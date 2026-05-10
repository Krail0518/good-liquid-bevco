import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { brandName, contactName, email, phone, service, volume, message } = body

    const { error } = await supabase
      .from('contact_submissions')
      .insert([{
        brand_name: brandName,
        contact_name: contactName,
        email,
        phone,
        service,
        volume,
        message,
        status: 'new'
      }])

    if (error) {
      return NextResponse.json({ error: 'Failed to save submission' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}