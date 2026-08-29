/*
 * crm-index-core.js — the core CRM script, lifted verbatim out of index.html.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * This was a single ~9,300-line inline <script> in index.html. GL-037 calls
 * for moving that into modules one capability at a time; this is the first
 * and structural step, and it is deliberately a VERBATIM move. Not one
 * character of the code changed, so the diff is a pure relocation and
 * anything that breaks is the move itself rather than an edit smuggled
 * alongside it.
 *
 * Semantics are preserved because a classic external script in the same
 * document position behaves identically to an inline one:
 *
 *   - execution order is document order for both, and the <script src> that
 *     replaced it sits at the exact line the inline block occupied
 *   - top-level `function` and `var` still become window properties, so the
 *     364 inline on* handlers in index.html still resolve
 *   - top-level `const`/`let` still share one global lexical scope across
 *     classic scripts, so the 76 declared here stay visible to the other
 *     57 crm-*.js files exactly as before
 *
 * The one hazard checked before moving was document.write, which behaves
 * differently for a deferred script. The single occurrence writes into a
 * popup (`w.document.write`), not this document, so it is unaffected.
 *
 * Do NOT add defer or async to the tag that loads this. Either would move it
 * after the scripts that currently follow, and the ordering the whole page
 * depends on would change silently.
 *
 * Note for whoever continues GL-037: the comment further down reading "we
 * cannot embed a <script> inside the template literal" describes a
 * constraint of having been inline. It no longer applies, but the code was
 * left exactly as it was so this commit stays a pure move.
 */

/* ── Capabilities extracted from this file (GL-037) ──────────────────
 *
 * These load AFTER this file, as classic scripts, so their top-level
 * declarations are still window properties and the inline on* handlers in
 * index.html still resolve. This file calls into several of them, always at
 * runtime (a template literal or a click), never at load time.
 *
 *   /src/modules/customers/client-notes.js
 *   /src/modules/customers/document-storage.js
 *   /src/modules/customers/email-templates.js
 *   /src/modules/customers/health-score-ai.js
 *   /src/modules/customers/health-score.js
 *   /src/modules/customers/tags.js
 *   /src/modules/invoicing/ar-aging.js
 *   /src/modules/invoicing/follow-up.js
 *   /src/modules/invoicing/pay-link.js
 *   /src/modules/pipeline/multi-pipeline.js
 *   /src/modules/pipeline/revenue-forecast.js
 *   /src/modules/pipeline/stale-deals.js
 *   /src/modules/production/ai-optimizer.js
 *   /src/modules/production/time-report.js
 *   /src/modules/production/time-tracking.js
 *   /src/modules/production/tour-booking.js
 *   /src/modules/shared/ai-chat.js
 *   /src/modules/shared/ai-drafts.js
 *   /src/modules/shared/ai-meeting-notes.js
 *   /src/modules/shared/calendar.js
 *   /src/modules/shared/mobile-menu.js
 *   /src/modules/shared/notifications.js
 *   /src/modules/shared/password-change.js
 *   /src/modules/shared/tasks.js
 *
 * Scattered "moved to" comments used to mark each removal. Later
 * extractions swallowed them — a boundary running to the next banner takes
 * the previous pointer with it — and eight ended up inside module files,
 * where they read as if the module had something to do with the section
 * named. One manifest here cannot drift that way.
 * ─────────────────────────────────────────────────────────────────── */
/* ── Global HTML escaper — used everywhere DB fields are interpolated into innerHTML ── */
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}

/* ═══ DATA ═══ */
/* All arrays are bridged to window so fix.js and index.html share the same identity.
   Never reassign window.X via .filter()/etc — mutate in place (splice/push/unshift). */
/* Staff users: empty seed. Real users come from Supabase `profiles` via
   loadSupabaseData() on login. Hardcoded names were removed so editing a
   role/name in the database is the single source of truth. */
let users=window.users=[];
let currentUser=null;
/* Bridged to window so fix.js can override/extend and index.html's filter
   (renderUsers area) reads the same merged table. fix.js mutates this in place. */
const PERMISSIONS=window.PERMISSIONS={
  admin:['dashboard','clients','pipeline','invoices','newinv','referrals','referrers','activity','users'],
  sales:['dashboard','clients','pipeline','invoices','newinv','referrals','referrers','activity'],
  warehouse:['dashboard','production-runs','production-cal','inventory','cip','gmp','defects','yield','samples','tasks','announcements'],
  viewer:['dashboard','clients','announcements']
};
function can(page){return currentUser&&PERMISSIONS[currentUser.role]?.includes(page)}
function canAction(a){
  if(!currentUser)return false;
  const map={
    create_invoice:['admin','sales'],mark_paid:['admin'],pay_commission:['admin'],
    manage_users:['admin'],add_referral:['admin','sales'],deactivate_user:['admin']
  };
  return map[a]?.includes(currentUser.role)||false;
}
const GL={name:'Good Liquid Bev Co',addr:'2011 51st Ave E, Unit 100',city:'Palmetto, FL 34221',email:'Mike@GoodLiquid.com'};

/* Referrers / Referrals / Clients: empty seeds. Real records come from
   Supabase via loadSupabaseData(), or from the CRM "Add" buttons. */
let referrers=window.referrers=[];
let referrals=window.referrals=[];
let clients=window.clients=[];

let invoices=window.invoices=[];

/* Deals: empty seed. Real deals come from Supabase via loadSupabaseData(),
   or from "Add Deal" / contact form. Bridged to window so fix.js can share. */
let deals=window.deals={'Prospecting':[],'Proposal':[],'Negotiation':[],'Closed Won':[],'Closed Lost':[]};

/* Activities: source of truth is public.activity_feed in Supabase.
   The in-memory array is the cached recent slice for the dashboard
   renderer. Every `activities.unshift({...}); saveActivities()` site
   in the legacy code now writes through to the DB via the override
   below — the local array is kept warm for renderers that read
   synchronously. */
let activities = window.activities = [];

async function glActivitiesBackfill(){
  try {
    if(localStorage.getItem('gl_activities_migrated') === '1') return;
    if(!window.supa || !window.currentUser) return;
    const blob = localStorage.getItem('gl_activities');
    if(!blob){ localStorage.setItem('gl_activities_migrated','1'); return; }
    let legacy = []; try { legacy = JSON.parse(blob) || []; } catch(_e){ return; }
    if(!legacy.length){ localStorage.setItem('gl_activities_migrated','1'); return; }
    const nowMs = Date.now();
    const rows = legacy.slice(0, 100).map((a, i) => ({
      kind:        a.type || 'note',
      icon:        a.icon || null,
      name:        String(a.name || '').slice(0, 300),
      detail:      a.detail || null,
      actor_email: (window.currentUser && window.currentUser.email) || null,
      client_id:   /^[0-9a-f-]{36}$/i.test(a.clientId||'') ? a.clientId : null,
      created_at:  new Date(nowMs - i*1000).toISOString()
    }));
    const r = await window.supa.from('activity_feed').insert(rows);
    if(r.error){ console.warn('[GL] activities backfill failed', r.error.message); return; }
    localStorage.setItem('gl_activities_migrated','1');
  } catch(e){ console.warn('[GL] activities backfill threw', e); }
}

async function loadActivities(){
  if(!window.supa){ activities = window.activities = []; return; }
  await glActivitiesBackfill();
  const r = await window.supa.from('activity_feed')
    .select('id, kind, icon, name, detail, client_id, created_at')
    .order('created_at', { ascending: false })
    .limit(100);
  if(r.error){ console.warn('[GL] loadActivities failed', r.error.message); return; }
  activities = window.activities = (r.data || []).map(a => ({
    type:   a.kind,
    icon:   a.icon,
    name:   a.name,
    detail: a.detail,
    time:   timeAgo(new Date(a.created_at)),
    clientId: a.client_id
  }));
}

// saveActivities is now a thin write-through: the legacy code calls
// activities.unshift({...}); saveActivities() — the unshift updates
// the in-memory cache; this fires off a single INSERT for the new
// head item. Keeps the array capped at 100.
function saveActivities(){
  if(activities.length > 100) activities = activities.slice(0, 100);
  if(!window.supa || !window.currentUser) return;
  const head = activities[0];
  if(!head || head._persisted) return;
  head._persisted = true;
  window.supa.from('activity_feed').insert([{
    kind:        head.type || 'note',
    icon:        head.icon || null,
    name:        String(head.name || '').slice(0, 300),
    detail:      head.detail || null,
    actor_email: (window.currentUser && window.currentUser.email) || null,
    client_id:   /^[0-9a-f-]{36}$/i.test(head.clientId||'') ? head.clientId : null
  }]).then(r => { if(r.error) console.warn('[GL] activity write failed', r.error.message); });
}

const PRICING={
  canning:{tiers:[
    {min:200,max:339,'12std':.48,'12slk':.48,'16std':.58},
    {min:340,max:500,'12std':.43,'12slk':.43,'16std':.53},
    {min:501,max:999,'12std':.38,'12slk':.38,'16std':.48},
    {min:1000,max:2499,'12std':.35,'12slk':.35,'16std':.45},
    {min:2500,max:4999,'12std':.31,'12slk':.31,'16std':.41},
    {min:5000,max:9e9,'12std':.28,'12slk':.28,'16std':.38},
  ]},
  bottling:{tiers:[
    {cases:220,perBtl:2.16},{cases:660,perBtl:1.91},{cases:1320,perBtl:1.58},
    {cases:2640,perBtl:1.41},{cases:5280,perBtl:1.12},
  ]}
};

/* ═══ WEBSITE JS ═══ */
const cursor=document.getElementById('cursor');
document.addEventListener('mousemove',e=>{cursor.style.opacity='1';cursor.style.left=e.clientX+'px';cursor.style.top=e.clientY+'px'});
document.querySelectorAll('a,button,.sv,.phc,.sc,.adbox,.pni,.tc,.fac-card').forEach(el=>{
  el.addEventListener('mouseenter',()=>cursor.classList.add('big'));
  el.addEventListener('mouseleave',()=>cursor.classList.remove('big'));
});
window.addEventListener('scroll',()=>{
  // Null guard — portal mode (?portal=1) replaces document.body.innerHTML,
  // removing #main-nav. Without this check, every scroll event throws
  // "Cannot read properties of null (reading 'classList')" — Mike saw
  // 28 of these in a 1.5s portal session during the Playwright runtime
  // audit. The listener stays attached because we never tear it down.
  const nav = document.getElementById('main-nav');
  if(nav) nav.classList.toggle('scrolled', window.scrollY > 60);
});

const cv=document.getElementById('hero-canvas');
const ctx=cv.getContext('2d');
let W,H,bubs=[];
function rsz(){W=cv.width=innerWidth;H=cv.height=innerHeight;initB()}
function initB(){bubs=[];for(let i=0;i<80;i++)bubs.push({x:Math.random()*W,y:Math.random()*H,r:Math.random()*3+1,vx:(Math.random()-.5)*.4,vy:(Math.random()-.5)*.4,o:Math.random()*.5+.1,c:Math.random()>.5?'0,229,192':'26,111,255'})}
function drawC(){
  ctx.clearRect(0,0,W,H);
  bubs.forEach(b=>{ctx.beginPath();ctx.arc(b.x,b.y,b.r,0,Math.PI*2);ctx.fillStyle=`rgba(${b.c},${b.o})`;ctx.fill();b.x+=b.vx;b.y+=b.vy;if(b.x<-10)b.x=W+10;if(b.x>W+10)b.x=-10;if(b.y<-10)b.y=H+10;if(b.y>H+10)b.y=-10});
  bubs.forEach((b,i)=>bubs.slice(i+1).forEach(b2=>{const dx=b.x-b2.x,dy=b.y-b2.y,d=Math.sqrt(dx*dx+dy*dy);if(d<120){ctx.beginPath();ctx.moveTo(b.x,b.y);ctx.lineTo(b2.x,b2.y);ctx.strokeStyle=`rgba(0,229,192,${(1-d/120)*.08})`;ctx.lineWidth=.5;ctx.stroke()}}));
  requestAnimationFrame(drawC);
}
window.addEventListener('resize',rsz);rsz();drawC();
document.getElementById('hero').addEventListener('mousemove',e=>{bubs.forEach(b=>{const dx=e.clientX-b.x,dy=e.clientY-b.y,d=Math.sqrt(dx*dx+dy*dy);if(d<200){b.vx+=dx/d*.02;b.vy+=dy/d*.02;b.vx*=.98;b.vy*=.98}})});

const io=new IntersectionObserver(e=>{e.forEach(x=>{if(x.isIntersecting){x.target.classList.add('in');io.unobserve(x.target)}})},{threshold:.1});
document.querySelectorAll('.rv').forEach(el=>io.observe(el));

function showPanel(name,el){
  document.querySelectorAll('.panels .panel').forEach(p=>p.classList.remove('act'));
  document.querySelectorAll('.pni').forEach(p=>p.classList.remove('act'));
  document.getElementById('panel-'+name).classList.add('act');el.classList.add('act');
}

/* ═══ ADMIN GATE ═══ */
function openAdmin(){document.getElementById('pw-ov').classList.add('show');setTimeout(()=>document.getElementById('pw-input').focus(),100)}
function closePw(){document.getElementById('pw-ov').classList.remove('show');document.getElementById('pw-input').value='';document.getElementById('pw-err').style.display='none'}

/* ═══════════════════════════════════════
   SUPABASE AUTH + MULTI-USER LOGIN
   The live client is window.supa, created in fix.js.
═══════════════════════════════════════ */


/* ═══════════════════════════════════════════
   LOGIN USER — called after auth success
═══════════════════════════════════════════ */
window.loginUser = function loginUser(u){
  currentUser = u;
  u.lastLogin = 'Just now';
  closePw();
  document.getElementById('crm-av-init').textContent = u.initials;
  document.getElementById('crm-user-name').textContent = u.name;
  const rb = document.getElementById('crm-role-badge');
  rb.textContent = u.role.charAt(0).toUpperCase() + u.role.slice(1);
  rb.style.cssText = u.role==='admin'
    ? 'background:rgba(245,200,66,.12);color:#d4a200;border:1px solid rgba(245,200,66,.25)'
    : u.role==='sales'
      ? 'background:rgba(26,111,255,.12);color:#6b9fff;border:1px solid rgba(26,111,255,.25)'
      : 'background:rgba(255,255,255,.06);color:var(--muted)';
  if(u.role==='admin'){
    const nu = document.getElementById('nav-users');
    const nc = document.getElementById('nav-customers');
    if(nu) nu.style.display='flex';
    if(nc) nc.style.display='flex';
    const tbu = document.getElementById('top-btn-users');
    const tbd = document.getElementById('top-btn-digest');
    if(tbu) tbu.style.display='';
    if(tbd) tbd.style.display='';
  }
  document.getElementById('crm-panel').classList.add('show');
  document.body.style.overflow = 'hidden';
  if(!crmInited) initCRM();
  addAIToolbar();
  addNotifBadge();
  checkStaleDeals();
  loadNotifications();
}

// Dead checkPw v1 removed in Round 4 cleanup — overridden later in this file
// by the supa.auth.signInWithPassword version, which fix.js then wraps for the live login flow.


/* ═══════════════════════════════════════
   CUSTOMER PORTAL
═══════════════════════════════════════ */
/* DEPRECATED: the canonical Customer Logins list now lives in
   public.customer_users (read by the fix.js admin renderer that
   binds to #cpg-customers). The legacy gl_customer_logins blob
   was insecure — it stored plaintext temp passwords in
   localStorage — so this is hardcoded to empty and any old
   blob is wiped on first load. */
let customerLogins = [];
try { if(localStorage.getItem('gl_customer_logins')) localStorage.removeItem('gl_customer_logins'); } catch(_e){}
let currentPortalUser = null;

function saveCustomerLogins(){ /* DEPRECATED no-op — see customerLogins declaration above */ }

function openCustomerPortal(customer){
  const portal = document.getElementById('customer-portal');
  portal.classList.add('show');
  document.getElementById('portal-user-name').textContent = customer.name;
  document.getElementById('portal-greeting').textContent = 'Welcome, ' + customer.name.split(' ')[0] + '!';
  
  // Find client
  const client = clients.find(c=>c.email.toLowerCase()===customer.email.toLowerCase());
  
  // Company info
  const companyEl = document.getElementById('portal-company-info');
  if(client){
    companyEl.innerHTML=`<div style="font-weight:700;font-size:15px;color:var(--white);margin-bottom:8px">${esc(client.name)}</div>
      <div style="font-size:12px;color:var(--muted);line-height:2">
        <div>📧 ${esc(client.email)}</div>
        <div>🏷 Service: ${esc(client.service)}</div>
        <div>📊 Status: <span class="cbdg ${esc(client.status)}">${esc(client.status)}</span></div>
      </div>`;
  } else {
    companyEl.innerHTML=`<div style="font-size:13px;color:var(--muted)">Contact Mike to complete your company profile.</div>`;
  }
  
  // Production status
  const prodEl = document.getElementById('portal-production-info');
  const clientRuns = calEvents.filter(e=>e.type==='production'&&e.clientId===client?.id);
  if(clientRuns.length){
    prodEl.innerHTML=clientRuns.map(r=>`<div style="margin-bottom:12px;padding:11px;background:rgba(0,229,192,.05);border:1px solid rgba(0,229,192,.12);border-radius:8px">
      <div style="font-weight:700;font-size:13px;color:var(--white);margin-bottom:4px">${esc(r.title)}</div>
      <div style="font-size:11px;color:var(--muted)">📅 ${esc(r.date)} · ${esc(r.format||'')} · ${esc(r.qty||'')} cases</div>
      <div class="prod-status-bar ${esc(r.prodStatus||'scheduled')}"></div>
      <div style="font-size:10px;color:var(--teal);margin-top:5px;font-weight:600">${esc((r.prodStatus||'Scheduled').toUpperCase())}</div>
    </div>`).join('');
  } else {
    prodEl.innerHTML=`<div style="font-size:13px;color:var(--muted)">No production runs scheduled yet.</div>`;
  }
  
  // Invoices
  const clientInvoices = client ? invoices.filter(i=>i.client===client.id) : [];
  document.getElementById('portal-invoices').innerHTML = clientInvoices.length ?
    clientInvoices.map(i=>`<tr>
      <td style="font-family:var(--ff-mono);font-size:11px">${esc(i.id)}</td>
      <td>${esc(String(i.svc||'').substring(0,30))}…</td>
      <td style="font-weight:700">$${(window.fmtUsd?window.fmtUsd(i.amount):Number(i.amount||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}))}</td>
      <td>${esc(i.date)}</td>
      <td><span class="cbdg ${esc(i.status)}">${esc(i.status)}</span></td>
    </tr>`).join('') :
    '<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:20px">No invoices yet.</td></tr>';
}

function logoutPortal(){
  currentPortalUser=null;
  document.getElementById('customer-portal').classList.remove('show');
}

function sendOnboardingEmail(){
  const email = prompt('Customer email address to send onboarding link:');
  if(!email) return;
  const name = prompt('Customer name:');
  if(!name) return;
  window.glInviteCustomerLogin(null, name, email);
}

function renderCustomerLogins(){
  const el = document.getElementById('customer-logins-list');
  if(!el) return;
  if(!customerLogins.length){
    el.innerHTML='<div style="color:var(--muted);font-size:13px;padding:20px 0">No customer portal accounts yet. Send an onboarding email to create one.</div>';
    return;
  }
  el.innerHTML=`<table class="ctbl"><thead><tr><th>Name</th><th>Email</th><th>Created</th><th>Actions</th></tr></thead><tbody>${
    customerLogins.map(c=>`<tr>
      <td style="font-weight:600">${esc(c.name)}</td>
      <td style="font-family:var(--ff-mono);font-size:11px">${esc(c.email)}</td>
      <td style="font-size:11px;color:var(--muted)">${c.createdAt?c.createdAt.split('T')[0]:''}</td>
      <td><button class="cbtn red" style="font-size:10px;padding:3px 8px" onclick="removeCustomerLogin('${c.id}')">Remove</button></td>
    </tr>`).join('')
  }</tbody></table>`;
}

function removeCustomerLogin(id){
  if(!confirm('Remove this customer login?')) return;
  customerLogins=customerLogins.filter(c=>c.id!==id);
  saveCustomerLogins();
  renderCustomerLogins();
}

function exitCRM(){document.getElementById('crm-panel').classList.remove('show');document.body.style.overflow=''}

/* ═══ CRM CORE ═══ */
let crmInited=false,invFilter='all',invSearch='',currentInvId=window.currentInvId=null,selAddons={},refFilter='all';

function initCRM(){
  if(crmInited)return;crmInited=true;
  populateClientDropdown();
  document.getElementById('inv-date').value=new Date().toISOString().split('T')[0];
  svcChange();renderDash();renderClients();renderKanban();renderInvoices();renderActivity();
  renderReferrals();renderReferrers();buildCharts();populateReferrerSelects();renderUsers();
}

function cNav(page,el){
  // Run registered guards — any returning false blocks navigation
  var guards = (window.GL_HOOKS && window.GL_HOOKS._navGuards) || [];
  for(var _gi=0; _gi<guards.length; _gi++){
    if(guards[_gi](page,el) === false) return;
  }
  document.querySelectorAll('.cni').forEach(n=>n.classList.remove('act'));
  if(el)el.classList.add('act');
  document.querySelectorAll('.cpg').forEach(p=>p.classList.remove('act'));
  // Sync bottom nav tab highlight
  document.querySelectorAll('.crm-bnav-item[data-page]').forEach(function(b){
    b.classList.toggle('act', b.dataset.page === page);
  });
  // Some sidebar entries (Reports / Time Tracker / AI Settings) open modals
  // instead of pages and don't have a #cpg-X container. Guard so a stray
  // programmatic cNav() with one of those IDs doesn't crash the app.
  var pageEl=document.getElementById('cpg-'+page);
  if(pageEl)pageEl.classList.add('act');
  closeDetail();closeRefModal();closeAddReferrer();
  // Trigger section-specific renders so data appears immediately on navigation
  if(page==='activity' && typeof renderActivity==='function') renderActivity();
  if(page==='pipeline' && typeof renderKanban==='function') renderKanban();
  if(page==='invoices' && typeof renderInvoices==='function') renderInvoices();
  if(page==='clients' && typeof renderClients==='function') renderClients();
  if(page==='referrals' && typeof renderReferrals==='function') renderReferrals();
  // Run registered nav hooks
  var navHooks = (window.GL_HOOKS && window.GL_HOOKS._navHooks) || [];
  navHooks.forEach(function(fn){ try{ fn(page,el); }catch(e){ console.warn('[GL] nav hook threw',e); } });
}

/* Dashboard */
/* Effective invoice status — flips a `pending` invoice to `overdue` when
   its due_date is in the past. The DB column doesn't auto-update; this
   keeps the dashboard tallies honest without a cron job.
   Exposed on window so fix.js IIFEs can share the same logic. */
function effectiveInvoiceStatus(inv){
  if(!inv) return 'draft';
  if(inv.status === 'paid' || inv.status === 'overdue' || inv.status === 'draft') return inv.status;
  if(inv.status === 'pending' && inv.dueDate){
    const due = new Date(inv.dueDate);
    if(!isNaN(due.getTime()) && due < new Date()){ return 'overdue'; }
  }
  return inv.status || 'draft';
}
window.effectiveInvoiceStatus = effectiveInvoiceStatus;
/* Money formatter that keeps precision: full $ under $1K, 1-decimal K
   from $1K to $1M, 2-decimal M above. Avoids $2,312.50 → "$2K". */
function fmtMoneyShort(n){
  const v = Number(n) || 0;
  if(v < 1000) return '$' + Math.round(v).toLocaleString();
  if(v < 1000000) return '$' + (v/1000).toFixed(1) + 'K';
  return '$' + (v/1000000).toFixed(2) + 'M';
}

function renderDash(){
  // Morning brief, right on the home screen: the same ranked "who needs you"
  // list as the 🔥 Needs Attention board and the WhatsApp digest, loaded on open.
  if(typeof window.glRenderAttentionCard === 'function'){ try { window.glRenderAttentionCard('dash-attention'); } catch(e){} }
  const effective = invoices.map(i => ({ inv: i, eff: effectiveInvoiceStatus(i) }));
  const paid    = effective.filter(x => x.eff === 'paid'   ).reduce((a,x) => a + (Number(x.inv.amount)||0), 0);
  const pend    = effective.filter(x => x.eff === 'pending').reduce((a,x) => a + (Number(x.inv.amount)||0), 0);
  const over    = effective.filter(x => x.eff === 'overdue').reduce((a,x) => a + (Number(x.inv.amount)||0), 0);
  const pendCt  = effective.filter(x => x.eff === 'pending').length;
  const overCt  = effective.filter(x => x.eff === 'overdue').length;
  const act     = clients.filter(c=>c.status==='active').length;
  document.getElementById('dash-metrics').innerHTML=`
    <div class="cmc"><div class="cml">Total collected</div><div class="cmv">${fmtMoneyShort(paid)}</div><div class="cmd up">↑ YTD 2026</div></div>
    <div class="cmc"><div class="cml">Pending</div><div class="cmv">${fmtMoneyShort(pend)}</div><div class="cmd" style="color:var(--muted)">${pendCt} open</div></div>
    <div class="cmc"><div class="cml">Overdue</div><div class="cmv" style="color:#e74c3c">${fmtMoneyShort(over)}</div><div class="cmd dn">${overCt} invoice(s)</div></div>
    <div class="cmc"><div class="cml">Active brands</div><div class="cmv">${act}</div><div class="cmd up">+${clients.filter(c=>c.status==='lead').length} leads</div></div>`;
  document.getElementById('dash-act').innerHTML=activities.slice(0,5).map(a=>`<div class="act-item" onclick="actNav(${esc(JSON.stringify(a))})" style="cursor:pointer;border-radius:8px;padding:9px 8px;margin:0 -8px;transition:background 0.2s" onmouseenter="this.style.background='rgba(255,255,255,.04)'" onmouseleave="this.style.background='transparent'">
    <div class="act-ico ${a.type}">${a.icon}</div>
    <div style="flex:1"><div class="act-name">${esc(a.name)}</div><div class="act-detail">${esc(a.detail)}</div><div class="act-time">${a.time}</div></div>
    <div style="color:var(--teal);font-size:11px;opacity:0.6;flex-shrink:0">→</div>
  </div>`).join('');
  const stages=['Prospecting','Proposal','Negotiation','Closed Won'];
  const sc={'Prospecting':'#6b87ad','Proposal':'#1a6fff','Negotiation':'#f5c842','Closed Won':'#00c4a7','Closed Lost':'#e74c3c'};
  const cnts=stages.map(s=>deals[s]?.length||0);const maxC=Math.max(...cnts)||1;
  document.getElementById('pipe-snap').innerHTML=stages.map((s,i)=>`<div class="pb">
    <div class="pb-v">${cnts[i]}</div>
    <div class="pb-b" style="height:${Math.max(4,Math.round(cnts[i]/maxC*40))}px;background:${sc[s]}"></div>
    <div class="pb-l">${s.split(' ')[0]}</div>
  </div>`).join('');
  // Referral dashboard card
  const owed=referrals.filter(r=>r.status==='won').reduce((a,r)=>a+r.commAmount,0);
  const paidR=referrals.filter(r=>r.status==='paid').reduce((a,r)=>a+r.commAmount,0);
  document.getElementById('dash-ref').innerHTML=`
    <div style="display:flex;justify-content:space-between;margin-bottom:10px">
      <div><div style="font-size:10px;color:var(--muted)">Commissions owed</div><div style="font-family:var(--ff-disp);font-size:18px;color:var(--teal)">$${owed.toLocaleString()}</div></div>
      <div style="text-align:right"><div style="font-size:10px;color:var(--muted)">Paid YTD</div><div style="font-family:var(--ff-disp);font-size:18px;color:#1D9E75">$${paidR.toLocaleString()}</div></div>
    </div>
    ${referrers.map(r=>{
      const rRefs=referrals.filter(x=>x.referrerId===r.id);
      const rOwed=rRefs.filter(x=>x.status==='won').reduce((a,x)=>a+x.commAmount,0);
      return`<div style="display:flex;align-items:center;justify-content:space-between;padding:7px 0;border-bottom:1px solid rgba(255,255,255,.05)">
        <div style="display:flex;align-items:center;gap:7px">
          <div class="cavt" style="background:${r.color};color:${r.tc};width:22px;height:22px;font-size:8px">${esc(r.init)}</div>
          <span style="font-size:11px;color:var(--white)">${esc(r.name)}</span>
        </div>
        <div style="text-align:right">
          ${rOwed>0?`<span class="owed-tag">$${rOwed.toLocaleString()} owed</span>`:'<span style="font-size:10px;color:var(--muted)">$0 owed</span>'}
        </div>
      </div>`;
    }).join('')}
    <button class="cbtn" style="width:100%;margin-top:10px;font-size:11px" onclick="cNav('referrals',document.querySelectorAll('.cni')[7])">View all referrals →</button>`;
}

// ── GL Module Hook System ──────────────────────────────────────────────────
// Modules call window.GL_HOOKS.registerDashPatch(fn) instead of wrapping
// renderDash directly. Load-order-safe: patches register whenever their IIFE
// runs; the base fires them all in registration order.
(function(){
  window.GL_HOOKS = window.GL_HOOKS || {};
  window.GL_HOOKS._dashPatches = [];
  window.GL_HOOKS.registerDashPatch = function(fn){ window.GL_HOOKS._dashPatches.push(fn); };
  window.GL_HOOKS._loginHooks = [];
  window.GL_HOOKS.registerLoginHook = function(fn){ window.GL_HOOKS._loginHooks.push(fn); };
  window.GL_HOOKS._navGuards = [];
  window.GL_HOOKS.registerNavGuard = function(fn){ window.GL_HOOKS._navGuards.push(fn); };
  window.GL_HOOKS._navHooks = [];
  window.GL_HOOKS.registerNavHook = function(fn){ window.GL_HOOKS._navHooks.push(fn); };
  var _base = renderDash;
  renderDash = window.renderDash = function(){
    var r = _base.apply(this, arguments);
    window.GL_HOOKS._dashPatches.forEach(function(fn){ try{ fn(); }catch(e){ console.warn('[GL] dash patch threw',e); } });
    return r;
  };
})();

let chartInst=null;
function buildCharts(){
  // Guard: Chart.js CDN may not have loaded yet (slow network / CSP block).
  if(typeof Chart === 'undefined'){ console.warn('[GL] buildCharts: Chart.js not loaded, skipping'); return; }
  try {
  if(chartInst)chartInst.destroy();
  const gc='rgba(255,255,255,.07)',tc='rgba(107,135,173,.7)';
  document.getElementById('rev-legend').innerHTML=
    '<span style="display:flex;align-items:center;gap:4px;font-size:10px;color:#6b87ad"><span style="width:8px;height:8px;border-radius:2px;background:#1a6fff"></span>Collected</span>'+
    '<span style="display:flex;align-items:center;gap:4px;font-size:10px;color:#6b87ad"><span style="width:8px;height:8px;border-radius:2px;background:#00c4a7"></span>Pending</span>';
  // Compute revenue per category from real invoices. When line_items are
  // available, aggregate per-line (a mixed invoice splits across categories);
  // otherwise fall back to the invoice's `svc` string and counts the whole
  // amount under the first matched category.
  const labels=['Canning','R&D','Bottling','Consulting'];
  const collected=[0,0,0,0], pending=[0,0,0,0];
  function categoryIndex(text){
    const t=(text||'').toLowerCase();
    if(t.includes('cann')) return 0;
    if(t.includes('r&d')||t.includes('formul')||t.includes('ip license')||t.includes('ip purchase')) return 1;
    if(t.includes('bottl')) return 2;
    if(t.includes('consult')||t.includes('hour')) return 3;
    return -1;
  }
  (invoices||[]).forEach(inv=>{
    const isPaid=inv.status==='paid';
    const isOwed=inv.status==='pending'||inv.status==='overdue';
    if(!isPaid && !isOwed) return;
    if(Array.isArray(inv.lines) && inv.lines.length){
      inv.lines.forEach(l=>{
        const idx=categoryIndex(l.desc||l.description||'');
        if(idx<0) return;
        const amt=Number(l.total||0);
        if(isPaid) collected[idx]+=amt;
        else pending[idx]+=amt;
      });
    } else {
      const idx=categoryIndex(inv.svc||'');
      if(idx<0) return;
      const amt=Number(inv.amount||0);
      if(isPaid) collected[idx]+=amt;
      else pending[idx]+=amt;
    }
  });
  chartInst=new Chart(document.getElementById('revChart'),{
    type:'bar',
    data:{labels,datasets:[
      {label:'Collected',data:collected,backgroundColor:'#1a6fff',borderRadius:3},
      {label:'Pending',data:pending,backgroundColor:'#00c4a7',borderRadius:3}
    ]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{
      x:{grid:{color:gc},ticks:{color:tc,font:{size:10}}},
      y:{grid:{color:gc},ticks:{color:tc,font:{size:10},callback:v=>'$'+v/1000+'K'}}
    }}
  });
  } catch(e){ console.warn('[GL] buildCharts failed', e); }
}

/* Clients */
function renderClients(list){
  const rows=list||clients;
  document.getElementById('client-sub').textContent=rows.length+' beverage brands';
  // Compute total billed from invoices on the fly. The clients.total_billed
  // DB column is never maintained (no trigger / cron updates it), so reading
  // c.billed showed $0 for every client even when invoices existed. Caught
  // during Playwright runtime audit on 2026-05-21 — Mike's $2,313 of
  // overdue Lotus invoices showed as $0 total billed.
  const billedByClient = {};
  (window.invoices||[]).forEach(i => {
    if(!i.client) return;
    billedByClient[i.client] = (billedByClient[i.client] || 0) + (Number(i.amount) || 0);
  });
  document.getElementById('client-body').innerHTML=rows.map(c=>{
    const ref=referrers.find(r=>r.id===c.referredBy);
    const billed = billedByClient[c.id] != null ? billedByClient[c.id] : (c.billed || 0);
    return`<tr style="cursor:pointer" onclick="openClientCard('${c.id}')">
      <td><div style="display:flex;align-items:center;gap:7px"><div class="cavt" style="background:${c.color};color:${c.tc}">${esc(c.init)}</div><span style="font-weight:600">${esc(c.name)}</span></div></td>
      <td style="color:var(--muted)">${esc(c.contact)}</td>
      <td style="color:var(--muted)">${esc(c.service)}</td>
      <td><span class="cbdg ${esc(c.status)}">${esc(c.status)}</span></td>
      <td style="font-weight:600">$${Number(billed||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
      <td style="color:var(--muted)">${ref?`🤝 ${esc(ref.name)}`:'-'}</td>
      <td onclick="event.stopPropagation()" style="white-space:nowrap">
        <button class="cbtn" style="font-size:10px;padding:3px 9px" onclick="createForClient('${c.id}')">+ Invoice</button>
        <button class="cbtn" style="font-size:10px;padding:3px 9px;margin-left:4px;background:rgba(26,111,255,.12);border-color:rgba(26,111,255,.35);color:#6b9fff" data-cname="${(c.name||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')}" onclick="if(window.glInviteCustomerLogin){window.glInviteCustomerLogin('${c.id}', this.dataset.cname);}else{alert('Portal module not ready');}">🔑 Invite</button>
        ${(window.glIsSuperUser && window.glIsSuperUser()) ? `<button class="cbtn red" style="font-size:10px;padding:3px 9px;margin-left:4px" data-cname="${(c.name||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')}" onclick="deleteClient('${c.id}', this.dataset.cname)">Delete</button>` : ''}
      </td>
    </tr>`;
  }).join('');
}
function filterClients(q){renderClients(clients.filter(c=>!q||c.name.toLowerCase().includes(q.toLowerCase())||c.contact.toLowerCase().includes(q.toLowerCase())))}

/* Delete client — super-user only (gated by the row button visibility, but
   re-checked here in case of a stale UI). Shows a real cascade-impact
   preview before destroying: how many invoices, production runs, samples,
   notes, etc. would be wiped. Most child rows are set to ON DELETE CASCADE
   (or set null) so the DB cleanup is one DELETE — but the warning is
   honest about what's about to disappear. */
async function deleteClient(cid, cname){
  if(!window.glIsSuperUser || !window.glIsSuperUser()){
    alert('Only the workspace owner can delete clients.');
    return;
  }
  if(!window.supa){ alert('Cloud sync unavailable — try reloading.'); return; }

  // Pull impact preview in parallel.
  const [inv, runs, samps, notes, tags] = await Promise.all([
    window.supa.from('invoices').select('id', { head: true, count: 'exact' }).eq('client_id', cid),
    window.supa.from('production_runs').select('id', { head: true, count: 'exact' }).eq('client_id', cid),
    window.supa.from('sample_shipments').select('id', { head: true, count: 'exact' }).eq('client_id', cid),
    window.supa.from('client_notes').select('id', { head: true, count: 'exact' }).eq('client_id', cid),
    window.supa.from('client_tags').select('tag', { head: true, count: 'exact' }).eq('client_id', cid)
  ]);
  const counts = {
    invoices:     inv.count    || 0,
    runs:         runs.count   || 0,
    samples:      samps.count  || 0,
    notes:        notes.count  || 0,
    tags:         tags.count   || 0
  };
  const cascadeLines = Object.entries(counts).filter(([_,v]) => v>0).map(([k,v]) => `  • ${v} ${k}`).join('\n');
  const msg = `Permanently delete "${cname}"?\n\n` +
    (cascadeLines ? `This will also cascade-delete:\n${cascadeLines}\n\n` : 'No linked records.\n\n') +
    'This cannot be undone.\n\nType the client name exactly to confirm:';
  const typed = prompt(msg);
  if(typed === null) return;
  if(typed !== cname){
    alert('Name did not match — delete cancelled. (Type "' + cname + '" exactly.)');
    return;
  }
  const res = await glCheckedDelete(sb => sb.from('clients').delete().eq('id', cid).select('id'));
  if(!res.ok){ alert('Delete failed — "' + cname + '" has NOT been deleted: ' + res.reason); return; }
  // Local cache + UI refresh
  if(Array.isArray(window.clients)) window.clients = window.clients.filter(c => c.id !== cid);
  if(typeof renderClients === 'function') renderClients();
  if(typeof renderDash === 'function') renderDash();
  addNotification('🗑️ Client deleted', cname, 'warning');
  if(typeof glAudit === 'function') glAudit('client_deleted', cname, counts);
}
function createForClient(cid){
  // Open the current invoice builder with this client pre-selected. (The old
  // path relied on cNav('newinv') + a hardcoded nav index + the legacy
  // #inv-client element — all fragile after the invoice builder was migrated,
  // which is why "New Invoice" from a client stopped working.)
  if(typeof window.openNewInvoiceBuilder === 'function'){
    try { window.openNewInvoiceBuilder(cid); return; }
    catch(e){ console.error('[GL] openNewInvoiceBuilder threw', e); }
  }
  // Legacy fallback (only if the new builder isn't loaded)
  cNav('newinv', document.querySelectorAll('.cni')[4]);
  setTimeout(()=>{ var el=document.getElementById('inv-client'); if(el){ el.value=cid; if(typeof updatePreview==='function') updatePreview(); } }, 100);
}

/* Kanban */
/* renderKanban defined below */

/* Invoices */
window.invSelected = window.invSelected || new Set();
function toggleSelectAllInvoices(checked){
  document.querySelectorAll('#inv-body input.inv-row-cb').forEach(cb => {
    cb.checked = checked;
    const id = cb.getAttribute('data-id');
    if(checked) window.invSelected.add(id); else window.invSelected.delete(id);
  });
  renderInvBulkBar();
}
function toggleInvoiceRow(id, checked){
  if(checked) window.invSelected.add(id); else window.invSelected.delete(id);
  const all = document.getElementById('inv-select-all');
  if(all){
    const cbs = Array.prototype.slice.call(document.querySelectorAll('#inv-body input.inv-row-cb'));
    all.checked = cbs.length > 0 && cbs.every(c => c.checked);
    all.indeterminate = !all.checked && cbs.some(c => c.checked);
  }
  renderInvBulkBar();
}
function renderInvBulkBar(){
  const bar = document.getElementById('inv-bulk-bar');
  if(!bar) return;
  const ids = Array.from(window.invSelected);
  if(!ids.length){ bar.style.display = 'none'; return; }
  const selectedInvs = invoices.filter(i => window.invSelected.has(i.id));
  const total = selectedInvs.reduce((s,i) => s + (Number(i.amount)||0), 0);
  const anyUnpaid = selectedInvs.some(i => i.status !== 'paid');
  // Count how many of the selected invoices have a reachable email
  const sendableCount = selectedInvs.filter(i => {
    const c = clients.find(x => x.id === i.client) || {};
    return !!(c.email || i.clientEmail);
  }).length;
  bar.style.display = 'flex';
  bar.innerHTML = `
    <div style="font-size:12px;color:#fff;font-weight:700">${ids.length} selected</div>
    <div style="font-size:11px;color:var(--muted)">Total: <b style="color:#00e5c0">${fmtMoneyShort(total)}</b></div>
    <div style="flex:1"></div>
    <button class="cbtn" style="font-size:11px;padding:6px 12px;background:rgba(26,111,255,.15);border-color:rgba(26,111,255,.4);color:#6b9fff" onclick="bulkSendInvoices()">📧 Send ${sendableCount > 0 ? sendableCount : ids.length}</button>
    ${anyUnpaid ? `<button class="cbtn grn" style="font-size:11px;padding:6px 12px" onclick="bulkMarkPaid()">✓ Mark ${selectedInvs.filter(i => i.status !== 'paid').length} paid</button>` : ''}
    <button class="cbtn" style="font-size:11px;padding:6px 12px" onclick="clearInvoiceSelection()">Clear</button>`;
}
function clearInvoiceSelection(){
  window.invSelected.clear();
  document.querySelectorAll('#inv-body input.inv-row-cb').forEach(cb => cb.checked = false);
  const all = document.getElementById('inv-select-all'); if(all){ all.checked = false; all.indeterminate = false; }
  renderInvBulkBar();
}
async function bulkMarkPaid(){
  const ids = Array.from(window.invSelected);
  const targets = invoices.filter(i => ids.includes(i.id) && i.status !== 'paid');
  if(!targets.length) return;
  if(!confirm(`Mark ${targets.length} invoice${targets.length===1?'':'s'} as paid? This won't actually charge Stripe — use only for offline payments.`)) return;
  // Persist each one and count what actually landed. Previously every invoice
  // was flipped to 'paid' in memory before the write, the write was unchecked,
  // and the success toast reported the full batch regardless — so a partly or
  // wholly rejected batch still read as "12 invoices marked paid".
  const failed = [];
  for(const inv of targets){
    const paidAt = new Date().toISOString();
    const res = await glPersistInvoiceStatus(inv, { status:'paid', paid_at: paidAt, paid_method:'manual' });
    if(!res.ok){ failed.push(inv.id + ' (' + res.reason + ')'); continue; }
    inv.status = 'paid';
    inv.paid_at = paidAt;
    inv.waiveCardSurcharge = inv.waiveCardSurcharge || false;
  }
  const okCount = targets.length - failed.length;
  if(typeof addNotification==='function'){
    if(okCount) addNotification('💰 Bulk mark-paid', okCount + ' invoice' + (okCount===1?'':'s') + ' marked paid', 'success');
    if(failed.length) addNotification('Some invoices were NOT marked paid', failed.length + ' failed: ' + failed.slice(0,5).join(', ') + (failed.length>5?' …':''), 'error');
  } else if(failed.length){
    alert(failed.length + ' invoice(s) were NOT marked paid:\n' + failed.join('\n'));
  }
  clearInvoiceSelection();
  renderInvoices();
  renderDash();
}

async function bulkSendInvoices(){
  const selectedInvs = invoices.filter(i => window.invSelected.has(i.id));
  if(!selectedInvs.length) return;

  // Build recipient rows — flag ones with no email
  const rows = selectedInvs.map(inv => {
    const c = clients.find(x => x.id === inv.client) || {};
    const email = c.email || inv.clientEmail || '';
    const extras = (Array.isArray(c.additionalEmails) ? c.additionalEmails : []).map(e => e.email).filter(Boolean).filter(e => e !== email);
    const usd = n => '$' + (Number(n)||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
    return { inv, c, email, extras, usd, hasEmail: !!email };
  });
  const sendable = rows.filter(r => r.hasEmail);
  const noEmail  = rows.filter(r => !r.hasEmail);

  // Remove any prior modal
  const prior = document.getElementById('gl-bulk-send-modal');
  if(prior) prior.remove();

  const ov = document.createElement('div');
  ov.id = 'gl-bulk-send-modal';
  ov.setAttribute('style','position:fixed;inset:0;z-index:1200;background:rgba(6,13,26,.9);backdrop-filter:blur(8px);display:flex;align-items:flex-start;justify-content:center;padding:30px;overflow-y:auto');

  const recipientRows = rows.map(r => `
    <tr id="gl-bsr-${r.inv.id}" style="border-bottom:1px solid rgba(255,255,255,.05)">
      <td style="padding:9px 8px;font-family:var(--ff-mono);font-size:12px;color:var(--teal);white-space:nowrap">${esc(r.inv.id)}</td>
      <td style="padding:9px 8px;font-size:12px;color:#fff;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.inv.clientName)}</td>
      <td style="padding:9px 8px;font-size:12px;color:${r.hasEmail ? 'var(--muted)' : '#ff8579'}">${r.hasEmail ? esc(r.email) + (r.extras.length ? ` <span style="color:#6b87ad;font-size:10px">+${r.extras.length} cc</span>` : '') : '⚠ No email on file'}</td>
      <td style="padding:9px 8px;font-size:12px;font-weight:600;text-align:right;white-space:nowrap">${r.usd(r.inv.amount)}</td>
      <td style="padding:9px 8px;text-align:center" id="gl-bsr-status-${r.inv.id}">
        ${r.hasEmail ? '<span style="font-size:11px;color:var(--muted)">—</span>' : '<span style="font-size:11px;color:#6b87ad">skip</span>'}
      </td>
    </tr>`).join('');

  ov.innerHTML = `
    <div style="background:#142238;border:1px solid rgba(26,111,255,.25);border-radius:14px;width:100%;max-width:780px;padding:26px 28px;color:#fff">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px">
        <div style="font-family:var(--ff-disp);font-size:18px;letter-spacing:2px;color:#6b9fff">📧 SEND ${rows.length} INVOICE${rows.length===1?'':'S'}</div>
        <button id="gl-bsm-close" style="background:none;border:none;color:#9aa7bd;font-size:22px;cursor:pointer;line-height:1">✕</button>
      </div>

      ${noEmail.length ? `<div style="background:rgba(231,76,60,.1);border:1px solid rgba(231,76,60,.3);border-radius:8px;padding:9px 14px;font-size:12px;color:#ff8579;margin-bottom:14px">⚠ ${noEmail.length} invoice${noEmail.length===1?'':'s'} skipped — no email on file for ${esc(noEmail.map(r=>r.inv.clientName).join(', '))}. Add email in the Clients panel first.</div>` : ''}

      <!-- Recipient table -->
      <div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:10px;overflow:hidden;margin-bottom:16px;max-height:240px;overflow-y:auto">
        <table style="width:100%;border-collapse:collapse">
          <thead><tr style="background:rgba(255,255,255,.05)">
            <th style="padding:7px 8px;font-size:10px;letter-spacing:1px;color:var(--muted);text-align:left;font-weight:600">Invoice</th>
            <th style="padding:7px 8px;font-size:10px;letter-spacing:1px;color:var(--muted);text-align:left;font-weight:600">Client</th>
            <th style="padding:7px 8px;font-size:10px;letter-spacing:1px;color:var(--muted);text-align:left;font-weight:600">Recipient</th>
            <th style="padding:7px 8px;font-size:10px;letter-spacing:1px;color:var(--muted);text-align:right;font-weight:600">Amount</th>
            <th style="padding:7px 8px;font-size:10px;letter-spacing:1px;color:var(--muted);text-align:center;font-weight:600">Status</th>
          </tr></thead>
          <tbody>${recipientRows}</tbody>
        </table>
      </div>

      <!-- Shared email template -->
      <div style="display:grid;grid-template-columns:80px 1fr;gap:8px 12px;align-items:center;font-size:13px;margin-bottom:12px">
        <label style="color:var(--muted);font-size:11px;letter-spacing:1px">BCC</label>
        <input id="gl-bsm-bcc" class="finp" placeholder="optional — e.g. mike@goodliquid.com" style="font-size:13px">
        <label style="color:var(--muted);font-size:11px;letter-spacing:1px">SUBJECT</label>
        <input id="gl-bsm-subject" class="finp" value="Your Invoice from Good Liquid Bev Co" style="font-size:13px">
      </div>
      <div style="margin-bottom:14px">
        <div style="font-size:11px;letter-spacing:1px;color:var(--muted);margin-bottom:4px">MESSAGE (added above each invoice — use {client} for their name, {invoice} for the ID, {amount} for the total)</div>
        <textarea id="gl-bsm-message" class="finp" rows="5" style="resize:vertical;font-size:13px">Hi {client},

Please find Invoice {invoice} below for {amount}.

Payment is due on receipt. Wire instructions are included at the bottom of the invoice.

Let me know if you have any questions.

Thanks,
Good Liquid Accounting
(803) 493-5065 · Mike@GoodLiquid.com</textarea>
      </div>

      <div id="gl-bsm-progress" style="display:none;margin-bottom:12px">
        <div style="font-size:11px;color:var(--muted);margin-bottom:5px" id="gl-bsm-prog-label">Sending…</div>
        <div style="background:rgba(255,255,255,.07);border-radius:4px;height:6px;overflow:hidden">
          <div id="gl-bsm-prog-bar" style="height:100%;background:var(--teal);width:0%;transition:width .4s"></div>
        </div>
      </div>

      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button id="gl-bsm-cancel" class="cbtn" style="font-size:13px">Cancel</button>
        <button id="gl-bsm-send" class="cbtn pri" style="font-size:13px" ${sendable.length===0?'disabled':''}>
          📤 Send ${sendable.length} Invoice${sendable.length===1?'':'s'}
        </button>
      </div>
      <div id="gl-bsm-result" style="margin-top:10px;font-size:12px;color:var(--muted);min-height:18px"></div>
    </div>`;

  document.body.appendChild(ov);
  ov.addEventListener('click', e => { if(e.target === ov) ov.remove(); });
  ov.querySelector('#gl-bsm-close').onclick  = () => ov.remove();
  ov.querySelector('#gl-bsm-cancel').onclick = () => ov.remove();

  ov.querySelector('#gl-bsm-send').onclick = async function(){
    if(!sendable.length) return;
    const btn      = this;
    const bccRaw   = ov.querySelector('#gl-bsm-bcc').value.trim();
    const subject  = ov.querySelector('#gl-bsm-subject').value.trim() || 'Your Invoice from Good Liquid Bev Co';
    const msgTpl   = ov.querySelector('#gl-bsm-message').value;
    const prog     = ov.querySelector('#gl-bsm-progress');
    const progBar  = ov.querySelector('#gl-bsm-prog-bar');
    const progLbl  = ov.querySelector('#gl-bsm-prog-label');
    const result   = ov.querySelector('#gl-bsm-result');

    btn.disabled = true;
    ov.querySelector('#gl-bsm-cancel').disabled = true;
    prog.style.display = 'block';

    const usd = n => '$' + (Number(n)||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
    let sent = 0, failed = 0;

    for(let ri = 0; ri < sendable.length; ri++){
      const r = sendable[ri];
      const statusCell = document.getElementById('gl-bsr-status-' + r.inv.id);
      const row = document.getElementById('gl-bsr-' + r.inv.id);
      if(statusCell) statusCell.innerHTML = '<span style="font-size:11px;color:#f5c842">⏳ Sending…</span>';
      progLbl.textContent = `Sending ${ri+1} of ${sendable.length}: ${r.inv.id}…`;

      // Personalise subject & message
      const personalSubject = subject
        .replace(/\{client\}/gi, r.c.contact || r.c.name || r.inv.clientName)
        .replace(/\{invoice\}/gi, r.inv.id)
        .replace(/\{amount\}/gi, usd(r.inv.amount));
      const personalMsg = msgTpl
        .replace(/\{client\}/gi, r.c.contact || r.c.name || r.inv.clientName)
        .replace(/\{invoice\}/gi, r.inv.id)
        .replace(/\{amount\}/gi, usd(r.inv.amount));

      let portalUrl = '';
      try {
        if(typeof window.glGenerateInvoiceShareLink === 'function')
          portalUrl = (await window.glGenerateInvoiceShareLink(r.inv.id)) || '';
      } catch(e){/* non-blocking */}

      let pdfAttachment = null;
      try { pdfAttachment = await generateInvoicePdfBlob(r.inv.id); }
      catch(e){ console.warn('[GL] PDF gen failed for', r.inv.id, e); }

      const htmlBody = `<div style="font-family:Arial,sans-serif;color:#1a1a1a;line-height:1.55"><div style="white-space:pre-wrap;padding:0 28px 14px">${personalMsg.replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))}</div>${buildInvoiceEmailHtml(r.inv.id, { portalUrl })}</div>`;
      const toLine = r.email + (r.extras.length ? ', ' + r.extras.join(', ') : '');

      let ok = false;
      try {
        ok = await sendMailgunEmail(toLine, personalSubject, personalMsg, {
          bcc: bccRaw, html: htmlBody,
          attachments: pdfAttachment ? [pdfAttachment] : []
        });
      } catch(e){ console.warn('[GL] bulkSend Mailgun error', r.inv.id, e); }

      if(ok){
        sent++;
        if(statusCell) statusCell.innerHTML = '<span style="font-size:11px;color:#00c4a7">✓ Sent</span>';
        if(row) row.style.opacity = '.6';
        if(typeof window.glAudit === 'function') window.glAudit('invoice_sent', r.inv.id, { to: toLine, bulk: true });
      } else {
        failed++;
        if(statusCell) statusCell.innerHTML = '<span style="font-size:11px;color:#ff8579">✗ Failed</span>';
      }

      progBar.style.width = Math.round(((ri+1)/sendable.length)*100) + '%';
    }

    progLbl.textContent = `Done — ${sent} sent${failed ? ', ' + failed + ' failed' : ''}.`;
    result.style.color = failed ? '#ff8579' : '#5fcf9e';
    result.textContent = failed
      ? `✓ ${sent} sent · ✗ ${failed} failed (check console for details)`
      : `✓ All ${sent} invoice${sent===1?'':'s'} sent successfully!`;
    btn.textContent = 'Done';
    if(typeof addNotification === 'function') addNotification('📧 Bulk send complete', `${sent} invoice${sent===1?'':'s'} sent`, sent&&!failed?'success':'warning');
    if(sent > 0) glNotifyDeal('invoice_sent_bulk', {count: String(sent), failed: String(failed)});
    if(!failed) setTimeout(() => { ov.remove(); clearInvoiceSelection(); }, 2200);
  };
}
window.bulkSendInvoices = bulkSendInvoices;

function renderInvoices(){
  let list=invoices.filter(i=>{
    const mf=invFilter==='all'||i.status===invFilter;
    const ms=!invSearch||i.clientName.toLowerCase().includes(invSearch)||i.id.toLowerCase().includes(invSearch);
    return mf&&ms;
  });
  document.getElementById('inv-sub').textContent=list.length+' invoices';
  document.getElementById('inv-body').innerHTML=list.map(i=>`<tr style="cursor:pointer" onclick="viewInvoice('${i.id}')">
    <td onclick="event.stopPropagation()" style="text-align:center"><input type="checkbox" class="inv-row-cb" data-id="${i.id}" ${window.invSelected.has(i.id)?'checked':''} onchange="toggleInvoiceRow('${i.id}',this.checked)"></td>
    <td style="font-weight:600;color:var(--teal)">${esc(i.id)}</td>
    <td>${esc(i.clientName)}</td>
    <td style="color:var(--muted);max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(i.svc)}</td>
    <td style="font-weight:600">$${(window.fmtUsd?window.fmtUsd(i.amount):Number(i.amount||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}))}</td>
    <td style="color:var(--muted)">${esc(i.date)}</td>
    <td><span class="cbdg ${esc(i.status)}">${esc(i.status)}</span></td>
    <td onclick="event.stopPropagation()"><div style="display:flex;gap:3px">
      ${i.status!=='paid'?`<button class="cbtn grn" style="font-size:10px;padding:3px 7px" onclick="event.stopPropagation();quickPaid('${i.id}')">Paid</button>`:''}
      ${effectiveInvoiceStatus(i)==='overdue'?`<button class="cbtn" style="font-size:10px;padding:3px 7px;background:rgba(245,200,66,.12);border-color:rgba(245,200,66,.35);color:#f5c842" onclick="event.stopPropagation();sendInvoiceSmsReminder('${i.id}')" title="Send SMS reminder">📱</button>`:''}
      <button class="cbtn" style="font-size:10px;padding:3px 7px" onclick="event.stopPropagation();viewInvoice('${i.id}')">👁</button>
      <button class="cbtn" style="font-size:10px;padding:3px 7px;background:rgba(231,76,60,.1);border-color:rgba(231,76,60,.35);color:#ff8579" onclick="event.stopPropagation();deleteInvoice('${i.id}')" title="Delete invoice">🗑</button>
    </div></td>
  </tr>`).join('');
  renderInvBulkBar();
}
function setInvFilter(el,f){document.querySelectorAll('#inv-pills .cpill').forEach(p=>p.classList.remove('act'));el.classList.add('act');invFilter=f;renderInvoices()}
function filterInvoices(q){invSearch=q.toLowerCase();renderInvoices()}
/* Apply a status patch to one invoice and report whether the DATABASE agreed.
   Returns {ok:true} or {ok:false, reason}.

   RLS rejects a write silently — 0 rows affected, no error — so `.select()`
   AND the array-length check are both required. Without them "mark paid"
   updates the screen, fires the paid alert, and leaves the invoice unpaid in
   the database (CLAUDE.md rule 4). Every mark-paid path goes through here so
   the check exists once rather than four times (§11). */
async function glPersistInvoiceStatus(inv, patch){
  if(!window.supa) return {ok:false, reason:'Not connected to the database.'};
  try{
    const base = window.supa.from('invoices').update(patch);
    const r = inv.supaId
      ? await base.eq('id', inv.supaId).select('invoice_number')
      : await base.eq('invoice_number', inv.id).select('invoice_number');
    if(r.error) return {ok:false, reason:r.error.message};
    if(!Array.isArray(r.data) || r.data.length === 0){
      return {ok:false, reason:'The server rejected the change — 0 rows updated.'};
    }
    return {ok:true};
  }catch(e){
    return {ok:false, reason:(e && e.message) ? e.message : String(e)};
  }
}

/* Run a delete and report whether the database actually removed anything.
   `build` receives window.supa and must return the query with `.select()`
   already appended — PostgREST only returns the deleted rows when asked, and
   without them an RLS rejection (0 rows, no error) is indistinguishable from
   success. Checking only `r.error`, as every delete in this file used to,
   means the local cache is purged and glAudit() records a deletion that never
   happened. A false audit entry is worse than a failed delete.
   Declared in this script block; the callers in the next block run later, so
   the global binding is in place by then. */
async function glCheckedDelete(build){
  if(!window.supa) return {ok:false, reason:'Not connected to the database.'};
  try{
    const r = await build(window.supa);
    if(r.error) return {ok:false, reason:r.error.message};
    if(!Array.isArray(r.data) || r.data.length === 0){
      return {ok:false, reason:'The server rejected the delete — 0 rows removed.'};
    }
    return {ok:true, count:r.data.length};
  }catch(e){
    return {ok:false, reason:(e && e.message) ? e.message : String(e)};
  }
}

/* Insert a row and return it, or report why it did not save.
   `build` receives window.supa and must return the query with `.select()`
   (and usually `.single()`) appended, so the caller gets the real database id.

   The pattern this replaces was:

       const {data:newX} = await supa.from('x').insert([...]).select().single();
       const id = newX ? newX.id : ('tmp_' + Date.now());
       list.push({id, ...});

   which invents a synthetic id when the insert fails and pushes a record that
   exists only in that browser tab. The user sees it created; it is gone on
   reload; and anything keyed to that id — uploaded files, follow-up writes —
   points at a row that was never created. Failing loudly is the only correct
   behaviour, so this returns {ok:false} and callers must not fabricate an id. */
async function glCheckedInsert(build){
  if(!window.supa) return {ok:false, reason:'Not connected to the database.'};
  try{
    const r = await build(window.supa);
    if(r.error) return {ok:false, reason:r.error.message};
    if(!r.data) return {ok:false, reason:'The server did not return the new record — it was not saved.'};
    return {ok:true, row:r.data};
  }catch(e){
    return {ok:false, reason:(e && e.message) ? e.message : String(e)};
  }
}

async function quickPaid(id){
  const i=invoices.find(x=>x.id===id);
  if(!i)return;
  const prevStatus = i.status, prevPaidAt = i.paid_at;
  const paidAt = new Date().toISOString();
  const res = await glPersistInvoiceStatus(i, {status:'paid', paid_at:paidAt, paid_method:'manual'});
  if(!res.ok){
    // Do not touch local state and do not fire the paid alert — the invoice is
    // still unpaid as far as the database is concerned.
    i.status = prevStatus; i.paid_at = prevPaidAt;
    if(typeof addNotification==='function') addNotification('Mark paid failed', id + ' is still unpaid: ' + res.reason, 'error');
    else alert('Mark paid failed — ' + id + ' is still unpaid: ' + res.reason);
    renderInvoices();renderDash();
    return;
  }
  i.status='paid';
  i.paid_at=paidAt;
  renderInvoices();renderDash();
  glNotifyDeal('invoice_paid_manual',{invoice_number:id,client:i.clientName||'',amount:String(i.amount||'')});
}

/* Invoice detail */
function viewInvoice(id){
  currentInvId=window.currentInvId=id;const inv=invoices.find(i=>i.id===id);if(!inv)return;
  const c=clients.find(x=>x.id===inv.client)||{name:inv.clientName,contact:'',email:''};
  document.getElementById('inv-detail-content').innerHTML=`
    <div style="background:var(--ink);border:1px solid rgba(255,255,255,.07);border-radius:14px;padding:28px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:18px;padding-bottom:18px;border-bottom:1px solid rgba(255,255,255,.07)">
        <div><div style="font-family:var(--ff-disp);font-size:18px;letter-spacing:2px;color:var(--teal);margin-bottom:3px">${GL.name}</div>
          <div style="font-size:11px;color:var(--muted)">${GL.addr} · ${GL.city}</div>
          <div style="font-size:11px;color:var(--muted)">${GL.email}</div></div>
        <div style="text-align:right">
          <div style="font-family:var(--ff-disp);font-size:20px;letter-spacing:2px;color:var(--white)">INVOICE</div>
          <div style="font-family:var(--ff-mono);font-size:13px;color:var(--teal);margin-top:2px">${inv.id}</div>
          <div style="font-size:11px;color:var(--muted);margin-top:3px">Date: ${inv.date}</div>
          <div style="margin-top:8px"><span class="cbdg ${inv.status}" style="font-size:11px;padding:4px 10px">${inv.status.toUpperCase()}</span></div>
        </div>
      </div>
      <div style="margin-bottom:18px"><div style="font-size:10px;letter-spacing:2px;text-transform:uppercase;color:var(--muted);margin-bottom:4px">BILL TO</div>
        <div style="font-weight:700;font-size:13px;color:var(--white)">${esc(c.legalName || c.name)}</div>
        ${c.legalName && c.legalName !== c.name ? `<div style="font-size:11px;color:var(--muted)">dba ${esc(c.name)}</div>` : ''}
        ${(function(){
          const useBilling = c.billingSame === false && (c.billingStreet || c.billingCity);
          const street = useBilling ? c.billingStreet : c.street;
          const city   = useBilling ? c.billingCity   : c.city;
          const state  = useBilling ? c.billingState  : c.state;
          const zip    = useBilling ? c.billingZip    : c.zip;
          return street
            ? `<div style="font-size:11px;color:var(--muted)">${esc(street)}</div><div style="font-size:11px;color:var(--muted)">${esc([city, state].filter(Boolean).join(', ') + (zip ? ' ' + zip : ''))}</div>`
            : `<div style="font-size:11px;color:#6b7280;font-style:italic">(address not on file — add via Edit Client)</div>`;
        })()}
        ${c.contact ? `<div style="font-size:11px;color:var(--muted);margin-top:4px">Attn: ${esc(c.contact)}</div>` : ''}
        ${c.email ? `<div style="font-size:11px;color:var(--muted)">${esc(c.email)}</div>` : ''}
        ${c.phone ? `<div style="font-size:11px;color:var(--muted)">${esc(c.phone)}</div>` : ''}
      </div>
      <table style="width:100%;border-collapse:collapse;margin-bottom:14px;font-size:12px">
        <thead><tr style="background:rgba(255,255,255,.04)">
          <th style="text-align:left;padding:9px 11px;font-size:10px;color:var(--muted);border-bottom:1px solid rgba(255,255,255,.07)">Description</th>
          <th style="text-align:center;padding:9px 11px;font-size:10px;color:var(--muted);border-bottom:1px solid rgba(255,255,255,.07)">Qty</th>
          <th style="text-align:right;padding:9px 11px;font-size:10px;color:var(--muted);border-bottom:1px solid rgba(255,255,255,.07)">Unit Price</th>
          <th style="text-align:right;padding:9px 11px;font-size:10px;color:var(--muted);border-bottom:1px solid rgba(255,255,255,.07)">Amount</th>
        </tr></thead>
        <tbody>${(function(){
          const usd = n => '$' + (Number(n)||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
          // Filter out "junk" line items — historical invoices have rows
          // like { desc: "0", qty: 1, total: 0 } that come from accidentally
          // clicking + Add Line and not filling it in. Rendering them makes
          // the invoice look unprofessional. A row is junk if its total is 0
          // AND its description is empty or just "0". Real $0 line items
          // (waived fees, comped service) keep a real description so they
          // still render.
          const isJunk = l => (Number(l.total)||0) === 0 && (!l.desc || String(l.desc).trim() === '' || String(l.desc).trim() === '0');
          const rawLines = Array.isArray(inv.lines) && inv.lines.length ? inv.lines : [{ desc: inv.svc, qty: 1, unitPrice: inv.amount, total: inv.amount }];
          const lines = rawLines.filter(l => !isJunk(l));
          return lines.map(function(l){
            const qty = (l.qty != null) ? Number(l.qty).toLocaleString() : '';
            const unitLbl = l.unit ? '<span style="font-size:10px;color:var(--muted);margin-left:4px">/'+l.unit+'</span>' : '';
            const unitPrice = l.unitPrice != null ? usd(l.unitPrice) + unitLbl : '';
            return '<tr>' +
              '<td style="padding:11px;color:var(--white);border-bottom:1px solid rgba(255,255,255,.05)">' + esc(l.desc || '') + '</td>' +
              '<td style="padding:11px;text-align:center;color:var(--white);border-bottom:1px solid rgba(255,255,255,.05)">' + qty + '</td>' +
              '<td style="padding:11px;text-align:right;color:var(--white);border-bottom:1px solid rgba(255,255,255,.05)">' + unitPrice + '</td>' +
              '<td style="padding:11px;text-align:right;font-weight:700;color:var(--white);border-bottom:1px solid rgba(255,255,255,.05)">' + usd(l.total||0) + '</td>' +
            '</tr>';
          }).join('') + (inv.discount && inv.discountAmt ? (
            '<tr><td colspan="3" style="padding:9px 11px;text-align:right;color:var(--muted);font-size:11px">Discount ('+inv.discount+'%)</td>' +
            '<td style="padding:9px 11px;text-align:right;color:var(--muted)">−' + usd(inv.discountAmt) + '</td></tr>'
          ) : '');
        })()}</tbody>
      </table>
      <div style="text-align:right;padding:10px 0">
        <div style="font-family:var(--ff-disp);font-size:20px;letter-spacing:1px;color:var(--teal)">Total Due: $${(window.fmtUsd?window.fmtUsd(inv.amount):Number(inv.amount||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}))}</div>
      </div>
      ${inv.notes?`<div style="margin-top:12px;padding:11px;background:rgba(255,255,255,.04);border-radius:7px;font-size:11px;color:var(--muted)">${esc(inv.notes)}</div>`:''}
      <div style="margin-top:18px;padding:14px;background:rgba(0,229,192,.05);border:1px solid rgba(0,229,192,.18);border-radius:8px">
        <div style="font-size:10px;letter-spacing:2px;text-transform:uppercase;color:var(--teal);margin-bottom:8px;font-weight:700">Payment Instructions — Wire Transfer</div>
        <div style="display:grid;grid-template-columns:140px 1fr;gap:4px 12px;font-size:12px;color:var(--white)">
          <div style="color:var(--muted)">Bank Name</div><div>Gulfside Bank</div>
          <div style="color:var(--muted)">Account Number</div><div style="font-family:var(--ff-mono)">1000007789</div>
          <div style="color:var(--muted)">Routing (ABA)</div><div style="font-family:var(--ff-mono)">063116902</div>
        </div>
      </div>
      <div style="margin-top:16px;font-size:10px;color:var(--muted)">Payment to ${GL.name} · ${GL.email}</div>
    </div>`;
  document.getElementById('btn-paid').style.display=inv.status==='paid'?'none':'';
  document.getElementById('btn-overdue').style.display=inv.status==='overdue'?'none':'';
  document.getElementById('inv-detail').classList.add('show');
}
function closeDetail(){document.getElementById('inv-detail').classList.remove('show')}
async function markStatus(s){
  if(!currentInvId) return;
  const i=invoices.find(x=>x.id===currentInvId);
  if(!i) return;
  // Persist FIRST. The screen used to update before the write and stayed
  // updated even when the write was rejected, so the invoice looked paid
  // until the next reload.
  const patch = { status: s };
  if(s === 'paid'){
    patch.paid_at = new Date().toISOString();
    patch.paid_method = 'manual';
  }
  const res = await glPersistInvoiceStatus(i, patch);
  if(!res.ok){
    if(typeof addNotification==='function') addNotification('Status change failed', i.id + ' is unchanged: ' + res.reason, 'error');
    else alert('Status change failed — ' + i.id + ' is unchanged: ' + res.reason);
    return;
  }
  i.status=s;
  if(s === 'paid') i.paid_at = patch.paid_at;
  viewInvoice(currentInvId);
  renderInvoices();
  renderDash();
  if(s === 'paid') glNotifyDeal('invoice_paid_manual', {invoice_number: i.id, client: i.clientName || i.name || '', amount: String(i.amount||'')});
}

/* Activity feed — filterable by type + free-text search. */
window.activityFilter = window.activityFilter || 'all';
window.activitySearch = window.activitySearch || '';
function setActivityFilter(el, t){
  document.querySelectorAll('#act-filters .cpill').forEach(p=>p.classList.remove('act'));
  if(el) el.classList.add('act');
  window.activityFilter = t || 'all';
  renderActivity();
}
function setActivitySearch(q){
  window.activitySearch = (q || '').trim().toLowerCase();
  renderActivity();
}
function renderActivity(){
  let list = activities;
  if(window.activityFilter && window.activityFilter !== 'all'){
    list = list.filter(a => a.type === window.activityFilter);
  }
  if(window.activitySearch){
    const q = window.activitySearch;
    list = list.filter(a => (a.name||'').toLowerCase().includes(q) || (a.detail||'').toLowerCase().includes(q));
  }
  const sub = document.getElementById('act-sub');
  if(sub) sub.textContent = list.length + ' of ' + activities.length + ' events';
  document.getElementById('full-activity').innerHTML = '<div style="padding:4px">' +
    (list.length === 0
      ? '<div style="padding:30px;text-align:center;color:var(--muted);font-size:13px">No activity matches the filter.</div>'
      : list.map(a=>`<div class="act-item" onclick="actNav(${esc(JSON.stringify(a))})" style="cursor:pointer;border-radius:8px;padding:9px 8px;margin:0 -8px;transition:background 0.2s" onmouseenter="this.style.background='rgba(255,255,255,.04)'" onmouseleave="this.style.background='transparent'">
        <div class="act-ico ${a.type}">${a.icon}</div>
        <div style="flex:1"><div class="act-name">${esc(a.name)}</div><div class="act-detail">${esc(a.detail)}</div><div class="act-time">${a.time}</div></div>
        <div style="color:var(--teal);font-size:11px;opacity:0.6;flex-shrink:0">→</div>
      </div>`).join('')
    ) + '</div>';
}

/* ═══ REFERRAL PROGRAM ═══ */
function renderReferrals(){
  // Update flow counts
  const statuses=['lead','presented','won','paid','lost'];
  statuses.forEach((s,i)=>{
    document.getElementById('flow-'+i).textContent=referrals.filter(r=>r.status===s).length;
  });
  // Metrics
  const wonRefs=referrals.filter(r=>r.status==='won'||r.status==='paid');
  const owed=referrals.filter(r=>r.status==='won').reduce((a,r)=>a+r.commAmount,0);
  const paidYTD=referrals.filter(r=>r.status==='paid').reduce((a,r)=>a+r.commAmount,0);
  const dealVal=wonRefs.reduce((a,r)=>a+r.dealValue,0);
  const total=referrals.filter(r=>r.status!=='').length;
  const wonCount=wonRefs.length;
  const lost=referrals.filter(r=>r.status==='lost').length;
  const decided=wonCount+lost;
  const winRate=decided>0?Math.round(wonCount/decided*100):0;
  document.getElementById('ref-owed').textContent='$'+owed.toLocaleString();
  document.getElementById('ref-paid-ytd').textContent='$'+paidYTD.toLocaleString();
  document.getElementById('ref-deal-val').textContent='$'+dealVal.toLocaleString();
  document.getElementById('ref-win-rate').textContent=winRate+'%';

  // Table
  let list=refFilter==='all'?referrals:referrals.filter(r=>r.status===refFilter);
  document.getElementById('ref-body').innerHTML=list.map(r=>{
    const ref=referrers.find(x=>x.id===r.referrerId)||{name:r.referrerName,color:'#444',tc:'#ccc',init:'?'};
    return`<tr>
      <td><div style="display:flex;align-items:center;gap:7px">
        <div class="cavt" style="background:${ref.color};color:${ref.tc};width:24px;height:24px;font-size:9px">${esc(ref.init)}</div>
        <div><div style="font-size:12px;font-weight:600;color:var(--white)">${esc(ref.name)}</div><div style="font-size:10px;color:var(--muted)">${esc(ref.rel||'')}</div></div>
      </div></td>
      <td style="font-weight:600">${esc(r.clientName)}</td>
      <td style="color:var(--muted)">$${(window.fmtUsd?window.fmtUsd(r.dealValue):Number(r.dealValue||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}))}</td>
      <td style="color:var(--muted)">${r.rate}%</td>
      <td style="font-weight:600;color:var(--teal)">$${(window.fmtUsd?window.fmtUsd(r.commAmount):Number(r.commAmount||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}))}</td>
      <td><span class="cbdg ${r.status==='won'?'earned':r.status}">${r.status==='won'?'Comm. earned':r.status==='paid'?'Paid out':r.status==='presented'?'Presented':r.status==='lead'?'Lead ref.':'Lost'}</span></td>
      <td><div style="display:flex;gap:3px">
        ${r.status==='won'?`<button class="cbtn grn" style="font-size:10px;padding:3px 8px" onclick="payComm('${r.id}')">Pay $${(window.fmtUsd?window.fmtUsd(r.commAmount):Number(r.commAmount||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}))}</button>`:''}
        ${r.status==='lead'?`<button class="cbtn amber" style="font-size:10px;padding:3px 8px" onclick="updateRefStatus('${r.id}','presented')">→ Presented</button>`:''}
        ${r.status==='presented'?`<button class="cbtn grn" style="font-size:10px;padding:3px 8px" onclick="updateRefStatus('${r.id}','won')">Won ✓</button><button class="cbtn red" style="font-size:10px;padding:3px 8px" onclick="updateRefStatus('${r.id}','lost')">Lost</button>`:''}
        ${r.status==='paid'?`<span class="paid-tag">✓ Paid ${r.datePaid||''}</span>`:''}
      </div></td>
    </tr>`;
  }).join('');
}

function setRefFilter(el,f){document.querySelectorAll('#ref-pills .cpill').forEach(p=>p.classList.remove('act'));el.classList.add('act');refFilter=f;renderReferrals()}

function payComm(id){
  const r=referrals.find(x=>x.id===id);
  if(r&&confirm(`Pay $${r.commAmount.toLocaleString()} commission to ${r.referrerName}?`)){
    r.status='paid';r.datePaid=new Date().toISOString().split('T')[0];
    renderReferrals();renderDash();
    activities.unshift({type:'ref',icon:'🤝',name:`Commission paid — ${r.referrerName}`,detail:`$${r.commAmount.toLocaleString()} for ${r.clientName} referral`,time:'Just now'});saveActivities();
    renderActivity();
    supa.from('referrals').update({status:'paid', date_paid: r.datePaid}).eq('id', id).then(function(res){ if(res.error) console.warn('payComm Supabase error:', res.error.message); });
  }
}

async function updateRefStatus(id,status){
  const r=referrals.find(x=>x.id===id);
  if(!r)return;
  if(status==='won'){
    const actual=prompt(`Enter actual deal value for ${r.clientName} (est. $${r.dealValue.toLocaleString()}):`,r.dealValue);
    if(actual){r.dealValue=parseFloat(actual)||r.dealValue;r.commAmount=Math.round(r.dealValue*r.rate/100);}
  }
  r.status=status;
  renderReferrals();renderDash();
  // Persist to Supabase — without this every status change was per-device
  // and disappeared on refresh.
  try {
    if(window.supa && r.id && !String(r.id).startsWith('ref')){
      const patch = { status: status };
      if(status==='won'){
        patch.deal_value       = r.dealValue;
        patch.commission_amount = r.commAmount;
      }
      await window.supa.from('referrals').update(patch).eq('id', r.id);
    }
  } catch(e){ console.warn('[GL] referral status save failed', e); }
}

function openRefModal(){
  document.getElementById('ref-modal').classList.add('show');
  calcRefComm();
}
function closeRefModal(){document.getElementById('ref-modal').classList.remove('show')}

function calcRefComm(){
  const deal=parseFloat(document.getElementById('ref-deal')?.value)||0;
  const rate=parseFloat(document.getElementById('ref-rate')?.value)||0;
  const comm=Math.round(deal*rate/100);
  const el=document.getElementById('ref-comm-preview');
  if(el)el.textContent='$'+comm.toLocaleString();
}

/* Referrers */
function renderReferrers(){
  document.getElementById('referrers-list').innerHTML=referrers.map(r=>{
    const rRefs=referrals.filter(x=>x.referrerId===r.id);
    const totalEarned=rRefs.filter(x=>x.status==='paid').reduce((a,x)=>a+x.commAmount,0);
    const owed=rRefs.filter(x=>x.status==='won').reduce((a,x)=>a+x.commAmount,0);
    const wonCount=rRefs.filter(x=>x.status==='won'||x.status==='paid').length;
    return`<div class="rref-card">
      <div class="rref-left">
        <div class="rref-av" style="background:${r.color};color:${r.tc}">${esc(r.init)}</div>
        <div>
          <div class="rref-name">${esc(r.name)}</div>
          <div class="rref-rel">${esc(r.rel)} · ${esc(r.email)} · Default: ${esc(r.rate)}% commission</div>
          ${r.notes?`<div style="font-size:10px;color:rgba(107,135,173,.6);margin-top:2px">${esc(r.notes)}</div>`:''}
        </div>
      </div>
      <div class="rref-stats">
        <div class="rref-stat"><div class="rv-val" style="color:var(--muted)">${rRefs.length}</div><div class="rv-lbl">Referrals</div></div>
        <div class="rref-stat"><div class="rv-val" style="color:#1D9E75">${wonCount}</div><div class="rv-lbl">Won</div></div>
        <div class="rref-stat"><div class="rv-val" style="color:#1D9E75">$${totalEarned.toLocaleString()}</div><div class="rv-lbl">Paid out</div></div>
        <div class="rref-stat">
          ${owed>0?`<div class="owed-tag">$${owed.toLocaleString()} owed</div>`:
          `<div class="rv-val" style="color:var(--muted)">$0</div><div class="rv-lbl">Owed</div>`}
        </div>
        <button class="cbtn" style="font-size:10px;padding:4px 10px" onclick="openRefForReferrer('${r.id}')">+ Log referral</button>
      </div>
    </div>`;
  }).join('');
}

function openRefForReferrer(rid){
  openRefModal();
  setTimeout(()=>{document.getElementById('ref-referrer-sel').value=rid;},100);
}

function openAddReferrer(){document.getElementById('add-ref-modal').classList.add('show')}
function closeAddReferrer(){document.getElementById('add-ref-modal').classList.remove('show')}

/* The Supabase-backed saveReferrer() is further down (search "Override
   saveReferrer"). A dead first declaration used to sit here: same name, same
   script block, so the later one won at hoist time and this body never ran.
   It pushed to a local array and never reached the database.

   Removed rather than annotated. The annotation was the previous state and it
   did not stop the trap being real -- this is the exact shape that hid a bug
   in quickPaid, where someone wrote a better version while the worse one kept
   winning. tests/duplicate-declarations.test.cjs now fails on any repeat. */
function populateReferrerSelects(){
  ['ref-referrer-sel'].forEach(selId=>{
    const sel=document.getElementById(selId);if(!sel)return;
    const cur=sel.value;
    sel.innerHTML='<option value="">Select referrer…</option>';
    referrers.forEach(r=>{const o=document.createElement('option');o.value=r.id;o.textContent=r.name+' ('+r.rate+'%)';sel.appendChild(o)});
    if(cur)sel.value=cur;
  });
}

/* Invoice form */
function svcChange(){
  const svc=document.getElementById('inv-svc').value;selAddons={};
  let html='';
  if(svc==='canning'||svc==='copacking'){
    html=`<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
      <div class="frow"><div class="flbl">Can format</div><select class="fsel" id="can-fmt" onchange="updatePreview()"><option value="12std">12oz Standard</option><option value="12slk">12oz Sleek</option><option value="16std">16oz Standard</option></select></div>
      <div class="frow"><div class="flbl">Cases</div><input type="number" class="finp" id="can-cases" value="500" min="200" oninput="updatePreview()"></div>
    </div><div style="font-size:10px;color:var(--muted);margin-bottom:12px">Min 200 cases · 24 cans/case</div>`;
    if(svc==='copacking')html+=`<div class="frow"><div class="flbl">Benchtop verification</div><select class="fsel" id="verif" onchange="updatePreview()"><option value="1">Yes — $500/SKU</option><option value="0">No (PAL provided)</option></select></div>`;
  }else if(svc==='bottling'){
    html=`<div class="frow"><div class="flbl">Cases (6-pack)</div><select class="fsel" id="btl-cases" onchange="updatePreview()">
      <option value="220">220 cases (1,320 btls)</option><option value="660">660 cases (3,960 btls)</option>
      <option value="1320">1,320 cases</option><option value="2640">2,640 cases</option><option value="5280">5,280 cases</option>
    </select></div>`;
  }else if(svc==='rd'){
    html=`<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
      <div class="frow"><div class="flbl">R&D package</div><select class="fsel" id="rd-pkg" onchange="updatePreview()"><option value="rd">R&D Only ($2,500)</option><option value="rd-lic">R&D + IP License ($7,000)</option><option value="rd-buy">R&D + IP Purchase ($16,000)</option></select></div>
      <div class="frow"><div class="flbl">SKUs</div><input type="number" class="finp" id="rd-skus" value="1" min="1" oninput="updatePreview()"></div>
    </div>`;
  }else{
    html=`<div class="frow"><div class="flbl">Flat fee ($)</div><input type="number" class="finp" id="consult-fee" value="2500" oninput="updatePreview()"></div>`;
  }
  document.getElementById('svc-fields').innerHTML=html;
  let addons='';
  if(svc==='canning'||svc==='copacking'){
    addons=`<div class="addon-card" onclick="toggleAddon(this,'past')"><div class="addon-card-t">🔥 Flash Pasteurization</div><div class="addon-card-p">5¢ per can</div></div>
    <div class="addon-card" onclick="toggleAddon(this,'nitro')"><div class="addon-card-t">💨 Nitrogen Dosing</div><div class="addon-card-p">3¢ per can</div></div>`;
  }else if(svc==='bottling'){
    addons=`<div class="addon-card" onclick="toggleAddon(this,'pastbtl')"><div class="addon-card-t">🔥 Flash Pasteurization</div><div class="addon-card-p">$0.20/btl</div></div>
    <div class="addon-card" onclick="toggleAddon(this,'overlbl')"><div class="addon-card-t">🏷️ Over-Top Labels</div><div class="addon-card-p">$0.20/btl</div></div>`;
  }
  document.getElementById('addon-grid').innerHTML=addons;
  updatePreview();
}

function toggleAddon(el,k){el.classList.toggle('sel');selAddons[k]=el.classList.contains('sel');updatePreview()}

function getCanRate(cases,fmt){
  for(const t of PRICING.canning.tiers){if(cases>=t.min&&cases<=t.max)return t[fmt]||t['12std'];}
  return PRICING.canning.tiers.at(-1)['12std'];
}

function calcTotal(){
  const svc=document.getElementById('inv-svc').value;
  let lines=[],total=0,desc='';
  if(svc==='canning'||svc==='copacking'){
    const fmt=document.getElementById('can-fmt')?.value||'12std';
    const cases=parseInt(document.getElementById('can-cases')?.value)||500;
    const cans=cases*24,rate=getCanRate(cases,fmt);
    const mfg=Math.round(rate*cans*100)/100,canC=Math.round(.32*cans*100)/100,pkgC=Math.round(.055*cans*100)/100;
    const fmtL={'12std':'12oz Standard','12slk':'12oz Sleek','16std':'16oz Standard'}[fmt];
    lines.push({d:`Manufacturing — ${cases} cases ${fmtL} @ $${rate}/can`,a:mfg});
    lines.push({d:`Can costs — ${cans.toLocaleString()} cans @ $0.32`,a:canC});
    lines.push({d:`Packaging — trays & PakTechs @ $0.055/can`,a:pkgC});
    total=mfg+canC+pkgC;
    if(svc==='copacking'&&document.getElementById('verif')?.value==='1'){lines.push({d:'Benchtop verification',a:500});total+=500}
    if(selAddons.past){const c=Math.round(.05*cans*100)/100;lines.push({d:'Flash Pasteurization @ $0.05/can',a:c});total+=c}
    if(selAddons.nitro){const c=Math.round(.03*cans*100)/100;lines.push({d:'Nitrogen Dosing @ $0.03/can',a:c});total+=c}
    desc=`Canning — ${cases} cases ${fmtL}`;
  }else if(svc==='bottling'){
    const cases=parseInt(document.getElementById('btl-cases')?.value)||660;
    const tier=PRICING.bottling.tiers.find(t=>t.cases===cases)||PRICING.bottling.tiers[1];
    const btls=cases*6,mfg=Math.round(tier.perBtl*btls*100)/100;
    lines.push({d:`Bottle filling — ${cases} cases @ $${tier.perBtl}/btl`,a:mfg});total=mfg;
    if(selAddons.pastbtl){const c=Math.round(.20*btls*100)/100;lines.push({d:'Flash Pasteurization @ $0.20/btl',a:c});total+=c}
    if(selAddons.overlbl){const c=Math.round(.20*btls*100)/100;lines.push({d:'Over-Top Labels @ $0.20/btl',a:c});total+=c}
    desc=`Bottle Filling — ${cases} cases 750ml`;
  }else if(svc==='rd'){
    const pkg=document.getElementById('rd-pkg')?.value||'rd';
    const skus=parseInt(document.getElementById('rd-skus')?.value)||1;
    lines.push({d:`R&D Formulation — ${skus} SKU(s)`,a:2500*skus});total=2500*skus;
    if(pkg==='rd-lic'){lines.push({d:'IP Licensing (annual)',a:6000});total+=6000}
    if(pkg==='rd-buy'){lines.push({d:'IP Purchase (outright)',a:15000});total+=15000}
    desc=pkg==='rd'?'R&D Formulation':pkg==='rd-lic'?'R&D + IP License':'R&D + IP Purchase';
  }else{
    const fee=parseFloat(document.getElementById('consult-fee')?.value)||2500;
    lines.push({d:'Consulting & Brand Support',a:fee});total=fee;desc='Consulting & Brand Support';
  }
  return{lines,total:Math.round(total*100)/100,desc};
}

function updatePreview(){
  try{
    const{lines,total,desc}=calcTotal();
    const cid=document.getElementById('inv-client').value;
    const c=clients.find(x=>x.id===cid);
    const date=document.getElementById('inv-date').value||new Date().toISOString().split('T')[0];
    const num='GL-'+new Date().getFullYear()+'-'+(invoices.length+1).toString().padStart(3,'0');
    const fmtUsd = n => (window.fmtUsd ? window.fmtUsd(n) : Number(n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}));
    document.getElementById('live-total').innerHTML=
      lines.map(l=>`<div class="tot-line"><span>${l.d}</span><span>$${fmtUsd(l.a)}</span></div>`).join('')+
      `<div class="tot-final"><span>Total</span><span>$${fmtUsd(total)}</span></div>`;
    document.getElementById('inv-preview-box').innerHTML=`
      <div class="inv-top">
        <div><div class="inv-co" style="font-size:11px">${GL.name}</div><div style="font-size:10px;color:var(--muted)">${GL.addr}</div></div>
        <div style="text-align:right"><div style="font-family:var(--ff-disp);font-size:12px;color:var(--white)">INVOICE</div><div style="font-size:10px;color:var(--teal)">${num}</div><div style="font-size:10px;color:var(--muted)">${date}</div></div>
      </div>
      <div style="margin-bottom:10px"><div style="font-size:9px;color:var(--muted);margin-bottom:2px">BILL TO</div><div style="font-weight:600;font-size:12px;color:var(--white)">${c?esc(c.name):'[Select client]'}</div></div>
      <table style="width:100%;border-collapse:collapse;font-size:10px">
        <thead><tr><th style="text-align:left;padding:4px;background:rgba(255,255,255,.04);border-bottom:1px solid rgba(255,255,255,.07);color:var(--muted)">Description</th><th style="text-align:right;padding:4px;background:rgba(255,255,255,.04);border-bottom:1px solid rgba(255,255,255,.07);color:var(--muted)">Amount</th></tr></thead>
        <tbody>${lines.map(l=>`<tr><td style="padding:5px;border-bottom:1px solid rgba(255,255,255,.05);color:var(--white)">${l.d}</td><td style="padding:5px;text-align:right;border-bottom:1px solid rgba(255,255,255,.05);color:var(--white)">$${fmtUsd(l.a)}</td></tr>`).join('')}</tbody>
      </table>
      <div style="text-align:right;margin-top:8px;font-family:var(--ff-disp);font-size:16px;color:var(--teal)">$${fmtUsd(total)}</div>`;
  }catch(e){}
}

function populateClientDropdown(){
  const sel=document.getElementById('inv-client');
  clients.forEach(c=>{const o=document.createElement('option');o.value=c.id;o.textContent=c.name;sel.appendChild(o)});
}

// Dead saveInvoice (sync) and dead checkPw v2 removed in Round 4 cleanup.
// saveInvoice was superseded by the async Supabase version later in this file.
// checkPw v2 referenced the removed `password` field on users — superseded by
// the supa.auth version below + fix.js's Supabase Auth wrapper.

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

/* ═══ USERS PAGE ═══ */
function renderUsers(){
  document.getElementById('users-sub').textContent = users.length+' team members';
  document.getElementById('users-list').innerHTML = users.map(u=>{
    const roleStyles = {
      admin:{bg:'rgba(0,229,192,.12)',color:'var(--teal)',border:'rgba(0,229,192,.25)',label:'Admin'},
      sales:{bg:'rgba(26,111,255,.12)',color:'#6b9fff',border:'rgba(26,111,255,.25)',label:'Sales'},
      warehouse:{bg:'rgba(168,85,247,.12)',color:'#c4a4f8',border:'rgba(168,85,247,.25)',label:'Warehouse'},
      viewer:{bg:'rgba(255,255,255,.06)',color:'var(--muted)',border:'rgba(255,255,255,.12)',label:'Viewer'}
    };
    const rs = roleStyles[u.role]||roleStyles.viewer;
    const isSelf = currentUser && u.id===currentUser.id;
    return `<div style="display:flex;align-items:center;justify-content:space-between;padding:16px 18px;background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.07);border-radius:12px;margin-bottom:9px;transition:all .3s">
      <div style="display:flex;align-items:center;gap:13px">
        <div style="width:42px;height:42px;border-radius:50%;background:${u.color||'#1a3a6e'};color:${u.tc||'#9FE1CB'};display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;flex-shrink:0">${esc(u.initials||'??')}</div>
        <div>
          <div style="font-size:13px;font-weight:600;color:var(--white)">${esc(u.name)} ${isSelf?'<span style="font-size:10px;color:var(--muted)">(you)</span>':''}</div>
          <div style="font-size:11px;color:var(--muted);margin-top:1px">${esc(u.email)}</div>
          <div style="font-size:10px;color:rgba(107,135,173,.55);margin-top:2px">Last login: ${esc(u.lastLogin||'Never')}</div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:10px">
        <span style="padding:4px 12px;border-radius:20px;font-size:11px;font-weight:700;background:${rs.bg};color:${rs.color};border:1px solid ${rs.border}">${rs.label}</span>
        <span class="cbdg ${u.status==='active'?'active':'draft'}">${esc(u.status)}</span>
        ${!isSelf && canAction('manage_users')?`
        <button class="cbtn" style="font-size:10px;padding:4px 9px" onclick="openChangeRole('${u.id}')">Change role</button>
        <button class="cbtn" style="font-size:10px;padding:4px 9px" onclick="resetPw('${u.id}')">Reset PW</button>
        <button class="cbtn red" style="font-size:10px;padding:4px 9px" onclick="deactivateUser('${u.id}')">${u.status==='active'?'Deactivate':'Reactivate'}</button>
        `:''}
      </div>
    </div>`;
  }).join('');
}

let changeRoleUserId=null;
function openChangeRole(uid){
  changeRoleUserId=uid;
  const u=users.find(x=>x.id===uid);if(!u)return;
  const roleStyles={admin:{bg:'rgba(0,229,192,.12)',color:'var(--teal)',label:'Admin'},sales:{bg:'rgba(26,111,255,.12)',color:'#6b9fff',label:'Sales'},warehouse:{bg:'rgba(168,85,247,.12)',color:'#c4a4f8',label:'Warehouse'},viewer:{bg:'rgba(255,255,255,.06)',color:'var(--muted)',label:'Viewer'}};
  const rs=roleStyles[u.role]||roleStyles.viewer;
  document.getElementById('role-modal-user').innerHTML=`
    <div style="width:36px;height:36px;border-radius:50%;background:${u.color};color:${u.tc};display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0">${esc(u.initials)}</div>
    <div><div style="font-size:13px;font-weight:600;color:var(--white)">${esc(u.name)}</div>
    <div style="font-size:11px;color:var(--muted)">${esc(u.email)}</div></div>
    <span style="margin-left:auto;padding:3px 10px;border-radius:20px;font-size:11px;background:${rs.bg};color:${rs.color}">${rs.label}</span>`;
  document.getElementById('role-select').value=u.role;
  document.getElementById('role-modal').classList.add('show');
}
function closeRoleModal(){document.getElementById('role-modal').classList.remove('show');changeRoleUserId=null}
/* saveRole / deactivateUser — thin wrappers over crm-permissions.js.
   The bodies that used to live here were the legacy pair, and they never
   worked: both called renderPermissionsPanel() BEFORE the update and OUTSIDE
   the try. That function is declared inside the crm-permissions.js IIFE and is
   never exported, so the bare call threw a ReferenceError and the
   `supa.from('profiles').update(...)` line below it was never reached. Role
   changes and deactivations therefore did nothing at all — a deactivated staff
   member could still sign in — and the click looked like a dead button.
   Even had the update run, it had no .select() and no rows-affected check, so
   an RLS rejection would have reported success (CLAUDE.md rule 4).
   glChangeUserRole and glToggleUserActive already do this correctly: they
   verify with .select(), refuse a 0-row result, read current status from the
   database rather than the in-memory cache, guard against locking yourself
   out, audit, and re-render. Delegate rather than keep a second copy (§11). */
async function saveRole(){
  if(!changeRoleUserId)return;
  const uid=changeRoleUserId;
  const newRole=document.getElementById('role-select').value;
  closeRoleModal();
  if(typeof window.glChangeUserRole!=='function'){
    alert('Cannot change roles: the permissions module did not load. Reload the page and try again.');
    return;
  }
  await window.glChangeUserRole(uid,newRole);
}

async function deactivateUser(uid){
  // glToggleUserActive runs its own confirm, so there is deliberately none here.
  if(typeof window.glToggleUserActive!=='function'){
    alert('Cannot change user status: the permissions module did not load. Reload the page and try again.');
    return;
  }
  await window.glToggleUserActive(uid);
}

function resetPw(uid){
  const u=users.find(x=>x.id===uid);if(!u)return;
  // Use the policy-compliant generator (guarantees uppercase + digit + special, 12 chars).
  // Falls back to a local impl if fix.js hasn't loaded yet.
  const pw = (window.glGenerateTempPassword ? window.glGenerateTempPassword() : (function(){
    const chars='ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#';
    let s='GL';for(let i=0;i<10;i++)s+=chars[Math.floor(Math.random()*chars.length)];return s;
  })());
  u.password=pw;
  const msg=`New password for ${u.name}:\n\nEmail: ${u.email}\nNew password: ${pw}\n\nShare this with them securely.`;
  if(navigator.clipboard){navigator.clipboard.writeText(msg).then(()=>alert('New password copied to clipboard!\n\nPassword: '+pw+'\n\nPaste it somewhere safe before closing.'));}
  else{alert(msg);}
}

/* ═══ KEYBOARD ═══ */
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){
    closePw();
    if(document.getElementById('inv-detail').classList.contains('show'))closeDetail();
    closeRefModal();closeAddReferrer();
  }
});

/* ═══ FOLLOW-UP EMAIL COMPOSER ═══ */
let currentTone = 'friendly';

function openFollowUp(){
  if(!currentInvId)return;
  const inv = invoices.find(i=>i.id===currentInvId);
  if(!inv)return;
  const c = clients.find(x=>x.id===inv.client)||{name:inv.clientName,email:''};
  const toEl = document.getElementById('fu-to');
  toEl.value = c.email||'';
  toEl.removeAttribute('readonly');
  if(!toEl.value || toEl.value.indexOf('@')<0){
    toEl.style.borderColor='#ff8579';
    toEl.placeholder='No email on file — type one to send';
  }
  // Auto-select tone based on status
  const tone = inv.status==='overdue' ? 'firm' : 'friendly';
  setTone(tone, inv);
  // Show content, hide loading spinner
  document.getElementById('followup-loading').style.display='none';
  document.getElementById('followup-content').style.display='block';
  document.getElementById('followup-modal').classList.add('show');
}

function closeFollowUp(){
  document.getElementById('followup-modal').classList.remove('show');
  document.getElementById('fu-copied').style.display='none';
}

function setTone(tone, inv){
  currentTone = tone;
  // Style buttons
  ['friendly','firm','final'].forEach(t=>{
    const btn=document.getElementById('tone-'+t);
    if(btn){btn.className = t===tone ? 'cbtn pri' : (t==='final' ? 'cbtn red' : 'cbtn');btn.style.fontSize='11px';btn.style.flex='1';}
  });
  if(!inv){
    if(!currentInvId)return;
    inv = invoices.find(i=>i.id===currentInvId);
    if(!inv)return;
  }
  const c = clients.find(x=>x.id===inv.client)||{name:inv.clientName,contact:'',email:''};
  const firstName = (c.contact||c.name).split(' ')[0];
  const amt = '$'+inv.amount.toLocaleString();
  const invNum = inv.id;
  const date = inv.date;

  const subjects = {
    friendly: `Following up — Invoice ${invNum}`,
    firm: `Payment reminder — Invoice ${invNum} (${amt})`,
    final: `FINAL NOTICE — Invoice ${invNum} — ${amt} past due`
  };

  const bodies = {
    friendly:
`Hi ${firstName},

Hope things are going well! I wanted to follow up on invoice ${invNum} for ${amt}, issued on ${date}.

If you have any questions about the invoice or need anything from our end, please don't hesitate to reach out — happy to help.

If payment has already been sent, please disregard this message.

Thanks so much,
Mike Krail
Good Liquid Bev Co
Mike@GoodLiquid.com
2011 51st Ave E, Unit 100 · Palmetto, FL 34221`,

    firm:
`Hi ${firstName},

I'm following up on invoice ${invNum} for ${amt} dated ${date}, which appears to be outstanding.

Could you let me know when we can expect payment, or if there's anything holding things up on your end? We're happy to work through any questions.

Please remit payment at your earliest convenience. Wire transfer or check are both accepted — reply to this email for banking details.

Thank you,
Mike Krail
Good Liquid Bev Co
Mike@GoodLiquid.com
(941) 555-0100`,

    final:
`Hi ${firstName},

This is a final notice regarding invoice ${invNum} for ${amt}, issued ${date}, which remains unpaid.

We value our relationship and want to resolve this promptly. Please arrange payment immediately or contact me directly today to discuss.

Failure to respond may result in suspension of future production runs.

Mike Krail
Good Liquid Bev Co
Mike@GoodLiquid.com
(941) 555-0100`
  };

  document.getElementById('fu-subject').value = subjects[tone];
  document.getElementById('fu-body').value = bodies[tone];
}

function openMailto(){
  const to = encodeURIComponent(document.getElementById('fu-to').value||'');
  const subject = encodeURIComponent(document.getElementById('fu-subject').value||'');
  const body = encodeURIComponent(document.getElementById('fu-body').value||'');
  window.location.href = `mailto:${to}?subject=${subject}&body=${body}`;
}

function copyEmail(){
  const subject = document.getElementById('fu-subject').value;
  const body = document.getElementById('fu-body').value;
  const text = `Subject: ${subject}\n\n${body}`;
  navigator.clipboard.writeText(text).then(()=>{
    const el=document.getElementById('fu-copied');
    el.style.display='block';
    setTimeout(()=>el.style.display='none',2500);
  }).catch(()=>{
    const ta=document.createElement('textarea');
    ta.value=text;document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta);
    const el=document.getElementById('fu-copied');el.style.display='block';
    setTimeout(()=>el.style.display='none',2500);
  });
}


/* ═══════════════════════════════════════════════
   SUPABASE INTEGRATION — replaces in-memory data
   ═══════════════════════════════════════════════ */
const SUPA_URL = 'https://ufjkeqmxwuyhbqyugcgg.supabase.co';
const SUPA_KEY = 'sb_publishable_-37mkPw8uLzEJM21T9jJOA_YQRQ7ikB';

/* If the URL carries ?inspector=TOKEN, inject the X-Inspector-Token
   header on every supabase-js request. The new RLS policies on the
   six core compliance tables (compliance_records, production_runs,
   defects, hold_tags, audit_log, and the deprecated cip_logs --
   see ADR-0001; it is empty and nothing reads it) check this header via
   public.is_valid_inspector_token() and grant anon SELECT when the
   token is live (unrevoked + within valid_from..valid_until). Other
   tables stay locked — the header is no master key. This makes the
   FDA-inspector emailed-link flow actually work end-to-end instead
   of landing on an empty page. See 20260523_inspector_mode_server_side.sql. */
const _glInspectorToken = (function(){
  try {
    const t = new URL(window.location.href).searchParams.get('inspector');
    return (t && t.trim()) || null;
  } catch(e){ return null; }
})();
const _glClientOpts = _glInspectorToken
  ? { global: { headers: { 'X-Inspector-Token': _glInspectorToken } } }
  : {};
// `var` (not `const`) so that window.supa and supa are the same reference.
// This means injecting window.supa = client after page load (e.g. when CDN
// loads late or in test harnesses) automatically updates every caller that
// references bare `supa` — they all read window.supa under the hood.
var supa = (typeof supabase !== 'undefined')
  ? supabase.createClient(SUPA_URL, SUPA_KEY, _glClientOpts)
  : null;
window.supa = supa;  // expose to fix.js (which needs supa.auth for login)
window.__glInspectorTokenInUrl = _glInspectorToken; // read by fix.js's mode-activation

// Override checkPw — tries Supabase first, falls back to local auth
window.checkPw = async function checkPw(){
  const email = (document.getElementById('pw-email').value||'').toLowerCase().trim();
  const pw = document.getElementById('pw-input').value;
  const btn = document.querySelector('.pw-btn');
  const errEl = document.getElementById('pw-err');
  const inp = document.getElementById('pw-input');
  btn.textContent = 'Signing in…';
  btn.disabled = true;

  // If supa wasn't ready at page-load (CDN race), try to init now
  if(!supa && typeof supabase !== 'undefined'){
    supa = supabase.createClient(SUPA_URL, SUPA_KEY, _glClientOpts);
    window.supa = supa;
  }
  // Also try fix.js getSupa() fallback
  if(!supa && typeof window.getSupabase === 'function'){
    supa = window.getSupabase();
    window.supa = supa;
  }

  // Try Supabase auth first
  let supaOk = false;
  try {
    const {data, error} = await supa.auth.signInWithPassword({email, password: pw});
    if(!error && data && data.user){
      supaOk = true;
      const {data:profile} = await supa.from('profiles').select('*').eq('id',data.user.id).single();
      currentUser = profile ? {
        id:profile.id, name:profile.name, email:profile.email, role:profile.role||'admin',
        status:profile.status||'active',
        initials: profile.initials||(profile.name||'').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase(),
        color:profile.color||'#0F6E56', tc:profile.tc||'#E1F5EE', lastLogin:'Just now', password:''
      } : {
        id:data.user.id, name:email, email:email, role:'admin', status:'active',
        initials:email.slice(0,2).toUpperCase(), color:'#0F6E56', tc:'#E1F5EE', lastLogin:'Just now', password:''
      };
      try { await loadSupabaseData(); } catch(e){ console.warn('Data load error:', e); }
    }
  } catch(e){
    console.warn('Supabase auth error:', e);
    // If supa is null, show a clearer error than "incorrect password"
    if(!supa){
      btn.textContent = 'Sign in →';
      btn.disabled = false;
      errEl.textContent = 'Connection error — please reload the page and try again.';
      errEl.style.display = 'block';
      return;
    }
  }

  // Fallback to local auth if Supabase failed
  if(!supaOk){
    const user = users.find(u=>u.email.toLowerCase()===email && u.password===pw && u.status==='active');
    if(user){
      currentUser = user;
      user.lastLogin = 'Just now';
      supaOk = true;
    }
  }

  btn.textContent = 'Sign in →';
  btn.disabled = false;

  if(supaOk){
    closePw();
    document.getElementById('crm-panel').classList.add('show');
    document.body.style.overflow='hidden';
    updateCRMForUser();
    initCRM();
  } else {
    inp.classList.add('wrong');
    errEl.textContent = 'Incorrect email or password.';
    errEl.style.display='block';
    setTimeout(()=>inp.classList.remove('wrong'),500);
    inp.value='';
  }
}

async function loadSupabaseData(){
  // NOTE: activity feed lives in `activity_feed` (kind/name columns), not `activity`.
  // We hydrate it separately via loadActivities() below to keep the column mapping
  // (kind→type, name→name) in one place. The 6th slot here used to point at a
  // non-existent `activity` table and silently 404'd on every login.
  const [cR,iR,rrR,refR,dR] = await Promise.all([
    supa.from('clients').select('*',{count:'exact'}).order('created_at',{ascending:false}).range(0,499),
    supa.from('invoices').select('*',{count:'exact'}).order('created_at',{ascending:false}).range(0,499),
    supa.from('referrers').select('*').order('name').range(0,499),
    supa.from('referrals').select('*',{count:'exact'}).order('created_at',{ascending:false}).range(0,499),
    supa.from('deals').select('*').order('created_at',{ascending:false}).range(0,499)
  ]);
  if(cR.data && cR.data.length>0){
    clients.length=0;
    cR.data.forEach(c=>clients.push({
      id:c.id, name:c.name,
      legalName: c.legal_name||'', ein: c.ein||'', website: c.website||'',
      contact:c.contact_name||'', email:c.email||'', phone:c.phone||'',
      contactType: c.contact_type||'',
      additionalEmails: Array.isArray(c.additional_emails) ? c.additional_emails : [],
      street:c.street||'', city:c.city||'', state:c.state||'', zip:c.zip||'',
      billingSame: c.billing_same !== false,
      billingStreet: c.billing_street||'', billingCity: c.billing_city||'',
      billingState: c.billing_state||'',   billingZip: c.billing_zip||'',
      shippingSame: c.shipping_same !== false,
      shippingStreet: c.shipping_street||'', shippingCity: c.shipping_city||'',
      shippingState: c.shipping_state||'',   shippingZip: c.shipping_zip||'',
      liftGate: !!c.lift_gate,
      dockDays: Array.isArray(c.dock_days) ? c.dock_days : (c.dock_days ? [c.dock_days] : []),
      dockHours: c.dock_hours||'',
      commPrefs: Array.isArray(c.comm_prefs) ? c.comm_prefs : (c.comm_prefs ? [c.comm_prefs] : []),
      productTypes: Array.isArray(c.product_types) ? c.product_types : (c.product_types ? [c.product_types] : []),
      service:c.service||'', status:c.status||'lead',
      paymentTerms: c.payment_terms||'Due on receipt',
      paymentMethod: c.payment_method||'',
      leadSource:   c.lead_source||'',
      accountOwner: c.account_owner||'',
      coiOnFile: !!c.coi_on_file, coiExpires: c.coi_expires||'',
      w9OnFile:  !!c.w9_on_file,  w9Received: c.w9_received||'',
      w9FilePath: c.w9_file_path||'',
      taxExempt: !!c.tax_exempt, taxExemptState: c.tax_exempt_state||'',
      taxExemptFilePath: c.tax_exempt_file_path||'',
      paLetterOnFile: !!c.pa_letter_on_file,
      paLetterExpires: c.pa_letter_expires||'',
      paLetterFilePath: c.pa_letter_file_path||'',
      stripeCustomerId: c.stripe_customer_id||'',
      qboCustomerId:    c.qbo_customer_id||'',
      billed:c.total_billed||0,
      notify_overdue_sms: !!c.notify_overdue_sms,
      referredBy:c.referred_by||'', color:c.color||'#1a3a6e', tc:c.tc||'#9FE1CB',
      init:c.initials||(c.name||'').slice(0,2).toUpperCase(), notes:c.notes||'',
      formulationDone: !!c.formulation_done,
      formulationVendor: c.formulation_vendor||'',
      formulationSpend: c.formulation_spend==null?null:parseFloat(c.formulation_spend),
      formulationPct: c.formulation_pct==null?null:parseFloat(c.formulation_pct)
    }));
  }
  if(iR.data && iR.data.length>0){
    invoices.length=0;
    iR.data.forEach(i=>invoices.push({
      id:i.invoice_number||i.id, supaId:i.id, client:i.client_id||'', clientName:i.client_name||'',
      svc:i.service||'', amount:i.amount||0, date:i.invoice_date||'', status:i.status||'draft', notes:i.notes||'',
      paymentTerms: i.payment_terms || '',
      dueDate: i.due_date || '',
      // Also hydrate line items so the dashboard chart can categorize per-line.
      lines: Array.isArray(i.line_items) ? i.line_items : [],
      // Per-invoice card-surcharge waiver (was gl_waive_surcharge_* localStorage).
      waiveCardSurcharge: !!i.waive_card_surcharge
    }));
  }
  if(rrR.data && rrR.data.length>0){
    referrers.length=0;
    rrR.data.forEach(r=>referrers.push({
      id:r.id, name:r.name, rel:r.relationship||'', email:r.email||'',
      phone:r.phone||'', rate:r.default_rate||5, color:r.color||'#1a3a6e',
      tc:r.tc||'#9FE1CB', init:r.initials||(r.name||'').slice(0,2).toUpperCase(), notes:r.notes||''
    }));
  }
  if(refR.data && refR.data.length>0){
    referrals.length=0;
    refR.data.forEach(r=>{
      const rr=referrers.find(x=>x.id===r.referrer_id);
      referrals.push({
        id:r.id, referrerId:r.referrer_id||'', referrerName:rr?rr.name:'',
        clientName:r.client_name||'', dealValue:r.deal_value||0,
        rate:r.commission_rate||5, commAmount:r.commission_amount||0,
        status:r.status||'lead', datePaid:r.date_paid||null,
        notes:r.notes||'', date:(r.created_at||'').split('T')[0]
      });
    });
  }
  if(dR.data && dR.data.length>0){
    const stages=['Prospecting','Proposal','Negotiation','Closed Won','Closed Lost'];
    stages.forEach(s=>{deals[s]=[];});
    dR.data.forEach(d=>{
      if(deals[d.stage]) deals[d.stage].push({
        id:d.id, name:d.name, co:d.client_name||'',
        val:'$'+(d.value||0).toLocaleString(), prob:d.probability||20,
        notes:d.notes||'',
        contactName:d.contact_name||'', email:d.email||'', phone:d.phone||'',
        city:d.city||'', state:d.state||'', service:d.service||'',
        productType:d.product_type||'', volume:d.volume||'',
        timeline:d.timeline||'', fundingStage:d.funding_stage||'',
        leadSource:d.lead_source||'',
        outreachStatus:d.outreach_status||null,
        createdAt:d.created_at||null,
        firstResponseAt:d.first_response_at||null,
        handledAt:d.handled_at||null,
        snoozedUntil:d.snoozed_until||null,
        stageEnteredAt:d.stage_entered_at||d.created_at||null,
        formulationDone:!!d.formulation_done,
        formulationVendor:d.formulation_vendor||'',
        formulationSpend:d.formulation_spend==null?null:parseFloat(d.formulation_spend),
        formulationPct:d.formulation_pct==null?null:parseFloat(d.formulation_pct)
      });
    });
  }
  // Truncation guard: warn if any table was capped at the 500-row limit.
  (function(){
    var over = [];
    if(cR.count  != null && cR.count  > 500) over.push(cR.count  + ' clients');
    if(iR.count  != null && iR.count  > 500) over.push(iR.count  + ' invoices');
    if(refR.count != null && refR.count > 500) over.push(refR.count + ' referrals');
    if(over.length){
      console.warn('[GL] Data load capped at 500 rows per table:', over.join(', '));
      setTimeout(function(){
        if(typeof addNotification === 'function')
          addNotification('Data limit reached','Showing first 500 ' + over[0].split(' ')[1] + ' — use search to find more.','warning');
      }, 1500);
    }
  })();

  // Activity feed: pull from `activity_feed` via loadActivities (kind→type mapping).
  try { await loadActivities(); } catch(e){ console.warn('[GL] loadActivities failed', e); }
  // Hydrate the follow-up log from Supabase (replaces the old gl_followup_log
  // localStorage store — see migration 20260519_followup_acks_waivers.sql).
  try { await loadFollowupLog(); } catch(e){ console.warn('[GL] loadFollowupLog failed', e); }
  // Deal activity timestamps — must load before checkStaleDeals() runs at login.
  try { await loadDealActivity(); } catch(e){ console.warn('[GL] loadDealActivity failed', e); }
}

// Override saveInvoice to also write to Supabase
const _origSaveInvoice = saveInvoice;
async function saveInvoice(status){
  const cid=document.getElementById('inv-client').value;
  if(!cid){alert('Please select a client.');return}
  const c=clients.find(x=>x.id===cid);
  const{lines,total,desc}=calcTotal();
  const date=document.getElementById('inv-date').value||new Date().toISOString().split('T')[0];
  const notes=document.getElementById('inv-notes')?.value||'';
  const num='GL-'+new Date().getFullYear()+'-'+(Math.floor(Math.random()*9000)+1000);
  // Write to Supabase
  try {
    const {error} = await supa.from('invoices').insert([{
      invoice_number:num, client_id:/^[0-9a-f-]{36}$/i.test(cid)?cid:null, client_name:c?.name||'',
      service:desc, amount:total, status, invoice_date:date,
      due_date:new Date(Date.now()+30*86400000).toISOString().split('T')[0], notes, line_items:lines.map(l=>({desc:l.d,qty:1,unitPrice:l.a,total:l.a}))
    }]);
    if(error) console.error('[GL] saveInvoice insert error', error.message);
  } catch(e){ console.error('[GL] saveInvoice threw', e); }
  // Update local array
  invoices.push({id:num,client:cid,clientName:c?.name||'',svc:desc,amount:total,date,status,notes,lineItems:lines.map(l=>({desc:l.d,qty:1,unitPrice:l.a,total:l.a}))});
  if(c) c.billed+=total;
  renderInvoices();renderDash();renderClients();
  cNav('invoices',document.querySelector('.cni[onclick*="invoices"]'));
  setTimeout(()=>viewInvoice(num),150);
}

async function saveReferral(){
  const refId=document.getElementById('ref-referrer-sel').value;
  const clientName=document.getElementById('ref-client-name').value.trim();
  if(!refId||!clientName){alert('Please fill in referrer and client name.');return}
  const ref=referrers.find(r=>r.id===refId);
  const deal=parseFloat(document.getElementById('ref-deal').value)||0;
  const rate=parseFloat(document.getElementById('ref-rate').value)||5;
  const comm=Math.round(deal*rate/100);
  const status=document.getElementById('ref-status-sel').value;
  const notes=document.getElementById('ref-notes').value;
  // Write to Supabase and capture the returned UUID so later updates can sync.
  const ins = await glCheckedInsert(sb => sb.from('referrals').insert([{
    referrer_id:refId, client_name:clientName, deal_value:deal,
    commission_rate:rate, commission_amount:comm, status, notes
  }]).select().single());
  if(!ins.ok){
    alert('The referral was NOT saved: ' + ins.reason + '\n\nNothing has been recorded. Please try again.');
    return;
  }
  const id = ins.row.id;
  referrals.push({id,referrerId:refId,referrerName:ref.name,clientName,dealValue:deal,rate,commAmount:comm,status,datePaid:null,notes,date:new Date().toISOString().split('T')[0]});
  activities.unshift({type:'ref',icon:'🤝',name:`New referral from ${ref.name}`,detail:`${clientName} — potential $${comm.toLocaleString()} commission`,time:'Just now'});saveActivities();
  renderReferrals();renderDash();renderActivity();
  closeRefModal();
  glNotifyDeal('new_referral', {name: clientName, company: ref.name, amount: String(comm)});
  document.getElementById('ref-client-name').value='';
  document.getElementById('ref-notes').value='';
}

// Override saveReferrer to also write to Supabase
const _origSaveReferrer = saveReferrer;
async function saveReferrer(){
  const name=document.getElementById('nr-name').value.trim();
  if(!name){alert('Please enter a name.');return}
  const init=name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);
  const colors=['#1a3a6e','#0F6E56','#854F0B','#3C3489','#712B13'];
  const tcs=['#9FE1CB','#E1F5EE','#FAEEDA','#EEEDFE','#FAECE7'];
  const ci=referrers.length%colors.length;
  const rel=document.getElementById('nr-rel').value;
  const email=document.getElementById('nr-email').value;
  const phone=document.getElementById('nr-phone').value;
  const rate=parseFloat(document.getElementById('nr-rate').value)||5;
  const notes=document.getElementById('nr-notes').value;
  // Write to Supabase
  const ins = await glCheckedInsert(sb => sb.from('referrers').insert([{
    name, relationship:rel, email, phone, default_rate:rate,
    initials:init, color:colors[ci], tc:tcs[ci], notes
  }]).select().single());
  if(!ins.ok){
    alert('The referrer was NOT saved: ' + ins.reason + '\n\nNothing has been recorded. Please try again.');
    return;
  }
  const rid = ins.row.id;
  referrers.push({id:rid,name,rel,email,phone,rate,color:colors[ci],tc:tcs[ci],init,notes});
  populateReferrerSelects();renderReferrers();renderDash();closeAddReferrer();
  ['nr-name','nr-email','nr-phone','nr-notes'].forEach(id=>document.getElementById(id).value='');
}

// Override logoutCRM to sign out of Supabase
const _origLogout = logoutCRM;
function logoutCRM(){
  crmInited = false;
  supa.auth.signOut();
  currentUser=null;
  exitCRM();
  const em=document.getElementById('pw-email');
  const pw=document.getElementById('pw-input');
  if(em)em.value='';
  if(pw)pw.value='';
  document.getElementById('pw-err').style.display='none';
}

// Add client to Supabase when saved
const addClientBtn = document.querySelector && document.querySelector('#add-client-btn');
// Patch saveClient if it exists  
setTimeout(()=>{
  const origSaveClient = window.saveClient;
  if(typeof origSaveClient === 'function'){
    window.saveClient = async function(){
      // Call original first to get local state
      origSaveClient();
      // Then sync last added client to Supabase
      const c = clients[clients.length-1];
      if(c) await supa.from('clients').insert([{
        name:c.name, contact_name:c.contact, email:c.email,
        service:c.service, status:c.status, total_billed:c.billed||0,
        initials:c.init, color:c.color, tc:c.tc, notes:c.notes||''
      }]);
    };
  }
},500);


/* ═══════════════════════════════════════════════
   ADD CLIENT / ADD DEAL / PIPELINE MOVE — with Supabase
   ═══════════════════════════════════════════════ */

function openAddClientModal(){
  // Populate referrer dropdown
  const sel = document.getElementById('nc-referrer');
  sel.innerHTML = '<option value="">None</option>' + referrers.map(r=>`<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('');
  // Populate account-owner dropdown from CRM users; default to current user.
  const own = document.getElementById('nc-account-owner');
  if(own){
    const userList = (window.users||[]).filter(u=>u.status!=='inactive');
    own.innerHTML = '<option value="">Unassigned</option>' +
      userList.map(u=>`<option value="${esc(u.id)}">${esc(u.name)} (${esc(u.role)})</option>`).join('');
    if(window.currentUser) own.value = window.currentUser.id;
  }
  document.getElementById('add-client-modal').classList.add('show');
}
function closeAddClientModal(){
  document.getElementById('add-client-modal').classList.remove('show');
  ['nc-name','nc-legal-name','nc-ein','nc-website',
   'nc-contact','nc-email','nc-phone','nc-contact-type',
   'nc-street','nc-city','nc-state','nc-zip',
   'nc-billing-street','nc-billing-city','nc-billing-state','nc-billing-zip',
   'nc-shipping-street','nc-shipping-city','nc-shipping-state','nc-shipping-zip',
   'nc-dock-hours',
   'nc-lead-source','nc-payment-method',
   'nc-coi-expires','nc-w9-received','nc-tax-exempt-state','nc-pa-letter-expires',
   'nc-w9-file','nc-tax-exempt-file','nc-pa-letter-file',
   'nc-notes'].forEach(id=>{
    const el=document.getElementById(id); if(el) el.value='';
  });
  ['nc-comm-email','nc-comm-sms','nc-comm-whatsapp','nc-comm-wechat'].forEach((id,i)=>{
    const el=document.getElementById(id); if(el) el.checked = (i===0); // re-default to Email only
  });
  ['nc-pt-seltzer','nc-pt-soda','nc-pt-coldbrew','nc-pt-juice','nc-pt-rtd',
   'nc-pt-energy','nc-pt-mocktail','nc-pt-sparkling','nc-pt-sports','nc-pt-other',
   'nc-coi-on-file','nc-w9-on-file','nc-tax-exempt','nc-pa-letter','nc-lift-gate',
   'nc-dock-mon','nc-dock-tue','nc-dock-wed','nc-dock-thu','nc-dock-fri','nc-dock-sat','nc-dock-sun'].forEach(id=>{
    const el=document.getElementById(id); if(el) el.checked = false;
  });
  const sameBill = document.getElementById('nc-billing-same');
  if(sameBill) sameBill.checked = true;
  const billBlock = document.getElementById('nc-billing-block');
  if(billBlock) billBlock.style.display = 'none';
  const sameShip = document.getElementById('nc-shipping-same');
  if(sameShip) sameShip.checked = true;
  const shipBlock = document.getElementById('nc-shipping-block');
  if(shipBlock) shipBlock.style.display = 'none';
  const pt = document.getElementById('nc-payment-terms');
  if(pt) pt.value = 'Due on receipt';
}

/* Upload a compliance doc (W-9, sales-tax exemption cert) to the
   client-docs bucket. Returns the storage path or '' on failure.
   Exposed on window so fix.js (Edit Client modal) can reuse it. */
async function uploadComplianceDoc(file, clientId, kind){
  window.__lastUploadError = '';
  if(!file || !window.supa){ window.__lastUploadError = 'Not signed in / storage unavailable'; return ''; }
  try {
    const ext = (file.name.split('.').pop() || 'pdf').toLowerCase();
    const path = `${clientId}/compliance/${kind}_${Date.now()}.${ext}`;
    const { error } = await window.supa.storage.from('client-docs').upload(path, file, { cacheControl:'3600', upsert:false });
    if(error){ console.warn('[GL] compliance upload error', error); window.__lastUploadError = (error && (error.message || error.error || error.statusCode)) || 'upload rejected'; return ''; }
    return path;
  } catch(e){ console.warn('[GL] compliance upload threw', e); window.__lastUploadError = (e && e.message) || String(e); return ''; }
}
window.uploadComplianceDoc = uploadComplianceDoc;

async function saveNewClient(){
  const $ = id => document.getElementById(id);
  const v = id => ($(id) ? $(id).value.trim() : '');
  const ck = id => !!($(id) && $(id).checked);
  const file = id => { const el = $(id); return el && el.files && el.files[0] ? el.files[0] : null; };

  const name = v('nc-name');
  if(!name){alert('Brand name is required.');return;}
  const legalName = v('nc-legal-name');
  const ein       = v('nc-ein');
  const website   = v('nc-website');
  const contact   = v('nc-contact');
  const email     = v('nc-email');
  const phone     = v('nc-phone');
  const contactType = v('nc-contact-type');
  const street    = v('nc-street');
  const city      = v('nc-city');
  const state     = v('nc-state').toUpperCase();
  const zip       = v('nc-zip');

  const billingSame = ck('nc-billing-same');
  const billingStreet = billingSame ? street : v('nc-billing-street');
  const billingCity   = billingSame ? city   : v('nc-billing-city');
  const billingState  = billingSame ? state  : v('nc-billing-state').toUpperCase();
  const billingZip    = billingSame ? zip    : v('nc-billing-zip');

  const shippingSame  = ck('nc-shipping-same');
  const shippingStreet= shippingSame ? billingStreet : v('nc-shipping-street');
  const shippingCity  = shippingSame ? billingCity   : v('nc-shipping-city');
  const shippingState = shippingSame ? billingState  : v('nc-shipping-state').toUpperCase();
  const shippingZip   = shippingSame ? billingZip    : v('nc-shipping-zip');

  const liftGate  = ck('nc-lift-gate');
  const dockDays  = ['mon','tue','wed','thu','fri','sat','sun'].filter(d => ck('nc-dock-'+d));
  const dockHours = v('nc-dock-hours');

  const commPrefs = [
    ck('nc-comm-email')    ? 'email'    : null,
    ck('nc-comm-sms')      ? 'sms'      : null,
    ck('nc-comm-whatsapp') ? 'whatsapp' : null,
    ck('nc-comm-wechat')   ? 'wechat'   : null
  ].filter(Boolean);

  const productTypes = [
    ck('nc-pt-seltzer')   ? 'seltzer'   : null,
    ck('nc-pt-soda')      ? 'soda'      : null,
    ck('nc-pt-coldbrew')  ? 'coldbrew'  : null,
    ck('nc-pt-juice')     ? 'juice'     : null,
    ck('nc-pt-rtd')       ? 'rtd'       : null,
    ck('nc-pt-energy')    ? 'energy'    : null,
    ck('nc-pt-mocktail')  ? 'mocktail'  : null,
    ck('nc-pt-sparkling') ? 'sparkling' : null,
    ck('nc-pt-sports')    ? 'sports'    : null,
    ck('nc-pt-other')     ? 'other'     : null
  ].filter(Boolean);

  const service       = v('nc-service');
  const status        = v('nc-status') || 'lead';
  const paymentTerms  = v('nc-payment-terms') || 'Due on receipt';
  const paymentMethod = v('nc-payment-method');
  const leadSource    = v('nc-lead-source');
  const accountOwner  = v('nc-account-owner');
  const referredBy    = v('nc-referrer');
  const coiOnFile     = ck('nc-coi-on-file');
  const coiExpires    = v('nc-coi-expires') || null;
  let   w9OnFile      = ck('nc-w9-on-file');
  let   w9Received    = v('nc-w9-received') || null;
  let   taxExempt     = ck('nc-tax-exempt');
  const taxExemptState= v('nc-tax-exempt-state').toUpperCase();
  let   paLetterOnFile = ck('nc-pa-letter');
  const paLetterExpires= v('nc-pa-letter-expires') || null;
  const w9File         = file('nc-w9-file');
  const taxExemptFile  = file('nc-tax-exempt-file');
  const paLetterFile   = file('nc-pa-letter-file');
  // Uploading a doc implies "on file".
  if(w9File){ w9OnFile = true; if(!w9Received) w9Received = new Date().toISOString().slice(0,10); }
  if(taxExemptFile) taxExempt = true;
  if(paLetterFile)  paLetterOnFile = true;
  const notes         = v('nc-notes');

  const init = name.split(' ').map(w=>w[0]||'').join('').toUpperCase().slice(0,2);
  const colors=['#1a3a6e','#0F6E56','#854F0B','#3C3489','#712B13','#27500A','#444441','#712B13'];
  const tcs=['#9FE1CB','#E1F5EE','#FAEEDA','#EEEDFE','#FAECE7','#EAF3DE','#F1EFE8','#FAECE7'];
  const ci = clients.length % colors.length;
  const color = colors[ci], tc = tcs[ci];

  // Placeholder id, used only to detect that the insert did not return one.
  // It is never persisted or used as a real key — see the guard after the try.
  const localId = 'c_' + Date.now();

  // Try Supabase save
  let cid = localId;
  let insertError = '';
  try {
    const {data:newC, error} = await supa.from('clients').insert([{
      name, legal_name:legalName, ein, website,
      contact_name:contact, email, phone, contact_type: contactType || null,
      street, city, state, zip,
      billing_same: billingSame,
      billing_street: billingStreet, billing_city: billingCity,
      billing_state: billingState, billing_zip: billingZip,
      shipping_same: shippingSame,
      shipping_street: shippingStreet, shipping_city: shippingCity,
      shipping_state: shippingState, shipping_zip: shippingZip,
      lift_gate: liftGate, dock_days: dockDays, dock_hours: dockHours,
      comm_prefs: commPrefs,
      service, status, payment_terms: paymentTerms,
      payment_method: paymentMethod || null,
      lead_source:    leadSource || null,
      account_owner: accountOwner || null,
      referred_by: referredBy || null,
      product_types: productTypes,
      coi_on_file: coiOnFile, coi_expires: coiExpires,
      w9_on_file: w9OnFile, w9_received: w9Received,
      tax_exempt: taxExempt, tax_exempt_state: taxExemptState || null,
      pa_letter_on_file: paLetterOnFile, pa_letter_expires: paLetterExpires,
      notes, total_billed:0,
      initials:init, color, tc
    }]).select().single();
    if(newC && !error) cid = newC.id;
    if(error) insertError = error.message;
  } catch(e){ insertError = (e && e.message) ? e.message : String(e); }

  /* Stop here if the client was not actually created. Previously cid stayed as
     the local 'c_<timestamp>' placeholder and execution continued: the
     compliance documents below were uploaded under a path keyed to an id that
     exists in no table, the record was pushed into the local array
     unconditionally, and a "client saved" toast fired. The row was gone on
     reload, and the uploaded W-9 / tax-exempt / PA letter were orphaned in
     storage under an id nothing references. */
  if(cid === localId){
    alert('The client was NOT saved: ' + (insertError || 'the server did not return the new record') +
          '\n\nNothing has been recorded, and no documents were uploaded. Please try again.');
    return;
  }

  // Upload compliance docs (after insert so the path can use the real cid)
  let w9FilePath = '', taxExemptFilePath = '', paLetterFilePath = '';
  if(w9File){
    w9FilePath = await uploadComplianceDoc(w9File, cid, 'w9');
    if(w9FilePath){
      try { await window.supa.from('clients').update({ w9_file_path: w9FilePath }).eq('id', cid); } catch(e){}
    }
  }
  if(taxExemptFile){
    taxExemptFilePath = await uploadComplianceDoc(taxExemptFile, cid, 'tax_exempt');
    if(taxExemptFilePath){
      try { await window.supa.from('clients').update({ tax_exempt_file_path: taxExemptFilePath }).eq('id', cid); } catch(e){}
    }
  }
  if(paLetterFile){
    paLetterFilePath = await uploadComplianceDoc(paLetterFile, cid, 'pa_letter');
    if(paLetterFilePath){
      try { await window.supa.from('clients').update({ pa_letter_file_path: paLetterFilePath }).eq('id', cid); } catch(e){}
    }
  }

  // Safe to cache locally: the guard above returned unless the database
  // created the row, so cid is a real id.
  clients.push({
    id:cid, name, legalName, ein, website,
    contact, email, phone, contactType,
    street, city, state, zip,
    billingSame, billingStreet, billingCity, billingState, billingZip,
    shippingSame, shippingStreet, shippingCity, shippingState, shippingZip,
    liftGate, dockDays, dockHours,
    commPrefs, productTypes,
    service, status, paymentTerms, paymentMethod, leadSource, accountOwner,
    coiOnFile, coiExpires, w9OnFile, w9Received, w9FilePath,
    taxExempt, taxExemptState, taxExemptFilePath,
    paLetterOnFile, paLetterExpires, paLetterFilePath,
    billed:0, referredBy, color, tc, init, notes
  });

  // Update UI
  renderClients();
  renderDash();
  closeAddClientModal();
  glNotifyDeal('new_client', {name, contact, email, phone, service, lead_source: leadSource||''});

  // Show confirmation
  const toast = document.createElement('div');
  toast.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:var(--teal);color:var(--ink);padding:12px 24px;border-radius:8px;font-weight:700;z-index:999;font-size:14px';
  toast.textContent = '✓ Client saved!';
  document.body.appendChild(toast);
  setTimeout(()=>toast.remove(), 3000);
}

function openAddDealModal(){
  document.getElementById('add-deal-modal').classList.add('show');
}
function closeAddDealModal(){
  document.getElementById('add-deal-modal').classList.remove('show');
  ['nd-name','nd-co','nd-val','nd-notes'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('nd-prob').value='20';
}

async function saveNewDeal(){
  const name = document.getElementById('nd-name').value.trim();
  if(!name){alert('Deal name is required.');return}
  const co = document.getElementById('nd-co').value.trim();
  const contactName = (document.getElementById('nd-contact')||{}).value ? document.getElementById('nd-contact').value.trim() : '';
  const email = (document.getElementById('nd-email')||{}).value ? document.getElementById('nd-email').value.trim() : '';
  const phone = (document.getElementById('nd-phone')||{}).value ? document.getElementById('nd-phone').value.trim() : '';
  const val = parseFloat(document.getElementById('nd-val').value)||0;
  const stage = document.getElementById('nd-stage').value;
  const prob = parseInt(document.getElementById('nd-prob').value)||20;
  const notes = document.getElementById('nd-notes').value.trim();

  // Save to Supabase. contact_name/email/phone let a manually-added lead be
  // emailed and converted to a client — the same columns the quote form fills.
  const ins = await glCheckedInsert(sb => sb.from('deals').insert([{
    name, client_name:co, contact_name:contactName||null, email:email||null, phone:phone||null,
    value:val, stage, probability:prob, notes
  }]).select().single());
  if(!ins.ok){
    alert('The deal was NOT saved: ' + ins.reason + '\n\nNothing has been recorded. Please try again.');
    return;
  }
  const newD = ins.row;
  const did = newD.id;
  if(!deals[stage]) deals[stage]=[];
  deals[stage].push({id:did, name, co, contactName, email, phone, val:'$'+val.toLocaleString(), prob, notes, stageEnteredAt: newD?.stage_entered_at || new Date().toISOString()});
  renderKanban(); renderDash();

  // Update pipeline subtitle
  const total = Object.values(deals).flat().length;
  const el = document.getElementById('pipe-sub');
  if(el) el.textContent = total + ' active deals';

  // No direct alert here: the insert into `deals` above fires the
  // on_deal_insert DB trigger, which sends the WhatsApp/email server-side.
  // Calling glNotifyDeal too would alert Mike twice per new deal.

  closeAddDealModal();
}

/* The second `async function quickPaid` used to live here. Two top-level
   declarations of the same name in the same script scope: the later one wins,
   so THIS was the live implementation and the fuller one above it was dead
   code. That mattered — this version wrote only {status:'paid'}, so paid_at
   and paid_method were never set, and crm-accounting.js reads paid_at for AR
   aging. It also matched on invoice_number only, and fired the paid alert
   whether or not the write succeeded.
   Removed so the single checked implementation above is the one that runs. */

/* ──────────────────────────────────────────────────────────
   SMS overdue reminder — sends a single short SMS to the
   client's phone via the send-sms Edge Function. Gated by
   client.notify_overdue_sms (opt-in only) so we don't spam
   customers who haven't consented. Logs to followup_log with
   channel='sms' so the invoice's follow-up history stays
   accurate.
   ────────────────────────────────────────────────────────── */
function normalizePhoneE164(raw){
  if(!raw) return '';
  const digits = String(raw).replace(/\D+/g, '');
  if(!digits) return '';
  if(digits.length === 10) return '+1' + digits;             // US default
  if(digits.length === 11 && digits[0] === '1') return '+' + digits;
  if(String(raw).trim().startsWith('+')) return '+' + digits; // already had a +, just rebuild
  return '';
}
async function sendInvoiceSmsReminder(invoiceId){
  const inv = (window.invoices||[]).find(i => i.id === invoiceId);
  if(!inv){ alert('Invoice not found.'); return; }
  const client = (window.clients||[]).find(c => c.id === inv.client);
  if(!client){ alert('No client on this invoice — add one first.'); return; }
  if(!client.notify_overdue_sms){
    alert('Client has NOT opted in to SMS reminders.\n\nOpen the Edit Client modal for "' + client.name + '" and check "SMS overdue reminders" first. SMS opt-in must be explicit.');
    return;
  }
  const phone = normalizePhoneE164(client.phone);
  if(!phone){
    alert('No valid phone number on file for ' + client.name + '. Add one via Edit Client (10-digit US or E.164 international).');
    return;
  }
  const eff = (typeof effectiveInvoiceStatus === 'function') ? effectiveInvoiceStatus(inv) : inv.status;
  if(eff !== 'overdue'){
    if(!confirm('This invoice is "' + eff + '", not overdue. Send SMS anyway?')) return;
  }
  const amt = Number(inv.amount) || 0;
  const due = inv.dueDate ? new Date(inv.dueDate).toLocaleDateString('en-US', {month:'short', day:'numeric'}) : 'recently';
  const body = 'Good Liquid Bev Co: friendly reminder — invoice ' + inv.id +
    ' for $' + amt.toLocaleString() + ' was due ' + due +
    '. Pay online: ' + (window.location.origin || 'https://goodliquidbevco.com') + '/?inv=' + inv.id +
    ' — Reply STOP to opt out.';
  const sender = (typeof window.sendSMS === 'function') ? window.sendSMS : null;
  if(!sender){
    alert('SMS infrastructure not loaded yet. Reload the page and try again.');
    return;
  }
  if(typeof window.glStartBusy === 'function') window.glStartBusy('Sending SMS reminder…');
  let ok = false;
  try { ok = await sender(body, { to: phone }); }
  finally { if(typeof window.glEndBusy === 'function') window.glEndBusy(); }
  // Log every attempt (success or failure)
  try {
    await supa.from('followup_log').insert({
      invoice_id:     inv.supaId || null,
      invoice_number: inv.id,
      kind:           'manual',
      channel:        'sms',
      sent:           !!ok,
      cc_count:       0,
      notes:          'SMS reminder to ' + phone
    });
  } catch(e){ console.warn('[GL] followup_log SMS insert failed', e); }
  if(typeof window.glAudit === 'function'){
    window.glAudit('invoice_sms_reminder', inv.id, { to: phone, amount: amt, ok: ok });
  }
  if(ok){
    if(typeof addNotification === 'function') addNotification('📱 SMS reminder sent', inv.id + ' → ' + client.name, 'success');
    alert('✓ SMS reminder dispatched to ' + phone + '.');
  } else {
    alert('✗ SMS send failed. Open the SMS Alerts modal (top toolbar) and run a test send to confirm Twilio credentials are configured.');
  }
}
window.sendInvoiceSmsReminder = sendInvoiceSmsReminder;

/* Manually fire the daily-digest Edge Function. Bound to the "📨 Send
   digest" admin button so Mike can test before waiting for the 11 UTC
   cron. Returns the function's JSON report so DevTools shows the
   recipient + send counts. */
async function runDailyDigestNow(){
  if(!supa){ alert('Supabase client not ready.'); return; }
  if(!confirm('Send today\'s activity digest to every opted-in staff user RIGHT NOW?\n\n(This bypasses the daily 7am schedule. Useful for testing or when a major event just happened.)')) return;
  if(typeof window.glStartBusy === 'function') window.glStartBusy('Building digest…');
  let report = null;
  try {
    const r = await supa.functions.invoke('daily-digest', { body: { source: 'manual' } });
    if(r.error){ alert('Digest failed: ' + r.error.message); return; }
    report = r.data;
  } catch(e){
    alert('Digest threw: ' + (e.message || e));
    return;
  } finally {
    if(typeof window.glEndBusy === 'function') window.glEndBusy();
  }
  if(report && report.skipped){
    alert('⏭ ' + report.skipped + (report.recipients ? '\n(' + report.recipients + ' recipients on file)' : ''));
  } else if(report){
    alert('📨 Digest fired.\n\nRecipients: ' + (report.recipients||0) + '\nSent: ' + (report.sent||0) + '\nFailed: ' + (report.failed||0) + (report.errors && report.errors.length ? '\n\nErrors:\n' + report.errors.join('\n') : ''));
  } else {
    alert('📨 Digest fired (no report returned).');
  }
}
window.runDailyDigestNow = runDailyDigestNow;

// Move deal between stages (on kanban cards)
async function moveDeal(dealId, fromStage, toStage, fallbackIdx){
  const stageDeals = deals[fromStage];
  if(!stageDeals) return;
  let idx = dealId ? stageDeals.findIndex(d=>d.id===dealId) : -1;
  if(idx===-1 && fallbackIdx!==undefined) idx = fallbackIdx;
  if(idx===-1) return;
  const deal = stageDeals.splice(idx,1)[0];
  if(!deals[toStage]) deals[toStage]=[];
  const now = new Date().toISOString();
  deal.stageEnteredAt = now;
  deals[toStage].push(deal);
  // Save to Supabase (only for real ids, not temp ones)
  if(dealId && !String(dealId).startsWith('tmp_')){
    try { await supa.from('deals').update({stage:toStage, stage_entered_at:now}).eq('id',dealId); } catch(e){ console.warn('Move save failed',e); }
  }
  touchDeal(deal.name || deal.co || dealId);
  renderKanban(); renderDash();
  if(toStage === 'Closed Won') glNotifyDeal('deal_closed_won', {name: deal.name||'', company: deal.co||'', stage:'Closed Won', value: String(deal.val||''), email: deal.email||'', phone: deal.phone||''});
}

window.glFilterPipeline = function(query){
  var q = (query||'').toLowerCase().trim();
  var cards = document.querySelectorAll('.kcard');
  cards.forEach(function(card){
    if(!q){ card.style.display = ''; return; }
    // Prefer the deal's data haystack (company + email + contact + …); fall
    // back to visible text for any card that predates data-search.
    var hay = card.getAttribute('data-search') || card.innerText.toLowerCase();
    card.style.display = hay.indexOf(q) > -1 ? '' : 'none';
  });
  // Also show/hide empty-column messages
  document.querySelectorAll('[id^="gl-pipeline-col-"]').forEach(function(col){
    var visible = Array.from(col.querySelectorAll('.kcard')).filter(function(c){ return c.style.display !== 'none'; });
    var emptyMsg = col.querySelector('.gl-pipeline-empty');
    if(emptyMsg) emptyMsg.style.display = (!q || visible.length) ? 'none' : 'block';
  });
};

// Enhanced renderKanban with move buttons and deal count
function renderKanban(){
  // Load the outreach summary once, then repaint so the follow-up badges
  // appear. Guarded so the repaint cannot loop, and refreshed on a later
  // render only if the data has gone stale (5 min).
  (function ensureOutreachIndex(){
    if(!window.supa || typeof glLoadOutreachIndex !== 'function') return;
    var fresh = renderKanban._outreachAt && (Date.now() - renderKanban._outreachAt) < 300000;
    if(fresh || renderKanban._outreachLoading) return;
    renderKanban._outreachLoading = true;
    glLoadOutreachIndex().then(function(ok){
      renderKanban._outreachLoading = false;
      renderKanban._outreachAt = Date.now();
      if(ok) renderKanban();
    }).catch(function(){ renderKanban._outreachLoading = false; });
  })();
  const sc={'Prospecting':'#6b87ad','Proposal':'#1a6fff','Negotiation':'#f5c842','Closed Won':'#00c4a7','Closed Lost':'#e74c3c'};
  const allStages=['Prospecting','Proposal','Negotiation','Closed Won','Closed Lost'];
  const totalDeals = Object.values(deals).flat().length;
  const el = document.getElementById('pipe-sub');
  if(el) el.textContent = totalDeals + ' active deals';

  document.getElementById('kanban').innerHTML=allStages.map(stage=>{
    const cards=deals[stage]||[];
    const tot=cards.reduce((a,d)=>a+parseInt((d.val||'$0').replace(/[$,]/g,'')),0);
    const otherStages = allStages.filter(s=>s!==stage);
    return`<div class="kcol">
      <div class="kcol-h"><span class="kcol-t" style="color:${sc[stage]}">${stage}</span><span class="kcol-c">${cards.length}</span></div>
      ${cards.map((d,di)=>{
        const obColor = d.outreachStatus==='sent' ? '#f5c842' : d.outreachStatus==='replied' ? '#00c4a7' : d.outreachStatus==='no_response' ? '#e74c3c' : 'transparent';
        const outreachRow = d.outreachStatus==='sent'
          ? `<span style="font-size:10px;background:rgba(245,200,66,.15);border:1px solid rgba(245,200,66,.35);color:#f5c842;border-radius:4px;padding:2px 7px;font-weight:600">✉️ Awaiting reply</span>
             <button onclick="setDealOutreach('${d.id||''}','${stage}',${di},'replied')" style="font-size:9px;padding:2px 7px;background:rgba(0,196,167,.15);border:1px solid rgba(0,196,167,.4);border-radius:4px;color:#00c4a7;cursor:pointer">✓ Replied</button>
             <button onclick="setDealOutreach('${d.id||''}','${stage}',${di},'no_response')" style="font-size:9px;padding:2px 7px;background:rgba(231,76,60,.12);border:1px solid rgba(231,76,60,.35);border-radius:4px;color:#e74c3c;cursor:pointer">No reply</button>`
          : d.outreachStatus==='replied'
          ? `<span style="font-size:10px;background:rgba(0,196,167,.15);border:1px solid rgba(0,196,167,.35);color:#00c4a7;border-radius:4px;padding:2px 7px;font-weight:600">✅ Replied</span>
             <button onclick="setDealOutreach('${d.id||''}','${stage}',${di},null)" style="font-size:9px;padding:2px 7px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:4px;color:var(--muted);cursor:pointer">Clear</button>`
          : d.outreachStatus==='no_response'
          ? `<span style="font-size:10px;background:rgba(231,76,60,.12);border:1px solid rgba(231,76,60,.35);color:#e74c3c;border-radius:4px;padding:2px 7px;font-weight:600">🔕 No response</span>
             <button onclick="setDealOutreach('${d.id||''}','${stage}',${di},null)" style="font-size:9px;padding:2px 7px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:4px;color:var(--muted);cursor:pointer">Clear</button>`
          : `<button onclick="setDealOutreach('${d.id||''}','${stage}',${di},'sent')" style="font-size:9px;padding:2px 7px;background:rgba(245,200,66,.1);border:1px solid rgba(245,200,66,.3);border-radius:4px;color:#f5c842;cursor:pointer">✉️ Log email sent</button>`;
        const leadDateStr = d.createdAt ? new Date(d.createdAt).toLocaleDateString('en-US',{month:'short',day:'numeric'}) : '';
        // Searchable haystack from the deal's real data (company + email +
        // contact + phone + product), so the pipeline search finds a card by
        // company name or email even when that field isn't shown on the card.
        const _search = [d.name,d.co,d.contactName,d.email,d.phone,d.service,d.productType,d.notes]
          .filter(Boolean).join(' ').toLowerCase().replace(/"/g,'&quot;');
        return`<div class="kcard" data-search="${_search}" onclick="openDealDetail('${stage}',${di})" style="cursor:pointer;border-left:3px solid ${obColor}">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:6px">
          <div><div class="kc-n">${esc(d.name)}</div><div class="kc-co">${esc(d.co)}</div></div>
          ${leadDateStr ? `<div style="font-size:10px;color:#6b7fa3;white-space:nowrap;padding-top:3px;flex-shrink:0">${esc(leadDateStr)}</div>` : ''}
        </div>
        ${d.contactName ? `<div style="font-size:11px;color:#9ca3af;margin-top:2px">👤 ${esc(d.contactName)}</div>` : ''}
        ${d.email ? `<div style="font-size:11px;color:#9ca3af;margin-top:1px">✉️ ${esc(d.email)}</div>` : ''}
        ${d.phone ? `<div style="font-size:11px;color:#9ca3af;margin-top:1px">📞 ${esc(d.phone)}</div>` : ''}
        ${(d.service||d.productType) ? `<div style="font-size:10px;color:var(--teal);margin-top:4px;opacity:.8">${esc([d.service,d.productType].filter(Boolean).join(' · '))}</div>` : ''}
        <div class="kc-val">${esc(d.val)}</div>
        ${(()=>{
          // Stage age and outreach state sit on one line, so a glance at the
          // board answers "how long has this sat?" and "did I already nudge?".
          const daysInStage = d.stageEnteredAt
            ? Math.floor((Date.now() - new Date(d.stageEnteredAt).getTime()) / 86400000)
            : null;
          let stagePill = '';
          if(daysInStage !== null && daysInStage >= 3){
            const badge = daysInStage > 14 ? '#e74c3c' : daysInStage > 7 ? '#f5c842' : '#6b87ad';
            stagePill = `<span style="display:inline-block;padding:2px 8px;border-radius:20px;font-size:10px;font-weight:700;background:${badge}22;color:${badge};border:1px solid ${badge}55;white-space:nowrap">${daysInStage}d in stage</span>`;
          }
          const outreachPill = (typeof glOutreachBadge === 'function') ? glOutreachBadge(d.email) : '';
          const slaPill = (typeof glSlaBadge === 'function') ? glSlaBadge(d) : '';
          if(!stagePill && !outreachPill && !slaPill) return '';
          return `<div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:4px">${slaPill}${stagePill}${outreachPill}</div>`;
        })()}
        <div class="kc-prog"><div class="kc-pf" style="width:${d.prob}%;background:${sc[stage]}"></div></div>
        <div style="display:flex;gap:4px;margin-top:8px;flex-wrap:wrap" onclick="event.stopPropagation()">
          ${otherStages.map(s=>`<button onclick="moveDeal('${d.id||''}','${stage}','${s}',${di})" style="font-size:9px;padding:2px 6px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:4px;color:var(--muted);cursor:pointer;white-space:nowrap">→ ${s.split(' ')[0]}</button>`).join('')}
        </div>
        <div style="margin-top:6px;display:flex;align-items:center;gap:4px;flex-wrap:wrap" onclick="event.stopPropagation()">
          ${outreachRow}
        </div>
      </div>`;}).join('')}
      <div style="font-size:10px;color:var(--muted);text-align:center;margin-top:6px">$${(tot/1000).toFixed(0)}K</div>
    </div>`;
  }).join('');
}

// Email outreach status — log from outside the CRM and track response
async function setDealOutreach(dealId, stage, idx, status){
  const stageArr = Array.isArray(deals[stage]) ? deals[stage] : [];
  const d = stageArr[idx];
  if(!d) return;
  d.outreachStatus = status;
  touchDeal(d.name || d.co || dealId);
  renderKanban();
  // Persist to Supabase only for real (UUID) deal IDs
  if(dealId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(dealId))){
    try {
      await supa.from('deals').update({outreach_status: status}).eq('id', dealId);
    } catch(e){ console.warn('[GL] Outreach update failed:', e); }
  }
  if(status === 'sent'){
    activities.unshift({
      type:'email', icon:'✉️',
      name:'Email logged — '+(d.name||d.co),
      detail:'Outreach sent; awaiting reply',
      clientId:'',
      time: new Date().toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'})
    });
    saveActivities();
  }
}
window.setDealOutreach = setDealOutreach;

// ─── LEAD EMAIL COMPOSER ───────────────────────────────────────────────────
// Opened from the deal detail panel. Reads the current deal's data,
// lets you draft with Claude AI, edit freely, then sends via mailgun-send edge function
// and auto-marks the deal's outreach_status as 'sent'.
function openLeadEmailComposer(){
  if(currentDealStage === null || currentDealIdx === null) return;
  const d = (deals[currentDealStage]||[])[currentDealIdx];
  if(!d){ alert('No deal selected.'); return; }
  if(!d.email){ alert('This lead has no email address on file. Add one in the fields above and save first.'); return; }

  const prior = document.getElementById('gl-lead-email-modal');
  if(prior) prior.remove();

  // Build a readable summary of what the lead told us — shown as context
  // inside the composer and fed to Claude for drafting.
  const details = [
    d.contactName  ? `Contact: ${d.contactName}` : null,
    d.co           ? `Company: ${d.co}` : null,
    d.service      ? `Service interest: ${d.service}` : null,
    d.productType  ? `Product type: ${d.productType}` : null,
    d.volume       ? `Volume / year: ${d.volume}` : null,
    d.timeline     ? `Timeline: ${d.timeline}` : null,
    d.fundingStage ? `Funding stage: ${d.fundingStage}` : null,
    d.city || d.state ? `Location: ${[d.city, d.state].filter(Boolean).join(', ')}` : null,
    d.notes        ? `Their message: "${d.notes}"` : null,
  ].filter(Boolean);

  const defaultSubject = `Re: Your inquiry to Good Liquid Bev Co${d.co ? ' — ' + d.co : ''}`;
  const firstName = (d.contactName || '').split(' ')[0] || 'there';

  const ov = document.createElement('div');
  ov.id = 'gl-lead-email-modal';
  ov.setAttribute('style','position:fixed;inset:0;z-index:700;background:rgba(6,13,26,.95);backdrop-filter:blur(10px);display:flex;align-items:flex-start;justify-content:center;padding:24px;overflow-y:auto');

  ov.innerHTML = `
    <div style="background:#142238;border:1px solid rgba(26,111,255,.3);border-radius:16px;width:100%;max-width:760px;padding:26px 28px;color:#fff">

      <!-- Header -->
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px">
        <div style="font-family:var(--ff-disp);font-size:18px;letter-spacing:2px;color:#6b9fff">✉️ EMAIL LEAD — ${esc((d.name||d.co||'').toUpperCase())}</div>
        <button id="gl-lem-close" style="background:none;border:none;color:#9aa7bd;font-size:22px;cursor:pointer;line-height:1">✕</button>
      </div>

      <!-- Lead context card -->
      <div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:10px;padding:12px 16px;margin-bottom:16px;font-size:12px;color:var(--muted);line-height:1.7">
        <div style="font-size:10px;letter-spacing:2px;color:#6b87ad;margin-bottom:6px;font-weight:600">THEIR INQUIRY</div>
        ${details.length ? details.map(l=>`<div>• ${esc(l)}</div>`).join('') : '<div style="font-style:italic">No additional details on file.</div>'}
      </div>

      <!-- Correspondence history + nudge (populated after the modal opens) -->
      <div id="gl-lem-corr" style="margin-bottom:16px"></div>

      <!-- Fields -->
      <div style="display:grid;grid-template-columns:60px 1fr;gap:8px 12px;align-items:center;font-size:13px;margin-bottom:12px">
        <label style="color:var(--muted);font-size:11px;letter-spacing:1px">TO</label>
        <input id="gl-lem-to" class="finp" value="${esc(d.email)}" style="font-size:13px">
        <label style="color:var(--muted);font-size:11px;letter-spacing:1px">BCC</label>
        <input id="gl-lem-bcc" class="finp" value="mike@goodliquid.com" placeholder="optional" style="font-size:13px">
        <label style="color:var(--muted);font-size:11px;letter-spacing:1px">SUBJECT</label>
        <input id="gl-lem-subject" class="finp" value="${esc(defaultSubject)}" style="font-size:13px">
      </div>

      <div style="margin-bottom:14px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
          <div style="font-size:11px;letter-spacing:1px;color:var(--muted)">MESSAGE</div>
          <button id="gl-lem-draft" style="font-size:11px;padding:4px 12px;background:rgba(0,229,192,.12);border:1px solid rgba(0,229,192,.3);border-radius:6px;color:var(--teal);cursor:pointer;display:flex;align-items:center;gap:5px">🤖 Draft with Claude</button>
        </div>
        <textarea id="gl-lem-body" class="finp" rows="12" style="resize:vertical;font-size:13px;line-height:1.6" placeholder="Click '🤖 Draft with Claude' to generate a personalised message, or type your own…"></textarea>
      </div>

      <div id="gl-lem-ai-status" style="font-size:12px;color:var(--teal);min-height:16px;margin-bottom:10px;display:none">🤖 Claude is drafting your email…</div>

      <div id="gl-lem-refine-row" style="display:none;padding:10px 12px;background:rgba(0,229,192,.04);border:1px solid rgba(0,229,192,.15);border-radius:8px;margin-bottom:12px">
        <div style="font-size:10px;letter-spacing:1px;color:var(--muted);margin-bottom:7px">REFINE WITH CLAUDE</div>
        <div style="display:flex;gap:8px">
          <input id="gl-lem-refine" type="text" class="finp" placeholder="e.g. make it shorter, more casual, add pricing details…" style="flex:1;font-size:12px">
          <button id="gl-lem-refine-btn" class="cbtn" style="font-size:12px;white-space:nowrap;background:rgba(0,229,192,.12);border-color:rgba(0,229,192,.3);color:var(--teal)">✨ Apply</button>
        </div>
      </div>

      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button id="gl-lem-cancel" class="cbtn" style="font-size:13px">Cancel</button>
        <button id="gl-lem-send" class="cbtn pri" style="font-size:13px">📤 Send Email</button>
      </div>
      <div id="gl-lem-result" style="margin-top:10px;font-size:12px;color:var(--muted);min-height:18px"></div>
    </div>`;

  document.body.appendChild(ov);
  ov.addEventListener('click', e => { if(e.target === ov) ov.remove(); });
  ov.querySelector('#gl-lem-close').onclick  = () => ov.remove();
  ov.querySelector('#gl-lem-cancel').onclick = () => ov.remove();

  // ── Correspondence history + follow-up nudge ──
  // Loads every email to/from this lead from email_log so Mike can see the
  // full back-and-forth without leaving the composer, and flags leads who
  // were emailed but never replied so they can be nudged.
  async function glLemLoadHistory(){
    var box = ov.querySelector('#gl-lem-corr');
    if(!box || !window.supa || !d.email) return;
    box.innerHTML = '<div style="font-size:11px;color:var(--muted);padding:6px 2px">Loading correspondence…</div>';
    var _res = await window.glLoadEmailLog(d.email, { co: d.co });
    if(_res.error){ box.innerHTML = '<div style="font-size:11px;color:#ff8579;padding:6px 2px">Could not load correspondence.</div>'; return; }
    var rows = _res.rows;

    // Nudge check: newest outbound with no inbound reply after it, ≥3 days old.
    var nudgeHtml = '';
    var lastOut = rows.find(function(x){ return x.direction !== 'inbound'; });
    if(lastOut){
      var lastOutT = new Date(lastOut.sent_at || lastOut.created_at).getTime();
      var replied = rows.some(function(x){ return x.direction === 'inbound' && new Date(x.sent_at || x.created_at).getTime() > lastOutT; });
      var days = Math.floor((Date.now() - lastOutT) / 86400000);
      if(!replied && days >= 3){
        nudgeHtml =
          '<div style="background:rgba(245,200,66,.08);border:1px solid rgba(245,200,66,.3);border-radius:8px;padding:11px 13px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;gap:10px">' +
            '<div style="font-size:12px;color:#f5c842;line-height:1.4">⏰ No reply in ' + days + ' days. Send a friendly nudge to check if they’re still interested.</div>' +
            '<button id="gl-lem-nudge" class="cbtn" style="font-size:12px;white-space:nowrap;background:rgba(245,200,66,.15);border-color:rgba(245,200,66,.4);color:#f5c842">✍️ Draft nudge</button>' +
          '</div>';
      }
    }

    var histHtml;
    if(!rows.length){
      histHtml = '<div style="font-size:11px;color:var(--muted);padding:4px 2px">No emails sent to this lead yet.</div>';
    } else {
      histHtml =
        '<div style="font-size:10px;letter-spacing:2px;color:#6b87ad;margin-bottom:8px;font-weight:600">CORRESPONDENCE (' + rows.length + ')</div>' +
        glRenderCorrespondence('lem', rows);
    }
    box.innerHTML = nudgeHtml + histHtml;

    var nudgeBtn = ov.querySelector('#gl-lem-nudge');
    if(nudgeBtn) nudgeBtn.onclick = function(){
      ov.querySelector('#gl-lem-subject').value = 'Following up — Good Liquid Bev Co' + (d.co ? ' × ' + d.co : '');
      ov.querySelector('#gl-lem-body').value =
        'Hi ' + firstName + ',\n\n' +
        'Just circling back on my note below — I know things get busy! I wanted to make sure it reached you and see if you’re still exploring co-packing for ' + (d.co || 'your brand') + '.\n\n' +
        'If now’s a good time, I’d be happy to set up a quick 20-minute call or a tour of our Palmetto facility. And if the timing isn’t right, just let me know and I’ll check back down the road.\n\n' +
        'Best,\nMike\nGood Liquid Bev Co\n(803) 493-5065';
      ov.querySelector('#gl-lem-body').focus();
    };
  }
  glLemLoadHistory();

  // ── Claude draft button ──
  ov.querySelector('#gl-lem-draft').onclick = async function(){
    const btn      = this;
    const aiStatus = ov.querySelector('#gl-lem-ai-status');
    btn.disabled   = true;
    btn.textContent = '🤖 Drafting…';
    aiStatus.style.display = 'block';

    // Live pricing/capabilities so Claude always uses current numbers.
    // Empty means NO doc is loaded — the prompt then explicitly forbids
    // inventing prices, and the composer shows a warning after drafting.
    let capsDoc = await glGetCapsDoc();

    const systemPrompt = `You are Mike's assistant at Good Liquid Bev Co, a beverage co-packer in Palmetto, FL (2011 51st Ave E, Unit 100). We help emerging beverage brands with R&D, small-batch canning, bottle filling, and co-packing.

Write warm, professional, conversational first-contact emails — not corporate-stiff. Mike's voice is direct, encouraging, and knowledgeable. Keep it to 3–4 short paragraphs. End with a clear next step (a call or facility tour).

When relevant to the lead's interest, reference specific pricing or minimums from our capabilities deck — be concrete, not vague. Do NOT paste a full price table; just mention the relevant numbers naturally in the text.

Output format — two sections separated by a blank line:
SUBJECT: [one-line subject here]

[email body here — start straight with the salutation, no extra labels]

${capsDoc ? `--- GOOD LIQUID CAPABILITIES & PRICING REFERENCE ---\n${capsDoc}` : GL_NO_PRICING_GUARD}`;

    const userPrompt = `Draft a first-contact reply email to this lead who submitted an inquiry on our website:

${details.join('\n')}

Greet them by first name (${firstName}). Acknowledge what they're building and why it's exciting. Mention relevant pricing or minimums from our capabilities deck that apply to their interest. Suggest a 20-minute intro call or facility tour as the next step. Sign off as Mike, Good Liquid Bev Co, (803) 493-5065.`;

    const raw = await callAI(systemPrompt, userPrompt);
    btn.disabled    = false;
    btn.textContent = '🤖 Re-draft with Claude';
    aiStatus.style.display = 'none';

    if(!raw){ ov.querySelector('#gl-lem-result').style.color = '#ff8579'; ov.querySelector('#gl-lem-result').textContent = '⚠ AI draft failed. Type your message manually.'; return; }

    // Parse SUBJECT: line out of the response
    const subjectMatch = raw.match(/^SUBJECT:\s*(.+)/im);
    if(subjectMatch){
      const subjEl = ov.querySelector('#gl-lem-subject');
      if(subjEl) subjEl.value = subjectMatch[1].trim();
    }
    // Body = everything after the first blank line past the SUBJECT line
    const bodyStart = raw.indexOf('\n\n');
    const body = bodyStart > -1 ? raw.slice(bodyStart).trim() : raw.replace(/^SUBJECT:.*\n?/im,'').trim();
    ov.querySelector('#gl-lem-body').value = body;
    ov.querySelector('#gl-lem-result').textContent = '';
    if(!capsDoc){
      // Say it out loud instead of quietly drafting priceless emails — an
      // unloaded pricing doc once had Claude inventing numbers for leads.
      const r = ov.querySelector('#gl-lem-result');
      r.style.color = '#f5c842';
      r.textContent = '⚠ Drafted WITHOUT your pricing doc (none is loaded, so no specific prices were used). Load it: 🤖 toolbar → Quick Actions → 📄 Pricing Doc (AI).';
    }
    ov.querySelector('#gl-lem-refine-row').style.display = 'block';
  };

  ov.querySelector('#gl-lem-refine-btn').onclick = async function(){
    return window.glRunRefine({
      row:      ov.querySelector('#gl-lem-refine-row'),
      instrEl:  ov.querySelector('#gl-lem-refine'),
      subjEl:   ov.querySelector('#gl-lem-subject'),
      bodyEl:   ov.querySelector('#gl-lem-body'),
      btn:      this,
      statusEl: ov.querySelector('#gl-lem-ai-status')
    });
  };

  // ── Send button ──
  ov.querySelector('#gl-lem-send').onclick = async function(){
    const btn     = this;
    const result  = ov.querySelector('#gl-lem-result');
    const toRaw   = ov.querySelector('#gl-lem-to').value.trim();
    const bccRaw  = ov.querySelector('#gl-lem-bcc').value.trim();
    const subject = ov.querySelector('#gl-lem-subject').value.trim();
    const body    = ov.querySelector('#gl-lem-body').value.trim();

    if(!toRaw)  { result.style.color = '#ff8579'; result.textContent = 'To address is required.'; return; }
    if(!subject){ result.style.color = '#ff8579'; result.textContent = 'Subject is required.'; return; }
    if(!body)   { result.style.color = '#ff8579'; result.textContent = 'Message body is required.'; return; }

    btn.disabled = true; btn.textContent = 'Sending…';
    result.style.color = 'var(--muted)'; result.textContent = '';

    const html = `<div style="font-family:Arial,sans-serif;color:#1a1a1a;line-height:1.6;max-width:640px;margin:0 auto">
      <div style="border-top:3px solid #00e5c0;padding:24px 28px">
        <div style="font-size:20px;font-weight:900;color:#00b89a;letter-spacing:2px;margin-bottom:4px">GOOD LIQUID BEV CO</div>
        <div style="font-size:11px;color:#6b87ad">2011 51st Ave E, Unit 100 · Palmetto, FL 34221 · Mike@GoodLiquid.com · (803) 493-5065</div>
      </div>
      <div style="padding:0 28px 28px;white-space:pre-wrap;font-size:14px;line-height:1.7">${body.replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))}</div>
      <div style="padding:14px 28px;border-top:1px solid #e5e7eb;font-size:11px;color:#9ca3af;text-align:center">Good Liquid Bev Co · goodliquidbevco.com</div>
    </div>`;

    const ok = await sendMailgunEmail(toRaw, subject, body, { bcc: bccRaw, html });

    btn.disabled = false; btn.textContent = '📤 Send Email';
    if(ok){
      result.style.color = '#5fcf9e';
      result.textContent = '✓ Sent to ' + toRaw + ' — logged in correspondence below.';
      // Auto-mark outreach status as 'sent'
      if(d.id) await setDealOutreach(d.id, currentDealStage, currentDealIdx, 'sent');
      if(typeof addNotification === 'function') addNotification('📧 Lead emailed', (d.name||d.co) + ' → ' + toRaw, 'email');
      if(typeof window.glAudit === 'function') window.glAudit('lead_emailed', d.id, { to: toRaw, subject });
      // Keep the composer open and refresh the thread so the sent message shows
      // up immediately under this lead (the email_log insert is async — give it
      // a moment to land before re-querying).
      ov.querySelector('#gl-lem-body').value = '';
      setTimeout(glLemLoadHistory, 900);
    } else {
      result.style.color = '#ff8579';
      result.textContent = '✗ Send failed. Check browser console.';
    }
  };
}
window.openLeadEmailComposer = openLeadEmailComposer;

// The pipeline→client→onboarding flow (glConvertLeadToOnboarding, the
// onboardings board, prefill mapping) lives in its own module, crm-onboarding.js
// — kept out of index.html on purpose. The "🚀 Convert to Client & Onboard"
// button above calls window.glConvertLeadToOnboarding, defined there.

// ─── BULK OUTREACH ─────────────────────────────────────────────────────────
// Opens a modal listing all Prospecting leads with no outreach status and a
// valid email. Drafts with Claude AI and sends via mailgun-send edge function for each checked lead.
async function openBulkOutreach(){
  const prior = document.getElementById('gl-bulk-outreach-modal');
  if(prior) prior.remove();

  // Collect Prospecting leads with email and no outreach yet
  const prospects = (deals['Prospecting'] || []).map((d,i) => ({...d, _idx:i}))
    .filter(d => d.email && !d.outreachStatus);

  // Live pricing/capabilities doc for the AI system prompt (empty = the
  // prompt forbids invented prices — see glGetCapsDoc).
  let capsDoc = await glGetCapsDoc();

  const systemPrompt = `You are Mike's assistant at Good Liquid Bev Co, a beverage co-packer in Palmetto, FL (2011 51st Ave E, Unit 100). We help emerging beverage brands with R&D, small-batch canning, bottle filling, and co-packing.

Write warm, professional, conversational first-contact emails — not corporate-stiff. Mike's voice is direct, encouraging, and knowledgeable. Keep it to 3-4 short paragraphs. End with a clear next step (a call or facility tour).

When relevant to the lead's interest, reference specific pricing or minimums from our capabilities deck — be concrete, not vague. Do NOT paste a full price table; just mention the relevant numbers naturally in the text.

Output format — two sections separated by a blank line:
SUBJECT: [one-line subject here]

[email body here — start straight with the salutation, no extra labels]

${capsDoc ? '--- GOOD LIQUID CAPABILITIES & PRICING REFERENCE ---\n' + capsDoc : GL_NO_PRICING_GUARD}`;

  const ov = document.createElement('div');
  ov.id = 'gl-bulk-outreach-modal';
  ov.setAttribute('style','position:fixed;inset:0;z-index:700;background:rgba(6,13,26,.95);backdrop-filter:blur(10px);display:flex;align-items:flex-start;justify-content:center;padding:24px;overflow-y:auto');

  const rowsHtml = prospects.map(function(d,ri){
    return '<tr data-ri="'+ri+'" style="border-bottom:1px solid rgba(255,255,255,.04)">' +
      '<td style="padding:8px 10px"><input type="checkbox" class="gl-bo-chk" data-ri="'+ri+'" checked style="cursor:pointer"></td>' +
      '<td style="padding:8px 10px;color:var(--white)">'+esc(d.name||'—')+'</td>' +
      '<td style="padding:8px 10px;color:var(--muted)">'+esc(d.co||'—')+'</td>' +
      '<td style="padding:8px 10px;color:#6b9fff">'+esc(d.email)+'</td>' +
      '<td style="padding:8px 10px" id="gl-bo-status-'+ri+'"><span style="color:var(--muted);font-size:10px">Pending</span></td>' +
    '</tr>';
  }).join('');

  ov.innerHTML = '<div style="background:#142238;border:1px solid rgba(245,200,66,.25);border-radius:16px;width:100%;max-width:800px;padding:26px 28px;color:#fff">' +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px">' +
      '<div style="font-family:var(--ff-disp);font-size:18px;letter-spacing:2px;color:#d4a200">📤 BULK OUTREACH — PROSPECTING</div>' +
      '<button id="gl-bo-close" style="background:none;border:none;color:#9aa7bd;font-size:22px;cursor:pointer;line-height:1">✕</button>' +
    '</div>' +
    (prospects.length === 0
      ? '<div style="color:var(--muted);font-size:14px;padding:24px 0">No uncontacted Prospecting leads with an email address found.</div>'
      : '<div style="font-size:12px;color:var(--muted);margin-bottom:14px">'+prospects.length+' uncontacted lead'+(prospects.length!==1?'s':'')+' found. All selected by default.</div>' +
        '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px">' +
          '<thead><tr style="border-bottom:1px solid rgba(255,255,255,.08)">' +
            '<th style="text-align:left;padding:6px 10px;color:var(--muted);font-weight:600;width:30px"><input type="checkbox" id="gl-bo-check-all" checked style="cursor:pointer"></th>' +
            '<th style="text-align:left;padding:6px 10px;color:var(--muted);font-weight:600">Name</th>' +
            '<th style="text-align:left;padding:6px 10px;color:var(--muted);font-weight:600">Company</th>' +
            '<th style="text-align:left;padding:6px 10px;color:var(--muted);font-weight:600">Email</th>' +
            '<th style="text-align:left;padding:6px 10px;color:var(--muted);font-weight:600;width:90px">Status</th>' +
          '</tr></thead>' +
          '<tbody id="gl-bo-rows">'+rowsHtml+'</tbody>' +
        '</table></div>' +
        '<div style="margin-top:16px;background:rgba(255,255,255,.03);border-radius:8px;height:6px;overflow:hidden">' +
          '<div id="gl-bo-progress" style="height:100%;background:#d4a200;width:0%;transition:width .3s"></div>' +
        '</div>' +
        '<div id="gl-bo-progress-label" style="font-size:11px;color:var(--muted);margin-top:6px;min-height:16px"></div>'
    ) +
    '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:20px">' +
      '<button id="gl-bo-cancel" class="cbtn" style="font-size:13px">Close</button>' +
      (prospects.length > 0 ? '<button id="gl-bo-send" class="cbtn" style="font-size:13px;background:rgba(245,200,66,.12);border-color:rgba(245,200,66,.3);color:#d4a200">📤 Draft &amp; Send All</button>' : '') +
    '</div>' +
  '</div>';

  document.body.appendChild(ov);
  ov.addEventListener('click', function(e){ if(e.target === ov) ov.remove(); });
  ov.querySelector('#gl-bo-close').onclick  = function(){ ov.remove(); };
  ov.querySelector('#gl-bo-cancel').onclick = function(){ ov.remove(); };

  if(prospects.length === 0) return;

  // Select-all checkbox
  ov.querySelector('#gl-bo-check-all').addEventListener('change', function(){
    ov.querySelectorAll('.gl-bo-chk').forEach(function(chk){ chk.checked = this.checked; }, this);
  });

  // Draft & Send All button
  ov.querySelector('#gl-bo-send').onclick = async function(){
    var btn = this;
    btn.disabled = true;
    btn.textContent = 'Sending...';

    var checked = Array.from(ov.querySelectorAll('.gl-bo-chk')).filter(function(c){ return c.checked; }).map(function(c){ return parseInt(c.dataset.ri); });
    if(!checked.length){ alert('No leads selected.'); btn.disabled=false; btn.textContent='📤 Draft & Send All'; return; }

    var sent = 0;
    var progBar   = ov.querySelector('#gl-bo-progress');
    var progLabel = ov.querySelector('#gl-bo-progress-label');

    for(var ci=0; ci<checked.length; ci++){
      var ri = checked[ci];
      var d = prospects[ri];
      var statusEl = ov.querySelector('#gl-bo-status-'+ri);
      if(!statusEl) continue;

      statusEl.innerHTML = '<span style="color:var(--teal);font-size:10px">🤖 Drafting...</span>';

      try {
        var firstName = ((d.contactName || d.name || '').split(' ')[0]) || 'there';
        var details = [
          d.contactName  ? 'Contact: '+d.contactName : null,
          d.co           ? 'Company: '+d.co : null,
          d.service      ? 'Service interest: '+d.service : null,
          d.productType  ? 'Product type: '+d.productType : null,
          d.volume       ? 'Volume / year: '+d.volume : null,
          d.timeline     ? 'Timeline: '+d.timeline : null,
          d.notes        ? 'Their message: "'+d.notes+'"' : null,
        ].filter(Boolean);

        var userPrompt = 'Draft a first-contact reply email to this lead who submitted an inquiry on our website:\n\n'+details.join('\n')+'\n\nGreet them by first name ('+firstName+'). Acknowledge what they\'re building and why it\'s exciting. Mention relevant pricing or minimums from our capabilities deck that apply to their interest. Suggest a 20-minute intro call or facility tour as the next step. Sign off as Mike, Good Liquid Bev Co, (803) 493-5065.';

        var raw = await callAI(systemPrompt, userPrompt);
        if(!raw) throw new Error('AI returned empty response');

        var subjectMatch = raw.match(/^SUBJECT:\s*(.+)/im);
        var subject = subjectMatch ? subjectMatch[1].trim() : 'Re: Your inquiry to Good Liquid Bev Co'+(d.co?' — '+d.co:'');
        var bodyStart = raw.indexOf('\n\n');
        var body = bodyStart > -1 ? raw.slice(bodyStart).trim() : raw.replace(/^SUBJECT:.*\n?/im,'').trim();

        var htmlBody = '<div style="font-family:Arial,sans-serif;color:#1a1a1a;line-height:1.6;max-width:640px;margin:0 auto">' +
          '<div style="border-top:3px solid #00e5c0;padding:24px 28px">' +
            '<div style="font-size:20px;font-weight:900;color:#00b89a;letter-spacing:2px;margin-bottom:4px">GOOD LIQUID BEV CO</div>' +
            '<div style="font-size:11px;color:#6b87ad">2011 51st Ave E, Unit 100 · Palmetto, FL 34221 · Mike@GoodLiquid.com · (803) 493-5065</div>' +
          '</div>' +
          '<div style="padding:0 28px 28px;white-space:pre-wrap;font-size:14px;line-height:1.7">'+body.replace(/[&<>]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;'}[c];})+'</div>' +
          '<div style="padding:14px 28px;border-top:1px solid #e5e7eb;font-size:11px;color:#9ca3af;text-align:center">Good Liquid Bev Co · goodliquidbevco.com</div>' +
        '</div>';

        statusEl.innerHTML = '<span style="color:var(--muted);font-size:10px">📤 Sending...</span>';
        var ok = await sendMailgunEmail(d.email, subject, body, { bcc: 'mike@goodliquid.com', html: htmlBody });

        if(ok){
          statusEl.innerHTML = '<span style="color:#5fcf9e;font-size:10px">✓ Sent</span>';
          await setDealOutreach(d.id||'', 'Prospecting', d._idx, 'sent');
          if(typeof addNotification === 'function') addNotification('📧 Lead emailed', (d.name||d.co)+' → '+d.email, 'email');
          if(typeof window.glAudit === 'function') window.glAudit('bulk_outreach_sent', d.id, { to: d.email, subject: subject });
          sent++;
        } else {
          statusEl.innerHTML = '<span style="color:#ff8579;font-size:10px">✗ Failed</span>';
        }
      } catch(err){
        console.error('[GL] Bulk outreach error for', d.email, err);
        statusEl.innerHTML = '<span style="color:#ff8579;font-size:10px">✗ Error</span>';
      }

      var pct = Math.round(((ci+1) / checked.length) * 100);
      progBar.style.width = pct + '%';
      progLabel.textContent = (ci+1) + ' / ' + checked.length + ' processed';
    }

    progLabel.textContent = 'Done — '+sent+' sent successfully out of '+checked.length+' attempted.';
    btn.disabled = false;
    btn.textContent = '✓ Complete';
  };
}
window.openBulkOutreach = openBulkOutreach;

// BULK NUDGE — find leads that have gone cold (we emailed them, they never
// replied, and it's been at least N days) and send a friendly follow-up to the
// ones you check off, all in one pass. N is a variable Mike can type: 7, 10,
// 21, whatever. The "who's gone quiet" signal comes from GL_OUTREACH — the same
// per-contact email index the pipeline badges use — so nudge state stays in
// sync with what the cards already show.
async function glOpenBulkNudge(){
  const prior = document.getElementById('gl-bulk-nudge-modal');
  if(prior) prior.remove();

  // Refresh the last-emailed / last-replied index so "days sitting" is current.
  if(typeof glLoadOutreachIndex === 'function'){
    try { await glLoadOutreachIndex(); } catch(_e){ /* fall back to cached */ }
  }
  const IDX = window.GL_OUTREACH || {};

  // Walk every pipeline stage and collect leads that have been sitting for at
  // least minDays. Two ways a lead can be "sitting":
  //   • follow-up — we emailed them, they never wrote back, and it's been a
  //     while (days measured from our last outbound).
  //   • first-touch — nobody has emailed them yet and the lead has sat in the
  //     pipeline that long (days measured from when it entered its stage).
  // Leads who replied, or that are too fresh, are left out. Longest-silent
  // first — those need the poke most.
  function candidates(minDays){
    var out = [], now = Date.now();
    Object.keys(deals || {}).forEach(function(stage){
      (deals[stage] || []).forEach(function(d, idx){
        if(!d || !d.email) return;
        if(d.outreachStatus === 'replied') return;   // already heard back → not sitting
        var e = IDX[String(d.email).trim().toLowerCase()];
        if(e && e.lastOut){
          // We've emailed this lead before.
          if(e.lastIn && e.lastIn > e.lastOut) return; // they replied → not sitting
          var fdays = Math.floor((now - e.lastOut) / 86400000);
          if(fdays < minDays) return;
          out.push({ d:d, stage:stage, idx:idx, email:d.email, days:fdays,
                     kind:'followup', nudges: Math.max(0, (e.sinceReply || 1) - 1) });
        } else {
          // Never emailed — has it been sitting untouched in the pipeline?
          var since = d.stageEnteredAt || d.createdAt || d.created_at;
          if(!since) return;                          // no age to judge → skip
          var t = new Date(since).getTime();
          if(!t) return;
          var udays = Math.floor((now - t) / 86400000);
          if(udays < minDays) return;
          out.push({ d:d, stage:stage, idx:idx, email:d.email, days:udays,
                     kind:'firsttouch', nudges:0 });
        }
      });
    });
    out.sort(function(a,b){ return b.days - a.days; });
    return out;
  }

  // Live pricing/capabilities doc so the follow-up can be concrete when useful.
  let capsDoc = await glGetCapsDoc();

  const systemPrompt = `You are Mike's assistant at Good Liquid Bev Co, a beverage co-packer in Palmetto, FL (2011 51st Ave E, Unit 100). We help emerging beverage brands with R&D, small-batch canning, bottle filling, and co-packing.

Write a SHORT, warm email to a lead who has gone quiet. The context tells you which kind:
• FOLLOW-UP — we've emailed them before and they haven't replied. Reference that you reached out earlier, keep it light and low-pressure, and make it easy to say "not right now."
• FIRST CONTACT — nobody has reached out yet; this lead has been sitting in our pipeline. Introduce Good Liquid warmly, acknowledge what they're building, and open the door.
Either way: 2-3 short paragraphs max, Mike's voice is direct, friendly, and human — never pushy or salesy. End with a soft next step (a quick call or a facility tour) and an explicit "if the timing isn't right, just let me know."

Output format — two sections separated by a blank line:
SUBJECT: [one-line subject here]

[email body here — start straight with the salutation, no extra labels]

${capsDoc ? '--- GOOD LIQUID CAPABILITIES & PRICING REFERENCE ---\n' + capsDoc : GL_NO_PRICING_GUARD}`;

  const DEFAULT_DAYS = 7;
  let list = candidates(DEFAULT_DAYS);

  const ov = document.createElement('div');
  ov.id = 'gl-bulk-nudge-modal';
  ov.setAttribute('style','position:fixed;inset:0;z-index:700;background:rgba(6,13,26,.95);backdrop-filter:blur(10px);display:flex;align-items:flex-start;justify-content:center;padding:24px;overflow-y:auto');

  function rowsHtml(items){
    if(!items.length){
      return '<tr><td colspan="6" style="padding:22px 10px;color:var(--muted);font-size:13px">No leads have been sitting that long. Try a smaller day count.</td></tr>';
    }
    return items.map(function(c,ri){
      var nudgeTag = c.kind === 'firsttouch'
        ? '<span style="color:#6b9fff;font-size:10px">never contacted</span>'
        : (c.nudges > 0
            ? '<span style="color:#c4a4f8;font-size:10px">nudged ×'+c.nudges+'</span>'
            : '<span style="color:var(--muted);font-size:10px">no reply</span>');
      return '<tr data-ri="'+ri+'" style="border-bottom:1px solid rgba(255,255,255,.04)">' +
        '<td style="padding:8px 10px"><input type="checkbox" class="gl-bn-chk" data-ri="'+ri+'" checked style="cursor:pointer"></td>' +
        '<td style="padding:8px 10px;color:var(--white)">'+esc(c.d.name||c.d.contactName||'—')+'</td>' +
        '<td style="padding:8px 10px;color:var(--muted)">'+esc(c.d.co||'—')+'</td>' +
        '<td style="padding:8px 10px;color:#6b9fff">'+esc(c.email)+'</td>' +
        '<td style="padding:8px 10px;color:#f5c842;font-weight:700;white-space:nowrap">'+c.days+'d</td>' +
        '<td style="padding:8px 10px" id="gl-bn-status-'+ri+'">'+nudgeTag+'</td>' +
      '</tr>';
    }).join('');
  }

  ov.innerHTML = '<div style="background:#142238;border:1px solid rgba(196,164,248,.28);border-radius:16px;width:100%;max-width:840px;padding:26px 28px;color:#fff">' +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">' +
      '<div style="font-family:var(--ff-disp);font-size:18px;letter-spacing:2px;color:#c4a4f8">⏰ BULK NUDGE — COLD LEADS</div>' +
      '<button id="gl-bn-close" style="background:none;border:none;color:#9aa7bd;font-size:22px;cursor:pointer;line-height:1">✕</button>' +
    '</div>' +
    '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;background:rgba(196,164,248,.06);border:1px solid rgba(196,164,248,.18);border-radius:10px;padding:12px 14px;margin-bottom:16px">' +
      '<span style="font-size:13px;color:var(--white)">Show leads sitting untouched for at least</span>' +
      '<input id="gl-bn-days" type="number" min="1" max="365" value="'+DEFAULT_DAYS+'" style="width:72px;padding:7px 10px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.15);border-radius:7px;color:#fff;font-size:14px;font-weight:700;text-align:center;outline:none" />' +
      '<span style="font-size:13px;color:var(--white)">days.</span>' +
      '<span style="display:flex;gap:6px;margin-left:4px">' +
        '<button class="gl-bn-preset" data-d="7"  style="font-size:11px;padding:4px 9px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);border-radius:6px;color:var(--muted);cursor:pointer">7</button>' +
        '<button class="gl-bn-preset" data-d="10" style="font-size:11px;padding:4px 9px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);border-radius:6px;color:var(--muted);cursor:pointer">10</button>' +
        '<button class="gl-bn-preset" data-d="21" style="font-size:11px;padding:4px 9px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);border-radius:6px;color:var(--muted);cursor:pointer">21</button>' +
        '<button class="gl-bn-preset" data-d="30" style="font-size:11px;padding:4px 9px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);border-radius:6px;color:var(--muted);cursor:pointer">30</button>' +
      '</span>' +
    '</div>' +
    '<div id="gl-bn-count" style="font-size:12px;color:var(--muted);margin-bottom:12px"></div>' +
    '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px">' +
      '<thead><tr style="border-bottom:1px solid rgba(255,255,255,.08)">' +
        '<th style="text-align:left;padding:6px 10px;color:var(--muted);font-weight:600;width:30px"><input type="checkbox" id="gl-bn-check-all" checked style="cursor:pointer"></th>' +
        '<th style="text-align:left;padding:6px 10px;color:var(--muted);font-weight:600">Name</th>' +
        '<th style="text-align:left;padding:6px 10px;color:var(--muted);font-weight:600">Company</th>' +
        '<th style="text-align:left;padding:6px 10px;color:var(--muted);font-weight:600">Email</th>' +
        '<th style="text-align:left;padding:6px 10px;color:var(--muted);font-weight:600;width:70px">Sitting</th>' +
        '<th style="text-align:left;padding:6px 10px;color:var(--muted);font-weight:600;width:90px">History</th>' +
      '</tr></thead>' +
      '<tbody id="gl-bn-rows">'+rowsHtml(list)+'</tbody>' +
    '</table></div>' +
    '<div style="margin-top:16px;background:rgba(255,255,255,.03);border-radius:8px;height:6px;overflow:hidden">' +
      '<div id="gl-bn-progress" style="height:100%;background:#c4a4f8;width:0%;transition:width .3s"></div>' +
    '</div>' +
    '<div id="gl-bn-progress-label" style="font-size:11px;color:var(--muted);margin-top:6px;min-height:16px"></div>' +
    '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">' +
      '<button id="gl-bn-cancel" class="cbtn" style="font-size:13px">Close</button>' +
      '<button id="gl-bn-send" class="cbtn" style="font-size:13px;background:rgba(196,164,248,.12);border-color:rgba(196,164,248,.32);color:#c4a4f8">✍️ Draft &amp; Send Nudges</button>' +
    '</div>' +
  '</div>';

  document.body.appendChild(ov);
  ov.addEventListener('click', function(e){ if(e.target === ov) ov.remove(); });
  ov.querySelector('#gl-bn-close').onclick  = function(){ ov.remove(); };
  ov.querySelector('#gl-bn-cancel').onclick = function(){ ov.remove(); };

  var daysInput = ov.querySelector('#gl-bn-days');
  var rowsBody  = ov.querySelector('#gl-bn-rows');
  var countEl   = ov.querySelector('#gl-bn-count');
  var checkAll  = ov.querySelector('#gl-bn-check-all');
  var sendBtn   = ov.querySelector('#gl-bn-send');

  function refresh(){
    var n = parseInt(daysInput.value, 10);
    if(!n || n < 1) n = 1;
    list = candidates(n);
    rowsBody.innerHTML = rowsHtml(list);
    if(list.length){
      var nf = list.filter(function(c){ return c.kind === 'firsttouch'; }).length;
      var nu = list.length - nf;
      var parts = [];
      if(nu) parts.push(nu + ' awaiting a reply');
      if(nf) parts.push(nf + ' never contacted');
      countEl.textContent = list.length + ' lead' + (list.length !== 1 ? 's' : '') +
        ' sitting ' + n + '+ days (' + parts.join(', ') + '). All selected by default.';
    } else {
      countEl.textContent = '';
    }
    checkAll.checked = list.length > 0;
    sendBtn.disabled = list.length === 0;
    sendBtn.style.opacity = list.length === 0 ? '.5' : '1';
  }

  daysInput.addEventListener('input', refresh);
  ov.querySelectorAll('.gl-bn-preset').forEach(function(b){
    b.addEventListener('click', function(){ daysInput.value = b.dataset.d; refresh(); });
  });
  checkAll.addEventListener('change', function(){
    var self = this;
    ov.querySelectorAll('.gl-bn-chk').forEach(function(chk){ chk.checked = self.checked; });
  });
  refresh();

  sendBtn.onclick = async function(){
    var btn = this;
    var checked = Array.from(ov.querySelectorAll('.gl-bn-chk')).filter(function(c){ return c.checked; }).map(function(c){ return parseInt(c.dataset.ri, 10); });
    if(!checked.length){ alert('No leads selected.'); return; }
    if(!confirm('Send a follow-up nudge to ' + checked.length + ' lead' + (checked.length !== 1 ? 's' : '') + '?')) return;

    btn.disabled = true;
    btn.textContent = 'Sending…';
    daysInput.disabled = true;

    var sent = 0;
    var progBar   = ov.querySelector('#gl-bn-progress');
    var progLabel = ov.querySelector('#gl-bn-progress-label');

    for(var ci=0; ci<checked.length; ci++){
      var ri = checked[ci];
      var c = list[ri];
      var d = c && c.d;
      var statusEl = ov.querySelector('#gl-bn-status-'+ri);
      if(!d || !statusEl) continue;

      statusEl.innerHTML = '<span style="color:var(--teal);font-size:10px">🤖 Drafting…</span>';

      try {
        var firstName = ((d.contactName || d.name || '').split(' ')[0]) || 'there';
        var isFirst = c.kind === 'firsttouch';
        var contextLine = isFirst
          ? 'This is a FIRST CONTACT — nobody at Good Liquid has emailed this lead yet, and they\'ve been sitting in our pipeline for about '+c.days+' days.'
          : 'This is a FOLLOW-UP — it has been about '+c.days+' days since our last email with no reply'+(c.nudges>0?' (already nudged '+c.nudges+' time'+(c.nudges!==1?'s':'')+')':'')+'.';
        var details = [
          d.contactName  ? 'Contact: '+d.contactName : null,
          d.co           ? 'Company: '+d.co : null,
          d.service      ? 'Service interest: '+d.service : null,
          d.productType  ? 'Product type: '+d.productType : null,
          d.notes        ? 'Their original message: "'+d.notes+'"' : null,
          contextLine,
        ].filter(Boolean);

        var userPrompt = 'Draft a short, friendly '+(isFirst?'first-contact email':'follow-up nudge')+' to this lead:\n\n'+details.join('\n')+'\n\nGreet them by first name ('+firstName+'). Keep it light and human'+(isFirst?', introduce Good Liquid and why co-packing here is a fit for what they\'re building':' — acknowledge they\'re busy and gently reopen the door for co-packing at Good Liquid')+', and make it easy to say the timing isn\'t right. Suggest a quick 20-minute call or a facility tour. Sign off as Mike, Good Liquid Bev Co, (803) 493-5065.';

        var raw = await callAI(systemPrompt, userPrompt);
        if(!raw) throw new Error('AI returned empty response');

        var subjectMatch = raw.match(/^SUBJECT:\s*(.+)/im);
        var subject = subjectMatch ? subjectMatch[1].trim() : 'Following up — Good Liquid Bev Co'+(d.co?' × '+d.co:'');
        var bodyStart = raw.indexOf('\n\n');
        var body = bodyStart > -1 ? raw.slice(bodyStart).trim() : raw.replace(/^SUBJECT:.*\n?/im,'').trim();

        var htmlBody = '<div style="font-family:Arial,sans-serif;color:#1a1a1a;line-height:1.6;max-width:640px;margin:0 auto">' +
          '<div style="border-top:3px solid #00e5c0;padding:24px 28px">' +
            '<div style="font-size:20px;font-weight:900;color:#00b89a;letter-spacing:2px;margin-bottom:4px">GOOD LIQUID BEV CO</div>' +
            '<div style="font-size:11px;color:#6b87ad">2011 51st Ave E, Unit 100 · Palmetto, FL 34221 · Mike@GoodLiquid.com · (803) 493-5065</div>' +
          '</div>' +
          '<div style="padding:0 28px 28px;white-space:pre-wrap;font-size:14px;line-height:1.7">'+body.replace(/[&<>]/g,function(ch){return {'&':'&amp;','<':'&lt;','>':'&gt;'}[ch];})+'</div>' +
          '<div style="padding:14px 28px;border-top:1px solid #e5e7eb;font-size:11px;color:#9ca3af;text-align:center">Good Liquid Bev Co · goodliquidbevco.com</div>' +
        '</div>';

        statusEl.innerHTML = '<span style="color:var(--muted);font-size:10px">📤 Sending…</span>';
        var ok = await sendMailgunEmail(d.email, subject, body, { bcc: 'mike@goodliquid.com', html: htmlBody });

        if(ok){
          statusEl.innerHTML = '<span style="color:#5fcf9e;font-size:10px">'+(isFirst?'✓ Emailed':'✓ Nudged')+'</span>';
          if(typeof setDealOutreach === 'function') await setDealOutreach(d.id||'', c.stage, c.idx, isFirst ? 'sent' : 'nudged');
          if(typeof addNotification === 'function') addNotification('⏰ Nudge sent', (d.name||d.co)+' → '+d.email, 'email');
          if(typeof window.glAudit === 'function') window.glAudit('bulk_nudge_sent', d.id, { to: d.email, subject: subject, daysSitting: c.days });
          sent++;
        } else {
          statusEl.innerHTML = '<span style="color:#ff8579;font-size:10px">✗ Failed</span>';
        }
      } catch(err){
        console.error('[GL] Bulk nudge error for', d.email, err);
        statusEl.innerHTML = '<span style="color:#ff8579;font-size:10px">✗ Error</span>';
      }

      var pct = Math.round(((ci+1) / checked.length) * 100);
      progBar.style.width = pct + '%';
      progLabel.textContent = (ci+1) + ' / ' + checked.length + ' processed';
    }

    progLabel.textContent = 'Done — '+sent+' nudge'+(sent!==1?'s':'')+' sent out of '+checked.length+' attempted.';
    btn.textContent = '✓ Complete';
    // New outbound mail means the pipeline badges are stale; force a reload.
    if(typeof renderKanban === 'function'){ renderKanban._outreachAt = 0; renderKanban(); }
  };
}
window.glOpenBulkNudge = glOpenBulkNudge;

// Close modals on backdrop click
document.getElementById('add-client-modal').addEventListener('click', function(e){ if(e.target===this) closeAddClientModal(); });
document.getElementById('add-deal-modal').addEventListener('click', function(e){ if(e.target===this) closeAddDealModal(); });


/* Activity item navigation — clicking routes to the right section */
function actNav(a){
  const navItems = document.querySelectorAll('.cni');
  const navMap = {
    invoice: ()=>{ cNav('invoices', navItems[4]); if(a.invId) setTimeout(()=>viewInvoice(a.invId),150); },
    deal:    ()=>{ cNav('pipeline', navItems[2]); },
    ref:     ()=>{ cNav('referrals', navItems[7]); },
    call:    ()=>{ cNav('activity', navItems[8]); },
    email:   ()=>{ cNav('activity', navItems[8]); },
    note:    ()=>{ cNav('activity', navItems[8]); },
  };
  const fn = navMap[a.type] || (()=>{ cNav('activity', navItems[8]); });
  fn();
}


function navTo(id){
  const el = document.getElementById(id);
  if(!el) return;
  const top = el.getBoundingClientRect().top + window.pageYOffset - 70;
  window.scrollTo({top: top, behavior: 'smooth'});
}


function getCheckedMain(groupId){
  var boxes = document.querySelectorAll('#' + groupId + ' input[type="checkbox"]:checked');
  return Array.prototype.map.call(boxes, function(cb){ return cb.value; });
}
function toggleOtherProductMain(cb){
  var reveal = document.getElementById('pt-other-reveal-main');
  if(!reveal) return;
  if(cb.checked){ reveal.classList.add('show'); document.getElementById('pt-other-text-main').focus(); }
  else { reveal.classList.remove('show'); document.getElementById('pt-other-text-main').value = ''; }
}

async function submitContactForm(btn){
  const v = id => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };

  // Multi-select service + product type
  var services     = getCheckedMain('qf-service-group');
  var productTypes = getCheckedMain('qf-product-group');
  var otherText    = v('pt-other-text-main');
  if(productTypes.indexOf('Other') !== -1 && otherText){
    productTypes[productTypes.indexOf('Other')] = 'Other: ' + otherText;
  }

  const vals = {
    brand_name:    v('qf-brand'),
    contact_name:  v('qf-name'),
    email:         v('qf-email'),
    phone:         v('qf-phone'),
    city:          v('qf-city'),
    state:         v('qf-state').toUpperCase(),
    service:       services.join(', ')     || '',
    product_type:  productTypes.join(', ') || '',
    volume:        v('qf-volume'),
    timeline:      v('qf-timeline'),
    funding_stage: v('qf-funding'),
    lead_source:   v('qf-source'),
    details:       v('qf-details')
  };

  // ── Validation ──────────────────────────────────────────────────────────
  // A submission must be complete enough to qualify the lead (and to feed the
  // auto deal-value estimate). We flag every problem at once, highlight the
  // offending fields, and refuse to submit until they're fixed — a low-effort
  // or bot submission can't get through with three blank boxes anymore.
  const problems = []; // {field: elementId | pillGroupId, msg}
  const markField = id => { const f = document.getElementById(id); if(f){ const w = f.closest('.field'); if(w) w.classList.add('err'); } };
  const markPill  = groupId => { const g = document.getElementById(groupId); if(g){ const w = g.closest('.pill-field'); if(w) w.classList.add('err'); } };

  // Clear any prior error state first.
  document.querySelectorAll('.cf .field.err, .cf .pill-field.err').forEach(el => el.classList.remove('err'));

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const phoneDigits = vals.phone.replace(/\D/g, '');

  if(!vals.brand_name){                          problems.push('Enter your brand name.');                   markField('qf-brand'); }
  if(!vals.contact_name){                         problems.push('Enter your name.');                          markField('qf-name'); }
  if(!vals.email){                                problems.push('Enter your email address.');                 markField('qf-email'); }
  else if(!EMAIL_RE.test(vals.email)){            problems.push('Enter a valid email address.');              markField('qf-email'); }
  if(!vals.phone){                                problems.push('Enter a phone number.');                     markField('qf-phone'); }
  else if(phoneDigits.length < 10){               problems.push('Enter a valid phone number (with area code).'); markField('qf-phone'); }
  if(services.length === 0){                      problems.push('Pick at least one service.');                markPill('qf-service-group'); }
  if(productTypes.length === 0){                  problems.push('Pick at least one product type.');           markPill('qf-product-group'); }
  else if(productTypes.some(p => p === 'Other')){ problems.push('Describe your product type in the "Other" box.'); markPill('qf-product-group'); markField('pt-other-text-main'); }
  if(vals.details.length < 15){                   problems.push('Add a few words about your project (at least 15 characters).'); markField('qf-details'); }

  const errBox = document.getElementById('form-err');
  if(problems.length){
    if(errBox){
      errBox.innerHTML = '<strong>Please finish these before sending:</strong><ul>' +
        problems.map(p => '<li>' + p + '</li>').join('') + '</ul>';
      errBox.style.display = 'block';
    }
    // Once the user starts fixing a flagged field, clear its highlight.
    document.querySelectorAll('.cf .field.err input, .cf .field.err select, .cf .field.err textarea').forEach(inp => {
      inp.addEventListener('input', function clr(){ const w = inp.closest('.field'); if(w) w.classList.remove('err'); inp.removeEventListener('input', clr); }, { once: true });
    });
    document.querySelectorAll('.cf .pill-field.err input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', function clr(){ const w = cb.closest('.pill-field'); if(w) w.classList.remove('err'); }, { once: true });
    });
    const firstErr = document.querySelector('.cf .field.err, .cf .pill-field.err');
    if(firstErr) firstErr.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  if(errBox) errBox.style.display = 'none';

  btn.textContent = 'Sending…';
  btn.disabled = true;

  // Build a single human-readable note block we'll reuse in the deal + the email.
  const noteBlock = [
    'Brand: ' + vals.brand_name,
    'Contact: ' + vals.contact_name + ' (' + vals.email + (vals.phone ? ', ' + vals.phone : '') + ')',
    (vals.city || vals.state) ? 'Location: ' + [vals.city, vals.state].filter(Boolean).join(', ') : null,
    'Service: ' + (vals.service || '—'),
    'Product type: ' + (vals.product_type || '—'),
    'Volume: ' + (vals.volume || '—'),
    'Timeline: ' + (vals.timeline || '—'),
    'Funding stage: ' + (vals.funding_stage || '—'),
    'Lead source: ' + (vals.lead_source || '—'),
    '',
    vals.details || '(no project details given)'
  ].filter(Boolean).join('\n');

  let formspreeOk = false;
  try {
    // 1. Notify Mike + Sandra via Formspree
    const emailRes = await fetch('https://formspree.io/f/mykolyee', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(Object.assign({}, vals, { _subject: '[Good Liquid] New quote: ' + vals.brand_name, summary: noteBlock }))
    });
    formspreeOk = emailRes.ok;

    // 2. Save the raw submission (audit + future analytics).
    try {
      if(!window.supa) throw new Error('Supabase not loaded');
      await window.supa.from('contact_submissions').insert([{
        brand_name:    vals.brand_name,
        contact_name:  vals.contact_name,
        email:         vals.email,
        phone:         vals.phone,
        city:          vals.city,
        state:         vals.state,
        service:       vals.service,
        product_type:  vals.product_type,
        volume:        vals.volume,
        timeline:      vals.timeline,
        funding_stage: vals.funding_stage,
        lead_source:   vals.lead_source,
        message:       vals.details,
        status:        'new'
      }]);
    } catch(e){ console.warn('Supabase contact_submissions insert failed:', e); }

    // 3. Auto-create a deal in the Pipeline (Prospecting stage) so the lead
    //    lands on the kanban and shows up in pipeline reports immediately.
    let newDealId = null;
    try {
      const dealName = vals.brand_name + ' — Quote Request';
      // Submitted through a SECURITY DEFINER RPC: the anonymous role has NO
      // privilege on public.deals (it used to have full read/write via an
      // `anon_all` policy — see migration 20260807010000), and the function
      // pins stage/value/probability so a stranger cannot set them.
      const { data: newId, error: dealErr } = await supa.rpc('submit_quote_request', {
        p: {
          brand_name:    vals.brand_name,
          details:       vals.details       || '',
          contact_name:  vals.contact_name  || '',
          email:         vals.email         || '',
          phone:         vals.phone         || '',
          city:          vals.city          || '',
          state:         vals.state         || '',
          service:       vals.service       || '',
          product_type:  vals.product_type  || '',
          volume:        vals.volume        || '',
          timeline:      vals.timeline      || '',
          funding_stage: vals.funding_stage || '',
          lead_source:   vals.lead_source   || ''
        }
      });
      if(dealErr) throw dealErr;
      newDealId = newId || null;
      if(typeof deals !== 'undefined' && deals['Prospecting']){
        deals['Prospecting'].push({
          id:           newDealId || ('tmp_' + Date.now()),
          name:         dealName,
          co:           vals.brand_name,
          val:          '$0',
          prob:         20,
          notes:        vals.details || '',
          contactName:  vals.contact_name  || '',
          email:        vals.email         || '',
          phone:        vals.phone         || '',
          city:         vals.city          || '',
          state:        vals.state         || '',
          service:      vals.service       || '',
          productType:  vals.product_type  || '',
          volume:       vals.volume        || '',
          timeline:     vals.timeline      || '',
          fundingStage: vals.funding_stage || '',
          leadSource:   vals.lead_source   || ''
        });
        if(typeof renderKanban === 'function') renderKanban();
        if(typeof renderDash === 'function')   renderDash();
      }
    } catch(e){ console.warn('Pipeline deal creation failed:', e); }

    // 4. Drop a notification in the CRM if it's open.
    if(typeof addNotification === 'function'){
      addNotification('💼 New quote request: ' + vals.brand_name, (vals.contact_name || '') + ' · ' + (vals.email || ''), 'success');
    }

    if(formspreeOk){
      document.getElementById('form-ok').style.display = 'block';
      ['qf-brand','qf-name','qf-email','qf-phone','qf-city','qf-state','qf-volume','qf-timeline','qf-funding','qf-source','qf-details'].forEach(id => {
        const el = document.getElementById(id); if(el) el.value = '';
      });
      // Uncheck all pill checkboxes
      document.querySelectorAll('#qf-service-group input, #qf-product-group input').forEach(cb => { cb.checked = false; });
      var rev = document.getElementById('pt-other-reveal-main'); if(rev) rev.classList.remove('show');
      var ot = document.getElementById('pt-other-text-main'); if(ot) ot.value = '';
      setTimeout(() => {
        const ok = document.getElementById('form-ok'); if(ok) ok.style.display = 'none';
        btn.textContent = 'Send inquiry →';
        btn.disabled = false;
      }, 6000);
    } else {
      btn.textContent = 'Send inquiry →';
      btn.disabled = false;
      alert('Something went wrong sending the email. Your inquiry was saved — Mike will see it. Or email Mike@GoodLiquid.com directly.');
    }
  } catch(e){
    console.error('submitContactForm threw', e);
    btn.textContent = 'Send inquiry →';
    btn.disabled = false;
    alert('Something went wrong. Please email Mike@GoodLiquid.com directly.');
  }
}


/* ═══ DEAL DETAIL PANEL ═══ */
let currentDealStage = null;
let currentDealIdx = null;

function openDealDetail(stage, idx){
  const d = (deals[stage]||[])[idx];
  if(!d) return;
  currentDealStage = stage;
  currentDealIdx = idx;
  // Bridge to window so external modules (crm-onboarding.js) can read which
  // lead is open — index.html keeps these as lexical `let`, invisible to
  // other scripts otherwise.
  window.currentDealStage = stage;
  window.currentDealIdx = idx;

  // Build read-only view
  const prob = d.prob || 20;
  const sc = {'Prospecting':'#6b87ad','Proposal':'#1a6fff','Negotiation':'#f5c842','Closed Won':'#00c4a7','Closed Lost':'#e74c3c'};
  const stageColor = sc[stage] || 'var(--teal)';
  const obBadge = d.outreachStatus === 'sent'
    ? '<span style="padding:2px 9px;border-radius:20px;font-size:11px;font-weight:600;background:rgba(245,200,66,.15);color:#f5c842;border:1px solid rgba(245,200,66,.35)">✉️ Awaiting Reply</span>'
    : d.outreachStatus === 'replied'
    ? '<span style="padding:2px 9px;border-radius:20px;font-size:11px;font-weight:600;background:rgba(0,196,167,.15);color:#00c4a7;border:1px solid rgba(0,196,167,.35)">✅ Replied</span>'
    : d.outreachStatus === 'no_response'
    ? '<span style="padding:2px 9px;border-radius:20px;font-size:11px;font-weight:600;background:rgba(231,76,60,.12);color:#e74c3c;border:1px solid rgba(231,76,60,.35)">🔕 No Response</span>'
    : '';

  function row(label, val){ return val ? `<div style="padding:7px 0;border-bottom:1px solid rgba(255,255,255,.05)"><span style="font-size:10px;letter-spacing:1px;color:var(--muted);display:block;margin-bottom:2px">${label}</span><span style="font-size:13px;color:var(--white)">${esc(val)}</span></div>` : ''; }

  const viewHTML = `
    <div style="margin-bottom:6px">
      <div style="font-family:var(--ff-disp);font-size:22px;letter-spacing:1px;color:var(--white)">${esc(d.name||'—')}</div>
      ${d.co ? `<div style="font-size:13px;color:var(--muted);margin-top:2px">${esc(d.co)}</div>` : ''}
    </div>
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
      <span style="padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;background:${stageColor}22;color:${stageColor};border:1px solid ${stageColor}55">${stage}</span>
      ${obBadge}
    </div>
    <div id="ddp-brief" style="margin:6px 0 12px"></div>
    ${row('CONTACT', d.contactName)}
    ${d.email ? `<div style="padding:7px 0;border-bottom:1px solid rgba(255,255,255,.05)"><span style="font-size:10px;letter-spacing:1px;color:var(--muted);display:block;margin-bottom:2px">EMAIL</span><a href="mailto:${esc(d.email)}" style="font-size:13px;color:var(--teal)">${esc(d.email)}</a></div>` : ''}
    ${row('PHONE', d.phone)}
    ${row('LOCATION', [d.city, d.state].filter(Boolean).join(', '))}
    ${row('SERVICE', d.service)}
    ${row('PRODUCT TYPE', d.productType)}
    ${row('VOLUME / YEAR', d.volume)}
    ${row('TIMELINE', d.timeline)}
    <div style="padding:7px 0;border-bottom:1px solid rgba(255,255,255,.05)">
      <span style="font-size:10px;letter-spacing:1px;color:var(--muted);display:block;margin-bottom:4px">DEAL VALUE</span>
      <span style="font-family:var(--ff-disp);font-size:20px;color:var(--teal)">${esc(d.val||'$0')}</span>
    </div>
    ${typeof window.glFormulationSummary === 'function' ? window.glFormulationSummary(d) : ''}
    <div style="padding:7px 0;border-bottom:1px solid rgba(255,255,255,.05)">
      <span style="font-size:10px;letter-spacing:1px;color:var(--muted);display:block;margin-bottom:6px">PROBABILITY — ${prob}%</span>
      <div style="background:rgba(255,255,255,.08);border-radius:4px;height:8px;overflow:hidden"><div style="height:100%;width:${prob}%;background:${stageColor};border-radius:4px"></div></div>
    </div>
    ${d.notes ? `<div style="padding:7px 0;border-bottom:1px solid rgba(255,255,255,.05)"><span style="font-size:10px;letter-spacing:1px;color:var(--muted);display:block;margin-bottom:4px">NOTES</span><div style="font-size:13px;color:var(--white);line-height:1.6;white-space:pre-wrap">${esc(d.notes)}</div></div>` : ''}
    <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">
      <button onclick="editDealDetail()" style="flex:1;padding:10px;background:var(--teal);color:var(--ink);border:none;border-radius:8px;font-weight:800;font-size:13px;cursor:pointer">✏️ Edit</button>
      <button onclick="openLeadEmailComposer()" style="flex:1;padding:10px;background:rgba(26,111,255,.15);color:#6b9fff;border:1px solid rgba(26,111,255,.35);border-radius:8px;font-weight:700;font-size:13px;cursor:pointer">✉️ Email Lead</button>
      <button onclick="deleteDeal()" style="padding:10px 16px;background:rgba(231,76,60,.15);color:#e74c3c;border:1px solid rgba(231,76,60,.3);border-radius:8px;font-weight:700;font-size:13px;cursor:pointer">Delete</button>
    </div>
    <button onclick="glConvertLeadToOnboarding()" style="width:100%;margin-top:8px;padding:12px;background:linear-gradient(135deg,#5fcf9e,#00c4a7);color:#04231d;border:none;border-radius:8px;font-weight:800;font-size:13.5px;cursor:pointer">🚀 Convert to Client &amp; Onboard</button>
    ${(d.id && !String(d.id).startsWith('tmp_')) ? `<div style="display:flex;gap:8px;margin-top:8px">
      <button onclick="glSnoozeLead('${d.id}')" title="Pause follow-up drafts & reply alerts for 7 days" style="flex:1;padding:9px;background:rgba(143,179,255,.1);color:#8fb3ff;border:1px solid rgba(143,179,255,.3);border-radius:8px;font-weight:700;font-size:12.5px;cursor:pointer">💤 Snooze 7d${d.snoozedUntil && new Date(d.snoozedUntil)>new Date() ? ' ✓' : ''}</button>
      <button onclick="glMarkLeadHandled('${d.id}')" title="Stop automations nagging about this lead" style="flex:1;padding:9px;background:rgba(95,207,158,.1);color:#5fcf9e;border:1px solid rgba(95,207,158,.3);border-radius:8px;font-weight:700;font-size:12.5px;cursor:pointer">✓ Handled${d.handledAt ? ' ✓' : ''}</button>
    </div>` : ''}
    <div id="ddp-docs" style="margin-top:18px;border-top:1px solid rgba(255,255,255,.07);padding-top:16px"></div>
    <div id="ddp-notes" style="margin-top:18px;border-top:1px solid rgba(255,255,255,.07);padding-top:16px"></div>
    <div id="ddp-corr" style="margin-top:18px;border-top:1px solid rgba(255,255,255,.07);padding-top:16px"></div>`;

  document.getElementById('ddp-view-mode').innerHTML = viewHTML;
  document.getElementById('ddp-view-mode').style.display = 'flex';
  document.getElementById('ddp-edit-mode').style.display = 'none';
  // Drop the previous deal's formulation block: editDealDetail() rebuilds it
  // for whichever deal is open, and a leftover one could otherwise be read
  // back and written onto this deal.
  var fprev = document.getElementById('ddp-formulation');
  if(fprev) fprev.innerHTML = '';
  document.getElementById('ddp-title').textContent = 'DEAL DETAILS';
  document.getElementById('deal-detail-panel').classList.add('show');
  // Load the email correspondence for this lead into the panel above.
  ddpLoadCorrespondence(d);
  // Documents (NDA, PA letter, formulas, labels). Only real (saved) deals have
  // a UUID to hang docs on; a not-yet-saved lead shows a gentle prompt instead.
  var docBox = document.getElementById('ddp-docs');
  if(docBox && typeof window.glRenderDealDocs === 'function'){
    if(d.id && !String(d.id).startsWith('tmp_')) window.glRenderDealDocs(docBox, { dealId: d.id });
    else docBox.innerHTML = '<div style="font-size:10px;letter-spacing:2px;color:var(--teal);margin-bottom:6px">📎 DOCUMENTS</div>' +
      '<div style="font-size:11px;color:#9aa7bd">Save this deal first (✏️ Edit → Save) to attach NDAs, Process Authority letters, formulas and labels.</div>';
  }
  // Meeting notes (Pocket AI NoteTaker etc.) — same real-deal guard.
  var mnBox = document.getElementById('ddp-notes');
  if(mnBox && typeof window.glRenderMeetingNotes === 'function'){
    if(d.id && !String(d.id).startsWith('tmp_')) window.glRenderMeetingNotes(mnBox, { kind: 'deal', id: d.id });
    else mnBox.innerHTML = '<div style="font-size:10px;letter-spacing:2px;color:var(--teal);margin-bottom:6px">🗒️ MEETING NOTES</div>' +
      '<div style="font-size:11px;color:#9aa7bd">Save this deal first to attach meeting notes.</div>';
  }
  // AI Brief — the living summary at the top of the panel.
  var brBox = document.getElementById('ddp-brief');
  if(brBox && typeof window.glRenderBrief === 'function' && d.id && !String(d.id).startsWith('tmp_')){
    window.glRenderBrief(brBox, { kind:'deal', id:d.id, email:d.email, name:d.name, co:d.co, stage:stage, notes:d.notes });
  }
  // Product intake questionnaire — answers from a tour booking or staff entry.
  if(brBox && typeof window.glRenderIntake === 'function' && d.id && !String(d.id).startsWith('tmp_')){
    var ddpIt = document.getElementById('ddp-intake');
    if(!ddpIt){ ddpIt = document.createElement('div'); ddpIt.id = 'ddp-intake'; ddpIt.style.marginTop = '12px'; brBox.parentNode.insertBefore(ddpIt, brBox.nextSibling); }
    window.glRenderIntake(ddpIt, { kind:'deal', dealId:d.id, email:d.email, name:d.name||d.co });
  }
}

/* ═══════════════════════════════════════════
   SHARED CORRESPONDENCE RENDERING
   One renderer for all three email-thread panels (lead / Deal Details,
   lead email composer, client detail). They used to each build their own
   copy of this markup, which is how they drifted apart — fix it here and
   every panel gets the fix.
═══════════════════════════════════════════ */

// Rows are stashed per panel so the "open full email" popup can look one up
// by index without re-querying Supabase.
window.__glCorrRows = {};

function glCorrEsc(s){
  return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];
  });
}

function glCorrWhen(row){
  try {
    return new Date(row.sent_at || row.created_at)
      .toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'});
  } catch(e){ return ''; }
}

// Builds the scrollable thread list. Each entry is clickable and opens the
// full stored message in a popup — the inline preview is deliberately clamped
// to two lines so a long email can't push the rest of the panel off screen.
function glRenderCorrespondence(key, rows){
  window.__glCorrRows[key] = rows || [];
  var inboundLabel = key === 'cde' ? '← FROM CLIENT' : '← FROM LEAD';
  var list = (rows || []).map(function(row, i){
    var inb = row.direction === 'inbound';
    var lbl = inb
      ? '<span style="font-size:10px;letter-spacing:1px;color:#6b9fff">' + inboundLabel + '</span>'
      : '<span style="font-size:10px;letter-spacing:1px;color:var(--muted)">→ SENT</span>';
    return '<div onclick="glShowEmailFull(\'' + key + '\',' + i + ')" title="Click to read the full message" ' +
        'style="background:' + (inb?'rgba(26,111,255,.07)':'rgba(255,255,255,.02)') + ';border:1px solid ' +
        (inb?'rgba(26,111,255,.25)':'rgba(255,255,255,.06)') + ';border-radius:6px;padding:8px 10px;cursor:pointer">' +
      '<div style="display:flex;justify-content:space-between;gap:8px;margin-bottom:3px">' + lbl +
        '<span style="font-size:10px;color:rgba(154,167,189,.6)">' + glCorrEsc(glCorrWhen(row)) + '</span></div>' +
      '<div style="font-size:12px;color:#fff;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
        glCorrEsc(row.subject || '(no subject)') + '</div>' +
      (row.body_preview
        ? '<div style="font-size:11px;color:#9aa7bd;line-height:1.4;margin-top:2px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">' +
            glCorrEsc(row.body_preview) + '</div>'
        : '') +
    '</div>';
  }).join('');
  // Fixed max height + overflow so a long thread scrolls inside the panel
  // instead of being cut off by it.
  return '<div style="display:flex;flex-direction:column;gap:6px;max-height:260px;overflow-y:auto;' +
    '-webkit-overflow-scrolling:touch;padding-right:2px">' + list + '</div>';
}

// Popup showing one message in full, scrollable. Sits above the client detail
// overlay (z 650) and the deal panel so it's never hidden behind them.
function glShowEmailFull(key, i){
  var rows = window.__glCorrRows[key] || [];
  var row = rows[i];
  if(!row) return;
  var prev = document.getElementById('gl-email-full');
  if(prev) prev.remove();
  var inb = row.direction === 'inbound';
  var who = inb ? ('From: ' + glCorrEsc(row.from_email || 'client'))
                : ('To: '   + glCorrEsc(row.to_email   || ''));
  var ov = document.createElement('div');
  ov.id = 'gl-email-full';
  ov.style.cssText = 'position:fixed;inset:0;z-index:900;background:rgba(6,13,26,.95);backdrop-filter:blur(10px);display:flex;align-items:center;justify-content:center;padding:20px';
  ov.innerHTML =
    '<div style="background:#142238;border:1px solid rgba(0,229,192,.2);border-radius:14px;width:100%;max-width:620px;max-height:85vh;display:flex;flex-direction:column;padding:22px 24px;color:#fff">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:10px">' +
        '<div style="font-size:11px;letter-spacing:1.5px;color:' + (inb?'#6b9fff':'var(--teal)') + '">' +
          (inb ? '← RECEIVED' : '→ SENT') + '</div>' +
        '<button onclick="document.getElementById(\'gl-email-full\').remove()" style="background:none;border:none;color:var(--muted);font-size:22px;cursor:pointer;line-height:1">&#x2715;</button>' +
      '</div>' +
      '<div style="font-size:16px;font-weight:700;line-height:1.35;margin-bottom:6px">' + glCorrEsc(row.subject || '(no subject)') + '</div>' +
      '<div style="font-size:11px;color:var(--muted);margin-bottom:14px">' + who + ' &middot; ' + glCorrEsc(glCorrWhen(row)) + '</div>' +
      '<div style="flex:1;overflow-y:auto;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:8px;padding:14px;font-size:13px;line-height:1.7;white-space:pre-wrap;color:#e8eef7">' +
        (row.body_preview ? glCorrEsc(row.body_preview) : '<span style="color:var(--muted);font-style:italic">No message text was stored for this email.</span>') +
      '</div>' +
      '<div style="font-size:10px;color:rgba(154,167,189,.55);margin-top:10px;line-height:1.5">' +
        'Shows the new message only — the quoted thread below a reply is not stored. ' +
        'Hit \u{1F504} Sync if an older entry still looks cluttered.' +
      '</div>' +
    '</div>';
  ov.addEventListener('click', function(e){ if(e.target === ov) ov.remove(); });
  document.body.appendChild(ov);
}
window.glShowEmailFull = glShowEmailFull;

// Opens the Email Lead composer for the currently-selected deal and pre-fills
// a friendly follow-up nudge. Wired to the "✍️ Draft nudge" button in the
// Deal Details correspondence panel.
function ddpNudgeLead(){
  if(typeof openLeadEmailComposer !== 'function') return;
  var d = (deals[currentDealStage]||[])[currentDealIdx];
  openLeadEmailComposer();
  setTimeout(function(){
    var subjEl = document.getElementById('gl-lem-subject');
    var bodyEl = document.getElementById('gl-lem-body');
    if(!subjEl || !bodyEl || !d) return;
    var firstName = (d.contactName || '').split(' ')[0] || 'there';
    subjEl.value = 'Following up — Good Liquid Bev Co' + (d.co ? ' × ' + d.co : '');
    bodyEl.value =
      'Hi ' + firstName + ',\n\n' +
      'Just circling back on my last note — I know things get busy! I wanted to make sure it reached you and see if you’re still exploring co-packing for ' + (d.co || 'your brand') + '.\n\n' +
      'If now’s a good time, I’d be happy to set up a quick 20-minute call or a tour of our Palmetto facility. And if the timing isn’t right, just let me know and I’ll check back down the road.\n\n' +
      'Best,\nMike\nGood Liquid Bev Co\n(803) 493-5065';
    bodyEl.focus();
  }, 250);
}
window.ddpNudgeLead = ddpNudgeLead;

// Pulls email history in from Gmail via the gmail-sync edge function, so the
// correspondence panels can be refreshed from inside the app — no Supabase
// dashboard trip needed. Invoked through supa.functions.invoke so the signed-in
// staff JWT is sent (the function rejects anyone who isn't staff).
//
// Pass an address to sync just that contact (fast); omit it for a full sweep.
// Returns true when the sync succeeded so callers can reload their panel.
async function glSyncGmail(email, opts){
  opts = opts || {};
  if(!window.supa){ if(typeof addNotification==='function') addNotification('Sync unavailable','Not connected to the server.','warning'); return null; }
  var body = email ? { email: email, days: opts.days || 90, max: opts.max || 200 }
                   : { days: opts.days || 90, max: opts.max || 400 };
  try {
    var r = await window.supa.functions.invoke('gmail-sync', { body: body });
    // A failed invoke puts the reason in r.error; the function itself reports
    // trouble as { ok:false, error } with a 4xx/5xx.
    var errMsg = (r && r.error && (r.error.message || String(r.error))) ||
                 (r && r.data && r.data.ok === false && r.data.error) || '';
    if(errMsg){
      var friendly = /readonly|403/i.test(errMsg)
        ? 'Gmail read access isn’t enabled yet — see GMAIL_SYNC_SETUP.md (steps 1–3).'
        : errMsg;
      console.error('[GL] gmail-sync failed', errMsg);
      if(!opts.silent && typeof addNotification==='function') addNotification('Email sync failed', friendly, 'warning');
      glSyncGmail.lastError = friendly;
      return null;
    }
    var d = (r && r.data) || {};
    // New mail means the pipeline badges are stale; force a reload next render.
    if(typeof renderKanban === 'function') renderKanban._outreachAt = 0;
    var msg = (d.inserted || 0) + ' new, ' + (d.skipped || 0) + ' already logged';
    // Say when existing entries were filled out, otherwise a sync that only
    // repaired truncated bodies looks like it did nothing.
    if(d.upgraded) msg += ', ' + d.upgraded + ' filled out in full';
    // Background/automatic syncs stay quiet unless they actually found something,
    // so the notification bell isn't full of "0 new" every 15 minutes.
    var announce = !opts.silent || (d.inserted || 0) > 0;
    if(announce && typeof addNotification==='function') addNotification('📧 Email sync complete', msg, 'success');
    // Return the payload so callers can show the real counts. Truthy on
    // success, null on failure, so existing truthiness checks still work.
    return d;
  } catch(e){
    console.error('[GL] gmail-sync threw', e);
    glSyncGmail.lastError = String(e && e.message || e);
    if(!opts.silent && typeof addNotification==='function') addNotification('Email sync failed', glSyncGmail.lastError, 'warning');
    return null;
  }
}
window.glSyncGmail = glSyncGmail;

// Throttle for automatic syncing: returns true at most once per `minutes` for a
// given key, and records the attempt. Keeps the background sync from firing on
// every render (and stops the panel reload below from looping).
function glAutoSyncDue(key, minutes){
  try {
    var k = 'gl_sync_' + key;
    var last = parseFloat(localStorage.getItem(k) || '0');
    if(Date.now() - last < minutes * 60000) return false;
    localStorage.setItem(k, String(Date.now()));
    return true;
  } catch(e){ return true; }  // private mode / no storage: just allow it
}
window.glAutoSyncDue = glAutoSyncDue;

// AUTOMATIC EMAIL SYNC
// Keeps correspondence current without anyone pressing a button: a small recent
// sweep shortly after the CRM opens, then every 15 minutes while the tab is
// open. Deliberately narrow (last 3 days, capped) so it stays cheap; the manual
// button remains for a deep backfill. Silent unless it actually files something.
(function glAutoSyncBoot(){
  function tick(){
    if(!window.currentUser || !window.supa) return;      // only for signed-in staff
    if(document.hidden) return;                          // don't work in a background tab
    // Belt-and-braces for scheduled email: pg_cron fires email-scheduler every
    // 15 minutes server-side, but if that plumbing ever breaks again (it has,
    // silently, for hours) this ping keeps due follow-ups going out whenever
    // the CRM is open. The function accepts a staff JWT precisely for this.
    if(glAutoSyncDue('sched', 20)){
      try { supa.functions.invoke('email-scheduler', { body: {} }).catch(function(){}); } catch(e){}
    }
    if(!glAutoSyncDue('recent', 15)) return;
    glSyncGmail(null, { days: 3, max: 120, silent: true });
  }
  setTimeout(tick, 8000);
  setInterval(tick, 15 * 60000);
})();

// Click handler for the 🔄 Sync button in a correspondence panel header:
// syncs just this contact, then reloads whichever panel asked for it.
async function glSyncCorrPanel(btn, email, panel, id){
  if(!btn) return;
  var orig = btn.textContent;
  btn.disabled = true; btn.textContent = '🔄 Syncing…';
  var ok = await glSyncGmail(email);
  btn.disabled = false; btn.textContent = orig;
  if(!ok) return;
  if(panel === 'cde'){
    var c = (window.clients||[]).find(function(x){ return x.id === id; });
    if(c) cdeLoadCorrespondence(c);
  } else if(panel === 'ddp'){
    var d = (deals[currentDealStage]||[])[currentDealIdx];
    if(d) ddpLoadCorrespondence(d);
  }
}
window.glSyncCorrPanel = glSyncCorrPanel;

// Opening a client or lead quietly refreshes just that contact's mail in the
// background, so the thread is current the moment you look at it — no button.
// Throttled per contact, and the panel is only re-rendered if something new
// was actually filed (which also stops a render -> sync -> render loop).
function glAutoSyncContact(email, panel, id){
  if(!email || !window.supa || !window.currentUser) return;
  if(!glAutoSyncDue('c_' + String(email).toLowerCase(), 15)) return;
  glSyncGmail(email, { days: 90, max: 100, silent: true }).then(function(res){
    if(!res || !(res.inserted > 0)) return;
    if(panel === 'cde'){
      var c = (window.clients||[]).find(function(x){ return x.id === id; });
      // Only refresh if the user is still looking at this client.
      if(c && document.getElementById('client-detail-overlay')) cdeLoadCorrespondence(c);
    } else if(panel === 'ddp'){
      var d = (deals[currentDealStage]||[])[currentDealIdx];
      if(d && d.email === email) ddpLoadCorrespondence(d);
    }
  });
}
window.glAutoSyncContact = glAutoSyncContact;

// Attaches the Sync handler to a freshly-rendered correspondence panel. Values
// are captured in this closure rather than written into an HTML attribute, so
// an address containing a quote can never break the button.
function glWireCorrSync(box, email, panel, id){
  if(!box) return;
  var btn = box.querySelector('.gl-corr-sync');
  if(!btn) return;
  btn.addEventListener('click', function(){ glSyncCorrPanel(btn, email, panel, id); });
}
window.glWireCorrSync = glWireCorrSync;

// Resilient email_log loader shared by the lead (Deal Details), lead composer,
// and client correspondence panels. Older databases may not have run the
// inbound-email migration (the `direction` / `from_email` columns), which made
// the strict column-list + OR-filter query fail outright ("Could not load
// correspondence"). This selects `*` (so a missing column can't break the
// SELECT) and, if the two-direction OR filter errors, falls back to matching
// on `to_email` alone — the always-present core column — so outbound history
// still shows. Returns { rows, error }.
// Collapses rows that are the SAME message logged twice — one written by the
// CRM when it sent the mail, one pulled back out of Gmail by gmail-sync. The
// sync now avoids creating these, but rows logged before that fix are already
// in the table, so we also merge them on the way out: same subject (ignoring a
// Re:/Fwd: prefix), same side of the conversation, within ten minutes.
//
// Doing it here rather than deleting rows means no destructive cleanup is
// needed, and the counts, nudge logic and thread all agree because every panel
// reads through this one loader.
function glDedupeEmailRows(rows){
  var norm = function(v){
    return String(v == null ? '' : v).replace(/^\s*(re|fwd|fw)\s*:\s*/gi, '')
      .replace(/\s+/g, ' ').trim().toLowerCase();
  };
  var when = function(x){ return Date.parse(x && (x.sent_at || x.created_at) || '') || 0; };
  var kept = [];
  (rows || []).forEach(function(row){
    var rSub = norm(row.subject);
    var rIn  = row.direction === 'inbound';
    var rAt  = when(row);
    var dupOf = null;
    for(var i = 0; i < kept.length; i++){
      var k = kept[i];
      if(norm(k.subject) !== rSub) continue;
      if((k.direction === 'inbound') !== rIn) continue;   // a reply is NOT a duplicate
      if(Math.abs(when(k) - rAt) > 10 * 60000) continue;
      dupOf = i; break;
    }
    if(dupOf === null){ kept.push(row); return; }
    // Same message twice: keep whichever copy has more of the body, since the
    // CRM stores the full text while Gmail only gives a short snippet.
    var a = kept[dupOf], aLen = (a.body_preview || '').length, bLen = (row.body_preview || '').length;
    if(bLen > aLen) kept[dupOf] = row;
  });
  // Order by when the email was actually SENT, newest first. Ordering by
  // created_at (row insert time) put the thread out of sequence, because the
  // Gmail sync files a reply long after the CRM logged the messages either side
  // of it. That also made the nudge below pick the wrong "last email".
  kept.sort(function(a, b){ return glCorrTime(b) - glCorrTime(a); });
  return kept;
}

// Timestamp for ordering / nudge maths: the send time, falling back to when the
// row was created for older rows that never had one.
function glCorrTime(row){
  var t = Date.parse((row && (row.sent_at || row.created_at)) || '');
  return Number.isFinite(t) ? t : 0;
}
window.glCorrTime = glCorrTime;

// Shared "they haven't replied" check for the lead and client panels — one
// implementation so the two can't drift apart.
// Returns { days } when the newest OUTBOUND email has had no inbound reply
// after it for 3+ days, otherwise null.
function glNoReplyFor(rows){
  var outs = (rows || []).filter(function(x){ return x.direction !== 'inbound'; });
  if(!outs.length) return null;
  // Newest by send time, not by position in the array.
  var lastOutAt = Math.max.apply(null, outs.map(glCorrTime));
  if(!lastOutAt) return null;
  var replied = (rows || []).some(function(x){
    return x.direction === 'inbound' && glCorrTime(x) > lastOutAt;
  });
  if(replied) return null;
  var days = Math.floor((Date.now() - lastOutAt) / 86400000);
  return days >= 3 ? { days: days } : null;
}
window.glNoReplyFor = glNoReplyFor;

// OUTREACH INDEX (for the pipeline board)
// One query builds a per-contact summary of email_log, so a kanban card can
// show follow-up state at a glance without a query per card (32 deals would
// otherwise mean 32 round trips on every render).
window.GL_OUTREACH = window.GL_OUTREACH || {};
async function glLoadOutreachIndex(){
  if(!window.supa) return false;
  var r = await window.supa.from('email_log')
    .select('to_email, from_email, direction, sent_at, created_at')
    .order('created_at', { ascending: false }).limit(2000);
  if(r.error){ console.warn('[GL] outreach index failed', r.error); return false; }
  var idx = {};
  (r.data || []).forEach(function(row){
    var inbound = row.direction === 'inbound';
    var raw = String((inbound ? row.from_email : row.to_email) || '');
    var t = glCorrTime(row);
    // to_email may hold several recipients; index the contact under each.
    raw.split(/[,;]/).forEach(function(part){
      var a = part.trim().replace(/^[^<]*</, '').replace(/>.*$/, '').toLowerCase();
      if(!a || a.indexOf('@') < 0) return;
      var e = idx[a] || (idx[a] = { lastOut: 0, lastIn: 0, outTimes: [] });
      if(inbound){ if(t > e.lastIn) e.lastIn = t; }
      else { if(t > e.lastOut) e.lastOut = t; e.outTimes.push(t); }
    });
  });
  // How many emails we have sent since their most recent reply.
  Object.keys(idx).forEach(function(a){
    var e = idx[a];
    e.sinceReply = e.outTimes.filter(function(t){ return t > e.lastIn; }).length;
  });
  window.GL_OUTREACH = idx;
  return true;
}
window.glLoadOutreachIndex = glLoadOutreachIndex;

// Compact kanban badge answering "where does this lead stand?" without opening
// it: whether they replied, whether we already nudged, and how long ago.
function glOutreachBadge(email){
  if(!email) return '';
  var e = (window.GL_OUTREACH || {})[String(email).trim().toLowerCase()];
  if(!e || !e.lastOut) return '';
  var pill = function(color, label){
    return '<span style="display:inline-block;padding:2px 8px;border-radius:20px;font-size:10px;font-weight:700;' +
      'background:' + color + '22;color:' + color + ';border:1px solid ' + color + '55;white-space:nowrap">' +
      label + '</span>';
  };
  if(e.lastIn > e.lastOut) return pill('#1D9E75', '\u2713 replied');
  var days = Math.floor((Date.now() - e.lastOut) / 86400000);
  var ago = days <= 0 ? 'today' : (days === 1 ? '1d ago' : days + 'd ago');
  if(e.sinceReply >= 2){
    // First email plus at least one follow-up: they have been nudged.
    return pill('#c4a4f8', '\u270D\uFE0F nudged ' + ago + (e.sinceReply > 2 ? ' \u00D7' + e.sinceReply : ''));
  }
  return pill('#6b87ad', '\u2709\uFE0F sent ' + ago);
}
window.glOutreachBadge = glOutreachBadge;

// "Awaiting first reply" badge — the visual half of the SLA watchdog. Shows on a
// lead we have not yet replied to once more than one business day has passed,
// unless it's been snoozed or marked handled. Mirrors the server-side rule so
// the board and the WhatsApp alert agree on who is overdue.
function glBusinessHoursSince(iso){
  if(!iso) return 0;
  var start = new Date(iso).getTime(); if(!start) return 0;
  var now = Date.now(); if(now <= start) return 0;
  var hrs = 0, cur = new Date(start);
  // Cap the walk so a very old lead doesn't loop forever; 30 business days is
  // far past the 24-hour threshold we care about.
  var guard = 0;
  while(cur.getTime() < now && guard < 24*45){
    var dow = cur.getUTCDay();
    if(dow !== 0 && dow !== 6) hrs++;
    cur.setUTCHours(cur.getUTCHours()+1);
    guard++;
  }
  return hrs;
}
function glSlaBadge(d){
  if(!d) return '';
  if(d.handledAt) return '';
  if(d.snoozedUntil && new Date(d.snoozedUntil).getTime() > Date.now()) return '';
  if(d.firstResponseAt) return '';
  // If our outreach index shows we've emailed them, treat as replied-to.
  var e = d.email && (window.GL_OUTREACH || {})[String(d.email).split(/[,;]/)[0].trim().toLowerCase()];
  if(e && e.lastOut) return '';
  if(glBusinessHoursSince(d.createdAt) < 24) return '';
  var c = '#e74c3c';
  return '<span style="display:inline-block;padding:2px 8px;border-radius:20px;font-size:10px;font-weight:800;background:'+c+'22;color:'+c+';border:1px solid '+c+'66;white-space:nowrap">⚠️ awaiting reply</span>';
}
window.glSlaBadge = glSlaBadge;

// Snooze / mark-handled: the desk equivalents of the one-tap phone links. Both
// tell the lead-automations watchdog to stop nagging about this lead — snooze
// for a week, handled indefinitely. .select() so an RLS-silent write is caught.
async function glSnoozeLead(id){
  if(!id || !window.supa) return;
  var until = new Date(Date.now()+7*86400000).toISOString();
  try {
    var r = await window.supa.from('deals').update({snoozed_until:until}).eq('id',id).select('id');
    if(r.error || !r.data || !r.data.length){ if(typeof addNotification==='function') addNotification('Snooze failed','Could not save — try again.','warning'); return; }
    if(typeof addNotification==='function') addNotification('💤 Lead snoozed','No nudges for 7 days.','success');
    var d = (deals[currentDealStage]||[])[currentDealIdx]; if(d) d.snoozedUntil = until;
    if(typeof renderKanban==='function') renderKanban();
    if(typeof openDealDetail==='function' && currentDealStage!=null) openDealDetail(currentDealStage,currentDealIdx);
  } catch(e){}
}
async function glMarkLeadHandled(id){
  if(!id || !window.supa) return;
  var now = new Date().toISOString();
  try {
    var r = await window.supa.from('deals').update({handled_at:now}).eq('id',id).select('id');
    if(r.error || !r.data || !r.data.length){ if(typeof addNotification==='function') addNotification('Update failed','Could not save — try again.','warning'); return; }
    if(typeof addNotification==='function') addNotification('✓ Marked handled','Automations will leave it alone.','success');
    var d = (deals[currentDealStage]||[])[currentDealIdx]; if(d) d.handledAt = now;
    if(typeof renderKanban==='function') renderKanban();
    if(typeof openDealDetail==='function' && currentDealStage!=null) openDealDetail(currentDealStage,currentDealIdx);
  } catch(e){}
}
window.glSnoozeLead = glSnoozeLead;
window.glMarkLeadHandled = glMarkLeadHandled;
window.glDedupeEmailRows = glDedupeEmailRows;

// Free/consumer email providers — a lead's own address may be at one of these,
// but we must NEVER treat the domain as "their company" or we'd cross-wire every
// gmail lead's thread together.
var GL_FREE_EMAIL_DOMAINS = {
  'gmail.com':1,'googlemail.com':1,'yahoo.com':1,'ymail.com':1,'yahoo.co.uk':1,
  'hotmail.com':1,'outlook.com':1,'live.com':1,'msn.com':1,'aol.com':1,
  'icloud.com':1,'me.com':1,'mac.com':1,'proton.me':1,'protonmail.com':1,
  'gmx.com':1,'zoho.com':1,'mail.com':1,'comcast.net':1,'verizon.net':1,'att.net':1,'sbcglobal.net':1
};
function glCleanDomain(d){
  return String(d||'').toLowerCase().replace(/^https?:\/\//,'').replace(/^www\./,'').split('/')[0].split('?')[0].trim();
}

// Load the email thread for a lead/client. Matches the exact address AND anyone
// at the same COMPANY: a client often starts on one address and later writes
// from another at the same domain — matching only the exact address silently
// dropped half the thread (and left the brief blind to it). We match the
// company email domain (from the address and/or an optional website), plus a
// distinctive token from the company name, but never a free provider.
//   opts = { co: 'Company Name', domains: ['company.com', ...] }
async function glLoadEmailLog(email, opts){
  var sb = window.supa;
  if(!sb || !email) return { rows: [], error: null };
  opts = opts || {};
  var esc = function(s){ return String(s).replace(/%/g,'\\%').replace(/_/g,'\\_'); };
  // A lead's email field can hold several addresses ("a@x.com,b@x.com"); split
  // so each is matched on its own (and contributes its own company domain).
  var addrs = String(email).toLowerCase().split(/[,;]/).map(function(s){ return s.trim(); })
              .filter(function(s){ return s.indexOf('@') >= 0; });
  if(!addrs.length) return { rows: [], error: null };
  var conds = [];
  addrs.forEach(function(a){
    conds.push('to_email.ilike.%' + esc(a) + '%');
    conds.push('from_email.ilike.%' + esc(a) + '%');
  });

  var domains = [];
  var addDomain = function(d){
    d = glCleanDomain(d);
    if(d && d.indexOf('.') > 0 && !GL_FREE_EMAIL_DOMAINS[d] && domains.indexOf(d) < 0) domains.push(d);
  };
  addrs.forEach(function(a){ addDomain(a.split('@')[1] || ''); });
  (opts.domains || []).forEach(addDomain);
  domains.forEach(function(d){
    conds.push('to_email.ilike.%@' + esc(d) + '%');
    conds.push('from_email.ilike.%@' + esc(d) + '%');
  });

  // Company-name token → match against the domain part (catches the case where
  // the lead's on-file address is a personal gmail but they also write from the
  // company domain). Conservative: needs a distinctive 6+ char token.
  if(opts.co){
    var tok = String(opts.co).toLowerCase().replace(/[^a-z0-9]/g,'');
    ['llc','inc','corp','ltd','company','beverages','beverage','brands','brand','drinks','drink'].forEach(function(sfx){
      if(tok.length > sfx.length + 3 && tok.slice(-sfx.length) === sfx) tok = tok.slice(0, -sfx.length);
    });
    if(tok.length >= 6){
      conds.push('to_email.ilike.%@%' + esc(tok) + '%');
      conds.push('from_email.ilike.%@%' + esc(tok) + '%');
    }
  }

  var r = await sb.from('email_log').select('*')
    .or(conds.join(','))
    .order('created_at', { ascending: false }).limit(80);
  if(!r.error) return { rows: glDedupeEmailRows(r.data || []), error: null };
  console.warn('[GL] email_log OR query failed; retrying on to_email only', r.error);
  var r2 = await sb.from('email_log').select('*')
    .ilike('to_email', '%' + esc(addrs[0]) + '%')
    .order('created_at', { ascending: false }).limit(50);
  if(!r2.error) return { rows: glDedupeEmailRows(r2.data || []), error: null };
  console.error('[GL] email_log load failed', r2.error);
  return { rows: [], error: r2.error };
}
window.glLoadEmailLog = glLoadEmailLog;

async function ddpLoadCorrespondence(d){
  var box = document.getElementById('ddp-corr');
  if(!box) return;
  if(!d || !d.email){
    box.innerHTML = '<div style="font-size:11px;color:var(--muted)">Add an email address to this lead to track correspondence.</div>';
    return;
  }
  if(!window.supa){ box.innerHTML = ''; return; }
  box.innerHTML = '<div style="font-size:11px;color:var(--muted)">Loading correspondence…</div>';
  var _res = await glLoadEmailLog(d.email, { co: d.co });
  if(_res.error){ box.innerHTML = '<div style="font-size:11px;color:#ff8579">Could not load correspondence.</div>'; return; }
  var rows = _res.rows;

  var header = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">' +
      '<span style="font-size:10px;letter-spacing:2px;color:var(--teal)">📧 CORRESPONDENCE' + (rows.length ? ' (' + rows.length + ')' : '') + '</span>' +
      '<span style="display:flex;gap:6px">' +
        // Wired with addEventListener below, not an inline onclick: embedding an
        // email address in an HTML attribute is a quoting trap (a stray quote
        // silently truncates the attribute and kills the handler).
        '<button class="gl-corr-sync" title="Pull the latest email in from Gmail" style="font-size:11px;padding:4px 10px;background:rgba(255,255,255,.05);color:var(--muted);border:1px solid rgba(255,255,255,.12);border-radius:6px;cursor:pointer">🔄 Sync</button>' +
        '<button onclick="openLeadEmailComposer()" style="font-size:11px;padding:4px 12px;background:rgba(26,111,255,.15);color:#6b9fff;border:1px solid rgba(26,111,255,.35);border-radius:6px;cursor:pointer">✉️ New email</button>' +
      '</span>' +
    '</div>';

  // Draft-nudge is ALWAYS available — Mike decides when to reach out. The amber
  // "no reply in N days" note only appears when we're genuinely waiting on them.
  var stale = glNoReplyFor(rows);
  var nudgeNote = stale
    ? '<span style="font-size:12px;color:#f5c842;line-height:1.4">⏰ No reply in ' + stale.days + ' days.</span>'
    : '<span style="font-size:12px;color:var(--muted);line-height:1.4">Draft a follow-up whenever you like.</span>';
  var nudge = '<div style="background:' + (stale ? 'rgba(245,200,66,.08)' : 'rgba(255,255,255,.03)') + ';border:1px solid ' + (stale ? 'rgba(245,200,66,.3)' : 'rgba(255,255,255,.1)') + ';border-radius:8px;padding:10px 12px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">' +
      nudgeNote +
      '<button onclick="ddpNudgeLead()" style="font-size:12px;white-space:nowrap;padding:5px 13px;background:rgba(245,200,66,.18);color:#f5c842;border:1px solid rgba(245,200,66,.45);border-radius:6px;cursor:pointer;font-weight:700">✍️ Draft nudge</button>' +
    '</div>';

  if(!rows.length){
    box.innerHTML = header + nudge + '<div style="font-size:11px;color:var(--muted)">No emails logged for this lead yet. Use 🔄 Sync to pull history in from Gmail.</div>';
    glWireCorrSync(box, d.email, 'ddp');
    glAutoSyncContact(d.email, 'ddp');
    return;
  }

  box.innerHTML = header + nudge + glRenderCorrespondence('ddp', rows);
  glWireCorrSync(box, d.email, 'ddp');
  glAutoSyncContact(d.email, 'ddp');
}

function editDealDetail(){
  const stage = currentDealStage;
  const idx = currentDealIdx;
  const d = (deals[stage]||[])[idx];
  if(!d) return;
  const sv = (id, val) => { const el = document.getElementById(id); if(el) el.value = val||''; };
  document.getElementById('ddp-title').textContent = d.name || 'EDIT DEAL';
  sv('ddp-name',    d.name);
  sv('ddp-co',      d.co);
  sv('ddp-contact', d.contactName);
  sv('ddp-email',   d.email);
  sv('ddp-phone',   d.phone);
  sv('ddp-city',    d.city);
  sv('ddp-state',   d.state);
  sv('ddp-service', d.service);
  sv('ddp-product', d.productType);
  sv('ddp-volume',  d.volume);
  sv('ddp-timeline',d.timeline);
  sv('ddp-funding', d.fundingStage);
  sv('ddp-source',  d.leadSource);
  sv('ddp-val',     parseInt((d.val||'$0').replace(/[$,]/g,'')) || 0);
  sv('ddp-prob',    d.prob || 20);
  sv('ddp-stage',   stage);
  sv('ddp-notes',   d.notes);
  var fbox = document.getElementById('ddp-formulation');
  if(fbox && typeof window.glFormulationBlock === 'function'){
    fbox.innerHTML = window.glFormulationBlock(d, 'ddp-form');
    if(typeof window.glFormulationBind === 'function') window.glFormulationBind('ddp-form');
  }
  document.getElementById('ddp-view-mode').style.display = 'none';
  document.getElementById('ddp-edit-mode').style.display = 'flex';
}

function closeDealDetail(){
  document.getElementById('deal-detail-panel').classList.remove('show');
  currentDealStage = null;
  currentDealIdx = null;
  window.currentDealStage = null;
  window.currentDealIdx = null;
}

async function saveDealDetail(){
  if(currentDealStage === null || currentDealIdx === null) return;
  const d = (deals[currentDealStage]||[])[currentDealIdx];
  if(!d) return;

  const gv = id => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
  const newName        = gv('ddp-name');
  const newCo          = gv('ddp-co');
  const newContactName = gv('ddp-contact');
  const newEmail       = gv('ddp-email');
  const newPhone       = gv('ddp-phone');
  const newCity        = gv('ddp-city');
  const newState       = gv('ddp-state').toUpperCase();
  const newService     = gv('ddp-service');
  const newProduct     = gv('ddp-product');
  const newVolume      = gv('ddp-volume');
  const newTimeline    = gv('ddp-timeline');
  const newFunding     = gv('ddp-funding');
  const newSource      = gv('ddp-source');
  const newVal         = parseFloat(document.getElementById('ddp-val').value)||0;
  const newProb        = parseInt(document.getElementById('ddp-prob').value)||20;
  const newStage       = gv('ddp-stage');
  const newNotes       = gv('ddp-notes');
  // Formulation block (checkbox + house + spend). null when the module or the
  // block is absent, in which case the existing values are left untouched.
  const newFormulation = (typeof window.glFormulationRead === 'function')
    ? window.glFormulationRead('ddp-form') : null;

  // Update local deal object
  d.name         = newName;
  d.co           = newCo;
  d.contactName  = newContactName;
  d.email        = newEmail;
  d.phone        = newPhone;
  d.city         = newCity;
  d.state        = newState;
  d.service      = newService;
  d.productType  = newProduct;
  d.volume       = newVolume;
  d.timeline     = newTimeline;
  d.fundingStage = newFunding;
  d.leadSource   = newSource;
  d.val          = '$' + newVal.toLocaleString();
  d.prob         = newProb;
  d.notes        = newNotes;
  if(newFormulation){
    d.formulationDone   = newFormulation.done;
    d.formulationVendor = newFormulation.vendor || '';
    d.formulationSpend  = newFormulation.spend;
    d.formulationPct    = newFormulation.pct;
  }

  // Move to different stage if changed; reset stage timer.
  // Remember the pre-move location so a rejected DB write can be rolled back —
  // otherwise the card appears to move (Close Won/Lost) while nothing persists,
  // and reverts on the next reload. See CLAUDE.md rule #4.
  const prevStage = currentDealStage;
  const prevStageEnteredAt = d.stageEnteredAt;
  const stageChanged = newStage !== currentDealStage;
  if(stageChanged){
    d.stageEnteredAt = new Date().toISOString();
    deals[currentDealStage].splice(currentDealIdx, 1);
    if(!deals[newStage]) deals[newStage] = [];
    deals[newStage].push(d);
  }

  // Save to Supabase if real id
  if(d.id && !String(d.id).startsWith('tmp_')){
    const updatePayload = {
      name: newName, client_name: newCo, value: newVal,
      probability: newProb, stage: newStage, notes: newNotes,
      contact_name: newContactName || undefined,
      email:        newEmail       || undefined,
      phone:        newPhone       || undefined,
      city:         newCity        || undefined,
      state:        newState       || undefined,
      service:      newService     || undefined,
      product_type: newProduct     || undefined,
      volume:       newVolume      || undefined,
      timeline:     newTimeline    || undefined,
      funding_stage:newFunding     || undefined,
      lead_source:  newSource      || undefined
    };
    if(newFormulation){
      updatePayload.formulation_done   = newFormulation.done;
      updatePayload.formulation_vendor = newFormulation.vendor;
      updatePayload.formulation_spend  = newFormulation.spend;
      updatePayload.formulation_pct    = newFormulation.pct;
    }
    if(stageChanged) updatePayload.stage_entered_at = d.stageEnteredAt;
    // .select() so RLS/constraint rejections surface: a silent 0-row reject
    // must be treated as failure, not success. On failure, roll the in-memory
    // move back so the board reflects what actually saved.
    let uq;
    try {
      uq = await supa.from('deals').update(updatePayload).eq('id', d.id).select();
    } catch(e){ uq = { error: e }; }
    if(uq.error || (Array.isArray(uq.data) && uq.data.length === 0)){
      console.warn('Deal save failed:', uq.error || '0 rows');
      if(stageChanged){
        const i = (deals[newStage]||[]).indexOf(d);
        if(i > -1) deals[newStage].splice(i, 1);
        d.stageEnteredAt = prevStageEnteredAt;
        if(!deals[prevStage]) deals[prevStage] = [];
        deals[prevStage].push(d);
      }
      alert('Could not save this deal — the server rejected the change'
        + (uq.error ? ': ' + (uq.error.message || uq.error) : ' (0 rows changed).')
        + '\n\nNothing was saved and the deal has NOT been moved. Please try again.');
      renderKanban();
      renderDash();
      return;
    }
    if(stageChanged && newStage === 'Closed Won') glNotifyDeal('deal_closed_won', {name: newName, company: newCo, stage:'Closed Won', value: String(newVal), email: newEmail, phone: newPhone});
  } else if(stageChanged && newStage === 'Closed Won'){
    glNotifyDeal('deal_closed_won', {name: newName, company: newCo, stage:'Closed Won', value: String(newVal), email: newEmail, phone: newPhone});
  }

  touchDeal(d.name || d.co || d.id);
  closeDealDetail();
  renderKanban();
  renderDash();
}

async function deleteDeal(){
  if(currentDealStage === null || currentDealIdx === null) return;
  if(!confirm('Delete this deal?')) return;
  const stage = currentDealStage, idx = currentDealIdx;
  const d = (deals[stage]||[])[idx];
  if(d && d.id && !String(d.id).startsWith('tmp_')){
    // Confirm the server actually deleted the row before removing it from the
    // board — an RLS reject deletes 0 rows with no error (CLAUDE.md rule #4).
    let dq;
    try { dq = await supa.from('deals').delete().eq('id', d.id).select(); }
    catch(e){ dq = { error: e }; }
    if(dq.error || (Array.isArray(dq.data) && dq.data.length === 0)){
      alert('Could not delete this deal — the server rejected it'
        + (dq.error ? ': ' + (dq.error.message || dq.error) : ' (0 rows). Nothing was deleted.'));
      return;
    }
  }
  deals[stage].splice(idx, 1);
  closeDealDetail();
  renderKanban();
  renderDash();
}

document.getElementById('deal-detail-panel').addEventListener('click', function(e){
  if(e.target === this) closeDealDetail();
});



/* ═══════════════════════════════════════════════
   AI + ENHANCED FEATURES — Good Liquid CRM
   ═══════════════════════════════════════════════ */

/* AI calls now route through the `ai-proxy` Edge Function. The Anthropic
   API key lives in Supabase secrets only — never exposed to the browser. */
const AI_MODEL = 'claude-haiku-4-5';
// Self-serve scheduling link, offered by AI reply drafts when a call/tour is the
// next step so the lead can pick a time without a back-and-forth. Update the
// slug if the active booking page changes.
const GL_BOOKING_URL = 'https://goodliquidbevco.com/book.html?u=mike-krail';

function openAISettings(){
  const existing = document.getElementById('ai-settings-overlay');
  if(existing) existing.remove();
  const ov = document.createElement('div');
  ov.id = 'ai-settings-overlay';
  ov.style.cssText = 'position:fixed;inset:0;z-index:900;background:rgba(6,13,26,.95);backdrop-filter:blur(16px);display:flex;align-items:center;justify-content:center;padding:20px';
  ov.innerHTML = `
    <div style="background:#142238;border:1px solid rgba(0,229,192,.2);border-radius:16px;padding:36px;width:100%;max-width:500px">
      <div style="font-family:var(--ff-disp);font-size:22px;letter-spacing:2px;color:var(--teal);margin-bottom:8px">🤖 AI SETTINGS</div>
      <div style="font-size:13px;color:var(--muted);margin-bottom:18px;line-height:1.6">AI calls now route through a server-side proxy. The Anthropic API key is stored in Supabase secrets, never in your browser.</div>
      <div style="background:rgba(29,158,117,.1);border:1px solid rgba(29,158,117,.3);border-radius:8px;padding:12px 14px;font-size:13px;color:#1D9E75;margin-bottom:18px">✅ AI features are active. Model: <code style="font-family:var(--ff-mono);font-size:12px">${AI_MODEL}</code></div>
      <div style="font-size:11px;color:var(--muted);margin-bottom:20px;line-height:1.5">To rotate the key: run <code style="font-family:var(--ff-mono);font-size:11px;color:#9ca3af">supabase secrets set ANTHROPIC_API_KEY=sk-ant-...</code> in PowerShell. No frontend change needed.</div>
      <div style="display:flex;gap:10px">
        <button onclick="document.getElementById('ai-settings-overlay').remove()" style="flex:1;padding:13px;background:var(--teal);color:var(--ink);border:none;border-radius:8px;font-weight:800;cursor:pointer;font-size:14px">Close</button>
      </div>
    </div>`;
  document.body.appendChild(ov);
}

// House writing style, appended to every AI request. Applied here rather than
// in each individual prompt so a new AI feature inherits it automatically.
// The owner's ask: stop using dashes where a comma belongs.
const GL_AI_STYLE = '\n\nWriting style rules (follow strictly):\n' +
  '- Never use an em dash or en dash as punctuation. Use a comma, a period, ' +
  'or parentheses instead.\n' +
  '- For number ranges write "2 to 6 weeks", not "2-6 weeks".\n' +
  '- Hyphens inside hyphenated words are fine (co-packing, small-batch, shelf-stable).\n' +
  '- Write plainly, the way a person speaks. No filler and no marketing padding.\n' +
  '- ONLY when the email proposes a call, tour, or meeting as the next step, ' +
  'include this scheduling link on its own line so they can pick a time: ' +
  GL_BOOKING_URL + ' — do not include it otherwise.';

// Models ignore style instructions often enough that the rule alone is not
// enough, so the output is also cleaned deterministically. A dash between two
// numbers is a range ("440-1,320") and becomes "to"; anywhere else it becomes a
// comma. Hyphens are left completely alone, so "co-packing" and invoice numbers
// like GL-1042 are untouched.
function glStripDashes(text) {
  if (!text) return text;
  return String(text)
    .replace(/(\d)\s*[\u2014\u2013]\s*(\d)/g, '$1 to $2')
    .replace(/\s*[\u2014\u2013]\s*/g, ', ')
    .replace(/,\s*,+/g, ',')            // collapse doubled commas
    .replace(/,\s*([.!?;:])/g, '$1')    // ", ." -> "."
    .replace(/([(\[])\s*,\s*/g, '$1')  // "( ," -> "("
    .replace(/\s+,/g, ',')              // " ," -> ","
    .replace(/[ \t]{2,}/g, ' ');
}
window.glStripDashes = glStripDashes;

async function callAI(systemPrompt, userPrompt) {
  try {
    const resp = await supa.functions.invoke('ai-proxy', {
      body: { systemPrompt: (systemPrompt || '') + GL_AI_STYLE, userPrompt, model: AI_MODEL, maxTokens: 1024 }
    });
    if(resp.error){
      console.error('[ai-proxy] error', resp.error);
      if(typeof addNotification==='function') addNotification('AI request failed', resp.error.message || 'See console', 'warning');
      return '';
    }
    if(resp.data && resp.data.ok === false){
      console.error('[ai-proxy] rejected', resp.data.error);
      if(typeof addNotification==='function') addNotification('AI request failed', resp.data.error || 'See console', 'warning');
      return '';
    }
    return glStripDashes((resp.data && resp.data.text) || '') || 'AI response unavailable.';
  } catch(e){
    console.error('[ai-proxy] threw', e);
    return '';
  }
}

// ─── AI MODAL HELPER ───
function showAIModal(title, content, loading=false) {
  const existing = document.getElementById('ai-modal');
  if(existing) existing.remove();
  const m = document.createElement('div');
  m.id = 'ai-modal';
  m.style.cssText = 'position:fixed;inset:0;z-index:800;background:rgba(6,13,26,.95);backdrop-filter:blur(16px);display:flex;align-items:center;justify-content:center;padding:20px';
  m.innerHTML = `
    <div style="background:#142238;border:1px solid rgba(0,229,192,.2);border-radius:16px;padding:32px;width:100%;max-width:620px;max-height:85vh;overflow-y:auto">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
        <div style="font-family:var(--ff-disp);font-size:20px;letter-spacing:2px;color:var(--teal)">🤖 ${title}</div>
        <button onclick="document.getElementById('ai-modal').remove()" style="background:none;border:none;color:var(--muted);font-size:24px;cursor:pointer">✕</button>
      </div>
      <div id="ai-modal-body" style="font-size:14px;color:var(--white);line-height:1.8;white-space:pre-wrap">
        ${loading ? '<div style="text-align:center;padding:40px;color:var(--teal)">🤖 AI is thinking...</div>' : content}
      </div>
      ${loading ? '' : `
      <div style="display:flex;gap:10px;margin-top:20px">
        <button onclick="navigator.clipboard.writeText(document.getElementById('ai-modal-body').innerText).then(()=>alert('Copied!'))" style="flex:1;padding:11px;background:rgba(0,229,192,.1);border:1px solid rgba(0,229,192,.3);border-radius:8px;color:var(--teal);cursor:pointer;font-weight:700">Copy</button>
        <button onclick="document.getElementById('ai-modal').remove()" style="padding:11px 20px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:8px;color:var(--muted);cursor:pointer">Close</button>
      </div>`}
    </div>`;
  m.addEventListener('click', e=>{ if(e.target===m) m.remove(); });
  document.body.appendChild(m);
}
function closeAIModal(){ var m=document.getElementById('ai-modal'); if(m) m.remove(); }

// ─── AI: DRAFT FOLLOW-UP EMAIL ───
async function aiDraftEmail(clientName, invoiceNum, amount, status) {
  showAIModal('Email Drafter', '', true);
  const text = await callAI(
    'You are an expert business communication writer for Good Liquid Bev Co, a premium beverage co-packer in Palmetto, FL. Write professional, warm, and effective emails.',
    `Write a follow-up email for invoice ${invoiceNum} for ${clientName}. Amount: $$${amount}. Status: ${status}. 
    Keep it professional but friendly. Sign off as Good Liquid Accounting, Good Liquid Bev Co, (803) 493-5065.
    Include subject line. Keep it concise and effective.`
  );
  // Re-render the modal with content + buttons (helper handles teardown of the loading instance).
  showAIModal('Email Drafter', text, false);
}

// ─── AI: SCORE LEAD ───
async function aiScoreLead(dealName, company, value, stage, notes) {
  showAIModal('Lead Scorer', '', true);
  const text = await callAI(
    'You are a sales analyst for Good Liquid Bev Co, a beverage co-packer. Score leads based on deal info and provide actionable recommendations.',
    `Score this lead out of 100 and explain why:
    Deal: ${dealName}
    Company: ${company}
    Value: ${value}
    Stage: ${stage}
    Notes: ${notes||'None'}
    
    Provide: Score (0-100), Key strengths, Red flags, Next best action, Estimated close probability.`
  );
  document.getElementById('ai-modal-body').textContent = text;
}

// ─── AI: QUOTE ESTIMATOR ───
async function aiEstimateQuote() {
  const desc = prompt('Describe the beverage project (product type, volume, service needed, any special requirements):');
  if(!desc) return;
  showAIModal('Quote Estimator', '', true);
  const text = await callAI(
    `You are a pricing expert for Good Liquid Bev Co. Use these rates:
    CANNING — manufacturing labor per can (24 cans = 1 case; 200-case minimum). 12oz Standard & 12oz Sleek: 200-339 cases=$0.48/can, 340-500=$0.43, 501-999=$0.38, 1,000-2,499=$0.35, 2,500-4,999=$0.31, 5,000+=$0.28. 16oz Standard: 200-339=$0.58, 340-500=$0.53, 501-999=$0.48, 1,000-2,499=$0.45, 2,500-4,999=$0.41, 5,000+=$0.38. The client buys their own cans from a print vendor ($0.29-0.35/can) and packaging — trays + PakTechs — runs $0.05-0.06/can; quote those separately, they are NOT our labor.
    BOTTLING — 750ml, per bottle: 220 cases=$2.16, 660=$1.91, 1,320=$1.58, 2,640=$1.41, 5,280=$1.12.
    R&D: From $2,500 (includes 3 iterations). If the client already has a formula there is NO R&D fee — just a $500 test batch + a Process Authority Letter. IP License=$6,000/yr. Full IP buyout=$15,000.
    ADD-ONS: Flash Pasteurization=$0.05/can or $0.20/bottle. Nitrogen Dosing=$0.03/can.
    IMPORTANT: tiers are per CASE — if the customer gives a CAN count, divide by 24 to get cases before picking a tier.`,
    `Estimate the cost for this project: ${desc}
    
    Provide: Recommended service, Estimated volume, Itemized cost breakdown, Total estimated range (low-high), Timeline estimate, Key assumptions made.`
  );
  document.getElementById('ai-modal-body').textContent = text;
}

// ─── AI: INVOICE DRAFTER ───
async function aiDraftInvoice() {
  const desc = prompt('Describe the job to invoice (client, service, volume, any extras):');
  if(!desc) return;
  showAIModal('Invoice Drafter', '', true);
  const text = await callAI(
    `You are a billing specialist for Good Liquid Bev Co. Create clear invoice line items based on job descriptions.
    Rates (per can; 24 cans = 1 case; 200-case minimum): 12oz canning labor by volume — 200-339 cases=$0.48/can, 340-500=$0.43, 501-999=$0.38, 1,000-2,499=$0.35, 2,500-4,999=$0.31, 5,000+=$0.28; 16oz runs $0.38-0.58/can. Bottling (750ml) $1.12-2.16/bottle by volume. R&D from $2,500 (existing formula: no R&D fee, $500 test batch instead). Flash Pasteurization +$0.05/can or +$0.20/bottle. Nitrogen Dosing +$0.03/can. Convert can counts to cases (÷24) before picking a tier.`,
    `Create invoice line items for: ${desc}
    
    Format as clear line items with description, quantity, unit price, and subtotal. Include a total. Flag any assumptions.`
  );
  document.getElementById('ai-modal-body').textContent = text;
}

// ─── AI: SUMMARIZE CLIENT ───
async function aiSummarizeClient(clientId) {
  // Look the client up by id instead of receiving name/notes as string args —
  // those were interpolated raw into the button's onclick, allowing a client
  // name/note to break out and run script in the staff/admin browser (XSS).
  const c = (window.clients||[]).find(x=>x.id===clientId) || {};
  const clientName = c.name||'', billed = c.billed, service = c.service, status = c.status, notes = c.notes||'';
  showAIModal('Client Summary', '', true);
  const clientInvoices = invoices.filter(i=>i.clientName===clientName);
  const invSummary = clientInvoices.map(i=>`${i.id}: $$${i.amount} (${i.status})`).join(', ');
  const text = await callAI(
    'You are a CRM assistant for Good Liquid Bev Co. Summarize client relationships and provide actionable insights.',
    `Summarize this client relationship and suggest next steps:
    Client: ${clientName}
    Service: ${service}
    Status: ${status}
    Total Billed: $$${billed}
    Invoices: ${invSummary||'None'}
    Notes: ${notes||'None'}
    
    Provide: Relationship summary, Account health, Upsell opportunities, Recommended next action.`
  );
  document.getElementById('ai-modal-body').textContent = text;
}

// ─── PDF INVOICE DOWNLOAD ───
async function downloadInvoicePDF(invId) {
  const inv = invoices.find(i=>i.id===invId);
  if(!inv) return;
  const c = clients.find(x=>x.id===inv.client)||{name:inv.clientName,contact:'',email:''};

  // Build a proper Bill To block using the client's billing address if it
  // differs from physical, otherwise the physical address.
  const useBilling = c.billingSame === false && (c.billingStreet || c.billingCity);
  const bStreet = useBilling ? c.billingStreet : c.street;
  const bCity   = useBilling ? c.billingCity   : c.city;
  const bState  = useBilling ? c.billingState  : c.state;
  const bZip    = useBilling ? c.billingZip    : c.zip;
  const bLine2  = [bCity, bState].filter(Boolean).join(', ') + (bZip ? ' ' + bZip : '');
  const billToHtml = `<strong>${esc(c.legalName || c.name)}</strong>`
    + (c.legalName && c.legalName !== c.name ? `<br><span style="color:#666;font-size:12px">dba ${esc(c.name)}</span>` : '')
    + (bStreet ? `<br>${esc(bStreet)}` : '')
    + (bLine2.trim() ? `<br>${esc(bLine2)}` : '')
    + (c.contact ? `<br><span style="color:#666;font-size:12px">Attn: ${esc(c.contact)}</span>` : '')
    + (c.email ? `<br><span style="color:#666;font-size:12px">${esc(c.email)}</span>` : '');

  // Prefer the client's payment terms, fall back to whatever's on the invoice.
  const terms = inv.paymentTerms || c.paymentTerms || 'Due on receipt';

  const usd = n => '$' + (Number(n)||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
  const lines = Array.isArray(inv.lines) && inv.lines.length
    ? inv.lines
    : [{ desc: inv.svc, qty: 1, unitPrice: inv.amount, total: inv.amount }];
  const lineRowsHtml = lines.map(function(l){
    const qty = (l.qty != null) ? Number(l.qty).toLocaleString() : '';
    const unitLbl = l.unit ? '<span style="font-size:10px;color:#888;margin-left:4px">/'+l.unit+'</span>' : '';
    const up = (l.unitPrice != null) ? usd(l.unitPrice) + unitLbl : '';
    return '<tr>' +
      '<td>' + (l.desc || '') + '</td>' +
      '<td style="text-align:center">' + qty + '</td>' +
      '<td style="text-align:right">' + up + '</td>' +
      '<td style="text-align:right;font-weight:700">' + usd(l.total||0) + '</td>' +
    '</tr>';
  }).join('');
  const discountRowHtml = (inv.discount && inv.discountAmt)
    ? `<tr><td colspan="3" style="text-align:right;color:#666">Discount (${inv.discount}%)</td><td style="text-align:right;color:#666">−${usd(inv.discountAmt)}</td></tr>`
    : '';

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${inv.id} — Good Liquid Bev Co</title>
  <style>
    @page { size: letter; margin: 0.5in; }
    body{font-family:Arial,sans-serif;max-width:700px;margin:24px auto;color:#1a1a1a;font-size:14px}
    .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:32px;padding-bottom:20px;border-bottom:3px solid #0F6E56}
    .brand{font-size:22px;font-weight:900;color:#0F6E56;letter-spacing:2px}
    .brand-sub{font-size:11px;color:#666;margin-top:2px}
    .inv-title{font-size:28px;font-weight:900;color:#1a1a1a;text-align:right}
    .inv-num{font-size:14px;color:#0F6E56;text-align:right;font-weight:700}
    .meta{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:28px}
    .meta-box h4{font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#999;margin-bottom:6px}
    .meta-box p{font-size:14px;color:#1a1a1a;margin:0;line-height:1.6}
    table{width:100%;border-collapse:collapse;margin:24px 0}
    th{background:#0F6E56;color:white;padding:12px 16px;text-align:left;font-size:12px;letter-spacing:1px}
    td{padding:12px 16px;border-bottom:1px solid #eee}
    .total-row{font-weight:900;font-size:18px;color:#0F6E56}
    .status-badge{display:inline-block;padding:4px 12px;border-radius:20px;font-size:11px;font-weight:700;text-transform:uppercase;
      background:${inv.status==='paid'?'#d1fae5':inv.status==='overdue'?'#fee2e2':'#fef3c7'};
      color:${inv.status==='paid'?'#065f46':inv.status==='overdue'?'#991b1b':'#92400e'}}
    .footer{margin-top:40px;padding-top:16px;border-top:1px solid #eee;font-size:11px;color:#999;text-align:center}
    .print-hint{position:fixed;top:14px;right:14px;background:#0F6E56;color:#fff;padding:10px 18px;border-radius:8px;font-size:13px;box-shadow:0 4px 12px rgba(0,0,0,.2);z-index:9999}
    @media print { .print-hint { display:none } }
  </style></head><body>
  <div class="print-hint">In the print dialog, choose <b>Save as PDF</b> as the destination.</div>
  <div class="header">
    <div>
      <div class="brand">GOOD LIQUID BEV CO</div>
      <div class="brand-sub">2011 51st Ave E, Unit 100 · Palmetto, FL 34221</div>
      <div class="brand-sub">Mike@GoodLiquid.com · (803) 493-5065</div>
    </div>
    <div>
      <div class="inv-title">INVOICE</div>
      <div class="inv-num">${inv.id}</div>
      <div style="text-align:right;margin-top:6px"><span class="status-badge">${inv.status.toUpperCase()}</span></div>
    </div>
  </div>
  <div class="meta">
    <div class="meta-box"><h4>Bill To</h4><p>${billToHtml}</p></div>
    <div class="meta-box" style="text-align:right"><h4>Invoice Details</h4>
      <p>Date: ${inv.date}<br>Terms: ${terms}</p></div>
  </div>
  <table>
    <thead><tr>
      <th>Description</th>
      <th style="text-align:center">Qty</th>
      <th style="text-align:right">Unit Price</th>
      <th style="text-align:right">Amount</th>
    </tr></thead>
    <tbody>
      ${lineRowsHtml}
      ${discountRowHtml}
      ${inv.notes?`<tr><td colspan="4" style="font-size:12px;color:#666;font-style:italic">${inv.notes}</td></tr>`:''}
      <tr class="total-row"><td colspan="3">Total Due</td><td style="text-align:right">${usd(inv.amount)}</td></tr>
    </tbody>
  </table>
  <div style="margin-top:24px;padding:14px 18px;background:#f4fbf9;border:1px solid #0F6E56;border-radius:8px">
    <div style="font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#0F6E56;margin-bottom:8px;font-weight:700">Payment Instructions — Wire Transfer</div>
    <table style="width:100%;border-collapse:collapse;margin:0;font-size:13px">
      <tr><td style="padding:3px 0;color:#555;width:160px;border:0">Bank Name</td><td style="padding:3px 0;color:#1a1a1a;border:0">Gulfside Bank</td></tr>
      <tr><td style="padding:3px 0;color:#555;border:0">Account Number</td><td style="padding:3px 0;color:#1a1a1a;font-family:monospace;border:0">1000007789</td></tr>
      <tr><td style="padding:3px 0;color:#555;border:0">Routing (ABA)</td><td style="padding:3px 0;color:#1a1a1a;font-family:monospace;border:0">063116902</td></tr>
    </table>
  </div>
  <div class="footer">Payment to Good Liquid Bev Co · Mike@GoodLiquid.com · (803) 493-5065 · goodliquidbevco.com</div>
</body></html>`;

  // Open in a new window and let the browser's print-to-PDF generate a real PDF.
  // This avoids shipping a 200KB+ PDF library client-side. The user picks
  // "Save as PDF" in the print dialog destination.
  // NOTE: we cannot embed a <script> inside the template literal above — the
  // HTML parser doesn't care that the closing tag is inside a JS string and
  // will terminate the OUTER script element early, breaking everything below
  // it in this file. Instead, trigger print() on the popup window from here.
  const w = window.open('', '_blank');
  if(!w){
    alert('Popup blocked — allow popups for this site to download invoice PDFs.');
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
  setTimeout(function(){ try { w.focus(); w.print(); } catch(e){} }, 350);
}

// ─── SEND INVOICE BY EMAIL ───
// Builds an HTML email body for the invoice (same data as the PDF but
// styled for email clients) and opens a composer with editable To / Cc /
// Bcc / Subject / Message. Sends via mailgun-send edge function with the HTML as the body.
function buildInvoiceEmailHtml(invId, opts){
  opts = opts || {};
  const inv = invoices.find(i => i.id === invId);
  if(!inv) return '';
  const c = clients.find(x => x.id === inv.client) || { name: inv.clientName, contact: '', email: '' };
  const usd = n => '$' + (Number(n)||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
  // Public portal link — drives "View & Pay" CTA. Falls back to wire-only
  // payment instructions when no token (e.g. caller didn't generate one).
  const portalUrl = opts.portalUrl || '';
  const showPay = !!portalUrl;
  const useBilling = c.billingSame === false && (c.billingStreet || c.billingCity);
  const bStreet = useBilling ? c.billingStreet : c.street;
  const bCity   = useBilling ? c.billingCity   : c.city;
  const bState  = useBilling ? c.billingState  : c.state;
  const bZip    = useBilling ? c.billingZip    : c.zip;
  const bLine2  = [bCity, bState].filter(Boolean).join(', ') + (bZip ? ' ' + bZip : '');
  const terms = inv.paymentTerms || c.paymentTerms || 'Due on receipt';
  const lines = Array.isArray(inv.lines) && inv.lines.length
    ? inv.lines
    : [{ desc: inv.svc, qty: 1, unitPrice: inv.amount, total: inv.amount }];
  const lineRows = lines.map(l => {
    const qty = (l.qty != null) ? Number(l.qty).toLocaleString() : '';
    const up = l.unitPrice != null ? usd(l.unitPrice) + (l.unit ? ' /'+l.unit : '') : '';
    return `<tr><td style="padding:10px 14px;border-bottom:1px solid #eee">${esc(l.desc||'')}</td><td style="padding:10px 14px;text-align:center;border-bottom:1px solid #eee">${qty}</td><td style="padding:10px 14px;text-align:right;border-bottom:1px solid #eee">${up}</td><td style="padding:10px 14px;text-align:right;font-weight:700;border-bottom:1px solid #eee">${usd(l.total||0)}</td></tr>`;
  }).join('');
  const discountRow = (inv.discount && inv.discountAmt)
    ? `<tr><td colspan="3" style="padding:8px 14px;text-align:right;color:#666">Discount (${inv.discount}%)</td><td style="padding:8px 14px;text-align:right;color:#666">−${usd(inv.discountAmt)}</td></tr>` : '';

  // Status badge colors — bright on light backgrounds, brand-aligned where possible
  const statusBg = inv.status==='paid' ? '#d1fae5' : inv.status==='overdue' ? '#fee2e2' : '#fff7d6';
  const statusFg = inv.status==='paid' ? '#065f46' : inv.status==='overdue' ? '#991b1b' : '#8a6500';

  return `<div style="max-width:700px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;color:#0a1628;font-size:14px;background:#ffffff">
    <!-- HEADER: table layout for email-client reliability (Gmail/Outlook strip flexbox) -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-bottom:3px solid #00e5c0">
      <tr>
        <td valign="top" style="padding:24px 28px">
          <div style="font-size:22px;font-weight:900;color:#00b89a;letter-spacing:2px;line-height:1.1">GOOD LIQUID BEV CO</div>
          <div style="font-size:11px;color:#6b87ad;margin-top:6px">2011 51st Ave E, Unit 100 · Palmetto, FL 34221</div>
          <div style="font-size:11px;color:#6b87ad">Mike@GoodLiquid.com · (803) 493-5065</div>
        </td>
        <td valign="top" align="right" style="padding:24px 28px;text-align:right">
          <div style="font-size:26px;font-weight:900;color:#0a1628;letter-spacing:3px;line-height:1">INVOICE</div>
          <div style="font-size:14px;color:#00b89a;font-weight:700;margin-top:4px;font-family:'Space Mono',monospace,Arial">${inv.id}</div>
          <div style="margin-top:8px">
            <span style="display:inline-block;background:${statusBg};color:${statusFg};padding:4px 12px;border-radius:14px;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase">${inv.status}</span>
          </div>
        </td>
      </tr>
    </table>

    <!-- BILL-TO + INVOICE-META -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="width:100%">
      <tr>
        <td valign="top" style="padding:18px 28px;width:60%">
          <div style="font-size:10px;letter-spacing:2px;color:#6b87ad;text-transform:uppercase;margin-bottom:4px">Bill To</div>
          <div style="font-weight:700;color:#0a1628">${esc(c.legalName||c.name||'')}</div>
          ${c.legalName && c.legalName !== c.name ? `<div style="font-size:11px;color:#6b87ad">dba ${esc(c.name)}</div>` : ''}
          ${bStreet ? `<div style="font-size:12px;color:#0a1628">${esc(bStreet)}</div>` : '<div style="font-size:11px;color:#aaa;font-style:italic">(address not on file)</div>'}
          ${bLine2.trim() ? `<div style="font-size:12px;color:#0a1628">${esc(bLine2)}</div>` : ''}
          ${c.contact ? `<div style="font-size:11px;color:#6b87ad;margin-top:4px">Attn: ${esc(c.contact)}</div>` : ''}
          ${c.email ? `<div style="font-size:11px;color:#6b87ad">${esc(c.email)}</div>` : ''}
          ${c.phone ? `<div style="font-size:11px;color:#6b87ad">${esc(c.phone)}</div>` : ''}
        </td>
        <td valign="top" align="right" style="padding:18px 28px;text-align:right">
          <div style="font-size:10px;letter-spacing:2px;color:#6b87ad;text-transform:uppercase;margin-bottom:4px">Invoice Details</div>
          <div style="font-size:12px;color:#0a1628">Date: ${esc(inv.date)}</div>
          <div style="font-size:12px;color:#0a1628">Terms: ${esc(terms)}</div>
        </td>
      </tr>
    </table>

    <!-- LINE ITEMS -->
    <table cellspacing="0" cellpadding="0" border="0" style="width:calc(100% - 56px);margin:8px 28px 0;border-collapse:collapse">
      <thead>
        <tr style="background:#0a1628;color:#00e5c0">
          <th align="left" style="padding:10px 14px;text-align:left;font-size:11px;letter-spacing:1px;font-weight:700">Description</th>
          <th align="center" style="padding:10px 14px;text-align:center;font-size:11px;letter-spacing:1px;font-weight:700">Qty</th>
          <th align="right" style="padding:10px 14px;text-align:right;font-size:11px;letter-spacing:1px;font-weight:700">Unit Price</th>
          <th align="right" style="padding:10px 14px;text-align:right;font-size:11px;letter-spacing:1px;font-weight:700">Amount</th>
        </tr>
      </thead>
      <tbody>
        ${lineRows}
        ${discountRow}
        ${inv.notes ? `<tr><td colspan="4" style="padding:10px 14px;font-size:12px;color:#6b87ad;font-style:italic">${esc(inv.notes)}</td></tr>` : ''}
        <tr style="background:#e6fbf6">
          <td colspan="3" style="padding:16px 14px;font-weight:900;color:#0a1628;font-size:16px;letter-spacing:.3px">Total Due</td>
          <td align="right" style="padding:16px 14px;text-align:right;font-weight:900;color:#00b89a;font-size:20px">${usd(inv.amount)}</td>
        </tr>
      </tbody>
    </table>

    ${showPay ? `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="width:100%;margin:24px 0 0">
      <tr><td align="center" style="padding:0 28px;text-align:center">
        <a href="${portalUrl}" style="display:inline-block;background:#00e5c0;color:#0a1628;padding:14px 34px;border-radius:8px;font-size:15px;font-weight:800;text-decoration:none;letter-spacing:.5px">💳 View Invoice & Pay Online →</a>
        <div style="font-size:11px;color:#6b87ad;margin-top:8px">Pay by card or ACH via Stripe. Or use the wire instructions below.</div>
      </td></tr>
    </table>` : ''}

    <!-- WIRE INSTRUCTIONS -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="width:calc(100% - 56px);margin:24px 28px;border-collapse:separate;background:#f0fbf7;border:1px solid #00e5c0;border-radius:8px">
      <tr><td style="padding:14px 18px">
        <div style="font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#00b89a;font-weight:700;margin-bottom:8px">Payment Instructions — Wire Transfer</div>
        <table cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;font-size:13px">
          <tr><td style="padding:3px 0;color:#6b87ad;width:160px">Bank Name</td><td style="color:#0a1628">Gulfside Bank</td></tr>
          <tr><td style="padding:3px 0;color:#6b87ad">Account Number</td><td style="color:#0a1628;font-family:'Space Mono',monospace,Arial">1000007789</td></tr>
          <tr><td style="padding:3px 0;color:#6b87ad">Routing (ABA)</td><td style="color:#0a1628;font-family:'Space Mono',monospace,Arial">063116902</td></tr>
        </table>
      </td></tr>
    </table>

    <div style="padding:14px 28px;border-top:1px solid #e5e7eb;font-size:11px;color:#6b87ad;text-align:center">
      Payment to Good Liquid Bev Co · Mike@GoodLiquid.com · (803) 493-5065 · goodliquidbevco.com
    </div>
  </div>`;
}

function openSendInvoiceModal(invId){
  const inv = invoices.find(i => i.id === invId);
  if(!inv){ alert('Invoice not found.'); return; }
  const c = clients.find(x => x.id === inv.client) || {};
  const primary = c.email || inv.clientEmail || '';
  const extras = (Array.isArray(c.additionalEmails) ? c.additionalEmails : [])
                   .map(e => e.email).filter(Boolean).filter(e => e !== primary);

  const prior = document.getElementById('gl-send-inv-modal');
  if(prior) prior.remove();
  const ov = document.createElement('div');
  ov.id = 'gl-send-inv-modal';
  ov.setAttribute('style','position:fixed;inset:0;z-index:1100;background:rgba(6,13,26,.85);backdrop-filter:blur(8px);display:flex;align-items:flex-start;justify-content:center;padding:30px;overflow-y:auto');

  const usd = n => '$' + (Number(n)||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
  const defaultSubject = `Invoice ${inv.id} from Good Liquid Bev Co — ${usd(inv.amount)}`;
  const defaultMessage = `Hi ${c.contact || c.name || 'there'},\n\nPlease find Invoice ${inv.id} below for ${usd(inv.amount)}.\n\nPayment is due ${inv.paymentTerms || 'on receipt'}. Wire instructions are included at the bottom of the invoice.\n\nLet me know if you have any questions.\n\nThanks,\nGood Liquid Accounting\n(803) 493-5065 · Mike@GoodLiquid.com`;

  ov.innerHTML = `
    <div style="background:#142238;border:1px solid rgba(26,111,255,.25);border-radius:14px;width:100%;max-width:720px;padding:24px 28px;color:#fff">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px">
        <div style="font-family:var(--ff-disp);font-size:18px;letter-spacing:2px;color:#6b9fff">📧 SEND INVOICE ${inv.id}</div>
        <button id="gl-si-close" style="background:none;border:none;color:#9aa7bd;font-size:22px;cursor:pointer;line-height:1">✕</button>
      </div>
      <div style="display:grid;grid-template-columns:80px 1fr;gap:8px 12px;align-items:center;font-size:13px">
        <label style="color:var(--muted);font-size:11px;letter-spacing:1px">TO</label>
        <input id="gl-si-to" class="finp" value="${esc(primary)}" placeholder="recipient@client.com (comma-separate for multiple)" style="font-size:13px">
        <label style="color:var(--muted);font-size:11px;letter-spacing:1px">CC</label>
        <input id="gl-si-cc" class="finp" value="${esc(extras.join(', '))}" placeholder="optional, comma-separated" style="font-size:13px">
        <label style="color:var(--muted);font-size:11px;letter-spacing:1px">BCC</label>
        <input id="gl-si-bcc" class="finp" placeholder="optional, comma-separated" style="font-size:13px">
        <label style="color:var(--muted);font-size:11px;letter-spacing:1px">SUBJECT</label>
        <input id="gl-si-subject" class="finp" value="${esc(defaultSubject)}" style="font-size:13px">
      </div>
      <div style="margin-top:14px"><div style="font-size:11px;letter-spacing:1px;color:var(--muted);margin-bottom:4px">MESSAGE (added above the invoice)</div>
        <textarea id="gl-si-message" class="finp" rows="6" style="resize:vertical;font-size:13px">${esc(defaultMessage)}</textarea>
      </div>
      <details style="margin-top:14px">
        <summary style="cursor:pointer;color:#6b9fff;font-size:12px;letter-spacing:1px">📄 PREVIEW EMBEDDED INVOICE</summary>
        <div id="gl-si-preview" style="margin-top:10px;background:#fff;border-radius:10px;max-height:420px;overflow-y:auto;border:1px solid rgba(255,255,255,.08)">${buildInvoiceEmailHtml(invId)}</div>
      </details>
      <div style="display:flex;gap:8px;margin-top:18px;justify-content:flex-end">
        <button id="gl-si-cancel" class="cbtn" style="font-size:13px">Cancel</button>
        <button id="gl-si-send" class="cbtn pri" style="font-size:13px">📤 Send Email</button>
      </div>
      <div id="gl-si-status" style="margin-top:10px;font-size:12px;color:var(--muted);min-height:18px"></div>
    </div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click', e => { if(e.target === ov) ov.remove(); });
  ov.querySelector('#gl-si-close').onclick = () => ov.remove();
  ov.querySelector('#gl-si-cancel').onclick = () => ov.remove();
  ov.querySelector('#gl-si-send').onclick = async function(){
    const btn = this;
    const status = ov.querySelector('#gl-si-status');
    const toRaw = ov.querySelector('#gl-si-to').value.trim();
    const ccRaw = ov.querySelector('#gl-si-cc').value.trim();
    const bccRaw = ov.querySelector('#gl-si-bcc').value.trim();
    const subject = ov.querySelector('#gl-si-subject').value.trim();
    const message = ov.querySelector('#gl-si-message').value;
    if(!toRaw){ status.style.color = '#ff8579'; status.textContent = 'At least one To recipient required.'; return; }
    if(!subject){ status.style.color = '#ff8579'; status.textContent = 'Subject required.'; return; }
    // Email credentials live server-side in the mailgun-send Edge Function.
    btn.disabled = true; btn.textContent = 'Preparing PDF…';
    status.style.color = 'var(--muted)'; status.textContent = '';
    // Generate a public share token (if not already set) so the email can
    // include a "View & Pay Online" CTA. The token grants anon read on
    // the invoice row + drives the customer portal Pay-via-Stripe flow.
    let portalUrl = '';
    try {
      if(typeof window.glGenerateInvoiceShareLink === 'function'){
        portalUrl = (await window.glGenerateInvoiceShareLink(inv.id)) || '';
      }
    } catch(e){ /* if token gen fails, send without the CTA */ }
    // Generate a PDF blob of the invoice and attach it. Renders the same
    // HTML the customer sees inline. Failure is non-blocking — we still
    // send with just the HTML body.
    let pdfAttachment = null;
    try { pdfAttachment = await generateInvoicePdfBlob(invId); }
    catch(e){ console.warn('[GL] PDF gen failed, sending without attachment', e); }
    btn.textContent = 'Sending…';
    const html = `<div style="font-family:Arial,sans-serif;color:#1a1a1a;line-height:1.55"><div style="white-space:pre-wrap;padding:0 28px 14px">${message.replace(/[&<>]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))}</div>${buildInvoiceEmailHtml(invId, { portalUrl: portalUrl })}</div>`;
    const ok = await sendMailgunEmail(toRaw, subject, message, {
      cc: ccRaw, bcc: bccRaw, html: html,
      attachments: pdfAttachment ? [pdfAttachment] : []
    });
    btn.disabled = false; btn.textContent = '📤 Send Email';
    if(ok){
      status.style.color = '#5fcf9e';
      const recipients = [toRaw, ccRaw, bccRaw].filter(Boolean).join(' · ');
      status.textContent = '✓ Sent. ' + recipients;
      if(typeof addNotification === 'function') addNotification('📧 Invoice sent', inv.id + ' → ' + toRaw + (ccRaw ? ' (+Cc)' : ''), 'email');
      if(typeof window.glAudit === 'function') window.glAudit('invoice_sent', invId, { to: toRaw, cc: ccRaw, bcc: bccRaw });
      glNotifyDeal('invoice_sent', {invoice_number: inv.id, client: inv.clientName||'', amount: String(inv.amount||''), to: toRaw});
      setTimeout(() => ov.remove(), 1400);
    } else {
      status.style.color = '#ff8579';
      status.textContent = '✗ Send failed. Check the browser console for details.';
    }
  };
}

// ─── CLIENT DETAIL PANEL ───
// Clicking a client opens the full, editable form directly for write users
// (admins / staff) — one view, every field, no separate "Edit" step. Pure
// read-only roles (viewer) still get the safe read-only card.
window.openClientCard = function(id){
  const u = window.currentUser;
  const canEdit = u && u.role !== 'viewer' && typeof window.glOpenEditClient === 'function';
  if(canEdit) return window.glOpenEditClient(id);
  if(typeof window.openClientDetail === 'function') return window.openClientDetail(id);
};

function openClientDetail(cid) {
  const c = clients.find(x=>x.id===cid);
  if(!c) return;
  const cInvoices = invoices.filter(i=>i.client===cid||i.clientName===c.name);
  const _dnorm = s => String(s==null?'':s).trim().toLowerCase();
  const cDeals = Object.values(deals).flat().filter(d=>{
    const nameMatch  = d.co && _dnorm(d.co) === _dnorm(c.name);
    const emailMatch = d.email && c.email && _dnorm(d.email) === _dnorm(c.email);
    return nameMatch || emailMatch;
  });
  const ref = referrers.find(r=>r.id===c.referredBy);
  const totalBilledAmt = cInvoices.reduce((s,i)=>s+(Number(i.amount)||0),0);
  const paid = cInvoices.filter(i=>i.status==='paid').reduce((s,i)=>s+(Number(i.amount)||0),0);
  const pending = cInvoices.filter(i=>i.status==='pending'||i.status==='overdue').reduce((s,i)=>s+(Number(i.amount)||0),0);

  const existing = document.getElementById('client-detail-overlay');
  if(existing) existing.remove();
  const ov = document.createElement('div');
  ov.id = 'client-detail-overlay';
  ov.style.cssText = 'position:fixed;inset:0;z-index:700;background:rgba(6,13,26,.92);backdrop-filter:blur(12px);display:flex;align-items:center;justify-content:center;padding:20px';
  ov.innerHTML = `
    <div style="background:#142238;border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:32px;width:100%;max-width:1000px;max-height:90vh;overflow-y:auto">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px">
        <div style="display:flex;align-items:center;gap:14px">
          <div style="width:56px;height:56px;border-radius:50%;background:${c.color};color:${c.tc};display:flex;align-items:center;justify-content:center;font-weight:900;font-size:18px;flex-shrink:0">${esc(c.init)}</div>
          <div>
            <div style="font-family:var(--ff-disp);font-size:22px;letter-spacing:2px;color:var(--white)">${esc(c.name)}</div>
            <div style="font-size:13px;color:var(--muted)">${esc(c.contact)} · ${esc(c.email)}</div>
            <span style="display:inline-block;margin-top:4px;padding:2px 10px;border-radius:20px;font-size:11px;font-weight:700;background:rgba(0,229,192,.1);color:var(--teal);border:1px solid rgba(0,229,192,.3)">${esc(c.service)}</span>
          </div>
        </div>
        <button onclick="document.getElementById('client-detail-overlay').remove()" style="background:none;border:none;color:var(--muted);font-size:24px;cursor:pointer">✕</button>
      </div>

      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:20px">
        <div style="background:rgba(255,255,255,.04);border-radius:10px;padding:14px;text-align:center">
          <div style="font-size:10px;color:var(--muted);letter-spacing:1px;margin-bottom:4px">TOTAL BILLED</div>
          <div style="font-family:var(--ff-disp);font-size:22px;color:var(--teal)">$${Number(totalBilledAmt||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
        </div>
        <div style="background:rgba(255,255,255,.04);border-radius:10px;padding:14px;text-align:center">
          <div style="font-size:10px;color:var(--muted);letter-spacing:1px;margin-bottom:4px">PAID</div>
          <div style="font-family:var(--ff-disp);font-size:22px;color:#1D9E75">$${Number(paid||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
        </div>
        <div style="background:rgba(255,255,255,.04);border-radius:10px;padding:14px;text-align:center">
          <div style="font-size:10px;color:var(--muted);letter-spacing:1px;margin-bottom:4px">OUTSTANDING</div>
          <div style="font-family:var(--ff-disp);font-size:22px;color:${pending>0?'#e74c3c':'var(--white)'}">$${Number(pending||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
        </div>
      </div>

      ${ref ? `<div style="background:rgba(0,229,192,.05);border:1px solid rgba(0,229,192,.15);border-radius:10px;padding:12px 16px;margin-bottom:16px;font-size:13px;color:var(--teal)">🤝 Referred by ${esc(ref.name)}</div>` : ''}

      <div id="cde-brief" style="margin-bottom:18px"></div>

      ${(typeof window.glClientInfoSections==='function') ? window.glClientInfoSections(c) : ''}

      <div style="margin-bottom:20px">
        <div style="font-size:10px;letter-spacing:2px;color:var(--muted);margin-bottom:10px">INVOICES (${cInvoices.length})</div>
        ${cInvoices.length===0 ? '<div style="color:var(--muted);font-size:13px">No invoices yet.</div>' :
          cInvoices.map(i=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid rgba(255,255,255,.05)">
            <div><div style="font-size:13px;font-weight:700;color:var(--teal)">${esc(i.id)}</div><div style="font-size:11px;color:var(--muted)">${esc(i.svc)}</div></div>
            <div style="display:flex;align-items:center;gap:10px">
              <div style="font-weight:700;color:var(--white)">$${i.amount.toLocaleString()}</div>
              <span style="padding:2px 8px;border-radius:20px;font-size:10px;font-weight:700;background:${i.status==='paid'?'rgba(29,158,117,.2)':i.status==='overdue'?'rgba(231,76,60,.2)':'rgba(255,255,255,.08)'};color:${i.status==='paid'?'#1D9E75':i.status==='overdue'?'#e74c3c':'var(--muted)'}">
                ${i.status.toUpperCase()}</span>
              <button onclick="downloadInvoicePDF('${i.id}')" style="font-size:10px;padding:3px 8px;background:rgba(0,229,192,.1);border:1px solid rgba(0,229,192,.3);border-radius:6px;color:var(--teal);cursor:pointer">⬇ PDF</button>
            </div>
          </div>`).join('')
        }
      </div>

      ${cDeals.length>0 ? `<div style="margin-bottom:20px">
        <div style="font-size:10px;letter-spacing:2px;color:var(--muted);margin-bottom:10px">PIPELINE DEALS (${cDeals.length})</div>
        ${cDeals.map(d=>`<div style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,.05)">
          <div style="font-size:13px;font-weight:700;color:var(--white)">${esc(d.name)}</div>
          <div style="font-size:11px;color:var(--muted)">${esc(d.val)} · ${esc(Object.keys(deals).find(s=>deals[s].includes(d))||'')}</div>
        </div>`).join('')}
      </div>` : ''}

      ${typeof window.glRenderClientNotesBlock === 'function' ? window.glRenderClientNotesBlock(c) : ''}

      <div id="cde-docs" style="margin-bottom:20px"></div>

      <div id="cde-notes" style="margin-bottom:20px"></div>

      <div style="margin-bottom:20px">
        <div id="cde-corr"><div style="font-size:11px;color:var(--muted)">Loading correspondence…</div></div>
      </div>

      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button onclick="(function(){var ov=document.getElementById('client-detail-overlay');if(ov)ov.remove();if(window.glOpenEditClient)window.glOpenEditClient('${c.id}');})()" style="flex:1;min-width:140px;padding:11px;background:rgba(245,200,66,.12);border:1px solid rgba(245,200,66,.35);border-radius:8px;color:#f5c842;cursor:pointer;font-weight:700;font-size:13px">✏️ Edit Client</button>
        <button onclick="createForClient('${c.id}');document.getElementById('client-detail-overlay').remove()" style="flex:1;min-width:140px;padding:11px;background:var(--teal);color:var(--ink);border:none;border-radius:8px;font-weight:800;cursor:pointer;font-size:13px">+ New Invoice</button>
        <button onclick="aiSummarizeClient('${c.id}')" style="flex:1;min-width:140px;padding:11px;background:rgba(0,229,192,.1);border:1px solid rgba(0,229,192,.3);border-radius:8px;color:var(--teal);cursor:pointer;font-weight:700;font-size:13px">🤖 AI Summary</button>
        <button onclick="window.glQuoteFromClient&&window.glQuoteFromClient('${c.id}')" style="flex:1;min-width:140px;padding:11px;background:rgba(26,111,255,.1);border:1px solid rgba(26,111,255,.35);border-radius:8px;color:#6b9fff;cursor:pointer;font-weight:700;font-size:13px">📋 Quote Builder</button>
        <button onclick="document.getElementById('client-detail-overlay').remove()" style="padding:11px 20px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:8px;color:var(--muted);cursor:pointer;font-size:13px">Close</button>
      </div>
    </div>`;
  ov.addEventListener('click', e=>{ if(e.target===ov) ov.remove(); });
  document.body.appendChild(ov);

  // Documents carried over from the pipeline (NDA, PA letter, formulas, labels)
  // plus anything uploaded here directly.
  if(typeof window.glRenderDealDocs === 'function'){
    window.glRenderDealDocs(document.getElementById('cde-docs'), { clientId: c.id });
  }
  // Meeting notes (Pocket AI NoteTaker etc.) for this client.
  if(typeof window.glRenderMeetingNotes === 'function'){
    window.glRenderMeetingNotes(document.getElementById('cde-notes'), { kind: 'client', id: c.id });
  }
  // AI Brief for this client.
  if(typeof window.glRenderBrief === 'function'){
    window.glRenderBrief(document.getElementById('cde-brief'), { kind:'client', id:c.id, email:c.email, name:c.name, co:c.name, stage:'client', notes:(c.notes||'') });
  }
  // Product intake questionnaire for this client (carried over from their tour /
  // onboarding, editable by staff).
  if(typeof window.glRenderIntake === 'function'){
    var cdeBr = document.getElementById('cde-brief');
    var cdeIt = document.getElementById('cde-intake');
    if(!cdeIt && cdeBr){ cdeIt = document.createElement('div'); cdeIt.id = 'cde-intake'; cdeIt.style.marginTop = '12px'; cdeBr.parentNode.insertBefore(cdeIt, cdeBr.nextSibling); }
    if(cdeIt) window.glRenderIntake(cdeIt, { kind:'client', clientId:c.id, email:c.email, name:c.name });
  }

  // Pull the client's email correspondence into the account view (same log the
  // pipeline uses — keyed by the client's email, so pipeline + later emails all
  // land here, not only in the deal panel).
  if(typeof cdeLoadCorrespondence === 'function'){ try { cdeLoadCorrespondence(c); } catch(e){} }

  // Auto-save client notes 1 second after user stops typing
  const notesEl = ov.querySelector(`#gl-notes-${c.id}`);
  const statusEl = ov.querySelector(`#gl-notes-status-${c.id}`);
  if(notesEl){
    let _notesTimer = null;
    notesEl.addEventListener('input', function(){
      if(statusEl) statusEl.textContent = '…';
      clearTimeout(_notesTimer);
      const val = this.value;
      _notesTimer = setTimeout(async () => {
        const ok = await (window.glSaveClientNotes ? window.glSaveClientNotes(c.id, val) : false);
        if(statusEl) statusEl.textContent = ok ? '✓ saved' : '⚠ saved locally only';
        setTimeout(()=>{ if(statusEl) statusEl.textContent = ''; }, 2500);
      }, 1000);
    });
  }
}

// ─── MONTHLY REPORTS ───
function openReports() {
  const existing = document.getElementById('reports-overlay');
  if(existing) existing.remove();

  const months = {};
  invoices.forEach(inv=>{
    if(!inv.date) return;
    const m = inv.date.slice(0,7);
    if(!months[m]) months[m]={paid:0,pending:0,overdue:0,count:0};
    months[m][inv.status]=(months[m][inv.status]||0)+inv.amount;
    months[m].count++;
  });
  const sortedMonths = Object.keys(months).sort();
  /* Use effective status so a pending invoice past its due_date counts as
     overdue here too (matches the dashboard tallies). */
  const totalPaid    = invoices.filter(i=>effectiveInvoiceStatus(i)==='paid'   ).reduce((s,i)=>s+(Number(i.amount)||0),0);
  const totalPending = invoices.filter(i=>effectiveInvoiceStatus(i)==='pending').reduce((s,i)=>s+(Number(i.amount)||0),0);
  const totalOverdue = invoices.filter(i=>effectiveInvoiceStatus(i)==='overdue').reduce((s,i)=>s+(Number(i.amount)||0),0);
  const topClients = [...clients].sort((a,b)=>(b.billed||0)-(a.billed||0)).slice(0,5);
  /* Always render currency with two decimals so $2,312.50 doesn't lose its trailing
     zero (toLocaleString() alone drops it). Used throughout this modal. */
  const fmtUsd = n => Number(n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});

  const ov = document.createElement('div');
  ov.id = 'reports-overlay';
  ov.style.cssText = 'position:fixed;inset:0;z-index:700;background:rgba(6,13,26,.95);backdrop-filter:blur(16px);display:flex;align-items:center;justify-content:center;padding:20px;overflow-y:auto';
  ov.innerHTML = `
    <div style="background:#142238;border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:32px;width:100%;max-width:800px;max-height:90vh;overflow-y:auto">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:28px">
        <div style="font-family:var(--ff-disp);font-size:24px;letter-spacing:2px;color:var(--teal)">📊 MONTHLY REPORTS</div>
        <button onclick="document.getElementById('reports-overlay').remove()" style="background:none;border:none;color:var(--muted);font-size:24px;cursor:pointer">✕</button>
      </div>

      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:28px">
        <div style="background:rgba(0,229,192,.08);border:1px solid rgba(0,229,192,.2);border-radius:12px;padding:20px;text-align:center">
          <div style="font-size:11px;color:var(--muted);letter-spacing:2px;margin-bottom:6px">TOTAL COLLECTED</div>
          <div style="font-family:var(--ff-disp);font-size:32px;color:var(--teal)">$${fmtUsd(totalPaid)}</div>
        </div>
        <div style="background:rgba(245,200,66,.08);border:1px solid rgba(245,200,66,.2);border-radius:12px;padding:20px;text-align:center">
          <div style="font-size:11px;color:var(--muted);letter-spacing:2px;margin-bottom:6px">PENDING</div>
          <div style="font-family:var(--ff-disp);font-size:32px;color:#f5c842">$${fmtUsd(totalPending)}</div>
        </div>
        <div style="background:rgba(231,76,60,.08);border:1px solid rgba(231,76,60,.2);border-radius:12px;padding:20px;text-align:center">
          <div style="font-size:11px;color:var(--muted);letter-spacing:2px;margin-bottom:6px">OVERDUE</div>
          <div style="font-family:var(--ff-disp);font-size:32px;color:#e74c3c">$${fmtUsd(totalOverdue)}</div>
        </div>
      </div>

      <div style="margin-bottom:28px">
        <div style="font-size:11px;letter-spacing:2px;color:var(--muted);margin-bottom:14px">MONTHLY BREAKDOWN</div>
        ${sortedMonths.length===0 ? '<div style="color:var(--muted);font-size:13px">No invoice data yet.</div>' :
          sortedMonths.map(m=>{
            const d=months[m];
            const total=(d.paid||0)+(d.pending||0)+(d.overdue||0);
            const maxBar=Math.max(...sortedMonths.map(x=>(months[x].paid||0)+(months[x].pending||0)+(months[x].overdue||0)))||1;
            const pct=Math.round(total/maxBar*100);
            return`<div style="margin-bottom:12px">
              <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px">
                <span style="color:var(--white);font-weight:600">${m}</span>
                <span style="color:var(--teal);font-weight:700">$${fmtUsd(total)} (${d.count} invoices)</span>
              </div>
              <div style="background:rgba(255,255,255,.06);border-radius:4px;height:8px;overflow:hidden">
                <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,var(--teal),#1a6fff);border-radius:4px;transition:width .5s"></div>
              </div>
              <div style="display:flex;gap:12px;margin-top:4px;font-size:10px;color:var(--muted)">
                ${d.paid?`<span style="color:#1D9E75">✓ Paid: $${fmtUsd(d.paid)}</span>`:''}
                ${d.pending?`<span style="color:#f5c842">⏳ Pending: $${fmtUsd(d.pending)}</span>`:''}
                ${d.overdue?`<span style="color:#e74c3c">⚠ Overdue: $${fmtUsd(d.overdue)}</span>`:''}
              </div>
            </div>`;
          }).join('')
        }
      </div>

      <div>
        <div style="font-size:11px;letter-spacing:2px;color:var(--muted);margin-bottom:14px">TOP CLIENTS BY REVENUE</div>
        ${topClients.map((c,i)=>`<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,.05)">
          <div style="font-family:var(--ff-disp);font-size:20px;color:var(--muted);min-width:24px">#${i+1}</div>
          <div style="width:36px;height:36px;border-radius:50%;background:${c.color};color:${c.tc};display:flex;align-items:center;justify-content:center;font-weight:900;font-size:12px;flex-shrink:0">${esc(c.init)}</div>
          <div style="flex:1"><div style="font-weight:700;color:var(--white);font-size:13px">${esc(c.name)}</div><div style="font-size:11px;color:var(--muted)">${esc(c.service)}</div></div>
          <div style="font-family:var(--ff-disp);font-size:20px;color:var(--teal)">$${fmtUsd(c.billed||0)}</div>
        </div>`).join('')}
      </div>

      ${renderArAgingSection()}

      <div style="display:flex;gap:10px;margin-top:24px">
        <button onclick="openArAging()" style="flex:1;padding:12px;background:rgba(245,200,66,.1);border:1px solid rgba(245,200,66,.3);border-radius:8px;color:#f5c842;font-weight:700;cursor:pointer;font-size:13px">📋 Accounts Receivable (A/R) Aging — Full Drill-Down</button>
        <button onclick="aiGenerateInsights()" style="flex:1;padding:12px;background:rgba(0,229,192,.1);border:1px solid rgba(0,229,192,.3);border-radius:8px;color:var(--teal);font-weight:700;cursor:pointer;font-size:13px">🤖 AI Business Insights</button>
        <button onclick="document.getElementById('reports-overlay').remove()" style="padding:12px 20px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:8px;color:var(--muted);cursor:pointer">Close</button>
      </div>
    </div>`;
  ov.addEventListener('click', e=>{ if(e.target===ov) ov.remove(); });
  document.body.appendChild(ov);
}

/* ── A/R AGING REPORT ───────────────────────────────────────────
   Moved to /src/modules/ar-aging.js (GL-037). It is loaded after this
   file; renderArAgingSection() and openArAging() are called from
   openReports() and from an onclick, both at runtime, so the ordering
   holds. aiGenerateInsights() below stays here — different capability. */


async function aiGenerateInsights() {
  showAIModal('Business Insights', '', true);
  const totalPaid = invoices.filter(i=>i.status==='paid').reduce((s,i)=>s+i.amount,0);
  const totalOverdue = invoices.filter(i=>i.status==='overdue').reduce((s,i)=>s+i.amount,0);
  const pipelineVal = Object.values(deals).flat().reduce((s,d)=>s+parseInt((d.val||'$0').replace(/[$,]/g,'')),0);
  const text = await callAI(
    'You are a business analyst for Good Liquid Bev Co, a beverage co-packer. Provide actionable business insights.',
    `Analyze this business data and provide insights:
    Total Revenue Collected: $${totalPaid.toLocaleString()}
    Overdue Amount: $${totalOverdue.toLocaleString()}
    Pipeline Value: $${pipelineVal.toLocaleString()}
    Active Clients: ${clients.filter(c=>c.status==='active').length}
    Total Invoices: ${invoices.length}
    
    Provide: Business health assessment, Top 3 opportunities, Top 3 risks, Recommended actions for next 30 days.`
  );
  document.getElementById('ai-modal-body').textContent = text;
}

// addAIToolbar is defined and fully managed in fix.js

// ─── PATCH CLIENT ROW CLICK TO OPEN DETAIL ───
/* renderClients override removed — click handlers added inline */

/* viewInvoice override removed - handled in viewInvoice directly */

/* initCRM override removed */











/* ═══════════════════════════════════════════
   DOCUMENT STORAGE (metadata only — file contents live in
   Supabase Storage when uploaded; this table is the index)
═══════════════════════════════════════════ */
let documents = [];
let docSearch='', docClientFilter='';
const typeIcons={'NDA':'📜','Formula':'🧪','Label Artwork':'🎨','COA':'🔬','Contract':'📋','Invoice':'🧾','Other':'📄'};

async function glDocumentsBackfill(){
  try {
    if(localStorage.getItem('gl_documents_migrated') === '1') return;
    if(!window.supa || !window.currentUser) return;
    const blob = localStorage.getItem('gl_documents');
    if(!blob){ localStorage.setItem('gl_documents_migrated','1'); return; }
    let legacy = []; try { legacy = JSON.parse(blob) || []; } catch(_e){ return; }
    if(!legacy.length){ localStorage.setItem('gl_documents_migrated','1'); return; }
    const rows = legacy.map(d => ({
      client_id:   /^[0-9a-f-]{36}$/i.test(d.clientId||'') ? d.clientId : null,
      client_name: d.clientName || null,
      name:        String(d.name || '').slice(0, 500),
      doc_type:    d.type || 'Other',
      notes:       d.notes || null,
      uploaded_by: d.uploadedBy || null,
      uploaded_at: d.uploadedAt || new Date().toISOString()
    }));
    const r = await window.supa.from('documents').insert(rows);
    if(r.error){ console.warn('[GL] documents backfill failed', r.error.message); return; }
    localStorage.setItem('gl_documents_migrated','1');
    if(typeof addNotification === 'function'){
      addNotification('📁 Documents migrated', rows.length + ' moved from device storage to the cloud.', 'success');
    }
  } catch(e){ console.warn('[GL] documents backfill threw', e); }
}

async function loadDocs(){
  if(!window.supa){ documents = []; return; }
  await glDocumentsBackfill();
  const r = await window.supa.from('documents')
    .select('id, client_id, client_name, name, doc_type, notes, uploaded_by, uploaded_at, file_path')
    .order('uploaded_at', { ascending: false })
    .limit(500);
  if(r.error){ console.warn('[GL] loadDocs failed', r.error.message); documents = []; return; }
  documents = (r.data || []).map(d => ({
    id: d.id, clientId: d.client_id,
    clientName: d.client_name || ((clients.find(c => c.id === d.client_id)||{}).name) || 'General',
    name: d.name, type: d.doc_type, notes: d.notes,
    uploadedAt: d.uploaded_at, uploadedBy: d.uploaded_by || 'Admin',
    filePath: d.file_path || null
  }));
}

function openDocUploadModal(){
  const sel=document.getElementById('doc-client-sel');
  sel.innerHTML='<option value="">Select client…</option>'+clients.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
  document.getElementById('doc-upload-modal').classList.add('show');
}
function closeDocUploadModal(){ document.getElementById('doc-upload-modal').classList.remove('show'); }

async function saveDocument(){
  const clientId=document.getElementById('doc-client-sel').value;
  const name=document.getElementById('doc-name').value.trim();
  const type=document.getElementById('doc-type').value;
  if(!name){alert('Document name required');return;}
  if(!window.supa){ alert('Cloud sync unavailable — try reloading.'); return; }
  const client=clients.find(c=>c.id===clientId);
  const r = await window.supa.from('documents').insert([{
    client_id:   /^[0-9a-f-]{36}$/i.test(clientId||'') ? clientId : null,
    client_name: client ? client.name : 'General',
    name:        name,
    doc_type:    type,
    notes:       document.getElementById('doc-notes').value || null,
    uploaded_by: (window.currentUser && window.currentUser.name) || 'Admin'
  }]);
  if(r.error){ alert('Save failed: ' + r.error.message); return; }
  await loadDocs();
  renderDocs();
  closeDocUploadModal();
  document.getElementById('doc-name').value='';
  addNotification('📁 Document saved: '+name,client?client.name:'General','success');
  if(typeof glAudit === 'function') glAudit('document_saved', clientId || null, { name: name.slice(0,80) });
}

function filterDocs(v){ docSearch=v; renderDocs(); }

function renderDocs(){
  const el=document.getElementById('doc-list');
  if(!el) return;
  // Declared before the client-filter build below, which also escapes.
  const esc = s => String(s||'').replace(/[&<>]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[m]));
  const cf=document.getElementById('doc-client-filter');
  if(cf && cf.children.length<=1){
    cf.innerHTML='<option value="">All clients</option>'+clients.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
  }
  docClientFilter = cf ? cf.value : '';
  let filtered=documents;
  if(docSearch) filtered=filtered.filter(d=>(d.name||'').toLowerCase().includes(docSearch.toLowerCase())||(d.type||'').toLowerCase().includes(docSearch.toLowerCase())||(d.clientName||'').toLowerCase().includes(docSearch.toLowerCase()));
  if(docClientFilter) filtered=filtered.filter(d=>d.clientId===docClientFilter);
  if(!filtered.length){el.innerHTML='<div style="color:var(--muted);font-size:13px;padding:20px 0">No documents found.</div>';return;}
  el.innerHTML=filtered.map(d=>`<div class="doc-item">
    <div class="doc-icon">${typeIcons[d.type]||'📄'}</div>
    <div style="flex:1">
      <div class="doc-name">${esc(d.name)}</div>
      <div class="doc-meta">${esc(d.type)} &nbsp;·&nbsp; ${esc(d.clientName)} &nbsp;·&nbsp; ${d.uploadedAt?d.uploadedAt.split('T')[0]:''} &nbsp;·&nbsp; by ${esc(d.uploadedBy||'Admin')}</div>
      ${d.notes?`<div style="font-size:11px;color:var(--muted);margin-top:2px">${esc(d.notes)}</div>`:''}
    </div>
    ${d.filePath
      ? `<button class="cbtn" style="font-size:10px;padding:3px 9px" onclick="glDownloadDocById('${esc(d.id)}')">\u2b07 Download</button>`
      : '<span style="font-size:10px;color:var(--muted)" title="Saved before a file could be attached">no file</span>'}
    <button class="cbtn red" style="font-size:10px;padding:3px 7px" onclick="deleteDoc('${d.id}')">✕</button>
  </div>`).join('');
}

async function deleteDoc(id){
  if(!confirm('Delete this document record?')) return;
  if(!window.supa){ return; }
  const res = await glCheckedDelete(sb => sb.from('documents').delete().eq('id', id).select('id'));
  if(!res.ok){ alert('Delete failed — the document record has NOT been deleted: ' + res.reason); return; }
  documents=documents.filter(d=>d.id!==id);
  renderDocs();
  if(typeof glAudit === 'function') glAudit('document_deleted', null, { document_id: id });
}

/* ═══════════════════════════════════════════
   INVENTORY TRACKER (cloud-backed)
═══════════════════════════════════════════ */
let inventory = [];

async function glInventoryBackfill(){
  try {
    if(localStorage.getItem('gl_inventory_migrated') === '1') return;
    if(!window.supa) return;
    const blob = localStorage.getItem('gl_inventory');
    if(!blob){ localStorage.setItem('gl_inventory_migrated','1'); return; }
    let legacy = []; try { legacy = JSON.parse(blob) || []; } catch(_e){ return; }
    if(!legacy.length){ localStorage.setItem('gl_inventory_migrated','1'); return; }
    const rows = legacy.map(i => ({
      name:   String(i.name || '').slice(0, 200),
      qty:    parseInt(i.qty) || 0,
      unit:   i.unit || 'units',
      low_at: parseInt(i.lowAt) || 10
    })).filter(r => r.name);
    if(!rows.length){ localStorage.setItem('gl_inventory_migrated','1'); return; }
    const r = await window.supa.from('inventory').insert(rows);
    if(r.error){ console.warn('[GL] inventory backfill failed', r.error.message); return; }
    localStorage.setItem('gl_inventory_migrated','1');
    if(typeof addNotification === 'function'){
      addNotification('📦 Inventory migrated', rows.length + ' item' + (rows.length===1?'':'s') + ' moved from device storage to the cloud.', 'success');
    }
  } catch(e){ console.warn('[GL] inventory backfill threw', e); }
}

async function loadInventory(){
  if(!window.supa){ inventory = []; return; }
  await glInventoryBackfill();
  const r = await window.supa.from('inventory').select('id, name, qty, unit, low_at').order('name', { ascending: true });
  if(r.error){ console.warn('[GL] loadInventory failed', r.error.message); inventory = []; return; }
  inventory = (r.data || []).map(i => ({ id: i.id, name: i.name, qty: i.qty, unit: i.unit, lowAt: i.low_at }));
}

function openInventoryModal(){ document.getElementById('inventory-modal').classList.add('show'); }
function closeInventoryModal(){ document.getElementById('inventory-modal').classList.remove('show'); }

async function saveInventoryItem(){
  const name=document.getElementById('inv-item-name').value.trim();
  if(!name){alert('Item name required');return;}
  if(!window.supa){ alert('Cloud sync unavailable — try reloading.'); return; }
  const r = await window.supa.from('inventory').insert([{
    name:   name,
    qty:    parseInt(document.getElementById('inv-item-qty').value) || 0,
    unit:   document.getElementById('inv-item-unit').value || 'units',
    low_at: parseInt(document.getElementById('inv-item-low').value) || 10
  }]);
  if(r.error){ alert('Save failed: ' + r.error.message); return; }
  await loadInventory();
  renderInventory();
  closeInventoryModal();
  document.getElementById('inv-item-name').value='';
  if(typeof glAudit === 'function') glAudit('inventory_added', null, { name: name.slice(0,80) });
}

function renderInventory(){
  const el=document.getElementById('inventory-list');
  if(!el) return;
  const maxQty=Math.max(...inventory.map(i=>i.qty),1);
  const lowItems=inventory.filter(i=>i.qty<=i.lowAt);
  
  const alertEl=document.getElementById('inv-low-alert');
  if(alertEl){
    if(lowItems.length){alertEl.style.display='block';alertEl.textContent='⚠️ Low stock: '+lowItems.map(i=>i.name).join(', ');}
    else alertEl.style.display='none';
  }
  
  el.innerHTML=inventory.map(i=>{
    const pct=Math.round(i.qty/maxQty*100);
    const color=i.qty<=i.lowAt?'#e74c3c':i.qty<=i.lowAt*2?'#f5c842':'#1D9E75';
    return `<div class="inv-item-row">
      <div style="min-width:180px;font-size:13px;font-weight:600;color:var(--white)">${esc(i.name)}</div>
      <div class="inv-stock-bar"><div class="inv-stock-fill" style="width:${pct}%;background:${color}"></div></div>
      <div style="min-width:100px;text-align:right;font-size:12px;font-weight:700;color:${color}">${esc(i.qty)} ${esc(i.unit)}</div>
      <div style="min-width:80px;text-align:right;font-size:10px;color:var(--muted)">low@${i.lowAt}</div>
      <div style="display:flex;gap:4px">
        <button class="cbtn" style="font-size:10px;padding:3px 7px" onclick="adjustInventory('${i.id}',10)">+</button>
        <button class="cbtn" style="font-size:10px;padding:3px 7px" onclick="adjustInventory('${i.id}',-10)">−</button>
      </div>
    </div>`;
  }).join('');
}

async function adjustInventory(id,delta){
  const item=inventory.find(i=>i.id===id);
  if(!item) return;
  const newQty = Math.max(0, item.qty + delta);
  if(!window.supa){ item.qty = newQty; renderInventory(); return; }
  const r = await window.supa.from('inventory').update({ qty: newQty }).eq('id', id);
  if(r.error){ alert('Update failed: ' + r.error.message); return; }
  item.qty = newQty;
  renderInventory();
}

/* ═══════════════════════════════════════════
   ANNOUNCEMENTS BOARD (team-wide, lives in public.announcements)
═══════════════════════════════════════════ */
let announcements = [];

async function glAnnouncementsBackfill(){
  try {
    if(localStorage.getItem('gl_announcements_migrated') === '1') return;
    if(!window.supa || !window.currentUser) return;
    const blob = localStorage.getItem('gl_announcements');
    if(!blob){ localStorage.setItem('gl_announcements_migrated','1'); return; }
    let legacy = [];
    try { legacy = JSON.parse(blob) || []; } catch(_e){ return; }
    if(!legacy.length){ localStorage.setItem('gl_announcements_migrated','1'); return; }
    const nowMs = Date.now();
    const rows = legacy.slice(0, 50).map((a, i) => ({
      body:         String(a.text || '').slice(0, 4000),
      author_id:    window.currentUser.id,
      author_name:  a.author || window.currentUser.name || 'Admin',
      author_email: window.currentUser.email || null,
      created_at:   new Date(nowMs - i*1000).toISOString()
    }));
    const r = await window.supa.from('announcements').insert(rows);
    if(r.error){ console.warn('[GL] announcements backfill failed', r.error.message); return; }
    localStorage.setItem('gl_announcements_migrated','1');
    if(typeof addNotification === 'function'){
      addNotification('📣 Announcements migrated', rows.length + ' moved from device storage to the cloud.', 'success');
    }
  } catch(e){ console.warn('[GL] announcements backfill threw', e); }
}

async function loadAnnouncements(){
  if(!window.supa){ announcements = []; return; }
  await glAnnouncementsBackfill();
  const r = await window.supa.from('announcements')
    .select('id, body, author_name, created_at, pinned')
    .order('pinned', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(100);
  if(r.error){ console.warn('[GL] loadAnnouncements failed', r.error.message); announcements = []; return; }
  announcements = (r.data || []).map(a => ({
    id: a.id,
    text: a.body,
    author: a.author_name || 'Admin',
    time: new Date(a.created_at).toLocaleString()
  }));
}

async function postAnnouncement(){
  const text = document.getElementById('ann-input').value.trim();
  if(!text) return;
  if(!window.supa || !window.currentUser){ alert('Cloud sync unavailable — try reloading.'); return; }
  const r = await window.supa.from('announcements').insert([{
    body:         text,
    author_id:    window.currentUser.id,
    author_name:  window.currentUser.name || 'Admin',
    author_email: window.currentUser.email || null
  }]);
  if(r.error){ alert('Post failed: ' + r.error.message); return; }
  document.getElementById('ann-input').value = '';
  await loadAnnouncements();
  renderAnnouncements();
  if(typeof glAudit === 'function') glAudit('announcement_posted', null, { length: text.length });
}

function renderAnnouncements(){
  const el=document.getElementById('ann-list');
  if(!el) return;
  if(!announcements.length){el.innerHTML='<div style="color:var(--muted);font-size:13px">No announcements yet. Post a note to the team.</div>';return;}
  const esc = s => String(s||'').replace(/[&<>]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[m]));
  el.innerHTML=announcements.map(a=>`<div class="ann-item">
    <div class="ann-author">${esc(a.author)}</div>
    <div class="ann-text" style="white-space:pre-wrap">${esc(a.text)}</div>
    <div class="ann-time">${esc(a.time)}</div>
  </div>`).join('');
}

















/* ═══════════════════════════════════════════
   ENHANCED initCRM
═══════════════════════════════════════════ */
const origInitCRM=initCRM;
initCRM=function(){
  origInitCRM();
  // Init new features
  renderCal('general');
  renderCal('production');
  renderProductionRuns();
  renderTasks();
  renderInventory();
  renderAnnouncements();
  renderDocs();
  renderCustomerLogins();
  
  // Populate client selects in task/doc modals
  const taskCl=document.getElementById('task-client-link');
  if(taskCl) taskCl.innerHTML='<option value="">None</option>'+clients.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
  
  // Update PERMISSIONS to include new pages
  PERMISSIONS.admin.push('calendar','production-cal','tasks','documents','inventory','announcements','customers');
  PERMISSIONS.sales.push('calendar','production-cal','tasks','announcements');
  
  bkCurrentDate=new Date();
  renderBkCal();
};

/* ═══════════════════════════════════════════
   ENHANCED renderClients — add tags + health
═══════════════════════════════════════════ */
const origRenderClients=renderClients;
renderClients=function(list){
  origRenderClients(list);
  // Add health dots and tags to client rows after render
  setTimeout(()=>{
    const rows=document.querySelectorAll('#client-body tr');
    rows.forEach(row=>{
      const nameCell=row.querySelector('td:first-child');
      if(nameCell){
        const cName=nameCell.textContent.trim();
        const client=clients.find(c=>c.name===cName);
        if(client){
          const health=getClientHealth(client);
          const existingDot=nameCell.querySelector('.health-dot');
          if(!existingDot){
            const dot=document.createElement('span');
            dot.className='health-dot '+health;
            dot.style.cssText='display:inline-block;margin-left:7px;vertical-align:middle';
            dot.title='Client health: '+health;
            nameCell.appendChild(dot);
          }
          // Add tags row if tags exist
          const tags=clientTags[client.id]||[];
          if(tags.length&&!row.querySelector('.tag-chip')){
            const tagCell=row.querySelector('td:last-child');
            if(tagCell){
              const tagWrap=document.createElement('div');
              tagWrap.style.cssText='margin-top:4px';
              tagWrap.innerHTML=tags.map(t=>`<span class="tag-chip" style="font-size:9px;padding:1px 6px">${esc(t)}</span>`).join('');
              nameCell.appendChild(tagWrap);
            }
          }
        }
      }
    });
  },100);
};

// Page-specific renders registered as nav hooks
window.GL_HOOKS.registerNavHook(function(page){
  if(page==='calendar'){ loadCalEvents().then(() => renderCal('general')); }
  if(page==='production-cal'){
    const ensurePRuns = window.glRefreshProductionRuns ? window.glRefreshProductionRuns() : Promise.resolve();
    Promise.all([loadCalEvents(), ensurePRuns]).then(() => { renderCal('production'); renderProductionRuns(); });
  }
  if(page==='tasks'){ loadTasks().then(renderTasks); }
  if(page==='documents'){ loadDocs().then(renderDocs); }
  if(page==='inventory'){ loadInventory().then(renderInventory); }
  if(page==='announcements'){ loadAnnouncements().then(renderAnnouncements); }
  if(page==='customers') renderCustomerLogins();
});







/* ═══════════════════════════════════════════
   ADD CLIENT HEALTH AI BUTTON TO CLIENT DETAIL
═══════════════════════════════════════════ */
// Hook into viewClient to add AI health score button
function viewClientEnhanced(clientId) {
  const client = clients.find(c => c.id === clientId);
  if(!client) return;

  const existing = document.getElementById('client-detail-overlay');
  if(existing) existing.remove();

  const clientInvs = invoices.filter(i => i.client === clientId);
  const totalBilled = clientInvs.reduce((s,i) => s + i.amount, 0);
  const health = getClientHealth(client);
  const healthColors = {green:'#1D9E75', yellow:'#f5c842', red:'#e74c3c'};

  const ov = document.createElement('div');
  ov.id = 'client-detail-overlay';
  ov.style.cssText = 'position:fixed;inset:0;z-index:650;background:rgba(6,13,26,.95);backdrop-filter:blur(16px);display:flex;align-items:center;justify-content:center;padding:20px';
  ov.innerHTML = `
    <div style="background:#142238;border:1px solid rgba(0,229,192,.18);border-radius:18px;padding:32px;width:100%;max-width:1000px;max-height:90vh;overflow-y:auto">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px">
        <div style="display:flex;align-items:center;gap:14px">
          <div style="width:54px;height:54px;border-radius:50%;background:${client.color};color:${client.tc};display:flex;align-items:center;justify-content:center;font-family:var(--ff-disp);font-size:18px;font-weight:900">${client.init}</div>
          <div>
            <div style="font-family:var(--ff-disp);font-size:22px;letter-spacing:1px;color:var(--white)">${esc(client.name)}</div>
            <div style="font-size:11px;color:var(--muted)">${esc(client.contact)} · ${esc(client.service)}</div>
          </div>
        </div>
        <button onclick="document.getElementById('client-detail-overlay').remove()" style="background:none;border:none;color:var(--muted);font-size:22px;cursor:pointer">✕</button>
      </div>

      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:11px;margin-bottom:20px">
        <div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:10px;padding:13px;text-align:center">
          <div style="font-size:10px;color:var(--muted);letter-spacing:1px;margin-bottom:4px">TOTAL BILLED</div>
          <div style="font-family:var(--ff-disp);font-size:22px;color:var(--teal)">$${Number(totalBilled||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
        </div>
        <div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:10px;padding:13px;text-align:center">
          <div style="font-size:10px;color:var(--muted);letter-spacing:1px;margin-bottom:4px">INVOICES</div>
          <div style="font-family:var(--ff-disp);font-size:22px;color:var(--white)">${clientInvs.length}</div>
        </div>
        <div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:10px;padding:13px;text-align:center">
          <div style="font-size:10px;color:var(--muted);letter-spacing:1px;margin-bottom:4px">HEALTH</div>
          <div style="font-family:var(--ff-disp);font-size:22px;color:${healthColors[health]}">${health.toUpperCase()}</div>
        </div>
      </div>

      ${(typeof window.glClientInfoSections==='function') ? window.glClientInfoSections(client) : ''}

      <div style="margin-bottom:18px">
        <div style="font-size:10px;letter-spacing:2px;color:var(--muted);margin-bottom:8px">TAGS</div>
        ${getClientTagsEl(clientId, true)}
      </div>

      ${typeof window.glRenderClientNotesBlock === 'function' ? window.glRenderClientNotesBlock(client) : ''}

      <div style="margin-bottom:18px">
        <div style="font-size:10px;letter-spacing:2px;color:var(--muted);margin-bottom:8px">RECENT INVOICES</div>
        ${clientInvs.length ? `<table class="ctbl"><thead><tr><th>Invoice</th><th>Amount</th><th>Date</th><th>Status</th></tr></thead><tbody>
          ${clientInvs.slice(0,5).map(i=>`<tr>
            <td style="font-family:var(--ff-mono);font-size:11px">${i.id}</td>
            <td style="font-weight:700">$${i.amount.toLocaleString()}</td>
            <td>${i.date}</td>
            <td><span class="cbdg ${i.status}">${i.status}</span></td>
          </tr>`).join('')}
        </tbody></table>` : '<div style="color:var(--muted);font-size:13px">No invoices yet.</div>'}
      </div>

      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button onclick="document.getElementById('client-detail-overlay').remove();if(window.glOpenEditClient)window.glOpenEditClient('${clientId}')" class="cbtn" style="background:rgba(245,200,66,.12);border-color:rgba(245,200,66,.35);color:#f5c842">✏️ Edit Client</button>
        <button onclick="aiScoreClientHealth('${clientId}')" class="cbtn" style="background:rgba(0,229,192,.1);border-color:rgba(0,229,192,.3);color:var(--teal)">🤖 AI Health Score</button>
        <button onclick="openAICommModal();document.getElementById('ai-comm-client').value='${clientId}';document.getElementById('client-detail-overlay').remove()" class="cbtn">✉️ Draft Email</button>
        <button onclick="openTimeTracker();document.getElementById('tt-client').value='${clientId}';document.getElementById('client-detail-overlay').remove()" class="cbtn">⏱️ Log Time</button>
        <button onclick="openTaskModal();document.getElementById('task-client-link').value='${clientId}';document.getElementById('client-detail-overlay').remove()" class="cbtn">✅ Add Task</button>
        <button onclick="createForClient('${clientId}');document.getElementById('client-detail-overlay').remove()" class="cbtn" style="background:var(--teal);border:none;color:var(--ink);font-weight:800">+ New Invoice</button>
        <button onclick="window.glQuoteFromClient&&window.glQuoteFromClient('${clientId}')" class="cbtn" style="background:rgba(26,111,255,.1);border-color:rgba(26,111,255,.35);color:#6b9fff">📋 Quote Builder</button>
      </div>
      <div id="cde-corr" style="margin-top:20px;border-top:1px solid rgba(255,255,255,.07);padding-top:16px"></div>
    </div>`;
  ov.addEventListener('click', e => { if(e.target === ov) ov.remove(); });
  document.body.appendChild(ov);
  // Load this client's email correspondence into the panel above.
  cdeLoadCorrespondence(client);
}

// Loads every email to/from a client (from email_log) and renders a read-only
// thread inside the client detail view, so all correspondence is visible in
// their account. Flags clients with no reply after 3+ days and offers a
// one-click "Draft nudge" that opens the AI email drafter pre-set to a
// friendly follow-up. Mirrors the lead (Deal Details) correspondence panel.
async function cdeLoadCorrespondence(client){
  var box = document.getElementById('cde-corr');
  if(!box) return;
  if(!client || !client.email){
    box.innerHTML = '<div style="font-size:11px;color:var(--muted)">Add an email address to this client (Edit Client) to track correspondence.</div>';
    return;
  }
  if(!window.supa){ box.innerHTML = ''; return; }
  box.innerHTML = '<div style="font-size:11px;color:var(--muted)">Loading correspondence…</div>';
  var _res = await glLoadEmailLog(client.email, { co: client.name });
  if(_res.error){ box.innerHTML = '<div style="font-size:11px;color:#ff8579">Could not load correspondence.</div>'; return; }
  var rows = _res.rows;

  var header = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">' +
      '<span style="font-size:10px;letter-spacing:2px;color:var(--teal)">📧 CORRESPONDENCE' + (rows.length ? ' (' + rows.length + ')' : '') + '</span>' +
      '<span style="display:flex;gap:6px">' +
        // Wired with addEventListener below — see the note in the lead panel.
        '<button class="gl-corr-sync" title="Pull the latest email in from Gmail" style="font-size:11px;padding:4px 10px;background:rgba(255,255,255,.05);color:var(--muted);border:1px solid rgba(255,255,255,.12);border-radius:6px;cursor:pointer">🔄 Sync</button>' +
        '<button onclick="openAICommModal();document.getElementById(\'ai-comm-client\').value=\'' + client.id + '\';document.getElementById(\'client-detail-overlay\').remove()" style="font-size:11px;padding:4px 12px;background:rgba(0,229,192,.12);color:var(--teal);border:1px solid rgba(0,229,192,.3);border-radius:6px;cursor:pointer">✉️ New email</button>' +
      '</span>' +
    '</div>';

  // Draft-nudge is ALWAYS available — Mike decides when to reach out. The amber
  // "no reply in N days" note only appears when we're genuinely waiting on them.
  var stale = glNoReplyFor(rows);
  var nudgeNote = stale
    ? '<span style="font-size:12px;color:#f5c842;line-height:1.4">⏰ No reply in ' + stale.days + ' days.</span>'
    : '<span style="font-size:12px;color:var(--muted);line-height:1.4">Draft a follow-up whenever you like.</span>';
  var nudge = '<div style="background:' + (stale ? 'rgba(245,200,66,.08)' : 'rgba(255,255,255,.03)') + ';border:1px solid ' + (stale ? 'rgba(245,200,66,.3)' : 'rgba(255,255,255,.1)') + ';border-radius:8px;padding:10px 12px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;gap:10px">' +
      nudgeNote +
      '<button onclick="cdeNudge(\'' + client.id + '\')" style="font-size:11px;white-space:nowrap;padding:4px 12px;background:rgba(245,200,66,.15);color:#f5c842;border:1px solid rgba(245,200,66,.4);border-radius:6px;cursor:pointer">✍️ Draft nudge</button>' +
    '</div>';

  if(!rows.length){
    box.innerHTML = header + nudge + '<div style="font-size:11px;color:var(--muted)">No emails logged for this client yet. Use 🔄 Sync to pull history in from Gmail.</div>';
    glWireCorrSync(box, client.email, 'cde', client.id);
    glAutoSyncContact(client.email, 'cde', client.id);
    return;
  }

  box.innerHTML = header + nudge + glRenderCorrespondence('cde', rows);
  glWireCorrSync(box, client.email, 'cde', client.id);
  glAutoSyncContact(client.email, 'cde', client.id);
}

// Opens the AI email drafter pre-set to write a friendly follow-up nudge for
// a client who hasn't replied. Reached from the client detail nudge banner.
function cdeNudge(clientId){
  var c = (window.clients||[]).find(function(x){ return x.id === clientId; });
  if(typeof openAICommModal !== 'function') return;
  openAICommModal();
  var sel = document.getElementById('ai-comm-client'); if(sel) sel.value = clientId;
  var typeSel = document.getElementById('ai-comm-type');
  if(typeSel){ typeSel.value = 'custom'; typeSel.dispatchEvent(new Event('change')); }
  var crow = document.getElementById('ai-comm-custom-row'); if(crow) crow.style.display = 'block';
  var cust = document.getElementById('ai-comm-custom');
  if(cust) cust.value = 'Write a short, warm follow-up nudge to ' + ((c && c.name) || 'the client') + '. We emailed earlier and haven’t heard back — politely check whether they’re still interested and offer to help with next steps. Keep it friendly and low-pressure.';
  var cd = document.getElementById('client-detail-overlay'); if(cd) cd.remove();
}
window.cdeNudge = cdeNudge;

/* ═══════════════════════════════════════════
   WIRE TIME TRACKER INTO SIDEBAR
═══════════════════════════════════════════ */
const _origInitCRM2 = initCRM;
initCRM = function() {
  _origInitCRM2();

  // Time Tracker already in sidebar HTML

  // Override client row clicks to open enhanced detail view
  setTimeout(() => {
    document.getElementById('client-body')?.addEventListener('click', e => {
      const row = e.target.closest('tr');
      if(!row) return;
      const nameCell = row.querySelector('td:first-child');
      if(!nameCell) return;
      const cName = nameCell.textContent.replace(/[🟢🟡🔴]/g,'').trim();
      const client = clients.find(c => c.name === cName);
      if(client) viewClientEnhanced(client.id);
    });
  }, 500);

  // Resume timer if one was running
  if(activeTimer && !timerInterval) resumeTimerDisplay();

  // Update PERMISSIONS for new pages
  if(!PERMISSIONS.admin.includes('time-tracker')) {
    PERMISSIONS.admin.push('time-tracker');
    PERMISSIONS.sales.push('time-tracker');
  }
};

/* ═══════════════════════════════════════════
   SHOW ACTIVE TIMER BADGE IN HEADER
═══════════════════════════════════════════ */
let _timerBadgeTick = 0;
let _timerBadgePollDisabled = false;  // circuit-breaker: stop polling if table missing
async function updateTimerBadge() {
  // Cross-device check every ~15s: if a timer was started on another
  // device, this picks it up so the header badge appears even before
  // the user opens the time tracker modal here. Cheap query (single
  // row, indexed) so the polling cost is negligible.
  _timerBadgeTick = (_timerBadgeTick + 1) % 5;
  if(!_timerBadgePollDisabled && _timerBadgeTick === 0 && window.supa && window.currentUser){
    try {
      const r = await window.supa.from('time_entries')
        .select('id, client_id, activity, notes, started_at')
        .eq('user_id', window.currentUser.id)
        .is('ended_at', null)
        .maybeSingle();
      if(r.error){
        // 406 = table exists but query rejected; 404 = table missing.
        // Either way, stop polling to avoid flooding the error log.
        console.warn('[GL] time_entries poll disabled (table not ready):', r.error.message || r.error.code);
        _timerBadgePollDisabled = true;
      } else {
        if(r.data){
          activeTimer = {
            id: r.data.id,
            startMs: new Date(r.data.started_at).getTime(),
            clientId: r.data.client_id,
            activity: r.data.activity,
            notes: r.data.notes
          };
        } else {
          activeTimer = null;
        }
      }
    } catch(_e){}
  }
  const existing = document.getElementById('timer-header-badge');
  if(activeTimer) {
    if(!existing) {
      const badge = document.createElement('div');
      badge.id = 'timer-header-badge';
      badge.style.cssText = 'display:flex;align-items:center;gap:6px;padding:4px 12px;background:rgba(231,76,60,.15);border:1px solid rgba(231,76,60,.3);border-radius:20px;font-size:11px;color:#e74c3c;cursor:pointer;font-weight:600';
      badge.innerHTML = '🔴 Timer running';
      badge.onclick = openTimeTracker;
      document.getElementById('crm-top')?.querySelector('.crm-brand')?.after(badge);
    }
  } else {
    if(existing) existing.remove();
  }
}

setInterval(updateTimerBadge, 3000);

/* ═══════════════════════════════════════════
   INVITE USER — saves to Supabase
═══════════════════════════════════════════ */
function openInviteModal(){
  const existing = document.getElementById('invite-user-modal');
  if(existing){ existing.classList.add('show'); return; }

  const modal = document.createElement('div');
  modal.id = 'invite-user-modal';
  modal.className = 'modal-ov show';
  modal.innerHTML = `
    <div class="modal-box" style="width:460px">
      <div class="modal-title">+ Invite User <span class="modal-close" onclick="closeInviteModal()">✕</span></div>
      <div style="font-size:12px;color:#9ca3af;margin-bottom:14px;line-height:1.5">An email will be sent with a secure link. The invitee clicks the link to set their own password and access the CRM with the role you select below.</div>
      <div class="frow"><div class="flbl">Full name *</div><input class="finp" id="inv-name" placeholder="e.g. John Smith"></div>
      <div class="frow"><div class="flbl">Email address *</div><input class="finp" type="email" id="inv-email" placeholder="john@goodliquid.com"></div>
      <div class="frow"><div class="flbl">Role</div>
        <select class="fsel" id="inv-role">
          <option value="sales">Sales</option>
          <option value="admin">Admin</option>
          <option value="warehouse">Warehouse</option>
          <option value="viewer">Viewer</option>
        </select>
      </div>
      <div id="inv-err" style="color:#e74c3c;font-size:12px;margin-bottom:8px;display:none"></div>
      <div id="inv-ok" style="color:var(--teal);font-size:12px;margin-bottom:8px;display:none">✓ Invite sent!</div>
      <div style="display:flex;gap:8px;margin-top:6px">
        <button class="cbtn pri" onclick="createInvitedUser()" style="flex:1">Send Invite</button>
        <button class="cbtn" onclick="closeInviteModal()">Cancel</button>
      </div>
    </div>`;
  modal.addEventListener('click', e => { if(e.target === modal) closeInviteModal(); });
  (document.getElementById('crm-panel')||document.body).appendChild(modal);
}

function closeInviteModal(){
  const m = document.getElementById('invite-user-modal');
  if(m) m.classList.remove('show');
}

async function createInvitedUser(){
  // NOTE: This fallback is overridden by fix.js when it loads.
  // It must not crash if the invite modal no longer has a password field.
  const nameEl  = document.getElementById('inv-name');
  const emailEl = document.getElementById('inv-email');
  const roleEl  = document.getElementById('inv-role');
  const err = document.getElementById('inv-err');
  const ok  = document.getElementById('inv-ok');
  if(!nameEl || !emailEl || !roleEl) return;
  if(err) err.style.display='none';
  if(ok)  ok.style.display='none';

  const name  = nameEl.value.trim();
  const email = emailEl.value.trim().toLowerCase();
  const role  = roleEl.value;

  function _fbSetErr(m){ if(err){ err.textContent=m; err.style.display='block'; } else alert(m); }

  if(!name){ _fbSetErr('Name is required'); return; }
  if(!email || !email.includes('@')){ _fbSetErr('Valid email is required'); return; }

  // ── If fix.js is loaded it has already replaced window.createInvitedUser;
  //    this path only runs when fix.js failed to load (dev / offline). ──────
  _fbSetErr('Sending invite… (fix.js may not have loaded — check the console)');
}

function renderUsersPanel(){
  const el = document.getElementById('users-list');
  if(!el) return;
  el.innerHTML = `<table class="ctbl"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Last Login</th><th>Actions</th></tr></thead><tbody>
    ${users.map(u => `<tr>
      <td style="font-weight:600;display:flex;align-items:center;gap:8px">
        <div style="width:28px;height:28px;border-radius:50%;background:${u.color};color:${u.tc};display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700">${esc(u.initials)}</div>
        ${esc(u.name)}
      </td>
      <td style="font-family:var(--ff-mono);font-size:11px">${esc(u.email)}</td>
      <td><span class="cbdg ${esc(u.role)}">${esc(u.role)}</span></td>
      <td style="font-size:11px;color:var(--muted)">${esc(u.lastLogin||'Never')}</td>
      <td style="display:flex;gap:6px">
        ${u.email !== 'mike@goodliquid.com' ? `<button class="cbtn red" style="font-size:10px;padding:3px 8px" onclick="removeUser('${u.id}')">Remove</button>` : '<span style="font-size:10px;color:var(--muted)">Owner</span>'}
      </td>
    </tr>`).join('')}
  </tbody></table>`;
}

async function removeUser(id){
  if(!confirm('Remove this user? They will lose access immediately.')) return;
  const u = users.find(x => x.id === id);
  if(!u) return;
  users = users.filter(x => x.id !== id);
  renderUsersPanel();
  addNotification('👤 User removed: ' + u.name, u.email, 'warning');
}


/* ═══════════════════════════════════════════
   FAVICON FIX
═══════════════════════════════════════════ */
(function addFavicon(){
  if(document.querySelector('link[rel="icon"]')) return;
  const link = document.createElement('link');
  link.rel = 'icon';
  link.type = 'image/svg+xml';
  link.href = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='20' fill='%230a1628'/><text y='.9em' font-size='80' x='10'>💧</text></svg>";
  document.head.appendChild(link);
})();








/* ═══════════════════════════════════════════
   ADD PAY LINK + NOTES BUTTONS TO INVOICE DETAIL
   AND CLIENT DETAIL
═══════════════════════════════════════════ */
// Hook into invoice viewing to add pay link button
const _origViewInvoice = typeof viewInvoice !== 'undefined' ? viewInvoice : null;
if(_origViewInvoice){
  viewInvoice = function(id){
    _origViewInvoice(id);
    setTimeout(() => {
      const detailPanel = document.getElementById('cpg-invoice-detail') || document.querySelector('.inv-detail');
      if(detailPanel && !detailPanel.querySelector('.pay-link-btn')){
        const btn = document.createElement('button');
        btn.className = 'cbtn pay-link-btn';
        btn.style.cssText = 'background:rgba(0,229,192,.1);border-color:rgba(0,229,192,.3);color:var(--teal)';
        btn.textContent = '💳 Generate Pay Link';
        btn.onclick = () => generatePayLink(id);
        const btnRow = detailPanel.querySelector('.btn-row') || detailPanel.querySelector('.cph');
        if(btnRow) btnRow.appendChild(btn);
      }
    }, 100);
  };
}

/* ═══════════════════════════════════════════
   ADD NOTES BUTTON TO CLIENT DETAIL PANEL
═══════════════════════════════════════════ */
const _origViewClientEnhanced = viewClientEnhanced;
viewClientEnhanced = function(clientId){
  _origViewClientEnhanced(clientId);
  setTimeout(() => {
    const overlay = document.getElementById('client-detail-overlay');
    if(!overlay) return;
    const btnRow = overlay.querySelector('[onclick*="aiScoreClientHealth"]')?.parentElement;
    if(btnRow && !btnRow.querySelector('.notes-btn')){
      const notesBtn = document.createElement('button');
      notesBtn.className = 'cbtn notes-btn';
      notesBtn.textContent = '📝 Notes';
      notesBtn.onclick = () => { overlay.remove(); openClientNote(clientId); };
      btnRow.appendChild(notesBtn);

      const templatesBtn = document.createElement('button');
      templatesBtn.className = 'cbtn';
      templatesBtn.textContent = '📧 Templates';
      templatesBtn.onclick = () => { overlay.remove(); openEmailTemplates(); };
      btnRow.appendChild(templatesBtn);
    }
  }, 150);
};

/* ═══════════════════════════════════════════
   CHECK FOR PAYMENT LINK ON PAGE LOAD
   If URL has ?pay= param show invoice details
═══════════════════════════════════════════ */
(function checkPaymentLink(){
  const params = new URLSearchParams(window.location.search);
  const payParam = params.get('pay');
  if(!payParam) return;
  try {
    const data = JSON.parse(atob(payParam));
    const banner = document.createElement('div');
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:#142238;border-bottom:2px solid var(--teal);padding:20px;text-align:center';
    banner.innerHTML = `
      <div style="font-family:var(--ff-disp);font-size:20px;color:var(--white);margin-bottom:6px">Payment Request — Good Liquid Bev Co</div>
      <div style="font-size:14px;color:var(--muted);margin-bottom:12px">Invoice ${esc(data.inv)} · ${esc(data.client)} · <span style="color:var(--teal);font-weight:700">$${Number(data.amount).toLocaleString()}</span></div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:14px">To pay this invoice please contact Mike at Mike@GoodLiquid.com or (803) 493-5065</div>
      <button onclick="this.parentElement.remove()" style="padding:8px 20px;background:var(--teal);color:var(--ink);border:none;border-radius:8px;font-weight:700;cursor:pointer">Dismiss</button>`;
    document.body.prepend(banner);
  } catch(e){}
})();



/* ═══════════════════════════════════════════
   PWA SERVICE WORKER REGISTRATION
═══════════════════════════════════════════ */
if('serviceWorker' in navigator){
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then(reg => {
      console.log('SW registered:', reg.scope);
    }).catch(err => {
      console.log('SW registration failed:', err);
    });
  });
}

/* ═══════════════════════════════════════════
   PWA INSTALL PROMPT
═══════════════════════════════════════════ */
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  showInstallBanner();
});

function showInstallBanner(){
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
      <button onclick="installPWA()" style="padding:7px 14px;background:var(--teal);color:var(--ink);border:none;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer">Install</button>
      <button onclick="document.getElementById('pwa-install-banner').remove()" style="padding:7px 10px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:8px;font-size:12px;color:var(--muted);cursor:pointer">✕</button>
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

/* ═══════════════════════════════════════════
   INLINE PWA MANIFEST — avoids file:// issues
═══════════════════════════════════════════ */
(function(){
  const m = document.getElementById('pwa-manifest');
  if(!m) return;
  const manifest = {
    name:'Good Liquid Bev Co CRM',
    short_name:'Good Liquid',
    display:'standalone',
    start_url:'https://www.goodliquidbevco.com/',
    background_color:'#0a1628',
    theme_color:'#0a1628',
    icons:[
      {src:'https://www.goodliquidbevco.com/icon-192.png',sizes:'192x192',type:'image/png',purpose:'any'},
      {src:'https://www.goodliquidbevco.com/icon-512.png',sizes:'512x512',type:'image/png',purpose:'any maskable'}
    ]
  };
  try {
    const blob = new Blob([JSON.stringify(manifest)],{type:'application/manifest+json'});
    m.href = URL.createObjectURL(blob);
  } catch(e){}
})();
