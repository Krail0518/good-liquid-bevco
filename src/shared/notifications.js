/*
 * notifications.js — extracted from crm-index-core.js (GL-037).
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
 * Declares: glNotificationsBackfill, loadNotifications, timeAgo, addNotification, notifIsFresh, addNotifBadge, updateNotifBadge, toggleNotifPanel, markAllNotifRead, renderNotifList, markNotifRead
 */
/* ═══════════════════════════════════════════
   NOTIFICATIONS SYSTEM
═══════════════════════════════════════════ */
/* Notifications: per-user inbox. Source of truth is public.notifications
   in Supabase. In-memory cache populated from DB on every panel open,
   plus optimistic update on addNotification so toasts feel instant. */
let notifications = [];

async function glNotificationsBackfill(){
  try {
    if(localStorage.getItem('gl_notifications_migrated') === '1') return;
    if(!window.supa || !window.currentUser) return;
    const blob = localStorage.getItem('gl_notifications');
    if(!blob){ localStorage.setItem('gl_notifications_migrated','1'); return; }
    let legacy = [];
    try { legacy = JSON.parse(blob) || []; } catch(_e){ return; }
    if(!legacy.length){ localStorage.setItem('gl_notifications_migrated','1'); return; }
    const rows = legacy.slice(0, 50).map(n => ({
      user_id: window.currentUser.id,
      title:   String(n.title || '').slice(0, 200),
      sub:     n.sub || null,
      type:    ['info','success','warning','stale','reminder','email'].includes(n.type) ? n.type : 'info',
      read:    !!n.read,
      read_at: n.read ? new Date().toISOString() : null,
      created_at: n.createdAt ? new Date(n.createdAt).toISOString() : new Date().toISOString()
    }));
    const r = await window.supa.from('notifications').insert(rows);
    if(r.error){ console.warn('[GL] notifications backfill failed', r.error.message); return; }
    localStorage.setItem('gl_notifications_migrated','1');
  } catch(e){ console.warn('[GL] notifications backfill threw', e); }
}

async function loadNotifications(){
  if(!window.supa || !window.currentUser){ notifications = []; return; }
  await glNotificationsBackfill();
  // 48-hour drop-off: anything older than 2 days is hidden from the bell
  // (Mike's call-out 2026-05-23). The DB row sticks around for audit; we
  // just stop showing it. A follow-up cron can hard-delete >30d rows if
  // the table gets noisy.
  const cutoff = new Date(Date.now() - 48*60*60*1000).toISOString();
  const r = await window.supa.from('notifications')
    .select('id, title, sub, type, read, created_at')
    .eq('user_id', window.currentUser.id)
    .gt('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(50);
  if(r.error){ console.warn('[GL] loadNotifications failed', r.error.message); notifications = []; return; }
  notifications = (r.data || []).map(n => ({
    id: n.id, title: n.title, sub: n.sub, type: n.type,
    read: !!n.read,
    time: timeAgo(new Date(n.created_at)),
    createdAt: new Date(n.created_at).getTime()
  }));
  updateNotifBadge();
  renderNotifList();
}

function timeAgo(d){
  const sec = Math.floor((Date.now() - d.getTime())/1000);
  if(sec < 60) return 'Just now';
  if(sec < 3600) return Math.floor(sec/60) + 'm ago';
  if(sec < 86400) return Math.floor(sec/3600) + 'h ago';
  return Math.floor(sec/86400) + 'd ago';
}

async function addNotification(title, sub, type='info'){
  // Optimistic insert into local cache so the toast fires immediately.
  const localN = { id: 'tmp'+Date.now(), title, sub, type, time:'Just now', read:false, createdAt:Date.now() };
  notifications.unshift(localN);
  if(notifications.length > 50) notifications = notifications.slice(0,50);
  updateNotifBadge();
  renderNotifList();
  // Then write through to the DB. Fire-and-forget — if it fails we keep
  // the local copy so the user still sees it.
  if(window.supa && window.currentUser){
    try {
      const r = await window.supa.from('notifications').insert([{
        user_id: window.currentUser.id,
        title:   String(title || '').slice(0, 200),
        sub:     sub || null,
        type:    ['info','success','warning','stale','reminder','email'].includes(type) ? type : 'info'
      }]).select('id').single();
      if(!r.error && r.data){
        // Swap the temp id for the real one so future read/delete by id
        // hits the right row.
        localN.id = r.data.id;
        renderNotifList();
      }
    } catch(_e){}
  }
}

// 48h cutoff for the bell — anything older drops off the badge + list.
const NOTIF_TTL_MS = 48 * 60 * 60 * 1000;
function notifIsFresh(n){
  if(!n || !n.createdAt) return true; // optimistic toasts have no createdAt yet
  return (Date.now() - Number(n.createdAt)) <= NOTIF_TTL_MS;
}

function addNotifBadge(){
  const badge=document.getElementById('notif-badge');
  const unread=notifications.filter(n=>!n.read && notifIsFresh(n)).length;
  if(unread>0){badge.style.display='flex';badge.textContent=unread>9?'9+':unread;}
  else badge.style.display='none';
}

function updateNotifBadge(){ addNotifBadge(); }

function toggleNotifPanel(){
  document.getElementById('notif-panel').classList.toggle('show');
  renderNotifList();
}

async function markAllNotifRead(){
  if(window.supa && window.currentUser){
    await window.supa.from('notifications').update({ read: true, read_at: new Date().toISOString() }).eq('user_id', window.currentUser.id).eq('read', false);
  }
  notifications.forEach(n=>n.read=true);
  updateNotifBadge();
  renderNotifList();
}

function renderNotifList(){
  const el=document.getElementById('notif-list');
  if(!el) return;
  const icons={'info':'ℹ️','success':'✅','warning':'⚠️','stale':'🔔','reminder':'📅','email':'📧'};
  const colors={'info':'rgba(26,111,255,.15)','success':'rgba(29,158,117,.15)','warning':'rgba(231,76,60,.15)','stale':'rgba(245,200,66,.15)','reminder':'rgba(0,229,192,.15)','email':'rgba(26,111,255,.15)'};
  const fresh = notifications.filter(notifIsFresh);
  if(!fresh.length){el.innerHTML='<div style="padding:20px;text-align:center;color:var(--muted);font-size:13px">No notifications in the last 48 hours.</div>';return;}
  el.innerHTML=fresh.map(n=>`<div class="notif-item ${n.read?'':'unread'}" onclick="markNotifRead('${n.id}')">
    <div class="notif-ico" style="background:${colors[n.type]||colors.info}">${icons[n.type]||'🔔'}</div>
    <div style="flex:1"><div class="notif-title">${esc(n.title)}</div><div class="notif-sub">${esc(n.sub)}</div><div class="notif-time">${n.time}</div></div>
  </div>`).join('');
}

async function markNotifRead(id){
  const n=notifications.find(x=>x.id===id);
  if(n) n.read = true;
  updateNotifBadge();
  renderNotifList();
  if(window.supa && id && !String(id).startsWith('tmp')){
    await window.supa.from('notifications').update({ read: true, read_at: new Date().toISOString() }).eq('id', id);
  }
}

