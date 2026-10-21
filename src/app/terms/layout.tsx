import type { Metadata, Route } from 'next'
import Link from 'next/link'
import type { ReactNode } from 'react'

import { Logo } from '@/components/ui'
import { PolicyLangProvider, PolicyLanguageSelector } from './policy-section'
import { TermsNav } from './terms-nav'

export const metadata: Metadata = {
  title: {
    template: '%s — CoachDesk BD',
    default: 'আইনি শর্তাবলী ও নীতিমালা — CoachDesk BD',
  },
  description:
    'CoachDesk BD-এর প্রিপেইড বিলিং, রিফান্ড, ব্যবহারের শর্তাবলী, গোপনীয়তা এবং নিরাপত্তা নীতিমালা। '
    + 'Prepaid billing terms, refunds, terms of service, privacy, and security policies of CoachDesk BD.',
}

export default function TermsLayout({ children }: { children: ReactNode }) {
  return (
    <PolicyLangProvider>
      <div className="min-h-screen bg-surface-alt text-ink flex flex-col">
        {/* Top Header */}
        <header className="border-b border-line bg-white sticky top-0 z-30 shadow-xs">
          <div className="mx-auto max-w-5xl px-4 sm:px-6 py-3.5 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-6">
              <Link href={'/terms' as Route} className="inline-flex items-center">
                <Logo />
              </Link>
              <span className="hidden sm:inline-block h-5 w-px bg-line" aria-hidden />
              <span className="hidden sm:inline-block text-xs font-semibold uppercase tracking-wider text-ink-soft">
                Legal & Governance
              </span>
            </div>

            <div className="flex items-center gap-3">
              <PolicyLanguageSelector />
              <div className="hidden md:flex items-center gap-2">
                <Link
                  href="/login"
                  className="rounded-xl px-3.5 py-1.5 text-sm font-semibold text-ink-soft hover:text-ink hover:bg-surface-alt transition-colors"
                >
                  লগইন
                </Link>
                <Link
                  href="/signup"
                  className="rounded-xl bg-brand-600 px-3.5 py-1.5 text-sm font-semibold text-white hover:bg-brand-700 transition-colors shadow-xs"
                >
                  শুরু করুন
                </Link>
              </div>
            </div>
          </div>

          {/* Navigation Bar for all 7 policy sub-routes */}
          <div className="mx-auto max-w-5xl px-4 sm:px-6 pt-1 pb-2">
            <TermsNav />
          </div>
        </header>

        {/* Main Content Area */}
        <main className="flex-1 mx-auto w-full max-w-5xl px-4 sm:px-6 py-8">
          {/* Draft Notice Banner */}
          <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs sm:text-sm text-amber-900 flex items-start gap-3">
            <span className="text-base font-bold text-amber-700" aria-hidden>⚠️</span>
            <div className="space-y-1">
              <p className="font-semibold text-amber-800">
                খসড়া সংস্করণ — আইনি পর্যালোচনার অপেক্ষাধীন (Draft — Pending Legal Review)
              </p>
              <p className="text-amber-800/90 leading-relaxed">
                এই পৃষ্ঠার নীতিমালা ও শর্তাবলীসমূহ সর্বসাধারণের অবগতির জন্য খসড়া আকারে প্রস্তুত করা হয়েছে এবং পেশাদার আইনি পর্যালোচনার অধীন। চূড়ান্ত অনুমোদনের পূর্বে এতে পরিবর্তন আসতে পারে।
              </p>
              <p className="text-xs text-amber-700/80 leading-normal">
                These terms and policies are working drafts prepared for transparency and remain subject to formal legal review prior to final adoption.
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-line bg-white p-6 sm:p-10 shadow-xs">
            {children}
          </div>
        </main>

        {/* Footer */}
        <footer className="border-t border-line bg-white py-10 mt-12 text-sm text-ink-soft">
          <div className="mx-auto max-w-5xl px-4 sm:px-6 space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <Logo className="text-base" />
                <p className="mt-2 text-ink-soft max-w-md">
                  বাংলাদেশের কোচিং সেন্টারের জন্য স্বচ্ছ, নিরাপদ ও প্রিপেইড ম্যানেজমেন্ট সিস্টেম।
                </p>
              </div>
              <div className="rounded-xl bg-surface-alt border border-line p-4 space-y-1">
                <p className="font-semibold text-ink">হেল্পলাইন ও সাপোর্ট (Helpline & Verification):</p>
                <p className="text-base font-bold text-brand-700">01756211762</p>
                <p className="text-xs text-ink-soft">সকাল ৯টা হতে রাত ৯টা (শুক্রবার সহ)</p>
              </div>
            </div>

            <div className="border-t border-line pt-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-ink-faint">
              <p>© {new Date().getFullYear()} CoachDesk BD. All rights reserved.</p>
              <div className="flex flex-wrap gap-4">
                <Link href={'/terms/privacy' as Route} className="hover:text-ink transition-colors">
                  গোপনীয়তা (Privacy)
                </Link>
                <Link href={'/terms/prepaid' as Route} className="hover:text-ink transition-colors">
                  বিলিং (Billing)
                </Link>
                <Link href={'/terms/security' as Route} className="hover:text-ink transition-colors">
                  নিরাপত্তা (Security)
                </Link>
              </div>
            </div>
          </div>
        </footer>
      </div>
    </PolicyLangProvider>
  )
}
