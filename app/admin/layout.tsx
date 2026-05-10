'use client'
import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { supabase } from '@/lib/supabase'

const NAV = [
  { href: '/admin/dashboard', label: '📊 Dashboard' },
  { href: '/admin/clients', label: '👥 Clients' },
  { href: '/admin/pipeline', label: '🔁 Pipeline' },
  { href: '/admin/invoices', label: '🧾 Invoices' },
  { href: '/admin/referrals', label: '🤝 Referrals' },
  { href: '/admin/activity', label: '📋 Activity' },
  { href: '/admin/users', label: '⚙️ Users' },
]

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [user, setUser] = useState<any>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session && pathname !== '/admin/login') {
        router.push('/admin/login')
      } else {
        setUser(data.session?.user)
      }
    })
  }, [pathname])

  if (pathname === '/admin/login') return <>{children}</>

  async function signOut() {
    await supabase.auth.signOut()
    router.push('/admin/login')
  }

  return (
    <div style={{display:'flex', minHeight:'100vh', background:'#f0f4f8'}}>
      {/* Mobile overlay */}
      {open && <div onClick={()=>setOpen(false)} style={{position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:40}} />}

      {/* Sidebar */}
      <aside style={{
        width:'220px', background:'#142238', color:'white', display:'flex', flexDirection:'column',
        position:'fixed', top:0, bottom:0, left: open ? 0 : '-220px', zIndex:50,
        transition:'left 0.3s'
      }} className="md-sidebar">
        <div style={{padding:'24px 20px', borderBottom:'1px solid #1c2e48'}}>
          <div style={{fontSize:'16px', fontWeight:'900', color:'#4fd1b0', letterSpacing:'1px'}}>GOOD LIQUID</div>
          <div style={{fontSize:'12px', color:'#9FE1CB', marginTop:'2px'}}>Admin Portal</div>
        </div>
        <nav style={{flex:1, padding:'16px 0'}}>
          {NAV.map(n => (
            <a key={n.href} href={n.href} style={{
              display:'block', padding:'12px 20px', color: pathname === n.href ? '#4fd1b0' : '#9FE1CB',
              background: pathname === n.href ? '#1c2e48' : 'transparent',
              textDecoration:'none', fontSize:'14px', fontWeight: pathname === n.href ? 700 : 400,
              borderLeft: pathname === n.href ? '3px solid #4fd1b0' : '3px solid transparent',
              transition:'all 0.2s'
            }}>{n.label}</a>
          ))}
        </nav>
        <div style={{padding:'16px 20px', borderTop:'1px solid #1c2e48'}}>
          <div style={{fontSize:'12px', color:'#9FE1CB', marginBottom:'8px'}}>{user?.email}</div>
          <button onClick={signOut} style={{background:'#1c2e48', color:'#9FE1CB', border:'none', padding:'8px 16px', borderRadius:'8px', cursor:'pointer', width:'100%', fontSize:'13px'}}>Sign Out</button>
        </div>
      </aside>

      {/* Main */}
      <div style={{flex:1, marginLeft:0, display:'flex', flexDirection:'column'}}>
        {/* Topbar */}
        <header style={{background:'#1c2e48', padding:'16px 24px', display:'flex', alignItems:'center', gap:'16px', position:'sticky', top:0, zIndex:30}}>
          <button onClick={()=>setOpen(!open)} style={{background:'none', border:'none', color:'#4fd1b0', fontSize:'24px', cursor:'pointer'}}>☰</button>
          <span style={{color:'white', fontWeight:'700', fontSize:'16px'}}>Good Liquid CRM</span>
          <div style={{marginLeft:'auto', display:'flex', gap:'12px', alignItems:'center'}}>
            <a href="/admin/invoices/new" style={{background:'#0F6E56', color:'white', padding:'8px 16px', borderRadius:'8px', textDecoration:'none', fontSize:'14px', fontWeight:'600'}}>+ New Invoice</a>
          </div>
        </header>
        <main style={{flex:1, padding:'24px', overflowY:'auto'}}>
          {children}
        </main>
      </div>

      <style>{`
        @media (min-width: 768px) {
          .md-sidebar { left: 0 !important; position: sticky !important; }
          main { margin-left: 0; }
        }
      `}</style>
    </div>
  )
}
