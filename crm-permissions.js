/* ============================================================
   CRM: Per-user, per-component permissions
   ============================================================
   - Loads window.glPermissions = { components: [...], userPerms: {...},
     defaults: {...}, isAdmin: bool } once the user is logged in.
   - Gates the sidebar nav items + cNav() routing based on what the
     logged-in user has permission to see.
   - Replaces the in-memory "Users & permissions" page with one
     backed by the permission_components + user_permissions tables.
   - Admins (profiles.role='admin') bypass all checks.
   ============================================================ */
(function(){
  /* ── ROLE-BASED PERMISSIONS (core table + nav guards) ── */
  var ALL=['dashboard','clients','pipeline','invoices','invoice-detail','newinv','referrals','referrers','activity','users','customers','calendar','production-cal','production-runs','samples','formulas','yield','content','compliance','holds','cip','audit','defects','vendors','tasks','documents','inventory','announcements','time-tracker','reports','ai-settings'];
  var WAREHOUSE=['dashboard','production-runs','production-cal','inventory','cip','defects','yield','samples','tasks','announcements'];
  if(window.PERMISSIONS){window.PERMISSIONS.admin=ALL;window.PERMISSIONS.sales=['dashboard','clients','pipeline','invoices','newinv','referrals','referrers','activity','calendar','production-cal','production-runs','samples','formulas','yield','content','cip','defects','vendors','tasks','announcements','reports'];window.PERMISSIONS.warehouse=WAREHOUSE;}
  else{window.PERMISSIONS={admin:ALL,sales:['dashboard','clients','pipeline','invoices','newinv','referrals','referrers','activity','calendar','production-cal','production-runs','samples','formulas','yield','content','cip','defects','vendors','tasks','announcements','reports'],warehouse:WAREHOUSE,viewer:['dashboard','clients','invoices','activity']};}
  window.can=function(page){var u=window.currentUser;if(!u)return false;if(u.role==='admin')return true;return(window.PERMISSIONS[u.role]||[]).includes(page);};
  window.GL_HOOKS.registerNavGuard(function(page){
    if(!window.can(page)){if(typeof addNotification==='function')addNotification('Access denied',page,'warning');return false;}
  });
  window.GL_HOOKS.registerNavGuard(function(page){
    if(page==='newinv'||page==='new-invoice'||page==='newInvoice'){window.openNewInvoiceBuilder();return false;}
  });

  function getSB(){ return window.supa || null; }
  var esc = window.glEsc;

  var perms = {
    loaded:    false,
    isAdmin:   false,
    userId:    null,
    components: [],            // [{id,label,category,description,default_on,sort_order}]
    byId:      {},             // id → component row
    userPerms: {}              // user_id → { component_id → granted }
  };
  window.glPermissions = perms;

  // Map sidebar nav `cni` element → page id used in cNav and permission id
  // (e.g. id="nav-clients" gates the 'page.clients' component for cNav('clients')).
  function permIdForPage(pageId){
    if(!pageId) return null;
    return 'page.' + pageId;
  }

  async function loadPermissions(){
    var sb = getSB();
    if(!sb || !sb.auth){ return; }
    var sess = await sb.auth.getSession();
    var user = sess && sess.data && sess.data.session && sess.data.session.user;
    if(!user){ return; }
    perms.userId = user.id;

    // Resolve admin flag from profiles.role
    var prof = await sb.from('profiles').select('id,role').eq('id', user.id).maybeSingle();
    perms.isAdmin = !!(prof.data && prof.data.role === 'admin');

    // Load catalog
    var cR = await sb.from('permission_components').select('*').order('sort_order', { ascending: true });
    if(cR.error){ console.warn('[GL perms] components load failed', cR.error); return; }
    perms.components = cR.data || [];
    perms.byId = {};
    perms.components.forEach(function(c){ perms.byId[c.id] = c; });

    // Load user's own permissions (RLS lets them read their own row only,
    // except admins who can read all — we'll fetch all for admin so the
    // matrix UI doesn't need a second roundtrip per user).
    var query = sb.from('user_permissions').select('user_id, component_id, granted');
    if(!perms.isAdmin) query = query.eq('user_id', user.id);
    var pR = await query;
    perms.userPerms = {};
    (pR.data || []).forEach(function(row){
      if(!perms.userPerms[row.user_id]) perms.userPerms[row.user_id] = {};
      perms.userPerms[row.user_id][row.component_id] = !!row.granted;
    });

    perms.loaded = true;
    applyGating();
    // Also explicitly run the button/visual scan now that perms are loaded.
    // Belt-and-suspenders on top of the applyGating wrapper, which we've seen
    // skip the scan in some load-order scenarios.
    try { if(typeof scanAndHide === 'function') scanAndHide(); } catch(e){}
    if(typeof window.glRescanPermissions === 'function') window.glRescanPermissions();
    console.log('[GL perms] loaded — admin=' + perms.isAdmin + ', components=' + perms.components.length);
  }

  // Synchronous permission check using already-loaded state.
  // If permissions aren't loaded yet, returns true (fail-open) so an
  // unconfigured site stays usable. Admins always true.
  window.glCan = function glCan(componentId){
    if(!perms.loaded) return true;
    if(perms.isAdmin) return true;
    var userPerms = perms.userPerms[perms.userId] || {};
    if(Object.prototype.hasOwnProperty.call(userPerms, componentId)) return userPerms[componentId];
    var comp = perms.byId[componentId];
    return comp ? !!comp.default_on : true;
  };

  // Hide sidebar nav items the user doesn't have access to + show the
  // Users & permissions nav for admins.
  function applyGating(){
    var navs = document.querySelectorAll('.cni');
    navs.forEach(function(el){
      var onclick = el.getAttribute('onclick') || '';
      var m = onclick.match(/cNav\(\s*['"]([^'"]+)['"]/);
      if(!m) return;
      var pageId = m[1];
      var permId = permIdForPage(pageId);
      var allowed = window.glCan(permId);
      el.style.display = allowed ? '' : 'none';
    });
    // Admin-only nav items: surface them when user is admin.
    if(perms.isAdmin){
      var adminOnly = ['nav-users', 'nav-customers', 'nav-audit', 'nav-ai-settings'];
      adminOnly.forEach(function(id){
        var el = document.getElementById(id);
        if(el) el.style.display = '';
      });
    }
    // If the user is currently on a page they can no longer access (e.g. dashboard
    // was the default landing page but has been removed from this user's permissions),
    // redirect them to the first page they ARE allowed to see.
    if(!perms.isAdmin){
      var activeEl = document.querySelector('.cpg.act');
      if(activeEl){
        var curPageId = activeEl.id.replace(/^cpg-/, '');
        if(!window.glCan(permIdForPage(curPageId))){
          var firstNav = null;
          navs.forEach(function(el){
            if(firstNav) return;
            var oc = el.getAttribute('onclick') || '';
            var m2 = oc.match(/cNav\(\s*['"]([^'"]+)['"]/);
            if(m2 && window.glCan(permIdForPage(m2[1]))){
              firstNav = { page: m2[1], el: el };
            }
          });
          if(firstNav && typeof window.cNav === 'function') window.cNav(firstNav.page, firstNav.el);
        }
      }
    }
  }

  // DB-backed permission guard registered once on boot.
  function installCNavGuard(){
    if(window.GL_HOOKS._navGuards._glPermGuardInstalled) return;
    window.GL_HOOKS._navGuards._glPermGuardInstalled = true;
    window.GL_HOOKS.registerNavGuard(function(page){
      var permId = permIdForPage(page);
      if(perms.loaded && permId && !window.glCan(permId)){
        if(typeof window.addNotification === 'function'){
          window.addNotification('Access denied', 'You do not have permission for this page. Ask Mike to enable it.', 'warning');
        } else {
          alert('Access denied — you do not have permission for this page.');
        }
        return false;
      }
    });
  }

  // ── Users & Permissions page renderer ───────────────────────────────────
  // Adds a per-user, per-component toggle matrix below the existing Users page
  // (which still shows the role cards from the original HTML).
  async function renderPermissionsPanel(){
    var el = document.getElementById('users-list');
    if(!el) return;
    var sb = getSB(); if(!sb) return;
    if(!perms.isAdmin){
      el.innerHTML = '<div style="color:var(--muted);padding:20px 0">Only admins can manage permissions.</div>';
      return;
    }
    if(!perms.loaded){
      el.innerHTML = '<div style="color:var(--muted);padding:20px 0">Loading permissions…</div>';
      await loadPermissions();
    }
    // Pull staff profiles (everyone except portal customers)
    var profR = await sb.from('profiles').select('id, name, email, role, status, notify_daily_digest').order('name', { ascending: true });
    var allProfiles = (profR && profR.data) || [];
    // Exclude profiles whose auth user is in customer_users (portal customers, not staff)
    var cuR = await sb.from('customer_users').select('auth_user_id, active');
    var customerIds = {};
    (cuR && cuR.data || []).forEach(function(r){ if(r.active !== false) customerIds[r.auth_user_id] = true; });
    var staff = allProfiles.filter(function(p){ return !customerIds[p.id]; });
    // Keep the page header count honest — the legacy renderUsers() in
    // index.html writes "N team members" from a stale in-memory list
    // that doesn't include profiles created via auth signup. The real
    // staff list is the one we just queried above.
    var activeStaffCount = staff.filter(function(p){ return p.status !== 'inactive'; }).length;
    var inactiveStaffCount = staff.length - activeStaffCount;
    var hdr = document.getElementById('users-sub');
    if(hdr){
      // Show "N active" by default since the table itself hides inactive
      // rows. If there are inactive members, note them so admins know
      // they exist (a click on the toggle link in TEAM MEMBERS header
      // brings them back into view).
      hdr.textContent = activeStaffCount + ' active team member' + (activeStaffCount === 1 ? '' : 's') +
        (inactiveStaffCount ? ' (+ ' + inactiveStaffCount + ' inactive)' : '');
    }
    // Refresh full user_permissions snapshot for the matrix
    var allPerms = await sb.from('user_permissions').select('user_id, component_id, granted');
    var byUser = {};
    (allPerms.data || []).forEach(function(row){
      if(!byUser[row.user_id]) byUser[row.user_id] = {};
      byUser[row.user_id][row.component_id] = !!row.granted;
    });
    perms.userPerms = byUser;

    function buildHeader(showBack){
      var backBtn = showBack
        ? '<button class="cbtn" onclick="window.glShowPermList()" style="font-size:11px;padding:6px 12px;margin-right:10px">← Back to users</button>'
        : '';
      return '<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:14px 18px;margin-bottom:16px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">' +
        '<div>' +
          '<div style="font-size:13px;font-weight:700;color:var(--teal);letter-spacing:1px">COMPONENT PERMISSIONS</div>' +
          '<div style="font-size:11px;color:var(--muted);margin-top:3px">' +
            (showBack
              ? 'Toggle a component for this user, or use a preset above to bulk-set everything at once.'
              : 'Pick a user below to manage their per-component access. Click <b>Edit defaults</b> to change what new users see by default. Admins always see everything.') +
          '</div>' +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:8px">' +
          backBtn +
          '<button class="cbtn" onclick="window.glOpenPermDefaults()" style="font-size:11px;padding:6px 12px">Edit defaults</button>' +
        '</div>' +
      '</div>';
    }

    function userListHtml(){
      if(!staff.length) return '<div style="color:var(--muted);padding:20px 0">No staff users found.</div>';
      // Inactive users are hidden by default so Remove / Deactivate actually
      // makes the row go away — that was Mike's call-out after fix #18
      // shipped. The header gets a toggle link to show them again. Toggle
      // state lives on the perms object so it survives the re-render that
      // glToggleUserActive / window.removeUser kick off.
      if(typeof perms.showInactive === 'undefined') perms.showInactive = false;
      var inactiveStaff = staff.filter(function(u){ return u.status === 'inactive'; });
      var visibleStaff = perms.showInactive ? staff : staff.filter(function(u){ return u.status !== 'inactive'; });
      if(!visibleStaff.length){
        // Edge case: every staff row is inactive AND we're filtering them
        // out — show an empty state that explains how to bring them back.
        var emptyToggle = inactiveStaff.length
          ? ' <a href="#" onclick="event.preventDefault();window.glToggleInactiveVisibility();" style="color:var(--teal);text-decoration:none">Show ' + inactiveStaff.length + ' inactive</a>'
          : '';
        return '<div style="color:var(--muted);padding:20px 0">No active staff to show.' + emptyToggle + '</div>';
      }
      var rows = visibleStaff.map(function(u){
        var overrideCount = (byUser[u.id] && Object.keys(byUser[u.id]).length) || 0;
        var roleColor = u.role === 'admin' ? '#f5c842' : u.role === 'sales' ? '#6b9fff' : 'var(--muted)';
        var overrideLabel = u.role === 'admin'
          ? '<span style="color:#f5c842;font-size:11px">all access (admin bypass)</span>'
          : (overrideCount === 0
              ? '<span style="color:var(--muted);font-size:11px">none — uses defaults</span>'
              : '<span style="color:#6b9fff;font-size:11px">' + overrideCount + ' override' + (overrideCount===1?'':'s') + '</span>');
        var nameLabel = u.name || (u.email || '').split('@')[0] || 'user';
        var isOwner = (u.email||'').toLowerCase() === window.GL_SUPER_USER_EMAIL;
        var isSelf  = window.currentUser && u.id === window.currentUser.id;
        var iAmSuper = window.glIsSuperUser && window.glIsSuperUser();
        var inactive = u.status === 'inactive';
        var nameCellExtra = inactive ? '<span style="font-size:10px;color:#ff8579;margin-left:8px">(inactive)</span>' : '';
        // Action cluster: Manage + Deactivate/Reactivate + Remove. The
        // workspace owner can't be removed from here. Self-removal is
        // blocked so an admin can't lock themselves out. Remove is
        // additionally super-user-only — admins can pause people but
        // can't hard-delete user records (Mike's 2026-05-23 ask).
        // Deactivate stays available to any admin.
        var deactivateBtn = (isOwner || isSelf)
          ? ''
          : '<button class="cbtn" onclick="event.stopPropagation();window.glToggleUserActive(\'' + u.id + '\')" style="font-size:11px;padding:5px 11px;background:' + (inactive ? 'rgba(29,158,117,.14);border-color:rgba(29,158,117,.4);color:#5fcf9e' : 'rgba(245,200,66,.12);border-color:rgba(245,200,66,.35);color:#f5c842') + ';margin-right:6px">' + (inactive ? 'Reactivate' : 'Deactivate') + '</button>';
        var removeBtn;
        if(isOwner)  removeBtn = '<span style="font-size:10px;color:var(--muted);margin-left:6px">Owner</span>';
        else if(isSelf) removeBtn = '<span style="font-size:10px;color:var(--muted);margin-left:6px">You</span>';
        else if(!iAmSuper) removeBtn = ''; // non-super admins don't see Remove
        else removeBtn = '<button class="cbtn" onclick="event.stopPropagation();window.removeUser(\'' + u.id + '\')" style="font-size:11px;padding:5px 11px;background:rgba(231,76,60,.12);border-color:rgba(231,76,60,.35);color:#ff8579;margin-right:6px">Remove</button>';
        return '<tr style="cursor:pointer' + (inactive ? ';opacity:.55' : '') + '" onclick="window.glRenderPermMatrixFor(\'' + u.id + '\')">' +
          '<td style="padding:12px 14px;font-weight:700">' + esc(nameLabel) + nameCellExtra + '</td>' +
          '<td style="padding:12px 14px;color:var(--muted);font-size:12px">' + esc(u.email||'') + '</td>' +
          '<td style="padding:12px 14px"><span style="font-size:10px;letter-spacing:1px;text-transform:uppercase;color:' + roleColor + ';font-weight:700">' + esc(u.role||'sales') + '</span></td>' +
          '<td style="padding:12px 14px">' + overrideLabel + '</td>' +
          '<td style="padding:12px 14px;text-align:right;white-space:nowrap">' +
            removeBtn +
            deactivateBtn +
            '<button class="cbtn" onclick="event.stopPropagation();window.glRenderPermMatrixFor(\'' + u.id + '\')" style="font-size:11px;padding:5px 14px;background:rgba(0,229,192,.12);border-color:rgba(0,229,192,.35);color:var(--teal)">Manage →</button>' +
          '</td>' +
        '</tr>';
      }).join('');
      var toggleLink = inactiveStaff.length === 0 ? '' :
        '<a href="#" onclick="event.preventDefault();window.glToggleInactiveVisibility();" ' +
          'style="font-size:11px;letter-spacing:1px;color:var(--muted);text-decoration:none;font-weight:500;text-transform:none">' +
          (perms.showInactive
            ? '(showing ' + inactiveStaff.length + ' inactive · click to hide)'
            : '(' + inactiveStaff.length + ' inactive hidden · click to show)') +
        '</a>';
      return '<div style="background:#0d1b2e;border:1px solid rgba(255,255,255,.08);border-radius:12px;overflow:hidden">' +
        '<div style="padding:12px 18px;border-bottom:1px solid rgba(255,255,255,.06);font-size:11px;letter-spacing:2px;color:var(--teal);font-weight:700;display:flex;justify-content:space-between;align-items:center"><span>TEAM MEMBERS</span>' + toggleLink + '</div>' +
        '<table style="width:100%;border-collapse:collapse;font-size:13px">' +
          '<thead><tr style="border-bottom:1px solid rgba(255,255,255,.06)">' +
            '<th style="padding:8px 14px;text-align:left;color:var(--muted);font-size:10px;letter-spacing:1px">NAME</th>' +
            '<th style="padding:8px 14px;text-align:left;color:var(--muted);font-size:10px;letter-spacing:1px">EMAIL</th>' +
            '<th style="padding:8px 14px;text-align:left;color:var(--muted);font-size:10px;letter-spacing:1px">ROLE</th>' +
            '<th style="padding:8px 14px;text-align:left;color:var(--muted);font-size:10px;letter-spacing:1px">OVERRIDES</th>' +
            '<th style="padding:8px 14px"></th>' +
          '</tr></thead>' +
          '<tbody>' + rows + '</tbody>' +
        '</table>' +
      '</div>';
    }

    function matrixFor(userId){
      var u = staff.find(function(x){ return x.id === userId; });
      if(!u) return '<div style="color:var(--muted);padding:20px 0">User not found.</div>';
      var userOverrides = byUser[userId] || {};
      var B = 'border:1px solid rgba(255,255,255,.28)';
      var HOVER_ON  = "this.style.background='rgba(0,229,192,.08)'";
      var HOVER_OFF_EVEN = "this.style.background=''";
      var HOVER_OFF_ODD  = "this.style.background='rgba(255,255,255,.05)'";
      function rowHtml(c, idx){
        var hasOverride = Object.prototype.hasOwnProperty.call(userOverrides, c.id);
        var effective = hasOverride ? userOverrides[c.id] : c.default_on;
        var note = u.role === 'admin'
          ? '<span style="font-size:10px;color:#f5c842">admin override</span>'
          : (hasOverride
              ? '<span style="font-size:10px;color:#6b9fff;cursor:pointer" onclick="window.glClearPerm(\'' + userId + '\',\'' + c.id + '\')" title="Click to revert to default">overridden — revert</span>'
              : '<span style="font-size:10px;color:var(--muted)">default (' + (c.default_on ? 'on' : 'off') + ')</span>');
        var isOdd = idx % 2;
        var rowBg = isOdd ? 'background:rgba(255,255,255,.05)' : '';
        var hoverOff = isOdd ? HOVER_OFF_ODD : HOVER_OFF_EVEN;
        var checked = effective ? ' checked' : '';
        var disabled = u.role === 'admin' ? ' disabled' : '';
        return '<tr style="' + rowBg + ';transition:background .1s" onmouseover="' + HOVER_ON + '" onmouseout="' + hoverOff + '">' +
          '<td style="padding:10px 12px;font-weight:600;' + B + '">' +
            esc(c.label) +
            (c.description ? '<div style="font-size:11px;color:var(--muted);font-weight:400;margin-top:3px;white-space:normal">' + esc(c.description) + '</div>' : '') +
          '</td>' +
          '<td style="padding:10px 12px;text-align:center;width:72px;' + B + '">' +
            '<label style="cursor:' + (u.role==='admin'?'default':'pointer') + ';display:block">' +
              '<input type="checkbox"' + checked + disabled +
                ' onchange="window.glTogglePerm(\'' + userId + '\',\'' + c.id + '\',this.checked)"' +
                ' style="width:18px;height:18px;cursor:' + (u.role==='admin'?'default':'pointer') + ';accent-color:var(--teal)">' +
            '</label>' +
          '</td>' +
          '<td style="padding:10px 12px;width:150px;' + B + '">' + note + '</td>' +
        '</tr>';
      }
      function sectionTable(title, color, items){
        if(!items.length) return '';
        return '<div style="margin-top:18px;padding:6px 0 5px;font-size:11px;letter-spacing:2px;color:' + color + ';font-weight:700">' + title + '</div>' +
          '<table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:10px;border:2px solid rgba(255,255,255,.28)">' +
            '<thead><tr style="background:rgba(255,255,255,.08)">' +
              '<th style="padding:10px 12px;color:#ccd6f6;font-size:10px;letter-spacing:1.5px;text-align:left;' + B + '">COMPONENT &amp; DESCRIPTION</th>' +
              '<th style="padding:10px 12px;color:#ccd6f6;font-size:10px;letter-spacing:1.5px;text-align:center;width:72px;' + B + '">ACCESS</th>' +
              '<th style="padding:10px 12px;color:#ccd6f6;font-size:10px;letter-spacing:1.5px;width:150px;' + B + '">STATE</th>' +
            '</tr></thead>' +
            '<tbody>' + items.map(function(c,i){ return rowHtml(c,i); }).join('') + '</tbody>' +
          '</table>';
      }
      var pages   = perms.components.filter(function(c){ return c.category === 'page'   || !c.category; });
      var actions = perms.components.filter(function(c){ return c.category === 'action'; });
      var dataC   = perms.components.filter(function(c){ return c.category === 'data'; });

      var presetOpts = Object.keys(window.glPresets || {}).map(function(k){
        return '<option value="' + k + '">' + esc(window.glPresets[k].label) + '</option>';
      }).join('');
      var presetBar = u.role === 'admin'
        ? '<div style="font-size:11px;color:#f5c842;margin-bottom:10px">Admin role bypasses every gate — presets do not apply.</div>'
        : '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px;padding:10px 12px;background:rgba(26,111,255,.06);border:1px solid rgba(26,111,255,.18);border-radius:8px">' +
            '<span style="font-size:11px;letter-spacing:1px;color:#6b9fff;font-weight:700">APPLY PRESET</span>' +
            '<select id="gl-preset-' + userId + '" style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.12);color:#eef4ff;padding:5px 8px;border-radius:6px;font-size:12px"><option value="">Choose a preset…</option>' + presetOpts + '</select>' +
            '<button onclick="(function(){var v=document.getElementById(\'gl-preset-' + userId + '\').value;if(v)window.glApplyRolePreset(\'' + userId + '\',v);})()" class="cbtn" style="font-size:11px;padding:5px 12px">Apply</button>' +
            '<span style="font-size:10px;color:var(--muted)">Overwrites all of this user\'s current overrides.</span>' +
          '</div>';

      var roleOpts = ['admin','sales','viewer'].map(function(r){
        return '<option value="' + r + '"' + (u.role===r?' selected':'') + '>' + r.charAt(0).toUpperCase() + r.slice(1) + '</option>';
      }).join('');
      var isSelf = u.id === perms.userId;
      var roleControl =
        '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:6px 0 10px;padding:8px 12px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:8px">' +
          '<span style="font-size:10px;letter-spacing:1.5px;color:var(--muted);font-weight:700">ROLE</span>' +
          '<select id="gl-role-' + u.id + '" ' + (isSelf?'disabled':'') + ' onchange="window.glChangeUserRole(\'' + u.id + '\',this.value)" style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.12);color:#eef4ff;padding:5px 10px;border-radius:6px;font-size:12px">' + roleOpts + '</select>' +
          (isSelf
            ? '<span style="font-size:10px;color:var(--muted)">— you can\'t change your own role (locked out risk)</span>'
            : '<span style="font-size:10px;color:var(--muted)">Admin role bypasses every gate. Changing to Sales/Viewer makes the per-component overrides apply.</span>') +
        '</div>';
      var digestOn = u.notify_daily_digest !== false;
      var notifyControl =
        '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0 0 14px;padding:8px 12px;background:rgba(124,58,237,.06);border:1px solid rgba(124,58,237,.2);border-radius:8px">' +
          '<span style="font-size:10px;letter-spacing:1.5px;color:#c4b5fd;font-weight:700">NOTIFICATIONS</span>' +
          '<label style="display:flex;align-items:center;gap:8px;font-size:12px;color:#eef4ff;cursor:pointer">' +
            '<input type="checkbox"' + (digestOn?' checked':'') + ' onchange="window.glToggleUserNotify(\'' + u.id + '\',\'notify_daily_digest\',this.checked)" style="width:14px;height:14px;cursor:pointer;accent-color:#c4b5fd">' +
            '<span>📨 Send Daily Digest email at 7am</span>' +
          '</label>' +
          '<span style="font-size:10px;color:var(--muted)">Uncheck to opt this user out of the morning digest.</span>' +
        '</div>';
      return '<div style="background:#0d1b2e;border:1px solid rgba(255,255,255,.08);border-radius:0 8px 8px 8px;padding:16px;margin-bottom:18px">' +
        '<div style="font-size:13px;color:#fff;font-weight:700;margin-bottom:2px">' + esc(u.name||u.email) + '</div>' +
        '<div style="font-size:11px;color:var(--muted);margin-bottom:6px">' + esc(u.email||'') + (u.role==='admin' ? ' · <span style="color:#f5c842">admin bypasses all gates</span>' : '') + '</div>' +
        roleControl +
        notifyControl +
        presetBar +
        sectionTable('PAGES — what they can navigate to',  '#00e5c0', pages) +
        sectionTable('ACTIONS — what they can do',          '#f5c842', actions) +
        sectionTable('DATA — what they can see',            '#c4b5fd', dataC) +
      '</div>';
    }

    // Default: show the team list. User clicks a row → drills into matrix.
    el.innerHTML = buildHeader(false) +
      '<div id="gl-perm-content">' + userListHtml() + '</div>' +
      '<div id="gl-perm-audit"></div>';
    if(typeof window.glRenderPermAudit === 'function') setTimeout(window.glRenderPermAudit, 100);

    window.glShowPermList = function(){
      var headerEl = el.querySelector(':scope > div:first-child');
      if(headerEl){
        var newHeader = document.createElement('div');
        newHeader.innerHTML = buildHeader(false);
        el.replaceChild(newHeader.firstChild, headerEl);
      }
      document.getElementById('gl-perm-content').innerHTML = userListHtml();
      // Re-render audit panel below the list
      var auditEl = document.getElementById('gl-perm-audit');
      if(auditEl && typeof window.glRenderPermAudit === 'function') setTimeout(window.glRenderPermAudit, 50);
    };

    window.glRenderPermMatrixFor = function(userId){
      var headerEl = el.querySelector(':scope > div:first-child');
      if(headerEl){
        var newHeader = document.createElement('div');
        newHeader.innerHTML = buildHeader(true);
        el.replaceChild(newHeader.firstChild, headerEl);
      }
      document.getElementById('gl-perm-content').innerHTML = matrixFor(userId);
      // Scroll the matrix into view
      var matrixEl = document.getElementById('gl-perm-content');
      if(matrixEl) matrixEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
  }

  window.glChangeUserRole = async function(userId, newRole){
    if(!['admin','sales','viewer'].includes(newRole)){ alert('Invalid role: ' + newRole); return; }
    if(userId === perms.userId){ alert('Cannot change your own role — that could lock you out.'); return; }
    var sb = getSB(); if(!sb) return;
    if(newRole === 'admin' && !confirm('Make this user an ADMIN? They will bypass every component gate and be able to manage everyone\'s permissions, invite users, etc.')) return;
    var r = await sb.from('profiles').update({ role: newRole }).eq('id', userId);
    if(r.error){ alert('Role change failed: ' + r.error.message); return; }
    if(typeof window.addNotification === 'function'){
      window.addNotification('Role updated', 'User role changed to ' + newRole + '.', 'success');
    }
    // Re-fetch staff data, then stay on this user's detail view so the
    // role badge in the header refreshes in place.
    if(typeof renderPermissionsPanel === 'function'){
      await renderPermissionsPanel();
      if(typeof window.glRenderPermMatrixFor === 'function') window.glRenderPermMatrixFor(userId);
    }
  };

  /* ── glToggleInactiveVisibility — show/hide inactive rows in the team
     members table. Default-hidden so Remove / Deactivate visually take
     effect (Mike's call-out after fix #18 shipped: "I clicked Remove and
     nothing happened"). The state lives on the perms object so it survives
     re-renders. */
  window.glToggleInactiveVisibility = function(){
    perms.showInactive = !perms.showInactive;
    if(typeof renderPermissionsPanel === 'function') renderPermissionsPanel();
  };

  /* ── glToggleUserActive — flip profiles.status between active / inactive ──
     Powers the Deactivate/Reactivate button in the new Users & Permissions
     team-members table. An inactive profile keeps its row in the DB (so
     audit history stays intact) but the user can no longer use the CRM —
     RLS policies + the in-app `can()` gate both check status. To FULLY
     delete the user (including the Supabase auth row), go to the Supabase
     dashboard → Authentication → Users. That step has to happen there
     because the JS client can't admin-delete auth users (anon key has no
     service-role privilege). */
  window.glToggleUserActive = async function(userId){
    var sb = getSB(); if(!sb) return;
    if(window.currentUser && userId === window.currentUser.id){
      alert('You can\'t deactivate yourself — that would lock you out.');
      return;
    }
    // Fetch the current status from the DB (don't trust the in-memory cache,
    // which may be stale or missing the row entirely for profiles created via
    // auth signup).
    var cur = await sb.from('profiles').select('id, email, name, status').eq('id', userId).maybeSingle();
    if(cur.error || !cur.data){ alert('User lookup failed: ' + ((cur.error && cur.error.message) || 'not found')); return; }
    var u = cur.data;
    var nextStatus = (u.status === 'inactive') ? 'active' : 'inactive';
    var verb = nextStatus === 'inactive' ? 'Deactivate' : 'Reactivate';
    if(!confirm(verb + ' ' + (u.name || u.email) + '? ' +
      (nextStatus === 'inactive'
        ? 'They will lose CRM access immediately, but their audit history stays. You can reactivate them any time.'
        : 'They\'ll regain CRM access at their current role.'))) return;
    // updated_at is bumped automatically by trg_profiles_updated_at; sending
    // it explicitly would 400 against deployments that haven't run the
    // 20260522_profiles_updated_at migration yet (originally caught when
    // Mike clicked Deactivate on Danny and got "Could not find the
    // 'updated_at' column" — the click silently bounced).
    var r = await sb.from('profiles').update({ status: nextStatus }).eq('id', userId);
    if(r.error){ alert('Status change failed: ' + r.error.message); return; }
    if(typeof window.addNotification === 'function'){
      window.addNotification('👤 User ' + nextStatus, u.email || u.name, nextStatus === 'inactive' ? 'warning' : 'success');
    }
    if(typeof window.glAudit === 'function') window.glAudit('user_' + nextStatus, u.email || userId, null);
    // Re-render the panel so the row reflects the new state.
    if(typeof renderPermissionsPanel === 'function') renderPermissionsPanel();
  };

  /* ── removeUser fallback — original lives at the top of this IIFE but
     bails out when `window.users` doesn't have the row (which is every
     profile that came in via auth signup). Re-bind it so the team-members
     table in the new panel can soft-delete those too. We keep the same
     `window.removeUser` name so existing call sites in the old renderer
     still work. */
  var _origRemoveUser = window.removeUser;
  window.removeUser = async function(id){
    if(!window.glIsSuperUser || !window.glIsSuperUser()){
      alert('Only the workspace owner can remove users. Other admins can Deactivate.');
      return;
    }
    var sb = getSB(); if(!sb){ if(_origRemoveUser) return _origRemoveUser(id); return; }
    if(window.currentUser && id === window.currentUser.id){
      alert('You can\'t remove yourself — that would lock you out.');
      return;
    }
    var cur = await sb.from('profiles').select('id, email, name').eq('id', id).maybeSingle();
    if(cur.error || !cur.data){
      // Fall back to the original behavior (works against window.users cache).
      if(_origRemoveUser) return _origRemoveUser(id);
      alert('User not found.');
      return;
    }
    var u = cur.data;
    if((u.email||'').toLowerCase() === 'mike@goodliquid.com'){
      alert('The workspace owner can\'t be removed from here. Use the Supabase dashboard → Authentication → Users if you really need to.');
      return;
    }
    if(!confirm('Remove ' + (u.name || u.email) + '?\n\n' +
      'This permanently removes their login. They\'ll need a new invite to regain access.\n\n' +
      'Their audit history is preserved in the database.')) return;

    // Hard-delete from Supabase Auth via edge function (service-role required).
    // This ensures their email can be re-invited later without a "already registered" error.
    var SUPA_URL = 'https://ufjkeqmxwuyhbqyugcgg.supabase.co';
    var sess = null;
    try {
      var sessRes = await sb.auth.getSession();
      sess = sessRes && sessRes.data && sessRes.data.session;
    } catch(e){}

    if(sess && sess.access_token){
      var delRes = await fetch(SUPA_URL + '/functions/v1/delete-staff-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + sess.access_token },
        body: JSON.stringify({ userId: id })
      });
      var delData = await delRes.json();
      if(!delRes.ok || !delData.ok){
        alert('Remove failed: ' + (delData.error || 'HTTP ' + delRes.status));
        return;
      }
    } else {
      // Fallback: soft-delete only if we can't reach the edge function
      var r = await sb.from('profiles').update({ status: 'inactive' }).eq('id', id);
      if(r.error){ alert('Remove failed: ' + r.error.message); return; }
    }

    if(typeof window.addNotification === 'function'){
      window.addNotification('👤 User removed', u.email || u.name, 'warning');
    }
    if(typeof window.glAudit === 'function') window.glAudit('user_removed', u.email || id, null);
    if(window.users) window.users = window.users.filter(function(x){ return x.id !== id; });
    if(typeof renderPermissionsPanel === 'function') renderPermissionsPanel();
    if(typeof window.renderUsers === 'function') window.renderUsers();
  };

  // Flip a notification preference column on a user's profiles row. Used
  // by the NOTIFICATIONS block in the Users & Permissions matrix to
  // opt-staff in/out of the morning Daily Digest. Whitelisted set of
  // columns to prevent arbitrary profile updates from this UI.
  window.glToggleUserNotify = async function(userId, field, on){
    var ALLOWED = ['notify_daily_digest'];
    if(ALLOWED.indexOf(field) < 0){ alert('Unsupported field: ' + field); return; }
    var sb = getSB(); if(!sb) return;
    var patch = {}; patch[field] = !!on;
    var r = await sb.from('profiles').update(patch).eq('id', userId);
    if(r.error){ alert('Save failed: ' + r.error.message); return; }
    if(typeof window.addNotification === 'function'){
      window.addNotification('Notification preference saved', field + ' = ' + (on?'on':'off'), 'success');
    }
    if(typeof window.glAudit === 'function') window.glAudit('user_notify_changed', userId, { field: field, value: !!on });
    // Update local cache so re-renders reflect the new value without a refetch.
    if(typeof perms === 'object' && Array.isArray(perms.staff)){
      var u = perms.staff.find(function(x){ return x.id === userId; });
      if(u) u[field] = !!on;
    }
  };

  window.glTogglePerm = async function(userId, componentId, granted){
    var sb = getSB(); if(!sb) return;
    var row = { user_id: userId, component_id: componentId, granted: granted, updated_at: new Date().toISOString(), updated_by: perms.userId };
    var r = await sb.from('user_permissions').upsert(row, { onConflict: 'user_id,component_id' });
    if(r.error){ alert('Save failed: ' + r.error.message); return; }
    if(!perms.userPerms[userId]) perms.userPerms[userId] = {};
    perms.userPerms[userId][componentId] = granted;
    // If toggling self, re-apply gating live.
    if(userId === perms.userId) applyGating();
    // Re-render the matrix so the "state" label flips correctly (default → overridden).
    if(typeof window.glRenderPermMatrixFor === 'function') window.glRenderPermMatrixFor(userId);
  };

  window.glClearPerm = async function(userId, componentId){
    var sb = getSB(); if(!sb) return;
    if(!confirm('Revert this component to its default for this user?')) return;
    var r = await sb.from('user_permissions').delete().eq('user_id', userId).eq('component_id', componentId);
    if(r.error){ alert('Revert failed: ' + r.error.message); return; }
    if(perms.userPerms[userId]) delete perms.userPerms[userId][componentId];
    if(userId === perms.userId) applyGating();
    // Stay on the user's matrix view — don't bounce back to the list.
    if(typeof window.glRenderPermMatrixFor === 'function') window.glRenderPermMatrixFor(userId);
  };

  window.glOpenPermDefaults = function(){
    var existing = document.getElementById('gl-perm-defaults');
    if(existing) existing.remove();
    var ov = document.createElement('div');
    ov.id = 'gl-perm-defaults';
    ov.setAttribute('style','position:fixed;inset:0;z-index:1100;background:rgba(6,13,26,.94);backdrop-filter:blur(10px);overflow-y:auto;padding:24px');
    var rows = perms.components.map(function(c){
      return '<tr>' +
        '<td style="padding:8px;font-weight:600">' + esc(c.label) + '</td>' +
        '<td style="padding:8px;color:var(--muted);font-size:11px">' + esc(c.description||'') + '</td>' +
        '<td style="padding:8px;text-align:center"><label style="cursor:pointer"><input type="checkbox"' + (c.default_on?' checked':'') + ' onchange="window.glSetDefault(\'' + c.id + '\',this.checked)"></label></td>' +
      '</tr>';
    }).join('');
    ov.innerHTML = '<div style="max-width:760px;margin:0 auto;background:#142238;border:1px solid rgba(0,229,192,.2);border-radius:14px;padding:24px;color:#eef4ff;font-family:Arial,Helvetica,sans-serif">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">' +
        '<div style="font-size:18px;font-weight:900;color:#00e5c0;letter-spacing:2px">EDIT DEFAULTS</div>' +
        '<button onclick="document.getElementById(\'gl-perm-defaults\').remove()" style="background:none;border:0;color:#6b87ad;font-size:22px;cursor:pointer">×</button>' +
      '</div>' +
      '<div style="font-size:12px;color:#9ca3af;margin-bottom:16px;line-height:1.5">These are the components a NEW staff user sees by default. Existing per-user overrides keep their explicit setting; users with no override use the default below.</div>' +
      '<table style="width:100%;border-collapse:collapse;font-size:13px">' +
        '<thead><tr style="border-bottom:1px solid rgba(255,255,255,.08);text-align:left">' +
          '<th style="padding:8px;color:#6b87ad;font-size:10px;letter-spacing:1px">COMPONENT</th>' +
          '<th style="padding:8px;color:#6b87ad;font-size:10px;letter-spacing:1px">DESCRIPTION</th>' +
          '<th style="padding:8px;color:#6b87ad;font-size:10px;letter-spacing:1px;text-align:center">DEFAULT ON</th>' +
        '</tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table>' +
    '</div>';
    document.body.appendChild(ov);
  };

  window.glSetDefault = async function(componentId, on){
    var sb = getSB(); if(!sb) return;
    var r = await sb.from('permission_components').update({ default_on: on }).eq('id', componentId);
    if(r.error){ alert('Save failed: ' + r.error.message); return; }
    var c = perms.byId[componentId];
    if(c) c.default_on = on;
    applyGating();
  };

  // Boot: load perms when supa is ready + a user is signed in.
  function boot(){
    var sb = window.supa;
    if(!sb || !sb.auth){ setTimeout(boot, 300); return; }
    loadPermissions();
    sb.auth.onAuthStateChange(function(event){
      if(event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') loadPermissions();
      if(event === 'SIGNED_OUT'){
        perms.loaded = false; perms.isAdmin = false; perms.userId = null;
        perms.userPerms = {};
      }
    });
    // Install cNav guard once
    var tries = 0;
    var iv = setInterval(function(){
      installCNavGuard();
      if((window.cNav && window.cNav.__glPermGuard) || ++tries > 30) clearInterval(iv);
    }, 200);
    // Re-apply gating after the SPA finishes painting the sidebar
    setTimeout(applyGating, 800);
    setTimeout(applyGating, 2000);
  }
  if(document.readyState !== 'loading') boot();
  else document.addEventListener('DOMContentLoaded', boot);

  // Apply permissions gating for non-admin users on login
  window.GL_HOOKS.registerLoginHook(function(u){
    if(u && u.role !== 'admin'){
      if(perms.loaded){
        applyGating();
      } else {
        var maxTries = 50, tries = 0;
        var iv = setInterval(function(){
          tries++;
          if(perms.loaded || tries >= maxTries){ clearInterval(iv); if(perms.loaded) applyGating(); }
        }, 100);
      }
    }
  });

  // Render permissions panel whenever the users page is navigated to.
  window.GL_HOOKS.registerNavHook(function(page){
    if(page === 'users') setTimeout(renderPermissionsPanel, 60);
  });

  // ────────────────────────────────────────────────────────────
  // Action-level gating — wrap destructive/financial global
  // functions so they no-op + notify when the user lacks
  // the relevant permission.
  // ────────────────────────────────────────────────────────────
  var ACTION_GATES = {
    deleteInvoice:           'action.invoice.delete',
    deleteDeal:              'action.deal.delete',
    deleteRun:               'action.production_run.delete',
    deleteProductionRun:     'action.production_run.delete',
    deleteClient:            'action.client.delete',
    quickPaid:               'action.invoice.mark_paid',
    markStatus:              'action.invoice.mark_paid',
    glExportEverything:      'action.export.bulk',
    glExportInvoicesCsv:     'action.export.csv',
    glInviteCustomerLogin:   'action.customer.invite',
    glOpenInvitePicker:      'action.customer.invite',
    glCpResendInvite:        'action.customer.invite',
    glCpSetActive:           'action.customer.deactivate',
    removeCustomerLogin:     'action.customer.deactivate',
    openInviteModal:         'action.user.invite',
    sendInvoiceEmail:        'action.invoice.send',
    sendFollowupEmail:       'action.invoice.send'
  };
  function denyAction(permId){
    if(typeof window.addNotification === 'function'){
      window.addNotification('Access denied', 'You do not have permission for this action. Ask Mike to enable it.', 'warning');
    } else {
      alert('Access denied — this action is disabled for your account.');
    }
    console.warn('[GL perms] action denied:', permId);
  }
  function gateFunction(name, permId){
    var orig = window[name];
    if(typeof orig !== 'function') return false;
    if(orig.__glPermGated) return true;
    var wrapped = function(){
      if(perms.loaded && !window.glCan(permId)){ denyAction(permId); return; }
      return orig.apply(this, arguments);
    };
    wrapped.__glPermGated = true;
    wrapped.__glPermOrig = orig;
    window[name] = wrapped;
    return true;
  }
  function applyActionGates(){
    Object.keys(ACTION_GATES).forEach(function(name){ gateFunction(name, ACTION_GATES[name]); });
  }
  // Retry gating periodically so functions defined later still get wrapped.
  (function watch(){
    applyActionGates();
    setTimeout(watch, 1500);
  })();

  // ────────────────────────────────────────────────────────────
  // Role presets — apply a set of overrides to a user in one click.
  // Admin presets use bulk upsert of user_permissions rows.
  // ────────────────────────────────────────────────────────────
  // The shape: { pageDefaults: bool, actionDefaults: bool, overrides: {component_id: bool} }
  // Effective rule: start with the global default_on of each component,
  // then layer pageDefaults / actionDefaults (only when not undefined),
  // then layer overrides (final word).
  var ROLE_PRESETS = window.glPresets = {
    admin: {
      label: 'Admin (full access)',
      description: 'Sets every component ON. Note: profiles.role=admin already bypasses gating; this is mostly cosmetic.',
      pageDefaults: true,
      actionDefaults: true,
      overrides: {}
    },
    sales: {
      label: 'Sales',
      description: 'Most pages on, no admin-only pages (Audit, Users, AI Settings, Customer Logins). Can mark paid + send invoices; cannot delete or export the full backup.',
      pageDefaults: true,
      actionDefaults: false,
      overrides: {
        'page.audit':       false,
        'page.users':       false,
        'page.customers':   false,
        'page.ai-settings': false,
        'action.invoice.mark_paid': true,
        'action.invoice.send':      true,
        'action.export.csv':        true,
        'action.customer.invite':   true
      }
    },
    viewer: {
      label: 'Viewer (read-only)',
      description: 'Dashboard, Clients, Invoices, Reports. Everything else hidden. Cannot delete, mark paid, export, or invite.',
      pageDefaults: false,
      actionDefaults: false,
      overrides: {
        'page.dashboard':  true,
        'page.clients':    true,
        'page.invoices':   true,
        'page.reports':    true
      }
    }
  };

  window.glApplyRolePreset = async function(userId, presetKey){
    var preset = ROLE_PRESETS[presetKey];
    if(!preset){ alert('Unknown preset: ' + presetKey); return; }
    if(!confirm('Apply "' + preset.label + '" preset to this user? This overwrites their current per-component overrides.')) return;
    var sb = getSB(); if(!sb) return;
    // Compute the preset's intended value for every component, then only
    // write overrides for components where the preset DIFFERS from the
    // global default. Components matching the default stay clean (showing
    // "default" in the matrix instead of "overridden — revert" noise).
    var overridesToWrite = [];
    perms.components.forEach(function(c){
      var presetValue;
      if(Object.prototype.hasOwnProperty.call(preset.overrides, c.id)){
        presetValue = preset.overrides[c.id];
      } else if(c.category === 'action'){
        presetValue = !!preset.actionDefaults;
      } else {
        presetValue = !!preset.pageDefaults;
      }
      if(presetValue !== !!c.default_on){
        overridesToWrite.push({
          user_id: userId,
          component_id: c.id,
          granted: presetValue,
          updated_at: new Date().toISOString(),
          updated_by: perms.userId
        });
      }
    });
    // Wipe existing overrides, then insert only the meaningful ones.
    var delR = await sb.from('user_permissions').delete().eq('user_id', userId);
    if(delR.error){ alert('Reset failed: ' + delR.error.message); return; }
    if(overridesToWrite.length){
      var upR = await sb.from('user_permissions').insert(overridesToWrite);
      if(upR.error){ alert('Apply failed: ' + upR.error.message); return; }
    }
    if(typeof window.addNotification === 'function'){
      window.addNotification('Preset applied',
        preset.label + ' applied — ' + overridesToWrite.length + ' override' + (overridesToWrite.length===1?'':'s') + ' written. The rest use the global default.',
        'success');
    }
    // Refresh in-memory state to match the new minimal set.
    perms.userPerms[userId] = {};
    overridesToWrite.forEach(function(r){ perms.userPerms[userId][r.component_id] = r.granted; });
    if(userId === perms.userId) applyGating();
    if(typeof window.glRenderPermMatrixFor === 'function') window.glRenderPermMatrixFor(userId);
  };

  window.glPresets = ROLE_PRESETS;

  // ────────────────────────────────────────────────────────────
  // Visual gating — proactively HIDE buttons the current user
  // cannot use, instead of just blocking them on click. Matches
  // by onclick attribute (for legacy inline handlers built as
  // HTML strings) AND by an explicit `data-gl-perm="<id>"`
  // attribute (for new code).
  // ────────────────────────────────────────────────────────────
  var ONCLICK_PATTERNS = [
    { re: /deleteInvoice\b/,         perm: 'action.invoice.delete' },
    { re: /deleteDeal\b/,            perm: 'action.deal.delete' },
    { re: /deleteRun\b/,             perm: 'action.production_run.delete' },
    { re: /deleteClient\b/,          perm: 'action.client.delete' },
    { re: /quickPaid\b/,             perm: 'action.invoice.mark_paid' },
    { re: /markStatus\(\s*['"]paid['"]/, perm: 'action.invoice.mark_paid' },
    { re: /glExportEverything\b/,    perm: 'action.export.bulk' },
    { re: /glExportInvoicesCsv\b/,   perm: 'action.export.csv' },
    { re: /glInviteCustomerLogin\b/, perm: 'action.customer.invite' },
    { re: /glOpenInvitePicker\b/,    perm: 'action.customer.invite' },
    { re: /glCpResendInvite\b/,      perm: 'action.customer.invite' },
    { re: /glCpSetActive\b/,         perm: 'action.customer.deactivate' },
    { re: /removeCustomerLogin\b/,   perm: 'action.customer.deactivate' },
    { re: /openInviteModal\b/,       perm: 'action.user.invite' },
    { re: /sendInvoiceEmail\b/,      perm: 'action.invoice.send' },
    { re: /sendFollowupEmail\b/,     perm: 'action.invoice.send' }
  ];
  function hidePoint(el, allowed){
    if(allowed){
      if(el.dataset.glPermHidden === '1'){
        el.style.display = el.dataset.glPermPrevDisplay || '';
        delete el.dataset.glPermHidden;
        delete el.dataset.glPermPrevDisplay;
      } else if(el.hasAttribute('data-gl-perm') && el.style.display === 'none'){
        // Element was authored with display:none expecting permissions to
        // reveal it (e.g. admin-only buttons). Unhide it now that we know
        // the current user is allowed.
        el.style.display = '';
      }
    } else {
      if(el.dataset.glPermHidden !== '1'){
        el.dataset.glPermPrevDisplay = el.style.display || '';
        el.dataset.glPermHidden = '1';
        el.style.display = 'none';
      }
    }
  }
  function scanAndHide(root){
    if(!perms.loaded) return;
    if(perms.isAdmin){
      // Admin: restore any previously hidden ones AND reveal anything
      // that was authored with display:none + data-gl-perm (e.g. the
      // top-toolbar Users & Permissions button).
      (root || document).querySelectorAll('[data-gl-perm-hidden="1"]').forEach(function(el){ hidePoint(el, true); });
      (root || document).querySelectorAll('[data-gl-perm]').forEach(function(el){ hidePoint(el, true); });
      return;
    }
    // 1) Explicit data-gl-perm attribute
    (root || document).querySelectorAll('[data-gl-perm]').forEach(function(el){
      hidePoint(el, window.glCan(el.getAttribute('data-gl-perm')));
    });
    // 2) Legacy inline onclick patterns
    var nodes = (root || document).querySelectorAll('button[onclick],a[onclick],[onclick]');
    nodes.forEach(function(el){
      var oc = el.getAttribute('onclick') || '';
      if(!oc) return;
      for(var i=0; i<ONCLICK_PATTERNS.length; i++){
        var spec = ONCLICK_PATTERNS[i];
        if(spec.re.test(oc)){
          hidePoint(el, window.glCan(spec.perm));
          break;
        }
      }
    });
  }
  // Debounced full-page scan in response to DOM changes
  var scanScheduled = false;
  function scheduleScan(){
    if(scanScheduled) return;
    scanScheduled = true;
    setTimeout(function(){ scanScheduled = false; scanAndHide(); }, 120);
  }
  if(typeof MutationObserver !== 'undefined'){
    new MutationObserver(function(records){
      // Cheap filter: only scan if at least one record added/removed nodes
      for(var i=0;i<records.length;i++){
        if(records[i].addedNodes && records[i].addedNodes.length){ scheduleScan(); return; }
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  }
  // Re-scan after route changes too — applyGating already runs after cNav.
  var origApplyGating = applyGating;
  applyGating = function(){ origApplyGating(); scanAndHide(); };
  // Also expose for the user-permissions panel to refresh after a toggle
  window.glRescanPermissions = function(){ scanAndHide(); };

  // ────────────────────────────────────────────────────────────
  // Audit log — record every permission change for accountability.
  // Backed by the permissions_audit table (created in a new migration).
  // Renders a "Recent permission changes" panel under the matrix.
  // ────────────────────────────────────────────────────────────
  async function loadPermissionAudit(){
    var sb = getSB(); if(!sb) return [];
    var r = await sb.from('permissions_audit')
      .select('id, actor_id, target_user_id, component_id, action, old_value, new_value, created_at')
      .order('created_at', { ascending: false }).limit(40);
    if(r.error){ console.warn('[GL audit] load failed', r.error); return []; }
    return r.data || [];
  }
  window.glRenderPermAudit = async function(){
    var el = document.getElementById('gl-perm-audit');
    if(!el) return;
    el.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:8px">Loading audit…</div>';
    var rows = await loadPermissionAudit();
    if(!rows.length){ el.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:8px">No permission changes recorded yet.</div>'; return; }
    var sb = getSB();
    // Resolve actor + target names in one go
    var ids = {};
    rows.forEach(function(r){ if(r.actor_id) ids[r.actor_id]=1; if(r.target_user_id) ids[r.target_user_id]=1; });
    var idList = Object.keys(ids);
    var nameMap = {};
    if(idList.length){
      var pR = await sb.from('profiles').select('id,name,email').in('id', idList);
      (pR.data || []).forEach(function(p){ nameMap[p.id] = p.name || p.email || p.id.slice(0,8); });
    }
    el.innerHTML = '<div style="font-size:11px;letter-spacing:2px;color:var(--muted);font-weight:700;margin:18px 0 8px">RECENT PERMISSION CHANGES</div>' +
      '<table style="width:100%;border-collapse:collapse;font-size:12px">' +
        '<thead><tr style="border-bottom:1px solid rgba(255,255,255,.08);text-align:left">' +
          '<th style="padding:6px 8px;color:var(--muted);font-size:10px;letter-spacing:1px">WHEN</th>' +
          '<th style="padding:6px 8px;color:var(--muted);font-size:10px;letter-spacing:1px">ADMIN</th>' +
          '<th style="padding:6px 8px;color:var(--muted);font-size:10px;letter-spacing:1px">TARGET</th>' +
          '<th style="padding:6px 8px;color:var(--muted);font-size:10px;letter-spacing:1px">COMPONENT</th>' +
          '<th style="padding:6px 8px;color:var(--muted);font-size:10px;letter-spacing:1px">CHANGE</th>' +
        '</tr></thead><tbody>' +
        rows.map(function(r){
          var comp = (perms.byId[r.component_id] && perms.byId[r.component_id].label) || r.component_id;
          var change;
          if(r.action === 'INSERT') change = '<span style="color:#5fcf9e">set to ' + (r.new_value ? 'ON' : 'OFF') + '</span>';
          else if(r.action === 'DELETE') change = '<span style="color:#9aa7bd">reverted to default</span>';
          else change = '<span style="color:#f5c842">' + (r.old_value?'ON':'OFF') + ' → ' + (r.new_value?'ON':'OFF') + '</span>';
          return '<tr>' +
            '<td style="padding:6px 8px;color:var(--muted);font-size:11px">' + new Date(r.created_at).toLocaleString() + '</td>' +
            '<td style="padding:6px 8px">' + esc(nameMap[r.actor_id] || '—') + '</td>' +
            '<td style="padding:6px 8px">' + esc(nameMap[r.target_user_id] || '—') + '</td>' +
            '<td style="padding:6px 8px">' + esc(comp) + '</td>' +
            '<td style="padding:6px 8px">' + change + '</td>' +
          '</tr>';
        }).join('') +
      '</tbody></table>';
  };

  // ────────────────────────────────────────────────────────────
  // Invite-flow integration — when the admin opens the existing
  // "+ Invite user" modal, inject a preset selector so the new
  // staff member gets a sensible permission set on day one.
  //
  // The legacy invite modal stores into an in-memory `users` array
  // (it does NOT create a Supabase auth.users row), so applying a
  // preset at this step is best-effort — it will only take effect
  // once the new staff member is actually created in Supabase Auth
  // (separate flow). For now we stash the chosen preset key on
  // window.glPendingPresetByEmail so a future hook can use it.
  // ────────────────────────────────────────────────────────────
  window.glPendingPresetByEmail = window.glPendingPresetByEmail || {};

  function injectPresetSelectorIntoInviteModal(){
    var modal = document.getElementById('invite-user-modal');
    if(!modal || modal.querySelector('#inv-preset')) return;
    var roleRow = null;
    Array.prototype.forEach.call(modal.querySelectorAll('.flbl'), function(lbl){
      if((lbl.textContent||'').trim().toLowerCase() === 'role') roleRow = lbl.parentNode;
    });
    if(!roleRow) return;
    var presetOpts = Object.keys(ROLE_PRESETS).map(function(k){
      return '<option value="' + k + '">' + esc(ROLE_PRESETS[k].label) + '</option>';
    }).join('');
    var row = document.createElement('div');
    row.className = 'frow';
    row.innerHTML = '<div class="flbl">Permission preset</div>' +
      '<select class="fsel" id="inv-preset">' +
        '<option value="">— Use defaults —</option>' + presetOpts +
      '</select>' +
      '<div style="font-size:10px;color:var(--muted);margin-top:4px">Applied after the user is created. Overwrites default per-component access.</div>';
    roleRow.parentNode.insertBefore(row, roleRow.nextSibling);

    // Wrap the Create User button so we can capture the preset choice.
    var createBtn = modal.querySelector('button.cbtn.pri');
    if(createBtn && !createBtn.__glPresetHooked){
      createBtn.__glPresetHooked = true;
      var origHandler = createBtn.getAttribute('onclick');
      createBtn.removeAttribute('onclick');
      createBtn.addEventListener('click', function(){
        var emailEl = document.getElementById('inv-email');
        var presetEl = document.getElementById('inv-preset');
        var email = (emailEl && emailEl.value || '').trim().toLowerCase();
        var preset = presetEl && presetEl.value || '';
        if(email && preset) window.glPendingPresetByEmail[email] = preset;
        try {
          if(origHandler){
            // Re-invoke the original inline handler text
            new Function(origHandler).call(createBtn);
          } else if(typeof window.createInvitedUser === 'function'){
            window.createInvitedUser();
          }
        } catch(e){ console.warn('[GL preset hook] handler threw', e); }
      });
    }
  }

  // Watch for the invite modal appearing
  if(typeof MutationObserver !== 'undefined'){
    new MutationObserver(function(){
      if(document.getElementById('invite-user-modal')) injectPresetSelectorIntoInviteModal();
    }).observe(document.body, { childList: true, subtree: true });
  }

  console.log('[GL] permissions module loaded (page + action gates + visual hiding + audit + invite preset)');
}());
