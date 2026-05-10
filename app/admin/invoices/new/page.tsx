'use client'
import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'

function NewInvoiceForm() {
  const router = useRouter()
  const params = useSearchParams()
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    client_name: params.get('name') || '',
    service: 'Canning',
    cases: 150,
    can_format: '12oz',
    addons: { flash: false, nitrogen: false },
    notes: '',
    due_days: 30,
  })

  const MFG: any = { 150: 28, 300: 24, 500: 20, 1000: 16 }
  const CAN: any = { '12oz': 0.32, '16oz': 0.34, '19.2oz': 0.36 }
  const CANS_PER_CASE = 24

  function getMfgRate() {
    const tiers = [1000, 500, 300, 150]
    for (const t of tiers) if (form.cases >= t) return MFG[t]
    return 28
  }

  function calcTotal() {
    if (form.service === 'Canning') {
      const cans = form.cases * CANS_PER_CASE
      const mfg = getMfgRate() * form.cases
      const canCost = CAN[form.can_format] * cans
      const pkg = 0.055 * cans
      const flash = form.addons.flash ? 0.015 * cans : 0
      const nitrogen = form.addons.nitrogen ? 0.008 * cans : 0
      return mfg + canCost + pkg + flash + nitrogen
    }
    if (form.service === 'Bottling') return form.cases * 8.5
    if (form.service === 'R&D') return 1000
    if (form.service === 'Consulting') return 500
    return 0
  }

  async function save(status: string) {
    setSaving(true)
    const date = new Date()
    const due = new Date(date.getTime() + form.due_days * 86400000)
    const num = `GL-${date.getFullYear()}-${String(Math.floor(Math.random()*9000)+1000)}`
    const amount = calcTotal()
    await supabase.from('invoices').insert([{
      invoice_number: num,
      client_name: form.client_name,
      service: form.service,
      amount: Math.round(amount * 100) / 100,
      status,
      invoice_date: date.toISOString().split('T')[0],
      due_date: due.toISOString().split('T')[0],
      notes: form.notes,
      line_items: []
    }])
    router.push('/admin/invoices')
  }

  const total = calcTotal()

  return (
    <div>
      <div style={{display:'flex', alignItems:'center', gap:'16px', marginBottom:'24px'}}>
        <a href="/admin/invoices" style={{color:'#666', textDecoration:'none'}}>← Invoices</a>
        <h1 style={{fontSize:'28px', fontWeight:'900', color:'#1c2e48'}}>New Invoice</h1>
      </div>

      <div style={{display:'grid', gridTemplateColumns:'1fr', gap:'24px', maxWidth:'700px'}}>
        <div style={{background:'white', borderRadius:'12px', padding:'24px', boxShadow:'0 1px 4px rgba(0,0,0,0.08)'}}>
          <h2 style={{fontSize:'18px', fontWeight:'700', color:'#1c2e48', marginBottom:'20px'}}>Invoice Details</h2>
          <div style={{display:'flex', flexDirection:'column', gap:'16px'}}>
            <div>
              <label style={{display:'block', fontWeight:'600', color:'#444', marginBottom:'6px', fontSize:'14px'}}>Client / Brand Name</label>
              <input value={form.client_name} onChange={e => setForm({...form, client_name: e.target.value})} style={{width:'100%', padding:'10px', borderRadius:'8px', border:'1px solid #ddd', fontSize:'15px', boxSizing:'border-box'}} />
            </div>
            <div>
              <label style={{display:'block', fontWeight:'600', color:'#444', marginBottom:'6px', fontSize:'14px'}}>Service</label>
              <select value={form.service} onChange={e => setForm({...form, service: e.target.value})} style={{width:'100%', padding:'10px', borderRadius:'8px', border:'1px solid #ddd', fontSize:'15px'}}>
                {['Canning','Bottling','R&D','Consulting'].map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
            {form.service === 'Canning' && (
              <>
                <div>
                  <label style={{display:'block', fontWeight:'600', color:'#444', marginBottom:'6px', fontSize:'14px'}}>Cases (min 150)</label>
                  <input type="number" min={150} value={form.cases} onChange={e => setForm({...form, cases: Number(e.target.value)})} style={{width:'100%', padding:'10px', borderRadius:'8px', border:'1px solid #ddd', fontSize:'15px', boxSizing:'border-box'}} />
                </div>
                <div>
                  <label style={{display:'block', fontWeight:'600', color:'#444', marginBottom:'6px', fontSize:'14px'}}>Can Format</label>
                  <select value={form.can_format} onChange={e => setForm({...form, can_format: e.target.value})} style={{width:'100%', padding:'10px', borderRadius:'8px', border:'1px solid #ddd', fontSize:'15px'}}>
                    {['12oz','16oz','19.2oz'].map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{display:'block', fontWeight:'600', color:'#444', marginBottom:'8px', fontSize:'14px'}}>Add-ons</label>
                  <div style={{display:'flex', gap:'16px'}}>
                    <label style={{display:'flex', alignItems:'center', gap:'8px', cursor:'pointer'}}>
                      <input type="checkbox" checked={form.addons.flash} onChange={e => setForm({...form, addons: {...form.addons, flash: e.target.checked}})} />
                      Flash Pasteurization (+$0.015/can)
                    </label>
                    <label style={{display:'flex', alignItems:'center', gap:'8px', cursor:'pointer'}}>
                      <input type="checkbox" checked={form.addons.nitrogen} onChange={e => setForm({...form, addons: {...form.addons, nitrogen: e.target.checked}})} />
                      Nitrogen Dosing (+$0.008/can)
                    </label>
                  </div>
                </div>
              </>
            )}
            <div>
              <label style={{display:'block', fontWeight:'600', color:'#444', marginBottom:'6px', fontSize:'14px'}}>Payment Terms (days)</label>
              <select value={form.due_days} onChange={e => setForm({...form, due_days: Number(e.target.value)})} style={{width:'100%', padding:'10px', borderRadius:'8px', border:'1px solid #ddd', fontSize:'15px'}}>
                {[15,30,45,60].map(d => <option key={d} value={d}>Net {d}</option>)}
              </select>
            </div>
            <div>
              <label style={{display:'block', fontWeight:'600', color:'#444', marginBottom:'6px', fontSize:'14px'}}>Notes</label>
              <textarea value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} rows={3} style={{width:'100%', padding:'10px', borderRadius:'8px', border:'1px solid #ddd', fontSize:'15px', resize:'vertical', boxSizing:'border-box'}} />
            </div>
          </div>
        </div>

        <div style={{background:'#1c2e48', borderRadius:'12px', padding:'24px', color:'white'}}>
          <h2 style={{fontSize:'18px', fontWeight:'700', marginBottom:'16px'}}>Total</h2>
          <div style={{fontSize:'48px', fontWeight:'900', color:'#4fd1b0'}}>${total.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}</div>
          <div style={{color:'#9FE1CB', fontSize:'14px', marginTop:'8px'}}>{form.service} • {form.cases > 0 && form.service === 'Canning' ? `${form.cases} cases` : ''}</div>
          <div style={{display:'flex', gap:'12px', marginTop:'24px', flexWrap:'wrap'}}>
            <button onClick={() => save('draft')} disabled={saving} style={{flex:1, background:'#2a4060', color:'white', border:'none', padding:'14px', borderRadius:'10px', fontWeight:'700', cursor:'pointer', fontSize:'15px'}}>Save Draft</button>
            <button onClick={() => save('pending')} disabled={saving} style={{flex:1, background:'#0F6E56', color:'white', border:'none', padding:'14px', borderRadius:'10px', fontWeight:'700', cursor:'pointer', fontSize:'15px'}}>Save & Send</button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function NewInvoicePage() {
  return <Suspense><NewInvoiceForm /></Suspense>
}
