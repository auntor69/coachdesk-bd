'use client'

import type { Route } from 'next'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const NAV_ITEMS: { href: Route; labelBn: string; labelEn: string }[] = [
  { href: '/terms' as Route, labelBn: 'পরিচিতি', labelEn: 'Overview' },
  { href: '/terms/prepaid' as Route, labelBn: 'প্রিপেইড বিলিং', labelEn: 'Prepaid Billing' },
  { href: '/terms/refund' as Route, labelBn: 'রিফান্ড ও বাতিল', labelEn: 'Refunds' },
  { href: '/terms/terms' as Route, labelBn: 'ব্যবহারের শর্তাবলী', labelEn: 'Terms of Service' },
  { href: '/terms/privacy' as Route, labelBn: 'গোপনীয়তা নীতি', labelEn: 'Privacy Policy' },
  { href: '/terms/acceptable-use' as Route, labelBn: 'গ্রহণযোগ্য ব্যবহার', labelEn: 'Acceptable Use' },
  { href: '/terms/deletion' as Route, labelBn: 'ডেটা ও অ্যাকাউন্ট মোছা', labelEn: 'Data & Deletion' },
  { href: '/terms/security' as Route, labelBn: 'নিরাপত্তা ও যোগাযোগ', labelEn: 'Security & Contact' },
]

export function TermsNav() {
  const pathname = usePathname()

  return (
    <nav
      aria-label="Legal policies"
      className="flex gap-2 overflow-x-auto pb-2 scrollbar-none"
    >
      {NAV_ITEMS.map((item) => {
        const hrefStr = item.href as string
        const isActive =
          pathname === hrefStr ||
          (hrefStr !== '/terms' && pathname.startsWith(hrefStr))

        return (
          <Link
            key={item.href}
            href={item.href}
            className={`whitespace-nowrap rounded-xl px-3.5 py-2 text-sm font-medium transition-colors ${
              isActive
                ? 'bg-brand-600 text-white shadow-sm font-semibold'
                : 'bg-white text-ink-soft hover:bg-surface-alt hover:text-ink border border-line'
            }`}
          >
            <span>{item.labelBn}</span>
            <span className="ml-1.5 opacity-75 text-xs">({item.labelEn})</span>
          </Link>
        )
      })}
    </nav>
  )
}
