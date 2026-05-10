'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@/lib/supabase'
import type { Client } from '@/lib/supabase'

const CANNING_TIERS = [
  { min: 150, max: 339, std: 0.48, slk: 0.48, xl: 0.58 },
  { min: 340, max: 500, std: 0.43, slk: 0.43, xl: 0.53 },
  { min: 501, max: 999, std: 0.38, slk: 0.38, xl: 0.48 },
  { min: 1000, max: 2499, std: 0.35, slk: 0.35, xl: 0.45 },
  { min: 2500, max: 4999, std: 0.31, slk: 0.31, xl: 0.41 },
  { min: 5000, max: 999999, std: 0.28, slk: 0.28, xl: 0.38 },
]
const BOTTLING_TIERS = [
  { cases: 220, perBtl: 2.16 }, { cases: 660, perBtl: 1.91 },
  { cases: 1320, perBtl: 1.58 }, { cases: 2640, perBtl: 1.41 },
  { cases: 5280, perBtl: 1.12 },
]

function getCanRate(cases: number, fmt: string) {
  const t = CANNING_TIERS.find(t => cases >= t.min && cases <= t.max) || CANNING_TIERS[CANNING_TIERS.length - 1]
  return fmt === 'slk' ? t.slk : fmt === 'xl' ? t.xl : t.std
}

type LineItem = { description: string; amount: number }

