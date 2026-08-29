/* ============================================================
   client-detail.js — shared client-detail info sections
   ============================================================
   Both client-detail popups (openClientDetail and viewClientEnhanced in
   index.html) previously hid any field that was empty, so a client with
   sparse data showed a near-empty card and the only way to see every field
   was to open Edit. This module renders ONE comprehensive, always-visible
   block used by both popups: every field shows its value or a muted "—", and
   every uploaded compliance document gets an explicit "View" link (signed
   URL). If a document is marked "on file" but no file was actually stored
   (a silent upload failure), it says so plainly instead of pretending.

   Exposes:
     window.glClientInfoSections(c) -> HTML string (Contact, Business,
        Receiving/Logistics, Product types, Compliance documents)
     window.glOpenClientDoc(path)   -> opens a signed URL for a stored doc
   ============================================================ */
(function(){
  'use strict';

  function esc(s){
    return String(s == null ? '' : s).replace(/[<>&"]/g, function(ch){
      return { '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;' }[ch];
    });
  }
  var MUTED = 'var(--muted)', WHITE = 'var(--white)', TEAL = 'var(--teal)';

  // Open a stored compliance document via a short-lived signed URL.
  window.glOpenClientDoc = async function(path){
    if(!path){ return; }
    if(!window.supa || !window.supa.storage){ alert('Storage not ready.'); return; }
    try {
      var r = await window.supa.storage.from('client-docs').createSignedUrl(path, 300);
      if(r && r.data && r.data.signedUrl){ window.open(r.data.signedUrl, '_blank'); }
      else { alert('Could not open the file — it may not be stored. Try re-uploading it from Edit.'); }
    } catch(e){ alert('Could not open the file: ' + (e && e.message || e)); }
  };

  // Download a stored compliance document (signed URL with the download flag,
  // so the browser saves the file instead of opening it in a tab).
  window.glDownloadClientDoc = async function(path){
    if(!path){ return; }
    if(!window.supa || !window.supa.storage){ alert('Storage not ready.'); return; }
    try {
      var r = await window.supa.storage.from('client-docs').createSignedUrl(path, 300, { download: true });
      if(r && r.data && r.data.signedUrl){
        var a = document.createElement('a'); a.href = r.data.signedUrl; a.download = '';
        document.body.appendChild(a); a.click(); a.remove();
      } else { alert('Could not download — the file may not be stored. Try re-uploading it from Edit.'); }
    } catch(e){ alert('Download failed: ' + (e && e.message || e)); }
  };

  function card(inner){
    return '<div style="background:rgba(255,255,255,.04);border-radius:10px;padding:14px;font-size:13px;color:'+WHITE+';line-height:1.9">' + inner + '</div>';
  }
  function head(t){
    return '<div style="font-size:10px;letter-spacing:2px;color:'+MUTED+';margin-bottom:10px">' + esc(t) + '</div>';
  }
  function section(title, inner){
    return '<div style="margin-bottom:20px">' + head(title) + card(inner) + '</div>';
  }
  // "Label: value" — value or a muted em dash when blank.
  function line(label, value, isHtml){
    var v = (value === 0 || value) ? (isHtml ? value : esc(value)) : '<span style="color:'+MUTED+'">—</span>';
    return '<div><span style="color:'+MUTED+'">' + esc(label) + ':</span> ' + v + '</div>';
  }
  function pill(txt, bg, fg, br){
    return '<span style="padding:3px 9px;border-radius:20px;font-size:11px;font-weight:700;background:'+bg+';color:'+fg+';border:1px solid '+br+'">' + txt + '</span>';
  }
  function viewBtn(path){
    var p = esc(String(path).replace(/'/g,''));
    return ' <a href="#" onclick="event.preventDefault();window.glOpenClientDoc(\'' + p + '\')" style="color:'+TEAL+';font-weight:700">📄 View</a>'
         + ' <a href="#" onclick="event.preventDefault();window.glDownloadClientDoc(\'' + p + '\')" style="color:'+TEAL+';font-weight:700">⬇ Download</a>';
  }

  var CONTACT_TYPE = {owner:'Owner',executive:'Executive',purchasing:'Purchasing',freight:'Freight / Logistics',sales:'Sales',other:'Other'};
  var PAY_METHOD   = {ach:'ACH',wire:'Wire',credit_card:'Credit card (3% fee)',check:'Check'};
  var LEAD_SRC     = {google:'Google search',instagram:'Instagram',linkedin:'LinkedIn',trade_show:'Trade show',industry_pub:'Industry publication',customer_referral:'Customer referral',word_of_mouth:'Word of mouth',cold_outreach:'Cold outreach',returning:'Returning customer',other:'Other'};
  var COMM_PREF    = {email:'✉️ Email', sms:'📱 SMS', whatsapp:'🟢 WhatsApp', wechat:'💬 WeChat'};
  var PRODUCT      = {seltzer:'🥤 Seltzer', soda:'🥤 Soda', kombucha:'🍵 Kombucha', coldbrew:'☕ Cold Brew', juice:'🧃 Juice', rtd:'🍸 RTD Cocktail', energy:'⚡ Energy', mocktail:'🍹 Mocktail', sparkling:'💧 Sparkling Water', sports:'🏃 Sport Drinks', other:'📦 Other'};
  var DOCK         = {mon:'Mon',tue:'Tue',wed:'Wed',thu:'Thu',fri:'Fri',sat:'Sat',sun:'Sun'};

  function addr(street, city, state, zip){
    var parts = [street, [city, state].filter(Boolean).join(', '), zip].filter(Boolean);
    return parts.length ? parts.join(' · ') : '';
  }
  // Expiry note: colored when expiring soon / expired.
  function expiry(dateStr){
    if(!dateStr) return '';
    var today = new Date(); today.setHours(0,0,0,0);
    var exp = new Date(dateStr);
    if(isNaN(exp)) return ' <span style="color:'+MUTED+'">(expires '+esc(dateStr)+')</span>';
    var days = Math.round((exp - today) / 86400000);
    if(days < 0)      return ' <span style="color:#ff8579;font-weight:700">· EXPIRED ' + (-days) + 'd ago</span>';
    if(days < 30)     return ' <span style="color:#f5c842;font-weight:700">· expires in ' + days + 'd</span>';
    return ' <span style="color:'+MUTED+'">· expires ' + esc(dateStr) + '</span>';
  }

  // One compliance document row. supportsFile=true means this doc type can
  // carry an uploaded file (W-9, tax exemption, PA letter); COI does not.
  function docRow(label, onFile, filePath, supportsFile, expiresStr, extra){
    if(onFile){
      var tail = (extra ? ' <span style="color:'+MUTED+'">' + esc(extra) + '</span>' : '') + expiry(expiresStr);
      if(filePath) return '<div>' + pill('📄 ' + esc(label) + ' · on file', 'rgba(29,158,117,.15)', '#5fcf9e', 'rgba(29,158,117,.35)') + tail + viewBtn(filePath) + '</div>';
      if(supportsFile) return '<div>' + pill('📄 ' + esc(label) + ' · on file', 'rgba(245,200,66,.15)', '#f5c842', 'rgba(245,200,66,.35)') + tail + ' <span style="color:#f5c842">⚠ no stored file — re-upload from Edit to attach</span></div>';
      return '<div>' + pill('📄 ' + esc(label) + ' · on file', 'rgba(29,158,117,.15)', '#5fcf9e', 'rgba(29,158,117,.35)') + tail + '</div>';
    }
    return '<div>' + pill('📄 ' + esc(label), 'rgba(255,255,255,.05)', MUTED, 'rgba(255,255,255,.12)') + ' <span style="color:'+MUTED+'">not on file</span></div>';
  }

  window.glClientInfoSections = function(c){
    c = c || {};
    var out = '';

    // ── CONTACT ──
    var extraEmails = (Array.isArray(c.additionalEmails) ? c.additionalEmails : [])
      .map(function(e){ return e && (e.email || e.address || e); }).filter(Boolean);
    var contactInner = '';
    contactInner += '<div>👤 ' + (c.contact ? esc(c.contact) : '<span style="color:'+MUTED+'">—</span>') +
      (c.contactType ? ' <span style="color:'+MUTED+';font-size:11px">(' + esc(CONTACT_TYPE[c.contactType] || c.contactType) + ')</span>' : '') + '</div>';
    contactInner += line('Email', c.email ? '<a href="mailto:'+esc(c.email)+'" style="color:'+TEAL+'">'+esc(c.email)+'</a>' : '', true);
    if(extraEmails.length) contactInner += line('Also', extraEmails.map(esc).join(', '), true);
    contactInner += line('Phone', c.phone ? '<a href="tel:'+esc(c.phone)+'" style="color:'+TEAL+'">'+esc(c.phone)+'</a>' : '', true);
    contactInner += line('Address', addr(c.street, c.city, c.state, c.zip));
    if(c.billingSame === false) contactInner += line('Billing', addr(c.billingStreet, c.billingCity, c.billingState, c.billingZip));
    if(c.shippingSame === false) contactInner += line('Shipping', addr(c.shippingStreet, c.shippingCity, c.shippingState, c.shippingZip));
    var prefs = (Array.isArray(c.commPrefs) ? c.commPrefs : []).map(function(p){ return COMM_PREF[p] || p; });
    contactInner += line('Prefers', prefs.length ? prefs.join(' · ') : '');
    contactInner += line('Overdue SMS reminders', c.notify_overdue_sms ? '<span style="color:#5fcf9e">On</span>' : '<span style="color:'+MUTED+'">Off</span>', true);
    out += section('CONTACT', contactInner);

    // ── BUSINESS INFO ──
    var owner = c.accountOwner ? (((window.users||[]).find(function(u){return u.id===c.accountOwner;})||{}).name || c.accountOwner) : '';
    var web = c.website ? '<a href="'+esc(c.website.indexOf('http')===0?c.website:'https://'+c.website)+'" target="_blank" rel="noopener" style="color:'+TEAL+'">'+esc(c.website)+'</a>' : '';
    var biz = '';
    biz += line('Legal name', c.legalName);
    biz += line('EIN', c.ein ? '<code style="font-family:var(--ff-mono);font-size:12px">'+esc(c.ein)+'</code>' : '', true);
    biz += line('Website', web, true);
    biz += line('Terms', c.paymentTerms);
    biz += line('Pays via', c.paymentMethod ? (PAY_METHOD[c.paymentMethod] || c.paymentMethod) : '');
    biz += line('Found us via', c.leadSource ? (LEAD_SRC[c.leadSource] || c.leadSource) : '');
    biz += line('Owner', owner);
    out += section('BUSINESS INFO', biz);

    // ── RECEIVING / LOGISTICS ──
    var dockDays = (Array.isArray(c.dockDays) ? c.dockDays : []).map(function(d){ return DOCK[d] || d; });
    var recv = '';
    recv += line('Lift gate', c.liftGate ? 'required' : '<span style="color:'+MUTED+'">not required</span>', true);
    recv += line('Dock days', dockDays.length ? dockDays.join(', ') : '');
    recv += line('Hours', c.dockHours);
    out += section('RECEIVING / LOGISTICS', recv);

    // ── PRODUCT TYPES ──
    var pts = (Array.isArray(c.productTypes) ? c.productTypes : []);
    var ptInner = pts.length
      ? '<div style="display:flex;flex-wrap:wrap;gap:6px">' + pts.map(function(p){
          return '<span style="padding:4px 11px;border-radius:20px;font-size:12px;font-weight:600;background:rgba(168,85,247,.12);color:#c4a4f8;border:1px solid rgba(168,85,247,.3)">' + esc(PRODUCT[p] || p) + '</span>';
        }).join('') + '</div>'
      : '<span style="color:'+MUTED+'">None specified</span>';
    out += section('PRODUCT TYPES', ptInner);

    // ── FORMULATION ── (only when it happened; module owns the markup)
    if(typeof window.glFormulationSummary === 'function'){
      var fSum = window.glFormulationSummary(c);
      if(fSum) out += section('FORMULATION', fSum);
    }

    // ── COMPLIANCE DOCUMENTS ──
    var docs = '';
    docs += docRow('Certificate of Insurance', c.coiOnFile, '', false, c.coiExpires, '');
    docs += docRow('W-9', c.w9OnFile, c.w9FilePath, true, '', c.w9Received ? ('received ' + c.w9Received) : '');
    docs += docRow('Sales-tax exemption', c.taxExempt, c.taxExemptFilePath, true, '', c.taxExemptState ? ('(' + c.taxExemptState + ')') : '');
    docs += docRow('Process Authority letter', c.paLetterOnFile, c.paLetterFilePath, true, c.paLetterExpires, '');
    out += section('COMPLIANCE DOCUMENTS', '<div style="display:flex;flex-direction:column;gap:8px">' + docs + '</div>');

    // ── ONBOARDING ── (rendered by onboarding.js; guarded so a
    // load-order change can't take down the whole popup)
    if(typeof window.glClientOnboardingSection === 'function'){
      out += window.glClientOnboardingSection(c);
    }

    return out;
  };

  console.log('[GL] client-detail info sections loaded');
}());
