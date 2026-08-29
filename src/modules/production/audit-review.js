/* ============================================================
   audit-review.js — Internal audit + management review
   ============================================================
   A self-contained module (no logic in index.html, nothing in
   localStorage — every entry is a row in Postgres). Mirrors the
   conventions of gmp.js: IIFE + 'use strict', sb()/esc()/
   overlay()/todayISO() helpers, dark-card/teal inline styling,
   if(!sb()) guards, red error messages, DOMContentLoaded +
   MutationObserver boot.

   Two sections rendered into #cpg-auditreview:
     A — INTERNAL AUDITS: schedule audits (internal_audits), expand
         each to view/add findings (audit_findings), and raise an
         NCR (defects row) straight from an open finding.
     B — MANAGEMENT REVIEW: a live KPI summary computed now (open
         deviations, open NCRs, approved suppliers, mock-recall pass
         rate) plus a log of past management_reviews.

   Exposes:
     window.glRenderAuditReview()        — fills the #cpg-auditreview page
     window.glAddAudit()                 — schedule an internal audit
     window.glOpenAudit(id)              — expand an audit's findings
     window.glAddFinding(auditId)        — add a finding to an audit
     window.glRaiseNCRFromFinding(f)     — raise an NCR from a finding
     window.glAddMgmtReview()            — log a management review
   ============================================================ */
