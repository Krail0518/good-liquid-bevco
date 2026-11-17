/* sign.js — public agreement signing page (sign.html#t=TOKEN).
   No login: the token in the link is the credential, checked server-side by
   the agreement-sign edge function. Everything is rendered with textContent;
   no agreement or signer text is ever parsed as HTML.

   One link can carry several documents (a signing packet, e.g. an invoice
   acceptance plus the Contract Manufacturing Agreement). They are shown one
   after another, and one consent + one typed name signs all of them. */
(function(){
  'use strict';
  var SUPA_URL = 'https://ufjkeqmxwuyhbqyugcgg.supabase.co';
  var ANON_KEY = 'sb_publishable_-37mkPw8uLzEJM21T9jJOA_YQRQ7ikB';
  // Token travels in the fragment (#t=…) so it never reaches a server log or
  // a redirect; ?t= is accepted too.
  var token = new URLSearchParams(location.hash.replace(/^#/, '')).get('t') ||
              new URLSearchParams(location.search).get('t') || '';
  var docCount = 1;

  function $(id){ return document.getElementById(id); }
  function show(id){ ['loading','fatal','done','main'].forEach(function(x){ $(x).classList.toggle('hidden', x !== id); }); }
  function fatal(msg){ $('fatal-msg').textContent = msg; show('fatal'); }
  function el(tag, cls, text){
    var d = document.createElement(tag);
    if(cls) d.className = cls;
    if(text != null) d.textContent = text;
    return d;
  }

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

  function renderBody(host, text){
    String(text || '').replace(/\r\n/g, '\n').split(/\n{2,}/).forEach(function(b){
      var t = b.replace(/\s+$/, ''); if(!t) return;
      if(/^# /.test(t)) host.appendChild(el('div', 't', t.slice(2)));
      else if(/^## /.test(t)) host.appendChild(el('div', 'h', t.slice(3)));
      else host.appendChild(el('div', 'p', t));
    });
  }

  function renderDocs(docs){
    var list = $('doc-list');
    while(list.firstChild) list.removeChild(list.firstChild);
    docs.forEach(function(d, i){
      if(docs.length > 1){
        var lab = el('div', 'doc-label', 'Document ' + (i + 1) + ' of ' + docs.length);
        lab.appendChild(el('b', null, d.title));
        list.appendChild(lab);
      }
      var card = el('div', 'card doc');
      renderBody(card, d.body);
      list.appendChild(card);
    });
  }

  function signLabel(){ return docCount > 1 ? ('Sign all ' + docCount + ' documents') : 'Sign agreement'; }
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
    var docs = Array.isArray(v.documents) && v.documents.length ? v.documents : [{ title: v.title, body: v.body }];
    docCount = docs.length;
    $('doc-title').textContent = docCount > 1 ? ('Please review and sign ' + docCount + ' documents') : v.title;
    var sub = $('doc-sub');
    sub.textContent = 'Between ' + v.parties.good_liquid + ' and ' + v.parties.company + '. ' +
      (docCount > 1
        ? 'Please read each document below. You sign them all at once at the bottom of the page.'
        : 'Please read the full agreement below, then sign at the bottom.') +
      ' You are signing as ' + v.signer.name + ' (' + v.signer.email + ').';
    if(docCount > 1){
      var ol = el('ol', 'doc-steps');
      docs.forEach(function(d){ ol.appendChild(el('li', null, d.title)); });
      sub.parentNode.appendChild(ol);
    }
    $('consent-text').textContent = v.consent_text;
    $('typed').value = v.signer.name || '';
    $('sig-preview').textContent = $('typed').value;
    $('sign-btn').textContent = signLabel();
    renderDocs(docs);
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
    if(!r.ok){ $('err').textContent = r.error; btn.textContent = signLabel(); refreshButton(); return; }
    var docs = Array.isArray(r.documents) ? r.documents : [];
    $('done-title').textContent = "Thank you — you've signed";
    if(docs.length > 1){
      var msg = $('done-msg');
      msg.textContent = 'Your signature is recorded on every document:';
      var ul = el('ul', 'doc-steps');
      docs.forEach(function(d){
        ul.appendChild(el('li', null, d.title + (d.complete
          ? ' — complete. A signed copy has been emailed to you.'
          : ' — Good Liquid will countersign, then the fully signed copy is emailed to you.')));
      });
      msg.parentNode.appendChild(ul);
    } else {
      $('done-msg').textContent = r.complete
        ? 'Everyone has now signed. A copy of the signed agreement has been emailed to you.'
        : 'Your signature is recorded. Good Liquid will countersign, and you will receive a copy of the fully signed agreement by email.';
    }
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
