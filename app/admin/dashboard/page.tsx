'use client'

import { useEffect, useState } from 'react'
import { createBrowserClient } from '@/lib/supabase'
import type { Invoice, Client, Referral, Activity } from '@/lib/supabase'
import Link from 'next/link'

export default function DashboardPage() {
  const supabase = createBrowserClient()
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [referrals, setReferrals] = useState<Referral[]>([])
  const [activity, setActivity] = useState<Activity[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      const [inv, cli, ref, act] = await Promise.all([
        supabase.from('invoices').select('*').order('created_at', { ascending: false }),
        supabase.from('clients').select('*'),
        supabase.from('referrals').select('*'),
        supabase.from('activity').select('*').order('created_at', { ascending: false }).limit(8),
      ])
      setInvoices(inv.data || [])
      setClients(cli.data || [])
      setReferrals(ref.data || [])
      setActivity(act.data || [])
      setLoading(false)
    }
    load()
  }, [])

  const paid = invoices.filter(i => i.status === 'paid').reduce((a, i) => a + i.amount, 0)
  const pending = invoices.filter(i => i.status === 'pending').reduce((a, i) => a + i.amount, 0)
  const overdue = invoices.filter(i => i.status === 'overdue').reduce((a, i) => a + i.amount, 0)
  const activeClients = clients.filter(c => c.status === 'active').length
  const commOwed = referrals.filter(r => r.status === 'won').reduce((a, r) => a + r.commission_amount, 0)

  const metrics = [
    { label: 'Total collected', value: `$${Math.round(paid / 1000)}K`, delta: '↑ YTD 2026', up: true },
    { label: 'Pending invoices', value: `$${Math.round(pending / 1000)}K`, delta: `${invoices.filter(i => i.status === 'pending').length} open`, up: null },
    { label: 'Overdue', value: `$${Math.round(overdue / 1000)}K`, delta: `${invoices.filter(i => i.status === 'overdue').length} invoice(s)`, up: false },
    { label: 'Active brands', value: activeClients.toString(), delta: `+${clients.filter(c => c.status === 'lead').length} leads`, up: true },
    { label: 'Commissions owed', value: `$${commOwed.toLocaleString()}`, delta: 'To referrers', up: null },
  ]

  const statusColor: Record<string, string> = {
    paid: 'bg-emerald-500/15 text-emerald-400',
    pending: 'bg-yellow-500/12 text-yellow-400',
    overdue: 'bg-red-500/13 text-red-400',
    draft: 'bg-white/7 text-muted',
  }

  const actIcon: Record<string, string> = { call: '📞', email: '✉️', deal: '⭐', note: '📝', ref: '🤝', invoice: '🧾' }

  if (loading) return <div className="p-6 text-muted font-mono text-sm animate-pulse">Loading dashboard...</div>

  return (
    <div className="p-6">
      <div className="flex items-start justify-between mb-5">
        <div>
          <h1 className="font-display text-2xl tracking-widest text-white">DASHBOARD</h1>
          <p className="text-muted text-xs mt-1">Good Liquid Bev Co · {new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</p>
        </div>
        <Link href="/admin/invoices/new" className="px-4 py-2 bg-teal text-ink text-xs font-bold rounded-lg hover:bg-teal-2 transition-colors">
          + New Invoice
        </Link>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-5 gap-3 mb-5">
        {metrics.map(m => (
          <div key={m.label} className="bg-ink-5 rounded-xl p-3 border border-white/6">
            <div className="text-xs text-muted mb-1 uppercase tracking-wide">{m.label}</div>
            <div className="font-display text-xl tracking-wide text-white">{m.value}</div>
            {m.delta && (
              <div className={`text-xs mt-1 ${m.up === true ? 'text-emerald-400' : m.up === false ? 'text-red-400' : 'text-muted'}`}>
                {m.delta}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4 mb-4">
        {/* Recent invoices */}
        <div className="bg-ink-5 border border-white/6 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-semibold text-white">Recent invoices</div>
            <Link href="/admin/invoices" className="text-xs text-teal hover:text-teal-2">View all →</Link>
          </div>
          <table className="w-full">
            <thead><tr>
              <th className="text-left text-xs text-muted pb-2">Client</th>
              <th className="text-right text-xs text-muted pb-2">Amount</th>
              <th className="text-right text-xs text-muted pb-2">Status</th>
            </tr></thead>
            <tbody>
              {invoices.slice(0, 6).map(inv => (
                <tr key={inv.id} className="border-t border-white/5">
                  <td className="py-2 text-xs text-white">{inv.client_name}</td>
                  <td className="py-2 text-xs text-right font-semibold">${inv.amount.toLocaleString()}</td>
                  <td className="py-2 text-right">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${statusColor[inv.status]}`}>{inv.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Activity feed */}
        <div className="bg-ink-5 border border-white/6 rounded-xl p-4">
          <div className="text-sm font-semibold text-white mb-3">Activity feed</div>
          <div className="space-y-0">
            {activity.slice(0, 6).map(a => (
              <div key={a.id} className="flex items-start gap-2 py-2 border-b border-white/5 last:border-none">
                <span className="text-sm mt-0.5">{actIcon[a.type] || '📌'}</span>
                <div>
                  <div className="text-xs font-semibold text-white">{a.title}</div>
                  <div className="text-xs text-muted">{a.detail}</div>
                  <div className="text-xs text-muted/50 mt-0.5">{new Date(a.created_at).toLocaleDateString()}</div>
                </div>
              </div>
            ))}
            {activity.length === 0 && <div className="text-xs text-muted">No activity yet.</div>}
          </div>
        </div>
      </div>

      {/* Quick links */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { href: '/admin/clients', label: 'Add client', icon: '👥' },
          { href: '/admin/invoices/new', label: 'Create invoice', icon: '🧾' },
          { href: '/admin/referrals', label: 'Log referral', icon: '🤝' },
          { href: '/admin/pipeline', label: 'View pipeline', icon: '📋' },
        ].map(q => (
          <Link key={q.href} href={q.href}
            className="bg-ink-5 border border-white/6 rounded-xl p-4 flex items-center gap-3 hover:border-teal/25 hover:bg-teal/5 transition-all group">
            <span className="text-xl">{q.icon}</span>
            <span className="text-xs font-semibold text-muted group-hover:text-white transition-colors">{q.label}</span>
          </Link>
        ))}
      </div>
    </div>
  )
}
