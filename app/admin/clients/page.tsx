'use client'

import { useEffect, useState } from 'react'
import { createBrowserClient } from '@/lib/supabase'
import type { Client, Referrer } from '@/lib/supabase'

const COLORS = [
  { color: '#1a3a6e', tc: '#9FE1CB' }, { color: '#0F6E56', tc: '#E1F5EE' },
  { color: '#854F0B', tc: '#FAEEDA' }, { color: '#3C3489', tc: '#EEEDFE' },
  { color: '#712B13', tc: '#FAECE7' }, { color: '#27500A', tc: '#EAF3DE' },
]

export default function ClientsPage() {
  const supabase = createBrowserClient()
  const [clients, setClients] = useState<Client[]>([])
  const [referrers, setReferrers] = useState<Referrer[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [showModal, setShowModal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    name: '', contact_name: '', email: '', phone: '',
    service: 'Canning', status: 'lead', referred_by: '', notes: ''
  })

  const load = async () => {
    const [cli, ref] = await Promise.all([
      supabase.from('clients').select('*').order('created_at', { ascending: false }),
      supabase.from('referrers').select('*').order('name'),
    ])
    setClients(cli.data || [])
    setReferrers(ref.data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const filtered = clients.filter(c => {
    const matchQ = !search || c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.contact_name?.toLowerCase().includes(search.toLowerCase()) ||
      c.email?.toLowerCase().includes(search.toLowerCase())
    const matchF = filter === 'all' || c.status === filter
    return matchQ && matchF
  })

  const saveClient = async () => {
    if (!form.name) return
    setSaving(true)
    const initials = form.name.split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2)
    const palette = COLORS[clients.length % COLORS.length]
    const { error } = await supabase.from('clients').insert([{
      ...form,
      referred_by: form.referred_by || null,
      initials,
      color: palette.color,
      tc: palette.tc,
      total_billed: 0,
    }])
    if (!error) {
      await supabase.from('activity').insert([{
        type: 'note', title: `New client added — ${form.name}`,
        detail: `${form.contact_name} · ${form.service}`,
      }])
      setShowModal(false)
      setForm({ name: '', contact_name: '', email: '', phone: '', service: 'Canning', status: 'lead', referred_by: '', notes: '' })
      load()
    }
    setSaving(false)
  }

  const statusBadge: Record<string, string> = {
    active: 'badge badge-active', lead: 'badge badge-lead', inactive: 'badge badge-draft'
  }

  return (
    <div className="p-6">
      <div className="flex items-start justify-between mb-5">
        <div>
          <h1 className="font-display text-2xl tracking-widest text-white">CLIENTS</h1>
          <p className="text-muted text-xs mt-1">{filtered.length} beverage brands</p>
        </div>
        <button onClick={() => setShowModal(true)}
          className="px-4 py-2 bg-teal text-ink text-xs font-bold rounded-lg hover:bg-teal-2 transition-colors">
          + Add client
        </button>
      </div>

      {/* Search & filter */}
      <div className="flex gap-3 mb-4">
        <div className="flex items-center gap-2 flex-1 bg-white/4 border border-white/8 rounded-lg px-3 py-2">
          <span className="text-muted text-sm">🔍</span>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by name, email, contact…"
            className="flex-1 bg-transparent text-white text-sm placeholder-muted/50 outline-none" />
        </div>
        {['all', 'active', 'lead', 'inactive'].map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all ${filter === f ? 'bg-teal text-ink' : 'bg-white/4 text-muted hover:text-white border border-white/8'}`}>
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-ink-5 border border-white/6 rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-muted text-sm font-mono animate-pulse">Loading clients...</div>
        ) : (
          <table className="admin-table">
            <thead><tr>
              <th>Brand</th><th>Contact</th><th>Email</th><th>Phone</th>
              <th>Service</th><th>Status</th><th>Referred by</th><th>Total billed</th>
            </tr></thead>
            <tbody>
              {filtered.map(c => {
                const ref = referrers.find(r => r.id === c.referred_by)
                return (
                  <tr key={c.id}>
                    <td>
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                          style={{ background: c.color, color: c.tc }}>{c.initials}</div>
                        <span className="font-semibold">{c.name}</span>
                      </div>
                    </td>
                    <td className="text-muted">{c.contact_name}</td>
                    <td className="text-muted text-xs">{c.email}</td>
                    <td className="text-muted text-xs">{c.phone}</td>
                    <td className="text-muted">{c.service}</td>
                    <td><span className={statusBadge[c.status]}>{c.status}</span></td>
                    <td className="text-muted text-xs">{ref ? `🤝 ${ref.name}` : '—'}</td>
                    <td className="font-semibold">${c.total_billed.toLocaleString()}</td>
                  </tr>
                )
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={8} className="text-center text-muted py-8">No clients found.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Add Client Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-ink/85 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-ink-2 border border-white/10 rounded-2xl p-7 w-full max-w-md">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-display text-lg tracking-widest text-white">ADD CLIENT</h2>
              <button onClick={() => setShowModal(false)} className="text-muted hover:text-white text-lg">✕</button>
            </div>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-muted uppercase tracking-wide mb-1.5">Brand name *</label>
                  <input value={form.name} onChange={e => setForm({...form, name: e.target.value})}
                    placeholder="Brand Co." className="form-input" />
                </div>
                <div>
                  <label className="block text-xs text-muted uppercase tracking-wide mb-1.5">Contact name</label>
                  <input value={form.contact_name} onChange={e => setForm({...form, contact_name: e.target.value})}
                    placeholder="First Last" className="form-input" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-muted uppercase tracking-wide mb-1.5">Email</label>
                  <input type="email" value={form.email} onChange={e => setForm({...form, email: e.target.value})}
                    placeholder="email@brand.com" className="form-input" />
                </div>
                <div>
                  <label className="block text-xs text-muted uppercase tracking-wide mb-1.5">Phone</label>
                  <input value={form.phone} onChange={e => setForm({...form, phone: e.target.value})}
                    placeholder="(555) 000-0000" className="form-input" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-muted uppercase tracking-wide mb-1.5">Service</label>
                  <select value={form.service} onChange={e => setForm({...form, service: e.target.value})} className="form-input">
                    <option>Canning</option><option>Bottling</option><option>R&D</option>
                    <option>R&D + Canning</option><option>Consulting</option><option>Co-packing</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-muted uppercase tracking-wide mb-1.5">Status</label>
                  <select value={form.status} onChange={e => setForm({...form, status: e.target.value})} className="form-input">
                    <option value="lead">Lead</option>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs text-muted uppercase tracking-wide mb-1.5">Referred by</label>
                <select value={form.referred_by} onChange={e => setForm({...form, referred_by: e.target.value})} className="form-input">
                  <option value="">None</option>
                  {referrers.map(r => <option key={r.id} value={r.id}>{r.name} ({r.default_rate}%)</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-muted uppercase tracking-wide mb-1.5">Notes</label>
                <textarea value={form.notes} onChange={e => setForm({...form, notes: e.target.value})}
                  rows={2} placeholder="Any notes about this client…" className="form-input resize-none" />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={saveClient} disabled={saving || !form.name}
                className="flex-1 py-2.5 bg-teal text-ink font-bold text-sm rounded-lg hover:bg-teal-2 transition-colors disabled:opacity-50">
                {saving ? 'Saving...' : 'Add client'}
              </button>
              <button onClick={() => setShowModal(false)}
                className="px-4 py-2.5 border border-white/10 text-muted text-sm rounded-lg hover:text-white transition-colors">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
