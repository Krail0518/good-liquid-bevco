'use client'

import { useEffect, useState } from 'react'
import { createBrowserClient } from '@/lib/supabase'
import type { Invoice } from '@/lib/supabase'
import Link from 'next/link'

export default function InvoicesPage() {
  const supabase = createBrowserClient()
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Invoice | null>(null)

  const load = async () => {
    const { data } = await supabase.from('invoices').select('*').order('created_at', { ascending: false })
    setInvoices(data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const filtered = invoices.filter(i => {
    const mf = filter === 'all' || i.status === filter
    const ms = !search || i.client_name.toLowerCase().includes(search.toLowerCase()) ||
      i.invoice_number.toLowerCase().includes(search.toLowerCase())
    return mf && ms
  })

  const markStatus = async (id: string, status: string) => {
    await supabase.from('invoices').update({ status, updated_at: new Date().toISOString() }).eq('id', id)
    if (status === 'paid') {
      const inv = invoices.find(i => i.id === id)
      if (inv) {
        await supabase.from('activity').insert([{
          type: 'invoice', title: `Invoice paid — ${inv.client_name}`,
          detail: `${inv.invoice_number} · $${inv.amount.toLocaleString()}`,
        }])
        await supabase.from('clients').select('id, total_billed').eq('name', inv.client_name).single()
          .then(({ data: c }) => {
            if (c) supabase.from('clients').update({ total_billed: (c.total_billed || 0) + inv.amount }).eq('id', c.id)
          })
      }
    }
    load()
    if (selected?.id === id) setSelected({ ...selected, status: status as any })
  }

  const totals = {
    paid: invoices.filter(i => i.status === 'paid').reduce((a, i) => a + i.amount, 0),
    pending: invoices.filter(i => i.status === 'pending').reduce((a, i) => a + i.amount, 0),
    overdue: invoices.filter(i => i.status === 'overdue').reduce((a, i) => a + i.amount, 0),
  }

  const badge: Record<string, string> = {
    paid: 'badge badge-paid', pending: 'badge badge-pending',
    overdue: 'badge badge-overdue', draft: 'badge badge-draft'
  }

  const GL = { name: 'Good Liquid Bev Co', addr: '2011 51st Ave E, Unit 100', city: 'Palmetto, FL 34221', email: 'mike@goodliquid.com', phone: '(803) 493-5065' }

  return (
    <div className="p-6">
      <div className="flex items-start justify-between mb-5">
        <div>
          <h1 className="font-display text-2xl tracking-widest text-white">INVOICES</h1>
          <p className="text-muted text-xs mt-1">{filtered.length} invoices</p>
        </div>
        <Link href="/admin/invoices/new"
          className="px-4 py-2 bg-teal text-ink text-xs font-bold rounded-lg hover:bg-teal-2 transition-colors">
          + New invoice
        </Link>
      </div>

      {/* Summary metrics */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        {[
          { label: 'Collected', value: `$${Math.round(totals.paid / 1000)}K`, color: 'text-emerald-400' },
          { label: 'Pending', value: `$${Math.round(totals.pending / 1000)}K`, color: 'text-yellow-400' },
          { label: 'Overdue', value: `$${Math.round(totals.overdue / 1000)}K`, color: 'text-red-400' },
        ].map(m => (
          <div key={m.label} className="bg-ink-5 border border-white/6 rounded-xl p-3">
            <div className="text-xs text-muted uppercase tracking-wide mb-1">{m.label}</div>
            <div className={`font-display text-xl tracking-wide ${m.color}`}>{m.value}</div>
          </div>
        ))}
      </div>

      {/* Search & filter */}
      <div className="flex gap-3 mb-4">
        <div className="flex items-center gap-2 flex-1 bg-white/4 border border-white/8 rounded-lg px-3 py-2">
          <span className="text-muted text-sm">🔍</span>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search invoices…"
            className="flex-1 bg-transparent text-white text-sm placeholder-muted/50 outline-none" />
        </div>
        {['all', 'draft', 'pending', 'paid', 'overdue'].map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-2 rounded-lg text-xs font-semibold transition-all ${filter === f ? 'bg-teal text-ink' : 'bg-white/4 text-muted hover:text-white border border-white/8'}`}>
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      <div className="flex gap-4">
        {/* Invoice list */}
        <div className="flex-1 bg-ink-5 border border-white/6 rounded-xl overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-muted text-sm font-mono animate-pulse">Loading...</div>
          ) : (
            <table className="admin-table">
              <thead><tr>
                <th>Invoice #</th><th>Client</th><th>Service</th>
                <th>Amount</th><th>Date</th><th>Status</th><th>Actions</th>
              </tr></thead>
              <tbody>
                {filtered.map(inv => (
                  <tr key={inv.id} onClick={() => setSelected(inv)}
                    className="cursor-pointer">
                    <td className="font-semibold text-teal text-xs font-mono">{inv.invoice_number}</td>
                    <td className="font-medium">{inv.client_name}</td>
                    <td className="text-muted text-xs max-w-32 overflow-hidden overflow-ellipsis whitespace-nowrap">{inv.service}</td>
                    <td className="font-semibold">${inv.amount.toLocaleString()}</td>
                    <td className="text-muted text-xs">{inv.invoice_date}</td>
                    <td><span className={badge[inv.status]}>{inv.status}</span></td>
                    <td onClick={e => e.stopPropagation()}>
                      <div className="flex gap-1.5">
                        {inv.status !== 'paid' && (
                          <button onClick={() => markStatus(inv.id, 'paid')}
                            className="text-xs px-2 py-1 bg-emerald-500/15 text-emerald-400 rounded-lg hover:bg-emerald-500/25 transition-colors">
                            Paid
                          </button>
                        )}
                        {inv.status === 'pending' && (
                          <button onClick={() => markStatus(inv.id, 'overdue')}
                            className="text-xs px-2 py-1 bg-red-500/12 text-red-400 rounded-lg hover:bg-red-500/22 transition-colors">
                            Overdue
                          </button>
                        )}
                        <button onClick={() => setSelected(inv)}
                          className="text-xs px-2 py-1 bg-white/5 text-muted rounded-lg hover:text-white transition-colors">
                          View
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={7} className="text-center text-muted py-8">No invoices found.</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        {/* Invoice detail panel */}
        {selected && (
          <div className="w-80 flex-shrink-0 bg-ink-5 border border-white/6 rounded-xl p-5 sticky top-0">
            <div className="flex items-center justify-between mb-4">
              <span className="font-mono text-xs text-teal">{selected.invoice_number}</span>
              <button onClick={() => setSelected(null)} className="text-muted hover:text-white text-sm">✕</button>
            </div>
            {/* Mini invoice */}
            <div className="bg-ink-3 rounded-xl p-4 mb-4">
              <div className="flex justify-between items-start mb-3 pb-3 border-b border-white/7">
                <div>
                  <div className="font-display text-sm tracking-widest text-teal">{GL.name}</div>
                  <div className="text-xs text-muted mt-0.5">{GL.addr}</div>
                  <div className="text-xs text-muted">{GL.city}</div>
                </div>
                <div className="text-right">
                  <div className="font-display text-base tracking-widest text-white">INVOICE</div>
                  <div className="text-xs text-muted mt-0.5">{selected.invoice_date}</div>
                  <span className={`mt-1 inline-block ${badge[selected.status]}`}>{selected.status.toUpperCase()}</span>
                </div>
              </div>
              <div className="mb-3">
                <div className="text-xs text-muted mb-1 uppercase tracking-wide">Bill to</div>
                <div className="text-sm font-semibold text-white">{selected.client_name}</div>
              </div>
              <div className="bg-white/4 rounded-lg p-3 mb-3">
                <div className="text-xs text-muted mb-1">{selected.service}</div>
                <div className="text-right font-semibold">${selected.amount.toLocaleString()}</div>
              </div>
              <div className="text-right">
                <div className="text-xs text-muted">Total Due</div>
                <div className="font-display text-lg text-teal">${selected.amount.toLocaleString()}</div>
              </div>
              {selected.notes && (
                <div className="mt-3 pt-3 border-t border-white/7 text-xs text-muted">{selected.notes}</div>
              )}
            </div>
            {/* Actions */}
            <div className="flex flex-col gap-2">
              {selected.status !== 'paid' && (
                <button onClick={() => markStatus(selected.id, 'paid')}
                  className="w-full py-2 bg-emerald-500/15 text-emerald-400 text-xs font-semibold rounded-lg hover:bg-emerald-500/25 transition-colors">
                  ✓ Mark as paid
                </button>
              )}
              {selected.status === 'pending' && (
                <button onClick={() => markStatus(selected.id, 'overdue')}
                  className="w-full py-2 bg-red-500/12 text-red-400 text-xs font-semibold rounded-lg hover:bg-red-500/22 transition-colors">
                  ⚠ Mark as overdue
                </button>
              )}
              <button onClick={() => {
                const subject = encodeURIComponent(`Follow up — ${selected.invoice_number}`)
                const body = encodeURIComponent(`Hi,\n\nFollowing up on invoice ${selected.invoice_number} for $${selected.amount.toLocaleString()}.\n\nPlease let me know if you have any questions.\n\nThanks,\nMike\nGood Liquid Bev Co`)
                window.location.href = `mailto:?subject=${subject}&body=${body}`
              }} className="w-full py-2 bg-white/5 text-muted text-xs font-semibold rounded-lg hover:text-white transition-colors">
                ✉ Draft follow-up
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
