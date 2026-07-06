/* ============================================================
   DELETE INVOICE
   - Confirm prompt (paid invoices double-confirm for safety).
   - Hard delete from Supabase by invoice_number (preferred) or by
     row id (supaId) when present. Local-only invoices skip the
     Supabase call.
   - Splice from window.invoices, re-render list + dashboard.
   - Close the detail panel if the deleted invoice is currently open.
   - Audit log via glAudit (if loaded).
   ============================================================ */
(function(){
  window.deleteInvoice = async function(id, opts){
    opts = opts || {};
    var list = window.invoices || [];
    var inv = list.find(function(i){ return i.id === id || i.supaId === id; });
    if(!inv){ alert('Invoice not found.'); return false; }

    var label = inv.id + (inv.clientName ? ' — ' + inv.clientName : '');
    if(!opts.skipConfirm){
      var msg = 'Delete invoice ' + label + '?\n\nThis cannot be undone.';
      if(inv.status === 'paid') msg = '⚠ This invoice is marked PAID.\n\n' + msg + '\n\nIf this was already paid out, deleting it will remove the revenue from reports.';
      if(!confirm(msg)) return false;
    }

    var sb = window.supa;
    if(sb){
      try {
        var q;
        // Prefer the human-readable invoice_number; fall back to row id when supaId exists.
        // .select() forces PostgREST to return the deleted rows so we can detect
        // RLS-silent-rejections (0 rows deleted, no error).
        if(inv.id && /^GL-/i.test(inv.id)){
          q = await sb.from('invoices').delete().eq('invoice_number', inv.id).select();
        } else if(inv.supaId){
          q = await sb.from('invoices').delete().eq('id', inv.supaId).select();
        }
        if(q && q.error){
          console.warn('[GL] invoice delete: supabase error', q.error);
          if(!confirm('Server reported: ' + q.error.message + '\n\nRemove from this session anyway?')) return false;
        } else if(q && Array.isArray(q.data) && q.data.length === 0){
          console.warn('[GL] invoice delete: 0 rows affected (likely RLS DELETE policy missing on invoices)');
          alert('Could not delete on the server (RLS denied).\n\nRun the migration:\n  supabase/migrations/20260518_invoices_delete_policy.sql\n\nThe invoice has not been removed.');
          return false;
        }
      } catch(e){
        console.warn('[GL] invoice delete: supabase threw', e);
        if(!confirm('Could not reach the server.\n\nRemove from this session anyway?')) return false;
      }
    }

    // Remove from in-memory list.
    var idx = list.indexOf(inv);
    if(idx >= 0) list.splice(idx, 1);

    // Close the detail panel if it's showing this invoice.
    if(window.currentInvId === inv.id || window.currentInvId === inv.supaId){
      window.currentInvId = null;
      var d = document.getElementById('inv-detail');
      if(d) d.classList.remove('show');
      if(typeof closeDetail === 'function') try { closeDetail(); } catch(e){}
    }

    if(typeof renderInvoices === 'function') try { renderInvoices(); } catch(e){}
    if(typeof renderDash === 'function')     try { renderDash();     } catch(e){}
    if(typeof renderActivity === 'function') try { renderActivity(); } catch(e){}

    if(typeof window.glAudit === 'function') window.glAudit('invoice_deleted', inv.id, { client: inv.clientName||'', amount: inv.amount||0, status: inv.status||'' });
    if(typeof addNotification === 'function') addNotification('🗑 Invoice deleted', label, 'warning');
    return true;
  };

  /* Auto-inject a delete button on the invoice-detail panel header so the
     user has a place to delete from the open view, not just the row. */
  function injectDeleteBtn(){
    var detailHeader = document.querySelector('#inv-detail > div:first-child');
    if(!detailHeader) return;
    if(detailHeader.querySelector('.gl-del-inv-btn')) return;
    var btn = document.createElement('button');
    btn.className = 'cbtn gl-del-inv-btn';
    btn.setAttribute('style','background:rgba(231,76,60,.12);border:1px solid rgba(231,76,60,.4);color:#ff8579');
    btn.textContent = '🗑 Delete';
    btn.addEventListener('click', function(){
      if(window.currentInvId) window.deleteInvoice(window.currentInvId);
    });
    detailHeader.appendChild(btn);
  }
  function startObs(){
    var panel = document.getElementById('crm-panel');
    if(panel){
      new MutationObserver(function(){ setTimeout(injectDeleteBtn, 60); }).observe(panel, { childList:true, subtree:true });
      injectDeleteBtn();
    } else setTimeout(startObs, 700);
  }
  if(document.readyState !== 'loading') startObs();
  else document.addEventListener('DOMContentLoaded', startObs);

  console.log('[GL] deleteInvoice loaded');
}());

/* ============================================================
   EDIT CLIENT NOTES
   Inline-editable notes textarea on both client detail panels. The
   panels render a textarea + Save button (no separate edit modal);
   this helper persists the change to Supabase and the in-memory
   record. Used by the buttons wired in openClientDetail and
   viewClientEnhanced.
   ============================================================ */
(function(){
  window.glSaveClientNotes = async function(clientId, notesText){
    var c = (window.clients||[]).find(function(x){ return x.id === clientId; });
    if(!c){ alert('Client not found.'); return false; }
    var trimmed = (notesText == null ? '' : String(notesText)).trim();
    c.notes = trimmed;

    if(window.supa){
      try {
        var r = await window.supa.from('clients').update({ notes: trimmed }).eq('id', clientId);
        if(r && r.error){
          console.warn('[GL] glSaveClientNotes: supabase error', r.error);
          if(typeof addNotification === 'function') addNotification('Notes saved locally','Server error — see console','warning');
          return false;
        }
      } catch(e){
        console.warn('[GL] glSaveClientNotes threw', e);
        if(typeof addNotification === 'function') addNotification('Notes saved locally','Server unreachable','warning');
        return false;
      }
    }
    if(typeof window.glAudit === 'function') window.glAudit('client_notes_edited', clientId, { length: trimmed.length });
    if(typeof addNotification === 'function') addNotification('📝 Notes saved', c.name, 'success');
    return true;
  };

  /* Helper used by both detail panels to render a consistent
     "click to expand, save inline" notes block.
     Returns an HTML string with a textarea + save button. */
  window.glRenderClientNotesBlock = function(client){
    var notes = (client.notes||'').replace(/</g,'&lt;');
    return ''
      + '<div style="margin-bottom:18px">'
      +   '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">'
      +     '<div style="font-size:10px;letter-spacing:2px;color:var(--muted)">NOTES</div>'
      +     '<span id="gl-notes-status-'+client.id+'" style="font-size:11px;color:var(--muted)">'+(client.notes ? '' : 'empty — add some')+'</span>'
      +   '</div>'
      +   '<textarea id="gl-notes-'+client.id+'" rows="4" placeholder="Add notes about this client — preferences, history, key dates…" '
      +     'style="width:100%;padding:11px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:8px;color:var(--white);font-size:13px;font-family:var(--ff-body);resize:vertical;line-height:1.5">'+notes+'</textarea>'
      +   '<div style="display:flex;justify-content:flex-end;margin-top:6px">'
      +     '<button class="cbtn pri" style="font-size:12px;padding:6px 14px" '
      +       'onclick="(async function(){'
      +         'var t=document.getElementById(\'gl-notes-'+client.id+'\').value;'
      +         'var s=document.getElementById(\'gl-notes-status-'+client.id+'\');'
      +         'var btn=event.target;var orig=btn.textContent;btn.disabled=true;btn.textContent=\'Saving…\';'
      +         'var ok=await window.glSaveClientNotes(\''+client.id+'\',t);'
      +         'btn.disabled=false;btn.textContent=orig;'
      +         'if(s) s.textContent=ok?\'✓ saved\':\'⚠ saved locally only\';'
      +         'setTimeout(function(){if(s)s.textContent=\'\';},2500);'
      +       '})()">💾 Save notes</button>'
      +   '</div>'
      + '</div>';
  };

  console.log('[GL] editable client notes loaded');
}());

/* ============================================================
   EDIT CLIENT — full record editor
   Opens a modal pre-filled with the current client's values. On save,
   updates Supabase + the in-memory client and re-renders the list,
   dashboard, and (if still open) the client detail panel.

   Covers every field collected at create time:
     name, contact, email, phone,
     street, city, state, zip,
     comm_prefs (Email / SMS / WhatsApp / WeChat),
     service, status, referred_by, notes.
   ============================================================ */
