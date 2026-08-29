/*
 * time-report.js — extracted from crm-index-core.js (GL-037).
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
 * Declares: openTimeTrackingReport
 */
/* ═══════════════════════════════════════════
   TIME TRACKING REPORT
   Full breakdown by client and activity
═══════════════════════════════════════════ */
async function openTimeTrackingReport(){
  showAIModal('Time Tracking Report', '', true);

  // Refresh from DB before computing the report. Without this the
  // report only sees what's in the in-memory cache (which is only
  // populated after the Time Tracker modal has been opened this
  // session).
  await loadTimeEntries();

  const totalHours = timeEntries.reduce((s,e) => s + parseFloat(e.hours), 0);

  // Group by client
  const byClient = {};
  timeEntries.forEach(e => {
    if(!byClient[e.clientName]) byClient[e.clientName] = {hours:0, entries:[]};
    byClient[e.clientName].hours += parseFloat(e.hours);
    byClient[e.clientName].entries.push(e);
  });

  // Group by activity
  const byActivity = {};
  timeEntries.forEach(e => {
    byActivity[e.activity] = (byActivity[e.activity] || 0) + parseFloat(e.hours);
  });

  const reportData = {
    totalHours: totalHours.toFixed(2),
    byClient: Object.entries(byClient).sort((a,b)=>b[1].hours-a[1].hours).map(([name,d])=>({name, hours:d.hours.toFixed(2)})),
    byActivity: Object.entries(byActivity).sort((a,b)=>b[1]-a[1]).map(([act,hrs])=>({act, hours:hrs.toFixed(2)})),
    entryCount: timeEntries.length,
  };

  const text = await callAI(
    'You are a business analyst for Good Liquid Bev Co.',
    `Analyze this time tracking data and provide insights:
    Total hours logged: ${reportData.totalHours}
    Total entries: ${reportData.entryCount}
    Hours by client: ${JSON.stringify(reportData.byClient)}
    Hours by activity: ${JSON.stringify(reportData.byActivity)}

    Provide: Summary, which clients take most time, which activities, billable vs non-billable estimate, 3 efficiency recommendations.`
  );

  const modalBody = document.getElementById('ai-modal-body');
  if(modalBody){
    modalBody.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:18px">
        <div style="background:rgba(0,229,192,.08);border:1px solid rgba(0,229,192,.15);border-radius:8px;padding:13px;text-align:center">
          <div style="font-size:10px;color:var(--muted);letter-spacing:1px">TOTAL HOURS</div>
          <div style="font-family:var(--ff-disp);font-size:28px;color:var(--teal)">${reportData.totalHours}</div>
        </div>
        <div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:8px;padding:13px;text-align:center">
          <div style="font-size:10px;color:var(--muted);letter-spacing:1px">LOG ENTRIES</div>
          <div style="font-family:var(--ff-disp);font-size:28px;color:var(--white)">${reportData.entryCount}</div>
        </div>
        <div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:8px;padding:13px;text-align:center">
          <div style="font-size:10px;color:var(--muted);letter-spacing:1px">CLIENTS TRACKED</div>
          <div style="font-family:var(--ff-disp);font-size:28px;color:var(--white)">${reportData.byClient.length}</div>
        </div>
      </div>
      <div style="margin-bottom:14px">
        <div style="font-size:10px;letter-spacing:2px;color:var(--muted);margin-bottom:8px">HOURS BY CLIENT</div>
        ${reportData.byClient.map(c=>`<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.05)">
          <div style="font-size:13px;color:var(--white)">${esc(c.name)}</div>
          <div style="font-family:var(--ff-disp);font-size:16px;color:var(--teal)">${c.hours}h</div>
        </div>`).join('')}
      </div>
      <div style="white-space:pre-wrap;font-size:13px;line-height:1.7;margin-top:14px;padding-top:14px;border-top:1px solid rgba(255,255,255,.07)">${esc(text)}</div>`;
  }
}

/* INVOICE PAY LINK GENERATOR — moved to /src/modules/invoicing/pay-link.js (GL-037). */
