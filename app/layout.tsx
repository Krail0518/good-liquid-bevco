import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Good Liquid Bev Co',
  description: 'Premium Beverage Co-Packing in Palmetto, FL',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
