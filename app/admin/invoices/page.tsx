'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<any[]>([])
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [loading, setLoading] = useState(true)

  async function load() {
    const { data } = await supabase.from('invoices').select('*').order('created_at', { ascending: false })
    setInvoices(data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function updateStatus(id: string, status: string) {
    await supabase.from('invoices').update({ status }).eq('id', id)
    load()
  }

  const filtered = invoices.filter(i => {
    const matchSearch = i.client_name?.toLowerCase().includes(search.toLowerCase()) || i.invoice_number?.includes(search)
    const matchFilter = filter === 'all' || i.status === filter
    return matchSearch && matchFilter
  })

  const statusColor: any = { paid: '#065f46', pending: '#92400e', overdue: '#991b1b', draft: '#374151' }
  const statusBg: any = { paid: '#d1fae5', pending: '#fef3c7', overdue: '#fee2e2', draft: '#e5e7eb' }

  return (
    <div>
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'24px', flexWrap:'wrap', gap:'12px'}}>
        <h1 style={{fontSize:'28px', fontWeight:'900', color:'#1c2e48'}}>Invoices</h1>
        <a href="/admin/invoices/new" style={{background:'#0F6E56', color:'white', padding:'10px 20px', borderRadius:'8px', fontWeight:'700', textDecoration:'none'}}>+ New Invoice</a>
      </div>

      <div style={{display:'flex', gap:'12px', marginBottom:'20px', flexWrap:'wrap'}}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..." style={{flex:1, minWidth:'200px', padding:'10px', borderRadius:'8px', border:'1px solid #ddd', fontSize:'15px'}} />
        {['all','draft','pending','paid','overdue'].map(s => (
          <button key={s} onClick={() => setFilter(s)} style={{padding:'8px 16px', borderRadius:'8px', border:'none', cursor:'pointer', fontWeight:'600', fontSize:'13px', background: filter === s ? '#1c2e48' : '#e5e7eb', color: filter === s ? 'white' : '#666'}}>
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {loading ? <div style={{color:'#666'}}>Loading...</div> : (
        <div style={{display:'grid', gap:'12px'}}>
          {filtered.map(inv => (
            <div key={inv.id} style={{background:'white', borderRadius:'12px', padding:'20px', boxShadow:'0 1px 4px rgba(0,0,0,0.08)'}}>
              <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', flexWrap:'wrap', gap:'12px'}}>
                <div>
                  <div style={{fontWeight:'900', color:'#1c2e48', fontSize:'16px'}}>{inv.invoice_number}</div>
                  <div style={{color:'#666', fontSize:'15px', marginTop:'4px'}}>{inv.client_name} • {inv.service}</div>
                  <div style={{color:'#999', fontSize:'13px', marginTop:'4px'}}>Due: {inv.due_date || 'N/A'}</div>
                </div>
                <div style={{display:'flex', alignItems:'center', gap:'12px', flexWrap:'wrap'}}>
                  <div style={{fontSize:'24px', fontWeight:'900', color:'#1c2e48'}}>${inv.amount?.toLocaleString()}</div>
                  <span style={{background: statusBg[inv.status], color: statusColor[inv.status], padding:'4px 12px', borderRadius:'20px', fontSize:'13px', fontWeight:'600'}}>{inv.status}</span>
                </div>
              </div>
              <div style={{display:'flex', gap:'8px', marginTop:'16px', flexWrap:'wrap'}}>
                {inv.status !== 'paid' && <button onClick={() => updateStatus(inv.id, 'paid')} style={{background:'#d1fae5', color:'#065f46', border:'none', padding:'6px 14px', borderRadius:'8px', cursor:'pointer', fontWeight:'600', fontSize:'13px'}}>✓ Mark Paid</button>}
                {inv.status !== 'overdue' && inv.status !== 'paid' && <button onClick={() => updateStatus(inv.id, 'overdue')} style={{background:'#fee2e2', color:'#991b1b', border:'none', padding:'6px 14px', borderRadius:'8px', cursor:'pointer', fontWeight:'600', fontSize:'13px'}}>Mark Overdue</button>}
                {inv.status === 'draft' && <button onClick={() => updateStatus(inv.id, 'pending')} style={{background:'#fef3c7', color:'#92400e', border:'none', padding:'6px 14px', borderRadius:'8px', cursor:'pointer', fontWeight:'600', fontSize:'13px'}}>Send Invoice</button>}
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <div style={{color:'#666', textAlign:'center', padding:'60px'}}>
              No invoices yet. <a href="/admin/invoices/new" style={{color:'#0F6E56', fontWeight:'600'}}>Create your first →</a>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
