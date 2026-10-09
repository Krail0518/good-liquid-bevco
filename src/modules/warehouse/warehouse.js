/* ============================================================
   warehouse.js — Warehouse Storage (pallets at CONRI Services)
   ============================================================
   Good Liquid stores pallets at CONRI Services, the 3PL behind the
   Palmetto facility, under ONE Good Liquid account:
     * EMPTY CANS (overflow) — 1-2 days, floor stacked, back for the run
     * FINISHED GOODS — after QA release, wait for a carrier pickup
     * PACKAGING — Good Liquid's own supplies (carrier trays, lids,
       cartons). These belong to no client: client_id is NULL on the SKU
       and on its transfers (20261008140620_warehouse_packaging.sql).
   This page is the system of record for where every pallet is and
   produces the paperwork for every move.

   Tables (all staff-only, see 20260930120000_warehouse_storage.sql):
     wh_skus, wh_lots, wh_pallets, wh_transfers, wh_transfer_lines,
     wh_movements (append-only, trigger-written), wh_outbound_orders

   THE RULES THAT COST MONEY ARE IN THE DATABASE, NOT HERE. QA hold,
   draft -> scheduled -> completed, "every SKU exported to CONRI before
   it is scheduled in", one open transfer per pallet, one client per
   transfer, and moving the pallets on completion are all triggers.
   This page checks the same things first so staff get a clear message
   before they press the button, but a check here is a courtesy, never
   the guard.

   Every write checks what the server actually did (CLAUDE.md rule 4):
   .select() after it, and an error OR an empty array is a failure.
   Everything a client or CONRI's CSV can contain goes through esc()
   before it reaches innerHTML (rule 5).

   Controls use data-wh="<action>" and one delegated listener below,
   so the module's actions are a private allowlist (the ACTIONS map)
   rather than new globals on window.

   Exposes:
     window.glRenderWarehouse()         — fills #cpg-warehouse
     window.glWhBuildPaperworkPdf(t, l) — jsPDF doc for a transfer
     window.glWhCode128(text)           — Code 128-B module widths
     window.glWhBuildBolSheetsPdf(j, i) — jsPDF pallet sheets from a BOL
   ============================================================ */
