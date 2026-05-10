import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function POST(request: Request) {
  try {
    const body = await request.json()
    await supabase.from('contact_submissions').insert([{
      brand_name: body.brandName,
      contact_name: body.contactName,
      email: body.email,
      phone: body.phone,
      service: body.service,
      message: body.message,
      status: 'new'
    }])
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
