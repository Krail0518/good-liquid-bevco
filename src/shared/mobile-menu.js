/*
 * mobile-menu.js — extracted from crm-index-core.js (GL-037).
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
 * Declares: toggleMobileMenu, toggleCRMSidebar, crmBnavSet
 */
/* ═══════════════════════════════════════════
   MOBILE MENU FUNCTIONS
═══════════════════════════════════════════ */
function toggleMobileMenu(){
  const nav = document.getElementById('nav-links-list');
  const btn = document.getElementById('mobile-menu-btn');
  if(!nav) return;
  nav.classList.toggle('mobile-open');
  btn.textContent = nav.classList.contains('mobile-open') ? '✕' : '☰';
}

// Close menu when a nav link is clicked
document.addEventListener('click', function(e){
  if(e.target.closest('#nav-links-list a')){
    const nav = document.getElementById('nav-links-list');
    const btn = document.getElementById('mobile-menu-btn');
    if(nav) nav.classList.remove('mobile-open');
    if(btn) btn.textContent = '☰';
  }
});

function toggleCRMSidebar(){
  const nav = document.querySelector('.cnav');
  const overlay = document.getElementById('cnav-overlay');
  if(!nav) return;
  nav.classList.toggle('mobile-open');
  if(overlay) overlay.classList.toggle('show');
}

function crmBnavSet(el){
  document.querySelectorAll('.crm-bnav-item').forEach(function(b){ b.classList.remove('act'); });
  if(el) el.classList.add('act');
}

// Close CRM sidebar when a nav item is clicked on mobile
document.addEventListener('click', function(e){
  if(e.target.closest('.cni') && window.innerWidth <= 768){
    const nav = document.querySelector('.cnav');
    const overlay = document.getElementById('cnav-overlay');
    if(nav) nav.classList.remove('mobile-open');
    if(overlay) overlay.classList.remove('show');
  }
});
