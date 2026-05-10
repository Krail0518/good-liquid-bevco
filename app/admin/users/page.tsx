'use client'

import { useEffect, useState } from 'react'
import { createBrowserClient } from '@/lib/supabase'
import type { Profile } from '@/lib/supabase'

const COLORS = [
  { color: '#0F6E56', tc: '#E1F5EE' }, { color: '#1a3a6e', tc: '#9FE1CB' },
  { color: '#854F0B', tc: '#FAEEDA' }, { color: '#3C3489', tc: '#EEEDFE' },
]

export default function UsersPage() {
  const supabase = createBrowserClient()
  const [users, setUsers] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [showInvite, setShowInvite] = useState(false)
  const [showRole, setShowRole] = useState<Profile | null>(null)
  const [currentUser, setCurrentUser] = useState<any>(null)
  const [form, setForm] = useState({ name: '', email: '', role: 'sales', tempPw: '' })
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState(false)

  const load = async () => {
    const [{ data: { user } }, { data: profiles }] = await Promise.all([
      supabase.auth.getUser(),
      supabase.from('profiles').select('*').order('created_at'),
    ])
    setCurrentUser(user)
    setUsers(profiles || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const genPw = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#'
    let pw = 'GL'
    for (let i = 0; i < 6; i++) pw += chars[Math.floor(Math.random() * chars.length)]
    setForm(f => ({...f, tempPw: pw}))
  }

  useEffect(() => { if (showInvite) genPw() }, [showInvite])

  const inviteText = `Hi ${form.name.split(' ')[0] || ''},\n\nYou've been invited to Good Liquid Bev Co CRM.\n\nWebsite: https://www.goodliquidbevco.com/admin\nEmail: ${form.email}\nPassword: ${form.tempPw}\nRole: ${form.role.charAt(0).toUpperCase() + form.role.slice(1)}\n\nNote: Change your password after first login.`

  const copyInvite = () => {
    navigator.clipboard.writeText(inviteText).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2500) })
  }

  const saveInvite = async () => {
    if (!form.name || !form.email || !form.tempPw) { alert('Please fill in all fields.'); return }
    setSaving(true)
    // Create user in Supabase Auth via admin
    const initials = form.name.split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2)
    const palette = COLORS[users.length % COLORS.length]
    // Note: In production, this would use a server-side admin API call to create the auth user
    // For now, we insert the profile — admin must create the auth user manually in Supabase dashboard
    const { error } = await supabase.from('profiles').insert([{
      id: crypto.randomUUID(), // Temp — must match auth user UUID
      name: form.name,
      email: form.email.toLowerCase(),
      role: form.role as 'admin' | 'sales' | 'viewer',
      status: 'active',
      initials,
      color: palette.color,
      tc: palette.tc,
    }])
    if (!error) {
      setShowInvite(false)
      setForm({ name: '', email: '', role: 'sales', tempPw: '' })
      load()
      alert(`✓ Profile created.\n\nIMPORTANT: You must also create the auth account in Supabase:\nAuthentication → Users → Add user → ${form.email}\n\nThen update the profile ID to match the auth UUID.`)
    } else {
      alert('Error: ' + error.message)
    }
    setSaving(false)
  }

  const changeRole = async (userId: string, role: string) => {
    await supabase.from('profiles').update({ role }).eq('id', userId)
    setShowRole(null)
    load()
  }

  const toggleStatus = async (user: Profile) => {
    const newStatus = user.status === 'active' ? 'inactive' : 'active'
    if (!confirm(`${newStatus === 'inactive' ? 'Deactivate' : 'Reactivate'} ${user.name}?`)) return
    await supabase.from('profiles').update({ status: newStatus }).eq('id', user.id)
    load()
  }

  const roleStyle: Record<string, { badge: string; desc: string; icon: string }> = {
    admin: { badge: 'badge badge-admin', desc: 'Full access — users, invoices, commissions, all settings', icon: '👑' },
    sales: { badge: 'badge badge-sales', desc: 'Clients, pipeline, invoices, referrals. No user management.', icon: '💼' },
    viewer: { badge: 'badge badge-viewer', desc: 'Dashboard & clients only — read only.', icon: '👁' },
  }

  return (
    <div className="p-6">
      <div className="flex items-start justify-between mb-5">
        <div>
          <h1 className="font-display text-2xl tracking-widest text-white">USERS & PERMISSIONS</h1>
          <p className="text-muted text-xs mt-1">{users.length} team members</p>
        </div>
        <button onClick={() => setShowInvite(true)}
          className="px-4 py-2 bg-teal text-ink text-xs font-bold rounded-lg hover:bg-teal-2 transition-colors">
          + Invite user
        </button>
      </div>

      {/* Role guide */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        {Object.entries(roleStyle).map(([role, s]) => (
          <div key={role} className={`rounded-xl p-4 border ${role === 'admin' ? 'bg-teal/6 border-teal/18' : role === 'sales' ? 'bg-blue-500/6 border-blue-500/18' : 'bg-white/3 border-white/8'}`}>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-base">{s.icon}</span>
              <span className={`font-display text-sm tracking-widest ${role === 'admin' ? 'text-teal' : role === 'sales' ? 'text-blue-400' : 'text-muted'}`}>{role.toUpperCase()}</span>
            </div>
            <p className="text-xs text-muted leading-relaxed">{s.desc}</p>
          </div>
        ))}
      </div>

      {/* Users list */}
      <div className="space-y-3">
        {loading ? <div className="text-muted text-sm font-mono animate-pulse">Loading users...</div> : users.map(u => (
          <div key={u.id} className="flex items-center justify-between p-4 bg-ink-5 border border-white/6 rounded-xl hover:border-white/10 transition-all">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold"
                style={{ background: u.color, color: u.tc }}>{u.initials}</div>
              <div>
                <div className="font-semibold text-white text-sm">
                  {u.name}
                  {u.id === currentUser?.id && <span className="text-muted text-xs ml-1.5">(you)</span>}
                </div>
                <div className="text-xs text-muted">{u.email}</div>
                <div className="text-xs text-muted/50 mt-0.5">Last login: {u.last_login ? new Date(u.last_login).toLocaleDateString() : 'Never'}</div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className={roleStyle[u.role]?.badge || 'badge badge-draft'}>{u.role.charAt(0).toUpperCase() + u.role.slice(1)}</span>
              <span className={`badge ${u.status === 'active' ? 'badge-active' : 'badge-draft'}`}>{u.status}</span>
              {u.id !== currentUser?.id && (
                <div className="flex gap-1.5">
                  <button onClick={() => setShowRole(u)}
                    className="text-xs px-2.5 py-1 bg-white/5 text-muted rounded-lg hover:text-white transition-colors">Change role</button>
                  <button onClick={() => toggleStatus(u)}
                    className={`text-xs px-2.5 py-1 rounded-lg transition-colors ${u.status === 'active' ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20' : 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'}`}>
                    {u.status === 'active' ? 'Deactivate' : 'Reactivate'}
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Invite modal */}
      {showInvite && (
        <div className="fixed inset-0 bg-ink/85 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-ink-2 border border-white/10 rounded-2xl p-7 w-full max-w-md">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-display text-lg tracking-widest text-white">INVITE TEAM MEMBER</h2>
              <button onClick={() => setShowInvite(false)} className="text-muted hover:text-white text-lg">✕</button>
            </div>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-muted uppercase tracking-wide mb-1.5">Full name *</label>
                  <input value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="First Last" className="form-input" />
                </div>
                <div>
                  <label className="block text-xs text-muted uppercase tracking-wide mb-1.5">Email *</label>
                  <input type="email" value={form.email} onChange={e => setForm({...form, email: e.target.value})} placeholder="name@email.com" className="form-input" />
                </div>
              </div>
              <div>
                <label className="block text-xs text-muted uppercase tracking-wide mb-1.5">Role</label>
                <select value={form.role} onChange={e => setForm({...form, role: e.target.value})} className="form-input">
                  <option value="sales">Sales — clients, pipeline, invoices, referrals</option>
                  <option value="viewer">Viewer — dashboard & clients (read-only)</option>
                  <option value="admin">Admin — full access including user management</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-muted uppercase tracking-wide mb-1.5">Temporary password</label>
                <div className="flex gap-2">
                  <input value={form.tempPw} onChange={e => setForm({...form, tempPw: e.target.value})}
                    className="form-input flex-1 font-mono tracking-widest" />
                  <button onClick={genPw} className="px-3 py-2 bg-white/5 text-muted text-xs rounded-lg hover:text-white transition-colors">🔄</button>
                </div>
              </div>
              <div className="bg-yellow-500/6 border border-yellow-500/18 rounded-lg p-3 text-xs text-muted leading-relaxed">
                ⚠️ You also need to create this user in <strong className="text-yellow-400">Supabase → Authentication → Users</strong> with the same email and password. Share the credentials with them directly.
              </div>
              <div className="bg-white/4 rounded-lg p-3">
                <div className="text-xs text-muted uppercase tracking-wide mb-2">Copy & share with them:</div>
                <pre className="text-xs text-white font-mono leading-relaxed whitespace-pre-wrap">{inviteText}</pre>
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={copyInvite} className="flex-1 py-2.5 bg-emerald-500/15 text-emerald-400 font-bold text-sm rounded-lg hover:bg-emerald-500/25 transition-colors">
                {copied ? '✓ Copied!' : '📋 Copy invite text'}
              </button>
              <button onClick={saveInvite} disabled={saving}
                className="flex-1 py-2.5 bg-teal text-ink font-bold text-sm rounded-lg hover:bg-teal-2 transition-colors disabled:opacity-50">
                {saving ? 'Saving...' : 'Add user'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Change role modal */}
      {showRole && (
        <div className="fixed inset-0 bg-ink/85 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-ink-2 border border-white/10 rounded-2xl p-7 w-full max-w-sm">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-display text-lg tracking-widest text-white">CHANGE ROLE</h2>
              <button onClick={() => setShowRole(null)} className="text-muted hover:text-white text-lg">✕</button>
            </div>
            <div className="flex items-center gap-3 p-3 bg-white/4 rounded-lg mb-4">
              <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold" style={{ background: showRole.color, color: showRole.tc }}>{showRole.initials}</div>
              <div><div className="font-semibold text-white text-sm">{showRole.name}</div><div className="text-xs text-muted">{showRole.email}</div></div>
            </div>
            <div className="space-y-2 mb-5">
              {['admin', 'sales', 'viewer'].map(role => (
                <button key={role} onClick={() => changeRole(showRole.id, role)}
                  className={`w-full p-3 rounded-lg border text-left transition-all ${showRole.role === role ? 'border-teal/30 bg-teal/8' : 'border-white/8 bg-white/3 hover:border-white/15'}`}>
                  <div className="flex items-center gap-2">
                    <span>{roleStyle[role].icon}</span>
                    <span className="font-semibold text-white text-sm capitalize">{role}</span>
                    {showRole.role === role && <span className="text-xs text-teal ml-auto">Current</span>}
                  </div>
                  <div className="text-xs text-muted mt-1 ml-6">{roleStyle[role].desc}</div>
                </button>
              ))}
            </div>
            <button onClick={() => setShowRole(null)} className="w-full py-2 border border-white/10 text-muted text-sm rounded-lg hover:text-white transition-colors">Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}
