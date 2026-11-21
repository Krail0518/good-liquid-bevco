/* ============================================================
   agreements.js — generate NDAs and manufacturing agreements
   ============================================================
   Admin-only. Opened from three places:
     • Pipeline deal panel   → window.glAgreementsFromDeal(dealId)
     • Clients list row      → window.glAgreementsForClient(clientId)
     • Edit Client modal     → window.glOpenAgreements({ clientId })
   and the template editor from the AI Tools / admin tools list:
     • window.glOpenAgreementTemplates()

   Flow: pick NDA or Manufacturing Agreement → fields are pre-filled from the
   deal / client record (anything missing is flagged) → the template is
   filled into an editable text → Download PDF, Save to the record's
   Documents card, or Send for e-signature (built in: agreement-sign edge
   function + public sign.html page). Every saved or
   sent agreement is logged in public.agreements with its exact text, so
   "what did we send them?" always has an answer. Signing happens on
   /sign.html through an emailed private link; the client signs first, then
   Good Liquid (if a GL signer email is set). When everyone has signed, the
   edge function files the signed PDF (with a signature certificate page)
   into Documents, marks the agreement signed and emails everyone a copy.

   Data (migration 20261007120000_agreements.sql, admin-only RLS):
     agreement_templates(kind, title, body)   — body is plain text:
         "# " title line, "## " section heading, blank line = new paragraph,
         {{placeholder}} = filled value, [[SIGNATURES]] = signature block.
     agreements(...)                          — the log.
   PDFs are filed in deal_documents (internal by default) in the client-docs
   bucket, same paths as deal-docs.js, so they appear in the existing
   Documents card on the deal / client.

   Cross-module dependencies (all read-only, all optional-guarded):
     window.supa, window.currentUser, window.deals, window.clients,
     window.ensureJsPdf (src/shared/password-change.js),
     window.glCheckedInsert (crm-index-core.js), window.glAudit,
     window.glOpenClientDoc / glDownloadClientDoc (client-detail.js),
     window.glRenderDealDocs (deal-docs.js), edge function 'agreement-sign'.

   No innerHTML anywhere in this file: every node is built with the h()
   helper below, so lead/client-typed text can never become markup.
   ============================================================ */
