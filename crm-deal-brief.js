/* ============================================================
   crm-deal-brief.js — the AI "Deal Brief"
   ============================================================
   A living, incrementally-updated summary of a lead/client's whole thread —
   emails + meeting notes + staff notes — so opening a deal answers "where's
   this at and what do I owe them?" without reading anything.

   Renders at the top of the deal detail panel and the client detail popup:
     • Status  — where it stands + the immediate next step
     • Ball    — whose court it's in (computed from the newest email) + how long
     • Key facts — product, volume, format, timeline, quote, decisions
     • Next actions — checkable to-dos (AI-extracted + your own), persisted

   INCREMENTAL: the stored brief is fed back to the model together with ONLY the
   emails/notes that arrived since it last ran, and the model merges — so it
   doesn't re-read 900 emails or parrot old info. Backed by ai_briefs +
   ai_brief_todos (migration 20260811000000). Summarization goes through the
   existing ai-proxy edge function (Claude Haiku), same key as callAI.

   Exposes: window.glRenderBrief(mount, { kind, id, email, name, co, stage, notes })
   ============================================================ */
(function(){
  'use strict';

  function sb(){ return window.supa || null; }
  function esc(s){
    return String(s == null ? '' : s).replace(/[<>&"]/g, function(c){
      return { '<':'&lt;', '>':'&gt;', '&':'&amp;', '"':'&quot;' }[c];
    });
  }
  function elOf(m){ return typeof m === 'string' ? document.querySelector(m) : m; }
  function slug(s){ return String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,44) || ('t-'+Math.random().toString(36).slice(2,7)); }
  function tAt(row){ return new Date(row.sent_at || row.created_at || 0).getTime() || 0; }
  function ago(ms){
    if(!ms) return '';
    var d = Math.floor((Date.now()-ms)/86400000);
    if(d <= 0){ var h = Math.floor((Date.now()-ms)/3600000); return h <= 0 ? 'just now' : h+'h'; }
    return d+'d';
  }

  // In-flight guard so opening/closing a panel can't stack summarize calls.
  var RUNNING = {};

  function key(kind,id){ return kind+':'+id; }

  // ---- data gathering -------------------------------------------------------
  async function gatherEmails(email){
    if(!email || typeof window.glLoadEmailLog !== 'function') return [];
    var res = await window.glLoadEmailLog(email);
    var rows = (res && res.rows) || [];
    return rows.map(function(r){
      return { dir: r.direction === 'inbound' ? 'IN' : 'OUT',
               subject: r.subject || '', body: r.body_preview || r.body || '',
               at: tAt(r) };
    }).filter(function(e){ return e.at; }).sort(function(a,b){ return a.at - b.at; });
  }
  async function gatherNotes(kind,id){
    if(!sb()) return [];
    var r = await sb().from('meeting_notes').select('title, meeting_date, body, created_at')
      .eq('subject_kind',kind).eq('subject_id',id).order('created_at',{ascending:true});
    return (r && r.data) || [];
  }
  async function loadBrief(kind,id){
    var r = await sb().from('ai_briefs').select('*').eq('subject_kind',kind).eq('subject_id',id).maybeSingle();
    return (r && r.data) || null;
  }
  async function loadTodos(kind,id){
    var r = await sb().from('ai_brief_todos').select('*').eq('subject_kind',kind).eq('subject_id',id).order('created_at',{ascending:true});
    return (r && r.data) || [];
  }

  // Ball-in-court is a timestamp fact, not a judgement call — compute it from the
  // newest email so "waiting on you 3d" is exact. Newest is inbound → they wrote
  // last, you owe a reply. Newest is outbound → waiting on them.
  function computeBall(emails){
    if(!emails.length) return { ball:'none', since:null };
    var last = emails[emails.length-1];
    return { ball: last.dir === 'IN' ? 'you' : 'them', since: last.at };
  }

  // ---- the summarizer -------------------------------------------------------
  async function aiJSON(system, user){
    try {
      var resp = await sb().functions.invoke('ai-proxy', {
        body: { systemPrompt: system, userPrompt: user, model: 'claude-haiku-4-5', maxTokens: 1600 }
      });
      if(resp.error || (resp.data && resp.data.ok === false)) return null;
      var txt = (resp.data && resp.data.text) || '';
      var a = txt.indexOf('{'), b = txt.lastIndexOf('}');
      if(a < 0 || b < a) return null;
      return JSON.parse(txt.slice(a, b+1));
    } catch(e){ console.warn('[brief] aiJSON', e); return null; }
  }

  var SYS = 'You maintain a running CRM brief for Good Liquid Bev Co, a beverage co-packer, tracking a sales lead or client. '
    + 'You are given the CURRENT brief (may be empty) plus NEW emails and notes since it last updated. Update the brief; do NOT repeat facts already captured. '
    + 'Output STRICT JSON only — no prose, no code fences — with these keys:\n'
    + '"status_text": 1-3 plain sentences on where things stand and the single most important next step.\n'
    + '"key_facts": array of {"label","value"} for durable facts (product, volume, format, timeline, quote/$ , decisions). Merge with the current facts; no duplicates.\n'
    + '"todos_add": array of {"body","owner","due_date","ai_key"} for NEW open action items only (not already in the open to-dos given). owner is "you" (Good Liquid must act) or "them" (waiting on the lead). due_date is "YYYY-MM-DD" or null. ai_key is a short kebab-case slug unique to the task.\n'
    + '"todos_complete_keys": array of ai_key strings, taken from the OPEN TO-DOS given, that these new emails/notes show are now done.\n'
    + 'Be concise and factual. If nothing material changed, return empty arrays and keep the status accurate.';

  async function summarize(ctx){
    var kind = ctx.kind, id = ctx.id;
    var brief = await loadBrief(kind,id);
    var emails = await gatherEmails(ctx.email);
    var notes  = await gatherNotes(kind,id);
    var openTodos = (await loadTodos(kind,id)).filter(function(t){ return !t.done; });

    var lastAt = brief && brief.last_email_at ? new Date(brief.last_email_at).getTime() : 0;
    var newEmails = emails.filter(function(e){ return e.at > lastAt; });
    if(!brief) newEmails = newEmails.slice(-40);                 // first run: cap history
    var newNotes = notes.slice(brief ? (brief.source_note_count || 0) : 0);

    var ballInfo = computeBall(emails);

    // Nothing new to fold in — just refresh ball/stale and bail (no AI spend).
    if(brief && !newEmails.length && !newNotes.length){
      await sb().from('ai_briefs').update({
        stale:false, ball:ballInfo.ball, ball_since: ballInfo.since ? new Date(ballInfo.since).toISOString() : null,
        last_email_at: emails.length ? new Date(emails[emails.length-1].at).toISOString() : brief.last_email_at,
        source_email_count: emails.length, source_note_count: notes.length, updated_at: new Date().toISOString()
      }).eq('subject_kind',kind).eq('subject_id',id);
      return;
    }

    var u = 'SUBJECT: ' + (ctx.name||'(unnamed)') + (ctx.co ? ' — '+ctx.co : '') + (ctx.stage ? ' — stage: '+ctx.stage : '') + '\n';
    u += 'CURRENT STATUS: ' + ((brief && brief.status_text) || '(none yet)') + '\n';
    u += 'CURRENT KEY FACTS: ' + JSON.stringify((brief && brief.key_facts) || []) + '\n';
    u += 'OPEN TO-DOS: ' + JSON.stringify(openTodos.map(function(t){ return { ai_key: t.ai_key || slug(t.body), body: t.body, owner: t.owner }; })) + '\n';
    if(ctx.notes) u += 'STAFF NOTE ON RECORD: ' + String(ctx.notes).slice(0, 800) + '\n';
    u += '\nNEW EMAILS (' + newEmails.length + ', chronological):\n';
    u += newEmails.map(function(e){
      return '['+e.dir+'] '+(e.subject||'(no subject)')+'\n'+String(e.body||'').slice(0, 1200);
    }).join('\n---\n') || '(none)';
    u += '\n\nNEW MEETING/STAFF NOTES (' + newNotes.length + '):\n';
    u += newNotes.map(function(n){ return (n.title||'Note')+(n.meeting_date?(' '+n.meeting_date):'')+':\n'+String(n.body||'').slice(0,2000); }).join('\n---\n') || '(none)';
    u += '\n\nReturn the updated JSON.';

    var out = await aiJSON(SYS, u);
    if(!out){ // AI failed — leave prior brief, clear stale so we don't spin
      if(brief) await sb().from('ai_briefs').update({ stale:false, updated_at:new Date().toISOString() }).eq('subject_kind',kind).eq('subject_id',id);
      return;
    }

    // Persist the brief.
    var facts = Array.isArray(out.key_facts) ? out.key_facts.filter(function(f){ return f && f.label; }).slice(0,12) : ((brief && brief.key_facts)||[]);
    await sb().from('ai_briefs').upsert({
      subject_kind:kind, subject_id:id,
      status_text: out.status_text || (brief && brief.status_text) || '',
      ball: ballInfo.ball, ball_since: ballInfo.since ? new Date(ballInfo.since).toISOString() : null,
      key_facts: facts,
      last_email_at: emails.length ? new Date(emails[emails.length-1].at).toISOString() : (brief && brief.last_email_at) || null,
      source_email_count: emails.length, source_note_count: notes.length,
      model: 'claude-haiku-4-5', stale:false, updated_at: new Date().toISOString()
    }, { onConflict: 'subject_kind,subject_id' });

    // Reconcile to-dos.
    var allTodos = await loadTodos(kind,id);
    var openByKey = {}, doneKeys = {};
    allTodos.forEach(function(t){
      var k = t.ai_key || slug(t.body);
      if(t.done) doneKeys[k] = true; else openByKey[k] = t;
    });
    var toInsert = [];
    (Array.isArray(out.todos_add) ? out.todos_add : []).forEach(function(t){
      if(!t || !t.body) return;
      var k = t.ai_key ? slug(t.ai_key) : slug(t.body);
      if(openByKey[k] || doneKeys[k]) return;   // already tracked or already done — don't resurrect
      openByKey[k] = true;
      toInsert.push({ subject_kind:kind, subject_id:id, body:String(t.body).slice(0,300),
        owner: t.owner === 'them' ? 'them' : 'you', due_date: /^\d{4}-\d{2}-\d{2}$/.test(t.due_date||'') ? t.due_date : null,
        source:'ai', ai_key:k });
    });
    if(toInsert.length) await sb().from('ai_brief_todos').insert(toInsert);

    var completeKeys = (Array.isArray(out.todos_complete_keys) ? out.todos_complete_keys : []).map(slug);
    for(var i=0;i<completeKeys.length;i++){
      var ot = allTodos.filter(function(t){ return !t.done && t.source==='ai' && (t.ai_key||slug(t.body)) === completeKeys[i]; })[0];
      if(ot) await sb().from('ai_brief_todos').update({ done:true, done_at:new Date().toISOString() }).eq('id', ot.id);
    }
  }

  // ---- rendering ------------------------------------------------------------
  function ballPill(ball, since){
    if(ball === 'you')  return '<span style="padding:3px 10px;border-radius:20px;font-size:11px;font-weight:800;background:rgba(245,200,66,.16);color:#f5c842;border:1px solid rgba(245,200,66,.4)">🟡 YOUR MOVE'+(since?(' · '+ago(since)):'')+'</span>';
    if(ball === 'them') return '<span style="padding:3px 10px;border-radius:20px;font-size:11px;font-weight:800;background:rgba(29,158,117,.16);color:#5fcf9e;border:1px solid rgba(29,158,117,.4)">🟢 Waiting on them'+(since?(' · '+ago(since)):'')+'</span>';
    return '<span style="padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;background:rgba(255,255,255,.05);color:#9aa7bd;border:1px solid rgba(255,255,255,.12)">— no contact yet</span>';
  }

  function todoLine(t){
    var ownerTag = '<span style="font-size:9px;padding:1px 6px;border-radius:10px;margin-left:6px;background:'+(t.owner==='them'?'rgba(29,158,117,.15);color:#5fcf9e':'rgba(245,200,66,.15);color:#f5c842')+'">'+(t.owner==='them'?'them':'you')+'</span>';
    var due = t.due_date ? '<span style="font-size:10px;color:#9aa7bd;margin-left:6px">· due '+esc(t.due_date)+'</span>' : '';
    return '<label class="gl-br-todo" style="display:flex;align-items:flex-start;gap:8px;padding:4px 0;cursor:pointer;'+(t.done?'opacity:.5':'')+'">' +
      '<input type="checkbox" class="gl-br-chk" data-id="'+esc(t.id)+'" '+(t.done?'checked':'')+' style="margin-top:3px;cursor:pointer">' +
      '<span style="font-size:12.5px;color:#eef4ff;'+(t.done?'text-decoration:line-through':'')+'">'+esc(t.body)+ownerTag+due+'</span>' +
    '</label>';
  }

  async function paint(host, ctx, opts){
    opts = opts || {};
    var kind = ctx.kind, id = ctx.id;
    var brief = await loadBrief(kind,id);
    var todos = await loadTodos(kind,id);

    // Decide if a refresh is warranted (stale flag, missing, or new emails/notes
    // since last run) — unless we're just repainting after a checkbox toggle.
    var needRefresh = !opts.noRefresh && !RUNNING[key(kind,id)] && (
      !brief || brief.stale ||
      (typeof opts.emailCount === 'number' && brief && opts.emailCount > (brief.source_email_count||0)) ||
      (typeof opts.noteCount  === 'number' && brief && opts.noteCount  > (brief.source_note_count ||0))
    );

    var open = todos.filter(function(t){ return !t.done; });
    var done = todos.filter(function(t){ return t.done; });

    var head = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">' +
      '<span style="font-size:10px;letter-spacing:2px;color:var(--teal)">🧠 BRIEF</span>' +
      '<span style="display:flex;align-items:center;gap:8px">' +
        (brief && brief.updated_at ? '<span style="font-size:10px;color:#6b7c93">updated '+ago(new Date(brief.updated_at).getTime())+' ago</span>' : '') +
        '<button class="gl-br-refresh" title="Re-summarize now" style="background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);color:#9aa7bd;border-radius:6px;font-size:12px;padding:2px 8px;cursor:pointer">🔄</button>' +
      '</span>' +
    '</div>';

    var card = '<div style="background:rgba(0,229,192,.04);border:1px solid rgba(0,229,192,.18);border-radius:12px;padding:14px 16px">';

    if(RUNNING[key(kind,id)] || (needRefresh && !brief)){
      card += head + '<div style="font-size:12px;color:var(--teal);padding:6px 0">🧠 Summarizing the thread…</div></div>';
      host.innerHTML = card;
    } else if(!brief){
      card += head + '<div style="font-size:12px;color:#9aa7bd">No brief yet. <a href="#" class="gl-br-refresh" style="color:var(--teal)">Generate one</a> from this lead\'s emails and notes.</div></div>';
      host.innerHTML = card;
    } else {
      card += head;
      card += '<div style="margin-bottom:8px">'+ballPill(brief.ball, brief.ball_since ? new Date(brief.ball_since).getTime() : null)+'</div>';
      card += '<div style="font-size:13px;color:#eef4ff;line-height:1.6;margin-bottom:10px">'+esc(brief.status_text||'—')+'</div>';
      var facts = Array.isArray(brief.key_facts) ? brief.key_facts : [];
      if(facts.length){
        card += '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">' + facts.map(function(f){
          return '<span style="font-size:11px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:6px;padding:3px 8px;color:#c7d2e0"><span style="color:#8493a8">'+esc(f.label)+':</span> '+esc(f.value)+'</span>';
        }).join('') + '</div>';
      }
      card += '<div style="font-size:10px;letter-spacing:1px;color:#8493a8;margin:6px 0 2px">NEXT ACTIONS</div>';
      card += open.length ? open.map(todoLine).join('') : '<div style="font-size:12px;color:#6b7c93;padding:2px 0">Nothing open. 🎉</div>';
      if(done.length){
        card += '<details style="margin-top:6px"><summary style="font-size:10px;color:#6b7c93;cursor:pointer">'+done.length+' done</summary>'+done.map(todoLine).join('')+'</details>';
      }
      // manual add
      card += '<div style="display:flex;gap:6px;margin-top:8px">' +
        '<input class="gl-br-newtodo" placeholder="Add a task…" style="flex:1;padding:6px 9px;background:#0a1628;border:1px solid rgba(255,255,255,.12);border-radius:6px;color:#fff;font-size:12px">' +
        '<button class="gl-br-addtodo" style="padding:6px 12px;background:rgba(0,229,192,.12);border:1px solid rgba(0,229,192,.3);border-radius:6px;color:#00e5c0;font-size:12px;font-weight:700;cursor:pointer">Add</button>' +
      '</div>';
      card += '</div>';
      host.innerHTML = card;
    }

    // wire refresh
    Array.prototype.forEach.call(host.querySelectorAll('.gl-br-refresh'), function(b){
      b.addEventListener('click', function(e){ e.preventDefault(); runRefresh(host, ctx, true); });
    });
    // wire checkboxes
    Array.prototype.forEach.call(host.querySelectorAll('.gl-br-chk'), function(c){
      c.addEventListener('change', async function(){
        var tid = this.getAttribute('data-id'), on = this.checked;
        try { await sb().from('ai_brief_todos').update({ done:on, done_at: on ? new Date().toISOString() : null }).eq('id', tid); } catch(e){}
        paint(host, ctx, { noRefresh:true });
      });
    });
    // wire manual add
    var addBtn = host.querySelector('.gl-br-addtodo');
    if(addBtn) addBtn.addEventListener('click', async function(){
      var inp = host.querySelector('.gl-br-newtodo'); var v = (inp.value||'').trim(); if(!v) return;
      try { await sb().from('ai_brief_todos').insert({ subject_kind:kind, subject_id:id, body:v.slice(0,300), owner:'you', source:'manual', ai_key:'m-'+slug(v) }); } catch(e){}
      paint(host, ctx, { noRefresh:true });
    });

    // kick a refresh if warranted
    if(needRefresh) runRefresh(host, ctx, false);
  }

  async function runRefresh(host, ctx, force){
    var k = key(ctx.kind, ctx.id);
    if(RUNNING[k]) return;
    if(force){ try { await sb().from('ai_briefs').update({ stale:true }).eq('subject_kind',ctx.kind).eq('subject_id',ctx.id); } catch(e){} }
    RUNNING[k] = true;
    paint(host, ctx, { noRefresh:true });      // show spinner
    try { await summarize(ctx); } catch(e){ console.warn('[brief] summarize', e); }
    RUNNING[k] = false;
    paint(host, ctx, { noRefresh:true });      // final render
  }

  // Public entry: render the brief for a deal/client, refreshing if stale/new.
  window.glRenderBrief = async function glRenderBrief(mount, ctx){
    var host = elOf(mount);
    if(!host) return;
    ctx = ctx || {};
    if(!ctx.kind || !ctx.id){ host.innerHTML = ''; return; }
    if(!sb()){ host.innerHTML = ''; return; }
    host.innerHTML = '<div style="font-size:11px;color:#9aa7bd">Loading brief…</div>';
    // Count current emails/notes so paint() can detect "new since last summary".
    var emailCount = 0, noteCount = 0;
    try {
      if(ctx.email && typeof window.glLoadEmailLog === 'function'){ var r = await window.glLoadEmailLog(ctx.email); emailCount = ((r&&r.rows)||[]).length; }
      var nr = await sb().from('meeting_notes').select('id',{count:'exact',head:true}).eq('subject_kind',ctx.kind).eq('subject_id',ctx.id);
      noteCount = (nr && nr.count) || 0;
    } catch(e){}
    paint(host, ctx, { emailCount: emailCount, noteCount: noteCount });
  };

  console.log('[GL] deal-brief module loaded');
}());
