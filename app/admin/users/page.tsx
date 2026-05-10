'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export default function UsersPage() {
  const [users, setUsers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  async function load() {
    const { data } = await supabase.from('profiles').select('*').order('created_at', { ascending: false })
    setUsers(data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function updateRole(id: string, role: string) {
    await supabase.from('profiles').update({ role }).eq('id', id)
    load()
  }

  const roleColor: any = { admin: '#1e40af', sales: '#065f46', viewer: '#374151' }
  const roleBg: any = { admin: '#dbeafe', sales: '#d1fae5', viewer: '#e5e7eb' }

  return (
    <div>
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'24px', flexWrap:'wrap', gap:'12px'}}>
        <h1 style={{fontSize:'28px', fontWeight:'900', color:'#1c2e48'}}>Users & Permissions</h1>
      </div>

      <div style={{background:'#dbeafe', borderRadius:'10px', padding:'16px', marginBottom:'20px', color:'#1e40af', fontSize:'14px'}}>
        💡 To invite a new user: go to <strong>supabase.com</strong> → your project → Authentication → Users → Add User. Then come back here and their profile will appear.
      </div>

      {loading ? <div style={{color:'#666'}}>Loading...</div> : (
        <div style={{display:'grid', gap:'12px'}}>
          {users.map(u => (
            <div key={u.id} style={{background:'white', borderRadius:'12px', padding:'20px', boxShadow:'0 1px 4px rgba(0,0,0,0.08)', display:'flex', alignItems:'center', gap:'16px', flexWrap:'wrap'}}>
              <div style={{width:'48px', height:'48px', borderRadius:'50%', background: u.color || '#1a3a6e', color: u.tc || 'white', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:'900', fontSize:'16px', flexShrink:0}}>
                {u.initials || u.name?.[0]}
              </div>
              <div style={{flex:1, minWidth:'150px'}}>
                <div style={{fontWeight:'700', color:'#1c2e48', fontSize:'16px'}}>{u.name}</div>
                <div style={{color:'#666', fontSize:'14px'}}>{u.email}</div>
              </div>
              <div style={{display:'flex', alignItems:'center', gap:'12px', flexWrap:'wrap'}}>
                <span style={{background: roleBg[u.role] || '#e5e7eb', color: roleColor[u.role] || '#374151', padding:'4px 14px', borderRadius:'20px', fontSize:'13px', fontWeight:'600'}}>{u.role}</span>
                <select value={u.role} onChange={e => updateRole(u.id, e.target.value)} style={{padding:'6px 12px', borderRadius:'8px', border:'1px solid #ddd', fontSize:'13px', cursor:'pointer'}}>
                  <option value="admin">Admin</option>
                  <option value="sales">Sales</option>
                  <option value="viewer">Viewer</option>
                </select>
              </div>
            </div>
          ))}
          {users.length === 0 && <div style={{color:'#666', textAlign:'center', padding:'60px'}}>No users yet.</div>}
        </div>
      )}
    </div>
  )
}
