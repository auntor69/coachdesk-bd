import type { Metadata } from 'next'
import type { Route } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'আইনি শর্তাবলী ও নীতিমালা — CoachDesk BD',
  description: 'CoachDesk BD-এর সকল আইনি নীতিমালা, বিলিং শর্তাবলী এবং গ্রাহক অধিকারের সমন্বিত পরিচিতি।',
}

const POLICIES: {
  href: Route
  titleBn: string
  titleEn: string
  descBn: string
  descEn: string
}[] = [
  {
    href: '/terms/prepaid' as Route,
    titleBn: 'প্রিপেইড বিলিং শর্তাবলী',
    titleEn: 'Prepaid Billing Terms',
    descBn: 'ব্যালেন্স অফেরতযোগ্য ও মেয়াদহীন, সেন্টারের আকার অনুযায়ী দৈনিক স্বয়ংক্রিয় কর্তন, বোনাস ক্রেডিট নীতি এবং শূন্য ব্যালেন্সে রিড-অনলি মোড।',
    descEn: 'Balances never expire and are non-refundable; daily burn based on active student sizing; promotional bonus rules and zero-balance read-only protection.',
  },
  {
    href: '/terms/refund' as Route,
    titleBn: 'রিফান্ড ও বাতিল নীতিমালা',
    titleEn: 'Refund & Cancellation Policy',
    descBn: 'ব্যালেন্সের অফেরতযোগ্যতা, কোনো প্ল্যাটফর্ম ত্রুটি বা অতিরিক্ত কর্তনের ক্ষেত্রে প্রতিষ্ঠাতা সমন্বয় (Founder Adjustment) ও অ্যাকাউন্ট বাতিলের নিয়মাবলী।',
    descEn: 'Prepaid credits non-refundable; discretionary founder adjustments for platform errors or billing discrepancies; fee-free center departure.',
  },
  {
    href: '/terms/terms' as Route,
    titleBn: 'ব্যবহারের সাধারণ শর্তাবলী',
    titleEn: 'Terms of Service',
    descBn: 'সেন্টার ও শিক্ষকের ব্যবহারের শর্ত, এক ব্যক্তি এক অ্যাকাউন্ট নীতি, সেন্টার কর্তৃক প্রদত্ত শিক্ষক/স্টাফ লগইনের সেন্টারের মালিকানা ও স্থগিতাদেশের বিধান।',
    descEn: 'Coaching center eligibility, one-account-per-human invariant, center ownership of staff credentials, and suspension grounds.',
  },
  {
    href: '/terms/privacy' as Route,
    titleBn: 'গোপনীয়তা নীতি',
    titleEn: 'Privacy Policy',
    descBn: 'শিক্ষার্থী ও অভিভাবকের সংরক্ষিত তথ্য, তথ্যের উদ্দেশ্য ও স্থায়িত্ব, সেন্টারের ভেতরের রোল-ভিত্তিক অ্যাক্সেস এবং কৃত্রিম বুদ্ধিমত্তা (AI) মডেলে কোনো শিক্ষার্থীর ডেটা না পাঠানো।',
    descEn: 'Student & guardian data storage, retention details, role-based center access, and assurance that student records are not sent to third-party AI models.',
  },
  {
    href: '/terms/acceptable-use' as Route,
    titleBn: 'গ্রহণযোগ্য ব্যবহারের নীতিমালা',
    titleEn: 'Acceptable Use Policy',
    descBn: 'অভিভাবকের ফোন নম্বর শুধুমাত্র শিক্ষা ও সেন্টারের নোটিশে ব্যবহারের নিয়ম, বাল্ক মার্কেটিং বা স্প্যাম মেসেজ পাঠানো নিষিদ্ধ।',
    descEn: 'Guardian phone numbers reserved for educational outreach; ban on commercial marketing, bulk spam, or unrelated messaging.',
  },
  {
    href: '/terms/deletion' as Route,
    titleBn: 'অ্যাকাউন্ট মুছে ফেলা ও ডেটা রপ্তানি',
    titleEn: 'Account Deletion & Data Export',
    descBn: 'সেন্টারের রস্টার ও হিসাবের CSV এক্সপোর্ট সুবিধা এবং সেন্টার বন্ধের মাধ্যমে অ্যাকাউন্ট ও ডেটা অপসারণের প্রক্রিয়া।',
    descEn: 'CSV data export via /settings/export, and account closure and data deletion procedures.',
  },
  {
    href: '/terms/security' as Route,
    titleBn: 'নিরাপত্তা ও যোগাযোগ',
    titleEn: 'Security & Contact',
    descBn: 'ডাটাবেস আইসোলেশন ও ট্রানজিট এনক্রিপশন, অপ্রমাণিত সার্টিফিকেশনের মিথ্যা দাবি না করার সততা, সিকিউরিটি বাগ রিপোর্টিং ও অফিশিয়াল হেল্পলাইন 01756211762।',
    descEn: 'Database tenant isolation, TLS encryption in transit and encryption at rest, no unverified compliance claims, vulnerability disclosure, and direct helpline 01756211762.',
  },
]

