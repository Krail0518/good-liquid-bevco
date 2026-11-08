/*
 * launch.js: the Formula to Shelf page (/launch).
 *
 * The request form feeds the CRM through the same public RPC the main site's
 * quote form uses, submit_quote_request (SECURITY DEFINER, anon execute only).
 * That function validates every field, rate limits per email and site wide
 * (CLAUDE.md rule 7), dedupes returning leads onto their open deal, creates a
 * Prospecting deal, and fires the existing new lead alert and deck email. So
 * this page needs no new table, policy or grant: anon still has no privilege
 * on public.deals.
 *
 * Launch leads are tagged lead_source 'formula_to_shelf' and service
 * 'Formula to Shelf: <program>' so they are easy to pick out in the pipeline.
 * Nothing the visitor types is written into the page; messages use textContent.
 */
(function(){
  'use strict';
  var SUPA_URL = 'https://ufjkeqmxwuyhbqyugcgg.supabase.co';
  var ANON_KEY = 'sb_publishable_-37mkPw8uLzEJM21T9jJOA_YQRQ7ikB';

  function el(id){ return document.getElementById(id); }
  var form = el('launch-form');
  if(!form) return;

  // Program buttons on the pricing cards preselect the program in the form.
  document.querySelectorAll('[data-program]').forEach(function(a){
    a.addEventListener('click', function(){
      var sel = el('lf-program');
      if(sel) sel.value = a.getAttribute('data-program');
    });
  });

  function msg(kind, text){ var m = el('lf-msg'); m.className = 'msg full ' + kind; m.textContent = text; }
  function mark(id){ var f = el(id); if(f && f.closest('.field')) f.closest('.field').classList.add('err'); }
  form.addEventListener('input', function(ev){
    var w = ev.target.closest && ev.target.closest('.field');
    if(w) w.classList.remove('err');
  });

  // Server messages written for the visitor to read; anything else gets a
  // generic line so internal details never reach the page.
  function friendly(e){
    var m = String((e && e.message) || '');
    if(/already have your request|lot of requests|valid email|valid phone/i.test(m)) return m;
    return 'Something went wrong sending your request. Please try again in a minute, or email Mike@GoodLiquid.com.';
  }

  var busy = false;
  form.addEventListener('submit', async function(ev){
    ev.preventDefault();
    if(busy) return;

    // Honeypot: bots fill every field. Pretend success, send nothing.
    if(el('lf-website').value){ el('apply').classList.add('sent'); return; }

    var v = {
      brand:   el('lf-brand').value.trim(),
      name:    el('lf-name').value.trim(),
      email:   el('lf-email').value.trim(),
      phone:   el('lf-phone').value.trim(),
      program: el('lf-program').value,
      product: el('lf-product').value,
      details: el('lf-details').value.trim()
    };

    var problems = [];
    if(!v.brand){ problems.push('brand name'); mark('lf-brand'); }
    if(!v.name){ problems.push('your name'); mark('lf-name'); }
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.email)){ problems.push('a valid email'); mark('lf-email'); }
    if(v.phone.replace(/\D/g, '').length < 10){ problems.push('a phone number with area code'); mark('lf-phone'); }
    if(!v.program){ problems.push('a program'); mark('lf-program'); }
    if(!v.product){ problems.push('a product type'); mark('lf-product'); }
    if(v.details.length < 15){ problems.push('a few words about your drink'); mark('lf-details'); }
    if(problems.length){ msg('err', 'Please add ' + problems.join(', ') + '.'); return; }

    busy = true; el('lf-submit').disabled = true; msg('ok', 'Sending…');
    try {
      var r = await fetch(SUPA_URL + '/rest/v1/rpc/submit_quote_request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': ANON_KEY, 'Authorization': 'Bearer ' + ANON_KEY },
        body: JSON.stringify({ p: {
          brand_name:   v.brand,
          contact_name: v.name,
          email:        v.email,
          phone:        v.phone,
          service:      'Formula to Shelf: ' + v.program,
          product_type: v.product,
          details:      'Formula to Shelf request (' + v.program + ')\n' + v.details,
          lead_source:  'formula_to_shelf'
        }})
      });
      var data = await r.json().catch(function(){ return null; });
      if(!r.ok) throw new Error((data && (data.message || data.hint)) || ('HTTP ' + r.status));
      if(!data) throw new Error('no deal returned');
      el('apply').classList.add('sent');
      el('lf-done').scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch(e){
      msg('err', friendly(e));
    } finally {
      busy = false; el('lf-submit').disabled = false;
    }
  });
})();
