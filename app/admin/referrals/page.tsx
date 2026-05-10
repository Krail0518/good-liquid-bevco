'use client'

import { useEffect, useState } from 'react'
import { createBrowserClient } from '@/lib/supabase'
import type { Referral, Referrer } from '@/lib/supabase'

export default function ReferralsPage() {
  const supabase = createBrowserClient()
  const [referrals, setReferrals] = useState<Referral[]>([])
  const [referrers, setReferrers] = useState<Referrer[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [showModal, setShowModal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    referrer_id: '', client_name: '', deal_value: 15000,
    commission_rate: 5, status: 'lead', notes: ''
  })

  const load = async () => {
    const [ref, rer] = await Promise.all([
      supabase.from('referrals').select('*').order('created_at', { ascending: false }),
      supabase.from('referrers').select('*').order('name'),
    ])
    setReferrals(ref.data || [])
    setReferrers(rer.data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const filtered = filter === 'all' ? referrals : referrals.filter(r => r.status === filter)

  const commPreview = Math.round(form.deal_value * form.commission_rate / 100)

  const saveReferral = async () => {
    if (!form.referrer_id || !form.client_name) { alert('Fill in referrer and client name.'); return }
    setSaving(true)
    const ref = referrers.find(r => r.id === form.referrer_id)
    const { error } = await supabase.from('referrals').insert([{
      ...form,
      commission_amount: commPreview,
      date_paid: null,
    }])
    if (!error) {
      await supabase.from('activity').insert([{
        type: 'ref', title: `New referral from ${ref?.name}`,
        detail: `${form.client_name} — potential $${commPreview.toLocaleString()} commission`,
      }])
      setShowModal(false)
      setForm({ referrer_id: '', client_name: '', deal_value: 15000, commission_rate: 5, status: 'lead', notes: '' })
      load()
    }
    setSaving(false)
  }

  const updateStatus = async (id: string, status: string, dealValue?: number) => {
    const updates: any = { status, updated_at: new Date().toISOString() }
    if (dealValue) {
      const ref = referrals.find(r => r.id === id)!
      updates.deal_value = dealValue
      updates.commission_amount = Math.round(dealValue * ref.commission_rate / 100)
    }
    if (status === 'paid') updates.date_paid = new Date().toISOString().split('T')[0]
    await supabase.from('referrals').update(updates).eq('id', id)
    if (status === 'paid') {
      const ref = referrals.find(r => r.id === id)
      const rer = referrers.find(r => r.id === ref?.referrer_id)
      if (ref && rer) {
        await supabase.from('activity').insert([{
          type: 'ref', title: `Commission paid — ${rer.name}`,
          detail: `$${(updates.commission_amount || ref.commission_amount).toLocaleString()} for ${ref.client_name}`,
        }])
      }
    }
    load()
  }

  const handleWon = (id: string) => {
    const ref = referrals.find(r => r.id === id)
    const val = prompt(`Enter actual deal value for ${ref?.client_name} (est. $${ref?.deal_value.toLocaleString()}):`, String(ref?.deal_value || 0))
    if (val !== null) updateStatus(id, 'won', parseFloat(val) || ref?.deal_value)
  }

  // Metrics
  const owed = referrals.filter(r => r.status === 'won').reduce((a, r) => a + r.commission_amount, 0)
  const paidYTD = referrals.filter(r => r.status === 'paid').reduce((a, r) => a + r.commission_amount, 0)
  const wonDeals = referrals.filter(r => r.status === 'won' || r.status === 'paid')
  const decided = wonDeals.length + referrals.filter(r => r.status === 'lost').length
  const winRate = decided > 0 ? Math.round(wonDeals.length / decided * 100) : 0

  const statusMap: Record<string, { label: string; badge: string }> = {
    lead: { label: 'Lead referred', badge: 'badge badge-lead' },
    presented: { label: 'Presented', badge: 'badge badge-pending' },
    won: { label: 'Comm. earned', badge: 'badge badge-earned' },
    paid: { label: 'Paid out', badge: 'badge badge-paid' },
    lost: { label: 'Lost', badge: 'badge badge-overdue' },
  }

  return (
    <div className="p-6">
      <div className="flex items-start justify-between mb-5">
        <div>
          <h1 className="font-display text-2xl tracking-widest text-white">REFERRALS</h1>
          <p className="text-muted text-xs mt-1">Track jobs referred to you & commissions owed</p>
        </div>
        <button onClick={() => setShowModal(true)}
          className="px-4 py-2 bg-teal text-ink text-xs font-bold rounded-lg hover:bg-teal-2 transition-colors">
          + Log referral
        </button>
      </div>

      {/* Status flow */}
      <div className="flex border border-white/7 rounded-xl overflow-hidden mb-5">
        {[
          { status: 'lead', icon: '📥', label: 'Lead Referred', bg: 'bg-blue-500/8' },
          { status: 'presented', icon: '📤', label: 'Presented', bg: 'bg-yellow-500/8' },
          { status: 'won', icon: '🎯', label: 'Won — Comm. Earned', bg: 'bg-teal/8' },
          { status: 'paid', icon: '✅', label: 'Paid Out', bg: 'bg-emerald-500/8' },
          { status: 'lost', icon: '❌', label: 'Lost', bg: 'bg-red-500/6' },
        ].map(s => (
          <div key={s.status} className={`flex-1 ${s.bg} p-3 text-center border-r border-white/7 last:border-none`}>
            <div className="text-base mb-1">{s.icon}</div>
            <div className="text-xs text-muted">{s.label}</div>
            <div className="text-sm font-bold text-white mt-0.5">{referrals.filter(r => r.status === s.status).length}</div>
          </div>
        ))}
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        {[
          { label: 'Commissions owed', value: `$${owed.toLocaleString()}`, color: 'text-teal' },
          { label: 'Paid out YTD', value: `$${paidYTD.toLocaleString()}`, color: 'text-emerald-400' },
          { label: 'Total deal value (won)', value: `$${wonDeals.reduce((a, r) => a + r.deal_value, 0).toLocaleString()}`, color: 'text-white' },
          { label: 'Win rate', value: `${winRate}%`, color: 'text-yellow-400' },
        ].map(m => (
          <div key={m.label} className="bg-ink-5 border border-white/6 rounded-xl p-3">
            <div className="text-xs text-muted uppercase tracking-wide mb-1">{m.label}</div>
            <div className={`font-display text-xl tracking-wide ${m.color}`}>{m.value}</div>
          </div>
        ))}
      </div>

      {/* Filter */}
      <div className="flex gap-2 mb-4">
        {['all', 'lead', 'presented', 'won', 'paid', 'lost'].map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${filter === f ? 'bg-teal text-ink' : 'bg-white/4 text-muted hover:text-white border border-white/8'}`}>
            {f === 'all' ? 'All' : statusMap[f]?.label || f}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-ink-5 border border-white/6 rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-muted text-sm font-mono animate-pulse">Loading...</div>
        ) : (
          <table className="admin-table">
            <thead><tr>
              <th>Referrer</th><th>Client / Project</th><th>Deal value</th>
              <th>Comm %</th><th>Commission $</th><th>Status</th><th>Actions</th>
            </tr></thead>
            <tbody>
              {filtered.map(r => {
                const rer = referrers.find(x => x.id === r.referrer_id)
                return (
                  <tr key={r.id}>
                    <td>
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
                          style={{ background: rer?.color || '#1a3a6e', color: rer?.tc || '#9FE1CB' }}>
                          {rer?.initials || '?'}
                        </div>
                        <div>
                          <div className="text-xs font-semibold text-white">{rer?.name || r.referrer_id}</div>
                          <div className="text-xs text-muted">{rer?.relationship}</div>
                        </div>
                      </div>
                    </td>
                    <td className="font-semibold">{r.client_name}</td>
                    <td className="text-muted">${r.deal_value.toLocaleString()}</td>
                    <td className="text-muted">{r.commission_rate}%</td>
                    <td className="font-semibold text-teal">${r.commission_amount.toLocaleString()}</td>
                    <td><span className={statusMap[r.status]?.badge || 'badge badge-draft'}>{statusMap[r.status]?.label || r.status}</span></td>
                    <td>
                      <div className="flex gap-1.5">
                        {r.status === 'lead' && (
                          <button onClick={() => updateStatus(r.id, 'presented')}
                            className="text-xs px-2 py-1 bg-yellow-500/12 text-yellow-400 rounded-lg hover:bg-yellow-500/22 transition-colors">→ Presented</button>
                        )}
                        {r.status === 'presented' && (<>
                          <button onClick={() => handleWon(r.id)}
                            className="text-xs px-2 py-1 bg-teal/12 text-teal rounded-lg hover:bg-teal/22 transition-colors">Won ✓</button>
                          <button onClick={() => updateStatus(r.id, 'lost')}
                            className="text-xs px-2 py-1 bg-red-500/12 text-red-400 rounded-lg hover:bg-red-500/22 transition-colors">Lost</button>
                        </>)}
                        {r.status === 'won' && (
                          <button onClick={() => { if (confirm(`Pay $${r.commission_amount.toLocaleString()} to ${rer?.name}?`)) updateStatus(r.id, 'paid') }}
                            className="text-xs px-2 py-1 bg-emerald-500/15 text-emerald-400 rounded-lg hover:bg-emerald-500/25 transition-colors font-semibold">
                            Pay ${r.commission_amount.toLocaleString()}
                          </button>
                        )}
                        {r.status === 'paid' && (
                          <span className="text-xs text-emerald-400 font-mono">✓ {r.date_paid}</span>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={7} className="text-center text-muted py-8">No referrals found.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Log referral modal */}
      {showModal && (
        <div className="fixed inset-0 bg-ink/85 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-ink-2 border border-white/10 rounded-2xl p-7 w-full max-w-md">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-display text-lg tracking-widest text-white">LOG A REFERRAL</h2>
              <button onClick={() => setShowModal(false)} className="text-muted hover:text-white text-lg">✕</button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-muted uppercase tracking-wide mb-1.5">Referred by *</label>
                <select value={form.referrer_id} onChange={e => {
                  const rer = referrers.find(r => r.id === e.target.value)
                  setForm({...form, referrer_id: e.target.value, commission_rate: rer?.default_rate || 5})
                }} className="form-input">
                  <option value="">Select referrer…</option>
                  {referrers.map(r => <option key={r.id} value={r.id}>{r.name} ({r.default_rate}% default)</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-muted uppercase tracking-wide mb-1.5">Client / project name *</label>
                <input value={form.client_name} onChange={e => setForm({...form, client_name: e.target.value})}
                  placeholder="Brand name or project description" className="form-input" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-muted uppercase tracking-wide mb-1.5">Est. deal value ($)</label>
                  <input type="number" value={form.deal_value} onChange={e => setForm({...form, deal_value: parseFloat(e.target.value) || 0})} className="form-input" />
                </div>
                <div>
                  <label className="block text-xs text-muted uppercase tracking-wide mb-1.5">Commission rate (%)</label>
                  <input type="number" value={form.commission_rate} step={0.5} onChange={e => setForm({...form, commission_rate: parseFloat(e.target.value) || 0})} className="form-input" />
                </div>
              </div>
              <div className="flex items-center justify-between bg-teal/6 border border-teal/18 rounded-lg px-4 py-3">
                <span className="text-xs text-muted">Commission if won:</span>
                <span className="font-display text-lg text-teal">${commPreview.toLocaleString()}</span>
              </div>
              <div>
                <label className="block text-xs text-muted uppercase tracking-wide mb-1.5">Status</label>
                <select value={form.status} onChange={e => setForm({...form, status: e.target.value})} className="form-input">
                  <option value="lead">Lead referred (no quote yet)</option>
                  <option value="presented">Presented (quote sent)</option>
                  <option value="won">Won — commission earned</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-muted uppercase tracking-wide mb-1.5">Notes</label>
                <textarea value={form.notes} onChange={e => setForm({...form, notes: e.target.value})}
                  rows={2} placeholder="How it came in, any context…" className="form-input resize-none" />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={saveReferral} disabled={saving}
                className="flex-1 py-2.5 bg-teal text-ink font-bold text-sm rounded-lg hover:bg-teal-2 transition-colors disabled:opacity-50">
                {saving ? 'Saving...' : 'Save referral'}
              </button>
              <button onClick={() => setShowModal(false)}
                className="px-4 py-2.5 border border-white/10 text-muted text-sm rounded-lg hover:text-white transition-colors">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
