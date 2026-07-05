/* ============================================================
   INVITE MODAL — direct button wiring

   The preset-hook IIFE earlier intercepts the invite button via
   new Function(origHandler) which silently drops async errors.
   This module fires AFTER everything else and re-wires the
   button with a plain onclick so the invite flow is guaranteed
   to run and errors surface to the user.
   ============================================================ */
(function(){
  var SUPA_URL = 'https://ufjkeqmxwuyhbqyugcgg.supabase.co';

  async function doInvite(){
    var nameEl  = document.getElementById('inv-name');
    var emailEl = document.getElementById('inv-email');
    var roleEl  = document.getElementById('inv-role');
    var errEl   = document.getElementById('inv-err');
    var okEl    = document.getElementById('inv-ok');
    var btn     = document.querySelector('#invite-user-modal button[data-invite-btn]');

    function showErr(m){
      if(errEl){ errEl.textContent=m; errEl.style.display='block'; }
      else { alert(m); }
    }
    function showOk(m){
      if(okEl){ okEl.textContent=m; okEl.style.display='block'; }
    }
    function resetBtn(){
      if(btn){ btn.disabled=false; btn.textContent='Send Invite'; }
    }

    if(errEl) errEl.style.display='none';
    if(okEl)  okEl.style.display='none';

    if(!nameEl||!emailEl||!roleEl){ showErr('Form elements missing — reload the page.'); return; }

    var name  = nameEl.value.trim();
    var email = emailEl.value.trim().toLowerCase();
    var role  = roleEl.value || 'sales';

    if(!name)               { showErr('Name is required.'); return; }
    if(email.indexOf('@')<0){ showErr('Valid email is required.'); return; }

    if(btn){ btn.disabled=true; btn.textContent='Sending…'; }

    // Get the current session token to authenticate the Edge Function call
    var token = null;
    try {
      var sb = window.supa;
      if(sb && sb.auth && typeof sb.auth.getSession === 'function'){
        var sess = await sb.auth.getSession();
        token = sess && sess.data && sess.data.session && sess.data.session.access_token;
      }
    } catch(e){ console.warn('[GL invite] getSession error', e); }

    if(!token){
      showErr('Not signed in. Please log in and try again.');
      resetBtn();
      return;
    }

    try {
      var res = await fetch(SUPA_URL + '/functions/v1/invite-staff-user', {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify({ email: email, name: name, role: role, redirectTo: window.location.origin })
      });
      var data = await res.json();
      if(!res.ok || !data.ok){
        showErr((data && data.error) || 'Invite failed (HTTP ' + res.status + ')');
        resetBtn();
        return;
      }
      showOk('✓ Invite sent! ' + name + ' will receive an email to set their password.');
      if(typeof addNotification==='function') addNotification('👤 Invite sent: '+name, email+' — link emailed', 'success');
      setTimeout(function(){
        if(typeof closeInviteModal==='function') closeInviteModal();
      }, 3500);
    } catch(e){
      console.error('[GL invite] fetch error', e);
      showErr('Error: ' + (e.message || 'unknown'));
      resetBtn();
    }
  }

  function wireInviteModal(){
    var modal = document.getElementById('invite-user-modal');
    if(!modal || modal.querySelector('button[data-invite-btn]')) return;

    // Find the primary action button (not Cancel / ✕)
    var btns = modal.querySelectorAll('button');
    var sendBtn = null;
    btns.forEach(function(b){
      if(!sendBtn && b.textContent.trim().toLowerCase().indexOf('cancel') < 0 &&
         b.textContent.trim().toLowerCase().indexOf('✕') < 0){
        sendBtn = b;
      }
    });
    if(!sendBtn) return;

    // Replace with a clean button to remove all prior event listeners
    var fresh = document.createElement('button');
    fresh.className     = sendBtn.className;
    fresh.style.cssText = sendBtn.style.cssText;
    fresh.textContent   = 'Send Invite';
    fresh.setAttribute('data-invite-btn', '1');
    fresh.onclick = doInvite;
    sendBtn.parentNode.replaceChild(fresh, sendBtn);
  }

  // Watch for the modal being added to the DOM
  if(typeof MutationObserver !== 'undefined'){
    var obs = new MutationObserver(function(){
      if(document.getElementById('invite-user-modal')) wireInviteModal();
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  console.log('[GL] Invite button wiring loaded');
}());