(function(){
  'use strict';

  // ── Fixed parties ──────────────────────────────────────────
  var GL = {
    name: 'Good Liquid Bev Co',
    street: '2011 51st Ave E, Unit 100',
    city: 'Palmetto, FL 34221',
    contact: 'Mike Krail',
    phone: '803 493 5065'
  };
  var CONRI = {
    name: 'CONRI Services, Inc.',
    attn: 'Paul Nolletti',
    email: 'pnolletti@conriservices.com',
    phone: '941 667 2021',
    city: 'Palmetto, FL'
  };
  var TYPES = {
    to_conri_finished: 'To CONRI: finished goods',
    to_conri_overflow: 'To CONRI: empty can overflow',
    to_conri_packaging: 'To CONRI: Good Liquid packaging',
    pull_back:         'Pull back from CONRI',
    outbound_pickup:   'Outbound carrier pickup'
  };
  var RACK_MAX_IN = 72;          // CONRI racks take pallets under 72"
  var EMPTY_MAX_DAYS = 2;        // empties come back within 1-2 days
  var BEST_BY_WARN_DAYS = 90;
  var PALLET_FOOTPRINT = '48 x 40 in';   // standard GMA pallet; stated in the email
  var INBOUND = { to_conri_finished: 1, to_conri_overflow: 1, to_conri_packaging: 1 };
  var INV_TYPE = { to_conri_finished: 'finished_good', to_conri_overflow: 'empty_can', to_conri_packaging: 'packaging' };
  var TYPE_LABEL = { finished_good: 'Finished good', empty_can: 'Empty cans', packaging: 'Packaging' };

  // Good Liquid's own stock has no client. In a <select> it is this value;
  // in the database it is client_id NULL.
  var GL_OWNER = '__gl__';
  var GL_OWNER_NAME = 'Good Liquid (own packaging)';
  function ownerName(client){ return (client && client.name) || GL_OWNER_NAME; }
  function ownerId(v){ return v === GL_OWNER ? null : (v || ''); }
  var NOTE_MAX = 500;
  function cleanNote(v){ v = String(v == null ? '' : v).trim().slice(0, NOTE_MAX); return v || null; }

  // ── Helpers ────────────────────────────────────────────────
  function sb(){ return window.supa || null; }
  function esc(s){
    return String(s == null ? '' : s).replace(/[<>&"']/g, function(c){
      return {'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c];
    });
  }
  function num(n){ var v = Number(n); return isFinite(v) ? v : 0; }
  function fmtInt(n){ return num(n).toLocaleString('en-US'); }
  function todayISO(){
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  }
  // Date-only strings are formatted by splitting, never via new Date(): a bare
  // '2026-09-30' parses as UTC midnight, which is the previous evening here.
  // crm-index-core.js documents the invoice bug that caused.
  function fmtDate(iso){
    if(!iso) return '';
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
    return m ? (m[2] + '/' + m[3] + '/' + m[1]) : String(iso);
  }
  function fmtMD(iso){ var f = fmtDate(iso); return f ? f.slice(0,5) : ''; }
  function localDate(iso){
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    return m ? new Date(+m[1], +m[2]-1, +m[3], 12) : null;
  }
  function daysUntil(iso){
    var d = localDate(iso); if(!d) return null;
    var t = new Date(); t.setHours(12,0,0,0);
    return Math.round((d - t) / 86400000);
  }
  function daysSince(ts){
    if(!ts) return null;
    var d = new Date(ts); if(isNaN(d)) return null;
    return Math.floor((Date.now() - d.getTime()) / 86400000);
  }
  function fmtTs(ts){
    if(!ts) return '';
    var d = new Date(ts); if(isNaN(d)) return String(ts);
    return d.toLocaleString('en-US', { month:'2-digit', day:'2-digit', year:'numeric', hour:'numeric', minute:'2-digit' });
  }
  // <input type="datetime-local"> value for a timestamp, in local time.
  function toLocalInput(ts){
    if(!ts) return '';
    var d = new Date(ts); if(isNaN(d)) return '';
    var p = function(n){ return String(n).padStart(2,'0'); };
    return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+'T'+p(d.getHours())+':'+p(d.getMinutes());
  }
  function fromLocalInput(v){ if(!v) return null; var d = new Date(v); return isNaN(d) ? null : d.toISOString(); }
  function userName(){
    var u = window.currentUser || {};
    return u.name || u.email || '';
  }
  function audit(action, id, detail){
    try { if(typeof window.glAudit === 'function') window.glAudit(action, String(id || ''), detail || {}); } catch(e){}
  }
  function errMsg(e){ return (e && (e.message || e.error_description || e.details)) || String(e); }

  // Rule 4. A write is a failure if it errored OR touched nothing.
  function checked(res, expectRows, what){
    if(res.error) throw res.error;
    var rows = res.data || [];
    if(!rows.length || (expectRows != null && rows.length !== expectRows)){
      throw new Error((what || 'Save') + ' did not take effect (' + rows.length + ' rows). You may not have access.');
    }
    return rows;
  }

  // UPC-A is 12 digits, EAN-13 is 13. Anything else is kept exactly as entered
  // and flagged, because the SKU on a real delivery may be missing digits.
  // Packaging is keyed by the vendor's item number (TRAY12-1800), not a UPC,
  // so it is never warned about.
  function upcWarning(upc, type){
    if(type === 'packaging') return '';
    var d = String(upc || '').replace(/\D/g,'');
    if(!d) return '';
    if(d.length === 12 || d.length === 13 || d.length === 14) return '';
    return 'UPC has ' + d.length + ' digits (UPC-A is 12). Kept as entered; confirm with the client.';
  }

  var BADGE = {
    draft:'background:rgba(255,255,255,.06);color:#9aa7bd',
    scheduled:'background:rgba(26,111,255,.14);color:#6b9fff',
    completed:'background:rgba(29,158,117,.16);color:#1D9E75',
    cancelled:'background:rgba(231,76,60,.12);color:#e74c3c',
    open:'background:rgba(255,255,255,.06);color:#9aa7bd',
    allocated:'background:rgba(26,111,255,.14);color:#6b9fff',
    shipped:'background:rgba(29,158,117,.16);color:#1D9E75',
    hold:'background:rgba(231,76,60,.12);color:#e74c3c',
    released:'background:rgba(29,158,117,.16);color:#1D9E75'
  };
  function badge(s){
    return '<span style="display:inline-block;padding:2px 9px;border-radius:20px;font-size:10.5px;font-weight:700;letter-spacing:.3px;' +
      (BADGE[s] || BADGE.draft) + '">' + esc(String(s || '').toUpperCase()) + '</span>';
  }
  var INP = 'width:100%;padding:8px 10px;background:#0a1628;border:1px solid rgba(255,255,255,.12);border-radius:7px;color:#fff;font-size:13px;box-sizing:border-box';
  function field(label, inner, span){
    return '<div' + (span ? ' style="grid-column:1/-1"' : '') + '><label style="display:block;font-size:11px;color:#9aa7bd;margin:0 0 4px">' +
      esc(label) + '</label>' + inner + '</div>';
  }
  function note(kind, text){
    var c = kind === 'err' ? '#ff8579' : kind === 'warn' ? '#f5c842' : kind === 'ok' ? '#5fcf9e' : '#9aa7bd';
    return '<div style="font-size:12.5px;color:' + c + ';padding:9px 12px;border-radius:8px;background:rgba(255,255,255,.04);margin:8px 0">' + esc(text) + '</div>';
  }

  function overlay(id, title, maxW){
    var prior = document.getElementById(id); if(prior) prior.remove();
    var ov = document.createElement('div');
    ov.id = id;
    ov.className = 'wh-ov';
    ov.setAttribute('style','position:fixed;inset:0;z-index:900;background:rgba(6,13,26,.95);backdrop-filter:blur(14px);display:flex;align-items:flex-start;justify-content:center;padding:20px;overflow-y:auto');
    ov.addEventListener('click', function(e){ if(e.target === ov) ov.remove(); });
    ov.innerHTML = '<div style="background:#142238;border:1px solid rgba(0,229,192,.2);border-radius:16px;padding:22px;width:100%;max-width:' + (maxW || 560) + 'px;color:#fff">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">' +
        '<div style="font-family:var(--ff-disp);font-size:17px;letter-spacing:1.5px;color:var(--teal)">' + esc(title) + '</div>' +
        '<button type="button" data-wh="closeOverlay" style="background:none;border:none;color:#9aa7bd;font-size:20px;cursor:pointer" aria-label="Close">✕</button>' +
      '</div><div class="wh-ov-body"></div><div class="wh-ov-msg"></div></div>';
    document.body.appendChild(ov);
    return ov;
  }
  // Every overlay body goes through here. Callers build it with esc() on
  // every interpolated value, the same contract as setBody() below.
  function ovBody(ov, html){ var b = ov.querySelector('.wh-ov-body'); if(b) b.innerHTML = html; }
  function ovMsg(ov, kind, text){ var m = ov.querySelector('.wh-ov-msg'); if(m) m.innerHTML = text ? note(kind, text) : ''; }
  function val(root, sel){ var el = root.querySelector(sel); return el ? String(el.value == null ? '' : el.value).trim() : ''; }

  // ── Shared data ────────────────────────────────────────────
  var SKU_COLS = 'id,client_id,upc_sku,description,brand,pack,units_per_case,default_cases_per_pallet,default_pallet_weight_lbs,default_pallet_height_in,inventory_type,active,notes,last_exported_at';
  var LOT_COLS = 'id,sku_id,lot_number,production_date,best_by_date,qa_status,notes';
  var PALLET_EMBED = 'id,pallet_tag,cases,weight_lbs,height_in,location,status,current_transfer_id,received_at_conri,expected_pull_date,notes,' +
    'sku:wh_skus!wh_pallets_sku_id_fkey(' + SKU_COLS + ',client:clients!wh_skus_client_id_fkey(id,name)),' +
    'lot:wh_lots!wh_pallets_lot_matches_sku(' + LOT_COLS + ')';

  var state = { tab: 'dashboard', clients: [], clientsLoaded: false, skuClient: '', bol: null, bolNote: null, bolFilled: [], bolBusy: false };

  async function loadClients(force){
    if(state.clientsLoaded && !force) return state.clients;
    var r = await sb().from('clients').select('id,name').order('name');
    if(r.error) throw r.error;
    state.clients = r.data || [];
    state.clientsLoaded = true;
    return state.clients;
  }
  function clientName(id){
    var c = state.clients.filter(function(x){ return x.id === id; })[0];
    return c ? c.name : '';
  }
  function clientOptions(selected, placeholder, withGl){
    return '<option value="">' + esc(placeholder || 'Choose a client…') + '</option>' +
      (withGl ? '<option value="' + GL_OWNER + '"' + (selected === GL_OWNER ? ' selected' : '') + '>' + esc(GL_OWNER_NAME) + '</option>' : '') +
      state.clients.map(function(c){
        return '<option value="' + esc(c.id) + '"' + (c.id === selected ? ' selected' : '') + '>' + esc(c.name) + '</option>';
      }).join('');
  }

  // ── Page shell ─────────────────────────────────────────────
  var TABS = [
    ['dashboard','📊 Dashboard'],
    ['transfers','🚚 Transfers'],
    ['skus','🏷️ SKU master'],
    ['outbound','📤 Outbound orders'],
    ['recon','🧮 Reconciliation'],
    ['bol','📄 BOL pallet sheets']
  ];

  window.glRenderWarehouse = function glRenderWarehouse(){
    var host = document.getElementById('cpg-warehouse');
    if(!host) return;
    host.innerHTML =
      '<div class="cph">' +
        '<div><div class="cpt">WAREHOUSE STORAGE</div>' +
        '<div class="cps">Pallets at CONRI Services, Palmetto · one Good Liquid account · every move scheduled in advance</div></div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
          '<button class="cbtn" type="button" data-wh="newOrder">🚚 Ship out (LTL)</button>' +
          '<button class="cbtn pri" type="button" data-wh="newTransfer">+ New transfer</button>' +
        '</div>' +
      '</div>' +
      '<div class="cpills" id="wh-tabs">' + TABS.map(function(t){
        return '<span class="cpill' + (t[0] === state.tab ? ' act' : '') + '" data-wh="tab" data-arg="' + t[0] + '">' + esc(t[1]) + '</span>';
      }).join('') + '</div>' +
      '<div id="wh-body"></div>';
    renderTab();
  };

  function body(){ return document.getElementById('wh-body'); }
  function setBody(html){ var b = body(); if(b) b.innerHTML = html; }
  function loading(){ setBody('<div style="color:#9aa7bd;font-size:13px;padding:14px 0">Loading…</div>'); }

  async function renderTab(){
    if(!window.currentUser) return;          // staff-only; see glWhenStaff (GL-052)
    if(!sb()){ setBody(note('err','Supabase not ready.')); return; }
    loading();
    try {
      await loadClients();
      if(state.tab === 'dashboard') await renderDashboard();
      else if(state.tab === 'transfers') await renderTransfers();
      else if(state.tab === 'skus') await renderSkus();
      else if(state.tab === 'outbound') await renderOutbound();
      else if(state.tab === 'recon') renderRecon();
      else if(state.tab === 'bol') renderBol();
    } catch(e){
      setBody(note('err', 'Could not load: ' + errMsg(e)));
    }
  }

  // ════════════════════════════════════════════════════════════
  // 1. DASHBOARD
  // ════════════════════════════════════════════════════════════
  async function loadConriPallets(){
    var r = await sb().from('wh_pallets').select(PALLET_EMBED).eq('location','conri').neq('status','void');
    if(r.error) throw r.error;
    return r.data || [];
  }

  async function renderDashboard(){
    var pallets = await loadConriPallets();
    var tr = await sb().from('wh_transfers')
      .select('id,transfer_number,type,status,scheduled_at,transfer_date,client:clients!wh_transfers_client_id_fkey(name)')
      .in('status',['draft','scheduled']).order('scheduled_at', { ascending: true, nullsFirst: false }).limit(50);
    if(tr.error) throw tr.error;
    var ob = await sb().from('wh_outbound_orders')
      .select('id,order_number,status,requested_pickup_date,carrier,client:clients!wh_outbound_orders_client_id_fkey(name)')
      .in('status',['open','allocated']).order('requested_pickup_date', { ascending: true }).limit(50);
    if(ob.error) throw ob.error;

    // client -> sku -> lot
    var tree = {};
    pallets.forEach(function(p){
      var s = p.sku || {}, l = p.lot || {};
      var cKey = ownerName(s.client);
      var sKey = s.id || '?', lKey = l.id || 'nolot';
      tree[cKey] = tree[cKey] || {};
      tree[cKey][sKey] = tree[cKey][sKey] || { sku: s, lots: {} };
      var node = tree[cKey][sKey].lots[lKey] = tree[cKey][sKey].lots[lKey] || { lot: l, pallets: 0, cases: 0, units: 0 };
      node.pallets += 1;
      node.cases += num(p.cases);
      node.units += num(p.cases) * num(s.units_per_case);
    });
    var totP = pallets.length, totC = 0, totU = 0;
    pallets.forEach(function(p){ totC += num(p.cases); totU += num(p.cases) * num(p.sku && p.sku.units_per_case); });

    var rows = '';
    Object.keys(tree).sort().forEach(function(cName){
      rows += '<tr><td colspan="8" style="font-weight:700;color:var(--teal);padding-top:14px">' + esc(cName) + '</td></tr>';
      Object.keys(tree[cName]).forEach(function(sId){
        var sNode = tree[cName][sId];
        Object.keys(sNode.lots).forEach(function(lId){
          var n = sNode.lots[lId], l = n.lot, s = sNode.sku;
          var d = daysUntil(l.best_by_date);
          var warn = s.inventory_type === 'finished_good' && d != null && d < BEST_BY_WARN_DAYS;
          rows += '<tr' + (warn ? ' style="background:rgba(245,200,66,.08)"' : '') + '>' +
            '<td>' + esc(s.upc_sku) + '</td>' +
            '<td>' + esc(s.description) + (s.inventory_type === 'empty_can' ? ' <span style="color:#9aa7bd">(empty cans)</span>' :
              s.inventory_type === 'packaging' ? ' <span style="color:#9aa7bd">(packaging)</span>' : '') + '</td>' +
            '<td>' + esc(l.lot_number || '') + '</td>' +
            '<td style="text-align:right">' + fmtInt(n.pallets) + '</td>' +
            '<td style="text-align:right">' + fmtInt(n.cases) + '</td>' +
            '<td style="text-align:right">' + (n.units ? fmtInt(n.units) : '') + '</td>' +
            '<td' + (warn ? ' style="color:#f5c842;font-weight:700"' : '') + '>' + esc(fmtDate(l.best_by_date)) +
              (warn ? ' · ' + esc(d) + ' days' : '') + '</td>' +
            '<td style="text-align:right">' + (shippable(s) && !sNode.shipBtn ? (sNode.shipBtn = 1,
              '<button type="button" class="cbtn" style="padding:3px 9px;font-size:11px" data-wh="shipSku" data-arg="' + esc(s.client_id) + '" data-arg2="' + esc(s.id) + '">🚚 Ship</button>') : '') + '</td></tr>';
        });
      });
    });

    var empties = pallets.filter(function(p){ return p.sku && p.sku.inventory_type === 'empty_can'; })
      .sort(function(a,b){ return String(a.received_at_conri||'').localeCompare(String(b.received_at_conri||'')); });
    var emptyRows = empties.map(function(p){
      var days = daysSince(p.received_at_conri);
      var late = days != null && days > EMPTY_MAX_DAYS;
      return '<tr' + (late ? ' style="background:rgba(231,76,60,.10)"' : '') + '>' +
        '<td>' + esc(p.pallet_tag) + '</td><td>' + esc(p.sku.client && p.sku.client.name) + '</td>' +
        '<td>' + esc(p.sku.description) + '</td>' +
        '<td>' + esc(fmtTs(p.received_at_conri)) + '</td>' +
        '<td style="font-weight:700;' + (late ? 'color:#ff8579' : '') + '">' + (days == null ? '' : esc(days) + ' days') + '</td>' +
        '<td>' + esc(fmtDate(p.expected_pull_date)) + '</td><td>' + esc(p.notes || '') + '</td></tr>';
    }).join('');

    var soon = [];
    Object.keys(tree).forEach(function(cName){
      Object.keys(tree[cName]).forEach(function(sId){
        var sNode = tree[cName][sId];
        if(sNode.sku.inventory_type !== 'finished_good') return;
        Object.keys(sNode.lots).forEach(function(lId){
          var n = sNode.lots[lId], d = daysUntil(n.lot.best_by_date);
          if(d != null && d < BEST_BY_WARN_DAYS) soon.push({ c: cName, s: sNode.sku, n: n, d: d });
        });
      });
    });
    soon.sort(function(a,b){ return a.d - b.d; });
    var soonRows = soon.map(function(x){
      return '<tr style="background:rgba(245,200,66,.08)"><td>' + esc(x.c) + '</td><td>' + esc(x.s.upc_sku) + ' · ' + esc(x.s.description) + '</td>' +
        '<td>' + esc(x.n.lot.lot_number) + '</td><td style="text-align:right">' + fmtInt(x.n.pallets) + '</td>' +
        '<td style="color:#f5c842;font-weight:700">' + esc(fmtDate(x.n.lot.best_by_date)) + ' · ' + esc(x.d) + ' days</td></tr>';
    }).join('');

    var upRows = (tr.data || []).map(function(t){
      return '<tr style="cursor:pointer" data-wh="openTransfer" data-arg="' + esc(t.id) + '">' +
        '<td>' + esc(t.transfer_number) + '</td><td>' + esc(TYPES[t.type] || t.type) + '</td>' +
        '<td>' + esc(ownerName(t.client)) + '</td>' +
        '<td>' + esc(t.scheduled_at ? fmtTs(t.scheduled_at) : 'not scheduled') + '</td><td>' + badge(t.status) + '</td></tr>';
    }).join('') + (ob.data || []).map(function(o){
      return '<tr><td>' + esc(o.order_number) + '</td><td>Outbound order</td><td>' + esc(o.client && o.client.name) + '</td>' +
        '<td>' + esc(fmtDate(o.requested_pickup_date)) + (o.carrier ? ' · ' + esc(o.carrier) : '') + '</td><td>' + badge(o.status) + '</td></tr>';
    }).join('');

    function stat(label, value){
      return '<div class="ccard" style="flex:1;min-width:140px"><div style="font-size:10.5px;letter-spacing:1px;color:var(--muted)">' + esc(label) +
        '</div><div style="font-family:var(--ff-disp);font-size:26px;color:var(--teal);margin-top:4px">' + esc(value) + '</div></div>';
    }
    var noted = pallets.filter(function(p){ return p.notes; }).sort(function(a, b){ return String(a.pallet_tag).localeCompare(String(b.pallet_tag)); });
    var noteRows = noted.map(function(p){
      var s = p.sku || {};
      return '<tr><td style="font-weight:700">' + esc(p.pallet_tag) + '</td><td>' + esc(ownerName(s.client)) + '</td>' +
        '<td>' + esc(s.upc_sku) + ' · ' + esc(s.description) + '</td><td style="text-align:right">' + fmtInt(p.cases) + '</td>' +
        '<td style="white-space:pre-line">' + esc(p.notes) + '</td></tr>';
    }).join('');
    var lateCount = empties.filter(function(p){ var d = daysSince(p.received_at_conri); return d != null && d > EMPTY_MAX_DAYS; }).length;

    setBody(
      '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:14px">' +
        stat('PALLETS AT CONRI', fmtInt(totP)) + stat('CASES', fmtInt(totC)) + stat('UNITS', fmtInt(totU)) +
        stat('EMPTIES PAST ' + EMPTY_MAX_DAYS + ' DAYS', fmtInt(lateCount)) + stat('LOTS < ' + BEST_BY_WARN_DAYS + ' DAYS TO BEST BY', fmtInt(soon.length)) +
      '</div>' +
      '<div class="ccard" style="margin-bottom:14px"><div class="ccard-t">On hand at CONRI · by owner, SKU, lot</div>' +
        (rows ? '<div style="overflow-x:auto"><table class="ctbl"><tr><th>UPC / SKU</th><th>Description</th><th>Lot</th><th style="text-align:right">Pallets</th><th style="text-align:right">Cases</th><th style="text-align:right">Units</th><th>Best by</th><th></th></tr>' + rows + '</table></div>'
              : '<div style="color:#9aa7bd;font-size:12px">Nothing at CONRI right now.</div>') +
      '</div>' +
      (noteRows ? '<div class="ccard" style="margin-bottom:14px"><div class="ccard-t">Pallet notes at CONRI</div>' +
        '<div style="overflow-x:auto"><table class="ctbl"><tr><th>Pallet</th><th>Client</th><th>SKU</th><th style="text-align:right">Cases</th><th>Note</th></tr>' + noteRows + '</table></div></div>' : '') +
      '<div class="ccard" style="margin-bottom:14px"><div class="ccard-t">Empty cans at CONRI · red past ' + EMPTY_MAX_DAYS + ' days</div>' +
        (emptyRows ? '<div style="overflow-x:auto"><table class="ctbl"><tr><th>Pallet</th><th>Client</th><th>SKU</th><th>Received</th><th>In storage</th><th>Expected pull</th><th>Note</th></tr>' + emptyRows + '</table></div>'
                   : '<div style="color:#9aa7bd;font-size:12px">No empty cans in storage.</div>') +
      '</div>' +
      '<div class="ccard" style="margin-bottom:14px"><div class="ccard-t">Finished goods lots under ' + BEST_BY_WARN_DAYS + ' days to best by</div>' +
        (soonRows ? '<div style="overflow-x:auto"><table class="ctbl"><tr><th>Client</th><th>SKU</th><th>Lot</th><th style="text-align:right">Pallets</th><th>Best by</th></tr>' + soonRows + '</table></div>'
                  : '<div style="color:#9aa7bd;font-size:12px">No lots close to best by.</div>') +
      '</div>' +
      '<div class="ccard"><div class="ccard-t">Upcoming transfers and pickups</div>' +
        (upRows ? '<div style="overflow-x:auto"><table class="ctbl"><tr><th>Number</th><th>Type</th><th>Client</th><th>When</th><th>Status</th></tr>' + upRows + '</table></div>'
                : '<div style="color:#9aa7bd;font-size:12px">Nothing open.</div>') +
      '</div>'
    );
  }

  // ════════════════════════════════════════════════════════════
  // 2. TRANSFERS (list + new)
  // ════════════════════════════════════════════════════════════
  async function renderTransfers(){
    var r = await sb().from('wh_transfers')
      .select('id,transfer_number,type,status,transfer_date,scheduled_at,client:clients!wh_transfers_client_id_fkey(name)')
      .order('transfer_date', { ascending: false }).order('transfer_number', { ascending: false }).limit(200);
    if(r.error) throw r.error;
    var ids = (r.data || []).map(function(t){ return t.id; });
    var counts = {};
    if(ids.length){
      var lr = await sb().from('wh_transfer_lines').select('transfer_id,pallet:wh_pallets!wh_transfer_lines_pallet_id_fkey(cases)').in('transfer_id', ids);
      if(lr.error) throw lr.error;
      (lr.data || []).forEach(function(l){
        var c = counts[l.transfer_id] = counts[l.transfer_id] || { p: 0, c: 0 };
        c.p += 1; c.c += num(l.pallet && l.pallet.cases);
      });
    }
    var rows = (r.data || []).map(function(t){
      var c = counts[t.id] || { p: 0, c: 0 };
      return '<tr style="cursor:pointer" data-wh="openTransfer" data-arg="' + esc(t.id) + '">' +
        '<td style="font-weight:700">' + esc(t.transfer_number) + '</td><td>' + esc(fmtDate(t.transfer_date)) + '</td>' +
        '<td>' + esc(TYPES[t.type] || t.type) + '</td><td>' + esc(ownerName(t.client)) + '</td>' +
        '<td style="text-align:right">' + fmtInt(c.p) + '</td><td style="text-align:right">' + fmtInt(c.c) + '</td>' +
        '<td>' + esc(t.scheduled_at ? fmtTs(t.scheduled_at) : '') + '</td><td>' + badge(t.status) + '</td></tr>';
    }).join('');
    setBody('<div class="ccard"><div class="ccard-t">Transfers</div>' +
      (rows ? '<div style="overflow-x:auto"><table class="ctbl"><tr><th>Number</th><th>Date</th><th>Type</th><th>Client</th><th style="text-align:right">Pallets</th><th style="text-align:right">Cases</th><th>Scheduled</th><th>Status</th></tr>' + rows + '</table></div>'
            : '<div style="color:#9aa7bd;font-size:12px">No transfers yet. Start one with + New transfer.</div>') + '</div>');
  }

  function openNewTransfer(){
    var ov = overlay('wh-new-transfer', '+ NEW TRANSFER');
    ovBody(ov, '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
        field('Type *', '<select id="wnt-type" style="' + INP + '">' + Object.keys(TYPES).map(function(k){
          return '<option value="' + k + '">' + esc(TYPES[k]) + '</option>'; }).join('') + '</select>', true) +
        field('Client / brand *', '<select id="wnt-client" style="' + INP + '">' + clientOptions('', null, true) + '</select>', true) +
        field('Transfer date', '<input id="wnt-date" type="date" value="' + todayISO() + '" style="' + INP + '">') +
        field('Scheduled with CONRI for', '<input id="wnt-when" type="datetime-local" style="' + INP + '">') +
        '<div id="wnt-outbound" style="grid-column:1/-1;display:none;gap:10px;grid-template-columns:1fr 1fr">' +
          field('Carrier', '<input id="wnt-carrier" style="' + INP + '">') +
          field('Ship to', '<textarea id="wnt-shipto" rows="2" style="' + INP + '"></textarea>') +
        '</div>' +
        field('Notes', '<textarea id="wnt-notes" rows="2" style="' + INP + '"></textarea>', true) +
      '</div>' +
      '<div style="display:flex;gap:10px;margin-top:14px"><button type="button" class="cbtn" data-wh="closeOverlay" style="flex:1;justify-content:center">Cancel</button>' +
      '<button type="button" class="cbtn pri" id="wnt-save" style="flex:1;justify-content:center">Create draft</button></div>');
    var typeSel = ov.querySelector('#wnt-type'), ownerSel = ov.querySelector('#wnt-client');
    var toggle = function(){
      ov.querySelector('#wnt-outbound').style.display = typeSel.value === 'outbound_pickup' ? 'grid' : 'none';
      // Packaging is always Good Liquid's own; nothing to choose.
      if(typeSel.value === 'to_conri_packaging') ownerSel.value = GL_OWNER;
      ownerSel.disabled = typeSel.value === 'to_conri_packaging';
    };
    typeSel.addEventListener('change', toggle); toggle();
    ov.querySelector('#wnt-save').addEventListener('click', async function(){
      var btn = this;
      var owner = val(ov,'#wnt-client');
      var row = {
        type: val(ov,'#wnt-type'),
        client_id: ownerId(owner),
        transfer_date: val(ov,'#wnt-date') || todayISO(),
        scheduled_at: fromLocalInput(val(ov,'#wnt-when')),
        carrier: val(ov,'#wnt-carrier') || null,
        ship_to: val(ov,'#wnt-shipto') || null,
        notes: val(ov,'#wnt-notes') || null,
        released_by: row_releasedBy(val(ov,'#wnt-type'))
      };
      if(!owner){ ovMsg(ov,'err','Choose the client.'); return; }
      // Same rule as wh_transfers_owner_check, said in words first.
      if(owner === GL_OWNER && row.type !== 'to_conri_packaging' && row.type !== 'pull_back'){
        ovMsg(ov,'err','Good Liquid\'s own stock can only go to CONRI as packaging or be pulled back.'); return;
      }
      btn.disabled = true; ovMsg(ov,'','Saving…');
      try {
        var rows = checked(await sb().from('wh_transfers').insert(row).select('id,transfer_number'), 1, 'Create transfer');
        audit('wh_transfer_created', rows[0].transfer_number, { type: row.type });
        ov.remove();
        openTransfer(rows[0].id);
      } catch(e){ btn.disabled = false; ovMsg(ov,'err','Could not create: ' + errMsg(e)); }
    });
  }
  // The person releasing is Good Liquid staff on an inbound move to CONRI.
  function row_releasedBy(type){
    return INBOUND[type] ? (userName() || null) : null;
  }

  // ════════════════════════════════════════════════════════════
  // 3. TRANSFER DETAIL
  // ════════════════════════════════════════════════════════════
  async function loadTransfer(id){
    var t = await sb().from('wh_transfers').select('*,client:clients!wh_transfers_client_id_fkey(id,name)').eq('id', id).limit(1);
    if(t.error) throw t.error;
    if(!t.data || !t.data.length) throw new Error('Transfer not found.');
    var l = await sb().from('wh_transfer_lines')
      .select('line_no,pallet:wh_pallets!wh_transfer_lines_pallet_id_fkey(' + PALLET_EMBED + ')')
      .eq('transfer_id', id).order('line_no');
    if(l.error) throw l.error;
    var lines = (l.data || []).map(function(x){ var p = x.pallet || {}; p.line_no = x.line_no; return p; });
    return { t: t.data[0], lines: lines };
  }

  // Warnings the page can see before the trigger would refuse. Blocking ones
  // stop the Schedule button; the rest are shown and allowed.
  function lineIssues(t, lines){
    var block = [], warn = [];
    var seenSku = {};
    lines.forEach(function(p){
      var s = p.sku || {}, l = p.lot || {};
      if(t.type === 'to_conri_finished'){
        if(!p.lot) block.push(p.pallet_tag + ': no lot (finished goods need a QA-released lot).');
        else if(l.qa_status !== 'released') block.push('Lot ' + l.lot_number + ' is on QA HOLD.');
      }
      if(INBOUND[t.type] && !s.last_exported_at && !seenSku[s.id]){
        block.push('SKU ' + s.upc_sku + ' has never been exported to CONRI. Export it from SKU master first.');
      }
      var h = num(p.height_in || s.default_pallet_height_in);
      if(s.inventory_type !== 'empty_can' && h >= RACK_MAX_IN && !seenSku['h' + s.id]){
        warn.push(s.upc_sku + ': pallet height ' + h + '" is not under ' + RACK_MAX_IN + '". CONRI cannot rack it.');
        seenSku['h' + s.id] = 1;
      }
      var uw = upcWarning(s.upc_sku, s.inventory_type);
      if(uw && !seenSku['u' + s.id]){ warn.push(s.upc_sku + ': ' + uw); seenSku['u' + s.id] = 1; }
      seenSku[s.id] = 1;
    });
    // de-duplicate
    block = block.filter(function(x, i){ return block.indexOf(x) === i; });
    return { block: block, warn: warn };
  }

  async function openTransfer(id){
    state.tab = 'transfers';
    var tabs = document.querySelectorAll('#wh-tabs .cpill');
    tabs.forEach(function(el){ el.classList.toggle('act', el.getAttribute('data-arg') === 'transfers'); });
    loading();
    try {
      var d = await loadTransfer(id);
      renderTransferDetail(d.t, d.lines);
    } catch(e){ setBody(note('err','Could not load transfer: ' + errMsg(e))); }
  }

  function renderTransferDetail(t, lines){
    var s = t.status, draft = s === 'draft';
    var issues = lineIssues(t, lines);
    var totC = 0, totU = 0, totW = 0;
    lines.forEach(function(p){ totC += num(p.cases); totU += num(p.cases) * num(p.sku && p.sku.units_per_case); totW += num(p.weight_lbs); });
    var inbound = !!INBOUND[t.type];

    var rows = lines.map(function(p, i){
      var sk = p.sku || {}, l = p.lot || {};
      var h = num(p.height_in || sk.default_pallet_height_in);
      var tall = sk.inventory_type !== 'empty_can' && h >= RACK_MAX_IN;
      return '<tr><td>' + (i+1) + ' of ' + lines.length + '</td><td style="font-weight:700">' + esc(p.pallet_tag) + '</td>' +
        '<td>' + esc(sk.upc_sku) + '</td><td>' + esc(sk.description) + '</td><td>' + esc(sk.pack) + '</td>' +
        '<td style="text-align:right">' + fmtInt(p.cases) + '</td><td>' + esc(l.lot_number || '') +
          (p.lot && l.qa_status !== 'released' ? ' ' + badge('hold') : '') + '</td>' +
        '<td>' + esc(fmtDate(l.best_by_date)) + '</td><td>' + esc(fmtDate(l.production_date)) + '</td>' +
        '<td' + (tall ? ' style="color:#f5c842;font-weight:700"' : '') + '>' + (h ? esc(h) + '"' : '') + '</td>' +
        '<td>' + (p.weight_lbs ? fmtInt(p.weight_lbs) : '') + '</td>' +
        '<td style="white-space:pre-line;max-width:220px">' + esc(p.notes || '') +
          ' <button type="button" class="cbtn" style="padding:2px 8px;font-size:10.5px" data-wh="editPalletNote" data-arg="' + esc(p.id) + '" data-arg2="' + esc(t.id) + '">' + (p.notes ? '✏️' : '+ Note') + '</button></td>' +
        '<td>' + (draft ? '<button type="button" class="cbtn red" data-wh="removeLine" data-arg="' + esc(t.id) + '" data-arg2="' + esc(p.id) + '">Remove</button>' : '') + '</td></tr>';
    }).join('');

    var actions = '';
    actions += '<button type="button" class="cbtn" data-wh="tab" data-arg="transfers">← All transfers</button>';
    if(lines.length) actions += '<button type="button" class="cbtn pri" data-wh="printPaperwork" data-arg="' + esc(t.id) + '">🖨️ Print paperwork</button>';
    if(lines.length && s !== 'cancelled') actions += '<button type="button" class="cbtn" data-wh="schedEmail" data-arg="' + esc(t.id) + '">✉ Scheduling email to CONRI</button>';
    if(draft){
      actions += '<button type="button" class="cbtn" data-wh="editTransfer" data-arg="' + esc(t.id) + '">✏️ Edit</button>';
      actions += '<button type="button" class="cbtn grn" data-wh="scheduleTransfer" data-arg="' + esc(t.id) + '"' + (issues.block.length || !lines.length ? ' disabled title="Fix the blocking items first"' : '') + '>📅 Mark scheduled</button>';
    }
    if(s === 'scheduled'){
      actions += '<button type="button" class="cbtn" data-wh="unscheduleTransfer" data-arg="' + esc(t.id) + '">↩ Back to draft</button>';
      actions += '<button type="button" class="cbtn grn" data-wh="completeTransfer" data-arg="' + esc(t.id) + '">✓ Complete (received)</button>';
    }
    if(draft || s === 'scheduled') actions += '<button type="button" class="cbtn red" data-wh="cancelTransfer" data-arg="' + esc(t.id) + '">Cancel transfer</button>';
    if(s === 'completed'){
      actions += '<button type="button" class="cbtn" data-wh="uploadSigned" data-arg="' + esc(t.id) + '">📎 ' + (t.signed_doc_path ? 'Replace' : 'Upload') + ' signed packing list</button>';
    }
    if(t.signed_doc_path) actions += '<button type="button" class="cbtn" data-wh="viewSigned" data-arg="' + esc(t.id) + '">📄 View signed packing list</button>';

    var add = '';
    if(draft){
      add = '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">' +
        (inbound ? '<button type="button" class="cbtn pri" data-wh="quickBuild" data-arg="' + esc(t.id) + '">⚡ Quick build pallets</button>' : '') +
        '<button type="button" class="cbtn" data-wh="pickPallets" data-arg="' + esc(t.id) + '">☑ Pick existing pallets</button></div>';
    }

    var receipt = s === 'completed'
      ? '<div class="ccard" style="margin-top:14px"><div class="ccard-t">Receipt</div><div style="font-size:12.5px;line-height:1.8;color:#dfe7f1">' +
        'Received by <b>' + esc(t.received_by) + '</b> · ' + esc(fmtTs(t.completed_at)) + '<br>' +
        'Pallets received ' + esc(t.pallets_received) + ' of ' + lines.length + ' · cases received ' + fmtInt(t.cases_received) + ' of ' + fmtInt(totC) + '<br>' +
        'Condition: ' + esc(t.receipt_condition === 'exceptions' ? 'Exceptions noted' : 'Good') +
        (t.exceptions ? '<br>Exceptions: ' + esc(t.exceptions) : '') + '</div></div>'
      : '';

    setBody(
      '<div class="ccard" style="margin-bottom:14px">' +
        '<div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-start">' +
          '<div><div style="font-family:var(--ff-disp);font-size:22px;letter-spacing:1px;color:var(--teal)">' + esc(t.transfer_number) + '</div>' +
          '<div style="font-size:12.5px;color:#9aa7bd;margin-top:4px">' + esc(TYPES[t.type] || t.type) + ' · ' + esc(ownerName(t.client)) +
            ' · dated ' + esc(fmtDate(t.transfer_date)) + '</div>' +
          '<div style="font-size:12.5px;color:#dfe7f1;margin-top:4px">Scheduled: ' + esc(t.scheduled_at ? fmtTs(t.scheduled_at) : 'not set') +
            (t.conri_confirmation ? ' · CONRI ref ' + esc(t.conri_confirmation) : '') +
            (t.carrier ? ' · Carrier ' + esc(t.carrier) : '') + '</div>' +
          (t.ship_to ? '<div style="font-size:12px;color:#9aa7bd;margin-top:2px;white-space:pre-line">Ship to: ' + esc(t.ship_to) + '</div>' : '') +
          (t.notes ? '<div style="font-size:12px;color:#9aa7bd;margin-top:2px">' + esc(t.notes) + '</div>' : '') +
          '</div><div>' + badge(s) + '</div></div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px">' + actions + '</div>' +
        issues.block.map(function(x){ return note('err', '⛔ ' + x); }).join('') +
        issues.warn.map(function(x){ return note('warn', '⚠ ' + x); }).join('') +
      '</div>' +
      '<div class="ccard"><div class="ccard-t">Pallets · ' + lines.length + ' pallets · ' + fmtInt(totC) + ' cases' + (totU ? ' · ' + fmtInt(totU) + ' units' : '') +
        (totW ? ' · ' + fmtInt(totW) + ' lbs' : '') + '</div>' +
        (rows ? '<div style="overflow-x:auto"><table class="ctbl"><tr><th>Pallet</th><th>Tag</th><th>UPC / SKU</th><th>Description</th><th>Pack</th><th style="text-align:right">Cases</th><th>Lot</th><th>Best by</th><th>Prod.</th><th>Height</th><th>Lbs</th><th>Note</th><th></th></tr>' + rows + '</table></div>'
              : '<div style="color:#9aa7bd;font-size:12px">No pallets yet.</div>') +
        add +
      '</div>' + receipt +
      '<div id="wh-moves" style="margin-top:14px"></div>'
    );
    renderMovements(t.id);
  }

  async function renderMovements(transferId){
    var host = document.getElementById('wh-moves'); if(!host) return;
    try {
      var r = await sb().from('wh_movements').select('seq,at,from_location,to_location,from_status,to_status,pallet:wh_pallets!wh_movements_pallet_id_fkey(pallet_tag)')
        .eq('transfer_id', transferId).order('seq');
      if(r.error) throw r.error;
      if(!(r.data || []).length){ host.textContent = ''; return; }
      host.innerHTML = '<div class="ccard"><div class="ccard-t">Movement log (append-only)</div><div style="overflow-x:auto"><table class="ctbl"><tr><th>When</th><th>Pallet</th><th>From</th><th>To</th></tr>' +
        r.data.map(function(m){
          return '<tr><td>' + esc(fmtTs(m.at)) + '</td><td>' + esc(m.pallet && m.pallet.pallet_tag) + '</td>' +
            '<td>' + esc((m.from_location || '') + (m.from_status ? ' / ' + m.from_status : '')) + '</td>' +
            '<td>' + esc(m.to_location + ' / ' + m.to_status) + '</td></tr>';
        }).join('') + '</table></div></div>';
    } catch(e){ host.innerHTML = note('err','Could not load movements: ' + errMsg(e)); }
  }

  // A pallet's note can change at any time, wherever the pallet is: it is
  // information about the pallet, not part of the move's record.
  async function editPalletNote(palletId, transferId){
    var r = await sb().from('wh_pallets').select('id,pallet_tag,notes').eq('id', palletId).limit(1);
    if(r.error || !r.data || !r.data[0]){ alert('Could not load the pallet.'); return; }
    var p = r.data[0];
    var ov = overlay('wh-pnote', 'NOTE · ' + p.pallet_tag);
    ovBody(ov, field('Note (shows on the transfer, the dashboard, the pallet label and the email to CONRI)',
        '<textarea id="wpn-note" rows="3" maxlength="' + NOTE_MAX + '" style="' + INP + '">' + esc(p.notes || '') + '</textarea>', true) +
      '<div style="display:flex;gap:10px;margin-top:14px"><button type="button" class="cbtn" data-wh="closeOverlay" style="flex:1;justify-content:center">Cancel</button>' +
      '<button type="button" class="cbtn pri" id="wpn-save" style="flex:1;justify-content:center">Save note</button></div>');
    ov.querySelector('#wpn-save').addEventListener('click', async function(){
      var btn = this; btn.disabled = true; ovMsg(ov,'','Saving…');
      try {
        var note = cleanNote(ov.querySelector('#wpn-note').value);
        checked(await sb().from('wh_pallets').update({ notes: note }).eq('id', palletId).select('id'), 1, 'Save note');
        audit('wh_pallet_note', p.pallet_tag, {});
        ov.remove();
        if(transferId) reopen(transferId); else renderTab();
      } catch(e){ btn.disabled = false; ovMsg(ov,'err','Save failed: ' + errMsg(e)); }
    });
  }

  async function reopen(id){ try { var d = await loadTransfer(id); renderTransferDetail(d.t, d.lines); } catch(e){ setBody(note('err', errMsg(e))); } }

  async function editTransfer(id){
    var d = await loadTransfer(id), t = d.t;
    var ov = overlay('wh-edit-transfer', 'EDIT ' + t.transfer_number);
    ovBody(ov, '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
        field('Scheduled with CONRI for', '<input id="wet-when" type="datetime-local" value="' + esc(toLocalInput(t.scheduled_at)) + '" style="' + INP + '">') +
        field('CONRI confirmation #', '<input id="wet-conf" value="' + esc(t.conri_confirmation || '') + '" style="' + INP + '">') +
        field('Released by', '<input id="wet-rel" value="' + esc(t.released_by || '') + '" style="' + INP + '">') +
        field('Carrier', '<input id="wet-carrier" value="' + esc(t.carrier || '') + '" style="' + INP + '">') +
        field('Ship to', '<textarea id="wet-shipto" rows="2" style="' + INP + '">' + esc(t.ship_to || '') + '</textarea>', true) +
        field('Notes', '<textarea id="wet-notes" rows="2" style="' + INP + '">' + esc(t.notes || '') + '</textarea>', true) +
      '</div>' +
      '<div style="display:flex;gap:10px;margin-top:14px"><button type="button" class="cbtn" data-wh="closeOverlay" style="flex:1;justify-content:center">Cancel</button>' +
      '<button type="button" class="cbtn pri" id="wet-save" style="flex:1;justify-content:center">Save</button></div>');
    ov.querySelector('#wet-save').addEventListener('click', async function(){
      var btn = this; btn.disabled = true; ovMsg(ov,'','Saving…');
      try {
        var patch = {
          scheduled_at: fromLocalInput(val(ov,'#wet-when')),
          conri_confirmation: val(ov,'#wet-conf') || null,
          released_by: val(ov,'#wet-rel') || null,
          carrier: val(ov,'#wet-carrier') || null,
          ship_to: val(ov,'#wet-shipto') || null,
          notes: val(ov,'#wet-notes') || null
        };
        checked(await sb().from('wh_transfers').update(patch).eq('id', id).select('id'), 1, 'Update');
        ov.remove(); reopen(id);
      } catch(e){ btn.disabled = false; ovMsg(ov,'err','Save failed: ' + errMsg(e)); }
    });
  }

  async function setStatus(id, status, extra, label){
    var patch = Object.assign({ status: status }, extra || {});
    try {
      var rows = checked(await sb().from('wh_transfers').update(patch).eq('id', id).select('id,transfer_number,status'), 1, label || 'Status change');
      audit('wh_transfer_' + status, rows[0].transfer_number, {});
      await reopen(id);
      return true;
    } catch(e){
      alert((label || 'Status change') + ' failed: ' + errMsg(e));
      return false;
    }
  }

  async function scheduleTransfer(id){
    var d = await loadTransfer(id);
    var issues = lineIssues(d.t, d.lines);
    if(issues.block.length){ alert('Cannot schedule yet:\n\n' + issues.block.join('\n')); return; }
    if(!d.t.scheduled_at){ alert('Set the date and time agreed with CONRI first (✏️ Edit).'); return; }
    if(issues.warn.length && !confirm('Warnings:\n\n' + issues.warn.join('\n') + '\n\nSchedule anyway?')) return;
    await setStatus(id, 'scheduled', null, 'Schedule');
  }

  async function cancelTransfer(id){
    if(!confirm('Cancel this transfer? Its pallets are released back to where they are. This cannot be undone.')) return;
    await setStatus(id, 'cancelled', null, 'Cancel');
  }

  async function removeLine(transferId, palletId){
    try {
      checked(await sb().from('wh_transfer_lines').delete().eq('transfer_id', transferId).eq('pallet_id', palletId).select('pallet_id'), 1, 'Remove');
      // A pallet quick-built for this transfer and now on none is a record made
      // in error; offer to void it so it does not linger as "staged".
      var p = await sb().from('wh_pallets').select('id,pallet_tag,location,status,current_transfer_id').eq('id', palletId).limit(1);
      if(!p.error && p.data && p.data[0] && p.data[0].location === 'good_liquid' && !p.data[0].current_transfer_id &&
         confirm('Also void pallet ' + p.data[0].pallet_tag + '? Choose Cancel to keep it for another transfer.')){
        checked(await sb().from('wh_pallets').update({ status: 'void' }).eq('id', palletId).select('id'), 1, 'Void');
      }
      reopen(transferId);
    } catch(e){ alert('Remove failed: ' + errMsg(e)); }
  }

  // ── Quick build ────────────────────────────────────────────
  async function quickBuild(transferId){
    var d = await loadTransfer(transferId), t = d.t;
    var wantType = INV_TYPE[t.type] || 'finished_good';
    var sq = sb().from('wh_skus').select(SKU_COLS);
    sq = t.client_id ? sq.eq('client_id', t.client_id) : sq.is('client_id', null);
    var sr = await sq.eq('active', true).eq('inventory_type', wantType).order('description');
    if(sr.error){ alert(errMsg(sr.error)); return; }
    var skus = sr.data || [];
    var ov = overlay('wh-quick', '⚡ QUICK BUILD PALLETS', 620);
    var who = '<div style="font-size:13px;margin-bottom:10px">Client: <b style="color:var(--teal)">' + esc(ownerName(t.client)) + '</b> · ' +
      esc(TYPE_LABEL[wantType]) + '</div>';
    if(!skus.length){
      ovBody(ov, who + note('warn', (t.client_id ? 'This client has' : 'Good Liquid has') + ' no ' + TYPE_LABEL[wantType].toLowerCase() + ' items yet. Add one, then build the pallets.') +
        '<button type="button" class="cbtn pri" id="wqb-newsku">+ New ' + esc(TYPE_LABEL[wantType].toLowerCase()) + ' item for ' + esc(ownerName(t.client)) + '</button>');
      ov.querySelector('#wqb-newsku').addEventListener('click', function(){
        ov.remove();
        editSku(null, { owner: t.client_id || GL_OWNER, type: wantType }, function(){ quickBuild(transferId); });
      });
      return;
    }
    ovBody(ov, who + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
        field('SKU *', '<select id="wqb-sku" style="' + INP + '">' + skus.map(function(s){
          return '<option value="' + esc(s.id) + '">' + esc(s.upc_sku + ' · ' + s.description) + '</option>'; }).join('') + '</select>', true) +
        field('Lot' + (wantType === 'finished_good' ? ' *' : ''), '<select id="wqb-lot" style="' + INP + '"></select>') +
        field('New lot number (optional)', '<input id="wqb-newlot" placeholder="adds a lot on QA hold" style="' + INP + '">') +
        field('Pallet count *', '<input id="wqb-count" type="number" min="1" max="60" value="1" style="' + INP + '">') +
        field('Cases per pallet *', '<input id="wqb-cases" type="number" min="1" style="' + INP + '">') +
        field('Weight per pallet (lbs)', '<input id="wqb-weight" type="number" min="1" step="any" style="' + INP + '">') +
        field('Height (in)', '<input id="wqb-height" type="number" min="1" step="any" style="' + INP + '">') +
        (wantType === 'empty_can' ? field('Expected pull date', '<input id="wqb-pull" type="date" style="' + INP + '">', true) : '') +
        field('Note (goes on every pallet built here; edit one pallet later with ✏️)',
          '<textarea id="wqb-note" rows="2" maxlength="' + NOTE_MAX + '" placeholder="e.g. 12oz sleek, for the Friday run" style="' + INP + '"></textarea>', true) +
      '</div><div id="wqb-hint"></div>' +
      '<div style="display:flex;gap:10px;margin-top:14px"><button type="button" class="cbtn" data-wh="closeOverlay" style="flex:1;justify-content:center">Cancel</button>' +
      '<button type="button" class="cbtn pri" id="wqb-save" style="flex:1;justify-content:center">Create pallets</button></div>');

    var lotsBySku = {};
    async function loadLots(){
      var skuId = val(ov,'#wqb-sku');
      var s = skus.filter(function(x){ return x.id === skuId; })[0] || {};
      if(!lotsBySku[skuId]){
        var lr = await sb().from('wh_lots').select(LOT_COLS).eq('sku_id', skuId).order('production_date', { ascending: false });
        lotsBySku[skuId] = lr.error ? [] : (lr.data || []);
      }
      var lots = lotsBySku[skuId];
      ov.querySelector('#wqb-lot').innerHTML = '<option value="">' + (wantType === 'finished_good' ? 'Choose a lot…' : '(no lot)') + '</option>' +
        lots.map(function(l){
          return '<option value="' + esc(l.id) + '">' + esc(l.lot_number + ' · ' + (l.qa_status === 'released' ? 'released' : 'QA HOLD') +
            (l.best_by_date ? ' · BB ' + fmtDate(l.best_by_date) : '')) + '</option>';
        }).join('');
      ov.querySelector('#wqb-cases').value = s.default_cases_per_pallet || '';
      ov.querySelector('#wqb-weight').value = s.default_pallet_weight_lbs || '';
      ov.querySelector('#wqb-height').value = s.default_pallet_height_in || '';
      var hint = [];
      if(!s.last_exported_at) hint.push(note('warn','This SKU has never been exported to CONRI; export it before scheduling.'));
      var uw = upcWarning(s.upc_sku, s.inventory_type); if(uw) hint.push(note('warn', uw));
      ov.querySelector('#wqb-hint').innerHTML = hint.join('');
    }
    ov.querySelector('#wqb-sku').addEventListener('change', loadLots);
    await loadLots();

    ov.querySelector('#wqb-save').addEventListener('click', async function(){
      var btn = this;
      var skuId = val(ov,'#wqb-sku');
      var lotId = val(ov,'#wqb-lot');
      var newLot = val(ov,'#wqb-newlot');
      var count = parseInt(val(ov,'#wqb-count'), 10);
      var cases = parseInt(val(ov,'#wqb-cases'), 10);
      var weight = val(ov,'#wqb-weight'), height = val(ov,'#wqb-height');
      if(!(count >= 1 && count <= 60)){ ovMsg(ov,'err','Pallet count must be 1 to 60.'); return; }
      if(!(cases >= 1)){ ovMsg(ov,'err','Cases per pallet is required.'); return; }
      if(newLot && lotId){ ovMsg(ov,'err','Pick an existing lot OR type a new one, not both.'); return; }
      if(wantType === 'finished_good' && !lotId && !newLot){ ovMsg(ov,'err','Finished goods need a lot.'); return; }
      if(newLot && wantType === 'finished_good'){
        ovMsg(ov,'err','A new lot starts on QA hold and cannot go to CONRI. Add it in SKU master, release it, then build.');
        return;
      }
      if(lotId && wantType === 'finished_good'){
        var lot = (lotsBySku[skuId] || []).filter(function(l){ return l.id === lotId; })[0];
        if(lot && lot.qa_status !== 'released'){ ovMsg(ov,'err','Lot ' + lot.lot_number + ' is on QA HOLD. Release it in SKU master first.'); return; }
      }
      if(height && num(height) >= RACK_MAX_IN && wantType !== 'empty_can' &&
         !confirm('Height ' + height + '" is not under ' + RACK_MAX_IN + '". CONRI cannot rack it. Build anyway?')) return;

      btn.disabled = true; ovMsg(ov,'','Creating ' + count + ' pallets…');
      var created = [];
      try {
        if(newLot){
          var nl = checked(await sb().from('wh_lots').insert({ sku_id: skuId, lot_number: newLot }).select('id'), 1, 'Add lot');
          lotId = nl[0].id;
        }
        var pRows = [];
        for(var i = 0; i < count; i++){
          pRows.push({
            sku_id: skuId, lot_id: lotId || null, cases: cases,
            weight_lbs: weight ? num(weight) : null, height_in: height ? num(height) : null,
            expected_pull_date: val(ov,'#wqb-pull') || null,
            notes: cleanNote(ov.querySelector('#wqb-note').value)
          });
        }
        created = checked(await sb().from('wh_pallets').insert(pRows).select('id,pallet_tag').order('pallet_tag'), count, 'Create pallets');
        var start = d.lines.reduce(function(m, p){ return Math.max(m, num(p.line_no)); }, 0);
        var lRows = created.map(function(p, i){ return { transfer_id: transferId, pallet_id: p.id, line_no: start + i + 1 }; });
        checked(await sb().from('wh_transfer_lines').insert(lRows).select('pallet_id'), count, 'Add pallets to transfer');
        audit('wh_pallets_built', t.transfer_number, { count: count, cases: cases });
        ov.remove(); reopen(transferId);
      } catch(e){
        // Pallets made but not attached would sit as "staged" forever. Void them.
        if(created.length){
          try { await sb().from('wh_pallets').update({ status: 'void' }).in('id', created.map(function(p){ return p.id; })).is('current_transfer_id', null).select('id'); } catch(_){}
        }
        btn.disabled = false; ovMsg(ov,'err','Failed: ' + errMsg(e));
      }
    });
  }

  // ── Pick existing pallets ──────────────────────────────────
  async function pickPallets(transferId){
    var d = await loadTransfer(transferId), t = d.t;
    var loc = (t.type === 'pull_back' || t.type === 'outbound_pickup') ? 'conri' : 'good_liquid';
    var r = await sb().from('wh_pallets').select(PALLET_EMBED).eq('location', loc).is('current_transfer_id', null).not('status','in','(void,shipped)');
    if(r.error){ alert(errMsg(r.error)); return; }
    var wantType = INV_TYPE[t.type] || null;
    // client_id is null on both sides for Good Liquid's own stock.
    var list = (r.data || []).filter(function(p){
      return p.sku && (p.sku.client_id || null) === (t.client_id || null) && (!wantType || p.sku.inventory_type === wantType);
    });
    sortFefo(list);
    var ov = overlay('wh-pick', '☑ PICK PALLETS · ' + (loc === 'conri' ? 'AT CONRI' : 'AT GOOD LIQUID'), 760);
    if(!list.length){ ovBody(ov, note('', 'No available pallets for ' + (t.client_id ? 'this client' : 'Good Liquid packaging') + ' ' + (loc === 'conri' ? 'at CONRI.' : 'at Good Liquid.'))); return; }
    ovBody(ov, '<div style="font-size:12px;color:#9aa7bd;margin-bottom:8px">Sorted FEFO: earliest best by first, then first received.</div>' +
      '<div style="max-height:52vh;overflow:auto"><table class="ctbl"><tr><th></th><th>Tag</th><th>SKU</th><th>Lot</th><th>Best by</th><th style="text-align:right">Cases</th><th>Received</th><th>Note</th></tr>' +
      list.map(function(p){
        return '<tr><td><input type="checkbox" class="wpk" value="' + esc(p.id) + '"></td><td>' + esc(p.pallet_tag) + '</td>' +
          '<td>' + esc(p.sku.upc_sku + ' · ' + p.sku.description) + '</td><td>' + esc(p.lot ? p.lot.lot_number : '') +
          (p.lot && p.lot.qa_status !== 'released' ? ' ' + badge('hold') : '') + '</td>' +
          '<td>' + esc(fmtDate(p.lot && p.lot.best_by_date)) + '</td><td style="text-align:right">' + fmtInt(p.cases) + '</td>' +
          '<td>' + esc(fmtTs(p.received_at_conri)) + '</td><td>' + esc(p.notes || '') + '</td></tr>';
      }).join('') + '</table></div>' +
      '<div style="display:flex;gap:10px;margin-top:14px"><button type="button" class="cbtn" data-wh="closeOverlay" style="flex:1;justify-content:center">Cancel</button>' +
      '<button type="button" class="cbtn pri" id="wpk-save" style="flex:1;justify-content:center">Add selected</button></div>');
    ov.querySelector('#wpk-save').addEventListener('click', async function(){
      var ids = Array.prototype.map.call(ov.querySelectorAll('.wpk:checked'), function(c){ return c.value; });
      if(!ids.length){ ovMsg(ov,'err','Select at least one pallet.'); return; }
      var btn = this; btn.disabled = true; ovMsg(ov,'','Adding…');
      try {
        var start = d.lines.reduce(function(m, p){ return Math.max(m, num(p.line_no)); }, 0);
        checked(await sb().from('wh_transfer_lines').insert(ids.map(function(id, i){
          return { transfer_id: transferId, pallet_id: id, line_no: start + i + 1 };
        })).select('pallet_id'), ids.length, 'Add pallets');
        ov.remove(); reopen(transferId);
      } catch(e){ btn.disabled = false; ovMsg(ov,'err','Failed: ' + errMsg(e)); }
    });
  }

  // FEFO: earliest best-by first (pallets without one last), then FIFO by the
  // day they reached CONRI, then tag for a stable order.
  function sortFefo(list){
    list.sort(function(a, b){
      var ab = (a.lot && a.lot.best_by_date) || '9999-12-31', bb = (b.lot && b.lot.best_by_date) || '9999-12-31';
      if(ab !== bb) return ab < bb ? -1 : 1;
      var ar = a.received_at_conri || '9999', br = b.received_at_conri || '9999';
      if(ar !== br) return ar < br ? -1 : 1;
      return String(a.pallet_tag).localeCompare(String(b.pallet_tag));
    });
    return list;
  }

  // ── Complete ───────────────────────────────────────────────
  async function completeTransfer(id){
    var d = await loadTransfer(id), t = d.t;
    var totC = d.lines.reduce(function(s, p){ return s + num(p.cases); }, 0);
    var who = t.type === 'outbound_pickup' ? 'Driver / carrier name' : t.type === 'pull_back' ? 'Received at Good Liquid by' : 'Received by (CONRI)';
    var ov = overlay('wh-complete', '✓ COMPLETE ' + t.transfer_number);
    ovBody(ov, '<div style="font-size:12px;color:#9aa7bd;margin-bottom:10px">Record what was actually received. Completing moves all ' + d.lines.length +
        ' pallets and writes the movement log; it cannot be undone.</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
        field('Pallets received *', '<input id="wc-p" type="number" min="0" value="' + d.lines.length + '" style="' + INP + '">') +
        field('Cases received *', '<input id="wc-c" type="number" min="0" value="' + totC + '" style="' + INP + '">') +
        field(who + ' *', '<input id="wc-by" style="' + INP + '">', true) +
        field('Condition *', '<select id="wc-cond" style="' + INP + '"><option value="good">Good</option><option value="exceptions">Exceptions noted</option></select>', true) +
        field('Exceptions', '<textarea id="wc-exc" rows="2" style="' + INP + '"></textarea>', true) +
        field('Signed packing list (PDF or photo, optional)', '<input id="wc-file" type="file" accept="application/pdf,image/*" style="' + INP + '">', true) +
      '</div>' +
      '<div style="display:flex;gap:10px;margin-top:14px"><button type="button" class="cbtn" data-wh="closeOverlay" style="flex:1;justify-content:center">Cancel</button>' +
      '<button type="button" class="cbtn grn" id="wc-save" style="flex:1;justify-content:center">Complete transfer</button></div>');
    ov.querySelector('#wc-save').addEventListener('click', async function(){
      var btn = this;
      var p = parseInt(val(ov,'#wc-p'),10), c = parseInt(val(ov,'#wc-c'),10);
      var by = val(ov,'#wc-by'), cond = val(ov,'#wc-cond'), exc = val(ov,'#wc-exc');
      if(!(p >= 0) || !(c >= 0)){ ovMsg(ov,'err','Enter pallets and cases received.'); return; }
      if(!by){ ovMsg(ov,'err','Enter who received it.'); return; }
      if(cond === 'exceptions' && !exc){ ovMsg(ov,'err','Describe the exceptions.'); return; }
      if((p !== d.lines.length || c !== totC) && cond !== 'exceptions'){
        ovMsg(ov,'err','Counts differ from the packing list (' + d.lines.length + ' pallets, ' + totC + ' cases). Mark "Exceptions noted" and describe it.');
        return;
      }
      btn.disabled = true; ovMsg(ov,'','Completing…');
      try {
        var file = ov.querySelector('#wc-file').files[0];
        var path = file ? await uploadSigned(t, file) : null;
        var patch = { status: 'completed', pallets_received: p, cases_received: c, received_by: by, receipt_condition: cond, exceptions: exc || null };
        if(path) patch.signed_doc_path = path;
        var rows = checked(await sb().from('wh_transfers').update(patch).eq('id', id).select('id,status'), 1, 'Complete');
        if(rows[0].status !== 'completed') throw new Error('Server did not complete the transfer.');
        audit('wh_transfer_completed', t.transfer_number, { pallets: p, cases: c, condition: cond });
        ov.remove(); reopen(id);
      } catch(e){ btn.disabled = false; ovMsg(ov,'err','Could not complete: ' + errMsg(e)); }
    });
  }

  async function uploadSigned(t, file){
    if(file.size > 25 * 1024 * 1024) throw new Error('File is over 25 MB.');
    var safe = String(file.name || 'signed').replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80);
    var path = 'transfers/' + t.id + '/' + Date.now() + '-' + safe;
    var up = await sb().storage.from('warehouse-docs').upload(path, file, { upsert: false, contentType: file.type || 'application/octet-stream' });
    if(up.error) throw up.error;
    return path;
  }

  function uploadSignedAfter(id){
    var ov = overlay('wh-upload', '📎 SIGNED PACKING LIST');
    ovBody(ov, field('PDF or photo', '<input id="wu-file" type="file" accept="application/pdf,image/*" style="' + INP + '">', true) +
      '<div style="display:flex;gap:10px;margin-top:14px"><button type="button" class="cbtn" data-wh="closeOverlay" style="flex:1;justify-content:center">Cancel</button>' +
      '<button type="button" class="cbtn pri" id="wu-save" style="flex:1;justify-content:center">Upload</button></div>');
    ov.querySelector('#wu-save').addEventListener('click', async function(){
      var btn = this, file = ov.querySelector('#wu-file').files[0];
      if(!file){ ovMsg(ov,'err','Choose a file.'); return; }
      btn.disabled = true; ovMsg(ov,'','Uploading…');
      try {
        var d = await loadTransfer(id);
        var path = await uploadSigned(d.t, file);
        checked(await sb().from('wh_transfers').update({ signed_doc_path: path }).eq('id', id).select('id'), 1, 'Attach');
        ov.remove(); reopen(id);
      } catch(e){ btn.disabled = false; ovMsg(ov,'err','Upload failed: ' + errMsg(e)); }
    });
  }

  async function viewSigned(id){
    try {
      var d = await loadTransfer(id);
      if(!d.t.signed_doc_path) return;
      // Private bucket: a short-lived signed URL, never a public one.
      var r = await sb().storage.from('warehouse-docs').createSignedUrl(d.t.signed_doc_path, 300);
      if(r.error) throw r.error;
      window.open(r.data.signedUrl, '_blank', 'noopener');
    } catch(e){ alert('Could not open: ' + errMsg(e)); }
  }

  // ── Scheduling email ───────────────────────────────────────
  function scheduleEmailText(t, lines){
    var bySku = {};
    var heights = [], weights = [];
    lines.forEach(function(p){
      var s = p.sku || {}, key = s.upc_sku + '|' + (p.lot ? p.lot.lot_number : '');
      var n = bySku[key] = bySku[key] || { s: s, lot: p.lot, pallets: 0, cases: 0 };
      n.pallets++; n.cases += num(p.cases);
      var h = num(p.height_in || s.default_pallet_height_in); if(h) heights.push(h);
      if(p.weight_lbs) weights.push(num(p.weight_lbs));
    });
    var totC = lines.reduce(function(s, p){ return s + num(p.cases); }, 0);
    var when = t.scheduled_at ? new Date(t.scheduled_at) : null;
    var dateStr = when ? when.toLocaleDateString('en-US', { weekday:'long', month:'2-digit', day:'2-digit', year:'numeric' }) : 'TBD';
    var timeStr = when ? when.toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit' }) : 'TBD';
    var client = ownerName(t.client);
    var verb = {
      to_conri_finished: 'Inbound to CONRI: finished goods (rack, FEFO by best by date)',
      to_conri_overflow: 'Inbound to CONRI: empty can overflow (floor stack; returns for production)',
      to_conri_packaging: 'Inbound to CONRI: Good Liquid packaging supplies',
      pull_back: 'Pull back to Good Liquid',
      outbound_pickup: 'Outbound carrier pickup from CONRI'
    }[t.type];
    var maxH = heights.length ? Math.max.apply(null, heights) : null;
    var wRange = weights.length ? (Math.min.apply(null, weights) === Math.max.apply(null, weights)
      ? fmtInt(weights[0]) + ' lbs each' : fmtInt(Math.min.apply(null, weights)) + ' to ' + fmtInt(Math.max.apply(null, weights)) + ' lbs') : 'about 2,000 lbs each';
    var skuLines = Object.keys(bySku).map(function(k){
      var n = bySku[k];
      return '  - ' + n.s.upc_sku + '  ' + n.s.description + (n.s.pack ? ' (' + n.s.pack + ')' : '') +
        (n.lot ? ', lot ' + n.lot.lot_number + (n.lot.best_by_date ? ', best by ' + fmtDate(n.lot.best_by_date) : '') : '') +
        ': ' + n.pallets + ' pallets, ' + fmtInt(n.cases) + ' cases';
    }).join('\n');
    var noteLines = lines.filter(function(p){ return p.notes; }).map(function(p){
      return '  - ' + p.pallet_tag + ': ' + String(p.notes).replace(/\s*\n\s*/g, ' ');
    }).join('\n');
    var subject = 'Schedule ' + t.transfer_number + ': ' + lines.length + ' pallets, ' + client + ', ' + (when ? fmtDate(toLocalInput(t.scheduled_at).slice(0,10)) : 'date TBD');
    var bodyTxt =
      'Hi Paul,\n\n' +
      'Please schedule the following for the Good Liquid Bev Co account.\n\n' +
      'Transfer: ' + t.transfer_number + '\n' +
      'Move: ' + verb + '\n' +
      'Date: ' + dateStr + '\n' +
      'Time: ' + timeStr + '\n' +
      'Client / brand: ' + client + '\n' +
      'Pallets: ' + lines.length + '\n' +
      'Total cases: ' + fmtInt(totC) + '\n' +
      (t.carrier ? 'Carrier: ' + t.carrier + '\n' : '') +
      (t.ship_to ? 'Ship to: ' + t.ship_to.replace(/\n/g, ', ') + '\n' : '') +
      '\nSKUs:\n' + skuLines + '\n\n' +
      (noteLines ? 'Pallet notes:\n' + noteLines + '\n\n' : '') +
      'Pallet dimensions: ' + PALLET_FOOTPRINT + ' footprint, ' + (maxH ? 'up to ' + maxH + ' in tall' : 'height to confirm') +
        (t.type === 'to_conri_overflow' ? ' (empty cans, floor stack)' : '') + ', ' + wRange + '.\n\n' +
      'Packing list and pallet labels will travel with the load.\n\n' +
      'Thanks,\n' + (userName() || GL.contact) + '\n' + GL.name + '\n' + GL.phone;
    return { to: CONRI.email, subject: subject, body: bodyTxt };
  }

  async function schedEmail(id){
    var d = await loadTransfer(id);
    var m = scheduleEmailText(d.t, d.lines);
    var ov = overlay('wh-email', '✉ SCHEDULING EMAIL', 680);
    var href = 'mailto:' + encodeURIComponent(m.to) + '?subject=' + encodeURIComponent(m.subject) + '&body=' + encodeURIComponent(m.body);
    ovBody(ov, '<div style="font-size:12px;color:#9aa7bd">To: ' + esc(m.to) + '</div>' +
      '<div style="font-size:12px;color:#9aa7bd;margin:4px 0 8px">Subject: ' + esc(m.subject) + '</div>' +
      '<textarea id="wem-body" rows="18" style="' + INP + ';font-family:ui-monospace,monospace;font-size:12px">' + esc(m.body) + '</textarea>' +
      '<div style="display:flex;gap:10px;margin-top:14px">' +
        '<button type="button" class="cbtn" id="wem-copy" style="flex:1;justify-content:center">Copy text</button>' +
        '<a class="cbtn pri" id="wem-open" href="' + esc(href) + '" style="flex:1;justify-content:center;text-decoration:none">Open in mail app</a></div>');
    ov.querySelector('#wem-copy').addEventListener('click', function(){
      var txt = 'To: ' + m.to + '\nSubject: ' + m.subject + '\n\n' + ov.querySelector('#wem-body').value;
      try { navigator.clipboard.writeText(txt).then(function(){ ovMsg(ov,'ok','Copied.'); }); } catch(e){ ovMsg(ov,'err','Copy failed; select the text instead.'); }
    });
    // Edits in the box travel with the mailto link.
    ov.querySelector('#wem-body').addEventListener('input', function(){
      ov.querySelector('#wem-open').setAttribute('href', 'mailto:' + encodeURIComponent(m.to) + '?subject=' + encodeURIComponent(m.subject) + '&body=' + encodeURIComponent(this.value));
    });
  }

  // ════════════════════════════════════════════════════════════
  // 4. SKU MASTER (+ lots)
  // ════════════════════════════════════════════════════════════
  async function renderSkus(){
    var q = sb().from('wh_skus').select(SKU_COLS + ',client:clients!wh_skus_client_id_fkey(name)').order('description');
    q = skuOwnerFilter(q);
    var r = await q;
    if(r.error) throw r.error;
    var skus = r.data || [];
    var lotsBy = {};
    if(skus.length){
      var lr = await sb().from('wh_lots').select(LOT_COLS).in('sku_id', skus.map(function(s){ return s.id; })).order('production_date', { ascending: false });
      if(lr.error) throw lr.error;
      (lr.data || []).forEach(function(l){ (lotsBy[l.sku_id] = lotsBy[l.sku_id] || []).push(l); });
    }
    var rows = skus.map(function(s){
      var lots = lotsBy[s.id] || [];
      var uw = upcWarning(s.upc_sku, s.inventory_type);
      return '<tr' + (s.active ? '' : ' style="opacity:.5"') + '><td style="font-weight:700">' + esc(s.upc_sku) +
          (uw ? ' <span title="' + esc(uw) + '" style="color:#f5c842">⚠</span>' : '') + '</td>' +
        '<td>' + esc(s.description) + '</td><td>' + esc(s.brand || ownerName(s.client)) + '</td><td>' + esc(s.pack) + '</td>' +
        '<td style="text-align:right">' + esc(s.units_per_case || '') + '</td><td style="text-align:right">' + esc(s.default_cases_per_pallet || '') + '</td>' +
        '<td>' + esc(TYPE_LABEL[s.inventory_type] || s.inventory_type) + '</td>' +
        '<td>' + (s.last_exported_at ? esc(fmtTs(s.last_exported_at)) : '<span style="color:#f5c842">never</span>') + '</td>' +
        '<td style="white-space:nowrap"><button type="button" class="cbtn" data-wh="editSku" data-arg="' + esc(s.id) + '">Edit</button> ' +
          '<button type="button" class="cbtn" data-wh="addLot" data-arg="' + esc(s.id) + '">+ Lot</button></td></tr>' +
        (lots.length ? '<tr><td></td><td colspan="8" style="padding-top:0">' + lots.map(function(l){
          return '<span style="display:inline-flex;gap:6px;align-items:center;margin:0 10px 6px 0;font-size:11.5px;color:#dfe7f1;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:20px;padding:3px 6px 3px 11px">' +
            'Lot ' + esc(l.lot_number) + (l.best_by_date ? ' · BB ' + esc(fmtDate(l.best_by_date)) : '') + ' ' + badge(l.qa_status) +
            '<button type="button" class="cbtn" style="padding:2px 8px;font-size:10.5px" data-wh="toggleLot" data-arg="' + esc(l.id) + '" data-arg2="' + esc(l.qa_status) + '">' +
              (l.qa_status === 'released' ? 'Put on hold' : 'QA release') + '</button></span>';
        }).join('') + '</td></tr>' : '');
    }).join('');
    setBody('<div class="ccard"><div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px">' +
        '<select id="wh-sku-client" style="' + INP + ';max-width:260px">' + clientOptions(state.skuClient, 'All owners', true) + '</select>' +
        '<button type="button" class="cbtn pri" data-wh="newSku">+ New SKU</button>' +
        '<button type="button" class="cbtn" data-wh="exportSkus">⬇ Export CSV for CONRI</button>' +
        '<span style="font-size:11.5px;color:#9aa7bd">Exports active SKUs' + (state.skuClient ? ' for this client' : '') + ' and stamps them as sent to CONRI.</span></div>' +
      (rows ? '<div style="overflow-x:auto"><table class="ctbl"><tr><th>UPC / SKU</th><th>Description</th><th>Brand</th><th>Pack</th><th style="text-align:right">Units/case</th><th style="text-align:right">Cases/pallet</th><th>Type</th><th>Sent to CONRI</th><th></th></tr>' + rows + '</table></div>'
            : '<div style="color:#9aa7bd;font-size:12px">No SKUs yet.</div>') + '</div>');
    var sel = document.getElementById('wh-sku-client');
    if(sel) sel.addEventListener('change', function(){ state.skuClient = this.value; renderTab(); });
  }

  function skuOwnerFilter(q){
    if(state.skuClient === GL_OWNER) return q.is('client_id', null);
    return state.skuClient ? q.eq('client_id', state.skuClient) : q;
  }

  // preset {owner, type} prefills a new SKU; onSaved replaces the page refresh
  // (quick build uses it to come straight back once the item exists).
  async function editSku(id, preset, onSaved){
    var s = {};
    if(id){
      var r = await sb().from('wh_skus').select(SKU_COLS).eq('id', id).limit(1);
      if(r.error || !r.data || !r.data[0]){ alert('Could not load SKU.'); return; }
      s = r.data[0];
    }
    var ov = overlay('wh-sku', id ? 'EDIT SKU' : '+ NEW SKU', 620);
    ovBody(ov, '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
        field('Owner *', '<select id="ws-client" style="' + INP + '"' + (id ? ' disabled' : '') + '>' +
          clientOptions(id ? (s.client_id || GL_OWNER) : (preset && preset.owner) || state.skuClient, null, true) + '</select>', true) +
        field('UPC / SKU *', '<input id="ws-upc" value="' + esc(s.upc_sku || '') + '" style="' + INP + '">') +
        field('Inventory type *', '<select id="ws-type" style="' + INP + '">' + Object.keys(TYPE_LABEL).map(function(k){
          return '<option value="' + k + '"' + (s.inventory_type === k ? ' selected' : '') + '>' + esc(TYPE_LABEL[k]) + '</option>'; }).join('') + '</select>') +
        field('Description *', '<input id="ws-desc" value="' + esc(s.description || '') + '" style="' + INP + '">', true) +
        field('Brand', '<input id="ws-brand" value="' + esc(s.brand || '') + '" style="' + INP + '">') +
        field('Pack', '<input id="ws-pack" placeholder="12 count tray" value="' + esc(s.pack || '') + '" style="' + INP + '">') +
        field('Units per case', '<input id="ws-upc-n" type="number" min="1" value="' + esc(s.units_per_case || '') + '" style="' + INP + '">') +
        field('Default cases per pallet', '<input id="ws-cpp" type="number" min="1" value="' + esc(s.default_cases_per_pallet || '') + '" style="' + INP + '">') +
        field('Default pallet weight (lbs)', '<input id="ws-w" type="number" min="1" step="any" value="' + esc(s.default_pallet_weight_lbs || '') + '" style="' + INP + '">') +
        field('Default pallet height (in)', '<input id="ws-h" type="number" min="1" step="any" value="' + esc(s.default_pallet_height_in || '') + '" style="' + INP + '">') +
        field('Notes', '<textarea id="ws-notes" rows="2" style="' + INP + '">' + esc(s.notes || '') + '</textarea>', true) +
        (id ? field('Active', '<select id="ws-active" style="' + INP + '"><option value="1">Active</option><option value="0"' + (s.active === false ? ' selected' : '') + '>Inactive</option></select>') : '') +
      '</div><div id="ws-hint"></div>' +
      '<div style="display:flex;gap:10px;margin-top:14px"><button type="button" class="cbtn" data-wh="closeOverlay" style="flex:1;justify-content:center">Cancel</button>' +
      '<button type="button" class="cbtn pri" id="ws-save" style="flex:1;justify-content:center">Save SKU</button></div>');
    var upcEl = ov.querySelector('#ws-upc');
    var hint = function(){ var w = upcWarning(upcEl.value, ov.querySelector('#ws-type').value); ov.querySelector('#ws-hint').innerHTML = w ? note('warn', w) : ''; };
    upcEl.addEventListener('input', hint); ov.querySelector('#ws-type').addEventListener('change', hint); hint();
    // Packaging and Good Liquid ownership go together (wh_skus_packaging_owner_check),
    // so picking one sets the other on a new SKU.
    var ownSel = ov.querySelector('#ws-client'), typeSel = ov.querySelector('#ws-type');
    if(!id){
      if(preset && preset.type) typeSel.value = preset.type;
      if(ownSel.value === GL_OWNER) typeSel.value = 'packaging';
      ownSel.addEventListener('change', function(){
        if(ownSel.value === GL_OWNER) typeSel.value = 'packaging';
        else if(typeSel.value === 'packaging') typeSel.value = 'finished_good';
      });
      typeSel.addEventListener('change', function(){
        if(typeSel.value === 'packaging') ownSel.value = GL_OWNER;
        else if(ownSel.value === GL_OWNER) ownSel.value = '';
      });
    }
    ov.querySelector('#ws-save').addEventListener('click', async function(){
      var btn = this;
      var n = function(sel){ var v = val(ov, sel); return v === '' ? null : num(v); };
      var row = {
        upc_sku: val(ov,'#ws-upc'), description: val(ov,'#ws-desc'),
        brand: val(ov,'#ws-brand') || null, pack: val(ov,'#ws-pack') || null,
        units_per_case: n('#ws-upc-n'), default_cases_per_pallet: n('#ws-cpp'),
        default_pallet_weight_lbs: n('#ws-w'), default_pallet_height_in: n('#ws-h'),
        inventory_type: val(ov,'#ws-type'), notes: val(ov,'#ws-notes') || null
      };
      var owner = id ? (s.client_id || GL_OWNER) : val(ov,'#ws-client');
      if(!id) row.client_id = ownerId(owner);
      else row.active = val(ov,'#ws-active') !== '0';
      if(!owner){ ovMsg(ov,'err','Choose the owner.'); return; }
      if((owner === GL_OWNER) !== (row.inventory_type === 'packaging')){
        ovMsg(ov,'err', owner === GL_OWNER ? 'Good Liquid\'s own SKUs are packaging.' : 'Packaging belongs to Good Liquid, not a client.'); return;
      }
      if(!row.upc_sku || !row.description){ ovMsg(ov,'err','UPC / SKU and description are required.'); return; }
      // A SKU CONRI already has on file and whose keyed fields change must be
      // sent again: clear the stamp so scheduling asks for a fresh export.
      if(id && (row.upc_sku !== s.upc_sku || row.units_per_case !== s.units_per_case || row.description !== s.description)) row.last_exported_at = null;
      btn.disabled = true; ovMsg(ov,'','Saving…');
      try {
        if(id) checked(await sb().from('wh_skus').update(row).eq('id', id).select('id'), 1, 'Update SKU');
        else checked(await sb().from('wh_skus').insert(row).select('id'), 1, 'Add SKU');
        audit(id ? 'wh_sku_updated' : 'wh_sku_created', row.upc_sku, {});
        ov.remove();
        if(onSaved) onSaved(); else renderTab();
      } catch(e){ btn.disabled = false; ovMsg(ov,'err','Save failed: ' + errMsg(e)); }
    });
  }

  function addLot(skuId){
    var ov = overlay('wh-lot', '+ NEW LOT');
    ovBody(ov, '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
        field('Lot number *', '<input id="wl-num" style="' + INP + '">', true) +
        field('Production date', '<input id="wl-prod" type="date" style="' + INP + '">') +
        field('Best by date', '<input id="wl-bb" type="date" style="' + INP + '">') +
        field('QA status', '<select id="wl-qa" style="' + INP + '"><option value="hold">Hold</option><option value="released">Released</option></select>', true) +
      '</div>' +
      '<div style="display:flex;gap:10px;margin-top:14px"><button type="button" class="cbtn" data-wh="closeOverlay" style="flex:1;justify-content:center">Cancel</button>' +
      '<button type="button" class="cbtn pri" id="wl-save" style="flex:1;justify-content:center">Save lot</button></div>');
    ov.querySelector('#wl-save').addEventListener('click', async function(){
      var btn = this, lot = val(ov,'#wl-num');
      if(!lot){ ovMsg(ov,'err','Lot number is required.'); return; }
      btn.disabled = true;
      try {
        checked(await sb().from('wh_lots').insert({ sku_id: skuId, lot_number: lot, production_date: val(ov,'#wl-prod') || null,
          best_by_date: val(ov,'#wl-bb') || null, qa_status: val(ov,'#wl-qa') }).select('id'), 1, 'Add lot');
        audit('wh_lot_created', lot, { qa: val(ov,'#wl-qa') });
        ov.remove(); renderTab();
      } catch(e){ btn.disabled = false; ovMsg(ov,'err','Save failed: ' + errMsg(e)); }
    });
  }

  async function toggleLot(lotId, current){
    var next = current === 'released' ? 'hold' : 'released';
    if(!confirm(next === 'released' ? 'QA release this lot? It can then go to CONRI.' : 'Put this lot on QA hold? It will be blocked from transfers to CONRI.')) return;
    try {
      var rows = checked(await sb().from('wh_lots').update({ qa_status: next }).eq('id', lotId).select('id,lot_number'), 1, 'QA status');
      audit('wh_lot_' + next, rows[0].lot_number, { by: userName() });
      renderTab();
    } catch(e){ alert('Failed: ' + errMsg(e)); }
  }

  // CSV for CONRI's WMS. Formula-leading cells are neutralised so a
  // description like "=HYPERLINK(...)" cannot execute when opened in Excel.
  function csvCell(v){
    var s = String(v == null ? '' : v);
    if(/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function skuCsv(skus){
    var head = ['SKU/Item Number','Description','Brand/Customer','Case Pack','Cases per Pallet','Pallet Weight (lbs)','Inventory Type'];
    var lines = [head.map(csvCell).join(',')];
    skus.forEach(function(s){
      lines.push([
        s.upc_sku, s.description, s.brand || (s.client && s.client.name) || (s.inventory_type === 'packaging' ? 'Good Liquid Bev Co' : ''),
        s.units_per_case || '', s.default_cases_per_pallet || '', s.default_pallet_weight_lbs || '',
        s.inventory_type === 'empty_can' ? 'Empty Cans' : s.inventory_type === 'packaging' ? 'Packaging' : 'Finished Good'
      ].map(csvCell).join(','));
    });
    return lines.join('\r\n') + '\r\n';
  }
  function download(name, text, type){
    var blob = new Blob([text], { type: type || 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  async function exportSkus(){
    try {
      var q = skuOwnerFilter(sb().from('wh_skus').select(SKU_COLS + ',client:clients!wh_skus_client_id_fkey(name)').eq('active', true).order('description'));
      var r = await q; if(r.error) throw r.error;
      var skus = r.data || [];
      if(!skus.length){ alert('No active SKUs to export.'); return; }
      download('GoodLiquid_SKUs_for_CONRI_' + todayISO() + '.csv', skuCsv(skus));
      checked(await sb().from('wh_skus').update({ last_exported_at: new Date().toISOString() })
        .in('id', skus.map(function(s){ return s.id; })).select('id'), skus.length, 'Stamp export');
      audit('wh_skus_exported', String(skus.length), {});
      renderTab();
    } catch(e){ alert('Export failed: ' + errMsg(e)); }
  }

  // ════════════════════════════════════════════════════════════
  // 5. OUTBOUND ORDERS
  // ════════════════════════════════════════════════════════════
  async function renderOutbound(){
    var r = await sb().from('wh_outbound_orders')
      .select('*,client:clients!wh_outbound_orders_client_id_fkey(name),transfer:wh_transfers!wh_outbound_orders_transfer_id_fkey(id,transfer_number,status,scheduled_at)')
      .order('created_at', { ascending: false }).limit(200);
    if(r.error) throw r.error;
    var rows = (r.data || []).map(function(o){
      var t = o.transfer;
      var act = '';
      if(t) act += '<button type="button" class="cbtn" data-wh="openTransfer" data-arg="' + esc(t.id) + '">' + esc(t.transfer_number) + '</button> ';
      if(o.status === 'allocated') act += '<button type="button" class="cbtn" data-wh="orderEmail" data-arg="' + esc(o.id) + '">✉ Order email</button> ' +
        '<button type="button" class="cbtn grn" data-wh="shipOrder" data-arg="' + esc(o.id) + '">Mark shipped</button>';
      return '<tr><td style="font-weight:700">' + esc(o.order_number) + '</td><td>' + esc(o.client && o.client.name) + '</td>' +
        '<td>' + esc(o.release_reference || '') + '</td><td>' + esc(fmtDate(o.requested_pickup_date)) + '</td>' +
        '<td>' + esc(o.ship_method || '') + (o.carrier ? ' · ' + esc(o.carrier) : '') + '</td>' +
        '<td>' + esc(o.bol_number || '') + '</td><td>' + badge(o.status) + '</td><td style="white-space:nowrap">' + act + '</td></tr>';
    }).join('');
    setBody('<div class="ccard"><div style="display:flex;gap:8px;margin-bottom:12px;align-items:center"><button type="button" class="cbtn pri" data-wh="newOrder">🚚 Ship out (LTL)</button>' +
      '<span style="font-size:11.5px;color:#9aa7bd">Allocates pallets at CONRI FEFO (earliest best by, then first received) and creates the pickup transfer.</span></div>' +
      (rows ? '<div style="overflow-x:auto"><table class="ctbl"><tr><th>Order</th><th>Client</th><th>Release ref</th><th>Pickup</th><th>Method</th><th>BOL</th><th>Status</th><th></th></tr>' + rows + '</table></div>'
            : '<div style="color:#9aa7bd;font-size:12px">No outbound orders yet.</div>') + '</div>');
  }

  // What can leave CONRI on an outbound order: a client's finished goods and
  // empty cans. Good Liquid's own packaging has no client and is pulled back
  // instead (wh_transfers_owner_check requires a client on an outbound pickup).
  function shippable(s){ return !!(s && s.client_id && (s.inventory_type === 'finished_good' || s.inventory_type === 'empty_can')); }
  // A finished good ships only from a QA-released lot; empty cans have no lot.
  function canShipPallet(p){
    if(!p.sku || !shippable(p.sku)) return false;
    return p.sku.inventory_type !== 'finished_good' || !!(p.lot && p.lot.qa_status === 'released');
  }

  // preset {client, sku}: the dashboard's 🚚 Ship button opens the order with
  // the client chosen and 1 pallet of that item filled in.
  function newOrder(preset){
    preset = preset || {};
    var ov = overlay('wh-order', '🚚 SHIP OUT FROM CONRI', 700);
    ovBody(ov, '<div style="font-size:12px;color:#9aa7bd;margin-bottom:10px;line-height:1.6">Pick the client and how many pallets of each item go out. ' +
        'It picks the pallets (earliest best by first), creates the pickup, and writes the email to Paul. When the truck leaves, <b>Mark shipped</b> with the BOL number.</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
        field('Client *', '<select id="wo-client" style="' + INP + '">' + clientOptions(preset.client || '') + '</select>', true) +
        field('Client release / PO', '<input id="wo-ref" style="' + INP + '">') +
        field('Requested pickup date *', '<input id="wo-date" type="date" style="' + INP + '">') +
        field('Ship method', '<select id="wo-method" style="' + INP + '"><option value="LTL">LTL</option><option value="FTL">FTL</option><option value="parcel">Parcel</option><option value="customer_pickup">Customer pickup</option></select>') +
        field('Carrier', '<input id="wo-carrier" style="' + INP + '">') +
        field('Ship to *', '<textarea id="wo-shipto" rows="3" style="' + INP + '"></textarea>', true) +
      '</div>' +
      '<div style="font-size:11px;color:#9aa7bd;margin:12px 0 6px;letter-spacing:1px">ALLOCATE (pallets per SKU, FEFO from CONRI stock)</div>' +
      '<div id="wo-lines"></div>' +
      '<div style="display:flex;gap:10px;margin-top:14px"><button type="button" class="cbtn" data-wh="closeOverlay" style="flex:1;justify-content:center">Cancel</button>' +
      '<button type="button" class="cbtn pri" id="wo-save" style="flex:1;justify-content:center">Allocate FEFO + create pickup</button></div>');
    var stock = [];
    ov.querySelector('#wo-client').addEventListener('change', async function(){
      var cid = this.value, host = ov.querySelector('#wo-lines');
      if(!cid){ host.textContent = ''; return; }
      host.innerHTML = '<div style="color:#9aa7bd;font-size:12px">Loading stock…</div>';
      var r = await sb().from('wh_pallets').select(PALLET_EMBED).eq('location','conri').eq('status','stored').is('current_transfer_id', null);
      if(r.error){ host.innerHTML = note('err', errMsg(r.error)); return; }
      stock = (r.data || []).filter(function(p){ return p.sku && p.sku.client_id === cid && canShipPallet(p); });
      var bySku = {};
      stock.forEach(function(p){ (bySku[p.sku.id] = bySku[p.sku.id] || { s: p.sku, n: 0 }).n++; });
      var keys = Object.keys(bySku);
      host.innerHTML = keys.length ? '<table class="ctbl"><tr><th>SKU</th><th style="text-align:right">At CONRI</th><th>Pallets to ship</th></tr>' + keys.map(function(k){
        var s = bySku[k].s;
        return '<tr><td>' + esc(s.upc_sku + ' · ' + s.description) + (s.inventory_type === 'empty_can' ? ' <span style="color:#9aa7bd">(empty cans)</span>' : '') + '</td>' +
          '<td style="text-align:right">' + bySku[k].n + '</td>' +
          '<td><input type="number" min="0" max="' + bySku[k].n + '" value="' + (k === preset.sku ? 1 : 0) + '" class="wo-qty" data-sku="' + esc(k) + '" style="' + INP + ';max-width:110px"></td></tr>';
      }).join('') + '</table>' : note('', 'This client has nothing at CONRI that can ship (finished goods need a QA-released lot).');
      var pre = preset.sku && host.querySelector('.wo-qty[data-sku="' + preset.sku + '"]');
      if(pre){ pre.focus(); pre.select(); }
    });
    if(preset.client) ov.querySelector('#wo-client').dispatchEvent(new Event('change'));
    ov.querySelector('#wo-save').addEventListener('click', async function(){
      var btn = this;
      var cid = val(ov,'#wo-client'), date = val(ov,'#wo-date'), shipTo = val(ov,'#wo-shipto');
      if(!cid || !date || !shipTo){ ovMsg(ov,'err','Client, pickup date and ship to are required.'); return; }
      var want = {};
      Array.prototype.forEach.call(ov.querySelectorAll('.wo-qty'), function(i){ var n = parseInt(i.value, 10); if(n > 0) want[i.getAttribute('data-sku')] = n; });
      if(!Object.keys(want).length){ ovMsg(ov,'err','Enter pallets to ship for at least one SKU.'); return; }
      var picked = allocateFefo(stock, want);
      if(picked.short.length){ ovMsg(ov,'err','Not enough stock: ' + picked.short.join('; ')); return; }
      btn.disabled = true; ovMsg(ov,'','Allocating…');
      var trId = null;
      try {
        var tr = checked(await sb().from('wh_transfers').insert({
          type: 'outbound_pickup', client_id: cid, transfer_date: date,
          scheduled_at: fromLocalInput(date + 'T08:00'), carrier: val(ov,'#wo-carrier') || null, ship_to: shipTo
        }).select('id,transfer_number'), 1, 'Create pickup');
        trId = tr[0].id;
        checked(await sb().from('wh_transfer_lines').insert(picked.pallets.map(function(p, i){
          return { transfer_id: trId, pallet_id: p.id, line_no: i + 1 };
        })).select('pallet_id'), picked.pallets.length, 'Allocate pallets');
        var ord = checked(await sb().from('wh_outbound_orders').insert({
          client_id: cid, release_reference: val(ov,'#wo-ref') || null, ship_to: shipTo, requested_pickup_date: date,
          ship_method: val(ov,'#wo-method'), carrier: val(ov,'#wo-carrier') || null, status: 'allocated', transfer_id: trId
        }).select('id,order_number'), 1, 'Create order');
        audit('wh_order_allocated', ord[0].order_number, { pallets: picked.pallets.length, transfer: tr[0].transfer_number });
        // Land on the order, with the email to CONRI already written.
        ov.remove(); state.tab = 'outbound'; window.glRenderWarehouse();
        orderEmail(ord[0].id);
      } catch(e){
        if(trId){ try { await sb().from('wh_transfers').update({ status: 'cancelled' }).eq('id', trId).select('id'); } catch(_){} }
        btn.disabled = false; ovMsg(ov,'err','Failed: ' + errMsg(e));
      }
    });
  }

  function allocateFefo(stock, want){
    var pallets = [], short = [];
    Object.keys(want).forEach(function(skuId){
      // Empty cans have no lot; anything else ships only from a released lot.
      var avail = sortFefo(stock.filter(function(p){
        return p.sku.id === skuId && (p.sku.inventory_type === 'empty_can' || (p.lot && p.lot.qa_status === 'released'));
      }));
      if(avail.length < want[skuId]) short.push((avail[0] ? avail[0].sku.upc_sku : skuId) + ' needs ' + want[skuId] + ', ' + avail.length + ' available');
      pallets = pallets.concat(avail.slice(0, want[skuId]));
    });
    return { pallets: pallets, short: short };
  }

  async function loadOrder(id){
    var r = await sb().from('wh_outbound_orders').select('*,client:clients!wh_outbound_orders_client_id_fkey(name)').eq('id', id).limit(1);
    if(r.error) throw r.error;
    if(!r.data || !r.data[0]) throw new Error('Order not found.');
    return r.data[0];
  }

  async function orderEmail(id){
    try {
      var o = await loadOrder(id);
      var d = await loadTransfer(o.transfer_id);
      var bySku = {};
      d.lines.forEach(function(p){
        var k = p.sku.upc_sku + '|' + (p.lot ? p.lot.lot_number : '');
        var n = bySku[k] = bySku[k] || { p: p, pallets: 0, cases: 0, tags: [] };
        n.pallets++; n.cases += num(p.cases); n.tags.push(p.pallet_tag);
      });
      var subject = 'Outbound order ' + o.order_number + ': ' + (o.client && o.client.name) + ', pickup ' + fmtDate(o.requested_pickup_date);
      var bodyTxt = 'Hi Paul,\n\nPlease pull the following for pickup from the Good Liquid Bev Co account.\n\n' +
        'Order: ' + o.order_number + (o.release_reference ? ' (client release ' + o.release_reference + ')' : '') + '\n' +
        'Transfer: ' + d.t.transfer_number + '\n' +
        'Client / brand: ' + (o.client && o.client.name) + '\n' +
        'Pickup date: ' + fmtDate(o.requested_pickup_date) + '\n' +
        'Ship method: ' + (o.ship_method || '') + (o.carrier ? ', carrier ' + o.carrier : '') + '\n' +
        'Ship to: ' + String(o.ship_to || '').replace(/\n/g, ', ') + '\n\n' +
        'Pick (FEFO):\n' + Object.keys(bySku).map(function(k){
          var n = bySku[k], p = n.p;
          return '  - ' + p.sku.upc_sku + '  ' + p.sku.description + (p.sku.inventory_type === 'empty_can' ? ' (empty cans)' : '') +
            (p.lot ? ', lot ' + p.lot.lot_number : '') +
            (p.lot && p.lot.best_by_date ? ', best by ' + fmtDate(p.lot.best_by_date) : '') + ': ' + n.pallets + ' pallets, ' + fmtInt(n.cases) + ' cases\n' +
            '      tags ' + n.tags.join(', ');
        }).join('\n') +
        (d.lines.some(function(p){ return p.notes; }) ? '\n\nPallet notes:\n' + d.lines.filter(function(p){ return p.notes; }).map(function(p){
          return '  - ' + p.pallet_tag + ': ' + String(p.notes).replace(/\s*\n\s*/g, ' ');
        }).join('\n') : '') +
        '\n\nTotal: ' + d.lines.length + ' pallets.\nPlease send the BOL number once it ships.\n\nThanks,\n' +
        (userName() || GL.contact) + '\n' + GL.name + '\n' + GL.phone;
      var ov = overlay('wh-oemail', '✉ ORDER EMAIL TO CONRI', 680);
      var href = 'mailto:' + encodeURIComponent(CONRI.email) + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(bodyTxt);
      ovBody(ov, '<div style="font-size:12px;color:#9aa7bd;margin-bottom:8px">To: ' + esc(CONRI.email) + ' · ' + esc(subject) + '</div>' +
        '<textarea rows="18" readonly style="' + INP + ';font-family:ui-monospace,monospace;font-size:12px">' + esc(bodyTxt) + '</textarea>' +
        '<div style="display:flex;gap:10px;margin-top:14px"><a class="cbtn pri" href="' + esc(href) + '" style="flex:1;justify-content:center;text-decoration:none">Open in mail app</a></div>');
    } catch(e){ alert(errMsg(e)); }
  }

  async function shipOrder(id){
    var o, d;
    try { o = await loadOrder(id); d = await loadTransfer(o.transfer_id); } catch(e){ alert(errMsg(e)); return; }
    var totC = d.lines.reduce(function(s, p){ return s + num(p.cases); }, 0);
    var ov = overlay('wh-ship', 'MARK ' + o.order_number + ' SHIPPED');
    ovBody(ov, '<div style="font-size:12px;color:#9aa7bd;margin-bottom:10px">Completes pickup ' + esc(d.t.transfer_number) + ' (' + d.lines.length + ' pallets, ' + fmtInt(totC) + ' cases) and marks the pallets shipped.</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
        field('BOL number *', '<input id="wsh-bol" style="' + INP + '">') +
        field('Driver / carrier name *', '<input id="wsh-by" value="' + esc(o.carrier || '') + '" style="' + INP + '">') +
      '</div>' +
      '<div style="display:flex;gap:10px;margin-top:14px"><button type="button" class="cbtn" data-wh="closeOverlay" style="flex:1;justify-content:center">Cancel</button>' +
      '<button type="button" class="cbtn grn" id="wsh-save" style="flex:1;justify-content:center">Mark shipped</button></div>');
    ov.querySelector('#wsh-save').addEventListener('click', async function(){
      var btn = this, bol = val(ov,'#wsh-bol'), by = val(ov,'#wsh-by');
      if(!bol || !by){ ovMsg(ov,'err','BOL number and driver / carrier are required.'); return; }
      btn.disabled = true; ovMsg(ov,'','Shipping…');
      try {
        if(d.t.status === 'draft'){
          checked(await sb().from('wh_transfers').update({ status: 'scheduled', scheduled_at: d.t.scheduled_at || new Date().toISOString() })
            .eq('id', d.t.id).select('id'), 1, 'Schedule pickup');
        }
        if(d.t.status !== 'completed'){
          checked(await sb().from('wh_transfers').update({ status: 'completed', received_by: by, pallets_received: d.lines.length,
            cases_received: totC, receipt_condition: 'good' }).eq('id', d.t.id).select('id'), 1, 'Complete pickup');
        }
        checked(await sb().from('wh_outbound_orders').update({ status: 'shipped', bol_number: bol }).eq('id', id).select('id'), 1, 'Mark shipped');
        audit('wh_order_shipped', o.order_number, { bol: bol });
        ov.remove(); renderTab();
      } catch(e){ btn.disabled = false; ovMsg(ov,'err','Failed: ' + errMsg(e)); }
    });
  }

  // ════════════════════════════════════════════════════════════
  // 5b. BOL PALLET SHEETS
  // A client sends a BOL that says "14 pallets". Type what is on the BOL,
  // press print, and get one big sheet per pallet: PALLET 3 OF 14, the BOL
  // and PO numbers, ship to, carrier. Print only; nothing is saved, so it
  // works for any shipment, whether or not its pallets are in this system.
  // ════════════════════════════════════════════════════════════
  var BOL_MAX_PALLETS = 200;
  var BOL_FIELDS = ['client','bol','po','date','carrier','shipto','product','lot','pallets','cases'];

  // Pure: form values in, { errors, info } out. Exposed for tests.
  function bolInput(v){
    v = v || {};
    var t = function(k){ return String(v[k] == null ? '' : v[k]).trim(); };
    var errors = [];
    var palletsRaw = t('pallets');
    var pallets = Number(palletsRaw);
    if(!t('bol')) errors.push('Enter the BOL number.');
    if(!palletsRaw) errors.push('Enter how many pallets the BOL lists.');
    else if(!(pallets >= 1 && pallets <= BOL_MAX_PALLETS && Math.floor(pallets) === pallets)) errors.push('Pallet count must be a whole number from 1 to ' + BOL_MAX_PALLETS + '.');
    var casesRaw = t('cases');
    var cases = casesRaw ? Number(casesRaw) : null;
    if(casesRaw && !(cases >= 0 && isFinite(cases))) errors.push('Cases per pallet must be a number.');
    return {
      errors: errors,
      info: {
        client: t('client'), bol: t('bol'), po: t('po'), date: t('date'), carrier: t('carrier'),
        shipto: t('shipto'), product: t('product'), lot: t('lot'),
        pallets: errors.length ? 0 : pallets, cases: cases
      }
    };
  }

  function renderBol(){
    var b = state.bol || { date: todayISO() };
    var v = function(k){ return esc(b[k] == null ? '' : b[k]); };
    // Fields the AI filled get a teal outline until someone edits the form,
    // so staff can see what to check against the paper.
    var hi = function(k){ return state.bolFilled.indexOf(k) >= 0 ? ';border-color:var(--teal);box-shadow:0 0 0 1px var(--teal)' : ''; };
    var INPK = function(k){ return INP + hi(k); };
    var names = state.clients.map(function(c){ return '<option value="' + esc(c.name) + '"></option>'; }).join('');
    setBody('<div class="ccard" id="wh-bol-form" style="max-width:760px"><div class="ccard-t">Pallet sheets from a BOL</div>' +
      '<div style="font-size:12px;color:#9aa7bd;line-height:1.6;margin-bottom:12px">Upload the client\'s BOL to fill this in, or type it. Then print: one sheet per pallet, marked <b>PALLET 1 OF N</b> through <b>N OF N</b>. Nothing is saved.</div>' +
      '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:14px">' +
        '<label class="cbtn pri" style="cursor:pointer' + (state.bolBusy ? ';opacity:.6;pointer-events:none' : '') + '">' +
          (state.bolBusy ? '⏳ Reading the BOL…' : '📎 Upload BOL (PDF or photo)') +
          '<input type="file" id="wh-bol-file" accept="application/pdf,image/jpeg,image/png,image/webp,image/gif" style="display:none"' + (state.bolBusy ? ' disabled' : '') + '>' +
        '</label>' +
        '<span style="font-size:11px;color:#9aa7bd">PDF, JPG or PNG, up to ' + BOL_MAX_MB + ' MB</span>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
        field('BOL # *', '<input id="wh-bol-bol" value="' + v('bol') + '" style="' + INPK('bol') + '">') +
        field('Number of pallets *', '<input id="wh-bol-pallets" type="number" min="1" max="' + BOL_MAX_PALLETS + '" step="1" value="' + v('pallets') + '" style="' + INPK('pallets') + '">') +
        field('Client / shipper', '<input id="wh-bol-client" list="wh-bol-clients" autocomplete="off" value="' + v('client') + '" style="' + INPK('client') + '"><datalist id="wh-bol-clients">' + names + '</datalist>') +
        field('PO / order #', '<input id="wh-bol-po" value="' + v('po') + '" style="' + INPK('po') + '">') +
        field('Ship date', '<input id="wh-bol-date" type="date" value="' + v('date') + '" style="' + INPK('date') + '">') +
        field('Carrier', '<input id="wh-bol-carrier" value="' + v('carrier') + '" style="' + INPK('carrier') + '">') +
        field('Ship to', '<textarea id="wh-bol-shipto" rows="3" style="' + INPK('shipto') + '">' + v('shipto') + '</textarea>', true) +
        field('Product', '<input id="wh-bol-product" value="' + v('product') + '" style="' + INPK('product') + '">') +
        field('Lot #', '<input id="wh-bol-lot" value="' + v('lot') + '" style="' + INPK('lot') + '">') +
        field('Cases per pallet', '<input id="wh-bol-cases" type="number" min="0" step="1" value="' + v('cases') + '" style="' + INPK('cases') + '">') +
      '</div>' +
      '<div id="wh-bol-msg">' + (state.bolNote ? note(state.bolNote.kind, state.bolNote.text) : '') + '</div>' +
      '<div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap">' +
        '<button type="button" class="cbtn pri" data-wh="printBolSheets" id="wh-bol-print">🖨️ Print pallet sheets</button>' +
        '<button type="button" class="cbtn" data-wh="clearBol">Clear</button>' +
      '</div></div>');
    // Listen on the form itself: it is replaced on every render, so the
    // listener goes with it and never fires on another tab.
    var host = document.getElementById('wh-bol-form');
    if(!host) return;
    // Keep what was typed when staff switch tabs and come back.
    var sync = function(){
      var cur = {};
      BOL_FIELDS.forEach(function(k){ cur[k] = val(host, '#wh-bol-' + k); });
      state.bol = cur;
      var n = bolInput(cur).info.pallets;
      var btn = host.querySelector('#wh-bol-print');
      if(btn) btn.textContent = '🖨️ Print ' + (n ? n + ' pallet sheet' + (n === 1 ? '' : 's') : 'pallet sheets');
    };
    host.addEventListener('input', function(){ state.bolFilled = []; state.bolNote = null; sync(); });
    sync();
    var file = host.querySelector('#wh-bol-file');
    if(file) file.addEventListener('change', function(){ var f = this.files && this.files[0]; if(f) readBol(f); });
  }

  // ── Read a BOL with AI ─────────────────────────────────────
  // The file goes to the staff-only, rate-limited ai-proxy edge function
  // (the API key never reaches the browser). What comes back is untrusted:
  // a BOL is a document a stranger wrote. It only ever fills form fields,
  // through bolFromAi() (type-checked, length-capped) and esc() on render,
  // and a person reads the fields before anything prints.
  var BOL_MAX_MB = 5;
  var BOL_TYPES = { 'application/pdf': 'document', 'image/jpeg': 'image', 'image/png': 'image', 'image/webp': 'image', 'image/gif': 'image' };
  var BOL_PROMPT =
    'This is a bill of lading (BOL) for a shipment of pallets. Read it and reply with ONLY a JSON object, no other text, with these keys:\n' +
    '{"bol_number": string, "po_number": string, "ship_date": "YYYY-MM-DD", "carrier": string, ' +
    '"shipper": string, "consignee": string, "ship_to": string, "product": string, "lot": string, ' +
    '"pallet_count": integer, "cases_per_pallet": integer}\n' +
    'Rules: ship_to is the consignee name and full delivery address, one line per address line separated by \\n. ' +
    'pallet_count is the total number of pallets (handling units) on the BOL. ' +
    'cases_per_pallet only if every pallet has the same case count; otherwise null. ' +
    'Use "" (or null for numbers) for anything not on the document. Never guess.';

  function readFileB64(file){
    return new Promise(function(resolve, reject){
      var r = new FileReader();
      r.onload = function(){ var s = String(r.result || ''); resolve(s.slice(s.indexOf(',') + 1)); };
      r.onerror = function(){ reject(new Error('Could not read the file.')); };
      r.readAsDataURL(file);
    });
  }

  // Pure: the model's reply text in, form values out. Exposed for tests.
  function bolFromAi(text, clientNames){
    var t = String(text || '');
    var a = t.indexOf('{'), z = t.lastIndexOf('}');
    if(a < 0 || z <= a) throw new Error('The AI did not return any BOL fields.');
    var j;
    try { j = JSON.parse(t.slice(a, z + 1)); } catch(e){ throw new Error('The AI reply could not be read.'); }
    if(!j || typeof j !== 'object') throw new Error('The AI reply could not be read.');
    var str = function(x, max){ return (typeof x === 'string' || typeof x === 'number') ? String(x).replace(/\r/g, '').trim().slice(0, max || 120) : ''; };
    var int = function(x, lo, hi){ var n = Number(x); return (x !== null && x !== '' && Math.floor(n) === n && n >= lo && n <= hi) ? String(n) : ''; };
    var date = str(j.ship_date, 10);
    var out = {
      bol: str(j.bol_number, 60), po: str(j.po_number, 60), carrier: str(j.carrier),
      shipto: str(j.ship_to, 400), product: str(j.product), lot: str(j.lot, 60),
      date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '',
      pallets: int(j.pallet_count, 1, BOL_MAX_PALLETS), cases: int(j.cases_per_pallet, 0, 100000),
      client: ''
    };
    // Prefer one of our client names, matched here rather than sending the
    // client list to the AI.
    var shipper = str(j.shipper), consignee = str(j.consignee);
    var hay = (shipper + ' ' + consignee).toLowerCase();
    var hit = (clientNames || []).filter(function(n){ return n && hay.indexOf(String(n).toLowerCase()) >= 0; })
      .sort(function(x, y){ return y.length - x.length; })[0];
    out.client = hit || shipper;
    return out;
  }

  async function readBol(file){
    var kind = BOL_TYPES[file.type];
    if(!kind){ state.bolNote = { kind: 'err', text: 'Upload a PDF, JPG or PNG of the BOL.' }; return renderBol(); }
    if(file.size > BOL_MAX_MB * 1024 * 1024){ state.bolNote = { kind: 'err', text: 'That file is over ' + BOL_MAX_MB + ' MB. Try a smaller scan or a photo.' }; return renderBol(); }
    if(!sb() || !sb().functions){ state.bolNote = { kind: 'err', text: 'Not connected. Type the BOL in instead.' }; return renderBol(); }
    state.bolBusy = true; state.bolNote = null; renderBol();
    try {
      var data = await readFileB64(file);
      var block = { type: kind, source: { type: 'base64', media_type: file.type, data: data } };
      var resp = await sb().functions.invoke('ai-proxy', {
        body: { model: 'claude-opus-5-5', maxTokens: 4096,
                messages: [{ role: 'user', content: [block, { type: 'text', text: BOL_PROMPT }] }] }
      });
      if(resp.error) throw new Error(errMsg(resp.error));
      if(!resp.data || resp.data.ok === false) throw new Error((resp.data && resp.data.error) || 'The AI could not read it.');
      var got = bolFromAi(resp.data.text, state.clients.map(function(c){ return c.name; }));
      var cur = state.bol || { date: todayISO() };
      var filled = [];
      BOL_FIELDS.forEach(function(k){ if(got[k]){ cur[k] = got[k]; filled.push(k); } });
      state.bol = cur;
      state.bolFilled = filled;
      if(!filled.length){
        state.bolNote = { kind: 'warn', text: 'Nothing readable was found on that file. Type the BOL in instead.' };
      } else {
        state.bolNote = { kind: got.pallets ? 'ok' : 'warn',
          text: 'Filled ' + filled.length + ' field' + (filled.length === 1 ? '' : 's') + ' from ' + file.name + ' (outlined). Check them against the BOL before printing.' +
            (got.pallets ? '' : ' The pallet count was not found: enter it.') };
      }
      audit('wh_bol_read_ai', got.bol || file.name, { fields: filled.length });
    } catch(e){
      state.bolNote = { kind: 'err', text: 'Could not read the BOL: ' + errMsg(e) + ' You can still type it in.' };
    } finally {
      state.bolBusy = false;
      if(state.tab === 'bol') renderBol();
    }
  }

  async function printBolSheets(){
    var host = body(); if(!host) return;
    var cur = {};
    BOL_FIELDS.forEach(function(k){ cur[k] = val(host, '#wh-bol-' + k); });
    state.bol = cur;
    var r = bolInput(cur);
    var msgEl = host.querySelector('#wh-bol-msg');
    var msg = function(kind, text){ if(msgEl) msgEl.innerHTML = text ? note(kind, text) : ''; };
    if(r.errors.length){ msg('err', r.errors.join(' ')); return; }
    msg('', '');
    try {
      if(typeof window.ensureJsPdf !== 'function') throw new Error('PDF engine not available on this page.');
      var jsPDF = await window.ensureJsPdf();
      var doc = buildBolSheets(jsPDF, r.info);
      doc.save('BOL_' + r.info.bol.replace(/[^A-Za-z0-9._-]+/g, '_') + '_pallet_sheets.pdf');
      audit('wh_bol_sheets_printed', r.info.bol, { pallets: r.info.pallets, client: r.info.client });
      msg('ok', r.info.pallets + ' pallet sheet' + (r.info.pallets === 1 ? '' : 's') + ' saved as a PDF. Open it and print.');
    } catch(e){ msg('err', 'Could not build the PDF: ' + errMsg(e)); }
  }

  // ════════════════════════════════════════════════════════════
  // 6. RECONCILIATION (CONRI inventory CSV vs our records)
  // ════════════════════════════════════════════════════════════
  function renderRecon(){
    setBody('<div class="ccard"><div class="ccard-t">Reconcile against CONRI\'s inventory report</div>' +
      '<div style="font-size:12px;color:#9aa7bd;line-height:1.6;margin-bottom:10px">Upload CONRI\'s CSV. Columns are matched by header name: SKU / item / UPC, lot / batch, pallets, and cases / quantity / on hand. ' +
      'Rows are matched by SKU and lot. Nothing is saved; this is a comparison only.</div>' +
      '<input type="file" id="wh-recon-file" accept=".csv,text/csv" style="' + INP + ';max-width:420px"><div id="wh-recon-out" style="margin-top:14px"></div></div>');
    var inp = document.getElementById('wh-recon-file');
    if(inp) inp.addEventListener('change', function(){ var f = this.files[0]; if(f) runRecon(f); });
  }

  // RFC 4180-ish: quoted fields, doubled quotes, CRLF.
  function parseCsv(text){
    var rows = [], row = [], cell = '', q = false;
    text = String(text).replace(/^﻿/, '');
    for(var i = 0; i < text.length; i++){
      var ch = text[i];
      if(q){
        if(ch === '"'){ if(text[i+1] === '"'){ cell += '"'; i++; } else q = false; }
        else cell += ch;
      } else if(ch === '"') q = true;
      else if(ch === ','){ row.push(cell); cell = ''; }
      else if(ch === '\n' || ch === '\r'){
        if(ch === '\r' && text[i+1] === '\n') i++;
        row.push(cell); cell = '';
        if(row.some(function(c){ return c.trim() !== ''; })) rows.push(row);
        row = [];
      } else cell += ch;
    }
    row.push(cell);
    if(row.some(function(c){ return c.trim() !== ''; })) rows.push(row);
    return rows;
  }
  function normKey(sku, lot){ return String(sku || '').trim().toUpperCase().replace(/\s+/g,'') + '|' + String(lot || '').trim().toUpperCase(); }

  function reconcile(csvRows, pallets){
    if(!csvRows.length) return { error: 'The file is empty.' };
    var head = csvRows[0].map(function(h){ return String(h).trim().toLowerCase(); });
    var find = function(re){ for(var i = 0; i < head.length; i++){ if(re.test(head[i])) return i; } return -1; };
    var iSku = find(/sku|item|upc|product\s*(code|id)/), iLot = find(/lot|batch/), iPal = find(/pallet|plt/), iCase = find(/case|qty|quantity|on\s*hand|units?\s*on/);
    if(iSku < 0) return { error: 'No SKU / item column found in the header row.' };
    if(iPal < 0 && iCase < 0) return { error: 'No pallets or cases column found in the header row.' };
    var theirs = {};
    csvRows.slice(1).forEach(function(r){
      var k = normKey(r[iSku], iLot >= 0 ? r[iLot] : '');
      var n = theirs[k] = theirs[k] || { sku: String(r[iSku] || '').trim(), lot: iLot >= 0 ? String(r[iLot] || '').trim() : '', pallets: 0, cases: 0 };
      n.pallets += iPal >= 0 ? num(String(r[iPal]).replace(/,/g,'')) : 0;
      n.cases += iCase >= 0 ? num(String(r[iCase]).replace(/,/g,'')) : 0;
    });
    var ours = {};
    pallets.forEach(function(p){
      var k = normKey(p.sku && p.sku.upc_sku, iLot >= 0 && p.lot ? p.lot.lot_number : '');
      var n = ours[k] = ours[k] || { sku: p.sku && p.sku.upc_sku, lot: iLot >= 0 && p.lot ? p.lot.lot_number : '', desc: p.sku && p.sku.description, pallets: 0, cases: 0 };
      n.pallets++; n.cases += num(p.cases);
    });
    var keys = {}; Object.keys(theirs).forEach(function(k){ keys[k] = 1; }); Object.keys(ours).forEach(function(k){ keys[k] = 1; });
    var out = Object.keys(keys).sort().map(function(k){
      var a = ours[k] || { pallets: 0, cases: 0 }, b = theirs[k] || { pallets: 0, cases: 0 };
      var dp = iPal >= 0 ? b.pallets - a.pallets : null, dc = iCase >= 0 ? b.cases - a.cases : null;
      return { sku: (ours[k] || theirs[k]).sku, lot: (ours[k] || theirs[k]).lot, desc: a.desc || '',
        oursP: a.pallets, oursC: a.cases, theirsP: b.pallets, theirsC: b.cases, dp: dp, dc: dc,
        match: (dp == null || dp === 0) && (dc == null || dc === 0) };
    });
    return { rows: out, hasPal: iPal >= 0, hasCase: iCase >= 0, byLot: iLot >= 0 };
  }

  async function runRecon(file){
    var out = document.getElementById('wh-recon-out');
    out.innerHTML = '<div style="color:#9aa7bd;font-size:12px">Comparing…</div>';
    try {
      var text = await file.text();
      var pallets = await loadConriPallets();
      var res = reconcile(parseCsv(text), pallets);
      if(res.error){ out.innerHTML = note('err', res.error); return; }
      var bad = res.rows.filter(function(r){ return !r.match; }).length;
      var d = function(n){ return n == null ? '' : (n === 0 ? '0' : (n > 0 ? '+' : '') + fmtInt(n)); };
      out.innerHTML = note(bad ? 'warn' : 'ok', bad ? bad + ' line(s) differ.' : 'Everything matches.') +
        (res.byLot ? '' : note('warn','No lot column in the file, so matching is by SKU only.')) +
        '<div style="overflow-x:auto"><table class="ctbl"><tr><th>SKU</th><th>Lot</th><th>Description</th>' +
          '<th style="text-align:right">Our pallets</th><th style="text-align:right">CONRI pallets</th><th style="text-align:right">Diff</th>' +
          '<th style="text-align:right">Our cases</th><th style="text-align:right">CONRI cases</th><th style="text-align:right">Diff</th></tr>' +
        res.rows.map(function(r){
          return '<tr' + (r.match ? '' : ' style="background:rgba(231,76,60,.10)"') + '><td>' + esc(r.sku) + '</td><td>' + esc(r.lot) + '</td><td>' + esc(r.desc) + '</td>' +
            '<td style="text-align:right">' + fmtInt(r.oursP) + '</td><td style="text-align:right">' + (res.hasPal ? fmtInt(r.theirsP) : '') + '</td>' +
            '<td style="text-align:right;font-weight:700">' + esc(d(r.dp)) + '</td>' +
            '<td style="text-align:right">' + fmtInt(r.oursC) + '</td><td style="text-align:right">' + (res.hasCase ? fmtInt(r.theirsC) : '') + '</td>' +
            '<td style="text-align:right;font-weight:700">' + esc(d(r.dc)) + '</td></tr>';
        }).join('') + '</table></div>';
    } catch(e){ out.innerHTML = note('err', 'Could not read the file: ' + errMsg(e)); }
  }

  // ════════════════════════════════════════════════════════════
  // DOCUMENTS — packing list + pallet labels (jsPDF, letter)
  // ════════════════════════════════════════════════════════════

  // Code 128 symbol widths (bar, space, bar, space, bar, space), values 0-106.
  var C128 = ('212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 ' +
    '123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 ' +
    '111323 131123 131321 112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 ' +
    '231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 111422 121124 121421 ' +
    '141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 111242 121142 121241 114212 ' +
    '124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 114131 ' +
    '311141 411131 211412 211214 211232 2331112').split(' ');

  // Code 128 subset B: start B (104), data, mod-103 checksum, stop. Returns the
  // run of module widths, alternating bar/space and starting with a bar.
  window.glWhCode128 = function glWhCode128(text){
    var s = String(text);
    var codes = [104], sum = 104;
    for(var i = 0; i < s.length; i++){
      var c = s.charCodeAt(i);
      if(c < 32 || c > 126) throw new Error('Code 128-B cannot encode character ' + c);
      codes.push(c - 32); sum += (c - 32) * (i + 1);
    }
    codes.push(sum % 103); codes.push(106);
    var widths = [];
    codes.forEach(function(v){ C128[v].split('').forEach(function(w){ widths.push(+w); }); });
    return widths;
  };

  function drawBarcode(doc, text, x, y, maxW, h){
    var widths = window.glWhCode128(text);
    var modules = widths.reduce(function(a, b){ return a + b; }, 0);
    var m = Math.min(2.2, maxW / (modules + 20));    // 10-module quiet zone each side
    var cx = x + 10 * m;
    doc.setFillColor(0, 0, 0);
    widths.forEach(function(w, i){
      if(i % 2 === 0) doc.rect(cx, y, w * m, h, 'F');
      cx += w * m;
    });
    return (modules + 20) * m;
  }

  function fitText(doc, text, maxW, size, minSize){
    var s = size;
    doc.setFontSize(s);
    while(s > minSize && doc.getTextWidth(text) > maxW){ s -= 1; doc.setFontSize(s); }
    if(doc.getTextWidth(text) > maxW){
      var t = text; while(t.length > 1 && doc.getTextWidth(t + '...') > maxW) t = t.slice(0, -1);
      return t + '...';
    }
    return text;
  }
  function cellText(doc, text, w){
    text = String(text == null ? '' : text);
    if(doc.getTextWidth(text) <= w) return text;
    var t = text; while(t.length > 1 && doc.getTextWidth(t + '...') > w) t = t.slice(0, -1);
    return t + '...';
  }

  function parties(t){
    var glBlock = [GL.name, GL.street, GL.city, 'Contact: ' + GL.contact + ', ' + GL.phone];
    var conriBlock = [CONRI.name, 'Attn: ' + CONRI.attn, CONRI.city, CONRI.phone + ', ' + CONRI.email];
    var shipTo = String(t.ship_to || '').split(/\n|,\s*(?=[A-Za-z0-9])/).filter(Boolean).slice(0, 3);
    if(t.type === 'pull_back') return { from: conriBlock, to: glBlock, rel: 'Released by (CONRI)', rec: 'Received by (Good Liquid)', route: 'CONRI Services to Good Liquid Bev Co' };
    if(t.type === 'outbound_pickup') return {
      from: conriBlock,
      to: (shipTo.length ? shipTo : ['(ship to not set)']).concat(['Carrier: ' + (t.carrier || 'TBD')]),
      rel: 'Released by (CONRI)', rec: 'Received by (Carrier)',
      route: 'CONRI Services to ' + (t.carrier || 'carrier')
    };
    return { from: glBlock, to: conriBlock, rel: 'Released by (Good Liquid)', rec: 'Received by (CONRI)', route: 'Good Liquid Bev Co to CONRI Services' };
  }

  function buildPaperwork(jsPDF, t, lines){
    var doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' });
    var W = 612, L = 40, R = 572;
    var pt = parties(t);
    var client = ownerName(t.client);
    var dateStr = fmtDate(t.transfer_date);
    var n = lines.length;

    function header(){
      doc.setFont('helvetica','bold'); doc.setFontSize(20); doc.setTextColor(0);
      doc.text('TRANSFER PACKING LIST', L, 56);
      doc.setFontSize(11);
      doc.text('Transfer # ' + t.transfer_number, R, 46, { align: 'right' });
      doc.setFont('helvetica','normal');
      doc.text('Transfer date: ' + dateStr, R, 61, { align: 'right' });
      doc.setLineWidth(1.2); doc.line(L, 70, R, 70);
    }
    header();

    function block(title, linesArr, x, y){
      doc.setFont('helvetica','bold'); doc.setFontSize(8.5); doc.setTextColor(90);
      doc.text(title, x, y);
      doc.setTextColor(0); doc.setFontSize(10.5);
      linesArr.forEach(function(s, i){
        doc.setFont('helvetica', i === 0 ? 'bold' : 'normal');
        doc.text(cellText(doc, s, 250), x, y + 15 + i * 13);
      });
    }
    block('SHIP FROM', pt.from, L, 90);
    block('SHIP TO', pt.to, 320, 90);

    var y = 170;
    doc.setFontSize(10.5); doc.setFont('helvetica','bold'); doc.text('Account:', L, y);
    doc.setFont('helvetica','normal'); doc.text('Good Liquid Bev Co', L + 50, y);
    doc.setFont('helvetica','bold'); doc.text('Client / Brand:', 320, y);
    doc.setFont('helvetica','normal'); doc.text(cellText(doc, client, 170), 402, y);
    y += 14;
    doc.setFont('helvetica','bold'); doc.text('Move:', L, y);
    doc.setFont('helvetica','normal'); doc.text(TYPES[t.type] || t.type, L + 50, y);
    doc.setFont('helvetica','bold'); doc.text('Scheduled:', 320, y);
    doc.setFont('helvetica','normal'); doc.text(t.scheduled_at ? fmtTs(t.scheduled_at) : 'TBD', 402, y);
    if(t.conri_confirmation){ y += 14; doc.setFont('helvetica','bold'); doc.text('CONRI ref:', 320, y); doc.setFont('helvetica','normal'); doc.text(String(t.conri_confirmation), 402, y); }

    // Table
    var cols = [
      ['Pallet', 50], ['UPC / SKU', 76], ['Description', 118], ['Pack', 70],
      ['Cases', 44, 'right'], ['Lot', 62], ['Best By', 56], ['Prod. Date', 56]
    ];
    y += 22;
    function tableHead(){
      doc.setFillColor(232, 236, 241); doc.rect(L, y - 12, R - L, 18, 'F');
      doc.setFont('helvetica','bold'); doc.setFontSize(9);
      var x = L + 4;
      cols.forEach(function(c){ doc.text(c[0], c[2] === 'right' ? x + c[1] - 8 : x, y, c[2] === 'right' ? { align: 'right' } : undefined); x += c[1]; });
      y += 18;
    }
    tableHead();
    var totC = 0, totU = 0, weights = [];
    doc.setFont('helvetica','normal'); doc.setFontSize(9.5);
    lines.forEach(function(p, i){
      if(y > 700){ doc.addPage('letter','portrait'); header(); y = 96; tableHead(); doc.setFont('helvetica','normal'); doc.setFontSize(9.5); }
      var s = p.sku || {}, l = p.lot || {};
      totC += num(p.cases); totU += num(p.cases) * num(s.units_per_case);
      if(p.weight_lbs) weights.push(num(p.weight_lbs));
      var vals = [(i + 1) + ' of ' + n, s.upc_sku, s.description, s.pack, fmtInt(p.cases), l.lot_number || '', fmtDate(l.best_by_date), fmtDate(l.production_date)];
      var x = L + 4;
      cols.forEach(function(c, j){
        var txt = cellText(doc, vals[j], c[1] - 8);
        doc.text(txt, c[2] === 'right' ? x + c[1] - 8 : x, y, c[2] === 'right' ? { align: 'right' } : undefined);
        x += c[1];
      });
      if(p.notes){
        doc.setFontSize(8.5); doc.setTextColor(80);
        doc.text(cellText(doc, 'Note: ' + String(p.notes).replace(/\s*\n\s*/g, ' '), R - L - 60), L + 54, y + 11);
        doc.setTextColor(0); doc.setFontSize(9.5);
        y += 11;
      }
      doc.setDrawColor(220); doc.setLineWidth(0.5); doc.line(L, y + 5, R, y + 5);
      y += 17;
    });
    // TOTAL row
    doc.setFont('helvetica','bold'); doc.setDrawColor(0); doc.setLineWidth(1); doc.line(L, y - 11, R, y - 11);
    doc.text('TOTAL', L + 4, y);
    var casesX = L + 4 + cols[0][1] + cols[1][1] + cols[2][1] + cols[3][1] + cols[4][1] - 8;
    doc.text(fmtInt(totC), casesX, y, { align: 'right' });
    y += 24;
    if(y > 610){ doc.addPage('letter','portrait'); header(); y = 100; }

    // Summary
    var totW = weights.reduce(function(a, b){ return a + b; }, 0);
    var sameW = weights.length === n && weights.every(function(w){ return w === weights[0]; });
    var perPallet = !weights.length ? 'not recorded' : sameW ? fmtInt(weights[0]) + ' lbs' : 'varies';
    var upcs = {}; lines.forEach(function(p){ if(p.sku) upcs[p.sku.units_per_case] = 1; });
    var unitsPer = Object.keys(upcs);
    var storage;
    if(t.type === 'to_conri_overflow'){
      var pulls = lines.map(function(p){ return p.expected_pull_date; }).filter(Boolean).sort();
      storage = 'Storage: empty cans, floor stack, pull date ' + (pulls.length ? fmtMD(pulls[0]) : 'TBD');
    } else if(t.type === 'to_conri_finished'){
      storage = 'Storage: finished goods, racked, FEFO by best by date';
    } else if(t.type === 'to_conri_packaging'){
      storage = 'Storage: Good Liquid packaging supplies';
    } else if(t.type === 'outbound_pickup'){
      storage = 'Pick: FEFO by best by date, then first received';
    } else {
      storage = 'Return to Good Liquid for production';
    }
    doc.setFont('helvetica','normal'); doc.setFontSize(10.5);
    var sum = [
      ['Total pallets', fmtInt(n)],
      ['Total cases', fmtInt(totC)],
      ['Total units', totU ? fmtInt(totU) + (unitsPer.length === 1 ? '  (' + fmtInt(totC) + ' cases x ' + unitsPer[0] + ' units)' : '') : 'n/a'],
      ['Weight per pallet', perPallet + (weights.length ? '    Total weight: ' + fmtInt(totW) + ' lbs' : '')]
    ];
    sum.forEach(function(r){
      doc.setFont('helvetica','bold'); doc.text(r[0] + ':', L, y);
      doc.setFont('helvetica','normal'); doc.text(r[1], L + 110, y);
      y += 15;
    });
    doc.setFont('helvetica','bold'); doc.text(storage, L, y); y += 22;

    // RECEIVING
    doc.setDrawColor(0); doc.setLineWidth(1); doc.rect(L, y, R - L, 82);
    doc.setFontSize(10); doc.text('RECEIVING', L + 8, y + 15);
    doc.setFont('helvetica','normal');
    doc.text('Pallets received: ____________', L + 8, y + 35);
    doc.text('Cases received: ____________', L + 200, y + 35);
    doc.text('Condition:', L + 8, y + 55);
    doc.rect(L + 68, y + 46, 10, 10); doc.text('Good', L + 83, y + 55);
    doc.rect(L + 130, y + 46, 10, 10); doc.text('Exceptions noted', L + 145, y + 55);
    doc.text('Exceptions: ' + '_'.repeat(78), L + 8, y + 74);
    y += 104;

    // Signatures
    function sig(label, x){
      doc.setLineWidth(0.8);
      doc.line(x, y, x + 240, y);
      doc.setFontSize(9); doc.text(label, x, y + 11);
      doc.line(x, y + 36, x + 240, y + 36);
      doc.text('Date / Time', x, y + 47);
    }
    sig(pt.rel, L); sig(pt.rec, 332);

    // Labels: one landscape page per pallet
    lines.forEach(function(p, i){
      doc.addPage('letter', 'landscape');
      drawLabel(doc, t, p, i + 1, n, pt.route, dateStr);
    });

    // Page numbers
    var pages = doc.getNumberOfPages();
    for(var pg = 1; pg <= pages; pg++){
      doc.setPage(pg);
      var w = doc.internal.pageSize.getWidth(), h = doc.internal.pageSize.getHeight();
      doc.setFont('helvetica','normal'); doc.setFontSize(7.5); doc.setTextColor(120);
      doc.text(t.transfer_number + '  page ' + pg + ' of ' + pages, w - 30, h - 8, { align: 'right' });
      doc.setTextColor(0);
    }
    return doc;
  }

  function drawLabel(doc, t, p, idx, n, route, dateStr){
    var s = p.sku || {}, l = p.lot || {};
    var W = 792, H = 612;
    doc.setDrawColor(0); doc.setLineWidth(7); doc.rect(20, 20, W - 40, H - 40);
    doc.setTextColor(0);
    // Product
    doc.setFont('helvetica','bold');
    var name = fitText(doc, String(s.description || '').toUpperCase(), W - 100, 44, 24);
    doc.text(name, 48, 84);
    doc.setFont('helvetica','normal');
    var sub = [s.brand || (s.client && s.client.name) || ownerName(t.client), s.pack || '', s.units_per_case ? s.units_per_case + ' units / case' : '']
      .filter(Boolean).join('  |  ');
    doc.setFontSize(19); doc.text(cellText(doc, sub, W - 100), 48, 114);
    doc.setLineWidth(2); doc.line(40, 130, W - 40, 130);

    // Data rows
    var rows = [['UPC', s.upc_sku || ''], ['LOT', l.lot_number || '-'], ['PROD DATE', fmtDate(l.production_date) || '-'],
                ['BEST BY', fmtDate(l.best_by_date) || '-'], ['CASES', fmtInt(p.cases)]];
    var y = 178;
    rows.forEach(function(r){
      doc.setFont('helvetica','bold'); doc.setFontSize(15); doc.setTextColor(70);
      doc.text(r[0], 48, y);
      doc.setTextColor(0); doc.setFontSize(36);
      doc.text(cellText(doc, r[1], 330), 190, y + 2);
      y += 52;
    });
    if(s.inventory_type === 'empty_can'){
      doc.setFontSize(13); doc.setFont('helvetica','bold');
      doc.text('EMPTY CANS  |  FLOOR STACK' + (p.expected_pull_date ? '  |  PULL ' + fmtMD(p.expected_pull_date) : ''), 48, y - 18);
    } else if(s.inventory_type === 'packaging'){
      doc.setFontSize(13); doc.setFont('helvetica','bold');
      doc.text('PACKAGING SUPPLIES  |  PROPERTY OF GOOD LIQUID BEV CO', 48, y - 18);
    }

    // Pallet number
    doc.setLineWidth(2); doc.line(540, 150, 540, 420);
    doc.setFont('helvetica','bold'); doc.setFontSize(96);
    doc.text(idx + '/' + n, 656, 300, { align: 'center' });
    doc.setFontSize(24); doc.text('PALLET', 656, 336, { align: 'center' });
    if(p.notes){
      doc.setFont('helvetica','bold'); doc.setFontSize(11); doc.setTextColor(70);
      doc.text('NOTE', 556, 366);
      doc.setTextColor(0); doc.setFont('helvetica','normal'); doc.setFontSize(12);
      var nl = doc.splitTextToSize(String(p.notes), 190).slice(0, 4);
      if(doc.splitTextToSize(String(p.notes), 190).length > 4) nl[3] = cellText(doc, nl[3] + '...', 190);
      doc.text(nl, 556, 382);
    }

    // Barcode of the pallet tag
    var bw = drawBarcode(doc, p.pallet_tag, 48, 440, 440, 78);
    doc.setFont('helvetica','bold'); doc.setFontSize(14);
    doc.text('LOT ' + (l.lot_number || '-') + '     ' + p.pallet_tag, 48 + bw / 2, 538, { align: 'center' });

    // Footer
    doc.setLineWidth(1); doc.line(40, 556, W - 40, 556);
    doc.setFont('helvetica','normal'); doc.setFontSize(12);
    doc.text(t.transfer_number + '   |   ' + dateStr + '   |   ' + route, W / 2, 576, { align: 'center' });
  }

  window.glWhBuildPaperworkPdf = function(jsPDF, t, lines){ return buildPaperwork(jsPDF, t, lines); };

  // One landscape letter page per pallet, readable from across the dock:
  // the pallet number is the biggest thing on the page.
  function buildBolSheets(jsPDF, info){
    var doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' });
    var W = 792, H = 612, n = info.pallets;
    var dateStr = fmtDate(info.date);
    var shipTo = String(info.shipto || '').split(/\r?\n/).map(function(x){ return x.trim(); }).filter(Boolean).slice(0, 4);
    var canBarcode = /^[\x20-\x7e]{1,30}$/.test(info.bol);
    for(var i = 1; i <= n; i++){
      if(i > 1) doc.addPage('letter', 'landscape');
      doc.setTextColor(0); doc.setDrawColor(0);
      doc.setLineWidth(7); doc.rect(20, 20, W - 40, H - 40);

      // Pallet X of N, top right
      doc.setFont('helvetica','bold'); doc.setFontSize(26);
      doc.text('PALLET', 590, 78, { align: 'center' });
      var big = i + ' OF ' + n;
      var bigTxt = fitText(doc, big, 300, 120, 60);
      doc.text(bigTxt, 590, 190, { align: 'center' });

      // Client / product, top left
      doc.setFontSize(30);
      doc.text(fitText(doc, String(info.client || 'SHIPMENT').toUpperCase(), 380, 30, 16), 48, 78);
      doc.setFont('helvetica','normal');
      if(info.product){ doc.setFontSize(18); doc.text(cellText(doc, info.product, 380), 48, 106); }

      // BOL / PO
      doc.setFont('helvetica','bold'); doc.setFontSize(14); doc.setTextColor(70);
      doc.text('BOL #', 48, 150);
      doc.setTextColor(0); doc.setFontSize(34);
      doc.text(fitText(doc, info.bol, 330, 34, 16), 48, 186);
      if(info.po){
        doc.setFontSize(14); doc.setTextColor(70); doc.text('PO #', 48, 220);
        doc.setTextColor(0); doc.setFontSize(24); doc.text(fitText(doc, info.po, 330, 24, 12), 48, 248);
      }

      doc.setLineWidth(2); doc.line(40, 270, W - 40, 270);

      // Ship to (left) / details (right)
      doc.setFont('helvetica','bold'); doc.setFontSize(14); doc.setTextColor(70);
      doc.text('SHIP TO', 48, 298);
      doc.setTextColor(0);
      (shipTo.length ? shipTo : ['-']).forEach(function(line, j){
        doc.setFont('helvetica', j === 0 ? 'bold' : 'normal');
        doc.text(fitText(doc, line, 380, j === 0 ? 24 : 18, 11), 48, 328 + j * 26);
      });
      var rows = [['SHIP DATE', dateStr || '-'], ['CARRIER', info.carrier || '-'], ['LOT', info.lot || '-'],
                  ['CASES', info.cases != null ? fmtInt(info.cases) : '-']];
      var y = 298;
      rows.forEach(function(r){
        doc.setFont('helvetica','bold'); doc.setFontSize(13); doc.setTextColor(70);
        doc.text(r[0], 460, y);
        doc.setTextColor(0); doc.setFontSize(22);
        doc.text(cellText(doc, r[1], 200), 560, y + 1);
        y += 38;
      });

      // Barcode of the BOL number
      if(canBarcode){
        var bw = drawBarcode(doc, info.bol, 48, 460, 400, 56);
        doc.setFont('helvetica','bold'); doc.setFontSize(12);
        doc.text(info.bol, 48 + bw / 2, 532, { align: 'center' });
      }

      // Footer
      doc.setLineWidth(1); doc.line(40, 552, W - 40, 552);
      doc.setFont('helvetica','normal'); doc.setFontSize(12);
      doc.text('FROM: ' + GL.name + ', ' + GL.street + ', ' + GL.city + '   |   BOL ' + cellText(doc, info.bol, 120) + '   |   Pallet ' + i + ' of ' + n,
        W / 2, 574, { align: 'center' });
    }
    return doc;
  }
  window.glWhBuildBolSheetsPdf = function(jsPDF, info){ return buildBolSheets(jsPDF, info); };

  async function printPaperwork(id){
    try {
      if(typeof window.ensureJsPdf !== 'function') throw new Error('PDF engine not available on this page.');
      var jsPDF = await window.ensureJsPdf();
      var d = await loadTransfer(id);
      if(!d.lines.length){ alert('Add pallets first.'); return; }
      var doc = buildPaperwork(jsPDF, d.t, d.lines);
      doc.save(d.t.transfer_number + '_paperwork.pdf');
      audit('wh_paperwork_printed', d.t.transfer_number, { pallets: d.lines.length });
    } catch(e){ alert('Could not build the PDF: ' + errMsg(e)); }
  }

  // ════════════════════════════════════════════════════════════
  // Actions (module-private allowlist) + delegated listener
  // ════════════════════════════════════════════════════════════
  var ACTIONS = {
    tab: function(a){ state.tab = a; window.glRenderWarehouse(); },
    closeOverlay: function(a, a2, el){ var ov = el.closest('.wh-ov'); if(ov) ov.remove(); },
    newTransfer: function(){ loadClients().then(openNewTransfer).catch(function(e){ alert(errMsg(e)); }); },
    openTransfer: function(a){ var ov = document.querySelector('.wh-ov'); if(ov) ov.remove(); openTransfer(a); },
    editTransfer: function(a){ return editTransfer(a); },
    scheduleTransfer: function(a){ return scheduleTransfer(a); },
    unscheduleTransfer: function(a){ return setStatus(a, 'draft', null, 'Back to draft'); },
    completeTransfer: function(a){ return completeTransfer(a); },
    cancelTransfer: function(a){ return cancelTransfer(a); },
    editPalletNote: function(a, a2){ return editPalletNote(a, a2); },
    removeLine: function(a, a2){ if(confirm('Remove this pallet from the transfer?')) return removeLine(a, a2); },
    quickBuild: function(a){ return quickBuild(a); },
    pickPallets: function(a){ return pickPallets(a); },
    printPaperwork: function(a){ return printPaperwork(a); },
    schedEmail: function(a){ return schedEmail(a); },
    uploadSigned: function(a){ return uploadSignedAfter(a); },
    viewSigned: function(a){ return viewSigned(a); },
    newSku: function(){ return editSku(null); },
    editSku: function(a){ return editSku(a); },
    addLot: function(a){ return addLot(a); },
    toggleLot: function(a, a2){ return toggleLot(a, a2); },
    exportSkus: function(){ return exportSkus(); },
    newOrder: function(){ return loadClients().then(function(){ return newOrder(); }); },
    shipSku: function(a, a2){ return loadClients().then(function(){ return newOrder({ client: a, sku: a2 }); }); },
    orderEmail: function(a){ return orderEmail(a); },
    shipOrder: function(a){ return shipOrder(a); },
    printBolSheets: function(){ return printBolSheets(); },
    clearBol: function(){ state.bol = null; state.bolNote = null; state.bolFilled = []; renderBol(); }
  };

  document.addEventListener('click', function(e){
    var el = e.target && e.target.closest ? e.target.closest('[data-wh]') : null;
    if(!el) return;
    if(!el.closest('#cpg-warehouse') && !el.closest('.wh-ov')) return;
    if(el.disabled) return;
    var fn = ACTIONS[el.getAttribute('data-wh')];
    if(!fn){ console.error('[warehouse] unknown action ' + el.getAttribute('data-wh')); return; }
    e.preventDefault();
    Promise.resolve().then(function(){
      return fn(el.getAttribute('data-arg'), el.getAttribute('data-arg2'), el);
    }).catch(function(err){ alert(errMsg(err)); });
  });

  // Exposed for tests: pure functions only.
  window.glWhInternals = { parseCsv: parseCsv, reconcile: reconcile, skuCsv: skuCsv, allocateFefo: allocateFefo,
    sortFefo: sortFefo, scheduleEmailText: scheduleEmailText, lineIssues: lineIssues, upcWarning: upcWarning, fmtDate: fmtDate, bolInput: bolInput, bolFromAi: bolFromAi };

  // Render when the page is opened. cNav hooks run after the page is shown.
  function boot(){
    if(window.GL_HOOKS && typeof window.GL_HOOKS.registerNavHook === 'function'){
      window.GL_HOOKS.registerNavHook(function(page){ if(page === 'warehouse') window.glRenderWarehouse(); });
    } else if(window.GL_HOOKS && window.GL_HOOKS._navHooks){
      window.GL_HOOKS._navHooks.push(function(page){ if(page === 'warehouse') window.glRenderWarehouse(); });
    }
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

  console.log('[GL] warehouse storage module loaded');
}());
