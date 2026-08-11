import type { Metadata, Viewport } from 'next'
import { Hind_Siliguri } from 'next/font/google'

import './globals.css'

/*
 * Hind Siliguri, not Geist. Geist has no Bengali glyphs at all, so every Bangla
 * string would fall back to whatever the phone happens to ship — which on
 * cheap Android is often a badly-hinted face that mangles conjuncts.
 *
 * Hind Siliguri was designed for Bengali UI text and carries Latin in the same
 * family, so Bangla and English sit on one baseline in mixed strings like
 * "রসায়ন Batch B".
 */
const bangla = Hind_Siliguri({
  subsets: ['bengali', 'latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-bangla',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'CoachDesk — কোচিং সেন্টার ম্যানেজমেন্ট',
  description:
    'হাজিরা, পরীক্ষার ফলাফল, ফি এবং অভিভাবককে SMS — এক জায়গায়। '
    + 'Attendance, exam results, fees and parent SMS for Bangladeshi coaching centres.',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'CoachDesk' },
}

export const viewport: Viewport = {
  themeColor: '#137e50',
  width: 'device-width',
  initialScale: 1,
  // No user-scalable: false. Pinch-zoom is an accessibility right, and a
  // teacher checking a marks column will want it.
  viewportFit: 'cover',
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="bn" className={`${bangla.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  )
}
