/* ============================================================================
   PORTAL — PROJECTS, MILESTONES, TABS, LOCKED SERVICES
   ----------------------------------------------------------------------------
   The customer portal's project spine. A client may have several projects
   running at once; each carries its own milestone set and its own entitlements.

   Three things here are deliberate and will look wrong if you skim them:

   1. NO PERCENTAGE IS EVER RENDERED. The tracker shows discrete states. A
      percentage implies a precision this data does not have, and the spec bans
      misleading progress outright.

   2. TWO TRACKS, TWO INDICATORS. Packaging/artwork runs parallel to
      formulation, so folding both into one left-to-right bar would show a
      client at 60% while artwork had not been started. The formulation track
      gets the main stepper; artwork gets its own line.

   3. LOCKED TABS ARE NOT DISABLED. A service the client has not bought still
      renders a real panel explaining what it is and how to ask for it. That
      surface is the reason the tabs exist. A greyed-out dead click is the one
      outcome worth avoiding.

   Entitlements come from gl_portal_entitlements(), never from a column on a
   table the browser can re-query. Ledger tables are staff-only.
   ========================================================================== */
(function(){
  'use strict';

  function getSB(){ return window.supa || null; }
  function escHtml(s){ return String(s==null?'':s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }

  var TAB_KEY = 'gl-portal-tab';
  var PROJ_KEY = 'gl-portal-project';

  // ── Milestone presentation ────────────────────────────────────────────────
  var MS_COLOR = {
    not_started:     '#3d4a63',
    in_progress:     '#00e5c0',
    awaiting_client: '#f5c842',
    completed:       '#5fcf9e',
    skipped:         '#6b87ad',
    blocked:         '#ff8579'
  };
  var MS_LABEL = {
    not_started:     'Not started',
    in_progress:     'In progress',
    awaiting_client: 'Waiting on you',
    completed:       'Done',
    skipped:         'Skipped',
    blocked:         'Blocked'
  };

  var SERVICES = {
    renders: {
      title: 'Product Renders',
      blurb: 'Photoreal 3D renders of your can or bottle — the images you need for a deck, a retailer one-sheet or a pre-order page, before a single unit exists.',
      why:   'Most brands need sell sheets months before first production. Renders let you pitch buyers while the liquid is still in development.'
    },
    packaging_artwork: {
      title: 'Packaging & Artwork',
      blurb: 'Label and packaging design taken from concept to print-ready files, checked against the panel requirements for your format.',
      why:   'Artwork that fails pre-press is the most common reason a launch date slips. Getting the dielines right the first time protects your run date.'
    },
    market_analytics: {
      title: 'Market Analytics',
      blurb: 'Category and shelf analysis for your segment — who is winning, at what price, in which channel, and where the gap is for your product.',
      why:   'Pricing and positioning are much cheaper to change now than after your first production run is on a pallet.'
    }
  };

  // ── Load ──────────────────────────────────────────────────────────────────
  // Returns { projects, milestones (by project), entitlements (by project),
  //           errors } — errors are surfaced rather than swallowed, matching
  // the rest of the dashboard: a section that FAILED must not render the same
  // confident empty state as a section that is genuinely empty.
  window.glPortalLoadProjects = async function(clientId){
    var sb = getSB();
    var out = { projects: [], milestones: {}, ents: {}, errors: [] };
    if(!sb || !clientId) return out;

    try {
      var pr = await sb.from('projects')
        .select('id, name, product_name, status, image_path, started_on, target_date, project_manager')
        .eq('client_id', clientId)
        .is('archived_at', null)
        .order('created_at', { ascending: true });
      if(pr && pr.error){ out.errors.push('projects: ' + (pr.error.message || 'unknown')); }
      out.projects = (pr && pr.data) || [];
    } catch(e){ out.errors.push('projects: ' + (e && e.message || e)); }

    if(!out.projects.length) return out;

    var ids = out.projects.map(function(p){ return p.id; });

    try {
      var ms = await sb.from('project_milestones')
        .select('id, project_id, track, key, label, sort_order, round, status, owner, target_date, completed_at, client_note')
        .in('project_id', ids)
        .order('sort_order', { ascending: true });
      if(ms && ms.error){ out.errors.push('milestones: ' + (ms.error.message || 'unknown')); }
      ((ms && ms.data) || []).forEach(function(m){
        (out.milestones[m.project_id] = out.milestones[m.project_id] || []).push(m);
      });
    } catch(e){ out.errors.push('milestones: ' + (e && e.message || e)); }

    // Entitlements come from the RPC, never from the ledger table — customers
    // hold no policy on project_entitlement_events at all.
    try {
      var en = await sb.rpc('gl_portal_entitlements');
      if(en && en.error){ out.errors.push('services: ' + (en.error.message || 'unknown')); }
      ((en && en.data) || []).forEach(function(e){
        if(e.action !== 'grant') return;
        (out.ents[e.project_id] = out.ents[e.project_id] || {})[e.service_key] = true;
      });
    } catch(e){ out.errors.push('services: ' + (e && e.message || e)); }

    return out;
  };

  // ── Milestone tracker ─────────────────────────────────────────────────────
  // Only the latest round of each milestone key is shown as a step; earlier
  // rounds become the "round N" annotation. Rendering every round as its own
  // dot would make a project that revised three times look three times longer
  // than one that did not.
  function latestRounds(list){
    var byKey = {};
    list.forEach(function(m){
      var cur = byKey[m.key];
      if(!cur || m.round > cur.round) byKey[m.key] = m;
    });
    return Object.keys(byKey).map(function(k){ return byKey[k]; })
      .sort(function(a,b){ return (a.sort_order||0) - (b.sort_order||0); });
  }

  function stepHtml(m){
    var c = MS_COLOR[m.status] || '#3d4a63';
    var round = m.round > 1 ? ' — round ' + m.round : '';
    return '<div style="display:flex;align-items:flex-start;gap:8px;min-width:132px;max-width:190px">' +
        '<div style="width:9px;height:9px;border-radius:50%;background:' + c + ';margin-top:4px;flex:0 0 auto"></div>' +
        '<div style="min-width:0">' +
          '<div style="font-size:10px;letter-spacing:1px;text-transform:uppercase;font-weight:700;color:' +
            (m.status === 'not_started' ? '#3d4a63' : '#eef4ff') + '">' +
            escHtml(m.label) + escHtml(round) +
          '</div>' +
          '<div style="font-size:10px;color:' + c + ';margin-top:1px">' + escHtml(MS_LABEL[m.status] || m.status) + '</div>' +
        '</div>' +
      '</div>';
  }

  function trackHtml(title, steps, accent){
    if(!steps.length) return '';
    return '<div style="margin-bottom:16px">' +
        '<div style="font-size:10px;letter-spacing:2px;color:' + accent + ';font-weight:700;margin-bottom:8px">' + escHtml(title) + '</div>' +
        '<div style="display:flex;gap:14px;flex-wrap:wrap">' + steps.map(stepHtml).join('') + '</div>' +
      '</div>';
  }

  window.glPortalMilestoneTracker = function(milestones){
    var all = milestones || [];
    var form = latestRounds(all.filter(function(m){ return m.track === 'formulation'; }));
    var art  = latestRounds(all.filter(function(m){ return m.track === 'artwork'; }));
    if(!form.length && !art.length){
      return '<div style="font-size:12px;color:#6b87ad">Your milestone track will appear here once your project is set up.</div>';
    }
    // Two separate indicators, never one combined bar — see the header note.
    return trackHtml('DEVELOPMENT', form, '#00e5c0') +
           trackHtml('PACKAGING & ARTWORK', art, '#c4b5fd');
  };

  // ── Current status / next action ──────────────────────────────────────────
  window.glPortalStatusCard = function(milestones){
    var all = latestRounds((milestones || []));
    var active = null, waiting = null;
    all.forEach(function(m){
      if(m.status === 'awaiting_client' && !waiting) waiting = m;
      if((m.status === 'in_progress' || m.status === 'blocked') && !active) active = m;
    });
    var focus = waiting || active;
    if(!focus){
      var done = all.filter(function(m){ return m.status === 'completed'; });
      if(done.length && done.length === all.length){
        return card('#5fcf9e', 'PROJECT COMPLETE', 'Everything on this project is finished.', '');
      }
      return card('#6b87ad', 'CURRENT STATUS', 'No stage is active right now. Mike will update this as work moves.', '');
    }
    var mine = focus.owner === 'client' || focus.status === 'awaiting_client';
    var accent = mine ? '#f5c842' : '#00e5c0';
    var head = mine ? 'WE NEED SOMETHING FROM YOU' : 'WHAT WE ARE WORKING ON';
    var body = focus.label + (focus.round > 1 ? ' — round ' + focus.round : '');
    var note = focus.client_note ? focus.client_note : '';
    var when = focus.target_date ? 'Target: ' + escHtml(focus.target_date) : '';
    return card(accent, head, body, note, when);

    function card(c, h, b, n, w){
      return '<div style="background:#142238;border:1px solid ' + c + '44;border-left:3px solid ' + c + ';border-radius:12px;padding:16px 18px;margin-bottom:20px">' +
          '<div style="font-size:10px;letter-spacing:2px;color:' + c + ';font-weight:700">' + escHtml(h) + '</div>' +
          '<div style="font-size:15px;color:#fff;font-weight:700;margin-top:6px">' + escHtml(b) + '</div>' +
          (n ? '<div style="font-size:12px;color:#9aa7bd;margin-top:6px;line-height:1.5">' + escHtml(n) + '</div>' : '') +
          (w ? '<div style="font-size:11px;color:#6b87ad;margin-top:8px">' + w + '</div>' : '') +
        '</div>';
    }
  };

  // ── Project header ────────────────────────────────────────────────────────
  window.glPortalProjectHeader = function(proj){
    if(!proj) return '';
    var S = { active:'#00e5c0', on_hold:'#f5c842', completed:'#5fcf9e', cancelled:'#6b87ad' };
    var c = S[proj.status] || '#6b87ad';
    return '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;margin-bottom:16px">' +
        '<div>' +
          '<div style="font-size:20px;font-weight:900;color:#fff">' + escHtml(proj.name) + '</div>' +
          (proj.product_name ? '<div style="font-size:12px;color:#6b87ad;margin-top:2px">' + escHtml(proj.product_name) + '</div>' : '') +
        '</div>' +
        '<div style="text-align:right">' +
          '<span style="font-size:10px;letter-spacing:1.5px;padding:3px 9px;border-radius:4px;background:rgba(255,255,255,.04);border:1px solid ' + c + '55;color:' + c + ';font-weight:700;text-transform:uppercase">' +
            escHtml(String(proj.status || '').replace('_',' ')) + '</span>' +
          (proj.target_date ? '<div style="font-size:11px;color:#6b87ad;margin-top:5px">Target ' + escHtml(proj.target_date) + '</div>' : '') +
        '</div>' +
      '</div>';
  };

  // ── Project picker ────────────────────────────────────────────────────────
  window.glPortalProjectPicker = function(projects, activeId){
    if(!projects || projects.length < 2) return '';
    return '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px">' +
      projects.map(function(p){
        var on = p.id === activeId;
        return '<button class="gl-cri-pill' + (on ? ' act' : '') + '" ' +
          'data-gl-action="glPortalPickProject" data-gl-arg1="' + escHtml(p.id) + '">' +
          escHtml(p.name) + '</button>';
      }).join('') + '</div>';
  };

  window.glPortalPickProject = function(projectId){
    try { sessionStorage.setItem(PROJ_KEY, projectId); } catch(e){}
    if(typeof window.glCheckPortal === 'function') window.glCheckPortal();
  };

  // ── Tabs ──────────────────────────────────────────────────────────────────
  // Pill bar copied from the requests.js filter bar so the portal and the CRM
  // share one visual language for "pick one of these".
  window.glPortalTabBar = function(tabs, activeId){
    return '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:18px;border-bottom:1px solid rgba(255,255,255,.06);padding-bottom:14px">' +
      tabs.map(function(t){
        var on = t.id === activeId;
        var lock = t.locked ? '🔒 ' : '';
        return '<button class="gl-cri-pill' + (on ? ' act' : '') + '" ' +
          'data-gl-action="glPortalTab" data-gl-arg1="' + escHtml(t.id) + '"' +
          (t.locked ? ' style="opacity:.75"' : '') + '>' +
          lock + escHtml(t.label) + '</button>';
      }).join('') + '</div>';
  };

  window.glPortalTab = function(tabId){
    try { sessionStorage.setItem(TAB_KEY, tabId); } catch(e){}
    var panels = document.querySelectorAll('[data-gl-portal-panel]');
    for(var i = 0; i < panels.length; i++){
      panels[i].hidden = (panels[i].getAttribute('data-gl-portal-panel') !== tabId);
    }
    var pills = document.querySelectorAll('[data-gl-action="glPortalTab"]');
    for(var j = 0; j < pills.length; j++){
      var isOn = pills[j].getAttribute('data-gl-arg1') === tabId;
      if(isOn) pills[j].classList.add('act'); else pills[j].classList.remove('act');
    }
  };

  window.glPortalActiveTab = function(fallback){
    try { return sessionStorage.getItem(TAB_KEY) || fallback; } catch(e){ return fallback; }
  };
  window.glPortalActiveProject = function(projects){
    if(!projects || !projects.length) return null;
    var want = null;
    try { want = sessionStorage.getItem(PROJ_KEY); } catch(e){}
    for(var i = 0; i < projects.length; i++){ if(projects[i].id === want) return projects[i]; }
    return projects[0];
  };

  // ── Locked service panel ──────────────────────────────────────────────────
  // Explains the service and offers a way to ask. Never a dead click, never a
  // disabled-grey box: this panel is the sales surface the tabs exist for.
  window.glPortalLockedPanel = function(serviceKey){
    var s = SERVICES[serviceKey];
    if(!s) return '';
    return '<div style="background:#142238;border:1px solid rgba(255,255,255,.06);border-radius:12px;padding:22px 24px">' +
        '<div style="font-size:10px;letter-spacing:2px;color:#f5c842;font-weight:700">NOT PART OF YOUR CURRENT PACKAGE</div>' +
        '<div style="font-size:19px;font-weight:900;color:#fff;margin-top:8px">' + escHtml(s.title) + '</div>' +
        '<div style="font-size:13px;color:#c8d4e8;margin-top:10px;line-height:1.6">' + escHtml(s.blurb) + '</div>' +
        '<div style="background:rgba(0,229,192,.06);border-left:2px solid #00e5c0;padding:10px 14px;border-radius:0 8px 8px 0;margin-top:14px">' +
          '<div style="font-size:10px;letter-spacing:1.5px;color:#00e5c0;font-weight:700">WHY IT HELPS</div>' +
          '<div style="font-size:12px;color:#9aa7bd;margin-top:4px;line-height:1.55">' + escHtml(s.why) + '</div>' +
        '</div>' +
        '<div style="margin-top:18px;display:flex;gap:8px;flex-wrap:wrap">' +
          '<button class="cbtn pri" data-gl-action="glPortalRequestService" data-gl-arg1="' + escHtml(serviceKey) + '">Ask about ' + escHtml(s.title) + '</button>' +
        '</div>' +
      '</div>';
  };

  // Reuses the existing customer-request flow rather than building a second
  // path — staff already triage customer_requests in one place.
  window.glPortalRequestService = function(serviceKey){
    var s = SERVICES[serviceKey];
    if(typeof window.glOpenCustomerRequest !== 'function') return;
    window.glOpenCustomerRequest('quote');
    // Prefill after the modal has mounted.
    setTimeout(function(){
      var box = document.querySelector('#gl-cust-req textarea');
      if(box && !box.value && s){
        box.value = 'I would like to know more about ' + s.title + ' for my project.';
        box.focus();
      }
    }, 60);
  };

  // ── Empty state ───────────────────────────────────────────────────────────
  window.glPortalNoProjects = function(){
    return '<div style="background:#142238;border:1px solid rgba(255,255,255,.06);border-radius:12px;padding:22px 24px;margin-bottom:24px">' +
        '<div style="font-size:10px;letter-spacing:2px;color:#00e5c0;font-weight:700">YOUR PROJECT</div>' +
        '<div style="font-size:13px;color:#9aa7bd;margin-top:8px;line-height:1.6">' +
          'Your project tracker is being set up. Once Mike creates your project you will see every stage here — what is finished, what we are working on, and anything we need from you.' +
        '</div>' +
      '</div>';
  };

})();
