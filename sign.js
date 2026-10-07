/* sign.js — public agreement signing page (sign.html?t=TOKEN).
   No login: the token in the link is the credential, checked server-side by
   the agreement-sign edge function. Everything is rendered with textContent;
   no agreement or signer text is ever parsed as HTML. */
(function(){
  'use strict';
  var SUPA_URL = 'https://ufjkeqmxwuyhbqyugcgg.supabase.co';
  var ANON_KEY = 'sb_publishable_-37mkPw8uLzEJM21T9jJOA_YQRQ7ikB';
  // Token travels in the fragment (#t=…) so it never reaches a server log or
  // a redirect; ?t= is accepted too.
  var token = new URLSearchParams(location.hash.replace(/^#/, '')).get('t') ||
              new URLSearchParams(location.search).get('t') || '';

  function $(id){ return document.getElementById(id); }
  function show(id){ ['loading','fatal','done','main'].forEach(function(x){ $(x).classList.toggle('hidden', x !== id); }); }
  function fatal(msg){ $('fatal-msg').textContent = msg; show('fatal'); }

  async function call(body){
    var r = await fetch(SUPA_URL + '/functions/v1/agreement-sign', {
      method: 'POST',
      headers: { 'Content-Type':'application/json', 'apikey':ANON_KEY, 'Authorization':'Bearer ' + ANON_KEY },
      body: JSON.stringify(Object.assign({ token: token }, body))
    });
    var j = null;
    try { j = await r.json(); } catch(e) {}
    if(!r.ok || !j || j.error) return { ok:false, error: (j && j.error) || ('Something went wrong (' + r.status + ').') };
    return j;
  }

  function renderDoc(text){
    var host = $('doc-body');
    while(host.firstChild) host.removeChild(host.firstChild);
    String(text || '').replace(/\r\n/g, '\n').split(/\n{2,}/).forEach(function(b){
      var t = b.replace(/\s+$/, ''); if(!t) return;
      var d = document.createElement('div');
      if(/^# /.test(t)){ d.className = 't'; d.textContent = t.slice(2); }
      else if(/^## /.test(t)){ d.className = 'h'; d.textContent = t.slice(3); }
      else { d.className = 'p'; d.textContent = t; }
      host.appendChild(d);
    });
  }

  function refreshButton(){
    $('sign-btn').disabled = !($('consent').checked && $('typed').value.trim().length >= 2);
  }

  async function init(){
    if(!/^[A-Za-z0-9_-]{40,60}$/.test(token)){ fatal('This link is incomplete. Open it directly from the email you received.'); return; }
    var v = await call({ action:'view' });
    if(!v.ok){ fatal(v.error); return; }
    if(v.already === 'signed'){
      $('done-title').textContent = 'Already signed';
      $('done-msg').textContent = 'You have already signed "' + (v.title || 'this agreement') + '". A copy will be emailed to you once everyone has signed.';
      show('done'); return;
    }
    $('doc-title').textContent = v.title;
    $('doc-sub').textContent = 'Between ' + v.parties.good_liquid + ' and ' + v.parties.company +
      '. Please read the full agreement below, then sign at the bottom. You are signing as ' + v.signer.name + ' (' + v.signer.email + ').';
    $('consent-text').textContent = v.consent_text;
    $('typed').value = v.signer.name || '';
    $('sig-preview').textContent = $('typed').value;
    renderDoc(v.body);
    show('main');
    refreshButton();
  }

  $('consent').addEventListener('change', refreshButton);
  $('typed').addEventListener('input', function(){ $('sig-preview').textContent = $('typed').value; refreshButton(); });

  $('sign-btn').addEventListener('click', async function(){
    var btn = this;
    $('err').textContent = '';
    btn.disabled = true; btn.textContent = 'Signing…';
    var r = await call({ action:'sign', consent: $('consent').checked === true, typed_name: $('typed').value });
    if(!r.ok){ $('err').textContent = r.error; btn.textContent = 'Sign agreement'; refreshButton(); return; }
    $('done-title').textContent = "Thank you — you've signed";
    $('done-msg').textContent = r.complete
      ? 'Everyone has now signed. A copy of the signed agreement has been emailed to you.'
      : 'Your signature is recorded. Good Liquid will countersign, and you will receive a copy of the fully signed agreement by email.';
    show('done');
  });

  $('decline-toggle').addEventListener('click', function(){ $('decline-box').classList.toggle('hidden'); });
  $('decline-btn').addEventListener('click', async function(){
    var btn = this; btn.disabled = true;
    var r = await call({ action:'decline', reason: $('decline-reason').value });
    if(!r.ok){ $('err').textContent = r.error; btn.disabled = false; return; }
    $('done-title').textContent = 'You declined to sign';
    $('done-msg').textContent = 'Good Liquid has been notified. If this was a mistake, contact Mike at mike@goodliquid.com.';
    show('done');
  });

  init().catch(function(e){ fatal('Something went wrong loading this agreement. Please try again in a moment.'); });
}());
