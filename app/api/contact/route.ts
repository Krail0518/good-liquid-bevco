import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { brand_name, contact_name, email, phone, service, volume, message } = body

    if (!email || !contact_name) {
      return NextResponse.json({ error: 'Name and email are required' }, { status: 400 })
    }

    // 1. Save to Supabase
    const { error: dbError } = await supabase
      .from('contact_submissions')
      .insert([{ brand_name, contact_name, email, phone, service, volume, message, status: 'new' }])

    if (dbError) console.error('DB error:', dbError)

    // 2. Send email via Resend
    if (process.env.RESEND_API_KEY && process.env.RESEND_API_KEY !== 're_YOUR_KEY_HERE') {
      const { Resend } = await import('resend')
      const resend = new Resend(process.env.RESEND_API_KEY)

      await resend.emails.send({
        from: 'Good Liquid Website <noreply@goodliquidbevco.com>',
        to: ['mike@goodliquid.com'],
        subject: `New quote request — ${brand_name || contact_name}`,
        html: `
          <div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#0a1628;color:#eef4ff;padding:32px;border-radius:12px">
            <div style="font-size:22px;font-weight:900;letter-spacing:2px;color:#00e5c0;margin-bottom:4px">GOOD LIQUID BEV CO</div>
            <div style="font-size:13px;color:#6b87ad;margin-bottom:24px">New quote request from your website</div>

            <div style="background:rgba(255,255,255,.05);border-radius:8px;padding:20px;margin-bottom:16px">
              <table style="width:100%;border-collapse:collapse">
                <tr><td style="padding:6px 0;color:#6b87ad;font-size:12px;width:140px">Brand name</td><td style="padding:6px 0;font-size:13px;font-weight:600">${brand_name || '—'}</td></tr>
                <tr><td style="padding:6px 0;color:#6b87ad;font-size:12px">Contact name</td><td style="padding:6px 0;font-size:13px;font-weight:600">${contact_name}</td></tr>
                <tr><td style="padding:6px 0;color:#6b87ad;font-size:12px">Email</td><td style="padding:6px 0;font-size:13px;color:#00e5c0">${email}</td></tr>
                <tr><td style="padding:6px 0;color:#6b87ad;font-size:12px">Phone</td><td style="padding:6px 0;font-size:13px">${phone || '—'}</td></tr>
                <tr><td style="padding:6px 0;color:#6b87ad;font-size:12px">Service needed</td><td style="padding:6px 0;font-size:13px">${service || '—'}</td></tr>
                <tr><td style="padding:6px 0;color:#6b87ad;font-size:12px">Volume estimate</td><td style="padding:6px 0;font-size:13px">${volume || '—'}</td></tr>
              </table>
            </div>

            ${message ? `
            <div style="background:rgba(255,255,255,.05);border-radius:8px;padding:20px;margin-bottom:16px">
              <div style="font-size:11px;color:#6b87ad;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">Project details</div>
              <div style="font-size:13px;line-height:1.7">${message}</div>
            </div>` : ''}

            <div style="text-align:center;margin-top:24px">
              <a href="https://www.goodliquidbevco.com/admin/dashboard" style="display:inline-block;padding:12px 28px;background:#00e5c0;color:#060d1a;border-radius:8px;font-weight:800;font-size:13px;text-decoration:none">
                View in CRM →
              </a>
            </div>

            <div style="margin-top:24px;font-size:11px;color:#6b87ad;text-align:center">
              Good Liquid Bev Co · 2011 51st Ave E, Unit 100 · Palmetto, FL 34221
            </div>
          </div>
        `,
      })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Contact form error:', err)
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 })
  }
}
