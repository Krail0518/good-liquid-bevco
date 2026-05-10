'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@/lib/supabase'

export default function LoginPage() {
  const router = useRouter()
  const supabase = createBrowserClient()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const signIn = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setError('Incorrect email or password.')
      setLoading(false)
    } else {
      router.push('/admin/dashboard')
    }
  }

  return (
    <div className="min-h-screen bg-ink flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="font-display text-3xl tracking-widest text-white mb-1">GOOD LIQUID</div>
          <div className="font-mono text-xs tracking-widest text-teal">BEV CO · CRM</div>
        </div>

        <div className="bg-ink-2 border border-white/10 rounded-2xl p-8">
          <div className="font-display text-2xl tracking-widest text-white mb-1">SIGN IN</div>
          <div className="text-muted text-sm mb-6">Good Liquid Bev Co · Admin</div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm px-4 py-3 rounded-lg mb-4">
              {error}
            </div>
          )}

          <form onSubmit={signIn} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold tracking-widest text-muted uppercase mb-2">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="your@email.com"
                required
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white text-sm placeholder-muted/50 focus:outline-none focus:border-teal focus:bg-teal/5 transition-all"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold tracking-widest text-muted uppercase mb-2">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white text-sm placeholder-muted/50 focus:outline-none focus:border-teal focus:bg-teal/5 transition-all"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-teal text-ink font-bold rounded-lg text-sm tracking-wide hover:bg-teal-2 transition-colors disabled:opacity-50"
            >
              {loading ? 'Signing in...' : 'Sign in →'}
            </button>
          </form>

          <div className="mt-6 pt-5 border-t border-white/8">
            <div className="text-xs text-muted/60 font-mono mb-2 tracking-widest">FORGOT PASSWORD?</div>
            <p className="text-xs text-muted leading-relaxed">
              Contact Mike at <span className="text-teal">mike@goodliquid.com</span> to reset your password.
            </p>
          </div>
        </div>

        <div className="text-center mt-6">
          <a href="/" className="text-xs text-muted hover:text-white transition-colors">
            ← Back to website
          </a>
        </div>
      </div>
    </div>
  )
}
