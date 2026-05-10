'use client'

import { useEffect, useState } from 'react'
import { createBrowserClient } from '@/lib/supabase'
import type { Activity } from '@/lib/supabase'

const TYPE_META: Record<string, { icon: string; color: string; bg: string }> = {
  call: { icon: '📞', color: 'text-blue-400', bg: 'bg-blue-500/15' },
  email: { icon: '✉️', color: 'text-emerald-400', bg: 'bg-emerald-500/15' },
  deal: { icon: '⭐', color: 'text-yellow-400', bg: 'bg-yellow-500/12' },
  note: { icon: '📝', color: 'text-muted', bg: 'bg-white/6' },
  ref: { icon: '🤝', color: 'text-teal', bg: 'bg-teal/12' },
  invoice: { icon: '🧾', color: 'text-purple-400', bg: 'bg-purple-500/12' },
}

export default function ActivityPage() {
  const supabase = createBrowserClient()
  const [activity, setActivity] = useState<Activity[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ type: 'call', title: '', detail: '' })
  const [saving, setSaving] = useState(false)

  const load = async () => {
    const { data } = await supabase.from('activity').select('*').order('created_at', { ascending: false }).limit(100)
    setActivity(data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const filtered = filter === 'all' ? activity : activity.filter(a => a.type === filter)

  const logActivity = async () => {
    if (!form.title) return
    setSaving(true)
    await supabase.from('activity').insert([{ type: form.type, title: form.title, detail: form.detail }])
    setShowModal(false)
    setForm({ type: 'call', title: '', detail: '' })
    load()
    setSaving(false)
  }

  const formatTime = (ts: string) => {
    const d = new Date(ts)
    const now = new Date()
    const diff = Math.floor((now.getTime() - d.getTime()) / 1000)
    if (diff < 60) return 'Just now'
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
    if (diff < 172800) return 'Yesterday'
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  return (
    <div className="p-6">
      <div className="flex items-start justify-between mb-5">
        <div>
          <h1 className="font-display text-2xl tracking-widest text-white">ACTIVITY FEED</h1>
          <p className="text-muted text-xs mt-1">All team activity — {filtered.length} entries</p>
        </div>
        <button onClick={() => setShowModal(true)}
          className="px-4 py-2 bg-teal text-ink text-xs font-bold rounded-lg hover:bg-teal-2 transition-colors">
          + Log activity
        </button>
      </div>

      {/* Filter */}
      <div className="flex gap-2 mb-5">
        {['all', 'call', 'email', 'deal', 'invoice', 'ref', 'note'].map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all capitalize ${filter === f ? 'bg-teal text-ink' : 'bg-white/4 text-muted hover:text-white border border-white/8'}`}>
            {f === 'ref' ? '🤝 Referral' : f === 'all' ? 'All' : `${TYPE_META[f]?.icon} ${f.charAt(0).toUpperCase() + f.slice(1)}`}
          </button>
        ))}
      </div>

      {/* Activity list */}
      <div className="bg-ink-5 border border-white/6 rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-muted text-sm font-mono animate-pulse">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-muted text-sm">No activity yet. Start logging calls, emails, and deals.</div>
        ) : (
          <div>
            {filtered.map((a, i) => {
              const meta = TYPE_META[a.type] || TYPE_META.note
              return (
                <div key={a.id} className={`flex items-start gap-3 p-4 ${i < filtered.length - 1 ? 'border-b border-white/5' : ''} hover:bg-white/2 transition-colors`}>
                  <div className={`w-8 h-8 rounded-full ${meta.bg} flex items-center justify-center text-sm flex-shrink-0 mt-0.5`}>
                    {meta.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-white">{a.title}</div>
                    {a.detail && <div className="text-xs text-muted mt-0.5">{a.detail}</div>}
                  </div>
                  <div className="text-xs text-muted/50 flex-shrink-0 font-mono">{formatTime(a.created_at)}</div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Log modal */}
      {showModal && (
        <div className="fixed inset-0 bg-ink/85 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-ink-2 border border-white/10 rounded-2xl p-7 w-full max-w-md">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-display text-lg tracking-widest text-white">LOG ACTIVITY</h2>
              <button onClick={() => setShowModal(false)} className="text-muted hover:text-white text-lg">✕</button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-muted uppercase tracking-wide mb-1.5">Type</label>
                <div className="grid grid-cols-3 gap-2">
                  {['call', 'email', 'deal', 'invoice', 'ref', 'note'].map(t => (
                    <button key={t} onClick={() => setForm({...form, type: t})}
                      className={`p-2 rounded-lg border text-xs font-semibold transition-all capitalize ${form.type === t ? 'border-teal/35 bg-teal/8 text-white' : 'border-white/8 bg-white/3 text-muted hover:text-white'}`}>
                      {TYPE_META[t]?.icon} {t === 'ref' ? 'Referral' : t}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs text-muted uppercase tracking-wide mb-1.5">Title *</label>
                <input value={form.title} onChange={e => setForm({...form, title: e.target.value})}
                  placeholder="e.g. Called SunBurst Seltzers" className="form-input" />
              </div>
              <div>
                <label className="block text-xs text-muted uppercase tracking-wide mb-1.5">Details</label>
                <textarea value={form.detail} onChange={e => setForm({...form, detail: e.target.value})}
                  rows={2} placeholder="Any notes about this activity…" className="form-input resize-none" />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={logActivity} disabled={saving || !form.title}
                className="flex-1 py-2.5 bg-teal text-ink font-bold text-sm rounded-lg hover:bg-teal-2 transition-colors disabled:opacity-50">
                {saving ? 'Saving...' : 'Log activity'}
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
