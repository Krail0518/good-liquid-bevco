'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export default function ClientsPage() {
  const [clients, setClients] = useState<any[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ name: '', contact_name: '', email: '', phone: '', service: '', status: 'lead', notes: '' })

  async function load() {
    const { data } = await supabase.from('clients').select('*').order('created_at', { ascending: false })
    setClients(data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function addClient(e: React.FormEvent) {
    e.preventDefault()
    const initials = form.name.split(' ').map(n => n[0]).join('').toUpperCase()
    await supabase.from('clients').insert([{ ...form, initials, color: '#1a3a6e', tc: '#9FE1CB' }])
    setShowAdd(false)
    setForm({ name: '', contact_name: '', email: '', phone: '', service: '', status: 'lead', notes: '' })
    load()
  }

  const filtered = clients.filter(c => c.name?.toLowerCase().includes(search.toLowerCase()) || c.contact_name?.toLowerCase().includes(search.toLowerCase()))
  const statusColor: any = { active: '#065f46', lead: '#92400e', inactive: '#374151' }
  const statusBg: any = { active: '#d1fae5', lead: '#fef3c7', inactive: '#e5e7eb' }

  return (
    <div>
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'24px', flexWrap:'wrap', gap:'12px'}}>
        <h1 style={{fontSize:'28px', fontWeight:'900', color:'#1c2e48'}}>Clients</h1>
        <button onClick={() => setShowAdd(true)} style={{background:'#0F6E56', color:'white', padding:'10px 20px', borderRadius:'8px', border:'none', fontWeight:'700', cursor:'pointer'}}>+ Add Client</button>
      </div>

      <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search clients..." style={{width:'100%', padding:'12px', borderRadius:'10px', border:'1px solid #ddd', fontSize:'16px', marginBottom:'20px', boxSizing:'border-box'}} />

      {showAdd && (
        <div style={{position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:100, display:'flex', alignItems:'center', justifyContent:'center', padding:'20px'}}>
          <div style={{background:'white', borderRadius:'16px', padding:'32px', width:'100%', maxWidth:'500px'}}>
            <h2 style={{marginBottom:'20px', color:'#1c2e48'}}>Add Client</h2>
            <form onSubmit={addClient} style={{display:'flex', flexDirection:'column', gap:'14px'}}>
              {[['Brand Name','name'],['Contact Name','contact_name'],['Email','email'],['Phone','phone'],['Service','service']].map(([l,k]) => (
                <input key={k} placeholder={l} value={(form as any)[k]} onChange={e => setForm({...form, [k]: e.target.value})} style={{padding:'10px', borderRadius:'8px', border:'1px solid #ddd', fontSize:'15px'}} />
              ))}
              <select value={form.status} onChange={e => setForm({...form, status: e.target.value})} style={{padding:'10px', borderRadius:'8px', border:'1px solid #ddd', fontSize:'15px'}}>
                <option value="lead">Lead</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
              <textarea placeholder="Notes" value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} style={{padding:'10px', borderRadius:'8px', border:'1px solid #ddd', fontSize:'15px', resize:'vertical'}} rows={3} />
              <div style={{display:'flex', gap:'12px'}}>
                <button type="submit" style={{flex:1, background:'#0F6E56', color:'white', padding:'12px', borderRadius:'8px', border:'none', fontWeight:'700', cursor:'pointer'}}>Save</button>
                <button type="button" onClick={() => setShowAdd(false)} style={{flex:1, background:'#f0f4f8', color:'#666', padding:'12px', borderRadius:'8px', border:'none', cursor:'pointer'}}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {loading ? <div style={{color:'#666'}}>Loading...</div> : (
        <div style={{display:'grid', gap:'12px'}}>
          {filtered.map(c => (
            <div key={c.id} style={{background:'white', borderRadius:'12px', padding:'20px', boxShadow:'0 1px 4px rgba(0,0,0,0.08)', display:'flex', alignItems:'center', gap:'16px', flexWrap:'wrap'}}>
              <div style={{width:'48px', height:'48px', borderRadius:'50%', background:'#1a3a6e', color:'white', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:'900', fontSize:'16px', flexShrink:0}}>
                {c.initials || c.name?.[0]}
              </div>
              <div style={{flex:1, minWidth:'150px'}}>
                <div style={{fontWeight:'700', color:'#1c2e48', fontSize:'16px'}}>{c.name}</div>
                <div style={{color:'#666', fontSize:'14px'}}>{c.contact_name} • {c.email}</div>
                <div style={{color:'#999', fontSize:'13px'}}>{c.service}</div>
              </div>
              <div style={{display:'flex', alignItems:'center', gap:'12px', flexWrap:'wrap'}}>
                <div style={{fontWeight:'700', color:'#1c2e48'}}>${(c.total_billed || 0).toLocaleString()}</div>
                <span style={{background: statusBg[c.status] || '#e5e7eb', color: statusColor[c.status] || '#374151', padding:'4px 12px', borderRadius:'20px', fontSize:'13px', fontWeight:'600'}}>{c.status}</span>
                <a href={`/admin/invoices/new?client=${c.id}&name=${encodeURIComponent(c.name)}`} style={{background:'#0F6E56', color:'white', padding:'6px 14px', borderRadius:'8px', fontSize:'13px', fontWeight:'600', textDecoration:'none'}}>Invoice</a>
              </div>
            </div>
          ))}
          {filtered.length === 0 && <div style={{color:'#666', textAlign:'center', padding:'40px'}}>No clients found.</div>}
        </div>
      )}
    </div>
  )
}
