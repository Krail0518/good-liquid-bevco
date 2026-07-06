/* ============================================================
   COMPLIANCE FINAL — JS-ONLY ENHANCEMENTS (PR D)
   Ships 6 features that don't need SQL or new DB tables:
     6.  Email digest (manual now + cron SQL provided in PR B)
     8.  Barcode/QR scan for Trace Lot (BarcodeDetector API)
    13.  OCR receiving COA via Claude Vision
    15.  PWA install prompt + manifest verification
    18.  AI root-cause suggester on NCR/Defect modal
    19.  Monthly trend report (printable PDF)
   ============================================================ */
(function(){
  function esc(v){ return v == null ? '' : String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function fmtDate(d){ if(!d) return ''; var x = new Date(d); return isNaN(x.getTime()) ? String(d) : x.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}); }
  function fmtTs(d){ if(!d) return ''; var x = new Date(d); return isNaN(x.getTime()) ? String(d) : x.toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}); }
  function nowISO(){ return new Date().toISOString(); }
  function todayISO(){ return new Date().toISOString().slice(0,10); }
  // DEPRECATED: these getters used to read API credentials out of
  // localStorage. The Mailgun key + AI key now live in Supabase secrets,
  // and the from-address is set inside the mailgun-send Edge Function.
  // The stubs are kept only because legacy callers reference them; they
  // return empty strings so any leftover client-side send paths fail
  // closed instead of leaking credentials.
  function getMailgunKey(){ return ''; }
  function getMailgunDomain(){ return 'mail.goodliquidbevco.com'; }
  function getMailgunFrom(){ return 'Good Liquid Bev Co <noreply@mail.goodliquidbevco.com>'; }
  function getAiKey(){ return ''; }

  async function sendMailgun(to, subject, text, html){
    if(!window.supa || !window.supa.functions){
      return { ok:false, error:'Supabase client not ready' };
    }
    try {
      var resp = await window.supa.functions.invoke('mailgun-send', {
        body: { to: to, subject: subject, text: text || '', html: html || undefined }
      });
      if(resp.error){ return { ok:false, error: resp.error.message || 'Mailgun call failed' }; }
      if(resp.data && resp.data.ok === false){ return { ok:false, error: resp.data.error || 'Mailgun rejected' }; }
      return { ok:true };
    } catch(e){ return { ok:false, error: e.message || 'send failed' }; }
  }

  async function askClaude(prompt, opts){
    opts = opts || {};
    if(!window.supa || !window.supa.functions){
      return { ok:false, error:'Supabase client not ready' };
    }
    // Build the messages array. For Vision (imageDataUrl), wrap into the
    // multi-part content shape Anthropic expects.
    var content = opts.imageDataUrl
      ? [{ type:'image', source:{ type:'base64', media_type: opts.imageDataUrl.match(/^data:([^;]+);/)[1], data: opts.imageDataUrl.split(',')[1] } }, { type:'text', text: prompt }]
      : prompt;
    try {
      var resp = await window.supa.functions.invoke('ai-proxy', {
        body: {
          model: opts.model || 'claude-sonnet-4-6',
          maxTokens: opts.max_tokens || 800,
          messages: [{ role:'user', content: content }]
        }
      });
      if(resp.error){ return { ok:false, error: resp.error.message || 'AI request failed' }; }
      if(resp.data && resp.data.ok === false){ return { ok:false, error: resp.data.error || 'AI rejected' }; }
      return { ok:true, text: (resp.data && resp.data.text) || '' };
    } catch(e){ return { ok:false, error: e.message || 'AI call failed' }; }
  }

  // ============================================================
  // (6) EMAIL DIGEST — daily compliance brief
  // ============================================================
  async function buildDigest(){
    if(!window.supa) return null;
    var sevenDaysAgo = new Date(Date.now() - 7*86400000).toISOString();
    var oneDayAgo = new Date(Date.now() - 86400000).toISOString();
    var today = todayISO();
    // Pull data
    var yesterdaysRecs = await window.supa.from('compliance_records').select('form_code,recorded_at,status,has_deviation,deviation_notes,signature_name').gt('recorded_at', oneDayAgo).order('recorded_at',{ascending:false}).limit(50);
    var openHolds = await window.supa.from('hold_tags').select('tag_number,product_name,reason,hold_date').eq('status','open').order('hold_date',{ascending:true}).limit(20);
    var unsignedOld = await window.supa.from('compliance_records').select('form_code,recorded_at').neq('status','signed').neq('status','voided').lt('recorded_at', sevenDaysAgo).limit(20);
    var todaysTasks = await window.supa.from('compliance_tasks').select('title,task_type,status').eq('due_date', today);
    var data = {
      yesterdays_count: (yesterdaysRecs.data || []).length,
      yesterdays_deviations: (yesterdaysRecs.data || []).filter(function(r){ return r.has_deviation; }),
      open_holds: openHolds.data || [],
      unsigned_old: unsignedOld.data || [],
      todays_open: (todaysTasks.data || []).filter(function(t){ return t.status === 'open'; }),
      todays_done: (todaysTasks.data || []).filter(function(t){ return t.status === 'done'; })
    };
    return data;
  }

  function digestHtml(data){
    if(!data) return '';
    return '<html><body style="font-family:Helvetica,Arial,sans-serif;color:#0a1628;max-width:640px;margin:0 auto;padding:24px">' +
      '<h1 style="font-size:18px;color:#0a8;margin:0 0 6px">Good Liquid · Compliance Daily Digest</h1>' +
      '<div style="color:#666;font-size:11px;margin-bottom:18px">' + fmtDate(new Date()) + '</div>' +
      // Open holds
      '<div style="margin-bottom:18px"><h2 style="font-size:13px;margin:0 0 6px;color:' + (data.open_holds.length?'#c41e3a':'#0a8') + '">' +
        '🚫 Open Hold Tags · ' + data.open_holds.length + '</h2>' +
        (data.open_holds.length ?
          '<ul style="margin:4px 0;padding-left:20px;font-size:12px;line-height:1.6">' +
          data.open_holds.map(function(h){ return '<li><b>' + h.tag_number + '</b> — ' + esc(h.product_name) + ' · ' + esc((h.reason||'').slice(0,80)) + '</li>'; }).join('') +
          '</ul>' : '<div style="font-size:12px;color:#666">All clear — no holds blocking shipment.</div>') +
      '</div>' +
      // Today's tasks
      '<div style="margin-bottom:18px"><h2 style="font-size:13px;margin:0 0 6px">📋 Today\'s Tasks · ' + data.todays_open.length + ' open · ' + data.todays_done.length + ' done</h2>' +
        (data.todays_open.length ?
          '<ul style="margin:4px 0;padding-left:20px;font-size:12px;line-height:1.6">' +
          data.todays_open.map(function(t){ return '<li>' + esc(t.title) + '</li>'; }).join('') +
          '</ul>' : '<div style="font-size:12px;color:#666">No open tasks.</div>') +
      '</div>' +
      // Yesterday's deviations
      '<div style="margin-bottom:18px"><h2 style="font-size:13px;margin:0 0 6px;color:' + (data.yesterdays_deviations.length?'#c41e3a':'#0a8') + '">' +
        '⚠ Deviations in last 24h · ' + data.yesterdays_deviations.length + '</h2>' +
        (data.yesterdays_deviations.length ?
          '<ul style="margin:4px 0;padding-left:20px;font-size:12px;line-height:1.6">' +
          data.yesterdays_deviations.map(function(r){ return '<li><b>' + r.form_code + '</b> at ' + fmtTs(r.recorded_at) + ' — ' + esc((r.deviation_notes||'').slice(0,120)) + '</li>'; }).join('') +
          '</ul>' : '<div style="font-size:12px;color:#666">None.</div>') +
      '</div>' +
      // Unsigned >7d
      (data.unsigned_old.length ? '<div style="margin-bottom:18px;padding:10px 14px;background:#fef0ef;border-left:3px solid #c41e3a;border-radius:0 6px 6px 0">' +
        '<b style="color:#c41e3a">' + data.unsigned_old.length + ' records older than 7 days awaiting PCQI sign-off.</b>' +
        '<div style="font-size:11px;color:#666;margin-top:4px">Open the CRM → Compliance → Weekly Review.</div>' +
      '</div>' : '') +
      '<div style="font-size:10px;color:#999;margin-top:24px;padding-top:14px;border-top:1px solid #e5e7eb">' +
        'This digest covers Compliance status. Open the CRM at <a href="https://www.goodliquidbevco.com" style="color:#0a8">goodliquidbevco.com</a> for full audit-ready records.' +
      '</div>' +
    '</body></html>';
  }

  window.glSendComplianceDigest = async function(){
    var to = prompt('Send compliance digest to (email):', (window.currentUser && window.currentUser.email) || '');
    if(!to) return;
    var data = await buildDigest();
    if(!data){ alert('Supabase not loaded'); return; }
    var html = digestHtml(data);
    var subject = '[GLBC Compliance] ' + fmtDate(new Date()) + ' · ' +
      (data.open_holds.length ? '🚫 ' + data.open_holds.length + ' holds · ' : '') +
      (data.todays_open.length ? data.todays_open.length + ' open tasks' : 'no open tasks');
    if(typeof window.glStartBusy === 'function') window.glStartBusy('Sending digest…');
    var r = await sendMailgun(to, subject, '', html);
    if(typeof window.glEndBusy === 'function') window.glEndBusy();
    if(r.ok){
      if(typeof addNotification === 'function') addNotification('📧 Digest sent', to, 'success');
      if(typeof window.glAudit === 'function') window.glAudit('compliance_digest_sent','', { to: to });
    } else {
      alert('Send failed: ' + r.error);
    }
  };

  // ============================================================
  // (8) BARCODE / QR SCAN for Trace Lot
  // ============================================================
  window.glOpenLotScanner = async function(){
    if(!('BarcodeDetector' in window)){
      alert('Barcode scanner not supported in this browser. Use Chrome on Android or a desktop Chrome. (You can also paste the lot manually.)');
      return;
    }
    var prior = document.getElementById('gl-scan-modal'); if(prior) prior.remove();
    var ov = document.createElement('div');
    ov.id = 'gl-scan-modal';
    ov.setAttribute('style','position:fixed;inset:0;z-index:9000;background:#000;display:flex;align-items:center;justify-content:center');
    ov.innerHTML =
      '<video id="gl-scan-video" autoplay playsinline muted style="max-width:100%;max-height:100%"></video>' +
      '<div style="position:absolute;top:0;left:0;right:0;padding:14px;background:linear-gradient(180deg,rgba(0,0,0,.7),transparent);color:#fff;font-family:sans-serif;display:flex;justify-content:space-between;align-items:center">' +
        '<div style="font-size:13px;font-weight:600">📱 Point camera at a lot QR code</div>' +
        '<button id="gl-scan-close" style="background:rgba(255,255,255,.15);border:none;color:#fff;font-size:14px;padding:6px 14px;border-radius:6px;cursor:pointer">✕ Close</button>' +
      '</div>' +
      '<div id="gl-scan-status" style="position:absolute;bottom:30px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,.7);color:#fff;padding:10px 18px;border-radius:8px;font-family:sans-serif;font-size:13px">Initializing camera…</div>';
    document.body.appendChild(ov);
    var video = ov.querySelector('#gl-scan-video');
    var status = ov.querySelector('#gl-scan-status');
    var stream = null, running = true;
    function close(){
      running = false;
      if(stream) stream.getTracks().forEach(function(t){ t.stop(); });
      ov.remove();
    }
    ov.querySelector('#gl-scan-close').addEventListener('click', close);

    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      video.srcObject = stream;
      await video.play();
    } catch(e){
      status.textContent = 'Camera blocked: ' + (e.message || 'denied');
      return;
    }
    var detector = new window.BarcodeDetector({ formats:['qr_code','code_128','code_39','ean_13','ean_8'] });
    status.textContent = 'Scanning… hold a lot QR code in frame';
    async function scanLoop(){
      if(!running) return;
      try {
        var codes = await detector.detect(video);
        if(codes.length){
          var raw = codes[0].rawValue;
          // Try to extract lot from a trace URL (?trace=LOT) or use raw
          var lot = raw;
          var m = raw.match(/[?&]trace=([^&]+)/);
          if(m) lot = decodeURIComponent(m[1]);
          status.textContent = '✓ Found: ' + lot;
          setTimeout(function(){
            close();
            // Navigate to compliance + open Trace Lot tab
            if(typeof window.cNav === 'function') window.cNav('compliance');
            setTimeout(function(){
              // Click Trace Lot tab
              var traceTab = document.querySelector('#comp-body .gl-comp-extratab[data-extra-tab="trace"]');
              if(traceTab) traceTab.click();
              setTimeout(function(){
                var input = document.getElementById('gl-trace-q');
                if(input){ input.value = lot; var go = document.getElementById('gl-trace-go'); if(go) go.click(); }
              }, 400);
            }, 300);
          }, 600);
          return;
        }
      } catch(e){}
      requestAnimationFrame(scanLoop);
    }
    scanLoop();
  };
  // Inject "📸 Scan QR" button next to the Trace Lot search input
  (function injectScanBtn(){
    var host = document.getElementById('comp-body');
    if(!host){ setTimeout(injectScanBtn, 700); return; }
    new MutationObserver(function(){
      var goBtn = document.getElementById('gl-trace-go');
      if(!goBtn) return;
      if(goBtn.parentNode.querySelector('.gl-trace-scan-btn')) return;
      var b = document.createElement('button');
      b.className = 'cbtn gl-trace-scan-btn';
      b.setAttribute('style','padding:9px 14px;background:rgba(95,207,158,.1);border:1px solid rgba(95,207,158,.32);color:#5fcf9e;margin-left:6px');
      b.textContent = '📸 Scan QR';
      b.addEventListener('click', function(){ window.glOpenLotScanner(); });
      goBtn.parentNode.appendChild(b);
    }).observe(host, { childList:true, subtree:true });
  })();

  // ============================================================
  // (13) OCR RECEIVING COA — extract fields from a photo via Claude Vision
  // ============================================================
  // Hook into the receiving form: when it opens, add a "📷 Scan COA"
  // button that uploads an image and auto-fills the form fields.
  function injectCoaScanIntoReceiving(){
    var modal = document.getElementById('gl-comp-modal');
    if(!modal) return;
    if(modal.dataset.glCoaScanInjected === '1') return;
    if(!modal.querySelector('#gl-cf-supplier')) return;
    modal.dataset.glCoaScanInjected = '1';
    var hint = document.createElement('div');
    hint.setAttribute('style','margin:6px 0 14px;padding:9px 13px;background:rgba(196,164,248,.08);border:1px solid rgba(196,164,248,.3);border-radius:6px;display:flex;align-items:center;gap:10px;font-size:11px');
    hint.innerHTML = '<span style="font-size:14px">📷</span>' +
      '<div style="flex:1">Snap a photo of the COA — AI will read it and auto-fill the form.</div>' +
      '<input type="file" id="gl-coa-file" accept="image/*" capture="environment" style="display:none">' +
      '<button class="cbtn gl-coa-trigger" style="font-size:11px;padding:4px 10px">Pick image</button>';
    var firstField = modal.querySelector('#gl-cf-supplier');
    if(firstField && firstField.parentNode) firstField.parentNode.parentNode.insertBefore(hint, firstField.parentNode);
    var fileInput = hint.querySelector('#gl-coa-file');
    hint.querySelector('.gl-coa-trigger').addEventListener('click', function(){ fileInput.click(); });
    fileInput.addEventListener('change', async function(){
      var f = fileInput.files[0]; if(!f) return;
      if(!getAiKey()){ alert('Add your Anthropic key first (AI toolbar → AI Settings)'); return; }
      hint.querySelector('.gl-coa-trigger').textContent = 'Reading COA…';
      hint.querySelector('.gl-coa-trigger').disabled = true;
      var reader = new FileReader();
      reader.onload = async function(){
        var dataUrl = reader.result;
        var prompt = 'You are extracting fields from a Certificate of Analysis (COA) for a beverage ingredient. ' +
          'Return ONLY a JSON object with these keys (use empty string if not found): ' +
          'supplier, ingredient, lot, qty, micro_pass (Y/N or empty if not stated), allergen_declared (Y/N), visual (OK/NG). ' +
          'No prose. Just the JSON.';
        var r = await askClaude(prompt, { imageDataUrl: dataUrl, max_tokens: 400 });
        hint.querySelector('.gl-coa-trigger').disabled = false;
        hint.querySelector('.gl-coa-trigger').textContent = 'Pick image';
        if(!r.ok){ alert('COA read failed: ' + r.error); return; }
        // Parse JSON out of the response (model may wrap in code fences)
        var jsonMatch = r.text.match(/\{[\s\S]*\}/);
        if(!jsonMatch){ alert('AI could not extract fields. Raw:\n' + r.text.slice(0,200)); return; }
        try {
          var ex = JSON.parse(jsonMatch[0]);
          // Fill matching fields
          if(ex.supplier){ var s = modal.querySelector('#gl-cf-supplier'); if(s){ if(s.tagName === 'SELECT'){ for(var i=0;i<s.options.length;i++){ if(s.options[i].value.toLowerCase().indexOf(ex.supplier.toLowerCase()) !== -1){ s.value = s.options[i].value; break; } } } else { s.value = ex.supplier; } } }
          if(ex.ingredient) modal.querySelector('#gl-cf-ingredient').value = ex.ingredient;
          if(ex.lot)        modal.querySelector('#gl-cf-lot').value = ex.lot;
          if(ex.qty)        modal.querySelector('#gl-cf-qty').value = ex.qty;
          // Yes/No fields rely on hidden inputs set by YN buttons — mark them directly
          function setHidden(name, val){
            var h = modal.querySelector('#gl-cf-' + name);
            if(h) h.value = val;
            var btns = modal.querySelectorAll('button[data-yn="gl-cf-' + name + '"]');
            btns.forEach(function(b){
              var v = b.getAttribute('data-val');
              if(v === val){ b.style.background = v === 'Y' ? 'rgba(95,207,158,.18)' : 'rgba(231,76,60,.18)'; b.style.color = v === 'Y' ? '#5fcf9e' : '#ff8579'; }
            });
          }
          if(ex.micro_pass === 'Y') setHidden('coa', 'Y');
          if(ex.allergen_declared) setHidden('allergen', ex.allergen_declared);
          if(ex.visual === 'OK') setHidden('visual', 'Y');
          hint.innerHTML = '<span style="font-size:14px;color:#5fcf9e">✓</span><div style="flex:1;color:#5fcf9e;font-weight:600">Fields auto-filled — review + confirm before signing</div>';
        } catch(e){
          alert('AI returned invalid JSON: ' + jsonMatch[0].slice(0,200));
        }
      };
      reader.readAsDataURL(f);
    });
  }
  new MutationObserver(function(muts){
    muts.forEach(function(m){
      if(!m.addedNodes) return;
      m.addedNodes.forEach(function(n){
        if(n.nodeType !== 1) return;
        var title = n.textContent || '';
        if(title.indexOf('GMP-REC-001') !== -1) setTimeout(injectCoaScanIntoReceiving, 60);
      });
    });
  }).observe(document.body, { childList:true, subtree:true });

  // ============================================================
  // (15) PWA INSTALL PROMPT
  // ============================================================
  // PWA install prompt — DISABLED here.
  // There were three independent beforeinstallprompt listeners across
  // the codebase (two in fix.js, one in index.html), each appending its
  // own banner. A fresh load on the marketing site showed three
  // "Install Good Liquid CRM" prompts simultaneously. The canonical
  // handler now lives only in index.html (showInstallBanner + installPWA).
  // This stub stays so any future grep finds it but it never mounts UI.
  // Caught during the Playwright runtime audit on 2026-05-21.
  (function pwaPromptDisabled(){
    /* no-op */
  })();
  // ============================================================
  // (18) AI ROOT-CAUSE SUGGESTER on NCR / defect modal
  // ============================================================
  function injectAiRootCauseIntoDefect(){
    var modal = document.getElementById('gl-comp-modal');
    if(!modal) return;
    if(modal.dataset.glRootCauseInjected === '1') return;
    var rootField = modal.querySelector('#gl-def-root');
    if(!rootField) return;
    modal.dataset.glRootCauseInjected = '1';
    var btn = document.createElement('button');
    btn.className = 'cbtn';
    btn.type = 'button';
    btn.setAttribute('style','margin-top:6px;font-size:11px;padding:5px 11px;background:rgba(196,164,248,.1);border:1px solid rgba(196,164,248,.32);color:#c4a4f8');
    btn.textContent = '🤖 Suggest root cause via AI';
    rootField.parentNode.appendChild(btn);
    btn.addEventListener('click', async function(){
      if(!getAiKey()){ alert('Add Anthropic key first (AI toolbar → AI Settings)'); return; }
      var desc = modal.querySelector('#gl-def-desc').value;
      var cat = modal.querySelector('#gl-def-cat').value;
      var sev = modal.querySelector('#gl-def-sev').value;
      if(!desc){ alert('Fill in the "What was observed" description first.'); return; }
      btn.disabled = true; btn.textContent = 'Thinking…';
      // Pull similar past defects to inform the model
      var similar = await window.supa.from('defects').select('category,severity,description,root_cause,corrective_action').eq('category', cat).neq('root_cause','').order('reported_at',{ascending:false}).limit(5);
      var hist = (similar.data || []).map(function(d){ return '— ' + d.severity + ': ' + (d.description||'').slice(0,100) + ' → ROOT: ' + (d.root_cause||'').slice(0,150); }).join('\n');
      var prompt = 'You are a food-safety QA expert helping a beverage co-packer (Good Liquid Bev Co, Palmetto FL) identify root causes for production deviations. ' +
        'Category: ' + cat + ' · Severity: ' + sev + ' · Observed: ' + desc + '\n\n' +
        (hist ? 'Past similar NCRs at this facility:\n' + hist + '\n\n' : '') +
        'Suggest 1-2 most likely root causes, in concise, actionable language. Then suggest a corrective action. ' +
        'Format:\nROOT CAUSE:\n- ...\nCORRECTIVE ACTION:\n- ...';
      var r = await askClaude(prompt, { max_tokens: 500 });
      btn.disabled = false; btn.textContent = '🤖 Suggest root cause via AI';
      if(!r.ok){ alert('AI failed: ' + r.error); return; }
      // Parse Claude output
      var rootMatch = r.text.match(/ROOT CAUSE:?\s*([\s\S]*?)(?:CORRECTIVE ACTION|$)/i);
      var corrMatch = r.text.match(/CORRECTIVE ACTION:?\s*([\s\S]*)/i);
      if(rootMatch){ rootField.value = rootMatch[1].trim().replace(/^[-\s]+/m,''); }
      var corr = modal.querySelector('#gl-def-corr');
      if(corr && corrMatch){ corr.value = corrMatch[1].trim().replace(/^[-\s]+/m,''); }
      if(!rootMatch && !corrMatch){ rootField.value = r.text.trim(); }
      if(typeof addNotification === 'function') addNotification('🤖 AI suggested root cause','Review + edit before saving','info');
    });
  }
  new MutationObserver(function(muts){
    muts.forEach(function(m){
      if(!m.addedNodes) return;
      m.addedNodes.forEach(function(n){
        if(n.nodeType !== 1) return;
        // Look for the defect modal — first td/label "Category" is a good signal
        setTimeout(function(){
          var modal = document.getElementById('gl-comp-modal');
          if(modal && modal.querySelector && modal.querySelector('#gl-def-root')) injectAiRootCauseIntoDefect();
        }, 60);
      });
    });
  }).observe(document.body, { childList:true, subtree:true });

  // ============================================================
  // (19) MONTHLY TREND REPORT (printable PDF)
  // ============================================================
  window.glGenerateMonthlyReport = async function(){
    if(!window.supa){ alert('Supabase not loaded'); return; }
    var fromIso = new Date(Date.now() - 30*86400000).toISOString();
    var rec = await window.supa.from('compliance_records').select('*').gt('recorded_at', fromIso).order('recorded_at',{ascending:false}).limit(2000);
    var holdR = await window.supa.from('hold_tags').select('*').gt('created_at', fromIso).limit(200);
    var rows = rec.data || [];
    var holds = holdR.data || [];
    // Aggregate
    var byForm = {};
    var deviations = [];
    var byDay = {};
    rows.forEach(function(r){
      byForm[r.form_code] = (byForm[r.form_code] || 0) + 1;
      if(r.has_deviation) deviations.push(r);
      var day = (r.record_date || '').slice(0,10);
      byDay[day] = (byDay[day] || 0) + 1;
    });
    var formList = Object.keys(byForm).sort(function(a,b){ return byForm[b] - byForm[a]; });
    // CCP averages
    var ccps = ['FSP-PC-001','FSP-PC-002','FSP-PC-004','FSP-PC-005'];
    var ccpStats = {};
    ccps.forEach(function(code){
      var matching = rows.filter(function(r){ return r.form_code === code; });
      if(!matching.length) return;
      var field = (code === 'FSP-PC-004') ? 'dose' : ((code === 'FSP-PC-005') ? 'ph_final' : 'temp_f');
      var values = matching.map(function(r){ var v = r.data && r.data[field]; return typeof v === 'number' ? v : parseFloat(v); }).filter(function(v){ return !isNaN(v); });
      if(!values.length) return;
      ccpStats[code] = {
        count: values.length,
        avg: (values.reduce(function(a,b){return a+b;},0) / values.length).toFixed(2),
        min: Math.min.apply(null, values).toFixed(2),
        max: Math.max.apply(null, values).toFixed(2),
        field: field
      };
    });

    var w = window.open('','_blank');
    if(!w){ alert('Pop-up blocked'); return; }
    var html = '<!doctype html><html><head><meta charset="utf-8"><title>Monthly QC Report — ' + fmtDate(new Date()) + '</title>' +
      '<style>body{font-family:Helvetica,Arial,sans-serif;color:#0a1628;margin:24px;font-size:11px;line-height:1.5}h1{font-size:20px;margin:0 0 4px;color:#0a8}.meta{color:#666;font-size:11px;margin-bottom:18px}h2{font-size:14px;border-bottom:2px solid #0a8;padding-bottom:4px;margin-top:18px}.kpi{display:inline-block;margin-right:16px;margin-bottom:8px;padding:8px 12px;background:#f5f5f5;border-radius:6px}.kpi b{font-size:18px;color:#0a8;display:block}.dev{padding:5px 8px;border-bottom:1px solid #eee;font-size:10px}.dev b{color:#c41e3a}@media print{.no-print{display:none}body{margin:12px}}</style>' +
      '</head><body>' +
      '<h1>Compliance Monthly Report</h1>' +
      '<div class="meta">Good Liquid Bev Co · ' + fmtDate(new Date(Date.now()-30*86400000)) + ' to ' + fmtDate(new Date()) + ' · generated ' + fmtTs(new Date()) + '</div>' +
      '<div class="no-print" style="margin-bottom:18px"><button onclick="window.print()" style="padding:8px 16px;background:#0a8;color:#fff;border:none;border-radius:4px;cursor:pointer;font-weight:700">🖨️ Print / Save as PDF</button> <button onclick="window.close()" style="margin-left:6px">Close</button></div>' +
      '<h2>Headline KPIs</h2>' +
      '<div>' +
        '<div class="kpi"><b>' + rows.length + '</b>Total records</div>' +
        '<div class="kpi"><b>' + rows.filter(function(r){return r.status==='signed';}).length + '</b>PCQI-signed</div>' +
        '<div class="kpi" style="color:' + (deviations.length?'#c41e3a':'#0a8') + '"><b>' + deviations.length + '</b>Deviations</div>' +
        '<div class="kpi"><b>' + holds.length + '</b>Hold tags</div>' +
        '<div class="kpi"><b>' + Object.keys(byDay).length + '</b>Active days</div>' +
      '</div>' +
      '<h2>Records by form</h2>' +
      '<table style="width:100%;border-collapse:collapse;font-size:11px;margin-top:8px">' +
        '<thead><tr style="background:#f5f5f5"><th style="text-align:left;padding:4px 8px">Form</th><th style="text-align:right;padding:4px 8px">Count</th></tr></thead><tbody>' +
        formList.map(function(c){ return '<tr><td style="padding:4px 8px;border-bottom:1px solid #eee">' + c + '</td><td style="text-align:right;padding:4px 8px;border-bottom:1px solid #eee">' + byForm[c] + '</td></tr>'; }).join('') +
      '</tbody></table>' +
      (Object.keys(ccpStats).length ? '<h2>CCP statistics</h2>' +
        '<table style="width:100%;border-collapse:collapse;font-size:11px;margin-top:8px">' +
          '<thead><tr style="background:#f5f5f5"><th style="text-align:left;padding:4px 8px">CCP</th><th style="padding:4px 8px">n</th><th style="padding:4px 8px">Field</th><th style="padding:4px 8px">Avg</th><th style="padding:4px 8px">Min</th><th style="padding:4px 8px">Max</th></tr></thead><tbody>' +
          Object.keys(ccpStats).map(function(c){ var s = ccpStats[c]; return '<tr><td style="padding:4px 8px;border-bottom:1px solid #eee">' + c + '</td><td style="text-align:center;padding:4px 8px;border-bottom:1px solid #eee">' + s.count + '</td><td style="padding:4px 8px;border-bottom:1px solid #eee">' + s.field + '</td><td style="text-align:right;padding:4px 8px;border-bottom:1px solid #eee">' + s.avg + '</td><td style="text-align:right;padding:4px 8px;border-bottom:1px solid #eee">' + s.min + '</td><td style="text-align:right;padding:4px 8px;border-bottom:1px solid #eee">' + s.max + '</td></tr>'; }).join('') +
        '</tbody></table>' : '') +
      '<h2>Deviations · ' + deviations.length + '</h2>' +
      (deviations.length ? deviations.map(function(d){ return '<div class="dev"><b>' + d.form_code + '</b> · ' + fmtTs(d.recorded_at) + ' · ' + esc((d.deviation_notes||'').slice(0,200)) + (d.corrective_action ? ' · <i>action:</i> ' + esc(d.corrective_action.slice(0,150)) : '') + '</div>'; }).join('') : '<div style="color:#0a8">No deviations this period.</div>') +
      '<h2>Hold tags · ' + holds.length + '</h2>' +
      (holds.length ? '<table style="width:100%;border-collapse:collapse;font-size:11px"><thead><tr style="background:#f5f5f5"><th style="text-align:left;padding:4px 8px">Tag</th><th style="text-align:left;padding:4px 8px">Product</th><th style="text-align:left;padding:4px 8px">Status</th><th style="text-align:left;padding:4px 8px">Reason</th></tr></thead><tbody>' + holds.map(function(h){ return '<tr><td style="padding:4px 8px;border-bottom:1px solid #eee">' + esc(h.tag_number) + '</td><td style="padding:4px 8px;border-bottom:1px solid #eee">' + esc(h.product_name) + '</td><td style="padding:4px 8px;border-bottom:1px solid #eee">' + esc(h.status) + '</td><td style="padding:4px 8px;border-bottom:1px solid #eee">' + esc((h.reason||'').slice(0,140)) + '</td></tr>'; }).join('') + '</tbody></table>' : '<div style="color:#0a8">No hold tags this period.</div>') +
      '<h2>PCQI sign-off</h2>' +
      '<div>Reviewed and approved by: ' + esc(window.currentUser && (window.currentUser.name || window.currentUser.email) || 'PCQI') + '</div>' +
      '<div>Signature: _________________________________</div>' +
      '<div>Date: _________________________________</div>' +
      '<div style="margin-top:24px;color:#666;font-size:10px">Audit-ready report — for monthly QC review and external auditor packages. Generated from compliance_records table covering the last 30 days.</div>' +
      '</body></html>';
    w.document.write(html); w.document.close();
  };

  // ============================================================
  // Wire all new buttons onto the Compliance master page header
  // ============================================================
  (function injectFinalButtons(){
    var host = document.getElementById('comp-body');
    if(!host){ setTimeout(injectFinalButtons, 700); return; }
    new MutationObserver(function(){
      var addBtn = host.querySelector('.gl-comp-applic');
      if(!addBtn) return;
      if(addBtn.parentNode.querySelector('.gl-comp-digest')) return;
      function btn(cls, text, c, fn){
        var b = document.createElement('button'); b.className = 'cbtn ' + cls;
        b.setAttribute('style','font-size:11px;padding:5px 11px;margin-right:6px;background:' + c.bg + ';border:1px solid ' + c.bd + ';color:' + c.fg);
        b.textContent = text; b.addEventListener('click', fn);
        return b;
      }
      var report = btn('gl-comp-report', '📊 Monthly report', { bg:'rgba(127,198,245,.08)', bd:'rgba(127,198,245,.3)', fg:'#7fc6f5' }, function(){ window.glGenerateMonthlyReport(); });
      var digest = btn('gl-comp-digest', '📧 Send digest',    { bg:'rgba(245,200,66,.08)',  bd:'rgba(245,200,66,.3)',  fg:'#f5c842' }, function(){ window.glSendComplianceDigest(); });
      addBtn.parentNode.insertBefore(digest, addBtn);
      addBtn.parentNode.insertBefore(report, addBtn);
    }).observe(host, { childList:true, subtree:true });
  })();

  console.log('[GL] compliance final JS pack — 6 features: email digest + barcode scan + OCR COA + PWA prompt + AI root-cause + monthly report');
}());

