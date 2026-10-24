/*
 * questionnaire.js: public, token gated project questionnaire for a pipeline lead.
 *
 * questionnaire.html?t=<48 hex token>. The token maps to exactly one deal
 * (deal_questionnaire_links). Answers are saved by gl_questionnaire_submit into
 * product_intake on that deal, which the CRM shows under Intake and carries to
 * the client record when the deal is converted.
 *
 * Renders with GL_INTAKE (intake-questions.js), the single source of truth for
 * the questions, so this page, the tour gate, onboarding and the CRM never
 * drift apart. Everything the lead types is set through textContent or
 * GL_INTAKE's own escaping; nothing is written as raw HTML here.
 */
(function(){
  'use strict';
  var SUPA_URL = 'https://ufjkeqmxwuyhbqyugcgg.supabase.co';
  var ANON_KEY = 'sb_publishable_-37mkPw8uLzEJM21T9jJOA_YQRQ7ikB';
  var params = new URLSearchParams(location.search);
  var token = params.get('t') || params.get('token') || '';

  function el(id){ return document.getElementById(id); }
  function show(id){ el(id).classList.remove('hidden'); }
  function hide(id){ el(id).classList.add('hidden'); }
  function fatal(m){ hide('loading'); hide('form'); el('fatal-msg').textContent = m; show('fatal'); }
  function msg(kind, text){ var m = el('msg'); m.className = 'msg ' + kind; m.textContent = text; }

  async function rpc(fn, body){
    var r = await fetch(SUPA_URL + '/rest/v1/rpc/' + fn, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': ANON_KEY, 'Authorization': 'Bearer ' + ANON_KEY },
      body: JSON.stringify(body)
    });
    var data = await r.json().catch(function(){ return null; });
    if(!r.ok){
      var text = (data && (data.message || data.hint)) || ('HTTP ' + r.status);
      throw new Error(text);
    }
    return data;
  }

  // Server errors that are written for the lead to read; anything else gets a
  // generic message so internal details never reach the page.
  function friendly(e){
    var m = String((e && e.message) || '');
    if(/wait a moment|update limit|too long/i.test(m)) return m;
    if(/invalid link/i.test(m)) return 'This link is no longer valid.';
    return 'Something went wrong saving your answers. Please try again in a minute.';
  }

  if(!/^[0-9a-f]{48}$/.test(token)){ fatal('This link is incomplete. Please use the full link from our email.'); return; }
  if(!window.GL_INTAKE){ fatal('The form did not load. Refresh the page to try again.'); return; }

  var mount = el('q-mount');

  (async function init(){
    var data;
    try { data = await rpc('gl_questionnaire_get', { p_token: token }); }
    catch(e){ fatal(/invalid link/i.test(String(e.message)) ? 'This link is no longer valid.' : 'We could not load your questionnaire right now. Please try again shortly.'); return; }
    if(!data || data.ok !== true){ fatal('This link is no longer valid.'); return; }

    var answers = Object.assign({}, data.answers || {});
    var hasPrior = Object.keys(answers).length > 0;
    // Prefill what we already know from the pipeline record.
    var parts = String(data.contact_name || '').trim().split(/\s+/).filter(Boolean);
    if(!answers.company && data.company) answers.company = data.company;
    if(!answers.first_name && parts.length) answers.first_name = parts[0];
    if(!answers.last_name && parts.length > 1) answers.last_name = parts.slice(1).join(' ');
    if(!answers.email && data.email) answers.email = data.email;
    if(!answers.phone && data.phone) answers.phone = data.phone;

    if(answers.first_name) el('hi').textContent = 'Project questionnaire for ' + answers.first_name;
    if(hasPrior) el('returning').style.display = 'block';

    window.GL_INTAKE.render(mount, answers);
    hide('loading'); show('form');
  })();

  var busy = false;
  el('form').addEventListener('submit', async function(ev){
    ev.preventDefault();
    if(busy) return;
    var res = window.GL_INTAKE.collect(mount);
    if(!res.ok){
      msg('err', 'Please complete: ' + res.missing.join('; ') + '.');
      return;
    }
    busy = true; el('submit-btn').disabled = true; msg('ok', 'Saving…');
    try {
      var out = await rpc('gl_questionnaire_submit', { p_token: token, p_answers: res.answers });
      if(!out || out.ok !== true) throw new Error('save failed');
      hide('form'); show('done');
      window.scrollTo(0, 0);
    } catch(e){
      msg('err', friendly(e));
    } finally {
      busy = false; el('submit-btn').disabled = false;
    }
  });
})();
