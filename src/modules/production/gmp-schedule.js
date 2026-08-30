/* ============================================================
   gmp-schedule.js — GMP task scheduler + due/overdue dashboard
   ============================================================
   A self-contained "what's due today" board (no logic in index.html,
   nothing in localStorage — every task is a row in Postgres). Recurring
   task definitions live in gmp_task_defs; each generated instance is a
   compliance_tasks row (due_date + status + dedupe_key). One button
   fans the active daily/weekly definitions out into today's instances,
   idempotently (dedupe_key = gmpsched:<def.id>:<todayISO>).

   The board groups compliance_tasks into OVERDUE (open, past due),
   DUE TODAY (open, due today) and DONE TODAY (done, completed today).

   Exposes:
     window.glRenderGMPSchedule() — fills the #cpg-gmpsched page (the board)
     window.glGenerateGMPTasks()  — create today's instances from the defs
     window.glMarkTaskDone(id)    — mark one instance done, re-render
   ============================================================ */
(function(){
  'use strict';

  function sb(){ return window.supa || null; }
  function esc(s){
    return String(s == null ? '' : s).replace(/[<>&"]/g, function(c){
      return { '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;' }[c];
    });
  }
  function todayISO(){ try { return new Date().toISOString().slice(0,10); } catch(e){ return ''; } }
  function daysAgoISO(n){ try { return new Date(Date.now() - n*86400000).toISOString().slice(0,10); } catch(e){ return ''; } }
  function overlay(id){
    var prior = document.getElementById(id); if(prior) prior.remove();
    var ov = document.createElement('div');
    ov.id = id;
    ov.setAttribute('style','position:fixed;inset:0;z-index:900;background:rgba(6,13,26,.95);backdrop-filter:blur(14px);display:flex;align-items:flex-start;justify-content:center;padding:20px;overflow-y:auto');
    ov.addEventListener('click', function(e){ if(e.target === ov) ov.remove(); });
    document.body.appendChild(ov);
    return ov;
  }

  // ── The board: three groups (overdue / due today / done today) ──
  window.glRenderGMPSchedule = async function glRenderGMPSchedule(){
    // Staff-only tables. Several triggers reach this — boot, a
    // MutationObserver watching for the page node, and cNav — so the guard
    // belongs here rather than on any one of them. Deferred, not disabled:
    // the boot path runs through glWhenStaff and fires again at sign-in.
    if(!window.currentUser) return;
    var host = document.getElementById('cpg-gmpsched');
    if(!host) return;

    var header =
      '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:6px">' +
        '<div style="font-family:var(--ff-disp);font-size:24px;letter-spacing:2px;color:var(--teal)">🗓️ GMP SCHEDULE</div>' +
        '<button data-gl-action="glGenerateGMPTasks" style="padding:12px 20px;background:linear-gradient(135deg,#00e5c0,#00c4a7);color:#04231d;border:none;border-radius:9px;font-weight:800;font-size:14px;cursor:pointer">＋ Generate today’s tasks</button>' +
      '</div>' +
      '<div style="font-size:12.5px;color:var(--muted);margin-bottom:18px;line-height:1.6">Today’s recurring GMP tasks, generated from your task definitions. Anything left open past its due date shows under “Overdue”. Mark each check done as you go.</div>';

    var shell = function(inner){ return '<div style="max-width:1000px;margin:0 auto">' + header + inner + '</div>'; };

    if(!sb()){
      host.innerHTML = shell('<div style="color:#ff8579;padding:16px 0">Supabase not ready — cannot load tasks.</div>');
      return;
    }

    host.innerHTML = shell('<div style="color:#9aa7bd;padding:16px 0">Loading tasks…</div>');

    var today = todayISO();
    var recs;
    try {
      var r = await sb().from('compliance_tasks').select('*').gte('due_date', daysAgoISO(7)).order('due_date', { ascending: true });
      if(r.error) throw r.error;
      recs = r.data || [];
    } catch(e){
      host.innerHTML = shell('<div style="color:#ff8579;padding:16px 0">Could not load tasks: '+esc(e.message||e)+'</div>');
      return;
    }

    // Group in JS.
    var overdue = [], dueToday = [], doneToday = [];
    recs.forEach(function(t){
      var completedIso = t.completed_at ? String(t.completed_at).slice(0,10) : '';
      if(t.status === 'open' && t.due_date && t.due_date < today) overdue.push(t);
      else if(t.status === 'open' && t.due_date === today) dueToday.push(t);
      else if(t.status === 'done' && completedIso === today) doneToday.push(t);
    });

    var openCard = function(t, accent){
      return '<div style="border:1px solid '+accent.border+';border-radius:10px;padding:12px 14px;margin-bottom:10px;background:'+accent.bg+'">' +
          '<div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center">' +
            '<div style="min-width:0">' +
              '<div style="font-weight:700;font-size:13.5px;color:'+accent.title+'">'+esc(t.title||'(untitled task)')+'</div>' +
              '<div style="font-size:11px;color:#9aa7bd;margin-top:3px">' +
                esc(t.due_date||'') + (t.due_time?(' · '+esc(String(t.due_time).slice(0,5))):'') +
                (t.task_type?(' · '+esc(t.task_type)):'') +
              '</div>' +
            '</div>' +
            '<button data-gl-action="glMarkTaskDone" data-gl-arg1="'+esc(String(t.id))+'" style="white-space:nowrap;padding:8px 14px;background:rgba(0,229,192,.14);border:1px solid rgba(0,229,192,.35);border-radius:7px;color:var(--teal);font-weight:700;font-size:12px;cursor:pointer">✓ Mark done</button>' +
          '</div>' +
        '</div>';
    };

    var doneCard = function(t){
      var when = t.completed_at ? new Date(t.completed_at).toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit' }) : '';
      return '<div style="border:1px solid rgba(95,207,158,.25);border-radius:10px;padding:12px 14px;margin-bottom:10px;background:rgba(95,207,158,.05)">' +
          '<div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center">' +
            '<div style="min-width:0"><div style="font-weight:700;font-size:13.5px;color:#5fcf9e">'+esc(t.title||'(untitled task)')+'</div>' +
              '<div style="font-size:11px;color:#9aa7bd;margin-top:3px">'+(t.task_type?esc(t.task_type)+' · ':'')+'✓ done'+(when?(' '+esc(when)):'')+'</div></div>' +
          '</div>' +
        '</div>';
    };

    var group = function(title, count, accent, bodyHtml, emptyText){
      return '<div style="margin-bottom:20px">' +
          '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">' +
            '<span style="font-family:var(--ff-disp);font-size:14px;letter-spacing:1.5px;color:'+accent.title+'">'+title+'</span>' +
            '<span style="font-size:11px;color:#9aa7bd;background:rgba(255,255,255,.05);border-radius:20px;padding:1px 9px">'+count+'</span>' +
          '</div>' +
          (count ? bodyHtml : '<div style="color:#9aa7bd;font-size:12.5px;padding:6px 0 2px">'+emptyText+'</div>') +
        '</div>';
    };

    var overdueAccent = { title:'#ff8579', border:'rgba(255,133,121,.3)', bg:'rgba(255,133,121,.06)' };
    var todayAccent   = { title:'#f5c842', border:'rgba(245,200,66,.28)', bg:'rgba(245,200,66,.05)' };
    var doneAccent    = { title:'#5fcf9e' };

    var inner =
      group('⛔ OVERDUE', overdue.length, overdueAccent,
        overdue.map(function(t){ return openCard(t, overdueAccent); }).join(''),
        '✓ Nothing overdue.') +
      group('🟡 DUE TODAY', dueToday.length, todayAccent,
        dueToday.map(function(t){ return openCard(t, todayAccent); }).join(''),
        'No open tasks due today — generate today’s tasks if you haven’t yet.') +
      group('✅ DONE TODAY', doneToday.length, doneAccent,
        doneToday.map(function(t){ return doneCard(t); }).join(''),
        'Nothing marked done yet today.');

    host.innerHTML = shell(inner);
  };

  // ── Idempotently create today's task instances from active defs ──
  window.glGenerateGMPTasks = async function glGenerateGMPTasks(){
    if(!sb()){ alert('Supabase not ready.'); return; }
    var today = todayISO();
    var dow = new Date().getDay();  // 0=Sun … 6=Sat

    var defs;
    try {
      var dRes = await sb().from('gmp_task_defs').select('*').eq('active', true).order('sort_order', { ascending: true });
      if(dRes.error) throw dRes.error;
      defs = dRes.data || [];
    } catch(e){
      alert('Could not load task definitions: ' + (e.message || e));
      return;
    }

    // Decide which defs are due today. Keep it simple: 'daily' every day,
    // 'weekly' on their weekday (null weekday ⇒ Monday). Everything else
    // (per_run / as_needed / monthly) is event-driven — skip auto-generation.
    var due = defs.filter(function(def){
      if(def.frequency === 'daily') return true;
      if(def.frequency === 'weekly'){
        var wd = (def.weekday === null || def.weekday === undefined) ? 1 : def.weekday;
        return Number(wd) === dow;
      }
      return false;
    });

    if(!due.length){ alert('No daily/weekly GMP tasks due today (0 created).'); return; }

    // Dedupe: build a key per due def, see which already exist for today.
    var wanted = due.map(function(def){ return 'gmpsched:'+def.id+':'+today; });
    var existing = {};
    try {
      var eRes = await sb().from('compliance_tasks').select('dedupe_key').eq('due_date', today).in('dedupe_key', wanted);
      if(eRes.error) throw eRes.error;
      (eRes.data || []).forEach(function(row){ if(row.dedupe_key) existing[row.dedupe_key] = true; });
    } catch(e){
      alert('Could not check existing tasks: ' + (e.message || e));
      return;
    }

    var payload = [];
    due.forEach(function(def){
      var key = 'gmpsched:'+def.id+':'+today;
      if(existing[key]) return;   // already generated today
      payload.push({
        due_date: today,
        due_time: def.due_time || null,
        task_type: def.task_type,
        title: def.title,
        description: def.category || null,
        status: 'open',
        source: 'auto',
        dedupe_key: key
      });
    });

    if(!payload.length){
      await window.glRenderGMPSchedule();
      alert('Today’s tasks are already generated (0 new).');
      return;
    }

    try {
      var iRes = await sb().from('compliance_tasks').insert(payload).select('id');
      if(iRes.error) throw iRes.error;
      if(typeof window.glAudit === 'function') window.glAudit('gmp_tasks_generated', today, { created: payload.length });
      await window.glRenderGMPSchedule();
      alert('✓ Generated ' + payload.length + ' task' + (payload.length===1?'':'s') + ' for today.');
    } catch(e){
      alert('Could not generate tasks: ' + (e.message || e));
    }
  };

  // ── Mark one task instance done, then re-render ──
  window.glMarkTaskDone = async function glMarkTaskDone(id){
    if(!sb()){ alert('Supabase not ready.'); return; }
    var uid = (window.currentUser && window.currentUser.id) || null;
    try {
      var r = await sb().from('compliance_tasks').update({
        status: 'done',
        completed_at: new Date().toISOString(),
        completed_by: uid
      }).eq('id', id).select();
      if(r.error) throw r.error;
      if(Array.isArray(r.data) && r.data.length === 0) throw new Error('the server rejected the change (0 rows updated)');
      if(typeof window.glAudit === 'function') window.glAudit('gmp_task_done', id);
      await window.glRenderGMPSchedule();
    } catch(e){
      var host = document.getElementById('cpg-gmpsched');
      if(host){
        var banner = document.createElement('div');
        banner.setAttribute('style','max-width:1000px;margin:10px auto;color:#ff8579;font-size:12.5px;padding:9px 12px;background:rgba(255,133,121,.08);border:1px solid rgba(255,133,121,.3);border-radius:8px');
        banner.textContent = 'Could not mark task done: ' + (e.message || e);
        host.insertBefore(banner, host.firstChild);
      } else {
        alert('Could not mark task done: ' + (e.message || e));
      }
    }
  };

  // Render the board into its page container once the DOM is ready.
  function boot(){ try { if(document.getElementById('cpg-gmpsched')) window.glRenderGMPSchedule(); } catch(e){} }
  // Staff-only data: do not load it for a logged-out visitor. Deferred
  // rather than skipped, because sign-in happens after this runs.
  function glBoot(){ if(window.glWhenStaff) window.glWhenStaff(boot); else boot(); }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', glBoot); else glBoot();
  // Re-render if the page node appears later (SPA builds it after login).
  try {
    var mo = new MutationObserver(function(){ var h = document.getElementById('cpg-gmpsched'); if(h && !h.getAttribute('data-gmpsched-ready')){ h.setAttribute('data-gmpsched-ready','1'); window.glRenderGMPSchedule(); } });
    mo.observe(document.documentElement, { childList:true, subtree:true });
  } catch(e){}

  console.log('[GL] GMP schedule module loaded');
}());
