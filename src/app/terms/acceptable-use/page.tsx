import type { Metadata } from 'next'
import { PolicySection } from '../policy-section'

export const metadata: Metadata = {
  title: 'গ্রহণযোগ্য ব্যবহারের নীতিমালা — Acceptable Use Policy',
  description:
    'CoachDesk BD-এর গ্রহণযোগ্য ব্যবহারের নীতিমালা, অভিভাবকের মোবাইল নম্বরের অনুমোদিত ব্যবহার এবং বাল্ক স্প্যাম ও বিজ্ঞাপনী বার্তা প্রেরণের ওপর নিষেধাজ্ঞা।',
}

export default function AcceptableUsePage() {
  return (
    <article className="space-y-6">
      <div className="border-b border-line pb-6">
        <span className="text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-full uppercase tracking-wider">
          খসড়া (Draft — Pending Legal Review)
        </span>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-ink mt-3">
          গ্রহণযোগ্য ব্যবহারের নীতিমালা
        </h1>
        <p className="text-base text-ink-soft mt-1 font-medium">
          Acceptable Use Policy & Messaging Guidelines
        </p>
        <p className="mt-3 text-xs text-ink-soft">
          এই নীতিমালা খসড়া হিসেবে প্রস্তুত করা হয়েছে এবং আইনি পর্যালোচনার অপেক্ষাধীন। (Working draft pending formal legal review.)
        </p>
      </div>

      <PolicySection
        number="১"
        titleBn="অভিভাবকের মোবাইল নম্বরের সীমাবদ্ধ ব্যবহার"
        titleEn="Limitation on Guardian Phone Number Usage"
        childrenBn={
          <>
            <p>
              CoachDesk BD-এর এক-ট্যাপে এসএমএস ও হোয়াটসঅ্যাপ নোটিশ পাঠানোর সুবিধাটি ছাত্রছাত্রীদের শিক্ষা কার্যক্রম সুষ্ঠুভাবে পরিচালনার জন্য তৈরি।
            </p>
            <p>
              <strong>নিয়মাবলী:</strong> কোনো কোচিং সেন্টার বা শিক্ষক অভিভাবকের সংরক্ষিত মোবাইল নম্বর শুধুমাত্র সংশ্লিষ্ট সেন্টারের প্রাতিষ্ঠানিক ও শিক্ষামূলক যোগাযোগের (যেমন: অনুপস্থিতির নোটিশ, পরীক্ষার ফলাফল, বকেয়া ফি এর তাগাদা ও ক্লাস ছুটির নোটিশ) বাইরে অন্য কোনো উদ্দেশ্যে ব্যবহার করতে পারবেন না।
            </p>
          </>
        }
        childrenEn={
          <>
            <p>
              The tap-to-send SMS and WhatsApp messaging capabilities built into CoachDesk BD are designed exclusively for educational outreach.
            </p>
            <p>
              <strong>Rule:</strong> Coaching centers and instructors may not use guardian mobile numbers for any purpose other than educational communications directly related to their child (e.g., absence alerts, exam marks, fee reminders, and class schedules).
            </p>
          </>
        }
      />

      <PolicySection
        number="২"
        titleBn="বিজ্ঞাপন, স্প্যাম ও বাল্ক মার্কেটিং সম্পূর্ণ নিষিদ্ধ"
        titleEn="Ban on Commercial Spam & Third-Party Advertising"
        childrenBn={
          <>
            <p>
              শিক্ষার্থীর রস্টার বা তালিকা কোনো বিজ্ঞাপনী মেইলিং লিস্ট নয়। CoachDesk BD-এর প্ল্যাটফর্ম বা মেসেজিং সুবিধা ব্যবহার করে:
            </p>
            <ul className="list-disc pl-5 space-y-2 mt-2">
              <li>কোনো বাণিজ্যিক পণ্য, বই, গাইড বা তৃতীয় পক্ষের পণ্যের বিজ্ঞাপন পাঠানো সম্পূর্ণ নিষিদ্ধ।</li>
              <li>রাজনৈতিক প্রচার, ধর্মীয় উসকানি বা অবান্তর কোনো তথ্য প্রচার করা যাবে না।</li>
              <li>অন্যান্য কোচিং সেন্টার বা প্রতিষ্ঠানে ভর্তির জন্য আক্রমণাত্মক বা অননুমোদিত প্রচারণা চালানো যাবে না।</li>
            </ul>
          </>
        }
        childrenEn={
          <>
            <p>
              A student roster must never be converted into a marketing mailing list. It is an immediate violation of our platform terms to:
            </p>
            <ul className="list-disc pl-5 space-y-2 mt-2">
              <li>Broadcast unsolicited commercial promotions, third-party publications, guide books, or commercial services.</li>
              <li>Disseminate partisan political campaigns, religious solicitation, or unauthorized public broadcasts.</li>
              <li>Harvest or export guardian contact rosters to run cross-promotional recruitment or aggressive competitive solicitations.</li>
            </ul>
          </>
        }
      />

      <PolicySection
        number="৩"
        titleBn="নিষিদ্ধ কনটেন্ট ও প্রতারণামূলক আচরণ"
        titleEn="Prohibited Content & Harassment Standards"
        childrenBn={
          <>
            <p>
              প্ল্যাটফর্মের মাধ্যমে প্রেরিত যেকোনো নোটিশ বা এসএমএসে অশোভন, হুমকি প্রদর্শনকারী, মানহানিকর, প্রতারণামূলক বা বেআইনি কোনো বার্তা পাঠানো সম্পূর্ণ নিষিদ্ধ।
            </p>
            <p>
              সেন্টারের সকল কর্মকর্তা ও শিক্ষকদের পেশাদার আচরণ বজায় রাখতে হবে। কোনো অভিভাবক বা শিক্ষার্থীকে হয়রানি করার অভিযোগ প্রমাণিত হলে সংশ্লিষ্ট অ্যাকাউন্ট অবিলম্বে টার্মিনেট করা হবে।
            </p>
          </>
        }
        childrenEn={
          <>
            <p>
              Transmitting abusive, threatening, defamatory, discriminatory, or unlawful content via CoachDesk BD notices is prohibited and may violate applicable telecommunications laws.
            </p>
            <p>
              All communications must adhere to high standards of professional and pedagogical integrity. Verified reports of guardian harassment will lead to immediate service termination and legal referral.
            </p>
          </>
        }
      />

      <PolicySection
        number="৪"
        titleBn="সিস্টেম অপব্যবহার ও স্ক্র্যাপিং নিষেধাজ্ঞা"
        titleEn="Prohibition of Automated Abuse & Scraping"
        childrenBn={
          <>
            <p>
              গ্রাহক কোনো স্বয়ংক্রিয় বট, স্ক্র্যাপার বা অননুমোদিত স্ক্রিপ্টের মাধ্যমে প্ল্যাটফর্মের ডেটা উত্তোলন বা সার্ভারের স্বাভাবিক কার্যক্রম বিঘ্নিত করতে পারবেন না। প্ল্যাটফর্মের এপিআই বা ইন্টারফেসে কৃত্রিম চাপ সৃষ্টির যেকোনো অপচেষ্টা সাইবার অপরাধ হিসেবে বিবেচিত হবে।
            </p>
          </>
        }
        childrenEn={
          <>
            <p>
              Customers may not deploy automated bots, scrapers, crawlers, or high-concurrency scripts to extract platform interfaces or overburden system resources. Any attempt to disrupt service reliability constitutes actionable system abuse.
            </p>
          </>
        }
      />
    </article>
  )
}