(function(){
  var INPUT_STYLE = 'width:100%;padding:11px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:8px;color:var(--white);font-size:14px;font-family:var(--ff-body)';
  var LABEL_STYLE = 'font-size:10px;letter-spacing:2px;color:var(--muted);margin-bottom:5px';

  function esc(v){
    if(v == null) return '';
    return String(v).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
  }

  window.glOpenEditClient = function(clientId){
    var c = (window.clients||[]).find(function(x){ return x.id === clientId; });
    if(!c){ alert('Client not found.'); return; }

    var prior = document.getElementById('gl-edit-client-modal');
    if(prior) prior.remove();

    var host = document.getElementById('crm-panel') || document.body;
    var refOptions = '<option value="">None</option>' +
      (window.referrers||[]).map(function(r){
        var sel = (c.referredBy === r.id) ? ' selected' : '';
        return '<option value="'+esc(r.id)+'"'+sel+'>'+esc(r.name)+'</option>';
      }).join('');

    var serviceOptions = ['','Canning','Bottling','R&D','R&D + Canning','Consulting'].map(function(s){
      var v = s; var label = s || 'Select service…';
      var sel = (c.service === v) ? ' selected' : '';
      return '<option value="'+esc(v)+'"'+sel+'>'+esc(label)+'</option>';
    }).join('');

    var statusOptions = ['lead','active','inactive'].map(function(s){
      var sel = ((c.status||'lead') === s) ? ' selected' : '';
      return '<option value="'+s+'"'+sel+'>'+s.charAt(0).toUpperCase()+s.slice(1)+'</option>';
    }).join('');

    var commPrefs = Array.isArray(c.commPrefs) ? c.commPrefs : [];
    function ck(key){ return commPrefs.indexOf(key) >= 0 ? ' checked' : ''; }
    var productTypes = Array.isArray(c.productTypes) ? c.productTypes : [];
    function pt(key){ return productTypes.indexOf(key) >= 0 ? ' checked' : ''; }

    var paymentTermsOptions = ['Due on receipt','Net 15','Net 30','Net 60','Prepaid','COD'].map(function(t){
      var sel = ((c.paymentTerms||'Due on receipt') === t) ? ' selected' : '';
      return '<option value="'+esc(t)+'"'+sel+'>'+esc(t)+'</option>';
    }).join('');

    var ownerOptions = '<option value="">Unassigned</option>' +
      (window.users||[]).filter(function(u){ return u.status !== 'inactive'; }).map(function(u){
        var sel = (c.accountOwner === u.id) ? ' selected' : '';
        return '<option value="'+esc(u.id)+'"'+sel+'>'+esc(u.name)+' ('+esc(u.role)+')</option>';
      }).join('');

    var billingSame  = c.billingSame  !== false;
    var shippingSame = c.shippingSame !== false;

    var contactTypeOptions = [
      ['',''], ['owner','Owner'], ['executive','Executive'], ['purchasing','Purchasing'],
      ['freight','Freight / Logistics'], ['sales','Sales'], ['other','Other']
    ].map(function(o){
      var sel = ((c.contactType||'') === o[0]) ? ' selected' : '';
      return '<option value="'+esc(o[0])+'"'+sel+'>'+esc(o[1]||'Contact type…')+'</option>';
    }).join('');

    var leadSourceOptions = [
      ['',''], ['google','Google search'], ['instagram','Instagram'], ['linkedin','LinkedIn'],
      ['trade_show','Trade show'], ['industry_pub','Industry publication'],
      ['customer_referral','Customer referral'], ['word_of_mouth','Word of mouth'],
      ['cold_outreach','Cold outreach (they reached us)'], ['returning','Returning customer'],
      ['other','Other']
    ].map(function(o){
      var sel = ((c.leadSource||'') === o[0]) ? ' selected' : '';
      return '<option value="'+esc(o[0])+'"'+sel+'>'+esc(o[1]||'Select…')+'</option>';
    }).join('');

    var paymentMethodOptions = [
      ['',''], ['ach','ACH'], ['wire','Wire'], ['credit_card','Credit card (3% fee)'], ['check','Check']
    ].map(function(o){
      var sel = ((c.paymentMethod||'') === o[0]) ? ' selected' : '';
      return '<option value="'+esc(o[0])+'"'+sel+'>'+esc(o[1]||'Select…')+'</option>';
    }).join('');

    var dockDaysArr = Array.isArray(c.dockDays) ? c.dockDays : [];
    function dck(day){ return dockDaysArr.indexOf(day) >= 0 ? ' checked' : ''; }

    var ov = document.createElement('div');
    ov.id = 'gl-edit-client-modal';
    ov.setAttribute('style','position:fixed;inset:0;z-index:1050;background:rgba(6,13,26,.92);backdrop-filter:blur(12px);display:flex;align-items:center;justify-content:center;padding:20px');
    ov.innerHTML =
      '<div style="background:#142238;border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:32px;width:100%;max-width:520px;max-height:90vh;overflow-y:auto">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:22px">' +
          '<div style="font-family:var(--ff-disp);font-size:20px;letter-spacing:2px;color:var(--teal)">EDIT CLIENT</div>' +
          '<button id="gl-ec-close" style="background:none;border:none;color:var(--muted);font-size:22px;cursor:pointer">✕</button>' +
        '</div>' +
        '<div style="display:flex;flex-direction:column;gap:12px">' +
          '<div><div style="'+LABEL_STYLE+'">BRAND NAME *</div><input id="gl-ec-name" value="'+esc(c.name)+'" style="'+INPUT_STYLE+'"></div>' +
          '<div><div style="'+LABEL_STYLE+'">LEGAL BUSINESS NAME <span style="opacity:.6">(if different)</span></div><input id="gl-ec-legal-name" value="'+esc(c.legalName)+'" style="'+INPUT_STYLE+'"></div>' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
            '<div><div style="'+LABEL_STYLE+'">EIN / TAX ID</div><input id="gl-ec-ein" placeholder="XX-XXXXXXX" value="'+esc(c.ein)+'" style="'+INPUT_STYLE+'"></div>' +
            '<div><div style="'+LABEL_STYLE+'">WEBSITE</div><input id="gl-ec-website" placeholder="https://" value="'+esc(c.website)+'" style="'+INPUT_STYLE+'"></div>' +
          '</div>' +
          '<div style="background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.06);border-radius:8px;padding:12px">' +
            '<div style="'+LABEL_STYLE+';margin-bottom:8px">MAIN POINT OF CONTACT</div>' +
            '<div style="display:flex;flex-direction:column;gap:8px">' +
              '<input id="gl-ec-contact" placeholder="Name" value="'+esc(c.contact)+'" style="'+INPUT_STYLE+'">' +
              '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
                '<input id="gl-ec-email" type="email" placeholder="Email" value="'+esc(c.email)+'" style="'+INPUT_STYLE+'">' +
                '<input id="gl-ec-phone" placeholder="Phone" value="'+esc(c.phone)+'" style="'+INPUT_STYLE+'">' +
              '</div>' +
              '<select id="gl-ec-contact-type" style="'+INPUT_STYLE+'">'+contactTypeOptions+'</select>' +
              '<label style="display:flex;align-items:flex-start;gap:8px;font-size:12px;color:var(--white);cursor:pointer;padding:8px 10px;background:rgba(245,200,66,.05);border:1px solid rgba(245,200,66,.18);border-radius:6px;line-height:1.45">' +
                '<input type="checkbox" id="gl-ec-notify-sms"'+(c.notify_overdue_sms?' checked':'')+' style="accent-color:#f5c842;width:15px;height:15px;cursor:pointer;margin-top:1px;flex-shrink:0">' +
                '<span>📱 <b>SMS overdue reminders</b> — customer has agreed to receive past-due invoice reminders by text. <span style="color:var(--muted);font-size:11px">Required by TCPA — check only with explicit opt-in.</span></span>' +
              '</label>' +
            '</div>' +
          '</div>' +
          '<div style="background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.06);border-radius:8px;padding:12px">' +
            '<div style="'+LABEL_STYLE+';margin-bottom:8px;display:flex;justify-content:space-between;align-items:center">' +
              '<span>ADDITIONAL EMAILS</span>' +
              '<button type="button" id="gl-ec-add-email" style="background:rgba(0,229,192,.12);border:1px solid rgba(0,229,192,.35);color:var(--teal);font-size:11px;padding:3px 10px;border-radius:4px;cursor:pointer">+ Add email</button>' +
            '</div>' +
            '<div id="gl-ec-emails-list" style="display:flex;flex-direction:column;gap:6px">' +
              ((c.additionalEmails || []).map(function(em, i){
                return '<div class="gl-ec-email-row" style="display:grid;grid-template-columns:120px 1fr 30px;gap:6px;align-items:center">' +
                  '<input class="gl-ec-em-label" placeholder="Label (AP, Ops…)" value="'+esc(em.label||'')+'" style="'+INPUT_STYLE+';font-size:11px">' +
                  '<input class="gl-ec-em-email" type="email" placeholder="email@company.com" value="'+esc(em.email||'')+'" style="'+INPUT_STYLE+';font-size:12px">' +
                  '<button type="button" class="gl-ec-em-del" title="Remove" style="background:none;border:none;color:rgba(231,76,60,.7);cursor:pointer;font-size:18px;line-height:1">&times;</button>' +
                '</div>';
              }).join('') || '<div style="font-size:11px;color:var(--muted);text-align:center;padding:6px">No additional emails. Click + Add email above.</div>') +
            '</div>' +
          '</div>' +
          '<div><div style="'+LABEL_STYLE+'">STREET ADDRESS</div><input id="gl-ec-street" value="'+esc(c.street)+'" style="'+INPUT_STYLE+'"></div>' +
          '<div style="display:grid;grid-template-columns:2fr 1fr 1fr;gap:8px">' +
            '<div><div style="'+LABEL_STYLE+'">CITY</div><input id="gl-ec-city" value="'+esc(c.city)+'" style="'+INPUT_STYLE+'"></div>' +
            '<div><div style="'+LABEL_STYLE+'">STATE</div><input id="gl-ec-state" maxlength="2" value="'+esc(c.state)+'" style="'+INPUT_STYLE+';text-transform:uppercase"></div>' +
            '<div><div style="'+LABEL_STYLE+'">ZIP</div><input id="gl-ec-zip" value="'+esc(c.zip)+'" style="'+INPUT_STYLE+'"></div>' +
          '</div>' +
          '<div>' +
            '<label style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--white);cursor:pointer;margin-bottom:8px">' +
              '<input type="checkbox" id="gl-ec-billing-same"'+(billingSame?' checked':'')+' style="accent-color:var(--teal);width:16px;height:16px;cursor:pointer">' +
              'Billing address same as physical' +
            '</label>' +
            '<div id="gl-ec-billing-block" style="display:'+(billingSame?'none':'grid')+';grid-template-columns:1fr;gap:8px">' +
              '<input id="gl-ec-billing-street" placeholder="Billing street address" value="'+esc(c.billingStreet)+'" style="'+INPUT_STYLE+'">' +
              '<div style="display:grid;grid-template-columns:2fr 1fr 1fr;gap:8px">' +
                '<input id="gl-ec-billing-city" placeholder="City" value="'+esc(c.billingCity)+'" style="'+INPUT_STYLE+'">' +
                '<input id="gl-ec-billing-state" placeholder="State" maxlength="2" value="'+esc(c.billingState)+'" style="'+INPUT_STYLE+';text-transform:uppercase">' +
                '<input id="gl-ec-billing-zip" placeholder="Zip" value="'+esc(c.billingZip)+'" style="'+INPUT_STYLE+'">' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div>' +
            '<label style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--white);cursor:pointer;margin-bottom:8px">' +
              '<input type="checkbox" id="gl-ec-shipping-same"'+(shippingSame?' checked':'')+' style="accent-color:var(--teal);width:16px;height:16px;cursor:pointer">' +
              'Shipping address same as billing' +
            '</label>' +
            '<div id="gl-ec-shipping-block" style="display:'+(shippingSame?'none':'grid')+';grid-template-columns:1fr;gap:8px">' +
              '<input id="gl-ec-shipping-street" placeholder="Shipping street address" value="'+esc(c.shippingStreet)+'" style="'+INPUT_STYLE+'">' +
              '<div style="display:grid;grid-template-columns:2fr 1fr 1fr;gap:8px">' +
                '<input id="gl-ec-shipping-city" placeholder="City" value="'+esc(c.shippingCity)+'" style="'+INPUT_STYLE+'">' +
                '<input id="gl-ec-shipping-state" placeholder="State" maxlength="2" value="'+esc(c.shippingState)+'" style="'+INPUT_STYLE+';text-transform:uppercase">' +
                '<input id="gl-ec-shipping-zip" placeholder="Zip" value="'+esc(c.shippingZip)+'" style="'+INPUT_STYLE+'">' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div style="background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.06);border-radius:8px;padding:12px">' +
            '<div style="'+LABEL_STYLE+';margin-bottom:8px">RECEIVING / LOGISTICS</div>' +
            '<label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--white);cursor:pointer;margin-bottom:10px">' +
              '<input type="checkbox" id="gl-ec-lift-gate"'+(c.liftGate?' checked':'')+' style="accent-color:var(--teal);width:16px;height:16px;cursor:pointer">🛗 Lift gate required for delivery' +
            '</label>' +
            '<div style="'+LABEL_STYLE+';margin-bottom:6px">LOADING DOCK DAYS</div>' +
            '<div style="display:flex;flex-wrap:wrap;gap:6px 12px;margin-bottom:10px">' +
              '<label style="display:flex;align-items:center;gap:5px;cursor:pointer;font-size:13px;color:var(--white)"><input type="checkbox" id="gl-ec-dock-mon"'+dck('mon')+' style="accent-color:var(--teal);width:15px;height:15px;cursor:pointer">Mon</label>' +
              '<label style="display:flex;align-items:center;gap:5px;cursor:pointer;font-size:13px;color:var(--white)"><input type="checkbox" id="gl-ec-dock-tue"'+dck('tue')+' style="accent-color:var(--teal);width:15px;height:15px;cursor:pointer">Tue</label>' +
              '<label style="display:flex;align-items:center;gap:5px;cursor:pointer;font-size:13px;color:var(--white)"><input type="checkbox" id="gl-ec-dock-wed"'+dck('wed')+' style="accent-color:var(--teal);width:15px;height:15px;cursor:pointer">Wed</label>' +
              '<label style="display:flex;align-items:center;gap:5px;cursor:pointer;font-size:13px;color:var(--white)"><input type="checkbox" id="gl-ec-dock-thu"'+dck('thu')+' style="accent-color:var(--teal);width:15px;height:15px;cursor:pointer">Thu</label>' +
              '<label style="display:flex;align-items:center;gap:5px;cursor:pointer;font-size:13px;color:var(--white)"><input type="checkbox" id="gl-ec-dock-fri"'+dck('fri')+' style="accent-color:var(--teal);width:15px;height:15px;cursor:pointer">Fri</label>' +
              '<label style="display:flex;align-items:center;gap:5px;cursor:pointer;font-size:13px;color:var(--white)"><input type="checkbox" id="gl-ec-dock-sat"'+dck('sat')+' style="accent-color:var(--teal);width:15px;height:15px;cursor:pointer">Sat</label>' +
              '<label style="display:flex;align-items:center;gap:5px;cursor:pointer;font-size:13px;color:var(--white)"><input type="checkbox" id="gl-ec-dock-sun"'+dck('sun')+' style="accent-color:var(--teal);width:15px;height:15px;cursor:pointer">Sun</label>' +
            '</div>' +
            '<div style="'+LABEL_STYLE+';margin-bottom:5px">DOCK HOURS</div>' +
            '<input id="gl-ec-dock-hours" placeholder="e.g. 7am – 3pm" value="'+esc(c.dockHours)+'" style="'+INPUT_STYLE+'">' +
          '</div>' +
          '<div>' +
            '<div style="'+LABEL_STYLE+'">PREFERRED COMMUNICATION</div>' +
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 12px;padding:10px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:8px">' +
              '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;color:var(--white)"><input type="checkbox" id="gl-ec-comm-email"'+ck('email')+' style="accent-color:var(--teal);width:16px;height:16px;cursor:pointer">✉️ Email</label>' +
              '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;color:var(--white)"><input type="checkbox" id="gl-ec-comm-sms"'+ck('sms')+' style="accent-color:var(--teal);width:16px;height:16px;cursor:pointer">📱 SMS</label>' +
              '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;color:var(--white)"><input type="checkbox" id="gl-ec-comm-whatsapp"'+ck('whatsapp')+' style="accent-color:var(--teal);width:16px;height:16px;cursor:pointer">🟢 WhatsApp</label>' +
              '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;color:var(--white)"><input type="checkbox" id="gl-ec-comm-wechat"'+ck('wechat')+' style="accent-color:var(--teal);width:16px;height:16px;cursor:pointer">💬 WeChat</label>' +
            '</div>' +
          '</div>' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
            '<div><div style="'+LABEL_STYLE+'">SERVICE</div><select id="gl-ec-service" style="'+INPUT_STYLE+'">'+serviceOptions+'</select></div>' +
            '<div><div style="'+LABEL_STYLE+'">STATUS</div><select id="gl-ec-status" style="'+INPUT_STYLE+'">'+statusOptions+'</select></div>' +
          '</div>' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
            '<div><div style="'+LABEL_STYLE+'">PAYMENT TERMS</div><select id="gl-ec-payment-terms" style="'+INPUT_STYLE+'">'+paymentTermsOptions+'</select></div>' +
            '<div><div style="'+LABEL_STYLE+'">ACCOUNT OWNER</div><select id="gl-ec-account-owner" style="'+INPUT_STYLE+'">'+ownerOptions+'</select></div>' +
          '</div>' +
          '<div><div style="'+LABEL_STYLE+'">REFERRED BY</div><select id="gl-ec-referrer" style="'+INPUT_STYLE+'">'+refOptions+'</select></div>' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
            '<div><div style="'+LABEL_STYLE+'">HOW DID YOU FIND US?</div><select id="gl-ec-lead-source" style="'+INPUT_STYLE+'">'+leadSourceOptions+'</select></div>' +
            '<div><div style="'+LABEL_STYLE+'">PREFERRED PAYMENT METHOD</div><select id="gl-ec-payment-method" style="'+INPUT_STYLE+'">'+paymentMethodOptions+'</select></div>' +
          '</div>' +
          '<div>' +
            '<div style="'+LABEL_STYLE+'">PRODUCT TYPES</div>' +
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 12px;padding:10px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:8px">' +
              '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;color:var(--white)"><input type="checkbox" id="gl-ec-pt-seltzer"'+pt('seltzer')+' style="accent-color:var(--teal);width:16px;height:16px;cursor:pointer">🥤 Seltzer</label>' +
              '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;color:var(--white)"><input type="checkbox" id="gl-ec-pt-kombucha"'+pt('kombucha')+' style="accent-color:var(--teal);width:16px;height:16px;cursor:pointer">🍵 Kombucha</label>' +
              '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;color:var(--white)"><input type="checkbox" id="gl-ec-pt-coldbrew"'+pt('coldbrew')+' style="accent-color:var(--teal);width:16px;height:16px;cursor:pointer">☕ Cold Brew</label>' +
              '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;color:var(--white)"><input type="checkbox" id="gl-ec-pt-juice"'+pt('juice')+' style="accent-color:var(--teal);width:16px;height:16px;cursor:pointer">🧃 Juice</label>' +
              '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;color:var(--white)"><input type="checkbox" id="gl-ec-pt-rtd"'+pt('rtd')+' style="accent-color:var(--teal);width:16px;height:16px;cursor:pointer">🍸 RTD Cocktail</label>' +
              '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;color:var(--white)"><input type="checkbox" id="gl-ec-pt-energy"'+pt('energy')+' style="accent-color:var(--teal);width:16px;height:16px;cursor:pointer">⚡ Energy</label>' +
              '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;color:var(--white)"><input type="checkbox" id="gl-ec-pt-mocktail"'+pt('mocktail')+' style="accent-color:var(--teal);width:16px;height:16px;cursor:pointer">🍹 Mocktail</label>' +
              '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;color:var(--white)"><input type="checkbox" id="gl-ec-pt-sparkling"'+pt('sparkling')+' style="accent-color:var(--teal);width:16px;height:16px;cursor:pointer">💧 Sparkling Water</label>' +
              '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;color:var(--white)"><input type="checkbox" id="gl-ec-pt-sports"'+pt('sports')+' style="accent-color:var(--teal);width:16px;height:16px;cursor:pointer">🏃 Sports Drink</label>' +
              '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;color:var(--white)"><input type="checkbox" id="gl-ec-pt-other"'+pt('other')+' style="accent-color:var(--teal);width:16px;height:16px;cursor:pointer">📦 Other</label>' +
            '</div>' +
          '</div>' +
          '<div style="background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.06);border-radius:8px;padding:12px">' +
            '<div style="'+LABEL_STYLE+';margin-bottom:8px">COMPLIANCE DOCS</div>' +
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;align-items:end">' +
              '<label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--white);cursor:pointer">' +
                '<input type="checkbox" id="gl-ec-coi-on-file"'+(c.coiOnFile?' checked':'')+' style="accent-color:var(--teal);width:16px;height:16px;cursor:pointer">📄 Certificate of Insurance (COI) on file' +
              '</label>' +
              '<div><div style="'+LABEL_STYLE+';margin-bottom:3px">CERTIFICATE OF INSURANCE EXPIRES</div><input type="date" id="gl-ec-coi-expires" value="'+esc(c.coiExpires)+'" style="'+INPUT_STYLE+';padding:8px;font-size:13px"></div>' +
            '</div>' +
            '<div style="border-top:1px solid rgba(255,255,255,.06);margin:10px 0"></div>' +
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;align-items:end">' +
              '<label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--white);cursor:pointer">' +
                '<input type="checkbox" id="gl-ec-w9-on-file"'+(c.w9OnFile?' checked':'')+' style="accent-color:var(--teal);width:16px;height:16px;cursor:pointer">📄 W-9 on file' +
              '</label>' +
              '<div><div style="'+LABEL_STYLE+';margin-bottom:3px">W-9 RECEIVED</div><input type="date" id="gl-ec-w9-received" value="'+esc(c.w9Received)+'" style="'+INPUT_STYLE+';padding:8px;font-size:13px"></div>' +
            '</div>' +
            (c.w9FilePath ? '<div style="font-size:12px;color:var(--teal);margin-top:6px"><a href="#" id="gl-ec-w9-link" style="color:var(--teal)">📄 View current W-9</a></div>' : '') +
            '<div style="margin-top:8px"><div style="'+LABEL_STYLE+';margin-bottom:3px">UPLOAD NEW W-9 PDF</div>' +
              '<input type="file" id="gl-ec-w9-file" accept=".pdf,image/*" style="'+INPUT_STYLE+';padding:8px;font-size:12px">' +
            '</div>' +
            '<div style="border-top:1px solid rgba(255,255,255,.06);margin:10px 0"></div>' +
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;align-items:end">' +
              '<label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--white);cursor:pointer">' +
                '<input type="checkbox" id="gl-ec-tax-exempt"'+(c.taxExempt?' checked':'')+' style="accent-color:var(--teal);width:16px;height:16px;cursor:pointer">📄 State sales-tax exempt' +
              '</label>' +
              '<div><div style="'+LABEL_STYLE+';margin-bottom:3px">EXEMPT STATE</div><input id="gl-ec-tax-exempt-state" maxlength="2" value="'+esc(c.taxExemptState)+'" style="'+INPUT_STYLE+';padding:8px;font-size:13px;text-transform:uppercase"></div>' +
            '</div>' +
            (c.taxExemptFilePath ? '<div style="font-size:12px;color:var(--teal);margin-top:6px"><a href="#" id="gl-ec-tax-link" style="color:var(--teal)">📄 View current exemption certificate</a></div>' : '') +
            '<div style="margin-top:8px"><div style="'+LABEL_STYLE+';margin-bottom:3px">UPLOAD NEW EXEMPTION CERTIFICATE</div>' +
              '<input type="file" id="gl-ec-tax-exempt-file" accept=".pdf,image/*" style="'+INPUT_STYLE+';padding:8px;font-size:12px">' +
            '</div>' +
            '<div style="border-top:1px solid rgba(255,255,255,.06);margin:10px 0"></div>' +
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;align-items:end">' +
              '<label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--white);cursor:pointer">' +
                '<input type="checkbox" id="gl-ec-pa-letter"'+(c.paLetterOnFile?' checked':'')+' style="accent-color:var(--teal);width:16px;height:16px;cursor:pointer">📄 Process Authority letter on file' +
              '</label>' +
              '<div><div style="'+LABEL_STYLE+';margin-bottom:3px">PA LETTER EXPIRES</div><input type="date" id="gl-ec-pa-letter-expires" value="'+esc(c.paLetterExpires)+'" style="'+INPUT_STYLE+';padding:8px;font-size:13px"></div>' +
            '</div>' +
            (c.paLetterFilePath ? '<div style="font-size:12px;color:var(--teal);margin-top:6px"><a href="#" id="gl-ec-pa-link" style="color:var(--teal)">📄 View current Process Authority letter</a></div>' : '') +
            '<div style="margin-top:8px"><div style="'+LABEL_STYLE+';margin-bottom:3px">UPLOAD NEW PROCESS AUTHORITY LETTER</div>' +
              '<input type="file" id="gl-ec-pa-letter-file" accept=".pdf,image/*" style="'+INPUT_STYLE+';padding:8px;font-size:12px">' +
              '<div style="font-size:11px;color:var(--muted);margin-top:4px">FDA-required for acidified / low-acid canned beverages.</div>' +
            '</div>' +
          '</div>' +
          ((c.stripeCustomerId || c.qboCustomerId) ?
            '<div style="background:rgba(0,229,192,.04);border:1px solid rgba(0,229,192,.15);border-radius:8px;padding:12px">' +
              '<div style="'+LABEL_STYLE+';margin-bottom:8px">LINKED ACCOUNTS <span style="opacity:.6">(auto-populated, read-only)</span></div>' +
              (c.stripeCustomerId ? '<div style="font-size:12px;color:var(--white);margin-bottom:4px"><span style="color:var(--muted)">Stripe:</span> <code style="font-family:var(--ff-mono);font-size:11px">'+esc(c.stripeCustomerId)+'</code></div>' : '') +
              (c.qboCustomerId ?    '<div style="font-size:12px;color:var(--white)"><span style="color:var(--muted)">QuickBooks:</span> <code style="font-family:var(--ff-mono);font-size:11px">'+esc(c.qboCustomerId)+'</code></div>' : '') +
            '</div>' : '') +
          '<div><div style="'+LABEL_STYLE+'">NOTES</div><textarea id="gl-ec-notes" rows="3" style="'+INPUT_STYLE+';resize:vertical">'+esc(c.notes)+'</textarea></div>' +
          '<div style="background:rgba(245,200,66,.04);border:1px solid rgba(245,200,66,.18);border-radius:8px;padding:14px;margin-top:6px">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">' +
              '<div style="'+LABEL_STYLE+'">💵 PRICING OVERRIDES</div>' +
              '<button type="button" id="gl-ec-rate-add" style="background:rgba(245,200,66,.14);border:1px solid rgba(245,200,66,.4);color:#f5c842;font-size:11px;padding:4px 10px;border-radius:4px;cursor:pointer">+ Add rate</button>' +
            '</div>' +
            '<div id="gl-ec-rates-list" style="font-size:11px;color:#9aa7bd">Loading…</div>' +
            '<div style="font-size:10px;color:#6b87ad;margin-top:8px;line-height:1.5">Negotiated rates for this client. Used by the invoice builder INSTEAD OF the global tier ladder when present. Leave format blank for hour-based services (R&D / Production / Consulting).</div>' +
          '</div>' +
          '<div id="gl-ec-err" style="display:none;color:#e74c3c;font-size:12px"></div>' +
          '<div style="display:flex;gap:8px;margin-top:6px">' +
            '<button id="gl-ec-save" class="cbtn pri" style="flex:1;padding:13px;font-weight:800">💾 Save changes</button>' +
            '<button id="gl-ec-cancel" class="cbtn" style="padding:13px 20px">Cancel</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    ov.addEventListener('click', function(e){ if(e.target === ov) ov.remove(); });
    ov.querySelector('#gl-ec-close').addEventListener('click', function(){ ov.remove(); });
    ov.querySelector('#gl-ec-cancel').addEventListener('click', function(){ ov.remove(); });

    // ── Pricing overrides ──────────────────────────────────────
    var RATE_SERVICES = [
      { value:'canning',    label:'Canning (per can)',         needsFmt:true,  formats:['12oz Standard can','12oz Sleek can','16oz Standard can'] },
      { value:'bottling',   label:'Bottling (per unit)',       needsFmt:true,  formats:['750ml bottle','355ml bottle','12oz bottle'] },
      { value:'rd',         label:'R&D / formulation (per hr)',needsFmt:false },
      { value:'production', label:'Production hours (per hr)', needsFmt:false },
      { value:'consulting', label:'Consulting (per hr)',       needsFmt:false }
    ];
    async function loadOverrides(){
      var listEl = ov.querySelector('#gl-ec-rates-list'); if(!listEl) return;
      if(!window.supa){ listEl.innerHTML = '<span style="color:#ff8579">Supabase not ready</span>'; return; }
      listEl.innerHTML = 'Loading…';
      var r = await window.supa.from('client_rate_overrides')
        .select('id, service, format, override_rate, notes, effective_from, effective_until')
        .eq('client_id', clientId)
        .order('service', { ascending: true });
      if(r.error){ listEl.innerHTML = '<span style="color:#ff8579">Failed: '+esc(r.error.message)+'</span>'; return; }
      var rows = r.data || [];
      if(!rows.length){
        listEl.innerHTML = '<span style="font-style:italic;color:#6b87ad">No custom rates — this client pays the standard tier ladder.</span>';
        return;
      }
      listEl.innerHTML = rows.map(function(o){
        var svc = (RATE_SERVICES.find(function(s){ return s.value === o.service; })||{label:o.service}).label;
        var fmtBit = o.format ? ' · <span style="color:#7fc6f5">' + esc(o.format) + '</span>' : '';
        var dateBit = '';
        if(o.effective_from) dateBit += ' · from ' + esc(o.effective_from);
        if(o.effective_until) dateBit += ' · until ' + esc(o.effective_until);
        return '<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:rgba(255,255,255,.03);border-radius:5px;margin-bottom:5px">' +
          '<div style="flex:1;min-width:0">' +
            '<div style="color:#fff;font-size:12px;font-weight:600">' + esc(svc) + fmtBit + '</div>' +
            '<div style="color:#f5c842;font-size:13px;font-weight:700;margin-top:2px">$' + (parseFloat(o.override_rate)||0).toFixed(4) + '</div>' +
            (o.notes ? '<div style="color:#9aa7bd;font-size:10px;margin-top:2px;font-style:italic">' + esc(o.notes) + '</div>' : '') +
            (dateBit ? '<div style="color:#6b87ad;font-size:10px;margin-top:2px">' + dateBit.slice(3) + '</div>' : '') +
          '</div>' +
          '<button type="button" data-rate-rm="' + esc(o.id) + '" style="background:rgba(231,76,60,.12);border:1px solid rgba(231,76,60,.35);color:#ff8579;font-size:10px;padding:4px 8px;border-radius:4px;cursor:pointer">Remove</button>' +
        '</div>';
      }).join('');
      Array.prototype.forEach.call(listEl.querySelectorAll('[data-rate-rm]'), function(b){
        b.onclick = async function(){
          var id = b.getAttribute('data-rate-rm');
          if(!confirm('Remove this rate override? The client will go back to the standard tier ladder for this service.')) return;
          b.disabled = true; b.textContent = '…';
          var rr = await window.supa.from('client_rate_overrides').delete().eq('id', id);
          if(rr.error){ alert('Delete failed: ' + rr.error.message); b.disabled = false; b.textContent = 'Remove'; return; }
          if(typeof window.glAudit === 'function') window.glAudit('rate_override_removed', clientId, { id: id });
          // Invalidate cache so next invoice builder load fetches fresh.
          if(window._glRates && window._glRates.overrides) delete window._glRates.overrides[clientId];
          loadOverrides();
        };
      });
    }
    function openAddRateModal(){
      var prior = document.getElementById('gl-rate-modal'); if(prior) prior.remove();
      var svcOpts = RATE_SERVICES.map(function(s){ return '<option value="'+s.value+'">'+esc(s.label)+'</option>'; }).join('');
      var mov = document.createElement('div');
      mov.id = 'gl-rate-modal';
      mov.setAttribute('style','position:fixed;inset:0;z-index:1200;background:rgba(6,13,26,.92);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:20px');
      mov.innerHTML =
        '<div style="background:#142238;border:1px solid rgba(245,200,66,.35);border-radius:14px;padding:24px;width:100%;max-width:440px">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">' +
            '<div style="font-family:var(--ff-disp);font-size:16px;letter-spacing:2px;color:#f5c842">💵 ADD RATE OVERRIDE</div>' +
            '<button id="gl-rate-close" style="background:none;border:none;color:#9aa7bd;font-size:20px;cursor:pointer">✕</button>' +
          '</div>' +
          '<div class="frow"><div class="flbl">Service *</div><select class="fsel" id="gl-rate-service">' + svcOpts + '</select></div>' +
          '<div class="frow" id="gl-rate-fmt-row"><div class="flbl">Format <span style="opacity:.6">(leave blank to apply to all formats)</span></div><input class="finp" id="gl-rate-format" placeholder="e.g. 12oz Standard can"></div>' +
          '<div class="frow"><div class="flbl">Override rate * <span style="opacity:.6">(per can / per unit / per hour, USD)</span></div><input class="finp" id="gl-rate-amt" type="number" step="0.0001" min="0" placeholder="0.42"></div>' +
          '<div class="frow"><div class="flbl">Notes <span style="opacity:.6">(why this rate exists)</span></div><textarea class="finp" id="gl-rate-notes" rows="2" placeholder="e.g. Locked in Mar 2026 pilot rate"></textarea></div>' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
            '<div class="frow"><div class="flbl">Effective from <span style="opacity:.6">(optional)</span></div><input class="finp" id="gl-rate-from" type="date"></div>' +
            '<div class="frow"><div class="flbl">Effective until <span style="opacity:.6">(optional)</span></div><input class="finp" id="gl-rate-until" type="date"></div>' +
          '</div>' +
          '<div id="gl-rate-msg" style="display:none;margin:10px 0;padding:8px 10px;border-radius:6px;font-size:12px"></div>' +
          '<div style="display:flex;gap:8px;margin-top:8px">' +
            '<button id="gl-rate-save" class="cbtn pri" style="flex:1">💾 Save rate</button>' +
            '<button id="gl-rate-cancel" class="cbtn">Cancel</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(mov);
      function rateMsg(text, kind){
        var el = mov.querySelector('#gl-rate-msg'); el.style.display='block'; el.textContent = text;
        if(kind==='err'){ el.style.background='rgba(231,76,60,.12)'; el.style.border='1px solid rgba(231,76,60,.35)'; el.style.color='#ff8579'; }
        else { el.style.background='rgba(95,207,158,.12)'; el.style.border='1px solid rgba(95,207,158,.35)'; el.style.color='#5fcf9e'; }
      }
      function toggleFmtRow(){
        var svc = mov.querySelector('#gl-rate-service').value;
        var meta = RATE_SERVICES.find(function(s){ return s.value === svc; });
        mov.querySelector('#gl-rate-fmt-row').style.display = (meta && meta.needsFmt) ? 'block' : 'none';
      }
      toggleFmtRow();
      mov.querySelector('#gl-rate-service').onchange = toggleFmtRow;
      mov.querySelector('#gl-rate-close').onclick  = function(){ mov.remove(); };
      mov.querySelector('#gl-rate-cancel').onclick = function(){ mov.remove(); };
      mov.querySelector('#gl-rate-save').onclick = async function(){
        var svc = mov.querySelector('#gl-rate-service').value;
        var fmt = (mov.querySelector('#gl-rate-format').value||'').trim() || null;
        var amt = parseFloat(mov.querySelector('#gl-rate-amt').value);
        if(!(amt >= 0)){ rateMsg('Enter a non-negative rate.', 'err'); return; }
        var notes = (mov.querySelector('#gl-rate-notes').value||'').trim() || null;
        var dFrom = mov.querySelector('#gl-rate-from').value || null;
        var dTo   = mov.querySelector('#gl-rate-until').value || null;
        var btn = this; btn.disabled = true; btn.textContent = 'Saving…';
        var ins = await window.supa.from('client_rate_overrides').insert({
          client_id: clientId, service: svc, format: fmt,
          override_rate: amt, notes: notes,
          effective_from: dFrom, effective_until: dTo
        });
        if(ins.error){
          // 23505 = unique violation (already exists for this svc+fmt)
          var dup = /duplicate key|23505|unique constraint/i.test(ins.error.message);
          rateMsg(dup ? 'A rate for this service + format already exists. Remove it first.' : 'Save failed: ' + ins.error.message, 'err');
          btn.disabled = false; btn.textContent = '💾 Save rate';
          return;
        }
        if(typeof window.glAudit === 'function') window.glAudit('rate_override_added', clientId, { service: svc, format: fmt, rate: amt });
        if(window._glRates && window._glRates.overrides) delete window._glRates.overrides[clientId];
        mov.remove();
        loadOverrides();
      };
    }
    var rateAddBtn = ov.querySelector('#gl-ec-rate-add');
    if(rateAddBtn) rateAddBtn.onclick = openAddRateModal;
    loadOverrides();

    // Toggle billing block based on "same as physical" checkbox.
    var bsame = ov.querySelector('#gl-ec-billing-same');
    var bblock = ov.querySelector('#gl-ec-billing-block');
    bsame.addEventListener('change', function(){ bblock.style.display = bsame.checked ? 'none' : 'grid'; });
    // Toggle shipping block based on "same as billing" checkbox.
    var ssame = ov.querySelector('#gl-ec-shipping-same');
    var sblock = ov.querySelector('#gl-ec-shipping-block');
    if(ssame && sblock) ssame.addEventListener('change', function(){ sblock.style.display = ssame.checked ? 'none' : 'grid'; });

    // Wire signed-URL preview links for stored compliance docs.
    async function openDoc(path){
      if(!path || !window.supa) return;
      try {
        var r = await window.supa.storage.from('client-docs').createSignedUrl(path, 300);
        if(r && r.data && r.data.signedUrl) window.open(r.data.signedUrl, '_blank');
      } catch(e){ console.warn('[GL] signed url failed', e); }
    }
    var w9Link  = ov.querySelector('#gl-ec-w9-link');
    var taxLink = ov.querySelector('#gl-ec-tax-link');
    var paLink  = ov.querySelector('#gl-ec-pa-link');
    if(w9Link)  w9Link.addEventListener('click',  function(e){ e.preventDefault(); openDoc(c.w9FilePath); });
    if(taxLink) taxLink.addEventListener('click', function(e){ e.preventDefault(); openDoc(c.taxExemptFilePath); });
    if(paLink)  paLink.addEventListener('click',  function(e){ e.preventDefault(); openDoc(c.paLetterFilePath); });

    // Additional-emails list: add + remove handlers.
    var EM_INPUT_STYLE = INPUT_STYLE; // reuse the modal's standard input style
    function appendEmailRow(label, email){
      var list = ov.querySelector('#gl-ec-emails-list');
      if(!list) return;
      // Clear the empty-state placeholder on first add.
      var ph = list.querySelector('div[style*="text-align:center"]');
      if(ph) ph.remove();
      var row = document.createElement('div');
      row.className = 'gl-ec-email-row';
      row.setAttribute('style','display:grid;grid-template-columns:120px 1fr 30px;gap:6px;align-items:center');
      row.innerHTML =
        '<input class="gl-ec-em-label" placeholder="Label (AP, Ops…)" value="'+esc(label||'')+'" style="'+EM_INPUT_STYLE+';font-size:11px">' +
        '<input class="gl-ec-em-email" type="email" placeholder="email@company.com" value="'+esc(email||'')+'" style="'+EM_INPUT_STYLE+';font-size:12px">' +
        '<button type="button" class="gl-ec-em-del" title="Remove" style="background:none;border:none;color:rgba(231,76,60,.7);cursor:pointer;font-size:18px;line-height:1">&times;</button>';
      list.appendChild(row);
    }
    var addEmailBtn = ov.querySelector('#gl-ec-add-email');
    if(addEmailBtn) addEmailBtn.addEventListener('click', function(){ appendEmailRow('', ''); });
    var emailsList = ov.querySelector('#gl-ec-emails-list');
    if(emailsList) emailsList.addEventListener('click', function(e){
      if(e.target.classList && e.target.classList.contains('gl-ec-em-del')){
        var row = e.target.closest('.gl-ec-email-row');
        if(row) row.remove();
      }
    });

    ov.querySelector('#gl-ec-save').addEventListener('click', async function(){
      var errEl = ov.querySelector('#gl-ec-err');
      errEl.style.display = 'none';
      function setErr(m){ errEl.textContent = m; errEl.style.display = 'block'; }
      function val(id){ var el = ov.querySelector('#'+id); return el ? el.value.trim() : ''; }
      function chk(id){ var el = ov.querySelector('#'+id); return !!(el && el.checked); }
      function fileOf(id){ var el = ov.querySelector('#'+id); return el && el.files && el.files[0] ? el.files[0] : null; }

      var name = val('gl-ec-name');
      if(!name){ setErr('Brand name is required.'); return; }

      var commPrefsOut = [
        chk('gl-ec-comm-email')    ? 'email'    : null,
        chk('gl-ec-comm-sms')      ? 'sms'      : null,
        chk('gl-ec-comm-whatsapp') ? 'whatsapp' : null,
        chk('gl-ec-comm-wechat')   ? 'wechat'   : null
      ].filter(Boolean);

      var productTypesOut = [
        chk('gl-ec-pt-seltzer')   ? 'seltzer'   : null,
        chk('gl-ec-pt-kombucha')  ? 'kombucha'  : null,
        chk('gl-ec-pt-coldbrew')  ? 'coldbrew'  : null,
        chk('gl-ec-pt-juice')     ? 'juice'     : null,
        chk('gl-ec-pt-rtd')       ? 'rtd'       : null,
        chk('gl-ec-pt-energy')    ? 'energy'    : null,
        chk('gl-ec-pt-mocktail')  ? 'mocktail'  : null,
        chk('gl-ec-pt-sparkling') ? 'sparkling' : null,
        chk('gl-ec-pt-sports')    ? 'sports'    : null,
        chk('gl-ec-pt-other')     ? 'other'     : null
      ].filter(Boolean);

      var dockDaysOut = ['mon','tue','wed','thu','fri','sat','sun']
        .filter(function(d){ return chk('gl-ec-dock-'+d); });

      // Read the additional-emails list. Trim whitespace, drop rows where
      // the email is blank (label without email is meaningless).
      var additionalEmailsOut = [];
      ov.querySelectorAll('.gl-ec-email-row').forEach(function(row){
        var lEl = row.querySelector('.gl-ec-em-label');
        var eEl = row.querySelector('.gl-ec-em-email');
        var label = lEl ? (lEl.value||'').trim() : '';
        var email = eEl ? (eEl.value||'').trim() : '';
        if(email) additionalEmailsOut.push({ label: label, email: email });
      });

      var street = val('gl-ec-street');
      var city   = val('gl-ec-city');
      var state  = val('gl-ec-state').toUpperCase();
      var zip    = val('gl-ec-zip');
      var bSame  = chk('gl-ec-billing-same');
      var bStreet= bSame ? street : val('gl-ec-billing-street');
      var bCity  = bSame ? city   : val('gl-ec-billing-city');
      var bState = bSame ? state  : val('gl-ec-billing-state').toUpperCase();
      var bZip   = bSame ? zip    : val('gl-ec-billing-zip');
      var sSame  = chk('gl-ec-shipping-same');

      // Upload new compliance files if the user picked any.
      var w9File  = fileOf('gl-ec-w9-file');
      var taxFile = fileOf('gl-ec-tax-exempt-file');
      var paFile  = fileOf('gl-ec-pa-letter-file');
      var w9OnFile = chk('gl-ec-w9-on-file');
      var w9Received = val('gl-ec-w9-received');
      var taxExempt = chk('gl-ec-tax-exempt');
      var paLetterOnFile = chk('gl-ec-pa-letter');
      var newW9Path = '', newTaxPath = '', newPaPath = '';
      if(w9File){
        // Implicitly mark on file if a fresh file is being attached.
        w9OnFile = true;
        if(!w9Received) w9Received = new Date().toISOString().slice(0,10);
      }
      if(taxFile) taxExempt = true;
      if(paFile)  paLetterOnFile = true;

      var btn = this; var orig = btn.textContent;
      btn.disabled = true; btn.textContent = 'Saving…';

      if(w9File && typeof window.uploadComplianceDoc === 'function'){
        newW9Path = await window.uploadComplianceDoc(w9File, clientId, 'w9');
      }
      if(taxFile && typeof window.uploadComplianceDoc === 'function'){
        newTaxPath = await window.uploadComplianceDoc(taxFile, clientId, 'tax_exempt');
      }
      if(paFile && typeof window.uploadComplianceDoc === 'function'){
        newPaPath = await window.uploadComplianceDoc(paFile, clientId, 'pa_letter');
      }

      var patch = {
        name:           name,
        legalName:      val('gl-ec-legal-name'),
        ein:            val('gl-ec-ein'),
        website:        val('gl-ec-website'),
        contact:        val('gl-ec-contact'),
        email:          val('gl-ec-email'),
        phone:          val('gl-ec-phone'),
        contactType:    val('gl-ec-contact-type'),
        additionalEmails: additionalEmailsOut,
        street:         street,
        city:           city,
        state:          state,
        zip:            zip,
        billingSame:    bSame,
        billingStreet:  bStreet,
        billingCity:    bCity,
        billingState:   bState,
        billingZip:     bZip,
        shippingSame:   sSame,
        shippingStreet: sSame ? bStreet : val('gl-ec-shipping-street'),
        shippingCity:   sSame ? bCity   : val('gl-ec-shipping-city'),
        shippingState:  sSame ? bState  : val('gl-ec-shipping-state').toUpperCase(),
        shippingZip:    sSame ? bZip    : val('gl-ec-shipping-zip'),
        liftGate:       chk('gl-ec-lift-gate'),
        notify_overdue_sms: chk('gl-ec-notify-sms'),
        dockDays:       dockDaysOut,
        dockHours:      val('gl-ec-dock-hours'),
        commPrefs:      commPrefsOut,
        productTypes:   productTypesOut,
        service:        val('gl-ec-service'),
        status:         val('gl-ec-status'),
        paymentTerms:   val('gl-ec-payment-terms') || 'Due on receipt',
        paymentMethod:  val('gl-ec-payment-method'),
        leadSource:     val('gl-ec-lead-source'),
        accountOwner:   val('gl-ec-account-owner'),
        referredBy:     val('gl-ec-referrer'),
        coiOnFile:      chk('gl-ec-coi-on-file'),
        coiExpires:     val('gl-ec-coi-expires'),
        w9OnFile:       w9OnFile,
        w9Received:     w9Received,
        taxExempt:      taxExempt,
        taxExemptState: val('gl-ec-tax-exempt-state').toUpperCase(),
        paLetterOnFile: paLetterOnFile,
        paLetterExpires:val('gl-ec-pa-letter-expires'),
        notes:          val('gl-ec-notes')
      };
      // Only set file paths in the patch when a new upload happened; otherwise
      // leave them alone so we don't overwrite the existing pointer.
      if(newW9Path)  patch.w9FilePath = newW9Path;
      if(newTaxPath) patch.taxExemptFilePath = newTaxPath;
      if(newPaPath)  patch.paLetterFilePath = newPaPath;

      var ok = await window.glUpdateClient(clientId, patch);
      btn.disabled = false; btn.textContent = orig;
      if(ok) ov.remove();
      else   setErr('Save failed — check the browser console.');
    });

    host.appendChild(ov);
    setTimeout(function(){ ov.querySelector('#gl-ec-name').focus(); }, 50);
  };

  window.glUpdateClient = async function(clientId, patch){
    var list = window.clients || [];
    var c = list.find(function(x){ return x.id === clientId; });
    if(!c) return false;

    // Recompute initials if the name changed.
    var newInit = (patch.name||c.name||'').split(' ').map(function(w){ return w[0]||''; }).join('').toUpperCase().slice(0,2);

    // Apply locally first so the UI feels instant.
    var prevSnapshot = Object.assign({}, c);
    Object.assign(c, patch, { init: newInit });

    if(window.supa){
      try {
        var supaPatch = {
          name:            patch.name,
          legal_name:      patch.legalName,
          ein:             patch.ein,
          website:         patch.website,
          contact_name:    patch.contact,
          email:           patch.email,
          phone:           patch.phone,
          contact_type:    patch.contactType || null,
          additional_emails: Array.isArray(patch.additionalEmails) ? patch.additionalEmails : undefined,
          street:          patch.street,
          city:            patch.city,
          state:           patch.state,
          zip:             patch.zip,
          billing_same:    patch.billingSame,
          billing_street:  patch.billingStreet,
          billing_city:    patch.billingCity,
          billing_state:   patch.billingState,
          billing_zip:     patch.billingZip,
          shipping_same:   patch.shippingSame,
          shipping_street: patch.shippingStreet,
          shipping_city:   patch.shippingCity,
          shipping_state:  patch.shippingState,
          shipping_zip:    patch.shippingZip,
          lift_gate:       !!patch.liftGate,
          notify_overdue_sms: typeof patch.notify_overdue_sms === 'boolean' ? patch.notify_overdue_sms : undefined,
          dock_days:       patch.dockDays,
          dock_hours:      patch.dockHours,
          comm_prefs:      patch.commPrefs,
          product_types:   patch.productTypes,
          service:         patch.service,
          status:          patch.status,
          payment_terms:   patch.paymentTerms,
          payment_method:  patch.paymentMethod || null,
          lead_source:     patch.leadSource || null,
          account_owner:   patch.accountOwner || null,
          referred_by:     patch.referredBy || null,
          coi_on_file:     !!patch.coiOnFile,
          coi_expires:     patch.coiExpires || null,
          w9_on_file:      !!patch.w9OnFile,
          w9_received:     patch.w9Received || null,
          w9_file_path:    patch.w9FilePath,
          tax_exempt:      !!patch.taxExempt,
          tax_exempt_state: patch.taxExemptState || null,
          tax_exempt_file_path: patch.taxExemptFilePath,
          pa_letter_on_file: !!patch.paLetterOnFile,
          pa_letter_expires: patch.paLetterExpires || null,
          pa_letter_file_path: patch.paLetterFilePath,
          notes:           patch.notes,
          initials:        newInit
        };
        // Strip undefined keys so we don't accidentally wipe values not in the patch
        // (file paths are only present when a fresh upload happened).
        Object.keys(supaPatch).forEach(function(k){ if(supaPatch[k] === undefined) delete supaPatch[k]; });
        // Retry on PGRST204 "column not found" by peeling off the offending column.
        // Without this, a schema drift on any single column rejects the entire UPDATE
        // and the user's edits silently disappear on refresh.
        var working = Object.assign({}, supaPatch);
        var r, retries = 30, droppedCols = [];
        while(retries-- > 0){
          r = await window.supa.from('clients').update(working).eq('id', clientId);
          if(!r || !r.error) break;
          if(r.error.code !== 'PGRST204') break;
          var m = (r.error.message || '').match(/'([^']+)' column/);
          if(!m || working[m[1]] === undefined) break;
          droppedCols.push(m[1]);
          delete working[m[1]];
        }
        if(droppedCols.length){
          console.warn('[GL] glUpdateClient: dropped unknown columns to recover save:', droppedCols);
          if(typeof addNotification === 'function') addNotification('Saved (partial)','Run the latest migration: '+droppedCols.join(', '),'warning');
        }
        if(r && r.error){
          console.warn('[GL] glUpdateClient: supabase error', r.error);
          if(typeof addNotification === 'function') addNotification('Saved locally','Server error: '+r.error.message,'warning');
          return false;
        }
      } catch(e){
        console.warn('[GL] glUpdateClient threw', e);
        if(typeof addNotification === 'function') addNotification('Saved locally','Server unreachable','warning');
      }
    }

    if(typeof window.glAudit === 'function'){
      // Audit only the fields that changed for a compact log.
      var diff = {};
      Object.keys(patch).forEach(function(k){
        if(JSON.stringify(prevSnapshot[k]) !== JSON.stringify(patch[k])) diff[k] = true;
      });
      window.glAudit('client_edited', clientId, { fields: Object.keys(diff) });
    }

    if(typeof renderClients === 'function') try { renderClients(); } catch(e){}
    if(typeof renderDash === 'function')    try { renderDash();    } catch(e){}

    // If a detail panel is open for this client, re-open it to reflect the changes.
    var openOv = document.getElementById('client-detail-overlay');
    if(openOv){
      openOv.remove();
      if(typeof viewClientEnhanced === 'function') try { viewClientEnhanced(clientId); } catch(e){
        if(typeof openClientDetail === 'function') openClientDetail(clientId);
      } else if(typeof openClientDetail === 'function') openClientDetail(clientId);
    }

    if(typeof addNotification === 'function') addNotification('✓ Client updated', c.name, 'success');
    return true;
  };

  console.log('[GL] glOpenEditClient + glUpdateClient loaded');
}());

