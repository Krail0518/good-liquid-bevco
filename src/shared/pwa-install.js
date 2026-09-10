/*
 * pwa-install.js — extracted from crm-index-core.js (GL-037).
 *
 * Loads AFTER crm-index-core.js and must stay a CLASSIC script — no defer,
 * async or type="module". Its top-level declarations become window
 * properties, which is how the inline on* handlers in index.html resolve
 * them. A module-scoped version would leave those handlers dead with no
 * error to show for it.
 *
 * index.html serves three audiences from one page: the public marketing
 * site, the staff CRM, and (?portal=1) the customer portal. The install
 * banner advertises the STAFF CRM, so it must never appear to the other
 * two. beforeinstallprompt fires on page load, long before anyone signs
 * in, so the prompt is captured immediately and the banner is held back
 * until #crm-panel opens — which happens only on staff sign-in, and never
 * in portal mode (that replaces document.body.innerHTML outright).
 *
 * Declares: showInstallBanner, installPWA
 */
/* ═══════════════════════════════════════════
   PWA INSTALL PROMPT
═══════════════════════════════════════════ */
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  if(staffCrmIsOpen()) showInstallBanner();
  else waitForStaffCrm();
});

/* The staff CRM is open iff #crm-panel carries .show — see loginUser() in
   crm-index-core.js. On the public marketing page the element exists but
   never gets the class; in portal mode it does not exist at all. */
function staffCrmIsOpen(){
  const panel = document.getElementById('crm-panel');
  return !!panel && panel.classList.contains('show');
}

let staffCrmWatcher = null;
function waitForStaffCrm(){
  if(staffCrmWatcher) return;
  const panel = document.getElementById('crm-panel');
  if(!panel) return;                       // portal mode — nothing to wait for
  staffCrmWatcher = new MutationObserver(() => {
    if(!staffCrmIsOpen()) return;
    staffCrmWatcher.disconnect();
    staffCrmWatcher = null;
    showInstallBanner();
  });
  staffCrmWatcher.observe(panel, {attributes:true, attributeFilter:['class']});
}

function showInstallBanner(){
  if(!deferredPrompt) return;
  if(!staffCrmIsOpen()) return;
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
  deferredPrompt = null;
  if(staffCrmWatcher){ staffCrmWatcher.disconnect(); staffCrmWatcher = null; }
  document.getElementById('pwa-install-banner')?.remove();
  if(staffCrmIsOpen()){
    addNotification('📱 App installed!', 'Good Liquid CRM is now on your home screen', 'success');
  }
});
