import { createClient } from '@supabase/supabase-js'
import { createClientComponentClient, createServerComponentClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// Client-side Supabase client
export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// For use in Client Components
export const createBrowserClient = () =>
  createClientComponentClient()

// For use in Server Components
export const createServerClient = () =>
  createServerComponentClient({ cookies })

// Types
export type Profile = {
  id: string
  name: string
  email: string
  role: 'admin' | 'sales' | 'viewer'
  status: 'active' | 'inactive'
  initials: string
  color: string
  tc: string
  last_login: string | null
  created_at: string
}

export type Client = {
  id: string
  name: string
  contact_name: string
  email: string
  phone: string
  service: string
  status: 'active' | 'lead' | 'inactive'
  referred_by: string | null
  notes: string
  total_billed: number
  color: string
  tc: string
  initials: string
  created_at: string
}

export type Invoice = {
  id: string
  invoice_number: string
  client_id: string | null
  client_name: string
  service: string
  amount: number
  status: 'draft' | 'pending' | 'paid' | 'overdue'
  invoice_date: string
  due_date: string | null
  notes: string
  line_items: LineItem[]
  created_at: string
}

export type LineItem = {
  description: string
  amount: number
}

export type Referrer = {
  id: string
  name: string
  relationship: string
  email: string
  phone: string
  default_rate: number
  color: string
  tc: string
  initials: string
  notes: string
  created_at: string
}

export type Referral = {
  id: string
  referrer_id: string
  client_name: string
  deal_value: number
  commission_rate: number
  commission_amount: number
  status: 'lead' | 'presented' | 'won' | 'paid' | 'lost'
  date_paid: string | null
  notes: string
  created_at: string
}

export type Deal = {
  id: string
  name: string
  client_name: string
  value: number
  stage: 'Prospecting' | 'Proposal' | 'Negotiation' | 'Closed Won' | 'Closed Lost'
  probability: number
  notes: string
  created_at: string
}

export type Activity = {
  id: string
  type: 'call' | 'email' | 'deal' | 'note' | 'ref' | 'invoice'
  title: string
  detail: string
  created_at: string
}

export type ContactSubmission = {
  id: string
  brand_name: string
  contact_name: string
  email: string
  phone: string
  service: string
  volume: string
  message: string
  status: 'new' | 'contacted' | 'converted' | 'closed'
  created_at: string
}
