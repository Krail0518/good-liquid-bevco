/* ============================================================
   Job Intake — one spec sheet for every production job
   ============================================================
   Atlas Canning (and any portal client) fills this out for every job:
   end customer, product, quantity, can size and decoration, carbonation,
   lid color, tray format, shrink wrap, PakTechs, pasteurization, what they
   supply, and the formula, which is required. Saving a job emails Mike the
   full spec (trigger_notify_job_intake → notify-deal 'job_intake').

   Two entry points, one form:
     glOpenJobIntakeForm('portal')  portal tile; client comes from the login
     glOpenJobIntakeForm('staff')   Production Runs → Job Intakes → + New job
   And the staff list:
     glOpenJobIntakes()             every job, filter by status, open a job,
                                    change status, staff notes, open formula

   Table: public.job_intakes (20261027120000_job_intakes.sql). RLS lets a
   portal customer insert for their own client only, read their own jobs, and
   never update; staff have full access.

   Rules followed (CLAUDE.md): everything a customer typed is escaped with
   escHtml before it reaches markup (rule 5); every insert and update appends
   .select() and treats an empty result as failure (rule 4).
   ============================================================ */
(function(){
  'use strict';

  function getSB(){ return window.supa || null; }
  function escHtml(s){ return String(s==null?'':s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function fmtTs(d){ if(!d) return ''; try { return new Date(d).toLocaleString(); } catch(e){ return String(d); } }
  function fmtDate(d){ if(!d) return ''; try { return new Date(d + 'T00:00:00').toLocaleDateString(); } catch(e){ return String(d); } }

  var CAN_SIZES = [['12oz_standard','12 oz standard'],['12oz_sleek','12 oz sleek'],['16oz_standard','16 oz standard']];
  var DECORATIONS = [['printed','Printed cans'],['sleeved','Shrink sleeved cans'],['brite','Brite (blank) cans']];
  var SUPPLIES = [['cans','Cans'],['lids','Lids'],['trays','Case trays'],['paktechs','PakTechs'],['ingredients','Ingredients']];
  var FG = [['pickup','Customer picks up'],['ship','Ship out'],['warehouse','Store at the warehouse']];
  var STATUSES = [['submitted','Submitted'],['reviewed','Reviewed'],['scheduled','Scheduled'],['completed','Completed'],['cancelled','Cancelled']];
  var STATUS_COLOR = { submitted:'#f5c842', reviewed:'#6b9fff', scheduled:'#00e5c0', completed:'#5fcf9e', cancelled:'#9aa7bd' };

  function label(list, v){ for(var i=0;i<list.length;i++){ if(list[i][0]===v) return list[i][1]; } return v || ''; }

  var BOX = 'width:100%;padding:9px 11px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.14);border-radius:8px;color:#eef4ff;font-size:13px;box-sizing:border-box;font-family:inherit';
  var LBL = 'display:block;font-size:10px;letter-spacing:1.5px;color:#6b87ad;margin-bottom:5px;text-transform:uppercase';

  function field(id, text, inner, req){
    return '<div><label for="' + id + '" style="' + LBL + '">' + escHtml(text) + (req ? ' <span style="color:#ff8579">*</span>' : '') + '</label>' + inner + '</div>';
  }
  function input(id, type, attrs){ return '<input id="' + id + '" type="' + type + '" ' + (attrs||'') + ' style="' + BOX + '">'; }
  function select(id, opts, placeholder){
    return '<select id="' + id + '" style="' + BOX + '">' +
      (placeholder ? '<option value="">' + escHtml(placeholder) + '</option>' : '') +
      opts.map(function(o){ return '<option value="' + escHtml(o[0]) + '">' + escHtml(o[1]) + '</option>'; }).join('') +
    '</select>';
  }
  function section(title){
    return '<div style="grid-column:1/-1;font-size:11px;letter-spacing:2px;color:#00e5c0;font-weight:800;margin-top:10px;padding-top:12px;border-top:1px solid rgba(255,255,255,.07)">' + escHtml(title) + '</div>';
  }

  async function currentUserId(sb){
    var sess = await sb.auth.getSession();
    return sess && sess.data && sess.data.session && sess.data.session.user && sess.data.session.user.id;
  }

  // ── The form ─────────────────────────────────────────────────────
  window.glOpenJobIntakeForm = async function(mode){
    mode = (mode === 'staff') ? 'staff' : 'portal';
    var sb = getSB(); if(!sb){ alert('Not connected yet. Try again in a moment.'); return; }
    var old = document.getElementById('gl-ji-form'); if(old) old.remove();

    var uid = await currentUserId(sb);
    var clientId = null, clients = [];
    if(mode === 'portal'){
      var cu = await sb.from('customer_users').select('client_id').eq('auth_user_id', uid).maybeSingle();
      clientId = cu && cu.data && cu.data.client_id;
      if(!clientId){ alert('Your login is not linked to a client account. Email mike@goodliquid.com.'); return; }
    } else {
      var cr = await sb.from('clients').select('id, name').order('name');
      if(cr.error){ alert('Could not load clients: ' + cr.error.message); return; }
      clients = cr.data || [];
      var atlas = clients.filter(function(c){ return /atlas/i.test(c.name || ''); })[0];
      clientId = atlas ? atlas.id : (clients[0] && clients[0].id);
    }

    var ov = document.createElement('div');
    ov.id = 'gl-ji-form';
    ov.setAttribute('style','position:fixed;inset:0;z-index:1100;background:rgba(6,13,26,.94);backdrop-filter:blur(10px);display:flex;align-items:flex-start;justify-content:center;padding:24px;overflow-y:auto;font-family:Arial,Helvetica,sans-serif');
    var grid = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px';
    ov.innerHTML =
      '<div style="background:#142238;border:1px solid rgba(0,229,192,.25);border-radius:14px;padding:26px;width:100%;max-width:760px;color:#eef4ff;margin:auto 0">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
          '<div style="font-size:18px;font-weight:900;color:#00e5c0;letter-spacing:2px">🥫 NEW PRODUCTION JOB</div>' +
          '<button data-gl-close="#gl-ji-form" aria-label="Close" style="background:none;border:0;color:#6b87ad;font-size:22px;cursor:pointer">×</button>' +
        '</div>' +
        '<div style="font-size:12px;color:#9aa7bd;margin-bottom:16px;line-height:1.5">Fill this out for every job. Fields marked <span style="color:#ff8579">*</span> are required, and the formula must be attached. Mike gets the full spec by email as soon as you submit.</div>' +
        '<div style="' + grid + '">' +
          (mode === 'staff' ? field('gl-ji-client', 'Client', select('gl-ji-client', clients.map(function(c){ return [c.id, c.name || '(no name)']; })), true) : '') +
          section('THE JOB') +
          field('gl-ji-endcust', 'End customer / brand', input('gl-ji-endcust','text','maxlength="200" placeholder="Who the product is for"'), true) +
          field('gl-ji-product', 'Product / flavor', input('gl-ji-product','text','maxlength="200"'), true) +
          field('gl-ji-jobtype', 'Job type', select('gl-ji-jobtype', [['new','New product'],['repeat','Repeat run']]), true) +
          field('gl-ji-cases', 'Cases', input('gl-ji-cases','number','min="1" step="1" inputmode="numeric"'), true) +
          field('gl-ji-needed', 'Needed by', input('gl-ji-needed','date','')) +
          section('PACKAGING') +
          field('gl-ji-can', 'Can size', select('gl-ji-can', CAN_SIZES, 'Choose…'), true) +
          field('gl-ji-deco', 'Can decoration', select('gl-ji-deco', DECORATIONS, 'Choose…'), true) +
          field('gl-ji-lid', 'Lid color', input('gl-ji-lid','text','maxlength="60" placeholder="e.g. silver, black"'), true) +
          field('gl-ji-tray', 'Case tray', select('gl-ji-tray', [['24','24 count tray'],['12','12 count tray']], 'Choose…'), true) +
          field('gl-ji-shrink', 'Shrink wrap the trays', select('gl-ji-shrink', [['yes','Yes'],['no','No']], 'Choose…'), true) +
          field('gl-ji-pak', 'PakTech', select('gl-ji-pak', [['none','None'],['4','4 pack'],['6','6 pack']]), true) +
          field('gl-ji-pakcolor', 'PakTech color', input('gl-ji-pakcolor','text','maxlength="60" disabled')) +
          section('CODING (PRINTED ON THE CAN)') +
          field('gl-ji-exp', 'Best by / expiration date', input('gl-ji-exp','date',''), true) +
          field('gl-ji-batch', 'Batch code (optional)', input('gl-ji-batch','text','maxlength="60" placeholder="Leave blank if you do not need one"')) +
          section('LIQUID') +
          field('gl-ji-carb', 'Carbonation', select('gl-ji-carb', [['carbonated','Carbonated'],['still','Still (nitrogen dosed)']], 'Choose…'), true) +
          field('gl-ji-co2', 'CO2 volumes', input('gl-ji-co2','number','min="0.1" max="5" step="0.05" placeholder="e.g. 2.8" disabled')) +
          field('gl-ji-flash', 'Flash pasteurize', select('gl-ji-flash', [['no','No'],['yes','Yes']])) +
          field('gl-ji-pres', 'Preservative', input('gl-ji-pres','text','maxlength="200" placeholder="e.g. potassium sorbate"')) +
          field('gl-ji-pa', 'Process Authority letter on file', select('gl-ji-pa', [['','Not sure'],['yes','Yes'],['no','No']])) +
          field('gl-ji-ph', 'pH target', input('gl-ji-ph','text','maxlength="40"')) +
          field('gl-ji-brix', 'Brix target', input('gl-ji-brix','text','maxlength="40"')) +
          section('FORMULA (REQUIRED)') +
          '<div style="grid-column:1/-1">' +
            '<div style="display:flex;gap:16px;flex-wrap:wrap;font-size:13px;margin-bottom:10px">' +
              '<label><input type="radio" name="gl-ji-fsrc" value="upload" checked> Upload the formula</label>' +
              '<label><input type="radio" name="gl-ji-fsrc" value="onfile"> Use a formula already on file</label>' +
              (mode === 'staff' ? '<label><input type="radio" name="gl-ji-fsrc" value="vault"> Formula Vault</label>' : '') +
            '</div>' +
            '<div id="gl-ji-f-upload"><input id="gl-ji-ffile" type="file" accept=".pdf,.xlsx,.xls,.csv,.doc,.docx,.png,.jpg,.jpeg" style="' + BOX + '"></div>' +
            '<div id="gl-ji-f-onfile" hidden><select id="gl-ji-fdoc" style="' + BOX + '"><option value="">Loading…</option></select></div>' +
            '<div id="gl-ji-f-vault" hidden><select id="gl-ji-fvault" style="' + BOX + '"><option value="">Loading…</option></select></div>' +
          '</div>' +
          section('MATERIALS AND FINISHED GOODS') +
          '<div style="grid-column:1/-1"><div style="' + LBL + '">You are supplying</div><div style="display:flex;gap:14px;flex-wrap:wrap;font-size:13px">' +
            SUPPLIES.map(function(s){ return '<label><input type="checkbox" class="gl-ji-supply" value="' + s[0] + '"> ' + escHtml(s[1]) + '</label>'; }).join('') +
          '</div></div>' +
          field('gl-ji-pallet', 'Cases per pallet', input('gl-ji-pallet','number','min="1" max="1000" step="1"')) +
          field('gl-ji-fg', 'Finished goods', select('gl-ji-fg', FG, 'Choose…')) +
          '<div style="grid-column:1/-1">' + field('gl-ji-notes', 'Anything else we should know', '<textarea id="gl-ji-notes" rows="4" maxlength="4000" style="' + BOX + ';resize:vertical"></textarea>') + '</div>' +
        '</div>' +
        '<div id="gl-ji-msg" role="status" style="display:none;margin-top:14px;padding:9px 12px;border-radius:6px;font-size:12px"></div>' +
        '<div style="display:flex;gap:10px;justify-content:flex-end;margin-top:16px">' +
          '<button data-gl-close="#gl-ji-form" style="background:rgba(255,255,255,.06);color:#eef4ff;border:1px solid rgba(255,255,255,.12);padding:9px 16px;border-radius:6px;font-size:13px;cursor:pointer">Cancel</button>' +
          '<button id="gl-ji-send" style="background:#00e5c0;color:#0a1628;border:0;padding:9px 22px;border-radius:6px;font-size:13px;font-weight:800;cursor:pointer">Submit job</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);

    function $(id){ return document.getElementById(id); }
    function val(id){ var e = $(id); return e ? String(e.value || '').trim() : ''; }
    function say(kind, text){
      var m = $('gl-ji-msg'); if(!m) return;
      var c = kind === 'ok' ? ['rgba(95,207,158,.12)','rgba(95,207,158,.35)','#5fcf9e']
            : kind === 'info' ? ['rgba(107,159,255,.1)','rgba(107,159,255,.3)','#9ab8ff']
            : ['rgba(231,76,60,.12)','rgba(231,76,60,.35)','#ff8579'];
      m.style.display = 'block'; m.style.background = c[0]; m.style.border = '1px solid ' + c[1]; m.style.color = c[2];
      m.textContent = text;
    }
    function fsrc(){ var r = ov.querySelector('input[name="gl-ji-fsrc"]:checked'); return r ? r.value : 'upload'; }

    $('gl-ji-carb').onchange = function(){
      var co2 = $('gl-ji-co2'); co2.disabled = this.value !== 'carbonated'; if(co2.disabled) co2.value = '';
    };
    $('gl-ji-pak').onchange = function(){
      var pc = $('gl-ji-pakcolor'); pc.disabled = this.value === 'none'; if(pc.disabled) pc.value = '';
    };
    ov.querySelectorAll('input[name="gl-ji-fsrc"]').forEach(function(r){
      r.onchange = function(){
        $('gl-ji-f-upload').hidden = fsrc() !== 'upload';
        $('gl-ji-f-onfile').hidden = fsrc() !== 'onfile';
        var v = $('gl-ji-f-vault'); if(v) v.hidden = fsrc() !== 'vault';
      };
    });

    // Formula documents already on file for the client. Under RLS a portal
    // customer sees only documents published to them.
    async function loadFormulaChoices(){
      var cid = mode === 'staff' ? val('gl-ji-client') : clientId;
      var dsel = $('gl-ji-fdoc');
      var dr = await sb.from('deal_documents').select('id, name, created_at').eq('client_id', cid).eq('doc_type', 'Formula').order('created_at', { ascending:false }).limit(100);
      var docs = (dr && dr.data) || [];
      dsel.innerHTML = docs.length
        ? '<option value="">Choose a formula…</option>' + docs.map(function(d){ return '<option value="' + escHtml(d.id) + '">' + escHtml(d.name || 'Formula') + ' (' + escHtml(fmtDate(String(d.created_at||'').slice(0,10))) + ')</option>'; }).join('')
        : '<option value="">No formulas on file yet. Upload one instead.</option>';
      var vsel = $('gl-ji-fvault');
      if(vsel){
        var vr = await sb.from('formulas').select('id, name, version, client_id, client_name').order('name').limit(500);
        var all = (vr && vr.data) || [];
        var cname = (clients.filter(function(c){ return c.id === cid; })[0] || {}).name || '';
        var mine = all.filter(function(f){ return f.client_id === cid || (cname && f.client_name === cname); });
        var list = mine.length ? mine : all;
        vsel.innerHTML = '<option value="">' + (mine.length ? 'Choose a formula…' : 'No Vault formulas for this client. All formulas:') + '</option>' +
          list.map(function(f){ return '<option value="' + escHtml(f.id) + '">' + escHtml(f.name || 'Formula') + (f.version ? ' v' + escHtml(f.version) : '') + (f.client_name && !mine.length ? ' (' + escHtml(f.client_name) + ')' : '') + '</option>'; }).join('');
      }
    }
    if(mode === 'staff'){
      $('gl-ji-client').value = clientId || '';
      $('gl-ji-client').onchange = loadFormulaChoices;
    }
    loadFormulaChoices();

    $('gl-ji-send').onclick = async function(){
      var btn = this;
      var cid = mode === 'staff' ? val('gl-ji-client') : clientId;
      var missing = [];
      var row = {
        client_id: cid,
        submitted_via: mode,
        end_customer: val('gl-ji-endcust'),
        product_name: val('gl-ji-product'),
        job_type: val('gl-ji-jobtype') || 'new',
        cases: parseInt(val('gl-ji-cases'), 10),
        can_size: val('gl-ji-can'),
        can_decoration: val('gl-ji-deco'),
        carbonation: val('gl-ji-carb'),
        co2_volumes: val('gl-ji-co2') ? Number(val('gl-ji-co2')) : null,
        lid_color: val('gl-ji-lid'),
        tray_format: parseInt(val('gl-ji-tray'), 10),
        shrink_wrap: val('gl-ji-shrink') === 'yes',
        paktech: val('gl-ji-pak') || 'none',
        paktech_color: val('gl-ji-pakcolor') || null,
        flash_pasteurize: val('gl-ji-flash') === 'yes',
        preservative: val('gl-ji-pres') || null,
        pa_letter_on_file: val('gl-ji-pa') === '' ? null : val('gl-ji-pa') === 'yes',
        ph_target: val('gl-ji-ph') || null,
        brix_target: val('gl-ji-brix') || null,
        client_supplies: Array.prototype.map.call(ov.querySelectorAll('.gl-ji-supply:checked'), function(c){ return c.value; }),
        expiration_date: val('gl-ji-exp') || null,
        batch_code: val('gl-ji-batch') || null,
        cases_per_pallet: val('gl-ji-pallet') ? parseInt(val('gl-ji-pallet'), 10) : null,
        fg_disposition: val('gl-ji-fg') || null,
        needed_by: val('gl-ji-needed') || null,
        notes: val('gl-ji-notes') || null
      };
      if(mode === 'portal') row.submitted_by = uid;
      if(!cid) missing.push('client');
      if(!row.end_customer) missing.push('end customer');
      if(!row.product_name) missing.push('product');
      if(!(row.cases >= 1)) missing.push('cases');
      if(!row.can_size) missing.push('can size');
      if(!row.can_decoration) missing.push('can decoration');
      if(!row.lid_color) missing.push('lid color');
      if(!row.tray_format) missing.push('case tray');
      if(!val('gl-ji-shrink')) missing.push('shrink wrap');
      if(!row.carbonation) missing.push('carbonation');
      if(!row.expiration_date) missing.push('best by / expiration date');
      else if(row.expiration_date <= new Date().toISOString().slice(0,10)){ say('err', 'The best by / expiration date has to be in the future.'); return; }
      if(row.carbonation === 'carbonated' && !(row.co2_volumes > 0 && row.co2_volumes <= 5)) missing.push('CO2 volumes (0.1 to 5)');
      var src = fsrc(), file = null;
      if(src === 'upload'){
        file = $('gl-ji-ffile').files && $('gl-ji-ffile').files[0];
        if(!file) missing.push('formula file');
        else if(file.size > 25 * 1024 * 1024){ say('err', 'The formula file is over 25 MB. Email it to mike@goodliquid.com instead.'); return; }
      } else if(src === 'onfile'){
        row.formula_doc_id = val('gl-ji-fdoc') || null;
        if(!row.formula_doc_id) missing.push('formula on file');
      } else {
        row.formula_id = val('gl-ji-fvault') || null;
        if(!row.formula_id) missing.push('Formula Vault formula');
      }
      if(missing.length){ say('err', 'Please fill in: ' + missing.join(', ') + '.'); return; }

      btn.disabled = true; var orig = btn.textContent; btn.textContent = 'Submitting…';
      try {
        if(src === 'upload'){
          say('info', 'Uploading the formula…');
          var ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
          // Portal uploads must live under <client>/portal/ (storage and
          // deal_documents policies); staff uploads use <client>/docs/ like
          // the CRM's own document cards.
          var path = cid + (mode === 'portal' ? '/portal/' : '/docs/') + Date.now() + '_' + Math.random().toString(36).slice(2, 7) + '.' + ext;
          var up = await sb.storage.from('client-docs').upload(path, file, { cacheControl:'3600', upsert:false });
          if(up.error) throw new Error('Formula upload failed: ' + (up.error.message || 'unknown'));
          var doc = await sb.from('deal_documents').insert({
            client_id: cid,
            doc_type: 'Formula',
            name: file.name,
            notes: 'Attached to job intake: ' + row.end_customer + ', ' + row.product_name,
            file_path: path,
            file_type: file.type || null,
            // A customer's own upload is visible to them (default is internal);
            // a staff upload stays internal until someone publishes it.
            client_visible: mode === 'portal',
            project_id: null,
            uploaded_by: mode === 'portal' ? 'portal:job-intake' : 'staff:job-intake'
          }).select('id');
          if(doc.error) throw new Error('Could not save the formula: ' + (doc.error.message || 'unknown'));
          if(!doc.data || !doc.data.length) throw new Error('The formula was not saved. Email it to mike@goodliquid.com.');
          row.formula_doc_id = doc.data[0].id;
        }
        say('info', 'Saving the job…');
        var ins = await sb.from('job_intakes').insert(row).select('id, job_no');
        if(ins.error) throw new Error(ins.error.message || 'the job was rejected');
        if(!ins.data || !ins.data.length) throw new Error('The job was not saved. Please try again.');
        var no = ins.data[0].job_no;
        say('ok', '✓ Job #' + no + ' submitted. Mike has the full spec by email.');
        btn.textContent = 'Submitted ✓';
        setTimeout(function(){
          ov.remove();
          if(mode === 'staff' && document.getElementById('gl-ji-list-modal')) window.glOpenJobIntakes();
        }, 1600);
      } catch(e){
        console.error('[GL job intake] submit failed', e);
        say('err', 'Submission failed: ' + (e && e.message || 'unknown'));
        btn.disabled = false; btn.textContent = orig;
      }
    };
  };

  // ── Staff list ───────────────────────────────────────────────────
  window.glOpenJobIntakes = async function(){
    var sb = getSB(); if(!sb) return;
    var old = document.getElementById('gl-ji-list-modal'); if(old) old.remove();
    var ov = document.createElement('div');
    ov.id = 'gl-ji-list-modal';
    ov.style.cssText = 'position:fixed;inset:0;z-index:720;background:rgba(6,13,26,.95);backdrop-filter:blur(16px);display:flex;align-items:center;justify-content:center;padding:20px;overflow-y:auto';
    ov.innerHTML = '<div style="background:#142238;border:1px solid rgba(255,255,255,.1);border-radius:14px;padding:24px;width:100%;max-width:980px;max-height:90vh;overflow-y:auto;color:#eef4ff;font-family:Arial,Helvetica,sans-serif">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap">' +
        '<div style="font-family:var(--ff-disp);font-size:20px;letter-spacing:2px;color:#00e5c0">🥫 JOB INTAKES</div>' +
        '<div style="display:flex;gap:8px;align-items:center">' +
          '<button id="gl-ji-new" class="cbtn pri">+ New job</button>' +
          '<button data-gl-close="#gl-ji-list-modal" aria-label="Close" style="background:none;border:0;color:#9aa7bd;font-size:22px;cursor:pointer">×</button>' +
        '</div>' +
      '</div>' +
      '<div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap">' +
        '<select id="gl-ji-fstatus" style="' + BOX + ';width:auto"><option value="open">Open (submitted, reviewed, scheduled)</option>' +
          STATUSES.map(function(s){ return '<option value="' + s[0] + '">' + s[1] + '</option>'; }).join('') + '<option value="">All</option></select>' +
        '<input id="gl-ji-search" type="search" placeholder="Search client, end customer, product" style="' + BOX + ';flex:1;min-width:200px">' +
      '</div>' +
      '<div id="gl-ji-rows"><div style="padding:30px;text-align:center;color:#9aa7bd">Loading…</div></div>' +
    '</div>';
    document.body.appendChild(ov);
    ov.addEventListener('click', function(e){ if(e.target === ov) ov.remove(); });
    document.getElementById('gl-ji-new').onclick = function(){ window.glOpenJobIntakeForm('staff'); };

    var rows = [], clientMap = {}, docMap = {}, vaultMap = {};
    var r = await sb.from('job_intakes').select('*').order('created_at', { ascending:false }).limit(500);
    if(r.error){ document.getElementById('gl-ji-rows').innerHTML = '<div style="padding:30px;color:#ff8579">Could not load jobs: ' + escHtml(r.error.message) + '</div>'; return; }
    rows = r.data || [];
    var cr = await sb.from('clients').select('id, name');
    (cr.data || []).forEach(function(c){ clientMap[c.id] = c.name; });
    var docIds = rows.map(function(x){ return x.formula_doc_id; }).filter(Boolean);
    if(docIds.length){
      var dr = await sb.from('deal_documents').select('id, name, file_path').in('id', docIds);
      (dr.data || []).forEach(function(d){ docMap[d.id] = d; });
    }
    var vIds = rows.map(function(x){ return x.formula_id; }).filter(Boolean);
    if(vIds.length){
      var vr = await sb.from('formulas').select('id, name, version').in('id', vIds);
      (vr.data || []).forEach(function(f){ vaultMap[f.id] = f; });
    }

    function spec(j){
      var cans = j.cases * j.tray_format;
      var items = [
        ['Quantity', j.cases.toLocaleString() + ' cases (' + cans.toLocaleString() + ' cans)'],
        ['Job type', j.job_type === 'repeat' ? 'Repeat run' : 'New product'],
        ['Can', label(CAN_SIZES, j.can_size) + ', ' + label(DECORATIONS, j.can_decoration)],
        ['Carbonation', j.carbonation === 'carbonated' ? 'Carbonated, ' + j.co2_volumes + ' vol CO2' : 'Still (nitrogen dosed)'],
        ['Lid color', j.lid_color],
        ['Case tray', j.tray_format + ' count' + (j.shrink_wrap ? ', shrink wrapped' : ', no shrink wrap')],
        ['PakTech', j.paktech === 'none' ? 'None' : j.paktech + ' pack' + (j.paktech_color ? ' (' + j.paktech_color + ')' : '')],
        ['Flash pasteurize', j.flash_pasteurize ? 'Yes' : 'No'],
        ['Preservative', j.preservative],
        ['PA letter on file', j.pa_letter_on_file == null ? '' : (j.pa_letter_on_file ? 'Yes' : 'No')],
        ['pH / Brix', [j.ph_target, j.brix_target].filter(Boolean).join(' / ')],
        ['Client supplies', (j.client_supplies || []).map(function(s){ return label(SUPPLIES, s); }).join(', ') || 'Nothing listed'],
        ['Best by / expiration date', fmtDate(j.expiration_date)],
        ['Batch code', j.batch_code || 'None requested'],
        ['Cases per pallet', j.cases_per_pallet],
        ['Finished goods', label(FG, j.fg_disposition)],
        ['Needed by', fmtDate(j.needed_by)]
      ].filter(function(x){ return x[1] !== null && x[1] !== undefined && x[1] !== ''; });
      return '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:6px 18px;font-size:12px;margin-top:10px">' +
        items.map(function(x){ return '<div><span style="color:#6b87ad">' + escHtml(x[0]) + ':</span> ' + escHtml(x[1]) + '</div>'; }).join('') +
      '</div>';
    }

    function render(){
      var st = document.getElementById('gl-ji-fstatus').value;
      var q = (document.getElementById('gl-ji-search').value || '').toLowerCase();
      var list = rows.filter(function(j){
        if(st === 'open' && !(j.status === 'submitted' || j.status === 'reviewed' || j.status === 'scheduled')) return false;
        if(st && st !== 'open' && j.status !== st) return false;
        if(q){
          var hay = [clientMap[j.client_id], j.end_customer, j.product_name, 'job ' + j.job_no].join(' ').toLowerCase();
          if(hay.indexOf(q) < 0) return false;
        }
        return true;
      });
      var el = document.getElementById('gl-ji-rows');
      if(!list.length){ el.innerHTML = '<div style="padding:50px;text-align:center;color:#9aa7bd;font-size:13px">No jobs match.</div>'; return; }
      el.innerHTML = list.map(function(j){
        var col = STATUS_COLOR[j.status] || '#9aa7bd';
        var doc = j.formula_doc_id && docMap[j.formula_doc_id];
        var vault = j.formula_id && vaultMap[j.formula_id];
        var formula = doc
          ? '<button class="gl-ji-fopen" data-path="' + escHtml(doc.file_path || '') + '" data-name="' + escHtml(doc.name || 'formula') + '" style="background:rgba(196,164,248,.12);border:1px solid rgba(196,164,248,.4);color:#c4a4f8;padding:4px 10px;border-radius:6px;font-size:11px;cursor:pointer">⚗️ ' + escHtml(doc.name || 'Formula') + '</button>'
          : vault ? '<span style="font-size:11px;color:#c4a4f8">⚗️ Vault: ' + escHtml(vault.name || '') + (vault.version ? ' v' + escHtml(vault.version) : '') + '</span>'
          : '<span style="font-size:11px;color:#ff8579">Formula no longer on file</span>';
        return '<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-left:3px solid ' + col + ';border-radius:8px;padding:14px 16px;margin-bottom:10px">' +
          '<div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap">' +
            '<div>' +
              '<div style="font-size:11px;color:#6b87ad;letter-spacing:1px">JOB #' + escHtml(j.job_no) + ' · ' + escHtml(clientMap[j.client_id] || 'Unknown client') + ' · ' + escHtml(fmtTs(j.created_at)) + (j.submitted_via === 'staff' ? ' · entered by staff' : '') + '</div>' +
              '<div style="font-size:15px;color:#fff;font-weight:700;margin-top:3px">' + escHtml(j.end_customer) + ', ' + escHtml(j.product_name) + '</div>' +
            '</div>' +
            '<div style="display:flex;gap:8px;align-items:center">' + formula +
              '<select class="gl-ji-status" data-id="' + escHtml(j.id) + '" style="' + BOX + ';width:auto;padding:5px 8px;font-size:11px;color:' + col + '">' +
                STATUSES.map(function(s){ return '<option value="' + s[0] + '"' + (s[0] === j.status ? ' selected' : '') + '>' + s[1] + '</option>'; }).join('') +
              '</select>' +
            '</div>' +
          '</div>' +
          spec(j) +
          (j.notes ? '<div style="font-size:12px;margin-top:10px;padding:9px 12px;background:rgba(255,255,255,.03);border-radius:6px;white-space:pre-wrap">' + escHtml(j.notes) + '</div>' : '') +
          '<div style="display:flex;gap:8px;margin-top:10px">' +
            '<input class="gl-ji-snote" data-id="' + escHtml(j.id) + '" maxlength="4000" placeholder="Staff notes (internal)" value="' + escHtml(j.staff_notes || '') + '" style="' + BOX + ';font-size:12px">' +
            '<button class="gl-ji-snote-save" data-id="' + escHtml(j.id) + '" style="background:rgba(0,229,192,.12);border:1px solid rgba(0,229,192,.4);color:#00e5c0;padding:5px 12px;border-radius:6px;font-size:11px;cursor:pointer;white-space:nowrap">Save note</button>' +
          '</div>' +
        '</div>';
      }).join('');

      el.querySelectorAll('.gl-ji-status').forEach(function(s){
        s.onchange = async function(){
          var id = s.getAttribute('data-id'), prev = (rows.filter(function(x){ return x.id === id; })[0] || {}).status;
          var u = await sb.from('job_intakes').update({ status: s.value }).eq('id', id).select('id, status');
          if(u.error || !u.data || !u.data.length){ alert('Status was not saved' + (u.error ? ': ' + u.error.message : '.')); s.value = prev; return; }
          rows.forEach(function(x){ if(x.id === id) x.status = u.data[0].status; });
          render();
        };
      });
      el.querySelectorAll('.gl-ji-snote-save').forEach(function(b){
        b.onclick = async function(){
          var id = b.getAttribute('data-id');
          var inp = el.querySelector('.gl-ji-snote[data-id="' + CSS.escape(id) + '"]');
          var u = await sb.from('job_intakes').update({ staff_notes: (inp.value || '').trim() || null }).eq('id', id).select('id, staff_notes');
          if(u.error || !u.data || !u.data.length){ alert('Note was not saved' + (u.error ? ': ' + u.error.message : '.')); return; }
          rows.forEach(function(x){ if(x.id === id) x.staff_notes = u.data[0].staff_notes; });
          b.textContent = 'Saved ✓'; setTimeout(function(){ b.textContent = 'Save note'; }, 1200);
        };
      });
      el.querySelectorAll('.gl-ji-fopen').forEach(function(b){
        b.onclick = async function(){
          var p = b.getAttribute('data-path'); if(!p) return;
          var su = await sb.storage.from('client-docs').createSignedUrl(p, 60, { download: b.getAttribute('data-name') || true });
          if(su.error || !su.data){ alert('Could not open the formula: ' + (su.error ? su.error.message : 'no link')); return; }
          window.open(su.data.signedUrl, '_blank', 'noopener');
        };
      });
    }
    document.getElementById('gl-ji-fstatus').onchange = render;
    document.getElementById('gl-ji-search').oninput = render;
    render();
  };

  // Portal tile, rendered by portal-customer.js next to the request tiles.
  window.glJobIntakeTile = function(){
    return '<div class="gl-portal-card" data-gl-action="glOpenJobIntakeForm" data-gl-arg1="portal" style="background:#142238;border:1px solid rgba(0,229,192,.35);border-radius:12px;padding:16px 18px;cursor:pointer;transition:background .15s,border-color .15s">' +
      '<div style="font-size:22px">🥫</div>' +
      '<div style="font-size:14px;font-weight:700;color:#fff;margin-top:6px">New production job</div>' +
      '<div style="font-size:11px;color:#6b87ad;margin-top:2px">Job spec and formula for every run</div>' +
    '</div>';
  };
})();
