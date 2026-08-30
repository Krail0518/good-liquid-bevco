/* ============================================================
   formulation.js — formulation house + spend, per record
   ============================================================
   Mike refers brands out to third-party formulation houses and needs to
   record, on both a pipeline deal and a client:
     • did formulation happen at all      → formulation_done   (bool)
     • which house did it                 → formulation_vendor (text)
     • what the brand spent with them     → formulation_spend  (numeric)
     • the cut Mike takes on that spend   → formulation_pct    (numeric)

   Revenue = spend x pct / 100, derived on read so a corrected spend can
   never drift from a stored dollar figure. The dashboard section totals it
   across clients and open leads.

   The house list is a table (public.formulators), not a hard-coded array,
   so staff can add a new formulator from the dropdown without a migration.
   The picked name is stored as text on the deal/client row: renaming or
   retiring a house must never rewrite history. The dropdown is what keeps
   the spelling consistent, which is what makes totals per house add up.

   Exposes:
     window.glLoadFormulators(force)    — cached list of active house names
     window.glFormulationBlock(rec,pfx) — form HTML (checkbox + house + $)
     window.glFormulationBind(pfx)      — fills the house list, wires handlers
     window.glFormulationRead(pfx)      — {done, vendor, spend} from the form
     window.glFormulationSummary(rec)   — read-only HTML ('' when not done)
     window.glFormulationRevenue(rec)   — spend x pct / 100, or null
     window.glRenderFormulationDash()   — the dashboard revenue section

   Field ids are '<prefix>-done' / '-vendor' / '-spend', so the same block
   works in the deal panel and the client editor without colliding.
   ============================================================ */
