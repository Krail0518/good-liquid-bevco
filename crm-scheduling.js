/* ============================================================
   SCHEDULING LINK (CRM page + public book.html support)

   Lets every rep configure their availability and share a
   public booking URL (goodliquidbevco.com/book?u=<slug>).
   Visitors can book a time slot without logging in; a
   confirmation email goes to both parties.

   Backed by:
     • booking_pages  — per-user availability config
     • bookings       — individual appointments
     • booking-confirm Edge Function — validates, inserts,
                         creates cal_event, sends emails
   ============================================================ */
(function(){
  'use strict';

  var CONFIRM_URL = 'https://ufjkeqmxwuyhbqyugcgg.supabase.co/functions/v1/booking-confirm';
  var BOOK_BASE   = window.location.origin + '/book';

  function getSB(){ return window.supa || null; }
  function esc(v){ return v==null?'':String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  var _page     = null;   // current user's booking_pages row
  var _bookings = [];     // upcoming confirmed bookings

  // ── Slug helper ─────────────────────────────────────────────────────
  function makeSlug(name){
    return String(name||'').toLowerCase().split('@')[0]
      .replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,30) || 'user';
  }

  // ── Load or auto-create the user's booking page ─────────────────────
  async function ensurePage(){
    var sb = getSB();
    if(!sb || !window.currentUser) return null;
    var uid = window.currentUser.id;

    var r = await sb.from('booking_pages').select('*').eq('user_id', uid).maybeSingle();
    if(r && r.data){ _page = r.data; return _page; }

    // Auto-create with a sensible slug derived from the user's name/email
    var slug = makeSlug(window.currentUser.name || window.currentUser.email || uid);
    var newPage = {
      user_id:      uid,
      slug:         slug,
      title:        'Schedule a Call with Good Liquid Bev Co',
      description:  'Pick a time that works for you — 100% free, no pressure.',
      duration:     30,
      buffer_after: 10,
      timezone:     'America/New_York',
      avail_days:   [1,2,3,4,5],
      start_time:   '09:00',
      end_time:     '17:00',
      is_active:    true
    };

    var ins = await sb.from('booking_pages').insert([newPage]).select().single();
    if(ins && ins.data){ _page = ins.data; return _page; }

    // Retry with random suffix on slug collision
    newPage.slug = slug + '-' + Math.random().toString(36).slice(2,5);
    ins = await sb.from('booking_pages').insert([newPage]).select().single();
    if(ins && ins.data){ _page = ins.data; return _page; }

    return null;
  }

  async function loadBookings(){
    var sb = getSB();
    if(!sb || !_page) return;
    var r = await sb.from('bookings')
      .select('*')
      .eq('page_id', _page.id)
      .eq('status', 'confirmed')
      .gte('start_at', new Date().toISOString())
      .order('start_at', {ascending:true})
      .limit(50);
    _bookings = (r && r.data) || [];
  }

  // ── Main page render ─────────────────────────────────────────────────
  async function refresh(){
    var host = document.getElementById('cpg-scheduling');
    if(!host || !host.classList.contains('act')) return;
    host.innerHTML = '<div style="padding:24px;color:var(--teal,#00e5c0);font-size:13px">Loading…</div>';

    var page = await ensurePage();
    if(!page){
      host.innerHTML = '<div style="padding:24px;color:var(--muted,#6b87ad);font-size:14px">Could not load your scheduling page. Please refresh and try again.</div>';
      return;
    }
    await loadBookings();
    renderPage(host, page);
  }

  function tz12(tz){
    try {
      var p = new Intl.DateTimeFormat('en-US',{timeZone:tz,timeZoneName:'short'}).formatToParts(new Date());
      return (p.find(function(x){return x.type==='timeZoneName';})||{value:tz}).value;
    } catch(e){ return tz; }
  }

  function fmtDT(iso){
    var d = new Date(iso);
    return d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) +
           ' at ' + d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',hour12:true});
  }

  function renderPage(host, page){
    var link = BOOK_BASE + '?u=' + encodeURIComponent(page.slug);
    var upcoming = _bookings;
    var daysMap  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    var selDays  = page.avail_days || [1,2,3,4,5];

    var tzOpts = [
      ['America/New_York',   'Eastern Time (ET)'],
      ['America/Chicago',    'Central Time (CT)'],
      ['America/Denver',     'Mountain Time (MT)'],
      ['America/Los_Angeles','Pacific Time (PT)'],
      ['America/Phoenix',    'Arizona (no DST)'],
      ['America/Anchorage',  'Alaska (AKT)'],
      ['Pacific/Honolulu',   'Hawaii (HST)'],
      ['UTC',                'UTC']
    ].map(function(o){
      return '<option value="'+esc(o[0])+'"'+(page.timezone===o[0]?' selected':'')+'>'+esc(o[1])+'</option>';
    }).join('');

    host.innerHTML =
      '<div style="padding:20px 24px;max-width:720px;margin:0 auto">' +

        /* ── Header ── */
        '<div style="margin-bottom:18px">' +
          '<h2 style="margin:0;font-size:20px;color:#fff">📅 Scheduling Link</h2>' +
          '<div style="color:var(--muted,#6b87ad);font-size:13px;margin-top:3px">Share your link — visitors book directly onto your calendar</div>' +
        '</div>' +

        /* ── Link card ── */
        '<div class="ccard" style="margin-bottom:18px;padding:18px 20px">' +
          '<div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:var(--muted,#6b87ad);margin-bottom:8px">Your booking link</div>' +
          '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
            '<div style="flex:1;min-width:200px;background:rgba(0,229,192,.06);border:1px solid rgba(0,229,192,.2);border-radius:8px;padding:10px 14px;font-size:13px;color:var(--teal,#00e5c0);word-break:break-all">'+esc(link)+'</div>' +
            '<button onclick="window.glSchedCopy()" style="white-space:nowrap;padding:10px 16px;background:rgba(0,229,192,.12);color:var(--teal,#00e5c0);border:1px solid rgba(0,229,192,.25);border-radius:8px;cursor:pointer;font-size:13px;font-weight:600">Copy Link</button>' +
          '</div>' +
          '<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">' +
            '<button onclick="window.glSchedEmail()" style="padding:8px 14px;background:rgba(245,200,66,.07);color:#f5c842;border:1px solid rgba(245,200,66,.25);border-radius:7px;cursor:pointer;font-size:12px">📧 Send via Email</button>' +
            '<a href="'+esc(link)+'" target="_blank" style="display:inline-flex;align-items:center;padding:8px 14px;background:rgba(100,140,255,.07);color:#7fc6f5;border:1px solid rgba(100,140,255,.2);border-radius:7px;cursor:pointer;font-size:12px;text-decoration:none">🔗 Preview Page</a>' +
          '</div>' +
        '</div>' +

        /* ── Settings ── */
        '<div class="ccard" style="margin-bottom:18px">' +
          '<div style="font-size:14px;font-weight:600;color:#fff;padding:16px 20px 0;margin-bottom:14px">Availability Settings</div>' +
          '<div style="padding:0 20px 20px;display:grid;gap:14px">' +

            '<div>' +
              '<label style="font-size:12px;color:var(--muted,#6b87ad);display:block;margin-bottom:5px">Booking page title (shown to visitors)</label>' +
              '<input id="gl-sched-title" value="'+esc(page.title)+'" style="width:100%;box-sizing:border-box;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:7px;color:#fff;padding:9px 12px;font-size:14px">' +
            '</div>' +

            '<div>' +
              '<label style="font-size:12px;color:var(--muted,#6b87ad);display:block;margin-bottom:5px">Description (shown to visitors, optional)</label>' +
              '<input id="gl-sched-desc" value="'+esc(page.description||'')+'" placeholder="e.g. Quick intro call — no commitment" style="width:100%;box-sizing:border-box;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:7px;color:#fff;padding:9px 12px;font-size:14px">' +
            '</div>' +

            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' +
              '<div>' +
                '<label style="font-size:12px;color:var(--muted,#6b87ad);display:block;margin-bottom:5px">Meeting duration</label>' +
                '<select id="gl-sched-dur" style="width:100%;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:7px;color:#fff;padding:9px 12px;font-size:14px">' +
                  '<option value="15"'+(page.duration===15?' selected':'')+'>15 minutes</option>' +
                  '<option value="30"'+(page.duration===30?' selected':'')+'>30 minutes</option>' +
                  '<option value="60"'+(page.duration===60?' selected':'')+'>60 minutes</option>' +
                '</select>' +
              '</div>' +
              '<div>' +
                '<label style="font-size:12px;color:var(--muted,#6b87ad);display:block;margin-bottom:5px">Buffer after each meeting</label>' +
                '<select id="gl-sched-buf" style="width:100%;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:7px;color:#fff;padding:9px 12px;font-size:14px">' +
                  '<option value="0"'+(page.buffer_after===0?' selected':'')+'>No buffer</option>' +
                  '<option value="5"'+(page.buffer_after===5?' selected':'')+'>5 min</option>' +
                  '<option value="10"'+(page.buffer_after===10?' selected':'')+'>10 min</option>' +
                  '<option value="15"'+(page.buffer_after===15?' selected':'')+'>15 min</option>' +
                  '<option value="30"'+(page.buffer_after===30?' selected':'')+'>30 min</option>' +
                '</select>' +
              '</div>' +
            '</div>' +

            '<div>' +
              '<label style="font-size:12px;color:var(--muted,#6b87ad);display:block;margin-bottom:5px">Your timezone</label>' +
              '<select id="gl-sched-tz" style="width:100%;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:7px;color:#fff;padding:9px 12px;font-size:14px">' +
                tzOpts +
              '</select>' +
            '</div>' +

            '<div>' +
              '<label style="font-size:12px;color:var(--muted,#6b87ad);display:block;margin-bottom:8px">Available days</label>' +
              '<div style="display:flex;gap:7px;flex-wrap:wrap">' +
                [0,1,2,3,4,5,6].map(function(d){
                  var on = selDays.indexOf(d) >= 0;
                  return '<label style="display:flex;align-items:center;gap:5px;padding:6px 10px;border-radius:6px;background:'+(on?'rgba(0,229,192,.1)':'rgba(255,255,255,.04)')+';border:1px solid '+(on?'rgba(0,229,192,.3)':'rgba(255,255,255,.08)')+';cursor:pointer;font-size:13px;color:'+(on?'var(--teal,#00e5c0)':'#9aa7bd')+'">' +
                    '<input type="checkbox" name="gl-sched-day" value="'+d+'"'+(on?' checked':'')+' style="margin:0"> '+daysMap[d] +
                  '</label>';
                }).join('') +
              '</div>' +
            '</div>' +

            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' +
              '<div>' +
                '<label style="font-size:12px;color:var(--muted,#6b87ad);display:block;margin-bottom:5px">Start time</label>' +
                '<input type="time" id="gl-sched-start" value="'+esc(page.start_time)+'" style="width:100%;box-sizing:border-box;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:7px;color:#fff;padding:9px 12px;font-size:14px">' +
              '</div>' +
              '<div>' +
                '<label style="font-size:12px;color:var(--muted,#6b87ad);display:block;margin-bottom:5px">End time</label>' +
                '<input type="time" id="gl-sched-end" value="'+esc(page.end_time)+'" style="width:100%;box-sizing:border-box;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:7px;color:#fff;padding:9px 12px;font-size:14px">' +
              '</div>' +
            '</div>' +

            '<div>' +
              '<label style="font-size:12px;color:var(--muted,#6b87ad);display:block;margin-bottom:5px">Your link slug — the part after <code style="color:var(--teal,#00e5c0)">/book?u=</code></label>' +
              '<input id="gl-sched-slug" value="'+esc(page.slug)+'" placeholder="mike" style="width:100%;box-sizing:border-box;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:7px;color:#fff;padding:9px 12px;font-size:14px;font-family:monospace">' +
            '</div>' +

            '<div style="display:flex;align-items:center;gap:12px">' +
              '<button onclick="window.glSchedSave()" style="padding:11px 24px;background:var(--teal,#00e5c0);color:#0f1624;border:none;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer">Save Settings</button>' +
              '<span id="gl-sched-msg" style="font-size:13px;color:#5fcf9e"></span>' +
            '</div>' +

          '</div>' +
        '</div>' +

        /* ── Upcoming bookings ── */
        renderUpcoming(upcoming) +

      '</div>';

    // Wire global action handlers for onclick attributes in rendered HTML
    window.glSchedSave   = saveSettings;
    window.glSchedCopy   = function(){ copyText(link, 'gl-sched-msg', 'Link copied!'); };
    window.glSchedEmail  = openEmailModal;
    window.glSchedCancel = cancelBooking;
  }

  function renderUpcoming(list){
    var header = '<div class="ccard">' +
      '<div style="font-size:14px;font-weight:600;color:#fff;padding:16px 20px 0;margin-bottom:4px">' +
        'Upcoming Bookings <span style="font-weight:400;font-size:13px;color:var(--muted,#6b87ad)">(' + list.length + ')</span>' +
      '</div>';

    if(!list.length){
      return header +
        '<div style="padding:20px 20px 24px;font-size:13px;color:var(--muted,#6b87ad)">No upcoming bookings yet. Share your link to get started.</div>' +
        '</div>';
    }

    return header +
      '<div>' +
        list.map(function(b){
          var start = new Date(b.start_at);
          var end   = new Date(b.end_at);
          var dateStr = start.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});
          var timeStr = start.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',hour12:true}) +
                        ' – ' + end.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',hour12:true});
          return '<div style="display:flex;align-items:center;gap:12px;padding:14px 20px;border-top:1px solid rgba(255,255,255,.06)">' +
            '<div style="flex:1;min-width:0">' +
              '<div style="font-size:14px;color:#fff;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(b.booker_name)+'</div>' +
              '<div style="font-size:12px;color:var(--muted,#6b87ad);margin-top:2px">'+esc(b.booker_email)+(b.booker_company?' · '+esc(b.booker_company):'')+'</div>' +
              (b.notes?'<div style="font-size:11px;color:#9aa7bd;margin-top:3px;font-style:italic">'+esc(b.notes.slice(0,80))+'</div>':'') +
            '</div>' +
            '<div style="text-align:right;white-space:nowrap;flex-shrink:0">' +
              '<div style="font-size:13px;color:#fff">'+esc(dateStr)+'</div>' +
              '<div style="font-size:12px;color:var(--muted,#6b87ad)">'+esc(timeStr)+'</div>' +
            '</div>' +
            '<button onclick="window.glSchedCancel(\''+b.id+'\')" style="flex-shrink:0;padding:6px 12px;background:rgba(231,70,70,.08);color:#e74646;border:1px solid rgba(231,70,70,.2);border-radius:6px;cursor:pointer;font-size:12px">Cancel</button>' +
          '</div>';
        }).join('') +
      '</div></div>';
  }

  // ── Save availability settings ────────────────────────────────────────
  async function saveSettings(){
    var sb = getSB();
    if(!sb || !_page) return;

    var title  = (document.getElementById('gl-sched-title')||{}).value || '';
    var desc   = (document.getElementById('gl-sched-desc')||{}).value  || '';
    var dur    = parseInt((document.getElementById('gl-sched-dur')||{}).value||'30', 10);
    var buf    = parseInt((document.getElementById('gl-sched-buf')||{}).value||'10', 10);
    var tz     = (document.getElementById('gl-sched-tz')||{}).value || 'America/New_York';
    var start  = (document.getElementById('gl-sched-start')||{}).value || '09:00';
    var end    = (document.getElementById('gl-sched-end')||{}).value   || '17:00';
    var slug   = ((document.getElementById('gl-sched-slug')||{}).value || '').trim()
                   .toLowerCase().replace(/[^a-z0-9-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,30);

    var days = [];
    document.querySelectorAll('input[name="gl-sched-day"]:checked').forEach(function(el){ days.push(Number(el.value)); });

    var msg = document.getElementById('gl-sched-msg');
    if(msg){ msg.textContent = 'Saving…'; msg.style.color = '#9aa7bd'; }

    var updates = {
      title:        title.trim() || 'Schedule a meeting',
      description:  desc.trim() || null,
      duration:     [15,30,60].includes(dur) ? dur : 30,
      buffer_after: [0,5,10,15,30].includes(buf) ? buf : 10,
      timezone:     tz,
      start_time:   start,
      end_time:     end,
      avail_days:   days.length ? days : [1,2,3,4,5],
      slug:         slug || _page.slug
    };

    var r = await sb.from('booking_pages').update(updates).eq('id', _page.id).select().single();
    if(r && r.data){
      _page = r.data;
      if(msg){ msg.textContent = '✓ Saved'; msg.style.color = '#5fcf9e'; setTimeout(function(){ if(msg)msg.textContent=''; }, 3000); }
      var linkEl = document.querySelector('#cpg-scheduling [style*="word-break"]');
      if(linkEl){ linkEl.textContent = BOOK_BASE + '?u=' + encodeURIComponent(_page.slug); }
    } else {
      if(msg){ msg.textContent = r && r.error ? r.error.message : 'Save failed'; msg.style.color = '#e74646'; }
    }
  }

  // ── Cancel a booking ─────────────────────────────────────────────────
  async function cancelBooking(id){
    if(!confirm('Cancel this booking? The visitor has already received a confirmation email — you may want to email them directly to let them know.')) return;
    var sb = getSB();
    if(!sb) return;
    await sb.from('bookings').update({status:'cancelled'}).eq('id', id);
    _bookings = _bookings.filter(function(b){ return b.id !== id; });
    refresh();
  }

  // ── Copy to clipboard with fallback ──────────────────────────────────
  function copyText(text, msgId, successMsg){
    navigator.clipboard.writeText(text).then(function(){
      var el = document.getElementById(msgId);
      if(el){ el.textContent = successMsg; el.style.color = '#5fcf9e'; setTimeout(function(){ if(el)el.textContent=''; }, 3000); }
    }).catch(function(){
      prompt('Copy this link:', text);
    });
  }

  // ── "Send via Email" modal ────────────────────────────────────────────
  function openEmailModal(){
    if(!_page) return;
    var link = BOOK_BASE + '?u=' + encodeURIComponent(_page.slug);
    var ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
    ov.innerHTML =
      '<div style="background:#192337;border:1px solid #1f3059;border-radius:14px;padding:28px;max-width:480px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.5)">' +
        '<div style="font-size:17px;font-weight:700;color:#fff;margin-bottom:4px">📧 Send Your Scheduling Link</div>' +
        '<div style="font-size:13px;color:#6b87ad;margin-bottom:18px">Send a personalised email with your booking link</div>' +
        '<div style="display:grid;gap:12px">' +
          '<div>' +
            '<label style="font-size:12px;color:#6b87ad;display:block;margin-bottom:5px">Recipient email *</label>' +
            '<input id="gl-sched-email-to" type="email" placeholder="prospect@company.com" style="width:100%;box-sizing:border-box;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:7px;color:#fff;padding:9px 12px;font-size:14px">' +
          '</div>' +
          '<div>' +
            '<label style="font-size:12px;color:#6b87ad;display:block;margin-bottom:5px">Their name (optional)</label>' +
            '<input id="gl-sched-email-name" type="text" placeholder="Jane" style="width:100%;box-sizing:border-box;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:7px;color:#fff;padding:9px 12px;font-size:14px">' +
          '</div>' +
          '<div>' +
            '<label style="font-size:12px;color:#6b87ad;display:block;margin-bottom:5px">Personal note (optional)</label>' +
            '<textarea id="gl-sched-email-note" rows="3" placeholder="Would love to connect and discuss your project…" style="width:100%;box-sizing:border-box;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:7px;color:#fff;padding:9px 12px;font-size:14px;font-family:inherit;resize:vertical"></textarea>' +
          '</div>' +
        '</div>' +
        '<div style="margin-top:8px;padding:12px;background:rgba(0,229,192,.05);border:1px solid rgba(0,229,192,.15);border-radius:8px;font-size:12px;color:#9aa7bd">' +
          'Preview: "'+esc((window.currentUser||{}).name||'I')+' would like to find a time to connect. Check my availability and book a slot that works for you: <a style=\'color:#00e5c0\'>' + esc(link) + '</a>"' +
        '</div>' +
        '<div style="display:flex;gap:10px;margin-top:18px">' +
          '<button onclick="window.glSchedSendEmail()" style="flex:1;padding:12px;background:var(--teal,#00e5c0);color:#0f1624;border:none;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer">Send Email</button>' +
          '<button onclick="this.closest(\'div[style*=fixed]\').remove()" style="padding:12px 18px;background:rgba(255,255,255,.07);color:#9aa7bd;border:1px solid rgba(255,255,255,.1);border-radius:8px;cursor:pointer;font-size:14px">Cancel</button>' +
        '</div>' +
        '<div id="gl-sched-email-err" style="margin-top:10px;font-size:13px;color:#e74646;display:none"></div>' +
      '</div>';
    document.body.appendChild(ov);
    ov.addEventListener('click', function(e){ if(e.target === ov) ov.remove(); });

    window.glSchedSendEmail = async function(){
      var to   = (document.getElementById('gl-sched-email-to')  ||{}).value||'';
      var name = (document.getElementById('gl-sched-email-name')||{}).value||'';
      var note = (document.getElementById('gl-sched-email-note')||{}).value||'';
      var errEl= document.getElementById('gl-sched-email-err');
      if(!to || !to.includes('@')){ if(errEl){errEl.textContent='Please enter a valid email address.';errEl.style.display='block';} return; }

      var senderName = (window.currentUser||{}).name || 'The team at Good Liquid Bev Co';
      var greeting   = name ? 'Hi ' + name + ',' : 'Hi there,';
      var noteText   = note.trim() ? '\n\n' + note.trim() : '';

      var body = greeting + noteText + '\n\nI\'d love to find a time to connect. Check my availability and book a slot that works for you:\n\n' +
                 link + '\n\nLooking forward to it!\n\n— ' + senderName + '\nGood Liquid Bev Co · Mike@GoodLiquid.com · (803) 493-5065';

      // HTML email with a teal CTA button — no raw URL visible to the reader
      var noteHtml = note.trim()
        ? '<p style="margin:0 0 20px;font-size:15px;color:#333;line-height:1.7">' + esc(note.trim()).replace(/\n/g,'<br>') + '</p>'
        : '';
      var htmlBody =
        '<!DOCTYPE html><html><head><meta charset="utf-8"></head>' +
        '<body style="margin:0;padding:0;background:#f0f2f5;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Helvetica,Arial,sans-serif">' +
        '<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f2f5;padding:40px 16px"><tr><td align="center">' +
        '<table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.10);max-width:560px">' +
        '<tr><td style="background:#0d1420;padding:28px 36px;text-align:center">' +
          '<div style="font-size:20px;font-weight:800;color:#ffffff;letter-spacing:2px;text-transform:uppercase">Good Liquid Bev Co</div>' +
          '<div style="font-size:11px;color:#00e5c0;letter-spacing:3px;margin-top:5px;text-transform:uppercase">Meeting Invite</div>' +
        '</td></tr>' +
        '<tr><td style="padding:36px 36px 28px">' +
          '<p style="margin:0 0 18px;font-size:16px;color:#111;line-height:1.5">' + esc(greeting) + '</p>' +
          noteHtml +
          '<p style="margin:0 0 28px;font-size:15px;color:#333;line-height:1.7">I\'d love to find a time to connect. Click the button below to see my availability and pick a slot that works for you.</p>' +
          '<table cellpadding="0" cellspacing="0" style="margin:0 auto 32px"><tr>' +
            '<td style="background:#00e5c0;border-radius:10px;box-shadow:0 4px 18px rgba(0,229,192,.35)">' +
              '<a href="' + esc(link) + '" target="_blank" style="display:block;padding:16px 44px;font-size:16px;font-weight:800;color:#0d1420;text-decoration:none;letter-spacing:.3px;white-space:nowrap">📅&nbsp; Book a Time</a>' +
            '</td>' +
          '</tr></table>' +
          '<p style="margin:0;font-size:14px;color:#333;line-height:1.7">Looking forward to connecting!</p>' +
          '<p style="margin:12px 0 0;font-size:14px;color:#111;font-weight:700">— ' + esc(senderName) + '</p>' +
        '</td></tr>' +
        '<tr><td style="background:#f8f9fb;padding:18px 36px;text-align:center;border-top:1px solid #eee">' +
          '<p style="margin:0;font-size:11px;color:#aaa;line-height:1.6">' +
            'Good Liquid Bev Co &nbsp;·&nbsp; ' +
            '<a href="mailto:Mike@GoodLiquid.com" style="color:#00b89a;text-decoration:none">Mike@GoodLiquid.com</a>' +
            ' &nbsp;·&nbsp; (803) 493-5065' +
          '</p>' +
        '</td></tr>' +
        '</table></td></tr></table></body></html>';

      if(typeof window.sendMailgunEmail === 'function'){
        var ok = await window.sendMailgunEmail(to, senderName + ' wants to meet — book a time', body, { html: htmlBody });
        if(ok){ ov.remove(); if(typeof addNotification==='function') addNotification('📧 Scheduling link sent', to, 'success'); }
        else { if(errEl){errEl.textContent='Send failed. Check your Mailgun settings.';errEl.style.display='block';} }
      } else {
        // Fallback: open the user's local mail client
        window.open('mailto:'+encodeURIComponent(to)+'?subject='+encodeURIComponent(senderName+' wants to meet')+'&body='+encodeURIComponent(body));
        ov.remove();
      }
    };
  }

  // ── Nav item injection (Calendars section) ────────────────────────────
  function injectNav(){
    if(document.getElementById('nav-scheduling')) return;
    var calNav = document.getElementById('nav-calendar') || document.getElementById('nav-production-cal');
    if(!calNav) return;
    var parent = calNav.parentElement;
    if(!parent) return;
    var link = document.createElement('div');
    link.id        = 'nav-scheduling';
    link.className = 'cni';
    link.innerHTML = '<span class="cni-ico">🔗</span>Scheduling Link';
    link.setAttribute('onclick', "cNav('scheduling',this)");
    // Insert after the production calendar nav item
    var prodCal = document.getElementById('nav-production-cal');
    var ref = prodCal ? prodCal.nextSibling : null;
    parent.insertBefore(link, ref);
  }

  // ── Page container injection ──────────────────────────────────────────
  function injectPage(){
    if(document.getElementById('cpg-scheduling')) return;
    var main = document.querySelector('.crm-main');
    if(!main) return;
    var div = document.createElement('div');
    div.id        = 'cpg-scheduling';
    div.className = 'cpg';
    main.insertBefore(div, main.firstChild);
  }

  // ── MutationObserver: refresh the page when it becomes active ─────────
  function watchPage(){
    var pg = document.getElementById('cpg-scheduling');
    if(!pg){ setTimeout(watchPage, 500); return; }
    if(pg.__schedWatched) return;
    pg.__schedWatched = true;
    new MutationObserver(function(){
      if(pg.classList.contains('act')) refresh();
    }).observe(pg, { attributes:true, attributeFilter:['class'] });
  }

  // ── Boot ──────────────────────────────────────────────────────────────
  function boot(){
    // Grant scheduling page access to admin and sales roles
    if(window.PERMISSIONS){
      ['admin','sales'].forEach(function(role){
        var arr = window.PERMISSIONS[role];
        if(arr && !arr.includes('scheduling')) arr.push('scheduling');
      });
    }
    injectPage();
    injectNav();
    watchPage();
  }

  if(document.readyState !== 'loading') setTimeout(boot, 400);
  else document.addEventListener('DOMContentLoaded', function(){ setTimeout(boot, 400); });

  window.GL_HOOKS.registerLoginHook(function(){ setTimeout(boot, 600); });

  console.log('[GL] Scheduling link loaded');
}());
