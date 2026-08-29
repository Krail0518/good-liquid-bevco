/*
 * ai-insights.js — extracted from crm-index-core.js (GL-037).
 *
 * VERBATIM move: the code below is byte-for-byte what was in the core, so
 * this diff is a relocation and nothing else.
 *
 * Loads AFTER crm-index-core.js and must stay a CLASSIC script — no defer,
 * async or type="module". Its top-level declarations become window
 * properties, which is how the inline on* handlers in index.html resolve
 * them. A module-scoped version would leave those handlers dead with no
 * error to show for it.
 *
 * Declares: aiGenerateInsights
 */
/* ── AI BUSINESS INSIGHTS ────────────────────────────────────────
   The A/R aging report that used to sit under this banner moved out in
   GL-037; see the manifest at the top of this file for where. This note
   still named the old path, src/modules/ar-aging.js, after the file was
   relocated into src/modules/invoicing/ — which is exactly why the
   manifest replaced per-section pointers. */


async function aiGenerateInsights() {
  showAIModal('Business Insights', '', true);
  const totalPaid = invoices.filter(i=>i.status==='paid').reduce((s,i)=>s+i.amount,0);
  const totalOverdue = invoices.filter(i=>i.status==='overdue').reduce((s,i)=>s+i.amount,0);
  const pipelineVal = Object.values(deals).flat().reduce((s,d)=>s+parseInt((d.val||'$0').replace(/[$,]/g,'')),0);
  const text = await callAI(
    'You are a business analyst for Good Liquid Bev Co, a beverage co-packer. Provide actionable business insights.',
    `Analyze this business data and provide insights:
    Total Revenue Collected: $${totalPaid.toLocaleString()}
    Overdue Amount: $${totalOverdue.toLocaleString()}
    Pipeline Value: $${pipelineVal.toLocaleString()}
    Active Clients: ${clients.filter(c=>c.status==='active').length}
    Total Invoices: ${invoices.length}
    
    Provide: Business health assessment, Top 3 opportunities, Top 3 risks, Recommended actions for next 30 days.`
  );
  document.getElementById('ai-modal-body').textContent = text;
}

// addAIToolbar is defined and fully managed in fix.js

// ─── PATCH CLIENT ROW CLICK TO OPEN DETAIL ───
/* renderClients override removed — click handlers added inline */

/* viewInvoice override removed - handled in viewInvoice directly */

/* initCRM override removed */
