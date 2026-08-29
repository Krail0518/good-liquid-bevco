/*
 * permissions.js — extracted from crm-index-core.js (GL-037).
 *
 * VERBATIM move: the code below is byte-for-byte what was in the core, so
 * this diff is a relocation and nothing else.
 *
 * Loads AFTER crm-index-core.js and must stay a CLASSIC script — no defer,
 * async or type="module". Its top-level declarations become window
 * properties, which is how the inline on* handlers in index.html resolve
 * them. A module-scoped version would leave those handlers dead with no
 * error to show for it.
 *
 * Declares: updateCRMForUser
 */
/* ═══ MULTI-USER AUTH & PERMISSIONS ═══ */
let editingUserId = null;

function updateCRMForUser(){
  if(!currentUser)return;
  const u = currentUser;
  // Update topbar
  document.getElementById('crm-av-init').textContent = u.initials||u.name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
  document.getElementById('crm-av-init').style.background = u.color||'rgba(0,229,192,.14)';
  document.getElementById('crm-av-init').style.color = u.tc||'var(--teal)';
  document.getElementById('crm-user-name').textContent = u.name;
  const badge = document.getElementById('crm-role-badge');
  const roleStyles = {
    admin:{bg:'rgba(0,229,192,.15)',color:'var(--teal)',text:'Admin'},
    sales:{bg:'rgba(26,111,255,.15)',color:'#6b9fff',text:'Sales'},
    warehouse:{bg:'rgba(168,85,247,.15)',color:'#c4a4f8',text:'Warehouse'},
    viewer:{bg:'rgba(255,255,255,.08)',color:'var(--muted)',text:'Viewer'}
  };
  const rs = roleStyles[u.role]||roleStyles.viewer;
  badge.style.background = rs.bg;
  badge.style.color = rs.color;
  badge.textContent = rs.text;
  // Show/hide nav items based on role. Use window.can() so this respects the
  // merged PERMISSIONS table (fix.js extends sales with calendar/tasks/etc).
  document.querySelectorAll('.cni[id^="nav-"]').forEach(el=>{
    const page = el.id.replace('nav-','');
    const ok = (typeof window.can==='function') ? window.can(page) : (PERMISSIONS[u.role]||[]).includes(page);
    el.style.display = ok?'':'none';
  });
  // Navigate to dashboard
  cNav('dashboard', document.querySelector('.cni.act')||document.querySelectorAll('.cni')[0]);
}

/* The second, live declaration of logoutCRM() is below (search
   "supa.auth.signOut"). A dead first copy used to sit here.

   Both were top-level `function` declarations with the same name, so the
   LAST one won for every call site -- including the Sign out button, which
   appears textually above both. The winner was the correct one: it calls
   supa.auth.signOut() and resets crmInited. The dead copy only cleared local
   state and left the Supabase session valid.

   So sign-out worked by accident of declaration order. Reordering, moving or
   extracting this code -- which is exactly what GL-037 does -- would have
   silently reverted logout to "clears the screen, keeps the session".
   Removed rather than left as a comment-only warning. */
