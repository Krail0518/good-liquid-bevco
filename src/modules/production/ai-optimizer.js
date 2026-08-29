/*
 * ai-optimizer.js — extracted from crm-index-core.js (GL-037).
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
 * Declares: openAIProductionOptimizer
 */
/* ═══════════════════════════════════════════
   AI PRODUCTION OPTIMIZER
═══════════════════════════════════════════ */
async function openAIProductionOptimizer(){
  showAIModal('Production Schedule Optimizer','',true);
  const runs=calEvents.filter(e=>e.type==='production');
  if(!runs.length){document.getElementById('ai-modal-body').textContent='No production runs scheduled yet. Add some runs first.';return;}
  
  const runList=runs.map(r=>{
    const client=clients.find(c=>c.id===r.clientId);
    return `- ${r.title}: ${client?client.name:'Unknown'}, ${r.qty||'?'} cases ${r.format||''}, start ${r.date}, due ${r.dueDate||'TBD'}`;
  }).join('\n');
  
  const text=await callAI('You are a production scheduling expert for Good Liquid Bev Co, a beverage co-packer.',
    `Optimize this production schedule. Consider: format changes require cleaning time, larger runs should be prioritized, group similar formats together.
    
    Current schedule:
    ${runList}
    
    Provide: Optimal run order, estimated total production days, any scheduling conflicts or concerns, and specific recommendations.`);
  document.getElementById('ai-modal-body').textContent=text;
}