/* ============================================================
   COMPLIANCE SQL-BACKED PACK (PR E)
   Four enhancements requiring the 20260518_phase4_sql_pack.sql migration:
     #10 Multi-PCQI sign-off (second signature on compliance_records)
     #11 Inspector read-only mode (anon token-bound view)
     #16 Multi-facility scoping (facilities table + facility_id stamping)
     #17 Customer-managed allergen declarations (per-client portal)
   All four degrade gracefully if migration is not yet applied — the new
   tables/columns are referenced via try/catch and missing-column tolerance.
   ============================================================ */
(function(){
  var sb = (function(){
    try { return window.supabase || (window.__GL && window.__GL.supabase) || null; }
    catch(e){ return null; }
  })();

  function getSB(){ return sb || window.supabase || null; }
  function $(q, root){ return (root||document).querySelector(q); }
  function $$(q, root){ return Array.prototype.slice.call((root||document).querySelectorAll(q)); }
  function toast(msg, kind){
    var d = document.createElement('div');
    d.textContent = msg;
    d.style.cssText = 'position:fixed;bottom:20px;right:20px;background:'+(kind==='err'?'#b91c1c':'#0f766e')+';color:#fff;padding:12px 18px;border-radius:8px;z-index:99999;font:14px system-ui;box-shadow:0 4px 12px rgba(0,0,0,.2);max-width:360px;';
    document.body.appendChild(d);
    setTimeout(function(){ d.remove(); }, 4500);
  }
  function randToken(){
    var a = new Uint8Array(18); crypto.getRandomValues(a);
    return Array.prototype.map.call(a, function(b){ return ('0'+b.toString(16)).slice(-2); }).join('');
  }
  function escHtml(s){ return String(s==null?'':s).replace(/[&<>"']/g, function(c){
    return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
  }); }
  function fmtDate(d){ try { return new Date(d).toLocaleString(); } catch(e){ return String(d); } }
  function getCurrentUserId(){
    try {
      var u = window.__GL && window.__GL.session && window.__GL.session.user;
      if(u && u.id) return u.id;
    } catch(e){}
    return null;
  }
  function getCurrentUserName(){
    try {
      var u = window.__GL && window.__GL.session && window.__GL.session.user;
      if(u && (u.user_metadata && u.user_metadata.name || u.email)) {
        return u.user_metadata && u.user_metadata.name || u.email;
      }
    } catch(e){}
    return localStorage.getItem('gl_user_display_name') || 'Mike Krail';
  }

  /* ==========================================================
     (16) Multi-facility scoping
     ========================================================== */
  var FACILITY_KEY = 'gl_active_facility_id';
  var FACILITY_CODE_KEY = 'gl_active_facility_code';
  var facilities = [];
  var activeFacility = null;

  async function loadFacilities(){
    var sb = getSB(); if(!sb) return;
    try {
      var r = await sb.from('facilities').select('id, code, name, active').eq('active', true).order('code');
      if(r.error) return;
      facilities = r.data || [];
      var savedId = localStorage.getItem(FACILITY_KEY);
      activeFacility = facilities.find(function(f){ return f.id === savedId; }) || facilities[0] || null;
      if(activeFacility){
        localStorage.setItem(FACILITY_KEY, activeFacility.id);
        localStorage.setItem(FACILITY_CODE_KEY, activeFacility.code);
      }
      renderFacilityChip();
    } catch(e){ /* table not yet migrated */ }
  }

  function isCrmVisible(){
    var p = document.getElementById('crm-panel');
    return !!(p && p.classList.contains('show'));
  }
  function renderFacilityChip(){
    var existing = document.getElementById('gl-facility-chip');
    if(!facilities.length || !isCrmVisible()){
      if(existing) existing.remove();
      return;
    }
    if(existing) existing.remove();
    var chip = document.createElement('div');
    chip.id = 'gl-facility-chip';
    chip.style.cssText = 'position:fixed;top:8px;right:8px;background:#0ea5e9;color:#fff;padding:4px 10px;border-radius:14px;font:12px system-ui;cursor:pointer;z-index:9999;box-shadow:0 2px 4px rgba(0,0,0,.15)';
    chip.title = 'Active facility — click to switch';
    chip.textContent = '🏭 ' + (activeFacility ? activeFacility.code : '—');
    chip.onclick = openFacilityPicker;
    document.body.appendChild(chip);
  }
  // Re-evaluate chip visibility whenever the CRM panel toggles
  (function watchCrmVisibility(){
    var panel = document.getElementById('crm-panel');
    if(!panel){ setTimeout(watchCrmVisibility, 800); return; }
    new MutationObserver(renderFacilityChip).observe(panel, { attributes:true, attributeFilter:['class'] });
  })();

  function openFacilityPicker(){
    if(facilities.length < 2){
      toast('Only one facility configured (' + (activeFacility ? activeFacility.code : '—') + '). Add more in Supabase → facilities.');
      return;
    }
    var opts = facilities.map(function(f){
      return '<option value="'+f.id+'"' + (f.id === (activeFacility && activeFacility.id) ? ' selected' : '') + '>' + escHtml(f.code) + ' — ' + escHtml(f.name) + '</option>';
    }).join('');
    var html = '<div style="position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:99998;display:flex;align-items:center;justify-content:center"><div style="background:#fff;padding:20px;border-radius:8px;min-width:320px"><h3 style="margin:0 0 12px">Switch facility</h3><select id="gl-fac-select" style="width:100%;padding:8px;font:14px system-ui">'+opts+'</select><div style="margin-top:14px;text-align:right"><button id="gl-fac-cancel" style="margin-right:8px">Cancel</button><button id="gl-fac-ok" style="background:#0ea5e9;color:#fff;padding:6px 14px;border:0;border-radius:4px">Switch</button></div></div></div>';
    var wrap = document.createElement('div'); wrap.innerHTML = html;
    document.body.appendChild(wrap);
    wrap.querySelector('#gl-fac-cancel').onclick = function(){ wrap.remove(); };
    wrap.querySelector('#gl-fac-ok').onclick = function(){
      var id = wrap.querySelector('#gl-fac-select').value;
      activeFacility = facilities.find(function(f){ return f.id === id; }) || activeFacility;
      localStorage.setItem(FACILITY_KEY, activeFacility.id);
      localStorage.setItem(FACILITY_CODE_KEY, activeFacility.code);
      wrap.remove();
      renderFacilityChip();
      toast('Switched to ' + activeFacility.code + '. Reload to refresh lists.');
    };
  }

  // Intercept compliance inserts to auto-stamp facility_id
  (function wrapSupabaseInsert(){
    var sb = getSB(); if(!sb || sb.__glFacilityWrapped) return;
    var FACILITY_TABLES = { compliance_records:1, compliance_tasks:1, hold_tags:1 };
    var origFrom = sb.from && sb.from.bind(sb);
    if(!origFrom) return;
    sb.from = function(tbl){
      var qb = origFrom(tbl);
      if(FACILITY_TABLES[tbl] && qb && qb.insert){
        var origInsert = qb.insert.bind(qb);
        qb.insert = function(rows, opts){
          var fid = activeFacility && activeFacility.id;
          if(fid){
            if(Array.isArray(rows)) rows.forEach(function(r){ if(r && r.facility_id == null) r.facility_id = fid; });
            else if(rows && typeof rows === 'object' && rows.facility_id == null) rows.facility_id = fid;
          }
          return origInsert(rows, opts);
        };
      }
      return qb;
    };
    sb.__glFacilityWrapped = true;
  })();

  /* ==========================================================
     (11) Inspector read-only mode
     ========================================================== */
  var INSPECTOR_PARAM = 'inspector';

  async function checkInspectorMode(){
    var url = new URL(window.location.href);
    var token = url.searchParams.get(INSPECTOR_PARAM);
    if(!token) return false;
    var sb = getSB(); if(!sb) return false;
    try {
      var r = await sb.from('inspector_tokens').select('id, inspector, agency, purpose, valid_until, revoked_at')
        .eq('token', token).maybeSingle();
      if(r.error || !r.data) { toast('Invalid inspector token', 'err'); return false; }
      if(r.data.revoked_at) { toast('Inspector token revoked', 'err'); return false; }
      if(new Date(r.data.valid_until) < new Date()){ toast('Inspector token expired', 'err'); return false; }
      activateInspectorMode(r.data);
      // Best-effort usage tracking (anon may not have update grant — silent failure is fine):
      try { await sb.from('inspector_tokens').update({ last_used_at: new Date().toISOString(), use_count: (r.data.use_count||0)+1 }).eq('id', r.data.id); } catch(e){}
      return true;
    } catch(e){ return false; }
  }

  function activateInspectorMode(data){
    document.documentElement.classList.add('gl-inspector-mode');
    var style = document.createElement('style');
    style.textContent = '.gl-inspector-mode input,.gl-inspector-mode textarea,.gl-inspector-mode select{pointer-events:none!important;background:#f8fafc!important;color:#0f172a!important}.gl-inspector-mode button:not([data-inspector-ok]){opacity:.4!important;pointer-events:none!important}.gl-inspector-mode [data-write],.gl-inspector-mode .danger,.gl-inspector-mode [data-action="delete"]{display:none!important}';
    document.head.appendChild(style);
    var banner = document.createElement('div');
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#dc2626;color:#fff;padding:10px;text-align:center;font:600 14px system-ui;z-index:99999';
    banner.innerHTML = '🔒 INSPECTOR MODE — read-only view for ' + escHtml(data.inspector) + (data.agency ? ' (' + escHtml(data.agency) + ')' : '') + ' • expires ' + fmtDate(data.valid_until);
    document.body.appendChild(banner);
    document.body.style.paddingTop = (banner.offsetHeight + 4) + 'px';
    window.__glInspectorMode = true;
  }

  // Inspector access link — generates a one-time token bound to a time
  // window, lands in inspector_tokens (anon-readable while live so the
  // inspector URL works without a login). Replaces the previous 4-sequential-
  // prompt() flow which was hostile (one accidental Cancel and the whole
  // flow aborted silently) AND only offered a clipboard copy.
  window.glGenerateInspectorLink = function(){
    if(window.__glInspectorMode){ toast('Cannot generate links in inspector mode', 'err'); return; }
    var sb = getSB(); if(!sb){ toast('Supabase not ready', 'err'); return; }
    var prior = document.getElementById('gl-insp-modal'); if(prior) prior.remove();
    var ov = document.createElement('div');
    ov.id = 'gl-insp-modal';
    ov.setAttribute('style','position:fixed;inset:0;z-index:99999;background:rgba(6,13,26,.88);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:20px');
    ov.innerHTML =
      '<div style="background:#142238;border:1px solid rgba(220,38,38,.3);border-radius:14px;padding:24px;width:100%;max-width:520px;color:#eef4ff">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">' +
          '<div><div style="font-family:var(--ff-disp);font-size:16px;letter-spacing:2px;color:#fca5a5">🔒 INSPECTOR ACCESS LINK</div><div style="font-size:11px;color:#9aa7bd;margin-top:2px">One-time read-only URL for FDA / FDACS / state visits</div></div>' +
          '<button id="gl-insp-close" style="background:none;border:none;color:#9aa7bd;font-size:22px;cursor:pointer">✕</button>' +
        '</div>' +
        '<div id="gl-insp-step1">' +
          '<div class="frow"><div class="flbl">Inspector name *</div><input class="finp" id="gl-insp-name" placeholder="e.g. Jane Smith"></div>' +
          '<div class="frow"><div class="flbl">📧 Inspector email <span style="opacity:.6">(link will be emailed on Generate)</span></div><input class="finp" id="gl-insp-email" type="email" placeholder="inspector@fda.hhs.gov"></div>' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
            '<div class="frow"><div class="flbl">Agency</div><input class="finp" id="gl-insp-agency" placeholder="FDA / FDACS / state" list="gl-insp-agencies"><datalist id="gl-insp-agencies"><option value="FDA"><option value="FDACS"><option value="USDA"></datalist></div>' +
            '<div class="frow"><div class="flbl">Valid for (hours)</div><input class="finp" id="gl-insp-hours" type="number" min="1" max="168" value="8"></div>' +
          '</div>' +
          '<div class="frow"><div class="flbl">Visit purpose <span style="opacity:.6">(optional)</span></div><input class="finp" id="gl-insp-purpose" placeholder="Routine inspection / complaint follow-up / etc."></div>' +
          '<div id="gl-insp-err" style="display:none;color:#ff8579;font-size:12px;margin-bottom:8px"></div>' +
          '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:6px">' +
            '<button id="gl-insp-cancel" class="cbtn">Cancel</button>' +
            '<button id="gl-insp-gen" class="cbtn pri">🔒 Generate & email link</button>' +
          '</div>' +
        '</div>' +
        '<div id="gl-insp-step2" style="display:none"></div>' +
      '</div>';
    document.body.appendChild(ov);
    function close(){ ov.remove(); }
    ov.addEventListener('click', function(e){ if(e.target === ov) close(); });
    ov.querySelector('#gl-insp-close').onclick = close;
    ov.querySelector('#gl-insp-cancel').onclick = close;
    setTimeout(function(){ ov.querySelector('#gl-insp-name').focus(); }, 30);
    ov.querySelector('#gl-insp-gen').onclick = async function(){
      var btn = this;
      var inspector = ov.querySelector('#gl-insp-name').value.trim();
      var email     = ov.querySelector('#gl-insp-email').value.trim();
      var agency    = ov.querySelector('#gl-insp-agency').value.trim();
      var purpose   = ov.querySelector('#gl-insp-purpose').value.trim();
      var hours     = parseInt(ov.querySelector('#gl-insp-hours').value, 10) || 8;
      var err = ov.querySelector('#gl-insp-err');
      err.style.display = 'none';
      if(!inspector){ err.textContent = 'Inspector name is required.'; err.style.display='block'; return; }
      if(email && email.indexOf('@') < 0){ err.textContent = 'Email looks invalid — fix it or clear the field to skip email.'; err.style.display='block'; return; }
      if(hours < 1 || hours > 168){ err.textContent = 'Valid hours must be 1–168 (max 1 week).'; err.style.display='block'; return; }
      btn.disabled = true; btn.textContent = email ? 'Generating + emailing…' : 'Generating…';
      var token = randToken();
      var validUntil = new Date(Date.now() + hours * 3600 * 1000).toISOString();
      var row = { token: token, inspector: inspector, agency: agency || null, purpose: purpose || null, valid_until: validUntil, created_by: getCurrentUserId() };
      var r = await sb.from('inspector_tokens').insert(row).select().single();
      if(r.error){
        err.textContent = 'Save failed: ' + r.error.message + (r.error.code ? ' (' + r.error.code + ')' : '');
        err.style.display = 'block';
        btn.disabled = false; btn.textContent = '🔒 Generate & email link';
        return;
      }
      var link = window.location.origin + window.location.pathname + '?inspector=' + token;
      var expires = new Date(validUntil).toLocaleString('en-US', { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' });
      if(typeof window.glAudit === 'function') window.glAudit('inspector_link_generated', inspector, { agency: agency, hours: hours, expires: validUntil });

      // Fire the email NOW if a recipient was provided — single-step UX.
      var emailStatus = '';
      if(email){
        var subj = 'Good Liquid Bev Co — read-only audit access for ' + (agency || 'your visit');
        var body = 'Hi ' + inspector + ',\n\n' +
          'Per our scheduled ' + (purpose || 'inspection') + ', here is your read-only access link for Good Liquid Bev Co\'s compliance records:\n\n' +
          link + '\n\n' +
          'The link is valid through ' + expires + '. No login required.\n\n' +
          'You\'ll have read-only access to compliance records (CIP cycles, batch records, hold tags, allergen declarations, etc.), audit log, and signed FDA forms. You will NOT be able to edit, sign, export, or delete anything.\n\n' +
          'Questions: Mike@GoodLiquid.com · (803) 493-5065.\n\n' +
          '— Good Liquid Bev Co';
        var sender = (typeof window.sendMailgunEmail === 'function') ? window.sendMailgunEmail : null;
        var ok = false;
        if(sender){ try { ok = await sender(email, subj, body); } catch(e){} }
        if(ok){
          emailStatus = '<div style="padding:10px 12px;background:rgba(95,207,158,.08);border:1px solid rgba(95,207,158,.3);border-radius:8px;margin-bottom:10px;font-size:12px;color:#5fcf9e">📧 Link emailed to <b>' + escHtml(email) + '</b></div>';
          if(typeof window.glAudit === 'function') window.glAudit('inspector_link_emailed', email, { inspector: inspector, agency: agency, hours: hours });
        } else {
          emailStatus = '<div style="padding:10px 12px;background:rgba(245,200,66,.08);border:1px solid rgba(245,200,66,.3);border-radius:8px;margin-bottom:10px;font-size:12px;color:#f5c842">⚠ Email send failed — use Copy link below to send manually.</div>';
        }
      }

      ov.querySelector('#gl-insp-step1').style.display = 'none';
      var step2 = ov.querySelector('#gl-insp-step2');
      step2.style.display = 'block';
      step2.innerHTML =
        '<div style="padding:12px 14px;background:rgba(95,207,158,.08);border:1px solid rgba(95,207,158,.3);border-radius:8px;margin-bottom:14px;font-size:12px;color:#5fcf9e">✓ Link generated for <b>' + escHtml(inspector) + '</b>' + (agency?' ('+escHtml(agency)+')':'') + ' — valid until ' + expires + '</div>' +
        emailStatus +
        '<div class="frow"><div class="flbl">Access URL <span style="opacity:.6">(also useful for SMS or printing)</span></div><textarea class="finp" id="gl-insp-link-out" readonly rows="3" style="font-family:var(--ff-mono);font-size:11px;resize:none">' + escHtml(link) + '</textarea></div>' +
        '<div style="display:flex;gap:8px;justify-content:flex-end">' +
          '<button id="gl-insp-copy" class="cbtn pri">📋 Copy link</button>' +
          '<button id="gl-insp-done" class="cbtn">Done</button>' +
        '</div>';
      step2.querySelector('#gl-insp-copy').onclick = async function(){
        var f = step2.querySelector('#gl-insp-link-out');
        try { await navigator.clipboard.writeText(f.value); }
        catch(e){ f.select(); document.execCommand('copy'); }
        this.textContent = '✓ Copied'; var self = this;
        setTimeout(function(){ self.textContent = '📋 Copy link'; }, 1400);
      };
      step2.querySelector('#gl-insp-done').onclick = close;
    };
  };

  /* ==========================================================
     (10) Multi-PCQI sign-off
     ========================================================== */
  function injectSecondSignButton(modalRoot){
    if(window.__glInspectorMode) return;
    if(!modalRoot || modalRoot.querySelector('[data-gl-second-sign]')) return;
    // Look for a signed record modal — heuristic: contains "Signed by" or a data-record-id attribute
    var recordIdEl = modalRoot.querySelector('[data-compliance-record-id]');
    var recordId = recordIdEl ? recordIdEl.getAttribute('data-compliance-record-id') : null;
    if(!recordId) return;
    var statusEl = modalRoot.querySelector('[data-record-status]');
    var status = statusEl ? statusEl.getAttribute('data-record-status') : null;
    if(status !== 'signed') return;
    if(modalRoot.querySelector('[data-second-signed]')) return; // already double-signed
    var btn = document.createElement('button');
    btn.textContent = '✍️ Add second PCQI signature';
    btn.setAttribute('data-gl-second-sign','1');
    btn.style.cssText = 'background:#7c3aed;color:#fff;padding:8px 14px;border:0;border-radius:4px;margin-top:8px';
    btn.onclick = function(){ openSecondSignModal(recordId, modalRoot); };
    var anchor = modalRoot.querySelector('.modal-footer, .form-actions, footer') || modalRoot;
    anchor.appendChild(btn);
  }

  function openSecondSignModal(recordId, sourceModal){
    var name = prompt('Backup PCQI typed signature (full name):');
    if(!name) return;
    var ack = confirm('You are co-signing this compliance record as a second PCQI. The record will be marked dual-signed with your name and a timestamp.\n\nProceed?');
    if(!ack) return;
    var sb = getSB(); if(!sb){ toast('Supabase not ready', 'err'); return; }
    var payload = { second_signed_by: getCurrentUserId(), second_signed_at: new Date().toISOString(), second_signature_name: name };
    sb.from('compliance_records').update(payload).eq('id', recordId).select().single().then(function(r){
      if(r.error){ toast('Failed: ' + r.error.message, 'err'); return; }
      toast('Second signature recorded ✓');
      var holder = sourceModal.querySelector('.signature-block, .modal-body') || sourceModal;
      var stamp = document.createElement('div');
      stamp.setAttribute('data-second-signed','1');
      stamp.style.cssText = 'margin-top:8px;padding:8px;background:#ede9fe;border-left:3px solid #7c3aed;font:13px system-ui';
      stamp.innerHTML = '✍️ <b>Second PCQI:</b> ' + escHtml(name) + ' • ' + fmtDate(payload.second_signed_at);
      holder.appendChild(stamp);
      var oldBtn = sourceModal.querySelector('[data-gl-second-sign]');
      if(oldBtn) oldBtn.remove();
    });
  }

  /* ==========================================================
     (17) Customer-managed allergen declarations
     ========================================================== */
  var ALLERGEN_PARAM = 'allergen_decl';
  var MAJOR_ALLERGENS = ['milk','eggs','fish','shellfish','tree_nuts','peanuts','wheat','soybeans','sesame'];

  async function checkAllergenDeclMode(){
    var url = new URL(window.location.href);
    var token = url.searchParams.get(ALLERGEN_PARAM);
    if(!token) return false;
    var sb = getSB(); if(!sb) return false;
    var r = await sb.from('client_allergen_declarations')
      .select('id, product_name, allergens, claims, declared_by, declared_at, effective_date, notes, client_id')
      .eq('share_token', token).maybeSingle();
    if(r.error || !r.data){ document.body.innerHTML = '<div style="padding:40px;font:16px system-ui">Declaration not found or revoked.</div>'; return true; }
    renderAllergenDeclPage(r.data);
    return true;
  }

  function renderAllergenDeclPage(d){
    var a = d.allergens || {};
    var rows = MAJOR_ALLERGENS.map(function(k){
      var present = !!a[k];
      return '<tr><td style="padding:6px 12px;border-bottom:1px solid #e5e7eb">' + k.replace(/_/g,' ').replace(/\b\w/g, function(c){return c.toUpperCase();}) + '</td><td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;color:' + (present?'#dc2626':'#16a34a') + ';font-weight:600">' + (present ? 'CONTAINS' : 'Does not contain') + '</td></tr>';
    }).join('');
    var claims = (d.claims && d.claims.length) ? d.claims.map(function(c){ return '<li>'+escHtml(c)+'</li>'; }).join('') : '<li>(none)</li>';
    document.body.innerHTML = '<div style="max-width:720px;margin:30px auto;padding:30px;font:14px/1.5 system-ui;background:#fff;border:1px solid #e5e7eb;border-radius:8px"><h1 style="margin:0 0 6px">Allergen Declaration</h1><div style="color:#64748b;margin-bottom:20px">Issued by Good Liquid Bev Co — read-only customer copy</div><h2 style="margin:0 0 4px">' + escHtml(d.product_name) + '</h2><div style="color:#64748b;font-size:13px;margin-bottom:18px">Declared by ' + escHtml(d.declared_by || '—') + ' • ' + fmtDate(d.declared_at) + (d.effective_date ? ' • Effective ' + d.effective_date : '') + '</div><h3 style="margin:0 0 8px">Major food allergens</h3><table style="width:100%;border-collapse:collapse;margin-bottom:18px"><tbody>' + rows + '</tbody></table><h3 style="margin:0 0 8px">Claims</h3><ul style="margin:0 0 18px 20px">' + claims + '</ul>' + (d.notes ? '<h3 style="margin:0 0 8px">Notes</h3><div style="white-space:pre-wrap;background:#f8fafc;padding:12px;border-radius:4px">' + escHtml(d.notes) + '</div>' : '') + '<div style="margin-top:30px;padding-top:14px;border-top:1px solid #e5e7eb;color:#94a3b8;font-size:12px">This declaration is provided for informational purposes and reflects the data the customer has supplied to Good Liquid Bev Co for the listed product. Refer to current product labeling for regulatory allergen statements.</div></div>';
    document.title = 'Allergen Declaration — ' + d.product_name;
  }

  window.glOpenAllergenDeclForm = function(clientId, clientName){
    if(!clientId){
      clientId = prompt('Client ID (UUID):'); if(!clientId) return;
    }
    var sb = getSB(); if(!sb){ toast('Supabase not ready', 'err'); return; }
    var rows = MAJOR_ALLERGENS.map(function(k){
      return '<label style="display:block;padding:4px 0"><input type="checkbox" name="alg_'+k+'"> '+ k.replace(/_/g,' ') +'</label>';
    }).join('');
    var html = '<div id="gl-alg-modal" style="position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:99999;display:flex;align-items:center;justify-content:center"><div style="background:#fff;padding:22px;border-radius:8px;max-width:560px;width:92%;max-height:88vh;overflow:auto"><h3 style="margin:0 0 14px">Allergen Declaration — ' + escHtml(clientName||'Client') + '</h3><label>Product name<br><input id="ag-prod" style="width:100%;padding:6px"></label><div style="margin:12px 0"><b>Contains:</b>'+rows+'</div><label>Claims (comma-separated, e.g. Gluten-Free, Vegan)<br><input id="ag-claims" style="width:100%;padding:6px"></label><label style="display:block;margin-top:10px">Declared by (customer name)<br><input id="ag-by" style="width:100%;padding:6px"></label><label style="display:block;margin-top:10px">Effective date<br><input type="date" id="ag-eff" style="padding:6px"></label><label style="display:block;margin-top:10px">Notes (optional)<br><textarea id="ag-notes" rows="3" style="width:100%;padding:6px"></textarea></label><div style="margin-top:16px;display:flex;gap:8px;justify-content:flex-end"><button id="ag-cancel">Cancel</button><button id="ag-save" style="background:#0ea5e9;color:#fff;padding:6px 14px;border:0;border-radius:4px">Save + Share</button></div></div></div>';
    var w = document.createElement('div'); w.innerHTML = html; document.body.appendChild(w);
    w.querySelector('#ag-cancel').onclick = function(){ w.remove(); };
    w.querySelector('#ag-save').onclick = async function(){
      var prod = w.querySelector('#ag-prod').value.trim();
      if(!prod){ alert('Product name required'); return; }
      var allergens = {};
      MAJOR_ALLERGENS.forEach(function(k){ allergens[k] = w.querySelector('[name="alg_'+k+'"]').checked; });
      var claimsArr = w.querySelector('#ag-claims').value.split(',').map(function(s){return s.trim();}).filter(Boolean);
      var by = w.querySelector('#ag-by').value.trim() || null;
      var eff = w.querySelector('#ag-eff').value || null;
      var notes = w.querySelector('#ag-notes').value.trim() || null;
      var token = randToken();
      var row = { client_id: clientId, product_name: prod, allergens: allergens, claims: claimsArr, declared_by: by, effective_date: eff, notes: notes, share_token: token };
      var r = await sb.from('client_allergen_declarations').insert(row).select().single();
      if(r.error){ alert('Failed: '+r.error.message); return; }
      w.remove();
      var link = window.location.origin + window.location.pathname + '?allergen_decl=' + token;
      var html2 = '<div style="position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:99999;display:flex;align-items:center;justify-content:center"><div style="background:#fff;padding:22px;border-radius:8px;max-width:560px;width:92%"><h3 style="margin:0 0 10px">Allergen declaration saved</h3><p>Send this link to ' + escHtml(clientName||'the customer') + ':</p><input type="text" readonly value="' + escHtml(link) + '" style="width:100%;padding:8px;font:13px monospace;border:1px solid #ccc;border-radius:4px" id="ag-link"><div style="margin-top:14px;display:flex;gap:8px;justify-content:flex-end"><button id="ag-copy" style="background:#0ea5e9;color:#fff;padding:6px 14px;border:0;border-radius:4px">Copy link</button><button id="ag-done">Done</button></div></div></div>';
      var w2 = document.createElement('div'); w2.innerHTML = html2; document.body.appendChild(w2);
      w2.querySelector('#ag-copy').onclick = function(){ var f = w2.querySelector('#ag-link'); f.select(); document.execCommand('copy'); toast('Link copied'); };
      w2.querySelector('#ag-done').onclick = function(){ w2.remove(); };
    };
  };

  /* ==========================================================
     Compliance-page buttons (scoped to #comp-body, admin-only)
     ========================================================== */
  function injectCompliancePageButtons(){
    if(window.__glInspectorMode) return;
    var host = document.getElementById('comp-body');
    if(!host){ setTimeout(injectCompliancePageButtons, 800); return; }
    new MutationObserver(function(){
      var anchor = host.querySelector('.gl-comp-applic') || host.querySelector('.gl-comp-digest') || host.querySelector('.gl-comp-report');
      if(!anchor) return;
      var parent = anchor.parentNode;
      if(parent.querySelector('.gl-comp-inspector') && parent.querySelector('.gl-comp-allergen')) return;
      function btn(cls, text, c, fn){
        var b = document.createElement('button'); b.className = 'cbtn ' + cls;
        b.setAttribute('style','font-size:11px;padding:5px 11px;margin-right:6px;background:' + c.bg + ';border:1px solid ' + c.bd + ';color:' + c.fg);
        b.textContent = text; b.addEventListener('click', fn);
        return b;
      }
      if(!parent.querySelector('.gl-comp-inspector')){
        var insp = btn('gl-comp-inspector', '🔒 Inspector link',
          { bg:'rgba(220,38,38,.10)', bd:'rgba(220,38,38,.35)', fg:'#fca5a5' },
          function(){ window.glGenerateInspectorLink(); });
        parent.insertBefore(insp, anchor);
      }
      if(!parent.querySelector('.gl-comp-allergen')){
        var alg = btn('gl-comp-allergen', '🥜 Allergen decl',
          { bg:'rgba(124,58,237,.10)', bd:'rgba(124,58,237,.35)', fg:'#c4b5fd' },
          function(){
            var cid = prompt('Client ID (UUID) for the allergen declaration:'); if(!cid) return;
            window.glOpenAllergenDeclForm(cid, '');
          });
        parent.insertBefore(alg, anchor);
      }
    }).observe(host, { childList:true, subtree:true });
  }

  function observeForSecondSign(){
    var mo = new MutationObserver(function(muts){
      muts.forEach(function(m){
        Array.prototype.forEach.call(m.addedNodes, function(n){
          if(n.nodeType !== 1) return;
          if(n.matches && n.matches('.modal, .dialog, [role="dialog"]')) injectSecondSignButton(n);
          $$('.modal, .dialog, [role="dialog"]', n).forEach(injectSecondSignButton);
        });
      });
    });
    mo.observe(document.body, { childList: true, subtree: true });
    // Initial pass
    $$('.modal, .dialog, [role="dialog"]').forEach(injectSecondSignButton);
  }

  /* ==========================================================
     Client-detail overlay button: 🥜 Allergen Declaration
     ========================================================== */
  function injectAllergenBtnIntoClientOverlay(){
    var mo = new MutationObserver(function(){
      var ov = document.getElementById('client-detail-overlay');
      if(!ov || ov.querySelector('.gl-cd-allergen')) return;
      // Find the action button row (the one with Edit Client / AI Health Score / etc.)
      var actionRow = null;
      var existingBtns = ov.querySelectorAll('button');
      for(var i=0;i<existingBtns.length;i++){
        var b = existingBtns[i];
        if(b.textContent && /Edit Client|AI Health Score|Add Task|Draft Email/.test(b.textContent)){
          actionRow = b.parentNode; break;
        }
      }
      if(!actionRow) return;
      // Extract clientId from any sibling button's onclick (matches a UUID)
      var clientId = null, clientName = '';
      Array.prototype.some.call(actionRow.querySelectorAll('button'), function(b){
        var on = b.getAttribute('onclick') || '';
        var m = on.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
        if(m){ clientId = m[0]; return true; }
        return false;
      });
      if(!clientId) return;
      // Best-effort client name from the overlay header
      var h = ov.querySelector('h1, h2, h3, .client-name');
      if(h) clientName = h.textContent.trim();
      var btn = document.createElement('button');
      btn.className = 'cbtn gl-cd-allergen';
      btn.setAttribute('style','background:rgba(124,58,237,.12);border-color:rgba(124,58,237,.35);color:#c4b5fd');
      btn.textContent = '🥜 Allergen Declaration';
      btn.onclick = function(){ window.glOpenAllergenDeclForm(clientId, clientName); };
      actionRow.appendChild(btn);
    });
    mo.observe(document.body, { childList:true, subtree:true });
  }

  /* ==========================================================
     Boot
     ========================================================== */
  function boot(){
    checkInspectorMode().then(function(isInsp){
      checkAllergenDeclMode().then(function(isAlg){
        if(isAlg) return; // public allergen decl page: stop here
        loadFacilities();
        injectCompliancePageButtons();
        injectAllergenBtnIntoClientOverlay();
        observeForSecondSign();
      });
    });
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  console.log('[GL] compliance SQL-backed pack — 4 features: multi-PCQI + inspector mode + multi-facility + customer allergens');
}());
