'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { createBrowserClient } from '@/lib/supabase'
import Link from 'next/link'

const NAV = [
  { href: '/admin/dashboard', label: 'Dashboard', icon: '📊', roles: ['admin','sales','viewer'] },
  { href: '/admin/clients', label: 'Clients', icon: '👥', roles: ['admin','sales','viewer'] },
  { href: '/admin/pipeline', label: 'Pipeline', icon: '📋', roles: ['admin','sales'] },
  { href: '/admin/invoices', label: 'Invoices', icon: '🧾', roles: ['admin','sales'] },
  { href: '/admin/invoices/new', label: 'New Invoice', icon: '➕', roles: ['admin','sales'] },
  { href: '/admin/referrals', label: 'Referrals', icon: '🤝', roles: ['admin','sales'] },
  { href: '/admin/users', label: 'Users & Permissions', icon: '🔑', roles: ['admin'] },
  { href: '/admin/activity', label: 'Activity', icon: '📡', roles: ['admin','sales'] },
]

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const supabase = createBrowserClient()
  const [user, setUser] = useState<any>(null)
  const [profile, setProfile] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const getUser = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { router.push('/admin/login'); return }
      setUser(session.user)
      const { data: prof } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .single()
      setProfile(prof)
      // Update last login
      await supabase.from('profiles').update({ last_login: new Date().toISOString() }).eq('id', session.user.id)
      setLoading(false)
    }
    getUser()

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') router.push('/admin/login')
    })
    return () => subscription.unsubscribe()
  }, [])

  const signOut = async () => {
    await supabase.auth.signOut()
    router.push('/admin/login')
  }

  if (loading) return (
    <div className="fixed inset-0 bg-ink flex items-center justify-center">
      <div className="text-teal font-mono text-sm tracking-widest animate-pulse">LOADING...</div>
    </div>
  )

  const allowedNav = NAV.filter(n => profile && n.roles.includes(profile.role))
  const roleBadge = { admin: { bg: 'bg-teal/20 text-teal', label: 'Admin' }, sales: { bg: 'bg-blue-brand/20 text-blue-400', label: 'Sales' }, viewer: { bg: 'bg-white/10 text-muted', label: 'Viewer' } }
  const rb = roleBadge[profile?.role as keyof typeof roleBadge] || roleBadge.viewer

  return (
    <div className="fixed inset-0 flex flex-col bg-ink-4">
      {/* Top bar */}
      <div className="h-14 bg-ink-3 border-b border-white/8 flex items-center justify-between px-5 flex-shrink-0">
        <Link href="/" className="text-muted hover:text-teal text-sm flex items-center gap-2 transition-colors">
          ← Back to website
        </Link>
        <div className="flex items-center gap-2">
          <span className="font-display text-sm tracking-widest text-white">GOOD LIQUID</span>
          <span className="text-teal text-xs tracking-widest font-mono">CRM · Admin</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-sm text-white font-semibold">{profile?.name}</div>
            <span className={`text-xs px-2 py-0.5 rounded-full ${rb.bg}`}>{rb.label}</span>
          </div>
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
            style={{ background: profile?.color || '#1a3a6e', color: profile?.tc || '#9FE1CB' }}
          >
            {profile?.initials || '??'}
          </div>
          <button onClick={signOut} className="text-xs text-muted hover:text-white px-3 py-1.5 border border-white/10 rounded-lg transition-colors">
            Sign out
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <div className="w-48 bg-ink-3 border-r border-white/7 flex flex-col overflow-y-auto flex-shrink-0">
          <nav className="p-2 flex-1">
            {allowedNav.map(item => (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium mb-0.5 transition-all ${
                  pathname === item.href
                    ? 'bg-teal/10 text-teal border border-teal/20'
                    : 'text-muted hover:text-white hover:bg-white/5'
                }`}
              >
                <span className="text-sm">{item.icon}</span>
                {item.label}
              </Link>
            ))}
          </nav>
        </div>

        {/* Main */}
        <main className="flex-1 overflow-y-auto bg-ink-4">
          {children}
        </main>
      </div>
    </div>
  )
}
