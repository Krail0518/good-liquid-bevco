/* ============================================================
   attention.js — "Needs Attention Today" triage board
   ============================================================
   One prioritized list across every open lead AND active client, so a glance
   answers "who's waiting on me and what do I owe them?" — not just a vague
   "needs attention". Client-side: it reads the pipeline (deals) + clients, the
   outreach index (GL_OUTREACH — who emailed whom, when), and the AI briefs +
   open to-dos we store per record (ai_briefs / ai_brief_todos).

   Each row shows the concrete asks the other side is waiting on us for — pulled
   from the email thread by the AI brief as owner:'you' to-dos (e.g. "send the
   portal link", "review their process-authority letter", "review labels"). The
   🔄 Re-scan button re-reads every thread and regenerates those items on demand.

   Ranking, highest first:
     • 🟡 Your move        — they replied, you haven't (score by days waiting × value)
     • ⏰ Overdue to-do    — a "you" task past its due date
     • 🧊 Gone cold        — you emailed, no reply for 7+ days
     • 📌 You owe them     — open "you" action items, even if nobody's chasing
     • ✨ New lead         — has an email, never contacted (leads only)
   Records you've snoozed or marked handled from the board are hidden until the
   snooze lapses (persisted in attention_snoozes) — deals also honor their own
   legacy snoozed_until / handled_at.

   Exposes: window.glOpenAttentionBoard(), window.glRenderAttentionCard(mount)
   ============================================================ */
