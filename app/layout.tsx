import type { Metadata } from 'next'
import { Anton, Plus_Jakarta_Sans, Space_Mono } from 'next/font/google'
import './globals.css'

const anton = Anton({
  weight: '400',
  subsets: ['latin'],
  variable: '--font-display',
})

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-body',
})

const spaceMono = Space_Mono({
  weight: ['400', '700'],
  subsets: ['latin'],
  variable: '--font-mono',
})

export const metadata: Metadata = {
  title: 'Good Liquid Bev Co | Beverage Copacker | Palmetto, FL',
  description: 'Family-run beverage copacker in Palmetto, FL specializing in small-batch canning, beverage formulation, bottle filling, and brand consulting. GMP, PCQI & HACCP certified. Minimum 150 cases.',
  keywords: 'beverage copacker, small batch canning, beverage formulation, Florida copacker, Palmetto FL copacker, beverage manufacturing, canning services, THC CBD beverage copacker, functional beverage, seltzer copacker',
  authors: [{ name: 'Good Liquid Bev Co' }],
  metadataBase: new URL('https://www.goodliquidbevco.com'),
  openGraph: {
    type: 'website',
    siteName: 'Good Liquid Bev Co',
    title: 'Good Liquid Bev Co | Small-Batch Beverage Copacker',
    description: 'Family-run beverage copacker in Palmetto, FL. Small-batch canning, formulation & bottle filling. GMP, PCQI & HACCP certified. Min 150 cases.',
    url: 'https://www.goodliquidbevco.com',
    images: [{ url: '/og-image.jpg', width: 1200, height: 630, alt: 'Good Liquid Bev Co' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Good Liquid Bev Co | Small-Batch Beverage Copacker',
    description: 'Family-run beverage copacker in Palmetto, FL.',
    images: ['/og-image.jpg'],
  },
  robots: { index: true, follow: true },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${anton.variable} ${plusJakarta.variable} ${spaceMono.variable}`}>
      <body className="bg-ink text-white font-body antialiased">{children}</body>
    </html>
  )
}
