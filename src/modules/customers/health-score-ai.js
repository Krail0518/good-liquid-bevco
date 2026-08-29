/*
 * health-score-ai.js — extracted from crm-index-core.js (GL-037).
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
 * Declares: aiScoreClientHealth
 */
/* ═══════════════════════════════════════════
   ENHANCED CLIENT HEALTH SCORE (AI-POWERED)
═══════════════════════════════════════════ */
async function aiScoreClientHealth(clientId) {
  const client = clients.find(c => c.id === clientId);
  if(!client) return;
  const clientInvs = invoices.filter(i => i.client === clientId);
  const paid = clientInvs.filter(i => i.status === 'paid').length;
  const overdue = clientInvs.filter(i => i.status === 'overdue').length;
  const total = clientInvs.reduce((s,i) => s + i.amount, 0);
  const tags = (clientTags[clientId] || []).join(', ');

  showAIModal('Client Health: ' + client.name, '', true);
  const text = await callAI(
    'You are a CRM analyst for Good Liquid Bev Co, a beverage co-packer.',
    `Analyze this client and give a health score 1-100 with reasoning:
    Client: ${client.name}
    Status: ${client.status}
    Service: ${client.service}
    Total billed: $${total.toLocaleString()}
    Paid invoices: ${paid}
    Overdue invoices: ${overdue}
    Tags: ${tags || 'none'}

    Format: Score: XX/100\nRating: Green/Yellow/Red\nStrengths: ...\nRisks: ...\nRecommendation: ...`
  );
  document.getElementById('ai-modal-body').textContent = text;
}

// Time Tracker is already in the CATEGORIES list inside fix.js's addAIToolbar — no wrapper needed
