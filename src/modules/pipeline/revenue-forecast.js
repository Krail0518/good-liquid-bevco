/*
 * revenue-forecast.js — extracted from crm-index-core.js (GL-037).
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
 * Declares: aiGenerateForecast
 */
/* ═══════════════════════════════════════════
   AI REVENUE FORECASTING
═══════════════════════════════════════════ */
async function aiGenerateForecast(){
  showAIModal('Revenue Forecast','',true);
  // GL-126: the forecast is only as good as its inputs — a part-paid invoice
  // contributes its received portion to collected and its balance to pending,
  // rather than being counted whole on one side or dropped from both.
  const paid=invoices.filter(i=>effectiveInvoiceStatus(i)==='paid'   ).reduce((a,i)=>a+(Number(i.amount)||0),0)
            +invoices.filter(i=>effectiveInvoiceStatus(i)==='partial').reduce((a,i)=>a+(Number(i.paidAmount)||0),0);
  const pend=invoices.filter(i=>{const e=effectiveInvoiceStatus(i);return e==='pending'||e==='partial';})
                     .reduce((a,i)=>a+(window.glInvoiceBalance?window.glInvoiceBalance(i):(Number(i.amount)||0)),0);
  const pipeVal=Object.values(deals).flat().reduce((s,d)=>s+parseInt((d.val||'$0').replace(/[$,]/g,'')),0);
  
  const text=await callAI('You are a revenue analyst for Good Liquid Bev Co.',
    `Based on this data, provide a 30/60/90-day revenue forecast:
    YTD Collected: $${paid.toLocaleString()}
    Pending Invoices: $${pend.toLocaleString()}
    Pipeline Value: $${pipeVal.toLocaleString()}
    Active Clients: ${clients.filter(c=>c.status==='active').length}
    
    Provide: 30-day forecast, 60-day forecast, 90-day forecast, key assumptions, and 2-3 action items to grow revenue. Be specific with dollar amounts.`);
  document.getElementById('ai-modal-body').textContent=text;
}
