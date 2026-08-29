/*
 * tasks.js — extracted from crm-index-core.js (GL-037).
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
 * Declares: glTasksBackfill, loadTasks, openTaskModal, closeTaskModal, saveTask, setTaskFilter, renderTasks, toggleTask, deleteTask
 */
/* ═══════════════════════════════════════════
   TASK MANAGEMENT
   Source of truth is public.tasks in Supabase. In-memory cache
   refreshed by loadTasks() on each page open + after mutations.
═══════════════════════════════════════════ */
let tasks = [];
let taskFilter = 'all';

async function glTasksBackfill(){
  try {
    if(localStorage.getItem('gl_tasks_migrated') === '1') return;
    if(!window.supa || !window.currentUser) return;
    const blob = localStorage.getItem('gl_tasks');
    if(!blob){ localStorage.setItem('gl_tasks_migrated','1'); return; }
    let legacy = [];
    try { legacy = JSON.parse(blob) || []; } catch(_e){ return; }
    if(!legacy.length){ localStorage.setItem('gl_tasks_migrated','1'); return; }
    const userId = window.currentUser.id;
    const rows = legacy.map(t => ({
      user_id:   userId,
      title:     String(t.title || '(untitled)').slice(0, 500),
      due_date:  t.due || null,
      priority:  ['high','medium','low'].includes(t.priority) ? t.priority : null,
      client_id: /^[0-9a-f-]{36}$/i.test(t.clientId||'') ? t.clientId : null,
      notes:     t.notes || null,
      done:      !!t.done,
      done_at:   t.done ? new Date().toISOString() : null,
      created_at: t.createdAt || new Date().toISOString()
    }));
    const r = await window.supa.from('tasks').insert(rows);
    if(r.error){ console.warn('[GL] tasks backfill failed', r.error.message); return; }
    localStorage.setItem('gl_tasks_migrated','1');
    if(typeof addNotification === 'function'){
      addNotification('✅ Tasks migrated', rows.length + ' task' + (rows.length===1?'':'s') + ' moved from device storage to the cloud.', 'success');
    }
  } catch(e){ console.warn('[GL] tasks backfill threw', e); }
}

