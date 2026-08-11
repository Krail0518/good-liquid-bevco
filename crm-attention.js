/* ============================================================
   crm-attention.js — "Needs Attention Today" triage board
   ============================================================
   One prioritized list across every open deal so you know who to touch first,
   instead of opening 41 cards. Pure client-side: it reads the pipeline (deals),
   the outreach index (GL_OUTREACH — who emailed whom, when), and the AI briefs
   + open to-dos we already store. Each row shows why it's surfaced and links
   straight into the deal (+ its brief).

   Ranking, highest first:
     • 🟡 Your move        — they replied, you haven't (score by days waiting × value)
     • ⏰ Overdue to-do    — a "you" task past its due date
     • 🧊 Gone cold        — you emailed, no reply for 7+ days
     • ✨ New lead         — has an email, never contacted
   Deals waiting on the customer with nothing overdue drop off the list.

   Exposes: window.glOpenAttentionBoard()
   ============================================================ */
(function(){
  'use strict';

  function sb(){ return window.supa || null; }
  function esc(s){
    return String(s == null ? '' : s).replace(/[<>&"]/g, function(c){
      return { '<':'&lt;', '>':'&gt;', '&':'&amp;', '"':'&quot;' }[c];
    });
  }
  var DAY = 86400000;
  function daysSince(ms){ return ms ? Math.floor((Date.now()-ms)/DAY) : 0; }
  function money(d){ return parseFloat(String(d.val||d.value||'0').replace(/[^0-9.]/g,'')) || 0; }
  function today(){ return new Date().toISOString().slice(0,10); }

  // Value nudges the score a little so a $50k lead outranks a $2k one at the
  // same wait — but time waiting dominates, on purpose.
  function valueBoost(d){ return Math.min(money(d)/1000, 150); }

  function classify(d, e, briefTodos, brief){
    var t0 = today();
    var overdue = (briefTodos||[]).filter(function(x){ return x.owner==='you' && x.due_date && x.due_date < t0; });
    var replied = e && e.lastIn && e.lastOut && e.lastIn > e.lastOut;
    var ballYou = replied || (brief && brief.ball === 'you');

    // 1) They're waiting on you.
    if(ballYou){
      var since = replied ? e.lastIn : (brief && brief.ball_since ? new Date(brief.ball_since).getTime() : (e && e.lastIn) || 0);
      var dw = daysSince(since);
      return { cat:'your-move', tag:'🟡 Your move'+(dw?(' · '+dw+'d'):''), color:'#f5c842',
               score: 1000 + dw*12 + valueBoost(d), days:dw };
    }
    // 2) A task you own is past due.
    if(overdue.length){
      var od = Math.max.apply(null, overdue.map(function(x){ return daysSince(new Date(x.due_date+'T00:00:00').getTime()); }));
      return { cat:'overdue', tag:'⏰ To-do overdue'+(od?(' · '+od+'d'):''), color:'#ff8579',
               score: 820 + od*12 + valueBoost(d), days:od, overdue:overdue };
    }
    // 3) You reached out and it went quiet.
    if(e && e.lastOut && (!e.lastIn || e.lastIn <= e.lastOut)){
      var dc = daysSince(e.lastOut);
      if(dc >= 7) return { cat:'cold', tag:'🧊 Cold · '+dc+'d no reply', color:'#7fc6f5',
               score: 400 + dc*5 + valueBoost(d), days:dc };
      return null; // sent recently, still their move — not urgent
    }
    // 4) Never contacted but we have an address.
    if(d.email && (!e || !e.lastOut)){
      var age = daysSince(d.stageEnteredAt ? new Date(d.stageEnteredAt).getTime() : (d.createdAt ? new Date(d.createdAt).getTime() : 0));
      return { cat:'new', tag:'✨ New lead — not contacted', color:'#c4a4f8',
               score: 300 + Math.min(age,60)*3 + valueBoost(d), days:age };
    }
    return null;
  }

  window.glOpenAttentionBoard = async function glOpenAttentionBoard(){
    var prior = document.getElementById('gl-attention-modal'); if(prior) prior.remove();
    var deals = window.deals || {};

    // Fresh outreach signal (who's waiting) + briefs/to-dos for context.
    if(typeof window.glLoadOutreachIndex === 'function'){ try { await window.glLoadOutreachIndex(); } catch(_e){} }
    var IDX = window.GL_OUTREACH || {};
    var briefs = {}, todos = {};
    if(sb()){
      try {
        var br = await sb().from('ai_briefs').select('subject_id,status_text,ball,ball_since').eq('subject_kind','deal');
        (br.data||[]).forEach(function(b){ briefs[b.subject_id] = b; });
        var td = await sb().from('ai_brief_todos').select('subject_id,body,owner,due_date,done').eq('subject_kind','deal').eq('done',false);
        (td.data||[]).forEach(function(t){ (todos[t.subject_id] = todos[t.subject_id] || []).push(t); });
      } catch(e){ console.warn('[attention] load', e); }
    }

    var items = [];
    Object.keys(deals).forEach(function(stage){
      if(stage === 'Closed Won' || stage === 'Closed Lost') return;
      (deals[stage]||[]).forEach(function(d, idx){
        if(!d) return;
        var e = d.email ? IDX[String(d.email).trim().toLowerCase()] : null;
        var c = classify(d, e, todos[d.id], briefs[d.id]);
        if(c) items.push({ d:d, stage:stage, idx:idx, c:c, brief:briefs[d.id], todos:todos[d.id]||[] });
      });
    });
    items.sort(function(a,b){ return b.c.score - a.c.score; });

    var counts = { 'your-move':0, overdue:0, cold:0, new:0 };
    items.forEach(function(x){ counts[x.c.cat]++; });

    var ov = document.createElement('div');
    ov.id = 'gl-attention-modal';
    ov.setAttribute('style','position:fixed;inset:0;z-index:720;background:rgba(6,13,26,.96);backdrop-filter:blur(10px);display:flex;align-items:flex-start;justify-content:center;padding:24px;overflow-y:auto');

    function card(x){
      var d = x.d, c = x.c;
      var youTodos = x.todos.filter(function(t){ return t.owner==='you'; }).slice(0,2);
      return '<div class="gl-at-card" data-stage="'+esc(x.stage)+'" data-idx="'+x.idx+'" style="background:#142238;border:1px solid rgba(255,255,255,.08);border-left:3px solid '+c.color+';border-radius:10px;padding:12px 14px;cursor:pointer;transition:border-color .15s">' +
        '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">' +
          '<div style="min-width:0">' +
            '<div style="font-weight:700;color:#eef4ff;font-size:14px">'+esc(d.name||d.co||'(unnamed)')+
              (d.co && d.name && d.co!==d.name ? ' <span style="color:#8493a8;font-weight:400;font-size:12px">· '+esc(d.co)+'</span>' : '')+'</div>' +
            '<div style="margin-top:3px"><span style="font-size:11px;font-weight:700;color:'+c.color+'">'+esc(c.tag)+'</span>' +
              '<span style="font-size:11px;color:#6b7c93"> · '+esc(x.stage)+(money(d)?(' · $'+money(d).toLocaleString()):'')+'</span></div>' +
            (x.brief && x.brief.status_text ? '<div style="font-size:12px;color:#c7d2e0;margin-top:5px;line-height:1.5">'+esc(x.brief.status_text)+'</div>' : '') +
            (youTodos.length ? '<div style="margin-top:5px">'+youTodos.map(function(t){ return '<div style="font-size:11.5px;color:#eef4ff">☐ '+esc(t.body)+(t.due_date?(' <span style="color:#8493a8">· due '+esc(t.due_date)+'</span>'):'')+'</div>'; }).join('')+'</div>' : '') +
          '</div>' +
          '<span style="font-size:11px;color:var(--teal);white-space:nowrap;font-weight:700">Open →</span>' +
        '</div>' +
      '</div>';
    }

    var chip = function(n, label, color){ return n ? '<span style="font-size:11px;padding:3px 9px;border-radius:20px;background:'+color+'22;color:'+color+';border:1px solid '+color+'55;font-weight:700">'+n+' '+label+'</span>' : ''; };

    ov.innerHTML = '<div style="width:100%;max-width:760px;color:#fff">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">' +
        '<div style="font-family:var(--ff-disp);font-size:20px;letter-spacing:2px;color:#f5c842">🔥 NEEDS ATTENTION TODAY</div>' +
        '<button id="gl-at-close" style="background:none;border:none;color:#9aa7bd;font-size:24px;cursor:pointer;line-height:1">✕</button>' +
      '</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">' +
        chip(counts['your-move'],'your move','#f5c842') + chip(counts.overdue,'overdue','#ff8579') +
        chip(counts.cold,'cold','#7fc6f5') + chip(counts['new'],'new','#c4a4f8') +
      '</div>' +
      (items.length
        ? '<div style="display:flex;flex-direction:column;gap:9px">' + items.map(card).join('') + '</div>'
        : '<div style="background:#142238;border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:28px;text-align:center;color:#9aa7bd">🎉 You\'re all caught up — nobody\'s waiting on you right now.</div>') +
    '</div>';

    document.body.appendChild(ov);
    ov.addEventListener('click', function(e){ if(e.target === ov) ov.remove(); });
    ov.querySelector('#gl-at-close').onclick = function(){ ov.remove(); };
    Array.prototype.forEach.call(ov.querySelectorAll('.gl-at-card'), function(el){
      el.addEventListener('mouseenter', function(){ el.style.borderColor = 'rgba(0,229,192,.4)'; });
      el.addEventListener('mouseleave', function(){ el.style.borderColor = 'rgba(255,255,255,.08)'; });
      el.addEventListener('click', function(){
        var stage = el.getAttribute('data-stage'), idx = parseInt(el.getAttribute('data-idx'),10);
        ov.remove();
        if(typeof window.openDealDetail === 'function') window.openDealDetail(stage, idx);
      });
    });
  };

  console.log('[GL] attention board loaded');
}());
