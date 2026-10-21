import type { Metadata } from 'next'
import { PolicySection } from '../policy-section'

export const metadata: Metadata = {
  title: 'প্রিপেইড বিলিং শর্তাবলী — Prepaid Billing Terms',
  description:
    'CoachDesk BD-এর প্রিপেইড বিলিং মডেল, অফেরতযোগ্য ও মেয়াদহীন ব্যালেন্স, দৈনিক চার্জ এবং রিড-অনলি মোডের সুনির্দিষ্ট নীতিমালা।',
}

export default function PrepaidTermsPage() {
  return (
    <article className="space-y-6">
      <div className="border-b border-line pb-6">
        <span className="text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-full uppercase tracking-wider">
          খসড়া (Draft — Pending Legal Review)
        </span>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-ink mt-3">
          প্রিপেইড বিলিং শর্তাবলী
        </h1>
        <p className="text-base text-ink-soft mt-1 font-medium">
          Prepaid Billing & Wallet Burn Terms
        </p>
        <p className="mt-3 text-xs text-ink-soft">
          এই নীতিমালা খসড়া হিসেবে প্রস্তুত করা হয়েছে এবং আইনি পর্যালোচনার অপেক্ষাধীন। (Working draft pending formal legal review.)
        </p>
      </div>

      <PolicySection
        number="১"
        titleBn="এক ব্যালেন্স ও দৈনিক চার্জের মূলনীতি"
        titleEn="Single Prepaid Balance & Daily Burn Mechanism"
        childrenBn={
          <>
            <p>
              CoachDesk BD সম্পূর্ণ প্রিপেইড (Prepaid) ওয়ালেট মডেলে পরিচালিত। এখানে কোনো লুকানো মাসিক বিল, অটো-ডেবিট বা পোস্ট-পেইড দেনা তৈরি হয় না।
            </p>
            <p>
              টাকা রিচার্জ করার পর তা সেন্টারের ওয়ালেটে জমা হয় (পয়সা হিসেবে সংরক্ষিত)। প্রতিটি ক্যালেন্ডার দিনে (ঢাকা সময় অনুযায়ী) সেন্টারের তৎকালীন সক্রিয় ছাত্রসংখ্যা এবং শাখার সংখ্যার ওপর ভিত্তি করে নির্ধারিত দৈনিক ফি ব্যালেন্স থেকে কর্তন করা হয়।
            </p>
          </>
        }
        childrenEn={
          <>
            <p>
              CoachDesk BD operates on a prepaid wallet model. There are no surprise monthly invoices, hidden debts, or automatic card debits.
            </p>
            <p>
              Recharge funds are credited directly to the coaching centre&apos;s prepaid wallet (calculated and tracked precisely in poisha). Each calendar day (Dhaka midnight-to-midnight), the platform calculates and deducts the exact daily rate based on the center&apos;s active student headcount and branch footprint.
            </p>
          </>
        }
      />

      <PolicySection
        number="২"
        titleBn="অফেরতযোগ্য ও মেয়াদহীন ব্যালেন্স"
        titleEn="Non-Refundable Balance (Does Not Expire)"
        childrenBn={
          <>
            <p>
              <strong>টাকার কোনো মেয়াদ নেই:</strong> আপনার ওয়ালেটে রিচার্জ করা টাকা কোনো নির্দিষ্ট সময়সীমায় মেয়াদোত্তীর্ণ হয় না। সেন্টার যদি পরীক্ষার মৌসুমে বা ছুটিতে কার্যক্রম সাময়িক বন্ধ রাখে, তবে অবশিষ্টাংশ ওয়ালেটে জমা থাকবে।
            </p>
            <p>
              <strong>ব্যালেন্স অফেরতযোগ্য (Non-Refundable):</strong> ওয়ালেটে টাকা প্রবেশ করার পর তা নগদে উত্তোলন বা রিফান্ডযোগ্য নয়। রিচার্জ করার আগে নিশ্চিত হয়ে আপনার প্রয়োজনীয় মেয়াদের সমপরিমাণ অর্থ জমা দিন।
            </p>
          </>
        }
        childrenEn={
          <>
            <p>
              <strong>Balances Do Not Expire:</strong> Deposited funds remain in your center&apos;s wallet. If your coaching centre pauses operations during vacations, Ramadan, or off-peak months, unspent funds remain safe in your wallet without arbitrary expiration dates.
            </p>
            <p>
              <strong>Non-Refundable:</strong> Once deposited, wallet credits cannot be cashed out, withdrawn, or refunded to a mobile financial services (MFS) account or bank. We advise customers to top up only the duration they intend to operate.
            </p>
          </>
        }
      />

      <PolicySection
        number="৩"
        titleBn="সেন্টারের সাইজ ও রেট পরিবর্তনের নিয়ম"
        titleEn="Pricing Tied Directly to Center Headcount"
        childrenBn={
          <>
            <p>
              দৈনিক চার্জ সেন্টারের সক্রিয় শিক্ষার্থীর সংখ্যার ওপর নির্ভর করে। কোনো নির্দিষ্ট দিনে শিক্ষার্থী সংখ্যা বৃদ্ধি পেলে সফটওয়্যার ওই দিনের রেট স্বয়ংক্রিয়ভাবে সমন্বয় করে এবং বর্ধিত অংশ কেটে নেয় (High-water mark principle)।
            </p>
            <p>
              একটি নির্ধারিত দিনে ইতিমধ্যে চার্জ হয়ে যাওয়ার পর ওই দিনে আর অতিরিক্ত কোনো দ্বিতীয় বেস চার্জ প্রযোজ্য হয় না।
            </p>
          </>
        }
        childrenEn={
          <>
            <p>
              The daily burn rate directly reflects the active roster size of your coaching centre. If additional students are admitted during the day, the daily rate adjusts automatically to reflect the actual capacity used.
            </p>
            <p>
              Once a calendar day&apos;s base charge is settled, the platform does not double-bill base charges for that day.
            </p>
          </>
        }
      />

      <PolicySection
        number="৪"
        titleBn="প্রমোশন ও বোনাস ক্রেডিটের বিধান"
        titleEn="Promotional Bonuses (Credit Only, Not Cash)"
        childrenBn={
          <>
            <p>
              দীর্ঘমেয়াদী রিচার্জে (যেমন ৩ মাস, ৬ মাস বা ১ বছর) প্ল্যাটফর্ম ঘোষিত বিশেষ বোনাস ক্রেডিট যুক্ত হতে পারে।
            </p>
            <p>
              এই বোনাস কেবল CoachDesk BD-এর প্রিপেইড চার্জ এবং এসএমএস ব্যবহারের জন্য প্রদত্ত সুবিধা। বোনাস ক্রেডিট কোনো অবস্থাতেই সেন্টারের নিজস্ব মূল রাজস্ব বা প্রত্যাহারযোগ্য নগদ অর্থ হিসেবে গণ্য হবে না।
            </p>
          </>
        }
        childrenEn={
          <>
            <p>
              Extended multi-month prepayments (e.g., 3-month, 6-month, or 12-month recharges) may qualify for promotional bonus credits according to active promotional tiers.
            </p>
            <p>
              Promotional bonuses are granted solely as usage credits on the platform. Bonus credits hold zero cash surrender value and are recorded as separate non-revenue credits in our billing ledger.
            </p>
          </>
        }
      />

      <PolicySection
        number="৫"
        titleBn="ব্যালেন্স শেষ হলে কী ঘটে: রিড-অনলি মোড"
        titleEn="Zero-Balance Handling: Read-Only Mode (No Deletion)"
        childrenBn={
          <>
            <p>
              <strong>কোনো তথ্য মুছে ফেলা হয় না:</strong> ওয়ালেটের ব্যালেন্স শূন্য হয়ে গেলে বা পরবর্তী দিনের খরচ বহনে অপারগ হলে সেন্টারটি স্বয়ংক্রিয়ভাবে <em>রিড-অনলি (Read-Only)</em> অবস্থায় স্থানান্তরিত হয়।
            </p>
            <p>
              রিড-অনলি অবস্থায় সেন্টারের কোনো শিক্ষার্থী, হাজিরা, পরীক্ষার নম্বর বা আর্থিক রসিদ মুছে ফেলা হয় না। সেন্টারের শিক্ষক ও পরিচালকরা সকল পূর্বতন ডেটা দেখতে ও এক্সপোর্ট করতে পারবেন; কেবল নতুন হাজিরা নেওয়া বা নম্বর এন্ট্রির মতো রাইট অপারেশনগুলো সাময়িক বন্ধ থাকবে, যা রিচার্জ করামাত্রই সচল হয়।
            </p>
          </>
        }
        childrenEn={
          <>
            <p>
              <strong>No Data Deletion:</strong> When your prepaid balance can no longer cover the next day&apos;s charge, your account transitions into <em>Read-Only Mode</em>.
            </p>
            <p>
              During read-only mode, no student records, attendance histories, exam results, or fee receipts are deleted or altered. You retain full access to view, search, and export all historical data. Only write operations (such as taking fresh attendance or recording new marks) pause until a recharge is confirmed.
            </p>
          </>
        }
      />

      <PolicySection
        number="৬"
        titleBn="পেমেন্ট ভেরিফিকেশন ও সাপোর্ট উইন্ডো"
        titleEn="Manual bKash Verification Window"
        childrenBn={
          <>
            <p>
              বর্তমানে বিকাশ (bKash) ও প্রচলিত মোবাইল পেমেন্টে প্রেরিত অর্থ আমাদের টিম দ্বারা ট্রানজাকশন আইডি (TrxID) যাচাইয়ের মাধ্যমে সেন্টারের অ্যাকাউন্টে যুক্ত করা হয়।
            </p>
            <p>
              সাধারণ ব্যবসায়িক কর্মঘণ্টায় (সকাল ৯টা হতে রাত ৯টা) ট্রানজাকশন সাবমিট করার ১ থেকে ২ ঘণ্টার মধ্যে ভেরিফিকেশন সম্পন্ন হয়। যেকোনো জরুরি প্রয়োজনে হেল্পলাইন <strong>01756211762</strong> নম্বরে কল বা হোয়াটসঅ্যাপে যোগাযোগ করা যাবে।
            </p>
          </>
        }
        childrenEn={
          <>
            <p>
              Recharge claims submitted via bKash or mobile financial services are verified against carrier statements by our finance team using the provided transaction ID (TrxID).
            </p>
            <p>
              Verification is completed promptly within standard business hours (9:00 AM to 9:00 PM, 7 days a week), typically within 1 to 2 hours. In case of urgent assistance, our direct support helpline is <strong>01756211762</strong>.
            </p>
          </>
        }
      />
    </article>
  )
}