(function(){
  'use strict';

  var KINDS = {
    nda:           { label: 'Mutual NDA',              docType: 'NDA',   icon: '🔒' },
    manufacturing: { label: 'Manufacturing Agreement', docType: 'Manufacturing Agreement', icon: '🏭' },
    // Not offered in the generator's kind buttons: it is built from an
    // invoice by glOpenInvoiceSignoff() below. Listed here so the template
    // editor and the "On file" list label it.
    invoice_acceptance: { label: 'Invoice Acceptance', docType: 'Invoice Acceptance', icon: '🧾' }
  };
  var STATUS_STYLE = {
    draft:  { bg: 'rgba(255,255,255,.08)', fg: '#cfd9e6', label: 'Draft' },
    sent:   { bg: 'rgba(245,200,66,.15)',  fg: '#f5c842', label: 'Sent for signature' },
    signed: { bg: 'rgba(0,196,167,.15)',   fg: '#00c4a7', label: 'Signed' },
    declined: { bg: 'rgba(231,76,60,.12)', fg: '#ff8579', label: 'Declined' },
    void:   { bg: 'rgba(231,76,60,.12)',   fg: '#e74c3c', label: 'Void' }
  };
  var GL_DEFAULTS = {
    gl_legal_name: 'Good Liquid Bev Co',
    gl_address:    '2011 51st Ave E, Unit 100, Palmetto, FL 34221',
    gl_signer_title: 'Owner'
  };

  function sb(){ return window.supa || null; }
  function isAdmin(){ return !!(window.currentUser && window.currentUser.role === 'admin'); }
  function notify(title, msg, kind){
    if(typeof window.addNotification === 'function') window.addNotification(title, msg || '', kind || 'info');
  }
  function audit(action, target, meta){
    if(typeof window.glAudit === 'function') window.glAudit(action, target, meta || {});
  }

  /* ── DOM helper: h('div', {style:'…', text:'…', onclick:fn}, [children]) ── */
  function h(tag, attrs, kids){
    var el = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function(k){
      var v = attrs[k];
      if(v == null || v === false) return;
      if(k === 'text') el.textContent = String(v);
      else if(k === 'style') el.setAttribute('style', v);
      else if(k === 'value') el.value = v;
      else if(k.slice(0,2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : String(v));
    });
    (kids || []).forEach(function(c){
      if(c == null || c === false) return;
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return el;
  }
  function clear(el){ while(el && el.firstChild) el.removeChild(el.firstChild); }

  var S = {
    overlay: 'position:fixed;inset:0;z-index:960;background:rgba(6,13,26,.9);backdrop-filter:blur(8px);display:flex;align-items:flex-start;justify-content:center;padding:16px;overflow-y:auto',
    card:    'background:#0d1f35;border:1px solid rgba(26,111,255,.25);border-radius:16px;width:100%;max-width:980px;padding:24px;margin:auto;color:#fff',
    title:   'font-family:var(--ff-disp);font-size:19px;letter-spacing:2.5px;color:#1a6fff',
    lbl:     'font-size:10px;letter-spacing:1.5px;color:#9aa7bd;margin-bottom:4px;display:block',
    inp:     'width:100%;box-sizing:border-box;padding:8px 10px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.12);border-radius:6px;color:#fff;font-size:13px;font-family:var(--ff-body)',
    inpMiss: 'width:100%;box-sizing:border-box;padding:8px 10px;background:rgba(245,200,66,.06);border:1px solid rgba(245,200,66,.6);border-radius:6px;color:#fff;font-size:13px;font-family:var(--ff-body)',
    btn:     'padding:9px 14px;border-radius:8px;font-weight:700;font-size:12.5px;cursor:pointer;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.05);color:#fff',
    btnPri:  'padding:9px 14px;border-radius:8px;font-weight:800;font-size:12.5px;cursor:pointer;border:none;background:#1a6fff;color:#fff',
    btnGo:   'padding:9px 14px;border-radius:8px;font-weight:800;font-size:12.5px;cursor:pointer;border:none;background:linear-gradient(135deg,#5fcf9e,#00c4a7);color:#04231d',
    section: 'background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.07);border-radius:10px;padding:14px;margin-bottom:14px'
  };

  /* ── Context: who is this agreement for? ───────────────────── */
  function findDeal(dealId){
    var all = window.deals || {};
    var hit = null;
    Object.keys(all).forEach(function(stage){
      (all[stage] || []).forEach(function(d){ if(d && d.id === dealId) hit = d; });
    });
    return hit;
  }
  function findClient(clientId){
    return (window.clients || []).find(function(c){ return c && c.id === clientId; }) || null;
  }
  function clientByName(name){
    var n = String(name || '').trim().toLowerCase();
    if(!n) return null;
    return (window.clients || []).find(function(c){ return c && String(c.name || '').trim().toLowerCase() === n; }) || null;
  }
  function joinAddr(street, city, state, zip){
    var line2 = [city, [state, zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    return [street, line2].filter(function(x){ return x && String(x).trim(); }).join(', ');
  }
  function clientAddress(c){
    if(!c) return '';
    if(c.billingSame === false && (c.billingStreet || c.billingCity)){
      return joinAddr(c.billingStreet, c.billingCity, c.billingState, c.billingZip);
    }
    return joinAddr(c.street, c.city, c.state, c.zip);
  }
  function todayLong(){
    return new Date().toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' });
  }

  // Resolve {clientId?, dealId?} into the record(s) and default field values.
  function buildContext(opts){
    var deal = opts.dealId ? findDeal(opts.dealId) : null;
    var client = opts.clientId ? findClient(opts.clientId) : null;
    if(!client && deal) client = clientByName(deal.co);
    var u = window.currentUser || {};
    var f = {
      effective_date:    todayLong(),
      gl_legal_name:     GL_DEFAULTS.gl_legal_name,
      gl_address:        GL_DEFAULTS.gl_address,
      gl_signer_name:    u.name || '',
      gl_signer_title:   GL_DEFAULTS.gl_signer_title,
      gl_signer_email:   u.email || '',
      client_legal_name: '',
      client_address:    '',
      client_signer_name:  '',
      client_signer_title: '',
      client_signer_email: '',
      term_years:        '1'
    };
    if(client){
      f.client_legal_name   = client.legalName || client.name || '';
      f.client_address      = clientAddress(client);
      f.client_signer_name  = client.contact || '';
      f.client_signer_email = client.email || '';
    }
    if(deal){
      if(!f.client_legal_name)   f.client_legal_name   = deal.co || deal.name || '';
      if(!f.client_address)      f.client_address      = joinAddr('', deal.city, deal.state, '');
      if(!f.client_signer_name)  f.client_signer_name  = deal.contactName || '';
      if(!f.client_signer_email) f.client_signer_email = deal.email || '';
    }
    return {
      deal: deal, client: client,
      dealId: deal && deal.id && !String(deal.id).startsWith('tmp_') ? deal.id : null,
      clientId: client ? client.id : null,
      partyLabel: (client && client.name) || (deal && (deal.co || deal.name)) || 'this account',
      fields: f
    };
  }

  /* ── Fields shown in the form, per kind ─────────────────────── */
  var FIELD_DEFS = [
    { key:'client_legal_name',   label:'CLIENT LEGAL NAME',        req:true },
    { key:'client_address',      label:'CLIENT ADDRESS',           req:true, wide:true },
    { key:'client_signer_name',  label:'CLIENT SIGNER NAME',       req:true },
    { key:'client_signer_title', label:'CLIENT SIGNER TITLE',      req:false },
    { key:'client_signer_email', label:'CLIENT SIGNER EMAIL',      req:false, hint:'Needed to send for e-signature' },
    { key:'effective_date',      label:'EFFECTIVE DATE',           req:true },
    { key:'term_years',          label:'INITIAL TERM (YEARS)',     req:true, only:'manufacturing' },
    { key:'gl_legal_name',       label:'GOOD LIQUID LEGAL NAME',   req:true },
    { key:'gl_address',          label:'GOOD LIQUID ADDRESS',      req:true, wide:true },
    { key:'gl_signer_name',      label:'GOOD LIQUID SIGNER',       req:true },
    { key:'gl_signer_title',     label:'GOOD LIQUID SIGNER TITLE', req:true },
    { key:'gl_signer_email',     label:'GOOD LIQUID SIGNER EMAIL', req:false, hint:'If set, you sign too (after the client)' }
  ];

  /* ── Template fill ──────────────────────────────────────────── */
  // The edge function stamps "By: ____" / "Date: ____" in block order:
  // Good Liquid then Company, or Company alone for an invoice acceptance
  // (stampSignatures in supabase/functions/agreement-sign). Keep in step.
  function signatureBlock(f, kind){
    function party(heading, name, signer, title){
      return [
        heading.toUpperCase(),
        name,
        '',
        'By: ______________________________',
        'Name: ' + (signer || ''),
        'Title: ' + (title || ''),
        'Date: ____________________________'
      ].join('\n');
    }
    var company = party(kind === 'invoice_acceptance' ? 'Customer' : 'Company', f.client_legal_name, f.client_signer_name, f.client_signer_title);
    if(kind === 'invoice_acceptance') return company;
    return party('Good Liquid', f.gl_legal_name, f.gl_signer_name, f.gl_signer_title) + '\n\n' + company;
  }
  function fillTemplate(body, f, kind){
    var missing = [];
    var out = String(body || '').replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, function(_, k){
      var v = f[k];
      if(v == null || String(v).trim() === ''){ missing.push(k); return '[' + k.toUpperCase() + ']'; }
      return String(v).trim();
    });
    out = out.replace('[[SIGNATURES]]', signatureBlock(f, kind));
    return { text: out, missing: missing };
  }

  /* ── Render plain-text agreement into a preview node ────────── */
  function renderPreview(mount, text){
    clear(mount);
    var blocks = String(text || '').replace(/\r\n/g, '\n').split(/\n{2,}/);
    blocks.forEach(function(b){
      var t = b.replace(/\s+$/, '');
      if(!t) return;
      if(/^# /.test(t)){
        mount.appendChild(h('div', { style:'font-weight:800;font-size:15px;text-align:center;margin:4px 0 14px;letter-spacing:.5px', text:t.slice(2) }));
      } else if(/^## /.test(t)){
        mount.appendChild(h('div', { style:'font-weight:800;font-size:12.5px;margin:12px 0 4px', text:t.slice(3) }));
      } else {
        mount.appendChild(h('div', { style:'font-size:12px;line-height:1.6;margin-bottom:8px;white-space:pre-wrap', text:t }));
      }
    });
  }

  /* ── PDF (native text via jsPDF) ────────────────────────────── */
  async function buildPdf(text, docTitle, footerNote){
    if(typeof window.ensureJsPdf !== 'function') throw new Error('PDF library loader is missing');
    var JsPDF = await window.ensureJsPdf();
    var doc = new JsPDF({ unit:'pt', format:'letter' });
    var W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
    var M = 64, maxW = W - M*2, y = M;
    doc.setProperties({ title: docTitle, creator: 'Good Liquid Bev Co CRM' });
    function ensure(space){ if(y + space > H - M){ doc.addPage(); y = M; } }
    function lines(str, font, size, style, gapAfter, align){
      doc.setFont(font, style); doc.setFontSize(size);
      var lh = size * 1.38;
      String(str).split('\n').forEach(function(raw){
        var wrapped = raw === '' ? [''] : doc.splitTextToSize(raw, maxW);
        wrapped.forEach(function(ln){
          ensure(lh);
          if(align === 'center') doc.text(ln, W/2, y, { align:'center' });
          else doc.text(ln, M, y);
          y += lh;
        });
      });
      y += gapAfter;
    }
    String(text || '').replace(/\r\n/g, '\n').split(/\n{2,}/).forEach(function(b){
      var t = b.replace(/\s+$/, '');
      if(!t) return;
      if(/^# /.test(t))       lines(t.slice(2), 'times', 14, 'bold', 10, 'center');
      else if(/^## /.test(t)){ ensure(40); lines(t.slice(3), 'times', 11.5, 'bold', 2); }
      else                    lines(t, 'times', 11, 'normal', 7);
    });
    var n = doc.getNumberOfPages();
    for(var i = 1; i <= n; i++){
      doc.setPage(i); doc.setFont('times', 'normal'); doc.setFontSize(8.5); doc.setTextColor(120);
      doc.text((footerNote ? footerNote + '   ·   ' : '') + 'Page ' + i + ' of ' + n, W/2, H - 30, { align:'center' });
      doc.setTextColor(0);
    }
    return doc.output('blob');
  }
  function downloadBlob(blob, name){
    var url = URL.createObjectURL(blob);
    var a = h('a', { href:url, download:name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function(){ URL.revokeObjectURL(url); }, 4000);
  }
  function safeFileName(s){ return String(s || 'agreement').replace(/[^A-Za-z0-9 ._-]+/g, '').trim().slice(0, 80) || 'agreement'; }

  /* ── Storage + document row (mirrors deal-docs.js paths) ────── */
  async function fileToDocuments(ctx, blob, name, docType, notes){
    var client = sb(); if(!client) return { ok:false, reason:'Not connected.' };
    var base = ctx.dealId ? ('deal/' + ctx.dealId) : (ctx.clientId + '/docs');
    var path = base + '/' + Date.now() + '_' + Math.random().toString(36).slice(2,7) + '.pdf';
    var up = await client.storage.from('client-docs').upload(path, blob, { cacheControl:'3600', upsert:false, contentType:'application/pdf' });
    if(up.error) return { ok:false, reason:'Upload failed: ' + (up.error.message || up.error.error || 'rejected') };
    var uploader = (window.currentUser && (window.currentUser.name || window.currentUser.email)) || 'Staff';
    var ins = await window.glCheckedInsert(function(s){
      return s.from('deal_documents').insert([{
        deal_id: ctx.dealId, client_id: ctx.clientId, doc_type: docType,
        name: name, notes: notes || null, file_path: path, file_type: 'pdf', uploaded_by: uploader
      }]).select('id').single();
    });
    if(!ins.ok) return { ok:false, reason:'Saved the file but could not list it in Documents: ' + ins.reason };
    return { ok:true, id: ins.row.id, path: path };
  }

  /* ── Edge function calls (agreement-sign) ───────────────────── */
  async function callSign(body){
    var client = sb(); if(!client) return { ok:false, reason:'Not connected.' };
    try {
      var r = await client.functions.invoke('agreement-sign', { body: body });
      if(r.error){
        var reason = r.error.message || 'Request failed';
        try {
          if(r.error.context && typeof r.error.context.json === 'function'){
            var j = await r.error.context.json();
            if(j && j.error) reason = j.error;
          }
        } catch(_){}
        return { ok:false, reason: reason };
      }
      if(r.data && r.data.error) return { ok:false, reason: r.data.error };
      return { ok:true, data: r.data || {} };
    } catch(e){
      return { ok:false, reason: (e && e.message) || String(e) };
    }
  }
  async function loadSigners(agreementId){
    var r = await sb().from('agreement_signers')
      .select('role,sign_order,name,email,status,sent_at,viewed_at,signed_at,decline_reason')
      .eq('agreement_id', agreementId).order('sign_order');
    return r.error ? [] : (r.data || []);
  }

  /* ── agreements log ─────────────────────────────────────────── */
  async function loadAgreements(ctx){
    var client = sb(); if(!client) return { ok:false, reason:'Not connected.', rows:[] };
    var ors = [];
    if(ctx.clientId) ors.push('client_id.eq.' + ctx.clientId);
    if(ctx.dealId)   ors.push('deal_id.eq.' + ctx.dealId);
    if(!ors.length) return { ok:true, rows:[] };
    var r = await client.from('agreements')
      .select('id,kind,title,status,party_name,body,sent_to,sent_at,signed_at,created_at,created_by_name,document_id,signed_document_id,signature_request_id,client_id,deal_id')
      .or(ors.join(','))
      .order('created_at', { ascending:false });
    if(r.error) return { ok:false, reason:r.error.message, rows:[] };
    return { ok:true, rows: r.data || [] };
  }
  async function updateAgreement(id, patch){
    var client = sb(); if(!client) return { ok:false, reason:'Not connected.' };
    var r = await client.from('agreements').update(patch).eq('id', id).select('id');
    if(r.error) return { ok:false, reason:r.error.message };
    if(!r.data || !r.data.length) return { ok:false, reason:'The database did not save the change (no permission?).' };
    return { ok:true };
  }
  async function docPath(docId){
    if(!docId || !sb()) return '';
    var r = await sb().from('deal_documents').select('file_path,name').eq('id', docId).maybeSingle();
    return (r && r.data && r.data.file_path) || '';
  }

  /* ════════════════════════════════════════════════════════════
     Generator modal
     ════════════════════════════════════════════════════════════ */
  window.glOpenAgreements = async function glOpenAgreements(opts){
    if(!isAdmin()){ alert('Admin only.'); return; }
    opts = (opts && typeof opts === 'object' && !(opts instanceof Event)) ? opts : {};
    var ctx = buildContext(opts);
    if(!ctx.clientId && !ctx.dealId){
      alert('Save this deal first (✏️ Edit → Save), then generate agreements for it.');
      return;
    }
    var prior = document.getElementById('gl-agr-modal'); if(prior) prior.remove();

    // opts.kind preselects the agreement (onboarding opens 'manufacturing').
    var state = { kind: (opts.kind === 'manufacturing' ? 'manufacturing' : 'nda'), templates:{}, fields: ctx.fields, generated:'', savedId:null, savedDocId:null };
    var statusEl = h('div', { style:'font-size:12px;min-height:16px;margin-top:8px' });
    function setStatus(msg, color){ statusEl.style.color = color || '#9aa7bd'; statusEl.textContent = msg || ''; }

    var listMount = h('div');
    var formMount = h('div', { style:'display:grid;grid-template-columns:1fr 1fr;gap:10px' });
    var textArea  = h('textarea', { style:S.inp + ';min-height:260px;font-family:Georgia,serif;font-size:12px;line-height:1.5;resize:vertical', spellcheck:'true' });
    var preview   = h('div', { style:'background:#fff;color:#111;border-radius:8px;padding:22px 26px;max-height:420px;overflow-y:auto;font-family:Georgia,serif' });
    var missingEl = h('div', { style:'font-size:12px;color:#f5c842;margin-bottom:8px' });
    var docStage  = h('div', { style:'display:none' });

    var kindBtns = {};
    function kindButton(k){
      var b = h('button', { type:'button', style:S.btn, onclick:function(){ state.kind = k; refreshKind(); } },
        [KINDS[k].icon + ' ' + KINDS[k].label]);
      kindBtns[k] = b; return b;
    }

    var closeBtn = h('button', { type:'button', title:'Close', style:'background:none;border:1px solid rgba(255,255,255,.15);border-radius:8px;color:#fff;font-size:15px;cursor:pointer;padding:4px 10px', onclick:function(){ ov.remove(); } }, ['✕']);

    var ov = h('div', { id:'gl-agr-modal', style:S.overlay }, [
      h('div', { style:S.card }, [
        h('div', { style:'display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px' }, [
          h('div', {}, [
            h('div', { style:S.title, text:'📄 AGREEMENTS' }),
            h('div', { style:'font-size:12px;color:#9aa7bd;margin-top:3px', text:'For ' + ctx.partyLabel + (ctx.dealId && !ctx.clientId ? ' (pipeline deal)' : '') })
          ]),
          closeBtn
        ]),
        h('div', { style:S.section }, [
          h('span', { style:S.lbl, text:'ON FILE' }),
          listMount
        ]),
        h('div', { style:S.section }, [
          h('span', { style:S.lbl, text:'NEW AGREEMENT' }),
          h('div', { style:'display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px' }, [kindButton('nda'), kindButton('manufacturing')]),
          formMount,
          h('div', { style:'display:flex;gap:8px;margin-top:14px;flex-wrap:wrap' }, [
            h('button', { type:'button', style:S.btnPri, onclick:generate }, ['Generate draft →'])
          ])
        ]),
        docStage,
        h('div', { style:'font-size:11px;color:#6b87ad;margin-top:6px;line-height:1.5',
          text:'These templates are starting drafts. Have your attorney review the wording (🤖 AI Tools → Agreement Templates) before sending to clients.' }),
        statusEl
      ])
    ]);

    // Document stage (after Generate)
    var btnDownload = h('button', { type:'button', style:S.btn, onclick:onDownload }, ['⬇ Download PDF']);
    var btnSave     = h('button', { type:'button', style:S.btn, onclick:function(){ onSave(false); } }, ['💾 Save to Documents']);
    var btnSend     = h('button', { type:'button', style:S.btnGo, onclick:onSend }, ['✍️ Send for e-signature']);
    docStage.appendChild(h('div', { style:S.section }, [
      h('span', { style:S.lbl, text:'DOCUMENT — EDIT THE TEXT FOR THIS CLIENT IF NEEDED' }),
      missingEl,
      h('div', { style:'display:grid;grid-template-columns:1fr 1fr;gap:12px' }, [
        h('div', {}, [textArea]),
        h('div', {}, [preview])
      ]),
      h('div', { style:'display:flex;gap:8px;margin-top:12px;flex-wrap:wrap' }, [btnDownload, btnSave, btnSend])
    ]));
    textArea.addEventListener('input', function(){
      state.generated = textArea.value;
      state.savedId = null; state.savedDocId = null;   // edited text = a new version
      renderPreview(preview, textArea.value);
    });

    (document.getElementById('crm-panel') || document.body).appendChild(ov);

    function refreshKind(){
      Object.keys(kindBtns).forEach(function(k){
        kindBtns[k].setAttribute('style', k === state.kind ? S.btnPri : S.btn);
      });
      renderForm();
      docStage.style.display = 'none';
      state.generated = ''; state.savedId = null; state.savedDocId = null;
    }

    function renderForm(){
      clear(formMount);
      FIELD_DEFS.forEach(function(d){
        if(d.only && d.only !== state.kind) return;
        var val = state.fields[d.key] || '';
        var miss = d.req && !String(val).trim();
        var input = h('input', { type:'text', value: val, style: miss ? S.inpMiss : S.inp, 'data-agr-field': d.key });
        input.addEventListener('input', function(){
          state.fields[d.key] = input.value;
          input.setAttribute('style', d.req && !input.value.trim() ? S.inpMiss : S.inp);
        });
        formMount.appendChild(h('div', { style: d.wide ? 'grid-column:1 / -1' : '' }, [
          h('label', { style:S.lbl, text: d.label + (d.req ? ' *' : '') }),
          input,
          d.hint ? h('div', { style:'font-size:10.5px;color:#6b87ad;margin-top:3px', text:d.hint }) : null
        ]));
      });
    }

    async function loadTemplates(){
      var r = await sb().from('agreement_templates').select('kind,title,body');
      if(r.error){ setStatus('Could not load templates: ' + r.error.message, '#ff8579'); return; }
      (r.data || []).forEach(function(t){ state.templates[t.kind] = t; });
      if(!r.data || !r.data.length) setStatus('No agreement templates found. Add them in 🤖 AI Tools → Agreement Templates.', '#f5c842');
    }

    function generate(){
      var tpl = state.templates[state.kind];
      if(!tpl){ setStatus('The ' + KINDS[state.kind].label + ' template is missing.', '#ff8579'); return; }
      var missingReq = FIELD_DEFS.filter(function(d){
        return d.req && (!d.only || d.only === state.kind) && !String(state.fields[d.key] || '').trim();
      });
      if(missingReq.length){
        setStatus('Fill in the highlighted fields first: ' + missingReq.map(function(d){ return d.label.toLowerCase(); }).join(', ') + '.', '#f5c842');
        return;
      }
      var res = fillTemplate(tpl.body, state.fields, state.kind);
      state.generated = res.text; state.savedId = null; state.savedDocId = null;
      textArea.value = res.text;
      missingEl.textContent = res.missing.length
        ? '⚠ The template uses fields with no value: ' + res.missing.join(', ') + ' (shown in [BRACKETS]). Fix them in the text before sending.'
        : '';
      renderPreview(preview, res.text);
      docStage.style.display = 'block';
      setStatus('Draft ready. Review the text, then download, save or send.', '#5fcf9e');
      docStage.scrollIntoView({ behavior:'smooth', block:'start' });
    }

    function docTitle(){
      var t = state.templates[state.kind];
      return ((t && t.title) || KINDS[state.kind].label) + ' — ' + (state.fields.client_legal_name || ctx.partyLabel);
    }
    function footerNote(){ return state.kind === 'nda' ? 'Confidential' : ''; }
    function unresolved(){ return /\[[A-Z0-9_]{3,}\]/.test(state.generated); }

    async function onDownload(){
      if(!state.generated) return;
      try {
        setStatus('Building PDF…');
        var blob = await buildPdf(state.generated, docTitle(), footerNote());
        downloadBlob(blob, safeFileName(docTitle()) + '.pdf');
        setStatus('PDF downloaded.', '#5fcf9e');
      } catch(e){ setStatus('PDF failed: ' + (e.message || e), '#ff8579'); }
    }

    // Saves the PDF to Documents and logs the agreement. Returns the row id.
    async function onSave(quiet){
      if(!state.generated) return null;
      if(state.savedId) { if(!quiet) setStatus('Already saved — see "On file" above.', '#5fcf9e'); return state.savedId; }
      if(unresolved() && !quiet){
        setStatus('The text still has [BRACKETED] blanks. Fill them in before saving.', '#f5c842'); return null;
      }
      setStatus('Saving…');
      var blob;
      try { blob = await buildPdf(state.generated, docTitle(), footerNote()); }
      catch(e){ setStatus('PDF failed: ' + (e.message || e), '#ff8579'); return null; }
      var filed = await fileToDocuments(ctx, blob, docTitle(), KINDS[state.kind].docType, 'Generated in the CRM (draft, unsigned)');
      if(!filed.ok){ setStatus(filed.reason, '#ff8579'); return null; }
      var u = window.currentUser || {};
      var ins = await window.glCheckedInsert(function(s){
        return s.from('agreements').insert([{
          kind: state.kind, title: docTitle(), client_id: ctx.clientId, deal_id: ctx.dealId,
          party_name: state.fields.client_legal_name || ctx.partyLabel,
          body: state.generated, fields: state.fields, status: 'draft',
          document_id: filed.id, created_by: u.id || null, created_by_name: u.name || u.email || null
        }]).select('id').single();
      });
      if(!ins.ok){ setStatus('PDF is in Documents, but the agreement log did not save: ' + ins.reason, '#ff8579'); return null; }
      state.savedId = ins.row.id; state.savedDocId = filed.id;
      audit('agreement_saved', docTitle(), { kind: state.kind, client: ctx.clientId, deal: ctx.dealId });
      if(!quiet) setStatus('Saved to Documents and logged as a draft.', '#5fcf9e');
      refreshList();
      return state.savedId;
    }

    async function onSend(){
      if(!state.generated) return;
      var email = String(state.fields.client_signer_email || '').trim();
      if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){ setStatus('Add a valid CLIENT SIGNER EMAIL above to send for signature.', '#f5c842'); return; }
      if(unresolved()){ setStatus('The text still has [BRACKETED] blanks. Fill them in before sending.', '#f5c842'); return; }
      btnSend.disabled = true;
      try {
        var id = await onSave(true);
        if(!id) return;
        setStatus('Emailing the signing link…');
        var r = await callSign({ action:'send', agreement_id: id });
        if(!r.ok){ setStatus('Saved as a draft, but sending failed: ' + r.reason, '#ff8579'); refreshList(); return; }
        audit('agreement_sent', docTitle(), { to: r.data.sent_to });
        setStatus('Signing link emailed to ' + r.data.sent_to + '. You will see progress under "On file".', '#5fcf9e');
        refreshList();
      } catch(e){
        setStatus('Send failed: ' + (e.message || e), '#ff8579');
      } finally {
        btnSend.disabled = false;
      }
    }

    /* ── "On file" list ── */
    async function refreshList(){
      clear(listMount);
      listMount.appendChild(h('div', { style:'font-size:12px;color:#6b87ad', text:'Loading…' }));
      var res = await loadAgreements(ctx);
      clear(listMount);
      if(!res.ok){ listMount.appendChild(h('div', { style:'font-size:12px;color:#ff8579', text:'Could not load agreements: ' + res.reason })); return; }
      if(!res.rows.length){ listMount.appendChild(h('div', { style:'font-size:12px;color:#6b87ad', text:'No agreements yet.' })); return; }
      res.rows.forEach(function(a){ listMount.appendChild(agreementRow(a)); });
    }

    function agreementRow(a){
      var st = STATUS_STYLE[a.status] || STATUS_STYLE.draft;
      var when = a.signed_at ? ('signed ' + new Date(a.signed_at).toLocaleDateString())
        : a.sent_at ? ('sent ' + new Date(a.sent_at).toLocaleDateString() + (a.sent_to ? ' to ' + a.sent_to : ''))
        : ('created ' + new Date(a.created_at).toLocaleDateString() + (a.created_by_name ? ' by ' + a.created_by_name : ''));
      var actions = h('div', { style:'display:flex;gap:6px;flex-wrap:wrap' });
      var rowMsg = h('div', { style:'font-size:11px;margin-top:4px' });
      function small(label, fn, style){ return h('button', { type:'button', style:(style || S.btn) + ';padding:5px 10px;font-size:11px', onclick:fn }, [label]); }

      if(a.document_id) actions.appendChild(small('View', async function(){
        var p = await docPath(a.document_id);
        if(p && typeof window.glOpenClientDoc === 'function') window.glOpenClientDoc(p);
        else rowMsg.textContent = 'File not found.';
      }));
      if(a.signed_document_id) actions.appendChild(small('View signed', async function(){
        var p = await docPath(a.signed_document_id);
        if(p && typeof window.glOpenClientDoc === 'function') window.glOpenClientDoc(p);
        else rowMsg.textContent = 'File not found.';
      }, S.btnGo));
      var signersEl = h('div', { style:'font-size:11px;color:#9aa7bd;margin-top:3px' });
      if(a.status === 'sent' || a.status === 'signed' || a.status === 'declined'){
        loadSigners(a.id).then(function(rows){
          rows.forEach(function(sg){
            var label = sg.status === 'signed'   ? ('✓ signed ' + new Date(sg.signed_at).toLocaleString())
                      : sg.status === 'viewed'   ? ('opened ' + new Date(sg.viewed_at).toLocaleString() + ', not signed yet')
                      : sg.status === 'sent'     ? ('link sent ' + new Date(sg.sent_at).toLocaleString())
                      : sg.status === 'declined' ? ('✗ declined' + (sg.decline_reason ? ': ' + sg.decline_reason : ''))
                      : 'waits for the previous signer';
            signersEl.appendChild(h('div', { text: (sg.role === 'gl' ? 'Good Liquid' : 'Client') + ' · ' + sg.name + ' (' + sg.email + ') — ' + label }));
          });
        });
      }
      if(a.status === 'sent') actions.appendChild(small('Resend link', async function(){
        rowMsg.style.color = '#9aa7bd'; rowMsg.textContent = 'Sending…';
        var r = await callSign({ action:'resend', agreement_id: a.id });
        rowMsg.style.color = r.ok ? '#5fcf9e' : '#ff8579';
        rowMsg.textContent = r.ok ? ('New link emailed to ' + r.data.sent_to + '.') : r.reason;
      }));
      // Two-click confirm (CRM_FEATURE_MAP: confirm() can be suppressed by Chrome).
      var voidArmed = false, voidBtn = null;
      if(a.status === 'draft' || a.status === 'sent') actions.appendChild(voidBtn = small('Mark void', async function(){
        if(!voidArmed){
          voidArmed = true; voidBtn.textContent = 'Click again to void';
          setTimeout(function(){ voidArmed = false; if(voidBtn) voidBtn.textContent = 'Mark void'; }, 4000);
          return;
        }
        var r = await updateAgreement(a.id, { status:'void' });
        if(!r.ok){ rowMsg.style.color = '#ff8579'; rowMsg.textContent = r.reason; return; }
        audit('agreement_void', a.title, { id: a.id });
        refreshList();
      }));

      return h('div', { style:'display:flex;justify-content:space-between;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid rgba(255,255,255,.06);flex-wrap:wrap' }, [
        h('div', { style:'min-width:0;flex:1' }, [
          h('div', { style:'font-size:13px;font-weight:600', text: (KINDS[a.kind] ? KINDS[a.kind].icon + ' ' : '') + a.title }),
          h('div', { style:'font-size:11px;color:#9aa7bd;margin-top:2px' }, [
            h('span', { style:'padding:1px 8px;border-radius:20px;font-size:10px;font-weight:700;margin-right:6px;background:' + st.bg + ';color:' + st.fg, text: st.label }),
            when
          ]),
          signersEl,
          rowMsg
        ]),
        actions
      ]);
    }

    refreshKind();
    await loadTemplates();
    refreshList();
  };

  /* ════════════════════════════════════════════════════════════
     Invoice sign-off (invoice acceptance + manufacturing agreement)
     ════════════════════════════════════════════════════════════
     Opened from the invoice detail panel (button injected below). Builds an
     "Invoice Acceptance and Product Responsibility" document from the
     invoice — line items, total, terms and the kill-step choice — and, when
     the client has no signed Contract Manufacturing Agreement, one of those
     too. Both are logged in public.agreements (the invoice one carries
     invoice_id) and sent with agreement-sign {action:'send_packet'}: one
     email, one page, one signature. Signed PDFs with certificate pages land
     in the client's Documents (and their portal) automatically. */

  var KILL_STEP = {
    accepted: 'Good Liquid offered flash pasteurization for this run, and Customer ACCEPTED it. It is included on this invoice.',
    declined: 'Good Liquid offered flash pasteurization for this run, and Customer DECLINED it. Customer understands that without a kill step the product may be more likely to re-ferment, swell, leak or burst, and Customer accepts sole responsibility for the microbial and pressure stability of the product.',
    na:       'Not applicable: no kill step applies to the services on this invoice.'
  };
  function usd(n, maxFrac){
    return '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits:2, maximumFractionDigits: maxFrac || 2 });
  }
  function findInvoice(num){
    return (window.invoices || []).find(function(i){ return i && i.id === num; }) || null;
  }
  // Same junk-row rule as the invoice detail view (crm-index-core viewInvoice).
  function invoiceLines(inv){
    var raw = Array.isArray(inv.lines) && inv.lines.length ? inv.lines : [{ desc: inv.svc, qty: 1, unitPrice: inv.amount, total: inv.amount }];
    return raw.filter(function(l){
      return !((Number(l.total) || 0) === 0 && (!l.desc || String(l.desc).trim() === '' || String(l.desc).trim() === '0'));
    });
  }
  function invoiceLinesText(inv){
    var out = invoiceLines(inv).map(function(l){
      var qty = l.qty != null ? Number(l.qty).toLocaleString('en-US') + (l.unit ? ' ' + l.unit : '') : '';
      var unit = l.unitPrice != null ? ' x ' + usd(l.unitPrice, 4) : '';
      return '- ' + String(l.desc || 'Service').replace(/\s+/g, ' ').trim() +
        (qty ? ': ' + qty + unit : '') + ' = ' + usd(l.total);
    });
    if(inv.discount && inv.discountAmt) out.push('- Discount (' + inv.discount + '%) = -' + usd(inv.discountAmt));
    return out.join('\n');
  }
  function hasPasteurization(inv){
    return invoiceLines(inv).some(function(l){ return /pasteuri/i.test(String(l.desc || '')); });
  }

  window.glOpenInvoiceSignoff = async function glOpenInvoiceSignoff(invNumber){
    if(!isAdmin()){ alert('Admin only.'); return; }
    if(typeof invNumber !== 'string' || !invNumber) invNumber = window.currentInvId;
    var inv = findInvoice(invNumber);
    if(!inv){ alert('Open the invoice first.'); return; }
    if(!inv.supaId || !/^[0-9a-f-]{36}$/i.test(inv.supaId)){ alert('Save this invoice first, then send it for signature.'); return; }
    if(!inv.client || !/^[0-9a-f-]{36}$/i.test(inv.client)){ alert('This invoice is not linked to a client. Edit it, pick the client, save, then try again.'); return; }
    var ctx = buildContext({ clientId: inv.client });
    if(!ctx.clientId){ alert('The client on this invoice was not found. Reload and try again.'); return; }
    var client = ctx.client || {};
    var prior = document.getElementById('gl-signoff-modal'); if(prior) prior.remove();

    var f = ctx.fields;
    // accOpen     unsigned acceptances already out for THIS invoice
    // oldPackets  their packet ids: a re-send replaces those packets whole
    // mfgElsewhere unsigned manufacturing agreements in OTHER requests
    //             (another invoice's packet, or sent from 📄 Agreements)
    var state = { templates:{}, mfgSigned:null, mfgOpen:[], accOpen:[], oldPackets:{}, mfgElsewhere:[],
      killStep: hasPasteurization(inv) ? 'accepted' : '', savedIds:null, sending:false, sent:false, resendArmed:false };
    var statusEl = h('div', { style:'font-size:13px;font-weight:600;min-height:18px;margin-top:10px' });
    // The status sits right under the buttons and is scrolled into view: on
    // a narrow screen it used to land off-screen, the Send button looked
    // dead, and every extra click sent the customer another request.
    function setStatus(msg, color){
      statusEl.style.color = color || '#9aa7bd'; statusEl.textContent = msg || '';
      if(msg && statusEl.scrollIntoView) try { statusEl.scrollIntoView({ block:'nearest' }); } catch(_){}
    }
    var onFile = h('div', {}, [h('div', { style:'font-size:12px;color:#6b87ad', text:'Loading…' })]);
    var mfgMount = h('div');
    var preview = h('div', { style:'display:none;margin-top:12px' });

    function field(key, label, req, wide){
      var inp = h('input', { type:'text', value: f[key] || '', style: req && !String(f[key] || '').trim() ? S.inpMiss : S.inp, 'data-signoff-field': key });
      inp.addEventListener('input', function(){
        f[key] = inp.value; state.savedIds = null;
        inp.setAttribute('style', req && !inp.value.trim() ? S.inpMiss : S.inp);
      });
      return h('div', { style: wide ? 'grid-column:1 / -1' : '' }, [
        h('label', { style:S.lbl, text: label + (req ? ' *' : '') }), inp
      ]);
    }

    var killSel = h('select', { style:S.inp, 'data-signoff-field':'kill_step' }, [
      h('option', { value:'', text:'— Choose —' }),
      h('option', { value:'accepted', text:'Offered and ACCEPTED (pasteurization is on this invoice)' }),
      h('option', { value:'declined', text:'Offered and DECLINED by the customer' }),
      h('option', { value:'na', text:'Not applicable to these services' })
    ]);
    killSel.value = state.killStep;
    killSel.addEventListener('change', function(){ state.killStep = killSel.value; state.savedIds = null; });

    var includeMfg = h('input', { type:'checkbox', 'data-signoff-field':'include_mfg' });
    includeMfg.addEventListener('change', function(){ state.savedIds = null; renderMfg(); });
    var mfgFields = h('div', { style:'display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px' }, [
      field('effective_date', 'EFFECTIVE DATE', true),
      field('term_years', 'INITIAL TERM (YEARS)', true),
      field('gl_signer_name', 'GOOD LIQUID SIGNER', true),
      field('gl_signer_title', 'GOOD LIQUID SIGNER TITLE', true),
      field('gl_signer_email', 'GOOD LIQUID SIGNER EMAIL (you countersign after the customer)', false, true)
    ]);

    function renderMfg(){
      clear(mfgMount);
      if(state.mfgSigned){
        mfgMount.appendChild(h('div', { style:'font-size:12.5px;color:#5fcf9e',
          text:'✓ Contract Manufacturing Agreement already signed on ' + new Date(state.mfgSigned.signed_at || state.mfgSigned.created_at).toLocaleDateString() + '. Only the invoice acceptance will be sent.' }));
        return;
      }
      mfgMount.appendChild(h('label', { style:'display:flex;gap:8px;align-items:center;font-size:13px;cursor:pointer' }, [
        includeMfg, 'Include the Contract Manufacturing Agreement (this client has not signed one)'
      ]));
      var waiting = state.mfgElsewhere.filter(function(a){ return a.status === 'sent'; });
      if(waiting.length){
        mfgMount.appendChild(h('div', { style:'font-size:11.5px;color:#f5c842;margin-top:6px',
          text:'The customer already has one to sign, in an earlier request (sent ' +
            waiting.map(function(a){ return new Date(a.sent_at || a.created_at).toLocaleDateString(); }).join(', ') +
            '), so it is not included again. Tick the box only to replace it: the earlier copy is voided, and that earlier request\'s link stops working.' }));
      }
      if(includeMfg.checked) mfgMount.appendChild(mfgFields);
    }

    var btnPreview = h('button', { type:'button', style:S.btn, onclick:onPreview }, ['👁 Preview documents']);
    var btnSend = h('button', { type:'button', style:S.btnGo, onclick:onSend }, ['✍️ Send for e-signature']);

    var ov = h('div', { id:'gl-signoff-modal', style:S.overlay }, [
      h('div', { style:S.card }, [
        h('div', { style:'display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px' }, [
          h('div', {}, [
            h('div', { style:S.title, text:'✍️ CUSTOMER SIGN-OFF' }),
            h('div', { style:'font-size:12px;color:#9aa7bd;margin-top:3px', text:'Invoice ' + inv.id + ' · ' + (client.name || inv.clientName || '') + ' · ' + usd(inv.amount) })
          ]),
          h('button', { type:'button', title:'Close', style:'background:none;border:1px solid rgba(255,255,255,.15);border-radius:8px;color:#fff;font-size:15px;cursor:pointer;padding:4px 10px', onclick:function(){ ov.remove(); } }, ['✕'])
        ]),
        h('div', { style:S.section }, [ h('span', { style:S.lbl, text:'ON FILE FOR THIS INVOICE' }), onFile ]),
        h('div', { style:S.section }, [
          h('span', { style:S.lbl, text:'WHO SIGNS' }),
          h('div', { style:'display:grid;grid-template-columns:1fr 1fr;gap:10px' }, [
            field('client_legal_name', 'CLIENT LEGAL NAME', true),
            field('client_signer_email', 'CLIENT SIGNER EMAIL', true),
            field('client_signer_name', 'CLIENT SIGNER NAME', true),
            field('client_signer_title', 'CLIENT SIGNER TITLE', false),
            field('client_address', 'CLIENT ADDRESS', true, true)
          ])
        ]),
        h('div', { style:S.section }, [
          h('span', { style:S.lbl, text:'KILL STEP FOR THIS RUN *' }),
          killSel,
          h('div', { style:'font-size:10.5px;color:#6b87ad;margin-top:4px', text:'Printed on the acceptance and signed by the customer: a record of whether they took the pasteurization you offered.' })
        ]),
        h('div', { style:S.section }, [ h('span', { style:S.lbl, text:'MANUFACTURING AGREEMENT' }), mfgMount ]),
        preview,
        h('div', { style:'display:flex;gap:8px;flex-wrap:wrap' }, [btnPreview, btnSend]),
        statusEl,
        h('div', { style:'font-size:11px;color:#6b87ad;margin-top:8px;line-height:1.5',
          text:'The customer gets one email and signs everything on one page. Signed copies, each with a signature certificate, are filed to this client\'s Documents and their portal. Wording: 🤖 AI Tools → Agreement Templates (have your attorney review it).' })
      ])
    ]);
    (document.getElementById('crm-panel') || document.body).appendChild(ov);

    // Build the documents' text from the current inputs. Returns
    // { docs:[{kind,title,text}] } or { error }.
    function buildDocs(){
      var need = [['client_legal_name','client legal name'],['client_address','client address'],['client_signer_name','client signer name'],['client_signer_email','client signer email']];
      if(includeMfg.checked && !state.mfgSigned) need = need.concat([['effective_date','effective date'],['term_years','initial term'],['gl_signer_name','Good Liquid signer'],['gl_signer_title','Good Liquid signer title']]);
      var miss = need.filter(function(p){ return !String(f[p[0]] || '').trim(); }).map(function(p){ return p[1]; });
      if(miss.length) return { error:'Fill in: ' + miss.join(', ') + '.' };
      if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(f.client_signer_email).trim())) return { error:'The client signer email is not valid.' };
      if(!state.killStep) return { error:'Choose the kill step for this run.' };
      var tpl = state.templates.invoice_acceptance;
      if(!tpl) return { error:'The Invoice Acceptance template is missing (🤖 AI Tools → Agreement Templates).' };
      var terms = inv.paymentTerms || client.paymentTerms || 'Due on receipt';
      var invFields = Object.assign({}, f, {
        invoice_number: inv.id,
        invoice_date: inv.date || '',
        invoice_lines: invoiceLinesText(inv),
        invoice_total: usd(inv.amount),
        payment_terms: terms,
        kill_step: KILL_STEP[state.killStep]
      });
      var docs = [];
      if(includeMfg.checked && !state.mfgSigned){
        var mt = state.templates.manufacturing;
        if(!mt) return { error:'The Manufacturing Agreement template is missing.' };
        var m = fillTemplate(mt.body, f, 'manufacturing');
        if(m.missing.length) return { error:'The manufacturing template uses fields with no value: ' + m.missing.join(', ') + '.' };
        docs.push({ kind:'manufacturing', title: mt.title + ' — ' + f.client_legal_name, text: m.text, fields: Object.assign({}, f) });
      }
      var r = fillTemplate(tpl.body, invFields, 'invoice_acceptance');
      if(r.missing.length) return { error:'The invoice acceptance template uses fields with no value: ' + r.missing.join(', ') + '.' };
      docs.push({ kind:'invoice_acceptance', title: 'Invoice ' + inv.id + ' Acceptance — ' + f.client_legal_name, text: r.text,
        // gl_signer_email is dropped: the invoice acceptance has no
        // countersignature (the edge function skips it anyway).
        fields: Object.assign({}, invFields, { gl_signer_email: '' }) });
      return { docs: docs };
    }

    function onPreview(){
      var b = buildDocs();
      if(b.error){ setStatus(b.error, '#f5c842'); return; }
      clear(preview);
      b.docs.forEach(function(d){
        var box = h('div', { style:'background:#fff;color:#111;border-radius:8px;padding:22px 26px;max-height:380px;overflow-y:auto;font-family:Georgia,serif;margin-bottom:10px' });
        renderPreview(box, d.text);
        preview.appendChild(h('div', { style:S.lbl, text: (KINDS[d.kind] ? KINDS[d.kind].icon + ' ' : '') + d.title }));
        preview.appendChild(box);
      });
      preview.style.display = 'block';
      setStatus('This is exactly what the customer will read and sign.', '#5fcf9e');
    }

    var SEND_LABEL = '✍️ Send for e-signature';
    async function onSend(){
      if(state.sending || state.sent) return;
      var b = buildDocs();
      if(b.error){ setStatus(b.error, '#f5c842'); return; }
      // A request is already out for this invoice: sending again must be
      // deliberate, and replaces it (the old link stops working).
      if(state.accOpen.length && !state.resendArmed){
        state.resendArmed = true;
        btnSend.textContent = '⚠ Click again to send a NEW request';
        setStatus('A signing request for this invoice is already out (sent ' +
          new Date(state.accOpen[0].sent_at || state.accOpen[0].created_at).toLocaleString() +
          '). Sending a new one voids it, and the customer\'s earlier link stops working. To just remind them, use "Resend link" above instead.', '#f5c842');
        setTimeout(function(){
          if(state.resendArmed && !state.sending && !state.sent){ state.resendArmed = false; btnSend.textContent = SEND_LABEL; }
        }, 8000);
        return;
      }
      state.resendArmed = false;
      state.sending = true; btnSend.disabled = true; btnSend.textContent = 'Sending…';
      try {
        // Reuse the drafts from a failed send of the same text, so a retry
        // does not pile up duplicate drafts.
        var ids = state.savedIds;
        if(!ids){
          ids = [];
          var u = window.currentUser || {};
          for(var i = 0; i < b.docs.length; i++){
            var d = b.docs[i];
            setStatus('Saving ' + KINDS[d.kind].label + '…');
            var blob;
            try { blob = await buildPdf(d.text, d.title, ''); }
            catch(e){ setStatus('PDF failed: ' + (e.message || e), '#ff8579'); return; }
            var filed = await fileToDocuments(ctx, blob, d.title, KINDS[d.kind].docType, 'Generated in the CRM (draft, unsigned)');
            if(!filed.ok){ setStatus(filed.reason, '#ff8579'); return; }
            var ins = await window.glCheckedInsert(function(s){
              return s.from('agreements').insert([{
                kind: d.kind, title: d.title, client_id: ctx.clientId, deal_id: null,
                invoice_id: d.kind === 'invoice_acceptance' ? inv.supaId : null,
                party_name: f.client_legal_name || ctx.partyLabel,
                body: d.text, fields: d.fields, status: 'draft',
                document_id: filed.id, created_by: u.id || null, created_by_name: u.name || u.email || null
              }]).select('id').single();
            });
            if(!ins.ok){ setStatus('The draft PDF is in Documents, but the agreement log did not save: ' + ins.reason, '#ff8579'); return; }
            ids.push(ins.row.id);
          }
          state.savedIds = ids;
        }
        setStatus('Emailing the signing link…');
        var r = await callSign({ action:'send_packet', agreement_ids: ids });
        if(!r.ok){ setStatus('Saved as drafts, but sending failed: ' + r.reason, '#ff8579'); return; }
        state.savedIds = null;
        state.sent = true;
        btnSend.textContent = '✓ Sent';
        audit('invoice_signoff_sent', inv.id, { to: r.data.sent_to, documents: b.docs.map(function(d){ return d.kind; }) });
        // Retire what this request replaces, so the customer has exactly one
        // live request: every earlier request for THIS invoice (acceptance
        // and its manufacturing agreement), and — only when this request
        // carries a manufacturing agreement — other unsigned copies of it.
        var retire = state.accOpen.concat(state.mfgOpen.filter(function(a){ return a.packet_id && state.oldPackets[a.packet_id]; }));
        if(b.docs.some(function(d){ return d.kind === 'manufacturing'; })) retire = retire.concat(state.mfgElsewhere);
        var voidFail = '';
        for(var j = 0; j < retire.length; j++){
          var v = await updateAgreement(retire[j].id, { status:'void' });
          if(v.ok) audit('agreement_void', retire[j].title, { id: retire[j].id, replaced_by_packet: r.data.packet_id });
          else voidFail = v.reason;
        }
        if(voidFail) setStatus('✓ Sent to ' + r.data.sent_to + ', but an earlier request could not be voided: ' + voidFail, '#f5c842');
        else setStatus('✓ Signing link emailed to ' + r.data.sent_to + ' (' + b.docs.length + ' document' + (b.docs.length === 1 ? '' : 's') + '). Close this window; progress shows on the invoice.', '#5fcf9e');
        await refreshState();
        window.glRefreshInvoiceSignoffStatus && window.glRefreshInvoiceSignoffStatus(true);
      } catch(e){
        setStatus('Send failed: ' + (e.message || e), '#ff8579');
      } finally {
        state.sending = false;
        // Once sent, the button stays locked for this window: a second click
        // used to send the customer a whole new request.
        if(!state.sent){ btnSend.disabled = false; btnSend.textContent = SEND_LABEL; }
      }
    }

    function signoffRow(a){
      var st = STATUS_STYLE[a.status] || STATUS_STYLE.draft;
      var rowMsg = h('div', { style:'font-size:11px;margin-top:4px' });
      var signersEl = h('div', { style:'font-size:11px;color:#9aa7bd;margin-top:3px' });
      var actions = h('div', { style:'display:flex;gap:6px;flex-wrap:wrap' });
      function small(label, fn, style){ return h('button', { type:'button', style:(style || S.btn) + ';padding:5px 10px;font-size:11px', onclick:fn }, [label]); }
      if(a.signed_document_id) actions.appendChild(small('View signed', async function(){
        var p = await docPath(a.signed_document_id);
        if(p && typeof window.glOpenClientDoc === 'function') window.glOpenClientDoc(p); else rowMsg.textContent = 'File not found.';
      }, S.btnGo));
      if(a.status === 'sent') actions.appendChild(small('Resend link', async function(){
        rowMsg.style.color = '#9aa7bd'; rowMsg.textContent = 'Sending…';
        var r = await callSign({ action:'resend', agreement_id: a.id });
        rowMsg.style.color = r.ok ? '#5fcf9e' : '#ff8579';
        rowMsg.textContent = r.ok ? ('New link emailed to ' + r.data.sent_to + '.') : r.reason;
      }));
      if(a.status !== 'draft'){
        loadSigners(a.id).then(function(rows){
          rows.forEach(function(sg){
            var label = sg.status === 'signed'   ? ('✓ signed ' + new Date(sg.signed_at).toLocaleString())
                      : sg.status === 'viewed'   ? ('opened ' + new Date(sg.viewed_at).toLocaleString() + ', not signed yet')
                      : sg.status === 'sent'     ? ('link sent ' + new Date(sg.sent_at).toLocaleString())
                      : sg.status === 'declined' ? ('✗ declined' + (sg.decline_reason ? ': ' + sg.decline_reason : ''))
                      : 'waits for the previous signer';
            signersEl.appendChild(h('div', { text: (sg.role === 'gl' ? 'Good Liquid' : 'Client') + ' · ' + sg.name + ' (' + sg.email + ') — ' + label }));
          });
        });
      }
      return h('div', { style:'display:flex;justify-content:space-between;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.06);flex-wrap:wrap' }, [
        h('div', { style:'min-width:0;flex:1' }, [
          h('div', { style:'font-size:13px;font-weight:600', text:(KINDS[a.kind] ? KINDS[a.kind].icon + ' ' : '') + a.title }),
          h('div', { style:'font-size:11px;color:#9aa7bd;margin-top:2px' }, [
            h('span', { style:'padding:1px 8px;border-radius:20px;font-size:10px;font-weight:700;margin-right:6px;background:' + st.bg + ';color:' + st.fg, text: st.label }),
            a.signed_at ? ('signed ' + new Date(a.signed_at).toLocaleDateString()) : a.sent_at ? ('sent ' + new Date(a.sent_at).toLocaleDateString()) : ''
          ]),
          signersEl, rowMsg
        ]),
        actions
      ]);
    }

    async function refreshState(){
      var s = sb();
      var res = await Promise.all([
        s.from('agreement_templates').select('kind,title,body').in('kind', ['invoice_acceptance', 'manufacturing']),
        s.from('agreements').select('id,kind,title,status,sent_at,signed_at,created_at,signed_document_id,invoice_id,packet_id')
          .eq('client_id', ctx.clientId).in('kind', ['invoice_acceptance', 'manufacturing']).order('created_at', { ascending:false })
      ]);
      if(res[0].error){ setStatus('Could not load templates: ' + res[0].error.message, '#ff8579'); }
      (res[0].data || []).forEach(function(t){ state.templates[t.kind] = t; });
      clear(onFile);
      if(res[1].error){ onFile.appendChild(h('div', { style:'font-size:12px;color:#ff8579', text:'Could not load agreements: ' + res[1].error.message })); return; }
      var rows = res[1].data || [];
      var mfg = rows.filter(function(a){ return a.kind === 'manufacturing'; });
      state.mfgSigned = mfg.find(function(a){ return a.status === 'signed'; }) || null;
      state.mfgOpen = mfg.filter(function(a){ return a.status === 'draft' || a.status === 'sent'; });
      state.accOpen = rows.filter(function(a){ return a.kind === 'invoice_acceptance' && a.invoice_id === inv.supaId && a.status === 'sent'; });
      state.oldPackets = {};
      state.accOpen.forEach(function(a){ if(a.packet_id) state.oldPackets[a.packet_id] = true; });
      state.mfgElsewhere = state.mfgOpen.filter(function(a){ return !(a.packet_id && state.oldPackets[a.packet_id]); });
      // Default: include it when the client has not signed one AND no copy
      // is already waiting in another request. Voiding that copy would kill
      // the other request's link (its first document), so it is opt-in.
      if(!state.sent) includeMfg.checked = !state.mfgSigned && !state.mfgElsewhere.some(function(a){ return a.status === 'sent'; });
      renderMfg();
      var mine = rows.filter(function(a){ return a.kind === 'invoice_acceptance' && a.invoice_id === inv.supaId && a.status !== 'draft' && a.status !== 'void'; });
      var packets = {};
      mine.forEach(function(a){ if(a.packet_id) packets[a.packet_id] = true; });
      var shown = mine.concat(mfg.filter(function(a){ return a.packet_id && packets[a.packet_id]; }));
      if(!shown.length){ onFile.appendChild(h('div', { style:'font-size:12px;color:#6b87ad', text:'Not sent for signature yet.' })); return; }
      shown.forEach(function(a){ onFile.appendChild(signoffRow(a)); });
    }

    await refreshState();
  };

  /* ── Invoice detail: "✍️ Customer sign-off" button + status line ──
     Admin only (agreements are admin-only RLS). Injected the house way
     (CRM_FEATURE_MAP §4): a class guard stops duplicates, and the per-
     invoice flag is set only after the work is done (GL-127). */
  var signoffCache = {};   // invoice supaId → latest acceptance row (or null)
  async function signoffFor(inv, force){
    if(!force && Object.prototype.hasOwnProperty.call(signoffCache, inv.supaId)) return signoffCache[inv.supaId];
    var r = await sb().from('agreements').select('id,status,sent_at,sent_to,signed_at')
      .eq('invoice_id', inv.supaId).eq('kind', 'invoice_acceptance').neq('status', 'draft')
      .order('created_at', { ascending:false }).limit(1);
    if(r.error) return undefined;
    signoffCache[inv.supaId] = (r.data && r.data[0]) || null;
    return signoffCache[inv.supaId];
  }
  function signoffText(a){
    if(a === undefined) return { text:'Customer sign-off: could not be checked.', color:'#ff8579' };
    if(!a) return { text:'Customer sign-off: not sent. Use ✍️ Customer sign-off to have them accept this invoice.', color:'#f5c842' };
    if(a.status === 'signed') return { text:'✓ Customer sign-off: accepted and signed ' + new Date(a.signed_at).toLocaleString() + '. Signed copy is in Documents.', color:'#5fcf9e' };
    if(a.status === 'declined') return { text:'✗ Customer sign-off: the customer declined to sign.', color:'#ff8579' };
    if(a.status === 'void') return { text:'Customer sign-off: the last request was voided. Not signed.', color:'#f5c842' };
    return { text:'Customer sign-off: sent ' + new Date(a.sent_at).toLocaleDateString() + (a.sent_to ? ' to ' + a.sent_to : '') + ', not signed yet.', color:'#f5c842' };
  }
  var signoffBusy = false;
  async function injectSignoff(force){
    if(!isAdmin() || !sb() || signoffBusy) return;
    var detail = document.getElementById('inv-detail');
    if(!detail || !detail.classList.contains('show')) return;
    var inv = findInvoice(window.currentInvId);
    if(!inv || !inv.supaId) return;
    var back = detail.querySelector('[data-gl-action="closeDetail"]');
    var row = back && back.parentNode;
    if(row && !row.querySelector('.gl-signoff-btn')){
      row.appendChild(h('button', { type:'button', class:'cbtn gl-signoff-btn',
        style:'background:rgba(95,207,158,.12);border-color:rgba(95,207,158,.35);color:#5fcf9e',
        title:'Have the customer e-sign their acceptance of this invoice (and the manufacturing agreement if they have not signed one)',
        onclick:function(){ window.glOpenInvoiceSignoff(window.currentInvId); } }, ['✍️ Customer sign-off']));
    }
    var content = document.getElementById('inv-detail-content');
    if(!content || !content.firstElementChild) return;
    var line = content.querySelector('.gl-signoff-status');
    if(line && !force && line.getAttribute('data-inv') === inv.supaId) return;
    signoffBusy = true;
    try {
      var a = await signoffFor(inv, force);
      if(findInvoice(window.currentInvId) !== inv) return;   // user moved on
      var t = signoffText(a);
      line = content.querySelector('.gl-signoff-status');
      if(!line){
        line = h('div', { class:'gl-signoff-status', style:'max-width:640px;margin:0 auto 10px;font-size:12px;padding:9px 12px;border-radius:8px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08)' });
        content.insertBefore(line, content.firstChild);
      }
      line.setAttribute('data-inv', inv.supaId);
      line.style.color = t.color;
      line.textContent = t.text;
    } finally { signoffBusy = false; }
  }
  window.glRefreshInvoiceSignoffStatus = function(force){ return injectSignoff(!!force); };
  function startSignoffObserver(){
    var detail = document.getElementById('inv-detail');
    if(!detail){ setTimeout(startSignoffObserver, 800); return; }
    new MutationObserver(function(){ setTimeout(function(){ injectSignoff(false); }, 120); })
      .observe(detail, { attributes:true, attributeFilter:['class'], childList:true, subtree:true });
  }
  if(document.readyState !== 'loading') startSignoffObserver();
  else document.addEventListener('DOMContentLoaded', startSignoffObserver);

  /* ── Paperwork check before a production run is scheduled ──────
     Practice (Mike, 2026-11-17): the customer signs the Contract
     Manufacturing Agreement at onboarding, and signs off on the deposit
     invoice BEFORE production is scheduled. Both scheduling paths
     (production-runs.js save, calendar.js production event) call
     glSignoffGate(); it warns and lets staff schedule anyway — a nudge, not
     a block, like the line-conflict warning beside it.

     Reads gl_client_signoff_readiness() (migration 20261118140000), a
     staff-only function, because sales users schedule runs but cannot read
     the admin-only agreements tables. Any failure to check (no function, no
     connection, not staff) returns "unknown" and shows nothing: this must
     never stop production being scheduled. */
  window.glSignoffReadiness = async function glSignoffReadiness(clientId){
    if(!sb() || !/^[0-9a-f-]{36}$/i.test(String(clientId || ''))) return null;
    try {
      var r = await sb().rpc('gl_client_signoff_readiness', { p_client_id: clientId });
      if(r.error || !r.data || typeof r.data !== 'object') return null;
      return r.data;
    } catch(_){ return null; }
  };
  function fmtDay(iso){ try { return new Date(iso).toLocaleDateString(); } catch(_){ return ''; } }
  // Returns the list of missing items (empty = all signed), or null = unknown.
  window.glSignoffGaps = function glSignoffGaps(r){
    if(!r) return null;
    var gaps = [];
    var m = r.manufacturing, a = r.invoice_signoff;
    if(!m) gaps.push('Contract Manufacturing Agreement: never sent. Send it from 📄 Agreements.');
    else if(m.status !== 'signed') gaps.push('Contract Manufacturing Agreement: ' + (m.status === 'sent' ? 'sent ' + fmtDay(m.sent_at) + ', not signed yet.' : m.status + '.'));
    if(!a) gaps.push('Invoice sign-off: none sent. Send ✍️ Customer sign-off on the deposit invoice.');
    else if(a.status !== 'signed') gaps.push('Invoice sign-off' + (a.invoice_number ? ' (' + a.invoice_number + ')' : '') + ': ' + (a.status === 'sent' ? 'sent ' + fmtDay(a.sent_at) + ', not signed yet.' : a.status + '.'));
    return gaps;
  };
  // Resolves true to go ahead with scheduling, false if staff chose to stop.
  window.glSignoffGate = async function glSignoffGate(clientId, clientName){
    var r = await window.glSignoffReadiness(clientId);
    var gaps = window.glSignoffGaps(r);
    if(!gaps || !gaps.length) return true;
    var a = r && r.invoice_signoff;
    var last = a && a.status === 'signed' ? '\n\nLast signed invoice sign-off: ' + (a.invoice_number || '') + ' on ' + fmtDay(a.signed_at) + '.' : '';
    var ok = confirm('Paperwork for ' + (clientName || 'this client') + ' is not complete:\n\n' +
      gaps.map(function(g){ return '• ' + g; }).join('\n') + last +
      '\n\nOur practice: the customer signs before production is scheduled.\n\nSchedule anyway?');
    audit(ok ? 'run_scheduled_without_signoff' : 'run_schedule_stopped_for_signoff', clientName || clientId, { gaps: gaps });
    return ok;
  };

  /* ── Entry points ───────────────────────────────────────────── */
  // Pipeline deal panel: data-gl-arg1 = deal id.
  window.glAgreementsFromDeal = function glAgreementsFromDeal(dealId){
    if(typeof dealId !== 'string' || !dealId) return;
    window.glOpenAgreements({ dealId: dealId });
  };
  // Clients list row: data-gl-arg1 = client id.
  window.glAgreementsForClient = function glAgreementsForClient(clientId){
    if(typeof clientId !== 'string' || !clientId) return;
    window.glOpenAgreements({ clientId: clientId });
  };

  /* ════════════════════════════════════════════════════════════
     Template editor (admin)
     ════════════════════════════════════════════════════════════ */
  window.glOpenAgreementTemplates = async function glOpenAgreementTemplates(){
    if(!isAdmin()){ alert('Admin only.'); return; }
    var prior = document.getElementById('gl-agr-tpl-modal'); if(prior) prior.remove();
    var status = h('div', { style:'font-size:12px;min-height:16px;margin-top:8px' });
    function setStatus(msg, color){ status.style.color = color || '#9aa7bd'; status.textContent = msg || ''; }
    var body = h('div', {}, [h('div', { style:'font-size:12px;color:#6b87ad', text:'Loading…' })]);
    var ov = h('div', { id:'gl-agr-tpl-modal', style:S.overlay }, [
      h('div', { style:S.card }, [
        h('div', { style:'display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px' }, [
          h('div', {}, [
            h('div', { style:S.title, text:'📄 AGREEMENT TEMPLATES' }),
            h('div', { style:'font-size:12px;color:#9aa7bd;margin-top:3px;line-height:1.6',
              text:'"# " = title line, "## " = section heading, blank line = new paragraph. Placeholders: {{effective_date}} {{gl_legal_name}} {{gl_address}} {{client_legal_name}} {{client_address}} {{client_signer_name}} {{client_signer_title}} {{term_years}}. Invoice Acceptance also has {{invoice_number}} {{invoice_date}} {{invoice_lines}} {{invoice_total}} {{payment_terms}} {{kill_step}}. [[SIGNATURES]] inserts the signature block. Changes apply to agreements generated from now on.' })
          ]),
          h('button', { type:'button', style:'background:none;border:1px solid rgba(255,255,255,.15);border-radius:8px;color:#fff;font-size:15px;cursor:pointer;padding:4px 10px', onclick:function(){ ov.remove(); } }, ['✕'])
        ]),
        body, status
      ])
    ]);
    (document.getElementById('crm-panel') || document.body).appendChild(ov);

    var r = await sb().from('agreement_templates').select('kind,title,body,updated_at').order('kind');
    clear(body);
    if(r.error){ setStatus('Could not load templates: ' + r.error.message, '#ff8579'); return; }
    (r.data || []).forEach(function(t){
      var titleIn = h('input', { type:'text', value:t.title, style:S.inp });
      var ta = h('textarea', { style:S.inp + ';min-height:320px;font-family:Georgia,serif;font-size:12px;line-height:1.5;resize:vertical', spellcheck:'true' });
      ta.value = t.body;
      var meta = h('div', { style:'font-size:11px;color:#6b87ad;margin-top:4px', text:'Last changed ' + new Date(t.updated_at).toLocaleString() });
      var save = h('button', { type:'button', style:S.btnPri, onclick: async function(){
        if(!ta.value.trim() || !titleIn.value.trim()){ setStatus('Title and text are required.', '#f5c842'); return; }
        save.disabled = true;
        var u = await sb().from('agreement_templates').update({ title: titleIn.value.trim(), body: ta.value })
          .eq('kind', t.kind).select('kind,updated_at');
        save.disabled = false;
        if(u.error){ setStatus('Save failed: ' + u.error.message, '#ff8579'); return; }
        if(!u.data || !u.data.length){ setStatus('Save failed: the database did not accept the change.', '#ff8579'); return; }
        meta.textContent = 'Last changed ' + new Date(u.data[0].updated_at).toLocaleString();
        audit('agreement_template_saved', t.kind, {});
        setStatus((KINDS[t.kind] ? KINDS[t.kind].label : t.kind) + ' template saved.', '#5fcf9e');
      } }, ['Save ' + (KINDS[t.kind] ? KINDS[t.kind].label : t.kind)]);
      body.appendChild(h('div', { style:S.section }, [
        h('span', { style:S.lbl, text:(KINDS[t.kind] ? KINDS[t.kind].icon + ' ' + KINDS[t.kind].label : t.kind).toUpperCase() }),
        h('label', { style:S.lbl, text:'TITLE' }), titleIn,
        h('label', { style:S.lbl + ';margin-top:10px', text:'TEXT' }), ta,
        meta,
        h('div', { style:'margin-top:10px' }, [save])
      ]));
    });
  };

  if(typeof window.glRegisterActions === 'function'){
    window.glRegisterActions({
      glAgreementsFromDeal: window.glAgreementsFromDeal,
      glAgreementsForClient: window.glAgreementsForClient
    });
  }
}());
