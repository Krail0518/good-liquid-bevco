/* ============================================================
   EMAIL TEMPLATES — pickable subject + body for outbound emails
   Adds:
     - Template picker dropdown injected into Send Invoice composer
       (#gl-send-inv-modal) and AI Follow-Up composer (#followup-modal)
     - window.glOpenEmailTemplates() opens a manage-templates modal
       (list / edit / new / delete)
     - Variable substitution: {{client_name}} {{invoice_number}}
       {{amount}} {{date}} {{due_date}} {{days_late}} {{my_name}}
       {{my_phone}}
   ============================================================ */
(function(){
  function getSB(){ return window.supa || null; }
  function escHtml(s){ return String(s==null?'':s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function usd(n){ return '$' + (Number(n)||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}); }
  function toast(msg, kind){
    var d = document.createElement('div');
    d.textContent = msg;
    d.style.cssText='position:fixed;bottom:20px;right:20px;background:'+(kind==='err'?'#b91c1c':'#0f766e')+';color:#fff;padding:12px 18px;border-radius:8px;z-index:99999;font:14px system-ui;box-shadow:0 4px 12px rgba(0,0,0,.2);max-width:360px';
    document.body.appendChild(d);
    setTimeout(function(){ d.remove(); }, 4500);
  }

  // In-memory cache (refreshed on each modal open)
  var TEMPLATES = [];
  async function loadTemplates(){
    var sb = getSB(); if(!sb) return [];
    var r = await sb.from('email_templates').select('id, name, category, subject, body, active').eq('active', true).order('category').order('name');
    if(r.error){ console.warn('[GL] email_templates load failed', r.error); return []; }
    TEMPLATES = r.data || [];
    return TEMPLATES;
  }

  function applyVars(text, vars){
    var t = text || '';
    Object.keys(vars||{}).forEach(function(k){
      t = t.replace(new RegExp('\\{\\{\\s*'+k+'\\s*\\}\\}', 'g'), vars[k] || '');
    });
    return t;
  }

  function buildVarsForInvoice(invId){
    var inv = (window.invoices||[]).find(function(i){ return i.id === invId; });
    if(!inv) return {};
    var c = (window.clients||[]).find(function(c){ return c.id === inv.client; }) || {};
    var daysLate = '';
    if(inv.date){
      try { daysLate = String(Math.max(0, Math.floor((Date.now() - new Date(inv.date).getTime()) / 86400000))); } catch(e){}
    }
    return {
      client_name: inv.clientName || c.name || '',
      invoice_number: inv.id,
      amount: usd(inv.amount || 0),
      date: inv.date || '',
      due_date: inv.dueDate || (inv.paymentTerms || 'on receipt'),
      days_late: daysLate,
      my_name: 'Good Liquid Accounting',
      my_phone: '(803) 493-5065'
    };
  }

  // Injects a "📝 Templates" select right before the Subject field
  function injectTemplatePicker(modal, opts){
    if(!modal || modal.querySelector('.gl-tpl-picker')) return;
    opts = opts || {};
    var category = opts.category;
    var subjectSel = opts.subjectSel;
    var bodySel = opts.bodySel;
    var getInvId = opts.getInvId || function(){ return null; };

    var subj = modal.querySelector(subjectSel);
    if(!subj) return;
    var wrap = document.createElement('div');
    wrap.className = 'gl-tpl-picker';
    wrap.style.cssText = 'display:flex;gap:6px;align-items:center;margin-bottom:8px';
    wrap.innerHTML =
      '<select class="gl-tpl-select finp" style="flex:1;font-size:12px"><option value="">📝 Apply a template…</option></select>' +
      '<button type="button" class="gl-tpl-manage cbtn" style="font-size:11px;padding:5px 9px;background:rgba(124,58,237,.12);border-color:rgba(124,58,237,.35);color:#c4b5fd">⚙ Manage</button>';
    // Insert above the subject's parent row when possible
    var anchor = subj.closest('.frow') || subj.parentNode;
    anchor.parentNode.insertBefore(wrap, anchor);

    var sel = wrap.querySelector('.gl-tpl-select');
    loadTemplates().then(function(list){
      var filtered = category ? list.filter(function(t){ return t.category === category || t.category === 'general'; }) : list;
      filtered.forEach(function(t){
        var opt = document.createElement('option');
        opt.value = t.id;
        opt.textContent = t.name + (t.category ? ' [' + t.category + ']' : '');
        sel.appendChild(opt);
      });
    });
    sel.onchange = function(){
      var t = TEMPLATES.find(function(x){ return x.id === sel.value; });
      if(!t) return;
      var vars = buildVarsForInvoice(getInvId());
      var subjEl = modal.querySelector(subjectSel);
      var bodyEl = modal.querySelector(bodySel);
      if(subjEl) subjEl.value = applyVars(t.subject, vars);
      if(bodyEl) bodyEl.value = applyVars(t.body, vars);
      toast('Template applied: ' + t.name);
      sel.value = '';
    };
    wrap.querySelector('.gl-tpl-manage').onclick = function(){ window.glOpenEmailTemplates(); };
  }

  // Observe DOM for Send Invoice + Follow-Up modals and inject the picker
  (function watch(){
    var mo = new MutationObserver(function(){
      var sendModal = document.getElementById('gl-send-inv-modal');
      if(sendModal && !sendModal.querySelector('.gl-tpl-picker')){
        injectTemplatePicker(sendModal, {
          category: 'invoice',
          subjectSel: '#gl-si-subject',
          bodySel: '#gl-si-message',
          getInvId: function(){
            var t = sendModal.querySelector('[style*="letter-spacing:2px"]');
            var m = t && t.textContent.match(/GL-\d+/);
            return m ? m[0] : null;
          }
        });
      }
      var fuModal = document.getElementById('followup-modal');
      if(fuModal && fuModal.classList.contains('show') && !fuModal.querySelector('.gl-tpl-picker')){
        injectTemplatePicker(fuModal, {
          category: 'followup',
          subjectSel: '#fu-subject',
          bodySel: '#fu-body',
          getInvId: function(){ return window.currentFollowupInvId || window.currentInvId; }
        });
      }
    });
    mo.observe(document.body, { childList:true, subtree:true, attributes:true, attributeFilter:['class'] });
  })();

  // ────────────────────────────────────────────────────────────
  // Manage templates modal
  // ────────────────────────────────────────────────────────────
  window.glOpenEmailTemplates = async function(){
    var ex = document.getElementById('gl-tpl-modal');
    if(ex) ex.remove();
    var list = await loadTemplates();
    var ov = document.createElement('div');
    ov.id = 'gl-tpl-modal';
    ov.style.cssText = 'position:fixed;inset:0;z-index:1200;background:rgba(6,13,26,.85);backdrop-filter:blur(8px);display:flex;align-items:flex-start;justify-content:center;padding:30px;overflow-y:auto';
    ov.innerHTML =
      '<div style="background:#142238;border:1px solid rgba(124,58,237,.25);border-radius:14px;width:100%;max-width:920px;padding:24px 28px;color:#fff">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px">' +
          '<div style="font-family:var(--ff-disp);font-size:18px;letter-spacing:2px;color:#c4b5fd">📝 EMAIL TEMPLATES</div>' +
          '<button id="gl-tpl-close" style="background:none;border:none;color:#9aa7bd;font-size:22px;cursor:pointer;line-height:1">✕</button>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:280px 1fr;gap:18px;min-height:420px">' +
          '<div style="border-right:1px solid rgba(255,255,255,.08);padding-right:16px">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">' +
              '<div style="font-size:11px;letter-spacing:1px;color:var(--muted)">TEMPLATES</div>' +
              '<button id="gl-tpl-new" style="background:rgba(0,229,192,.12);border:1px solid rgba(0,229,192,.35);color:var(--teal);font-size:11px;padding:3px 10px;border-radius:4px;cursor:pointer">+ New</button>' +
            '</div>' +
            '<div id="gl-tpl-list" style="display:flex;flex-direction:column;gap:4px;max-height:480px;overflow-y:auto">' +
              (list.length ? list.map(function(t){
                return '<div class="gl-tpl-li" data-id="'+t.id+'" style="padding:8px 10px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:6px;cursor:pointer;font-size:12px">' +
                  '<div style="color:#fff;font-weight:600">' + escHtml(t.name) + '</div>' +
                  '<div style="font-size:10px;color:var(--muted)">' + escHtml(t.category) + '</div>' +
                '</div>';
              }).join('') : '<div style="font-size:11px;color:var(--muted);padding:8px">No templates yet.</div>') +
            '</div>' +
          '</div>' +
          '<div id="gl-tpl-editor" style="display:flex;flex-direction:column;gap:8px">' +
            '<div style="color:var(--muted);font-size:12px;text-align:center;padding:80px 0">Select a template on the left, or click + New.</div>' +
          '</div>' +
        '</div>' +
        '<div style="margin-top:14px;font-size:11px;color:var(--muted);line-height:1.5">' +
          'Variables: <code>{{client_name}}</code> <code>{{invoice_number}}</code> <code>{{amount}}</code> <code>{{date}}</code> <code>{{due_date}}</code> <code>{{days_late}}</code> <code>{{my_name}}</code> <code>{{my_phone}}</code>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);
    ov.addEventListener('click', function(e){ if(e.target === ov) ov.remove(); });
    ov.querySelector('#gl-tpl-close').onclick = function(){ ov.remove(); };

    function loadEditor(t){
      var ed = ov.querySelector('#gl-tpl-editor');
      var isNew = !t;
      t = t || { name:'', category:'general', subject:'', body:'', active:true };
      ed.innerHTML =
        '<label style="font-size:11px;color:var(--muted)">NAME</label>' +
        '<input id="gl-tpl-name" class="finp" value="'+escHtml(t.name)+'" placeholder="e.g. Net 30 follow-up">' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
          '<div>' +
            '<label style="font-size:11px;color:var(--muted)">CATEGORY</label>' +
            '<select id="gl-tpl-cat" class="finp">' +
              ['general','invoice','followup','quote','onboarding'].map(function(c){
                return '<option value="'+c+'"'+(t.category===c?' selected':'')+'>'+c+'</option>';
              }).join('') +
            '</select>' +
          '</div>' +
          '<div>' +
            '<label style="font-size:11px;color:var(--muted)">ACTIVE</label>' +
            '<select id="gl-tpl-active" class="finp">' +
              '<option value="1"'+(t.active!==false?' selected':'')+'>Yes</option>' +
              '<option value="0"'+(t.active===false?' selected':'')+'>No (hidden from pickers)</option>' +
            '</select>' +
          '</div>' +
        '</div>' +
        '<label style="font-size:11px;color:var(--muted)">SUBJECT</label>' +
        '<input id="gl-tpl-subject" class="finp" value="'+escHtml(t.subject)+'">' +
        '<label style="font-size:11px;color:var(--muted)">BODY</label>' +
        '<textarea id="gl-tpl-body" class="finp" rows="12" style="resize:vertical;font:13px monospace">'+escHtml(t.body)+'</textarea>' +
        '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px">' +
          (isNew ? '' : '<button id="gl-tpl-delete" class="cbtn" style="background:rgba(231,76,60,.12);border-color:rgba(231,76,60,.35);color:#ff8579">🗑 Delete</button>') +
          '<button id="gl-tpl-save" class="cbtn pri">💾 Save</button>' +
        '</div>';
      ov.querySelector('#gl-tpl-save').onclick = async function(){
        var sb = getSB();
        var payload = {
          name: ov.querySelector('#gl-tpl-name').value.trim(),
          category: ov.querySelector('#gl-tpl-cat').value,
          subject: ov.querySelector('#gl-tpl-subject').value,
          body: ov.querySelector('#gl-tpl-body').value,
          active: ov.querySelector('#gl-tpl-active').value === '1'
        };
        if(!payload.name){ alert('Name is required.'); return; }
        if(isNew){
          var ins = await sb.from('email_templates').insert(payload).select().single();
          if(ins.error){ alert('Save failed: '+ins.error.message); return; }
          toast('Template created ✓');
        } else {
          var upd = await sb.from('email_templates').update(payload).eq('id', t.id);
          if(upd.error){ alert('Save failed: '+upd.error.message); return; }
          toast('Template saved ✓');
        }
        ov.remove();
        window.glOpenEmailTemplates();
      };
      var delBtn = ov.querySelector('#gl-tpl-delete');
      if(delBtn) delBtn.onclick = async function(){
        if(!confirm('Delete "'+t.name+'"?')) return;
        var sb = getSB();
        var r = await sb.from('email_templates').delete().eq('id', t.id);
        if(r.error){ alert('Delete failed: '+r.error.message); return; }
        toast('Template deleted ✓');
        ov.remove();
        window.glOpenEmailTemplates();
      };
    }
    ov.querySelector('#gl-tpl-new').onclick = function(){ loadEditor(null); };
    ov.querySelectorAll('.gl-tpl-li').forEach(function(li){
      li.onclick = function(){
        var t = list.find(function(x){ return x.id === li.getAttribute('data-id'); });
        if(t) loadEditor(t);
      };
    });
  };

  console.log('[GL] email templates loaded — window.glOpenEmailTemplates()');
}());

/* ============================================================
   EMAIL LOG + SCHEDULER — track sends + queue future follow-ups
   Adds:
     - Logs every outbound message via sendMailgunEmail wrapper
     - window.glOpenEmailActivity() opens a list of recent sends
       with status (sent / opened / clicked / bounced)
     - window.glScheduleFollowup(invId) opens a date-picker modal
       to queue a future follow-up email
     - Header buttons "📊 Email activity" and "📅 Schedule follow-up"
       on the invoice detail panel
   ============================================================ */
(function(){
  function getSB(){ return window.supa || null; }
  function escHtml(s){ return String(s==null?'':s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function fmtDate(s){ try { return new Date(s).toLocaleString(); } catch(e){ return s; } }
  function toast(msg, kind){
    var d = document.createElement('div');
    d.textContent = msg;
    d.style.cssText='position:fixed;bottom:20px;right:20px;background:'+(kind==='err'?'#b91c1c':'#0f766e')+';color:#fff;padding:12px 18px;border-radius:8px;z-index:99999;font:14px system-ui;box-shadow:0 4px 12px rgba(0,0,0,.2);max-width:360px';
    document.body.appendChild(d);
    setTimeout(function(){ d.remove(); }, 4500);
  }

  // Wrap sendMailgunEmail to log every send to email_log.
  // The underlying sendMailgunEmail (index.html) now stashes the Mailgun
  // message id on `sendMailgunEmail._lastMailgunId` after each successful
  // send. We grab it here and write it as `mailgun_id` on the email_log
  // row so the mailgun-webhook Edge Function can match incoming
  // delivered/opened/clicked events back to the right row. Without that
  // link, every email got stuck on "sent" status forever even when the
  // webhook fired correctly (caught via Playwright runtime audit
  // 2026-05-21 — GL-1003 send was 1d old with no Delivered/Opened state).
  (function wrapSend(){
    var orig = window.sendMailgunEmail;
    if(typeof orig !== 'function') { setTimeout(wrapSend, 500); return; }
    if(orig.__glLogged) return;
    window.sendMailgunEmail = async function(to, subject, body, opts){
      var sb = getSB();
      // Clear any stale id before the call so a failed send doesn't
      // accidentally re-use the previous send's id.
      try { orig._lastMailgunId = null; } catch(e){}
      var ok = await orig.apply(this, arguments);
      var mailgunId = null;
      try { mailgunId = orig._lastMailgunId || null; } catch(e){}
      // Best-effort log — don't block on errors
      try {
        var ccArr = [];
        if(opts && opts.cc){
          if(Array.isArray(opts.cc)) ccArr = opts.cc.map(function(c){ return typeof c === 'string' ? c : (c && c.email); }).filter(Boolean);
          else if(typeof opts.cc === 'string') ccArr = opts.cc.split(/[,;]/).map(function(s){ return s.trim(); }).filter(Boolean);
        }
        var bccArr = [];
        if(opts && opts.bcc){
          if(Array.isArray(opts.bcc)) bccArr = opts.bcc.map(function(c){ return typeof c === 'string' ? c : (c && c.email); }).filter(Boolean);
          else if(typeof opts.bcc === 'string') bccArr = opts.bcc.split(/[,;]/).map(function(s){ return s.trim(); }).filter(Boolean);
        }
        if(sb){
          // Auto-detect "GL-####" in the subject so the row links to its
          // invoice and shows up under the invoice's Activity tab.
          var invNum = null;
          var invSupaId = null;
          var combined = (subject||'') + ' ' + (body||'');
          var m = combined.match(/GL-\d+/);
          if(m){
            invNum = m[0];
            var matched = (window.invoices||[]).find(function(i){ return i.id === invNum; });
            if(matched && matched.supaId) invSupaId = matched.supaId;
          }
          await sb.from('email_log').insert({
            mailgun_id: mailgunId,
            to_email: Array.isArray(to) ? to.join(', ') : (to||''),
            cc_emails: ccArr.length ? ccArr : null,
            bcc_emails: bccArr.length ? bccArr : null,
            subject: subject || '',
            body_preview: (body || '').slice(0, 280),
            invoice_id: invSupaId,
            invoice_number: invNum,
            status: ok ? 'sent' : 'failed',
            sent_at: ok ? new Date().toISOString() : null
          });
        }
      } catch(e){ /* log-only path; never affect send result */ }
      return ok;
    };
    window.sendMailgunEmail.__glLogged = true;
  })();

  // ────────────────────────────────────────────────────────────
  // Email activity modal
  // ────────────────────────────────────────────────────────────
  window.glOpenEmailActivity = async function(invoiceFilter){
    var sb = getSB(); if(!sb) return;
    var ex = document.getElementById('gl-email-activity'); if(ex) ex.remove();
    var fellBackToAll = false;
    var rows;
    if(invoiceFilter){
      var rf = await sb.from('email_log').select('*').eq('invoice_number', invoiceFilter).order('created_at', { ascending: false }).limit(100);
      rows = rf.data || [];
      if(rows.length === 0){
        // No invoice-specific sends — fall back to all and flag it.
        var ra = await sb.from('email_log').select('*').order('created_at', { ascending: false }).limit(100);
        rows = ra.data || [];
        fellBackToAll = true;
      }
    } else {
      var rall = await sb.from('email_log').select('*').order('created_at', { ascending: false }).limit(100);
      rows = rall.data || [];
    }
    var STATUS_COLOR = { sent:'#5fcf9e', delivered:'#5fcf9e', opened:'#1a6fff', clicked:'#7c3aed', bounced:'#e74c3c', failed:'#e74c3c', queued:'#f5c842' };
    function timeAgo(iso){
      if(!iso) return '';
      var ms = Date.now() - new Date(iso).getTime();
      var s = Math.floor(ms/1000);
      if(s < 60) return 'just now';
      if(s < 3600) return Math.floor(s/60) + 'm ago';
      if(s < 86400) return Math.floor(s/3600) + 'h ago';
      var d = Math.floor(s/86400);
      return d < 7 ? d + 'd ago' : fmtDate(iso).replace(',', '');
    }
    function stepHtml(label, iso, color){
      var done = !!iso;
      return '<div style="display:flex;align-items:center;gap:6px;font-size:10px;color:' + (done ? color : '#3d4a63') + ';white-space:nowrap">' +
        '<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:' + (done ? color : '#3d4a63') + '"></span>' +
        '<span style="text-transform:uppercase;letter-spacing:.5px;font-weight:700">' + label + '</span>' +
        (done ? '<span style="color:var(--muted);font-weight:400">' + timeAgo(iso) + '</span>' : '') +
      '</div>';
    }
    var bodyHtml = rows.length ? rows.map(function(r){
      var statusColor = STATUS_COLOR[r.status] || '#9aa7bd';
      // Build a sent → delivered → opened → clicked timeline so the user
      // can see exactly when each stage happened.
      var timeline =
        stepHtml('Sent',      r.sent_at,         '#5fcf9e') +
        stepHtml('Delivered', r.delivered_at,    '#5fcf9e') +
        stepHtml('Opened',    r.first_opened_at, '#1a6fff') +
        (r.click_count > 0 ? stepHtml('Clicked', r.first_opened_at /* approx */, '#7c3aed') : '');
      var counts = '';
      if(r.open_count > 0) counts += '<span style="color:#1a6fff">' + r.open_count + ' open' + (r.open_count === 1 ? '' : 's') + '</span>';
      if(r.click_count > 0) counts += (counts ? ' · ' : '') + '<span style="color:#7c3aed">' + r.click_count + ' click' + (r.click_count === 1 ? '' : 's') + '</span>';
      return '<div style="padding:12px 14px;border-bottom:1px solid rgba(255,255,255,.05)">' +
        '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">' +
          '<div style="flex:1;min-width:0">' +
            '<div style="color:#fff;font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escHtml(r.subject) + '</div>' +
            '<div style="font-size:11px;color:var(--muted);margin-top:2px">→ ' + escHtml(r.to_email) +
              (r.cc_emails && r.cc_emails.length ? ' · cc ' + r.cc_emails.length : '') +
            '</div>' +
          '</div>' +
          '<div style="text-align:right;flex-shrink:0"><span style="font-size:10px;letter-spacing:1px;text-transform:uppercase;color:' + statusColor + ';font-weight:700">' + r.status + '</span>' +
            (counts ? '<div style="font-size:10px;margin-top:2px">' + counts + '</div>' : '') +
          '</div>' +
        '</div>' +
        '<div style="display:flex;gap:14px;margin-top:8px;flex-wrap:wrap">' + timeline + '</div>' +
      '</div>';
    }).join('') : '<div style="padding:30px;text-align:center;color:var(--muted);font-size:13px">No sends yet.</div>';

    var ov = document.createElement('div');
    ov.id = 'gl-email-activity';
    ov.style.cssText = 'position:fixed;inset:0;z-index:1100;background:rgba(6,13,26,.85);backdrop-filter:blur(8px);display:flex;align-items:flex-start;justify-content:center;padding:30px;overflow-y:auto';
    ov.innerHTML =
      '<div style="background:#142238;border:1px solid rgba(26,111,255,.25);border-radius:14px;width:100%;max-width:820px;padding:20px 24px;color:#fff">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">' +
          '<div style="font-family:var(--ff-disp);font-size:18px;letter-spacing:2px;color:#6b9fff">📊 EMAIL ACTIVITY' +
            (invoiceFilter ? ' — ' + escHtml(invoiceFilter) : '') +
          '</div>' +
          '<button id="gl-ea-close" style="background:none;border:none;color:#9aa7bd;font-size:22px;cursor:pointer;line-height:1">✕</button>' +
        '</div>' +
        '<div style="font-size:11px;color:var(--muted);margin-bottom:10px">' +
          (fellBackToAll
            ? '<span style="color:#f5c842">⚠ No sends tagged to ' + escHtml(invoiceFilter) + ' yet — showing all sends across the account.</span>'
            : 'Open / click tracking populates when Mailgun webhooks fire on delivered / opens / clicks.') +
        '</div>' +
        '<div style="background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.06);border-radius:10px;max-height:60vh;overflow-y:auto">' +
          bodyHtml +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);
    ov.addEventListener('click', function(e){ if(e.target === ov) ov.remove(); });
    ov.querySelector('#gl-ea-close').onclick = function(){ ov.remove(); };
  };

  // ────────────────────────────────────────────────────────────
  // Schedule follow-up modal
  // ────────────────────────────────────────────────────────────
  window.glScheduleFollowup = async function(invId){
    invId = invId || window.currentInvId;
    var inv = (window.invoices||[]).find(function(i){ return i.id === invId; });
    if(!inv){ alert('Invoice not found.'); return; }
    if(!inv.supaId){ alert('Save the invoice first.'); return; }
    var c = (window.clients||[]).find(function(c){ return c.id === inv.client; }) || {};
    var to = c.email || inv.clientEmail || '';
    if(!to){ alert('No email on the client. Add one in Edit Client first.'); return; }

    var ex = document.getElementById('gl-sched-modal'); if(ex) ex.remove();
    var ov = document.createElement('div');
    ov.id = 'gl-sched-modal';
    ov.style.cssText = 'position:fixed;inset:0;z-index:1200;background:rgba(6,13,26,.85);backdrop-filter:blur(8px);display:flex;align-items:flex-start;justify-content:center;padding:30px;overflow-y:auto';
    var defaultSubject = 'Reminder: Invoice ' + invId + ' — Good Liquid Bev Co';
    var defaultBody = 'Hi ' + (c.contact || c.name || 'there') + ',\n\nJust a quick reminder that Invoice ' + invId + ' for $' + (inv.amount||0).toLocaleString() + ' is due.\n\nThanks,\nGood Liquid Accounting\n(803) 493-5065 · Mike@GoodLiquid.com';
    // Default send_at = 7 days from now at 9am
    var dt = new Date(Date.now() + 7*86400000);
    dt.setHours(9,0,0,0);
    var defaultIso = dt.toISOString().slice(0,16);
    ov.innerHTML =
      '<div style="background:#142238;border:1px solid rgba(245,200,66,.25);border-radius:14px;width:100%;max-width:640px;padding:22px 26px;color:#fff">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">' +
          '<div style="font-family:var(--ff-disp);font-size:16px;letter-spacing:2px;color:#f5c842">📅 SCHEDULE FOLLOW-UP — ' + escHtml(invId) + '</div>' +
          '<button id="gl-sf-close" style="background:none;border:none;color:#9aa7bd;font-size:22px;cursor:pointer;line-height:1">✕</button>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:90px 1fr;gap:8px 12px;align-items:center;font-size:13px">' +
          '<label style="color:var(--muted);font-size:11px;letter-spacing:1px">TO</label>' +
          '<input id="gl-sf-to" class="finp" value="'+escHtml(to)+'">' +
          '<label style="color:var(--muted);font-size:11px;letter-spacing:1px">SEND AT</label>' +
          '<input id="gl-sf-when" type="datetime-local" class="finp" value="'+defaultIso+'">' +
          '<label style="color:var(--muted);font-size:11px;letter-spacing:1px">SUBJECT</label>' +
          '<input id="gl-sf-subject" class="finp" value="'+escHtml(defaultSubject)+'">' +
        '</div>' +
        '<div style="margin-top:10px"><div style="font-size:11px;letter-spacing:1px;color:var(--muted);margin-bottom:4px">MESSAGE</div>' +
          '<textarea id="gl-sf-body" class="finp" rows="6" style="resize:vertical;font-size:13px">'+escHtml(defaultBody)+'</textarea>' +
        '</div>' +
        '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">' +
          '<button id="gl-sf-cancel" class="cbtn">Cancel</button>' +
          '<button id="gl-sf-save" class="cbtn pri" style="background:#f5c842;color:#0a1628;border:0">📅 Schedule</button>' +
        '</div>' +
        '<div id="gl-sf-status" style="font-size:11px;color:var(--muted);margin-top:8px;min-height:14px"></div>' +
      '</div>';
    document.body.appendChild(ov);
    ov.addEventListener('click', function(e){ if(e.target === ov) ov.remove(); });
    ov.querySelector('#gl-sf-close').onclick = function(){ ov.remove(); };
    ov.querySelector('#gl-sf-cancel').onclick = function(){ ov.remove(); };
    ov.querySelector('#gl-sf-save').onclick = async function(){
      var sb = getSB();
      var when = ov.querySelector('#gl-sf-when').value;
      var sendAt = when ? new Date(when).toISOString() : null;
      if(!sendAt){ alert('Pick a send date / time.'); return; }
      var payload = {
        invoice_id: inv.supaId,
        to_email: ov.querySelector('#gl-sf-to').value.trim(),
        subject: ov.querySelector('#gl-sf-subject').value.trim(),
        body: ov.querySelector('#gl-sf-body').value,
        send_at: sendAt
      };
      var r = await sb.from('email_schedule').insert(payload).select().single();
      if(r.error){ ov.querySelector('#gl-sf-status').textContent = '✗ ' + r.error.message; return; }
      toast('Scheduled for ' + fmtDate(sendAt) + ' ✓');
      ov.remove();
    };
  };

  // ────────────────────────────────────────────────────────────
  // Inject "📊 Email activity" + "📅 Schedule" buttons into the
  // invoice detail header.
  // ────────────────────────────────────────────────────────────
  (function inject(){
    var mo = new MutationObserver(function(){
      var header = document.querySelector('#inv-detail > div:first-child');
      if(!header) return;
      if(!header.querySelector('.gl-inv-activity-btn')){
        var btn1 = document.createElement('button');
        btn1.className = 'cbtn gl-inv-activity-btn';
        btn1.setAttribute('style','background:rgba(26,111,255,.10);border-color:rgba(26,111,255,.30);color:#6b9fff');
        btn1.textContent = '📊 Activity';
        btn1.onclick = function(){ if(window.currentInvId) window.glOpenEmailActivity(window.currentInvId); };
        header.appendChild(btn1);
      }
      if(!header.querySelector('.gl-inv-sched-btn')){
        var btn2 = document.createElement('button');
        btn2.className = 'cbtn gl-inv-sched-btn';
        btn2.setAttribute('style','background:rgba(245,200,66,.12);border-color:rgba(245,200,66,.35);color:#f5c842');
        btn2.textContent = '📅 Schedule';
        btn2.onclick = function(){ if(window.currentInvId) window.glScheduleFollowup(window.currentInvId); };
        header.appendChild(btn2);
      }
    });
    mo.observe(document.body, { childList:true, subtree:true });
  })();

  console.log('[GL] email log + scheduler loaded');
}());