(function(){
  'use strict';

  function sb(){ return window.supa || null; }
  function esc(s){
    return String(s == null ? '' : s).replace(/[<>&"]/g, function(c){
      return { '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;' }[c];
    });
  }
  function todayISO(){ try { return new Date().toISOString().slice(0,10); } catch(e){ return ''; } }
  function overlay(id){
    var prior = document.getElementById(id); if(prior) prior.remove();
    var ov = document.createElement('div');
    ov.id = id;
    ov.setAttribute('style','position:fixed;inset:0;z-index:900;background:rgba(6,13,26,.95);backdrop-filter:blur(14px);display:flex;align-items:flex-start;justify-content:center;padding:20px;overflow-y:auto');
    ov.addEventListener('click', function(e){ if(e.target === ov) ov.remove(); });
    document.body.appendChild(ov);
    return ov;
  }

  // Shared input style so modals read like the GMP module.
  var INP = 'width:100%;padding:9px 10px;background:#0a1628;border:1px solid rgba(255,255,255,.12);border-radius:7px;color:#fff;font-size:13px;font-family:var(--ff-body)';
  var LAB = 'display:block;font-size:11px;letter-spacing:.4px;color:#9aa7bd;margin:10px 0 4px';

  // ── Status / severity badges ──
  function statusBadge(status){
    var s = String(status||'').toLowerCase();
    var map = {
      planned:     ['#f5c842','rgba(245,200,66,.12)','rgba(245,200,66,.3)'],
      in_progress: ['#00e5c0','rgba(0,229,192,.12)','rgba(0,229,192,.3)'],
      closed:      ['#5fcf9e','rgba(95,207,158,.12)','rgba(95,207,158,.3)']
    };
    var c = map[s] || ['#9aa7bd','rgba(255,255,255,.06)','rgba(255,255,255,.14)'];
    var label = s ? s.replace(/_/g,' ') : '—';
    return '<span style="font-size:10.5px;letter-spacing:.5px;text-transform:uppercase;color:'+c[0]+';background:'+c[1]+';border:1px solid '+c[2]+';border-radius:20px;padding:2px 9px">'+esc(label)+'</span>';
  }
  function severityBadge(sev){
    var s = String(sev||'').toLowerCase();
    var map = {
      critical: ['#ff8579','rgba(255,133,121,.12)','rgba(255,133,121,.35)'],
      high:     ['#ff8579','rgba(255,133,121,.12)','rgba(255,133,121,.35)'],
      major:    ['#f5c842','rgba(245,200,66,.12)','rgba(245,200,66,.3)'],
      medium:   ['#f5c842','rgba(245,200,66,.12)','rgba(245,200,66,.3)'],
      minor:    ['#9aa7bd','rgba(255,255,255,.06)','rgba(255,255,255,.14)'],
      low:      ['#9aa7bd','rgba(255,255,255,.06)','rgba(255,255,255,.14)']
    };
    var c = map[s] || ['#9aa7bd','rgba(255,255,255,.06)','rgba(255,255,255,.14)'];
    return '<span style="font-size:10px;letter-spacing:.5px;text-transform:uppercase;color:'+c[0]+';background:'+c[1]+';border:1px solid '+c[2]+';border-radius:20px;padding:1px 8px">'+esc(s||'—')+'</span>';
  }

  // ── Live KPI snapshot (best-effort; every path guarded) ──
  async function countWhere(table, apply){
    if(!sb()) return null;
    try {
      var q = sb().from(table).select('id', { count: 'exact', head: true });
      if(apply) q = apply(q);
      var r = await q;
      if(r.error) throw r.error;
      if(typeof r.count === 'number') return r.count;
      return (r.data && r.data.length) || 0;
    } catch(e){ return null; }
  }

  async function computeKPIs(){
    var openDeviations = await countWhere('compliance_records', function(q){ return q.eq('has_deviation', true); });
    var openNCRs       = await countWhere('defects', function(q){ return q.neq('status', 'closed'); });
    var approvedSup    = await countWhere('vendors', function(q){ return q.eq('approval_status', 'approved'); });
    var recallTotal    = await countWhere('mock_recalls', null);
    var recallPassed   = await countWhere('mock_recalls', function(q){ return q.eq('passed', true); });
    var recallRate = null;
    if(typeof recallTotal === 'number' && recallTotal > 0 && typeof recallPassed === 'number'){
      recallRate = Math.round((recallPassed / recallTotal) * 100);
    }
    return {
      open_deviations: openDeviations,
      open_ncrs: openNCRs,
      approved_suppliers: approvedSup,
      mock_recall_total: recallTotal,
      mock_recall_passed: recallPassed,
      mock_recall_pass_rate: recallRate,
      captured_at: new Date().toISOString()
    };
  }

  // Keep the last computed snapshot reachable for glAddMgmtReview().
  window.__glAuditKPIs = null;

  function kpiTile(icon, value, label, accent){
    return '<div style="flex:1;min-width:140px;background:#0a1628;border:1px solid rgba(0,229,192,.18);border-radius:12px;padding:14px 16px">' +
        '<div style="font-size:18px">'+icon+'</div>' +
        '<div style="font-family:var(--ff-disp);font-size:26px;color:'+(accent||'#eef4ff')+';line-height:1.1;margin-top:4px">'+esc(value)+'</div>' +
        '<div style="font-size:11px;color:#9aa7bd;margin-top:2px;line-height:1.4">'+esc(label)+'</div>' +
      '</div>';
  }

  // ── MAIN RENDER ──
  window.glRenderAuditReview = async function glRenderAuditReview(){
    var host = document.getElementById('cpg-auditreview');
    if(!host) return;
    host.innerHTML = '<div style="max-width:1000px;margin:0 auto;color:#9aa7bd;padding:20px 0">Loading…</div>';
    if(!sb()){
      host.innerHTML = '<div style="max-width:1000px;margin:0 auto"><div style="color:#ff8579;padding:20px 0">Supabase not ready.</div></div>';
      return;
    }

    // Fetch audits, their findings, past reviews, and the live KPIs together.
    var audits = [], findingsByAudit = {}, reviews = [], kpis = null, loadErr = null;
    try {
      var aRes = await sb().from('internal_audits').select('*').order('audit_date', { ascending: false }).limit(200);
      if(aRes.error) throw aRes.error;
      audits = aRes.data || [];

      var ids = audits.map(function(a){ return a.id; });
      if(ids.length){
        var fRes = await sb().from('audit_findings').select('*').in('audit_id', ids).order('created_at', { ascending: true }).limit(1000);
        if(fRes.error) throw fRes.error;
        (fRes.data || []).forEach(function(f){
          (findingsByAudit[f.audit_id] = findingsByAudit[f.audit_id] || []).push(f);
        });
      }

      var rRes = await sb().from('management_reviews').select('*').order('review_date', { ascending: false }).limit(200);
      if(rRes.error) throw rRes.error;
      reviews = rRes.data || [];
    } catch(e){ loadErr = e; }

    try { kpis = await computeKPIs(); } catch(e){ kpis = null; }
    window.__glAuditKPIs = kpis;
    window.__glAuditFindings = findingsByAudit;  // reachable for delegated handlers

    if(loadErr){
      host.innerHTML = '<div style="max-width:1000px;margin:0 auto"><div style="color:#ff8579;padding:20px 0">Could not load audit / review data: '+esc(loadErr.message||loadErr)+'</div></div>';
      return;
    }

    // ── Section A: audit rows ──
    var auditRows = audits.map(function(a){
      var findings = findingsByAudit[a.id] || [];
      var open = document.getElementById('gl-audit-body-'+a.id);  // preserve expander state on re-render
      var isOpen = !!(open && open.getAttribute('data-open') === '1');
      var findingRows = findings.map(function(f){
        var isOpenFinding = String(f.status||'').toLowerCase() !== 'closed' && !f.ncr_id;
        var ncrTag = f.ncr_id
          ? '<span style="font-size:10.5px;color:#5fcf9e;background:rgba(95,207,158,.1);border:1px solid rgba(95,207,158,.3);border-radius:20px;padding:2px 9px">✓ NCR raised</span>'
          : (isOpenFinding ? '<button class="gl-find-ncr" data-fid="'+esc(f.id)+'" style="padding:6px 12px;background:rgba(0,229,192,.12);color:var(--teal);border:1px solid rgba(0,229,192,.3);border-radius:7px;cursor:pointer;font-size:11.5px">⤴ Raise NCR</button>' : '');
        return '<div style="border-top:1px solid rgba(255,255,255,.06);padding:10px 0;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-start">' +
            '<div style="flex:1;min-width:200px">' +
              '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
                (f.clause ? '<span style="font-weight:700;font-size:12.5px;color:#eef4ff">'+esc(f.clause)+'</span>' : '') +
                severityBadge(f.severity) +
                (f.status ? '<span style="font-size:10.5px;color:#9aa7bd">'+esc(f.status)+'</span>' : '') +
              '</div>' +
              '<div style="font-size:12.5px;color:#dfe7f1;margin-top:4px;line-height:1.5">'+esc(f.description||'')+'</div>' +
            '</div>' +
            '<div style="white-space:nowrap">'+ncrTag+'</div>' +
          '</div>';
      }).join('');

      return '<div style="border:1px solid rgba(0,229,192,.14);border-radius:12px;padding:14px 16px;margin-bottom:12px;background:rgba(255,255,255,.02)">' +
          '<div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:center">' +
            '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">' +
              '<span style="font-weight:800;font-size:14px;color:#eef4ff">'+esc(a.audit_date||'')+'</span>' +
              statusBadge(a.status) +
              '<span style="font-size:12.5px;color:#dfe7f1">'+esc(a.scope||'')+'</span>' +
              (a.auditor ? '<span style="font-size:11.5px;color:#9aa7bd">· '+esc(a.auditor)+'</span>' : '') +
            '</div>' +
            '<button class="gl-audit-toggle" data-aid="'+esc(a.id)+'" style="padding:7px 13px;background:rgba(0,229,192,.1);color:var(--teal);border:1px solid rgba(0,229,192,.28);border-radius:7px;cursor:pointer;font-size:12px">Findings ('+findings.length+')</button>' +
          '</div>' +
          (a.summary ? '<div style="font-size:12px;color:#9aa7bd;margin-top:8px;line-height:1.5">'+esc(a.summary)+'</div>' : '') +
          '<div id="gl-audit-body-'+esc(a.id)+'" data-open="'+(isOpen?'1':'0')+'" style="display:'+(isOpen?'block':'none')+';margin-top:10px;border-top:1px solid rgba(255,255,255,.06);padding-top:6px">' +
            (findings.length ? findingRows : '<div style="font-size:12px;color:#9aa7bd;padding:8px 0">No findings recorded.</div>') +
            '<div style="margin-top:10px"><button class="gl-add-finding" data-aid="'+esc(a.id)+'" style="padding:7px 13px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);border-radius:7px;color:#dfe7f1;font-size:12px;cursor:pointer">＋ Add finding</button></div>' +
          '</div>' +
        '</div>';
    }).join('');

    // ── Section B: KPI tiles + reviews ──
    var kpiRow = kpis
      ? '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px">' +
          kpiTile('⚠️', kpis.open_deviations == null ? '—' : kpis.open_deviations, 'Open deviations', '#f5c842') +
          kpiTile('🛠️', kpis.open_ncrs == null ? '—' : kpis.open_ncrs, 'Open NCRs', '#ff8579') +
          kpiTile('✅', kpis.approved_suppliers == null ? '—' : kpis.approved_suppliers, 'Approved suppliers', '#00e5c0') +
          kpiTile('🔁', kpis.mock_recall_pass_rate == null ? '—' : (kpis.mock_recall_pass_rate + '%'), 'Mock-recall pass rate', '#5fcf9e') +
        '</div>'
      : '<div style="color:#9aa7bd;font-size:12px;margin-bottom:16px">KPIs unavailable.</div>';

    var reviewRows = reviews.map(function(rv){
      return '<div style="border:1px solid rgba(0,229,192,.14);border-radius:12px;padding:14px 16px;margin-bottom:10px;background:rgba(255,255,255,.02)">' +
          '<div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center">' +
            '<span style="font-weight:800;font-size:14px;color:#eef4ff">'+esc(rv.review_date||'')+'</span>' +
            (rv.attendees ? '<span style="font-size:11.5px;color:#9aa7bd">'+esc(rv.attendees)+'</span>' : '') +
          '</div>' +
          (rv.notes   ? '<div style="font-size:12.5px;color:#dfe7f1;margin-top:8px;line-height:1.5">'+esc(rv.notes)+'</div>' : '') +
          (rv.actions ? '<div style="font-size:12px;color:#5fcf9e;margin-top:6px;line-height:1.5">Actions: '+esc(rv.actions)+'</div>' : '') +
        '</div>';
    }).join('');

    host.innerHTML =
      '<div style="max-width:1000px;margin:0 auto">' +
        // Section A
        '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:6px">' +
          '<div style="font-family:var(--ff-disp);font-size:24px;letter-spacing:2px;color:var(--teal)">🔍 INTERNAL AUDITS</div>' +
          '<button data-gl-action="glAddAudit" style="padding:12px 20px;background:linear-gradient(135deg,#00e5c0,#00c4a7);color:#04231d;border:none;border-radius:9px;font-weight:800;font-size:14px;cursor:pointer">＋ Schedule audit</button>' +
        '</div>' +
        '<div style="font-size:12.5px;color:var(--muted);margin-bottom:16px;line-height:1.6">Plan and record internal audits, log findings against clauses, and raise an NCR straight from any open finding.</div>' +
        (audits.length ? auditRows : '<div style="color:#9aa7bd;padding:16px 0;margin-bottom:8px">No audits scheduled yet. Click ＋ Schedule audit to plan one.</div>') +

        // Section B
        '<div style="height:22px"></div>' +
        '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:6px">' +
          '<div style="font-family:var(--ff-disp);font-size:24px;letter-spacing:2px;color:var(--teal)">📋 MANAGEMENT REVIEW</div>' +
          '<button data-gl-action="glAddMgmtReview" style="padding:12px 20px;background:linear-gradient(135deg,#00e5c0,#00c4a7);color:#04231d;border:none;border-radius:9px;font-weight:800;font-size:14px;cursor:pointer">＋ New management review</button>' +
        '</div>' +
        '<div style="font-size:12.5px;color:var(--muted);margin-bottom:14px;line-height:1.6">Live compliance KPIs, captured into each review record so the snapshot is preserved.</div>' +
        kpiRow +
        (reviews.length ? reviewRows : '<div style="color:#9aa7bd;padding:16px 0">No management reviews logged yet.</div>') +
      '</div>';

    // Delegated handlers for the dynamically rendered buttons.
    if(!host.getAttribute('data-ar-bound')){
      host.setAttribute('data-ar-bound','1');
      host.addEventListener('click', async function(ev){
        var t = ev.target;
        if(!t || !t.closest) return;
        var tgl = t.closest('.gl-audit-toggle');
        if(tgl){
          var body = document.getElementById('gl-audit-body-'+tgl.getAttribute('data-aid'));
          if(body){
            var nowOpen = body.getAttribute('data-open') !== '1';
            body.setAttribute('data-open', nowOpen ? '1' : '0');
            body.style.display = nowOpen ? 'block' : 'none';
          }
          return;
        }
        var addF = t.closest('.gl-add-finding');
        if(addF){ window.glAddFinding(addF.getAttribute('data-aid')); return; }
        var ncrBtn = t.closest('.gl-find-ncr');
        if(ncrBtn && !ncrBtn.disabled){
          var fid = ncrBtn.getAttribute('data-fid');
          var finding = null, groups = window.__glAuditFindings || {};
          Object.keys(groups).forEach(function(k){ (groups[k]||[]).forEach(function(f){ if(String(f.id) === String(fid)) finding = f; }); });
          if(!finding) return;
          ncrBtn.disabled = true; ncrBtn.textContent = 'Raising…';
          var id = await window.glRaiseNCRFromFinding(finding);
          if(id){ window.glRenderAuditReview(); }
          else { ncrBtn.disabled = false; ncrBtn.textContent = '⤴ Raise NCR'; }
          return;
        }
      });
    }
  };

  // ── Modal: schedule an internal audit ──
  window.glAddAudit = function glAddAudit(){
    if(!sb()){ alert('Supabase not ready.'); return; }
    var ov = overlay('gl-ar-audit');
    ov.innerHTML =
      '<div style="background:#142238;border:1px solid rgba(0,229,192,.2);border-radius:16px;padding:22px;width:100%;max-width:560px;color:#fff">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
          '<div style="font-family:var(--ff-disp);font-size:17px;letter-spacing:1.5px;color:var(--teal)">🔍 SCHEDULE AUDIT</div>' +
          '<button data-gl-close="#gl-ar-audit" style="background:none;border:none;color:#9aa7bd;font-size:20px;cursor:pointer">✕</button>' +
        '</div>' +
        '<label style="'+LAB+'">Audit date <span style="color:#f5c842">*</span></label>' +
        '<input id="ar-a-date" type="date" value="'+todayISO()+'" style="'+INP+'">' +
        '<label style="'+LAB+'">Scope <span style="color:#f5c842">*</span></label>' +
        '<input id="ar-a-scope" placeholder="e.g. Sanitation program / SQF 11.2" style="'+INP+'">' +
        '<label style="'+LAB+'">Auditor</label>' +
        '<input id="ar-a-auditor" placeholder="Lead auditor name" style="'+INP+'">' +
        '<label style="'+LAB+'">Status</label>' +
        '<select id="ar-a-status" style="'+INP+'"><option value="planned">Planned</option><option value="in_progress">In progress</option><option value="closed">Closed</option></select>' +
        '<label style="'+LAB+'">Summary <span style="opacity:.6">(optional)</span></label>' +
        '<textarea id="ar-a-summary" style="'+INP+';min-height:56px;resize:vertical"></textarea>' +
        '<div id="ar-a-err" style="display:none;color:#ff8579;font-size:12px;margin-top:8px"></div>' +
        '<div style="display:flex;gap:10px;margin-top:14px">' +
          '<button data-gl-close="#gl-ar-audit" style="flex:1;padding:11px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);border-radius:8px;color:#dfe7f1;font-size:13px;cursor:pointer">Cancel</button>' +
          '<button id="ar-a-save" style="flex:1;padding:11px;background:rgba(0,229,192,.14);border:1px solid rgba(0,229,192,.35);border-radius:8px;color:var(--teal);font-weight:700;font-size:13px;cursor:pointer">Schedule</button>' +
        '</div>' +
      '</div>';
    ov.querySelector('#ar-a-save').addEventListener('click', async function(){
      var btn = this, err = ov.querySelector('#ar-a-err');
      err.style.display = 'none';
      var date = ov.querySelector('#ar-a-date').value || todayISO();
      var scope = (ov.querySelector('#ar-a-scope').value||'').trim();
      if(!scope){ err.textContent='Scope is required.'; err.style.display='block'; return; }
      var row = {
        audit_date: date,
        scope: scope,
        auditor: (ov.querySelector('#ar-a-auditor').value||'').trim() || null,
        status: ov.querySelector('#ar-a-status').value || 'planned',
        summary: (ov.querySelector('#ar-a-summary').value||'').trim() || null,
        created_at: new Date().toISOString()
      };
      btn.disabled = true; btn.textContent = 'Saving…';
      try {
        var r = await sb().from('internal_audits').insert([row]).select('id');
        if(r.error) throw r.error;
        if(typeof window.glAudit === 'function') window.glAudit('internal_audit_scheduled', scope, { date: date });
        ov.remove();
        window.glRenderAuditReview();
      } catch(e){
        err.textContent = 'Save failed: ' + (e.message || e); err.style.display='block';
        btn.disabled = false; btn.textContent = 'Schedule';
      }
    });
  };

  // ── Expand an audit's findings (delegated toggle covers the in-page case;
  //    this global keeps the documented API stable). ──
  window.glOpenAudit = function glOpenAudit(id){
    var body = document.getElementById('gl-audit-body-'+id);
    if(!body) return;
    var nowOpen = body.getAttribute('data-open') !== '1';
    body.setAttribute('data-open', nowOpen ? '1' : '0');
    body.style.display = nowOpen ? 'block' : 'none';
  };

  // ── Modal: add a finding to an audit ──
  window.glAddFinding = function glAddFinding(auditId){
    if(!sb()){ alert('Supabase not ready.'); return; }
    if(!auditId){ alert('No audit selected.'); return; }
    var ov = overlay('gl-ar-finding');
    ov.innerHTML =
      '<div style="background:#142238;border:1px solid rgba(0,229,192,.2);border-radius:16px;padding:22px;width:100%;max-width:560px;color:#fff">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
          '<div style="font-family:var(--ff-disp);font-size:17px;letter-spacing:1.5px;color:var(--teal)">＋ ADD FINDING</div>' +
          '<button data-gl-close="#gl-ar-finding" style="background:none;border:none;color:#9aa7bd;font-size:20px;cursor:pointer">✕</button>' +
        '</div>' +
        '<label style="'+LAB+'">Clause / reference</label>' +
        '<input id="ar-f-clause" placeholder="e.g. 11.2.3.1" style="'+INP+'">' +
        '<label style="'+LAB+'">Description <span style="color:#f5c842">*</span></label>' +
        '<textarea id="ar-f-desc" style="'+INP+';min-height:64px;resize:vertical"></textarea>' +
        '<label style="'+LAB+'">Severity</label>' +
        '<select id="ar-f-sev" style="'+INP+'"><option value="minor">Minor</option><option value="medium" selected>Medium</option><option value="major">Major</option><option value="critical">Critical</option></select>' +
        '<div id="ar-f-err" style="display:none;color:#ff8579;font-size:12px;margin-top:8px"></div>' +
        '<div style="display:flex;gap:10px;margin-top:14px">' +
          '<button data-gl-close="#gl-ar-finding" style="flex:1;padding:11px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);border-radius:8px;color:#dfe7f1;font-size:13px;cursor:pointer">Cancel</button>' +
          '<button id="ar-f-save" style="flex:1;padding:11px;background:rgba(0,229,192,.14);border:1px solid rgba(0,229,192,.35);border-radius:8px;color:var(--teal);font-weight:700;font-size:13px;cursor:pointer">Add finding</button>' +
        '</div>' +
      '</div>';
    ov.querySelector('#ar-f-save').addEventListener('click', async function(){
      var btn = this, err = ov.querySelector('#ar-f-err');
      err.style.display = 'none';
      var desc = (ov.querySelector('#ar-f-desc').value||'').trim();
      if(!desc){ err.textContent='Description is required.'; err.style.display='block'; return; }
      var row = {
        audit_id: auditId,
        clause: (ov.querySelector('#ar-f-clause').value||'').trim() || null,
        description: desc,
        severity: ov.querySelector('#ar-f-sev').value || 'medium',
        status: 'open',
        created_at: new Date().toISOString()
      };
      btn.disabled = true; btn.textContent = 'Saving…';
      try {
        var r = await sb().from('audit_findings').insert([row]).select('id');
        if(r.error) throw r.error;
        if(typeof window.glAudit === 'function') window.glAudit('audit_finding_added', auditId, { severity: row.severity });
        ov.remove();
        window.glRenderAuditReview();
      } catch(e){
        err.textContent = 'Save failed: ' + (e.message || e); err.style.display='block';
        btn.disabled = false; btn.textContent = 'Add finding';
      }
    });
  };

  // ── Raise an NCR (defects row) from an open finding, then link it back ──
  window.glRaiseNCRFromFinding = async function glRaiseNCRFromFinding(finding){
    if(!sb()){ alert('Supabase not ready.'); return null; }
    finding = finding || {};
    var row = {
      reported_at: new Date().toISOString(),
      run_ref: 'Internal audit ' + (finding.clause || ''),
      category: 'internal_audit',
      severity: finding.severity || 'medium',
      status: 'open',
      description: finding.description,
      source: 'internal_audit',
      source_record_id: finding.id,
      ncr_number: 'NCR-' + Date.now().toString().slice(-6)
    };
    try {
      var r = await sb().from('defects').insert([row]).select('id');
      if(r.error) throw r.error;
      var newId = (r.data && r.data[0] && r.data[0].id) || null;
      if(newId){
        var u = await sb().from('audit_findings').update({ ncr_id: newId }).eq('id', finding.id).select();
        if(u.error) throw u.error;
        if(Array.isArray(u.data) && u.data.length === 0) throw new Error('the finding could not be linked to the new NCR (0 rows updated)');
      }
      if(typeof window.glAudit === 'function') window.glAudit('ncr_raised_from_finding', finding.clause || finding.id, { finding: finding.id, ncr: newId });
      return newId;
    } catch(e){
      alert('Could not raise NCR: ' + (e.message || e));
      return null;
    }
  };

  // ── Modal: new management review (captures the live KPI snapshot) ──
  window.glAddMgmtReview = function glAddMgmtReview(){
    if(!sb()){ alert('Supabase not ready.'); return; }
    var ov = overlay('gl-ar-review');
    var kpis = window.__glAuditKPIs || null;
    var snapshot = kpis
      ? '<div style="background:rgba(0,229,192,.05);border:1px solid rgba(0,229,192,.18);border-radius:10px;padding:10px 12px;margin:12px 0;font-size:11.5px;color:#9aa7bd;line-height:1.7">' +
          '<div style="font-size:10.5px;letter-spacing:1.5px;color:var(--teal);margin-bottom:4px">KPI SNAPSHOT (STORED WITH THIS REVIEW)</div>' +
          'Open deviations: <b style="color:#eef4ff">'+esc(kpis.open_deviations==null?'—':kpis.open_deviations)+'</b> · ' +
          'Open NCRs: <b style="color:#eef4ff">'+esc(kpis.open_ncrs==null?'—':kpis.open_ncrs)+'</b> · ' +
          'Approved suppliers: <b style="color:#eef4ff">'+esc(kpis.approved_suppliers==null?'—':kpis.approved_suppliers)+'</b> · ' +
          'Mock-recall pass rate: <b style="color:#eef4ff">'+esc(kpis.mock_recall_pass_rate==null?'—':(kpis.mock_recall_pass_rate+'%'))+'</b>' +
        '</div>'
      : '<div style="font-size:11.5px;color:#9aa7bd;margin:12px 0">KPI snapshot unavailable.</div>';
    ov.innerHTML =
      '<div style="background:#142238;border:1px solid rgba(0,229,192,.2);border-radius:16px;padding:22px;width:100%;max-width:600px;color:#fff">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
          '<div style="font-family:var(--ff-disp);font-size:17px;letter-spacing:1.5px;color:var(--teal)">📋 NEW MANAGEMENT REVIEW</div>' +
          '<button data-gl-close="#gl-ar-review" style="background:none;border:none;color:#9aa7bd;font-size:20px;cursor:pointer">✕</button>' +
        '</div>' +
        '<label style="'+LAB+'">Review date <span style="color:#f5c842">*</span></label>' +
        '<input id="ar-r-date" type="date" value="'+todayISO()+'" style="'+INP+'">' +
        '<label style="'+LAB+'">Attendees</label>' +
        '<input id="ar-r-att" placeholder="Names / roles present" style="'+INP+'">' +
        snapshot +
        '<label style="'+LAB+'">Notes / discussion</label>' +
        '<textarea id="ar-r-notes" style="'+INP+';min-height:64px;resize:vertical"></textarea>' +
        '<label style="'+LAB+'">Actions / decisions</label>' +
        '<textarea id="ar-r-actions" style="'+INP+';min-height:56px;resize:vertical"></textarea>' +
        '<div id="ar-r-err" style="display:none;color:#ff8579;font-size:12px;margin-top:8px"></div>' +
        '<div style="display:flex;gap:10px;margin-top:14px">' +
          '<button data-gl-close="#gl-ar-review" style="flex:1;padding:11px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);border-radius:8px;color:#dfe7f1;font-size:13px;cursor:pointer">Cancel</button>' +
          '<button id="ar-r-save" style="flex:1;padding:11px;background:rgba(0,229,192,.14);border:1px solid rgba(0,229,192,.35);border-radius:8px;color:var(--teal);font-weight:700;font-size:13px;cursor:pointer">Save review</button>' +
        '</div>' +
      '</div>';
    ov.querySelector('#ar-r-save').addEventListener('click', async function(){
      var btn = this, err = ov.querySelector('#ar-r-err');
      err.style.display = 'none';
      var date = ov.querySelector('#ar-r-date').value || todayISO();
      var row = {
        review_date: date,
        attendees: (ov.querySelector('#ar-r-att').value||'').trim() || null,
        kpis: window.__glAuditKPIs || null,
        notes: (ov.querySelector('#ar-r-notes').value||'').trim() || null,
        actions: (ov.querySelector('#ar-r-actions').value||'').trim() || null,
        created_at: new Date().toISOString()
      };
      btn.disabled = true; btn.textContent = 'Saving…';
      try {
        var r = await sb().from('management_reviews').insert([row]).select('id');
        if(r.error) throw r.error;
        if(typeof window.glAudit === 'function') window.glAudit('management_review_logged', date, {});
        ov.remove();
        window.glRenderAuditReview();
      } catch(e){
        err.textContent = 'Save failed: ' + (e.message || e); err.style.display='block';
        btn.disabled = false; btn.textContent = 'Save review';
      }
    });
  };

  // Render into the page container once the DOM is ready.
  function boot(){ try { if(document.getElementById('cpg-auditreview')) window.glRenderAuditReview(); } catch(e){} }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  // Re-render if the page node appears later (SPA builds it after login).
  try {
    var mo = new MutationObserver(function(){ var h = document.getElementById('cpg-auditreview'); if(h && !h.getAttribute('data-auditreview-ready')){ h.setAttribute('data-auditreview-ready','1'); window.glRenderAuditReview(); } });
    mo.observe(document.documentElement, { childList:true, subtree:true });
  } catch(e){}

  console.log('[GL] internal audit / management review module loaded');
}());
