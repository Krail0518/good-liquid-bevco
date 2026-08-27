/* ============================================================
   crm-formulation.js — formulation house + spend, per record
   ============================================================
   Mike refers brands out to third-party formulation houses and needs to
   record, on both a pipeline deal and a client:
     • did formulation happen at all      → formulation_done   (bool)
     • which house did it                 → formulation_vendor (text)
     • what the brand spent with them     → formulation_spend  (numeric)

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

  function money(n){
    if(n == null || isNaN(n)) return '';
    try { return '$' + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
    catch(e){ return '$' + n; }
  }

  // ── The house list ──────────────────────────────────────────
  var CACHE = null;

  window.glLoadFormulators = async function glLoadFormulators(force){
    if(CACHE && !force) return CACHE;
    if(!sb()) return (CACHE = CACHE || []);
    try {
      var r = await sb().from('formulators').select('name,active,sort_order')
        .eq('active', true).order('sort_order', { ascending: true }).order('name', { ascending: true });
      if(r.error) throw r.error;
      CACHE = (r.data || []).map(function(f){ return f.name; }).filter(Boolean);
    } catch(e){
      console.warn('[GL] formulators load failed', e);
      CACHE = CACHE || [];
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
    var done = recDone(rec), vendor = recVendor(rec), spend = recSpend(rec);
    var label = 'font-size:10px;letter-spacing:2px;color:var(--muted);margin-bottom:5px';
    var input = 'width:100%;padding:10px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:8px;color:var(--white);font-size:14px;font-family:var(--ff-body)';
    return '' +
      '<div style="background:rgba(196,164,248,.05);border:1px solid rgba(196,164,248,.22);border-radius:8px;padding:12px">' +
        '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;color:var(--white)">' +
          '<input type="checkbox" id="'+esc(prefix)+'-done"'+(done?' checked':'')+' style="accent-color:#c4a4f8;width:16px;height:16px;cursor:pointer">' +
          '🧪 Formulation done' +
        '</label>' +
        '<div id="'+esc(prefix)+'-fields" style="display:'+(done?'grid':'none')+';grid-template-columns:1fr 1fr;gap:10px;margin-top:10px">' +
          '<div>' +
            '<div style="'+label+'">FORMULATOR</div>' +
            '<select id="'+esc(prefix)+'-vendor" style="'+input+'">'+vendorOptions(vendor)+'</select>' +
          '</div>' +
          '<div>' +
            '<div style="'+label+'">THEY SPENT ($)</div>' +
            '<input id="'+esc(prefix)+'-spend" type="number" min="0" step="0.01" value="'+esc(spend == null ? '' : spend)+'" placeholder="0.00" style="'+input+'">' +
          '</div>' +
        '</div>' +
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

    cb.addEventListener('change', function(){
      box.style.display = cb.checked ? 'grid' : 'none';
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
  };

  // ── Reading the form back ───────────────────────────────────
  window.glFormulationRead = function glFormulationRead(prefix){
    prefix = prefix || 'gl-form';
    var cb  = document.getElementById(prefix + '-done');
    var sel = document.getElementById(prefix + '-vendor');
    var amt = document.getElementById(prefix + '-spend');
    if(!cb) return null;                            // block not on this form
    var done = !!cb.checked;
    var vendor = sel && sel.value && sel.value !== ADD_SENTINEL ? sel.value : '';
    var spend = null;
    if(amt && String(amt.value).trim() !== ''){
      var n = parseFloat(amt.value);
      // The DB rejects a negative spend; clamp here so the save doesn't bounce.
      if(!isNaN(n) && n >= 0) spend = Math.round(n * 100) / 100;
    }
    // Unticking clears the pair, so a stale house/amount can't linger unseen.
    if(!done) return { done: false, vendor: null, spend: null };
    return { done: true, vendor: vendor || null, spend: spend };
  };

  // ── Read-only summary (view panels) ─────────────────────────
  window.glFormulationSummary = function glFormulationSummary(rec){
    if(!recDone(rec)) return '';
    var vendor = recVendor(rec), spend = recSpend(rec);
    var bits = '<span style="padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;background:rgba(196,164,248,.14);color:#c4a4f8;border:1px solid rgba(196,164,248,.35)">🧪 ' +
      esc(vendor || 'Formulation') + '</span>';
    if(spend != null) bits += ' <span style="font-size:13px;color:var(--white)">' + esc(money(spend)) + ' spent</span>';
    return '<div style="padding:7px 0;border-bottom:1px solid rgba(255,255,255,.05)">' +
      '<span style="font-size:10px;letter-spacing:1px;color:var(--muted);display:block;margin-bottom:4px">FORMULATION</span>' +
      bits + '</div>';
  };

  // Warm the cache once Supabase is up so the first dropdown paints filled.
  (function warm(){
    var tries = 0;
    var t = setInterval(function(){
      if(sb()){ clearInterval(t); window.glLoadFormulators(); return; }
      if(++tries > 40) clearInterval(t);
    }, 250);
  }());

  console.log('[GL] formulation tracking module loaded');
}());
