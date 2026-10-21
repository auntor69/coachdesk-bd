import type { Metadata } from 'next'
import { PolicySection } from '../policy-section'

export const metadata: Metadata = {
  title: 'গোপনীয়তা নীতি — Privacy Policy',
  description:
    'CoachDesk BD-এর গোপনীয়তা নীতি, শিক্ষার্থী ও অভিভাবকের সংরক্ষিত তথ্যের নিরাপত্তা, সেন্টারের অভ্যন্তরে ভূমিকা-ভিত্তিক প্রবেশাধিকার এবং কৃত্রিম বুদ্ধিমত্তা (AI) মডেলে ডেটা না পাঠানোর নীতি।',
}

export default function PrivacyPolicyPage() {
  return (
    <article className="space-y-6">
      <div className="border-b border-line pb-6">
        <span className="text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-full uppercase tracking-wider">
          খসড়া (Draft — Pending Legal Review)
        </span>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-ink mt-3">
          গোপনীয়তা নীতি
        </h1>
        <p className="text-base text-ink-soft mt-1 font-medium">
          Privacy Policy & Minor Data Protection
        </p>
        <p className="mt-3 text-xs text-ink-soft">
          এই নীতিমালা খসড়া হিসেবে প্রস্তুত করা হয়েছে এবং আইনি পর্যালোচনার অপেক্ষাধীন। (Working draft pending formal legal review.)
        </p>
      </div>

      <PolicySection
        number="১"
        titleBn="আমরা কী তথ্য সংগ্রহ ও সংরক্ষণ করি"
        titleEn="Data Collected on Students, Guardians & Centres"
        childrenBn={
          <>
            <p>
              কোচিং সেন্টারের দৈনন্দিন শিক্ষা ব্যবস্থাপনা পরিচালনার উদ্দেশ্যে CoachDesk BD নিম্নলিখিত সীমিত তথ্য সংরক্ষণ করে:
            </p>
            <ul className="list-disc pl-5 space-y-2 mt-2">
              <li><strong>শিক্ষার্থীর তথ্য:</strong> শিক্ষার্থীর নাম, রোল নম্বর, শ্রেণি, ব্যাচ এবং শিক্ষা প্রতিষ্ঠানের নাম।</li>
              <li><strong>অভিভাবকের তথ্য:</strong> অভিভাবকের নাম ও মোবাইল নম্বর (এসএমএস অ্যালার্ট ও জরুরি যোগাযোগের জন্য)।</li>
              <li><strong>শিক্ষা ও আর্থিক রেকর্ড:</strong> দৈনিক ক্লাসের হাজিরা (উপস্থিত/অনুপস্থিত/দেরি), পরীক্ষার ফলাফল ও নম্বরপত্র, এবং পরিশোধিত ফি ও রসিদ নম্বর।</li>
            </ul>
          </>
        }
        childrenEn={
          <>
            <p>
              To deliver operational coaching center management, CoachDesk BD holds only necessary information:
            </p>
            <ul className="list-disc pl-5 space-y-2 mt-2">
              <li><strong>Student Profile:</strong> Full name, institutional roll, academic class, assigned batch, and school/college.</li>
              <li><strong>Guardian Details:</strong> Guardian name and Bangladeshi mobile phone number for direct transactional SMS notifications and emergency outreach.</li>
              <li><strong>Academic & Financial Records:</strong> Daily attendance states (present, absent, late, excused), examination scores, and fee collection receipts.</li>
            </ul>
          </>
        }
      />

      <PolicySection
        number="২"
        titleBn="তথ্যের উদ্দেশ্য ও সেন্টারের অভ্যন্তরীণ অ্যাক্সেস"
        titleEn="Purpose of Data & Role-Based Internal Access"
        childrenBn={
          <>
            <p>
              এই তথ্যসমূহ কেবল সংশ্লিষ্ট সেন্টারের শিক্ষা পরিচালনা, অভিভাবককে ফলাফল ও হাজিরা অবহিতকরণ এবং সেন্টারের নিজস্ব হিসাব ব্যবস্থাপনার কাজে ব্যবহৃত হয়।
            </p>
            <p>
              <strong>সেন্টারের অভ্যন্তরে ভূমিকার ভিত্তিতে নিয়ন্ত্রণ:</strong>
            </p>
            <ul className="list-disc pl-5 space-y-1.5 mt-2">
              <li><strong>পরিচালক (Owner):</strong> সেন্টারের সকল শিক্ষার্থী, কর্মী ও আর্থিক তথ্যের সম্পূর্ণ নিয়ন্ত্রণাধিকার।</li>
              <li><strong>ম্যানেজার (Manager):</strong> সেন্টারের বা নির্দিষ্ট শাখার ছাত্র ও হাজিরা পরিচালনার অধিকার।</li>
              <li><strong>শিক্ষক (Teacher):</strong> কেবল নিজের নির্ধারিত ব্যাচের হাজিরা ও পরীক্ষার নম্বর ইনপুটের অধিকার। শিক্ষক কখনোই অন্য শিক্ষকের ছাত্র বা সেন্টারের সম্পূর্ণ আয়-ব্যয় দেখতে পান না।</li>
            </ul>
          </>
        }
        childrenEn={
          <>
            <p>
              Information is processed solely to facilitate educational delivery, attendance alerts, exam evaluations, and fee bookkeeping for the managing centre.
            </p>
            <p>
              <strong>Enforced Role-Based Scoping:</strong>
            </p>
            <ul className="list-disc pl-5 space-y-1.5 mt-2">
              <li><strong>Owners:</strong> Full administrative oversight over center rosters, accounting, and staff appointments.</li>
              <li><strong>Branch Managers:</strong> Scoped administrative permissions restricted to their assigned branch facilities.</li>
              <li><strong>Teachers:</strong> Scoped to assigned batches and subjects for register marking and score entry. Teachers cannot inspect other instructors&apos; students or institution-wide financials.</li>
            </ul>
          </>
        }
      />

      <PolicySection
        number="৩"
        titleBn="কৃত্রিম বুদ্ধিমত্তা (AI) মডেলে ডেটা না পাঠানোর নীতি"
        titleEn="Policy Against Sending Student Records to External AI Providers"
        childrenBn={
          <>
            <div className="rounded-xl border-2 border-brand-300 bg-brand-50 p-4 font-medium text-brand-900">
              <p className="font-bold text-base text-brand-800">আমাদের সুনির্দিষ্ট নীতি:</p>
              <p className="mt-1.5 leading-relaxed">
                CoachDesk BD কোনো শিক্ষার্থী বা অভিভাবকের নাম, মোবাইল নম্বর, পরীক্ষার নম্বর বা ব্যক্তিগত তথ্য কোনো তৃতীয় পক্ষের কৃত্রিম বুদ্ধিমত্তা বা AI কোম্পানির (যেমন OpenAI, Google, Anthropic বা অন্যান্য লার্জ ল্যাঙ্গুয়েজ মডেল) কাছে বিশ্লেষণ, ট্রেনিং বা প্রক্রিয়াকরণের জন্য প্রেরণ করে না।
              </p>
            </div>
            <p className="mt-3">
              শিক্ষার্থীদের ফলাফল, উপস্থিতি ও ফি সংক্রান্ত সকল গণনা এবং প্রক্রিয়াকরণ আমাদের নিজস্ব ডেটাবেসে সম্পন্ন হয়। শিশুদের তথ্য নিয়ে কোনো কৃত্রিম বুদ্ধিমত্তার প্রশিক্ষণ বা বাণিজ্যিক ট্র্যাকিং চালানো হয় না।
            </p>
          </>
        }
        childrenEn={
          <>
            <div className="rounded-xl border-2 border-brand-300 bg-brand-50 p-4 font-medium text-brand-900">
              <p className="font-bold text-base text-brand-800">Our Explicit Policy:</p>
              <p className="mt-1.5 leading-relaxed">
                CoachDesk BD does NOT transmit student records, minor identities, guardian phone numbers, or academic evaluations to third-party Artificial Intelligence (AI) or Large Language Model (LLM) providers (including OpenAI, Google Gemini, Anthropic, or external inference APIs).
              </p>
            </div>
            <p className="mt-3">
              All grade rankings, attendance percentages, and fee calculations are processed within our database. We do not monetize, harvest, or feed children&apos;s academic data into AI training datasets.
            </p>
          </>
        }
      />

      <PolicySection
        number="৪"
        titleBn="অপ্রাপ্তবয়স্ক ও শিক্ষার্থীর তথ্যের সুরক্ষা"
        titleEn="Protection of Minors&apos; Data"
        childrenBn={
          <>
            <p>
              কোচিং সেন্টারে পাঠরত অধিকাংশ শিক্ষার্থী অপ্রাপ্তবয়স্ক। এই তথ্যের সংবেদনশীলতা অনুধাবন করে:
            </p>
            <ul className="list-disc pl-5 space-y-2 mt-2">
              <li>আমরা কখনোই কোনো শিক্ষার্থীর ব্যক্তিগত তথ্য বিজ্ঞাপনী সংস্থা বা থার্ড পার্টির নিকট বিক্রি বা শেয়ার করি না।</li>
              <li>অভিভাবকের স্পষ্ট সম্মতি ও সেন্টারের প্রাতিষ্ঠানিক প্রয়োজন ব্যতীত কোনো আউটরিচ করা হয় না।</li>
              <li>যেকোনো সময় অভিভাবক সেন্টারের মাধ্যমে তাদের সন্তানের সংরক্ষিত তথ্য যাচাই বা সংশোধনের অনুরোধ জানাতে পারেন।</li>
            </ul>
          </>
        }
        childrenEn={
          <>
            <p>
              Recognizing that students are predominantly minors, we apply privacy safeguards:
            </p>
            <ul className="list-disc pl-5 space-y-2 mt-2">
              <li>We never sell, rent, broker, or syndicate student or guardian contact details to advertising networks or marketing brokers.</li>
              <li>Guardian numbers are dialed or texted solely for verified academic alerts directly initiated by their child&apos;s coaching center.</li>
              <li>Guardians retain the right via their coaching center to inspect and correct academic contact details.</li>
            </ul>
          </>
        }
      />

      <PolicySection
        number="৫"
        titleBn="তথ্য সংরক্ষণের সময়সীমা ও গোপনীয়তা অধিকার"
        titleEn="Data Retention Schedules & Access Rights"
        childrenBn={
          <>
            <p>
              সেন্টারের সক্রিয় ব্যবহার চলাকালীন সময় পর্যন্ত শিক্ষার্থীদের তথ্য ডেটাবেসে সংরক্ষিত থাকে। কোনো শিক্ষার্থী কোর্স সম্পন্ন করলে বা ভর্তি বাতিল হলে তাকে নিষ্ক্রিয় (dropped/completed) অবস্থায় সংরক্ষণ করা হয়, যা সেন্টারের হিসাবের জন্য অপরিহার্য।
            </p>
            <p>
              সেন্টার পরিচালক চাইলে যেকোনো সময় /settings/export স্ক্রিনের মাধ্যমে সম্পূর্ণ ডেটা এক্সপোর্ট করে নিতে পারেন অথবা সেন্টার বন্ধের মাধ্যমে তা অপসারণের অনুরোধ জানাতে পারেন।
            </p>
          </>
        }
        childrenEn={
          <>
            <p>
              Records are maintained for the active operational lifespan of the coaching center. When a student completes their academic term, their status transitions to completed or dropped while preserving financial audit integrity.
            </p>
            <p>
              Center owners hold rights to export their operational datasets at any time via /settings/export or request account termination and data deletion.
            </p>
          </>
        }
      />
    </article>
  )
}
