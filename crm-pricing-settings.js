/* ============================================================
   PRICING SETTINGS — staff-editable flat / add-on prices.
   Reads & writes the public.pricing_settings table so Mike can
   adjust nitrogen, pasteurization, case trays, the case erector,
   pallets + wrap, keg fill, R&D / IP / benchtop, and bottling
   add-ons himself — no code change, no going through the assistant.

   The volume tier ladders (per-can / per-unit by volume) stay in
   canning_rates / bottling_rates, editable from the existing
   "$ Pricing" screen (glOpenPricing); this editor links to it.
   ============================================================ */
(function(){
  'use strict';
  var esc = window.glEsc || function(s){
    return String(s==null?'':s).replace(/[&<>"]/g,function(c){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];
    });
  };

  window._glPricing      = window._glPricing || {};   // key -> numeric value
  window._glPricingRows  = window._glPricingRows || [];
  window._glPricingLoaded = false;

  // Load once and cache. Callers (the quote builder) can force a refresh.
  window.glLoadPricingSettings = async function(force){
    if(window._glPricingLoaded && !force) return window._glPricingRows;
    if(!window.supa) return [];
    try {
      var r = await window.supa.from('pricing_settings').select('*').order('sort_order');
      if(r.error){ console.warn('[GL] pricing_settings load:', r.error.message); return []; }
      window._glPricingRows = r.data || [];
      var map = {};
      window._glPricingRows.forEach(function(row){ map[row.key] = parseFloat(row.value); });
      window._glPricing = map;
      window._glPricingLoaded = true;
      return window._glPricingRows;
    } catch(e){ console.warn('[GL] pricing_settings load err', e); return []; }
  };

  // Read one price with a hard-coded fallback, so quoting still works if the
  // table is briefly unreachable.
  window.glPrice = function(key, fallback){
    var v = window._glPricing ? window._glPricing[key] : undefined;
    return (v == null || isNaN(v)) ? fallback : v;
  };

  function isAdmin(){ return window.currentUser && window.currentUser.role === 'admin'; }
  function moneyUnit(unit){ return !/(percent|cases)/i.test(unit||''); }

  window.glOpenPricingSettings = async function(){
    if(!isAdmin()){ alert('Admin only.'); return; }
    var prior = document.getElementById('gl-ps-ov'); if(prior) prior.remove();
    var host = document.getElementById('crm-panel') || document.body;

    var ov = document.createElement('div');
    ov.id = 'gl-ps-ov';
    ov.setAttribute('style','position:fixed;inset:0;z-index:1200;background:rgba(6,13,26,.92);backdrop-filter:blur(10px);display:flex;align-items:flex-start;justify-content:center;padding:24px;overflow:auto');
    ov.innerHTML = '<div style="background:#142238;border:1px solid rgba(0,229,192,.25);border-radius:16px;padding:24px;width:100%;max-width:560px;margin:auto">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
        '<div style="font-family:var(--ff-disp,inherit);font-size:19px;letter-spacing:1px;color:#00e5c0">💲 PRICE SETTINGS</div>' +
        '<button id="gl-ps-close" class="cbtn" style="padding:6px 12px">✕</button>' +
      '</div>' +
      '<div style="font-size:12px;color:#9aa7bd;margin-bottom:16px">Edit any add-on, packaging, pallet, keg, or formulation price. Changes save straight to the database and the quote builder picks them up next time you open it.</div>' +
      '<div id="gl-ps-body"><div style="color:#9aa7bd;font-size:13px;padding:12px 0">Loading…</div></div>' +
      '<div style="margin-top:14px;padding-top:14px;border-top:1px solid rgba(255,255,255,.08)">' +
        '<button id="gl-ps-tiers" class="cbtn" style="padding:8px 14px;font-size:12px">Edit volume tier ladders (per-can / per-unit) →</button>' +
      '</div>' +
    '</div>';
    host.appendChild(ov);
    ov.addEventListener('click', function(e){ if(e.target === ov) ov.remove(); });
    ov.querySelector('#gl-ps-close').addEventListener('click', function(){ ov.remove(); });
    ov.querySelector('#gl-ps-tiers').addEventListener('click', function(){
      ov.remove();
      if(typeof window.glOpenPricing === 'function') window.glOpenPricing();
      else alert('The tier-ladder editor ("$ Pricing") is not available on this screen.');
    });

    await window.glLoadPricingSettings(true);
    var rows = window._glPricingRows || [];
    var bodyEl = ov.querySelector('#gl-ps-body');
    if(!rows.length){
      bodyEl.innerHTML = '<div style="color:#ff8579;font-size:13px;padding:12px 0">Could not load prices — check the database connection and try again.</div>';
      return;
    }
    var groups = {};
    rows.forEach(function(r){ (groups[r.category] = groups[r.category] || []).push(r); });
    bodyEl.innerHTML = Object.keys(groups).map(function(cat){
      var items = groups[cat].map(function(r){
        return '<div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid rgba(255,255,255,.05)">' +
          '<div style="flex:1;min-width:0"><div style="font-size:13px;color:#fff">'+esc(r.label)+'</div>' +
            '<div style="font-size:11px;color:#6b87ad">'+esc(r.unit||'')+'</div></div>' +
          '<span style="color:#6b87ad;font-size:12px">'+(moneyUnit(r.unit)?'$':'')+'</span>' +
          '<input id="gl-ps-inp-'+esc(r.id)+'" type="number" step="0.01" min="0" value="'+esc(r.value)+'" ' +
            'style="width:92px;padding:6px 8px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.14);border-radius:6px;color:#fff;font-size:13px;text-align:right">' +
          '<button data-save="'+esc(r.id)+'" class="cbtn pri" style="padding:6px 12px;font-size:12px">Save</button>' +
        '</div>';
      }).join('');
      return '<div style="margin-bottom:16px">' +
        '<div style="font-size:11px;letter-spacing:1.5px;color:#00e5c0;font-weight:800;text-transform:uppercase;margin-bottom:2px">'+esc(cat)+'</div>' +
        items + '</div>';
    }).join('');

    bodyEl.querySelectorAll('[data-save]').forEach(function(btn){
      btn.addEventListener('click', async function(){
        var id  = btn.getAttribute('data-save');
        var inp = document.getElementById('gl-ps-inp-'+id);
        if(!inp) return;
        var val = parseFloat(inp.value);
        if(isNaN(val) || val < 0){ alert('Enter a valid, non-negative number.'); return; }
        var orig = btn.textContent;
        btn.textContent = '…'; btn.disabled = true;
        try {
          // .select() + treat error AND 0-rows as failure (CLAUDE.md rule #4):
          // RLS rejects silently, so an unchecked update would look saved.
          var q = await window.supa.from('pricing_settings')
            .update({ value: val, updated_at: new Date().toISOString() })
            .eq('id', id).select('id,key,value');
          if(q.error || !(q.data && q.data.length)){
            btn.textContent = 'Error'; btn.style.color = '#ff8579';
            alert('Not saved: ' + (q.error ? q.error.message : 'the server rejected the change (0 rows). Are you signed in as staff?'));
            setTimeout(function(){ btn.textContent = orig; btn.style.color=''; btn.disabled=false; }, 1800);
            return;
          }
          // Refresh caches so the quote builder uses the new number immediately.
          var key = q.data[0].key;
          if(window._glPricing) window._glPricing[key] = val;
          var row = (window._glPricingRows||[]).find(function(r){ return String(r.id)===String(id); });
          if(row) row.value = val;
          btn.textContent = '✓ Saved'; btn.style.color = '#5fcf9e';
          if(typeof window.glAudit === 'function') window.glAudit('price_updated', key, { value: val });
          setTimeout(function(){ btn.textContent = orig; btn.style.color=''; btn.disabled=false; }, 1600);
        } catch(e){
          btn.textContent = 'Error'; btn.style.color = '#ff8579'; btn.disabled = false;
          console.error('[GL] price save', e);
        }
      });
    });
  };

  // ── Nav button (admin only) ─────────────────────────────────
  function injectNav(){
    if(!isAdmin()) return;
    if(document.getElementById('gl-ps-nav')) return;
    var anchor = document.getElementById('gl-pricing-nav');   // the existing "$ Pricing" button
    var btn = document.createElement('button');
    btn.id = 'gl-ps-nav';
    btn.textContent = '💲 Prices';
    btn.onclick = window.glOpenPricingSettings;
    if(anchor && anchor.parentNode){
      btn.setAttribute('style', anchor.getAttribute('style') || '');
      anchor.parentNode.insertBefore(btn, anchor.nextSibling);
    } else {
      var bar = document.querySelector('.cpills');
      if(!bar) return;
      btn.setAttribute('style','padding:8px 14px;margin:2px;background:rgba(0,229,192,.12);border:1px solid rgba(0,229,192,.35);border-radius:8px;color:#00e5c0;font-weight:700;font-size:12px;cursor:pointer');
      bar.appendChild(btn);
    }
  }
  setTimeout(injectNav, 1600);
  document.addEventListener('click', function(){ setTimeout(injectNav, 500); });

  // Warm the cache once the DB client is up, so the quote builder's defaults
  // reflect live prices from the first quote of the session.
  (function preload(tries){
    if(window.supa && window.currentUser){ window.glLoadPricingSettings(); return; }
    if((tries||0) < 20) setTimeout(function(){ preload((tries||0)+1); }, 1000);
  })(0);

  console.log('[GL] pricing-settings editor loaded');
}());
