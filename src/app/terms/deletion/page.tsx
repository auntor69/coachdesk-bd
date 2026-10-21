import type { Metadata } from 'next'
import { PolicySection } from '../policy-section'

export const metadata: Metadata = {
  title: 'অ্যাকাউন্ট মুছে ফেলা ও ডেটা রপ্তানি — Account Deletion & Data Export',
  description:
    'CoachDesk BD-এর ডেটা এক্সপোর্ট সুবিধা (/settings/export), সেন্টার বন্ধের আবেদন এবং ডেটাবেস থেকে তথ্য অপসারণের প্রক্রিয়া।',
}

export default function DeletionAndExportPage() {
  return (
    <article className="space-y-6">
      <div className="border-b border-line pb-6">
        <span className="text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-full uppercase tracking-wider">
          খসড়া (Draft — Pending Legal Review)
        </span>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-ink mt-3">
          অ্যাকাউন্ট মুছে ফেলা ও ডেটা রপ্তানি
        </h1>
        <p className="text-base text-ink-soft mt-1 font-medium">
          Account Deletion, Data Portability & Retention
        </p>
        <p className="mt-3 text-xs text-ink-soft">
          এই নীতিমালা খসড়া হিসেবে প্রস্তুত করা হয়েছে এবং আইনি পর্যালোচনার অপেক্ষাধীন। (Working draft pending formal legal review.)
        </p>
      </div>

      <PolicySection
        number="১"
        titleBn="ডেটার মালিকানা ও এক্সপোর্ট সুবিধা"
        titleEn="Data Portability & Export Availability"
        childrenBn={
          <>
            <p>
              <strong>আপনার ডেটা আপনার:</strong> কোচিং সেন্টারে সংরক্ষিত সকল শিক্ষার্থী তালিকা, ফোন নম্বর, মাসিক উপস্থিতি, পরীক্ষার ফলাফল এবং ফি সংগ্রহের রসিদের মালিক সংশ্লিষ্ট প্রতিষ্ঠান।
            </p>
            <p>
              সেন্টার পরিচালক /settings/export স্ক্রিনের মাধ্যমে সেন্টারের তথ্য CSV ফরম্যাটে ডাউনলোড করে নিতে পারেন, অথবা অ্যাকাউন্ট বন্ধের পূর্বে ডেটা এক্সপোর্টের জন্য আমাদের সহায়তা চাইতে পারেন। আমরা গ্রাহকের ডেটা আটকে রাখার নীতি সমর্থন করি না; আপনার প্রতিষ্ঠানের তথ্যে আপনার অধিকার রয়েছে।
            </p>
          </>
        }
        childrenEn={
          <>
            <p>
              <strong>Your Data Belongs to You:</strong> All student registers, contact directories, attendance logs, evaluation score sheets, and fee transaction archives belong to your coaching centre.
            </p>
            <p>
              Center proprietors can export operational records in CSV format via the /settings/export screen or request an export archive prior to account closure. We do not lock in or withhold your data; your center retains ownership of its operational records.
            </p>
          </>
        }
      />

      <PolicySection
        number="২"
        titleBn="কোন কোন ডেটা এক্সপোর্ট করা সম্ভব"
        titleEn="Available Data Export Scopes"
        childrenBn={
          <>
            <p>CoachDesk BD-এর এক্সপোর্ট স্ক্রিন (/settings/export) থেকে নিম্নলিখিত রেকর্ডসমূহ পাওয়া যায়:</p>
            <ul className="list-disc pl-5 space-y-2 mt-2">
              <li><strong>শিক্ষার্থী রস্টার (Student Rosters):</strong> নাম, শ্রেণি, ব্যাচ, অভিভাবকের ফোন ও ভর্তির তারিখ।</li>
              <li><strong>হাজিরা বিবরণী (Attendance Sheets):</strong> প্রতি ক্লাসের তারিখভিত্তিক উপস্থিতি রেকর্ড।</li>
              <li><strong>নম্বরপত্র (Exam Results):</strong> পরীক্ষার নম্বর, সর্বোচ্চ নম্বর ও গ্রেড শিট।</li>
              <li><strong>আর্থিক লেজার (Fee Registers):</strong> সংগৃহীত ফি, বকেয়া তালিকা ও ট্রানজাকশন নম্বর।</li>
            </ul>
          </>
        }
        childrenEn={
          <>
            <p>The built-in export modules (/settings/export) provide complete reporting covering:</p>
            <ul className="list-disc pl-5 space-y-2 mt-2">
              <li><strong>Student Directories:</strong> Student rosters, batch schedules, guardian phones, and admission stamps.</li>
              <li><strong>Attendance Registers:</strong> Date-stamped roll call history per batch and session.</li>
              <li><strong>Examination Ledgers:</strong> Standardized test marks, subject score sheets, and batch rankings.</li>
              <li><strong>Collection Registers:</strong> Append-only fee payment records, gapless receipt numbers, and balances.</li>
            </ul>
          </>
        }
      />

      <PolicySection
        number="৩"
        titleBn="অ্যাকাউন্ট ও ডেটা স্থায়ীভাবে মুছে ফেলার প্রক্রিয়া"
        titleEn="Center Closure & Account Erasure Procedure"
        childrenBn={
          <>
            <p>
              সেন্টার পরিচালক যদি স্থায়ীভাবে সেন্টার বন্ধ করতে চান এবং সমস্ত ডেটা অপসারণের ইচ্ছা পোষণ করেন:
            </p>
            <ol className="list-decimal pl-5 space-y-2 mt-2">
              <li>প্রথমে /settings/export থেকে সেন্টারের সকল প্রয়োজনীয় ডেটা ডাউনলোড করে সংরক্ষণ করুন।</li>
              <li>পরিচালকের নিবন্ধিত যোগাযোগ মাধ্যম থেকে আমাদের সাপোর্ট টিম (০১৭৫৬২১১৭৬২) বা ইমেইলে অনুরোধ জানান।</li>
              <li>সেন্টারের পরিচয় ও মালিকানা যাচাইয়ের পর অ্যাকাউন্ট বন্ধ ও ডেটা অপসারণের প্রক্রিয়া সম্পন্ন করা হয়।</li>
            </ol>
          </>
        }
        childrenEn={
          <>
            <p>
              If a center owner determines to permanently close operations and request account deletion:
            </p>
            <ol className="list-decimal pl-5 space-y-2 mt-2">
              <li>First download and archive all necessary records via /settings/export.</li>
              <li>Submit a formal closure request through our support line (01756211762) or registered email.</li>
              <li>Following verification of center ownership, our team processes account closure and data removal.</li>
            </ol>
          </>
        }
      />

      <PolicySection
        number="৪"
        titleBn="আর্থিক লেনদেন রেকর্ড সংরক্ষণ"
        titleEn="Financial Transaction Record Retention"
        childrenBn={
          <>
            <p>
              প্ল্যাটফর্ম ব্যবহারের জন্য কোচিং সেন্টার কর্তৃক CoachDesk BD-কে প্রদত্ত রিচার্জ ও বিলিং পেমেন্টের লেনদেন রেকর্ড (যেমন পেমেন্ট ইনভয়েস ও রসিদ নম্বর) হিসাব ও অডিট সংরক্ষণের স্বার্থে আমাদের বিলিং লেজারে সংরক্ষিত থাকে।
            </p>
          </>
        }
        childrenEn={
          <>
            <p>
              Direct transaction records and billing receipts for wallet recharges paid by the customer to CoachDesk BD are retained in the billing ledger for accounting and audit purposes.
            </p>
          </>
        }
      />
    </article>
  )
}
