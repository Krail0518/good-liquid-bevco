/*
 * users-page.js — extracted from crm-index-core.js (GL-037).
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
 * Declares: renderUsers, openChangeRole, closeRoleModal, saveRole, deactivateUser, resetPw
 */
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
        <button class="cbtn" style="font-size:10px;padding:4px 9px" data-gl-action="openChangeRole" data-gl-arg1="${esc(u.id)}">Change role</button>
        <button class="cbtn" style="font-size:10px;padding:4px 9px" data-gl-action="resetPw" data-gl-arg1="${esc(u.id)}">Reset PW</button>
        <button class="cbtn red" style="font-size:10px;padding:4px 9px" data-gl-action="deactivateUser" data-gl-arg1="${esc(u.id)}">${u.status==='active'?'Deactivate':'Reactivate'}</button>
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
/* saveRole / deactivateUser — thin wrappers over src/services/permissions-service.js.
   The bodies that used to live here were the legacy pair, and they never
   worked: both called renderPermissionsPanel() BEFORE the update and OUTSIDE
   the try. That function is declared inside the src/services/permissions-service.js IIFE and is
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
