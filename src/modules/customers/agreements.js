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
    manufacturing: { label: 'Manufacturing Agreement', docType: 'Manufacturing Agreement', icon: '🏭' }
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
  function signatureBlock(f){
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
    return party('Good Liquid', f.gl_legal_name, f.gl_signer_name, f.gl_signer_title) +
      '\n\n' + party('Company', f.client_legal_name, f.client_signer_name, f.client_signer_title);
  }
  function fillTemplate(body, f){
    var missing = [];
    var out = String(body || '').replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, function(_, k){
      var v = f[k];
      if(v == null || String(v).trim() === ''){ missing.push(k); return '[' + k.toUpperCase() + ']'; }
      return String(v).trim();
    });
    out = out.replace('[[SIGNATURES]]', signatureBlock(f));
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

    var state = { kind:'nda', templates:{}, fields: ctx.fields, generated:'', savedId:null, savedDocId:null };
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
      var res = fillTemplate(tpl.body, state.fields);
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
              text:'"# " = title line, "## " = section heading, blank line = new paragraph. Placeholders: {{effective_date}} {{gl_legal_name}} {{gl_address}} {{client_legal_name}} {{client_address}} {{client_signer_name}} {{client_signer_title}} {{term_years}}. [[SIGNATURES]] inserts the signature block. Changes apply to agreements generated from now on.' })
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
