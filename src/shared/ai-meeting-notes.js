/*
 * ai-meeting-notes.js — extracted from crm-index-core.js (GL-037).
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
 * Declares: openMeetingNotesModal, closeMeetingNotesModal, generateMeetingNotes, saveMeetingNotes
 */
/* ═══════════════════════════════════════════
   AI MEETING NOTES
═══════════════════════════════════════════ */
function openMeetingNotesModal(){
  const sel=document.getElementById('mn-client');
  sel.innerHTML='<option value="">Select client…</option>'+clients.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
  document.getElementById('mn-output').style.display='none';
  document.getElementById('mn-save-btn').style.display='none';
  document.getElementById('meeting-notes-modal').classList.add('show');
}
function closeMeetingNotesModal(){ document.getElementById('meeting-notes-modal').classList.remove('show'); }

async function generateMeetingNotes(){
  const bullets=document.getElementById('mn-bullets').value.trim();
  if(!bullets){alert('Enter your meeting notes first');return;}
  const clientId=document.getElementById('mn-client').value;
  const client=clients.find(c=>c.id===clientId);
  
  showAIModal('Generating Meeting Notes...','',true);
  const text=await callAI('You are a professional business note-taker for Good Liquid Bev Co, a beverage co-packer.',
    `Expand these meeting bullet points into professional meeting notes:
    Client: ${client?client.name:'Unknown'}
    Date: ${new Date().toLocaleDateString()}
    
    Bullet points:
    ${bullets}
    
    Format as: Meeting Summary, Key Discussion Points, Action Items, Next Steps. Be concise but professional.`);
  
  closeAIModal();
  document.getElementById('mn-result').textContent=text;
  document.getElementById('mn-output').style.display='block';
  document.getElementById('mn-save-btn').style.display='inline-flex';
}

async function saveMeetingNotes(){
  const clientId=document.getElementById('mn-client').value;
  const notes=document.getElementById('mn-result').textContent;
  const client=clients.find(c=>c.id===clientId);
  // Persist the FULL note to the database — the activity feed only keeps an
  // 80-char preview, so previously the note body was lost on refresh.
  if(window.supa && /^[0-9a-f-]{36}$/i.test(clientId||'') && notes && notes.trim()){
    try {
      const r = await window.supa.from('client_notes').insert([{
        client_id: clientId, body: notes,
        author_name:  (window.currentUser&&window.currentUser.name)||null,
        author_email: (window.currentUser&&window.currentUser.email)||null
      }]);
      if(r.error){ addNotification('⚠ Meeting notes NOT saved', r.error.message, 'error'); return; }
    } catch(e){ addNotification('⚠ Meeting notes NOT saved', e.message||'error', 'error'); return; }
  }
  activities.unshift({type:'note',icon:'📝',name:'Meeting notes: '+(client?client.name:'General'),detail:notes.substring(0,80)+'…',time:'Just now'});saveActivities();
  addNotification('📝 Meeting notes saved','Notes saved for '+(client?client.name:'General'),'success');
  closeMeetingNotesModal();
}
