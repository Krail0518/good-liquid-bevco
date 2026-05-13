/* Good Liquid CRM — Login + Feature Patch
   Loaded after main script to ensure all functions are available */

(function() {
  'use strict';

  // ── loginUser ─────────────────────────────
  window.loginUser = function(u) {
    window.currentUser = u;
    u.lastLogin = 'Just now';
    if (typeof closePw === 'function') closePw();

    const avInit = document.getElementById('crm-av-init');
    const userName = document.getElementById('crm-user-name');
    const rb = document.getElementById('crm-role-badge');

    if (avInit) avInit.textContent = u.initials || u.name[0].toUpperCase();
    if (userName) userName.textContent = u.name;
    if (rb) {
      rb.textContent = u.role.charAt(0).toUpperCase() + u.role.slice(1);
      rb.style.cssText = u.role === 'admin'
        ? 'background:rgba(245,200,66,.12);color:#d4a200;border:1px solid rgba(245,200,66,.25)'
        : u.role === 'sales'
          ? 'background:rgba(26,111,255,.12);color:#6b9fff;border:1px solid rgba(26,111,255,.25)'
          : 'background:rgba(255,255,255,.06);color:#6b87ad';
    }

    if (u.role === 'admin') {
      const navUsers = document.getElementById('nav-users');
      const navCust = document.getElementById('nav-customers');
      if (navUsers) navUsers.style.display = 'flex';
      if (navCust) navCust.style.display = 'flex';
    }

    const panel = document.getElementById('crm-panel');
    if (panel) panel.classList.add('show');
    document.body.style.overflow = 'hidden';

    if (!window.crmInited && typeof initCRM === 'function') initCRM();
    if (typeof addAIToolbar === 'function') addAIToolbar();
    if (typeof addNotifBadge === 'function') addNotifBadge();
    if (typeof checkStaleDeals === 'function') checkStaleDeals();
    if (typeof loadNotifications === 'function') loadNotifications();
  };

  // ── checkPw — Supabase REST + local fallback ──
  window.checkPw = async function() {
    const emailEl = document.getElementById('pw-email');
    const pwEl    = document.getElementById('pw-input');
    const err     = document.getElementById('pw-err');
    if (!emailEl || !pwEl) return;

    const email = emailEl.value.trim().toLowerCase();
    const pw    = pwEl.value;
    if (err) err.style.display = 'none';

    function showError() {
      if (err) err.style.display = 'block';
      pwEl.classList.add('wrong');
      setTimeout(() => pwEl.classList.remove('wrong'), 500);
    }

    // 1. Customer portal logins
    if (window.customerLogins) {
      const cust = window.customerLogins.find(
        c => c.email.toLowerCase() === email && c.password === pw
      );
      if (cust) {
        window.currentPortalUser = cust;
        if (typeof closePw === 'function') closePw();
        if (typeof openCustomerPortal === 'function') openCustomerPortal(cust);
        return;
      }
    }

    // 2. Supabase crm_users via direct REST (no SDK auth calls)
    const sbKey = localStorage.getItem('gl_supabase_key');
    if (sbKey) {
      try {
        const res = await fetch(
          'https://ufjkeqmxwuyhbqyugcgg.supabase.co/rest/v1/crm_users'
          + '?email=eq.' + encodeURIComponent(email)
          + '&select=password_hash',
          {
            headers: {
              'apikey': sbKey,
              'Authorization': 'Bearer ' + sbKey
            }
          }
        );
        const rows = await res.json();
        if (Array.isArray(rows) && rows.length > 0 && rows[0].password_hash) {
          const decoded = atob(rows[0].password_hash);
          if (decoded !== pw) { showError(); return; }
          const u = (window.users || []).find(x => x.email.toLowerCase() === email);
          if (u) { window.loginUser(u); return; }
          // User in Supabase but not local array — create on the fly
          window.loginUser({
            id: 'sb' + Date.now(), name: email.split('@')[0],
            email, password: pw, role: 'sales',
            initials: email[0].toUpperCase(), color: '#1a6fff',
            tc: '#fff', status: 'active', lastLogin: 'Just now'
          });
          return;
        }
      } catch (e) {
        console.log('[GL] Supabase REST error:', e.message);
      }
    }

    // 3. Local users array fallback
    const u = (window.users || []).find(
      x => x.email.toLowerCase() === email && x.password === pw && x.status === 'active'
    );
    if (!u) { showError(); return; }
    window.loginUser(u);
  };

  // ── syncPasswordToSupabase — direct REST ──
  window.syncPasswordToSupabase = async function(email, newPw) {
    const sbKey = localStorage.getItem('gl_supabase_key');
    if (!sbKey) return;
    try {
      await fetch('https://ufjkeqmxwuyhbqyugcgg.supabase.co/rest/v1/crm_users', {
        method: 'POST',
        headers: {
          'apikey': sbKey,
          'Authorization': 'Bearer ' + sbKey,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates'
        },
        body: JSON.stringify({
          email: email.toLowerCase(),
          password_hash: btoa(newPw),
          updated_at: new Date().toISOString()
        })
      });
      console.log('[GL] Password synced:', email);
    } catch (e) {
      console.log('[GL] Sync error:', e.message);
    }
  };

  console.log('[GL] fix.js loaded — loginUser, checkPw, syncPasswordToSupabase patched');

})();
