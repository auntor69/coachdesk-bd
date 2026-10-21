import type { Metadata } from 'next'
import { PolicySection } from '../policy-section'

export const metadata: Metadata = {
  title: 'নিরাপত্তা ও যোগাযোগ — Security & Contact',
  description:
    'CoachDesk BD-এর ডেটা নিরাপত্তা ব্যবস্থা, ট্রানজিট এনক্রিপশন, স্বচ্ছ কারিগরি নীতিমালা, সিকিউরিটি বাগ রিপোর্ট এবং সার্বক্ষণিক অফিশিয়াল হেল্পলাইন।',
}

export default function SecurityAndContactPage() {
  return (
    <article className="space-y-6">
      <div className="border-b border-line pb-6">
        <span className="text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-full uppercase tracking-wider">
          খসড়া (Draft — Pending Legal Review)
        </span>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-ink mt-3">
          নিরাপত্তা ও যোগাযোগ
        </h1>
        <p className="text-base text-ink-soft mt-1 font-medium">
          Security Infrastructure & Official Contact Helpline
        </p>
        <p className="mt-3 text-xs text-ink-soft">
          এই নীতিমালা খসড়া হিসেবে প্রস্তুত করা হয়েছে এবং আইনি পর্যালোচনার অপেক্ষাধীন। (Working draft pending formal legal review.)
        </p>
      </div>

      <PolicySection
        number="১"
        titleBn="ডেটাবেস আইসোলেশন ও ডেটা নিরাপত্তা ব্যবস্থা"
        titleEn="Database Tenant Isolation & Encryption"
        childrenBn={
          <>
            <p>
              CoachDesk BD পোস্টগ্রেস (PostgreSQL) ডেটাবেসের <strong>Row-Level Security (RLS)</strong> নীতির মাধ্যমে পরিচালিত। প্রতিটি ডেটাবেস কোয়েরিতে ডেটাবেস পলিসির মাধ্যমে নিশ্চিত করা হয় যাতে এক কোচিং সেন্টারের কোনো সদস্য অন্য সেন্টারের তথ্য দেখতে না পারে।
            </p>
            <p>
              ব্রাউজার থেকে সার্ভারে স্থানান্তরের সময় সকল ডেটা TLS/HTTPS এনক্রিপশনের মাধ্যমে সুরক্ষিত থাকে এবং ডেটাবেস স্টোরেজে সংরক্ষিত অবস্থাতেও এনক্রিপ্টেড (Encrypted at rest) থাকে।
            </p>
          </>
        }
        childrenEn={
          <>
            <p>
              CoachDesk BD enforces tenant isolation directly in PostgreSQL via <strong>Row-Level Security (RLS)</strong> policies. Access control is enforced at the database tier rather than trusting application code: queries execute under database policies ensuring rows belonging to one center are inaccessible to actors from another center.
            </p>
            <p>
              All traffic between your browser and our servers is secured via TLS/HTTPS encryption in transit. Underlying storage volumes and automated backups are encrypted at rest.
            </p>
          </>
        }
      />

      <PolicySection
        number="২"
        titleBn="সততা ও মিথ্যা দাবি পরিহার"
        titleEn="Honest Disclosures & No False Compliance Claims"
        childrenBn={
          <>
            <p>
              <strong>আমরা কোনো ভুয়া দাবি করি না:</strong> আমরা যে আন্তর্জাতিক সার্টিফিকেশন বা অডিট সম্পন্ন করিনি, তা নিয়ে কোনো অসত্য মার্কেটিং দাবি করি না।
            </p>
            <p>
              &ldquo;আমরা ট্রানজিটে ও স্টোরেজে ডেটা এনক্রিপ্ট করি&rdquo; — এটি প্রযুক্তিগত সুবিধা কারণ আমাদের ক্লাউড ইনফ্রাস্ট্রাকচার তা প্রদান করে। তবে যে অডিট আমরা সম্পন্ন করিনি, তা নিয়ে কোনো &ldquo;ISO 27001&rdquo; বা আন্তর্জাতিক &ldquo;GDPR Compliant&rdquo; সাইনবোর্ড ঝুলিয়ে গ্রাহককে বিভ্রান্ত করা আমাদের নীতিবিরুদ্ধ। আমরা যা বাস্তবায়ন করেছি, কেবল সেটাই বলি।
            </p>
          </>
        }
        childrenEn={
          <>
            <p>
              <strong>Transparent Truth:</strong> We refuse to market unearned badges or certifications we have not been independently audited against.
            </p>
            <p>
              &ldquo;We encrypt data in transit and at rest&rdquo; is an operational capability provided by our cloud infrastructure. Conversely, claiming unverified global credentials like &ldquo;ISO 27001 Certified&rdquo; or generic &ldquo;GDPR Compliance&rdquo; when operating a coaching SaaS in Bangladesh would be deceptive. We state only what is actually implemented and verified.
            </p>
          </>
        }
      />

      <PolicySection
        number="৩"
        titleBn="নিরাপত্তা ত্রুটি রিপোর্ট করার নিয়ম (Vulnerability Disclosure)"
        titleEn="Responsible Vulnerability Disclosure"
        childrenBn={
          <>
            <p>
              নিরাপত্তা গবেষক বা ডেভেলপারদের দ্বারা দায়িত্বশীল নিরাপত্তা ত্রুটি উন্মোচনকে আমরা আন্তরিকভাবে স্বাগত জানাই। যদি আপনি সিস্টেমে কোনো দুর্বলতা বা নিরাপত্তা ত্রুটি খুঁজে পান:
            </p>
            <ul className="list-disc pl-5 space-y-2 mt-2">
              <li>অনুগ্রহ করে কোনো পাবলিক ফোরাম বা সোশ্যাল মিডিয়ায় প্রকাশের আগে সরাসরি আমাদের নিরাপত্তা টিমকে অবহিত করুন।</li>
              <li>ইমেইল করুন: <code className="bg-surface-alt px-2 py-0.5 rounded text-sm">security@coachdesk.app</code> অথবা হেল্পলাইনে যোগাযোগ করুন।</li>
              <li>আমরা প্রতিটি বৈধ নিরাপত্তা প্রতিবেদন গুরুত্বের সাথে তদন্ত করি এবং দ্রুত প্রতিকার নিশ্চিত করি।</li>
            </ul>
          </>
        }
        childrenEn={
          <>
            <p>
              We welcome coordinated security research from developers and security professionals. If you identify a potential security vulnerability or tenant leak:
            </p>
            <ul className="list-disc pl-5 space-y-2 mt-2">
              <li>Please disclose findings responsibly directly to our team before public disclosure.</li>
              <li>Email: <code className="bg-surface-alt px-2 py-0.5 rounded text-sm">security@coachdesk.app</code> or contact our direct phone line.</li>
              <li>We acknowledge receipt within 24 hours, patch verified defects urgently, and credit responsible researchers.</li>
            </ul>
          </>
        }
      />

      <PolicySection
        number="৪"
        titleBn="সরাসরি অফিশিয়াল হেল্পলাইন ও যোগাযোগ"
        titleEn="Direct Customer Helpline & Company Contact"
        childrenBn={
          <>
            <p>
              যেকোনো জরুরি জিজ্ঞাসা, রিচার্জের টাকা যাচাইকরণ বা প্রযুক্তিগত সহায়তার জন্য আমাদের একটিই প্রধান ও যাচাইকৃত হেল্পলাইন নম্বর:
            </p>
            <div className="rounded-xl border border-line bg-surface-alt p-5 mt-3 space-y-2">
              <div className="text-xl font-bold text-brand-700 tracking-wide">
                📞 01756211762
              </div>
              <p className="text-sm text-ink-soft">
                সরাসরি ফোন ও হোয়াটসঅ্যাপ (Phone & WhatsApp). প্রতিদিন সকাল ৯:০০ টা হতে রাত ৯:০০ টা পর্যন্ত।
              </p>
              <div className="text-xs text-ink-faint pt-2 border-t border-line">
                অফিস: ঢাকা, বাংলাদেশ (Dhaka, Bangladesh).
              </div>
            </div>
          </>
        }
        childrenEn={
          <>
            <p>
              For immediate payment confirmation, recharge status queries, or administrative support, reach our single dedicated helpline:
            </p>
            <div className="rounded-xl border border-line bg-surface-alt p-5 mt-3 space-y-2">
              <div className="text-xl font-bold text-brand-700 tracking-wide">
                📞 01756211762
              </div>
              <p className="text-sm text-ink-soft">
                Voice calls and WhatsApp support. Active 7 days a week, 9:00 AM to 9:00 PM BST.
              </p>
              <div className="text-xs text-ink-faint pt-2 border-t border-line">
                Headquarters: Dhaka, Bangladesh.
              </div>
            </div>
          </>
        }
      />
    </article>
  )
}
