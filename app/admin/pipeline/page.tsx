'use client'

import { useEffect, useState } from 'react'
import { createBrowserClient } from '@/lib/supabase'
import type { Deal } from '@/lib/supabase'

const STAGES = ['Prospecting', 'Proposal', 'Negotiation', 'Closed Won', 'Closed Lost'] as const
const STAGE_COLORS: Record<string, string> = {
  'Prospecting': '#6b87ad', 'Proposal': '#1a6fff',
  'Negotiation': '#f5c842', 'Closed Won': '#00c4a7', 'Closed Lost': '#e74c3c'
}

export default function PipelinePage() {
  const supabase = createBrowserClient()
  const [deals, setDeals] = useState<Deal[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ name: '', client_name: '', value: 0, stage: 'Prospecting', probability: 20, notes: '' })

  const load = async () => {
    const { data } = await supabase.from('deals').select('*').order('created_at', { ascending: false })
    setDeals(data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const moveStage = async (id: string, stage: string) => {
    await supabase.from('deals').update({ stage, updated_at: new Date().toISOString() }).eq('id', id)
    load()
  }

  const saveDeal = async () => {
    if (!form.name || !form.client_name) return
    setSaving(true)
    await supabase.from('deals').insert([{ ...form }])
    setShowModal(false)
    setForm({ name: '', client_name: '', value: 0, stage: 'Prospecting', probability: 20, notes: '' })
    load()
    setSaving(false)
  }

  const totalPipeline = deals.filter(d => !['Closed Won','Closed Lost'].includes(d.stage)).reduce((a, d) => a + d.value, 0)
  const totalWon = deals.filter(d => d.stage === 'Closed Won').reduce((a, d) => a + d.value, 0)

  if (loading) return <div className="p-6 text-muted font-mono text-sm animate-pulse">Loading pipeline...</div>

  return (
    <div className="p-6">
      <div className="flex items-start justify-between mb-5">
        <div>
          <h1 className="font-display text-2xl tracking-widest text-white">PIPELINE</h1>
          <p className="text-muted text-xs mt-1">
            ${Math.round(totalPipeline / 1000)}K active · ${Math.round(totalWon / 1000)}K closed won
          </p>
        </div>
        <button onClick={() => setShowModal(true)}
          className="px-4 py-2 bg-teal text-ink text-xs font-bold rounded-lg hover:bg-teal-2 transition-colors">
          + New deal
        </button>
      </div>

      {/* Kanban */}
      <div className="grid grid-cols-5 gap-3">
        {STAGES.map(stage => {
          const stageDeals = deals.filter(d => d.stage === stage)
          const stageTotal = stageDeals.reduce((a, d) => a + d.value, 0)
          const color = STAGE_COLORS[stage]
          return (
            <div key={stage} className="bg-ink-3 border border-white/6 rounded-xl p-3">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-bold uppercase tracking-wide" style={{ color }}>{stage}</span>
                <span className="text-xs bg-white/6 border border-white/8 rounded-full px-2 py-0.5 text-muted">{stageDeals.length}</span>
              </div>
              <div className="space-y-2 min-h-16">
                {stageDeals.map(d => (
                  <div key={d.id} className="bg-ink-4 border border-white/7 rounded-lg p-3 hover:border-white/15 transition-all">
                    <div className="text-xs font-semibold text-white mb-0.5">{d.name}</div>
                    <div className="text-xs text-muted">{d.client_name}</div>
                    <div className="text-xs font-semibold text-white mt-2">${d.value.toLocaleString()}</div>
                    <div className="h-1 bg-white/7 rounded-full mt-2 overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${d.probability}%`, background: color }}></div>
                    </div>
                    <div className="text-xs text-muted mt-1">{d.probability}% probability</div>
                    {/* Move stage buttons */}
                    <div className="flex gap-1 mt-2 flex-wrap">
                      {STAGES.filter(s => s !== stage).slice(0, 2).map(s => (
                        <button key={s} onClick={() => moveStage(d.id, s)}
                          className="text-xs px-1.5 py-0.5 bg-white/5 text-muted rounded hover:text-white transition-colors">
                          → {s.split(' ')[0]}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              {stageTotal > 0 && (
                <div className="text-xs text-muted text-center mt-2 pt-2 border-t border-white/6">
                  ${Math.round(stageTotal / 1000)}K
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Add deal modal */}
      {showModal && (
        <div className="fixed inset-0 bg-ink/85 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-ink-2 border border-white/10 rounded-2xl p-7 w-full max-w-md">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-display text-lg tracking-widest text-white">NEW DEAL</h2>
              <button onClick={() => setShowModal(false)} className="text-muted hover:text-white text-lg">✕</button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-muted uppercase tracking-wide mb-1.5">Deal name *</label>
                <input value={form.name} onChange={e => setForm({...form, name: e.target.value})}
                  placeholder="e.g. SunBurst Q3 Canning Run" className="form-input" />
              </div>
              <div>
                <label className="block text-xs text-muted uppercase tracking-wide mb-1.5">Client / company *</label>
                <input value={form.client_name} onChange={e => setForm({...form, client_name: e.target.value})}
                  placeholder="Brand name" className="form-input" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-muted uppercase tracking-wide mb-1.5">Deal value ($)</label>
                  <input type="number" value={form.value} onChange={e => setForm({...form, value: parseFloat(e.target.value) || 0})} className="form-input" />
                </div>
                <div>
                  <label className="block text-xs text-muted uppercase tracking-wide mb-1.5">Stage</label>
                  <select value={form.stage} onChange={e => setForm({...form, stage: e.target.value})} className="form-input">
                    {STAGES.map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs text-muted uppercase tracking-wide mb-1.5">Probability ({form.probability}%)</label>
                <input type="range" min={0} max={100} step={5} value={form.probability}
                  onChange={e => setForm({...form, probability: parseInt(e.target.value)})}
                  className="w-full accent-teal" />
              </div>
              <div>
                <label className="block text-xs text-muted uppercase tracking-wide mb-1.5">Notes</label>
                <textarea value={form.notes} onChange={e => setForm({...form, notes: e.target.value})}
                  rows={2} className="form-input resize-none" placeholder="Any context on this deal…" />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={saveDeal} disabled={saving || !form.name || !form.client_name}
                className="flex-1 py-2.5 bg-teal text-ink font-bold text-sm rounded-lg hover:bg-teal-2 transition-colors disabled:opacity-50">
                {saving ? 'Saving...' : 'Add deal'}
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
