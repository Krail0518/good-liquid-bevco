/* ============================================================
   COMPLIANCE LOG PRINTING (print / save as PDF)

   One printer for the compliance logs people hand to an auditor:

     - CIP / Sanitation Log (GMP-SAN-002): one block per cycle with its
       9-step table. Used by the CIP page toolbar and the cycle detail.
     - Calibration (GMP-CAL-001): one landscape table, one row per check.
       Used by Daily GMP > Prerequisite Programs > Calibration, which can
       narrow it to one instrument (e.g. pH meter) first.
     - Any other register: a table built from the register's template fields.

   It opens a popup the same way the other print views do (see
   printSingleRecord in compliance.js): plain HTML, a stylesheet linked by
   absolute URL because the popup inherits the opener's CSP and has no base
   URL, and the Print / Close buttons bound from here by
   glBindPopupControls, so no script runs inside the popup.

   Every value comes from a compliance record somebody typed, so every value
   goes through esc() (CLAUDE.md rule 5).

   It only reads the rows it is handed. It writes nothing.
   ============================================================ */
(function(){
  function esc(s){
    if(typeof window.glEsc === 'function') return window.glEsc(s);
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
      return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
    });
  }
  function isBlank(v){ return v == null || String(v).trim() === ''; }
  function fmtDate(d){
    if(isBlank(d)) return '';
    // A bare YYYY-MM-DD is a calendar date, not midnight UTC. new Date() would
    // read it as UTC and print the day before anywhere west of Greenwich.
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d));
    var x = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(d);
    return isNaN(x.getTime()) ? String(d) : x.toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
  }
  function fmtTs(d){
    if(isBlank(d)) return '';
    var x = new Date(d);
    return isNaN(x.getTime()) ? String(d) : x.toLocaleString('en-US', { month:'short', day:'numeric', year:'numeric', hour:'numeric', minute:'2-digit' });
  }
  function upper(v){ return isBlank(v) ? '' : String(v).toUpperCase(); }

  // Where the record stands, in the words an auditor reads.
  function statusText(r){
    if(r.status === 'signed') return 'Signed';
    if(r.status === 'complete') return 'Complete, not signed';
    if(r.status === 'draft') return 'Draft, not signed';
    return r.status ? String(r.status) : 'Unknown';
  }
  function signatureText(r){
    if(r.signature_name) return r.signature_name + (r.signed_at ? ' on ' + fmtTs(r.signed_at) : '');
    return 'Not signed';
  }
  function whenOf(r){
    var d = r.data || {};
    return d.cycle_start || r.recorded_at || r.record_date || '';
  }
  function byWhenAsc(a, b){
    var x = String(whenOf(a)), y = String(whenOf(b));
    return x < y ? -1 : x > y ? 1 : 0;
  }

  // ── CIP: one block per cycle ─────────────────────────────
  var CIP_STEP_NAMES = ['Pre-Rinse','PBW Wash','Intermediate Rinse #1','Caustic Wash (NaOH)','Intermediate Rinse #2','Acid Wash','Final Rinse','POST-CIP PAA Sanitize','PRE-USE PAA (at run time)'];

  function cipBlock(r){
    var d = r.data || {};
    var steps = Array.isArray(d.steps) ? d.steps : [];
    var result = r.has_deviation ? 'FAIL' : (r.status === 'signed' || r.status === 'complete') ? 'PASS' : 'DRAFT';
    var stepRows = CIP_STEP_NAMES.map(function(name, i){
      var n = i + 1;
      var s = steps.filter(function(x){ return x && Number(x.n) === n; })[0] || {};
      var done = !!s.done;
      var pf = done ? upper(s.pf) : 'SKIPPED';
      var mins = isBlank(s.actual_min) ? '' : String(s.actual_min);
      if(!isBlank(s.target_min)) mins += (mins ? ' ' : '') + '(target ' + s.target_min + ')';
      return '<tr' + (done ? '' : ' class="skipped"') + '>' +
        '<td class="c">' + n + '</td>' +
        '<td>' + esc(s.name || name) + (s.chem && s.chem !== 'Potable water' ? '<div class="sub">' + esc(s.chem) + '</div>' : '') + '</td>' +
        '<td class="c">' + (done ? 'Yes' : 'No') + '</td>' +
        '<td class="c">' + esc(mins) + '</td>' +
        // The form stores a blank temperature as 0; no CIP step runs at 0°F.
        '<td class="c">' + (n >= 8 ? 'ambient' : (isBlank(s.temp_f) || Number(s.temp_f) === 0 ? '' : esc(s.temp_f))) + '</td>' +
        '<td>' + esc(s.reading || '') + '</td>' +
        '<td class="c' + (pf === 'FAIL' ? ' fail' : '') + '">' + esc(pf) + '</td>' +
      '</tr>';
    }).join('');
    // The CIP form saves its free-text box as corrective_action on every
    // record, failed or not, so only a flagged record gets the red block.
    var dev = '';
    var notes = d.deviation_notes || r.corrective_action || '';
    if(r.has_deviation){
      dev = '<div class="dev"><b>Deviation:</b> ' + esc(r.deviation_notes || '(no notes)') +
        (isBlank(r.corrective_action) ? '' : '<br><b>Corrective action:</b> ' + esc(r.corrective_action)) + '</div>';
    } else if(!isBlank(notes)){
      dev = '<div class="note"><b>Notes:</b> ' + esc(notes) + '</div>';
    }
    return '<section class="rec">' +
      '<div class="rec-head">' +
        '<div><span class="k">Equipment</span>' + esc(d.equipment || r.product_name || '') + '</div>' +
        '<div><span class="k">Cycle start</span>' + esc(fmtTs(d.cycle_start || r.recorded_at)) + '</div>' +
        '<div><span class="k">Operator</span>' + esc(d.operator || '') + '</div>' +
        '<div><span class="k">Result</span><b class="' + (result === 'FAIL' ? 'fail' : result === 'PASS' ? 'pass' : '') + '">' + result + '</b> · ' + esc(statusText(r)) + '</div>' +
      '</div>' +
      '<table class="grid"><thead><tr><th>#</th><th>Step</th><th>Done</th><th>Minutes</th><th>Temp °F</th><th>Verification</th><th>P/F</th></tr></thead>' +
        '<tbody>' + stepRows + '</tbody></table>' +
      dev +
      '<div class="sig"><b>PCQI signature:</b> ' + (r.signature_name ? esc(signatureText(r)) : '______________________ &nbsp; Date: __________') + '</div>' +
    '</section>';
  }

  // ── Calibration: one row per check ───────────────────────
  // Two forms write GMP-CAL-001 with different keys: the Compliance form
  // (location, method, result, range, pf) and the Daily GMP register template
  // (instrument_id, as_found, as_left, tolerance_ok, performed_by, notes).
  // Each column reads whichever one the record has.
  var CAL_COLUMNS = [
    { label:'Date',              get:function(r, d){ return fmtDate(r.record_date || r.recorded_at); } },
    { label:'Instrument',        get:function(r, d){ return d.instrument; } },
    { label:'ID / location',     get:function(r, d){ return d.location || d.instrument_id; } },
    { label:'Method',            get:function(r, d){ return d.method; } },
    { label:'Reference / lot',   get:function(r, d){ return d.reference; } },
    { label:'Result',            get:function(r, d){
        if(!isBlank(d.result)) return d.result;
        var bits = [];
        if(!isBlank(d.as_found)) bits.push('As found ' + d.as_found);
        if(!isBlank(d.as_left))  bits.push('As left ' + d.as_left);
        return bits.join(', ');
      } },
    { label:'Acceptable range',  get:function(r, d){ return d.range; } },
    { label:'Pass / Fail',       get:function(r, d){ return upper(d.pf || d.tolerance_ok); }, cls:function(v){ return v === 'FAIL' ? 'c fail' : 'c'; } },
    { label:'Next due',          get:function(r, d){ return fmtDate(d.next_due); } },
    { label:'Performed by',      get:function(r, d){ return d.performed_by || d.operator; } },
    { label:'Notes',             get:function(r, d){ return [d.notes, r.has_deviation ? r.deviation_notes : '', r.corrective_action ? 'Corrective: ' + r.corrective_action : ''].filter(function(x){ return !isBlank(x); }).join(' · '); } },
    { label:'PCQI signature',    get:function(r, d){ return signatureText(r); } }
  ];

  // Any other register: its template fields, plus the shared header details.
  function fieldColumns(fields){
    var cols = [
      { label:'Date',      get:function(r, d){ return fmtDate(r.record_date || r.recorded_at); } },
      { label:'Line / run', get:function(r, d){ return [d.line, d.run].filter(function(x){ return !isBlank(x); }).join(' / '); } },
      { label:'By',        get:function(r, d){ return d.operator; } }
    ];
    (fields || []).forEach(function(f){
      if(!f || !f.key) return;
      cols.push({
        label: f.label || f.key,
        get: function(r, d){
          var v = d[f.key];
          if(v === true) return 'Yes';
          if(v === false) return 'No';
          if(f.type === 'date') return fmtDate(v);
          if(f.type === 'passfail') return upper(v);
          return v;
        },
        cls: f.type === 'passfail' ? function(v){ return v === 'FAIL' ? 'c fail' : 'c'; } : null
      });
    });
    cols.push({ label:'Deviation', get:function(r, d){ return r.has_deviation ? (r.deviation_notes || 'Yes') : ''; } });
    cols.push({ label:'PCQI signature', get:function(r, d){ return signatureText(r); } });
    return cols;
  }

  function tableOf(rows, cols){
    return '<table class="grid log"><thead><tr>' +
      cols.map(function(c){ return '<th>' + esc(c.label) + '</th>'; }).join('') +
      '</tr></thead><tbody>' +
      rows.map(function(r){
        var d = r.data || {};
        return '<tr' + (r.has_deviation ? ' class="devrow"' : '') + '>' + cols.map(function(c){
          var v = c.get(r, d);
          v = isBlank(v) ? '' : String(v);
          var cls = c.cls ? c.cls(v) : '';
          return '<td' + (cls ? ' class="' + cls + '"' : '') + '>' + esc(v) + '</td>';
        }).join('') + '</tr>';
      }).join('') +
      '</tbody></table>';
  }

  // ── CIP cycle: a real .pdf file (Download PDF) ───────────
  // The print view above goes through the browser's print dialog. This one
  // draws the same cycle with jsPDF (loaded on demand by window.ensureJsPdf,
  // the same copy the ATP and warehouse reports use) and saves a file.
  //
  // PDF text is drawn, not parsed as HTML, so HTML escaping does not apply.
  // The standard PDF fonts only cover WinAnsi, so anything outside it is
  // spelled out ("≥" becomes ">=") rather than printed as garbage.
  function pdfText(v){
    return String(v == null ? '' : v)
      .replace(/≥/g, '>=').replace(/≤/g, '<=').replace(/[–—]/g, '-')
      .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, '...').replace(/·/g, '-')
      .replace(/[^\x09\x0a\x0d\x20-\x7e\xa0-\xff]/g, '?');
  }
  function fileSafe(v){ return String(v == null ? '' : v).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40); }
  async function loadLogo(){
    try {
      var r = await fetch('/gl-logo.jpg');
      if(!r.ok) return null;
      var blob = await r.blob();
      return await new Promise(function(res){
        var fr = new FileReader();
        fr.onload = function(){ res(String(fr.result || '')); };
        fr.onerror = function(){ res(null); };
        fr.readAsDataURL(blob);
      });
    } catch(e){ return null; }
  }

  function buildCipPdf(jsPDF, r, logo, opts){
    opts = opts || {};
    var d = r.data || {};
    var steps = Array.isArray(d.steps) ? d.steps : [];
    var doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' });
    var W = 612, H = 792, L = 40, R = W - 40, BOTTOM = H - 50;
    var INK = [10, 22, 40], MUTED = 110, RED = [179, 38, 30], GREEN = [8, 122, 91];
    var y;
    function t(str, x, yy, o){ doc.text(pdfText(str), x, yy, o); }
    function font(style, size, color){
      doc.setFont('helvetica', style); doc.setFontSize(size);
      if(Array.isArray(color)) doc.setTextColor(color[0], color[1], color[2]); else doc.setTextColor(color);
    }
    function ensure(h){ if(y + h > BOTTOM){ doc.addPage(); y = 50; return true; } return false; }

    // Header
    var hx = L;
    if(logo){ try { doc.addImage(logo, 'JPEG', L, 30, 44, 44); hx = L + 54; } catch(e){} }
    font('bold', 14, INK); t('Good Liquid Bev Co', hx, 48);
    font('normal', 9, MUTED); t('2011 51st Ave E, Palmetto, FL 34221', hx, 62);
    font('bold', 17, INK); t('CIP Cycle Record', R, 48, { align: 'right' });
    font('normal', 9, MUTED); t('Form GMP-SAN-002 - 9-Step CIP Monitoring', R, 62, { align: 'right' });
    doc.setDrawColor(0, 170, 136); doc.setLineWidth(2); doc.line(L, 84, R, 84);
    y = 104;

    if(opts.warning){
      font('bold', 9, RED);
      var wl = doc.splitTextToSize(pdfText(opts.warning), R - L);
      doc.text(wl, L, y); y += wl.length * 12 + 6;
    }

    // Cycle details, two columns
    var result = r.has_deviation ? 'FAIL' : (r.status === 'signed' || r.status === 'complete') ? 'PASS' : 'DRAFT';
    var meta = [
      ['Equipment', d.equipment || r.product_name || '', 'Cycle start', fmtTs(d.cycle_start || r.recorded_at)],
      ['Operator', d.operator || '', 'Status', result + ' - ' + statusText(r)],
      ['Record ID', r.id || '', 'Recorded', fmtTs(r.recorded_at)]
    ];
    // Values wrap rather than truncate: a record must not lose characters.
    font('bold', 10, INK);
    var laid = meta.map(function(m){
      var a = doc.splitTextToSize(pdfText(m[1]), 186), b = doc.splitTextToSize(pdfText(m[3]), 176);
      return { m: m, a: a, b: b, h: Math.max(a.length, b.length, 1) * 12 + 6 };
    });
    var metaH = laid.reduce(function(s, l){ return s + l.h; }, 0);
    doc.setFillColor(244, 247, 249); doc.roundedRect(L, y - 12, R - L, metaH + 10, 4, 4, 'F');
    laid.forEach(function(l){
      font('normal', 8.5, MUTED); t(l.m[0].toUpperCase(), L + 10, y); t(l.m[2].toUpperCase(), 316, y);
      font('bold', 10, INK); doc.text(l.a, L + 82, y);
      if(l.m[2] === 'Status') font('bold', 10, result === 'FAIL' ? RED : result === 'PASS' ? GREEN : INK);
      doc.text(l.b, 388, y);
      y += l.h;
    });
    y += 14;

    // Steps table
    var cols = [
      { h:'#',            w:22,  a:'center' },
      { h:'Step',         w:150 },
      { h:'Done',         w:38,  a:'center' },
      { h:'Minutes',      w:62,  a:'center' },
      { h:'Temp F',       w:52,  a:'center' },
      { h:'Verification', w:156 },
      { h:'P/F',          w:52,  a:'center' }
    ];
    function header(){
      doc.setFillColor(232, 240, 238); doc.rect(L, y, R - L, 18, 'F');
      font('bold', 8, INK);
      var x = L;
      cols.forEach(function(c){ t(c.h.toUpperCase(), c.a === 'center' ? x + c.w / 2 : x + 5, y + 12, c.a === 'center' ? { align:'center' } : undefined); x += c.w; });
      y += 18;
    }
    header();
    CIP_STEP_NAMES.forEach(function(name, i){
      var n = i + 1;
      var s = steps.filter(function(x){ return x && Number(x.n) === n; })[0] || {};
      var done = !!s.done;
      var pf = done ? upper(s.pf) : 'SKIPPED';
      var mins = isBlank(s.actual_min) ? '' : String(s.actual_min);
      if(!isBlank(s.target_min)) mins += (mins ? ' ' : '') + '(target ' + s.target_min + ')';
      var temp = n >= 8 ? 'ambient' : (isBlank(s.temp_f) || Number(s.temp_f) === 0 ? '' : String(s.temp_f));
      var stepLines = doc.splitTextToSize(pdfText(s.name || name), cols[1].w - 10);
      if(s.chem && s.chem !== 'Potable water') stepLines = stepLines.concat(doc.splitTextToSize(pdfText(s.chem), cols[1].w - 10));
      var readLines = doc.splitTextToSize(pdfText(s.reading || ''), cols[5].w - 10);
      var minLines = doc.splitTextToSize(pdfText(mins), cols[3].w - 6);
      var lines = Math.max(stepLines.length, readLines.length, minLines.length, 1);
      var h = lines * 11 + 9;
      if(ensure(h)) header();
      doc.setDrawColor(215); doc.setLineWidth(0.5); doc.line(L, y + h, R, y + h);
      var x = L, base = y + 13;
      var cells = [String(n), stepLines, done ? 'Yes' : 'No', minLines, temp, readLines, pf];
      cells.forEach(function(v, ci){
        var c = cols[ci];
        var color = !done ? 150 : (ci === 6 && pf === 'FAIL') ? RED : (ci === 6 && pf === 'PASS') ? GREEN : INK;
        font(ci === 6 ? 'bold' : 'normal', 9, color);
        if(ci === 1 && Array.isArray(v) && v.length > 1){
          // Step name in ink, chemical below it in grey.
          var nameLines = doc.splitTextToSize(pdfText(s.name || name), c.w - 10);
          doc.text(nameLines, x + 5, base);
          font('normal', 8, done ? MUTED : 170);
          doc.text(v.slice(nameLines.length), x + 5, base + nameLines.length * 11);
        } else if(Array.isArray(v)){
          doc.text(v, c.a === 'center' ? x + c.w / 2 : x + 5, base, c.a === 'center' ? { align:'center' } : undefined);
        } else {
          t(v, c.a === 'center' ? x + c.w / 2 : x + 5, base, c.a === 'center' ? { align:'center' } : undefined);
        }
        x += c.w;
      });
      y += h;
    });
    y += 16;

    // Deviation or notes
    var notes = d.deviation_notes || r.corrective_action || '';
    function box(label, body, fill, bar){
      font('normal', 9.5, INK);
      var bl = doc.splitTextToSize(pdfText(body), R - L - 24);
      var bh = bl.length * 12 + 26;
      ensure(bh + 6);
      doc.setFillColor(fill[0], fill[1], fill[2]); doc.rect(L, y, R - L, bh, 'F');
      doc.setFillColor(bar[0], bar[1], bar[2]); doc.rect(L, y, 3, bh, 'F');
      font('bold', 9.5, INK); t(label, L + 12, y + 15);
      font('normal', 9.5, INK); doc.text(bl, L + 12, y + 28);
      y += bh + 12;
    }
    if(r.has_deviation){
      box('Deviation', (r.deviation_notes || '(no notes)') + (isBlank(r.corrective_action) ? '' : '\nCorrective action: ' + r.corrective_action), [254, 240, 239], RED);
    } else if(!isBlank(notes)){
      box('Notes', notes, [246, 247, 249], [150, 150, 170]);
    }

    // Signatures
    ensure(70);
    y += 8;
    font('bold', 10, INK); t('PCQI signature:', L, y);
    font('normal', 10, INK);
    if(r.signature_name){
      t(signatureText(r) + (r.signature_meaning ? ' (' + r.signature_meaning + ')' : ''), L + 92, y);
    } else {
      doc.setDrawColor(120); doc.line(L + 92, y + 2, L + 300, y + 2); t('Date:', L + 316, y); doc.line(L + 346, y + 2, L + 440, y + 2);
    }
    y += 30;
    font('bold', 10, INK); t('Reviewed by:', L, y);
    doc.setDrawColor(120); doc.line(L + 92, y + 2, L + 300, y + 2);
    font('normal', 10, INK); t('Date:', L + 316, y); doc.line(L + 346, y + 2, L + 440, y + 2);

    // Footer on every page
    var who = (window.currentUser && (window.currentUser.name || window.currentUser.email)) || '';
    var pages = doc.getNumberOfPages();
    for(var p = 1; p <= pages; p++){
      doc.setPage(p);
      font('normal', 8, 130);
      t('Generated ' + fmtTs(new Date()) + (who ? ' by ' + who : '') + ' - Good Liquid Bev Co', L, H - 26);
      t('Page ' + p + ' of ' + pages, R, H - 26, { align: 'right' });
    }
    return doc;
  }

  // Saves one CIP cycle as a .pdf file. Returns the file name, or null.
  window.glDownloadCipPdf = async function glDownloadCipPdf(rec, opts){
    if(!rec){ alert('There is no cycle to save.'); return null; }
    try {
      if(typeof window.ensureJsPdf !== 'function') throw new Error('PDF engine not available on this page.');
      var jsPDF = await window.ensureJsPdf();
      var doc = buildCipPdf(jsPDF, rec, await loadLogo(), opts);
      var d = rec.data || {};
      // Name it by the cycle start as the screen shows it (local time), not
      // the UTC instant stored in the database.
      var ts = new Date(d.cycle_start || rec.recorded_at || rec.record_date || '');
      var p2 = function(n){ return (n < 10 ? '0' : '') + n; };
      var when = isNaN(ts.getTime()) ? '' :
        ts.getFullYear() + '-' + p2(ts.getMonth() + 1) + '-' + p2(ts.getDate()) + '_' + p2(ts.getHours()) + p2(ts.getMinutes());
      var name = 'CIP_' + (fileSafe(d.equipment || rec.product_name) || 'cycle') + (when ? '_' + when : '') + '.pdf';
      doc.save(name);
      return name;
    } catch(e){
      alert('Could not create the PDF: ' + ((e && e.message) || e) + '. You can still use Print / PDF and choose "Save as PDF".');
      return null;
    }
  };

  /* opts:
       rows      compliance_records rows (required)
       formCode  'GMP-SAN-002', 'GMP-CAL-001', or another register code
       title     heading on the printout
       scope     one line saying what is included, e.g. 'Instrument: pH meter'
       fields    template fields, for registers other than CIP and calibration
       note      optional extra line under the header
     Returns true if the print window opened. */
  window.glPrintComplianceLog = function glPrintComplianceLog(opts){
    opts = opts || {};
    var rows = (opts.rows || []).filter(Boolean).slice().sort(byWhenAsc);
    if(!rows.length){ alert('There are no records to print.'); return false; }
    var w = window.open('', '_blank');
    if(!w){ alert('Pop-up blocked. Allow pop-ups for this site to print or save as PDF.'); return false; }

    var code = opts.formCode || rows[0].form_code || '';
    var isCip = code === 'GMP-SAN-002';
    var body;
    if(isCip) body = rows.map(cipBlock).join('');
    else if(code === 'GMP-CAL-001') body = tableOf(rows, CAL_COLUMNS);
    else body = tableOf(rows, fieldColumns(opts.fields));

    var first = whenOf(rows[0]), last = whenOf(rows[rows.length - 1]);
    var range = fmtDate(first) === fmtDate(last) ? fmtDate(first) : fmtDate(first) + ' to ' + fmtDate(last);
    var fails = rows.filter(function(r){ return r.has_deviation; }).length;
    var unsigned = rows.filter(function(r){ return r.status !== 'signed'; }).length;
    var who = (window.currentUser && (window.currentUser.name || window.currentUser.email)) || '';
    var counts = rows.length + ' record' + (rows.length === 1 ? '' : 's') +
      (fails ? ' · ' + fails + ' with a deviation' : '') +
      (unsigned ? ' · ' + unsigned + ' not signed' : '');
    var title = opts.title || code;

    w.document.write(
      '<!doctype html><html><head><meta charset="utf-8"><title>' + esc(title) + '</title>' +
      '<link rel="stylesheet" href="' + location.origin + '/gl-print-log.css">' +
      '</head><body class="' + (isCip ? 'portrait' : 'wide') + '">' +
      '<div class="no-print bar"><button data-gl-action="print" class="pbtn">🖨️ Print / Save as PDF</button> <button data-gl-action="close">Close</button>' +
        '<span class="hint">To get a PDF, choose “Save as PDF” as the printer.</span></div>' +
      '<header>' +
        '<div class="co">Good Liquid Bev Co · 2011 51st Ave E, Palmetto, FL 34221</div>' +
        '<h1>' + esc(title) + '</h1>' +
        '<div class="meta">' +
          (code ? 'Form ' + esc(code) + ' · ' : '') +
          (opts.scope ? esc(opts.scope) + ' · ' : '') +
          esc(range) + ' · ' + esc(counts) +
        '</div>' +
        '<div class="meta">Printed ' + esc(fmtTs(new Date())) + (who ? ' by ' + esc(who) : '') + '</div>' +
        (opts.note ? '<div class="meta warn">' + esc(opts.note) + '</div>' : '') +
      '</header>' +
      body +
      '<div class="review">Reviewed by: ______________________________ &nbsp; Date: ______________</div>' +
      '</body></html>'
    );
    w.document.close();
    if(typeof window.glBindPopupControls === 'function') window.glBindPopupControls(w);
    return true;
  };
}());
