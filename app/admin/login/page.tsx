'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setError('Invalid email or password')
      setLoading(false)
    } else {
      router.push('/admin/dashboard')
    }
  }

  return (
    <div style={{minHeight:'100vh', background:'#0a1628', display:'flex', alignItems:'center', justifyContent:'center', padding:'20px'}}>
      <div style={{background:'#1c2e48', borderRadius:'20px', padding:'48px', width:'100%', maxWidth:'420px', boxShadow:'0 20px 60px rgba(0,0,0,0.5)'}}>
        <div style={{textAlign:'center', marginBottom:'40px'}}>
          <div style={{fontSize:'28px', fontWeight:'900', color:'#4fd1b0', letterSpacing:'2px'}}>GOOD LIQUID</div>
          <div style={{color:'#9FE1CB', fontSize:'14px', marginTop:'4px'}}>Admin Portal</div>
        </div>
        <form onSubmit={handleLogin} style={{display:'flex', flexDirection:'column', gap:'20px'}}>
          <div>
            <label style={{color:'#9FE1CB', fontSize:'14px', display:'block', marginBottom:'8px'}}>Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              style={{width:'100%', padding:'14px', borderRadius:'10px', background:'#142238', border:'1px solid #2a4060', color:'white', fontSize:'16px', boxSizing:'border-box'}}
            />
          </div>
          <div>
            <label style={{color:'#9FE1CB', fontSize:'14px', display:'block', marginBottom:'8px'}}>Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              style={{width:'100%', padding:'14px', borderRadius:'10px', background:'#142238', border:'1px solid #2a4060', color:'white', fontSize:'16px', boxSizing:'border-box'}}
            />
          </div>
          {error && <div style={{color:'#f87171', textAlign:'center', fontSize:'14px'}}>{error}</div>}
          <button
            type="submit"
            disabled={loading}
            style={{background:'#0F6E56', color:'white', padding:'16px', borderRadius:'12px', border:'none', fontSize:'18px', fontWeight:'700', cursor:'pointer', marginTop:'8px'}}
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
        <div style={{textAlign:'center', marginTop:'24px'}}>
          <a href="/" style={{color:'#4a6a8a', fontSize:'14px', textDecoration:'none'}}>← Back to website</a>
        </div>
      </div>
    </div>
  )
}
