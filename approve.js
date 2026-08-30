/*
 * approve.js — extracted verbatim from approve.html (GL-DEF-01).
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
  var FN = SUPA_URL + '/functions/v1/booking-approve';

  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
  function headers(extra){ var h={ 'apikey':ANON_KEY, 'Authorization':'Bearer '+ANON_KEY }; if(extra) for(var k in extra) h[k]=extra[k]; return h; }
  var card = document.getElementById('card');
  function show(html){ card.innerHTML = html; }

  var qs = new URLSearchParams(location.search);
  var b = qs.get('b') || '';
  var t = qs.get('t') || '';

  function detailRows(bk){
    return '<div class="box">' +
      '<div class="row"><span class="lbl">When</span><span class="val">' + esc(bk.date) + '</span></div>' +
      '<div class="row"><span class="lbl">Time</span><span class="val">' + esc(bk.time) + ' <span style="color:#6b87ad;font-weight:400">' + esc(bk.tz||'') + '</span></span></div>' +
      '<div class="row"><span class="lbl">Who</span><span class="val">' + esc(bk.name) + (bk.company ? ' · ' + esc(bk.company) : '') + '</span></div>' +
      '<div class="row"><span class="lbl">Contact</span><span class="val">' + esc(bk.email) + '</span></div>' +
      (bk.notes ? '<div class="row"><span class="lbl">Notes</span><span class="val" style="font-weight:400;color:#c8d8f0">' + esc(bk.notes) + '</span></div>' : '') +
      '</div>';
  }

  function renderReview(bk){
    show('<h1>Tour request</h1><div class="sub">Approve to confirm the tour and send the customer their invite, or decline to free the slot.</div>' +
      detailRows(bk) +
      '<div class="btns">' +
        '<button class="approve" id="btn-approve">✓ Approve</button>' +
        '<button class="decline" id="btn-decline">✕ Decline</button>' +
      '</div>' +
      '<div id="busy">Working…</div>');
    document.getElementById('btn-approve').addEventListener('click', function(){ act('approve'); });
    document.getElementById('btn-decline').addEventListener('click', function(){ act('decline'); });
  }

  function renderAlready(status, bk){
    var map = {
      confirmed: '<div class="big">✅</div><h1 class="ok">Already approved</h1><p>This tour is confirmed and the customer has their calendar invite.</p>',
      declined:  '<div class="big">✖️</div><h1 class="warn">Already declined</h1><p>This request was declined and the customer was let know.</p>',
      cancelled: '<div class="big">🚫</div><h1 class="warn">Cancelled</h1><p>This booking was cancelled.</p>'
    };
    show((map[status] || '<div class="big">ℹ️</div><h1>Status: ' + esc(status) + '</h1>') + (bk ? detailRows(bk) : ''));
  }

  function act(action){
    var busy = document.getElementById('busy');
    var ap = document.getElementById('btn-approve'), dc = document.getElementById('btn-decline');
    if(busy) busy.style.display = 'block';
    if(ap) ap.disabled = true; if(dc) dc.disabled = true;
    var fd = new FormData();
    fd.append('b', b); fd.append('t', t); fd.append('action', action); fd.append('format','json');
    fetch(FN + '?format=json', { method:'POST', body: fd, headers: headers({ Accept:'application/json' }) })
      .then(function(r){ return r.json().catch(function(){ return {}; }); })
      .then(function(j){
        if(!j || !j.ok){
          if(busy) busy.style.display='none';
          if(ap) ap.disabled=false; if(dc) dc.disabled=false;
          show('<div class="big">⚠️</div><h1 class="bad">Couldn\'t complete that</h1><p>' + esc((j && j.message) || 'Please try again in a moment.') + '</p>');
          return;
        }
        if(action === 'approve'){
          show('<div class="big">✅</div><h1 class="ok">Tour approved</h1><p>' + esc(j.message || 'The customer got their confirmation and calendar invite.') + ' It\'s on your calendar and the admin schedule.</p>' + (j.booking ? detailRows(j.booking) : ''));
        } else {
          show('<div class="big">✖️</div><h1 class="warn">Request declined</h1><p>' + esc(j.message || 'The customer was let know and the slot is free again.') + '</p>' + (j.booking ? detailRows(j.booking) : ''));
        }
      })
      .catch(function(){
        if(busy) busy.style.display='none';
        if(ap) ap.disabled=false; if(dc) dc.disabled=false;
        show('<div class="big">⚠️</div><h1 class="bad">Network error</h1><p>Please try again in a moment.</p>');
      });
  }

  if(!b || !t){
    show('<div class="big">🔗</div><h1>Link incomplete</h1><p>This approval link is missing information. Open it directly from your email.</p>');
    return;
  }

  fetch(FN + '?format=json&b=' + encodeURIComponent(b) + '&t=' + encodeURIComponent(t), { headers: headers({ Accept:'application/json' }) })
    .then(function(r){ return r.json().catch(function(){ return {}; }); })
    .then(function(j){
      if(!j || (!j.ok && !j.already)){
        show('<div class="big">🚫</div><h1 class="bad">Couldn\'t open this request</h1><p>' + esc((j && j.message) || 'The link may be invalid or expired. Reply to the request email and we\'ll sort it out.') + '</p>');
        return;
      }
      if(j.already){ renderAlready(j.status, j.booking); return; }
      renderReview(j.booking || {});
    })
    .catch(function(){
      show('<div class="big">⚠️</div><h1 class="bad">Couldn\'t load the request</h1><p>Please try again in a moment, or reply to the request email.</p>');
    });
})();

