'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export default function Dashboard() {
  const [stats, setStats] = useState({ clients: 0, invoices: 0, revenue: 0, pending: 0 })
  const [invoices, setInvoices] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const [{ count: clients }, { data: inv }] = await Promise.all([
        supabase.from('clients').select('*', { count: 'exact', head: true }),
        supabase.from('invoices').select('*').order('created_at', { ascending: false }).limit(5)
      ])
      const all = inv || []
      setInvoices(all)
      setStats({
        clients: clients || 0,
        invoices: all.length,
        revenue: all.filter((i: any) => i.status === 'paid').reduce((s: number, i: any) => s + i.amount, 0),
        pending: all.filter((i: any) => i.status === 'pending' || i.status === 'overdue').reduce((s: number, i: any) => s + i.amount, 0),
      })
      setLoading(false)
    }
    load()
  }, [])

  const cards = [
    { label: 'Active Clients', value: stats.clients, color: '#4fd1b0' },
    { label: 'Revenue Collected', value: `$${stats.revenue.toLocaleString()}`, color: '#38bdf8' },
    { label: 'Pending / Overdue', value: `$${stats.pending.toLocaleString()}`, color: '#f87171' },
    { label: 'Recent Invoices', value: stats.invoices, color: '#a78bfa' },
  ]

  const statusColor: any = { paid: '#065f46', pending: '#92400e', overdue: '#991b1b', draft: '#374151' }
  const statusBg: any = { paid: '#d1fae5', pending: '#fef3c7', overdue: '#fee2e2', draft: '#e5e7eb' }

  return (
    <div>
      <h1 style={{fontSize:'28px', fontWeight:'900', color:'#1c2e48', marginBottom:'24px'}}>Dashboard</h1>
      {loading ? <div style={{color:'#666'}}>Loading...</div> : (
        <>
          <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))', gap:'16px', marginBottom:'32px'}}>
            {cards.map(c => (
              <div key={c.label} style={{background:'white', borderRadius:'12px', padding:'24px', boxShadow:'0 1px 4px rgba(0,0,0,0.08)', borderTop:`4px solid ${c.color}`}}>
                <div style={{color:'#666', fontSize:'13px', marginBottom:'8px'}}>{c.label}</div>
                <div style={{fontSize:'32px', fontWeight:'900', color:'#1c2e48'}}>{c.value}</div>
              </div>
            ))}
          </div>

          <div style={{background:'white', borderRadius:'12px', padding:'24px', boxShadow:'0 1px 4px rgba(0,0,0,0.08)'}}>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'16px'}}>
              <h2 style={{fontSize:'18px', fontWeight:'700', color:'#1c2e48'}}>Recent Invoices</h2>
              <a href="/admin/invoices" style={{color:'#0F6E56', fontSize:'14px', textDecoration:'none', fontWeight:'600'}}>View All →</a>
            </div>
            {invoices.length === 0 ? (
              <div style={{color:'#666', textAlign:'center', padding:'40px'}}>No invoices yet. <a href="/admin/invoices/new" style={{color:'#0F6E56'}}>Create one →</a></div>
            ) : (
              <table style={{width:'100%', borderCollapse:'collapse'}}>
                <thead>
                  <tr style={{borderBottom:'2px solid #f0f4f8'}}>
                    {['Invoice','Client','Service','Amount','Status'].map(h => (
                      <th key={h} style={{textAlign:'left', padding:'10px', fontSize:'13px', color:'#666', fontWeight:'600'}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv: any) => (
                    <tr key={inv.id} style={{borderBottom:'1px solid #f0f4f8'}}>
                      <td style={{padding:'12px 10px', fontWeight:'600', color:'#1c2e48', fontSize:'14px'}}>{inv.invoice_number}</td>
                      <td style={{padding:'12px 10px', fontSize:'14px'}}>{inv.client_name}</td>
                      <td style={{padding:'12px 10px', fontSize:'14px', color:'#666'}}>{inv.service}</td>
                      <td style={{padding:'12px 10px', fontWeight:'700', color:'#1c2e48'}}>${inv.amount?.toLocaleString()}</td>
                      <td style={{padding:'12px 10px'}}>
                        <span style={{background: statusBg[inv.status] || '#e5e7eb', color: statusColor[inv.status] || '#374151', padding:'3px 10px', borderRadius:'20px', fontSize:'12px', fontWeight:'600'}}>
                          {inv.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  )
}