export default function NewInvoicePage() {
  const router = useRouter()
  const supabase = createBrowserClient()
  const [clients, setClients] = useState<Client[]>([])
  const [saving, setSaving] = useState(false)

  // Form state
  const [clientId, setClientId] = useState('')
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().split('T')[0])
  const [svcType, setSvcType] = useState('canning')
  const [canFmt, setCanFmt] = useState('std')
  const [canCases, setCanCases] = useState(500)
  const [btlCases, setBtlCases] = useState(660)
  const [rdPkg, setRdPkg] = useState('rd')
  const [rdSkus, setRdSkus] = useState(1)
  const [consultFee, setConsultFee] = useState(2500)
  const [addPast, setAddPast] = useState(false)
  const [addNitro, setAddNitro] = useState(false)
  const [addPastBtl, setAddPastBtl] = useState(false)
  const [addOvLbl, setAddOvLbl] = useState(false)
  const [notes, setNotes] = useState('Net 30 · Wire transfer or check accepted')

  useEffect(() => {
    supabase.from('clients').select('*').order('name').then(({ data }) => setClients(data || []))
  }, [])

  // Calculate line items
  const calcLines = (): { lines: LineItem[]; total: number; desc: string } => {
    let lines: LineItem[] = [], total = 0, desc = ''
    if (svcType === 'canning') {
      const cans = canCases * 24
      const rate = getCanRate(canCases, canFmt)
      const fmtL = canFmt === 'slk' ? '12oz Sleek' : canFmt === 'xl' ? '16oz Standard' : '12oz Standard'
      const mfg = Math.round(rate * cans * 100) / 100
      const canC = Math.round(0.32 * cans * 100) / 100
      const pkg = Math.round(0.055 * cans * 100) / 100
      lines = [
        { description: `Manufacturing — ${canCases} cases ${fmtL} @ $${rate}/can`, amount: mfg },
        { description: `Can costs — ${cans.toLocaleString()} cans @ $0.32/unit`, amount: canC },
        { description: `Packaging — trays & PakTechs @ $0.055/can`, amount: pkg },
      ]
      total = mfg + canC + pkg
      if (addPast) { const c = Math.round(0.085 * cans * 100) / 100; lines.push({ description: 'Flash Pasteurization @ $0.085/can', amount: c }); total += c }
      if (addNitro) { const c = Math.round(0.035 * cans * 100) / 100; lines.push({ description: 'Nitrogen Dosing @ $0.035/can', amount: c }); total += c }
      desc = `Canning — ${canCases} cases ${fmtL}${addPast ? ' + Flash Past.' : ''}${addNitro ? ' + Nitrogen' : ''}`
    } else if (svcType === 'bottling') {
      const tier = BOTTLING_TIERS.find(t => t.cases === btlCases) || BOTTLING_TIERS[1]
      const btls = btlCases * 6
      const mfg = Math.round(tier.perBtl * btls * 100) / 100
      lines = [{ description: `Bottle filling — ${btlCases} cases (${btls.toLocaleString()} btls) @ $${tier.perBtl}/btl`, amount: mfg }]
      total = mfg
      if (addPastBtl) { const c = Math.round(0.20 * btls * 100) / 100; lines.push({ description: 'Flash Pasteurization @ $0.20/btl', amount: c }); total += c }
      if (addOvLbl) { const c = Math.round(0.20 * btls * 100) / 100; lines.push({ description: 'Over-Top Labels @ $0.20/btl', amount: c }); total += c }
      desc = `Bottle Filling — ${btlCases} cases 750ml`
    } else if (svcType === 'rd') {
      const base = 1000 * rdSkus
      lines = [{ description: `R&D Formulation — ${rdSkus} SKU(s), 3 iterations`, amount: base }]
      total = base
      if (rdPkg === 'rd-lic') { lines.push({ description: 'IP Licensing (annual)', amount: 6000 }); total += 6000 }
      if (rdPkg === 'rd-buy') { lines.push({ description: 'IP Purchase (outright)', amount: 15000 }); total += 15000 }
      desc = rdPkg === 'rd' ? 'R&D Formulation' : rdPkg === 'rd-lic' ? 'R&D + IP License' : 'R&D + IP Purchase'
    } else {
      lines = [{ description: 'Consulting & Brand Support', amount: consultFee }]
      total = consultFee
      desc = 'Consulting & Brand Support'
    }
    return { lines, total: Math.round(total * 100) / 100, desc }
  }

  const { lines, total, desc } = calcLines()
  const client = clients.find(c => c.id === clientId)

  const genInvoiceNumber = () => {
    const yr = new Date().getFullYear()
    const seq = Math.floor(Math.random() * 900) + 100
    return `GL-${yr}-${seq}`
  }

  const saveInvoice = async (status: 'draft' | 'pending') => {
    if (!clientId) { alert('Please select a client.'); return }
    setSaving(true)
    const invoiceNumber = genInvoiceNumber()
    const { error } = await supabase.from('invoices').insert([{
      invoice_number: invoiceNumber,
      client_id: clientId,
      client_name: client?.name || '',
      service: desc,
      amount: total,
      status,
      invoice_date: invoiceDate,
      notes,
      line_items: lines,
    }])
    if (!error) {
      await supabase.from('activity').insert([{
        type: 'invoice',
        title: `Invoice ${status === 'draft' ? 'drafted' : 'sent'} — ${client?.name}`,
        detail: `${invoiceNumber} · $${total.toLocaleString()}`,
      }])
      router.push('/admin/invoices')
    }
    setSaving(false)
  }

  return (
    <div className="p-6">
      <div className="mb-5">
        <h1 className="font-display text-2xl tracking-widest text-white">CREATE INVOICE</h1>
        <p className="text-muted text-xs mt-1">Auto-priced from Good Liquid rate card</p>
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Left — form */}
        <div>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div>
              <label className="block text-xs text-muted uppercase tracking-wide mb-1.5">Client *</label>
              <select value={clientId} onChange={e => setClientId(e.target.value)} className="form-input">
                <option value="">Select client…</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-muted uppercase tracking-wide mb-1.5">Invoice date</label>
              <input type="date" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} className="form-input" />
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-xs text-muted uppercase tracking-wide mb-1.5">Service type</label>
            <select value={svcType} onChange={e => setSvcType(e.target.value)} className="form-input">
              <option value="canning">Small Batch Canning</option>
              <option value="bottling">Bottle Filling (750ml)</option>
              <option value="rd">Beverage Formulation / R&D</option>
              <option value="consulting">Consulting & Brand Support</option>
            </select>
          </div>

          {/* Dynamic service fields */}
          {svcType === 'canning' && (
            <div className="bg-white/3 border border-white/7 rounded-xl p-4 mb-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-muted uppercase tracking-wide mb-1.5">Can format</label>
                  <select value={canFmt} onChange={e => setCanFmt(e.target.value)} className="form-input">
                    <option value="std">12oz Standard</option>
                    <option value="slk">12oz Sleek</option>
                    <option value="xl">16oz Standard</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-muted uppercase tracking-wide mb-1.5">Cases (min 150)</label>
                  <input type="number" value={canCases} min={150} onChange={e => setCanCases(parseInt(e.target.value) || 150)} className="form-input" />
                </div>
              </div>
              <div className="text-xs text-muted">{canCases * 24} cans total · Rate: ${getCanRate(canCases, canFmt)}/can</div>
              <div>
                <div className="text-xs text-muted uppercase tracking-wide mb-2">Add-ons</div>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { key: 'past', label: '🔥 Flash Pasteurization', price: '5–12¢/can', val: addPast, set: setAddPast },
                    { key: 'nitro', label: '💨 Nitrogen Dosing', price: '3–4¢/can', val: addNitro, set: setAddNitro },
                  ].map(a => (
                    <button key={a.key} onClick={() => a.set(!a.val)}
                      className={`p-2.5 rounded-lg border text-left transition-all ${a.val ? 'border-teal/35 bg-teal/6 text-white' : 'border-white/8 bg-white/2 text-muted hover:text-white'}`}>
                      <div className="text-xs font-semibold">{a.label}</div>
                      <div className="text-xs opacity-60 mt-0.5">{a.price}</div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {svcType === 'bottling' && (
            <div className="bg-white/3 border border-white/7 rounded-xl p-4 mb-4 space-y-3">
              <div>
                <label className="block text-xs text-muted uppercase tracking-wide mb-1.5">Cases (6-pack)</label>
                <select value={btlCases} onChange={e => setBtlCases(parseInt(e.target.value))} className="form-input">
                  <option value={220}>220 cases (1,320 bottles) — $2.16/btl</option>
                  <option value={660}>660 cases (3,960 bottles) — $1.91/btl</option>
                  <option value={1320}>1,320 cases (7,920 bottles) — $1.58/btl</option>
                  <option value={2640}>2,640 cases (15,840 bottles) — $1.41/btl</option>
                  <option value={5280}>5,280 cases (31,680 bottles) — $1.12/btl</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { key: 'pastbtl', label: '🔥 Flash Pasteurization', price: '$0.20/btl', val: addPastBtl, set: setAddPastBtl },
                  { key: 'ovlbl', label: '🏷️ Over-Top Labels', price: '$0.20/btl', val: addOvLbl, set: setAddOvLbl },
                ].map(a => (
                  <button key={a.key} onClick={() => a.set(!a.val)}
                    className={`p-2.5 rounded-lg border text-left transition-all ${a.val ? 'border-teal/35 bg-teal/6 text-white' : 'border-white/8 bg-white/2 text-muted hover:text-white'}`}>
                    <div className="text-xs font-semibold">{a.label}</div>
                    <div className="text-xs opacity-60 mt-0.5">{a.price}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {svcType === 'rd' && (
            <div className="bg-white/3 border border-white/7 rounded-xl p-4 mb-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-muted uppercase tracking-wide mb-1.5">Package</label>
                  <select value={rdPkg} onChange={e => setRdPkg(e.target.value)} className="form-input">
                    <option value="rd">R&D Only ($1,000)</option>
                    <option value="rd-lic">R&D + IP License ($7,000)</option>
                    <option value="rd-buy">R&D + IP Purchase ($16,000)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-muted uppercase tracking-wide mb-1.5">SKUs</label>
                  <input type="number" value={rdSkus} min={1} onChange={e => setRdSkus(parseInt(e.target.value) || 1)} className="form-input" />
                </div>
              </div>
            </div>
          )}

          {svcType === 'consulting' && (
            <div className="bg-white/3 border border-white/7 rounded-xl p-4 mb-4">
              <label className="block text-xs text-muted uppercase tracking-wide mb-1.5">Flat fee ($)</label>
              <input type="number" value={consultFee} onChange={e => setConsultFee(parseFloat(e.target.value) || 0)} className="form-input" />
            </div>
          )}

          <div className="mb-4">
            <label className="block text-xs text-muted uppercase tracking-wide mb-1.5">Notes / payment terms</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)}
              rows={2} className="form-input resize-none" />
          </div>

          <div className="flex gap-3">
            <button onClick={() => saveInvoice('pending')} disabled={saving || !clientId}
              className="flex-1 py-2.5 bg-teal text-ink font-bold text-sm rounded-lg hover:bg-teal-2 transition-colors disabled:opacity-50">
              {saving ? 'Saving...' : '✉ Save & Send'}
            </button>
            <button onClick={() => saveInvoice('draft')} disabled={saving || !clientId}
              className="px-5 py-2.5 border border-white/10 text-muted text-sm rounded-lg hover:text-white transition-colors disabled:opacity-50">
              Save draft
            </button>
          </div>
        </div>

        {/* Right — live preview */}
        <div>
          {/* Total breakdown */}
          <div className="bg-teal/6 border border-teal/18 rounded-xl p-4 mb-4">
            {lines.map((l, i) => (
              <div key={i} className="flex justify-between text-xs text-muted mb-1.5">
                <span>{l.description}</span>
                <span>${l.amount.toLocaleString()}</span>
              </div>
            ))}
            <div className="flex justify-between font-display text-base text-teal tracking-wide mt-2 pt-2 border-t border-teal/18">
              <span>Total</span>
              <span>${total.toLocaleString()}</span>
            </div>
          </div>

          {/* Invoice preview */}
          <div className="bg-ink-3 border border-white/7 rounded-xl p-5 text-sm">
            <div className="flex justify-between items-start mb-4 pb-4 border-b border-white/7">
              <div>
                <div className="font-display text-sm tracking-widest text-teal">GOOD LIQUID BEV CO</div>
                <div className="text-xs text-muted mt-0.5">2011 51st Ave E, Unit 100</div>
                <div className="text-xs text-muted">Palmetto, FL 34221</div>
                <div className="text-xs text-muted">mike@goodliquid.com</div>
              </div>
              <div className="text-right">
                <div className="font-display text-base tracking-widest text-white">INVOICE</div>
                <div className="text-xs text-muted mt-0.5">{invoiceDate}</div>
              </div>
            </div>
            <div className="mb-4">
              <div className="text-xs text-muted uppercase tracking-wide mb-1">Bill to</div>
              <div className="font-semibold text-white">{client?.name || '[Select client]'}</div>
              <div className="text-xs text-muted">{client?.contact_name}</div>
            </div>
            <table className="w-full mb-4" style={{ borderCollapse: 'collapse' }}>
              <thead><tr>
                <th className="text-left text-xs text-muted pb-2 border-b border-white/7">Description</th>
                <th className="text-right text-xs text-muted pb-2 border-b border-white/7">Amount</th>
              </tr></thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i}>
                    <td className="py-1.5 text-xs text-white border-b border-white/5">{l.description}</td>
                    <td className="py-1.5 text-xs text-right border-b border-white/5">${l.amount.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="text-right">
              <div className="font-display text-lg text-teal">${total.toLocaleString()}</div>
            </div>
            {notes && <div className="mt-3 pt-3 border-t border-white/7 text-xs text-muted">{notes}</div>}
          </div>
        </div>
      </div>
    </div>
  )
}
