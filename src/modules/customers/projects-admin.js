/* ============================================================================
   STAFF — PROJECTS, MILESTONES, ENTITLEMENTS
   ----------------------------------------------------------------------------
   Mounted into the client edit form (idiom B: an empty div in the template,
   filled after append). Self-contained read/write, so glUpdateClient's
   camelCase -> snake_case patch map is untouched.

   Entitlements are written as LEDGER EVENTS, never as a mutable row: grant ->
   revoke -> re-grant is three preserved events, because for a billing-adjacent
   record the history of who granted what, when, is the point.

   Every write appends .select() and treats an empty array as failure. RLS
   rejects silently — 0 rows, no error — so an unchecked write reports success
   while nothing saved. That pattern produced ~40 bugs in this codebase.
   ========================================================================== */
(function(){
  'use strict';

  function getSB(){ return window.supa || null; }
  var esc = window.glEsc || function(s){ return String(s==null?'':s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); };
  function elOf(m){ return typeof m === 'string' ? document.querySelector(m) : m; }

  var MS_STATUS = ['not_started','in_progress','awaiting_client','completed','skipped','blocked'];
  var MS_LABEL = {
    not_started:'Not started', in_progress:'In progress', awaiting_client:'Waiting on client',
    completed:'Done', skipped:'Skipped', blocked:'Blocked'
  };
  var SERVICES = [
    { key:'renders',           label:'Product renders' },
    { key:'packaging_artwork', label:'Packaging & artwork' },
    { key:'market_analytics',  label:'Market analytics' }
  ];
  var PROJ_STATUS = ['active','on_hold','completed','cancelled'];
  // The revision loop (prompts/client-portal-v2.md): sample sent -> client
  // feedback -> formula revisions is a cycle. Another round adds all three
  // again with round + 1; earlier rounds and their history are untouched.
  var ROUND_KEYS = ['sample_sent', 'client_feedback', 'formula_revisions'];
  var OWNER_LABEL = { gl: 'Good Liquid', client: 'Client' };

  var _cache = {};   // clientId -> { projects, milestones, ents }

  // ── Render ────────────────────────────────────────────────────────────────
  window.glRenderProjects = async function(mount, opts){
    var host = elOf(mount);
    if(!host) return;
    var sb = getSB();
    var clientId = opts && opts.clientId;
    if(!sb || !clientId){ host.innerHTML = ''; return; }

    host.innerHTML = '<div style="font-size:11px;color:#6b87ad">Loading projects…</div>';

    var pr = await sb.from('projects')
      .select('id, name, product_name, status, started_on, target_date, archived_at')
      .eq('client_id', clientId)
      .order('created_at', { ascending: true });
    if(pr.error){
      host.innerHTML = '<div style="font-size:11px;color:#ff8579">Could not load projects: ' + esc(pr.error.message || 'unknown') + '</div>';
      return;
    }
    var projects = pr.data || [];
    var ids = projects.map(function(p){ return p.id; });

    var milestones = {}, ents = {};
    if(ids.length){
      var ms = await sb.from('project_milestones')
        .select('id, project_id, track, key, label, sort_order, round, status, owner, target_date, completed_at, client_note')
        .in('project_id', ids).order('sort_order', { ascending: true });
      ((ms && ms.data) || []).forEach(function(m){
        (milestones[m.project_id] = milestones[m.project_id] || []).push(m);
      });
      Object.keys(milestones).forEach(function(pid){
        milestones[pid].sort(function(a, b){ return (a.sort_order - b.sort_order) || (a.round - b.round); });
      });
      // Staff read the ledger directly; only the portal goes through the RPC.
      var en = await sb.from('project_entitlement_events')
        .select('project_id, service_key, action, seq')
        .in('project_id', ids).order('seq', { ascending: true });
      ((en && en.data) || []).forEach(function(e){
        (ents[e.project_id] = ents[e.project_id] || {})[e.service_key] = (e.action === 'grant');
      });
    }

    _cache[clientId] = { projects: projects, milestones: milestones, ents: ents };

    host.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">' +
        '<div style="font-size:11px;letter-spacing:1px;color:#6b87ad;font-weight:700">PROJECTS</div>' +
        '<button class="cbtn" style="font-size:10px;padding:3px 8px" data-gl-action="glProjectCreate" data-gl-arg1="' + esc(clientId) + '">+ New project</button>' +
      '</div>' +
      (projects.length
        ? projects.map(function(p){ return projectCard(p, milestones[p.id] || [], ents[p.id] || {}, clientId); }).join('')
        : '<div style="font-size:11px;color:#6b87ad;padding:8px 0">No projects yet. Create one to give this client a milestone tracker in their portal.</div>') +
      '<div id="gl-proj-msg" style="display:none;font-size:11px;margin-top:8px"></div>';
  };

  function projectCard(p, ms, ent, clientId){
    var archived = !!p.archived_at;
    return '<div style="background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.06);border-radius:8px;padding:12px;margin-bottom:12px' + (archived ? ';opacity:.55' : '') + '">' +
      '<div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center">' +
        '<div style="font-size:13px;color:#fff;font-weight:700">' + esc(p.name) +
          (p.product_name ? ' <span style="font-size:11px;color:#6b87ad;font-weight:500">' + esc(p.product_name) + '</span>' : '') +
          (archived ? ' <span style="font-size:9px;color:#f5c842;letter-spacing:1px">ARCHIVED</span>' : '') +
          ((p.started_on || p.target_date)
            ? '<div style="font-size:10.5px;color:#6b87ad;font-weight:500;margin-top:2px">' +
                (p.started_on ? 'Started ' + esc(p.started_on) : '') +
                (p.started_on && p.target_date ? ' · ' : '') +
                (p.target_date ? 'Target ' + esc(p.target_date) : '') + '</div>'
            : '') +
        '</div>' +
        '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">' +
          '<button class="cbtn" style="font-size:10px;padding:3px 8px" data-gl-action="glProjectEditDetails" data-gl-arg1="' + esc(p.id) + '" data-gl-arg2="' + esc(clientId) + '">✎ Details</button>' +
          '<button class="cbtn" style="font-size:10px;padding:3px 8px" data-gl-action="glProjectPreviewAsClient" data-gl-arg1="' + esc(p.id) + '" data-gl-arg2="' + esc(clientId) + '">👁 Preview as client</button>' +
          statusSelect(p) +
          (archived
            ? '<button class="cbtn" style="font-size:10px;padding:3px 8px" data-gl-action="glProjectSetArchived" data-gl-arg1="' + esc(p.id) + '" data-gl-arg2="' + esc(clientId) + '" data-gl-arg3="false">Restore</button>'
            : '<button class="cbtn" style="font-size:10px;padding:3px 8px;color:#f5c842" data-gl-action="glProjectSetArchived" data-gl-arg1="' + esc(p.id) + '" data-gl-arg2="' + esc(clientId) + '" data-gl-arg3="true">Archive</button>') +
        '</div>' +
      '</div>' +

      // Entitlements — what unlocks in the portal.
      '<div style="margin-top:10px;padding-top:8px;border-top:1px solid rgba(255,255,255,.06)">' +
        '<div style="font-size:10px;letter-spacing:1px;color:#6b87ad;font-weight:700;margin-bottom:6px">PORTAL SERVICES</div>' +
        '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
          SERVICES.map(function(s){
            var on = !!ent[s.key];
            return '<button class="cbtn" style="font-size:10px;padding:3px 8px;' +
              (on ? 'color:#5fcf9e;border-color:rgba(95,207,158,.4)' : 'color:#6b87ad') + '" ' +
              'data-gl-action="glProjectToggleService" data-gl-arg1="' + esc(p.id) + '" ' +
              'data-gl-arg2="' + esc(clientId) + '" data-gl-arg3="' + esc(s.key) + '" ' +
              'data-gl-arg4="' + (on ? 'revoke' : 'grant') + '">' +
              (on ? '✓ ' : '') + esc(s.label) + '</button>';
          }).join('') +
        '</div>' +
      '</div>' +

      // Milestones.
      '<div style="margin-top:10px;padding-top:8px;border-top:1px solid rgba(255,255,255,.06)">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
          '<div style="font-size:10px;letter-spacing:1px;color:#6b87ad;font-weight:700">MILESTONES</div>' +
          (archived ? '' : '<button class="cbtn" style="font-size:10px;padding:3px 8px" title="Adds sample sent, client feedback and formula revisions again as the next round" data-gl-action="glMilestoneNewRound" data-gl-arg1="' + esc(p.id) + '" data-gl-arg2="' + esc(clientId) + '">+ Sampling round ' + (nextRound(ms)) + '</button>') +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 130px 120px 96px 70px;gap:8px;font-size:9px;letter-spacing:1px;color:#6b87ad;padding:2px 0">' +
          '<div>STAGE</div><div>STATUS</div><div>TARGET DATE</div><div>WHO ACTS</div><div></div></div>' +
        (ms.length ? ms.map(function(m){ return msRow(m, clientId); }).join('')
                   : '<div style="font-size:11px;color:#6b87ad">No milestones.</div>') +
      '</div>' +
    '</div>';
  }

  function statusSelect(p){
    return '<select data-gl-action="glProjectSetStatus" data-gl-on="change" ' +
      'data-gl-arg1="' + esc(p.id) + '" data-gl-el-prop="value" ' +
      'style="font-size:10px;padding:3px 6px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.12);border-radius:4px;color:#eef4ff">' +
      PROJ_STATUS.map(function(s){
        return '<option value="' + s + '"' + (p.status === s ? ' selected' : '') + '>' + s.replace('_',' ') + '</option>';
      }).join('') + '</select>';
  }

  function msRow(m, clientId){
    var round = m.round > 1 ? ' (round ' + m.round + ')' : '';
    return '<div style="display:grid;grid-template-columns:1fr 130px 120px 96px 70px;gap:8px;align-items:center;padding:4px 0">' +
      '<div style="font-size:11px;color:#c8d4e8">' + esc(m.label) + esc(round) +
        (m.track === 'artwork' ? ' <span style="font-size:9px;color:#c4b5fd">ARTWORK</span>' : '') + '</div>' +
      '<select data-gl-action="glMilestoneSetStatus" data-gl-on="change" ' +
        'data-gl-arg1="' + esc(m.id) + '" data-gl-arg2="' + esc(clientId) + '" data-gl-el-prop="value" ' +
        'style="font-size:10px;padding:3px 6px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.12);border-radius:4px;color:#eef4ff">' +
        MS_STATUS.map(function(s){
          return '<option value="' + s + '"' + (m.status === s ? ' selected' : '') + '>' + esc(MS_LABEL[s]) + '</option>';
        }).join('') + '</select>' +
      '<input type="date" value="' + esc(m.target_date || '') + '" aria-label="Target date for ' + esc(m.label) + '" ' +
        'data-gl-action="glMilestoneSetTarget" data-gl-on="change" data-gl-arg1="' + esc(m.id) + '" data-gl-arg2="' + esc(clientId) + '" data-gl-el-prop="value" ' +
        'style="font-size:10px;padding:2px 4px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.12);border-radius:4px;color:#eef4ff">' +
      '<select aria-label="Who acts on ' + esc(m.label) + '" data-gl-action="glMilestoneSetOwner" data-gl-on="change" ' +
        'data-gl-arg1="' + esc(m.id) + '" data-gl-arg2="' + esc(clientId) + '" data-gl-el-prop="value" ' +
        'style="font-size:10px;padding:3px 4px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.12);border-radius:4px;color:#eef4ff">' +
        ['gl','client'].map(function(o){ return '<option value="' + o + '"' + (m.owner === o ? ' selected' : '') + '>' + OWNER_LABEL[o] + '</option>'; }).join('') +
      '</select>' +
      '<button class="cbtn" style="font-size:10px;padding:3px 6px" ' +
        'data-gl-action="glMilestoneNote" data-gl-arg1="' + esc(m.id) + '" data-gl-arg2="' + esc(clientId) + '">' +
        (m.client_note ? '✎ Note' : '+ Note') + '</button>' +
    '</div>';
  }

  function nextRound(ms){
    var max = 1;
    (ms || []).forEach(function(m){ if(ROUND_KEYS.indexOf(m.key) > -1 && m.round > max) max = m.round; });
    return max + 1;
  }

  function say(text, ok){
    var el = document.getElementById('gl-proj-msg');
    if(!el) return;
    el.style.display = 'block';
    el.style.color = ok ? '#5fcf9e' : '#ff8579';
    el.textContent = text;
  }

  function remount(clientId){
    var host = document.getElementById('gl-ec-projects');
    if(host) window.glRenderProjects(host, { clientId: clientId });
  }

  // ── Writes ────────────────────────────────────────────────────────────────
  window.glProjectCreate = async function(clientId){
    var sb = getSB(); if(!sb) return;
    var name = prompt('Project name (e.g. "Lemon-Lime 12oz launch")');
    if(!name) return;
    var product = prompt('Product name (optional)') || null;
    var r = await sb.from('projects').insert({
      client_id: clientId, name: name, product_name: product
    }).select('id');
    if(r.error){ say('Could not create: ' + (r.error.message || 'unknown'), false); return; }
    if(!r.data || !r.data.length){ say('Create was rejected — no row was written.', false); return; }
    if(typeof window.glAudit === 'function') window.glAudit('project_created', r.data[0].id, { client_id: clientId });
    remount(clientId);
  };

  window.glProjectSetStatus = async function(projectId, value){
    var sb = getSB(); if(!sb) return;
    var r = await sb.from('projects').update({ status: value }).eq('id', projectId).select('id');
    if(r.error){ say('Could not update status: ' + (r.error.message || 'unknown'), false); return; }
    if(!r.data || !r.data.length){ say('Status change was rejected — nothing saved.', false); return; }
    say('Status saved.', true);
  };

  window.glProjectSetArchived = async function(projectId, clientId, archived){
    var sb = getSB(); if(!sb) return;
    var on = String(archived) === 'true';
    if(on && !confirm('Archive this project? It disappears from the client portal immediately, along with its milestones and any documents assigned to it. Reversible.')) return;
    var r = await sb.from('projects')
      .update({ archived_at: on ? new Date().toISOString() : null })
      .eq('id', projectId).select('id');
    if(r.error){ say('Could not archive: ' + (r.error.message || 'unknown'), false); return; }
    if(!r.data || !r.data.length){ say('Archive was rejected — nothing saved.', false); return; }
    remount(clientId);
  };

  window.glMilestoneSetStatus = async function(milestoneId, clientId, value){
    var sb = getSB(); if(!sb) return;
    // Reopening a completed stage clears its completion time, so the record
    // never says "done at 3pm" about a stage that is in progress again.
    var patch = { status: value, completed_at: value === 'completed' ? new Date().toISOString() : null };
    var r = await sb.from('project_milestones').update(patch).eq('id', milestoneId).select('id');
    if(r.error){ say('Could not update milestone: ' + (r.error.message || 'unknown'), false); return; }
    if(!r.data || !r.data.length){ say('Milestone change was rejected — nothing saved.', false); return; }
    say('Milestone saved.', true);
  };

  window.glMilestoneNote = async function(milestoneId, clientId){
    var sb = getSB(); if(!sb) return;
    var cur = '';
    var c = _cache[clientId];
    if(c){
      Object.keys(c.milestones).forEach(function(pid){
        c.milestones[pid].forEach(function(m){ if(m.id === milestoneId) cur = m.client_note || ''; });
      });
    }
    // This text is shown to the client verbatim, so the prompt says so.
    var note = prompt('Note for the CLIENT to read on this milestone:', cur);
    if(note === null) return;
    var r = await sb.from('project_milestones')
      .update({ client_note: note || null }).eq('id', milestoneId).select('id');
    if(r.error){ say('Could not save note: ' + (r.error.message || 'unknown'), false); return; }
    if(!r.data || !r.data.length){ say('Note was rejected — nothing saved.', false); return; }
    remount(clientId);
  };

  window.glProjectEditDetails = async function(projectId, clientId){
    var sb = getSB(); if(!sb) return;
    var c = _cache[clientId] || {};
    var p = (c.projects || []).filter(function(x){ return x.id === projectId; })[0];
    if(!p){ say('Project not found — refresh and try again.', false); return; }
    var name = prompt('Project name', p.name || '');
    if(name === null) return;
    name = name.trim();
    if(!name){ say('A project needs a name. Nothing saved.', false); return; }
    var product = prompt('Product name (leave empty for none)', p.product_name || '');
    if(product === null) return;
    var started = prompt('Start date (YYYY-MM-DD, empty for none)', p.started_on || '');
    if(started === null) return;
    var target = prompt('Target date (YYYY-MM-DD, empty for none)', p.target_date || '');
    if(target === null) return;
    var dateOk = function(v){ return !v || /^\d{4}-\d{2}-\d{2}$/.test(v); };
    started = started.trim(); target = target.trim();
    if(!dateOk(started) || !dateOk(target)){ say('Dates must be YYYY-MM-DD. Nothing saved.', false); return; }
    if(started && target && target < started){ say('The target date is before the start date. Nothing saved.', false); return; }
    var r = await sb.from('projects').update({
      name: name, product_name: product.trim() || null,
      started_on: started || null, target_date: target || null
    }).eq('id', projectId).select('id');
    if(r.error){ say('Could not save details: ' + (r.error.message || 'unknown'), false); return; }
    if(!r.data || !r.data.length){ say('Details were rejected — nothing saved.', false); return; }
    remount(clientId);
  };

  window.glMilestoneSetTarget = async function(milestoneId, clientId, value){
    var sb = getSB(); if(!sb) return;
    var r = await sb.from('project_milestones').update({ target_date: value || null }).eq('id', milestoneId).select('id');
    if(r.error){ say('Could not save the target date: ' + (r.error.message || 'unknown'), false); return; }
    if(!r.data || !r.data.length){ say('Target date was rejected — nothing saved.', false); return; }
    say('Target date saved.', true);
  };

  window.glMilestoneSetOwner = async function(milestoneId, clientId, value){
    var sb = getSB(); if(!sb) return;
    if(value !== 'gl' && value !== 'client'){ say('Unknown owner.', false); return; }
    var r = await sb.from('project_milestones').update({ owner: value }).eq('id', milestoneId).select('id');
    if(r.error){ say('Could not change who acts: ' + (r.error.message || 'unknown'), false); return; }
    if(!r.data || !r.data.length){ say('Change was rejected — nothing saved.', false); return; }
    say('Saved — ' + OWNER_LABEL[value] + ' acts on this stage.', true);
  };

  window.glMilestoneNewRound = async function(projectId, clientId){
    var sb = getSB(); if(!sb) return;
    var c = _cache[clientId] || {};
    var ms = (c.milestones && c.milestones[projectId]) || [];
    var round = nextRound(ms);
    var templates = ROUND_KEYS.map(function(k){
      return ms.filter(function(m){ return m.key === k; }).sort(function(a, b){ return b.round - a.round; })[0];
    });
    if(templates.some(function(t){ return !t; })){
      say('This project is missing a sampling stage, so a new round cannot be added.', false); return;
    }
    if(!confirm('Start sampling round ' + round + '?\n\nSample sent, client feedback and formula revisions are added again as round ' + round + '. Earlier rounds keep their history.')) return;
    var rows = templates.map(function(t){
      return { project_id: projectId, track: t.track, key: t.key, label: t.label,
               sort_order: t.sort_order, round: round, status: 'not_started', owner: t.owner };
    });
    var r = await sb.from('project_milestones').insert(rows).select('id');
    if(r.error){ say('Could not add round ' + round + ': ' + (r.error.message || 'unknown'), false); return; }
    if(!r.data || r.data.length !== rows.length){ say('Round ' + round + ' was not fully created — refresh and check.', false); return; }
    remount(clientId);
  };

  // "Preview as client" — the safest form of it: no impersonation, no session
  // swap. It renders this project with the SAME functions the portal uses, from
  // columns a client can read anyway (milestones and service state), inside a
  // clearly labelled read-only panel.
  window.glProjectPreviewAsClient = function(projectId, clientId){
    var c = _cache[clientId] || {};
    var p = (c.projects || []).filter(function(x){ return x.id === projectId; })[0];
    if(!p){ say('Project not found — refresh and try again.', false); return; }
    if(typeof window.glPortalMilestoneTracker !== 'function'){ say('The portal renderer is not loaded.', false); return; }
    var ms = (c.milestones && c.milestones[projectId]) || [];
    var ent = (c.ents && c.ents[projectId]) || {};
    var prior = document.getElementById('gl-proj-preview'); if(prior) prior.remove();
    var ov = document.createElement('div');
    ov.id = 'gl-proj-preview';
    ov.setAttribute('style', 'position:fixed;inset:0;z-index:950;background:rgba(6,13,26,.92);display:flex;align-items:flex-start;justify-content:center;padding:24px;overflow-y:auto');
    var services = SERVICES.map(function(s){
      return '<span style="font-size:11px;padding:3px 9px;border-radius:20px;border:1px solid rgba(255,255,255,.12);color:' + (ent[s.key] ? '#5fcf9e' : '#6b87ad') + '">' +
        (ent[s.key] ? '' : '🔒 ') + esc(s.label) + '</span>';
    }).join(' ');
    ov.innerHTML =
      '<div style="background:#0a1628;border:1px solid rgba(0,229,192,.25);border-radius:14px;width:100%;max-width:820px;padding:22px 24px;color:#eef4ff">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:14px">' +
          '<div style="font-size:10px;letter-spacing:2px;color:#f5c842;font-weight:700">PREVIEW — WHAT THE CLIENT SEES FOR THIS PROJECT</div>' +
          '<button class="cbtn" style="font-size:11px;padding:4px 10px" data-gl-close="#gl-proj-preview">Close</button>' +
        '</div>' +
        (p.archived_at ? '<div style="font-size:12px;color:#f5c842;margin-bottom:12px">This project is archived, so the client does not see it at all.</div>' : '') +
        window.glPortalProjectHeader(p) +
        window.glPortalStatusCard(ms) +
        window.glPortalMilestoneTracker(ms) +
        '<div style="margin-top:6px;font-size:10px;letter-spacing:1.5px;color:#6b87ad;font-weight:700">SERVICE TABS</div>' +
        '<div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">' + services + '</div>' +
        '<div style="margin-top:14px;font-size:11px;color:#6b87ad">Documents and artwork follow each file’s own visibility and are not shown in this preview.</div>' +
      '</div>';
    document.body.appendChild(ov);
  };

  // Grant/revoke is an INSERT, never an update: the ledger is append-only and
  // the trigger on the table will refuse anything else.
  window.glProjectToggleService = async function(projectId, clientId, serviceKey, action){
    var sb = getSB(); if(!sb) return;
    var uid = (window.currentUser && window.currentUser.id) || null;
    if(!uid){ say('Could not identify you — sign in again.', false); return; }
    // actor is stamped from the verified session by the database (CP06); it is
    // still sent because the column is NOT NULL at the API layer.
    var r = await sb.from('project_entitlement_events').insert({
      project_id: projectId, service_key: serviceKey, action: action, actor: uid
    }).select('seq');
    if(r.error){ say('Could not change service: ' + (r.error.message || 'unknown'), false); return; }
    if(!r.data || !r.data.length){ say('Service change was rejected — nothing saved.', false); return; }
    remount(clientId);
  };

})();
