/* ============================================================================
   STAFF — PROJECT TRACKER
   ----------------------------------------------------------------------------
   One row per client project (and per open lead), each drawn as a 14-step
   progress line in four phases:

     Sales       Lead in · Qualified · Quote sent · Won
     Onboarding  Onboarding
     Formulation Formulation · 1 L batch (rounds) · 1 L approved · 50 L batch
                 · Process Authority letter
     Production  Scheduled · Production run · Quality check and shipped
                 · Invoiced and paid

   WHERE EACH STEP COMES FROM
   - Sales steps are DERIVED here from deals / quotes / product_intake. They
     are not stored as milestones on purpose: milestones are client-readable,
     and a client must never see pipeline state (or anyone else's leads).
   - Every other step is a project_milestones row. Staff edit them here;
     the database also moves them by itself (migration
     20261115150000_project_tracker_steps.sql): finishing a step starts the
     next, and onboarding / Process Authority letter / production runs /
     paid invoices finish steps. Auto moves are forward-only.

   RULES THIS FILE FOLLOWS (CLAUDE.md)
   - Everything a lead or client typed goes through esc() before it reaches
     innerHTML: brand names, product names, contact names.
   - Every write appends .select() and treats an error OR an empty array as
     failure — RLS rejects silently.
   - No inline handlers (CSP has no 'unsafe-inline' for scripts): one
     delegated click listener on the page body.
   ========================================================================== */
