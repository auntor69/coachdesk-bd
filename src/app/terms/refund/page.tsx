import type { Metadata } from 'next'
import { PolicySection } from '../policy-section'

export const metadata: Metadata = {
  title: 'রিফান্ড ও বাতিল নীতিমালা — Refund & Cancellation Policy',
  description:
    'CoachDesk BD-এর রিফান্ড নীতিমালা, ক্রেডিট অফেরতযোগ্যতার সুস্পষ্ট নিয়মাবলী এবং ভুল বা ত্রুটিতে প্রতিষ্ঠাতা সমন্বয়ের বিধান।',
}

export default function RefundPolicyPage() {
  return (
    <article className="space-y-6">
      <div className="border-b border-line pb-6">
        <span className="text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-full uppercase tracking-wider">
          খসড়া (Draft — Pending Legal Review)
        </span>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-ink mt-3">
          রিফান্ড ও বাতিল নীতিমালা
        </h1>
        <p className="text-base text-ink-soft mt-1 font-medium">
          Refund & Cancellation Policy
        </p>
        <p className="mt-3 text-xs text-ink-soft">
          এই নীতিমালা খসড়া হিসেবে প্রস্তুত করা হয়েছে এবং আইনি পর্যালোচনার অপেক্ষাধীন। (Working draft pending formal legal review.)
        </p>
      </div>

      <PolicySection
        number="১"
        titleBn="প্রিপেইড ক্রেডিটের অফেরতযোগ্যতা"
        titleEn="Non-Refundable Prepaid Wallet Credits"
        childrenBn={
          <>
            <p>
              CoachDesk BD সফটওয়্যারে রিচার্জকৃত অর্থ <strong>অফেরতযোগ্য (Non-Refundable)</strong>। কোনো গ্রাহক সেন্টারের রিচার্জকৃত ব্যালেন্স নগদ বা কোনো মোবাইল আর্থিক সেবা (যেমন বিকাশ/নগদ/রকেট) বা ব্যাংক অ্যাকাউন্টে ফেরত চাইতে পারবেন না।
            </p>
            <p>
              রিচার্জের বাটনে ট্যাপ করার পূর্বেই এই শর্ত প্রযোজ্য হয়। আমরা সকল প্রতিষ্ঠান প্রধানকে অনুরোধ জানাই তাদের সেন্টারের সম্ভাব্য শিক্ষার্থী সংখ্যা ও সময়কাল বিবেচনা করে পরিমিত পরিমাণ অর্থ রিচার্জ করতে।
            </p>
          </>
        }
        childrenEn={
          <>
            <p>
              All prepaid credits deposited into CoachDesk BD are <strong>non-refundable</strong>. Customers may not request cash payouts, withdrawals, or reverse transfers of unburned balances to mobile wallets or bank accounts.
            </p>
            <p>
              This binding condition is presented and acknowledged prior to initiating any recharge intent. We advise owners to deposit amounts tailored to their intended operating schedule.
            </p>
          </>
        }
      />

      <PolicySection
        number="২"
        titleBn="ভুল বা ত্রুটির ক্ষেত্রে কী সুবিধা: প্রতিষ্ঠাতা সমন্বয়"
        titleEn="Remedy for Platform or Operational Errors: Founder Adjustments"
        childrenBn={
          <>
            <p>
              যেখানে সাধারণ অবস্থায় নগদ রিফান্ড প্রদান করা হয় না, সেখানে প্ল্যাটফর্মের নিজস্ব কোনো প্রযুক্তিগত ত্রুটি, ভুল গণনা বা সার্ভার ডাউনটাইমের কারণে অনাকাঙ্ক্ষিত ক্ষতি হলে আমরা তা সমন্বয় করি:
            </p>
            <ul className="list-disc pl-5 space-y-2 mt-2">
              <li>
                <strong>প্রতিষ্ঠাতা ব্যালেন্স সমন্বয় (Founder Money Adjustment):</strong> সেন্টারের লিখিত অভিযোগ তদন্ত সাপেক্ষে প্ল্যাটফর্ম প্রতিষ্ঠাতা সরাসরি সেন্টারের লেজারে সমপরিমাণ অর্থ ক্রেডিট বা ব্যালেন্স সমন্বয় করে দেবেন।
              </li>
              <li>
                <strong>কার্যদিবস মঞ্জুরি (Founder Granted Days):</strong> রমজান মাস, দুর্যোগকালীন সাধারণ ছুটি বা সেন্টারের বিশেষ প্রয়োজনে প্রতিষ্ঠাতা সেন্টারের জন্য অতিরিক্ত সুবিধা বা ব্যালেন্স সমন্বয় বিবেচনা করতে পারেন।
              </li>
            </ul>
          </>
        }
        childrenEn={
          <>
            <p>
              While cash refunds are not offered, we acknowledge and rectify errors where the platform is at fault. If an inadvertent system fault, calculation discrepancy, or platform downtime results in an erroneous deduction:
            </p>
            <ul className="list-disc pl-5 space-y-2 mt-2">
              <li>
                <strong>Founder Money Adjustments:</strong> Following verification, our platform team can issue manual billing ledger adjustments directly to your center&apos;s wallet balance.
              </li>
              <li>
                <strong>Granted Days:</strong> In extraordinary operational circumstances (such as unforeseen closures, Ramadan pauses, or prolonged technical incidents), founders may issue discretionary billing adjustments or account extensions.
              </li>
            </ul>
          </>
        }
      />

      <PolicySection
        number="৩"
        titleBn="অ্যাকাউন্ট বাতিল ও প্রস্থান নীতি"
        titleEn="Cancellation & Center Departure Policy"
        childrenBn={
          <>
            <p>
              <strong>কোনো লক-ইন বা প্রস্থান জরিমানা নেই:</strong> আপনি যেকোনো সময় CoachDesk BD-এর ব্যবহার বন্ধ করতে পারেন। কোনো গ্রাহককে নির্দিষ্ট সময় পর্যন্ত চুক্তি ধরে রাখতে বাধ্য করা হয় না।
            </p>
            <p>
              সেন্টার বন্ধ করার পূর্বে পরিচালক তার সেন্টারের সমস্ত শিক্ষার্থীর তালিকা, হাজিরা রেকর্ড ও ফি কালেকশন রেজিস্টার এক্সেল/সিএসভি ফরম্যাটে ডাউনলোড করে নিতে পারবেন (/settings/export)। ব্যালেন্স শূন্য হওয়ার পর কোনো অতিরিক্ত ফি ধার্য করা হয় না।
            </p>
          </>
        }
        childrenEn={
          <>
            <p>
              <strong>Zero Lock-in, Zero Exit Penalties:</strong> Coaching centres may cease using CoachDesk BD at any time without penalty or termination fees. There are no mandatory multi-year commitments.
            </p>
            <p>
              Prior to departure, owners can export their operational data, rosters, exam marks, and financial registers via built-in CSV exports (/settings/export). Once wallet balance is depleted, no residual debt or fees accrue.
            </p>
          </>
        }
      />

      <PolicySection
        number="৪"
        titleBn="অভিযোগ ও সমন্বয় আবেদনের প্রক্রিয়া"
        titleEn="Discrepancy Reporting & Resolution Process"
        childrenBn={
          <>
            <p>
              বিলিং সম্পর্কিত যেকোনো অসঙ্গতি পরিলক্ষিত হলে ঘটনা ঘটার ৭ কার্যদিবসের মধ্যে ট্রানজাকশন বিবরণ ও সেন্টারের নাম সহ আমাদের অফিশিয়াল সাপোর্ট নম্বরে (<strong>01756211762</strong>) যোগাযোগ করুন। প্রতিটি সমন্বয় লেজারে লিখিত অডিট ট্রেইল সহ রেকর্ড করা হয়।
            </p>
          </>
        }
        childrenEn={
          <>
            <p>
              Any billing discrepancies or unexpected deductions should be reported within 7 business days via our official support line (<strong>01756211762</strong>) with your center name and transaction timestamps. Every adjustment is recorded in the billing ledger.
            </p>
          </>
        }
      />
    </article>
  )
}
