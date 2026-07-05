/* ============================================================
   SOFT REFRESH BUTTON + PAGE MEMORY
   - Injects a "↻ Refresh" button into the CRM top bar
   - Clicking it reloads Supabase data in-place and re-renders
     the current page — no full page reload, user stays put.
   - Every cNav() call saves the active page to sessionStorage
     so F5/hard-refresh can restore it when the user re-opens
     the Admin panel.
   ============================================================ */
(function(){
  'use strict';

  var PAGE_KEY = 'gl_last_crm_page';

  // ── 1. Persist active page on every navigation ──
  window.GL_HOOKS.registerNavHook(function(page){
    if(page) try{ sessionStorage.setItem(PAGE_KEY, page); }catch(e){}
  });

  // ── 2. Restore saved page after F5 → re-login ──
  window.GL_HOOKS.registerLoginHook(function(){
    setTimeout(function() {
      try {
        var saved = sessionStorage.getItem(PAGE_KEY);
        if (!saved || saved === 'dashboard') return;
        var navEl = null;
        document.querySelectorAll('.cni').forEach(function(n) {
          var oc = n.getAttribute('onclick') || '';
          if (oc.indexOf("'" + saved + "'") !== -1) navEl = n;
        });
        window.cNav(saved, navEl);
      } catch(e) {}
    }, 300);
  });

  // ── 3. Soft-refresh: reload Supabase data, re-render current page ──
  function softRefresh(btn) {
    if (!window.currentUser) { location.reload(); return; }

    // Determine which page is active right now
    var activePg = document.querySelector('.cpg.act');
    var page = activePg ? activePg.id.replace('cpg-', '') : 'dashboard';

    // Save it so F5-restore still works
    try { sessionStorage.setItem(PAGE_KEY, page); } catch(e) {}

    // Visual feedback on the button
    var orig = btn.textContent;
    btn.textContent = '⏳';
    btn.disabled = true;

    // Re-render helpers (per-page, no network needed for static pages)
    function rerender(loadedData) {
      try {
        var fns = {
          dashboard:        function(){ if(typeof renderDash==='function') renderDash(); },
          clients:          function(){ if(typeof renderClients==='function') renderClients(); },
          pipeline:         function(){ if(typeof renderKanban==='function') renderKanban(); },
          invoices:         function(){ if(typeof renderInvoices==='function') renderInvoices(); },
          referrals:        function(){ if(typeof renderReferrals==='function') renderReferrals(); },
          referrers:        function(){ if(typeof renderReferrers==='function') renderReferrers(); },
          activity:         function(){ if(typeof renderActivity==='function') renderActivity(); },
          calendar:         function(){ if(typeof renderCal==='function') renderCal('general'); },
          'production-cal': function(){ if(typeof renderCal==='function') renderCal('production'); },
          tasks:            function(){ if(typeof renderTasks==='function') renderTasks(); },
          documents:        function(){ if(typeof renderDocs==='function') renderDocs(); },
          inventory:        function(){ if(typeof renderInventory==='function') renderInventory(); },
          announcements:    function(){ if(typeof renderAnnouncements==='function') renderAnnouncements(); },
          customers:        function(){ if(typeof renderCustomerLogins==='function') renderCustomerLogins(); },
          users:            function(){ if(typeof renderUsers==='function') renderUsers(); }
        };
        var fn = fns[page];
        if (fn) fn();
      } catch(e) { console.warn('[GL soft-refresh] rerender threw', e); }

      btn.textContent = '✓';
      setTimeout(function(){ btn.textContent = orig; btn.disabled = false; }, 1200);
      if (typeof addNotification === 'function') {
        addNotification('Data refreshed', 'All records reloaded from the database.', 'success');
      }
    }

    // Load fresh data from Supabase then re-render
    if (typeof window.loadSupabaseData === 'function') {
      window.__glDataLoaded = false; // force re-fetch
      window.loadSupabaseData()
        .then(rerender)
        .catch(function(e) {
          console.warn('[GL soft-refresh] loadSupabaseData failed', e);
          btn.textContent = orig;
          btn.disabled = false;
          if (typeof addNotification === 'function') {
            addNotification('Refresh failed', 'Could not reload data. Check your connection.', 'error');
          }
        });
    } else {
      rerender();
    }
  }

  // ── 4. Inject the Refresh button into the CRM top bar ──────────
  function injectRefreshBtn() {
    var crm = document.getElementById('crm-top');
    if (!crm || crm.querySelector('#gl-refresh-btn')) return;
    var usrRow = crm.querySelector('.crm-usr');
    if (!usrRow) return;

    var btn = document.createElement('button');
    btn.id  = 'gl-refresh-btn';
    btn.className = 'cbtn';
    btn.style.cssText = 'font-size:10px;padding:4px 10px;margin-left:4px;' +
      'background:rgba(0,229,192,.08);border:1px solid rgba(0,229,192,.25);color:var(--teal)';
    btn.title = 'Reload all data and stay on this page';
    btn.textContent = '↻ Refresh';
    btn.onclick = function() { softRefresh(btn); };

    var signOutBtn = null;
    usrRow.querySelectorAll('.cbtn').forEach(function(b) {
      if ((b.textContent || '').trim().toLowerCase().includes('sign out')) signOutBtn = b;
    });
    if (signOutBtn) usrRow.insertBefore(btn, signOutBtn);
    else usrRow.appendChild(btn);
  }

  if (document.readyState !== 'loading') injectRefreshBtn();
  else document.addEventListener('DOMContentLoaded', injectRefreshBtn);

  console.log('[GL] Soft refresh + page restore v2 loaded');
}());