/* ============================================================
   DASHBOARD COMPLIANCE ALERT
   Surfaces clients whose Certificate of Insurance or Process
   Authority letter is expired or expiring within the next 30 days.
   - Renders nothing if no docs are at risk.
   - Renders an amber banner if only "expiring soon" items exist.
   - Renders a red banner if anything is already expired (mixed
     content still uses red since the expired items dominate).
   - Click any client row to jump straight to that client's detail
     panel. Wires through whichever viewer the CRM has loaded.
   ============================================================ */
(function(){
  function daysBetween(d){
    var today = new Date(); today.setHours(0,0,0,0);
    var exp = new Date(d); exp.setHours(0,0,0,0);
    return Math.round((exp - today) / 86400000);
  }

  function gatherAtRisk(){
    var rows = [];
    (window.clients || []).forEach(function(c){
      function consider(kind, label, hasFlag, expDate){
        if(!hasFlag) return;       // nothing to track if doc not on file
        if(!expDate) return;       // no date = no expiration to warn on
        var d = daysBetween(expDate);
        if(d > 30) return;          // safe window
        rows.push({
          clientId: c.id, clientName: c.name,
          kind: kind, label: label,
          daysLeft: d, expDate: expDate
        });
      }
      consider('coi', 'Certificate of Insurance', c.coiOnFile, c.coiExpires);
      consider('pa',  'Process Authority letter', c.paLetterOnFile, c.paLetterExpires);
    });
    // Sort: expired first (most negative daysLeft), then by daysLeft ascending.
    rows.sort(function(a,b){ return a.daysLeft - b.daysLeft; });
    return rows;
  }

  function openClient(id){
    if(typeof window.viewClientEnhanced === 'function') return window.viewClientEnhanced(id);
    if(typeof window.openClientDetail === 'function') return window.openClientDetail(id);
  }

  window.renderComplianceAlert = function(){
    var host = document.getElementById('dash-compliance-alert');
    if(!host) return;
    var rows = gatherAtRisk();
    if(!rows.length){ host.innerHTML = ''; return; }

    var anyExpired = rows.some(function(r){ return r.daysLeft < 0; });
    var color = anyExpired ? '#e74c3c' : '#f5c842';
    var bg    = anyExpired ? 'rgba(231,76,60,.07)' : 'rgba(245,200,66,.06)';
    var border= anyExpired ? 'rgba(231,76,60,.35)' : 'rgba(245,200,66,.3)';
    var icon  = anyExpired ? '🚨' : '⚠';
    var headline = anyExpired
      ? rows.filter(function(r){ return r.daysLeft < 0; }).length + ' expired · ' + rows.length + ' total flagged'
      : rows.length + ' document' + (rows.length === 1 ? '' : 's') + ' expiring soon';

    var listHtml = rows.map(function(r){
      var sev, txt;
      if(r.daysLeft < 0)      { sev = '#ff8579'; txt = 'EXPIRED ' + (-r.daysLeft) + 'd ago'; }
      else if(r.daysLeft < 8) { sev = '#ff8579'; txt = 'in ' + r.daysLeft + 'd'; }
      else                    { sev = '#f5c842'; txt = 'in ' + r.daysLeft + 'd'; }
      return '<div class="gl-comp-row" data-cid="' + r.clientId + '" style="display:flex;justify-content:space-between;align-items:center;padding:9px 12px;border-radius:8px;cursor:pointer;transition:background .15s" onmouseover="this.style.background=\'rgba(255,255,255,.04)\'" onmouseout="this.style.background=\'transparent\'">' +
        '<div style="display:flex;align-items:center;gap:10px;min-width:0">' +
          '<span style="font-size:14px">📄</span>' +
          '<div style="min-width:0">' +
            '<div style="color:var(--white);font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(r.clientName) + '</div>' +
            '<div style="color:var(--muted);font-size:11px">' + esc(r.label) + ' · ' + esc(r.expDate) + '</div>' +
          '</div>' +
        '</div>' +
        '<div style="color:' + sev + ';font-size:11px;font-weight:700;white-space:nowrap;letter-spacing:.5px">' + txt + '</div>' +
      '</div>';
    }).join('');

    host.innerHTML =
      '<div style="background:' + bg + ';border:1px solid ' + border + ';border-radius:12px;padding:14px 16px;margin-bottom:14px">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">' +
          '<div style="display:flex;align-items:center;gap:10px">' +
            '<span style="font-size:18px">' + icon + '</span>' +
            '<div>' +
              '<div style="font-family:var(--ff-disp);font-size:13px;letter-spacing:2px;color:' + color + '">COMPLIANCE EXPIRING</div>' +
              '<div style="font-size:11px;color:var(--muted);margin-top:2px">' + headline + '</div>' +
            '</div>' +
          '</div>' +
          '<button id="gl-comp-dismiss" style="background:none;border:1px solid rgba(255,255,255,.12);color:var(--muted);font-size:11px;padding:5px 11px;border-radius:6px;cursor:pointer">hide for today</button>' +
        '</div>' +
        '<div style="display:flex;flex-direction:column;gap:2px">' + listHtml + '</div>' +
      '</div>';

    // Click row → open client detail.
    host.querySelectorAll('.gl-comp-row').forEach(function(row){
      row.addEventListener('click', function(){ openClient(row.getAttribute('data-cid')); });
    });
    // Hide for today (per-device).
    var dismiss = host.querySelector('#gl-comp-dismiss');
    if(dismiss) dismiss.addEventListener('click', function(){
      localStorage.setItem('gl_comp_alert_hide_until', new Date().toISOString().slice(0,10));
      host.innerHTML = '';
    });
  };

  // Refresh the compliance alert whenever the dashboard re-renders.
  window.GL_HOOKS.registerDashPatch(function(){
    try {
      var hideUntil = localStorage.getItem('gl_comp_alert_hide_until');
      var today = new Date().toISOString().slice(0,10);
      if(hideUntil === today){
        var host = document.getElementById('dash-compliance-alert');
        if(host) host.innerHTML = '';
        return;
      }
      window.renderComplianceAlert();
    } catch(e){ console.warn('[GL] compliance alert render threw', e); }
  });

  console.log('[GL] dashboard compliance alert loaded');
}());
