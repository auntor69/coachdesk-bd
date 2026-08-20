import type { Metadata, Viewport } from 'next'
import { Hind_Siliguri } from 'next/font/google'

import { readerLocale } from '@/lib/i18n/server'

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

/**
 * `lang` follows the reader, and is the reason this layout is async.
 *
 * It was hardcoded "bn", which was true of every screen until the language switch
 * existed. A page rendering English under lang="bn" is not cosmetic: it is what a
 * screen reader announces it in, and it decides which font the browser falls back
 * to for a glyph Hind Siliguri does not have.
 *
 * readerLocale rather than a session read, because this layout also wraps the
 * login screen, where there is no profile to read yet.
 */
export default async function RootLayout({ children }: LayoutProps<'/'>) {
  const locale = await readerLocale()

  return (
    <html lang={locale} className={`${bangla.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  )
}