(function(){
  'use strict';

  var ADD_SENTINEL = '__gl_add_formulator__';

  function sb(){ return window.supa || null; }

  function esc(s){
    return String(s == null ? '' : s).replace(/[<>&"]/g, function(c){
      return { '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;' }[c];
    });
  }

  // Accepts either the camelCase shape the CRM keeps in memory or the raw
  // snake_case row straight from Postgres, so callers can pass either.
  function read(rec, camel, snake){
    if(!rec) return null;
    return rec[camel] != null ? rec[camel] : (rec[snake] != null ? rec[snake] : null);
  }
  function recDone(rec){   return !!read(rec, 'formulationDone',   'formulation_done'); }
  function recVendor(rec){ return read(rec, 'formulationVendor', 'formulation_vendor') || ''; }
  function recSpend(rec){
    var v = read(rec, 'formulationSpend', 'formulation_spend');
    if(v === null || v === '') return null;
    var n = parseFloat(v);
    return isNaN(n) ? null : n;
  }

  function recPct(rec){
    var v = read(rec, 'formulationPct', 'formulation_pct');
    if(v === null || v === '') return null;
    var n = parseFloat(v);
    return isNaN(n) ? null : n;
  }
  // The money the referral earned. null (not 0) when either half is missing —
  // an unset rate is an unknown, and calling it zero would quietly understate
  // the total with nothing on screen to say so.
  window.glFormulationRevenue = function glFormulationRevenue(rec){
    if(!recDone(rec)) return null;
    var spend = recSpend(rec), pct = recPct(rec);
    if(spend == null || pct == null) return null;
    return Math.round(spend * pct) / 100;
  };

  function money(n){
    if(n == null || isNaN(n)) return '';
    try { return '$' + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
    catch(e){ return '$' + n; }
  }

  // ── The house list ──────────────────────────────────────────
  var CACHE = null;

  // Only a load that actually reached the server may fill CACHE.
  //
  // This used to do `CACHE = CACHE || []` when Supabase was not ready yet, and
  // again when the fetch threw. [] is truthy, so the `if(CACHE && !force)`
  // guard above then short-circuited on every later call and the house list
  // stayed empty for the rest of the session. One early call — the warm-up
  // poll, or any form that binds before the client is up — was enough.
  //
  // The visible damage was on deals: an empty dropdown never seeds, ticking
  // "formulation done" cannot auto-pick a house, and the deal saves with
  // formulation_vendor: null. Formulation revenue was attributed to no one.
  // Leaving CACHE null instead means the next call simply retries.
  window.glLoadFormulators = async function glLoadFormulators(force){
    if(CACHE && !force) return CACHE;
    if(!sb()) return CACHE || [];
    try {
      var r = await sb().from('formulators').select('name,active,sort_order')
        .eq('active', true).order('sort_order', { ascending: true }).order('name', { ascending: true });
      if(r.error) throw r.error;
      CACHE = (r.data || []).map(function(f){ return f.name; }).filter(Boolean);
    } catch(e){
      console.warn('[GL] formulators load failed', e);
      return CACHE || [];
    }
    return CACHE;
  };

  // Adds a house and returns its name, or null if the server refused. A 0-row
  // insert is a silent RLS rejection, not a success — see CLAUDE.md rule #4.
  window.glAddFormulator = async function glAddFormulator(name){
    name = String(name == null ? '' : name).trim();
    if(!name) return null;
    if(!sb()){ alert('Supabase not ready.'); return null; }
    var existing = (CACHE || []).find(function(n){ return n.toLowerCase() === name.toLowerCase(); });
    if(existing) return existing;
    try {
      var r = await sb().from('formulators').insert([{ name: name }]).select();
      if(r.error){
        // Unique violation: someone added it already (or it is inactive).
        if(r.error.code === '23505'){ await window.glLoadFormulators(true); return name; }
        throw r.error;
      }
      if(Array.isArray(r.data) && r.data.length === 0) throw new Error('the server rejected the write (0 rows added)');
      await window.glLoadFormulators(true);
      if(typeof window.glAudit === 'function') window.glAudit('formulator_added', name, {});
      return name;
    } catch(e){
      alert('Could not add that formulator: ' + (e.message || e));
      return null;
    }
  };

  // ── Form block ──────────────────────────────────────────────
  function vendorOptions(selected){
    var names = (CACHE || []).slice();
    // Keep a house that has since been retired or renamed visible on the record
    // that references it, so opening an old deal never silently blanks it.
    if(selected && names.indexOf(selected) === -1) names.unshift(selected);
    var opts = '<option value="">Select formulator…</option>';
    opts += names.map(function(n){
      return '<option value="'+esc(n)+'"'+(n === selected ? ' selected' : '')+'>'+esc(n)+'</option>';
    }).join('');
    opts += '<option value="'+ADD_SENTINEL+'">＋ Add formulator…</option>';
    return opts;
  }

  window.glFormulationBlock = function glFormulationBlock(rec, prefix){
    prefix = prefix || 'gl-form';
    var done = recDone(rec), vendor = recVendor(rec), spend = recSpend(rec), pct = recPct(rec);
    var label = 'font-size:10px;letter-spacing:2px;color:var(--muted);margin-bottom:5px';
    var input = 'width:100%;padding:10px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:8px;color:var(--white);font-size:14px;font-family:var(--ff-body)';
    return '' +
      '<div style="background:rgba(196,164,248,.05);border:1px solid rgba(196,164,248,.22);border-radius:8px;padding:12px">' +
        '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;color:var(--white)">' +
          '<input type="checkbox" id="'+esc(prefix)+'-done"'+(done?' checked':'')+' style="accent-color:#c4a4f8;width:16px;height:16px;cursor:pointer">' +
          '🧪 Formulation done' +
        '</label>' +
        '<div id="'+esc(prefix)+'-fields" style="display:'+(done?'grid':'none')+';grid-template-columns:1.4fr 1fr .8fr;gap:10px;margin-top:10px">' +
          '<div>' +
            '<div style="'+label+'">FORMULATOR</div>' +
            '<select id="'+esc(prefix)+'-vendor" style="'+input+'">'+vendorOptions(vendor)+'</select>' +
          '</div>' +
          '<div>' +
            '<div style="'+label+'">THEY SPENT ($)</div>' +
            '<input id="'+esc(prefix)+'-spend" type="number" min="0" step="0.01" value="'+esc(spend == null ? '' : spend)+'" placeholder="0.00" style="'+input+'">' +
          '</div>' +
          '<div>' +
            '<div style="'+label+'">MY CUT (%)</div>' +
            '<input id="'+esc(prefix)+'-pct" type="number" min="0" max="100" step="0.01" value="'+esc(pct == null ? '' : pct)+'" placeholder="0" style="'+input+'">' +
          '</div>' +
        '</div>' +
        '<div id="'+esc(prefix)+'-calc" style="display:'+(done?'block':'none')+';font-size:12px;color:#c4a4f8;margin-top:8px"></div>' +
      '</div>';
  };

  // Loads the house list into the select and wires the checkbox + "add" flow.
  // Safe to call before the list has loaded — it repaints the options itself.
  window.glFormulationBind = async function glFormulationBind(prefix){
    prefix = prefix || 'gl-form';
    var cb  = document.getElementById(prefix + '-done');
    var box = document.getElementById(prefix + '-fields');
    var sel = document.getElementById(prefix + '-vendor');
    if(!cb || !box || !sel) return;

    var amt  = document.getElementById(prefix + '-spend');
    var pct  = document.getElementById(prefix + '-pct');
    var calc = document.getElementById(prefix + '-calc');

    // Shows the money the rate works out to, so a mistyped percentage is
    // obvious while typing rather than after it lands in the dashboard total.
    function repaintCalc(){
      if(!calc) return;
      calc.style.display = cb.checked ? 'block' : 'none';
      if(!cb.checked){ calc.textContent = ''; return; }
      var s = amt && String(amt.value).trim() !== '' ? parseFloat(amt.value) : null;
      var p = pct && String(pct.value).trim() !== '' ? parseFloat(pct.value) : null;
      if(s == null || isNaN(s) || p == null || isNaN(p)){
        calc.textContent = p == null || isNaN(p)
          ? 'Set your % to count this toward formulation revenue.'
          : 'Enter what they spent to see your cut.';
        return;
      }
      calc.textContent = 'Your cut: ' + money(Math.round(s * p) / 100) + '  (' + p + '% of ' + money(s) + ')';
    }
    if(amt) amt.addEventListener('input', repaintCalc);
    if(pct) pct.addEventListener('input', repaintCalc);

    cb.addEventListener('change', function(){
      box.style.display = cb.checked ? 'grid' : 'none';
      repaintCalc();
      // Ticking the box with nothing picked lands on the first house rather
      // than an empty select the user has to notice and fill in.
      if(cb.checked && !sel.value && (CACHE || []).length) sel.value = CACHE[0];
    });

    var lastVendor = sel.value;
    sel.addEventListener('change', async function(){
      if(sel.value !== ADD_SENTINEL){ lastVendor = sel.value; return; }
      sel.value = lastVendor;                       // never leave the sentinel selected
      var name = window.prompt('Formulation house name:');
      if(name == null) return;
      var added = await window.glAddFormulator(name);
      if(!added) return;
      sel.innerHTML = vendorOptions(added);
      sel.value = added;
      lastVendor = added;
    });

    // Repaint once the list arrives, preserving whatever this record already
    // points at (the block renders before the fetch can finish).
    await window.glLoadFormulators();
    var keep = sel.value && sel.value !== ADD_SENTINEL ? sel.value : '';
    sel.innerHTML = vendorOptions(keep);
    if(keep) sel.value = keep;
    lastVendor = sel.value;
    repaintCalc();
  };

  // ── Reading the form back ───────────────────────────────────
  window.glFormulationRead = function glFormulationRead(prefix){
    prefix = prefix || 'gl-form';
    var cb  = document.getElementById(prefix + '-done');
    var sel = document.getElementById(prefix + '-vendor');
    var amt = document.getElementById(prefix + '-spend');
    var pctEl = document.getElementById(prefix + '-pct');
    if(!cb) return null;                            // block not on this form
    var done = !!cb.checked;
    var vendor = sel && sel.value && sel.value !== ADD_SENTINEL ? sel.value : '';
    var spend = null;
    if(amt && String(amt.value).trim() !== ''){
      var n = parseFloat(amt.value);
      // The DB rejects a negative spend; clamp here so the save doesn't bounce.
      if(!isNaN(n) && n >= 0) spend = Math.round(n * 100) / 100;
    }
    var pct = null;
    if(pctEl && String(pctEl.value).trim() !== ''){
      var q = parseFloat(pctEl.value);
      // 0–100 is the DB CHECK; anything outside is a typo, not a rate.
      if(!isNaN(q) && q >= 0 && q <= 100) pct = Math.round(q * 100) / 100;
    }
    // Unticking clears the set, so stale figures can't linger unseen.
    if(!done) return { done: false, vendor: null, spend: null, pct: null };
    return { done: true, vendor: vendor || null, spend: spend, pct: pct };
  };

  // ── Read-only summary (view panels) ─────────────────────────
  window.glFormulationSummary = function glFormulationSummary(rec){
    if(!recDone(rec)) return '';
    var vendor = recVendor(rec), spend = recSpend(rec);
    var bits = '<span style="padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;background:rgba(196,164,248,.14);color:#c4a4f8;border:1px solid rgba(196,164,248,.35)">🧪 ' +
      esc(vendor || 'Formulation') + '</span>';
    if(spend != null) bits += ' <span style="font-size:13px;color:var(--white)">' + esc(money(spend)) + ' spent</span>';
    var rev = window.glFormulationRevenue(rec);
    if(rev != null) bits += ' <span style="font-size:12.5px;color:#5fcf9e">· ' + esc(money(rev)) + ' to you (' + esc(recPct(rec)) + '%)</span>';
    else if(spend != null) bits += ' <span style="font-size:12px;color:#f5c842">· % not set</span>';
    return '<div style="padding:7px 0;border-bottom:1px solid rgba(255,255,255,.05)">' +
      '<span style="font-size:10px;letter-spacing:1px;color:var(--muted);display:block;margin-bottom:4px">FORMULATION</span>' +
      bits + '</div>';
  };

  // ── Dashboard: revenue generated from formulation ───────────
  // Sums the cut across clients and open leads. The two are separate tables
  // with nothing linking them: converting a lead creates a client but never
  // sets deals.client_id, so a converted brand can carry formulation on BOTH
  // rows. Counting both would inflate the one number this section exists to
  // report, so a lead whose company matches a client that also has
  // formulation recorded is skipped, and the count of skips is shown.
  function norm(x){ return String(x == null ? '' : x).trim().toLowerCase().replace(/\s+/g,' '); }

  function collect(){
    var clientRows = (window.clients || []).filter(recDone).map(function(c){
      return { source:'client', label:c.name || '(unnamed client)', rec:c };
    });
    var byName = {}, byEmail = {};
    clientRows.forEach(function(r){
      if(norm(r.rec.name)) byName[norm(r.rec.name)] = 1;
      if(norm(r.rec.email)) byEmail[norm(r.rec.email)] = 1;
    });

    var leadRows = [], skipped = 0;
    Object.keys(window.deals || {}).forEach(function(stage){
      (window.deals[stage] || []).forEach(function(d){
        if(!recDone(d)) return;
        var nm = norm(d.co) || norm(d.name);
        if((nm && byName[nm]) || (norm(d.email) && byEmail[norm(d.email)])){ skipped++; return; }
        leadRows.push({ source:'lead', label:(d.co || d.name || '(unnamed lead)'), stage:stage, rec:d });
      });
    });
    return { rows: clientRows.concat(leadRows), clientRows: clientRows, leadRows: leadRows, skipped: skipped };
  }

  function sum(rows, fn){ return rows.reduce(function(a,r){ var v = fn(r); return a + (v == null ? 0 : v); }, 0); }

  window.glRenderFormulationDash = function glRenderFormulationDash(){
    var host = document.getElementById('dash-formulation');
    if(!host) return;

    var got = collect();
    if(!got.rows.length){
      host.innerHTML = '<div class="ccard"><div class="ccard-t">🧪 Formulation revenue</div>' +
        '<div style="font-size:12.5px;color:#9aa7bd;line-height:1.6">Nothing recorded yet. Tick <b>Formulation done</b> on a client or a pipeline deal, pick the house, and enter what they spent plus your %.</div></div>';
      return;
    }

    var revenue = sum(got.rows, function(r){ return window.glFormulationRevenue(r.rec); });
    var spend   = sum(got.rows, function(r){ return recSpend(r.rec); });
    var noPct   = got.rows.filter(function(r){ return recSpend(r.rec) != null && recPct(r.rec) == null; }).length;
    var noSpend = got.rows.filter(function(r){ return recSpend(r.rec) == null; }).length;

    // Per-house breakdown.
    var houses = {};
    got.rows.forEach(function(r){
      var v = recVendor(r.rec) || '(no house named)';
      var h = houses[v] || (houses[v] = { vendor:v, n:0, spend:0, revenue:0 });
      h.n++;
      var sp = recSpend(r.rec); if(sp != null) h.spend += sp;
      var rv = window.glFormulationRevenue(r.rec); if(rv != null) h.revenue += rv;
    });
    var houseList = Object.keys(houses).map(function(k){ return houses[k]; })
      .sort(function(a,b){ return b.revenue - a.revenue || b.spend - a.spend; });

    var td = 'padding:7px 10px;font-size:12.5px;border-top:1px solid rgba(255,255,255,.06)';
    var th = 'padding:6px 10px;font-size:10px;letter-spacing:1.2px;color:#9aa7bd;text-align:left';

    var rowsHtml = houseList.map(function(h){
      return '<tr>' +
        '<td style="'+td+';color:#eef4ff;font-weight:600">' + esc(h.vendor) + '</td>' +
        '<td style="'+td+';color:#9aa7bd;text-align:center">' + h.n + '</td>' +
        '<td style="'+td+';color:#dfe7f1;text-align:right">' + esc(money(h.spend)) + '</td>' +
        '<td style="'+td+';color:#5fcf9e;text-align:right;font-weight:700">' + esc(money(h.revenue)) + '</td>' +
      '</tr>';
    }).join('');

    var notes = [];
    notes.push('From clients ' + money(sum(got.clientRows, function(r){ return window.glFormulationRevenue(r.rec); })) +
               ' · from open leads ' + money(sum(got.leadRows, function(r){ return window.glFormulationRevenue(r.rec); })));
    if(noPct)   notes.push('<span style="color:#f5c842">' + noPct + ' record' + (noPct===1?'':'s') + ' with a spend but no % — not counted in revenue.</span>');
    if(noSpend) notes.push('<span style="color:#f5c842">' + noSpend + ' record' + (noSpend===1?'':'s') + ' ticked with no amount entered.</span>');
    if(got.skipped) notes.push(got.skipped + ' converted lead' + (got.skipped===1?'':'s') + ' skipped — already counted as clients.');

    host.innerHTML =
      '<div class="ccard">' +
        '<div class="ccard-t">🧪 Formulation revenue</div>' +
        '<div style="display:flex;gap:26px;flex-wrap:wrap;align-items:flex-end;margin-bottom:12px">' +
          '<div>' +
            '<div style="font-size:10px;letter-spacing:1.5px;color:#9aa7bd;margin-bottom:3px">YOUR CUT</div>' +
            '<div style="font-family:var(--ff-disp);font-size:28px;color:#5fcf9e;line-height:1">' + esc(money(revenue)) + '</div>' +
          '</div>' +
          '<div>' +
            '<div style="font-size:10px;letter-spacing:1.5px;color:#9aa7bd;margin-bottom:3px">REFERRED SPEND</div>' +
            '<div style="font-family:var(--ff-disp);font-size:20px;color:#c4a4f8;line-height:1">' + esc(money(spend)) + '</div>' +
          '</div>' +
          '<div>' +
            '<div style="font-size:10px;letter-spacing:1.5px;color:#9aa7bd;margin-bottom:3px">REFERRALS</div>' +
            '<div style="font-family:var(--ff-disp);font-size:20px;color:#dfe7f1;line-height:1">' + got.rows.length + '</div>' +
          '</div>' +
        '</div>' +
        '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">' +
          '<thead><tr><th style="'+th+'">FORMULATOR</th><th style="'+th+';text-align:center">REFERRALS</th>' +
          '<th style="'+th+';text-align:right">SPEND</th><th style="'+th+';text-align:right">YOUR CUT</th></tr></thead>' +
          '<tbody>' + rowsHtml + '</tbody>' +
        '</table></div>' +
        '<div style="font-size:11.5px;color:#9aa7bd;margin-top:10px;line-height:1.7">' + notes.join('<br>') + '</div>' +
      '</div>';
  };

  if(window.GL_HOOKS && typeof window.GL_HOOKS.registerDashPatch === 'function'){
    window.GL_HOOKS.registerDashPatch(function(){
      try { window.glRenderFormulationDash(); }
      catch(e){ console.warn('[GL] formulation dash threw', e); }
    });
  }

  // Warm the cache once Supabase is up so the first dropdown paints filled.
  (function warm(){
    var tries = 0;
    var t = setInterval(function(){
      // Wait for a staff session as well as for Supabase: formulators is a
      // staff-only table and this warm-up fired on the public site (GL-052).
      if(sb() && window.currentUser){ clearInterval(t); window.glLoadFormulators(); return; }
      if(++tries > 40) clearInterval(t);
    }, 250);
  }());

  console.log('[GL] formulation tracking module loaded');
}());