(function(){
  'use strict';

  function getSB(){ return window.supa || null; }
  var esc = window.glEsc || function(s){ return String(s==null?'':s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); };

  var DAY = 86400000;
  var STALL_DAYS = 14;      // current step older than this = stalled
  var LEAD_WINDOW_DAYS = 90; // Prospecting leads untouched longer are hidden unless "Show older leads"

  var COLOR = {
    done:   '#5fcf9e',
    cur:    '#00e5c0',
    wait:   '#f5c842',
    block:  '#ff8579',
    skip:   '#6b87ad',
    todo:   '#3d4a63'
  };
  var MS_STATUS = ['not_started','in_progress','awaiting_client','completed','skipped','blocked'];
  var MS_LABEL = { not_started:'Not started', in_progress:'In progress', awaiting_client:'Waiting on client',
                   completed:'Done', skipped:'Skipped', blocked:'Blocked' };
  var LOOP_KEYS = ['batch_1l_sent','client_feedback','formula_revisions'];

  // The 14 visible steps. kind: 'sales' (derived) | 'ms' (one milestone key) | 'loop' (1 L rounds)
  var STEPS = [
    { phase:'sales',       key:'lead',       label:'Lead in',                   kind:'sales', doing:'New lead' },
    { phase:'sales',       key:'qualified',  label:'Qualified',                 kind:'sales', doing:'Qualifying' },
    { phase:'sales',       key:'quoted',     label:'Quote sent',                kind:'sales', doing:'Preparing quote' },
    { phase:'sales',       key:'won',        label:'Won',                       kind:'sales', doing:'Quote out, awaiting decision' },
    { phase:'onboarding',  key:'intake',     label:'Onboarding',                kind:'ms' },
    { phase:'formulation', key:'formulation',label:'Formulation',               kind:'ms' },
    { phase:'formulation', key:'loop_1l',    label:'1 L batch',                 kind:'loop' },
    { phase:'formulation', key:'batch_1l_approved', label:'1 L batch approved', kind:'ms' },
    { phase:'formulation', key:'batch_50l',  label:'50 L batch',                kind:'ms' },
    { phase:'formulation', key:'pa_letter',  label:'Process Authority letter',  kind:'ms' },
    { phase:'production',  key:'production_scheduled', label:'Production scheduled', kind:'ms' },
    { phase:'production',  key:'production_run', label:'Production run',        kind:'ms' },
    { phase:'production',  key:'shipped',    label:'Quality check and shipped', kind:'ms' },
    { phase:'production',  key:'invoiced_paid', label:'Invoiced and paid',      kind:'ms' }
  ];
  var PHASES = [
    { key:'sales', label:'Sales' }, { key:'onboarding', label:'Onboarding' },
    { key:'formulation', label:'Formulation' }, { key:'production', label:'Production' }
  ];

  var state = {
    rows: [],             // built rows
    msById: {},           // milestone id -> row
    filter: 'all',
    search: '',
    showOldLeads: false,
    openEditor: null,     // { rowId, stepKey }
    history: {}           // milestone id -> audit rows
  };

  // ── Helpers ───────────────────────────────────────────────────────────────
  function norm(s){ return String(s||'').trim().toLowerCase(); }
  function days(since){
    if(!since) return null;
    var t = new Date(since).getTime();
    if(!isFinite(t)) return null;
    return Math.max(0, Math.floor((Date.now() - t) / DAY));
  }
  function fmtDate(d){
    if(!d) return '';
    var t = new Date(d);
    if(!isFinite(t.getTime())) return '';
    return t.toLocaleDateString(undefined, { month:'short', day:'numeric', year:'numeric' });
  }
  function visual(status){
    switch(status){
      case 'completed':       return 'done';
      case 'in_progress':     return 'cur';
      case 'awaiting_client': return 'wait';
      case 'blocked':         return 'block';
      case 'skipped':         return 'skip';
      default:                return 'todo';
    }
  }
  // Latest round of each key, as a key -> milestone map.
  function latestByKey(ms){
    var out = {};
    ms.forEach(function(m){
      if(m.track !== 'formulation') return;
      if(!out[m.key] || m.round > out[m.key].round) out[m.key] = m;
    });
    return out;
  }

  // The 1 L loop shown as one dot. Its state is the state of whichever loop
  // step is live in the latest round; done once the 1 L batch is approved.
  function loopState(latest){
    var approved = latest.batch_1l_approved && latest.batch_1l_approved.status === 'completed';
    var parts = LOOP_KEYS.map(function(k){ return latest[k]; }).filter(Boolean);
    var round = parts.reduce(function(r, m){ return Math.max(r, m.round); }, 1);
    if(approved) return { v:'done', round: round, sub: 'approved', since: latest.batch_1l_approved.completed_at, ms: parts };
    var live = parts.filter(function(m){ return m.status === 'awaiting_client' || m.status === 'in_progress' || m.status === 'blocked'; })[0];
    if(live) return { v: visual(live.status), round: round, sub: live.label, since: live.updated_at, ms: parts };
    var anyDone = parts.some(function(m){ return m.status === 'completed'; });
    return { v: anyDone ? 'cur' : 'todo', round: round, sub: anyDone ? 'between rounds' : '', since: null, ms: parts };
  }

  // ── Load ──────────────────────────────────────────────────────────────────
  async function load(){
    var sb = getSB();
    if(!sb) throw new Error('Not connected to the database.');

    var results = await Promise.all([
      sb.from('projects')
        .select('id, client_id, name, product_name, status, target_date, created_at, archived_at')
        .is('archived_at', null).in('status', ['active','on_hold']),
      sb.from('project_milestones')
        .select('id, project_id, track, key, label, sort_order, round, status, owner, target_date, completed_at, updated_at'),
      sb.from('clients').select('id, name, company, email'),
      sb.from('deals')
        .select('id, name, co, client_name, client_id, email, stage, stage_entered_at, created_at, updated_at, product_type')
        .neq('stage', 'Closed Lost'),
      sb.from('quotes').select('id, deal_id, client_id, status, sent_at'),
      sb.from('product_intake').select('deal_id, client_id, submitted_at'),
      sb.from('onboarding').select('client_id, deal_id, status, submitted_at, created_at')
    ]);
    var names = ['projects','milestones','clients','deals','quotes','product intake','onboarding'];
    for(var i = 0; i < results.length; i++){
      if(results[i].error) throw new Error('Could not load ' + names[i] + ': ' + (results[i].error.message || 'unknown'));
    }
    return {
      projects:   results[0].data || [],
      milestones: results[1].data || [],
      clients:    results[2].data || [],
      deals:      results[3].data || [],
      quotes:     results[4].data || [],
      intake:     results[5].data || [],
      onboarding: results[6].data || []
    };
  }

  // ── Build rows ────────────────────────────────────────────────────────────
  function build(d){
    var clientsById = {}; d.clients.forEach(function(c){ clientsById[c.id] = c; });
    // Converting a lead creates a client but does not set deals.client_id
    // (CRM_FEATURE_MAP, formulation section), so deals are also matched to
    // clients by email and by company name.
    var clientByEmail = {}, clientByName = {};
    d.clients.forEach(function(c){
      if(c.email) clientByEmail[norm(c.email)] = c;
      if(c.company) clientByName[norm(c.company)] = c;
      if(c.name) clientByName[norm(c.name)] = clientByName[norm(c.name)] || c;
    });
    function clientForDeal(deal){
      if(deal.client_id && clientsById[deal.client_id]) return clientsById[deal.client_id];
      return (deal.email && clientByEmail[norm(deal.email)]) ||
             clientByName[norm(deal.co)] || clientByName[norm(deal.client_name)] || null;
    }

    var msByProject = {};
    d.milestones.forEach(function(m){ (msByProject[m.project_id] = msByProject[m.project_id] || []).push(m); });
    var projectsByClient = {};
    d.projects.forEach(function(p){ (projectsByClient[p.client_id] = projectsByClient[p.client_id] || []).push(p); });

    var quotesByDeal = {}, quotesByClient = {};
    d.quotes.forEach(function(q){
      if(q.deal_id) (quotesByDeal[q.deal_id] = quotesByDeal[q.deal_id] || []).push(q);
      if(q.client_id) (quotesByClient[q.client_id] = quotesByClient[q.client_id] || []).push(q);
    });
    var intakeByDeal = {};
    d.intake.forEach(function(x){ if(x.deal_id && x.submitted_at) intakeByDeal[x.deal_id] = x; });
    var onbByClient = {}, onbByDeal = {};
    d.onboarding.forEach(function(o){
      if(o.client_id) onbByClient[o.client_id] = o;
      if(o.deal_id) onbByDeal[o.deal_id] = o;
    });

    var rows = [];
    state.msById = {};

    // Project rows: the sale is won by definition, so the four sales steps are done.
    d.projects.forEach(function(p){
      var ms = (msByProject[p.id] || []).slice();
      ms.forEach(function(m){ state.msById[m.id] = m; });
      var latest = latestByKey(ms);
      var art = ms.filter(function(m){ return m.track === 'artwork'; })[0] || null;
      var client = clientsById[p.client_id] || {};
      var steps = STEPS.map(function(s){
        if(s.kind === 'sales') return { def:s, v:'done', title: s.label + ': done' };
        if(s.kind === 'loop'){
          var L = loopState(latest);
          return { def:s, v:L.v, loop:L, since:L.since,
                   title: '1 L batch' + (L.round > 1 ? ', round ' + L.round : '') + (L.sub ? ': ' + L.sub : '') };
        }
        var m = latest[s.key];
        if(!m) return { def:s, v:'todo', missing:true, title: s.label + ': not on this project' };
        return { def:s, v:visual(m.status), ms:m, since:m.updated_at,
                 title: s.label + ': ' + MS_LABEL[m.status] + (m.completed_at ? ' ' + fmtDate(m.completed_at) : '') };
      });
      rows.push(finishRow({
        id: 'p:' + p.id, type: 'project', projectId: p.id, clientId: p.client_id,
        name: client.company || client.name || 'Unknown client',
        sub: p.product_name || p.name || '',
        projectStatus: p.status, targetDate: p.target_date,
        steps: steps, artwork: art
      }));
    });

    // Lead rows: open deals that have not become a project yet.
    d.deals.forEach(function(deal){
      var client = clientForDeal(deal);
      var won = deal.stage === 'Closed Won';
      // A WON deal whose client already has a project is that project's row.
      // An OPEN deal always shows, even for an existing client: it is a new
      // inquiry (a second product), and hiding it would lose a live lead.
      if(won && client && projectsByClient[client.id] && projectsByClient[client.id].length) return;
      var lastTouch = deal.updated_at || deal.stage_entered_at || deal.created_at;
      var old = deal.stage === 'Prospecting' && days(lastTouch) > LEAD_WINDOW_DAYS;

      var quotes = (quotesByDeal[deal.id] || []).concat(client ? (quotesByClient[client.id] || []) : []);
      var quoteSent = quotes.some(function(q){ return q.sent_at || q.status === 'sent' || q.status === 'accepted'; });
      var qualified = !!intakeByDeal[deal.id] || quoteSent || quotes.length > 0 ||
                      ['Proposal','Negotiation','Closed Won'].indexOf(deal.stage) > -1;
      if(['Negotiation','Closed Won'].indexOf(deal.stage) > -1) quoteSent = true;
      var done = { lead:true, qualified:qualified, quoted:quoteSent, won:won };
      var curSet = false;
      var onb = (client && onbByClient[client.id]) || onbByDeal[deal.id] || null;

      var steps = STEPS.map(function(s){
        if(s.kind === 'sales'){
          if(done[s.key]) return { def:s, v:'done', title: s.label + ': done' };
          if(!curSet){ curSet = true; return { def:s, v:'cur', since: deal.stage_entered_at || deal.created_at, title: s.label + ': current (from the pipeline)' }; }
          return { def:s, v:'todo', title: s.label };
        }
        if(s.key === 'intake' && won){
          var submitted = onb && (onb.status === 'submitted' || onb.submitted_at);
          var v = submitted ? 'done' : (onb ? 'wait' : 'cur');
          return { def:s, v:v, since: onb ? onb.created_at : deal.stage_entered_at,
                   title: 'Onboarding: ' + (submitted ? 'submitted' : onb ? 'form ' + onb.status : 'not sent yet') };
        }
        return { def:s, v:'todo', title: s.label };
      });
      rows.push(finishRow({
        id: 'd:' + deal.id, type: 'lead', dealId: deal.id, clientId: client ? client.id : null,
        name: deal.co || deal.client_name || deal.name || 'Unnamed lead',
        sub: won ? 'Won · no project yet' : ('Lead · ' + (deal.stage || 'Prospecting')),
        productName: deal.product_type || '',
        won: won, oldLead: old,
        steps: steps
      }));
    });

    // Furthest along first, then longest waiting.
    rows.sort(function(a, b){
      if(b.progress !== a.progress) return b.progress - a.progress;
      return (b.daysOnStep || 0) - (a.daysOnStep || 0);
    });
    return rows;
  }

  function finishRow(r){
    var cur = null, done = 0;
    r.steps.forEach(function(s, i){
      if(s.v === 'done' || s.v === 'skip') done = i + 1;
    });
    // Current = first live step; otherwise the first step that is not done.
    r.steps.forEach(function(s){ if(!cur && (s.v === 'cur' || s.v === 'wait' || s.v === 'block')) cur = s; });
    if(!cur) r.steps.forEach(function(s){ if(!cur && s.v === 'todo' && !s.missing) cur = s; });
    r.current = cur;
    r.progress = done;
    r.phase = cur ? cur.def.phase : 'production';
    r.daysOnStep = cur && cur.since ? days(cur.since) : null;
    r.waiting = !!(cur && cur.v === 'wait');
    r.stalled = r.daysOnStep != null && r.daysOnStep > STALL_DAYS && r.projectStatus !== 'on_hold';
    var next = null, seen = false;
    r.steps.forEach(function(s){ if(seen && !next && s.v === 'todo' && !s.missing) next = s; if(s === cur) seen = true; });
    r.next = next;
    return r;
  }

  // ── Render ────────────────────────────────────────────────────────────────
  function visibleRows(){
    var q = norm(state.search);
    return state.rows.filter(function(r){
      if(r.oldLead && !state.showOldLeads) return false;
      if(q && norm(r.name + ' ' + r.sub + ' ' + (r.productName||'')).indexOf(q) === -1) return false;
      switch(state.filter){
        case 'all':     return true;
        case 'waiting': return r.waiting;
        case 'stalled': return r.stalled;
        default:        return r.phase === state.filter;
      }
    });
  }

  function pill(key, label, n, active, tone){
    var bg = active ? 'rgba(0,229,192,.15)' : 'transparent';
    var fg = active ? 'var(--teal)' : (tone || '#8fa4c4');
    var bd = active ? 'rgba(0,229,192,.45)' : 'rgba(255,255,255,.12)';
    return '<button type="button" class="gl-trk-filter" data-filter="' + key + '" style="cursor:pointer;font:inherit;font-size:12px;padding:4px 10px;border-radius:999px;background:' + bg + ';color:' + fg + ';border:1px solid ' + bd + '">' +
      esc(label) + ' <span style="opacity:.75">' + n + '</span></button>';
  }

  function dot(rowId, s){
    var c = COLOR[s.v] || COLOR.todo;
    var filled = s.v !== 'todo';
    var ring = (s.v === 'cur' || s.v === 'wait' || s.v === 'block') ? 'box-shadow:0 0 0 3px ' + c + '33;' : '';
    var style = 'width:15px;height:15px;border-radius:50%;flex:none;padding:0;cursor:pointer;' +
      'border:2px solid ' + (s.missing ? '#2a3448' : c) + ';' +
      'background:' + (filled ? c : 'transparent') + ';' + ring +
      (s.missing ? 'border-style:dotted;' : '');
    return '<button type="button" class="gl-trk-dot" data-row="' + esc(rowId) + '" data-step="' + esc(s.def.key) + '" ' +
      'title="' + esc(s.title) + '" aria-label="' + esc(s.title) + '" style="' + style + '"></button>';
  }

  function lineHtml(r){
    return '<div style="display:flex;align-items:center;flex-wrap:nowrap;overflow-x:auto;padding:2px 0">' +
      PHASES.map(function(ph, pi){
        var dots = r.steps.filter(function(s){ return s.def.phase === ph.key; }).map(function(s){ return dot(r.id, s); }).join('');
        return '<div style="display:flex;align-items:center;gap:4px;padding:0 8px;' +
          (pi ? 'border-left:1px dashed rgba(255,255,255,.14);' : 'padding-left:0;') + '">' + dots + '</div>';
      }).join('') +
    '</div>';
  }

  function currentText(r){
    if(!r.current) return '<span style="color:' + COLOR.done + '">All steps done</span>';
    var s = r.current, c = COLOR[s.v] || '#8fa4c4';
    var label = (s.def.kind === 'sales' && s.def.doing) ? s.def.doing : s.def.label;
    if(s.loop) label = '1 L batch' + (s.loop.round > 1 ? ', round ' + s.loop.round : '') + (s.loop.sub && s.loop.sub !== 'approved' ? ' · ' + s.loop.sub : '');
    var extra = s.v === 'wait' ? ' · waiting on client' : s.v === 'block' ? ' · blocked' : '';
    var out = '<span style="color:' + c + '">' + esc(label) + extra + '</span>';
    if(r.next) out += ' <span style="color:#6b87ad">· next: ' + esc(r.next.def.label) + '</span>';
    return out;
  }

  function daysBadge(r){
    if(r.daysOnStep == null) return '<span style="color:#6b87ad">—</span>';
    var txt = r.daysOnStep + (r.daysOnStep === 1 ? ' day' : ' days');
    if(r.stalled) return '<span title="On this step for more than ' + STALL_DAYS + ' days" style="display:inline-block;padding:2px 8px;border-radius:999px;background:rgba(255,133,121,.15);color:#ff8579;font-size:12px">' + txt + '</span>';
    return '<span style="font-size:12px;color:#c8d4e8">' + txt + '</span>';
  }

  function rowHtml(r){
    var tag = r.type === 'lead'
      ? '<span style="font-size:10px;letter-spacing:.06em;color:#6b87ad;border:1px solid rgba(255,255,255,.14);border-radius:4px;padding:1px 5px;margin-left:6px">' + (r.won ? 'WON' : 'LEAD') + '</span>'
      : (r.projectStatus === 'on_hold' ? '<span style="font-size:10px;color:#f5c842;border:1px solid rgba(245,200,66,.4);border-radius:4px;padding:1px 5px;margin-left:6px">ON HOLD</span>' : '');
    var art = r.artwork ? '<div style="font-size:11px;color:#6b87ad;margin-top:3px">Packaging and artwork: ' + esc(MS_LABEL[r.artwork.status] || r.artwork.status) + '</div>' : '';
    var action = '';
    if(r.type === 'lead' && r.won && r.clientId){
      action = '<button type="button" class="gl-trk-create cbtn" data-row="' + esc(r.id) + '" style="margin-top:6px;font-size:11px;padding:3px 8px">+ Create project</button>';
    } else if(r.type === 'lead' && r.won){
      action = '<div style="font-size:11px;color:#f5c842;margin-top:4px">Convert this deal to a client first, then create the project.</div>';
    }
    var open = r.type === 'project'
      ? '<button type="button" class="gl-trk-open" data-kind="client" data-id="' + esc(r.clientId) + '" style="all:unset;cursor:pointer;font-size:14px;font-weight:600;color:#e6eefb">' + esc(r.name) + '</button>'
      : '<button type="button" class="gl-trk-open" data-kind="deal" data-id="' + esc(r.dealId) + '" style="all:unset;cursor:pointer;font-size:14px;font-weight:600;color:#e6eefb">' + esc(r.name) + '</button>';

    var editor = (state.openEditor && state.openEditor.rowId === r.id) ? editorHtml(r, state.openEditor.stepKey) : '';

    return '<div class="gl-trk-row" style="border-top:1px solid rgba(255,255,255,.07);padding:12px 0">' +
      '<div style="display:grid;grid-template-columns:minmax(150px,220px) minmax(0,1fr) 90px;gap:14px;align-items:center">' +
        '<div style="min-width:0">' + open + tag +
          '<div style="font-size:12px;color:#8fa4c4;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(r.sub) + '</div>' + art + action +
        '</div>' +
        '<div style="min-width:0">' + lineHtml(r) +
          '<div style="font-size:12px;margin-top:6px">' + currentText(r) + '</div></div>' +
        '<div style="text-align:right">' + daysBadge(r) + '</div>' +
      '</div>' + editor +
    '</div>';
  }

  function legendHtml(){
    function sw(c, filled, label){
      return '<span style="display:inline-flex;align-items:center;gap:6px"><span style="width:10px;height:10px;border-radius:50%;border:2px solid ' + c + ';background:' + (filled ? c : 'transparent') + '"></span>' + label + '</span>';
    }
    return '<div style="display:flex;flex-wrap:wrap;gap:16px;font-size:12px;color:#8fa4c4;margin-top:14px;padding-top:10px;border-top:1px solid rgba(255,255,255,.07)">' +
      sw(COLOR.done, true, 'Done') + sw(COLOR.cur, true, 'Current') + sw(COLOR.wait, true, 'Waiting on client') +
      sw(COLOR.block, true, 'Blocked') + sw(COLOR.todo, false, 'Upcoming') +
      '<span>Hover a dot for the step and date. Click it to change it.</span></div>';
  }

  function render(){
    var body = document.getElementById('trk-body');
    if(!body) return;
    var all = state.rows.filter(function(r){ return !r.oldLead || state.showOldLeads; });
    function count(fn){ return all.filter(fn).length; }
    var vis = visibleRows();
    var sub = document.getElementById('trk-sub');
    if(sub) sub.textContent = count(function(r){ return r.type === 'project'; }) + ' projects · ' +
      count(function(r){ return r.type === 'lead'; }) + ' open leads';

    var hiddenOld = state.rows.filter(function(r){ return r.oldLead; }).length;

    body.innerHTML =
      '<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between;margin-bottom:12px">' +
        '<div style="display:flex;flex-wrap:wrap;gap:6px">' +
          pill('all', 'All', all.length, state.filter === 'all') +
          PHASES.map(function(ph){ return pill(ph.key, ph.label, count(function(r){ return r.phase === ph.key; }), state.filter === ph.key); }).join('') +
          pill('waiting', 'Waiting on client', count(function(r){ return r.waiting; }), state.filter === 'waiting', '#f5c842') +
          pill('stalled', 'Stalled', count(function(r){ return r.stalled; }), state.filter === 'stalled', '#ff8579') +
        '</div>' +
        '<div style="display:flex;gap:10px;align-items:center">' +
          (hiddenOld ? '<label style="font-size:12px;color:#8fa4c4;display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" id="trk-old"' + (state.showOldLeads ? ' checked' : '') + '> Show ' + hiddenOld + ' older leads</label>' : '') +
          '<input id="trk-search" type="search" placeholder="Search brand or product" value="' + esc(state.search) + '" style="font:inherit;font-size:13px;padding:6px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.04);color:#e6eefb;width:200px">' +
        '</div>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:minmax(150px,220px) minmax(0,1fr) 90px;gap:14px;font-size:11px;color:#6b87ad;padding-bottom:6px">' +
        '<div>Client</div><div>Sales · Onboarding · Formulation · Production</div><div style="text-align:right">On step</div>' +
      '</div>' +
      (vis.length ? vis.map(rowHtml).join('') :
        '<div style="padding:28px 0;text-align:center;color:#8fa4c4;font-size:13px;border-top:1px solid rgba(255,255,255,.07)">Nothing matches this filter.</div>') +
      legendHtml();

    var search = document.getElementById('trk-search');
    if(search && state._refocus){
      search.focus();
      try { search.setSelectionRange(search.value.length, search.value.length); } catch(e){}
      state._refocus = false;
    }
  }

  // ── Step editor ───────────────────────────────────────────────────────────
  function findRow(id){ return state.rows.filter(function(r){ return r.id === id; })[0] || null; }

  function msEditorRow(m){
    var opts = MS_STATUS.map(function(s){
      return '<option value="' + s + '"' + (s === m.status ? ' selected' : '') + '>' + MS_LABEL[s] + '</option>';
    }).join('');
    var hist = state.history[m.id];
    var histHtml = '';
    if(hist && hist.length){
      histHtml = '<div style="margin-top:6px;font-size:11px;color:#8fa4c4;line-height:1.6">' +
        hist.slice(0, 6).map(function(h){
          var dd = h.details || {};
          var who = dd.auto_source ? esc(String(dd.auto_source).replace(/^auto:\s*/, 'auto: ')) : esc(h.actor_email || 'staff');
          return fmtDate(h.created_at) + ' · ' + esc(MS_LABEL[dd.from] || dd.from || '') + ' → ' +
                 esc(MS_LABEL[dd.to] || dd.to || '') + ' · <span style="color:#6b87ad">' + who + '</span>';
        }).join('<br>') + '</div>';
    } else if(hist){
      histHtml = '<div style="margin-top:6px;font-size:11px;color:#6b87ad">No changes recorded yet.</div>';
    }
    return '<div style="padding:8px 0;border-top:1px solid rgba(255,255,255,.06)">' +
      '<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">' +
        '<span style="min-width:170px;font-size:13px;color:#e6eefb">' + esc(m.label) + (m.round > 1 ? ' <span style="color:#6b87ad">· round ' + m.round + '</span>' : '') + '</span>' +
        '<select class="gl-trk-status" data-ms="' + esc(m.id) + '" style="font:inherit;font-size:12px;padding:4px 6px;border-radius:6px;background:#0f1a2e;color:#e6eefb;border:1px solid rgba(255,255,255,.16)">' + opts + '</select>' +
        '<button type="button" class="gl-trk-save cbtn pri" data-ms="' + esc(m.id) + '" style="font-size:12px;padding:4px 10px">Save</button>' +
        (m.completed_at ? '<span style="font-size:11px;color:#6b87ad">done ' + fmtDate(m.completed_at) + '</span>' : '') +
        '<span class="gl-trk-msg" data-ms="' + esc(m.id) + '" style="font-size:12px"></span>' +
      '</div>' + histHtml +
    '</div>';
  }

  function editorHtml(r, stepKey){
    var step = r.steps.filter(function(s){ return s.def.key === stepKey; })[0];
    if(!step) return '';
    var inner = '';
    var help = '';
    if(step.def.kind === 'sales'){
      inner = '<div style="font-size:13px;color:#c8d4e8">Sales steps follow the pipeline: <b>Qualified</b> when the questionnaire comes back, a quote exists or the deal reaches Proposal; <b>Quote sent</b> when a quote is emailed; <b>Won</b> when the deal is Closed Won. Change them by moving the deal in the pipeline.</div>';
    } else if(r.type === 'lead'){
      inner = '<div style="font-size:13px;color:#c8d4e8">This lead has no project yet, so there is nothing to change here. ' +
        (r.won && r.clientId ? 'Use <b>+ Create project</b> to start tracking onboarding, formulation and production.' : 'Steps after the sale start once the deal is won and a project is created.') + '</div>';
    } else if(step.def.kind === 'loop'){
      var ms = (step.loop && step.loop.ms) || [];
      help = 'Finishing <b>Formula revisions</b> starts the next round. Marking <b>1 L batch approved</b> closes the loop and starts the 50 L batch.';
      inner = ms.length ? ms.sort(function(a, b){ return a.sort_order - b.sort_order; }).map(msEditorRow).join('')
                        : '<div style="font-size:13px;color:#8fa4c4">This project has no 1 L batch steps.</div>';
    } else if(step.ms){
      help = autoHelp(step.def.key);
      inner = msEditorRow(step.ms);
    } else {
      inner = '<div style="font-size:13px;color:#8fa4c4">This step is not on this project. It was created before the step existed. Open the client to add it.</div>';
    }
    return '<div style="margin:10px 0 0;padding:10px 14px;border-radius:10px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08)">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px">' +
        '<div style="font-size:13px;font-weight:600;color:#e6eefb">' + esc(step.def.label) + '</div>' +
        '<button type="button" class="gl-trk-close" style="all:unset;cursor:pointer;color:#8fa4c4;font-size:12px">Close</button>' +
      '</div>' +
      (help ? '<div style="font-size:11px;color:#6b87ad;margin:4px 0 2px">' + help + '</div>' : '') +
      inner +
    '</div>';
  }

  function autoHelp(key){
    return {
      intake: 'Moves by itself when the client submits the onboarding form.',
      pa_letter: 'Moves by itself when a Process Authority letter is uploaded to the client’s documents.',
      production_scheduled: 'Moves by itself when a production run for this client reaches the Production stage.',
      production_run: 'Moves by itself when the production run moves to Ship.',
      invoiced_paid: 'Moves by itself when an invoice is paid after the order has shipped.',
      batch_50l: 'Set to “Waiting on client” when the 50 L batch goes to the client for sign-off. That emails them.'
    }[key] || '';
  }

  async function loadHistory(ids){
    var sb = getSB(); if(!sb || !ids.length) return;
    var r = await sb.from('audit_log')
      .select('target, details, actor_email, created_at')
      .eq('action', 'milestone_status_changed')
      .in('target', ids)
      .order('created_at', { ascending: false })
      .limit(60);
    if(r.error){ ids.forEach(function(id){ state.history[id] = []; }); return; }
    ids.forEach(function(id){ state.history[id] = []; });
    (r.data || []).forEach(function(h){ (state.history[h.target] = state.history[h.target] || []).push(h); });
  }

  async function openEditor(rowId, stepKey){
    if(state.openEditor && state.openEditor.rowId === rowId && state.openEditor.stepKey === stepKey){
      state.openEditor = null; render(); return;
    }
    state.openEditor = { rowId: rowId, stepKey: stepKey };
    render();
    var r = findRow(rowId); if(!r) return;
    var step = r.steps.filter(function(s){ return s.def.key === stepKey; })[0];
    var ids = [];
    if(step && step.ms) ids.push(step.ms.id);
    if(step && step.loop) step.loop.ms.forEach(function(m){ ids.push(m.id); });
    if(ids.length){ await loadHistory(ids); if(state.openEditor && state.openEditor.rowId === rowId) render(); }
  }

  function msg(msId, text, ok){
    var el = document.querySelector('.gl-trk-msg[data-ms="' + (window.CSS && CSS.escape ? CSS.escape(msId) : msId) + '"]');
    if(el){ el.textContent = text; el.style.color = ok ? COLOR.done : COLOR.block; }
  }

  async function saveStatus(msId){
    var sb = getSB(); if(!sb) return;
    var sel = document.querySelector('.gl-trk-status[data-ms="' + (window.CSS && CSS.escape ? CSS.escape(msId) : msId) + '"]');
    if(!sel) return;
    var status = sel.value;
    if(MS_STATUS.indexOf(status) === -1){ msg(msId, 'Unknown status.', false); return; }
    var m = state.msById[msId];
    var patch = { status: status };
    if(status === 'completed') patch.completed_at = (m && m.completed_at) || new Date().toISOString();
    else patch.completed_at = null;
    msg(msId, 'Saving…', true);
    var r;
    try { r = await sb.from('project_milestones').update(patch).eq('id', msId).select('id, status'); }
    catch(e){ msg(msId, 'Could not save: ' + (e.message || e), false); return; }
    if(r.error){ msg(msId, 'Could not save: ' + (r.error.message || 'unknown'), false); return; }
    if(!r.data || !r.data.length){ msg(msId, 'Change was rejected. Nothing saved.', false); return; }
    if(typeof window.glAudit === 'function') window.glAudit('tracker_step_changed', msId, { status: status });
    // Auto-advance may have moved the next step too, so reload everything.
    var keep = state.openEditor;
    state.history = {};
    await refresh();
    state.openEditor = null;               // openEditor() toggles, so clear first
    if(keep) await openEditor(keep.rowId, keep.stepKey);
    msg(msId, 'Saved', true);
  }

  async function createProject(rowId){
    var r = findRow(rowId); if(!r || !r.clientId) return;
    var sb = getSB(); if(!sb) return;
    var name = (r.productName || r.name || 'New project').slice(0, 120);
    var btn = document.querySelector('.gl-trk-create[data-row="' + (window.CSS && CSS.escape ? CSS.escape(rowId) : rowId) + '"]');
    if(btn){ btn.disabled = true; btn.textContent = 'Creating…'; }
    var res;
    try {
      res = await sb.from('projects').insert({
        client_id: r.clientId, name: name, product_name: r.productName || null,
        started_on: new Date().toISOString().slice(0, 10)
      }).select('id');
    } catch(e){ res = { error: e }; }
    if(res.error || !res.data || !res.data.length){
      if(btn){ btn.disabled = false; btn.textContent = '+ Create project'; }
      alert('Could not create the project: ' + ((res.error && res.error.message) || 'it was rejected, nothing saved.'));
      return;
    }
    if(typeof window.glAudit === 'function') window.glAudit('project_created_from_tracker', res.data[0].id, { client_id: r.clientId });
    await refresh();
  }

  function openRecord(kind, id){
    if(kind === 'client' && typeof window.glOpenEditClient === 'function'){ window.glOpenEditClient(id); return; }
    if(kind === 'deal' && typeof window.openDealDetail === 'function'){
      var all = window.deals || {}, hit = null;
      Object.keys(all).forEach(function(stage){
        (all[stage] || []).forEach(function(d, idx){ if(d && d.id === id) hit = { stage: stage, idx: idx }; });
      });
      if(hit){ window.openDealDetail(hit.stage, hit.idx); return; }
    }
    if(typeof window.cNav === 'function') window.cNav(kind === 'client' ? 'clients' : 'pipeline', null);
  }

  // ── Wiring ────────────────────────────────────────────────────────────────
  function wire(){
    var body = document.getElementById('trk-body');
    if(!body || body._glTrkWired) return;
    body._glTrkWired = true;

    body.addEventListener('click', function(e){
      var t = e.target.closest && e.target.closest('button');
      if(!t || !body.contains(t)) return;
      if(t.classList.contains('gl-trk-filter')){ state.filter = t.getAttribute('data-filter'); state.openEditor = null; render(); return; }
      if(t.classList.contains('gl-trk-dot')){ openEditor(t.getAttribute('data-row'), t.getAttribute('data-step')); return; }
      if(t.classList.contains('gl-trk-close')){ state.openEditor = null; render(); return; }
      if(t.classList.contains('gl-trk-save')){ saveStatus(t.getAttribute('data-ms')); return; }
      if(t.classList.contains('gl-trk-create')){ createProject(t.getAttribute('data-row')); return; }
      if(t.classList.contains('gl-trk-open')){ openRecord(t.getAttribute('data-kind'), t.getAttribute('data-id')); return; }
    });
    body.addEventListener('input', function(e){
      if(e.target && e.target.id === 'trk-search'){ state.search = e.target.value; state._refocus = true; render(); }
    });
    body.addEventListener('change', function(e){
      if(e.target && e.target.id === 'trk-old'){ state.showOldLeads = !!e.target.checked; render(); }
    });
  }

  var _loading = false;
  async function refresh(){
    var body = document.getElementById('trk-body');
    if(!body || _loading) return;
    _loading = true;
    wire();
    // Plain text, so textContent rather than another raw-HTML sink.
    if(!state.rows.length){ body.style.color = '#8fa4c4'; body.textContent = 'Loading the tracker…'; }
    try {
      var d = await load();
      state.rows = build(d);
      body.style.color = '';
      render();
    } catch(e){
      body.style.color = '#ff8579';
      body.textContent = e.message || String(e);
    } finally {
      _loading = false;
    }
  }
  window.glRefreshProjectTracker = refresh;

  // Exposed for tests only: pure functions, no DOM, no network.
  window.__glTrackerInternals = { build: build, loopState: loopState, latestByKey: latestByKey, STEPS: STEPS };

  function watch(){
    var pg = document.getElementById('cpg-tracker');
    if(!pg){ setTimeout(watch, 600); return; }
    new MutationObserver(function(){
      if(pg.classList.contains('act')){ state.openEditor = null; refresh(); }
    }).observe(pg, { attributes:true, attributeFilter:['class'] });
    if(pg.classList.contains('act')) refresh();
  }
  if(document.readyState !== 'loading') watch();
  else document.addEventListener('DOMContentLoaded', watch);
}());
