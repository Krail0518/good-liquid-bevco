/*
 * onboard.js — extracted verbatim from onboard.html (GL-DEF-01).
 *
 * The code below is byte-for-byte what was inside the page's inline
 * <script> block. Nothing was rewritten: the move exists so that
 * script-src can drop 'unsafe-inline', which an inline block would keep
 * alive on its own regardless of how many on* handlers were converted.
 *
 * The tag replacing it sits in the same document position, so execution
 * order is unchanged.
 */
(function(){
  'use strict';
  var SUPA_URL = 'https://ufjkeqmxwuyhbqyugcgg.supabase.co';
  var ANON_KEY = 'sb_publishable_-37mkPw8uLzEJM21T9jJOA_YQRQ7ikB';
  var token = new URLSearchParams(location.search).get('token') || '';

  function el(id){ return document.getElementById(id); }
  function show(id){ el(id).classList.remove('hidden'); }
  function hide(id){ el(id).classList.add('hidden'); }
  function fatal(m){ hide('loading'); hide('form'); el('fatal-msg').textContent = m; show('fatal'); }

  async function rpc(fn, body){
    var r = await fetch(SUPA_URL + '/rest/v1/rpc/' + fn, {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'apikey':ANON_KEY, 'Authorization':'Bearer '+ANON_KEY },
      body: JSON.stringify(body)
    });
    if(!r.ok){ throw new Error('HTTP ' + r.status); }
    return r.json();
  }

  // Call an edge function (token-gated server-side). Returns the parsed body
  // even on a 4xx so we can show the server's specific message.
  async function callFn(name, body){
    var r = await fetch(SUPA_URL + '/functions/v1/' + name, {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'apikey':ANON_KEY, 'Authorization':'Bearer '+ANON_KEY },
      body: JSON.stringify(body)
    });
    return r.json().catch(function(){ return { ok:false, error:'Unexpected server response.' }; });
  }

  // Same policy the server enforces — stated to the user and pre-checked here.
  function passwordProblem(pw){
    if(!pw || pw.length < 8)     return 'At least 8 characters.';
    if(!/[A-Z]/.test(pw))        return 'Add an uppercase letter.';
    if(!/[0-9]/.test(pw))        return 'Add a number.';
    if(!/[^A-Za-z0-9]/.test(pw)) return 'Add a special character (e.g. ! ? @ #).';
    return '';
  }

  // Prefill: set a field from the prefill blob and flag it visually.
  function fill(key, val){
    var node = el('f-' + key);
    if(node && val != null && String(val).trim() !== ''){ node.value = val; }
  }

  var bs = el('bill-same'), sf = el('bill-fields');
  var ss = el('ship-same'), shf = el('ship-fields');
  bs.addEventListener('change', function(){ sf.classList.toggle('hidden', bs.checked); });
  ss.addEventListener('change', function(){ shf.classList.toggle('hidden', ss.checked); });

  if(!token){ fatal('This link is missing its onboarding token.'); return; }

  (async function boot(){
    try{
      var res = await rpc('gl_onboarding_get', { p_token: token });
      if(!res || res.ok === false){ fatal((res && res.error) || 'This onboarding link is not valid.'); return; }
      if(res.submitted){ hide('loading'); show('done'); return; }
      var p = res.prefill || {};
      el('hi').textContent = 'Welcome' + (res.client_name ? ', ' + res.client_name : '') + '!';
      // Company name is read-only context.
      el('f-company').value = res.client_name || p.company || p.name || '';
      // Everything the lead already gave us, pre-filled.
      fill('legal_name', p.legal_name);
      fill('ein', p.ein);
      fill('website', p.website);
      fill('contact_name', p.contact_name || p.name);
      fill('phone', p.phone);
      fill('street', p.street); fill('city', p.city); fill('state', p.state); fill('zip', p.zip);
      fill('service', p.service);
      fill('notes', p.notes);
      // Their login email (read-only context for the password section).
      var loginEmail = (res.email || p.email || '');
      var le = el('login-email'); if(le) le.textContent = loginEmail || 'your email';
      window.__loginEmail = loginEmail;
      // Product questionnaire — carry over prior answers (from the tour), seed from the lead.
      try {
        var itk = await rpc('gl_onboarding_intake_get', { p_token: token });
        var ians = (itk && itk.answers) || {};
        if(!ians.company)      ians.company      = res.client_name || p.company || p.name || '';
        if(!ians.first_name && !ians.last_name){ var _nm=String(p.contact_name||p.name||'').trim().split(/\s+/); ians.first_name=_nm.shift()||''; ians.last_name=_nm.join(' '); }
        if(!ians.email)        ians.email        = loginEmail || p.email || '';
        if(!ians.phone)        ians.phone        = p.phone || '';
        if(window.GL_INTAKE) window.GL_INTAKE.render(el('ob-intake-mount'), ians);
      } catch(e){ if(window.GL_INTAKE) window.GL_INTAKE.render(el('ob-intake-mount'), {}); }
      hide('loading'); show('form');
    }catch(e){ fatal('We could not load your onboarding right now. Please try again in a moment.'); }
  })();

  // Live password hint as they type.
  var pwEl = el('f-password'), pw2El = el('f-password2'), hintEl = el('pw-hint');
  function updatePwHint(){
    var p = pwEl.value, p2 = pw2El.value, prob = passwordProblem(p);
    if(!p){ hintEl.textContent = ''; return; }
    if(prob){ hintEl.style.color = '#f5c842'; hintEl.textContent = '⚠ ' + prob; return; }
    if(p2 && p !== p2){ hintEl.style.color = '#ff8579'; hintEl.textContent = '⚠ Passwords don\'t match.'; return; }
    hintEl.style.color = '#5fcf9e'; hintEl.textContent = '✓ Strong password' + (p2 ? ' — matches.' : '.');
  }
  pwEl.addEventListener('input', updatePwHint);
  pw2El.addEventListener('input', updatePwHint);

  el('form').addEventListener('submit', async function(ev){
    ev.preventDefault();
    var btn = el('submit-btn'), msg = el('msg');
    msg.className = 'msg';
    var g = function(k){ var n = el('f-'+k); return n ? n.value.trim() : ''; };
    if(!g('contact_name')){ msg.className='msg err'; msg.textContent='Please add a primary contact name.'; return; }

    // Portal login: enforce the stated policy + confirmation before anything.
    var pw = pwEl.value, pw2 = pw2El.value;
    var pwProb = passwordProblem(pw);
    if(pwProb){ msg.className='msg err'; msg.textContent='Password: ' + pwProb + ' (at least 8 chars, an uppercase letter, a number, and a special character.)'; pwEl.focus(); return; }
    if(pw !== pw2){ msg.className='msg err'; msg.textContent='The two passwords don\'t match.'; pw2El.focus(); return; }

    // Mirror company address into billing/shipping when "same" is ticked.
    var data = {
      legal_name:g('legal_name'), ein:g('ein'), website:g('website'),
      contact_name:g('contact_name'), phone:g('phone'),
      street:g('street'), city:g('city'), state:g('state'), zip:g('zip'),
      service:g('service'), notes:g('notes'),
      has_formula: el('c-formula').checked, has_pa_letter: el('c-pa').checked, can_provide_coi: el('c-coi').checked
    };
    if(bs.checked){ data.billing_street=g('street'); data.billing_city=g('city'); data.billing_state=g('state'); data.billing_zip=g('zip'); }
    else { data.billing_street=g('billing_street'); data.billing_city=g('billing_city'); data.billing_state=g('billing_state'); data.billing_zip=g('billing_zip'); }
    if(ss.checked){ data.shipping_street=g('street'); data.shipping_city=g('city'); data.shipping_state=g('state'); data.shipping_zip=g('zip'); }
    else { data.shipping_street=g('shipping_street'); data.shipping_city=g('shipping_city'); data.shipping_state=g('shipping_state'); data.shipping_zip=g('shipping_zip'); }

    btn.disabled = true; btn.textContent = 'Setting up your account…';
    var reset = function(){ btn.disabled=false; btn.textContent='Submit & create my login'; };
    try{
      // 1) Create the portal login FIRST. If it fails (e.g. server rejects the
      //    password), the onboarding is NOT marked submitted, so they can fix
      //    it and retry — no half-finished state.
      var setpw = await callFn('onboarding-set-password', { token: token, password: pw });
      if(!setpw || setpw.ok !== true){
        msg.className='msg err'; msg.textContent = (setpw && setpw.error) || 'We could not set your password. Please try again.';
        reset(); return;
      }
      // 2) Now record the intake answers.
      var res = await rpc('gl_onboarding_submit', { p_token: token, p_data: data });
      // Save the product questionnaire alongside (non-blocking — onboarding
      // succeeds even if a detail is missing).
      try {
        if(window.GL_INTAKE){
          var qa = window.GL_INTAKE.collect(el('ob-intake-mount'));
          await rpc('gl_onboarding_intake_submit', { p_token: token, p: { answers: qa.answers } });
        }
      } catch(e){ console.warn('onboarding intake save:', e); }
      if(res && res.ok){
        var em = (setpw.email || window.__loginEmail || 'your email');
        var d = el('done');
        d.querySelector('.sub').innerHTML = 'Your details are in and your portal login is ready. Sign in anytime at <a href="/?portal=1">your client portal</a> with <b>' + String(em).replace(/[<>&]/g,'') + '</b> and the password you just chose. Mike has been notified and will follow up on next steps.';
        hide('form'); show('done'); window.scrollTo(0,0);
      } else {
        // Password was set but the answers didn't save — tell them plainly.
        msg.className='msg err'; msg.textContent = (res && res.error) || 'Your login was created, but saving your answers failed. Please try Submit once more.';
        reset();
      }
    }catch(e){
      msg.className='msg err'; msg.textContent='We could not finish right now. Please try again in a moment.';
      reset();
    }
  });
})();

