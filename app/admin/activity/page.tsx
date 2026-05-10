'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

const TYPE_ICONS: any = { call: '📞', email: '✉️', deal: '💰', note: '📝', ref: '🤝', invoice: '🧾' }

export default function ActivityPage() {
  const [activity, setActivity] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ type: 'note', title: '', detail: '' })
  const [saving, setSaving] = useState(false)

  async function load() {
    const { data } = await supabase.from('activity').select('*').order('created_at', { ascending: false }).limit(50)
    setActivity(data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function addActivity(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    await supabase.from('activity').insert([form])
    setForm({ type: 'note', title: '', detail: '' })
    setSaving(false)
    load()
  }

  return (
    <div>
      <h1 style={{fontSize:'28px', fontWeight:'900', color:'#1c2e48', marginBottom:'24px'}}>Activity Log</h1>

      <div style={{background:'white', borderRadius:'12px', padding:'24px', boxShadow:'0 1px 4px rgba(0,0,0,0.08)', marginBottom:'24px'}}>
        <h2 style={{fontSize:'16px', fontWeight:'700', color:'#1c2e48', marginBottom:'16px'}}>Log Activity</h2>
        <form onSubmit={addActivity} style={{display:'flex', flexDirection:'column', gap:'12px'}}>
          <div style={{display:'flex', gap:'12px', flexWrap:'wrap'}}>
            <select value={form.type} onChange={e => setForm({...form, type: e.target.value})} style={{padding:'10px', borderRadius:'8px', border:'1px solid #ddd', fontSize:'14px'}}>
              {Object.keys(TYPE_ICONS).map(t => <option key={t} value={t}>{TYPE_ICONS[t]} {t.charAt(0).toUpperCase()+t.slice(1)}</option>)}
            </select>
            <input placeholder="Title" value={form.title} onChange={e => setForm({...form, title: e.target.value})} required style={{flex:1, minWidth:'200px', padding:'10px', borderRadius:'8px', border:'1px solid #ddd', fontSize:'14px'}} />
          </div>
          <textarea placeholder="Details (optional)" value={form.detail} onChange={e => setForm({...form, detail: e.target.value})} rows={2} style={{padding:'10px', borderRadius:'8px', border:'1px solid #ddd', fontSize:'14px', resize:'vertical'}} />
          <button type="submit" disabled={saving} style={{background:'#0F6E56', color:'white', padding:'10px 24px', borderRadius:'8px', border:'none', fontWeight:'700', cursor:'pointer', alignSelf:'flex-start'}}>
            {saving ? 'Saving...' : 'Log Activity'}
          </button>
        </form>
      </div>

      {loading ? <div style={{color:'#666'}}>Loading...</div> : (
        <div style={{display:'flex', flexDirection:'column', gap:'10px'}}>
          {activity.map(a => (
            <div key={a.id} style={{background:'white', borderRadius:'10px', padding:'16px', boxShadow:'0 1px 4px rgba(0,0,0,0.08)', display:'flex', gap:'14px', alignItems:'flex-start'}}>
              <div style={{fontSize:'24px', flexShrink:0}}>{TYPE_ICONS[a.type] || '📋'}</div>
              <div style={{flex:1}}>
                <div style={{fontWeight:'700', color:'#1c2e48'}}>{a.title}</div>
                {a.detail && <div style={{color:'#666', fontSize:'14px', marginTop:'4px'}}>{a.detail}</div>}
                <div style={{color:'#999', fontSize:'12px', marginTop:'6px'}}>{new Date(a.created_at).toLocaleDateString()} {new Date(a.created_at).toLocaleTimeString()}</div>
              </div>
            </div>
          ))}
          {activity.length === 0 && <div style={{color:'#666', textAlign:'center', padding:'60px'}}>No activity logged yet.</div>}
        </div>
      )}
    </div>
  )
}
