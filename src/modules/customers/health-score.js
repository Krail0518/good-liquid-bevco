/*
 * health-score.js — extracted from crm-index-core.js (GL-037).
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
 * Declares: getClientHealth
 */
/* ═══════════════════════════════════════════
   CLIENT HEALTH SCORE
═══════════════════════════════════════════ */
function getClientHealth(client){
  let score=0;
  const clientInvoices=invoices.filter(i=>i.client===client.id);
  const paidCount=clientInvoices.filter(i=>i.status==='paid').length;
  const overdueCount=clientInvoices.filter(i=>i.status==='overdue').length;
  if(paidCount>0) score+=30;
  if(overdueCount===0) score+=20; else score-=20;
  if(client.status==='active') score+=30; else if(client.status==='lead') score+=10;
  if(clientInvoices.length>2) score+=20;
  if(score>=60) return 'green';
  if(score>=30) return 'yellow';
  return 'red';
}

