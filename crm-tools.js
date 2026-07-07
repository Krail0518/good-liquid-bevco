/* ============================================================
   PUBLIC CASE STUDIES GRID
   Pulls from Supabase `case_studies` table; falls back to demo
   so the section never renders empty.
   ============================================================ */
(function(){
  var esc = window.glEsc;

  var DEMO = [
    { brand:'SunBurst Seltzers', tagline:'Pilot run → 12,000 cases / yr', headline:'From napkin to national', body:'Came in with a hop-water concept on a napkin. We helped formulate, ran the pilot in 4 weeks, and now produce monthly canning runs.', metric:'12,000 cases / yr', color:'#f5c842', tc:'#0a1628' },
    { brand:'Wildkind Kombucha', tagline:'Live → shelf-stable in one summer', headline:'Cracked the shelf-stable code', body:'Wanted shelf-stable kombucha without losing the live character. Flash pasteurization plus a custom acid profile gave them retail-ready stability.', metric:'6-month shelf life', color:'#5fcf9e', tc:'#0a1628' },
    { brand:'Bayline Cold Brew', tagline:'Nitro upgrade in 2 weeks', headline:'Premium positioning, same SKU', body:'Cold-brew brand wanted nitro for mouthfeel. We layered nitrogen dosing into their existing run — same price tier, 3¢ extra per can, premium product.', metric:'+15% margin', color:'#7fc6f5', tc:'#0a1628' }
  ];

  function cardHtml(c){
    return '<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:22px;display:flex;flex-direction:column;gap:12px">' +
      '<div style="display:flex;align-items:center;gap:11px">' +
        '<div style="width:44px;height:44px;border-radius:50%;background:' + esc(c.color || '#1a3a6e') + ';color:' + esc(c.tc || '#fff') + ';display:flex;align-items:center;justify-content:center;font-weight:900;font-size:14px">' + esc((c.brand || 'X').split(' ').map(function(w){return w[0]||'';}).join('').toUpperCase().slice(0,2)) + '</div>' +
        '<div style="min-width:0">' +
          '<div style="font-family:var(--ff-disp);font-size:14px;letter-spacing:1px;color:#fff">' + esc(c.brand || 'Brand') + '</div>' +
          (c.tagline ? '<div style="font-size:11px;color:var(--teal)">' + esc(c.tagline) + '</div>' : '') +
        '</div>' +
      '</div>' +
      (c.headline ? '<div style="font-size:14px;font-weight:700;color:#fff;line-height:1.4">' + esc(c.headline) + '</div>' : '') +
      '<div style="font-size:13px;color:var(--muted);line-height:1.65">' + esc(c.body || '') + '</div>' +
      (c.metric ? '<div style="margin-top:auto;padding-top:6px;border-top:1px solid rgba(255,255,255,.06)"><span style="font-size:10px;letter-spacing:2px;color:var(--muted)">RESULT</span><div style="font-family:var(--ff-disp);font-size:18px;color:var(--teal);margin-top:2px">' + esc(c.metric) + '</div></div>' : '') +
    '</div>';
  }

  async function load(){
    var host = document.getElementById('gl-case-studies');
    if(!host) return;
    var items = null;
    try {
      if(window.supa){
        var r = await window.supa.from('case_studies').select('*').eq('published', true).order('display_order',{ascending:true,nullsFirst:false}).limit(12);
        if(r && r.data && r.data.length) items = r.data;
      }
    } catch(e){ /* fall through to demo */ }
    items = items || DEMO;
    host.innerHTML = items.map(cardHtml).join('');
  }

  function start(){
    if(document.getElementById('gl-case-studies')) load();
    else setTimeout(start, 600);
  }
  if(document.readyState !== 'loading') start();
  else document.addEventListener('DOMContentLoaded', start);

  console.log('[GL] public case studies loaded');
}());

/* ============================================================
   CUSTOMER PORTAL (read-only project status)
   URL: <site>/#portal/<client-uuid>
   ============================================================ */