export default function TermsOverviewPage() {
  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div className="border-b border-line pb-6">
        <span className="text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-full uppercase tracking-wider">
          খসড়া (Draft — Pending Legal Review)
        </span>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-ink mt-3">
          আইনি কাঠামো ও নীতিমালা বিবরণী
        </h1>
        <p className="text-base text-ink-soft mt-1 font-medium">
          Legal Framework & Trust Principles of CoachDesk BD
        </p>
        <p className="mt-2 text-xs text-ink-soft">
          এই বিবরণী খসড়া হিসেবে প্রস্তুত করা হয়েছে এবং আইনি পর্যালোচনার অপেক্ষাধীন। (Working draft pending formal legal review.)
        </p>
        <p className="mt-4 text-ink/90 leading-relaxed max-w-3xl">
          বাংলাদেশের কোচিং সেন্টার পরিচালকদের জন্য কোনো জটিল বা অসচ্ছ চুক্তি নয় — CoachDesk BD সম্পূর্ণ খোলামেলা ও লিখিত আইনি নীতিমালায় পরিচালিত। প্রথম টাকা রিচার্জ করার আগেই আমাদের প্রিপেইড আর্থিক মডেল, ডেটার গোপনীয়তা এবং গ্রাহক সুরক্ষা সম্পর্কে পরিষ্কার ধারণা থাকা আপনার অধিকার।
        </p>
      </div>

      {/* Core Principles Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-xl border border-line bg-surface-alt p-4">
          <div className="font-bold text-ink">টাকা মেয়াদহীন (Never Expires)</div>
          <p className="text-xs text-ink-soft mt-1 leading-normal">
            ব্যালেন্স যত দিনই থাকুক তা নষ্ট হয় না। কোনো মাসিক অটো-চার্জ বা জোরপূর্বক সাবস্ক্রিপশন নেই।
          </p>
        </div>
        <div className="rounded-xl border border-line bg-surface-alt p-4">
          <div className="font-bold text-ink">রিড-অনলি মোড (Read-Only Mode)</div>
          <p className="text-xs text-ink-soft mt-1 leading-normal">
            ব্যালেন্স শেষ হলে সফটওয়্যার রিড-অনলি মোডে চলে যায়। কোনো ছাত্রের রেকর্ড বা পরীক্ষার নম্বর মুছে যায় না।
          </p>
        </div>
        <div className="rounded-xl border border-line bg-surface-alt p-4">
          <div className="font-bold text-ink">AI সুরক্ষা (No Student Data to AI)</div>
          <p className="text-xs text-ink-soft mt-1 leading-normal">
            ছাত্রছাত্রী বা অভিভাবকদের নাম, নম্বর বা ফলাফল কোনো কৃত্রিম বুদ্ধিমত্তা বা AI কোম্পানির কাছে পাঠানো হয় না।
          </p>
        </div>
      </div>

      {/* Policy Cards Grid */}
      <div className="space-y-4 pt-2">
        <h2 className="text-xl font-bold text-ink">সকল নীতিমালা (Complete Policies)</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {POLICIES.map((p, idx) => (
            <Link
              key={p.href}
              href={p.href}
              className="group block rounded-xl border border-line bg-white p-5 hover:border-brand-500 hover:shadow-sm transition-all"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-xs font-bold text-brand-700 bg-brand-50 px-2 py-0.5 rounded-md">
                  ধারা {idx + 1}
                </span>
                <span className="text-xs text-brand-700 font-semibold group-hover:translate-x-0.5 transition-transform">
                  সম্পূর্ণ পড়ুন →
                </span>
              </div>
              <h3 className="text-lg font-bold text-ink mt-2 group-hover:text-brand-700 transition-colors">
                {p.titleBn}
              </h3>
              <div className="text-xs font-medium text-ink-soft">{p.titleEn}</div>
              <p className="text-sm text-ink-soft mt-2.5 leading-relaxed line-clamp-3">
                {p.descBn}
              </p>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
