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
      // clients.status is constrained to lead/active/inactive — a converted
      // lead is an active client. The onboarding stage lives in the separate,
      // unconstrained onboarding_status column, NOT here.
      var ins = await sb().from('clients').insert([{
        name: company, contact_name: contact, email: email, phone: d.phone || null,
        city: d.city || null, state: d.state || null,
        service: d.service || null, status: 'active',
        lead_source: d.leadSource || null, notes: d.notes || null,
        initials: initials, onboarding_status: 'invited'
      }]).select('id').single();
      if(ins.error) throw new Error('client insert: ' + ins.error.message);
      var clientId = ins.data.id;

      // 1b) Carry the deal's documents over to the new client, and smart-file the
      //     ones with a dedicated home so they land where staff expect them:
      //     the Process Authority letter fills the client's PA-letter compliance
      //     slot, and label artwork becomes SKU entries. NDAs, formulas and
      //     anything else stay linked to the client's Documents card. A failure
      //     here must not sink the whole conversion — the client is already made.
      try {
        var realDealId = (d.id && !String(d.id).startsWith('tmp_')) ? d.id : null;
        if(realDealId){
          var dd = await sb().from('deal_documents').select('*').eq('deal_id', realDealId);
          var docs = (dd.data) || [];
          if(docs.length){
            await sb().from('deal_documents').update({ client_id: clientId }).eq('deal_id', realDealId);

            var paDocs = docs.filter(function(x){ return x.doc_type === 'Process Authority Letter' && x.file_path; })
              .sort(function(a, b){ return new Date(b.created_at) - new Date(a.created_at); });
            if(paDocs.length){
              await sb().from('clients')
                .update({ pa_letter_file_path: paDocs[0].file_path, pa_letter_on_file: true })
                .eq('id', clientId);
            }

            var labels = docs.filter(function(x){ return x.doc_type === 'Label / Artwork' && x.file_path; });
            if(labels.length){
              var uid = (window.currentUser && window.currentUser.id) || null;
              await sb().from('client_artwork').insert(labels.map(function(l){
                return { client_id: clientId, sku_name: l.name || 'Label', description: l.notes || null,
                         file_path: l.file_path, file_type: l.file_type || null,
                         status: 'submitted', created_by: uid };
              }));
            }
          }
        }
      } catch(docErr){ console.warn('[onboarding] document carry-over failed', docErr); }

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
      var emailOk = await sendOnboardEmail(email, contact, company, link);

      // 4) No separate portal-invite email: the client creates their login
      //    (email + a password meeting the complexity policy) at the end of the
      //    onboarding form itself, via the onboarding-set-password function.
      //    Staff can still invite a login manually from the client detail page.

      // 5) Refresh local state so the new client shows up without a reload.
      try { if(typeof window.loadSupabaseData === 'function') await window.loadSupabaseData(); } catch(e){}

      if(typeof window.glEndBusy === 'function') window.glEndBusy();
      var linkNote = emailOk
        ? 'An onboarding email was sent to ' + email + '. They\'ll complete their details and create their portal login (email + password) on the form.'
        : '⚠ The client was created but the email failed to send. Copy this onboarding link to them manually:\n\n' + link;
      alert('✓ ' + company + ' is now a client.\n\n' + linkNote + '\n\nYou\'ll get a WhatsApp when they finish onboarding.');
      if(typeof window.glAudit === 'function') window.glAudit('lead_converted', clientId, { company: company, email: email });
    } catch(e){
      if(typeof window.glEndBusy === 'function') window.glEndBusy();
      console.error('[onboarding] convert failed', e);
      alert('✗ Convert failed: ' + (e.message || e) + '\n\nNothing was sent. Check the browser console and try again.');
    }
  };

  // ── Compose + send the branded onboarding email ──
  // Shared by the pipeline convert flow and the client-detail Send/Resend
  // button so the client always gets the identical, tested email.
  async function sendOnboardEmail(email, contactName, company, link){
    if(typeof window.sendMailgunEmail !== 'function') return false;
    var firstName = (String(contactName || '').split(' ')[0]) || 'there';
    var subject = 'Welcome to Good Liquid Bev Co — let\'s get you set up';
    var body = 'Hi ' + firstName + ',\n\n'
      + 'Great news, we\'re excited to start working with ' + company + '. '
      + 'To set up your account and get your project moving, please complete a short onboarding form. '
      + 'We\'ve already filled in what we have, and at the end you\'ll create your client-portal login '
      + '(you\'ll sign in with this email). It should only take a few minutes:\n\n'
      + link + '\n\n'
      + 'Once you submit it, I\'ll be in touch about next steps and your production schedule.\n\n'
      + 'Thanks,\nMike\nGood Liquid Bev Co\n(803) 493-5065';
    return await window.sendMailgunEmail(email, subject, body, {
      html: '<div style="font-family:Arial,sans-serif;color:#1a1a1a;line-height:1.7;max-width:600px;margin:0 auto">'
        + '<div style="border-top:3px solid #00e5c0;padding:22px 26px">'
        + '<div style="font-size:19px;font-weight:900;color:#00b89a;letter-spacing:2px;margin-bottom:12px">GOOD LIQUID BEV CO</div>'
        + '<p>Hi ' + esc(firstName) + ',</p>'
        + '<p>Great news — we\'re excited to start working with ' + esc(company) + '. To set up your account and get your project moving, please complete a short onboarding form. We\'ve already filled in what we have, and at the end you\'ll create your client-portal login (you\'ll sign in with this email). It should only take a few minutes:</p>'
        + '<p style="text-align:center;margin:26px 0"><a href="' + link + '" style="background:#00e5c0;color:#04231d;text-decoration:none;font-weight:800;padding:13px 26px;border-radius:8px;display:inline-block">Complete your onboarding →</a></p>'
        + '<p>Once you submit it, I\'ll be in touch about next steps and your production schedule.</p>'
        + '<p>Thanks,<br>Mike<br>Good Liquid Bev Co · (803) 493-5065</p>'
        + '</div></div>'
    });
  }

  // ── Client detail: ONBOARDING section (status + send / copy link) ──
  // The pipeline convert flow emails the link automatically, but until now
  // there was no way to send or re-send it from the client itself — the only
  // entry point was the Quick Actions onboardings board.
  async function latestOnboarding(clientId){
    var r = await sb().from('onboarding')
      .select('id, token, status, created_at, submitted_at')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false }).limit(1);
    if(r.error) throw new Error(r.error.message);
    return (r.data && r.data[0]) || null;
  }

  // Reuse the open invite when there is one; otherwise mint a fresh
  // token-secured onboarding row via the staff-gated RPC.
  async function ensureOnboarding(clientId, client){
    var ob = await latestOnboarding(clientId);
    if(ob && ob.status !== 'submitted' && ob.status !== 'approved') return ob;
    if(ob && !confirm('This client already submitted their onboarding. Create a fresh link anyway?\n\nTheir portal login keeps working either way.')) return null;
    var prefill = {
      company: client.name || '', name: client.contact_name || '',
      email: client.email || '', phone: client.phone || '',
      city: client.city || '', state: client.state || '', service: client.service || ''
    };
    var cr = await sb().rpc('gl_onboarding_create', { p_client_id: clientId, p_prefill: prefill, p_deal_id: null });
    if(cr.error) throw new Error(cr.error.message);
    if(!cr.data || cr.data.ok === false) throw new Error((cr.data && cr.data.error) || 'could not create the onboarding');
    var su = await sb().from('clients').update({ onboarding_status: 'invited' }).eq('id', clientId).select();
    if(su.error) throw new Error(su.error.message);
    if(Array.isArray(su.data) && su.data.length === 0) throw new Error('the client status could not be set to invited (0 rows updated)');
    return { id: cr.data.id, token: cr.data.token, status: 'invited' };
  }

  async function fetchClientRow(clientId){
    var r = await sb().from('clients').select('name, contact_name, email, phone, city, state, service').eq('id', clientId).maybeSingle();
    if(r.error) throw new Error(r.error.message);
    if(!r.data) throw new Error('client not found');
    return r.data;
  }

  window.glSendOnboardingLink = async function(clientId){
    if(!sb()){ alert('Supabase not ready.'); return; }
    try {
      var client = await fetchClientRow(clientId);
      if(!client.email){ alert('This client has no email address — add one first (✏️ Edit).'); return; }
      var ob = await ensureOnboarding(clientId, client);
      if(!ob) return;
      var link = onboardLink(ob.token);
      var okSend = await sendOnboardEmail(client.email, client.contact_name, client.name, link);
      if(okSend){
        alert('✓ Onboarding email sent to ' + client.email + '.');
        if(typeof window.glAudit === 'function') window.glAudit('onboarding_link_sent', clientId, { email: client.email });
      } else {
        prompt('The email could not be sent automatically. Copy the onboarding link and send it yourself:', link);
      }
      refreshObStatus(clientId);
    } catch(e){ alert('Could not send the onboarding link: ' + (e.message || e)); }
  };

  window.glCopyOnboardingLink = async function(clientId){
    if(!sb()){ alert('Supabase not ready.'); return; }
    try {
      var client = await fetchClientRow(clientId);
      var ob = await ensureOnboarding(clientId, client);
      if(!ob) return;
      var link = onboardLink(ob.token);
      try { await navigator.clipboard.writeText(link); alert('✓ Onboarding link copied to your clipboard.'); }
      catch(err){ prompt('Copy this onboarding link:', link); }
      refreshObStatus(clientId);
    } catch(e){ alert('Could not get the onboarding link: ' + (e.message || e)); }
  };

  // ── Clients page: top-bar "Send Onboarding" client picker ──
  // Pick any existing client and email them the onboarding link (company
  // details + product questionnaire). Mirrors the Invite Customer Login picker;
  // the actual send reuses glSendOnboardingLink so behaviour is identical to the
  // client-card button.
  window.glOpenOnboardPicker = function(preselectedClientId){
    var existing = document.getElementById('gl-onboard-picker'); if(existing) existing.remove();
    var clients = (window.clients && Array.isArray(window.clients)) ? window.clients.slice() : [];
    clients.sort(function(a,b){ return (a.name||'').localeCompare(b.name||''); });
    var ov = document.createElement('div');
    ov.id = 'gl-onboard-picker';
    ov.setAttribute('style','position:fixed;inset:0;z-index:9500;background:rgba(6,13,26,.92);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:20px');
    var opts = ['<option value="">— Pick a client —</option>'].concat(clients.map(function(c){
      var sel = (c.id === preselectedClientId) ? ' selected' : '';
      return '<option value="' + esc(c.id) + '"' + sel + '>' + esc(c.name || '(no name)') + (c.email ? '' : ' — ⚠ no email') + '</option>';
    })).join('');
    var SEL = 'width:100%;padding:11px 12px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.12);border-radius:8px;color:#eef4ff;font-size:14px;box-sizing:border-box';
    ov.innerHTML =
      '<div style="background:#142238;border:1px solid rgba(0,229,192,.35);border-radius:14px;padding:28px;width:100%;max-width:460px">' +
        '<div style="font-family:var(--ff-disp);font-size:18px;letter-spacing:2px;color:var(--teal);margin-bottom:6px">SEND ONBOARDING</div>' +
        '<div style="font-size:12px;color:#9ca3af;margin-bottom:18px;line-height:1.5">Emails the client a link to the onboarding form — company details plus the product questionnaire — and creates their portal login at the end. We pre-fill everything we already have. Sends to the client\'s email on file.</div>' +
        '<div style="font-size:11px;letter-spacing:1.5px;color:#6b87ad;margin-bottom:6px">WHICH CLIENT?</div>' +
        '<select id="gl-op-client" style="' + SEL + '">' + opts + '</select>' +
        '<div id="gl-op-err" style="display:none;color:#ff8579;font-size:12px;margin:10px 0 0"></div>' +
        '<div style="display:flex;gap:10px;justify-content:flex-end;margin-top:18px">' +
          '<button id="gl-op-cancel" class="cbtn" style="background:rgba(255,255,255,.06)">Cancel</button>' +
          '<button id="gl-op-send" class="cbtn pri">📨 Send onboarding email</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);
    ov.addEventListener('click', function(e){ if(e.target === ov) ov.remove(); });
    var selEl = ov.querySelector('#gl-op-client'), errEl = ov.querySelector('#gl-op-err'), sendBtn = ov.querySelector('#gl-op-send');
    ov.querySelector('#gl-op-cancel').onclick = function(){ ov.remove(); };
    setTimeout(function(){ selEl.focus(); }, 30);
    sendBtn.onclick = async function(){
      errEl.style.display = 'none';
      var cid = selEl.value;
      if(!cid){ errEl.style.display='block'; errEl.textContent='Pick a client.'; return; }
      sendBtn.disabled = true; var orig = sendBtn.textContent; sendBtn.textContent = 'Sending…';
      try { await window.glSendOnboardingLink(cid); ov.remove(); }
      catch(e){ errEl.style.display='block'; errEl.textContent='Failed: ' + ((e && e.message) || 'unknown'); sendBtn.disabled=false; sendBtn.textContent=orig; }
    };
  };

  var OB_LABEL = {
    invited:   ['#f5c842', 'Invited — link sent, not opened yet'],
    started:   ['#6b9fff', 'Opened — they started the form'],
    submitted: ['#5fcf9e', 'Submitted ✓ — their answers are on this record'],
    approved:  ['#5fcf9e', 'Approved ✓']
  };
  async function refreshObStatus(clientId){
    var el = document.getElementById('gl-cd-ob-status-' + clientId);
    if(!el) return;
    try {
      var ob = await latestOnboarding(clientId);
      if(!ob){ el.innerHTML = '<span style="color:var(--muted)">Not started — no onboarding link sent yet.</span>'; return; }
      var m = OB_LABEL[ob.status] || ['#9aa7bd', ob.status || 'unknown'];
      var when = (ob.status === 'submitted' && ob.submitted_at) ? ob.submitted_at : ob.created_at;
      var whenTxt = when ? new Date(when).toLocaleDateString() : '';
      el.innerHTML = '<span style="color:' + m[0] + ';font-weight:700">' + esc(m[1]) + '</span>'
        + (whenTxt ? ' <span style="color:var(--muted);font-size:11px">(' + esc(whenTxt) + ')</span>' : '');
    } catch(e){ el.innerHTML = '<span style="color:var(--muted)">Status unavailable.</span>'; }
  }

  // Section HTML consumed by glClientInfoSections (crm-client-detail.js).
  // The popup builder is synchronous, so this renders instantly with a
  // placeholder and fills the live status as soon as the element mounts.
  window.glClientOnboardingSection = function(c){
    if(!c || !c.id) return '';
    var cid = String(c.id).replace(/[^a-zA-Z0-9-]/g, '');
    var tries = 0;
    (function waitForMount(){
      if(document.getElementById('gl-cd-ob-status-' + cid)) return refreshObStatus(cid);
      if(++tries < 20) setTimeout(waitForMount, 100);
    })();
    return '<div style="margin-bottom:20px">' +
      '<div style="font-size:10px;letter-spacing:2px;color:var(--muted);margin-bottom:10px">ONBOARDING</div>' +
      '<div style="background:rgba(255,255,255,.04);border-radius:10px;padding:14px;font-size:13px;line-height:1.9">' +
        '<div id="gl-cd-ob-status-' + cid + '" style="margin-bottom:10px;color:var(--muted)">Checking status…</div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
          '<button onclick="window.glSendOnboardingLink(\'' + cid + '\')" style="padding:8px 14px;background:rgba(0,229,192,.1);border:1px solid rgba(0,229,192,.3);border-radius:8px;color:var(--teal);font-weight:700;font-size:12px;cursor:pointer">📨 Send / resend onboarding email</button>' +
          '<button onclick="window.glCopyOnboardingLink(\'' + cid + '\')" style="padding:8px 14px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);border-radius:8px;color:var(--white);font-weight:700;font-size:12px;cursor:pointer">🔗 Copy link</button>' +
        '</div>' +
      '</div>' +
    '</div>';
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
