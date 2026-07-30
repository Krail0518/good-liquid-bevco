/* ============================================================
   crm-onboarding.js — pipeline lead → client → self-service intake
   ============================================================
   The whole staff side of client onboarding, kept in its own module (the
   public intake page is onboard.html; the schema + token RPCs are migration
   20260730020000_onboarding.sql). Nothing here stores data locally — every
   read and write goes to Supabase (the `onboarding` and `clients` tables via
   the gl_onboarding_* RPCs). No localStorage, no in-memory source of truth.

   Exposes:
     window.glConvertLeadToOnboarding()  — button on the pipeline deal detail
     window.glOpenOnboardings()          — admin status board (Quick Actions)
   ============================================================ */
(function(){
  'use strict';

  function sb(){ return window.supa || null; }
  function esc(s){
    return String(s == null ? '' : s).replace(/[<>&"]/g, function(c){
      return { '<':'&lt;', '>':'&gt;', '&':'&amp;', '"':'&quot;' }[c];
    });
  }

  // ── Build the onboarding link for a token ──
  function onboardLink(token){
    return location.origin + '/onboard.html?token=' + encodeURIComponent(token);
  }

  // ── Convert the currently-open pipeline lead into a client + onboarding ──
  // One click: create the client (carrying over what the lead told us), create
  // a token-secured onboarding row prefilled from the same data, email the
  // client their finish link, invite their portal login, and (via the DB
  // submit trigger) get a WhatsApp when they complete it. Every failure is
  // surfaced; nothing half-done is left silent.
  window.glConvertLeadToOnboarding = async function glConvertLeadToOnboarding(){
    var stage = window.currentDealStage, idx = window.currentDealIdx;
    if(stage == null || idx == null){ alert('No lead selected.'); return; }
    var d = ((window.deals && window.deals[stage]) || [])[idx];
    if(!d){ alert('No lead selected.'); return; }
    if(!sb()){ alert('Supabase not ready.'); return; }

    var company = d.co || d.name || '';
    var email = (d.email || '').trim();
    if(!company){ alert('This lead has no company name — add one first (✏️ Edit).'); return; }
    if(!email){ alert('This lead has no email address — add one first so we can send the onboarding link.'); return; }

    if(!confirm('Convert "' + company + '" into a client and send them an onboarding link at ' + email + '?')) return;

    if(typeof window.glStartBusy === 'function') window.glStartBusy('Creating client & onboarding…');
    try {
      // 1) Create the client, carrying over what the lead gave us.
      var contact = d.contactName || '';
      var initials = (company.trim().split(/\s+/).map(function(w){ return w[0]; }).join('').slice(0,2) || 'GL').toUpperCase();
      var ins = await sb().from('clients').insert([{
        name: company, contact_name: contact, email: email, phone: d.phone || null,
        city: d.city || null, state: d.state || null,
        service: d.service || null, status: 'onboarding',
        lead_source: d.leadSource || null, notes: d.notes || null,
        initials: initials, onboarding_status: 'invited'
      }]).select('id').single();
      if(ins.error) throw new Error('client insert: ' + ins.error.message);
      var clientId = ins.data.id;

      // 2) Create the onboarding row, prefilled — RPC returns the secret token.
      var prefill = {
        company: company, name: contact, email: email, phone: d.phone || '',
        city: d.city || '', state: d.state || '', service: d.service || '',
        notes: d.notes || '', volume: d.volume || '', timeline: d.timeline || '',
        product_type: d.productType || ''
      };
      var cr = await sb().rpc('gl_onboarding_create', {
        p_client_id: clientId, p_prefill: prefill,
        p_deal_id: (d.id && !String(d.id).startsWith('tmp_')) ? d.id : null
      });
      if(cr.error) throw new Error('onboarding create: ' + cr.error.message);
      if(!cr.data || cr.data.ok === false) throw new Error('onboarding create: ' + ((cr.data && cr.data.error) || 'unknown'));
      var link = onboardLink(cr.data.token);

      // 3) Email the client their onboarding link.
      var firstName = (contact.split(' ')[0]) || 'there';
      var subject = 'Welcome to Good Liquid Bev Co — let\'s get you set up';
      var body = 'Hi ' + firstName + ',\n\n'
        + 'Great news, we\'re excited to start working with ' + company + '. '
        + 'To set up your account and get your project moving, please complete a short onboarding form. '
        + 'We\'ve already filled in what we have, so it should only take a few minutes:\n\n'
        + link + '\n\n'
        + 'Once you submit it, I\'ll be in touch about next steps and your production schedule.\n\n'
        + 'Thanks,\nMike\nGood Liquid Bev Co\n(803) 493-5065';
      var emailOk = false;
      if(typeof window.sendMailgunEmail === 'function'){
        emailOk = await window.sendMailgunEmail(email, subject, body, {
          html: '<div style="font-family:Arial,sans-serif;color:#1a1a1a;line-height:1.7;max-width:600px;margin:0 auto">'
            + '<div style="border-top:3px solid #00e5c0;padding:22px 26px">'
            + '<div style="font-size:19px;font-weight:900;color:#00b89a;letter-spacing:2px;margin-bottom:12px">GOOD LIQUID BEV CO</div>'
            + '<p>Hi ' + esc(firstName) + ',</p>'
            + '<p>Great news — we\'re excited to start working with ' + esc(company) + '. To set up your account and get your project moving, please complete a short onboarding form. We\'ve already filled in what we have, so it should only take a few minutes:</p>'
            + '<p style="text-align:center;margin:26px 0"><a href="' + link + '" style="background:#00e5c0;color:#04231d;text-decoration:none;font-weight:800;padding:13px 26px;border-radius:8px;display:inline-block">Complete your onboarding →</a></p>'
            + '<p>Once you submit it, I\'ll be in touch about next steps and your production schedule.</p>'
            + '<p>Thanks,<br>Mike<br>Good Liquid Bev Co · (803) 493-5065</p>'
            + '</div></div>'
        });
      }

      // 4) Invite their portal login (best-effort — never blocks onboarding).
      try { if(typeof window.glInviteCustomerLogin === 'function') await window.glInviteCustomerLogin(clientId, company, email); }
      catch(e){ console.warn('[onboarding] portal invite failed', e); }

      // 5) Refresh local state so the new client shows up without a reload.
      try { if(typeof window.loadSupabaseData === 'function') await window.loadSupabaseData(); } catch(e){}

      if(typeof window.glEndBusy === 'function') window.glEndBusy();
      var linkNote = emailOk
        ? 'An onboarding email was sent to ' + email + '.'
        : '⚠ The client was created but the email failed to send. Copy this link to them manually:\n\n' + link;
      alert('✓ ' + company + ' is now a client.\n\n' + linkNote + '\n\nYou\'ll get a WhatsApp when they finish onboarding.');
      if(typeof window.glAudit === 'function') window.glAudit('lead_converted', clientId, { company: company, email: email });
    } catch(e){
      if(typeof window.glEndBusy === 'function') window.glEndBusy();
      console.error('[onboarding] convert failed', e);
      alert('✗ Convert failed: ' + (e.message || e) + '\n\nNothing was sent. Check the browser console and try again.');
    }
  };

  // ── Admin status board: every onboarding and where it stands ──
  window.glOpenOnboardings = async function glOpenOnboardings(){
    var prior = document.getElementById('gl-onboardings-modal'); if(prior) prior.remove();
    var ov = document.createElement('div');
    ov.id = 'gl-onboardings-modal';
    ov.setAttribute('style','position:fixed;inset:0;z-index:900;background:rgba(6,13,26,.95);backdrop-filter:blur(16px);display:flex;align-items:center;justify-content:center;padding:20px');
    ov.innerHTML =
      '<div style="background:#142238;border:1px solid rgba(0,229,192,.2);border-radius:16px;padding:26px;width:100%;max-width:720px;max-height:92vh;overflow-y:auto">' +
        '<div style="font-family:var(--ff-disp);font-size:20px;letter-spacing:2px;color:var(--teal);margin-bottom:6px">🚀 CLIENT ONBOARDINGS</div>' +
        '<div style="font-size:12.5px;color:var(--muted);margin-bottom:16px;line-height:1.6">Every onboarding you\'ve started from the pipeline. <b>Invited</b> = sent, not opened. <b>Opened</b> = they started it. <b>Submitted</b> = done (their answers are on the client record).</div>' +
        '<div id="gl-ob-list" style="font-size:13px;color:#9aa7bd">Loading…</div>' +
        '<div style="display:flex;justify-content:flex-end;margin-top:16px"><button onclick="document.getElementById(\'gl-onboardings-modal\').remove()" style="padding:11px 20px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:8px;color:var(--muted);cursor:pointer">Close</button></div>' +
      '</div>';
    document.body.appendChild(ov);
    var list = ov.querySelector('#gl-ob-list');
    if(!sb()){ list.textContent = 'Supabase not ready.'; return; }
    try {
      var r = await sb().from('onboarding')
        .select('id, client_id, token, status, contact_email, created_at, submitted_at')
        .order('created_at', { ascending: false }).limit(100);
      if(r.error) throw r.error;
      var rows = r.data || [];
      if(!rows.length){ list.innerHTML = '<div style="padding:16px 0;color:var(--muted)">No onboardings yet. Start one from a pipeline lead with 🚀 Convert to Client &amp; Onboard.</div>'; return; }
      var names = {};
      var ids = rows.map(function(x){ return x.client_id; }).filter(Boolean);
      if(ids.length){ var cr = await sb().from('clients').select('id,name').in('id', ids); (cr.data||[]).forEach(function(c){ names[c.id] = c.name; }); }
      var badge = function(s){
        var map = { invited:['#f5c842','rgba(245,200,66,.12)','Invited'], started:['#6b9fff','rgba(26,111,255,.15)','Opened'], submitted:['#5fcf9e','rgba(95,207,158,.14)','Submitted'], approved:['#5fcf9e','rgba(95,207,158,.14)','Approved'] };
        var m = map[s] || ['#9aa7bd','rgba(255,255,255,.06)', s];
        return '<span style="font-size:10.5px;font-weight:700;letter-spacing:.5px;color:'+m[0]+';background:'+m[1]+';border-radius:20px;padding:3px 10px">'+m[2]+'</span>';
      };
      list.innerHTML = rows.map(function(x){
        var nm = esc(names[x.client_id] || x.contact_email || '(unknown)');
        var when = x.created_at ? new Date(x.created_at).toLocaleDateString() : '';
        var copyBtn = (x.status === 'invited' || x.status === 'started')
          ? '<button data-link="'+esc(onboardLink(x.token))+'" class="gl-ob-copy" style="font-size:11px;padding:4px 10px;background:rgba(0,229,192,.1);color:var(--teal);border:1px solid rgba(0,229,192,.3);border-radius:6px;cursor:pointer">Copy link</button>'
          : '';
        return '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px 0;border-bottom:1px solid rgba(255,255,255,.06)">' +
            '<div><div style="color:#eef4ff;font-size:13.5px;font-weight:600">'+nm+'</div><div style="font-size:11px;color:var(--muted)">'+when+'</div></div>' +
            '<div style="display:flex;align-items:center;gap:8px">'+badge(x.status)+copyBtn+'</div>' +
          '</div>';
      }).join('');
      list.querySelectorAll('.gl-ob-copy').forEach(function(b){
        b.addEventListener('click', function(){
          var lk = b.getAttribute('data-link');
          navigator.clipboard.writeText(lk).then(function(){ b.textContent='✓ Copied'; setTimeout(function(){ b.textContent='Copy link'; }, 1500); })
            .catch(function(){ prompt('Copy this onboarding link:', lk); });
        });
      });
    } catch(e){
      list.innerHTML = '<div style="color:#ff8579;padding:12px 0">Could not load onboardings: ' + esc(e.message || String(e)) + '</div>';
    }
  };

  console.log('[GL] onboarding module loaded');
}());
