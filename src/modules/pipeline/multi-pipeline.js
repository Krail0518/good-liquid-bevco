/*
 * multi-pipeline.js — extracted from crm-index-core.js (GL-037).
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
 * Declares: glProdPipelineBackfill, loadProductionPipeline, switchPipeline, renderProductionKanban
 */
/* ═══════════════════════════════════════════
   MULTI-PIPELINE
═══════════════════════════════════════════ */
/* Production pipeline kanban: source of truth is public.production_pipeline.
   The in-memory map { stage: [deals...] } is rebuilt from the DB on every
   tab switch. Distinct from public.production_runs (which is the
   operations runs table). */
let productionDeals = {
  'Scheduled':[],
  'In Production':[],
  'Quality Check':[],
  'Completed':[],
  'Shipped':[]
};

async function glProdPipelineBackfill(){
  try {
    if(localStorage.getItem('gl_prod_pipeline_migrated') === '1') return;
    if(!window.supa) return;
    const blob = localStorage.getItem('gl_prod_pipeline');
    if(!blob){ localStorage.setItem('gl_prod_pipeline_migrated','1'); return; }
    let legacy = {}; try { legacy = JSON.parse(blob) || {}; } catch(_e){ return; }
    const rows = [];
    Object.keys(legacy).forEach(stage => {
      (legacy[stage]||[]).forEach(d => {
        rows.push({
          name:    String(d.name||'').slice(0,300),
          company: d.co || null,
          stage:   ['Scheduled','In Production','Quality Check','Completed','Shipped'].includes(stage) ? stage : 'Scheduled',
          notes:   d.notes || null
        });
      });
    });
    if(!rows.length){ localStorage.setItem('gl_prod_pipeline_migrated','1'); return; }
    const r = await window.supa.from('production_pipeline').insert(rows);
    if(r.error){ console.warn('[GL] production_pipeline backfill failed', r.error.message); return; }
    localStorage.setItem('gl_prod_pipeline_migrated','1');
  } catch(e){ console.warn('[GL] production_pipeline backfill threw', e); }
}

async function loadProductionPipeline(){
  if(!window.supa) return;
  await glProdPipelineBackfill();
  const r = await window.supa.from('production_pipeline')
    .select('id, name, company, stage, notes, client_id, created_at')
    .order('created_at', { ascending: false });
  if(r.error){ console.warn('[GL] loadProductionPipeline failed', r.error.message); return; }
  productionDeals = { 'Scheduled':[], 'In Production':[], 'Quality Check':[], 'Completed':[], 'Shipped':[] };
  (r.data || []).forEach(d => {
    const stage = productionDeals[d.stage] ? d.stage : 'Scheduled';
    productionDeals[stage].push({ id: d.id, name: d.name, co: d.company, notes: d.notes, clientId: d.client_id });
  });
}

async function switchPipeline(type,el){
  document.querySelectorAll('.pipe-tab').forEach(t=>t.classList.remove('act'));
  if(el) el.classList.add('act');
  document.getElementById('pipeline-sales').style.display=type==='sales'?'block':'none';
  document.getElementById('pipeline-production').style.display=type==='production'?'block':'none';
  if(type==='production'){
    // Load from production_runs (same source as the Production Runs kanban)
    if(typeof window.glRefreshProductionRuns === 'function') await window.glRefreshProductionRuns();
    renderProductionKanban();
  }
}

function renderProductionKanban(){
  const el=document.getElementById('kanban-prod');
  if(!el) return;
  const STAGES=['Discovery','Formulation','Sample','COA','Production','Ship'];
  const stageColors={Discovery:'#9aa7bd',Formulation:'#7fc6f5',Sample:'#c4a4f8',COA:'#f5c842',Production:'#5fcf9e',Ship:'#00e5c0'};
  const runs=window.glProductionRuns||[];
  if(!runs.length){
    el.innerHTML='<div style="padding:40px;color:var(--muted);font-size:13px;text-align:center">No production runs yet.<br>Go to <b>Production Runs</b> in the sidebar to add your first run.</div>';
    return;
  }
  const byStage={};
  STAGES.forEach(s=>byStage[s]=[]);
  runs.forEach(r=>{ const s=r.stage||'Discovery'; if(byStage[s]) byStage[s].push(r); });
  el.innerHTML=STAGES.map(stage=>`
    <div class="kcol">
      <div class="kcol-h">
        <span class="kcol-t" style="color:${stageColors[stage]}">${stage.toUpperCase()}</span>
        <span class="kcol-c">${byStage[stage].length}</span>
      </div>
      ${byStage[stage].map(r=>`<div class="kcard" data-gl-action="glOpenEditProductionRun" data-gl-arg1="${esc(r.id)}" style="cursor:pointer">
        <div class="kc-n">${esc(r.run_name||'(untitled)')}</div>
        <div class="kc-co">${esc(r.client_name||'—')}</div>
        <div class="kc-val">${esc(r.format||'')}${r.cases?' · '+(+r.cases).toLocaleString()+' cs':''}</div>
      </div>`).join('')}
    </div>`).join('');
}
