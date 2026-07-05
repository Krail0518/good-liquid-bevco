/* ============================================================
   ACCOUNTING ENHANCEMENTS v1.0

   14 features injected into the invoices section:
    1. PO Number field in invoice builder
    2. Void Invoice button
    3. Quote auto-expiry (30 days)
    4. Late fee prompt (1.5%/month after due date)
    5. Payment receipt email
    6. Credit limit warning
    7. Statement of Account (per-client)
    8. Revenue by Client chart
    9. Cash Flow Forecast
   10. Partial Payments (invoice_payments table)
   11. Multi-step Collections email sequence
   12. Recurring Invoices (recurring_invoices table)
   13. Credit Memos
   14. Expense Tracking (expenses table)

   All features are injected via MutationObserver so they work
   regardless of when the invoices page is navigated to.
   ============================================================ */
(function () {
  'use strict';

  // ── Shared helpers ─────────────────────────────────────────
  function SB() { return window.supa; }
  function fmt$(n) { return '$' + (Number(n) || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function esc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function todayStr() { return new Date().toISOString().slice(0,10); }
  function notify(msg, type) {
    var n = document.createElement('div');
    n.textContent = msg;
    n.style.cssText = 'position:fixed;top:70px;right:20px;z-index:99999;padding:10px 16px;border-radius:6px;font-size:14px;font-weight:600;color:#fff;background:' + (type==='error' ? '#e53e3e' : type==='warn' ? '#d69e2e' : '#38a169');
    document.body.appendChild(n);
    setTimeout(function(){ n.remove(); }, 3500);
  }
  function getInv(id) {
    var arr = window.invoices || [];
    return arr.find(function(x){ return x.invoice_number === id || x.id === id; }) || null;
  }
  function getClient(id) {
    var arr = window.clients || [];
    return arr.find(function(x){ return x.id === id || x.client_id === id; }) || null;
  }

  // ── Modal helper ───────────────────────────────────────────
  function openModal(id, title, bodyHtml, onOpen) {
    var existing = document.getElementById(id);
    if (existing) existing.remove();
    var m = document.createElement('div');
    m.id = id;
    m.style.cssText = 'position:fixed;inset:0;z-index:9990;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:20px';
    m.innerHTML = '<div style="background:#fff;border-radius:10px;width:100%;max-width:760px;max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.3)">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid #e2e8f0">' +
      '<h3 style="margin:0;font-size:18px">' + esc(title) + '</h3>' +
      '<button id="' + id + '-close" style="background:none;border:none;font-size:22px;cursor:pointer;line-height:1">&times;</button></div>' +
      '<div id="' + id + '-body" style="padding:20px">' + bodyHtml + '</div></div>';
    document.body.appendChild(m);
    document.getElementById(id + '-close').onclick = function(){ m.remove(); };
    m.addEventListener('click', function(e){ if (e.target === m) m.remove(); });
    if (typeof onOpen === 'function') onOpen(m);
    return m;
  }

  // ── FEATURE 1: PO Number field in invoice builder ─────────
  function injectPOField() {
    var builder = document.getElementById('gl-inv-builder');
    if (!builder || builder.dataset.poInjected) return;
    builder.dataset.poInjected = '1';
    var body = document.getElementById('gl-inv-body') || builder.querySelector('.inv-body, form');
    if (!body) return;
    var firstInput = body.querySelector('input, select, textarea');
    if (!firstInput) return;
    var row = document.createElement('div');
    row.style.cssText = 'margin-bottom:12px';
    row.innerHTML = '<label style="display:block;font-size:12px;font-weight:600;color:#718096;margin-bottom:4px">PO Number (optional)</label>' +
      '<input id="gl-po-number" type="text" placeholder="Customer PO #" style="width:100%;padding:8px 10px;border:1px solid #e2e8f0;border-radius:6px;font-size:14px">';
    var parent = firstInput.closest('div') || body;
    body.insertBefore(row, parent.firstChild);
    var inv = window.currentInvId ? getInv(window.currentInvId) : null;
    if (inv && inv.po_number) document.getElementById('gl-po-number').value = inv.po_number;
  }

  // Patch save to capture PO number
  var _origSave = window.glSaveInvoice;
  if (typeof _origSave === 'function' && !_origSave.__poPatched) {
    window.glSaveInvoice = async function() {
      var poEl = document.getElementById('gl-po-number');
      if (window.INV && poEl) window.INV.poNumber = poEl.value.trim();
      var result = await _origSave.apply(this, arguments);
      if (window.INV && window.INV.poNumber && window.INV.invoice_number) {
        await SB().from('invoices').update({ po_number: window.INV.poNumber }).eq('invoice_number', window.INV.invoice_number);
      }
      return result;
    };
    window.glSaveInvoice.__poPatched = true;
  }

  // ── FEATURE 2: Void Invoice button ────────────────────────
  function injectVoidButton() {
    var detail = document.getElementById('inv-detail');
    if (!detail || !detail.classList.contains('show') || detail.dataset.voidInjected) return;
    detail.dataset.voidInjected = '1';
    var invId = window.currentInvId;
    var inv = invId ? getInv(invId) : null;
    if (!inv || inv.status === 'voided' || inv.is_credit_memo) return;
    var btnRow = detail.querySelector('div[style*="display:flex"]');
    if (!btnRow || btnRow.querySelector('.gl-void-btn')) return;
    var btn = document.createElement('button');
    btn.innerHTML = '🚫 Void';
    btn.className = 'cbtn gl-void-btn';
    btn.style.cssText = 'background:rgba(231,76,60,.12);border-color:rgba(231,76,60,.35);color:#e74c3c';
    btn.onclick = async function() {
      var reason = prompt('Reason for voiding this invoice:');
      if (reason === null) return;
      if (!reason.trim()) { notify('Please enter a void reason.', 'error'); return; }
      if (!confirm('Void invoice ' + invId + '? This cannot be undone.')) return;
      btn.disabled = true; btn.textContent = 'Voiding…';
      var { error } = await SB().from('invoices').update({
        status: 'voided', void_reason: reason.trim(), voided_at: new Date().toISOString()
      }).eq('invoice_number', invId);
      if (error) { notify('Error: ' + error.message, 'error'); btn.disabled = false; btn.innerHTML = '🚫 Void'; return; }
      if (inv) { inv.status = 'voided'; inv.void_reason = reason; inv.voided_at = new Date().toISOString(); }
      notify('Invoice voided.', 'success');
      detail.dataset.voidInjected = '';
      var badge = detail.querySelector('.inv-status-badge, [class*="status"]');
      if (badge) { badge.textContent = 'VOIDED'; badge.style.background = '#718096'; badge.style.color = '#fff'; }
      btn.remove();
    };
    btnRow.appendChild(btn);
  }

  // ── FEATURE 3: Quote Auto-Expiry (30 days) ────────────────
  var QUOTE_EXPIRY_DAYS = 30;
  function patchExpiredQuoteBadges() {
    var today = Date.now();
    document.querySelectorAll('[data-status="quote"], .status-quote').forEach(function(el) {
      var row = el.closest('[data-inv-id], tr, .inv-row');
      if (!row) return;
      var invId = row.dataset.invId || row.dataset.invoiceNumber;
      var inv = invId ? getInv(invId) : null;
      if (!inv || inv.status !== 'quote') return;
      var age = Math.floor((today - new Date(inv.date || inv.created_at)) / 86400000);
      if (age >= QUOTE_EXPIRY_DAYS && !el.dataset.expiredTagged) {
        el.dataset.expiredTagged = '1';
        el.textContent = '⏰ Expired Quote';
        el.style.background = '#c05621';
      }
    });
  }

  function injectQuoteExpiredBanner() {
    var detail = document.getElementById('inv-detail');
    if (!detail || !detail.classList.contains('show') || detail.dataset.expBannerInjected) return;
    var invId = window.currentInvId;
    var inv = invId ? getInv(invId) : null;
    if (!inv || inv.status !== 'quote') return;
    var age = Math.floor((Date.now() - new Date(inv.date || inv.created_at)) / 86400000);
    if (age < QUOTE_EXPIRY_DAYS) return;
    detail.dataset.expBannerInjected = '1';
    var banner = document.createElement('div');
    banner.style.cssText = 'background:rgba(245,200,66,.1);border:1px solid rgba(245,200,66,.35);border-radius:8px;padding:12px 16px;margin-bottom:16px;font-size:13px;color:#f5c842';
    banner.innerHTML = '⏰ <strong>This quote expired ' + age + ' days ago.</strong> Consider sending an updated quote or converting to an invoice.';
    detail.insertBefore(banner, detail.firstChild);
  }

  // ── FEATURE 4: Late Fee Prompt ────────────────────────────
  var LATE_FEE_RATE = 0.015;
  function injectLateFeePrompt() {
    var detail = document.getElementById('inv-detail');
    if (!detail || !detail.classList.contains('show') || detail.dataset.lateFeeBannerInjected) return;
    var invId = window.currentInvId;
    var inv = invId ? getInv(invId) : null;
    if (!inv || inv.status === 'paid' || inv.status === 'voided' || inv.is_credit_memo) return;
    var due = inv.due_date || inv.dueDate;
    if (!due) return;
    var overdueDays = Math.floor((Date.now() - new Date(due)) / 86400000);
    if (overdueDays < 1) return;
    detail.dataset.lateFeeBannerInjected = '1';
    var months = overdueDays / 30;
    var fee = (Number(inv.amount) || 0) * LATE_FEE_RATE * months;
    var banner = document.createElement('div');
    banner.style.cssText = 'background:rgba(231,76,60,.1);border:1px solid rgba(231,76,60,.35);border-radius:8px;padding:12px 16px;margin-bottom:16px;font-size:13px;color:#e74c3c;display:flex;align-items:center;gap:12px';
    banner.innerHTML = '<span>⚠️ <strong>' + overdueDays + ' days overdue.</strong> Suggested late fee (1.5%/mo): <strong>' + fmt$(fee) + '</strong></span>' +
      '<button id="gl-add-late-fee" class="cbtn" style="margin-left:auto;background:rgba(231,76,60,.15);border-color:rgba(231,76,60,.4);color:#e74c3c;white-space:nowrap">Add to Invoice</button>';
    detail.insertBefore(banner, detail.firstChild);
    document.getElementById('gl-add-late-fee').onclick = async function() {
      this.disabled = true; this.textContent = 'Adding…';
      var currentAmount = Number(inv.amount) || 0;
      var newAmount = currentAmount + fee;
      var lineItems = Array.isArray(inv.line_items) ? inv.line_items.slice() : [];
      lineItems.push({ desc: 'Late fee (' + overdueDays + ' days @ 1.5%/mo)', qty: 1, unitPrice: +fee.toFixed(2), total: +fee.toFixed(2), unit: '' });
      var { error } = await SB().from('invoices').update({ amount: +newAmount.toFixed(2), line_items: lineItems }).eq('invoice_number', invId);
      if (error) { notify('Error: ' + error.message, 'error'); this.disabled = false; this.textContent = 'Add to Invoice'; return; }
      inv.amount = +newAmount.toFixed(2);
      inv.line_items = lineItems;
      notify('Late fee ' + fmt$(fee) + ' added to invoice.', 'success');
      banner.remove();
    };
  }

  // ── FEATURE 5: Payment Receipt Email ─────────────────────
  window.glSendPaymentReceipt = async function(invId) {
    var inv = getInv(invId);
    if (!inv) { notify('Invoice not found.', 'error'); return; }
    var client = getClient(inv.client_id || inv.clientId);
    var email = client && (client.email || client.contact_email);
    if (!email) { notify('No client email on file.', 'warn'); return; }
    var subject = 'Payment received — Invoice ' + invId;
    var body = 'Hi ' + (client.name || client.company || 'there') + ',\n\nThank you! We\'ve received your payment of ' + fmt$(inv.amount) + ' for invoice ' + invId + '.\n\nThank you for your business.\n\nGood Liquid Bevco';
    var sent = false;
    if (typeof window.glSendEmail === 'function') {
      try { await window.glSendEmail({ to: email, subject: subject, body: body }); sent = true; } catch(e) {}
    }
    if (!sent && typeof window.glMailgunSend === 'function') {
      try { await window.glMailgunSend(email, subject, body); sent = true; } catch(e) {}
    }
    if (sent) notify('Receipt sent to ' + email, 'success');
    else notify('Could not send email — check email config.', 'error');
  };

  // ── FEATURE 6: Credit Limit Warning ───────────────────────
  function checkCreditLimit() {
    var builder = document.getElementById('gl-inv-builder');
    if (!builder) return;
    var clientSel = builder.querySelector('[name="client_id"], #inv-client, select[name="client"]');
    if (!clientSel) return;
    var clientId = clientSel.value;
    if (!clientId) return;
    var client = getClient(clientId);
    if (!client || !client.credit_limit) return;
    var outstanding = (window.invoices || []).filter(function(x){
      return (x.client_id === clientId || x.clientId === clientId) && (x.status === 'pending' || x.status === 'overdue');
    }).reduce(function(sum, x){ return sum + (Number(x.amount) || 0); }, 0);
    var limit = Number(client.credit_limit);
    if (outstanding >= limit * 0.8) {
      var existing = document.getElementById('gl-credit-limit-warn');
      if (!existing) {
        var w = document.createElement('div');
        w.id = 'gl-credit-limit-warn';
        w.style.cssText = 'background:#fffaf0;border:1px solid #f6ad55;border-radius:6px;padding:10px 14px;margin-bottom:12px;font-size:13px;color:#744210';
        w.innerHTML = '⚠️ <strong>Credit limit alert:</strong> ' + (client.name || 'This client') + ' has ' + fmt$(outstanding) + ' outstanding of ' + fmt$(limit) + ' limit (' + Math.round(outstanding/limit*100) + '%)';
        var body = document.getElementById('gl-inv-body') || builder.querySelector('form');
        if (body) body.insertBefore(w, body.firstChild);
      }
    }
  }

  // ── FEATURE 7: Statement of Account ───────────────────────
  window.glOpenStatement = async function(clientId) {
    var client = getClient(clientId);
    if (!client) { notify('Client not found.', 'error'); return; }
    var invs = (window.invoices || []).filter(function(x){ return x.client_id === clientId || x.clientId === clientId; });
    var totalBilled = invs.reduce(function(s,x){ return s + (Number(x.amount)||0); }, 0);
    var totalPaid = invs.filter(function(x){ return x.status==='paid' && !x.is_credit_memo; }).reduce(function(s,x){ return s + (Number(x.amount)||0); }, 0);
    var totalCredit = invs.filter(function(x){ return x.is_credit_memo; }).reduce(function(s,x){ return s + Math.abs(Number(x.amount)||0); }, 0);
    var balance = totalBilled - totalPaid - totalCredit;
    var rows = invs.map(function(x){
      return '<tr><td style="padding:6px 8px">' + esc(x.invoice_number) + '</td><td style="padding:6px 8px">' + esc(x.date||'') + '</td>' +
        '<td style="padding:6px 8px">' + esc(x.due_date||x.dueDate||'') + '</td>' +
        '<td style="padding:6px 8px;text-transform:capitalize">' + esc(x.status||'') + (x.is_credit_memo?' (CM)':'') + '</td>' +
        '<td style="padding:6px 8px;text-align:right">' + fmt$(x.amount) + '</td></tr>';
    }).join('');
    var summaryItems = ['Total Billed|'+fmt$(totalBilled),'Total Paid|'+fmt$(totalPaid),'Credits|'+fmt$(totalCredit),'Balance Due|'+fmt$(balance)];
    var html = '<p style="margin:0 0 12px;color:#4a5568">Account: <strong>' + esc(client.name||client.company||clientId) + '</strong> — as of ' + new Date().toLocaleDateString() + '</p>' +
      '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px">' +
      summaryItems.map(function(p){
        var parts = p.split('|');
        return '<div style="background:#f7fafc;border-radius:6px;padding:10px;text-align:center"><div style="font-size:11px;color:#718096">' + parts[0] + '</div><div style="font-size:18px;font-weight:700;color:#2d3748">' + parts[1] + '</div></div>';
      }).join('') + '</div>' +
      '<table style="width:100%;border-collapse:collapse;font-size:13px">' +
      '<thead><tr style="background:#edf2f7">' +
      ['Invoice #','Date','Due Date','Status','Amount'].map(function(h){ return '<th style="padding:6px 8px;text-align:left;font-weight:600">' + h + '</th>'; }).join('') +
      '</tr></thead><tbody>' +
      (rows || '<tr><td colspan="5" style="padding:12px;text-align:center;color:#a0aec0">No invoices</td></tr>') +
      '</tbody></table>' +
      '<div style="margin-top:16px;text-align:right"><button onclick="window.print()" style="padding:8px 18px;background:#3182ce;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px">🖨️ Print Statement</button></div>';
    openModal('gl-statement-modal', 'Statement of Account', html);
  };

  function injectStmtBtn() {
    var ov = document.getElementById('client-detail-overlay');
    if (!ov || ov.dataset.stmtBtn) return;
    ov.dataset.stmtBtn = '1';
    var editBtn = ov.querySelector('button[onclick*="glOpenEditClient"]');
    if (!editBtn) return;
    var match = editBtn.getAttribute('onclick').match(/glOpenEditClient\('([^']+)'\)/);
    if (!match) return;
    var clientId = match[1];
    var btnRow = ov.querySelector('div[style*="flex-wrap:wrap"], div[style*="flex-wrap: wrap"]');
    if (!btnRow) return;
    var btn = document.createElement('button');
    btn.className = 'cbtn';
    btn.innerHTML = '📄 Statement';
    btn.onclick = function(){ window.glOpenStatement(clientId); };
    btnRow.appendChild(btn);
  }

  // ── FEATURE 8: Revenue by Client chart ────────────────────
  window.glOpenRevenueByClient = function() {
    var paid = (window.invoices || []).filter(function(x){ return x.status === 'paid' && !x.is_credit_memo; });
    var map = {};
    paid.forEach(function(x){
      var cid = x.client_id || x.clientId || 'Unknown';
      var client = getClient(cid);
      var name = (client && (client.name || client.company)) || cid;
      map[name] = (map[name] || 0) + (Number(x.amount) || 0);
    });
    var sorted = Object.keys(map).map(function(k){ return { name: k, amt: map[k] }; })
      .sort(function(a,b){ return b.amt - a.amt; }).slice(0, 12);
    if (!sorted.length) { notify('No paid invoices found.', 'warn'); return; }
    var maxAmt = sorted[0].amt;
    var bars = sorted.map(function(d){
      var pct = Math.round(d.amt / maxAmt * 100);
      return '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">' +
        '<div style="width:140px;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:right" title="' + esc(d.name) + '">' + esc(d.name) + '</div>' +
        '<div style="flex:1;background:#ebf8ff;border-radius:4px;overflow:hidden">' +
        '<div style="width:' + pct + '%;background:#3182ce;height:24px;border-radius:4px;transition:width .4s"></div></div>' +
        '<div style="width:80px;font-size:12px;font-weight:600;color:#2d3748">' + fmt$(d.amt) + '</div></div>';
    }).join('');
    openModal('gl-revenue-modal', 'Revenue by Client (Paid Invoices)', '<div style="padding:4px 0">' + bars + '</div>');
  };

  // ── FEATURE 9: Cash Flow Forecast ─────────────────────────
  window.glOpenCashFlow = function() {
    var pending = (window.invoices || []).filter(function(x){ return (x.status === 'pending' || x.status === 'overdue') && !x.is_credit_memo; });
    var map = {};
    pending.forEach(function(x){
      var due = x.due_date || x.dueDate;
      var key = due ? due.slice(0,7) : 'Unknown';
      map[key] = (map[key] || 0) + (Number(x.amount) || 0);
    });
    var keys = Object.keys(map).sort();
    if (!keys.length) { notify('No pending invoices.', 'warn'); return; }
    var maxAmt = Math.max.apply(null, keys.map(function(k){ return map[k]; }));
    var bars = keys.map(function(k){
      var pct = Math.round(map[k] / maxAmt * 100);
      var label = k === 'Unknown' ? 'No due date' : new Date(k + '-01').toLocaleDateString('en-US',{month:'short',year:'numeric'});
      return '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">' +
        '<div style="width:100px;font-size:12px;text-align:right">' + esc(label) + '</div>' +
        '<div style="flex:1;background:#f0fff4;border-radius:4px;overflow:hidden">' +
        '<div style="width:' + pct + '%;background:#38a169;height:24px;border-radius:4px"></div></div>' +
        '<div style="width:80px;font-size:12px;font-weight:600;color:#2d3748">' + fmt$(map[k]) + '</div></div>';
    }).join('');
    openModal('gl-cashflow-modal', 'Cash Flow Forecast (Pending + Overdue)', '<p style="margin:0 0 14px;color:#718096;font-size:13px">Grouped by due date month</p>' + bars);
  };

  // ── FEATURE 10: Partial Payments ──────────────────────────
  window.glRecordPayment = async function(invId) {
    if (!invId) invId = window.currentInvId;
    var inv = getInv(invId);
    if (!inv) { notify('Invoice not found.', 'error'); return; }
    var { data: payments, error } = await SB().from('invoice_payments').select('*').eq('invoice_number', invId).order('paid_at');
    if (error) { notify('Error loading payments: ' + error.message, 'error'); return; }
    payments = payments || [];
    var totalPaid = payments.reduce(function(s,p){ return s + Number(p.amount); }, 0);
    var remaining = (Number(inv.amount) || 0) - totalPaid;
    var pmtRows = payments.map(function(p){
      return '<tr><td style="padding:6px 8px">' + esc(p.paid_at) + '</td><td style="padding:6px 8px">' + esc(p.method) + '</td>' +
        '<td style="padding:6px 8px">' + esc(p.reference||'') + '</td><td style="padding:6px 8px;text-align:right;font-weight:600">' + fmt$(p.amount) + '</td></tr>';
    }).join('') || '<tr><td colspan="4" style="padding:10px;text-align:center;color:#a0aec0">No payments recorded</td></tr>';
    var newPmtForm = remaining > 0.01 ? (
      '<div style="background:#f7fafc;border-radius:8px;padding:16px">' +
      '<h4 style="margin:0 0 12px;font-size:15px">Record New Payment</h4>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">' +
      '<div><label style="display:block;font-size:12px;color:#718096;margin-bottom:4px">Amount</label>' +
      '<input id="gl-pmt-amount" type="number" step="0.01" min="0.01" max="' + remaining.toFixed(2) + '" value="' + remaining.toFixed(2) + '" style="width:100%;padding:7px 10px;border:1px solid #e2e8f0;border-radius:5px"></div>' +
      '<div><label style="display:block;font-size:12px;color:#718096;margin-bottom:4px">Method</label>' +
      '<select id="gl-pmt-method" style="width:100%;padding:7px 10px;border:1px solid #e2e8f0;border-radius:5px">' +
      '<option>Check</option><option>Wire transfer</option><option>ACH</option><option>Cash</option><option>Stripe</option><option>Other</option></select></div>' +
      '</div>' +
      '<div style="margin-bottom:10px"><label style="display:block;font-size:12px;color:#718096;margin-bottom:4px">Reference / Check # (optional)</label>' +
      '<input id="gl-pmt-ref" type="text" style="width:100%;padding:7px 10px;border:1px solid #e2e8f0;border-radius:5px"></div>' +
      '<button id="gl-pmt-save" style="padding:8px 18px;background:#3182ce;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px;font-weight:600">Save Payment</button></div>'
    ) : '<div style="text-align:center;color:#38a169;font-weight:600;padding:12px">✅ Fully Paid</div>';
    var html = '<div style="display:flex;gap:12px;margin-bottom:16px">' +
      '<div style="flex:1;background:#f7fafc;border-radius:6px;padding:10px;text-align:center"><div style="font-size:11px;color:#718096">Invoice Total</div><div style="font-size:18px;font-weight:700">' + fmt$(inv.amount) + '</div></div>' +
      '<div style="flex:1;background:#f0fff4;border-radius:6px;padding:10px;text-align:center"><div style="font-size:11px;color:#718096">Paid</div><div style="font-size:18px;font-weight:700;color:#38a169">' + fmt$(totalPaid) + '</div></div>' +
      '<div style="flex:1;background:' + (remaining > 0.01 ? '#fff5f5' : '#f0fff4') + ';border-radius:6px;padding:10px;text-align:center"><div style="font-size:11px;color:#718096">Remaining</div><div style="font-size:18px;font-weight:700;color:' + (remaining > 0.01 ? '#e53e3e' : '#38a169') + '">' + fmt$(remaining) + '</div></div>' +
      '</div>' +
      '<table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px">' +
      '<thead><tr style="background:#edf2f7"><th style="padding:6px 8px;text-align:left">Date</th><th style="padding:6px 8px;text-align:left">Method</th><th style="padding:6px 8px;text-align:left">Reference</th><th style="padding:6px 8px;text-align:right">Amount</th></tr></thead>' +
      '<tbody>' + pmtRows + '</tbody></table>' + newPmtForm;
    var modal = openModal('gl-payment-modal', 'Record Payment — ' + invId, html);
    var saveBtn = document.getElementById('gl-pmt-save');
    if (saveBtn) {
      saveBtn.onclick = async function() {
        var amt = parseFloat(document.getElementById('gl-pmt-amount').value);
        var method = document.getElementById('gl-pmt-method').value;
        var ref = document.getElementById('gl-pmt-ref').value.trim();
        if (!amt || amt <= 0) { notify('Enter a valid amount.', 'error'); return; }
        saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
        var { data: pmt, error: pErr } = await SB().from('invoice_payments')
          .insert({ invoice_number: invId, amount: amt, method: method, reference: ref || null, paid_at: todayStr() })
          .select().single();
        if (pErr) { notify('Error: ' + pErr.message, 'error'); saveBtn.disabled = false; saveBtn.textContent = 'Save Payment'; return; }
        payments.push(pmt);
        totalPaid += amt;
        remaining -= amt;
        notify('Payment of ' + fmt$(amt) + ' recorded.', 'success');
        if (remaining <= 0.01) {
          await SB().from('invoices').update({ status: 'paid' }).eq('invoice_number', invId);
          if (inv) inv.status = 'paid';
          modal.remove();
          if (confirm('Invoice fully paid! Send payment receipt to client?')) window.glSendPaymentReceipt(invId);
          return;
        }
        modal.remove();
        window.glRecordPayment(invId);
      };
    }
  };

  function injectPartialPayBtn() {
    var detail = document.getElementById('inv-detail');
    if (!detail || !detail.classList.contains('show') || detail.dataset.payBtnInjected) return;
    detail.dataset.payBtnInjected = '1';
    var inv = window.currentInvId ? getInv(window.currentInvId) : null;
    if (!inv || inv.status === 'voided' || inv.is_credit_memo) return;
    var btnRow = detail.querySelector('div[style*="display:flex"]');
    if (!btnRow || btnRow.querySelector('.gl-pay-btn')) return;
    var btn = document.createElement('button');
    btn.innerHTML = '💵 Record Payment';
    btn.className = 'cbtn gl-pay-btn';
    btn.style.cssText = 'background:rgba(95,207,158,.12);border-color:rgba(95,207,158,.35);color:#5fcf9e';
    btn.onclick = function(){ window.glRecordPayment(window.currentInvId); };
    btnRow.appendChild(btn);
  }

  // ── FEATURE 11: Multi-Step Collections ────────────────────
  var COLLECTION_STEPS = [
    { delay: 3,  label: 'Gentle reminder', tone: 'gentle' },
    { delay: 14, label: 'Firm reminder',   tone: 'firm' },
    { delay: 30, label: 'Urgent notice',   tone: 'urgent' },
    { delay: 45, label: 'Final notice',    tone: 'final' }
  ];

  window.glSetupCollections = async function(invId) {
    if (!invId) invId = window.currentInvId;
    var inv = getInv(invId);
    if (!inv) { notify('Invoice not found.', 'error'); return; }
    var client = getClient(inv.client_id || inv.clientId);
    var email = client && (client.email || client.contact_email);
    var stepRows = COLLECTION_STEPS.map(function(s){
      var d = new Date(); d.setDate(d.getDate() + s.delay);
      return '<tr><td style="padding:6px 8px">' + esc(s.label) + '</td><td style="padding:6px 8px">' + d.toLocaleDateString() + '</td><td style="padding:6px 8px;text-transform:capitalize">' + esc(s.tone) + '</td></tr>';
    }).join('');
    var html = '<p style="margin:0 0 14px;color:#4a5568">This will schedule a 4-step email sequence for <strong>' + esc(invId) + '</strong>:</p>' +
      '<table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px">' +
      '<thead><tr style="background:#edf2f7"><th style="padding:6px 8px;text-align:left">Step</th><th style="padding:6px 8px;text-align:left">Send Date</th><th style="padding:6px 8px;text-align:left">Type</th></tr></thead>' +
      '<tbody>' + stepRows + '</tbody></table>' +
      (email ? '<p style="color:#718096;font-size:13px">Emails will be sent to: <strong>' + esc(email) + '</strong></p>' :
               '<p style="color:#e53e3e;font-size:13px">⚠️ No email on file for this client.</p>') +
      '<button id="gl-coll-confirm" style="padding:8px 18px;background:#e53e3e;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px;font-weight:600">Schedule Collection Sequence</button>';
    var modal = openModal('gl-collections-modal', 'Collections Sequence — ' + invId, html);
    document.getElementById('gl-coll-confirm').onclick = async function() {
      this.disabled = true; this.textContent = 'Scheduling…';
      var rows = COLLECTION_STEPS.map(function(s){
        var d = new Date(); d.setDate(d.getDate() + s.delay);
        return { invoice_number: invId, client_id: inv.client_id || inv.clientId, scheduled_date: d.toISOString().slice(0,10), email_type: 'collection_' + s.tone, status: 'pending' };
      });
      var { error } = await SB().from('email_schedule').insert(rows);
      if (error && error.code !== '42P01') {
        notify('Error scheduling: ' + error.message, 'error');
        this.disabled = false; this.textContent = 'Schedule Collection Sequence';
        return;
      }
      if (error && error.code === '42P01') notify('email_schedule table not found — run the SQL migration first.', 'warn');
      else notify('4-step collection sequence scheduled for ' + invId, 'success');
      modal.remove();
    };
  };

  function injectCollectBtn() {
    var detail = document.getElementById('inv-detail');
    if (!detail || !detail.classList.contains('show') || detail.dataset.collectBtnInjected) return;
    detail.dataset.collectBtnInjected = '1';
    var inv = window.currentInvId ? getInv(window.currentInvId) : null;
    if (!inv || inv.status === 'paid' || inv.status === 'voided' || inv.is_credit_memo) return;
    var due = inv.due_date || inv.dueDate;
    if (!due || new Date(due) > new Date()) return;
    var btnRow = detail.querySelector('div[style*="display:flex"]');
    if (!btnRow || btnRow.querySelector('.gl-collect-btn')) return;
    var btn = document.createElement('button');
    btn.innerHTML = '📋 Collect';
    btn.className = 'cbtn gl-collect-btn';
    btn.style.cssText = 'background:rgba(245,200,66,.12);border-color:rgba(245,200,66,.35);color:#f5c842';
    btn.onclick = function(){ window.glSetupCollections(window.currentInvId); };
    btnRow.appendChild(btn);
  }

  // ── FEATURE 12: Recurring Invoices ────────────────────────
  window.glOpenRecurring = async function() {
    var { data: templates } = await SB().from('recurring_invoices').select('*').order('created_at', { ascending: false });
    templates = templates || [];
    var clientOpts = (window.clients || []).map(function(c){
      return '<option value="' + esc(c.id||c.client_id||'') + '">' + esc(c.name||c.company||c.id) + '</option>';
    }).join('');
    var tRows = templates.map(function(t){
      var client = getClient(t.client_id);
      var statusColor = t.status==='active' ? '#c6f6d5' : t.status==='paused' ? '#fefcbf' : '#fed7d7';
      return '<tr><td style="padding:6px 8px">' + esc((client&&(client.name||client.company))||t.client_id) + '</td>' +
        '<td style="padding:6px 8px">' + esc(t.description) + '</td>' +
        '<td style="padding:6px 8px">' + fmt$(t.amount) + '</td>' +
        '<td style="padding:6px 8px;text-transform:capitalize">' + esc(t.frequency) + '</td>' +
        '<td style="padding:6px 8px">' + esc(t.next_run||'') + '</td>' +
        '<td style="padding:6px 8px"><span style="padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;background:' + statusColor + '">' + esc(t.status) + '</span></td>' +
        '<td style="padding:6px 8px"><button onclick="window.glPauseRecurring(\'' + esc(t.id) + '\',\'' + esc(t.status) + '\')" style="font-size:11px;padding:2px 8px;border-radius:4px;border:1px solid #718096;background:#fff;cursor:pointer">' + (t.status==='active'?'Pause':'Resume') + '</button></td></tr>';
    }).join('') || '<tr><td colspan="7" style="padding:12px;text-align:center;color:#a0aec0">No templates yet</td></tr>';
    var html = '<table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px">' +
      '<thead><tr style="background:#edf2f7"><th style="padding:6px 8px;text-align:left">Client</th><th style="padding:6px 8px;text-align:left">Description</th>' +
      '<th style="padding:6px 8px;text-align:left">Amount</th><th style="padding:6px 8px;text-align:left">Frequency</th>' +
      '<th style="padding:6px 8px;text-align:left">Next Run</th><th style="padding:6px 8px;text-align:left">Status</th><th style="padding:6px 8px"></th></tr></thead>' +
      '<tbody>' + tRows + '</tbody></table>' +
      '<div style="background:#f7fafc;border-radius:8px;padding:16px"><h4 style="margin:0 0 12px;font-size:15px">New Template</h4>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">' +
      '<div><label style="display:block;font-size:12px;color:#718096;margin-bottom:4px">Client</label><select id="gl-rec-client" style="width:100%;padding:7px 10px;border:1px solid #e2e8f0;border-radius:5px"><option value="">Select client…</option>' + clientOpts + '</select></div>' +
      '<div><label style="display:block;font-size:12px;color:#718096;margin-bottom:4px">Amount</label><input id="gl-rec-amount" type="number" step="0.01" min="0.01" placeholder="0.00" style="width:100%;padding:7px 10px;border:1px solid #e2e8f0;border-radius:5px"></div>' +
      '</div><div style="margin-bottom:10px"><label style="display:block;font-size:12px;color:#718096;margin-bottom:4px">Description</label>' +
      '<input id="gl-rec-desc" type="text" placeholder="e.g. Monthly retainer" style="width:100%;padding:7px 10px;border:1px solid #e2e8f0;border-radius:5px"></div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:12px">' +
      '<div><label style="display:block;font-size:12px;color:#718096;margin-bottom:4px">Frequency</label><select id="gl-rec-freq" style="width:100%;padding:7px 10px;border:1px solid #e2e8f0;border-radius:5px"><option>monthly</option><option>weekly</option><option>quarterly</option><option>annually</option></select></div>' +
      '<div><label style="display:block;font-size:12px;color:#718096;margin-bottom:4px">Start Date</label><input id="gl-rec-start" type="date" value="' + todayStr() + '" style="width:100%;padding:7px 10px;border:1px solid #e2e8f0;border-radius:5px"></div>' +
      '<div><label style="display:block;font-size:12px;color:#718096;margin-bottom:4px">End Date (opt.)</label><input id="gl-rec-end" type="date" style="width:100%;padding:7px 10px;border:1px solid #e2e8f0;border-radius:5px"></div>' +
      '</div><button id="gl-rec-save" style="padding:8px 18px;background:#38a169;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px;font-weight:600">Save Template</button></div>';
    var modal = openModal('gl-recurring-modal', '🔄 Recurring Invoices', html);
    document.getElementById('gl-rec-save').onclick = async function() {
      var clientId = document.getElementById('gl-rec-client').value;
      var desc = document.getElementById('gl-rec-desc').value.trim();
      var amount = parseFloat(document.getElementById('gl-rec-amount').value);
      var freq = document.getElementById('gl-rec-freq').value;
      var start = document.getElementById('gl-rec-start').value;
      var end = document.getElementById('gl-rec-end').value;
      if (!clientId || !desc || !amount || !start) { notify('Fill in all required fields.', 'error'); return; }
      this.disabled = true; this.textContent = 'Saving…';
      var { error } = await SB().from('recurring_invoices').insert({ client_id: clientId, description: desc, amount: amount, frequency: freq, start_date: start, end_date: end || null, next_run: start, status: 'active' });
      if (error) { notify('Error: ' + error.message, 'error'); this.disabled = false; this.textContent = 'Save Template'; return; }
      notify('Recurring template saved.', 'success');
      modal.remove(); window.glOpenRecurring();
    };
  };

  window.glPauseRecurring = async function(id, currentStatus) {
    var newStatus = currentStatus === 'active' ? 'paused' : 'active';
    var { error } = await SB().from('recurring_invoices').update({ status: newStatus }).eq('id', id);
    if (error) { notify('Error: ' + error.message, 'error'); return; }
    notify('Template ' + newStatus + '.', 'success');
    window.glOpenRecurring();
  };

  // ── FEATURE 13: Credit Memos ──────────────────────────────
  window.glOpenCreditMemo = function() {
    var clientOpts = (window.clients || []).map(function(c){
      return '<option value="' + esc(c.id||c.client_id||'') + '">' + esc(c.name||c.company||c.id) + '</option>';
    }).join('');
    var html = '<p style="margin:0 0 14px;color:#4a5568;font-size:14px">A credit memo reduces a client\'s balance. It will be recorded as a paid invoice with a negative amount.</p>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">' +
      '<div><label style="display:block;font-size:12px;color:#718096;margin-bottom:4px">Client</label><select id="gl-cm-client" style="width:100%;padding:7px 10px;border:1px solid #e2e8f0;border-radius:5px"><option value="">Select client…</option>' + clientOpts + '</select></div>' +
      '<div><label style="display:block;font-size:12px;color:#718096;margin-bottom:4px">Amount (credit)</label><input id="gl-cm-amount" type="number" step="0.01" min="0.01" placeholder="0.00" style="width:100%;padding:7px 10px;border:1px solid #e2e8f0;border-radius:5px"></div>' +
      '</div><div style="margin-bottom:10px"><label style="display:block;font-size:12px;color:#718096;margin-bottom:4px">Reason</label>' +
      '<input id="gl-cm-reason" type="text" placeholder="e.g. Return, discount, overcharge correction" style="width:100%;padding:7px 10px;border:1px solid #e2e8f0;border-radius:5px"></div>' +
      '<div style="margin-bottom:14px"><label style="display:block;font-size:12px;color:#718096;margin-bottom:4px">Date</label><input id="gl-cm-date" type="date" value="' + todayStr() + '" style="width:160px;padding:7px 10px;border:1px solid #e2e8f0;border-radius:5px"></div>' +
      '<button id="gl-cm-save" style="padding:8px 18px;background:#805ad5;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px;font-weight:600">Issue Credit Memo</button>';
    var modal = openModal('gl-cm-modal', '📝 Issue Credit Memo', html);
    document.getElementById('gl-cm-save').onclick = async function() {
      var clientId = document.getElementById('gl-cm-client').value;
      var amount = parseFloat(document.getElementById('gl-cm-amount').value);
      var reason = document.getElementById('gl-cm-reason').value.trim();
      var date = document.getElementById('gl-cm-date').value;
      if (!clientId || !amount || !reason || !date) { notify('Fill in all fields.', 'error'); return; }
      this.disabled = true; this.textContent = 'Creating…';
      var year = new Date().getFullYear();
      var { data: existing } = await SB().from('invoices').select('invoice_number').like('invoice_number', 'CM-' + year + '-%').order('invoice_number', { ascending: false }).limit(1);
      var seq = 1;
      if (existing && existing.length) { seq = (parseInt(existing[0].invoice_number.split('-')[2], 10) || 0) + 1; }
      var invNum = 'CM-' + year + '-' + String(seq).padStart(4, '0');
      var { error } = await SB().from('invoices').insert({
        invoice_number: invNum, client_id: clientId, amount: -amount, status: 'paid',
        is_credit_memo: true, date: date, due_date: date, payment_terms: 'Credit Memo',
        notes: reason, line_items: [{ desc: reason, qty: 1, unitPrice: -amount, total: -amount, unit: '' }]
      });
      if (error) { notify('Error: ' + error.message, 'error'); this.disabled = false; this.textContent = 'Issue Credit Memo'; return; }
      notify('Credit memo ' + invNum + ' issued for ' + fmt$(amount), 'success');
      modal.remove();
    };
  };

  // ── FEATURE 14: Expense Tracking ─────────────────────────
  window.glOpenExpenses = async function() {
    var { data: expenses } = await SB().from('expenses').select('*').order('expense_date', { ascending: false }).limit(50);
    expenses = expenses || [];
    var thisMonth = todayStr().slice(0,7);
    var monthTotal = expenses.filter(function(e){ return (e.expense_date||'').slice(0,7) === thisMonth; }).reduce(function(s,e){ return s + Number(e.amount); }, 0);
    var clientOpts = '<option value="">No client</option>' + (window.clients || []).map(function(c){
      return '<option value="' + esc(c.id||c.client_id||'') + '">' + esc(c.name||c.company||c.id) + '</option>';
    }).join('');
    var categories = ['Ingredients','Packaging','Equipment','Labor','Shipping','Marketing','Office','Travel','Utilities','Other'];
    var catOpts = categories.map(function(c){ return '<option>' + c + '</option>'; }).join('');
    var eRows = expenses.map(function(e){
      return '<tr><td style="padding:5px 8px">' + esc(e.expense_date||'') + '</td><td style="padding:5px 8px">' + esc(e.vendor) + '</td>' +
        '<td style="padding:5px 8px">' + esc(e.category) + '</td><td style="padding:5px 8px">' + esc(e.notes||'') + '</td>' +
        '<td style="padding:5px 8px;text-align:right;font-weight:600">' + fmt$(e.amount) + '</td></tr>';
    }).join('') || '<tr><td colspan="5" style="padding:12px;text-align:center;color:#a0aec0">No expenses yet</td></tr>';
    var html = '<div style="display:flex;align-items:center;gap:16px;margin-bottom:16px;background:#f7fafc;border-radius:8px;padding:12px 16px">' +
      '<div><div style="font-size:11px;color:#718096">This Month</div><div style="font-size:22px;font-weight:700;color:#e53e3e">' + fmt$(monthTotal) + '</div></div>' +
      '<div style="margin-left:auto;font-size:13px;color:#718096">' + expenses.length + ' expenses tracked</div></div>' +
      '<table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px">' +
      '<thead><tr style="background:#edf2f7"><th style="padding:5px 8px;text-align:left">Date</th><th style="padding:5px 8px;text-align:left">Vendor</th><th style="padding:5px 8px;text-align:left">Category</th><th style="padding:5px 8px;text-align:left">Notes</th><th style="padding:5px 8px;text-align:right">Amount</th></tr></thead>' +
      '<tbody>' + eRows + '</tbody></table>' +
      '<div style="background:#f7fafc;border-radius:8px;padding:16px"><h4 style="margin:0 0 12px;font-size:15px">Add Expense</h4>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:10px">' +
      '<div><label style="display:block;font-size:12px;color:#718096;margin-bottom:4px">Vendor</label><input id="gl-exp-vendor" type="text" placeholder="Vendor name" style="width:100%;padding:7px 10px;border:1px solid #e2e8f0;border-radius:5px"></div>' +
      '<div><label style="display:block;font-size:12px;color:#718096;margin-bottom:4px">Amount</label><input id="gl-exp-amount" type="number" step="0.01" min="0.01" placeholder="0.00" style="width:100%;padding:7px 10px;border:1px solid #e2e8f0;border-radius:5px"></div>' +
      '<div><label style="display:block;font-size:12px;color:#718096;margin-bottom:4px">Category</label><select id="gl-exp-cat" style="width:100%;padding:7px 10px;border:1px solid #e2e8f0;border-radius:5px">' + catOpts + '</select></div>' +
      '</div><div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">' +
      '<div><label style="display:block;font-size:12px;color:#718096;margin-bottom:4px">Date</label><input id="gl-exp-date" type="date" value="' + todayStr() + '" style="width:100%;padding:7px 10px;border:1px solid #e2e8f0;border-radius:5px"></div>' +
      '<div><label style="display:block;font-size:12px;color:#718096;margin-bottom:4px">Client (opt.)</label><select id="gl-exp-client" style="width:100%;padding:7px 10px;border:1px solid #e2e8f0;border-radius:5px">' + clientOpts + '</select></div>' +
      '</div><div style="margin-bottom:12px"><label style="display:block;font-size:12px;color:#718096;margin-bottom:4px">Notes</label>' +
      '<input id="gl-exp-notes" type="text" placeholder="Optional notes" style="width:100%;padding:7px 10px;border:1px solid #e2e8f0;border-radius:5px"></div>' +
      '<button id="gl-exp-save" style="padding:8px 18px;background:#e53e3e;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px;font-weight:600">Save Expense</button></div>';
    var modal = openModal('gl-expenses-modal', '💸 Expense Tracker', html);
    document.getElementById('gl-exp-save').onclick = async function() {
      var vendor = document.getElementById('gl-exp-vendor').value.trim();
      var amount = parseFloat(document.getElementById('gl-exp-amount').value);
      var cat = document.getElementById('gl-exp-cat').value;
      var date = document.getElementById('gl-exp-date').value;
      var clientId = document.getElementById('gl-exp-client').value;
      var notes = document.getElementById('gl-exp-notes').value.trim();
      if (!vendor || !amount || !date) { notify('Fill in vendor, amount, and date.', 'error'); return; }
      this.disabled = true; this.textContent = 'Saving…';
      var { error } = await SB().from('expenses').insert({ vendor: vendor, amount: amount, category: cat, expense_date: date, client_id: clientId || null, notes: notes || null });
      if (error) { notify('Error: ' + error.message, 'error'); this.disabled = false; this.textContent = 'Save Expense'; return; }
      notify('Expense saved.', 'success');
      modal.remove(); window.glOpenExpenses();
    };
  };

  // ── Invoices page accounting toolbar ─────────────────────
  function injectInvAcctBtns() {
    var invPage = document.getElementById('cpg-invoices');
    if (!invPage || document.getElementById('gl-acct-toolbar')) return;
    var cph = invPage.querySelector('.cph');
    if (!cph) return;
    var wrap = document.createElement('div');
    wrap.id = 'gl-acct-toolbar';
    wrap.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px';
    var btns = [
      ['💰 Revenue by Client', function(){ window.glOpenRevenueByClient(); }],
      ['📈 Cash Flow',          function(){ window.glOpenCashFlow(); }],
      ['🔄 Recurring',           function(){ window.glOpenRecurring(); }],
      ['📝 Credit Memo',         function(){ window.glOpenCreditMemo(); }],
      ['💸 Expenses',            function(){ window.glOpenExpenses(); }]
    ];
    btns.forEach(function(pair){
      var btn = document.createElement('button');
      btn.textContent = pair[0];
      btn.className = 'cbtn';
      btn.onclick = pair[1];
      wrap.appendChild(btn);
    });
    cph.insertAdjacentElement('afterend', wrap);
  }

  // ── Bootstrap: MutationObserver ───────────────────────────
  function resetDetailDatasets() {
    // When the invoice detail closes, clear injector flags so they
    // re-run on the next invoice opened.
    var detail = document.getElementById('inv-detail');
    if (detail && !detail.classList.contains('show')) {
      delete detail.dataset.voidInjected;
      delete detail.dataset.payBtnInjected;
      delete detail.dataset.collectBtnInjected;
      delete detail.dataset.expBannerInjected;
      delete detail.dataset.lateFeeBannerInjected;
    }
  }

  function runInjectors() {
    resetDetailDatasets();
    injectInvAcctBtns();
    injectVoidButton();
    injectPartialPayBtn();
    injectCollectBtn();
    injectQuoteExpiredBanner();
    injectLateFeePrompt();
    injectPOField();
    patchExpiredQuoteBadges();
    injectStmtBtn();
    checkCreditLimit();
  }

  var _acctObs = new MutationObserver(function(){ setTimeout(runInjectors, 300); });
  _acctObs.observe(document.getElementById('crm-panel') || document.body, { childList: true, subtree: true });
  setTimeout(runInjectors, 800);

  console.log('[GL] Accounting enhancements v1.0 — 14 features loaded');
}());
