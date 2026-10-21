import type { Metadata } from 'next'
import { PolicySection } from '../policy-section'

export const metadata: Metadata = {
  title: 'ব্যবহারের সাধারণ শর্তাবলী — Terms of Service',
  description:
    'CoachDesk BD-এর সাধারণ ব্যবহারের শর্তাবলী, এক মানব এক অ্যাকাউন্ট নীতি, সেন্টার কর্তৃক প্রদত্ত শিক্ষক লগইনের স্বত্বাধিকার ও স্থগিতাদেশের নীতিমালা।',
}

export default function TermsOfServicePage() {
  return (
    <article className="space-y-6">
      <div className="border-b border-line pb-6">
        <span className="text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-full uppercase tracking-wider">
          খসড়া (Draft — Pending Legal Review)
        </span>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-ink mt-3">
          ব্যবহারের সাধারণ শর্তাবলী
        </h1>
        <p className="text-base text-ink-soft mt-1 font-medium">
          Terms of Service & Usage Governance
        </p>
        <p className="mt-3 text-xs text-ink-soft">
          এই নীতিমালা খসড়া হিসেবে প্রস্তুত করা হয়েছে এবং আইনি পর্যালোচনার অপেক্ষাধীন। (Working draft pending formal legal review.)
        </p>
      </div>

      <PolicySection
        number="১"
        titleBn="কারা ব্যবহার করতে পারবেন"
        titleEn="Eligibility & Target Audience"
        childrenBn={
          <>
            <p>
              CoachDesk BD বাংলাদেশের যেকোনো বৈধ কোচিং সেন্টার, প্রাইভেট ব্যাচ, একাডেমি ও শিক্ষা প্রতিষ্ঠানের পরিচালক, শিক্ষক, কর্মকর্তা এবং অভিভাবকদের জন্য প্রণীত।
            </p>
            <p>
              সফটওয়্যার ব্যবহারের মাধ্যমে গ্রাহক নিশ্চিত করেন যে তিনি বাংলাদেশে প্রচলিত আইনানুযায়ী চুক্তি সম্পাদনে সক্ষম এবং সংশ্লিষ্ট শিক্ষা প্রতিষ্ঠানের পক্ষে সিদ্ধান্ত গ্রহণের এখতিয়ার রাখেন।
            </p>
          </>
        }
        childrenEn={
          <>
            <p>
              CoachDesk BD is built exclusively for authorized proprietors, managers, teachers, and guardians of coaching centres, tutoring academies, and private educational institutions in Bangladesh.
            </p>
            <p>
              By signing up, you affirm that you possess the legal capacity under the laws of Bangladesh to enter into a binding agreement on behalf of yourself and the educational institution you represent.
            </p>
          </>
        }
      />

      <PolicySection
        number="২"
        titleBn="এক ব্যক্তি, এক অ্যাকাউন্ট নীতি"
        titleEn="One Account Per Human Invariant"
        childrenBn={
          <>
            <p>
              <strong>অ্যাকাউন্ট ভাগাভাগি নিষিদ্ধ:</strong> প্রতিটি অ্যাকাউন্ট একজন সুনির্দিষ্ট ব্যক্তির জন্য বরাদ্দ। একটি অ্যাকাউন্টের ইউজারনেম ও পাসওয়ার্ড একাধিক ব্যক্তির মাঝে আদান-প্রদান করা সম্পূর্ণ নিষিদ্ধ।
            </p>
            <p>
              সেন্টারের সকল শিক্ষক এবং স্টাফদের জন্য আলাদা আলাদা স্বতন্ত্র লগইন ও পাসওয়ার্ড তৈরি করতে হবে, যাতে অডিট ট্রেইলে কে কোন শিক্ষার্থীর তথ্য বা নম্বর পরিবর্তন করেছে তা সুস্পষ্টভাবে সংরক্ষিত থাকে।
            </p>
          </>
        }
        childrenEn={
          <>
            <p>
              <strong>No Account Sharing:</strong> Each user account must belong to a single human individual. Sharing login credentials, passwords, or access links among multiple staff or instructors is prohibited.
            </p>
            <p>
              Distinct logins must be provisioned for each instructor and administrator to safeguard accountability and audit integrity across student marks, attendance, and fee collections.
            </p>
          </>
        }
      />

      <PolicySection
        number="৩"
        titleBn="সেন্টার কর্তৃক প্রদত্ত শিক্ষক ও স্টাফ লগইনের মালিকানা"
        titleEn="Center Ownership of Center-Issued Staff Credentials"
        childrenBn={
          <>
            <p>
              সেন্টার পরিচালক কর্তৃক কোনো শিক্ষক বা স্টাফের জন্য যে ইউজারনেম/লগইন তৈরি করা হয় (Center-issued login), তা সেন্টারের অভ্যন্তরীণ প্রাতিষ্ঠানিক পরিচালনার আওতাধীন।
            </p>
            <p>
              যদি কোনো শিক্ষক বা কর্মী সেন্টার ত্যাগ করেন বা তাকে দায়িত্ব থেকে অব্যাহতি দেওয়া হয়, তবে সেন্টারের মালিক তাৎক্ষণিকভাবে ওই কর্মীর লগইন ও সেন্টারে প্রবেশের অনুমতি বন্ধ বা নিষ্ক্রিয় করার অধিকার রাখেন।
            </p>
          </>
        }
        childrenEn={
          <>
            <p>
              All username-based accounts and access credentials provisioned by a center owner or manager (Center-issued logins) are managed by the coaching centre.
            </p>
            <p>
              Upon a teacher or staff member&apos;s departure, termination, or reassignment, the center owner retains the right to revoke access, reset credentials, or deactivate the associated permissions.
            </p>
          </>
        }
      />

      <PolicySection
        number="৪"
        titleBn="অ্যাকাউন্ট স্থগিত ও বাতিলের কারণসমূহ"
        titleEn="Grounds for Immediate Account Suspension"
        childrenBn={
          <>
            <p>
              CoachDesk BD নিম্নলিখিত কার্যকলাপের প্রেক্ষিতে কোনো পূর্ব সতর্কতা ছাড়াই যেকোনো অ্যাকাউন্ট সাময়িক বা স্থায়ীভাবে বাতিল করার অধিকার সংরক্ষণ করে:
            </p>
            <ul className="list-disc pl-5 space-y-2 mt-2">
              <li>অভিভাবকদের ফোন নম্বরে অননুমোদিত স্প্যাম, বাল্ক মার্কেটিং বা প্রতারণামূলক এসএমএস প্রেরণ।</li>
              <li>প্ল্যাটফর্মের মাল্টি-টেন্যান্ট সিকিউরিটি বা ডেটাবেস আইসোলেশন লঙ্ঘনের কোনো প্রকার অপচেষ্টা।</li>
              <li>সফটওয়্যারের সোর্স কোড বা নিরাপত্তা ব্যবস্থার রিভার্স ইঞ্জিনিয়ারিং বা অননুমোদিত স্ক্র্যাপিং।</li>
              <li>ভুয়া বা জাল পেমেন্ট ট্রানজাকশন আইডি (TrxID) দাখিল করে অবৈধ ক্রেডিট অর্জনের প্রচেষ্টা।</li>
            </ul>
          </>
        }
        childrenEn={
          <>
            <p>
              CoachDesk BD reserves the right to immediately suspend or permanently terminate access without prior notice under the following circumstances:
            </p>
            <ul className="list-disc pl-5 space-y-2 mt-2">
              <li>Transmitting unsolicited promotional spam, bulk marketing, or deceptive SMS to guardian phone numbers.</li>
              <li>Any attempt to circumvent or probe database Row-Level Security (RLS) or cross-tenant boundaries.</li>
              <li>Reverse engineering, automated bulk scraping, or deliberate denial-of-service attempts.</li>
              <li>Submitting fraudulent, altered, or stolen transaction IDs (TrxIDs) to illicitly inflate wallet credits.</li>
            </ul>
          </>
        }
      />

      <PolicySection
        number="৫"
        titleBn="আইন ও বিচারিক এখতিয়ার"
        titleEn="Governing Law & Jurisdiction"
        childrenBn={
          <>
            <p>
              এই শর্তাবলী গণপ্রজাতন্ত্রী বাংলাদেশের আইন অনুযায়ী পরিচালিত ও ব্যাখ্যায়িত হবে। এই সফটওয়্যার ব্যবহারজনিত যেকোনো বিরোধ নিষ্পত্তিতে ঢাকার দেওয়ানি আদালতসমূহের একক বিচারিক এখতিয়ার থাকবে।
            </p>
          </>
        }
        childrenEn={
          <>
            <p>
              These Terms of Service are governed by and construed under the laws of the People&apos;s Republic of Bangladesh. Any legal disputes arising in connection with the platform shall be subject to the exclusive jurisdiction of the competent courts in Dhaka, Bangladesh.
            </p>
          </>
        }
      />
    </article>
  )
}
