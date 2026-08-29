/* ============================================================
   trace.js — Lot traceability + mock recall
   ============================================================
   A self-contained module (no logic in index.html, nothing in
   localStorage — every row lives in Postgres). Given a production run
   you can trace BACKWARD (what materials/lots went into it) and
   FORWARD (which customers it shipped to), see the GMP trail of
   compliance checks tied to the run, and fire a one-button MOCK
   RECALL that reconciles units produced vs. units accounted for.

   THE TRACE: type a run name → look up the production_run → fan out
   to lot_inputs (backward), lot_shipments (forward), and
   compliance_records (the GMP trail). One-click recall drills the
   whole chain and records a mock_recalls row with a reconciliation %.

   Exposes:
     window.glRenderTrace()                 — fills the #cpg-trace page
     window.glTraceLot(query)               — trace a run by name
     window.glAddLotInput(runId)            — add a lot_inputs row
     window.glAddLotShipment(runId)         — add a lot_shipments row
     window.glRunMockRecall(runId, lotCode) — run + record a mock recall
   ============================================================ */
(function(){
  'use strict';

  function sb(){ return window.supa || null; }
  function esc(s){
    return String(s == null ? '' : s).replace(/[<>&"]/g, function(c){
      return { '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;' }[c];
    });
  }
  function todayISO(){ try { return new Date().toISOString().slice(0,10); } catch(e){ return ''; } }
  function overlay(id){
    var prior = document.getElementById(id); if(prior) prior.remove();
    var ov = document.createElement('div');
    ov.id = id;
    ov.setAttribute('style','position:fixed;inset:0;z-index:900;background:rgba(6,13,26,.95);backdrop-filter:blur(14px);display:flex;align-items:flex-start;justify-content:center;padding:20px;overflow-y:auto');
    ov.addEventListener('click', function(e){ if(e.target === ov) ov.remove(); });
    document.body.appendChild(ov);
    return ov;
  }
  var INP = 'width:100%;padding:9px 10px;background:#0a1628;border:1px solid rgba(255,255,255,.12);border-radius:7px;color:#fff;font-size:13px';

  // ── Page shell: the search box + recent recalls list ──
  window.glRenderTrace = function glRenderTrace(){
    var host = document.getElementById('cpg-trace');
    if(!host) return;
    host.innerHTML =
      '<div style="max-width:1000px;margin:0 auto">' +
        '<div style="font-family:var(--ff-disp);font-size:24px;letter-spacing:2px;color:var(--teal);margin-bottom:6px">🔗 LOT TRACEABILITY</div>' +
        '<div style="font-size:12.5px;color:var(--muted);margin-bottom:18px;line-height:1.6">Trace any production run backward to the materials and supplier lots that went into it, forward to the customers it shipped to, and across to its GMP trail. One click runs a mock recall and records the reconciliation.</div>' +
        '<div style="background:#142238;border:1px solid rgba(0,229,192,.18);border-radius:12px;padding:16px 18px;margin-bottom:16px">' +
          '<div style="font-size:10.5px;letter-spacing:1.5px;color:var(--teal);margin-bottom:8px">TRACE A LOT / RUN</div>' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
            '<input id="gl-trace-q" placeholder="Run name, e.g. Cold Brew R-2041" style="flex:1;min-width:200px;'+INP+'" onkeydown="if(event.key===\'Enter\')window.glTraceLot(document.getElementById(\'gl-trace-q\').value)">' +
            '<button onclick="window.glTraceLot(document.getElementById(\'gl-trace-q\').value)" style="padding:10px 18px;background:linear-gradient(135deg,#00e5c0,#00c4a7);color:#04231d;border:none;border-radius:9px;font-weight:800;font-size:13px;cursor:pointer;white-space:nowrap">🔎 Trace</button>' +
          '</div>' +
        '</div>' +
        '<div id="gl-trace-panel"></div>' +
        '<div id="gl-trace-recent" style="margin-top:18px"></div>' +
      '</div>';
    renderRecentRecalls();
  };

  function panelError(msg){
    var p = document.getElementById('gl-trace-panel');
    if(p) p.innerHTML = '<div style="color:#ff8579;font-size:13px;padding:14px 16px;background:rgba(255,133,121,.08);border:1px solid rgba(255,133,121,.3);border-radius:10px">'+esc(msg)+'</div>';
  }

  // ── Trace a run by name → backward, forward, GMP trail ──
  window.glTraceLot = async function glTraceLot(query){
    var q = (query || '').trim();
    var panel = document.getElementById('gl-trace-panel');
    if(!panel) return;
    if(!q){ panel.innerHTML = '<div style="color:#f5c842;font-size:13px;padding:12px 0">Type a run name to trace.</div>'; return; }
    if(!sb()){ panelError('Supabase not ready.'); return; }
    panel.innerHTML = '<div style="color:#9aa7bd;font-size:13px;padding:14px 0">Tracing…</div>';
    try {
      var runRes = await sb().from('production_runs').select('*').ilike('run_name', '%'+q+'%').limit(1);
      if(runRes.error) throw runRes.error;
      var run = (runRes.data && runRes.data[0]) || null;
      if(!run){ panel.innerHTML = '<div style="color:#f5c842;font-size:13px;padding:14px 16px;background:rgba(245,200,66,.08);border:1px solid rgba(245,200,66,.3);border-radius:10px">No run found — check the name.</div>'; return; }

      var inRes  = await sb().from('lot_inputs').select('*').eq('run_id', run.id).order('created_at', { ascending: true });
      if(inRes.error) throw inRes.error;
      var shRes  = await sb().from('lot_shipments').select('*').eq('run_id', run.id).order('ship_date', { ascending: true });
      if(shRes.error) throw shRes.error;
      var cpRes  = await sb().from('compliance_records').select('form_code, record_date, has_deviation').eq('run_id', run.id).order('record_date', { ascending: false });
      if(cpRes.error) throw cpRes.error;

      var inputs = inRes.data || [], shipments = shRes.data || [], checks = cpRes.data || [];
      // Best-effort lot code for the run: first input/shipment lot, else run name.
      var lotCode = (inputs[0] && inputs[0].lot_code) || (shipments[0] && shipments[0].lot_code) || run.run_name || '';

      var totalShipped = shipments.reduce(function(s, r){ var n = Number(r.quantity); return s + (isFinite(n) ? n : 0); }, 0);

      // Backward — inputs table
      var inHead = '<tr style="text-align:left;color:#9aa7bd;font-size:11px"><th style="padding:6px 8px">Material</th><th style="padding:6px 8px">Supplier</th><th style="padding:6px 8px">Supplier lot</th><th style="padding:6px 8px">Lot code</th><th style="padding:6px 8px">Qty</th></tr>';
      var inBody = inputs.map(function(r){
        return '<tr style="border-top:1px solid rgba(255,255,255,.06);font-size:12px">' +
          '<td style="padding:6px 8px;color:#dfe7f1">'+esc(r.material||'')+'</td>' +
          '<td style="padding:6px 8px;color:#9aa7bd">'+esc(r.supplier||'')+'</td>' +
          '<td style="padding:6px 8px;color:#9aa7bd">'+esc(r.supplier_lot||'')+'</td>' +
          '<td style="padding:6px 8px;color:#9aa7bd">'+esc(r.lot_code||'')+'</td>' +
          '<td style="padding:6px 8px;color:#dfe7f1">'+esc((r.quantity==null?'':r.quantity)+(r.uom?(' '+r.uom):''))+'</td></tr>';
      }).join('');

      // Forward — shipments table
      var shHead = '<tr style="text-align:left;color:#9aa7bd;font-size:11px"><th style="padding:6px 8px">Customer</th><th style="padding:6px 8px">Qty</th><th style="padding:6px 8px">Ship date</th><th style="padding:6px 8px">PO</th></tr>';
      var shBody = shipments.map(function(r){
        return '<tr style="border-top:1px solid rgba(255,255,255,.06);font-size:12px">' +
          '<td style="padding:6px 8px;color:#dfe7f1">'+esc(r.customer||'')+'</td>' +
          '<td style="padding:6px 8px;color:#dfe7f1">'+esc((r.quantity==null?'':r.quantity)+(r.uom?(' '+r.uom):''))+'</td>' +
          '<td style="padding:6px 8px;color:#9aa7bd">'+esc(r.ship_date||'')+'</td>' +
          '<td style="padding:6px 8px;color:#9aa7bd">'+esc(r.po||'')+'</td></tr>';
      }).join('');

      // GMP trail
      var trail = checks.length ? checks.map(function(c){
        return '<span style="display:inline-flex;align-items:center;gap:5px;font-size:11.5px;color:#dfe7f1;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:20px;padding:4px 11px;margin:0 6px 6px 0">' +
          (c.has_deviation ? '<span style="color:#ff8579">⚠</span>' : '<span style="color:#5fcf9e">✓</span>') +
          esc(c.form_code||'') + (c.record_date?' · <span style="color:#9aa7bd">'+esc(c.record_date)+'</span>':'') + '</span>';
      }).join('') : '<span style="font-size:12px;color:#9aa7bd">No GMP checks linked to this run.</span>';

      var section = function(accent, title, inner){
        return '<div style="background:#142238;border:1px solid '+accent+';border-radius:12px;padding:16px 18px;margin-bottom:12px">' +
          '<div style="font-size:10.5px;letter-spacing:1.5px;color:'+(accent==='rgba(245,200,66,.25)'?'#f5c842':'var(--teal)')+';margin-bottom:10px">'+title+'</div>'+inner+'</div>';
      };
      var lotEsc = String(lotCode).replace(/'/g, "\\'").replace(/"/g,'&quot;');
      var rid = run.id;

      panel.innerHTML =
        // Run header
        '<div style="background:#142238;border:1px solid rgba(0,229,192,.25);border-radius:12px;padding:16px 18px;margin-bottom:12px">' +
          '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">' +
            '<div><div style="font-family:var(--ff-disp);font-size:19px;letter-spacing:1px;color:var(--teal)">'+esc(run.run_name||'(unnamed run)')+'</div>' +
              '<div style="font-size:12px;color:#9aa7bd;margin-top:4px">'+esc(run.client_name||'')+(run.format?(' · '+esc(run.format)):'')+(run.cases!=null?(' · '+esc(run.cases)+' cases'):'')+'</div></div>' +
            '<span style="font-size:11px;color:#eef4ff;background:rgba(0,229,192,.12);border:1px solid rgba(0,229,192,.3);border-radius:20px;padding:4px 12px;white-space:nowrap">'+esc(run.stage||'—')+'</span>' +
          '</div>' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px">' +
            '<button data-gl-action="glAddLotInput" data-gl-arg1="+rid+" style="padding:9px 14px;background:rgba(0,229,192,.12);color:var(--teal);border:1px solid rgba(0,229,192,.3);border-radius:7px;cursor:pointer;font-size:12px;font-weight:700">＋ Add input</button>' +
            '<button data-gl-action="glAddLotShipment" data-gl-arg1="+rid+" style="padding:9px 14px;background:rgba(0,229,192,.12);color:var(--teal);border:1px solid rgba(0,229,192,.3);border-radius:7px;cursor:pointer;font-size:12px;font-weight:700">＋ Add shipment</button>' +
            '<button data-gl-action="glRunMockRecall" data-gl-arg1="+rid+" data-gl-arg2="' + esc(lotEsc) + '" style="padding:9px 14px;background:rgba(245,200,66,.16);color:#f5c842;border:1px solid rgba(245,200,66,.4);border-radius:7px;cursor:pointer;font-size:12px;font-weight:700">🚨 Run mock recall</button>' +
          '</div>' +
        '</div>' +
        // Backward
        section('rgba(0,229,192,.18)', '⬅ BACKWARD — INPUTS (' + inputs.length + ')',
          (inputs.length ? '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">'+inHead+inBody+'</table></div>'
                         : '<div style="color:#9aa7bd;font-size:12px">No inputs recorded. Click ＋ Add input.</div>')) +
        // Forward
        section('rgba(0,229,192,.18)', '➡ FORWARD — SHIPMENTS (' + shipments.length + ')',
          (shipments.length ? '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">'+shHead+shBody+'</table></div>' +
              '<div style="font-size:12px;color:var(--teal);margin-top:10px;font-weight:700">Total shipped: '+esc(totalShipped)+' units</div>'
                            : '<div style="color:#9aa7bd;font-size:12px">No shipments recorded. Click ＋ Add shipment.</div>')) +
        // GMP trail
        section('rgba(245,200,66,.25)', '🧾 GMP TRAIL (' + checks.length + ')', '<div>'+trail+'</div>');
    } catch(e){
      panelError('Trace failed: ' + (e.message || e));
    }
  };

  // ── Add one lot_inputs row ──
  window.glAddLotInput = function glAddLotInput(runId){
    if(!sb()){ alert('Supabase not ready.'); return; }
    var ov = overlay('gl-trace-input');
    ov.innerHTML =
      '<div style="background:#142238;border:1px solid rgba(0,229,192,.2);border-radius:16px;padding:22px;width:100%;max-width:520px;color:#fff">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">' +
          '<div style="font-family:var(--ff-disp);font-size:17px;letter-spacing:1.5px;color:var(--teal)">＋ ADD LOT INPUT</div>' +
          '<button data-gl-close="#gl-trace-input" style="background:none;border:none;color:#9aa7bd;font-size:20px;cursor:pointer">✕</button></div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
          '<div style="grid-column:1/3"><label style="display:block;font-size:11px;color:#9aa7bd;margin:0 0 4px">Material *</label><input id="ti-material" style="'+INP+'"></div>' +
          '<div><label style="display:block;font-size:11px;color:#9aa7bd;margin:0 0 4px">Lot code</label><input id="ti-lot" style="'+INP+'"></div>' +
          '<div><label style="display:block;font-size:11px;color:#9aa7bd;margin:0 0 4px">Supplier</label><input id="ti-supplier" style="'+INP+'"></div>' +
          '<div><label style="display:block;font-size:11px;color:#9aa7bd;margin:0 0 4px">Supplier lot</label><input id="ti-suplot" style="'+INP+'"></div>' +
          '<div><label style="display:block;font-size:11px;color:#9aa7bd;margin:0 0 4px">Received record id</label><input id="ti-recv" style="'+INP+'"></div>' +
          '<div><label style="display:block;font-size:11px;color:#9aa7bd;margin:0 0 4px">Quantity</label><input id="ti-qty" type="number" step="any" style="'+INP+'"></div>' +
          '<div><label style="display:block;font-size:11px;color:#9aa7bd;margin:0 0 4px">UoM</label><input id="ti-uom" placeholder="kg / L / cases" style="'+INP+'"></div>' +
        '</div>' +
        '<div id="ti-msg" style="display:none;font-size:12.5px;margin:10px 0 0;padding:9px 12px;border-radius:8px"></div>' +
        '<div style="display:flex;gap:10px;margin-top:14px">' +
          '<button data-gl-close="#gl-trace-input" style="flex:1;padding:11px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);border-radius:8px;color:#dfe7f1;font-size:13px;cursor:pointer">Cancel</button>' +
          '<button id="ti-save" style="flex:1;padding:11px;background:rgba(0,229,192,.14);border:1px solid rgba(0,229,192,.35);border-radius:8px;color:var(--teal);font-weight:700;font-size:13px;cursor:pointer">Save input</button>' +
        '</div>' +
      '</div>';
    ov.querySelector('#ti-save').addEventListener('click', async function(){
      var btn = this, msg = ov.querySelector('#ti-msg');
      var show = function(color, text){ msg.style.display='block'; msg.style.color=color; msg.style.background='rgba(255,255,255,.04)'; msg.textContent=text; };
      var material = (ov.querySelector('#ti-material').value||'').trim();
      if(!material){ show('#ff8579','Material is required.'); return; }
      var qtyRaw = (ov.querySelector('#ti-qty').value||'').trim();
      var recvRaw = (ov.querySelector('#ti-recv').value||'').trim();
      var row = {
        run_id: runId,
        lot_code: (ov.querySelector('#ti-lot').value||'').trim() || null,
        material: material,
        supplier: (ov.querySelector('#ti-supplier').value||'').trim() || null,
        supplier_lot: (ov.querySelector('#ti-suplot').value||'').trim() || null,
        quantity: qtyRaw === '' ? null : Number(qtyRaw),
        uom: (ov.querySelector('#ti-uom').value||'').trim() || null,
        received_record_id: recvRaw === '' ? null : recvRaw,
        created_at: new Date().toISOString()
      };
      btn.disabled = true; show('#9aa7bd','Saving…');
      try {
        var r = await sb().from('lot_inputs').insert(row).select('id');
        if(r.error) throw r.error;
        show('#5fcf9e','✓ Input added.');
        if(typeof window.glAudit === 'function') window.glAudit('lot_input_added', String(runId), { material: material });
        setTimeout(function(){ ov.remove(); reTrace(); }, 700);
      } catch(e){
        btn.disabled = false;
        show('#ff8579','Save failed: ' + (e.message || e));
      }
    });
  };

  // ── Add one lot_shipments row ──
  window.glAddLotShipment = function glAddLotShipment(runId){
    if(!sb()){ alert('Supabase not ready.'); return; }
    var ov = overlay('gl-trace-ship');
    ov.innerHTML =
      '<div style="background:#142238;border:1px solid rgba(0,229,192,.2);border-radius:16px;padding:22px;width:100%;max-width:520px;color:#fff">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">' +
          '<div style="font-family:var(--ff-disp);font-size:17px;letter-spacing:1.5px;color:var(--teal)">＋ ADD SHIPMENT</div>' +
          '<button data-gl-close="#gl-trace-ship" style="background:none;border:none;color:#9aa7bd;font-size:20px;cursor:pointer">✕</button></div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
          '<div style="grid-column:1/3"><label style="display:block;font-size:11px;color:#9aa7bd;margin:0 0 4px">Customer *</label><input id="ts-customer" style="'+INP+'"></div>' +
          '<div><label style="display:block;font-size:11px;color:#9aa7bd;margin:0 0 4px">Lot code</label><input id="ts-lot" style="'+INP+'"></div>' +
          '<div><label style="display:block;font-size:11px;color:#9aa7bd;margin:0 0 4px">PO</label><input id="ts-po" style="'+INP+'"></div>' +
          '<div><label style="display:block;font-size:11px;color:#9aa7bd;margin:0 0 4px">Quantity</label><input id="ts-qty" type="number" step="any" style="'+INP+'"></div>' +
          '<div><label style="display:block;font-size:11px;color:#9aa7bd;margin:0 0 4px">UoM</label><input id="ts-uom" placeholder="cases / units" style="'+INP+'"></div>' +
          '<div style="grid-column:1/3"><label style="display:block;font-size:11px;color:#9aa7bd;margin:0 0 4px">Ship date</label><input id="ts-date" type="date" value="'+todayISO()+'" style="'+INP+'"></div>' +
        '</div>' +
        '<div id="ts-msg" style="display:none;font-size:12.5px;margin:10px 0 0;padding:9px 12px;border-radius:8px"></div>' +
        '<div style="display:flex;gap:10px;margin-top:14px">' +
          '<button data-gl-close="#gl-trace-ship" style="flex:1;padding:11px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);border-radius:8px;color:#dfe7f1;font-size:13px;cursor:pointer">Cancel</button>' +
          '<button id="ts-save" style="flex:1;padding:11px;background:rgba(0,229,192,.14);border:1px solid rgba(0,229,192,.35);border-radius:8px;color:var(--teal);font-weight:700;font-size:13px;cursor:pointer">Save shipment</button>' +
        '</div>' +
      '</div>';
    ov.querySelector('#ts-save').addEventListener('click', async function(){
      var btn = this, msg = ov.querySelector('#ts-msg');
      var show = function(color, text){ msg.style.display='block'; msg.style.color=color; msg.style.background='rgba(255,255,255,.04)'; msg.textContent=text; };
      var customer = (ov.querySelector('#ts-customer').value||'').trim();
      if(!customer){ show('#ff8579','Customer is required.'); return; }
      var qtyRaw = (ov.querySelector('#ts-qty').value||'').trim();
      var row = {
        run_id: runId,
        lot_code: (ov.querySelector('#ts-lot').value||'').trim() || null,
        customer: customer,
        quantity: qtyRaw === '' ? null : Number(qtyRaw),
        uom: (ov.querySelector('#ts-uom').value||'').trim() || null,
        ship_date: (ov.querySelector('#ts-date').value||'').trim() || null,
        po: (ov.querySelector('#ts-po').value||'').trim() || null,
        created_at: new Date().toISOString()
      };
      btn.disabled = true; show('#9aa7bd','Saving…');
      try {
        var r = await sb().from('lot_shipments').insert(row).select('id');
        if(r.error) throw r.error;
        show('#5fcf9e','✓ Shipment added.');
        if(typeof window.glAudit === 'function') window.glAudit('lot_shipment_added', String(runId), { customer: customer });
        setTimeout(function(){ ov.remove(); reTrace(); }, 700);
      } catch(e){
        btn.disabled = false;
        show('#ff8579','Save failed: ' + (e.message || e));
      }
    });
  };

  // ── Run + record a mock recall ──
  window.glRunMockRecall = function glRunMockRecall(runId, lotCode){
    if(!sb()){ alert('Supabase not ready.'); return; }
    var uname = (window.currentUser && (window.currentUser.name || window.currentUser.email)) || '';
    var ov = overlay('gl-trace-recall');
    ov.innerHTML =
      '<div style="background:#142238;border:1px solid rgba(245,200,66,.3);border-radius:16px;padding:22px;width:100%;max-width:520px;color:#fff">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
          '<div style="font-family:var(--ff-disp);font-size:17px;letter-spacing:1.5px;color:#f5c842">🚨 MOCK RECALL</div>' +
          '<button data-gl-close="#gl-trace-recall" style="background:none;border:none;color:#9aa7bd;font-size:20px;cursor:pointer">✕</button></div>' +
        '<div style="font-size:12px;color:#9aa7bd;margin-bottom:14px;line-height:1.5">Reconcile units produced against units you can account for on lot <b style="color:#eef4ff">'+esc(lotCode||'—')+'</b>. A ≥98% reconciliation passes; ≥100% is a clean pass.</div>' +
        '<div id="gl-recall-form">' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
            '<div><label style="display:block;font-size:11px;color:#9aa7bd;margin:0 0 4px">Units produced *</label><input id="mr-produced" type="number" step="any" min="0" style="'+INP+'"></div>' +
            '<div><label style="display:block;font-size:11px;color:#9aa7bd;margin:0 0 4px">Units accounted *</label><input id="mr-accounted" type="number" step="any" min="0" style="'+INP+'"></div>' +
            '<div><label style="display:block;font-size:11px;color:#9aa7bd;margin:0 0 4px">Time to complete</label><input id="mr-time" placeholder="e.g. 45 min" style="'+INP+'"></div>' +
            '<div><label style="display:block;font-size:11px;color:#9aa7bd;margin:0 0 4px">Conducted by</label><input id="mr-by" value="'+esc(uname)+'" style="'+INP+'"></div>' +
          '</div>' +
          '<label style="display:block;font-size:11px;color:#9aa7bd;margin:10px 0 4px">Notes</label>' +
          '<textarea id="mr-notes" style="'+INP+';min-height:52px;resize:vertical"></textarea>' +
          '<div id="mr-msg" style="display:none;font-size:12.5px;margin:10px 0 0;padding:9px 12px;border-radius:8px"></div>' +
          '<div style="display:flex;gap:10px;margin-top:14px">' +
            '<button data-gl-close="#gl-trace-recall" style="flex:1;padding:11px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);border-radius:8px;color:#dfe7f1;font-size:13px;cursor:pointer">Cancel</button>' +
            '<button id="mr-run" style="flex:1;padding:11px;background:rgba(245,200,66,.16);border:1px solid rgba(245,200,66,.4);border-radius:8px;color:#f5c842;font-weight:700;font-size:13px;cursor:pointer">🚨 Run recall</button>' +
          '</div>' +
        '</div>' +
        '<div id="gl-recall-result" style="display:none"></div>' +
      '</div>';
    ov.querySelector('#mr-run').addEventListener('click', async function(){
      var btn = this, msg = ov.querySelector('#mr-msg');
      var show = function(color, text){ msg.style.display='block'; msg.style.color=color; msg.style.background='rgba(255,255,255,.04)'; msg.textContent=text; };
      var produced = Number((ov.querySelector('#mr-produced').value||'').trim());
      var accounted = Number((ov.querySelector('#mr-accounted').value||'').trim());
      if(!isFinite(produced) || produced <= 0){ show('#ff8579','Enter units produced (greater than zero).'); return; }
      if(!isFinite(accounted) || accounted < 0){ show('#ff8579','Enter units accounted for.'); return; }
      var pct = Math.round(accounted / produced * 100);   // produced guaranteed > 0 above
      var passed = pct >= 100 ? true : (pct >= 98);
      var nowIso = new Date().toISOString();
      var row = {
        lot_code: lotCode || null,
        run_id: runId,
        initiated_at: nowIso,
        completed_at: nowIso,
        units_produced: produced,
        units_accounted: accounted,
        pct_reconciled: pct,
        time_to_complete: (ov.querySelector('#mr-time').value||'').trim() || null,
        conducted_by: (ov.querySelector('#mr-by').value||'').trim() || null,
        passed: passed,
        notes: (ov.querySelector('#mr-notes').value||'').trim() || null
      };
      btn.disabled = true; show('#9aa7bd','Running recall…');
      try {
        var r = await sb().from('mock_recalls').insert(row).select('id');
        if(r.error) throw r.error;
        if(typeof window.glAudit === 'function') window.glAudit('mock_recall_run', String(lotCode||runId), { pct: pct, passed: passed });
        ov.querySelector('#gl-recall-form').style.display = 'none';
        var res = ov.querySelector('#gl-recall-result');
        res.style.display = 'block';
        res.innerHTML =
          '<div style="text-align:center;padding:14px 0">' +
            '<div style="font-family:var(--ff-disp);font-size:44px;letter-spacing:1px;color:'+(passed?'#5fcf9e':'#ff8579')+'">'+esc(pct)+'%</div>' +
            '<div style="font-size:12px;color:#9aa7bd;margin-top:2px">reconciled ('+esc(accounted)+' of '+esc(produced)+' units)</div>' +
            '<div style="display:inline-block;margin-top:12px;font-size:13px;font-weight:800;letter-spacing:1px;color:'+(passed?'#04231d':'#2a0d0a')+';background:'+(passed?'#5fcf9e':'#ff8579')+';border-radius:20px;padding:6px 18px">'+(passed?'PASS':'FAIL')+'</div>' +
          '</div>' +
          '<div style="text-align:right;margin-top:6px"><button data-gl-close="#gl-trace-recall" style="padding:10px 16px;background:rgba(0,229,192,.12);border:1px solid rgba(0,229,192,.3);border-radius:8px;color:var(--teal);font-weight:700;font-size:13px;cursor:pointer">Done</button></div>';
        renderRecentRecalls();
      } catch(e){
        btn.disabled = false;
        show('#ff8579','Save failed: ' + (e.message || e));
      }
    });
  };

  // ── Recent mock recalls list ──
  async function renderRecentRecalls(){
    var host = document.getElementById('gl-trace-recent');
    if(!host) return;
    if(!sb()){ host.innerHTML = '<div style="color:#ff8579;font-size:12px">Supabase not ready.</div>'; return; }
    host.innerHTML = '<div style="color:#9aa7bd;font-size:12px">Loading recent recalls…</div>';
    try {
      var r = await sb().from('mock_recalls').select('*').order('initiated_at', { ascending: false }).limit(10);
      if(r.error) throw r.error;
      var recs = r.data || [];
      var rows = recs.map(function(m){
        var pass = !!m.passed;
        var when = '';
        try { when = m.initiated_at ? new Date(m.initiated_at).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' }) : ''; } catch(e){ when = String(m.initiated_at||''); }
        return '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:11px 14px;margin-bottom:8px;background:rgba(255,255,255,.02)">' +
          '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">' +
            '<span style="font-weight:700;font-size:13px;color:#eef4ff">'+esc(m.lot_code||'(no lot)')+'</span>' +
            '<span style="font-size:12px;color:#9aa7bd">'+esc(m.pct_reconciled==null?'—':m.pct_reconciled)+'% reconciled</span>' +
          '</div>' +
          '<div style="display:flex;align-items:center;gap:10px">' +
            '<span style="font-size:11px;font-weight:800;letter-spacing:.5px;color:'+(pass?'#04231d':'#2a0d0a')+';background:'+(pass?'#5fcf9e':'#ff8579')+';border-radius:20px;padding:3px 12px">'+(pass?'PASS':'FAIL')+'</span>' +
            '<span style="font-size:11px;color:#9aa7bd">'+esc(when)+'</span>' +
          '</div>' +
        '</div>';
      }).join('');
      host.innerHTML =
        '<div style="font-size:10.5px;letter-spacing:1.5px;color:var(--teal);margin-bottom:10px">RECENT MOCK RECALLS</div>' +
        (recs.length ? rows : '<div style="color:#9aa7bd;font-size:12px;padding:6px 0">No mock recalls run yet.</div>');
    } catch(e){
      host.innerHTML = '<div style="color:#ff8579;font-size:12px">Could not load recalls: '+esc(e.message||e)+'</div>';
    }
  }

  // Re-run the trace for whatever run name is currently in the search box.
  function reTrace(){
    var q = document.getElementById('gl-trace-q');
    if(q && (q.value||'').trim()) window.glTraceLot(q.value);
  }

  // Render the page into its container once the DOM is ready.
  function boot(){ try { if(document.getElementById('cpg-trace')) window.glRenderTrace(); } catch(e){} }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  // Re-render if the page node appears later (SPA builds it after login).
  try {
    var mo = new MutationObserver(function(){ var h = document.getElementById('cpg-trace'); if(h && !h.getAttribute('data-trace-ready')){ h.setAttribute('data-trace-ready','1'); window.glRenderTrace(); } });
    mo.observe(document.documentElement, { childList:true, subtree:true });
  } catch(e){}

  console.log('[GL] traceability / mock recall module loaded');
}());