(function(){
  'use strict';

  function sb(){ return window.supa || null; }
  function esc(s){
    return String(s == null ? '' : s).replace(/[<>&"']/g, function(c){ return {'<':'&lt;', '>':'&gt;', '&':'&amp;', '"':'&quot;',"'":'&#39;'}[c]; });
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
    // 4) Never contacted but we have an address (leads only — handled by caller).
    if(d.email && (!e || !e.lastOut)){
      var age = daysSince(d.stageEnteredAt ? new Date(d.stageEnteredAt).getTime() : (d.createdAt ? new Date(d.createdAt).getTime() : 0));
      return { cat:'new', tag:'✨ New lead — not contacted', color:'#c4a4f8',
               score: 300 + Math.min(age,60)*3 + valueBoost(d), days:age };
    }
    return null;
  }

  // Run classify, then layer on "what I owe them". Any record with open
  // owner:'you' to-dos surfaces even when nobody is actively chasing — that's
  // the whole point: a running list of what Mike owes each account.
  function classifyRecord(rec, e, todos, brief, isClient){
    var c = classify(rec, e, todos, brief);
    if(c && c.cat === 'new' && isClient) c = null;          // "new lead" is lead-only
    var owed = (todos||[]).filter(function(t){ return t.owner === 'you' && !t.done; });
    if(!c && owed.length){
      c = { cat:'owed', tag:'📌 You owe them', color:'#c4a4f8', score: 500 + valueBoost(rec), days:0 };
    }
    return { c:c, owed:owed };
  }

  // Shared: rank every open lead + client into the attention buckets. Used by
  // the full board and the compact dashboard card, so both always agree.
  async function buildItems(){
    var deals = window.deals || {};
    var clients = window.clients || [];
    if(typeof window.glLoadOutreachIndex === 'function'){ try { await window.glLoadOutreachIndex(); } catch(_e){} }
    var IDX = window.GL_OUTREACH || {};
    var briefs = {}, todos = {}, snz = {};
    if(sb()){
      try {
        var br = await sb().from('ai_briefs').select('subject_kind,subject_id,status_text,ball,ball_since').in('subject_kind',['deal','client']);
        (br.data||[]).forEach(function(b){ briefs[b.subject_kind+':'+b.subject_id] = b; });
        var td = await sb().from('ai_brief_todos').select('id,subject_kind,subject_id,body,owner,due_date,done').in('subject_kind',['deal','client']).eq('done',false);
        (td.data||[]).forEach(function(t){ var k=t.subject_kind+':'+t.subject_id; (todos[k] = todos[k] || []).push(t); });
      } catch(e){ console.warn('[attention] load briefs', e); }
      try {
        var s = await sb().from('attention_snoozes').select('subject_kind,subject_id,snoozed_until,handled');
        (s.data||[]).forEach(function(x){ snz[x.subject_kind+':'+x.subject_id] = x; });
      } catch(e){ /* table may not exist yet — legacy deal snooze still honored */ }
    }
    function snoozed(kind,id){
      var x = snz[kind+':'+id]; if(!x) return false;
      if(x.handled) return true;
      return !!(x.snoozed_until && new Date(x.snoozed_until).getTime() > Date.now());
    }

    var items = [];
    // Open pipeline leads.
    Object.keys(deals).forEach(function(stage){
      if(stage === 'Closed Won' || stage === 'Closed Lost') return;
      (deals[stage]||[]).forEach(function(d, idx){
        if(!d || !d.id) return;
        if(snoozed('deal', d.id)) return;
        if(d.handledAt) return;                                            // legacy handled
        if(d.snoozedUntil && new Date(d.snoozedUntil).getTime() > Date.now()) return;  // legacy snooze
        var e = d.email ? IDX[String(d.email).trim().toLowerCase()] : null;
        var k = 'deal:'+d.id;
        var r = classifyRecord(d, e, todos[k], briefs[k], false);
        if(r.c) items.push({ kind:'deal', d:d, stage:stage, idx:idx, id:d.id, c:r.c, brief:briefs[k], owed:r.owed, todos:todos[k]||[] });
      });
    });
    // Active clients.
    clients.forEach(function(c){
      if(!c || !c.id) return;
      if(snoozed('client', c.id)) return;
      var e = c.email ? IDX[String(c.email).trim().toLowerCase()] : null;
      var k = 'client:'+c.id;
      var r = classifyRecord(c, e, todos[k], briefs[k], true);
      if(r.c) items.push({ kind:'client', d:c, stage:'Client', idx:-1, id:c.id, c:r.c, brief:briefs[k], owed:r.owed, todos:todos[k]||[] });
    });

    items.sort(function(a,b){ return b.c.score - a.c.score; });
    var counts = { 'your-move':0, overdue:0, cold:0, owed:0, 'new':0 };
    items.forEach(function(x){ counts[x.c.cat] = (counts[x.c.cat]||0) + 1; });
    return { items:items, counts:counts };
  }

  function openRecord(x){
    if(x.kind === 'client'){ if(typeof window.openClientDetail === 'function') window.openClientDetail(x.id); }
    else { if(typeof window.openDealDetail === 'function') window.openDealDetail(x.stage, x.idx); }
  }

  // Persist a board-level snooze / handled so the record stops reappearing.
  // Checks BOTH error and an empty returned row — RLS rejects silently.
  async function saveSnooze(kind, id, patch){
    if(!sb()) return false;
    var row = { subject_kind:kind, subject_id:String(id), updated_at:new Date().toISOString() };
    if('snoozed_until' in patch) row.snoozed_until = patch.snoozed_until;
    if('handled' in patch) row.handled = patch.handled;
    try {
      var r = await sb().from('attention_snoozes').upsert(row, { onConflict:'subject_kind,subject_id' }).select('subject_id');
      if(r.error || !r.data || !r.data.length){
        // Legacy fallback for deals if the snooze table isn't there yet.
        if(kind === 'deal'){
          if(patch.handled && typeof window.glMarkLeadHandled === 'function'){ window.glMarkLeadHandled(id); return true; }
          if(patch.snoozed_until && typeof window.glSnoozeLead === 'function'){ window.glSnoozeLead(id); return true; }
        }
        return false;
      }
      return true;
    } catch(e){ console.warn('[attention] saveSnooze', e); return false; }
  }

  // Every open lead + client that has an email — the full set the Re-scan
  // sweeps so brand-new asks surface even for accounts not currently listed.
  function allRecords(){
    var out = [];
    var deals = window.deals || {};
    Object.keys(deals).forEach(function(stage){
      if(stage === 'Closed Won' || stage === 'Closed Lost') return;
      (deals[stage]||[]).forEach(function(d){
        if(d && d.id && d.email && !String(d.id).startsWith('tmp_'))
          out.push({ kind:'deal', id:d.id, email:d.email, name:d.name, co:d.co, stage:stage, notes:d.notes });
      });
    });
    (window.clients||[]).forEach(function(c){
      if(c && c.id && c.email)
        out.push({ kind:'client', id:c.id, email:c.email, name:c.name, co:c.name, stage:'client', notes:c.notes });
    });
    return out;
  }

  // Compact "Needs attention today" card that auto-loads on the Dashboard.
  window.glRenderAttentionCard = async function glRenderAttentionCard(mount){
    var host = typeof mount === 'string' ? document.getElementById(mount) : mount;
    if(!host) return;
    if(!sb()){ host.style.display = 'none'; return; }
    host.style.display = '';
    host.style.cssText = 'background:#111d31;border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:15px 17px;margin-bottom:14px';
    host.innerHTML = '<div style="font-size:12px;color:#9aa7bd">Loading your to-do list…</div>';
    var built; try { built = await buildItems(); } catch(e){ host.style.display='none'; return; }
    var items = built.items, counts = built.counts;
    var chip = function(n,label,color){ return n ? '<span style="font-size:11px;padding:2px 8px;border-radius:20px;background:'+color+'22;color:'+color+';border:1px solid '+color+'55;font-weight:700">'+n+' '+label+'</span>' : ''; };
    var head = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">' +
      '<div style="font-weight:800;color:#eef4ff;font-size:14.5px">🔥 Needs attention today</div>' +
      '<button data-gl-action="glOpenAttentionBoard" style="background:none;border:none;color:var(--teal);font-size:12px;font-weight:700;cursor:pointer">Open full board →</button>' +
    '</div>';
    if(!items.length){ host.innerHTML = head + '<div style="font-size:12.5px;color:#9aa7bd;padding:4px 0">🎉 You\'re all caught up, nobody is waiting on you right now.</div>'; return; }
    var chips = '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">' +
      chip(counts['your-move'],'your move','#f5c842') + chip(counts.overdue,'overdue','#ff8579') +
      chip(counts.cold,'cold','#7fc6f5') + chip(counts.owed,'you owe','#c4a4f8') + chip(counts['new'],'new','#c4a4f8') + '</div>';
    var rows = items.slice(0,6).map(function(x){ var d=x.d, c=x.c;
      var owe = x.owed && x.owed.length ? '<span style="color:#c4a4f8;font-size:11px;white-space:nowrap"> · '+x.owed.length+' owed</span>' : '';
      return '<div class="gl-atc-row" data-i="'+items.indexOf(x)+'" style="display:flex;align-items:center;gap:10px;padding:8px 0;border-top:1px solid rgba(255,255,255,.06);cursor:pointer">' +
        '<span style="font-size:11px;font-weight:700;color:'+c.color+';white-space:nowrap;min-width:132px">'+esc(c.tag)+'</span>' +
        '<span style="font-weight:650;color:#eef4ff;font-size:13px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(d.name||d.co||'(unnamed)')+'</span>' +
        owe +
        '<span style="margin-left:auto;color:var(--teal);font-size:11px;font-weight:700;white-space:nowrap">Open →</span>' +
      '</div>';
    }).join('');
    var more = items.length > 6 ? '<div style="font-size:11.5px;color:#8493a8;margin-top:8px">…and '+(items.length-6)+' more on the board.</div>' : '';
    host.innerHTML = head + chips + rows + more;
    Array.prototype.forEach.call(host.querySelectorAll('.gl-atc-row'), function(el){
      el.addEventListener('click', function(){ openRecord(items[parseInt(el.getAttribute('data-i'),10)]); });
    });
  };

  window.glOpenAttentionBoard = async function glOpenAttentionBoard(){
    var prior = document.getElementById('gl-attention-modal'); if(prior) prior.remove();

    var ov = document.createElement('div');
    ov.id = 'gl-attention-modal';
    ov.setAttribute('style','position:fixed;inset:0;z-index:720;background:rgba(6,13,26,.96);backdrop-filter:blur(10px);display:flex;align-items:flex-start;justify-content:center;padding:24px;overflow-y:auto');

    ov.innerHTML = '<div style="width:100%;max-width:760px;color:#fff">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;gap:10px;flex-wrap:wrap">' +
        '<div style="font-family:var(--ff-disp);font-size:20px;letter-spacing:2px;color:#f5c842">🔥 NEEDS ATTENTION TODAY</div>' +
        '<span style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
          '<button id="gl-at-rescan" title="Re-read every email thread and refresh what each account needs from you" style="background:rgba(196,164,248,.12);border:1px solid rgba(196,164,248,.32);color:#c4a4f8;border-radius:7px;font-size:12px;font-weight:700;padding:5px 11px;cursor:pointer">🔄 Re-scan emails</button>' +
          '<button id="gl-at-send" title="Send this list to your phone (WhatsApp) + email now" style="background:rgba(0,229,192,.12);border:1px solid rgba(0,229,192,.3);color:#00e5c0;border-radius:7px;font-size:12px;font-weight:700;padding:5px 11px;cursor:pointer">📲 Send to my phone</button>' +
          '<button id="gl-at-close" style="background:none;border:none;color:#9aa7bd;font-size:24px;cursor:pointer;line-height:1">✕</button>' +
        '</span>' +
      '</div>' +
      '<div id="gl-at-body"><div style="color:#9aa7bd;font-size:13px;padding:20px">Loading…</div></div>' +
    '</div>';

    document.body.appendChild(ov);
    ov.addEventListener('click', function(e){ if(e.target === ov) ov.remove(); });
    ov.querySelector('#gl-at-close').onclick = function(){ ov.remove(); };

    var chip = function(n, label, color){ return n ? '<span style="font-size:11px;padding:3px 9px;border-radius:20px;background:'+color+'22;color:'+color+';border:1px solid '+color+'55;font-weight:700">'+n+' '+label+'</span>' : ''; };

    function owedHtml(owed){
      if(!owed || !owed.length) return '';
      var lis = owed.slice(0,8).map(function(t){
        var due = t.due_date ? ' <span style="color:#8493a8">· due '+esc(t.due_date)+'</span>' : '';
        return '<label class="gl-at-todo" style="display:flex;align-items:flex-start;gap:7px;padding:3px 0;cursor:pointer">' +
          '<input type="checkbox" class="gl-at-todochk" data-id="'+esc(t.id)+'" title="Check off once you\'ve done this" style="margin-top:2px;cursor:pointer;accent-color:#c4a4f8">' +
          '<span style="font-size:12px;color:#eef4ff;line-height:1.5">'+esc(t.body)+due+'</span>' +
        '</label>';
      }).join('');
      var more = owed.length>8 ? '<div style="font-size:11px;color:#8493a8">+'+(owed.length-8)+' more — open the account</div>' : '';
      return '<div style="margin-top:8px;padding:8px 10px;background:rgba(196,164,248,.08);border:1px solid rgba(196,164,248,.22);border-radius:8px">' +
        '<div style="font-size:9.5px;letter-spacing:1.5px;color:#c4a4f8;margin-bottom:4px;font-weight:700">THEY NEED FROM YOU</div>' + lis + more + '</div>';
    }

    function card(x, i){
      var d = x.d, c = x.c;
      var title = d.name || d.co || '(unnamed)';
      return '<div class="gl-at-card" data-i="'+i+'" style="background:#142238;border:1px solid rgba(255,255,255,.08);border-left:3px solid '+c.color+';border-radius:10px;padding:12px 14px;transition:border-color .15s">' +
        '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;cursor:pointer" class="gl-at-open">' +
          '<div style="min-width:0;flex:1">' +
            '<div style="font-weight:700;color:#eef4ff;font-size:14px">'+esc(title)+
              (x.kind==='client' ? ' <span style="color:#5fcf9e;font-weight:400;font-size:11px">· client</span>' : (d.co && d.name && d.co!==d.name ? ' <span style="color:#8493a8;font-weight:400;font-size:12px">· '+esc(d.co)+'</span>' : ''))+'</div>' +
            '<div style="margin-top:3px"><span style="font-size:11px;font-weight:700;color:'+c.color+'">'+esc(c.tag)+'</span>' +
              '<span style="font-size:11px;color:#6b7c93"> · '+esc(x.stage)+(money(d)?(' · $'+money(d).toLocaleString()):'')+'</span></div>' +
            (x.brief && x.brief.status_text ? '<div style="font-size:12px;color:#c7d2e0;margin-top:5px;line-height:1.5">'+esc(x.brief.status_text)+'</div>' : '') +
          '</div>' +
          '<span style="font-size:11px;color:var(--teal);white-space:nowrap;font-weight:700">Open →</span>' +
        '</div>' +
        owedHtml(x.owed) +
        '<div style="display:flex;gap:8px;margin-top:9px;padding-top:9px;border-top:1px solid rgba(255,255,255,.06)">' +
          '<button class="gl-at-snooze" data-i="'+i+'" style="font-size:11px;padding:4px 11px;background:rgba(143,179,255,.1);color:#8fb3ff;border:1px solid rgba(143,179,255,.3);border-radius:6px;font-weight:700;cursor:pointer">💤 Snooze 7d</button>' +
          '<button class="gl-at-handled" data-i="'+i+'" style="font-size:11px;padding:4px 11px;background:rgba(95,207,158,.1);color:#5fcf9e;border:1px solid rgba(95,207,158,.3);border-radius:6px;font-weight:700;cursor:pointer">✓ Handled</button>' +
        '</div>' +
      '</div>';
    }

    var CURRENT = [];
    async function fill(){
      var body = ov.querySelector('#gl-at-body'); if(!body) return;
      var built; try { built = await buildItems(); } catch(e){ body.innerHTML = '<div style="color:#ff8579;padding:16px">Could not load the board.</div>'; return; }
      CURRENT = built.items; var counts = built.counts;
      var chips = '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">' +
        chip(counts['your-move'],'your move','#f5c842') + chip(counts.overdue,'overdue','#ff8579') +
        chip(counts.cold,'cold','#7fc6f5') + chip(counts.owed,'you owe','#c4a4f8') + chip(counts['new'],'new','#c4a4f8') + '</div>';
      body.innerHTML = chips + (CURRENT.length
        ? '<div style="display:flex;flex-direction:column;gap:9px">' + CURRENT.map(function(x,i){ return card(x,i); }).join('') + '</div>'
        : '<div style="background:#142238;border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:28px;text-align:center;color:#9aa7bd">🎉 You\'re all caught up — nobody\'s waiting on you right now.</div>');

      Array.prototype.forEach.call(body.querySelectorAll('.gl-at-card'), function(el){
        el.addEventListener('mouseenter', function(){ el.style.borderColor = 'rgba(0,229,192,.4)'; });
        el.addEventListener('mouseleave', function(){ el.style.borderColor = 'rgba(255,255,255,.08)'; });
      });
      Array.prototype.forEach.call(body.querySelectorAll('.gl-at-open'), function(el){
        el.addEventListener('click', function(){ var x = CURRENT[parseInt(el.parentNode.getAttribute('data-i'),10)]; if(x){ ov.remove(); openRecord(x); } });
      });
      Array.prototype.forEach.call(body.querySelectorAll('.gl-at-snooze'), function(el){
        el.addEventListener('click', async function(e){ e.stopPropagation();
          var x = CURRENT[parseInt(el.getAttribute('data-i'),10)]; if(!x) return;
          el.disabled = true; el.textContent = '💤 …';
          var ok = await saveSnooze(x.kind, x.id, { snoozed_until:new Date(Date.now()+7*DAY).toISOString(), handled:false });
          if(ok){ if(typeof window.addNotification==='function') window.addNotification('💤 Snoozed', (x.d.name||x.d.co||'Account')+' — hidden for 7 days.', 'success'); await fill(); }
          else { el.disabled=false; el.textContent='💤 Snooze 7d'; if(typeof window.addNotification==='function') window.addNotification('Snooze failed','Could not save — try again.','warning'); }
        });
      });
      Array.prototype.forEach.call(body.querySelectorAll('.gl-at-handled'), function(el){
        el.addEventListener('click', async function(e){ e.stopPropagation();
          var x = CURRENT[parseInt(el.getAttribute('data-i'),10)]; if(!x) return;
          el.disabled = true; el.textContent = '✓ …';
          var ok = await saveSnooze(x.kind, x.id, { handled:true, snoozed_until:null });
          if(ok){ if(typeof window.addNotification==='function') window.addNotification('✓ Handled', (x.d.name||x.d.co||'Account')+' — cleared from the list.', 'success'); await fill(); }
          else { el.disabled=false; el.textContent='✓ Handled'; if(typeof window.addNotification==='function') window.addNotification('Update failed','Could not save — try again.','warning'); }
        });
      });
      // Check off an individual "they need from you" item — marks the AI brief
      // to-do done (both error and 0-rows treated as failure, per house rule).
      Array.prototype.forEach.call(body.querySelectorAll('.gl-at-todochk'), function(el){
        el.addEventListener('change', async function(){
          var id = el.getAttribute('data-id'); if(!id || !sb()){ el.checked=false; return; }
          el.disabled = true;
          try {
            var r = await sb().from('ai_brief_todos').update({ done:true, done_at:new Date().toISOString() }).eq('id', id).select('id');
            if(r.error || !r.data || !r.data.length){ el.disabled=false; el.checked=false; if(typeof window.addNotification==='function') window.addNotification('Could not check off','Try again.','warning'); return; }
          } catch(e){ el.disabled=false; el.checked=false; return; }
          await fill();
        });
      });
    }

    // Re-scan: re-read every thread and regenerate each account's owed-items,
    // then rebuild the board. Cheap for threads with nothing new (the brief
    // summarizer skips the AI call unless emails arrived since it last ran).
    var reBtn = ov.querySelector('#gl-at-rescan');
    if(reBtn) reBtn.onclick = async function(){
      if(typeof window.glRefreshBriefData !== 'function'){ await fill(); return; }
      var recs = allRecords();
      reBtn.disabled = true;
      for(var i=0;i<recs.length;i++){
        reBtn.textContent = '🔄 Scanning '+(i+1)+'/'+recs.length+'…';
        try { await window.glRefreshBriefData(recs[i]); } catch(e){}
      }
      reBtn.textContent = '✓ Rescanned '+recs.length;
      await fill();
      setTimeout(function(){ if(reBtn){ reBtn.disabled=false; reBtn.textContent='🔄 Re-scan emails'; } }, 2500);
    };

    var sendBtn = ov.querySelector('#gl-at-send');
    if(sendBtn) sendBtn.onclick = async function(){
      var btn = this; btn.disabled = true; btn.textContent = 'Sending…';
      try {
        var r = await sb().functions.invoke('attention-digest', { body: { source: 'manual' } });
        var d = (r && r.data) || {};
        if(r && r.error) throw new Error(r.error.message || 'send failed');
        if(d.items === 0 || d.skipped){ btn.textContent = '✓ Nothing urgent to send'; }
        else { btn.textContent = '✓ Sent'+((d.whatsappSent||d.emailSent)?'':' (check secrets)'); }
      } catch(e){ btn.textContent = '✗ Failed'; if(typeof window.addNotification==='function') window.addNotification('Digest failed', (e&&e.message)||'See console', 'warning'); console.error('[attention] send', e); }
      setTimeout(function(){ if(btn){ btn.disabled=false; btn.textContent='📲 Send to my phone'; } }, 3000);
    };

    fill();
  };

  console.log('[GL] attention board loaded');
}());
