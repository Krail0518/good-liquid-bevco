/* ============================================================
   intake.js — staff view / edit of the product intake
   ============================================================
   Shows the questionnaire answers (from intake-questions.js / the
   product_intake table) on a lead's Deal Details panel and on a client card,
   and lets staff fill or fix them. Answers a tour booker submitted flow in
   here automatically (keyed by deal_id / email); once a lead becomes a client
   they carry over by client_id.

   Exposes: window.glRenderIntake(mount, { kind, dealId, clientId, email, name })
   ============================================================ */
(function(){
  'use strict';

  function sb(){ return window.supa || null; }
  function esc(s){ return String(s==null?'':s).replace(/[<>&"]/g,function(c){ return {'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]; }); }

  async function loadIntake(ctx){
    if(!sb()) return null;
    async function first(q){ try { var r = await q.order('updated_at',{ascending:false}).limit(1); return (r && r.data && r.data[0]) || null; } catch(e){ return null; } }
    var row = null;
    if(ctx.clientId) row = await first(sb().from('product_intake').select('*').eq('client_id', ctx.clientId));
    if(!row && ctx.dealId) row = await first(sb().from('product_intake').select('*').eq('deal_id', ctx.dealId));
    if(!row && ctx.email) row = await first(sb().from('product_intake').select('*').ilike('email', ctx.email));
    return row;
  }

  async function saveIntake(ctx, existing, answers){
    if(!sb()) return { ok:false };
    var patch = {
      answers: answers, source: (existing && existing.source) || 'staff', updated_at: new Date().toISOString(),
      email: (answers && answers.email) || (existing && existing.email) || ctx.email || null
    };
    if(ctx.clientId) patch.client_id = ctx.clientId;
    if(ctx.dealId) patch.deal_id = ctx.dealId;
    try {
      var r;
      if(existing && existing.id){
        r = await sb().from('product_intake').update(patch).eq('id', existing.id).select('id');
      } else {
        patch.submitted_at = new Date().toISOString();
        r = await sb().from('product_intake').insert(patch).select('id');
      }
      if(r.error || !r.data || !r.data.length) return { ok:false, error:r.error };
      return { ok:true, id:r.data[0].id };
    } catch(e){ return { ok:false, error:e }; }
  }

  function readView(answers){
    // Render the answers as labelled rows grouped by section.
    var GI = window.GL_INTAKE; if(!GI) return '';
    return GI.SECTIONS.map(function(sec){
      var rows = sec.fields.map(function(f){
        var v = answers ? answers[f.key] : '';
        if(Array.isArray(v)) v = v.join(', ');
        if(v == null || v === '') return '';
        return '<div style="display:flex;gap:8px;font-size:12px;padding:2px 0"><span style="color:#8493a8;min-width:150px;flex-shrink:0">'+esc(f.label)+'</span><span style="color:#e6edf6">'+esc(v)+'</span></div>';
      }).filter(Boolean).join('');
      if(!rows) return '';
      return '<div style="margin-bottom:10px"><div style="font-size:10px;letter-spacing:1.5px;color:#00e5c0;font-weight:700;margin-bottom:4px">'+esc(sec.title.toUpperCase())+'</div>'+rows+'</div>';
    }).filter(Boolean).join('');
  }

  window.glRenderIntake = async function glRenderIntake(mount, ctx){
    var host = typeof mount === 'string' ? document.querySelector(mount) : mount;
    if(!host) return;
    ctx = ctx || {};
    if(!window.GL_INTAKE){ host.innerHTML = ''; return; }
    if(!sb()){ host.innerHTML = ''; return; }
    host.innerHTML = '<div style="font-size:11px;color:#9aa7bd">Loading intake…</div>';
    var existing = await loadIntake(ctx);
    paint(host, ctx, existing, false);
  };

  function paint(host, ctx, existing, editing){
    var answers = (existing && existing.answers) || {};
    var head = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">' +
      '<span style="font-size:10px;letter-spacing:2px;color:var(--teal)">📋 PRODUCT INTAKE</span>' +
      (existing && existing.updated_at ? '<span style="font-size:10px;color:#6b7c93">updated '+esc(String(existing.updated_at).slice(0,10))+(existing.source?(' · '+esc(existing.source)):'')+'</span>' : '') +
    '</div>';
    var wrap = '<div style="background:rgba(196,164,248,.05);border:1px solid rgba(196,164,248,.2);border-radius:12px;padding:14px 16px">';

    if(editing){
      host.innerHTML = wrap + head + '<div id="gl-intake-form"></div>' +
        '<div style="display:flex;gap:8px;margin-top:10px">' +
          '<button id="gl-intake-save" style="padding:8px 16px;background:var(--teal);color:#04231d;border:none;border-radius:8px;font-weight:800;font-size:13px;cursor:pointer">Save intake</button>' +
          '<button id="gl-intake-cancel" style="padding:8px 14px;background:rgba(255,255,255,.06);color:#c7d2e0;border:1px solid rgba(255,255,255,.14);border-radius:8px;font-size:13px;cursor:pointer">Cancel</button>' +
          '<span id="gl-intake-msg" style="font-size:12px;color:#9aa7bd;align-self:center"></span>' +
        '</div></div>';
      window.GL_INTAKE.render(host.querySelector('#gl-intake-form'), answers);
      host.querySelector('#gl-intake-cancel').onclick = function(){ paint(host, ctx, existing, false); };
      host.querySelector('#gl-intake-save').onclick = async function(){
        var btn = this; var msg = host.querySelector('#gl-intake-msg');
        var res = window.GL_INTAKE.collect(host.querySelector('#gl-intake-form'));
        btn.disabled = true; msg.textContent = 'Saving…';
        var out = await saveIntake(ctx, existing, res.answers);
        if(!out.ok){ btn.disabled=false; msg.style.color='#ff8579'; msg.textContent='Could not save — try again.'; return; }
        // reload the saved row so subsequent edits update it
        var fresh = await loadIntake(ctx);
        if(typeof window.addNotification==='function') window.addNotification('📋 Intake saved', (ctx.name||'Account'), 'success');
        paint(host, ctx, fresh || Object.assign({}, existing||{}, { id:out.id, answers:res.answers, updated_at:new Date().toISOString(), source:'staff' }), false);
      };
      return;
    }

    var body;
    if(!existing){
      body = '<div style="font-size:12px;color:#9aa7bd;margin-bottom:10px">No intake questionnaire on file yet.</div>' +
        '<button id="gl-intake-add" style="padding:7px 14px;background:rgba(0,229,192,.12);color:var(--teal);border:1px solid rgba(0,229,192,.3);border-radius:8px;font-weight:700;font-size:12.5px;cursor:pointer">＋ Fill intake</button>';
    } else {
      body = readView(answers) +
        '<button id="gl-intake-edit" style="margin-top:8px;padding:6px 13px;background:rgba(255,255,255,.05);color:#c7d2e0;border:1px solid rgba(255,255,255,.14);border-radius:8px;font-size:12px;cursor:pointer">✏️ Edit intake</button>';
    }
    host.innerHTML = wrap + head + body + '</div>';
    var add = host.querySelector('#gl-intake-add'); if(add) add.onclick = function(){ paint(host, ctx, existing, true); };
    var ed = host.querySelector('#gl-intake-edit'); if(ed) ed.onclick = function(){ paint(host, ctx, existing, true); };
  }

  console.log('[GL] intake module loaded');
})();