async function loadTasks(){
  if(!window.supa || !window.currentUser){ tasks = []; return; }
  await glTasksBackfill();
  const r = await window.supa.from('tasks')
    .select('id, title, due_date, priority, client_id, notes, done, created_at')
    .eq('user_id', window.currentUser.id)
    .order('done', { ascending: true })
    .order('due_date', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(500);
  if(r.error){ console.warn('[GL] loadTasks failed', r.error.message); tasks = []; return; }
  // Keep the shape the existing renderer expects.
  tasks = (r.data || []).map(t => ({
    id:        t.id,
    title:     t.title,
    due:       t.due_date,
    priority:  t.priority,
    clientId:  t.client_id,
    notes:     t.notes,
    done:      !!t.done,
    createdAt: t.created_at
  }));
}

function openTaskModal(){
  const sel=document.getElementById('task-client-link');
  sel.innerHTML='<option value="">None</option>'+clients.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
  document.getElementById('task-modal').classList.add('show');
}
function closeTaskModal(){ document.getElementById('task-modal').classList.remove('show'); }

async function saveTask(){
  const title=document.getElementById('task-title-inp').value.trim();
  if(!title){alert('Task title required');return;}
  if(!window.supa || !window.currentUser){ alert('Cloud sync unavailable — try reloading.'); return; }
  const due = document.getElementById('task-due').value || null;
  const priority = document.getElementById('task-priority').value || null;
  const clientId = document.getElementById('task-client-link').value || null;
  const notes = document.getElementById('task-notes').value || null;
  const r = await window.supa.from('tasks').insert([{
    user_id:   window.currentUser.id,
    title:     title,
    due_date:  due,
    priority:  ['high','medium','low'].includes(priority) ? priority : null,
    client_id: /^[0-9a-f-]{36}$/i.test(clientId||'') ? clientId : null,
    notes:     notes,
    done:      false
  }]);
  if(r.error){ alert('Save failed: ' + r.error.message); return; }
  await loadTasks();
  renderTasks();
  closeTaskModal();
  document.getElementById('task-title-inp').value='';
  document.getElementById('task-notes').value='';
  if(typeof glAudit === 'function') glAudit('task_created', clientId || null, { title: title.slice(0,80) });
  addNotification('✅ Task added: '+title, due ? 'Due '+due : 'No due date', 'success');
}

function setTaskFilter(el,f){
  taskFilter=f;
  document.querySelectorAll('.cpill').forEach(p=>p.classList.remove('act'));
  el.classList.add('act');
  renderTasks();
}

function renderTasks(){
  const el=document.getElementById('task-list');
  if(!el) return;
  let filtered=tasks;
  if(taskFilter==='open') filtered=tasks.filter(t=>!t.done);
  else if(taskFilter==='done') filtered=tasks.filter(t=>t.done);
  else if(taskFilter==='high') filtered=tasks.filter(t=>t.priority==='high'&&!t.done);
  else if(taskFilter==='medium') filtered=tasks.filter(t=>t.priority==='medium'&&!t.done);

  const sub=document.getElementById('task-sub');
  if(sub) sub.textContent=filtered.filter(t=>!t.done).length+' open tasks';

  if(!filtered.length){el.innerHTML='<div style="color:var(--muted);font-size:13px;padding:20px 0">No tasks found.</div>';return;}

  el.innerHTML=filtered.map(t=>{
    const client=clients.find(c=>c.id===t.clientId);
    const overdue=t.due&&new Date(t.due)<new Date()&&!t.done;
    const safeTitle = String(t.title||'').replace(/[&<>]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[m]));
    const safeNotes = t.notes ? String(t.notes).replace(/[&<>]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[m])) : '';
    return `<div class="task-item">
      <div class="task-check ${t.done?'done':''}" data-gl-action="toggleTask" data-gl-arg1="${esc(t.id)}">${t.done?'✓':''}</div>
      <div style="flex:1">
        <div class="task-title ${t.done?'done':''}">${safeTitle}</div>
        <div class="task-meta">
          ${t.priority?`<span class="priority-badge ${t.priority}">${t.priority.charAt(0).toUpperCase()+t.priority.slice(1)}</span>`:''}
          ${t.due?`<span style="margin-left:8px;color:${overdue?'#e74c3c':'var(--muted)'}">📅 ${t.due}${overdue?' (overdue)':''}</span>`:''}
          ${client?`<span style="margin-left:8px;color:var(--muted)">👤 ${esc(client.name)}</span>`:''}
        </div>
        ${safeNotes?`<div style="font-size:11px;color:var(--muted);margin-top:3px">${safeNotes}</div>`:''}
      </div>
      <button class="cbtn red" style="font-size:10px;padding:3px 7px" data-gl-action="deleteTask" data-gl-arg1="${esc(t.id)}">✕</button>
    </div>`;
  }).join('');
}

async function toggleTask(id){
  if(!window.supa){ return; }
  const t=tasks.find(x=>x.id===id);
  if(!t) return;
  const nextDone = !t.done;
  const r = await window.supa.from('tasks').update({
    done: nextDone,
    done_at: nextDone ? new Date().toISOString() : null
  }).eq('id', id);
  if(r.error){ alert('Update failed: ' + r.error.message); return; }
  t.done = nextDone;
  renderTasks();
  if(typeof glAudit === 'function') glAudit(nextDone ? 'task_completed' : 'task_reopened', null, { task_id: id });
}

async function deleteTask(id){
  if(!window.supa){ return; }
  if(!confirm('Delete this task?')) return;
  const res = await glCheckedDelete(sb => sb.from('tasks').delete().eq('id', id).select('id'));
  if(!res.ok){ alert('Delete failed — the task has NOT been deleted: ' + res.reason); return; }
  tasks = tasks.filter(t => t.id !== id);
  renderTasks();
  if(typeof glAudit === 'function') glAudit('task_deleted', null, { task_id: id });
}
