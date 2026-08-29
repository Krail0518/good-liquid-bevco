/*
 * stale-deals.js — extracted from crm-index-core.js (GL-037).
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
 * Declares: glDealActivityBackfill, loadDealActivity, checkStaleDeals, touchDeal
 */
/* ═══════════════════════════════════════════
   STALE DEAL DETECTION
═══════════════════════════════════════════ */
/* Deal staleness tracker: { dealName: lastActivityMs }. Source of
   truth is public.deal_activity. Loaded async on dashboard render;
   the local map is kept hot for the synchronous checkStaleDeals
   loop. Writes through to the DB on every touch. */
let dealLastActivity = {};

async function glDealActivityBackfill(){
  try {
    if(localStorage.getItem('gl_deal_activity_migrated') === '1') return;
    if(!window.supa) return;
    const blob = localStorage.getItem('gl_deal_activity');
    if(!blob){ localStorage.setItem('gl_deal_activity_migrated','1'); return; }
    let legacy = {}; try { legacy = JSON.parse(blob) || {}; } catch(_e){ return; }
    const rows = Object.keys(legacy).map(name => ({
      deal_name:     String(name).slice(0, 300),
      last_activity: new Date(legacy[name]).toISOString()
    })).filter(r => r.deal_name);
    if(!rows.length){ localStorage.setItem('gl_deal_activity_migrated','1'); return; }
    const r = await window.supa.from('deal_activity').upsert(rows, { onConflict: 'deal_name' });
    if(r.error){ console.warn('[GL] deal_activity backfill failed', r.error.message); return; }
    localStorage.setItem('gl_deal_activity_migrated','1');
  } catch(e){ console.warn('[GL] deal_activity backfill threw', e); }
}

async function loadDealActivity(){
  if(!window.supa) return;
  await glDealActivityBackfill();
  const r = await window.supa.from('deal_activity').select('deal_name, last_activity');
  if(r.error){ console.warn('[GL] loadDealActivity failed', r.error.message); return; }
  dealLastActivity = {};
  (r.data || []).forEach(row => {
    dealLastActivity[row.deal_name] = new Date(row.last_activity).getTime();
  });
}

function checkStaleDeals(){
  const STALE_DAYS=7;
  const now=Date.now();
  Object.entries(deals).forEach(([stage, arr]) => arr.forEach(d => {
    if(['Closed Won','Closed Lost'].includes(stage)) return;
    if(d.name){
      const key=d.name;
      const last=dealLastActivity[key]||now;
      const daysDiff=Math.floor((now-last)/(1000*60*60*24));
      if(daysDiff>=STALE_DAYS){
        addNotification('⚠️ Stale Deal: '+d.name,`${daysDiff} days without activity — ${d.co||''}. Follow up now!`,'stale');
        // Dedup guard — only send one email alert per deal per day
        var _staleKey = 'gl_stale_alerted_' + (d.name||'') + '_' + new Date().toISOString().slice(0,10);
        if(localStorage.getItem(_staleKey)) return;
        // Send email notification
        sendMailgunEmail('mike@goodliquid.com','[Good Liquid CRM] Stale Deal Alert: '+d.name,
          `Hi Mike,\n\nThe deal "${d.name}" for ${d.co||''} has been inactive for ${daysDiff} days.\n\nDeal value: ${d.val||'N/A'}\n\nPlease follow up to keep this deal moving.\n\n— Good Liquid CRM`);
        sendMailgunEmail('sandra@goodliquid.com','[Good Liquid CRM] Stale Deal Alert: '+d.name,
          `Hi Sandra,\n\nThe deal "${d.name}" for ${d.co||''} has been inactive for ${daysDiff} days.\n\nDeal value: ${d.val||'N/A'}\n\nPlease follow up.\n\n— Good Liquid CRM`);
        localStorage.setItem(_staleKey, '1');
      }
    }
  }));
}

function touchDeal(dealName){
  const nowMs = Date.now();
  dealLastActivity[dealName] = nowMs;
  if(window.supa){
    window.supa.from('deal_activity').upsert([{
      deal_name: dealName, last_activity: new Date(nowMs).toISOString()
    }], { onConflict: 'deal_name' }).then(r => {
      if(r.error) console.warn('[GL] deal_activity upsert failed', r.error.message);
    });
  }
}
