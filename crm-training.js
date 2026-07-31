/* ============================================================
   crm-training.js — Training & competency records
   ============================================================
   A self-contained module (no logic in index.html, nothing in
   localStorage — every record is a row in Postgres). Each training
   record is one row in the DB table training_records:
     id, employee_name, role, course, completed_date, expires_date,
     trainer, notes, active (bool), created_at.

   The module renders into the #cpg-training page:
     • a MATRIX (employees × courses) showing who is trained on what,
       flagging expired (red) and expiring-soon (amber) certifications;
     • a RECORDS list with an expiry badge and per-record Edit;
     • add / edit / delete via an overlay modal.

   Exposes:
     window.glRenderTraining()   — fills the #cpg-training page
     window.glAddTraining()      — modal to add a training record
     window.glEditTraining(id)   — modal to edit/delete one record
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

  // ── Expiry helpers ──────────────────────────────────────────
  // Returns one of 'none' | 'ok' | 'soon' | 'expired' plus the day
  // gap. "soon" = expiring within the next 60 days.
  function expiryState(expires){
    if(!expires) return { state:'none', days:null };
    var t0, t1;
    try { t0 = new Date(todayISO()+'T00:00:00'); t1 = new Date(String(expires).slice(0,10)+'T00:00:00'); }
    catch(e){ return { state:'none', days:null }; }
    if(isNaN(t1.getTime())) return { state:'none', days:null };
    var days = Math.round((t1 - t0) / 86400000);
    if(days < 0) return { state:'expired', days:days };
    if(days <= 60) return { state:'soon', days:days };
    return { state:'ok', days:days };
  }
  function expiryColor(state){
    if(state === 'expired') return '#ff8579';
    if(state === 'soon') return '#f5c842';
    if(state === 'ok') return '#5fcf9e';
    return '#9aa7bd';
  }
  function expiryBadge(expires){
    var e = expiryState(expires);
    var label, color = expiryColor(e.state), bg;
    if(e.state === 'none'){ return '<span style="font-size:10.5px;letter-spacing:.5px;color:#9aa7bd;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);border-radius:20px;padding:2px 9px">No expiry</span>'; }
    if(e.state === 'expired') label = 'Expired ' + (-e.days) + 'd ago';
    else if(e.state === 'soon') label = 'Expires in ' + e.days + 'd';
    else label = 'Valid · ' + esc(String(expires).slice(0,10));
    bg = e.state === 'expired' ? 'rgba(255,133,121,.12)' : (e.state === 'soon' ? 'rgba(245,200,66,.12)' : 'rgba(95,207,158,.12)');
    return '<span style="font-size:10.5px;letter-spacing:.5px;color:'+color+';background:'+bg+';border:1px solid '+color+';border-radius:20px;padding:2px 9px">'+esc(label)+'</span>';
  }

  // ── Distinct + sort helper (build the sets in JS, robustly) ──
  function distinctSorted(recs, key){
    var seen = {}, out = [];
    (recs||[]).forEach(function(r){
      var v = (r[key] == null ? '' : String(r[key])).trim();
      if(v && !seen[v]){ seen[v] = 1; out.push(v); }
    });
    out.sort(function(a,b){ return a.toLowerCase() < b.toLowerCase() ? -1 : (a.toLowerCase() > b.toLowerCase() ? 1 : 0); });
    return out;
  }

  // ── Main render ─────────────────────────────────────────────
  window.glRenderTraining = async function glRenderTraining(){
    var host = document.getElementById('cpg-training');
    if(!host) return;
    var header =
      '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:6px">' +
        '<div style="font-family:var(--ff-disp);font-size:24px;letter-spacing:2px;color:var(--teal)">🎓 TRAINING &amp; COMPETENCY</div>' +
        '<button onclick="window.glAddTraining()" style="padding:12px 20px;background:linear-gradient(135deg,#00e5c0,#00c4a7);color:#04231d;border:none;border-radius:9px;font-weight:800;font-size:14px;cursor:pointer">＋ Add training record</button>' +
      '</div>' +
      '<div style="font-size:12.5px;color:var(--muted);margin-bottom:18px;line-height:1.6">Who is trained on what, and when certifications lapse. Expired shows red, expiring within 60 days shows amber.</div>';

    if(!sb()){
      host.innerHTML = '<div style="max-width:1000px;margin:0 auto">' + header +
        '<div style="color:#ff8579;padding:16px 0">Supabase not ready.</div></div>';
      return;
    }

    host.innerHTML = '<div style="max-width:1000px;margin:0 auto">' + header +
      '<div style="color:#9aa7bd;padding:16px 0">Loading…</div></div>';

    var recs;
    try {
      var res = await sb().from('training_records').select('*').eq('active', true).order('employee_name', { ascending: true });
      if(res.error) throw res.error;
      recs = res.data || [];
    } catch(e){
      host.innerHTML = '<div style="max-width:1000px;margin:0 auto">' + header +
        '<div style="color:#ff8579;padding:16px 0">Could not load training records: '+esc(e.message||e)+'</div></div>';
      return;
    }

    if(!recs.length){
      host.innerHTML = '<div style="max-width:1000px;margin:0 auto">' + header +
        '<div style="color:#9aa7bd;padding:20px 0">No training records yet.</div></div>';
      return;
    }

    // ── MATRIX: employees (rows) × courses (columns) ──
    var employees = distinctSorted(recs, 'employee_name');
    var courses = distinctSorted(recs, 'course');
    // Index: employee -> course -> most-relevant record (worst expiry wins).
    var order = { expired:0, soon:1, none:2, ok:3 };
    var cellRec = {};
    recs.forEach(function(r){
      var emp = (r.employee_name||'').trim(), crs = (r.course||'').trim();
      if(!emp || !crs) return;
      var k = emp + '||' + crs;
      var prior = cellRec[k];
      if(!prior){ cellRec[k] = r; return; }
      var a = order[expiryState(r.expires_date).state], b = order[expiryState(prior.expires_date).state];
      if(a < b) cellRec[k] = r;
    });

    var thStyle = 'padding:8px 10px;font-size:11px;letter-spacing:.4px;color:#9aa7bd;text-align:left;position:sticky;left:0;background:#142238';
    var matHead = '<tr><th style="'+thStyle+';z-index:2">Employee</th>' +
      courses.map(function(c){ return '<th style="padding:8px 10px;font-size:11px;letter-spacing:.4px;color:#9aa7bd;text-align:center;white-space:nowrap">'+esc(c)+'</th>'; }).join('') + '</tr>';
    var matBody = employees.map(function(emp){
      var cells = courses.map(function(c){
        var r = cellRec[emp + '||' + c];
        if(!r) return '<td style="padding:8px 10px;text-align:center;color:#3d4a5f">·</td>';
        var e = expiryState(r.expires_date);
        var color = expiryColor(e.state === 'none' ? 'ok' : e.state);
        var sub = r.expires_date ? esc(String(r.expires_date).slice(0,10)) : '—';
        return '<td style="padding:8px 10px;text-align:center;border-top:1px solid rgba(255,255,255,.06)">' +
          '<div style="color:'+color+';font-weight:700;font-size:13px">✔</div>' +
          '<div style="font-size:10px;color:'+color+'">'+sub+'</div></td>';
      }).join('');
      return '<tr style="font-size:12px"><td style="padding:8px 10px;color:#eef4ff;font-weight:600;border-top:1px solid rgba(255,255,255,.06);position:sticky;left:0;background:#142238">'+esc(emp)+'</td>'+cells+'</tr>';
    }).join('');
    var matrix =
      '<div style="background:#142238;border:1px solid rgba(0,229,192,.18);border-radius:12px;padding:16px 18px;margin-bottom:18px">' +
        '<div style="font-size:10.5px;letter-spacing:1.5px;color:var(--teal);margin-bottom:10px">COMPETENCY MATRIX</div>' +
        '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">'+matHead+matBody+'</table></div>' +
        '<div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:12px;font-size:11px">' +
          '<span style="color:#5fcf9e">✔ Valid</span>' +
          '<span style="color:#f5c842">✔ Expiring ≤60d</span>' +
          '<span style="color:#ff8579">✔ Expired</span>' +
          '<span style="color:#3d4a5f">· None on file</span>' +
        '</div>' +
      '</div>';

    // ── RECORDS list ──
    var list = recs.map(function(r){
      return '<div style="border:1px solid rgba(0,229,192,.14);border-radius:10px;padding:12px 14px;margin-bottom:10px;background:rgba(255,255,255,.02)">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">' +
          '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">' +
            '<span style="font-weight:700;font-size:14px;color:#eef4ff">'+esc(r.employee_name)+'</span>' +
            (r.role ? '<span style="font-size:10.5px;letter-spacing:.5px;color:#9aa7bd;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);border-radius:20px;padding:2px 9px">'+esc(r.role)+'</span>' : '') +
            '<span style="font-size:12.5px;color:var(--teal)">'+esc(r.course)+'</span>' +
          '</div>' +
          '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">' +
            expiryBadge(r.expires_date) +
            '<button onclick="window.glEditTraining('+JSON.stringify(String(r.id))+')" style="padding:7px 13px;background:rgba(0,229,192,.12);color:var(--teal);border:1px solid rgba(0,229,192,.3);border-radius:7px;cursor:pointer;font-size:12px">Edit</button>' +
          '</div>' +
        '</div>' +
        '<div style="font-size:11.5px;color:#9aa7bd;margin-top:8px;line-height:1.5">' +
          'Completed: '+esc(r.completed_date ? String(r.completed_date).slice(0,10) : '—') +
          ' · Expires: '+esc(r.expires_date ? String(r.expires_date).slice(0,10) : '—') +
          (r.trainer ? ' · Trainer: '+esc(r.trainer) : '') +
        '</div>' +
        (r.notes ? '<div style="font-size:12px;color:#dfe7f1;margin-top:6px;line-height:1.5">'+esc(r.notes)+'</div>' : '') +
      '</div>';
    }).join('');
    var records =
      '<div style="font-size:10.5px;letter-spacing:1.5px;color:var(--teal);margin-bottom:10px">RECORDS · '+recs.length+'</div>' + list;

    host.innerHTML = '<div style="max-width:1000px;margin:0 auto">' + header + matrix + records + '</div>';
  };

  // ── Add / edit modal ────────────────────────────────────────
  function fld(label, id, type, value, required, placeholder){
    var base = 'width:100%;padding:10px;background:#0a1628;border:1px solid rgba(255,255,255,.12);border-radius:7px;color:#fff;font-size:13px;font-family:var(--ff-body)';
    var lab = '<label style="display:block;font-size:11px;letter-spacing:.4px;color:#9aa7bd;margin:10px 0 4px">'+esc(label)+(required?' <span style="color:#f5c842">*</span>':'')+'</label>';
    if(type === 'textarea') return lab + '<textarea id="'+id+'" placeholder="'+esc(placeholder||'')+'" style="'+base+';min-height:60px;resize:vertical">'+esc(value||'')+'</textarea>';
    if(type === 'date') return lab + '<input id="'+id+'" type="date" value="'+esc(value||'')+'" style="'+base+'">';
    return lab + '<input id="'+id+'" type="text" value="'+esc(value||'')+'" placeholder="'+esc(placeholder||'')+'" style="'+base+'">';
  }

  function openTrainingModal(rec){
    if(!sb()){ alert('Supabase not ready.'); return; }
    rec = rec || {};
    var editing = !!rec.id;
    var ov = overlay('gl-training-edit');
    var slc = function(d){ return d ? String(d).slice(0,10) : ''; };
    ov.innerHTML =
      '<div style="background:#142238;border:1px solid rgba(0,229,192,.2);border-radius:16px;padding:22px;width:100%;max-width:560px;color:#fff">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">' +
          '<div style="font-family:var(--ff-disp);font-size:17px;letter-spacing:1.5px;color:var(--teal)">'+(editing?'✏️ EDIT TRAINING RECORD':'＋ ADD TRAINING RECORD')+'</div>' +
          '<button onclick="document.getElementById(\'gl-training-edit\').remove()" style="background:none;border:none;color:#9aa7bd;font-size:20px;cursor:pointer">✕</button>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:0 12px">' +
          '<div>'+fld('Employee name', 'tr-employee', 'text', rec.employee_name, true, 'e.g. Jane Smith')+'</div>' +
          '<div>'+fld('Role', 'tr-role', 'text', rec.role, false, 'e.g. Line operator')+'</div>' +
        '</div>' +
        fld('Course', 'tr-course', 'text', rec.course, true, 'e.g. HACCP Level 2') +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:0 12px">' +
          '<div>'+fld('Completed date', 'tr-completed', 'date', slc(rec.completed_date), false)+'</div>' +
          '<div>'+fld('Expires date', 'tr-expires', 'date', slc(rec.expires_date), false)+'</div>' +
        '</div>' +
        fld('Trainer', 'tr-trainer', 'text', rec.trainer, false, 'e.g. External / QA lead') +
        fld('Notes', 'tr-notes', 'textarea', rec.notes, false, 'optional') +
        '<div id="tr-msg" style="display:none;font-size:12.5px;margin:12px 0 0;padding:9px 12px;border-radius:8px"></div>' +
        '<div style="display:flex;gap:10px;margin-top:14px">' +
          (editing ? '<button id="tr-delete" style="padding:11px 14px;background:rgba(255,133,121,.12);border:1px solid rgba(255,133,121,.4);border-radius:8px;color:#ff8579;font-size:13px;cursor:pointer">Delete</button>' : '') +
          '<button onclick="document.getElementById(\'gl-training-edit\').remove()" style="flex:1;padding:11px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);border-radius:8px;color:#dfe7f1;font-size:13px;cursor:pointer">Cancel</button>' +
          '<button id="tr-save" style="flex:1;padding:11px;background:rgba(0,229,192,.14);border:1px solid rgba(0,229,192,.35);border-radius:8px;color:var(--teal);font-weight:700;font-size:13px;cursor:pointer">💾 Save</button>' +
        '</div>' +
      '</div>';

    var msg = ov.querySelector('#tr-msg');
    var show = function(color, text){ msg.style.display='block'; msg.style.color=color; msg.style.background='rgba(255,255,255,.04)'; msg.textContent=text; };

    ov.querySelector('#tr-save').addEventListener('click', async function(){
      var btn = this;
      var employee = (ov.querySelector('#tr-employee').value||'').trim();
      var course   = (ov.querySelector('#tr-course').value||'').trim();
      if(!employee){ show('#ff8579','Employee name is required.'); return; }
      if(!course){ show('#ff8579','Course is required.'); return; }
      var row = {
        employee_name: employee,
        role:          (ov.querySelector('#tr-role').value||'').trim() || null,
        course:        course,
        completed_date:(ov.querySelector('#tr-completed').value||'') || null,
        expires_date:  (ov.querySelector('#tr-expires').value||'') || null,
        trainer:       (ov.querySelector('#tr-trainer').value||'').trim() || null,
        notes:         (ov.querySelector('#tr-notes').value||'').trim() || null,
        active:        true
      };
      btn.disabled = true; show('#9aa7bd','Saving…');
      try {
        var r;
        if(editing) r = await sb().from('training_records').update(row).eq('id', rec.id);
        else r = await sb().from('training_records').insert([row]);
        if(r.error) throw r.error;
        if(typeof window.glAudit === 'function') window.glAudit(editing?'training_updated':'training_added', employee, { course: course });
        ov.remove();
        window.glRenderTraining();
      } catch(e){
        btn.disabled = false;
        show('#ff8579','Save failed: ' + (e.message || e));
      }
    });

    var delBtn = ov.querySelector('#tr-delete');
    if(delBtn){
      delBtn.addEventListener('click', async function(){
        if(!window.confirm('Delete this training record for '+(rec.employee_name||'')+'? This cannot be undone.')) return;
        var btn = this; btn.disabled = true; show('#9aa7bd','Deleting…');
        try {
          var r = await sb().from('training_records').delete().eq('id', rec.id);
          if(r.error) throw r.error;
          if(typeof window.glAudit === 'function') window.glAudit('training_deleted', rec.employee_name||'', { course: rec.course });
          ov.remove();
          window.glRenderTraining();
        } catch(e){
          btn.disabled = false;
          show('#ff8579','Delete failed: ' + (e.message || e));
        }
      });
    }
  }

  window.glAddTraining = function glAddTraining(){ openTrainingModal(null); };

  window.glEditTraining = async function glEditTraining(id){
    if(!sb()){ alert('Supabase not ready.'); return; }
    try {
      var res = await sb().from('training_records').select('*').eq('id', id).maybeSingle();
      if(res.error) throw res.error;
      if(!res.data){ alert('Training record not found.'); return; }
      openTrainingModal(res.data);
    } catch(e){
      alert('Could not load record: ' + (e.message || e));
    }
  };

  // Render into the page container once the DOM is ready.
  function boot(){ try { if(document.getElementById('cpg-training')) window.glRenderTraining(); } catch(e){} }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  // Re-render if the page node appears later (SPA builds it after login).
  try {
    var mo = new MutationObserver(function(){ var h = document.getElementById('cpg-training'); if(h && !h.getAttribute('data-training-ready')){ h.setAttribute('data-training-ready','1'); window.glRenderTraining(); } });
    mo.observe(document.documentElement, { childList:true, subtree:true });
  } catch(e){}

  console.log('[GL] training & competency module loaded');
}());