(function(){
  var esc = window.glEsc;
  function fmt$(n){ return '$' + Math.round(n || 0).toLocaleString(); }

  function getClientIdFromHash(){
    var h = window.location.hash || '';
    var m = h.match(/^#portal\/([\w-]{20,})$/);
    return m ? m[1] : null;
  }

  async function loadClient(cid){
    if(!window.supa) return null;
    try {
      var r = await window.supa.from('clients').select('*').eq('id', cid).maybeSingle();
      return r && r.data;
    } catch(e){ return null; }
  }

  async function loadAll(cid){
    if(!window.supa) return { invoices: [], runs: [], samples: [] };
    var out = { invoices: [], runs: [], samples: [] };
    try {
      var inv = await window.supa.from('invoices').select('*').eq('client_id', cid).order('invoice_date',{ascending:false}).limit(20);
      if(inv && inv.data) out.invoices = inv.data;
    } catch(e){}
    try {
      var rn = await window.supa.from('production_runs').select('*').eq('client_id', cid).order('scheduled_start_date',{ascending:true,nullsFirst:false}).limit(20);
      if(rn && rn.data) out.runs = rn.data;
    } catch(e){}
    try {
      var sm = await window.supa.from('sample_shipments').select('*').eq('client_id', cid).order('shipped_date',{ascending:false}).limit(20);
      if(sm && sm.data) out.samples = sm.data;
    } catch(e){}
    return out;
  }

  function statusBadge(s){
    var map = {
      paid:    'background:rgba(29,158,117,.15);color:#5fcf9e;border-color:rgba(29,158,117,.35)',
      overdue: 'background:rgba(231,76,60,.15);color:#ff8579;border-color:rgba(231,76,60,.35)',
      pending: 'background:rgba(245,200,66,.12);color:#f5c842;border-color:rgba(245,200,66,.3)',
      sent:    'background:rgba(0,229,192,.1);color:#00e5c0;border-color:rgba(0,229,192,.3)',
      draft:   'background:rgba(155,155,155,.15);color:#9aa7bd;border-color:rgba(155,155,155,.3)'
    };
    var css = map[s] || map.draft;
    return '<span style="padding:3px 9px;border-radius:20px;font-size:11px;font-weight:600;border:1px solid;text-transform:uppercase;letter-spacing:1px;' + css + '">' + esc(s || 'draft') + '</span>';
  }

  function runStageBadge(stage){
    var colors = { Discovery:'#9aa7bd', Formulation:'#7fc6f5', Sample:'#c4a4f8', COA:'#f5c842', Production:'#5fcf9e', Ship:'#00e5c0' };
    var color = colors[stage] || '#9aa7bd';
    return '<span style="padding:3px 9px;border-radius:20px;font-size:11px;font-weight:600;background:rgba(255,255,255,.04);color:' + color + ';border:1px solid ' + color + '44">' + esc(stage || 'Discovery') + '</span>';
  }

  async function render(host, cid){
    host.innerHTML = '<div style="max-width:840px;margin:60px auto;text-align:center;color:#9aa7bd;font-size:14px">Loading your projects…</div>';
    host.style.display = 'block';

    var client = await loadClient(cid);
    if(!client){
      host.innerHTML = '<div style="max-width:520px;margin:80px auto;padding:32px;background:#142238;border:1px solid rgba(231,76,60,.3);border-radius:14px;text-align:center"><div style="font-family:var(--ff-disp);font-size:18px;color:#ff8579;margin-bottom:10px">PORTAL LINK NOT FOUND</div><div style="font-size:13px;color:#9aa7bd;line-height:1.6">This link may have been mistyped or revoked. Please contact Mike@GoodLiquid.com for a fresh link.</div></div>';
      return;
    }

    var data = await loadAll(cid);
    var unpaidTotal = data.invoices.filter(function(i){ return i.status !== 'paid'; }).reduce(function(s,i){ return s + (i.amount||0); }, 0);
    var openRuns = data.runs.filter(function(r){ return r.stage !== 'Ship'; }).length;
    var pendingSamples = data.samples.filter(function(s){ return s.status === 'sent'; }).length;

    host.innerHTML = '<div style="max-width:900px;margin:0 auto">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:30px;padding-bottom:20px;border-bottom:1px solid rgba(255,255,255,.08)">' +
        '<div>' +
          '<div style="font-family:var(--ff-disp);font-size:11px;letter-spacing:3px;color:#00e5c0">CLIENT PORTAL</div>' +
          '<div style="font-family:var(--ff-disp);font-size:28px;letter-spacing:2px;color:#fff;margin-top:4px">' + esc(client.name) + '</div>' +
          '<div style="font-size:12px;color:#9aa7bd;margin-top:2px">Project status · Updated ' + new Date().toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'}) + '</div>' +
        '</div>' +
        '<a href="mailto:Mike@GoodLiquid.com" style="font-size:12px;color:#00e5c0;text-decoration:none;border:1px solid rgba(0,229,192,.3);padding:8px 16px;border-radius:20px">✉ Contact Mike</a>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:30px">' +
        '<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:12px;padding:18px;text-align:center"><div style="font-size:11px;color:#9aa7bd;letter-spacing:2px">OPEN RUNS</div><div style="font-family:var(--ff-disp);font-size:32px;color:#fff;margin-top:6px">' + openRuns + '</div></div>' +
        '<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:12px;padding:18px;text-align:center"><div style="font-size:11px;color:#9aa7bd;letter-spacing:2px">SAMPLES OUT</div><div style="font-family:var(--ff-disp);font-size:32px;color:#fff;margin-top:6px">' + pendingSamples + '</div></div>' +
        '<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:12px;padding:18px;text-align:center"><div style="font-size:11px;color:#9aa7bd;letter-spacing:2px">UNPAID BALANCE</div><div style="font-family:var(--ff-disp);font-size:32px;color:' + (unpaidTotal > 0 ? '#f5c842' : '#5fcf9e') + ';margin-top:6px">' + fmt$(unpaidTotal) + '</div></div>' +
      '</div>' +
      '<div style="margin-bottom:30px">' +
        '<div style="font-family:var(--ff-disp);font-size:13px;letter-spacing:2px;color:#00e5c0;margin-bottom:14px">PRODUCTION RUNS</div>' +
        (data.runs.length
          ? '<div style="background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.06);border-radius:12px;overflow:hidden">' +
              data.runs.map(function(r, i){
                var sched = r.scheduled_date ? window.fmtLocalDate(r.scheduled_date, {month:'short',day:'numeric'}) : '—';
                return '<div style="padding:14px 18px;display:flex;justify-content:space-between;align-items:center' + (i < data.runs.length - 1 ? ';border-bottom:1px solid rgba(255,255,255,.05)' : '') + '">' +
                  '<div><div style="font-size:13px;color:#fff;font-weight:600">' + esc(r.run_name || '(run)') + '</div>' +
                  '<div style="font-size:11px;color:#9aa7bd;margin-top:2px">' + esc(r.format || '—') + (r.cases ? ' · ' + Number(r.cases).toLocaleString() + ' cases' : '') + ' · 📅 ' + sched + '</div></div>' +
                  '<div>' + runStageBadge(r.stage || 'Discovery') + '</div>' +
                '</div>';
              }).join('') +
            '</div>'
          : '<div style="font-size:13px;color:#9aa7bd;padding:14px 0">No active runs. Reach out to Mike to schedule one.</div>'
        ) +
      '</div>' +
      '<div style="margin-bottom:30px">' +
        '<div style="font-family:var(--ff-disp);font-size:13px;letter-spacing:2px;color:#00e5c0;margin-bottom:14px">SAMPLES SHIPPED TO YOU</div>' +
        (data.samples.length
          ? '<div style="background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.06);border-radius:12px;overflow:hidden">' +
              data.samples.map(function(s, i){
                var shipDate = s.shipped_date ? window.fmtLocalDate(s.shipped_date, {month:'short',day:'numeric',year:'numeric'}) : '—';
                return '<div style="padding:14px 18px;display:flex;justify-content:space-between;align-items:center' + (i < data.samples.length - 1 ? ';border-bottom:1px solid rgba(255,255,255,.05)' : '') + '">' +
                  '<div><div style="font-size:13px;color:#fff;font-weight:600">' + esc(s.kind || 'Sample') + (s.qty ? ' · ' + s.qty + ' unit' + (s.qty === 1 ? '' : 's') : '') + '</div>' +
                  '<div style="font-size:11px;color:#9aa7bd;margin-top:2px">Shipped ' + shipDate + (s.carrier ? ' via ' + esc(s.carrier) : '') + (s.tracking ? ' · ' + esc(s.tracking) : '') + '</div></div>' +
                  '<div>' + statusBadge(s.status || 'sent') + '</div>' +
                '</div>';
              }).join('') +
            '</div>'
          : '<div style="font-size:13px;color:#9aa7bd;padding:14px 0">No samples shipped to you yet.</div>'
        ) +
      '</div>' +
      '<div style="margin-bottom:50px">' +
        '<div style="font-family:var(--ff-disp);font-size:13px;letter-spacing:2px;color:#00e5c0;margin-bottom:14px">INVOICES</div>' +
        (data.invoices.length
          ? '<div style="background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.06);border-radius:12px;overflow:hidden">' +
              data.invoices.map(function(inv, i){
                var d = inv.invoice_date ? window.fmtLocalDate(inv.invoice_date, {month:'short',day:'numeric',year:'numeric'}) : '—';
                return '<div style="padding:14px 18px;display:flex;justify-content:space-between;align-items:center' + (i < data.invoices.length - 1 ? ';border-bottom:1px solid rgba(255,255,255,.05)' : '') + '">' +
                  '<div><div style="font-size:13px;color:#fff;font-weight:600">' + esc(inv.invoice_number || inv.id) + ' · ' + fmt$(inv.amount) + '</div>' +
                  '<div style="font-size:11px;color:#9aa7bd;margin-top:2px">' + esc(inv.service || '') + ' · ' + d + '</div></div>' +
                  '<div>' + statusBadge(inv.status || 'pending') + '</div>' +
                '</div>';
              }).join('') +
            '</div>'
          : '<div style="font-size:13px;color:#9aa7bd;padding:14px 0">No invoices on file.</div>'
        ) +
      '</div>' +
      '<div style="text-align:center;padding:20px 0;border-top:1px solid rgba(255,255,255,.06);font-size:11px;color:#9aa7bd">Good Liquid Bev Co · 2011 51st Ave E, Unit 100 · Palmetto, FL 34221 · <a href="mailto:Mike@GoodLiquid.com" style="color:#00e5c0">Mike@GoodLiquid.com</a></div>' +
    '</div>';
  }

  function maybeMount(){
    var host = document.getElementById('gl-portal');
    if(!host) return;
    var cid = getClientIdFromHash();
    if(!cid){ host.style.display = 'none'; return; }
    document.body.style.overflow = 'hidden';
    render(host, cid);
  }

  if(document.readyState !== 'loading') maybeMount();
  else document.addEventListener('DOMContentLoaded', maybeMount);
  window.addEventListener('hashchange', maybeMount);

  console.log('[GL] customer portal loaded');
}());

/* ============================================================
   RUN SHEET PDF
   window.glPrintRunSheet(runId) — printable for the line lead.
   Pulls associated formula (allergen profile, ingredients, target
   specs) from glFormulas so the line crew has everything in one page.
   ============================================================ */
(function(){
  var esc = window.glEsc;

  function buildHtml(run){
    var client = (window.clients||[]).find(function(c){ return c.id === run.client_id; }) || {};
    var formula = (window.glFormulas||[])
      .filter(function(f){ return f.client_id === run.client_id; })
      .sort(function(a,b){ return (b.version||0) - (a.version||0); })[0];
    var allergens = formula && formula.allergens ? formula.allergens : [];
    var allergenMap = { gluten:'Gluten', dairy:'Dairy', soy:'Soy', eggs:'Eggs', tree_nuts:'Tree nuts', peanuts:'Peanuts', sesame:'Sesame', fish:'Fish', shellfish:'Shellfish', sulfites:'Sulfites' };
    var allergenList = allergens.length
      ? allergens.map(function(a){ return allergenMap[a] || a; }).join(' · ')
      : '<span style="color:#666">None declared</span>';
    var sched = run.scheduled_date ? window.fmtLocalDate(run.scheduled_date, {weekday:'long',month:'long',day:'numeric',year:'numeric'}) : '—';

    return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Run Sheet · ' + esc(run.run_name||'') + '</title>' +
      '<style>' +
      'body{font-family:Arial,sans-serif;max-width:780px;margin:30px auto;color:#111;font-size:13px;line-height:1.5}' +
      '.hdr{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #0F6E56;padding-bottom:18px;margin-bottom:24px}' +
      '.brand{font-size:20px;font-weight:900;color:#0F6E56;letter-spacing:2px}' +
      '.brand-sub{font-size:10px;color:#666;margin-top:3px}' +
      'h2{font-size:14px;letter-spacing:2px;color:#0F6E56;margin:24px 0 10px;text-transform:uppercase}' +
      '.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}' +
      '.box{background:#f7f7f7;border:1px solid #ddd;border-radius:6px;padding:12px}' +
      '.lbl{font-size:9px;letter-spacing:2px;color:#999;text-transform:uppercase;margin-bottom:3px}' +
      '.val{font-weight:600;color:#111;font-size:14px}' +
      '.allergen{background:#fee;border:1px solid #fcc;color:#c33;padding:12px;border-radius:6px;font-size:12px}' +
      '.sig-row{display:grid;grid-template-columns:1fr 1fr 1fr;gap:24px;margin-top:48px}' +
      '.sig-line{border-bottom:1px solid #333;height:32px;margin-bottom:6px}' +
      '.sig-lbl{font-size:10px;color:#666;text-transform:uppercase;letter-spacing:1px}' +
      '@media print{body{margin:0;padding:20px}}' +
      '</style></head><body>' +
      '<div class="hdr">' +
        '<div><div class="brand">GOOD LIQUID BEV CO</div><div class="brand-sub">RUN SHEET · 2011 51st Ave E, Unit 100, Palmetto FL 34221</div></div>' +
        '<div style="text-align:right"><h2 style="margin:0;border:none;font-size:18px">' + esc(run.run_name||'Untitled Run') + '</h2><div style="color:#666;font-size:11px;margin-top:2px">Printed ' + new Date().toLocaleString() + '</div></div>' +
      '</div>' +

      '<div class="grid">' +
        '<div class="box"><div class="lbl">CLIENT</div><div class="val">' + esc(client.name || run.client_name || '—') + '</div></div>' +
        '<div class="box"><div class="lbl">SCHEDULED</div><div class="val">' + esc(sched) + '</div></div>' +
        '<div class="box"><div class="lbl">FORMAT</div><div class="val">' + esc(run.format || '—') + '</div></div>' +
        '<div class="box"><div class="lbl">CASES PLANNED</div><div class="val">' + (run.cases ? Number(run.cases).toLocaleString() : '—') + '</div></div>' +
        '<div class="box"><div class="lbl">STAGE</div><div class="val">' + esc(run.stage || 'Production') + '</div></div>' +
        '<div class="box"><div class="lbl">FORMULA</div><div class="val">' + (formula ? esc(formula.name) + ' · v' + (formula.version||1) : '<span style="color:#999">—</span>') + '</div></div>' +
      '</div>' +

      '<h2>Allergen profile</h2>' +
      '<div class="allergen">' +
        '<strong>⚠ Allergens declared on this product:</strong> ' + allergenList +
        (allergens.length ? '<br><span style="font-size:11px;color:#666">CIP / sanitation must be verified before this run if the previous run had different allergens.</span>' : '') +
      '</div>' +

      (formula && formula.ingredients
        ? '<h2>Ingredients</h2><div style="background:#f7f7f7;border:1px solid #ddd;border-radius:6px;padding:12px;font-family:monospace;white-space:pre-wrap;font-size:12px">' + esc(formula.ingredients) + '</div>'
        : ''
      ) +

      (formula && (formula.ph_target || formula.brix_target || formula.batch_size_gal)
        ? '<h2>Target specs</h2><div class="grid">' +
          (formula.batch_size_gal ? '<div class="box"><div class="lbl">BATCH SIZE</div><div class="val">' + esc(formula.batch_size_gal) + ' gal</div></div>' : '') +
          (formula.ph_target ? '<div class="box"><div class="lbl">pH TARGET</div><div class="val">' + esc(formula.ph_target) + '</div></div>' : '') +
          (formula.brix_target ? '<div class="box"><div class="lbl">BRIX TARGET</div><div class="val">' + esc(formula.brix_target) + '</div></div>' : '') +
        '</div>'
        : ''
      ) +

      (run.notes
        ? '<h2>Run notes</h2><div style="background:#fff8e1;border-left:4px solid #f5c842;padding:12px 16px;font-size:12px;line-height:1.6">' + esc(run.notes) + '</div>'
        : ''
      ) +

      '<div class="sig-row">' +
        '<div><div class="sig-line"></div><div class="sig-lbl">Line lead</div></div>' +
        '<div><div class="sig-line"></div><div class="sig-lbl">QC sign-off</div></div>' +
        '<div><div class="sig-line"></div><div class="sig-lbl">Date / time</div></div>' +
      '</div>' +
      '</body></html>';
  }

  window.glPrintRunSheetData = function(run){
    if(!run){ alert('No run data passed.'); return; }
    var html = buildHtml(run);
    var w = window.open('', '_blank', 'width=900,height=900');
    w.document.write(html);
    w.document.close();
    w.onload = function(){ w.focus(); w.print(); };
    if(typeof window.glAudit === 'function') window.glAudit('run_sheet_printed', run.id || run.run_name || '', {});
  };

  window.glPrintRunSheet = function(runId){
    var run = (window.glProductionRuns||[]).find(function(r){ return r.id === runId; });
    if(!run){ alert('Run not found. Open a run, click Edit, then Print Run Sheet.'); return; }
    window.glPrintRunSheetData(run);
  };

  console.log('[GL] run sheet PDF loaded');
}());

/* ============================================================
   PORTAL LINK COPY HELPER
   window.glCopyPortalLink(clientId) — copies the customer-portal URL
   to the clipboard so Mike can paste it into an email. Standalone
   helper; the Edit Client modal (PR #7) will wire a button to it.
   ============================================================ */
(function(){
  window.glCopyPortalLink = async function(clientId){
    if(!clientId){ alert('No client.'); return; }
    var base = window.location.origin + window.location.pathname.replace(/[^/]*$/, '');
    var url = base + '#portal/' + clientId;
    try { await navigator.clipboard.writeText(url); }
    catch(e){
      var ta = document.createElement('textarea'); ta.value = url; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
    }
    if(typeof addNotification === 'function') addNotification('🔗 Portal link copied', url, 'success');
    else alert('Portal link copied:\n\n' + url);
    if(typeof window.glAudit === 'function') window.glAudit('portal_link_copied', clientId, {});
  };
  console.log('[GL] portal link helper loaded');
}());

/* ============================================================
   TRADE SHOW ROI TRACKER
   ============================================================ */
(function(){
  var esc = window.glEsc;
  function fmt$(n){ return '$' + Math.round(n || 0).toLocaleString(); }
  window.glTradeShows = window.glTradeShows || [];

  async function load(){
    if(window.supa){
      try { var r = await window.supa.from('trade_shows').select('*').order('show_date',{ascending:false}); if(r && r.data) return r.data; } catch(e){}
    }
    try { return JSON.parse(localStorage.getItem('gl_trade_shows') || '[]'); } catch(e){ return []; }
  }
  function saveLocal(){ localStorage.setItem('gl_trade_shows', JSON.stringify(window.glTradeShows)); }
  function roi(s){ var c = Number(s.cost) || 0; var r = Number(s.revenue) || 0; if(!c) return r > 0 ? Infinity : 0; return ((r - c) / c) * 100; }
  function roiColor(p){ if(p === Infinity || p >= 200) return '#5fcf9e'; if(p >= 0) return '#f5c842'; return '#ff8579'; }
  function roiLabel(p){ return p === Infinity ? '∞' : Math.round(p) + '%'; }

  window.openTradeShowROI = async function(){
    var prior = document.getElementById('gl-ts-modal'); if(prior) prior.remove();
    var host = document.getElementById('crm-panel') || document.body;
    window.glTradeShows = await load();
    var rows = window.glTradeShows;
    var totalCost = rows.reduce(function(s,r){ return s + (Number(r.cost)||0); }, 0);
    var totalRev  = rows.reduce(function(s,r){ return s + (Number(r.revenue)||0); }, 0);
    var totalROI  = roi({ cost: totalCost, revenue: totalRev });
    var rowsHtml = rows.map(function(r){
      var d = r.show_date ? window.fmtLocalDate(r.show_date, {month:'short',year:'numeric'}) : '—';
      var p = roi(r);
      return '<tr style="cursor:pointer" onclick="window.glEditTradeShow(\'' + esc(r.id) + '\')">' +
        '<td style="padding:11px;font-weight:600;color:var(--white)">' + esc(r.name || '(untitled)') + '</td>' +
        '<td style="padding:11px;color:var(--muted)">' + d + '</td>' +
        '<td style="padding:11px;color:var(--muted)">' + fmt$(r.cost) + '</td>' +
        '<td style="padding:11px;color:var(--muted)">' + (r.leads_count || 0) + '</td>' +
        '<td style="padding:11px;color:var(--muted)">' + (r.deals_won || 0) + '</td>' +
        '<td style="padding:11px;color:var(--white);font-weight:600">' + fmt$(r.revenue) + '</td>' +
        '<td style="padding:11px;color:' + roiColor(p) + ';font-weight:700">' + roiLabel(p) + '</td>' +
      '</tr>';
    }).join('');
    var ov = document.createElement('div');
    ov.id = 'gl-ts-modal';
    ov.setAttribute('style','position:fixed;inset:0;z-index:1000;background:rgba(6,13,26,.88);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:20px');
    ov.innerHTML =
      '<div style="background:#142238;border:1px solid rgba(0,229,192,.2);border-radius:14px;padding:26px;width:100%;max-width:840px;max-height:88vh;overflow-y:auto">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">' +
          '<div style="font-family:var(--ff-disp);font-size:18px;letter-spacing:2px;color:var(--teal)">🎪 TRADE SHOW ROI</div>' +
          '<button id="gl-ts-close" style="background:none;border:none;color:#9aa7bd;font-size:20px;cursor:pointer">✕</button>' +
        '</div>' +
        (rows.length
          ? '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:11px;margin-bottom:18px">' +
              '<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:10px;padding:13px;text-align:center"><div style="font-size:10px;color:var(--muted);letter-spacing:1px">TOTAL SPENT</div><div style="font-family:var(--ff-disp);font-size:22px;color:var(--white);margin-top:3px">' + fmt$(totalCost) + '</div></div>' +
              '<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:10px;padding:13px;text-align:center"><div style="font-size:10px;color:var(--muted);letter-spacing:1px">TOTAL REVENUE</div><div style="font-family:var(--ff-disp);font-size:22px;color:var(--teal);margin-top:3px">' + fmt$(totalRev) + '</div></div>' +
              '<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:10px;padding:13px;text-align:center"><div style="font-size:10px;color:var(--muted);letter-spacing:1px">ROLLING ROI</div><div style="font-family:var(--ff-disp);font-size:22px;color:' + roiColor(totalROI) + ';margin-top:3px">' + roiLabel(totalROI) + '</div></div>' +
            '</div>'
          : '') +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">' +
          '<div style="font-size:12px;color:#9aa7bd">' + rows.length + ' show' + (rows.length === 1 ? '' : 's') + ' tracked</div>' +
          '<button id="gl-ts-add" class="cbtn pri" style="font-size:12px">+ Add show</button>' +
        '</div>' +
        (rows.length
          ? '<table class="ctbl"><thead><tr><th>Show</th><th>When</th><th>Cost</th><th>Leads</th><th>Won</th><th>Revenue</th><th>ROI</th></tr></thead><tbody>' + rowsHtml + '</tbody></table>'
          : '<div style="padding:30px;text-align:center;color:var(--muted);font-size:13px">No trade shows tracked yet. Add your first one to start measuring which shows pay back.</div>'
        ) +
      '</div>';
    ov.addEventListener('click', function(e){ if(e.target === ov) ov.remove(); });
    ov.querySelector('#gl-ts-close').addEventListener('click', function(){ ov.remove(); });
    ov.querySelector('#gl-ts-add').addEventListener('click', function(){ tsForm(null, ov); });
    host.appendChild(ov);
  };

  window.glEditTradeShow = function(id){
    var s = (window.glTradeShows||[]).find(function(x){ return x.id === id; });
    if(s) tsForm(s, document.getElementById('gl-ts-modal'));
  };

  function tsForm(existing, parent){
    var prior = document.getElementById('gl-ts-form'); if(prior) prior.remove();
    var host = document.getElementById('crm-panel') || document.body;
    var isEdit = !!existing;
    var s = existing || { name:'', show_date: new Date().toISOString().slice(0,10), location:'', cost:0, leads_count:0, deals_won:0, revenue:0, notes:'' };
    var ov = document.createElement('div');
    ov.id = 'gl-ts-form';
    ov.setAttribute('style','position:fixed;inset:0;z-index:1100;background:rgba(6,13,26,.92);backdrop-filter:blur(10px);display:flex;align-items:center;justify-content:center;padding:20px');
    ov.innerHTML =
      '<div style="background:#142238;border:1px solid rgba(0,229,192,.2);border-radius:14px;padding:26px;width:100%;max-width:440px">' +
        '<div style="font-family:var(--ff-disp);font-size:18px;letter-spacing:2px;color:var(--teal);margin-bottom:14px">' + (isEdit ? '✏️ EDIT SHOW' : '🎪 ADD SHOW') + '</div>' +
        '<div class="frow"><div class="flbl">Name *</div><input class="finp" id="gl-ts-name" value="' + esc(s.name) + '" placeholder="e.g. BevNet Live 2026"></div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
          '<div class="frow"><div class="flbl">Date</div><input class="finp" id="gl-ts-date" type="date" value="' + esc(s.show_date) + '"></div>' +
          '<div class="frow"><div class="flbl">Location</div><input class="finp" id="gl-ts-loc" value="' + esc(s.location) + '"></div>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
          '<div class="frow"><div class="flbl">Total cost ($)</div><input class="finp" id="gl-ts-cost" type="number" min="0" value="' + (s.cost||0) + '"></div>' +
          '<div class="frow"><div class="flbl">Leads collected</div><input class="finp" id="gl-ts-leads" type="number" min="0" value="' + (s.leads_count||0) + '"></div>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
          '<div class="frow"><div class="flbl">Deals won</div><input class="finp" id="gl-ts-won" type="number" min="0" value="' + (s.deals_won||0) + '"></div>' +
          '<div class="frow"><div class="flbl">Revenue attributed ($)</div><input class="finp" id="gl-ts-rev" type="number" min="0" value="' + (s.revenue||0) + '"></div>' +
        '</div>' +
        '<div class="frow"><div class="flbl">Notes</div><textarea class="finp" id="gl-ts-notes" rows="2">' + esc(s.notes) + '</textarea></div>' +
        '<div style="display:flex;gap:8px;margin-top:6px">' +
          '<button id="gl-ts-save" class="cbtn pri" style="flex:1">💾 Save</button>' +
          (isEdit ? '<button id="gl-ts-del" class="cbtn" style="background:rgba(231,76,60,.12);border-color:rgba(231,76,60,.35);color:#ff8579">Delete</button>' : '') +
          '<button id="gl-ts-cancel" class="cbtn">Cancel</button>' +
        '</div>' +
      '</div>';
    ov.querySelector('#gl-ts-cancel').addEventListener('click', function(){ ov.remove(); });
    var del = ov.querySelector('#gl-ts-del');
    if(del) del.addEventListener('click', async function(){
      if(!confirm('Delete this show?')) return;
      if(window.supa){ try { await window.supa.from('trade_shows').delete().eq('id', s.id); } catch(e){} }
      window.glTradeShows = (window.glTradeShows||[]).filter(function(x){ return x.id !== s.id; });
      saveLocal(); ov.remove();
      if(parent) parent.remove();
      window.openTradeShowROI();
    });
    ov.querySelector('#gl-ts-save').addEventListener('click', async function(){
      var data = {
        name:        ov.querySelector('#gl-ts-name').value.trim(),
        show_date:   ov.querySelector('#gl-ts-date').value || null,
        location:    ov.querySelector('#gl-ts-loc').value.trim(),
        cost:        parseFloat(ov.querySelector('#gl-ts-cost').value) || 0,
        leads_count: parseInt(ov.querySelector('#gl-ts-leads').value, 10) || 0,
        deals_won:   parseInt(ov.querySelector('#gl-ts-won').value, 10) || 0,
        revenue:     parseFloat(ov.querySelector('#gl-ts-rev').value) || 0,
        notes:       ov.querySelector('#gl-ts-notes').value
      };
      if(!data.name){ alert('Name is required.'); return; }
      if(window.supa){
        try {
          if(isEdit){ await window.supa.from('trade_shows').update(data).eq('id', s.id); Object.assign(s, data); }
          else { var r = await window.supa.from('trade_shows').insert([data]).select().single(); if(r && r.data){ window.glTradeShows.unshift(r.data); } else { data.id = 'local_' + Date.now(); window.glTradeShows.unshift(data); } }
        } catch(e){
          if(isEdit) Object.assign(s, data);
          else { data.id = 'local_' + Date.now(); window.glTradeShows.unshift(data); }
        }
      } else {
        if(isEdit) Object.assign(s, data);
        else { data.id = 'local_' + Date.now(); window.glTradeShows.unshift(data); }
      }
      saveLocal();
      ov.remove();
      if(parent) parent.remove();
      window.openTradeShowROI();
      if(typeof addNotification === 'function') addNotification('🎪 ' + (isEdit ? 'Show updated' : 'Show added'), data.name, 'success');
    });
    host.appendChild(ov);
  }

  console.log('[GL] trade show ROI loaded');
}());

/* ============================================================
   PRODUCTIZED SERVICE PACKAGES
   ============================================================ */
(function(){
  var esc = window.glEsc;
  function fmt$(n){ return '$' + Math.round(n || 0).toLocaleString(); }

  var SEED = [
    { id:'seed_launch', name:'Brand Launch Bundle', tagline:'Recipe to retail in one engagement', price:8500,
      items:['R&D formulation (1 SKU, 3 iterations)','Benchtop verification + COA','First production run (up to 500 cases)','Brand strategy call (90 min)','PakTech handles + custom lid color'] },
    { id:'seed_rd_run', name:'R&D + First Run', tagline:'Lower-commit on-ramp for new brands', price:4500,
      items:['R&D formulation (1 SKU)','Benchtop verification','Pilot canning run (150 cases minimum)'] },
    { id:'seed_quarterly', name:'Quarterly Co-pack Plan', tagline:'Locked-in capacity for growing brands', price:0,
      items:['4 production runs reserved per year','5% discount vs. ad-hoc rate card','Priority scheduling on dock days','Quarterly business review'] }
  ];

  function loadLocal(){ try { var raw = localStorage.getItem('gl_service_packages'); if(raw) return JSON.parse(raw); } catch(e){} return SEED.slice(); }
  function saveLocal(arr){ localStorage.setItem('gl_service_packages', JSON.stringify(arr)); }

  window.openServicePackages = function(){
    var prior = document.getElementById('gl-pkg-modal'); if(prior) prior.remove();
    var host = document.getElementById('crm-panel') || document.body;
    var pkgs = loadLocal();
    var rowsHtml = pkgs.map(function(p){
      return '<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:18px;margin-bottom:12px">' +
        '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:14px;margin-bottom:10px">' +
          '<div><div style="font-family:var(--ff-disp);font-size:15px;letter-spacing:1px;color:var(--white)">' + esc(p.name) + '</div>' +
            '<div style="font-size:12px;color:var(--teal);margin-top:2px">' + esc(p.tagline) + '</div></div>' +
          '<div style="text-align:right"><div style="font-family:var(--ff-disp);font-size:22px;color:var(--teal)">' + (p.price ? fmt$(p.price) : 'Custom') + '</div></div>' +
        '</div>' +
        '<ul style="margin:0;padding-left:18px;font-size:12px;color:#9aa7bd;line-height:1.7">' + p.items.map(function(it){ return '<li>' + esc(it) + '</li>'; }).join('') + '</ul>' +
        '<div style="display:flex;gap:8px;margin-top:12px">' +
          '<button class="cbtn gl-pkg-quote" data-id="' + esc(p.id) + '" style="font-size:11px;padding:6px 12px">📋 Copy as quote text</button>' +
          '<button class="cbtn gl-pkg-edit" data-id="' + esc(p.id) + '" style="font-size:11px;padding:6px 12px">✏️ Edit</button>' +
          '<button class="cbtn gl-pkg-del"  data-id="' + esc(p.id) + '" style="font-size:11px;padding:6px 12px;background:rgba(231,76,60,.1);border-color:rgba(231,76,60,.3);color:#ff8579">Delete</button>' +
        '</div>' +
      '</div>';
    }).join('');
    var ov = document.createElement('div');
    ov.id = 'gl-pkg-modal';
    ov.setAttribute('style','position:fixed;inset:0;z-index:1000;background:rgba(6,13,26,.88);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:20px');
    ov.innerHTML =
      '<div style="background:#142238;border:1px solid rgba(0,229,192,.2);border-radius:14px;padding:26px;width:100%;max-width:580px;max-height:88vh;overflow-y:auto">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
          '<div style="font-family:var(--ff-disp);font-size:18px;letter-spacing:2px;color:var(--teal)">📦 SERVICE PACKAGES</div>' +
          '<button id="gl-pkg-close" style="background:none;border:none;color:#9aa7bd;font-size:20px;cursor:pointer">✕</button>' +
        '</div>' +
        '<div style="font-size:12px;color:#9aa7bd;margin-bottom:18px;line-height:1.6">Pre-built bundles. "Copy as quote text" pastes into emails or quote PDFs. Stored per-device.</div>' +
        rowsHtml +
        '<div style="display:flex;justify-content:flex-end;margin-top:10px"><button id="gl-pkg-add" class="cbtn pri">+ New package</button></div>' +
      '</div>';
    ov.addEventListener('click', function(e){ if(e.target === ov) ov.remove(); });
    ov.querySelector('#gl-pkg-close').addEventListener('click', function(){ ov.remove(); });
    ov.querySelector('#gl-pkg-add').addEventListener('click', function(){ ov.remove(); pkgEditor(null); });
    ov.querySelectorAll('.gl-pkg-edit').forEach(function(b){
      b.addEventListener('click', function(){
        var p = pkgs.find(function(x){ return x.id === b.getAttribute('data-id'); });
        ov.remove(); pkgEditor(p);
      });
    });
    ov.querySelectorAll('.gl-pkg-quote').forEach(function(b){
      b.addEventListener('click', async function(){
        var p = pkgs.find(function(x){ return x.id === b.getAttribute('data-id'); });
        if(!p) return;
        var txt = p.name + ' — ' + (p.price ? fmt$(p.price) : 'Custom quote') + '\n' + p.tagline + '\n\nIncludes:\n' + p.items.map(function(i){ return '  • ' + i; }).join('\n');
        try { await navigator.clipboard.writeText(txt); }
        catch(e){
          var ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
        }
        b.textContent = '✓ Copied'; setTimeout(function(){ b.textContent = '📋 Copy as quote text'; }, 1500);
      });
    });
    ov.querySelectorAll('.gl-pkg-del').forEach(function(b){
      b.addEventListener('click', function(){
        var p = pkgs.find(function(x){ return x.id === b.getAttribute('data-id'); });
        if(!p) return;
        if(!confirm('Delete "' + p.name + '"?')) return;
        var fresh = loadLocal().filter(function(x){ return x.id !== p.id; });
        saveLocal(fresh);
        ov.remove(); window.openServicePackages();
      });
    });
    host.appendChild(ov);
  };

  function pkgEditor(existing){
    var host = document.getElementById('crm-panel') || document.body;
    var isEdit = !!existing;
    var p = existing || { id: 'pkg_' + Date.now(), name:'', tagline:'', price:0, items:[''] };
    var ov = document.createElement('div');
    ov.id = 'gl-pkg-edit';
    ov.setAttribute('style','position:fixed;inset:0;z-index:1000;background:rgba(6,13,26,.88);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:20px');
    ov.innerHTML =
      '<div style="background:#142238;border:1px solid rgba(0,229,192,.2);border-radius:14px;padding:26px;width:100%;max-width:460px">' +
        '<div style="font-family:var(--ff-disp);font-size:18px;letter-spacing:2px;color:var(--teal);margin-bottom:14px">' + (isEdit ? '✏️ EDIT PACKAGE' : '📦 NEW PACKAGE') + '</div>' +
        '<div class="frow"><div class="flbl">Name *</div><input class="finp" id="gl-pkg-name" value="' + esc(p.name) + '"></div>' +
        '<div class="frow"><div class="flbl">Tagline</div><input class="finp" id="gl-pkg-tag" value="' + esc(p.tagline) + '"></div>' +
        '<div class="frow"><div class="flbl">Price ($ — leave 0 for "Custom")</div><input class="finp" id="gl-pkg-price" type="number" min="0" value="' + (p.price||0) + '"></div>' +
        '<div class="frow"><div class="flbl">Items (one per line)</div><textarea class="finp" id="gl-pkg-items" rows="6">' + esc((p.items||[]).join('\n')) + '</textarea></div>' +
        '<div style="display:flex;gap:8px;margin-top:6px">' +
          '<button id="gl-pkg-savebtn" class="cbtn pri" style="flex:1">💾 Save</button>' +
          '<button id="gl-pkg-cancelbtn" class="cbtn">Cancel</button>' +
        '</div>' +
      '</div>';
    ov.querySelector('#gl-pkg-cancelbtn').addEventListener('click', function(){ ov.remove(); window.openServicePackages(); });
    ov.querySelector('#gl-pkg-savebtn').addEventListener('click', function(){
      var data = {
        id:      p.id,
        name:    ov.querySelector('#gl-pkg-name').value.trim(),
        tagline: ov.querySelector('#gl-pkg-tag').value.trim(),
        price:   parseFloat(ov.querySelector('#gl-pkg-price').value) || 0,
        items:   ov.querySelector('#gl-pkg-items').value.split('\n').map(function(s){ return s.trim(); }).filter(Boolean)
      };
      if(!data.name){ alert('Name is required.'); return; }
      var fresh = loadLocal();
      if(isEdit){ var idx = fresh.findIndex(function(x){ return x.id === p.id; }); if(idx >= 0) fresh[idx] = data; else fresh.push(data); }
      else { fresh.push(data); }
      saveLocal(fresh);
      ov.remove(); window.openServicePackages();
    });
    host.appendChild(ov);
  }

  console.log('[GL] service packages loaded');
}());

/* ============================================================
   CHURN PREDICTOR (AI)
   ============================================================ */
(function(){
  var esc = window.glEsc;

  function gatherSnapshot(){
    var clients = (window.clients||[]).filter(function(c){ return c.status === 'active'; });
    var lines = clients.map(function(c){
      var invs = (window.invoices||[]).filter(function(i){ return i.client === c.id; });
      var latest = invs.reduce(function(m,i){
        if(!i.date) return m;
        var t = Date.parse(i.date);
        return (t && (!m || t > m)) ? t : m;
      }, null);
      var daysSince = latest ? Math.round((Date.now() - latest) / 86400000) : null;
      var totalBilled = invs.reduce(function(s,i){ return s + (i.amount||0); }, 0);
      var paidCount   = invs.filter(function(i){ return i.status === 'paid'; }).length;
      var unpaid      = invs.filter(function(i){ return i.status !== 'paid'; }).reduce(function(s,i){ return s + (i.amount||0); }, 0);
      return c.name + ' | $' + Math.round(totalBilled).toLocaleString() + ' lifetime | ' + paidCount + ' paid runs | $' + Math.round(unpaid).toLocaleString() + ' unpaid | last invoice ' + (daysSince === null ? 'never' : daysSince + 'd ago') + ' | service: ' + (c.service||'—');
    });
    return lines.join('\n');
  }

  window.openChurnPredictor = function(){
    var prior = document.getElementById('gl-churn-modal'); if(prior) prior.remove();
    var host = document.getElementById('crm-panel') || document.body;
    var ov = document.createElement('div');
    ov.id = 'gl-churn-modal';
    ov.setAttribute('style','position:fixed;inset:0;z-index:1000;background:rgba(6,13,26,.88);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:20px');
    ov.innerHTML =
      '<div style="background:#142238;border:1px solid rgba(0,229,192,.2);border-radius:14px;padding:26px;width:100%;max-width:620px;max-height:88vh;overflow-y:auto">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
          '<div style="font-family:var(--ff-disp);font-size:18px;letter-spacing:2px;color:var(--teal)">🔮 CHURN RISK</div>' +
          '<button id="gl-churn-close" style="background:none;border:none;color:#9aa7bd;font-size:20px;cursor:pointer">✕</button>' +
        '</div>' +
        '<div style="font-size:12px;color:#9aa7bd;margin-bottom:14px;line-height:1.6">AI ranks your active clients by churn risk and explains why. Uses lifetime billed, paid-run count, unpaid balance, days since last invoice.</div>' +
        '<div style="display:flex;gap:8px"><button id="gl-churn-go" class="cbtn pri" style="flex:1">🔮 Analyze</button></div>' +
        '<div id="gl-churn-out" style="margin-top:16px"></div>' +
      '</div>';
    ov.addEventListener('click', function(e){ if(e.target === ov) ov.remove(); });
    ov.querySelector('#gl-churn-close').addEventListener('click', function(){ ov.remove(); });
    ov.querySelector('#gl-churn-go').addEventListener('click', async function(){
      var btn = this; var out = ov.querySelector('#gl-churn-out');
      var snapshot = gatherSnapshot();
      if(!snapshot){ out.innerHTML = '<div style="color:#9aa7bd;font-size:13px;padding:14px">No active clients to analyze.</div>'; return; }
      btn.disabled = true; btn.textContent = '🔮 Thinking…';
      out.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:14px;text-align:center">Reading the room…</div>';
      var sys = 'You are a CRM analyst for Good Liquid Bev Co. You spot churn risk based on invoice cadence and amount. Be concrete — name names, cite the metric driving the risk, and suggest a specific retention action. Do not invent data not in the snapshot.';
      var user = 'Here is a snapshot of every active client (one per line):\n\n' + snapshot + '\n\nReturn the top 3 churn risks. Use this exact format:\n\n=== Risk N ===\nClient: <brand>\nRisk level: <HIGH | MEDIUM | LOW>\nWhy: <one sentence citing the specific metric>\nSuggested action: <one short concrete next step this week>';
      if(typeof window.callAI !== 'function'){
        out.innerHTML = '<div style="color:#f5c842;font-size:13px;padding:14px">AI not configured. Open AI Settings to paste your Anthropic key.</div>';
        btn.disabled = false; btn.textContent = '🔮 Analyze'; return;
      }
      var text = await window.callAI(sys, user);
      btn.disabled = false; btn.textContent = '🔮 Analyze';
      if(!text){ out.innerHTML = '<div style="color:#f5c842;font-size:13px;padding:14px">No AI response.</div>'; return; }
      var parts = text.split(/===\s*Risk\s*\d+\s*===/i).map(function(s){ return s.trim(); }).filter(Boolean);
      if(!parts.length) parts = [text];
      out.innerHTML = parts.map(function(p, i){
        var level = /HIGH/i.test(p) ? '#ff8579' : /MEDIUM/i.test(p) ? '#f5c842' : '#5fcf9e';
        return '<div style="background:rgba(255,255,255,.03);border:1px solid ' + level + '55;border-radius:10px;padding:14px;margin-bottom:10px">' +
          '<div style="font-family:var(--ff-disp);font-size:10px;letter-spacing:2px;color:' + level + ';margin-bottom:6px">RISK ' + (i+1) + '</div>' +
          '<div style="font-size:13px;color:var(--white);line-height:1.6;white-space:pre-wrap">' + esc(p) + '</div>' +
        '</div>';
      }).join('');
      if(typeof window.glAudit === 'function') window.glAudit('churn_predicted', '', { count: parts.length });
    });
    host.appendChild(ov);
  };

  console.log('[GL] churn predictor loaded');
}());

/* ============================================================
   PUBLIC QUOTE CALCULATOR (lives on the pricing section)
   Reads inputs from #qc-* fields and updates #qc-total + #qc-breakdown
   on every change. Pricing data mirrors the rate card on the site.
   ============================================================ */
(function(){
  // Canning rate per case by format + cases tier. Mirrors index.html pricing.
  var RATES = {
    canning: {
      '12std':   [[150,11.52],[340,10.32],[501,9.12],[1000,8.40],[2500,7.44],[5000,6.72]],
      '12sleek': [[150,11.52],[340,10.32],[501,9.12],[1000,8.40],[2500,7.44],[5000,6.72]],
      '16std':   [[150,13.92],[340,12.72],[501,11.52],[1000,10.80],[2500,9.84],[5000,9.12]]
    },
    bottling: {
      '750ml':   [[220,12.96],[660,11.46],[1320,9.48],[2640,8.46],[5280,6.72]]
    }
  };

  function rateForCases(table, cases){
    var match = table[0];
    for(var i = 0; i < table.length; i++){
      if(cases >= table[i][0]) match = table[i];
    }
    return match[1];
  }

  function fmt$(n){ return '$' + Math.round(n).toLocaleString(); }

  function compute(){
    var svc = document.getElementById('qc-service'); if(!svc) return;
    var fmt = document.getElementById('qc-format');
    var casesEl = document.getElementById('qc-cases');
    var totalEl = document.getElementById('qc-total');
    var bdEl    = document.getElementById('qc-breakdown');
    var pasteur = document.getElementById('qc-pasteur');
    var nitro   = document.getElementById('qc-nitro');

    var service = svc.value;
    // If user picks bottling, force the format to 750ml; if canning, ensure can format.
    if(service === 'bottling'){
      var hasBottle = false;
      for(var i = 0; i < fmt.options.length; i++){
        if(fmt.options[i].value === '750ml'){ hasBottle = true; fmt.options[i].disabled = false; }
        else { fmt.options[i].disabled = true; }
      }
      if(hasBottle && fmt.value !== '750ml') fmt.value = '750ml';
    } else {
      for(var j = 0; j < fmt.options.length; j++){
        fmt.options[j].disabled = (fmt.options[j].value === '750ml');
      }
      if(fmt.value === '750ml') fmt.value = '12std';
    }

    var cases = Math.max(150, parseInt(casesEl.value, 10) || 150);
    casesEl.value = cases;
    var table = (RATES[service] || {})[fmt.value];
    if(!table){ totalEl.textContent = '$0'; bdEl.textContent = ''; return; }

    var perCase = rateForCases(table, cases);
    var base = perCase * cases;
    var pCost = pasteur && pasteur.checked ? (cases * 24 * 0.08) : 0;     // ~8¢/can * 24 cans/case
    var nCost = nitro && nitro.checked    ? (cases * 24 * 0.035) : 0;     // ~3.5¢/can
    var total = base + pCost + nCost;

    totalEl.textContent = fmt$(total);
    var lines = [
      'Run cost: ' + fmt$(base) + ' (' + cases.toLocaleString() + ' cases @ ' + fmt$(perCase) + '/case)'
    ];
    if(pCost) lines.push('+ Flash pasteurization: ' + fmt$(pCost));
    if(nCost) lines.push('+ Nitrogen dosing: ' + fmt$(nCost));
    lines.push('Excludes ingredients, packaging, freight.');
    bdEl.innerHTML = lines.join('<br>');
  }

  function start(){
    var svc = document.getElementById('qc-service');
    if(!svc){ setTimeout(start, 600); return; }
    ['qc-service','qc-format','qc-cases','qc-pasteur','qc-nitro'].forEach(function(id){
      var el = document.getElementById(id);
      if(el) el.addEventListener('input', compute);
      if(el) el.addEventListener('change', compute);
    });
    compute();
  }
  if(document.readyState !== 'loading') start();
  else document.addEventListener('DOMContentLoaded', start);

  console.log('[GL] public quote calculator loaded');
}());

/* ============================================================
   CONTENT CALENDAR (CRM page)
   Month grid view of planned posts across channels. Each entry:
   date, channel (IG/LinkedIn/X/FB), status (idea/draft/scheduled/
   posted), short title, full caption.
   Backed by Supabase `content_calendar` table; localStorage fallback.
   ============================================================ */
(function(){
  var esc = window.glEsc;
  var CHANNELS = [
    ['instagram','📷 Instagram','#E1306C'],
    ['linkedin','💼 LinkedIn','#0077B5'],
    ['x','🐦 X','#fff'],
    ['facebook','📘 Facebook','#1877F2']
  ];
  var STATUSES = [['idea','Idea'],['draft','Draft'],['scheduled','Scheduled'],['posted','Posted']];
  window.glContent = window.glContent || [];

  async function loadFromSupabase(){
    if(!window.supa) return null;
    try {
      var r = await window.supa.from('content_calendar').select('*').order('post_date',{ascending:true});
      if(r && r.data) return r.data;
    } catch(e){}
    return null;
  }
  function loadLocal(){ try { return JSON.parse(localStorage.getItem('gl_content') || '[]'); } catch(e){ return []; } }
  function saveLocal(){ localStorage.setItem('gl_content', JSON.stringify(window.glContent)); }

  var viewMonth = new Date(); viewMonth.setDate(1);
  async function refresh(){
    var rows = await loadFromSupabase();
    window.glContent = rows || loadLocal();
    render();
  }

  function statusColor(s){
    return ({ idea:'#9aa7bd', draft:'#f5c842', scheduled:'#7fc6f5', posted:'#5fcf9e' })[s] || '#9aa7bd';
  }
  function channelMeta(c){ return CHANNELS.find(function(x){ return x[0] === c; }) || ['', c, '#fff']; }

  function render(){
    var host = document.getElementById('cc-body');
    if(!host) return;
    var sub = document.getElementById('cc-sub');
    var rows = window.glContent || [];
    var scheduled = rows.filter(function(p){ return p.status === 'scheduled'; }).length;
    if(sub) sub.textContent = rows.length + ' post' + (rows.length === 1 ? '' : 's') + (scheduled ? ' · ' + scheduled + ' scheduled' : '');

    // Build month grid
    var year = viewMonth.getFullYear(), month = viewMonth.getMonth();
    var firstDow = new Date(year, month, 1).getDay();
    var daysInMonth = new Date(year, month + 1, 0).getDate();
    var monthLabel = viewMonth.toLocaleString('en-US', { month:'long', year:'numeric' });

    var postsByDate = {};
    rows.forEach(function(p){
      if(!p.post_date) return;
      var d = new Date(p.post_date);
      if(d.getFullYear() === year && d.getMonth() === month){
        var key = d.getDate();
        if(!postsByDate[key]) postsByDate[key] = [];
        postsByDate[key].push(p);
      }
    });

    var headerHtml = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">' +
      '<button class="cbtn" id="cc-prev" style="font-size:12px">← Prev</button>' +
      '<div style="font-family:var(--ff-disp);font-size:18px;letter-spacing:2px;color:var(--white)">' + monthLabel + '</div>' +
      '<button class="cbtn" id="cc-next" style="font-size:12px">Next →</button>' +
    '</div>';

    var dowHtml = '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:6px;margin-bottom:6px">' +
      ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(function(d){
        return '<div style="font-size:10px;letter-spacing:2px;color:var(--muted);text-align:center;padding:4px">' + d + '</div>';
      }).join('') +
    '</div>';

    var cells = '';
    // Blank pre-cells
    for(var b = 0; b < firstDow; b++){
      cells += '<div style="min-height:90px;background:rgba(255,255,255,.01);border:1px solid rgba(255,255,255,.04);border-radius:8px"></div>';
    }
    for(var d = 1; d <= daysInMonth; d++){
      var posts = postsByDate[d] || [];
      cells += '<div style="min-height:90px;background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.06);border-radius:8px;padding:6px;display:flex;flex-direction:column;gap:4px">' +
        '<div style="font-size:11px;color:var(--muted);font-weight:600">' + d + '</div>' +
        posts.map(function(p){
          var m = channelMeta(p.channel);
          var col = statusColor(p.status);
          return '<div onclick="window.glOpenEditContent(\'' + esc(p.id) + '\')" style="font-size:11px;color:var(--white);background:' + col + '22;border-left:3px solid ' + col + ';padding:4px 7px;border-radius:4px;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(p.title || '') + '">' +
            (m[0] ? m[1].split(' ')[0] + ' ' : '') + esc((p.title || '').slice(0, 20)) +
          '</div>';
        }).join('') +
      '</div>';
    }

    host.innerHTML = headerHtml + dowHtml +
      '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:6px">' + cells + '</div>';

    host.querySelector('#cc-prev').addEventListener('click', function(){
      viewMonth = new Date(year, month - 1, 1); render();
    });
    host.querySelector('#cc-next').addEventListener('click', function(){
      viewMonth = new Date(year, month + 1, 1); render();
    });
  }

  function contentForm(existing){
    var prior = document.getElementById('gl-cc-modal'); if(prior) prior.remove();
    var host = document.getElementById('crm-panel') || document.body;
    var isEdit = !!existing;
    var p = existing || { title:'', caption:'', channel:'instagram', status:'idea', post_date: new Date().toISOString().slice(0,10) };
    var chOpts = CHANNELS.map(function(c){
      var sel = (c[0] === p.channel) ? ' selected' : '';
      return '<option value="' + c[0] + '"'+sel+'>' + c[1] + '</option>';
    }).join('');
    var stOpts = STATUSES.map(function(s){
      var sel = (s[0] === p.status) ? ' selected' : '';
      return '<option value="' + s[0] + '"'+sel+'>' + s[1] + '</option>';
    }).join('');
    var ov = document.createElement('div');
    ov.id = 'gl-cc-modal';
    ov.setAttribute('style','position:fixed;inset:0;z-index:1000;background:rgba(6,13,26,.88);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:20px');
    ov.innerHTML =
      '<div style="background:#142238;border:1px solid rgba(0,229,192,.2);border-radius:14px;padding:26px;width:100%;max-width:500px">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">' +
          '<div style="font-family:var(--ff-disp);font-size:18px;letter-spacing:2px;color:var(--teal)">' + (isEdit ? '✏️ EDIT POST' : '🗓️ NEW POST') + '</div>' +
          '<button id="gl-cc-close" style="background:none;border:none;color:#9aa7bd;font-size:20px;cursor:pointer">✕</button>' +
        '</div>' +
        '<div class="frow"><div class="flbl">Title (short, for the calendar tile) *</div><input class="finp" id="gl-cc-title" value="' + esc(p.title) + '"></div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">' +
          '<div class="frow"><div class="flbl">Channel</div><select class="fsel" id="gl-cc-channel">' + chOpts + '</select></div>' +
          '<div class="frow"><div class="flbl">Status</div><select class="fsel" id="gl-cc-status">' + stOpts + '</select></div>' +
          '<div class="frow"><div class="flbl">Date</div><input class="finp" id="gl-cc-date" type="date" value="' + esc(p.post_date) + '"></div>' +
        '</div>' +
        '<div class="frow"><div class="flbl">Full caption / draft</div><textarea class="finp" id="gl-cc-caption" rows="6">' + esc(p.caption) + '</textarea></div>' +
        '<div style="display:flex;gap:8px;margin-top:6px">' +
          '<button id="gl-cc-save" class="cbtn pri" style="flex:1">💾 Save</button>' +
          (isEdit ? '<button id="gl-cc-del" class="cbtn" style="background:rgba(231,76,60,.12);border-color:rgba(231,76,60,.35);color:#ff8579">Delete</button>' : '') +
          '<button id="gl-cc-cancel" class="cbtn">Cancel</button>' +
        '</div>' +
      '</div>';
    ov.addEventListener('click', function(e){ if(e.target === ov) ov.remove(); });
    ov.querySelector('#gl-cc-close').addEventListener('click', function(){ ov.remove(); });
    ov.querySelector('#gl-cc-cancel').addEventListener('click', function(){ ov.remove(); });
    var del = ov.querySelector('#gl-cc-del');
    if(del) del.addEventListener('click', async function(){
      if(!confirm('Delete this post?')) return;
      if(window.supa){ try { await window.supa.from('content_calendar').delete().eq('id', p.id); } catch(e){} }
      window.glContent = (window.glContent||[]).filter(function(x){ return x.id !== p.id; });
      saveLocal(); render(); ov.remove();
    });
    ov.querySelector('#gl-cc-save').addEventListener('click', async function(){
      var data = {
        title:     ov.querySelector('#gl-cc-title').value.trim(),
        caption:   ov.querySelector('#gl-cc-caption').value,
        channel:   ov.querySelector('#gl-cc-channel').value,
        status:    ov.querySelector('#gl-cc-status').value,
        post_date: ov.querySelector('#gl-cc-date').value || null
      };
      if(!data.title){ alert('Title is required.'); return; }
      if(window.supa){
        try {
          if(isEdit){ await window.supa.from('content_calendar').update(data).eq('id', p.id); Object.assign(p, data); }
          else { var r = await window.supa.from('content_calendar').insert([data]).select().single(); if(r && r.data){ window.glContent.push(r.data); } else { data.id = 'local_' + Date.now(); window.glContent.push(data); } }
        } catch(e){
          if(isEdit) Object.assign(p, data);
          else { data.id = 'local_' + Date.now(); window.glContent.push(data); }
        }
      } else {
        if(isEdit) Object.assign(p, data);
        else { data.id = 'local_' + Date.now(); window.glContent.push(data); }
      }
      saveLocal(); ov.remove(); render();
      if(typeof addNotification === 'function') addNotification('🗓️ ' + (isEdit ? 'Post updated' : 'Post added'), data.title, 'success');
    });
    host.appendChild(ov);
  }

  window.glOpenAddContent  = function(){ contentForm(null); };
  window.glOpenEditContent = function(id){
    var p = (window.glContent||[]).find(function(x){ return x.id === id; });
    if(p) contentForm(p);
  };

  function watch(){
    var pg = document.getElementById('cpg-content');
    if(!pg){ setTimeout(watch, 600); return; }
    new MutationObserver(function(){ if(pg.classList.contains('act')) refresh(); }).observe(pg, { attributes:true, attributeFilter:['class'] });
  }
  if(document.readyState !== 'loading') watch();
  else document.addEventListener('DOMContentLoaded', watch);

  console.log('[GL] content calendar loaded');
}());

/* ============================================================
   AI IMAGE PROMPT GENERATOR
   Returns 3 ready-to-paste prompts for Midjourney / DALL-E / Stable
   Diffusion based on product type + scene + mood. Uses callAI.
   ============================================================ */
(function(){
  var esc = window.glEsc;

  window.openAIImagePrompts = function(){
    var prior = document.getElementById('gl-img-modal'); if(prior) prior.remove();
    var host = document.getElementById('crm-panel') || document.body;
    var ov = document.createElement('div');
    ov.id = 'gl-img-modal';
    ov.setAttribute('style','position:fixed;inset:0;z-index:1000;background:rgba(6,13,26,.88);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:20px');
    ov.innerHTML =
      '<div style="background:#142238;border:1px solid rgba(0,229,192,.2);border-radius:14px;padding:26px;width:100%;max-width:580px;max-height:88vh;overflow-y:auto">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
          '<div style="font-family:var(--ff-disp);font-size:18px;letter-spacing:2px;color:var(--teal)">🎨 AI IMAGE PROMPTS</div>' +
          '<button id="gl-img-close" style="background:none;border:none;color:#9aa7bd;font-size:20px;cursor:pointer">✕</button>' +
        '</div>' +
        '<div style="font-size:12px;color:#9aa7bd;margin-bottom:14px;line-height:1.6">Generates 3 ready-to-paste prompts for Midjourney / DALL-E / Stable Diffusion. Copy any of them into your image tool of choice.</div>' +
        '<div class="frow"><div class="flbl">Product</div><input class="finp" id="gl-img-product" placeholder="e.g. 12oz can of mango hop water"></div>' +
        '<div class="frow"><div class="flbl">Scene / setting</div><input class="finp" id="gl-img-scene" placeholder="e.g. wet beach rocks, golden hour, ocean spray"></div>' +
        '<div class="frow"><div class="flbl">Mood</div>' +
          '<select class="fsel" id="gl-img-mood">' +
            '<option>Bright + summery</option>' +
            '<option>Moody + premium</option>' +
            '<option>Minimal + clean studio</option>' +
            '<option>Action / motion</option>' +
            '<option>Behind-the-scenes documentary</option>' +
            '<option>Editorial / magazine</option>' +
          '</select>' +
        '</div>' +
        '<div style="display:flex;gap:8px"><button id="gl-img-go" class="cbtn pri" style="flex:1">✨ Draft 3 prompts</button></div>' +
        '<div id="gl-img-out" style="margin-top:16px"></div>' +
      '</div>';
    ov.addEventListener('click', function(e){ if(e.target === ov) ov.remove(); });
    ov.querySelector('#gl-img-close').addEventListener('click', function(){ ov.remove(); });
    ov.querySelector('#gl-img-go').addEventListener('click', async function(){
      var btn = this; var out = ov.querySelector('#gl-img-out');
      var product = ov.querySelector('#gl-img-product').value.trim();
      var scene   = ov.querySelector('#gl-img-scene').value.trim();
      var mood    = ov.querySelector('#gl-img-mood').value;
      if(!product){ alert('Describe the product first.'); return; }
      btn.disabled = true; btn.textContent = '✨ Drafting…';
      out.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:14px;text-align:center">Composing prompts…</div>';
      var sys = 'You write image-generation prompts for product photography of beverage cans and bottles. Each prompt must be vivid, specific, include camera/lens hints when relevant, and stay under 80 words. Use commercial-photo language (studio, key light, rim light, depth of field). Return EXACTLY three numbered prompts separated by "=== Prompt N ===" delimiters.';
      var user = 'Product: ' + product + '\nScene: ' + (scene || 'studio') + '\nMood: ' + mood + '\n\nReturn three distinct prompts. Variations should differ in composition (close macro vs lifestyle vs flat-lay) and lighting (key light angle, color temperature, contrast). No preamble.\n\nFormat:\n=== Prompt 1 ===\n<prompt text>\n\n=== Prompt 2 ===\n<prompt text>\n\n=== Prompt 3 ===\n<prompt text>';
      if(typeof window.callAI !== 'function'){
        out.innerHTML = '<div style="color:#f5c842;font-size:13px;padding:14px">AI not configured. Open AI Settings to paste your Anthropic key.</div>';
        btn.disabled = false; btn.textContent = '✨ Draft 3 prompts'; return;
      }
      var text = await window.callAI(sys, user);
      btn.disabled = false; btn.textContent = '✨ Draft 3 prompts';
      if(!text){ out.innerHTML = '<div style="color:#f5c842;font-size:13px;padding:14px">No AI response.</div>'; return; }
      var parts = text.split(/===\s*Prompt\s*\d+\s*===/i).map(function(s){ return s.trim(); }).filter(Boolean);
      if(!parts.length) parts = [text];
      out.innerHTML = parts.map(function(p, i){
        return '<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:14px;margin-bottom:10px">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">' +
            '<div style="font-family:var(--ff-disp);font-size:10px;letter-spacing:2px;color:var(--teal)">PROMPT ' + (i+1) + '</div>' +
            '<button class="gl-img-copy cbtn" data-text="' + esc(p).replace(/"/g,'&quot;') + '" style="font-size:10px;padding:4px 10px">📋 Copy</button>' +
          '</div>' +
          '<div style="font-size:13px;color:var(--white);line-height:1.6;white-space:pre-wrap">' + esc(p) + '</div>' +
        '</div>';
      }).join('');
      out.querySelectorAll('.gl-img-copy').forEach(function(b){
        b.addEventListener('click', async function(){
          var t = b.getAttribute('data-text') || '';
          try { await navigator.clipboard.writeText(t); } catch(e){
            var ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
          }
          b.textContent = '✓ Copied'; setTimeout(function(){ b.textContent = '📋 Copy'; }, 1500);
        });
      });
      if(typeof window.glAudit === 'function') window.glAudit('ai_image_prompts', '', { mood: mood });
    });
    host.appendChild(ov);
  };

  console.log('[GL] AI image prompts loaded');
}());

/* ============================================================
   PUBLIC RESOURCE LIBRARY (blog grid)
   ============================================================ */
(function(){
  var esc = window.glEsc;

  var DEMO = [
    { title:'How to launch a hard kombucha brand', tag:'Brand launch', excerpt:'From recipe to retail in 5 milestones. What to expect on cost, timeline, and the FDA paperwork no one warns you about.', read_time_min:6, url:'resources/launch-hard-kombucha-brand.html' },
    { title:'Canning MOQs explained', tag:'Operations', excerpt:'Why 150 cases is our floor and what economic ladder kicks in at 500 / 1k / 5k. Read this before you ask for a quote.', read_time_min:4, url:'resources/canning-moqs-explained.html' },
    { title:'Flash vs. tunnel pasteurization for botanical beverages', tag:'R&D', excerpt:'Why batch flash pasteurization protects thermolabile botanicals that tunnel systems destroy. The science, the temperature data, and the real numbers.', read_time_min:7, url:'resources/flash-vs-tunnel-pasteurization-botanicals.html' },
    { title:'Pasteurization vs cold-fill — pick one', tag:'R&D', excerpt:'A practical decision tree based on pH, sugar, and where you plan to distribute. We make the call on every formulation we run.', read_time_min:5, url:'resources/pasteurization-vs-cold-fill.html' },
    { title:'PakTech handles + custom lid colors — what they cost', tag:'Packaging', excerpt:'Two upgrades brands always ask about. Real numbers on the per-can adder and when they pay off in shelf appeal.', read_time_min:3, url:'resources/paktech-custom-lid-colors.html' }
  ];

  function tagColor(t){
    var map = { 'Brand launch':'#5fcf9e', 'Operations':'#7fc6f5', 'R&D':'#c4a4f8', 'Packaging':'#f5c842' };
    return map[t] || '#9aa7bd';
  }

  function cardHtml(p){
    var col = tagColor(p.tag);
    var hasUrl = p.url && p.url !== '#';
    // Null/# URLs: scroll to contact form instead of jumping to top of page.
    var safeUrl = hasUrl ? p.url : 'javascript:void(0)';
    var newTab = (hasUrl && p.url.indexOf('http') === 0) ? ' target="_blank" rel="noopener"' : '';
    var onclickAttr = hasUrl ? '' : ' onclick="if(typeof navTo===\'function\')navTo(\'contact\')"';
    return '<a href="' + esc(safeUrl) + '"'+newTab+onclickAttr+' style="text-decoration:none;display:flex;flex-direction:column;gap:11px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:22px;transition:border-color .15s" onmouseover="this.style.borderColor=\'rgba(0,229,192,.35)\'" onmouseout="this.style.borderColor=\'rgba(255,255,255,.08)\'">' +
      (p.tag ? '<span style="display:inline-block;padding:3px 10px;border-radius:20px;font-size:10px;font-weight:600;letter-spacing:1px;background:' + col + '22;color:' + col + ';border:1px solid ' + col + '44;width:fit-content">' + esc(p.tag) + '</span>' : '') +
      '<div style="font-family:var(--ff-disp);font-size:16px;letter-spacing:.5px;color:#fff;line-height:1.3">' + esc(p.title || 'Untitled') + '</div>' +
      '<div style="font-size:13px;color:var(--muted);line-height:1.65">' + esc(p.excerpt || '') + '</div>' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:auto;padding-top:6px;border-top:1px solid rgba(255,255,255,.06)">' +
        '<span style="font-size:11px;color:var(--muted)">' + (p.read_time_min ? p.read_time_min + ' min read' : 'Read more') + '</span>' +
        '<span style="font-size:13px;color:var(--teal)">Read →</span>' +
      '</div>' +
    '</a>';
  }

  async function load(){
    var host = document.getElementById('gl-resources');
    if(!host) return;
    var items = null;
    try {
      if(window.supa){
        var r = await window.supa.from('resources').select('*').eq('published', true).order('display_order',{ascending:true,nullsFirst:false}).limit(8);
        if(r && r.data && r.data.length) items = r.data;
      }
    } catch(e){}
    items = items || DEMO;
    host.innerHTML = items.map(cardHtml).join('');
  }

  function start(){
    if(document.getElementById('gl-resources')) load();
    else setTimeout(start, 600);
  }
  if(document.readyState !== 'loading') start();
  else document.addEventListener('DOMContentLoaded', start);

  console.log('[GL] public resource library loaded');
}());

/* ============================================================
   EMAIL DRIP CAMPAIGN GENERATOR (AI)
   ============================================================ */
(function(){
  var esc = window.glEsc;
  var VERTICALS = ['RTD cocktail brand','Kombucha brand','Cold brew / coffee brand','Functional / wellness drink','Sparkling water brand','Energy drink brand','Hop water / NA beer brand','Sports / hydration brand','Generic — beverage startup'];

  window.openEmailDripGenerator = function(){
    var prior = document.getElementById('gl-drip-modal'); if(prior) prior.remove();
    var host = document.getElementById('crm-panel') || document.body;
    var verticalOpts = VERTICALS.map(function(v){ return '<option>' + esc(v) + '</option>'; }).join('');
    var ov = document.createElement('div');
    ov.id = 'gl-drip-modal';
    ov.setAttribute('style','position:fixed;inset:0;z-index:1000;background:rgba(6,13,26,.88);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:20px');
    ov.innerHTML =
      '<div style="background:#142238;border:1px solid rgba(0,229,192,.2);border-radius:14px;padding:26px;width:100%;max-width:640px;max-height:88vh;overflow-y:auto">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
          '<div style="font-family:var(--ff-disp);font-size:18px;letter-spacing:2px;color:var(--teal)">✉️ EMAIL DRIP GENERATOR</div>' +
          '<button id="gl-drip-close" style="background:none;border:none;color:#9aa7bd;font-size:20px;cursor:pointer">✕</button>' +
        '</div>' +
        '<div style="font-size:12px;color:#9aa7bd;margin-bottom:14px;line-height:1.6">AI drafts a 5-email cold-lead nurture sequence tailored to a beverage vertical. Each email has subject + body, copy-ready to drop into Mailgun, Mailchimp, or your tool of choice.</div>' +
        '<div class="frow"><div class="flbl">Target vertical</div><select class="fsel" id="gl-drip-vertical">' + verticalOpts + '</select></div>' +
        '<div class="frow"><div class="flbl">Lead source</div>' +
          '<select class="fsel" id="gl-drip-source">' +
            '<option value="cold">Pure cold outreach (we found them)</option>' +
            '<option value="form">Filled out quote form but went quiet</option>' +
            '<option value="show">Met us at a trade show</option>' +
            '<option value="referral">Came in via referral, never followed up</option>' +
          '</select>' +
        '</div>' +
        '<div class="frow"><div class="flbl">Pacing</div>' +
          '<select class="fsel" id="gl-drip-pace">' +
            '<option value="aggressive">Aggressive (every 2 days)</option>' +
            '<option value="standard" selected>Standard (every 4 days)</option>' +
            '<option value="slow">Slow burn (weekly)</option>' +
          '</select>' +
        '</div>' +
        '<div style="display:flex;gap:8px"><button id="gl-drip-go" class="cbtn pri" style="flex:1">✨ Draft 5-email sequence</button></div>' +
        '<div id="gl-drip-out" style="margin-top:16px"></div>' +
      '</div>';
    ov.addEventListener('click', function(e){ if(e.target === ov) ov.remove(); });
    ov.querySelector('#gl-drip-close').addEventListener('click', function(){ ov.remove(); });
    ov.querySelector('#gl-drip-go').addEventListener('click', async function(){
      var btn = this; var out = ov.querySelector('#gl-drip-out');
      var vertical = ov.querySelector('#gl-drip-vertical').value;
      var source   = ov.querySelector('#gl-drip-source').value;
      var pace     = ov.querySelector('#gl-drip-pace').value;
      btn.disabled = true; btn.textContent = '✨ Drafting…';
      out.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:14px;text-align:center">Composing 5 emails…</div>';
      var sys = 'You write cold-lead nurture sequences for Good Liquid Bev Co, a family-run beverage co-packer in Palmetto FL. Voice: confident, direct, founder-first-person ("we"). Avoid corporate filler ("innovative", "leverage", "passionate"). Each email is short (under 120 words). Sequence opens curious, builds value, ends with a clear ask.';
      var paceLine = ({ aggressive:'2 days apart', standard:'4 days apart', slow:'7 days apart' })[pace];
      var sourceLine = ({
        cold:'pure cold outreach — they don\'t know us yet',
        form:'they filled out our quote form but went silent',
        show:'we met them at a trade show',
        referral:'a referrer introduced them but they haven\'t responded'
      })[source];
      var user = 'Draft a 5-email nurture sequence for a ' + vertical + '. Context: ' + sourceLine + '. Pacing: ' + paceLine + '.\n\nReturn EXACTLY this format with the === delimiter, no preamble:\n\n=== Email 1 ===\nSubject: <subject>\nBody:\n<body>\n\n=== Email 2 ===\n...etc through Email 5. Subjects should sound like a real person sent them.';
      if(typeof window.callAI !== 'function'){
        out.innerHTML = '<div style="color:#f5c842;font-size:13px;padding:14px">AI not configured. Open AI Settings to paste your Anthropic key.</div>';
        btn.disabled = false; btn.textContent = '✨ Draft 5-email sequence'; return;
      }
      var text = await window.callAI(sys, user);
      btn.disabled = false; btn.textContent = '✨ Draft 5-email sequence';
      if(!text){ out.innerHTML = '<div style="color:#f5c842;font-size:13px;padding:14px">No AI response.</div>'; return; }
      var parts = text.split(/===\s*Email\s*\d+\s*===/i).map(function(s){ return s.trim(); }).filter(Boolean);
      if(!parts.length) parts = [text];
      out.innerHTML = parts.map(function(p, i){
        return '<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:14px;margin-bottom:10px">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">' +
            '<div style="font-family:var(--ff-disp);font-size:10px;letter-spacing:2px;color:var(--teal)">EMAIL ' + (i+1) + '</div>' +
            '<button class="gl-drip-copy cbtn" data-text="' + esc(p).replace(/"/g,'&quot;') + '" style="font-size:10px;padding:4px 10px">📋 Copy</button>' +
          '</div>' +
          '<div style="font-size:13px;color:var(--white);line-height:1.6;white-space:pre-wrap">' + esc(p) + '</div>' +
        '</div>';
      }).join('');
      out.querySelectorAll('.gl-drip-copy').forEach(function(b){
        b.addEventListener('click', async function(){
          var t = b.getAttribute('data-text') || '';
          try { await navigator.clipboard.writeText(t); } catch(e){
            var ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
          }
          b.textContent = '✓ Copied'; setTimeout(function(){ b.textContent = '📋 Copy'; }, 1500);
        });
      });
      if(typeof window.glAudit === 'function') window.glAudit('drip_generated', '', { vertical: vertical, source: source, pace: pace });
    });
    host.appendChild(ov);
  };

  console.log('[GL] email drip generator loaded');
}());

/* ============================================================
   LINKEDIN OUTREACH HELPER (AI)
   ============================================================ */
(function(){
  var esc = window.glEsc;

  window.openLinkedInOutreach = function(){
    var prior = document.getElementById('gl-li-modal'); if(prior) prior.remove();
    var host = document.getElementById('crm-panel') || document.body;
    var ov = document.createElement('div');
    ov.id = 'gl-li-modal';
    ov.setAttribute('style','position:fixed;inset:0;z-index:1000;background:rgba(6,13,26,.88);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:20px');
    ov.innerHTML =
      '<div style="background:#142238;border:1px solid rgba(0,229,192,.2);border-radius:14px;padding:26px;width:100%;max-width:580px;max-height:88vh;overflow-y:auto">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
          '<div style="font-family:var(--ff-disp);font-size:18px;letter-spacing:2px;color:var(--teal)">💼 LINKEDIN OUTREACH</div>' +
          '<button id="gl-li-close" style="background:none;border:none;color:#9aa7bd;font-size:20px;cursor:pointer">✕</button>' +
        '</div>' +
        '<div style="font-size:12px;color:#9aa7bd;margin-bottom:14px;line-height:1.6">Drafts 3 personalized cold messages. Open their LinkedIn in another tab, paste a recent post line into "Recent context" — that\'s what makes the message feel human.</div>' +
        '<div class="frow"><div class="flbl">Brand or person name *</div><input class="finp" id="gl-li-target" placeholder="e.g. SunBurst Seltzers / Alex Torres"></div>' +
        '<div class="frow"><div class="flbl">Their role (if known)</div><input class="finp" id="gl-li-role" placeholder="e.g. Founder & CEO"></div>' +
        '<div class="frow"><div class="flbl">Recent context (paste 1-2 lines from a post / bio)</div><textarea class="finp" id="gl-li-context" rows="3" placeholder="e.g. just posted about expanding into the Carolinas, talked about needing co-pack capacity for Q3"></textarea></div>' +
        '<div class="frow"><div class="flbl">Length</div>' +
          '<select class="fsel" id="gl-li-len">' +
            '<option value="connect" selected>Connection request (under 300 chars)</option>' +
            '<option value="message">Direct message (3-5 sentences)</option>' +
            '<option value="inmail">InMail (longer, with offer)</option>' +
          '</select>' +
        '</div>' +
        '<div style="display:flex;gap:8px"><button id="gl-li-go" class="cbtn pri" style="flex:1">✨ Draft 3 versions</button></div>' +
        '<div id="gl-li-out" style="margin-top:16px"></div>' +
      '</div>';
    ov.addEventListener('click', function(e){ if(e.target === ov) ov.remove(); });
    ov.querySelector('#gl-li-close').addEventListener('click', function(){ ov.remove(); });
    ov.querySelector('#gl-li-go').addEventListener('click', async function(){
      var btn = this; var out = ov.querySelector('#gl-li-out');
      var target  = ov.querySelector('#gl-li-target').value.trim();
      var role    = ov.querySelector('#gl-li-role').value.trim();
      var context = ov.querySelector('#gl-li-context').value.trim();
      var len     = ov.querySelector('#gl-li-len').value;
      if(!target){ alert('Who are we reaching out to?'); return; }
      btn.disabled = true; btn.textContent = '✨ Drafting…';
      out.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:14px;text-align:center">Composing…</div>';
      var lenLine = ({
        connect: 'a connection request under 300 characters (LinkedIn\'s hard limit)',
        message: 'a 3-5 sentence DM that fits on one screen',
        inmail:  'a longer InMail (8-10 sentences) with a soft pitch and one specific offer'
      })[len];
      var sys = 'You write LinkedIn outreach for Good Liquid Bev Co, a family-run beverage co-packer in Palmetto FL. Mike Krail (founder) is the sender. Voice: warm, specific, never templated. Always reference something concrete from the recipient — never use "innovative", "leverage", "passionate".';
      var user = 'Draft ' + lenLine + ' for outreach to: ' + target + (role ? ' (' + role + ')' : '') +
        '\n\nRecent context to reference (if any): ' + (context || '[none provided — keep it about co-packing fit without name-drops]') +
        '\n\nReturn 3 distinct variations using this format:\n\n=== Version 1 ===\n<message>\n\n=== Version 2 ===\n<message>\n\n=== Version 3 ===\n<message>\n\nNo preamble.';
      if(typeof window.callAI !== 'function'){
        out.innerHTML = '<div style="color:#f5c842;font-size:13px;padding:14px">AI not configured. Open AI Settings to paste your Anthropic key.</div>';
        btn.disabled = false; btn.textContent = '✨ Draft 3 versions'; return;
      }
      var text = await window.callAI(sys, user);
      btn.disabled = false; btn.textContent = '✨ Draft 3 versions';
      if(!text){ out.innerHTML = '<div style="color:#f5c842;font-size:13px;padding:14px">No AI response.</div>'; return; }
      var parts = text.split(/===\s*Version\s*\d+\s*===/i).map(function(s){ return s.trim(); }).filter(Boolean);
      if(!parts.length) parts = [text];
      out.innerHTML = parts.map(function(p, i){
        var charCount = p.length;
        var warn = len === 'connect' && charCount > 300 ? '<span style="color:#ff8579;font-size:10px;margin-left:6px">⚠ ' + charCount + ' chars (over LinkedIn limit)</span>' : '<span style="font-size:10px;color:var(--muted);margin-left:6px">' + charCount + ' chars</span>';
        return '<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:14px;margin-bottom:10px">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">' +
            '<div><span style="font-family:var(--ff-disp);font-size:10px;letter-spacing:2px;color:var(--teal)">VERSION ' + (i+1) + '</span>' + warn + '</div>' +
            '<button class="gl-li-copy cbtn" data-text="' + esc(p).replace(/"/g,'&quot;') + '" style="font-size:10px;padding:4px 10px">📋 Copy</button>' +
          '</div>' +
          '<div style="font-size:13px;color:var(--white);line-height:1.6;white-space:pre-wrap">' + esc(p) + '</div>' +
        '</div>';
      }).join('');
      out.querySelectorAll('.gl-li-copy').forEach(function(b){
        b.addEventListener('click', async function(){
          var t = b.getAttribute('data-text') || '';
          try { await navigator.clipboard.writeText(t); } catch(e){
            var ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
          }
          b.textContent = '✓ Copied'; setTimeout(function(){ b.textContent = '📋 Copy'; }, 1500);
        });
      });
      if(typeof window.glAudit === 'function') window.glAudit('linkedin_outreach', target, { length: len });
    });
    host.appendChild(ov);
  };

  console.log('[GL] linkedin outreach loaded');
}());


/* ============================================================
   LOW-STOCK DASHBOARD ALERT
   Reads window.inventory (the existing inventory list) and surfaces
   any item where qty <= reorder_threshold on a dashboard banner.
   Wraps renderDash like the compliance + AR aging widgets.
   ============================================================ */
(function(){
  var esc = window.glEsc;

  function gather(){
    var items = window.inventory || [];
    return items.filter(function(i){
      if(!i || typeof i !== 'object') return false;
      // Two field-name conventions seen in the wild:
      var qty = Number(i.qty != null ? i.qty : i.quantity);
      var par = Number(i.par != null ? i.par : (i.threshold != null ? i.threshold : i.reorder_at));
      return !isNaN(qty) && !isNaN(par) && qty <= par;
    });
  }

  window.renderLowStockAlert = function(){
    var host = document.getElementById('dash-low-stock');
    if(!host) return;
    var low = gather();
    if(!low.length){ host.innerHTML = ''; return; }
    var rows = low.slice(0, 6).map(function(i){
      var name = i.name || i.item || '(unnamed)';
      var qty = i.qty != null ? i.qty : i.quantity;
      var par = i.par != null ? i.par : (i.threshold != null ? i.threshold : i.reorder_at);
      return '<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 12px;border-radius:7px">' +
        '<div style="font-size:13px;color:var(--white);font-weight:600">' + esc(name) + '</div>' +
        '<div style="font-size:12px;color:#f5c842;font-weight:700">' + qty + ' on hand · par ' + par + '</div>' +
      '</div>';
    }).join('');
    host.innerHTML =
      '<div style="background:rgba(245,200,66,.06);border:1px solid rgba(245,200,66,.3);border-radius:12px;padding:14px 16px;margin-top:14px">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">' +
          '<div style="display:flex;align-items:center;gap:10px">' +
            '<span style="font-size:18px">📦</span>' +
            '<div>' +
              '<div style="font-family:var(--ff-disp);font-size:13px;letter-spacing:2px;color:#f5c842">LOW STOCK</div>' +
              '<div style="font-size:11px;color:var(--muted);margin-top:2px">' + low.length + ' item' + (low.length === 1 ? '' : 's') + ' at or below reorder threshold</div>' +
            '</div>' +
          '</div>' +
          '<a href="javascript:void(0)" onclick="if(window.cNav)window.cNav(\'inventory\',null)" style="font-size:11px;color:var(--teal);text-decoration:none">Open inventory →</a>' +
        '</div>' +
        '<div>' + rows + '</div>' +
      '</div>';
  };

  window.GL_HOOKS.registerDashPatch(function(){ try{ window.renderLowStockAlert(); }catch(e){ console.warn('[GL] low-stock alert threw', e); } });

  console.log('[GL] low-stock dashboard alert loaded');
}());

/* ============================================================
   RUN → INVOICE AUTO-DRAFT
   ============================================================ */
(function(){
  var esc = window.glEsc;
  function ratePerCase(format){
    var map = { '12oz Standard can':9.12, '12oz Sleek can':9.12, '16oz Standard can':11.52, '750ml bottle':9.48 };
    return map[format] || 9.12;
  }
  window.glDraftInvoiceFromRun = function(runId){
    var run = (window.glProductionRuns||[]).find(function(r){ return r.id === runId; });
    if(!run){ alert('Production run not found.'); return; }
    var cid = run.client_id;
    var client = (window.clients||[]).find(function(c){ return c.id === cid; });
    if(!client){ if(!confirm('No matching client found for this run. Draft an invoice anyway?')) return; }
    var cases = run.cases || 0;
    var format = run.format || '12oz Standard can';
    var perCase = ratePerCase(format);
    var lineDesc = 'Co-packing — ' + (run.run_name || 'Run') + ' · ' + format;
    window._glPendingDraft = {
      client_id: cid,
      client_name: client ? client.name : (run.client_name || ''),
      lines: [{ desc: lineDesc, qty: cases, unit: 'cases', unitPrice: perCase, total: cases * perCase }],
      notes: 'Drafted from production run ' + (run.run_name || run.id) + '. Verify yield, ingredients, and add-ons before sending.',
      paymentTerms: client && client.paymentTerms || 'Net 30'
    };
    if(typeof window.openNewInvoiceBuilder === 'function'){
      window.openNewInvoiceBuilder();
      setTimeout(function(){
        var clientSel = document.getElementById('ginv-client');
        if(clientSel && cid) clientSel.value = cid;
        if(typeof addNotification === 'function') addNotification('🧾 Draft created', 'Verify line items + add-ons before saving', 'info');
      }, 250);
    } else if(typeof window.cNav === 'function'){
      window.cNav('newinv', null);
    } else {
      alert('Could not open the invoice builder automatically.');
    }
    if(typeof window.glAudit === 'function') window.glAudit('invoice_drafted_from_run', runId, { cases: cases, format: format });
  };
  function injectButtons(){
    var detail = document.getElementById('cpg-production-runs');
    if(!detail || !detail.classList.contains('act')) return;
    detail.querySelectorAll('.gl-prun-card').forEach(function(card){
      if(card.querySelector('.gl-r2i-btn')) return;
      var col = card.closest('.gl-prun-col');
      if(!col) return;
      var stage = col.getAttribute('data-stage');
      if(stage !== 'Ship') return;
      var id = card.getAttribute('data-id');
      var btn = document.createElement('button');
      btn.className = 'cbtn gl-r2i-btn';
      btn.setAttribute('style','font-size:10px;padding:4px 9px;margin-top:6px;background:rgba(0,229,192,.12);border:1px solid rgba(0,229,192,.35);color:var(--teal);width:100%');
      btn.textContent = '🧾 Draft invoice';
      btn.addEventListener('click', function(e){ e.stopPropagation(); window.glDraftInvoiceFromRun(id); });
      card.appendChild(btn);
    });
  }
  function start(){
    var panel = document.getElementById('crm-panel');
    if(!panel){ setTimeout(start, 600); return; }
    new MutationObserver(function(){ setTimeout(injectButtons, 80); }).observe(panel, { childList:true, subtree:true });
  }
  if(document.readyState !== 'loading') start();
  else document.addEventListener('DOMContentLoaded', start);
  console.log('[GL] run → invoice draft loaded');
}());

/* ============================================================
   AR COLLECTION EMAILS (AI-drafted, Mailgun-sent)
   ============================================================ */
(function(){
  var esc = window.glEsc;
  function fmt$(n){ return '$' + Math.round(n||0).toLocaleString(); }

  function gatherOverdue(){
    var today = new Date(); today.setHours(0,0,0,0);
    return (window.invoices||[]).filter(function(i){
      if(!i || (i.status||'').toLowerCase() === 'paid') return false;
      var dueStr = i.dueDate || i.due_date;
      var due;
      if(dueStr) due = new Date(dueStr);
      else if(i.date) due = new Date(Date.parse(i.date) + 30*86400000);
      else return false;
      due.setHours(0,0,0,0);
      return due < today;
    }).map(function(i){
      var dueStr = i.dueDate || i.due_date;
      var due = dueStr ? new Date(dueStr) : new Date(Date.parse(i.date) + 30*86400000);
      due.setHours(0,0,0,0);
      var daysLate = Math.round((today - due) / 86400000);
      return { inv: i, daysLate: daysLate };
    }).sort(function(a,b){ return b.daysLate - a.daysLate; });
  }
  function toneFor(days){
    if(days <= 15) return 'gentle nudge';
    if(days <= 45) return 'firm but professional';
    return 'formal — escalating to collection';
  }
  async function draftEmail(inv, daysLate){
    var client = (window.clients||[]).find(function(c){ return c.id === inv.client; }) || {};
    var contactName = client.contact || 'there';
    var tone = toneFor(daysLate);
    if(typeof window.callAI !== 'function'){
      var subj = 'Invoice ' + inv.id + ' — ' + (daysLate <= 15 ? 'gentle reminder' : daysLate <= 45 ? 'past due notice' : 'collection notice');
      var body = 'Hi ' + contactName + ',\n\nOur records show invoice ' + inv.id + ' for ' + fmt$(inv.amount) + ' is ' + daysLate + ' day' + (daysLate === 1 ? '' : 's') + ' past its due date.\n\n' +
        (daysLate <= 15 ? 'A quick check that this didn\'t slip through — let us know if you need a fresh copy or a different payment method.\n\nThanks,\nGood Liquid Accounting'
        : daysLate <= 45 ? 'Please remit payment within the next 5 business days. If there\'s an issue with the invoice itself, reply to this email and we\'ll get it sorted.\n\nBest,\nGood Liquid Accounting'
        : 'This account is now significantly past due. We need payment received within 7 business days to avoid further escalation. Please call (803) 493-5065 if you\'d like to discuss a payment plan.\n\nRegards,\nGood Liquid Accounting');
      return { subject: subj, body: body };
    }
    var sys = 'You write collection emails for Good Liquid Bev Co (Palmetto FL beverage co-packer). The sender is the company\'s accounting team — never a personal name. Voice matches the tone level. Keep it under 100 words. End with a clear next step. Sign "Good Liquid Accounting" (do NOT use any personal name).';
    var user = 'Draft a ' + tone + ' collection email for invoice ' + inv.id + '. Owed: ' + fmt$(inv.amount) + '. Days past due: ' + daysLate + '. Contact: ' + contactName + ' (' + (client.name||'') + ').\n\nReturn EXACTLY this format:\nSubject: <subject line>\nBody:\n<email body>';
    var text = await window.callAI(sys, user);
    var m = text && text.match(/Subject:\s*(.+?)\nBody:\n([\s\S]+)/i);
    if(m) return { subject: m[1].trim(), body: m[2].trim() };
    return { subject: 'Invoice ' + inv.id + ' — past due', body: text || '' };
  }
  window.openARCollection = function(){
    var prior = document.getElementById('gl-ar-modal'); if(prior) prior.remove();
    var host = document.getElementById('crm-panel') || document.body;
    var rows = gatherOverdue();
    var bodyHtml = rows.length
      ? rows.map(function(r){
          var inv = r.inv;
          var client = (window.clients||[]).find(function(c){ return c.id === inv.client; }) || {};
          var color = r.daysLate <= 15 ? '#f5c842' : r.daysLate <= 45 ? '#ff8579' : '#e74c3c';
          return '<div style="background:rgba(255,255,255,.03);border:1px solid ' + color + '44;border-radius:10px;padding:14px;margin-bottom:9px">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">' +
              '<div><div style="font-size:13px;color:var(--white);font-weight:600">' + esc(inv.id) + ' · ' + fmt$(inv.amount) + '</div>' +
              '<div style="font-size:11px;color:var(--muted);margin-top:2px">' + esc(inv.clientName || client.name || '—') + ' · ' + esc(client.email || inv.clientEmail || 'no email on file') + '</div></div>' +
              '<div style="color:' + color + ';font-weight:700;font-size:13px">' + r.daysLate + 'd late</div>' +
            '</div>' +
            '<div style="display:flex;gap:6px">' +
              '<button class="cbtn gl-ar-draft" data-invid="' + esc(inv.id) + '" data-late="' + r.daysLate + '" style="font-size:11px;padding:5px 11px">✏️ Draft email</button>' +
              '<button class="cbtn gl-ar-send" data-invid="' + esc(inv.id) + '" data-late="' + r.daysLate + '" style="font-size:11px;padding:5px 11px;background:rgba(0,229,192,.12);border-color:rgba(0,229,192,.35);color:var(--teal)" ' + (!(client.email || inv.clientEmail) ? 'disabled' : '') + '>📧 Draft + send</button>' +
            '</div>' +
            '<div class="gl-ar-out" id="gl-ar-out-' + esc(inv.id) + '" style="margin-top:10px"></div>' +
          '</div>';
        }).join('')
      : '<div style="padding:30px;text-align:center;color:#5fcf9e;font-size:13px">✓ No invoices past due. Cash flow is clean.</div>';
    var ov = document.createElement('div');
    ov.id = 'gl-ar-modal';
    ov.setAttribute('style','position:fixed;inset:0;z-index:1000;background:rgba(6,13,26,.88);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:20px');
    ov.innerHTML =
      '<div style="background:#142238;border:1px solid rgba(0,229,192,.2);border-radius:14px;padding:26px;width:100%;max-width:620px;max-height:88vh;overflow-y:auto">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
          '<div style="font-family:var(--ff-disp);font-size:18px;letter-spacing:2px;color:var(--teal)">💰 AR COLLECTION</div>' +
          '<button id="gl-ar-close" style="background:none;border:none;color:#9aa7bd;font-size:20px;cursor:pointer">✕</button>' +
        '</div>' +
        '<div style="font-size:12px;color:#9aa7bd;margin-bottom:14px;line-height:1.6">Overdue invoices with one-click email drafts. Tone scales with days late: amber = gentle, orange = firm, red = formal.</div>' +
        bodyHtml +
      '</div>';
    ov.addEventListener('click', function(e){ if(e.target === ov) ov.remove(); });
    ov.querySelector('#gl-ar-close').addEventListener('click', function(){ ov.remove(); });
    ov.querySelectorAll('.gl-ar-draft, .gl-ar-send').forEach(function(b){
      b.addEventListener('click', async function(){
        var invId = b.getAttribute('data-invid');
        var late  = parseInt(b.getAttribute('data-late'), 10);
        var inv = (window.invoices||[]).find(function(i){ return i.id === invId; });
        if(!inv) return;
        var out = ov.querySelector('#gl-ar-out-' + invId);
        var sending = b.classList.contains('gl-ar-send');
        var orig = b.textContent;
        b.disabled = true; b.textContent = '✏️ Drafting…';
        out.innerHTML = '<div style="color:var(--muted);font-size:11px;padding:8px">Drafting…</div>';
        var draft = await draftEmail(inv, late);
        b.disabled = false; b.textContent = orig;
        var client = (window.clients||[]).find(function(c){ return c.id === inv.client; }) || {};
        var to = client.email || inv.clientEmail || '';
        out.innerHTML =
          '<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:10px;font-size:12px">' +
            '<div style="color:var(--muted);font-size:10px;letter-spacing:1px">SUBJECT</div>' +
            '<div style="color:var(--white);font-weight:600;margin-bottom:8px">' + esc(draft.subject) + '</div>' +
            '<div style="color:var(--muted);font-size:10px;letter-spacing:1px">BODY</div>' +
            '<div style="color:var(--white);white-space:pre-wrap;line-height:1.5;margin-bottom:10px">' + esc(draft.body) + '</div>' +
            '<div style="display:flex;gap:6px">' +
              '<button class="cbtn" onclick="(async function(b){try{await navigator.clipboard.writeText(' + JSON.stringify(draft.subject + '\n\n' + draft.body) + ');b.textContent=\'✓ Copied\';setTimeout(function(){b.textContent=\'📋 Copy\'},1500);}catch(e){alert(\'Copy failed\')}})(this)" style="font-size:11px;padding:5px 11px">📋 Copy</button>' +
              (sending && to && typeof window.sendMailgunEmail === 'function'
                ? '<button class="cbtn pri" onclick="(async function(b){b.disabled=true;b.textContent=\'Sending…\';var ok=await window.sendMailgunEmail(' + JSON.stringify(to) + ',' + JSON.stringify(draft.subject) + ',' + JSON.stringify(draft.body) + ',{cc:' + JSON.stringify(client.additionalEmails||[]) + '});b.disabled=false;b.textContent=ok?\'✓ Sent\':\'✗ Failed\';if(ok&&typeof window.glAudit===\'function\')window.glAudit(\'ar_email_sent\',' + JSON.stringify(invId) + ',{days_late:' + late + ',cc_count:' + ((client.additionalEmails||[]).length) + '});})(this)" style="font-size:11px;padding:5px 11px">📧 Send' + ((client.additionalEmails||[]).length ? ' +Cc ' + (client.additionalEmails||[]).length : '') + '</button>'
                : '<button class="cbtn" disabled style="font-size:11px;padding:5px 11px;opacity:.5">' + (to ? 'Mailgun not configured' : 'No email on file') + '</button>') +
            '</div>' +
          '</div>';
      });
    });
    host.appendChild(ov);
  };
  console.log('[GL] AR collection emails loaded');
}());

/* ============================================================
   WEIGHTED PIPELINE FORECAST (dashboard widget)
   ============================================================ */
(function(){
  function fmt$(n){ return '$' + Math.round(n||0).toLocaleString(); }
  function dollarsFromVal(v){
    if(typeof v === 'number') return v;
    if(!v) return 0;
    return parseFloat(String(v).replace(/[$,]/g,'')) || 0;
  }
  window.renderPipelineForecast = function(){
    var host = document.getElementById('cpg-dashboard');
    if(!host) return;
    // Always remove stale card first so we re-insert in the right place
    var existing = document.getElementById('gl-forecast-card');
    if(existing) existing.remove();

    var deals = window.deals || {};
    var byStageRaw = {};
    var byStageWtd = {};
    var rawTotal = 0;
    var wtdTotal = 0;
    Object.keys(deals).forEach(function(stage){
      if(stage === 'Closed Won' || stage === 'Closed Lost') return;
      var subRaw = 0, subWtd = 0;
      var stageArr = Array.isArray(deals[stage]) ? deals[stage] : [];
      stageArr.forEach(function(d){
        var v = dollarsFromVal(d.val);
        var p = (d.prob != null ? d.prob : 20) / 100;
        subRaw += v;
        subWtd += v * p;
      });
      if(subRaw > 0){
        byStageRaw[stage] = subRaw;
        byStageWtd[stage] = subWtd;
        rawTotal += subRaw;
        wtdTotal += subWtd;
      }
    });
    if(rawTotal === 0) return;

    var stageBars = Object.keys(byStageRaw).map(function(stage){
      var rawAmt = byStageRaw[stage];
      var pct = rawTotal ? Math.round(rawAmt / rawTotal * 100) : 0;
      return '<div style="margin-bottom:7px">' +
        '<div style="display:flex;justify-content:space-between;font-size:11px;color:var(--white);margin-bottom:3px">' +
          '<span>' + stage + '</span>' +
          '<span style="color:var(--teal);font-weight:600">' + fmt$(rawAmt) + '</span>' +
        '</div>' +
        '<div style="height:6px;background:rgba(255,255,255,.05);border-radius:3px;overflow:hidden">' +
          '<div style="width:' + pct + '%;height:100%;background:linear-gradient(90deg,var(--teal),#1a6fff)"></div>' +
        '</div>' +
      '</div>';
    }).join('');

    var card = document.createElement('div');
    card.id = 'gl-forecast-card';
    card.className = 'ccard';
    card.style.marginTop = '14px';
    card.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">' +
        '<div class="ccard-t" style="margin:0">Open pipeline</div>' +
        '<div style="text-align:right">' +
          '<div style="font-family:var(--ff-disp);font-size:22px;color:var(--teal)">' + fmt$(rawTotal) + '</div>' +
          '<div style="font-size:11px;color:var(--muted);margin-top:2px">Weighted: ' + fmt$(wtdTotal) + '</div>' +
        '</div>' +
      '</div>' +
      stageBars +
      '<div style="font-size:10px;color:var(--muted);margin-top:8px;letter-spacing:1px">Weighted = deal value × close probability across open stages.</div>';

    // Insert right before #dash-low-stock so position is always stable
    var anchor = host.querySelector('#dash-low-stock');
    if(anchor){ host.insertBefore(card, anchor); }
    else { host.appendChild(card); }
  };
  window.GL_HOOKS.registerDashPatch(function(){ try{ window.renderPipelineForecast(); }catch(e){ console.warn('[GL] forecast threw', e); } });
  console.log('[GL] weighted pipeline forecast loaded');
}());

/* ============================================================
   NPS SURVEY MODULE
   Public route #nps/<client-uuid>. Admin CRM modal for responses.
   ============================================================ */
(function(){
  var esc = window.glEsc;
  async function mountSurvey(cid){
    var host = document.getElementById('gl-portal') || (function(){
      var d = document.createElement('div'); d.id = 'gl-portal';
      d.setAttribute('style','position:fixed;inset:0;z-index:9000;background:#0a1628;overflow-y:auto;padding:40px 24px');
      document.body.appendChild(d); return d;
    })();
    host.style.display = 'block'; document.body.style.overflow = 'hidden';
    var client = null;
    if(window.supa){ try { var r = await window.supa.from('clients').select('*').eq('id', cid).maybeSingle(); if(r) client = r.data; } catch(e){} }
    if(!client){
      host.innerHTML = '<div style="max-width:520px;margin:80px auto;padding:32px;background:#142238;border:1px solid rgba(231,76,60,.3);border-radius:14px;text-align:center;color:#fff"><div style="font-family:var(--ff-disp);font-size:18px;color:#ff8579;margin-bottom:10px">SURVEY LINK NOT FOUND</div><div style="font-size:13px;color:#9aa7bd;line-height:1.6">Please contact Mike@GoodLiquid.com.</div></div>';
      return;
    }
    var scores = '';
    for(var i = 0; i <= 10; i++){
      var color = i <= 6 ? '#ff8579' : i <= 8 ? '#f5c842' : '#5fcf9e';
      scores += '<button class="gl-nps-score" data-score="' + i + '" style="width:46px;height:46px;border-radius:10px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.04);color:' + color + ';font-size:16px;font-weight:700;cursor:pointer;transition:all .15s">' + i + '</button>';
    }
    host.innerHTML =
      '<div style="max-width:640px;margin:80px auto;background:#142238;border:1px solid rgba(0,229,192,.2);border-radius:18px;padding:40px">' +
        '<div style="font-family:var(--ff-disp);font-size:11px;letter-spacing:3px;color:var(--teal);text-align:center">GOOD LIQUID BEV CO</div>' +
        '<h2 style="font-family:var(--ff-disp);font-size:24px;letter-spacing:1px;color:#fff;margin:14px 0 6px;text-align:center">Quick question, ' + esc((client.contact || client.name || 'friend').split(' ')[0]) + '?</h2>' +
        '<p style="font-size:14px;color:#9aa7bd;text-align:center;line-height:1.6;margin-bottom:30px">On a scale of 0-10, how likely are you to recommend Good Liquid Bev Co to another beverage brand?</p>' +
        '<div style="display:flex;justify-content:center;flex-wrap:wrap;gap:6px;margin-bottom:14px" id="gl-nps-scores">' + scores + '</div>' +
        '<div style="display:flex;justify-content:space-between;font-size:10px;letter-spacing:1px;color:rgba(255,255,255,.4);max-width:540px;margin:0 auto 30px"><span>NOT LIKELY</span><span>EXTREMELY LIKELY</span></div>' +
        '<div id="gl-nps-followup" style="display:none">' +
          '<div class="frow"><div class="flbl" style="text-align:center">What would have made it a 10?</div><textarea class="finp" id="gl-nps-comment" rows="4"></textarea></div>' +
          '<button id="gl-nps-submit" class="cbtn pri" style="width:100%;padding:14px;font-weight:800;font-size:14px">Submit feedback →</button>' +
        '</div>' +
        '<div id="gl-nps-thanks" style="display:none;text-align:center;padding:20px"><div style="font-size:48px;margin-bottom:14px">🙏</div><div style="font-family:var(--ff-disp);font-size:18px;color:var(--teal);margin-bottom:8px">THANK YOU.</div><div style="font-size:13px;color:#9aa7bd">Your feedback genuinely helps us improve. Mike or Sandra will follow up if it looks like we missed something.</div></div>' +
      '</div>';
    var pickedScore = null;
    host.querySelectorAll('.gl-nps-score').forEach(function(btn){
      btn.addEventListener('click', function(){
        pickedScore = parseInt(btn.getAttribute('data-score'), 10);
        host.querySelectorAll('.gl-nps-score').forEach(function(b){ b.style.outline = ''; b.style.transform = ''; });
        btn.style.outline = '2px solid var(--teal)';
        btn.style.transform = 'scale(1.1)';
        document.getElementById('gl-nps-followup').style.display = 'block';
        document.getElementById('gl-nps-followup').scrollIntoView({ behavior:'smooth', block:'nearest' });
      });
    });
    var submit = host.querySelector('#gl-nps-submit');
    if(submit) submit.addEventListener('click', async function(){
      if(pickedScore === null){ alert('Pick a score first.'); return; }
      submit.disabled = true; submit.textContent = 'Submitting…';
      var comment = document.getElementById('gl-nps-comment').value;
      if(window.supa){
        try { await window.supa.from('nps_responses').insert([{ client_id: cid, client_name: client.name, score: pickedScore, comment: comment, responded_at: new Date().toISOString() }]); } catch(e){}
      }
      document.getElementById('gl-nps-followup').style.display = 'none';
      document.getElementById('gl-nps-scores').style.display = 'none';
      document.querySelector('#gl-portal h2').style.display = 'none';
      document.querySelector('#gl-portal p').style.display = 'none';
      document.getElementById('gl-nps-thanks').style.display = 'block';
    });
  }
  function maybeMount(){
    var m = (window.location.hash || '').match(/^#nps\/([\w-]{20,})/);
    if(!m) return;
    mountSurvey(m[1]);
  }
  if(document.readyState !== 'loading') maybeMount();
  else document.addEventListener('DOMContentLoaded', maybeMount);
  window.addEventListener('hashchange', maybeMount);

  window.openNpsResults = async function(){
    var prior = document.getElementById('gl-nps-results-modal'); if(prior) prior.remove();
    var host = document.getElementById('crm-panel') || document.body;
    var rows = [];
    if(window.supa){ try { var r = await window.supa.from('nps_responses').select('*').order('responded_at',{ascending:false}).limit(100); if(r && r.data) rows = r.data; } catch(e){} }
    var promoters = rows.filter(function(r){ return r.score >= 9; }).length;
    var detractors = rows.filter(function(r){ return r.score <= 6; }).length;
    var nps = rows.length ? Math.round(((promoters - detractors) / rows.length) * 100) : 0;
    var npsColor = nps >= 30 ? '#5fcf9e' : nps >= 0 ? '#f5c842' : '#ff8579';
    var ov = document.createElement('div');
    ov.id = 'gl-nps-results-modal';
    ov.setAttribute('style','position:fixed;inset:0;z-index:1000;background:rgba(6,13,26,.88);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:20px');
    ov.innerHTML =
      '<div style="background:#142238;border:1px solid rgba(0,229,192,.2);border-radius:14px;padding:26px;width:100%;max-width:640px;max-height:88vh;overflow-y:auto">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">' +
          '<div style="font-family:var(--ff-disp);font-size:18px;letter-spacing:2px;color:var(--teal)">⭐ NPS RESPONSES</div>' +
          '<button id="gl-nps-close" style="background:none;border:none;color:#9aa7bd;font-size:20px;cursor:pointer">✕</button>' +
        '</div>' +
        (rows.length
          ? '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:11px;margin-bottom:18px">' +
              '<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:10px;padding:13px;text-align:center"><div style="font-size:10px;color:var(--muted);letter-spacing:1px">PROMOTERS (9-10)</div><div style="font-family:var(--ff-disp);font-size:22px;color:#5fcf9e;margin-top:3px">' + promoters + '</div></div>' +
              '<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:10px;padding:13px;text-align:center"><div style="font-size:10px;color:var(--muted);letter-spacing:1px">DETRACTORS (0-6)</div><div style="font-family:var(--ff-disp);font-size:22px;color:#ff8579;margin-top:3px">' + detractors + '</div></div>' +
              '<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:10px;padding:13px;text-align:center"><div style="font-size:10px;color:var(--muted);letter-spacing:1px">NPS</div><div style="font-family:var(--ff-disp);font-size:22px;color:' + npsColor + ';margin-top:3px">' + (nps > 0 ? '+' : '') + nps + '</div></div>' +
            '</div>' +
            rows.map(function(r){
              var col = r.score >= 9 ? '#5fcf9e' : r.score <= 6 ? '#ff8579' : '#f5c842';
              var when = r.responded_at ? new Date(r.responded_at).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '';
              return '<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:10px;padding:14px;margin-bottom:8px">' +
                '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
                  '<div><div style="font-size:13px;color:var(--white);font-weight:600">' + esc(r.client_name||'—') + '</div><div style="font-size:11px;color:var(--muted);margin-top:2px">' + when + '</div></div>' +
                  '<div style="font-family:var(--ff-disp);font-size:24px;color:' + col + '">' + r.score + '</div>' +
                '</div>' +
                (r.comment ? '<div style="font-size:12px;color:var(--white);line-height:1.5;background:rgba(255,255,255,.02);padding:9px;border-radius:6px;font-style:italic">"' + esc(r.comment) + '"</div>' : '') +
              '</div>';
            }).join('')
          : '<div style="padding:30px;text-align:center;color:var(--muted);font-size:13px">No responses yet. Use the CRM action "Copy NPS link" on a client to share a survey URL.</div>'
        ) +
      '</div>';
    ov.addEventListener('click', function(e){ if(e.target === ov) ov.remove(); });
    ov.querySelector('#gl-nps-close').addEventListener('click', function(){ ov.remove(); });
    host.appendChild(ov);
  };
  console.log('[GL] NPS survey loaded');
}());

/* ============================================================
   CLIENT ONBOARDING WIZARD (5-step modal)
   ============================================================ */
(function(){
  var esc = window.glEsc;

  window.openOnboardingWizard = function(){
    var prior = document.getElementById('gl-wiz-modal'); if(prior) prior.remove();
    var host = document.getElementById('crm-panel') || document.body;
    var step = 1;
    var data = { name:'', legal_name:'', ein:'', website:'', contact:'', email:'', phone:'', street:'', city:'', state:'', zip:'', service:'', product_types:[], paymentTerms:'Net 30', leadSource:'', notes:'' };
    var ov = document.createElement('div');
    ov.id = 'gl-wiz-modal';
    ov.setAttribute('style','position:fixed;inset:0;z-index:1000;background:rgba(6,13,26,.92);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:20px');
    host.appendChild(ov);
    function progress(){
      var pct = (step / 5) * 100;
      return '<div style="height:4px;background:rgba(255,255,255,.05);border-radius:2px;overflow:hidden;margin-bottom:20px"><div style="width:' + pct + '%;height:100%;background:linear-gradient(90deg,var(--teal),#1a6fff);transition:width .3s"></div></div>';
    }
    function render(){
      var content = '';
      if(step === 1){
        content =
          '<div style="font-family:var(--ff-disp);font-size:11px;letter-spacing:2px;color:var(--teal);margin-bottom:8px">STEP 1 of 5</div>' +
          '<div style="font-family:var(--ff-disp);font-size:22px;letter-spacing:1px;color:var(--white);margin-bottom:18px">Who are they?</div>' +
          '<div class="frow"><div class="flbl">Brand name *</div><input class="finp" id="w-name" value="' + esc(data.name) + '" placeholder="e.g. SunBurst Seltzers"></div>' +
          '<div class="frow"><div class="flbl">Legal business name <span style="opacity:.5">(if different)</span></div><input class="finp" id="w-legal" value="' + esc(data.legal_name) + '"></div>' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
            '<div class="frow"><div class="flbl">EIN / Tax ID</div><input class="finp" id="w-ein" value="' + esc(data.ein) + '"></div>' +
            '<div class="frow"><div class="flbl">Website</div><input class="finp" id="w-web" value="' + esc(data.website) + '" placeholder="https://"></div>' +
          '</div>';
      } else if(step === 2){
        content =
          '<div style="font-family:var(--ff-disp);font-size:11px;letter-spacing:2px;color:var(--teal);margin-bottom:8px">STEP 2 of 5</div>' +
          '<div style="font-family:var(--ff-disp);font-size:22px;letter-spacing:1px;color:var(--white);margin-bottom:18px">How do we reach them?</div>' +
          '<div class="frow"><div class="flbl">Main point of contact *</div><input class="finp" id="w-contact" value="' + esc(data.contact) + '" placeholder="Name"></div>' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
            '<div class="frow"><div class="flbl">Email *</div><input class="finp" id="w-email" type="email" value="' + esc(data.email) + '"></div>' +
            '<div class="frow"><div class="flbl">Phone</div><input class="finp" id="w-phone" value="' + esc(data.phone) + '"></div>' +
          '</div>';
      } else if(step === 3){
        content =
          '<div style="font-family:var(--ff-disp);font-size:11px;letter-spacing:2px;color:var(--teal);margin-bottom:8px">STEP 3 of 5</div>' +
          '<div style="font-family:var(--ff-disp);font-size:22px;letter-spacing:1px;color:var(--white);margin-bottom:18px">Where are they?</div>' +
          '<div class="frow"><div class="flbl">Street address</div><input class="finp" id="w-street" value="' + esc(data.street) + '"></div>' +
          '<div style="display:grid;grid-template-columns:2fr 1fr 1fr;gap:8px">' +
            '<div class="frow"><div class="flbl">City</div><input class="finp" id="w-city" value="' + esc(data.city) + '"></div>' +
            '<div class="frow"><div class="flbl">State</div><input class="finp" id="w-state" maxlength="2" value="' + esc(data.state) + '" style="text-transform:uppercase"></div>' +
            '<div class="frow"><div class="flbl">Zip</div><input class="finp" id="w-zip" value="' + esc(data.zip) + '"></div>' +
          '</div>';
      } else if(step === 4){
        var serviceOptions = ['','Canning','Bottling','R&D','R&D + Canning','Consulting'].map(function(s){
          var sel = (s === data.service) ? ' selected' : '';
          return '<option value="' + esc(s) + '"'+sel+'>' + esc(s || 'Pick service…') + '</option>';
        }).join('');
        var prods = [['seltzer','🥤 Seltzer'],['kombucha','🍵 Kombucha'],['coldbrew','☕ Cold brew'],['juice','🧃 Juice'],['rtd','🍸 RTD'],['energy','⚡ Energy'],['mocktail','🍹 Mocktail'],['sparkling','💧 Sparkling'],['sports','🏃 Sports'],['other','📦 Other']].map(function(p){
          var ch = data.product_types.indexOf(p[0]) >= 0 ? ' checked' : '';
          return '<label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;color:var(--white)"><input type="checkbox" data-pt="' + p[0] + '"'+ch+' style="accent-color:var(--teal);width:15px;height:15px">' + p[1] + '</label>';
        }).join('');
        content =
          '<div style="font-family:var(--ff-disp);font-size:11px;letter-spacing:2px;color:var(--teal);margin-bottom:8px">STEP 4 of 5</div>' +
          '<div style="font-family:var(--ff-disp);font-size:22px;letter-spacing:1px;color:var(--white);margin-bottom:18px">What do they make?</div>' +
          '<div class="frow"><div class="flbl">Primary service</div><select class="fsel" id="w-service">' + serviceOptions + '</select></div>' +
          '<div class="frow"><div class="flbl">Product types</div><div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 12px;padding:10px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:8px">' + prods + '</div></div>';
      } else if(step === 5){
        content =
          '<div style="font-family:var(--ff-disp);font-size:11px;letter-spacing:2px;color:var(--teal);margin-bottom:8px">STEP 5 of 5</div>' +
          '<div style="font-family:var(--ff-disp);font-size:22px;letter-spacing:1px;color:var(--white);margin-bottom:18px">Review &amp; save</div>' +
          '<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:10px;padding:16px;line-height:2;font-size:13px;color:var(--white)">' +
            '<div><span style="color:var(--muted)">Brand:</span> ' + esc(data.name || '—') + (data.legal_name && data.legal_name !== data.name ? ' <span style="color:var(--muted)">(dba ' + esc(data.legal_name) + ')</span>' : '') + '</div>' +
            '<div><span style="color:var(--muted)">Contact:</span> ' + esc(data.contact || '—') + ' · ' + esc(data.email || '—') + '</div>' +
            '<div><span style="color:var(--muted)">Address:</span> ' + esc([data.street, data.city, data.state, data.zip].filter(Boolean).join(', ') || '—') + '</div>' +
            '<div><span style="color:var(--muted)">Service:</span> ' + esc(data.service || '—') + '</div>' +
            '<div><span style="color:var(--muted)">Products:</span> ' + esc(data.product_types.join(', ') || '—') + '</div>' +
            '<div><span style="color:var(--muted)">Payment terms:</span> ' + esc(data.paymentTerms) + '</div>' +
          '</div>' +
          '<div class="frow" style="margin-top:14px"><div class="flbl">Onboarding notes</div><textarea class="finp" id="w-notes" rows="3">' + esc(data.notes) + '</textarea></div>';
      }
      ov.innerHTML =
        '<div style="background:#142238;border:1px solid rgba(0,229,192,.2);border-radius:14px;padding:30px;width:100%;max-width:560px;max-height:88vh;overflow-y:auto">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">' +
            '<div style="font-family:var(--ff-disp);font-size:13px;letter-spacing:2px;color:var(--teal)">🚀 ONBOARDING WIZARD</div>' +
            '<button id="w-close" style="background:none;border:none;color:#9aa7bd;font-size:20px;cursor:pointer">✕</button>' +
          '</div>' +
          progress() + content +
          '<div style="display:flex;gap:8px;margin-top:20px;justify-content:space-between">' +
            (step > 1 ? '<button id="w-back" class="cbtn">← Back</button>' : '<div></div>') +
            (step < 5 ? '<button id="w-next" class="cbtn pri">Next →</button>' : '<button id="w-save" class="cbtn pri">✓ Create client</button>') +
          '</div>' +
        '</div>';
      ov.querySelector('#w-close').addEventListener('click', function(){ ov.remove(); });
      var back = ov.querySelector('#w-back');
      if(back) back.addEventListener('click', function(){ stash(); step--; render(); });
      var next = ov.querySelector('#w-next');
      if(next) next.addEventListener('click', function(){
        stash();
        if(step === 1 && !data.name){ alert('Brand name is required.'); return; }
        if(step === 2 && (!data.contact || !data.email)){ alert('Contact name and email are required.'); return; }
        step++; render();
      });
      var save = ov.querySelector('#w-save');
      if(save) save.addEventListener('click', async function(){
        stash();
        save.disabled = true; save.textContent = 'Creating…';
        var localId = 'c_' + Date.now();
        var cid = localId;
        if(window.supa){
          try {
            var r = await window.supa.from('clients').insert([{
              name: data.name, legal_name: data.legal_name, ein: data.ein, website: data.website,
              contact_name: data.contact, email: data.email, phone: data.phone,
              street: data.street, city: data.city, state: data.state, zip: data.zip,
              service: data.service, product_types: data.product_types,
              payment_terms: data.paymentTerms, lead_source: data.leadSource,
              notes: data.notes, status: 'lead', total_billed: 0,
              initials: (data.name || 'X').split(' ').map(function(w){return w[0]||'';}).join('').toUpperCase().slice(0,2)
            }]).select().single();
            if(r && r.data){ cid = r.data.id; }
          } catch(e){ console.warn('[GL] wizard save failed', e); }
        }
        if(window.clients){
          window.clients.push({
            id: cid, name: data.name, legalName: data.legal_name, ein: data.ein, website: data.website,
            contact: data.contact, email: data.email, phone: data.phone,
            street: data.street, city: data.city, state: data.state, zip: data.zip,
            service: data.service, productTypes: data.product_types,
            paymentTerms: data.paymentTerms, leadSource: data.leadSource,
            notes: data.notes, status: 'lead', billed: 0,
            init: (data.name || 'X').split(' ').map(function(w){return w[0]||'';}).join('').toUpperCase().slice(0,2),
            color: '#1a3a6e', tc: '#9FE1CB'
          });
        }
        if(typeof renderClients === 'function') renderClients();
        if(typeof renderDash === 'function')    renderDash();
        ov.remove();
        if(typeof addNotification === 'function') addNotification('🚀 Client onboarded', data.name, 'success');
        if(typeof window.glAudit === 'function') window.glAudit('client_onboarded_via_wizard', cid, { name: data.name });
      });
    }
    function stash(){
      var v = function(id){ var el = document.getElementById(id); return el ? el.value.trim() : ''; };
      if(step === 1){ data.name = v('w-name'); data.legal_name = v('w-legal'); data.ein = v('w-ein'); data.website = v('w-web'); }
      if(step === 2){ data.contact = v('w-contact'); data.email = v('w-email'); data.phone = v('w-phone'); }
      if(step === 3){ data.street = v('w-street'); data.city = v('w-city'); data.state = v('w-state').toUpperCase(); data.zip = v('w-zip'); }
      if(step === 4){
        data.service = v('w-service');
        data.product_types = [];
        document.querySelectorAll('input[data-pt]').forEach(function(el){ if(el.checked) data.product_types.push(el.getAttribute('data-pt')); });
      }
      if(step === 5){ data.notes = v('w-notes'); }
    }
    render();
  };
  console.log('[GL] onboarding wizard loaded');
}());

/* ============================================================
   ANNIVERSARY / BIRTHDAY DASHBOARD TRACKER
   ============================================================ */
(function(){
  var esc = window.glEsc;
  function daysUntil(month, day){
    var today = new Date(); today.setHours(0,0,0,0);
    var y = today.getFullYear();
    var target = new Date(y, month, day);
    target.setHours(0,0,0,0);
    if(target < today) target = new Date(y + 1, month, day);
    return Math.round((target - today) / 86400000);
  }
  function gather(){
    var rows = [];
    (window.clients||[]).forEach(function(c){
      var anni = c.acquired_at || c.created_at;
      if(anni){
        var d = new Date(anni);
        if(!isNaN(d)){
          var until = daysUntil(d.getMonth(), d.getDate());
          if(until <= 14){
            var yrs = new Date().getFullYear() - d.getFullYear();
            rows.push({ client:c, kind:'anniversary', until:until, label: yrs + (yrs === 1 ? ' year' : ' years') + ' with us' });
          }
        }
      }
      if(c.contact_birthday){
        var b = new Date(c.contact_birthday);
        if(!isNaN(b)){
          var bUntil = daysUntil(b.getMonth(), b.getDate());
          if(bUntil <= 14){
            rows.push({ client:c, kind:'birthday', until:bUntil, label: (c.contact || 'Contact') + '\'s birthday' });
          }
        }
      }
    });
    rows.sort(function(a,b){ return a.until - b.until; });
    return rows;
  }
  window.renderAnniversaries = function(){
    var slot = document.getElementById('dash-anniversaries');
    if(!slot){
      var dash = document.getElementById('cpg-dashboard');
      if(!dash) return;
      slot = document.createElement('div');
      slot.id = 'dash-anniversaries';
      dash.appendChild(slot);
    }
    var rows = gather();
    if(!rows.length){ slot.innerHTML = ''; return; }
    slot.innerHTML =
      '<div style="background:rgba(168,85,247,.06);border:1px solid rgba(168,85,247,.25);border-radius:12px;padding:14px 16px;margin-top:14px">' +
        '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">' +
          '<span style="font-size:18px">🎉</span>' +
          '<div>' +
            '<div style="font-family:var(--ff-disp);font-size:13px;letter-spacing:2px;color:#c4a4f8">UPCOMING CELEBRATIONS</div>' +
            '<div style="font-size:11px;color:var(--muted);margin-top:2px">' + rows.length + ' client touchpoint' + (rows.length === 1 ? '' : 's') + ' in the next 14 days</div>' +
          '</div>' +
        '</div>' +
        rows.map(function(r){
          var icon = r.kind === 'birthday' ? '🎂' : '🥂';
          return '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-top:1px solid rgba(255,255,255,.04)">' +
            '<div><span style="font-size:14px;margin-right:8px">' + icon + '</span><span style="color:var(--white);font-weight:600;font-size:13px">' + esc(r.client.name) + '</span> <span style="color:var(--muted);font-size:11px;margin-left:6px">' + esc(r.label) + '</span></div>' +
            '<div style="color:#c4a4f8;font-weight:600;font-size:12px">' + (r.until === 0 ? 'TODAY' : 'in ' + r.until + 'd') + '</div>' +
          '</div>';
        }).join('') +
      '</div>';
  };
  window.GL_HOOKS.registerDashPatch(function(){ try{ window.renderAnniversaries(); }catch(e){ console.warn('[GL] anniversaries threw', e); } });
  console.log('[GL] anniversary tracker loaded');
}());

/* ============================================================
   REVENUE FORECAST DASHBOARD (12-month stacked bar)
   ============================================================ */
(function(){
  function fmt$(n){ return '$' + Math.round(n||0).toLocaleString(); }
  function monthKey(d){ return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0'); }
  function dollarsFromVal(v){
    if(typeof v === 'number') return v;
    if(!v) return 0;
    return parseFloat(String(v).replace(/[$,]/g,'')) || 0;
  }

  function gather(){
    var months = [];
    var anchor = new Date(); anchor.setDate(1);
    for(var i = -6; i <= 5; i++){
      var d = new Date(anchor.getFullYear(), anchor.getMonth() + i, 1);
      months.push({ key: monthKey(d), label: d.toLocaleString('en-US',{month:'short'}) + (i === 0 ? ' (now)' : ''), paid:0, open:0, pipeline:0, isNow: i === 0 });
    }
    var byKey = {}; months.forEach(function(m){ byKey[m.key] = m; });
    (window.invoices||[]).forEach(function(i){
      if(!i || !i.date) return;
      var k = monthKey(new Date(i.date));
      if(!byKey[k]) return;
      if((i.status||'').toLowerCase() === 'paid') byKey[k].paid += (i.amount||0);
      else byKey[k].open += (i.amount||0);
    });
    var weightedTotal = 0;
    var deals = window.deals || {};
    Object.keys(deals).forEach(function(stage){
      if(stage === 'Closed Won' || stage === 'Closed Lost') return;
      (deals[stage]||[]).forEach(function(d){
        weightedTotal += dollarsFromVal(d.val) * ((d.prob != null ? d.prob : 20) / 100);
      });
    });
    var perMonth = weightedTotal / 3;
    for(var k = 1; k <= 3; k++){
      var futKey = monthKey(new Date(anchor.getFullYear(), anchor.getMonth() + k, 1));
      if(byKey[futKey]) byKey[futKey].pipeline = perMonth;
    }
    return months;
  }

  window.renderRevenueForecast = function(){
    var host = document.getElementById('cpg-dashboard');
    if(!host) return;
    var existing = document.getElementById('gl-rev-forecast');
    var months = gather();
    var max = months.reduce(function(m,r){ return Math.max(m, r.paid + r.open + r.pipeline); }, 0);
    if(max === 0){ if(existing) existing.remove(); return; }
    var trailing = months.slice(0,6).reduce(function(s,m){ return s + m.paid + m.open; }, 0);
    var forecast6 = months.slice(6).reduce(function(s,m){ return s + m.paid + m.open + m.pipeline; }, 0);
    var bars = months.map(function(m){
      var total = m.paid + m.open + m.pipeline;
      var pH = max ? Math.round(m.paid / max * 160) : 0;
      var oH = max ? Math.round(m.open / max * 160) : 0;
      var fH = max ? Math.round(m.pipeline / max * 160) : 0;
      return '<div style="flex:1;display:flex;flex-direction:column;align-items:center;min-width:0">' +
        '<div style="font-size:10px;color:var(--muted);margin-bottom:6px;height:14px;text-align:center">' + (total > 0 ? '$' + (Math.round(total/100)/10) + 'k' : '') + '</div>' +
        '<div style="display:flex;flex-direction:column-reverse;height:160px;width:80%;max-width:42px;background:rgba(255,255,255,.02);border-radius:6px 6px 0 0;overflow:hidden">' +
          (pH > 0 ? '<div style="height:' + pH + 'px;background:#5fcf9e"></div>' : '') +
          (oH > 0 ? '<div style="height:' + oH + 'px;background:#f5c842"></div>' : '') +
          (fH > 0 ? '<div style="height:' + fH + 'px;background:rgba(0,229,192,.4);border-top:1px dashed var(--teal)"></div>' : '') +
        '</div>' +
        '<div style="font-size:10px;color:' + (m.isNow ? 'var(--teal)' : 'var(--muted)') + ';margin-top:6px;font-weight:' + (m.isNow ? '700' : '400') + '">' + m.label + '</div>' +
      '</div>';
    }).join('');
    var html =
      '<div id="gl-rev-forecast" class="ccard" style="grid-column:1/-1;margin-top:14px">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">' +
          '<div class="ccard-t" style="margin:0">12-month revenue forecast</div>' +
          '<div style="display:flex;gap:14px;font-size:11px">' +
            '<span style="color:#9aa7bd">Trailing 6mo · <b style="color:#fff">' + fmt$(trailing) + '</b></span>' +
            '<span style="color:#9aa7bd">Next 6mo · <b style="color:var(--teal)">' + fmt$(forecast6) + '</b></span>' +
          '</div>' +
        '</div>' +
        '<div style="display:flex;align-items:flex-end;gap:8px;padding:8px 0">' + bars + '</div>' +
        '<div style="display:flex;justify-content:center;gap:14px;font-size:10px;color:var(--muted);margin-top:10px;letter-spacing:1px">' +
          '<span><span style="display:inline-block;width:10px;height:10px;background:#5fcf9e;border-radius:2px;vertical-align:middle"></span> PAID</span>' +
          '<span><span style="display:inline-block;width:10px;height:10px;background:#f5c842;border-radius:2px;vertical-align:middle"></span> INVOICED · OPEN</span>' +
          '<span><span style="display:inline-block;width:10px;height:10px;background:rgba(0,229,192,.5);border-radius:2px;vertical-align:middle"></span> WEIGHTED PIPELINE</span>' +
        '</div>' +
      '</div>';
    if(existing) existing.outerHTML = html;
    else host.insertAdjacentHTML('beforeend', html);
  };
  window.GL_HOOKS.registerDashPatch(function(){ try{ window.renderRevenueForecast(); }catch(e){ console.warn('[GL] forecast threw', e); } });
  console.log('[GL] revenue forecast loaded');
}());

/* ============================================================
   PRODUCTION CAPACITY HEATMAP
   ============================================================ */
(function(){
  var esc = window.glEsc;
  var WEEKLY_CAPACITY_CASES = 8000;
  function weekKey(d){
    var dt = new Date(d);
    dt.setHours(0,0,0,0);
    dt.setDate(dt.getDate() - dt.getDay());
    return dt.toISOString().slice(0,10);
  }
  function gather(){
    var weeks = [];
    var anchor = new Date(); anchor.setHours(0,0,0,0);
    anchor.setDate(anchor.getDate() - anchor.getDay());
    for(var i = 0; i < 12; i++){
      var d = new Date(anchor); d.setDate(d.getDate() + i*7);
      weeks.push({ key: weekKey(d), label: d.toLocaleDateString('en-US',{month:'short',day:'numeric'}), cases:0, runs:[] });
    }
    var byKey = {}; weeks.forEach(function(w){ byKey[w.key] = w; });
    (window.glProductionRuns||[]).forEach(function(r){
      if(!r.scheduled_date) return;
      var k = weekKey(r.scheduled_date);
      if(!byKey[k]) return;
      byKey[k].cases += (r.cases || 0);
      byKey[k].runs.push(r);
    });
    return weeks;
  }
  window.openCapacityHeatmap = function(){
    var prior = document.getElementById('gl-cap-heat-modal'); if(prior) prior.remove();
    var host = document.getElementById('crm-panel') || document.body;
    var weeks = gather();
    var rowsHtml = weeks.map(function(w){
      var pct = Math.min(100, Math.round(w.cases / WEEKLY_CAPACITY_CASES * 100));
      var over = w.cases > WEEKLY_CAPACITY_CASES;
      var color = over ? '#ff8579' : pct >= 80 ? '#f5c842' : '#5fcf9e';
      return '<div style="display:grid;grid-template-columns:100px 1fr 110px;gap:14px;align-items:center;padding:9px 0;border-bottom:1px solid rgba(255,255,255,.04)">' +
        '<div style="font-size:12px;color:var(--white);font-weight:600">' + w.label + '</div>' +
        '<div><div style="height:16px;background:rgba(255,255,255,.05);border-radius:4px;overflow:hidden;position:relative">' +
          '<div style="position:absolute;left:0;top:0;height:100%;width:' + Math.min(100, pct) + '%;background:' + color + '"></div>' +
          (over ? '<div style="position:absolute;right:6px;top:0;line-height:16px;color:#fff;font-size:10px;font-weight:700;letter-spacing:1px">OVER</div>' : '') +
        '</div></div>' +
        '<div style="text-align:right;color:' + color + ';font-weight:700;font-size:13px">' + w.cases.toLocaleString() + ' / ' + WEEKLY_CAPACITY_CASES.toLocaleString() + '</div>' +
      '</div>';
    }).join('');
    var totalPlanned = weeks.reduce(function(s,w){ return s + w.cases; }, 0);
    var overCount = weeks.filter(function(w){ return w.cases > WEEKLY_CAPACITY_CASES; }).length;
    var ov = document.createElement('div');
    ov.id = 'gl-cap-heat-modal';
    ov.setAttribute('style','position:fixed;inset:0;z-index:1000;background:rgba(6,13,26,.88);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:20px');
    ov.innerHTML =
      '<div style="background:#142238;border:1px solid rgba(0,229,192,.2);border-radius:14px;padding:26px;width:100%;max-width:740px;max-height:88vh;overflow-y:auto">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">' +
          '<div style="font-family:var(--ff-disp);font-size:18px;letter-spacing:2px;color:var(--teal)">📊 CAPACITY HEATMAP</div>' +
          '<button id="gl-ch-close" style="background:none;border:none;color:#9aa7bd;font-size:20px;cursor:pointer">✕</button>' +
        '</div>' +
        '<div style="font-size:12px;color:#9aa7bd;margin-bottom:14px;line-height:1.6">Next 12 weeks of planned production vs. ~8,000 cases/week theoretical capacity. Red bars need a reshuffle or extra capacity.</div>' +
        '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:11px;margin-bottom:18px">' +
          '<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:10px;padding:13px;text-align:center"><div style="font-size:10px;color:var(--muted);letter-spacing:1px">12-WEEK PLANNED</div><div style="font-family:var(--ff-disp);font-size:22px;color:var(--white);margin-top:3px">' + totalPlanned.toLocaleString() + '</div></div>' +
          '<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:10px;padding:13px;text-align:center"><div style="font-size:10px;color:var(--muted);letter-spacing:1px">WEEKLY CAPACITY</div><div style="font-family:var(--ff-disp);font-size:22px;color:var(--teal);margin-top:3px">' + WEEKLY_CAPACITY_CASES.toLocaleString() + '</div></div>' +
          '<div style="background:rgba(255,255,255,.03);border:1px solid rgba(' + (overCount ? '231,76,60' : '29,158,117') + ',.25);border-radius:10px;padding:13px;text-align:center"><div style="font-size:10px;color:var(--muted);letter-spacing:1px">OVER CAPACITY</div><div style="font-family:var(--ff-disp);font-size:22px;color:' + (overCount ? '#ff8579' : '#5fcf9e') + ';margin-top:3px">' + overCount + ' week' + (overCount === 1 ? '' : 's') + '</div></div>' +
        '</div>' +
        rowsHtml +
      '</div>';
    ov.addEventListener('click', function(e){ if(e.target === ov) ov.remove(); });
    ov.querySelector('#gl-ch-close').addEventListener('click', function(){ ov.remove(); });
    host.appendChild(ov);
  };
  console.log('[GL] capacity heatmap loaded');
}());
