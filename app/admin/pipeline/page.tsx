'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

const STAGES = ['Prospecting', 'Proposal', 'Negotiation', 'Closed Won']

export default function PipelinePage() {
  const [deals, setDeals] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ name: '', client_name: '', value: '', stage: 'Prospecting', probability: '20', notes: '' })

  async function load() {
    const { data } = await supabase.from('deals').select('*').order('created_at', { ascending: false })
    setDeals(data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function addDeal(e: React.FormEvent) {
    e.preventDefault()
    await supabase.from('deals').insert([{ ...form, value: Number(form.value), probability: Number(form.probability) }])
    setShowAdd(false)
    setForm({ name: '', client_name: '', value: '', stage: 'Prospecting', probability: '20', notes: '' })
    load()
  }

  async function moveDeal(id: string, stage: string) {
    await supabase.from('deals').update({ stage }).eq('id', id)
    load()
  }

  const totalPipeline = deals.filter(d => d.stage !== 'Closed Won').reduce((s, d) => s + (d.value || 0), 0)

  return (
    <div>
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'8px', flexWrap:'wrap', gap:'12px'}}>
        <h1 style={{fontSize:'28px', fontWeight:'900', color:'#1c2e48'}}>Pipeline</h1>
        <div style={{display:'flex', gap:'12px', alignItems:'center', flexWrap:'wrap'}}>
          <div style={{fontWeight:'700', color:'#0F6E56'}}>Pipeline: ${totalPipeline.toLocaleString()}</div>
          <button onClick={() => setShowAdd(true)} style={{background:'#0F6E56', color:'white', padding:'10px 20px', borderRadius:'8px', border:'none', fontWeight:'700', cursor:'pointer'}}>+ Add Deal</button>
        </div>
      </div>

      {showAdd && (
        <div style={{position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:100, display:'flex', alignItems:'center', justifyContent:'center', padding:'20px'}}>
          <div style={{background:'white', borderRadius:'16px', padding:'32px', width:'100%', maxWidth:'480px'}}>
            <h2 style={{marginBottom:'20px', color:'#1c2e48'}}>Add Deal</h2>
            <form onSubmit={addDeal} style={{display:'flex', flexDirection:'column', gap:'14px'}}>
              <input placeholder="Deal Name" value={form.name} onChange={e => setForm({...form, name: e.target.value})} required style={{padding:'10px', borderRadius:'8px', border:'1px solid #ddd', fontSize:'15px'}} />
              <input placeholder="Client / Brand" value={form.client_name} onChange={e => setForm({...form, client_name: e.target.value})} style={{padding:'10px', borderRadius:'8px', border:'1px solid #ddd', fontSize:'15px'}} />
              <input placeholder="Deal Value ($)" type="number" value={form.value} onChange={e => setForm({...form, value: e.target.value})} style={{padding:'10px', borderRadius:'8px', border:'1px solid #ddd', fontSize:'15px'}} />
              <select value={form.stage} onChange={e => setForm({...form, stage: e.target.value})} style={{padding:'10px', borderRadius:'8px', border:'1px solid #ddd', fontSize:'15px'}}>
                {STAGES.map(s => <option key={s}>{s}</option>)}
              </select>
              <div style={{display:'flex', gap:'12px'}}>
                <button type="submit" style={{flex:1, background:'#0F6E56', color:'white', padding:'12px', borderRadius:'8px', border:'none', fontWeight:'700', cursor:'pointer'}}>Save</button>
                <button type="button" onClick={() => setShowAdd(false)} style={{flex:1, background:'#f0f4f8', color:'#666', padding:'12px', borderRadius:'8px', border:'none', cursor:'pointer'}}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {loading ? <div style={{color:'#666'}}>Loading...</div> : (
        <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(240px,1fr))', gap:'16px', marginTop:'16px'}}>
          {STAGES.map(stage => {
            const stageDeals = deals.filter(d => d.stage === stage)
            const stageTotal = stageDeals.reduce((s, d) => s + (d.value || 0), 0)
            const colors: any = { 'Prospecting': '#38bdf8', 'Proposal': '#a78bfa', 'Negotiation': '#fb923c', 'Closed Won': '#4ade80' }
            return (
              <div key={stage} style={{background:'white', borderRadius:'12px', overflow:'hidden', boxShadow:'0 1px 4px rgba(0,0,0,0.08)'}}>
                <div style={{background: colors[stage], padding:'12px 16px'}}>
                  <div style={{fontWeight:'900', color:'white', fontSize:'14px'}}>{stage.toUpperCase()}</div>
                  <div style={{color:'rgba(255,255,255,0.8)', fontSize:'13px'}}>{stageDeals.length} deals • ${stageTotal.toLocaleString()}</div>
                </div>
                <div style={{padding:'12px', display:'flex', flexDirection:'column', gap:'10px', minHeight:'120px'}}>
                  {stageDeals.map(d => (
                    <div key={d.id} style={{background:'#f8fafc', borderRadius:'8px', padding:'12px', border:'1px solid #e5e7eb'}}>
                      <div style={{fontWeight:'700', color:'#1c2e48', fontSize:'14px'}}>{d.name}</div>
                      <div style={{color:'#666', fontSize:'13px'}}>{d.client_name}</div>
                      <div style={{fontWeight:'700', color:'#0F6E56', marginTop:'6px'}}>${(d.value||0).toLocaleString()}</div>
                      <div style={{display:'flex', gap:'6px', marginTop:'8px', flexWrap:'wrap'}}>
                        {STAGES.filter(s => s !== stage).map(s => (
                          <button key={s} onClick={() => moveDeal(d.id, s)} style={{background:'#e5e7eb', color:'#444', border:'none', padding:'4px 8px', borderRadius:'6px', cursor:'pointer', fontSize:'11px'}}>→ {s.split(' ')[0]}</button>
                        ))}
                      </div>
                    </div>
                  ))}
                  {stageDeals.length === 0 && <div style={{color:'#ccc', fontSize:'13px', textAlign:'center', paddingTop:'20px'}}>No deals</div>}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
