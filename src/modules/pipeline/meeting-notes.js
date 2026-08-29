/* ============================================================
   meeting-notes.js — meeting notes (Pocket AI NoteTaker etc.)
   ============================================================
   A place to drop meeting notes on any pipeline deal or client. Paste the text
   (the AI brief reads it) and/or attach the source file. Notes are polymorphic:
   opts = { kind:'deal'|'client', id }. Adding or removing a note marks that
   subject's AI brief stale so the summarizer folds it in on the next refresh.

   Backed by public.meeting_notes (+ ai_briefs.stale). Files live in the shared
   client-docs bucket under meeting-notes/<kind>/<id>/…. Staff-only.

   Exposes:
     window.glRenderMeetingNotes(mount, { kind, id })
     window.glMarkBriefStale(kind, id)   — flag a brief for re-summarize
   ============================================================ */
(function(){
  'use strict';

  function sb(){ return window.supa || null; }
  function esc(s){
    return String(s == null ? '' : s).replace(/[<>&"]/g, function(c){
      return { '<':'&lt;', '>':'&gt;', '&':'&amp;', '"':'&quot;' }[c];
    });
  }
  function elOf(m){ return typeof m === 'string' ? document.querySelector(m) : m; }
  function clip(s, n){ s = String(s || ''); return s.length > n ? s.slice(0, n).trim() + '…' : s; }

  // Flag a subject's brief for re-summarization. Upserts an ai_briefs row so the
  // Phase-2 summarizer knows there's something new to fold in, even before a
  // brief has ever been generated for this subject.
  window.glMarkBriefStale = async function glMarkBriefStale(kind, id){
    if(!sb() || !kind || !id) return;
    try {
      await sb().from('ai_briefs')
        .upsert({ subject_kind: kind, subject_id: id, stale: true, updated_at: new Date().toISOString() },
                { onConflict: 'subject_kind,subject_id' });
    } catch(e){ console.warn('[meeting-notes] markBriefStale', e); }
  };

  function uploadFile(kind, id, file){
    window.__lastNoteErr = '';
    if(!file || !sb()){ window.__lastNoteErr = 'Not signed in / storage unavailable'; return Promise.resolve(''); }
    var ext = (file.name.split('.').pop() || 'bin').toLowerCase();
    var path = 'meeting-notes/' + kind + '/' + id + '/' + Date.now() + '_' + Math.random().toString(36).slice(2,7) + '.' + ext;
    return sb().storage.from('client-docs').upload(path, file, { cacheControl:'3600', upsert:false })
      .then(function(r){
        if(r.error){ window.__lastNoteErr = (r.error && (r.error.message || r.error.error)) || 'upload rejected'; return ''; }
        return path;
      })
      .catch(function(e){ window.__lastNoteErr = (e && e.message) || String(e); return ''; });
  }

  function noteRow(r){
    var when = r.meeting_date ? new Date(r.meeting_date + 'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})
                              : (r.created_at ? new Date(r.created_at).toLocaleDateString('en-US',{month:'short',day:'numeric'}) : '');
    var fileLink = r.file_path
      ? ' · <a href="#" data-gl-action="glOpenClientDoc" data-gl-prevent="" data-gl-arg1="'+esc(String(r.file_path).replace(/\x27/g,''))+'" style="color:#00e5c0;font-weight:700">📎 File</a>'
      : '';
    return '<div class="gl-mn-row" data-id="'+esc(r.id)+'" style="padding:10px 0;border-top:1px solid rgba(255,255,255,.06)">' +
        '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">' +
          '<div style="min-width:0">' +
            '<div style="font-weight:700;color:#eef4ff;font-size:13px">📝 '+esc(r.title || 'Meeting notes')+
              '<span style="color:#9aa7bd;font-weight:400;font-size:11px"> · '+esc(when)+fileLink+'</span></div>' +
            (r.body ? '<div style="font-size:12px;color:#c7d2e0;margin-top:4px;line-height:1.5;white-space:pre-wrap">'+esc(clip(r.body, 240))+'</div>' : '') +
          '</div>' +
          '<button class="gl-mn-del" data-id="'+esc(r.id)+'" title="Remove note" style="background:none;border:none;color:#ff8579;cursor:pointer;font-size:15px;flex-shrink:0">🗑</button>' +
        '</div>' +
      '</div>';
  }

  window.glRenderMeetingNotes = async function glRenderMeetingNotes(mount, opts){
    var host = elOf(mount);
    if(!host) return;
    opts = opts || {};
    var kind = opts.kind, id = opts.id;
    if(!kind || !id){ host.innerHTML = ''; return; }
    if(!sb()){ host.innerHTML = '<div style="font-size:11px;color:#9aa7bd">Storage not ready.</div>'; return; }

    var title = '<div style="font-size:10px;letter-spacing:2px;color:var(--teal);margin-bottom:2px">🗒️ MEETING NOTES</div>' +
      '<div style="font-size:11px;color:#9aa7bd;margin-bottom:8px">Paste notes from Pocket AI NoteTaker (or type them). They feed the AI brief for this ' + (kind === 'deal' ? 'lead' : 'client') + '.</div>';

    host.innerHTML = title + '<div style="font-size:11px;color:#9aa7bd">Loading notes…</div>';

    var rows = [];
    try {
      var r = await sb().from('meeting_notes').select('*')
        .eq('subject_kind', kind).eq('subject_id', id)
        .order('meeting_date', { ascending:false, nullsFirst:false }).order('created_at', { ascending:false });
      if(r.error) throw r.error; rows = r.data || [];
    } catch(e){ host.innerHTML = title + '<div style="font-size:11px;color:#ff8579">Could not load notes: '+esc(e.message||e)+'</div>'; return; }

    var inp = 'width:100%;padding:9px 10px;background:#0a1628;border:1px solid rgba(255,255,255,.12);border-radius:7px;color:#fff;font-size:13px;box-sizing:border-box';

    host.innerHTML = title +
      (rows.length ? rows.map(noteRow).join('') : '<div style="font-size:12px;color:#9aa7bd;padding:6px 0">No meeting notes yet.</div>') +
      '<div style="border-top:1px solid rgba(255,255,255,.06);margin-top:8px;padding-top:10px">' +
        '<div style="display:grid;grid-template-columns:1fr 150px;gap:8px">' +
          '<input class="gl-mn-title" placeholder="Note title (e.g. Kickoff call)" style="'+inp+'">' +
          '<input class="gl-mn-date" type="date" style="'+inp+'">' +
        '</div>' +
        '<textarea class="gl-mn-body" rows="4" placeholder="Paste the meeting notes / transcript here…" style="'+inp+';margin-top:8px;resize:vertical;font-family:inherit"></textarea>' +
        '<div style="display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap">' +
          '<input class="gl-mn-file" type="file" accept=".txt,.md,.pdf,.doc,.docx,.rtf,image/*" style="'+inp+';flex:1;min-width:170px;padding:7px">' +
          '<button class="gl-mn-add" style="padding:9px 16px;background:rgba(0,229,192,.14);border:1px solid rgba(0,229,192,.35);border-radius:8px;color:#00e5c0;font-weight:700;font-size:13px;cursor:pointer;white-space:nowrap">＋ Add Note</button>' +
        '</div>' +
        '<div class="gl-mn-msg" style="display:none;font-size:12px;margin-top:8px"></div>' +
      '</div>';

    var msg = host.querySelector('.gl-mn-msg');
    function show(color, text){ msg.style.display='block'; msg.style.color=color; msg.textContent=text; }

    host.querySelector('.gl-mn-add').addEventListener('click', async function(){
      var btn = this;
      var titleV = (host.querySelector('.gl-mn-title').value || '').trim();
      var dateV  = host.querySelector('.gl-mn-date').value || null;
      var bodyV  = (host.querySelector('.gl-mn-body').value || '').trim();
      var fileEl = host.querySelector('.gl-mn-file');
      var file   = fileEl.files && fileEl.files[0];
      if(!bodyV && !file){ show('#f5c842','Paste some notes or attach a file.'); return; }
      btn.disabled = true; btn.textContent = 'Saving…';
      var path = '';
      if(file){
        path = await uploadFile(kind, id, file);
        if(!path){ btn.disabled=false; btn.textContent='＋ Add Note'; show('#ff8579','Upload failed'+(window.__lastNoteErr?(' ('+window.__lastNoteErr+')'):'')+'.'); return; }
      }
      var uploader = (window.currentUser && (window.currentUser.name || window.currentUser.email)) || 'Staff';
      try {
        var ins = await sb().from('meeting_notes').insert([{
          subject_kind: kind, subject_id: id,
          title: titleV || 'Meeting notes', meeting_date: dateV,
          body: bodyV || null, file_path: path || null,
          file_type: file ? (file.name.split('.').pop()||'').toLowerCase() : null,
          uploaded_by: uploader
        }]);
        if(ins.error) throw ins.error;
      } catch(e){ btn.disabled=false; btn.textContent='＋ Add Note'; show('#ff8579','Save failed: '+(e.message||e)); return; }
      await window.glMarkBriefStale(kind, id);
      if(typeof window.glAudit === 'function') window.glAudit('meeting_note_added', titleV || 'note', { kind: kind, id: id });
      glRenderMeetingNotes(host, opts);
    });

    Array.prototype.forEach.call(host.querySelectorAll('.gl-mn-del'), function(b){
      b.addEventListener('click', async function(){
        if(!confirm('Remove this meeting note?')) return;
        var nid = this.getAttribute('data-id');
        // Row-level security refuses a delete by returning ZERO ROWS and no
        // error, so the empty catch that used to be here reported success on
        // a note the database had kept. The re-render then hid it, and it
        // reappeared on reload. Ask for the removed rows back and treat an
        // empty array as failure — CLAUDE.md rule 4.
        var dq;
        try { dq = await sb().from('meeting_notes').delete().eq('id', nid).select(); }
        catch(e){ dq = { error: e }; }
        if(dq && dq.error){
          alert('Could not remove the note: ' + (dq.error.message || dq.error));
          return;
        }
        if(!dq || !Array.isArray(dq.data) || dq.data.length === 0){
          alert('The server refused to remove that note (0 rows changed). It is unchanged.');
          return;
        }
        await window.glMarkBriefStale(kind, id);
        glRenderMeetingNotes(host, opts);
      });
    });
  };

  console.log('[GL] meeting-notes module loaded');
}());
