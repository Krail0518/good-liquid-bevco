/*
 * pwa-install.js — extracted from crm-index-core.js (GL-037).
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
 * Declares: isStaffCrmOpen, maybeShowInstallBanner, showInstallBanner, installPWA
 *
 * STAFF ONLY. index.html serves three audiences at once: the public marketing
 * site, the customer portal (?portal=1) and the staff CRM. This banner used to
 * mount the moment Chrome fired beforeinstallprompt, so strangers and portal
 * customers were repeatedly nudged to install a CRM they can never sign into.
 * We now stash the event and only offer the banner once the staff CRM shell is
 * open. Same shape as the row-level-security note in CLAUDE.md: a behaviour
 * written when there was only one kind of user here, never revisited once the
 * customer portal shipped.
 */
/* ═══════════════════════════════════════════
   PWA INSTALL PROMPT
═══════════════════════════════════════════ */
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  maybeShowInstallBanner();
});

/* The staff CRM shell. #crm-panel gets .show from loginUser (both the core
   copy and the auth.js override) and from the sign-in handler, and from
   nothing else. The marketing site never sets it, and the customer portal
   replaces document.body outright, so the element is not even present there. */
function isStaffCrmOpen(){
  const p = document.getElementById('crm-panel');
  return !!(p && p.classList.contains('show'));
}

/* Called both when the browser offers the prompt and when staff sign in,
   because either can happen first. A no-op unless both have. */
function maybeShowInstallBanner(){
  if(!deferredPrompt) return;
  showInstallBanner();
}

function showInstallBanner(){
  if(!isStaffCrmOpen()) return;
  if(document.getElementById('pwa-install-banner')) return;
  const banner = document.createElement('div');
  banner.id = 'pwa-install-banner';
  banner.style.cssText = 'position:fixed;bottom:80px;right:16px;left:16px;max-width:360px;margin:0 auto;background:#142238;border:1px solid rgba(0,229,192,.25);border-radius:14px;padding:14px 16px;z-index:600;display:flex;align-items:center;gap:12px;box-shadow:0 8px 32px rgba(0,0,0,.5)';
  banner.innerHTML = `
    <div style="font-size:28px">📱</div>
    <div style="flex:1">
      <div style="font-size:13px;font-weight:700;color:var(--white)">Install Good Liquid CRM</div>
      <div style="font-size:11px;color:var(--muted)">Add to your home screen for quick access</div>
    </div>
    <div style="display:flex;gap:6px">
      <button data-gl-action="installPWA" style="padding:7px 14px;background:var(--teal);color:var(--ink);border:none;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer">Install</button>
      <button data-gl-close="#pwa-install-banner" style="padding:7px 10px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:8px;font-size:12px;color:var(--muted);cursor:pointer">✕</button>
    </div>`;
  document.body.appendChild(banner);
}

async function installPWA(){
  if(!deferredPrompt) return;
  deferredPrompt.prompt();
  const result = await deferredPrompt.userChoice;
  deferredPrompt = null;
  document.getElementById('pwa-install-banner')?.remove();
  if(result.outcome === 'accepted'){
    addNotification('📱 App installed!', 'Good Liquid CRM added to home screen', 'success');
  }
}

window.addEventListener('appinstalled', () => {
  document.getElementById('pwa-install-banner')?.remove();
  addNotification('📱 App installed!', 'Good Liquid CRM is now on your home screen', 'success');
});
