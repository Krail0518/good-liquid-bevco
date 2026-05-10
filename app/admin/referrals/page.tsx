'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export default function ReferralsPage() {
  const [referrers, setReferrers] = useState<any[]>([])
  const [referrals, setReferrals] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'referrals'|'referrers'>('referrals')
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ referrer_id: '', client_name: '', deal_value: '', commission_rate: '5', notes: '' })

  async function load() {
    const [{ data: rs }, { data: refs }] = await Promise.all([
      supabase.from('referrers').select('*').order('name'),
      supabase.from('referrals').select('*').order('created_at', { ascending: false })
    ])
    setReferrers(rs || [])
    setReferrals(refs || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function addReferral(e: React.FormEvent) {
    e.preventDefault()
    const commission_amount = (Number(form.deal_value) * Number(form.commission_rate)) / 100
    await supabase.from('referrals').insert([{ ...form, deal_value: Number(form.deal_value), commission_rate: Number(form.commission_rate), commission_amount, status: 'lead' }])
    setShowAdd(false)
    load()
  }

  async function updateStatus(id: string, status: string) {
    const updates: any = { status }
    if (status === 'paid') updates.date_paid = new Date().toISOString().split('T')[0]
    await supabase.from('referrals').update(updates).eq('id', id)
    load()
  }

  const statusColor: any = { lead: '#92400e', presented: '#1e40af', won: '#065f46', paid: '#374151', lost: '#991b1b' }
  const statusBg: any = { lead: '#fef3c7', presented: '#dbeafe', won: '#d1fae5', paid: '#e5e7eb', lost: '#fee2e2' }
  const totalOwed = referrals.filter(r => r.status === 'won').reduce((s, r) => s + (r.commission_amount || 0), 0)

  return (
    <div>
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'24px', flexWrap:'wrap', gap:'12px'}}>
        <h1 style={{fontSize:'28px', fontWeight:'900', color:'#1c2e48'}}>Referrals</h1>
        <div style={{display:'flex', gap:'12px', alignItems:'center'}}>
          {totalOwed > 0 && <div style={{background:'#fef3c7', color:'#92400e', padding:'8px 16px', borderRadius:'8px', fontWeight:'700'}}>Owed: ${totalOwed.toFixed(2)}</div>}
          <button onClick={() => setShowAdd(true)} style={{background:'#0F6E56', color:'white', padding:'10px 20px', borderRadius:'8px', border:'none', fontWeight:'700', cursor:'pointer'}}>+ Log Referral</button>
        </div>
      </div>

      <div style={{display:'flex', gap:'8px', marginBottom:'20px'}}>
        {(['referrals','referrers'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{padding:'8px 20px', borderRadius:'8px', border:'none', cursor:'pointer', fontWeight:'600', background: tab === t ? '#1c2e48' : '#e5e7eb', color: tab === t ? 'white' : '#666'}}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {showAdd && (
        <div style={{position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:100, display:'flex', alignItems:'center', justifyContent:'center', padding:'20px'}}>
          <div style={{background:'white', borderRadius:'16px', padding:'32px', width:'100%', maxWidth:'480px'}}>
            <h2 style={{marginBottom:'20px', color:'#1c2e48'}}>Log Referral</h2>
            <form onSubmit={addReferral} style={{display:'flex', flexDirection:'column', gap:'14px'}}>
              <select value={form.referrer_id} onChange={e => setForm({...form, referrer_id: e.target.value})} required style={{padding:'10px', borderRadius:'8px', border:'1px solid #ddd', fontSize:'15px'}}>
                <option value="">Select Referrer</option>
                {referrers.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
              <input placeholder="Client / Brand Name" value={form.client_name} onChange={e => setForm({...form, client_name: e.target.value})} required style={{padding:'10px', borderRadius:'8px', border:'1px solid #ddd', fontSize:'15px'}} />
              <input placeholder="Deal Value ($)" type="number" value={form.deal_value} onChange={e => setForm({...form, deal_value: e.target.value})} style={{padding:'10px', borderRadius:'8px', border:'1px solid #ddd', fontSize:'15px'}} />
              <input placeholder="Commission Rate (%)" type="number" value={form.commission_rate} onChange={e => setForm({...form, commission_rate: e.target.value})} style={{padding:'10px', borderRadius:'8px', border:'1px solid #ddd', fontSize:'15px'}} />
              <div style={{background:'#f0f4f8', padding:'12px', borderRadius:'8px', fontWeight:'700', color:'#0F6E56'}}>
                Commission: ${((Number(form.deal_value) * Number(form.commission_rate)) / 100).toFixed(2)}
              </div>
              <div style={{display:'flex', gap:'12px'}}>
                <button type="submit" style={{flex:1, background:'#0F6E56', color:'white', padding:'12px', borderRadius:'8px', border:'none', fontWeight:'700', cursor:'pointer'}}>Save</button>
                <button type="button" onClick={() => setShowAdd(false)} style={{flex:1, background:'#f0f4f8', color:'#666', padding:'12px', borderRadius:'8px', border:'none', cursor:'pointer'}}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {loading ? <div style={{color:'#666'}}>Loading...</div> : tab === 'referrals' ? (
        <div style={{display:'grid', gap:'12px'}}>
          {referrals.map(r => {
            const referrer = referrers.find(rf => rf.id === r.referrer_id)
            return (
              <div key={r.id} style={{background:'white', borderRadius:'12px', padding:'20px', boxShadow:'0 1px 4px rgba(0,0,0,0.08)'}}>
                <div style={{display:'flex', justifyContent:'space-between', flexWrap:'wrap', gap:'12px'}}>
                  <div>
                    <div style={{fontWeight:'700', color:'#1c2e48', fontSize:'16px'}}>{r.client_name}</div>
                    <div style={{color:'#666', fontSize:'14px'}}>Referred by: {referrer?.name || 'Unknown'}</div>
                    <div style={{color:'#0F6E56', fontWeight:'700', marginTop:'4px'}}>Commission: ${(r.commission_amount||0).toFixed(2)} ({r.commission_rate}%)</div>
                  </div>
                  <span style={{background: statusBg[r.status], color: statusColor[r.status], padding:'4px 14px', borderRadius:'20px', fontSize:'13px', fontWeight:'600', height:'fit-content'}}>{r.status}</span>
                </div>
                <div style={{display:'flex', gap:'8px', marginTop:'14px', flexWrap:'wrap'}}>
                  {r.status === 'lead' && <button onClick={() => updateStatus(r.id, 'presented')} style={{background:'#dbeafe', color:'#1e40af', border:'none', padding:'6px 14px', borderRadius:'8px', cursor:'pointer', fontWeight:'600', fontSize:'13px'}}>Mark Presented</button>}
                  {r.status === 'presented' && <button onClick={() => updateStatus(r.id, 'won')} style={{background:'#d1fae5', color:'#065f46', border:'none', padding:'6px 14px', borderRadius:'8px', cursor:'pointer', fontWeight:'600', fontSize:'13px'}}>Mark Won</button>}
                  {r.status === 'won' && <button onClick={() => updateStatus(r.id, 'paid')} style={{background:'#1c2e48', color:'white', border:'none', padding:'6px 14px', borderRadius:'8px', cursor:'pointer', fontWeight:'600', fontSize:'13px'}}>Pay ${(r.commission_amount||0).toFixed(2)}</button>}
                  {r.status !== 'lost' && r.status !== 'paid' && <button onClick={() => updateStatus(r.id, 'lost')} style={{background:'#fee2e2', color:'#991b1b', border:'none', padding:'6px 14px', borderRadius:'8px', cursor:'pointer', fontWeight:'600', fontSize:'13px'}}>Mark Lost</button>}
                </div>
              </div>
            )
          })}
          {referrals.length === 0 && <div style={{color:'#666', textAlign:'center', padding:'60px'}}>No referrals yet.</div>}
        </div>
      ) : (
        <div style={{display:'grid', gap:'12px'}}>
          {referrers.map(r => (
            <div key={r.id} style={{background:'white', borderRadius:'12px', padding:'20px', boxShadow:'0 1px 4px rgba(0,0,0,0.08)', display:'flex', alignItems:'center', gap:'16px', flexWrap:'wrap'}}>
              <div style={{width:'48px', height:'48px', borderRadius:'50%', background:'#1a3a6e', color:'white', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:'900', fontSize:'16px', flexShrink:0}}>
                {r.initials || r.name?.[0]}
              </div>
              <div style={{flex:1}}>
                <div style={{fontWeight:'700', color:'#1c2e48', fontSize:'16px'}}>{r.name}</div>
                <div style={{color:'#666', fontSize:'14px'}}>{r.relationship} • {r.email}</div>
              </div>
              <div style={{fontWeight:'700', color:'#0F6E56'}}>{r.default_rate}% commission</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
