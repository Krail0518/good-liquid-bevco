/* ============================================================
   PUBLIC FACILITY GALLERY
   Pulls photos from the Supabase Storage 'facility-photos' bucket
   and drops them into the #facility-gallery grid on the public site.
   Renders elegant SVG placeholders if the bucket is empty or
   unreachable so the section never looks broken.
   Admin uploads via the CRM (separate admin UI to follow if needed
   — for now drop files into the bucket through the Supabase dashboard).
   ============================================================ */
(function(){
  var PLACEHOLDERS = [
    { label: 'Canning line',     icon: '🥫' },
    { label: 'Filling station',  icon: '⚙' },
    { label: 'Cold-fill tank',   icon: '🧊' },
    { label: 'Palletizing',      icon: '📦' },
    { label: 'Quality check',    icon: '🔬' },
    { label: 'PakTech handles',  icon: '🤝' }
  ];

  function tileHtml(src, label){
    if(src){
      return '<a href="' + src + '" target="_blank" rel="noopener" style="display:block;border-radius:12px;overflow:hidden;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.02);aspect-ratio:4/3;position:relative">' +
        '<img src="' + src + '" alt="' + (label||'Facility photo').replace(/"/g,'&quot;') + '" loading="lazy" style="width:100%;height:100%;object-fit:cover;display:block">' +
        (label ? '<div style="position:absolute;left:0;right:0;bottom:0;padding:10px 12px;background:linear-gradient(to top,rgba(0,0,0,.7),transparent);color:#fff;font-size:11px;letter-spacing:1px;font-family:var(--ff-disp)">' + label + '</div>' : '') +
      '</a>';
    }
    // Placeholder tile — graceful fallback if the bucket is empty / unreachable.
    return '<div style="border-radius:12px;overflow:hidden;border:1px dashed rgba(255,255,255,.12);background:linear-gradient(135deg,rgba(0,229,192,.05),rgba(26,111,255,.04));aspect-ratio:4/3;display:flex;flex-direction:column;align-items:center;justify-content:center;color:var(--muted);gap:8px">' +
      '<div style="font-size:38px;opacity:.45">' + label.icon + '</div>' +
      '<div style="font-size:11px;letter-spacing:2px;color:rgba(255,255,255,.45);font-family:var(--ff-disp)">' + label.label + '</div>' +
    '</div>';
  }

  async function renderGallery(){
    var host = document.getElementById('facility-gallery');
    if(!host) return;

    var photos = [];
    try {
      if(window.supa && window.supa.storage){
        var r = await window.supa.storage.from('facility-photos').list('', { limit: 24, sortBy: { column:'name', order:'asc' } });
        if(r && r.data){
          photos = r.data.filter(function(o){
            // Only images, skip the auto-created .emptyFolderPlaceholder file.
            return o.name && !o.name.startsWith('.') && /\.(jpe?g|png|webp|gif|avif)$/i.test(o.name);
          });
        }
      }
    } catch(e){ console.warn('[GL] facility-photos list failed', e); }

    var html;
    if(photos.length){
      // Public URLs work because the bucket is set public; if not, signed URLs
      // would be needed but that defeats SEO/embedding so we assume public.
      html = photos.map(function(p){
        var u = window.supa.storage.from('facility-photos').getPublicUrl(p.name);
        var url = (u && u.data && u.data.publicUrl) || '';
        // Use filename (minus extension) as the caption.
        var label = p.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
        return tileHtml(url, label);
      }).join('');
    } else {
      // No photos uploaded yet — show the 6 elegant placeholders so the
      // section still looks intentional.
      html = PLACEHOLDERS.map(function(p){ return tileHtml(null, p); }).join('');
    }
    host.innerHTML = html;
  }

  function start(){
    if(document.getElementById('facility-gallery')) renderGallery();
    else setTimeout(start, 600);
  }
  if(document.readyState !== 'loading') start();
  else document.addEventListener('DOMContentLoaded', start);

  console.log('[GL] public facility gallery loaded');
}());

/* ============================================================
   PUBLIC CAPACITY INDICATOR
   - Renders a "Q3 2026: 65% booked · Q4 opens Sep 1" badge in the
     hero so visitors see urgency + production transparency.
   - Data lives in Supabase table `capacity` (one row per quarter)
     with anon read access; the admin edits via a toolbar item.
   - Falls back to a sensible hardcoded default if the table is
     empty or unreachable, so the badge always shows something.
   - Pulses on the hero to draw the eye.
   ============================================================ */
(function(){
  function currentQuarter(){
    var now = new Date();
    var q = Math.floor(now.getMonth() / 3) + 1; // 1..4
    return { q: q, y: now.getFullYear() };
  }
  function nextQuarter(){
    var c = currentQuarter();
    return c.q === 4 ? { q:1, y:c.y+1 } : { q:c.q+1, y:c.y };
  }
  function quarterStartMonthName(q){ return ['Jan','Apr','Jul','Oct'][q-1]; }

  var DEFAULT_CAPACITY = {
    quarter: 'Q' + currentQuarter().q + ' ' + currentQuarter().y,
    booked: 60,
    next_label: 'Q' + nextQuarter().q + ' opens ' + quarterStartMonthName(nextQuarter().q) + ' 1',
    updated_at: ''
  };

  async function loadCapacity(){
    // Prefer Supabase, fall back to localStorage override, fall back to default.
    var override = null;
    try {
      var ls = localStorage.getItem('gl_capacity_override');
      if(ls) override = JSON.parse(ls);
    } catch(e){}
    if(override) return override;

    if(window.supa){
      try {
        var r = await window.supa.from('capacity').select('*').order('updated_at',{ascending:false}).limit(1);
        if(r && r.data && r.data[0]) return r.data[0];
      } catch(e){ /* table may not exist yet — silent fallback */ }
    }
    return DEFAULT_CAPACITY;
  }

  function fmt(c){
    var pct = Math.max(0, Math.min(100, parseInt(c.booked, 10) || 0));
    return (c.quarter || DEFAULT_CAPACITY.quarter) + ': ' + pct + '% booked · ' + (c.next_label || DEFAULT_CAPACITY.next_label);
  }

  async function renderBadge(){
    var host = document.getElementById('gl-capacity-badge');
    var txt  = document.getElementById('gl-capacity-text');
    if(!host || !txt) return;
    var c = await loadCapacity();
    txt.textContent = fmt(c);
    host.style.display = 'inline-flex';
  }

  // Inject the pulse keyframe once (shared with the dot in the badge).
  function injectPulse(){
    if(document.getElementById('gl-capacity-style')) return;
    var s = document.createElement('style');
    s.id = 'gl-capacity-style';
    s.textContent = '@keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.5;transform:scale(.85)}}';
    document.head.appendChild(s);
  }

  function start(){
    injectPulse();
    if(document.getElementById('gl-capacity-badge')) renderBadge();
    else setTimeout(start, 600);
  }
  if(document.readyState !== 'loading') start();
  else document.addEventListener('DOMContentLoaded', start);

  /* Admin-only editor (CRM toolbar). Lets Mike update the badge in 10
     seconds without touching code. Writes to Supabase if the table
     exists; otherwise stores a localStorage override (same device only). */
  window.openCapacitySettings = async function(){
    var prior = document.getElementById('gl-cap-modal'); if(prior) prior.remove();
    var host = document.getElementById('crm-panel') || document.body;
    var c = await loadCapacity();
    var ov = document.createElement('div');
    ov.id = 'gl-cap-modal';
    ov.setAttribute('style','position:fixed;inset:0;z-index:920;background:rgba(6,13,26,.85);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:20px');
    ov.innerHTML =
      '<div style="background:#142238;border:1px solid rgba(0,229,192,.2);border-radius:14px;padding:26px;width:100%;max-width:460px">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
          '<div style="font-family:var(--ff-disp);font-size:18px;letter-spacing:2px;color:var(--teal)">📅 CAPACITY BADGE</div>' +
          '<button id="gl-cap-close" style="background:none;border:none;color:#9aa7bd;font-size:20px;cursor:pointer">✕</button>' +
        '</div>' +
        '<div style="font-size:12px;color:#9aa7bd;margin-bottom:18px;line-height:1.6">Shown in the hero of the public site. Set what visitors should see right now.</div>' +
        '<div class="frow"><div class="flbl">Quarter label</div><input class="finp" id="gl-cap-quarter" value="' + (c.quarter||'').replace(/"/g,'&quot;') + '" placeholder="Q3 2026"></div>' +
        '<div class="frow"><div class="flbl">% booked</div><input class="finp" id="gl-cap-booked" type="number" min="0" max="100" value="' + (parseInt(c.booked,10)||0) + '"></div>' +
        '<div class="frow"><div class="flbl">Next-quarter line</div><input class="finp" id="gl-cap-next" value="' + (c.next_label||'').replace(/"/g,'&quot;') + '" placeholder="Q4 opens Oct 1"></div>' +
        '<div style="background:rgba(0,229,192,.05);border:1px solid rgba(0,229,192,.15);border-radius:8px;padding:11px;font-size:11px;color:#9aa7bd;margin:8px 0 16px">Preview: <span id="gl-cap-preview" style="color:var(--teal);font-weight:600"></span></div>' +
        '<div style="display:flex;gap:8px">' +
          '<button id="gl-cap-save" class="cbtn pri" style="flex:1">💾 Save</button>' +
          '<button id="gl-cap-reset" class="cbtn">Reset to default</button>' +
        '</div>' +
      '</div>';
    ov.addEventListener('click', function(e){ if(e.target === ov) ov.remove(); });
    host.appendChild(ov);

    function readForm(){
      return {
        quarter:    ov.querySelector('#gl-cap-quarter').value.trim(),
        booked:     parseInt(ov.querySelector('#gl-cap-booked').value, 10) || 0,
        next_label: ov.querySelector('#gl-cap-next').value.trim(),
        updated_at: new Date().toISOString()
      };
    }
    function updatePreview(){ ov.querySelector('#gl-cap-preview').textContent = fmt(readForm()); }
    ['gl-cap-quarter','gl-cap-booked','gl-cap-next'].forEach(function(id){
      ov.querySelector('#'+id).addEventListener('input', updatePreview);
    });
    updatePreview();

    ov.querySelector('#gl-cap-close').addEventListener('click', function(){ ov.remove(); });
    ov.querySelector('#gl-cap-reset').addEventListener('click', function(){
      localStorage.removeItem('gl_capacity_override');
      ov.remove();
      renderBadge();
      if(typeof addNotification === 'function') addNotification('📅 Capacity reset', 'Cleared override','info');
    });
    ov.querySelector('#gl-cap-save').addEventListener('click', async function(){
      var data = readForm();
      var btn = this; btn.disabled = true; btn.textContent = 'Saving…';
      // Try Supabase first; fall back to local override.
      var supaOk = false;
      if(window.supa){
        try {
          var r = await window.supa.from('capacity').insert([data]);
          supaOk = !r.error;
          if(r.error) console.warn('[GL] capacity insert error', r.error);
        } catch(e){ console.warn('[GL] capacity insert threw', e); }
      }
      if(!supaOk) localStorage.setItem('gl_capacity_override', JSON.stringify(data));
      else        localStorage.removeItem('gl_capacity_override');
      btn.disabled = false; btn.textContent = '💾 Save';
      ov.remove();
      renderBadge();
      if(typeof addNotification === 'function') addNotification('📅 Capacity updated', supaOk ? 'Synced to Supabase' : 'Saved locally (table missing?)','success');
      if(typeof window.glAudit === 'function') window.glAudit('capacity_updated', '', data);
    });
  };

  console.log('[GL] capacity indicator loaded');
}());

/* ============================================================
   FORMULA VAULT
   - Single source of truth for client recipes.
   - Each formula belongs to one client. Versioned (v1, v2, …).
   - Captures: name, version, ingredients (multi-line), allergen
     profile (multi-select), target yield per case, batch size,
     pH / brix targets, notes, approval status.
   - Backed by Supabase `formulas` table; localStorage fallback.
   ============================================================ */
(function(){
  function esc(v){ return v == null ? '' : String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  var ALLERGENS = [
    ['gluten','🌾 Gluten'],['dairy','🥛 Dairy'],['soy','🌱 Soy'],
    ['eggs','🥚 Eggs'],['tree_nuts','🌰 Tree nuts'],['peanuts','🥜 Peanuts'],
    ['sesame','🌻 Sesame'],['fish','🐟 Fish'],['shellfish','🦐 Shellfish'],
    ['sulfites','⚗️ Sulfites']
  ];
  var STATUSES = [
    ['draft','Draft'],['benchtop','Benchtop verified'],
    ['approved','Production approved'],['archived','Archived']
  ];
  window.glFormulas = window.glFormulas || [];

  async function loadFromSupabase(){
    if(!window.supa) return null;
    try {
      var r = await window.supa.from('formulas').select('*').order('updated_at',{ascending:false});
      if(r && r.data) return r.data;
    } catch(e){ console.warn('[GL] formulas load failed', e); }
    return null;
  }
  function loadLocal(){
    try { return JSON.parse(localStorage.getItem('gl_formulas') || '[]'); } catch(e){ return []; }
  }
  function saveLocal(){ localStorage.setItem('gl_formulas', JSON.stringify(window.glFormulas)); }

  async function refresh(){
    var rows = await loadFromSupabase();
    window.glFormulas = rows || loadLocal();
    render();
  }

  function statusBadge(s){
    var map = {
      draft:    'background:rgba(155,155,155,.15);color:#9aa7bd;border-color:rgba(155,155,155,.3)',
      benchtop: 'background:rgba(245,200,66,.12);color:#f5c842;border-color:rgba(245,200,66,.3)',
      approved: 'background:rgba(29,158,117,.15);color:#5fcf9e;border-color:rgba(29,158,117,.35)',
      archived: 'background:rgba(231,76,60,.1);color:#ff8579;border-color:rgba(231,76,60,.3)'
    };
    var label = (STATUSES.find(function(x){ return x[0] === s; }) || ['',''])[1] || s;
    return '<span style="padding:3px 9px;border-radius:20px;font-size:11px;font-weight:600;border:1px solid;' + (map[s] || map.draft) + '">' + esc(label) + '</span>';
  }

  function allergenPills(arr){
    if(!arr || !arr.length) return '<span style="font-size:11px;color:rgba(255,255,255,.3);font-style:italic">none declared</span>';
    return arr.map(function(a){
      var lbl = (ALLERGENS.find(function(x){ return x[0] === a; }) || [a, a])[1];
      return '<span style="padding:2px 8px;border-radius:20px;font-size:10px;font-weight:600;background:rgba(231,76,60,.1);color:#ff8579;border:1px solid rgba(231,76,60,.3);margin-right:4px">' + esc(lbl) + '</span>';
    }).join('');
  }

  function render(){
    var host = document.getElementById('fv-body');
    if(!host) return;
    var sub = document.getElementById('fv-sub');
    var rows = window.glFormulas || [];
    var approved = rows.filter(function(f){ return f.status === 'approved'; }).length;
    if(sub) sub.textContent = rows.length + ' formula' + (rows.length === 1 ? '' : 's') + (approved ? ' · ' + approved + ' production-approved' : '');

    if(!rows.length){
      host.innerHTML = '<div style="padding:30px;text-align:center;color:var(--muted);font-size:13px">No formulas in the vault yet. Click "New Formula" to add the first one.</div>';
      return;
    }
    host.innerHTML = '<table class="ctbl"><thead><tr><th>Name</th><th>Client</th><th>Version</th><th>Allergens</th><th>Status</th><th>Updated</th></tr></thead><tbody>' +
      rows.map(function(f){
        var clientName = f.client_name || ((window.clients||[]).find(function(c){ return c.id === f.client_id; })||{}).name || '—';
        var updated = f.updated_at ? new Date(f.updated_at).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '—';
        return '<tr style="cursor:pointer" onclick="window.glOpenEditFormula(\'' + esc(f.id) + '\')">' +
          '<td style="padding:11px;font-weight:600;color:var(--white)">' + esc(f.name || '(untitled)') + '</td>' +
          '<td style="padding:11px;color:var(--muted)">' + esc(clientName) + '</td>' +
          '<td style="padding:11px;color:var(--teal);font-family:var(--ff-mono)">v' + (f.version || 1) + '</td>' +
          '<td style="padding:11px">' + allergenPills(f.allergens) + '</td>' +
          '<td style="padding:11px">' + statusBadge(f.status || 'draft') + '</td>' +
          '<td style="padding:11px;color:var(--muted);font-size:11px">' + updated + '</td>' +
        '</tr>';
      }).join('') + '</tbody></table>';
  }

  function formulaModal(existing){
    var prior = document.getElementById('gl-fv-modal'); if(prior) prior.remove();
    var host = document.getElementById('crm-panel') || document.body;
    var isEdit = !!existing;
    var f = existing || { name:'', client_id:'', client_name:'', version:1, ingredients:'', allergens:[], target_yield_cases:'', batch_size_gal:'', ph_target:'', brix_target:'', notes:'', status:'draft' };
    var clientOptions = '<option value="">— Pick client —</option>' +
      (window.clients||[]).map(function(c){
        var sel = (c.id === f.client_id) ? ' selected' : '';
        return '<option value="' + esc(c.id) + '"'+sel+'>' + esc(c.name) + '</option>';
      }).join('');
    var allergenChecks = ALLERGENS.map(function(a){
      var checked = (f.allergens||[]).indexOf(a[0]) >= 0 ? ' checked' : '';
      return '<label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;color:var(--white)"><input type="checkbox" id="gl-fv-al-' + a[0] + '"'+checked+' style="accent-color:#ff8579;width:15px;height:15px;cursor:pointer">' + a[1] + '</label>';
    }).join('');
    var statusOptions = STATUSES.map(function(s){
      var sel = (s[0] === (f.status||'draft')) ? ' selected' : '';
      return '<option value="' + s[0] + '"'+sel+'>' + s[1] + '</option>';
    }).join('');

    var ov = document.createElement('div');
    ov.id = 'gl-fv-modal';
    ov.setAttribute('style','position:fixed;inset:0;z-index:1000;background:rgba(6,13,26,.88);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:20px');
    ov.innerHTML =
      '<div style="background:#142238;border:1px solid rgba(0,229,192,.2);border-radius:14px;padding:26px;width:100%;max-width:560px;max-height:88vh;overflow-y:auto">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">' +
          '<div style="font-family:var(--ff-disp);font-size:18px;letter-spacing:2px;color:var(--teal)">' + (isEdit ? '✏️ EDIT FORMULA' : '🧪 NEW FORMULA') + '</div>' +
          '<button id="gl-fv-close" style="background:none;border:none;color:#9aa7bd;font-size:20px;cursor:pointer">✕</button>' +
        '</div>' +
        '<div class="frow"><div class="flbl">Name *</div><input class="finp" id="gl-fv-name" value="' + esc(f.name) + '" placeholder="e.g. SunBurst Mango Seltzer"></div>' +
        '<div style="display:grid;grid-template-columns:2fr 1fr;gap:8px">' +
          '<div class="frow"><div class="flbl">Client *</div><select class="fsel" id="gl-fv-client">' + clientOptions + '</select></div>' +
          '<div class="frow"><div class="flbl">Version</div><input class="finp" id="gl-fv-version" type="number" min="1" value="' + (f.version || 1) + '"></div>' +
        '</div>' +
        '<div class="frow"><div class="flbl">Ingredients (one per line)</div><textarea class="finp" id="gl-fv-ingredients" rows="5" placeholder="Carbonated filtered water&#10;Cane sugar&#10;Natural mango flavor&#10;Citric acid&#10;Sodium citrate" style="font-family:var(--ff-mono);font-size:12px">' + esc(f.ingredients) + '</textarea></div>' +
        '<div>' +
          '<div class="flbl" style="margin-bottom:6px">Allergen profile</div>' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:7px 12px;padding:11px;background:rgba(231,76,60,.04);border:1px solid rgba(231,76,60,.18);border-radius:8px;margin-bottom:12px">' + allergenChecks + '</div>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
          '<div class="frow"><div class="flbl">Target yield (cases / batch)</div><input class="finp" id="gl-fv-yield" type="number" min="0" value="' + esc(f.target_yield_cases) + '"></div>' +
          '<div class="frow"><div class="flbl">Batch size (gallons)</div><input class="finp" id="gl-fv-batch" type="number" min="0" value="' + esc(f.batch_size_gal) + '"></div>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
          '<div class="frow"><div class="flbl">pH target</div><input class="finp" id="gl-fv-ph" value="' + esc(f.ph_target) + '" placeholder="3.5"></div>' +
          '<div class="frow"><div class="flbl">Brix target</div><input class="finp" id="gl-fv-brix" value="' + esc(f.brix_target) + '" placeholder="10.5"></div>' +
        '</div>' +
        '<div class="frow"><div class="flbl">Status</div><select class="fsel" id="gl-fv-status">' + statusOptions + '</select></div>' +
        '<div class="frow"><div class="flbl">Notes</div><textarea class="finp" id="gl-fv-notes" rows="2">' + esc(f.notes) + '</textarea></div>' +
        '<div style="display:flex;gap:8px;margin-top:6px">' +
          '<button id="gl-fv-save" class="cbtn pri" style="flex:1">💾 Save</button>' +
          (isEdit ? '<button id="gl-fv-clone" class="cbtn" style="background:rgba(168,85,247,.12);border-color:rgba(168,85,247,.35);color:#c4a4f8">Clone as v' + ((f.version||1) + 1) + '</button>' : '') +
          (isEdit ? '<button id="gl-fv-del" class="cbtn" style="background:rgba(231,76,60,.12);border-color:rgba(231,76,60,.35);color:#ff8579">Delete</button>' : '') +
          '<button id="gl-fv-cancel" class="cbtn">Cancel</button>' +
        '</div>' +
      '</div>';
    ov.addEventListener('click', function(e){ if(e.target === ov) ov.remove(); });
    ov.querySelector('#gl-fv-close').addEventListener('click', function(){ ov.remove(); });
    ov.querySelector('#gl-fv-cancel').addEventListener('click', function(){ ov.remove(); });

    function readForm(){
      var allergens = ALLERGENS.map(function(a){ return a[0]; }).filter(function(k){
        var el = ov.querySelector('#gl-fv-al-' + k); return el && el.checked;
      });
      var cid = ov.querySelector('#gl-fv-client').value;
      var c = (window.clients||[]).find(function(x){ return x.id === cid; });
      return {
        name:    ov.querySelector('#gl-fv-name').value.trim(),
        client_id:   cid || null,
        client_name: c ? c.name : '',
        version:  parseInt(ov.querySelector('#gl-fv-version').value, 10) || 1,
        ingredients: ov.querySelector('#gl-fv-ingredients').value,
        allergens:   allergens,
        target_yield_cases: parseInt(ov.querySelector('#gl-fv-yield').value, 10) || null,
        batch_size_gal:     parseFloat(ov.querySelector('#gl-fv-batch').value) || null,
        ph_target:   ov.querySelector('#gl-fv-ph').value.trim(),
        brix_target: ov.querySelector('#gl-fv-brix').value.trim(),
        status:      ov.querySelector('#gl-fv-status').value,
        notes:       ov.querySelector('#gl-fv-notes').value,
        updated_at:  new Date().toISOString()
      };
    }

    var delBtn = ov.querySelector('#gl-fv-del');
    if(delBtn) delBtn.addEventListener('click', async function(){
      if(!confirm('Delete this formula record? This cannot be undone.')) return;
      if(window.supa){ try { await window.supa.from('formulas').delete().eq('id', f.id); } catch(e){} }
      window.glFormulas = (window.glFormulas||[]).filter(function(x){ return x.id !== f.id; });
      saveLocal(); render(); ov.remove();
      if(typeof addNotification === 'function') addNotification('🧪 Formula deleted', f.name, 'warning');
      if(typeof window.glAudit === 'function') window.glAudit('formula_deleted', f.id, {});
    });
    var clone = ov.querySelector('#gl-fv-clone');
    if(clone) clone.addEventListener('click', async function(){
      var data = readForm();
      data.version = (f.version || 1) + 1;
      data.status = 'draft';
      delete data.id;
      ov.remove();
      // Save as a fresh row using the same flow as a new formula.
      if(window.supa){
        try {
          var r = await window.supa.from('formulas').insert([data]).select().single();
          if(r && r.data){ window.glFormulas.unshift(r.data); }
          else            { data.id = 'local_' + Date.now(); window.glFormulas.unshift(data); }
        } catch(e){ data.id = 'local_' + Date.now(); window.glFormulas.unshift(data); }
      } else {
        data.id = 'local_' + Date.now(); window.glFormulas.unshift(data);
      }
      saveLocal(); render();
      if(typeof addNotification === 'function') addNotification('🧪 Cloned as v' + data.version, data.name, 'success');
    });

    ov.querySelector('#gl-fv-save').addEventListener('click', async function(){
      var data = readForm();
      if(!data.name){ alert('Name is required.'); return; }
      var btn = this; btn.disabled = true; btn.textContent = 'Saving…';
      if(window.supa){
        try {
          if(isEdit){
            await window.supa.from('formulas').update(data).eq('id', f.id);
            Object.assign(f, data);
          } else {
            var r = await window.supa.from('formulas').insert([data]).select().single();
            if(r && r.data){ window.glFormulas.unshift(r.data); }
            else            { data.id = 'local_' + Date.now(); window.glFormulas.unshift(data); }
          }
        } catch(e){
          console.warn('[GL] formula save failed; using local', e);
          if(isEdit) Object.assign(f, data);
          else { data.id = 'local_' + Date.now(); window.glFormulas.unshift(data); }
        }
      } else {
        if(isEdit) Object.assign(f, data);
        else { data.id = 'local_' + Date.now(); window.glFormulas.unshift(data); }
      }
      saveLocal();
      btn.disabled = false; btn.textContent = '💾 Save';
      ov.remove(); render();
      if(typeof addNotification === 'function') addNotification(isEdit ? '🧪 Formula updated' : '🧪 Formula added', data.name + ' v' + data.version, 'success');
      if(typeof window.glAudit === 'function') window.glAudit(isEdit ? 'formula_edited' : 'formula_added', data.name, { allergens: data.allergens });
    });
    host.appendChild(ov);
  }

  window.glOpenAddFormula  = function(){ formulaModal(null); };
  window.glOpenEditFormula = function(id){
    var f = (window.glFormulas||[]).find(function(x){ return x.id === id; });
    if(f) formulaModal(f);
  };

  function watch(){
    var pg = document.getElementById('cpg-formulas');
    if(!pg){ setTimeout(watch, 600); return; }
    new MutationObserver(function(){ if(pg.classList.contains('act')) refresh(); }).observe(pg, { attributes:true, attributeFilter:['class'] });
  }
  if(document.readyState !== 'loading') watch();
  else document.addEventListener('DOMContentLoaded', watch);

  console.log('[GL] formula vault loaded');
}());

/* ============================================================
   YIELD TRACKER
   - Lightweight log of "run X planned Y cases, actually produced Z".
   - Standalone page; doesn't depend on production_runs being shipped
     (works even before PR #15 lands).
   - Computes yield % per row and a rolling average at the top.
   - Backed by Supabase `yield_logs` table; localStorage fallback.
   ============================================================ */
(function(){
  function esc(v){ return v == null ? '' : String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  window.glYieldLogs = window.glYieldLogs || [];

  async function loadFromSupabase(){
    if(!window.supa) return null;
    try {
      var r = await window.supa.from('yield_logs').select('*').order('completed_at',{ascending:false});
      if(r && r.data) return r.data;
    } catch(e){ console.warn('[GL] yield_logs load failed', e); }
    return null;
  }
  function loadLocal(){
    try { return JSON.parse(localStorage.getItem('gl_yield_logs') || '[]'); } catch(e){ return []; }
  }
  function saveLocal(){ localStorage.setItem('gl_yield_logs', JSON.stringify(window.glYieldLogs)); }

  async function refresh(){
    var rows = await loadFromSupabase();
    window.glYieldLogs = rows || loadLocal();
    render();
  }

  function pctColor(pct){
    if(pct >= 95) return '#5fcf9e';
    if(pct >= 85) return '#f5c842';
    return '#ff8579';
  }

  function render(){
    var host = document.getElementById('yld-body');
    if(!host) return;
    var sub = document.getElementById('yld-sub');
    var rows = window.glYieldLogs || [];
    var total = rows.length;
    var avg = 0;
    if(total){
      avg = Math.round(rows.reduce(function(s,r){
        var p = r.planned_cases || 0, a = r.actual_cases || 0;
        return s + (p > 0 ? (a / p * 100) : 0);
      }, 0) / total);
    }
    if(sub) sub.textContent = total + ' completed run' + (total === 1 ? '' : 's') + (total ? ' · rolling yield ' + avg + '%' : '');

    var statHtml = total
      ? '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:11px;margin-bottom:18px">' +
        '<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:10px;padding:13px;text-align:center"><div style="font-size:10px;color:var(--muted);letter-spacing:1px">RUNS LOGGED</div><div style="font-family:var(--ff-disp);font-size:22px;color:var(--white);margin-top:3px">' + total + '</div></div>' +
        '<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:10px;padding:13px;text-align:center"><div style="font-size:10px;color:var(--muted);letter-spacing:1px">ROLLING YIELD</div><div style="font-family:var(--ff-disp);font-size:22px;color:' + pctColor(avg) + ';margin-top:3px">' + avg + '%</div></div>' +
        '<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:10px;padding:13px;text-align:center"><div style="font-size:10px;color:var(--muted);letter-spacing:1px">TOTAL CASES PRODUCED</div><div style="font-family:var(--ff-disp);font-size:22px;color:var(--teal);margin-top:3px">' + rows.reduce(function(s,r){return s + (r.actual_cases || 0);}, 0).toLocaleString() + '</div></div>' +
      '</div>'
      : '';

    if(!total){
      host.innerHTML = '<div style="padding:30px;text-align:center;color:var(--muted);font-size:13px">No completed runs logged yet. Click "Log Completion" after a production run to start tracking yield.</div>';
      return;
    }

    host.innerHTML = statHtml + '<table class="ctbl"><thead><tr><th>Run</th><th>Client</th><th>Planned</th><th>Actual</th><th>Yield %</th><th>Completed</th></tr></thead><tbody>' +
      rows.map(function(r){
        var p = r.planned_cases || 0, a = r.actual_cases || 0;
        var pct = p > 0 ? Math.round(a / p * 100) : 0;
        var d = r.completed_at ? new Date(r.completed_at).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '—';
        return '<tr style="cursor:pointer" onclick="window.glOpenEditYield(\'' + esc(r.id) + '\')">' +
          '<td style="padding:11px;font-weight:600;color:var(--white)">' + esc(r.run_name || '(untitled)') + '</td>' +
          '<td style="padding:11px;color:var(--muted)">' + esc(r.client_name || '—') + '</td>' +
          '<td style="padding:11px;color:var(--muted)">' + p.toLocaleString() + '</td>' +
          '<td style="padding:11px;color:var(--white);font-weight:600">' + a.toLocaleString() + '</td>' +
          '<td style="padding:11px;color:' + pctColor(pct) + ';font-weight:700">' + pct + '%</td>' +
          '<td style="padding:11px;color:var(--muted);font-size:11px">' + d + '</td>' +
        '</tr>';
      }).join('') + '</tbody></table>';
  }

  function yieldModal(existing){
    var prior = document.getElementById('gl-yld-modal'); if(prior) prior.remove();
    var host = document.getElementById('crm-panel') || document.body;
    var isEdit = !!existing;
    var r = existing || { run_name:'', client_id:'', client_name:'', planned_cases:'', actual_cases:'', completed_at: new Date().toISOString().slice(0,10), loss_reason:'', notes:'' };
    var clientOptions = '<option value="">— Pick client —</option>' +
      (window.clients||[]).map(function(c){
        var sel = (c.id === r.client_id) ? ' selected' : '';
        return '<option value="' + esc(c.id) + '"'+sel+'>' + esc(c.name) + '</option>';
      }).join('');
    var ov = document.createElement('div');
    ov.id = 'gl-yld-modal';
    ov.setAttribute('style','position:fixed;inset:0;z-index:1000;background:rgba(6,13,26,.88);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:20px');
    ov.innerHTML =
      '<div style="background:#142238;border:1px solid rgba(0,229,192,.2);border-radius:14px;padding:26px;width:100%;max-width:480px;max-height:88vh;overflow-y:auto">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">' +
          '<div style="font-family:var(--ff-disp);font-size:18px;letter-spacing:2px;color:var(--teal)">' + (isEdit ? '✏️ EDIT YIELD LOG' : '📈 LOG RUN COMPLETION') + '</div>' +
          '<button id="gl-yld-close" style="background:none;border:none;color:#9aa7bd;font-size:20px;cursor:pointer">✕</button>' +
        '</div>' +
        '<div class="frow"><div class="flbl">Run name *</div><input class="finp" id="gl-yld-name" value="' + esc(r.run_name) + '" placeholder="e.g. SunBurst Mango Run #3"></div>' +
        '<div class="frow"><div class="flbl">Client</div><select class="fsel" id="gl-yld-client">' + clientOptions + '</select></div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
          '<div class="frow"><div class="flbl">Planned cases</div><input class="finp" id="gl-yld-planned" type="number" min="0" value="' + esc(r.planned_cases) + '"></div>' +
          '<div class="frow"><div class="flbl">Actual cases</div><input class="finp" id="gl-yld-actual" type="number" min="0" value="' + esc(r.actual_cases) + '"></div>' +
        '</div>' +
        '<div class="frow"><div class="flbl">Completed date</div><input class="finp" id="gl-yld-date" type="date" value="' + esc(r.completed_at) + '"></div>' +
        '<div class="frow"><div class="flbl">If under-yield: what caused the loss?</div><input class="finp" id="gl-yld-loss" value="' + esc(r.loss_reason) + '" placeholder="e.g. foam-over, can dent, label misregister"></div>' +
        '<div class="frow"><div class="flbl">Notes</div><textarea class="finp" id="gl-yld-notes" rows="2">' + esc(r.notes) + '</textarea></div>' +
        '<div style="display:flex;gap:8px;margin-top:6px">' +
          '<button id="gl-yld-save" class="cbtn pri" style="flex:1">💾 Save</button>' +
          (isEdit ? '<button id="gl-yld-del" class="cbtn" style="background:rgba(231,76,60,.12);border-color:rgba(231,76,60,.35);color:#ff8579">Delete</button>' : '') +
          '<button id="gl-yld-cancel" class="cbtn">Cancel</button>' +
        '</div>' +
      '</div>';
    ov.addEventListener('click', function(e){ if(e.target === ov) ov.remove(); });
    ov.querySelector('#gl-yld-close').addEventListener('click', function(){ ov.remove(); });
    ov.querySelector('#gl-yld-cancel').addEventListener('click', function(){ ov.remove(); });
    var delBtn = ov.querySelector('#gl-yld-del');
    if(delBtn) delBtn.addEventListener('click', async function(){
      if(!confirm('Delete this yield log?')) return;
      if(window.supa){ try { await window.supa.from('yield_logs').delete().eq('id', r.id); } catch(e){} }
      window.glYieldLogs = (window.glYieldLogs||[]).filter(function(x){ return x.id !== r.id; });
      saveLocal(); render(); ov.remove();
    });
    ov.querySelector('#gl-yld-save').addEventListener('click', async function(){
      var name = ov.querySelector('#gl-yld-name').value.trim();
      if(!name){ alert('Run name is required.'); return; }
      var cid = ov.querySelector('#gl-yld-client').value;
      var c = (window.clients||[]).find(function(x){ return x.id === cid; });
      var data = {
        run_name:       name,
        client_id:      cid || null,
        client_name:    c ? c.name : '',
        planned_cases:  parseInt(ov.querySelector('#gl-yld-planned').value, 10) || 0,
        actual_cases:   parseInt(ov.querySelector('#gl-yld-actual').value, 10) || 0,
        completed_at:   ov.querySelector('#gl-yld-date').value || null,
        loss_reason:    ov.querySelector('#gl-yld-loss').value.trim(),
        notes:          ov.querySelector('#gl-yld-notes').value
      };
      var btn = this; btn.disabled = true; btn.textContent = 'Saving…';
      if(window.supa){
        try {
          if(isEdit){
            await window.supa.from('yield_logs').update(data).eq('id', r.id);
            Object.assign(r, data);
          } else {
            var resp = await window.supa.from('yield_logs').insert([data]).select().single();
            if(resp && resp.data){ window.glYieldLogs.unshift(resp.data); }
            else                  { data.id = 'local_' + Date.now(); window.glYieldLogs.unshift(data); }
          }
        } catch(e){
          if(isEdit) Object.assign(r, data);
          else { data.id = 'local_' + Date.now(); window.glYieldLogs.unshift(data); }
        }
      } else {
        if(isEdit) Object.assign(r, data);
        else { data.id = 'local_' + Date.now(); window.glYieldLogs.unshift(data); }
      }
      saveLocal();
      btn.disabled = false; btn.textContent = '💾 Save';
      ov.remove(); render();
      if(typeof addNotification === 'function') addNotification(isEdit ? '📈 Yield updated' : '📈 Yield logged', data.run_name, 'success');
      if(typeof window.glAudit === 'function') window.glAudit(isEdit ? 'yield_edited' : 'yield_logged', data.run_name, { yield_pct: data.planned_cases ? Math.round(data.actual_cases / data.planned_cases * 100) : 0 });
    });
    host.appendChild(ov);
  }

  window.glOpenLogYield  = function(){ yieldModal(null); };
  window.glOpenEditYield = function(id){
    var r = (window.glYieldLogs||[]).find(function(x){ return x.id === id; });
    if(r) yieldModal(r);
  };

  function watch(){
    var pg = document.getElementById('cpg-yield');
    if(!pg){ setTimeout(watch, 600); return; }
    new MutationObserver(function(){ if(pg.classList.contains('act')) refresh(); }).observe(pg, { attributes:true, attributeFilter:['class'] });
  }
  if(document.readyState !== 'loading') watch();
  else document.addEventListener('DOMContentLoaded', watch);

  console.log('[GL] yield tracker loaded');
}());

/* ============================================================
   AI MARKETING SUITE
   Three features that share the existing window.callAI helper:
     1. openSocialDrafter   — channel + tone + topic → 3 post drafts
     2. openCaseStudyBuilder — pick a client → 200-word case study
     3. openPostSuggester   — scans CRM activity → 3 "post this week" ideas
   All output is copyable; nothing auto-publishes.
   ============================================================ */
(function(){
  function esc(v){ return v == null ? '' : String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  function modal(id, title, bodyHtml, opts){
    opts = opts || {};
    var prior = document.getElementById(id); if(prior) prior.remove();
    var host = document.getElementById('crm-panel') || document.body;
    var ov = document.createElement('div');
    ov.id = id;
    ov.setAttribute('style','position:fixed;inset:0;z-index:1000;background:rgba(6,13,26,.88);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:20px');
    ov.innerHTML =
      '<div style="background:#142238;border:1px solid rgba(0,229,192,.2);border-radius:14px;padding:26px;width:100%;max-width:' + (opts.maxWidth || '560px') + ';max-height:88vh;overflow-y:auto">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">' +
          '<div style="font-family:var(--ff-disp);font-size:18px;letter-spacing:2px;color:var(--teal)">' + title + '</div>' +
          '<button class="gl-mod-close" style="background:none;border:none;color:#9aa7bd;font-size:20px;cursor:pointer">✕</button>' +
        '</div>' +
        bodyHtml +
      '</div>';
    ov.addEventListener('click', function(e){ if(e.target === ov) ov.remove(); });
    ov.querySelector('.gl-mod-close').addEventListener('click', function(){ ov.remove(); });
    host.appendChild(ov);
    return ov;
  }

  function resultCard(label, text){
    var t = esc(text || '');
    return '<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:14px;margin-bottom:10px">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">' +
        '<div style="font-family:var(--ff-disp);font-size:10px;letter-spacing:2px;color:var(--teal)">' + esc(label) + '</div>' +
        '<button class="gl-copy-btn cbtn" style="font-size:10px;padding:4px 10px" data-text="' + t.replace(/"/g,'&quot;') + '">📋 Copy</button>' +
      '</div>' +
      '<div style="font-size:13px;color:var(--white);line-height:1.6;white-space:pre-wrap">' + t + '</div>' +
    '</div>';
  }

  function wireCopyButtons(host){
    host.querySelectorAll('.gl-copy-btn').forEach(function(b){
      b.addEventListener('click', async function(){
        var t = b.getAttribute('data-text') || '';
        try { await navigator.clipboard.writeText(t); }
        catch(e){
          var ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
        }
        var orig = b.textContent; b.textContent = '✓ Copied'; setTimeout(function(){ b.textContent = orig; }, 1500);
      });
    });
  }

  /* ─── 1. SOCIAL POST DRAFTER ─── */
  window.openSocialDrafter = function(){
    var clientOptions = '<option value="">— No specific client —</option>' +
      (window.clients||[]).map(function(c){ return '<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>'; }).join('');

    var ov = modal('gl-social-modal', '📣 AI SOCIAL POST DRAFTER',
      '<div class="frow"><div class="flbl">Channel</div>' +
        '<select class="fsel" id="gl-soc-channel">' +
          '<option value="instagram">📷 Instagram</option>' +
          '<option value="linkedin">💼 LinkedIn</option>' +
          '<option value="x">🐦 X / Twitter</option>' +
          '<option value="facebook">📘 Facebook</option>' +
        '</select>' +
      '</div>' +
      '<div class="frow"><div class="flbl">Tone</div>' +
        '<select class="fsel" id="gl-soc-tone">' +
          '<option>Confident &amp; founder-voice</option>' +
          '<option>Behind-the-scenes / casual</option>' +
          '<option>Educational / industry insight</option>' +
          '<option>Celebratory client win</option>' +
          '<option>Direct sales / call-to-action</option>' +
        '</select>' +
      '</div>' +
      '<div class="frow"><div class="flbl">Topic / talking point</div>' +
        '<textarea class="finp" id="gl-soc-topic" rows="3" placeholder="e.g. We just finished a 2,500-case run of a hop-water seltzer for a small craft brewery."></textarea>' +
      '</div>' +
      '<div class="frow"><div class="flbl">Tie to a client (optional)</div>' +
        '<select class="fsel" id="gl-soc-client">' + clientOptions + '</select>' +
      '</div>' +
      '<div style="display:flex;gap:8px"><button id="gl-soc-go" class="cbtn pri" style="flex:1">✨ Draft 3 versions</button></div>' +
      '<div id="gl-soc-out" style="margin-top:18px"></div>',
      { maxWidth: '600px' });

    ov.querySelector('#gl-soc-go').addEventListener('click', async function(){
      var btn = this; var out = ov.querySelector('#gl-soc-out');
      var channel = ov.querySelector('#gl-soc-channel').value;
      var tone    = ov.querySelector('#gl-soc-tone').value;
      var topic   = ov.querySelector('#gl-soc-topic').value.trim();
      var cid     = ov.querySelector('#gl-soc-client').value;
      if(!topic){ alert('Type in a topic or talking point first.'); return; }
      var c = (window.clients||[]).find(function(x){ return x.id === cid; });
      var clientCtx = c ? ('\n\nClient context: brand "' + c.name + '"' + (c.productTypes && c.productTypes.length ? ', makes ' + c.productTypes.join('/') : '') + (c.service ? ', service: ' + c.service : '') + '.') : '';
      btn.disabled = true; btn.textContent = '✨ Drafting…';
      out.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:14px;text-align:center">Asking the model for 3 angles…</div>';

      var charLimit = channel === 'x' ? 280 : channel === 'instagram' ? 2200 : channel === 'linkedin' ? 1200 : 1500;
      var sys = 'You are a social-media copywriter for Good Liquid Bev Co, a family-run beverage co-packer in Palmetto, FL. The brand voice is confident, direct, and craft-forward — never corporate. You write in their first-person plural ("we"). Avoid hashtag overuse and avoid "innovative", "leverage", "passionate". Each post must fit within ' + charLimit + ' characters including hashtags.';
      var user = 'Write 3 distinct ' + channel.toUpperCase() + ' posts in this tone: "' + tone + '".\n\nTopic / talking point:\n' + topic + clientCtx + '\n\nReturn exactly this format, no preamble:\n\n=== Version 1 ===\n<post body>\n<2-5 relevant hashtags on one line>\n\n=== Version 2 ===\n<post body>\n<2-5 relevant hashtags>\n\n=== Version 3 ===\n<post body>\n<2-5 relevant hashtags>';

      var text = await window.callAI(sys, user);
      btn.disabled = false; btn.textContent = '✨ Draft 3 versions';
      if(!text){ out.innerHTML = '<div style="color:#f5c842;font-size:13px;padding:14px">No AI response. Check that your Anthropic key is set in AI Settings.</div>'; return; }
      var parts = text.split(/===\s*Version\s*\d+\s*===/i).map(function(s){ return s.trim(); }).filter(Boolean);
      if(!parts.length) parts = [text];
      out.innerHTML = parts.map(function(p, i){ return resultCard('VERSION ' + (i+1), p); }).join('');
      wireCopyButtons(out);
      if(typeof window.glAudit === 'function') window.glAudit('ai_social_drafted', channel, { tone: tone, hasClient: !!c });
    });
  };

  /* ─── 2. CASE STUDY BUILDER ─── */
  window.openCaseStudyBuilder = function(){
    var clientOptions = '<option value="">— Pick a client —</option>' +
      (window.clients||[]).filter(function(c){ return c.status !== 'inactive'; }).map(function(c){
        return '<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>';
      }).join('');

    var ov = modal('gl-case-modal', '📰 AUTO CASE STUDY',
      '<div style="font-size:12px;color:#9aa7bd;margin-bottom:14px;line-height:1.6">Pick a client and the model drafts a 200-word case study from their invoice history, product types, and service. Edit before publishing.</div>' +
      '<div class="frow"><div class="flbl">Client</div><select class="fsel" id="gl-case-client">' + clientOptions + '</select></div>' +
      '<div class="frow"><div class="flbl">Angle</div>' +
        '<select class="fsel" id="gl-case-angle">' +
          '<option value="general">General success story</option>' +
          '<option value="growth">Volume growth over time</option>' +
          '<option value="rd">R&amp;D → production journey</option>' +
          '<option value="speed">Fast turnaround</option>' +
        '</select>' +
      '</div>' +
      '<div style="display:flex;gap:8px"><button id="gl-case-go" class="cbtn pri" style="flex:1">✨ Draft case study</button></div>' +
      '<div id="gl-case-out" style="margin-top:18px"></div>',
      { maxWidth: '600px' });

    ov.querySelector('#gl-case-go').addEventListener('click', async function(){
      var btn = this; var out = ov.querySelector('#gl-case-out');
      var cid = ov.querySelector('#gl-case-client').value;
      var angle = ov.querySelector('#gl-case-angle').value;
      var c = (window.clients||[]).find(function(x){ return x.id === cid; });
      if(!c){ alert('Pick a client first.'); return; }

      var clientInvs = (window.invoices||[]).filter(function(i){ return i.client === cid; });
      var totalBilled = clientInvs.reduce(function(s,i){ return s + (i.amount||0); }, 0);
      var paidCount = clientInvs.filter(function(i){ return i.status === 'paid'; }).length;

      var facts = [
        'Brand: ' + c.name,
        'Service: ' + (c.service || 'general co-packing'),
        c.productTypes && c.productTypes.length ? 'Product types: ' + c.productTypes.join(', ') : null,
        'Total billed lifetime: $' + Math.round(totalBilled).toLocaleString(),
        'Completed runs (paid invoices): ' + paidCount,
        c.notes ? 'Internal notes: ' + c.notes : null
      ].filter(Boolean).join('\n');

      btn.disabled = true; btn.textContent = '✨ Drafting…';
      out.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:14px;text-align:center">Composing case study…</div>';

      var angleHint = ({
        general: 'a general success story',
        growth:  'their growth in production volume over time',
        rd:      'their journey from R&D / formulation through production',
        speed:   'a fast turnaround we delivered'
      })[angle] || 'a general success story';

      var sys = 'You are a brand journalist writing a 180–220 word case study for Good Liquid Bev Co, a beverage co-packer in Palmetto FL. Keep it factual, never invent specifics that are not in the facts provided. Use the brand voice "we" (Good Liquid). End with one short line about being open to similar work.';
      var user = 'Write a case study highlighting ' + angleHint + ' about this client. Use only the facts below — if something would require detail not provided, write it more generally rather than fabricating numbers.\n\nFACTS:\n' + facts;

      var text = await window.callAI(sys, user);
      btn.disabled = false; btn.textContent = '✨ Draft case study';
      if(!text){ out.innerHTML = '<div style="color:#f5c842;font-size:13px;padding:14px">No AI response. Check your Anthropic key.</div>'; return; }
      out.innerHTML = resultCard('CASE STUDY · ' + c.name, text);
      wireCopyButtons(out);
      if(typeof window.glAudit === 'function') window.glAudit('ai_case_study_drafted', c.id, { angle: angle });
    });
  };

  /* ─── 3. POST-THIS-WEEK SUGGESTER ─── */
  window.openPostSuggester = function(){
    var ov = modal('gl-suggest-modal', '💡 POST IDEAS THIS WEEK',
      '<div style="font-size:12px;color:#9aa7bd;margin-bottom:14px;line-height:1.6">The model scans your recent CRM activity — wins, new clients, compliance milestones — and suggests 3 posts you could publish this week.</div>' +
      '<div style="display:flex;gap:8px"><button id="gl-suggest-go" class="cbtn pri" style="flex:1">✨ Suggest 3 posts</button></div>' +
      '<div id="gl-suggest-out" style="margin-top:18px"></div>',
      { maxWidth: '620px' });

    ov.querySelector('#gl-suggest-go').addEventListener('click', async function(){
      var btn = this; var out = ov.querySelector('#gl-suggest-out');
      var clientsList = (window.clients||[]).slice(0, 20);
      var recentInvs  = (window.invoices||[]).slice(0, 10);
      var activeClients = clientsList.filter(function(c){ return c.status === 'active'; }).length;
      var newLeads     = clientsList.filter(function(c){ return c.status === 'lead'; }).length;
      var productMix   = {};
      clientsList.forEach(function(c){ (c.productTypes||[]).forEach(function(p){ productMix[p] = (productMix[p]||0) + 1; }); });
      var topProducts = Object.keys(productMix).sort(function(a,b){ return productMix[b] - productMix[a]; }).slice(0, 3).join(', ');

      var snapshot = [
        'Active clients: ' + activeClients,
        'New leads in pipeline: ' + newLeads,
        topProducts ? 'Top product types we pack: ' + topProducts : null,
        'Recent paid invoices: ' + recentInvs.filter(function(i){return i.status==='paid';}).length,
        'Recent runs total $: ' + recentInvs.reduce(function(s,i){return s + (i.amount||0);}, 0).toLocaleString()
      ].filter(Boolean).join('\n');

      btn.disabled = true; btn.textContent = '✨ Thinking…';
      out.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:14px;text-align:center">Scanning the CRM…</div>';

      var sys = 'You are the head of marketing for Good Liquid Bev Co, a family-run beverage co-packer in Palmetto FL. You suggest 3 short post ideas the founders can publish this week across social channels. Suggestions should feel grounded in what is actually happening at the business — do not invent specific client names or dollar amounts unless provided.';
      var user = 'Here is a snapshot of what is happening this week:\n\n' + snapshot + '\n\nSuggest exactly 3 post ideas. For each, return:\n\n=== Idea N ===\nHeadline / hook: <one short line>\nChannel pick: <Instagram | LinkedIn | X | Facebook>\nWhy now: <one sentence — what makes this timely>\nDraft caption: <2-4 short sentences ready to post>\n\nUse the exact "=== Idea N ===" delimiter.';

      var text = await window.callAI(sys, user);
      btn.disabled = false; btn.textContent = '✨ Suggest 3 posts';
      if(!text){ out.innerHTML = '<div style="color:#f5c842;font-size:13px;padding:14px">No AI response. Check your Anthropic key.</div>'; return; }
      var parts = text.split(/===\s*Idea\s*\d+\s*===/i).map(function(s){ return s.trim(); }).filter(Boolean);
      if(!parts.length) parts = [text];
      out.innerHTML = parts.map(function(p, i){ return resultCard('IDEA ' + (i+1), p); }).join('');
      wireCopyButtons(out);
      if(typeof window.glAudit === 'function') window.glAudit('ai_post_suggested', '', { count: parts.length });
    });
  };

  console.log('[GL] AI marketing suite loaded');
}());


/* ============================================================
   SAMPLE SHIPMENTS
   - Log a shipment in seconds: client + kind + qty + tracking +
     follow-up date.
   - List view with status badge; overdue follow-ups render red.
   - Backed by Supabase `sample_shipments`; falls back to localStorage.
   ============================================================ */
(function(){
  function esc(v){ return v == null ? '' : String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  var KINDS = ['Formula sample','COA / lab','Mock-up label','Finished product','Other'];
  window.glSamples = window.glSamples || [];

  async function loadFromSupabase(){
    if(!window.supa) return null;
    try {
      var r = await window.supa.from('sample_shipments').select('*').order('shipped_date',{ascending:false});
      if(r && r.data) return r.data;
    } catch(e){ console.warn('[GL] sample_shipments load failed', e); }
    return null;
  }
  function loadLocal(){
    try { return JSON.parse(localStorage.getItem('gl_samples') || '[]'); } catch(e){ return []; }
  }
  function saveLocal(){ localStorage.setItem('gl_samples', JSON.stringify(window.glSamples)); }

  async function refresh(){
    var rows = await loadFromSupabase();
    window.glSamples = rows || loadLocal();
    render();
  }

  function render(){
    var host = document.getElementById('samp-body');
    if(!host) return;
    var sub = document.getElementById('samp-sub');
    var rows = window.glSamples || [];
    var today = new Date(); today.setHours(0,0,0,0);
    var overdueCount = rows.filter(function(s){
      return s.status === 'sent' && s.follow_up_date && new Date(s.follow_up_date) < today;
    }).length;
    if(sub) sub.textContent = rows.length + ' shipment' + (rows.length === 1 ? '' : 's') + (overdueCount ? ' · ' + overdueCount + ' follow-up' + (overdueCount === 1 ? '' : 's') + ' overdue' : '');

    if(!rows.length){
      host.innerHTML = '<div style="padding:30px;text-align:center;color:var(--muted);font-size:13px">No shipments logged yet. Click "Log Shipment" to add the first one.</div>';
      return;
    }
    var rowsHtml = rows.map(function(s){
      var clientName = s.client_name || ((window.clients||[]).find(function(c){ return c.id === s.client_id; })||{}).name || '—';
      var shipDate = s.shipped_date ? window.fmtLocalDate(s.shipped_date, {month:'short',day:'numeric',year:'numeric'}) : '—';
      var followBadge = '';
      if(s.status === 'responded'){
        followBadge = '<span style="padding:3px 9px;border-radius:20px;font-size:11px;font-weight:600;background:rgba(29,158,117,.15);color:#5fcf9e;border:1px solid rgba(29,158,117,.35)">✓ Responded</span>';
      } else if(s.status === 'no_response'){
        followBadge = '<span style="padding:3px 9px;border-radius:20px;font-size:11px;font-weight:600;background:rgba(155,155,155,.12);color:#9aa7bd;border:1px solid rgba(155,155,155,.3)">✕ No response</span>';
      } else if(s.follow_up_date){
        var fu = new Date(s.follow_up_date);
        if(fu < today){
          var daysLate = Math.round((today - fu) / 86400000);
          followBadge = '<span style="padding:3px 9px;border-radius:20px;font-size:11px;font-weight:700;background:rgba(231,76,60,.18);color:#ff8579;border:1px solid rgba(231,76,60,.4)">⚠ Follow up · ' + daysLate + 'd overdue</span>';
        } else {
          var daysLeft = Math.round((fu - today) / 86400000);
          followBadge = '<span style="padding:3px 9px;border-radius:20px;font-size:11px;font-weight:600;background:rgba(245,200,66,.12);color:#f5c842;border:1px solid rgba(245,200,66,.3)">Follow up in ' + daysLeft + 'd</span>';
        }
      } else {
        followBadge = '<span style="padding:3px 9px;border-radius:20px;font-size:11px;font-weight:600;background:rgba(0,229,192,.1);color:var(--teal);border:1px solid rgba(0,229,192,.3)">Sent</span>';
      }
      return '<tr style="cursor:pointer" onclick="window.glOpenEditSample(\'' + esc(s.id) + '\')">' +
        '<td style="padding:11px;font-weight:600;color:var(--white)">' + esc(clientName) + '</td>' +
        '<td style="padding:11px;color:var(--muted)">' + esc(s.kind || '—') + '</td>' +
        '<td style="padding:11px;color:var(--muted)">' + (s.qty || '—') + '</td>' +
        '<td style="padding:11px;color:var(--muted)">' + shipDate + '</td>' +
        '<td style="padding:11px;color:var(--muted);font-family:var(--ff-mono);font-size:11px">' + esc(s.tracking || '—') + '</td>' +
        '<td style="padding:11px">' + followBadge + '</td>' +
      '</tr>';
    }).join('');

    host.innerHTML = '<table class="ctbl"><thead><tr><th>Client</th><th>Kind</th><th>Qty</th><th>Shipped</th><th>Tracking</th><th>Status</th></tr></thead><tbody>' + rowsHtml + '</tbody></table>';
  }

  function sampleModal(existing){
    var prior = document.getElementById('gl-samp-modal'); if(prior) prior.remove();
    var host = document.getElementById('crm-panel') || document.body;
    var isEdit = !!existing;
    var s = existing || { client_id:'', kind:'Formula sample', qty:1, shipped_date: new Date().toISOString().slice(0,10), carrier:'', tracking:'', follow_up_date:'', status:'sent', notes:'' };
    // Default follow-up to +7 days if blank
    if(!s.follow_up_date && s.shipped_date){
      s.follow_up_date = new Date(Date.parse(s.shipped_date) + 7*86400000).toISOString().slice(0,10);
    }
    var clientOptions = '<option value="">— Pick client —</option>' +
      (window.clients||[]).map(function(c){
        var sel = (c.id === s.client_id) ? ' selected' : '';
        return '<option value="' + esc(c.id) + '"'+sel+'>' + esc(c.name) + '</option>';
      }).join('');
    var kindOptions = KINDS.map(function(k){
      var sel = (k === s.kind) ? ' selected' : '';
      return '<option value="' + esc(k) + '"'+sel+'>' + esc(k) + '</option>';
    }).join('');
    var carrierOptions = ['','FedEx','UPS','USPS','DHL','Hand delivery','Other'].map(function(o){
      var sel = (o === s.carrier) ? ' selected' : '';
      return '<option value="' + esc(o) + '"'+sel+'>' + esc(o || 'Select carrier…') + '</option>';
    }).join('');
    var statusOptions = [['sent','Sent'],['responded','Responded'],['no_response','No response']].map(function(o){
      var sel = (o[0] === s.status) ? ' selected' : '';
      return '<option value="' + o[0] + '"'+sel+'>' + o[1] + '</option>';
    }).join('');
    var ov = document.createElement('div');
    ov.id = 'gl-samp-modal';
    ov.setAttribute('style','position:fixed;inset:0;z-index:1000;background:rgba(6,13,26,.88);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:20px');
    ov.innerHTML =
      '<div style="background:#142238;border:1px solid rgba(0,229,192,.2);border-radius:14px;padding:26px;width:100%;max-width:480px;max-height:88vh;overflow-y:auto">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">' +
          '<div style="font-family:var(--ff-disp);font-size:18px;letter-spacing:2px;color:var(--teal)">' + (isEdit ? '✏️ EDIT SHIPMENT' : '📦 LOG SHIPMENT') + '</div>' +
          '<button id="gl-samp-close" style="background:none;border:none;color:#9aa7bd;font-size:20px;cursor:pointer">✕</button>' +
        '</div>' +
        '<div class="frow"><div class="flbl">Client *</div><select class="fsel" id="gl-samp-client">' + clientOptions + '</select></div>' +
        '<div style="display:grid;grid-template-columns:2fr 1fr;gap:8px">' +
          '<div class="frow"><div class="flbl">Kind</div><select class="fsel" id="gl-samp-kind">' + kindOptions + '</select></div>' +
          '<div class="frow"><div class="flbl">Qty</div><input class="finp" id="gl-samp-qty" type="number" min="1" value="' + (s.qty || 1) + '"></div>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
          '<div class="frow"><div class="flbl">Shipped date</div><input class="finp" id="gl-samp-date" type="date" value="' + esc(s.shipped_date) + '"></div>' +
          '<div class="frow"><div class="flbl">Follow-up date</div><input class="finp" id="gl-samp-followup" type="date" value="' + esc(s.follow_up_date) + '"></div>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 2fr;gap:8px">' +
          '<div class="frow"><div class="flbl">Carrier</div><select class="fsel" id="gl-samp-carrier">' + carrierOptions + '</select></div>' +
          '<div class="frow"><div class="flbl">Tracking #</div><input class="finp" id="gl-samp-tracking" value="' + esc(s.tracking) + '"></div>' +
        '</div>' +
        '<div class="frow"><div class="flbl">Status</div><select class="fsel" id="gl-samp-status">' + statusOptions + '</select></div>' +
        '<div class="frow"><div class="flbl">Notes</div><textarea class="finp" id="gl-samp-notes" rows="2">' + esc(s.notes) + '</textarea></div>' +
        '<div style="display:flex;gap:8px;margin-top:6px">' +
          '<button id="gl-samp-save" class="cbtn pri" style="flex:1">💾 Save</button>' +
          (isEdit ? '<button id="gl-samp-del" class="cbtn" style="background:rgba(231,76,60,.12);border-color:rgba(231,76,60,.35);color:#ff8579">Delete</button>' : '') +
          '<button id="gl-samp-cancel" class="cbtn">Cancel</button>' +
        '</div>' +
      '</div>';
    ov.addEventListener('click', function(e){ if(e.target === ov) ov.remove(); });
    ov.querySelector('#gl-samp-close').addEventListener('click', function(){ ov.remove(); });
    ov.querySelector('#gl-samp-cancel').addEventListener('click', function(){ ov.remove(); });
    var delBtn = ov.querySelector('#gl-samp-del');
    if(delBtn) delBtn.addEventListener('click', async function(){
      if(!confirm('Delete this shipment record?')) return;
      if(window.supa){ try { await window.supa.from('sample_shipments').delete().eq('id', s.id); } catch(e){} }
      window.glSamples = (window.glSamples||[]).filter(function(x){ return x.id !== s.id; });
      saveLocal(); render(); ov.remove();
      if(typeof addNotification === 'function') addNotification('📦 Shipment deleted','','warning');
      if(typeof window.glAudit === 'function') window.glAudit('sample_deleted', s.id, {});
    });
    ov.querySelector('#gl-samp-save').addEventListener('click', async function(){
      var cid = ov.querySelector('#gl-samp-client').value;
      if(!cid){ alert('Client is required.'); return; }
      var c = (window.clients||[]).find(function(x){ return x.id === cid; });
      var data = {
        client_id:      cid,
        client_name:    c ? c.name : '',
        kind:           ov.querySelector('#gl-samp-kind').value,
        qty:            parseInt(ov.querySelector('#gl-samp-qty').value, 10) || 1,
        shipped_date:   ov.querySelector('#gl-samp-date').value || null,
        carrier:        ov.querySelector('#gl-samp-carrier').value,
        tracking:       ov.querySelector('#gl-samp-tracking').value.trim(),
        follow_up_date: ov.querySelector('#gl-samp-followup').value || null,
        status:         ov.querySelector('#gl-samp-status').value,
        notes:          ov.querySelector('#gl-samp-notes').value
      };
      var btn = this; btn.disabled = true; btn.textContent = 'Saving…';
      if(window.supa){
        try {
          if(isEdit){
            await window.supa.from('sample_shipments').update(data).eq('id', s.id);
            Object.assign(s, data);
          } else {
            var r = await window.supa.from('sample_shipments').insert([data]).select().single();
            if(r && r.data){ window.glSamples.unshift(r.data); }
            else            { data.id = 'local_' + Date.now(); window.glSamples.unshift(data); }
          }
        } catch(e){
          console.warn('[GL] sample save failed; using local', e);
          if(isEdit) Object.assign(s, data);
          else { data.id = 'local_' + Date.now(); window.glSamples.unshift(data); }
        }
      } else {
        if(isEdit) Object.assign(s, data);
        else { data.id = 'local_' + Date.now(); window.glSamples.unshift(data); }
      }
      saveLocal();
      btn.disabled = false; btn.textContent = '💾 Save';
      ov.remove();
      render();
      if(typeof addNotification === 'function') addNotification(isEdit ? '📦 Shipment updated' : '📦 Shipment logged', data.client_name + ' · ' + data.kind, 'success');
      if(typeof window.glAudit === 'function') window.glAudit(isEdit ? 'sample_edited' : 'sample_logged', data.client_id, { kind: data.kind });
    });
    host.appendChild(ov);
  }

  window.glOpenAddSample = function(){ sampleModal(null); };
  window.glOpenEditSample = function(id){
    var s = (window.glSamples||[]).find(function(x){ return x.id === id; });
    if(s) sampleModal(s);
  };

  function watch(){
    var pg = document.getElementById('cpg-samples');
    if(!pg){ setTimeout(watch, 600); return; }
    new MutationObserver(function(){
      if(pg.classList.contains('act')) refresh();
    }).observe(pg, { attributes:true, attributeFilter:['class'] });
  }
  if(document.readyState !== 'loading') watch();
  else document.addEventListener('DOMContentLoaded', watch);

  console.log('[GL] sample shipments loaded');
}());

/* ============================================================
   AR AGING DASHBOARD WIDGET
   Renders a compact AR summary at the top of the dashboard
   (right under the compliance alert). Reuses the renderDash wrap
   pattern. No SQL — pure derived view of window.invoices.
   ============================================================ */
(function(){
  function fmt(n){ return '$' + Math.round(n).toLocaleString(); }

  function gather(){
    var today = new Date(); today.setHours(0,0,0,0);
    var buckets = { current:0, due30:0, due60:0, due90:0, due90plus:0 };
    var counts  = { current:0, due30:0, due60:0, due90:0, due90plus:0 };
    var total = 0;
    (window.invoices || []).forEach(function(i){
      if(!i) return;
      var status = (i.status||'').toLowerCase();
      // Outstanding = anything not paid.
      if(status === 'paid') return;
      var amt = i.amount || 0;
      total += amt;
      // Try to derive a due date — invoice.dueDate column if hydrated, otherwise
      // assume Net 30 from invoice.date.
      var dueStr = i.dueDate || i.due_date;
      var due;
      if(dueStr) due = new Date(dueStr);
      else if(i.date) due = new Date(Date.parse(i.date) + 30*86400000);
      else            due = today;
      due.setHours(0,0,0,0);
      var daysLate = Math.round((today - due) / 86400000);
      if(daysLate < 0)        { buckets.current += amt;   counts.current++; }
      else if(daysLate < 31)  { buckets.due30 += amt;     counts.due30++; }
      else if(daysLate < 61)  { buckets.due60 += amt;     counts.due60++; }
      else if(daysLate < 91)  { buckets.due90 += amt;     counts.due90++; }
      else                    { buckets.due90plus += amt; counts.due90plus++; }
    });
    return { buckets: buckets, counts: counts, total: total };
  }

  function buildSlot(){
    // Insert the AR-aging slot above the compliance alert if it isn't there.
    var existing = document.getElementById('dash-ar-aging');
    if(existing) return existing;
    var alert = document.getElementById('dash-compliance-alert');
    if(!alert) return null;
    var slot = document.createElement('div');
    slot.id = 'dash-ar-aging';
    alert.parentNode.insertBefore(slot, alert);
    return slot;
  }

  window.renderARAging = function(){
    var host = buildSlot();
    if(!host) return;
    var data = gather();
    var anyLate = data.counts.due30 + data.counts.due60 + data.counts.due90 + data.counts.due90plus;
    if(!anyLate && data.total === 0){ host.innerHTML = ''; return; }

    var bucketHtml = function(label, amt, count, color, accent){
      return '<div style="flex:1;min-width:0;background:rgba(255,255,255,.03);border:1px solid ' + accent + ';border-radius:10px;padding:10px 14px">' +
        '<div style="font-size:10px;letter-spacing:1.5px;color:' + color + ';margin-bottom:2px">' + label + '</div>' +
        '<div style="display:flex;justify-content:space-between;align-items:baseline">' +
          '<div style="font-family:var(--ff-disp);font-size:18px;color:var(--white)">' + fmt(amt) + '</div>' +
          '<div style="font-size:11px;color:var(--muted)">' + count + '</div>' +
        '</div>' +
      '</div>';
    };

    var headerColor = (data.counts.due60 + data.counts.due90 + data.counts.due90plus) > 0 ? '#ff8579' : (data.counts.due30 > 0 ? '#f5c842' : 'var(--teal)');
    var headerIcon  = headerColor === '#ff8579' ? '🚨' : headerColor === '#f5c842' ? '⚠' : '💰';

    host.innerHTML =
      '<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:12px;padding:14px 16px;margin-bottom:14px">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">' +
          '<div style="display:flex;align-items:center;gap:10px">' +
            '<span style="font-size:18px">' + headerIcon + '</span>' +
            '<div>' +
              '<div style="font-family:var(--ff-disp);font-size:13px;letter-spacing:2px;color:' + headerColor + '">ACCOUNTS RECEIVABLE</div>' +
              '<div style="font-size:11px;color:var(--muted);margin-top:2px">' + fmt(data.total) + ' outstanding · ' + anyLate + ' invoice' + (anyLate === 1 ? '' : 's') + ' past due</div>' +
            '</div>' +
          '</div>' +
          '<a href="javascript:void(0)" onclick="if(window.cNav)window.cNav(\'invoices\',null)" style="font-size:11px;color:var(--teal);text-decoration:none">View all →</a>' +
        '</div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
          bucketHtml('CURRENT',    data.buckets.current,   data.counts.current,   'var(--muted)',  'rgba(255,255,255,.07)') +
          bucketHtml('1–30 DAYS',  data.buckets.due30,     data.counts.due30,     '#f5c842',       'rgba(245,200,66,.25)') +
          bucketHtml('31–60 DAYS', data.buckets.due60,     data.counts.due60,     '#ff8579',       'rgba(231,76,60,.25)') +
          bucketHtml('61–90 DAYS', data.buckets.due90,     data.counts.due90,     '#ff8579',       'rgba(231,76,60,.3)') +
          bucketHtml('90+ DAYS',   data.buckets.due90plus, data.counts.due90plus, '#ff8579',       'rgba(231,76,60,.4)') +
        '</div>' +
      '</div>';
  };

  window.GL_HOOKS.registerDashPatch(function(){ try{ window.renderARAging(); }catch(e){ console.warn('[GL] AR widget render threw', e); } });

  console.log('[GL] AR aging widget loaded');
}());

/* ============================================================
   CROSS-SELL SUGGESTER (rules-based)
   ============================================================ */
(function(){
  function esc(v){ return v == null ? '' : String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  function lastInvoiceDate(clientId){
    var invs = (window.invoices||[]).filter(function(i){ return i.client === clientId; });
    if(!invs.length) return null;
    var dates = invs.map(function(i){ return i.date ? new Date(i.date) : null; }).filter(Boolean);
    if(!dates.length) return null;
    return new Date(Math.max.apply(null, dates));
  }

  function gatherForClient(c){
    var out = [];
    var service = (c.service || '').toLowerCase();
    var prods = c.productTypes || [];
    if(service.indexOf('bottl') >= 0 && service.indexOf('can') < 0){
      out.push({ id:'canning', title:'Offer canning', why:'Client only bottles with us. Canning runs lower MOQ and many bottling clients want a canned line extension.' });
    }
    if(service.indexOf('r&d') >= 0 && service.indexOf('canning') < 0 && service.indexOf('bottling') < 0){
      out.push({ id:'first_run', title:'Pitch first production run', why:'They started with R&D. Worth checking if the formula is locked and ready to scale.' });
    }
    if(prods.indexOf('kombucha') >= 0){
      out.push({ id:'pasteur', title:'Flash pasteurization for shelf stability', why:'Live kombucha typically needs refrigerated distribution. Pasteurization opens shelf-stable channels.' });
    }
    if(prods.indexOf('coldbrew') >= 0 || prods.indexOf('rtd') >= 0){
      out.push({ id:'nitro', title:'Nitrogen dosing for mouthfeel', why:'Cold brew + RTD cocktails benefit from nitro — better mouthfeel, premium positioning, a few cents per can.' });
    }
    if(service.indexOf('bottl') >= 0 && !(c.notes||'').toLowerCase().includes('label')){
      out.push({ id:'labels', title:'Label application service', why:'We can apply front + back labels in-line. Most bottling clients are paying a separate vendor for this.' });
    }
    if(c.status === 'active'){
      var last = lastInvoiceDate(c.id);
      var ninetyAgo = new Date(); ninetyAgo.setDate(ninetyAgo.getDate() - 90);
      if(!last || last < ninetyAgo){
        out.push({ id:'reengage', title:'Re-engage — no invoice in 90+ days', why:'Active client but no recent run. Quick check-in usually surfaces what they need.' });
      }
    }
    return out;
  }

  function gatherAll(){
    var rows = [];
    (window.clients||[]).forEach(function(c){
      if(c.status === 'inactive') return;
      var sugs = gatherForClient(c);
      sugs.forEach(function(s){ rows.push({ client:c, suggestion:s }); });
    });
    return rows;
  }

  function rowHtml(client, suggestion){
    return '<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:10px;padding:12px 14px;margin-bottom:9px">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">' +
        '<div style="min-width:0;flex:1">' +
          '<div style="font-size:13px;color:var(--white);font-weight:600;margin-bottom:2px">' + esc(client.name) + ' · <span style="color:var(--teal);font-weight:500">' + esc(suggestion.title) + '</span></div>' +
          '<div style="font-size:11px;color:var(--muted);line-height:1.5">' + esc(suggestion.why) + '</div>' +
        '</div>' +
        '<div style="display:flex;gap:6px;flex-shrink:0">' +
          '<button class="cbtn gl-cs-draft" data-cid="' + esc(client.id) + '" data-title="' + esc(suggestion.title) + '" data-why="' + esc(suggestion.why) + '" style="font-size:11px;padding:5px 11px">✉️ Draft</button>' +
          '<button class="cbtn gl-cs-view" data-cid="' + esc(client.id) + '" style="font-size:11px;padding:5px 11px">Open</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  window.openCrossSellSuggester = function(){
    var prior = document.getElementById('gl-cs-modal'); if(prior) prior.remove();
    var host = document.getElementById('crm-panel') || document.body;
    var rows = gatherAll();
    var ov = document.createElement('div');
    ov.id = 'gl-cs-modal';
    ov.setAttribute('style','position:fixed;inset:0;z-index:1000;background:rgba(6,13,26,.88);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:20px');
    var body = rows.length
      ? rows.map(function(r){ return rowHtml(r.client, r.suggestion); }).join('')
      : '<div style="padding:30px;text-align:center;color:var(--muted);font-size:13px">No cross-sell opportunities right now. Add more product-type or service data on your clients to surface ideas.</div>';
    ov.innerHTML =
      '<div style="background:#142238;border:1px solid rgba(0,229,192,.2);border-radius:14px;padding:26px;width:100%;max-width:620px;max-height:88vh;overflow-y:auto">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
          '<div style="font-family:var(--ff-disp);font-size:18px;letter-spacing:2px;color:var(--teal)">🎯 CROSS-SELL OPPORTUNITIES</div>' +
          '<button class="gl-cs-close" style="background:none;border:none;color:#9aa7bd;font-size:20px;cursor:pointer">✕</button>' +
        '</div>' +
        '<div style="font-size:12px;color:#9aa7bd;margin-bottom:14px">' + rows.length + ' opportunit' + (rows.length === 1 ? 'y' : 'ies') + ' found across the active client base.</div>' +
        body +
      '</div>';
    ov.addEventListener('click', function(e){ if(e.target === ov) ov.remove(); });
    ov.querySelector('.gl-cs-close').addEventListener('click', function(){ ov.remove(); });
    ov.querySelectorAll('.gl-cs-view').forEach(function(b){
      b.addEventListener('click', function(){
        var cid = b.getAttribute('data-cid');
        ov.remove();
        if(typeof window.viewClientEnhanced === 'function') window.viewClientEnhanced(cid);
        else if(typeof window.openClientDetail === 'function') window.openClientDetail(cid);
      });
    });
    ov.querySelectorAll('.gl-cs-draft').forEach(function(b){
      b.addEventListener('click', function(){
        var cid = b.getAttribute('data-cid');
        var title = b.getAttribute('data-title');
        var why = b.getAttribute('data-why');
        if(typeof window.openAICommModal === 'function'){
          ov.remove();
          window.openAICommModal();
          setTimeout(function(){
            var sel = document.getElementById('ai-comm-client'); if(sel) sel.value = cid;
            var ctx = document.getElementById('ai-comm-context');
            if(ctx) ctx.value = 'Cross-sell opportunity: ' + title + '\n\nWhy: ' + why + '\n\nDraft a short, friendly email pitching this to the client.';
          }, 200);
        } else {
          alert('Cross-sell: ' + title + '\n\nWhy: ' + why + '\n\n(AI email modal not available — copy this and send manually.)');
        }
        if(typeof window.glAudit === 'function') window.glAudit('cross_sell_drafted', cid, { rule: title });
      });
    });
    host.appendChild(ov);
  };

  console.log('[GL] cross-sell suggester loaded');
}());

/* ============================================================
   WIN-LOSS TRACKER
   - Hooks saveDealDetail: when a deal moves to Closed Won/Lost,
     prompt for reason + value + notes.
   - Persists via supa.from('deals').update(...). Stripped-undefined
     pattern means missing columns just no-op if migration not run.
   - openWinLossAnalytics aggregates won/lost/win-rate/top reasons.
   ============================================================ */
(function(){
  function esc(v){ return v == null ? '' : String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  var WON_REASONS  = ['Price competitive','Speed/timeline','Capability fit','Personal relationship','Referral','Other'];
  var LOST_REASONS = ['Price too high','Capability mismatch','Timeline too long','Picked competitor','Lost to in-house','Project paused','No response','Other'];

  function promptOutcome(dealName, isWon){
    return new Promise(function(resolve){
      var prior = document.getElementById('gl-wl-prompt'); if(prior) prior.remove();
      var host = document.getElementById('crm-panel') || document.body;
      var reasons = isWon ? WON_REASONS : LOST_REASONS;
      var opts = reasons.map(function(r){ return '<option value="'+esc(r)+'">'+esc(r)+'</option>'; }).join('');
      var ov = document.createElement('div');
      ov.id = 'gl-wl-prompt';
      ov.setAttribute('style','position:fixed;inset:0;z-index:1100;background:rgba(6,13,26,.92);backdrop-filter:blur(10px);display:flex;align-items:center;justify-content:center;padding:20px');
      ov.innerHTML =
        '<div style="background:#142238;border:1px solid ' + (isWon ? 'rgba(29,158,117,.4)' : 'rgba(231,76,60,.4)') + ';border-radius:14px;padding:26px;width:100%;max-width:440px">' +
          '<div style="font-family:var(--ff-disp);font-size:18px;letter-spacing:2px;color:' + (isWon ? '#5fcf9e' : '#ff8579') + ';margin-bottom:6px">' + (isWon ? '🎉 CLOSED WON' : '😔 CLOSED LOST') + '</div>' +
          '<div style="font-size:13px;color:#9aa7bd;margin-bottom:18px">' + esc(dealName) + ' — log the outcome so patterns emerge over time.</div>' +
          '<div class="frow"><div class="flbl">Primary reason</div><select class="fsel" id="gl-wl-reason">' + opts + '</select></div>' +
          '<div class="frow"><div class="flbl">Deal value at close ($)</div><input class="finp" id="gl-wl-value" type="number" min="0" placeholder="0"></div>' +
          '<div class="frow"><div class="flbl">Notes (optional)</div><textarea class="finp" id="gl-wl-notes" rows="2" placeholder="What specifically — pricing detail, competitor name, anything that helps future analysis…"></textarea></div>' +
          '<div style="display:flex;gap:8px;margin-top:6px">' +
            '<button id="gl-wl-save" class="cbtn pri" style="flex:1">💾 Save outcome</button>' +
            '<button id="gl-wl-skip" class="cbtn">Skip</button>' +
          '</div>' +
        '</div>';
      ov.querySelector('#gl-wl-save').addEventListener('click', function(){
        resolve({
          reason: ov.querySelector('#gl-wl-reason').value,
          value:  parseFloat(ov.querySelector('#gl-wl-value').value) || 0,
          notes:  ov.querySelector('#gl-wl-notes').value.trim()
        });
        ov.remove();
      });
      ov.querySelector('#gl-wl-skip').addEventListener('click', function(){ ov.remove(); resolve(null); });
      host.appendChild(ov);
    });
  }

  (function wrap(){
    if(typeof window.saveDealDetail !== 'function'){ setTimeout(wrap, 600); return; }
    if(window.saveDealDetail._wlWrapped) return;
    var orig = window.saveDealDetail;
    window.saveDealDetail = async function(){
      var stageEl = document.getElementById('ddp-stage');
      var nameEl  = document.getElementById('ddp-name');
      var stage = stageEl ? stageEl.value : '';
      var isClosed = (stage === 'Closed Won' || stage === 'Closed Lost');
      var movingToClosed = isClosed && (window.currentDealStage !== stage);
      if(movingToClosed){
        var outcome = await promptOutcome(nameEl ? nameEl.value : 'Deal', stage === 'Closed Won');
        if(outcome) window._glPendingOutcome = outcome;
      }
      var r = orig.apply(this, arguments);
      if(window._glPendingOutcome && window.supa){
        try {
          var name = nameEl ? nameEl.value : '';
          var deals = window.deals || {};
          var found = null;
          Object.keys(deals).forEach(function(s){
            (deals[s]||[]).forEach(function(d){ if(d && d.name === name) found = d; });
          });
          if(found && found.id && String(found.id).indexOf('tmp_') !== 0){
            var p = { outcome_reason: window._glPendingOutcome.reason, outcome_value: window._glPendingOutcome.value, outcome_notes: window._glPendingOutcome.notes, closed_at: new Date().toISOString() };
            await window.supa.from('deals').update(p).eq('id', found.id);
            found.outcomeReason = p.outcome_reason;
            found.outcomeValue  = p.outcome_value;
            found.outcomeNotes  = p.outcome_notes;
            found.closedAt      = p.closed_at;
          }
          if(typeof addNotification === 'function') addNotification('📊 Outcome logged', window._glPendingOutcome.reason, 'success');
          if(typeof window.glAudit === 'function') window.glAudit('deal_outcome_logged', name, { stage: stage, reason: window._glPendingOutcome.reason });
        } catch(e){ console.warn('[GL] outcome save failed', e); }
        delete window._glPendingOutcome;
      }
      return r;
    };
    window.saveDealDetail._wlWrapped = true;
  })();

  window.openWinLossAnalytics = async function(){
    var prior = document.getElementById('gl-wl-modal'); if(prior) prior.remove();
    var host = document.getElementById('crm-panel') || document.body;

    var rows = [];
    if(window.supa){
      try {
        var r = await window.supa.from('deals').select('*').in('stage',['Closed Won','Closed Lost']).order('closed_at',{ascending:false,nullsFirst:false});
        if(r && r.data) rows = r.data;
      } catch(e){ console.warn('[GL] win-loss fetch failed', e); }
    }
    if(!rows.length){
      var ddeals = window.deals || {};
      ['Closed Won','Closed Lost'].forEach(function(s){
        (ddeals[s]||[]).forEach(function(d){
          rows.push({ name:d.name, stage:s, outcome_reason:d.outcomeReason||'(no reason)', outcome_value:d.outcomeValue||0, closed_at:d.closedAt||null });
        });
      });
    }
    var won  = rows.filter(function(d){ return d.stage === 'Closed Won'; });
    var lost = rows.filter(function(d){ return d.stage === 'Closed Lost'; });
    var winTotal  = won.reduce(function(s,d){ return s + (Number(d.outcome_value)||0); }, 0);
    var lostTotal = lost.reduce(function(s,d){ return s + (Number(d.outcome_value)||0); }, 0);
    var winRate = (won.length + lost.length) ? Math.round(won.length / (won.length + lost.length) * 100) : 0;
    var byReason = {};
    lost.forEach(function(d){ var k = d.outcome_reason || '(no reason)'; byReason[k] = (byReason[k] || 0) + 1; });
    var topReasons = Object.keys(byReason).sort(function(a,b){ return byReason[b] - byReason[a]; }).slice(0, 5);
    function fmt$(n){ return '$' + Math.round(n).toLocaleString(); }

    var ov = document.createElement('div');
    ov.id = 'gl-wl-modal';
    ov.setAttribute('style','position:fixed;inset:0;z-index:1000;background:rgba(6,13,26,.88);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:20px');
    ov.innerHTML =
      '<div style="background:#142238;border:1px solid rgba(0,229,192,.2);border-radius:14px;padding:26px;width:100%;max-width:580px;max-height:88vh;overflow-y:auto">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">' +
          '<div style="font-family:var(--ff-disp);font-size:18px;letter-spacing:2px;color:var(--teal)">📊 WIN-LOSS ANALYTICS</div>' +
          '<button id="gl-wl-modclose" style="background:none;border:none;color:#9aa7bd;font-size:20px;cursor:pointer">✕</button>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:18px">' +
          '<div style="background:rgba(29,158,117,.08);border:1px solid rgba(29,158,117,.25);border-radius:10px;padding:12px;text-align:center">' +
            '<div style="font-size:10px;color:#5fcf9e;letter-spacing:1px">WON</div>' +
            '<div style="font-family:var(--ff-disp);font-size:22px;color:var(--white);margin:3px 0">' + won.length + '</div>' +
            '<div style="font-size:11px;color:var(--muted)">' + fmt$(winTotal) + '</div>' +
          '</div>' +
          '<div style="background:rgba(231,76,60,.08);border:1px solid rgba(231,76,60,.25);border-radius:10px;padding:12px;text-align:center">' +
            '<div style="font-size:10px;color:#ff8579;letter-spacing:1px">LOST</div>' +
            '<div style="font-family:var(--ff-disp);font-size:22px;color:var(--white);margin:3px 0">' + lost.length + '</div>' +
            '<div style="font-size:11px;color:var(--muted)">' + fmt$(lostTotal) + '</div>' +
          '</div>' +
          '<div style="background:rgba(0,229,192,.08);border:1px solid rgba(0,229,192,.25);border-radius:10px;padding:12px;text-align:center">' +
            '<div style="font-size:10px;color:var(--teal);letter-spacing:1px">WIN RATE</div>' +
            '<div style="font-family:var(--ff-disp);font-size:22px;color:var(--white);margin:3px 0">' + winRate + '%</div>' +
            '<div style="font-size:11px;color:var(--muted)">' + (won.length + lost.length) + ' decided</div>' +
          '</div>' +
        '</div>' +
        '<div style="font-family:var(--ff-disp);font-size:11px;letter-spacing:2px;color:#9aa7bd;margin-bottom:8px">TOP LOSS REASONS</div>' +
        (topReasons.length
          ? topReasons.map(function(rsn){
              var pct = lost.length ? Math.round(byReason[rsn] / lost.length * 100) : 0;
              return '<div style="display:flex;justify-content:space-between;align-items:center;padding:9px 0;border-bottom:1px solid rgba(255,255,255,.05)">' +
                '<div style="color:var(--white);font-size:13px">' + esc(rsn) + '</div>' +
                '<div style="display:flex;align-items:center;gap:10px">' +
                  '<div style="width:120px;height:6px;background:rgba(255,255,255,.05);border-radius:3px;overflow:hidden"><div style="width:' + pct + '%;height:100%;background:#ff8579"></div></div>' +
                  '<div style="color:var(--muted);font-size:11px;min-width:60px;text-align:right">' + byReason[rsn] + ' · ' + pct + '%</div>' +
                '</div>' +
              '</div>';
            }).join('')
          : '<div style="font-size:12px;color:var(--muted);padding:14px 0">No losses logged yet. As you close deals with a reason, this list will populate.</div>'
        ) +
      '</div>';
    ov.addEventListener('click', function(e){ if(e.target === ov) ov.remove(); });
    ov.querySelector('#gl-wl-modclose').addEventListener('click', function(){ ov.remove(); });
    host.appendChild(ov);
  };

  console.log('[GL] win-loss tracker loaded');
}());

