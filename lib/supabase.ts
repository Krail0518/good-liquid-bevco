import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

export const createBrowserClient = () => createClient(supabaseUrl, supabaseAnonKey)

export type Client = { id: string; name: string; contact_name: string; email: string; phone: string; service: string; status: string; total_billed: number; initials: string; color: string; tc: string; notes: string; referred_by: string | null }

export type Invoice = { id: string; invoice_number: string; client_name: string; service: string; amount: number; status: string; invoice_date: string; due_date: string; notes: string; line_items: any[] }

export type Deal = { id: string; name: string; client_name: string; value: number; stage: string; probability: number; notes: string; assigned_to: string | null }

export type Referrer = { id: string; name: string; relationship: string; email: string; phone: string; default_rate: number; initials: string; color: string; tc: string; notes: string }

export type Referral = { id: string; referrer_id: string; client_name: string; deal_value: number; commission_rate: number; commission_amount: number; status: string; date_paid: string | null; notes: string; created_at: string }

export type Activity = { id: string; type: string; title: string; detail: string; created_at: string; related_client: string | null; created_by: string | null }

export type Profile = { id: string; name: string; email: string; role: string; status: string; initials: string; color: string; tc: string; last_login: string | null; created_at: string }

export type ContactSubmission = { id: string; brand_name: string; contact_name: string; email: string; phone: string; service: string; volume: string; message: string; status: string; created_at: string }