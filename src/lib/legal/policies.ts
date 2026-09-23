/**
 * The seven pages that must exist before the first taka — MASTERPLAN.md §14.1,
 * build-order step 25a.
 *
 * WHY THIS FILE IS CONTENT AND NOT JSX. These are seven documents, each of which will be
 * edited by somebody who should not have to read a React component to change a sentence.
 * They are also read twice: once by the page that draws them, and once by
 * `lib/legal/acceptance.ts`, which stores the version of each policy somebody agreed to.
 * A version that lives in the same object as the words it versions is the only arrangement
 * where changing the words and forgetting to change the version is visible in a diff.
 *
 * VERSIONED PER POLICY AND NOT ONCE FOR THE SITE (`PolicyDoc.version`). A term we change is
 * a term somebody agreed to a different form of, and "they ticked a box once" is not an
 * answer when the box has been re-worded twice (§14.1). Per policy because the alternative
 * re-asks every customer to accept the billing terms because the privacy page gained a
 * paragraph — a dialog nobody reads, which is worse than the question it asks.
 *
 * BANGLA FIRST, AND THE BANGLA IS THE ONE THAT MATTERS. The reader is a coaching-centre
 * owner in Mymensingh, not a lawyer in Dhaka. The English is written to say the same thing
 * rather than to be the authoritative text, and no sentence here depends on the other
 * language for its meaning.
 *
 * WHAT THESE PAGES MUST NOT CLAIM (§14.1, §24): no certification, no standard, no
 * compliance framework we have not actually been audited against. "Data is encrypted in
 * transit and at rest" is true because Supabase does it. "GDPR compliant" and "ISO 27001"
 * are not ours to say, and a false statement turns a small dispute into a large one.
 * `tests/legal.test.ts` refuses those words in either language, so the rule survives the
 * next edit by somebody who has not read this comment.
 *
 * NO STUDENT OR GUARDIAN IS EVER A PARTY HERE. The person accepting is the account holder
 * — the centre — and a child cannot consent to a contract (§14.1). The privacy page says so
 * out loud, in both languages, because that is the question a parent actually asks.
 *
 * NO IMPORTS FROM THE APP. This module is pure data with one type import, so it can be read
 * by a server component, a test, and a migration-drift check without dragging a Supabase
 * client or a dictionary in behind it. Deliberately NOT imported by any `'use client'`
 * file: seven documents in two languages is most of a megabyte of prose, and the recharge
 * form needs one link to it, which the server parent passes down as a string.
 */
import type { Route } from 'next'

import type { Locale } from '@/lib/i18n/locale'

/**
 * The one number a customer can call, and it is the same number a recharge is chased on.
 *
 * Hardcoded rather than read from the environment, unlike `NEXT_PUBLIC_SALES_PHONE`. That
 * variable is where money is *sent* and is deliberately absent from every deployment until
 * a founder sets it — so it is exactly the wrong thing for a legal page to depend on, since
 * a support page that renders no contact because an env var is unset is a page that has
 * failed at its one job. §14.1 names 01756211762 as already being that number.
 */
export const SUPPORT_PHONE = '01756211762'

/** The same number, plus the international form a page needs for a `tel:` link. */
export const SUPPORT_PHONE_E164 = '+8801756211762'

/**
 * The seven kinds, in the order they are read: money first, because the money is the part
 * that cannot wait, then the contract, then the things a parent or a founder asks about.
 */
export const POLICY_KINDS = [
  'prepaid_billing',
  'refunds',
  'terms',
  'privacy',
  'acceptable_use',
  'deletion',
  'security',
] as const

export type PolicyKind = (typeof POLICY_KINDS)[number]

/**
 * URL segments, written out rather than derived from the kind.
 *
 * `prepaid_billing` slugified by a regex is `prepaid-billing`, which is right — and a slug
 * that is computed is a slug that changes the day somebody adds an underscore to a kind,
 * silently breaking a link a customer has already been sent. These are the addresses the
 * recharge screen and the signup checkbox link to, so they are stable on purpose.
 */
export const POLICY_SLUGS = {
  prepaid_billing: 'prepaid-billing',
  refunds: 'refunds',
  terms: 'terms',
  privacy: 'privacy',
  acceptable_use: 'acceptable-use',
  deletion: 'deletion',
  security: 'security',
} as const satisfies Record<PolicyKind, string>

export type PolicySlug = (typeof POLICY_SLUGS)[PolicyKind]

/** One headed block. Paragraphs, not markup: a policy is prose and should stay prose. */
export type PolicySection = {
  heading: string
  paragraphs: readonly string[]
}

/** One policy, in one language. */
export type PolicyCopy = {
  /** The page's own name, and the words a checkbox links with. */
  title: string
  /** One sentence for the index, and for the line above the sections. */
  lead: string
  sections: readonly PolicySection[]
}

/**
 * One policy: what it is called, where it lives, which version it is, and both languages.
 *
 * `version` is a date rather than a number, because the question a dispute asks is "when did
 * these words change", and `'2026-09-18'` answers it while `v3` does not. It is compared for
 * equality and never ordered, so nothing has to parse it — the shape only has to be one a
 * human can read in a row of `policy_acceptances`.
 */
export type PolicyDoc = {
  kind: PolicyKind
  slug: PolicySlug
  version: string
  bn: PolicyCopy
  en: PolicyCopy
}

/**
 * The five kinds somebody has to accept, and the two that are only read.
 *
 * SPLIT BY WHEN THE CONSENT HAPPENS, and the split is a product decision rather than a legal
 * one. At signup the person is opening an account, so what they are agreeing to is the
 * contract and the handling of the data — and a fresh account has agreed to nothing about
 * money, because no money exists yet. At the first recharge the balance becomes real, which
 * is where the terms that govern the balance have to be seen (§14.1: "the first taka must
 * not arrive against nothing written").
 *
 * `deletion` AND `security` ARE NOT ACCEPTED BY ANYBODY, deliberately. They are statements
 * of what we do to a request and how to reach a human, not terms anybody can be held to, and
 * a checkbox on "we will answer your email" is consent theatre — the kind that teaches a
 * reader to tick without reading, which is the failure that makes the other five worthless.
 */
export const SIGNUP_POLICIES = ['terms', 'privacy', 'acceptable_use'] as const satisfies
  readonly PolicyKind[]

export const RECHARGE_POLICIES = ['prepaid_billing', 'refunds'] as const satisfies
  readonly PolicyKind[]

/**
 * Where a policy is read from. One function, because the recharge screen's non-refundable
 * line, the signup checkbox and the index all have to point at the same place.
 *
 * Typed as `Route` rather than `string` because Next 16's typed routes refuse a bare string
 * in `href` — and the cast is honest about what the compiler cannot see: a template literal
 * built from a record of slugs is a real route at runtime, and the route group's `[kind]`
 * page is what serves it. A slug that named no page would 404 rather than break the build,
 * which is why `tests/legal.test.ts` asserts this function against `POLICIES` instead.
 */
export function policyHref(slug: PolicySlug): Route {
  return `/legal/${slug}` as Route
}

export const POLICIES: readonly PolicyDoc[] = [
  /* ------------------------------------------------------------------ money --- */
  {
    kind: 'prepaid_billing',
    slug: POLICY_SLUGS.prepaid_billing,
    version: '2026-09-18',
    bn: {
      title: 'প্রিপেইড বিলিং শর্তাবলি',
      lead:
        'টাকা একবার জমা হয়, তারপর প্রতিদিন নিজের খরচ নিজে কেটে নেয়। কোনো মাসিক বিল নেই, '
        + 'কোনো ডিউ ডেট নেই।',
      sections: [
        {
          heading: '১. ব্যালান্স যেভাবে খরচ হয়',
          paragraphs: [
            'আপনি যে টাকা পাঠান সেটি কেন্দ্রের ব্যালান্সে জমা থাকে। প্রতিদিনের কাজের জন্য '
            + 'ঠিক এক দিনের খরচ ওই ব্যালান্স থেকে কেটে নেওয়া হয় — অগ্রিম, দিনে দিনে। '
            + 'কোনো মাস শেষে বিল আসে না, আর কোনো তারিখে টাকা দিতে হয় না।',
            'এক দিনের দাম নির্ভর করে আপনার কেন্দ্রের আকারের উপর — সক্রিয় শিক্ষার্থী, '
            + 'সক্রিয় শিক্ষক এবং শাখার সংখ্যা। যে দিনের হিসাব নেওয়া হয়েছে, সেদিনের কার্ড '
            + 'অনুযায়ী দাম দেওয়া হয়েছে; পরে দাম বদলালেও পুরনো দিনের দাম কখনো আবার '
            + 'হিসাব করা হয় না।',
            'আজকের দাম ঠিক হয় দিনের কাজ শুরু হওয়ার সময় কেন্দ্রের যে আকার থাকে, সেই '
            + 'আকার অনুযায়ী।',
          ],
        },
        {
          heading: '২. টাকা ফেরত হয় না, মেয়াদও শেষ হয় না',
          paragraphs: [
            'ব্যালান্সে জমা পড়া টাকা ফেরতযোগ্য নয়। কারণটি সরল: ওই টাকা ইতিমধ্যে দিন কিনে '
            + 'ফেলেছে, আর ব্যয় হয়ে যাওয়া দিন ফেরানো যায় না। এজন্যই জমা রাখতে হয় ছোট '
            + 'এবং প্রতি মাসে নয়।',
            'যে টাকা এখনো ব্যয় হয়নি, তার কোনো মেয়াদ নেই। ব্যালান্স যত দিন থাকবে, তত দিন '
            + 'ডেটা থাকবে — কোনো টাকার অভাবে ব্যালান্স মুছে যায় না, মেয়াদ শেষ হয় না।',
            'এই টাকা ফেরত চাওয়ার নিয়ম আলাদা পাতায় লেখা আছে — "টাকা ফেরত ও বাতিল" দেখুন।',
          ],
        },
        {
          heading: '৩. টাকা পাঠানো ও জমা হওয়া',
          paragraphs: [
            'রিচার্জ স্ক্রিনে যে নম্বর দেখানো হয়, bKash বা Nagad-এর "Send Money" দিয়ে ঠিক '
            + 'ততটুকু টাকা পাঠাতে হবে। তারপর ওই ফর্মে Transaction ID (TrxID) এবং যে নম্বর '
            + 'থেকে পাঠিয়েছেন সেটি লিখে জানাতে হবে।',
            'এই জানানোটাই আমাদের কাছে আপনার দাবি — আপনি যা বলেছেন, আমরা সেটা যাচাই করি। '
            + 'নিজে থেকে কোনো ব্যালান্স জমা হয় না, এবং স্ক্রিনে যা দেখানো হয় তার বেশি '
            + 'জমা হয় না।',
          ],
        },
        {
          heading: '৪. যাচাই হাতে হয় — এক কর্মদিবসের মধ্যে',
          paragraphs: [
            'আমাদের পেমেন্ট নিজে দেখে যাচাই করতে হয়। সাধারণত মিনিটেই হয়ে যায়, কিন্তু '
            + 'আমরা সময়সীমা দিচ্ছি একটি কর্মদিবস — সকাল ৯টা থেকে রাত ৯টা, সপ্তাহে সাত '
            + 'দিন। যাচাই না হওয়া পর্যন্ত ব্যালান্স যেমন ছিল তেমনই থাকে; অপেক্ষার সময় '
            + 'কোনো কিছু হারায় না।',
            'টাকা জমা পড়ার পরে সেটি ব্যালান্সে যোগ হয়, এবং স্ক্রিনে "Credited" লেখা '
            + 'থাকে — কত জমা পড়ল, কত বোনাস এল, সহ।',
          ],
        },
        {
          heading: '৫. বোনাস মানে জমা, নগদ নয়',
          paragraphs: [
            'কখনো কখনো আমরা বেশি টাকা পাঠিয়ে রিচার্জ করতে উৎসাহ দিই — যেমন এখন ১ মাস, ৩ মাস, '
            + '৬ মাস ও ১২ মাসের জন্য ধাপে ধাপে বোনাস আছে। বোনাস হলো বাড়তি ব্যালান্স, '
            + 'অর্থাৎ কত দিন চলবে তা বাড়ায় — এটি নগদ টাকা নয়, ফেরতযোগ্যও নয়।',
            'বোনাস কী হবে তা সার্ভারে হিসাব হয়, আপনার ফোনে নয়। আপনার অনুরোধ আমাদের '
            + 'হাতে আসার সময় যে নিয়ম চালু ছিল, সেটাই সেই অনুরোধে প্রয়োগ হয় — তারপর '
            + 'নিয়ম বদলালেও আপনার ওই অপেক্ষমাণ অনুরোধে পুরনো নিয়মই থাকে।',
            'প্রকৃতপক্ষে যে টাকা আমাদের কাছে এসেছে, কেবল সেটাই (আর তার বোনাস) জমা হয়, '
            + 'আর বাকি অংশ আমাদের হিসাবে আয় হিসেবে লেখা থাকে — আপনার ব্যালান্সে এতে কোনো '
            + 'প্রভাব নেই।',
          ],
        },
        {
          heading: '৬. ব্যালান্স শেষ হয়ে গেলে কী হয়',
          paragraphs: [
            'ব্যালান্স পরের দিনের খরচ দিতে না পারলে ডেটা মুছে যায় না এবং অ্যাকাউন্ট বন্ধ '
            + 'হয় না — শুধু সেভ করা বন্ধ হয়। পুরনো সব দেখা যায়, রিপোর্ট বের করা যায়, '
            + 'তালিকা পড়া যায়; নতুন লেখা যায় না।',
            'টাকা যোগ করলে বন্ধ থাকা জায়গাটি আবার চালু হয়ে যায়, কোনো কিছু পুনরায় '
            + 'সেটআপ করতে হয় না।',
          ],
        },
        {
          heading: '৭. দাম বদলাতে পারে',
          paragraphs: [
            'আমাদের দামের একটি তালিকা আছে, আর প্রতিটি তালিকার শুরু হওয়ার তারিখ থাকে। '
            + 'নতুন দাম কখনো পুরনো দিনের উপর প্রয়োগ হয় না — যেদিন থেকে নতুন তালিকা চালু '
            + 'হবে, সেদিনের পরের দিনগুলোতে সেটি খাটে।',
            'দাম বদলালে আমরা আগে জানাই। দাম বদলানোর কারণে আপনার জমা টাকা কমে যায় না, '
            + 'শুধু প্রতি দিনে ওই টাকায় কিছু দিন কমবেশি চলতে পারে।',
          ],
        },
      ],
    },
    en: {
      title: 'Prepaid Billing Terms',
      lead:
        'Money is added once and then spends itself a day at a time. There is no monthly '
        + 'invoice and no due date.',
      sections: [
        {
          heading: '1. How the balance is spent',
          paragraphs: [
            'The money you send is credited to the centre\'s balance. Each day of work costs '
            + 'exactly one day\'s price, and it comes off that balance — in advance, day by '
            + 'day. No bill arrives at the end of a month and nothing has to be paid on a '
            + 'date.',
            'A day\'s price depends on the size of your centre: active students, active '
            + 'teachers and branches. Each day is charged at the price in force on that day, '
            + 'and a day already charged is never re-priced, even if the price changes '
            + 'afterwards.',
            'Today\'s price is fixed by the size of the centre at the moment the day\'s work '
            + 'starts.',
          ],
        },
        {
          heading: '2. Not refundable, and it does not expire',
          paragraphs: [
            'Money in the balance is not refundable. The reason is simple: it has already '
            + 'bought days, and a day that has been spent cannot be unspent. That is also why '
            + 'you add a small amount rather than a month at a time.',
            'Whatever has not been spent yet has no expiry date. As long as there is a '
            + 'balance, your data stays — an empty balance never deletes it and never expires '
            + 'it.',
            'Asking for a refund is a separate page: see "Refund & Cancellation".',
          ],
        },
        {
          heading: '3. Sending the money and having it credited',
          paragraphs: [
            'Send exactly the amount shown on the recharge screen to the number it displays, '
            + 'using Send Money in bKash or Nagad. Then file the claim on that screen with the '
            + 'transaction ID (TrxID) and the number you sent from.',
            'That claim is what we check. Nothing is credited automatically and nothing is '
            + 'credited on the browser\'s word — the figure on the screen is a quote, not a '
            + 'receipt.',
          ],
        },
        {
          heading: '4. Verification is by hand, within one working day',
          paragraphs: [
            'A person has to look at the payment. It usually takes minutes, but the window we '
            + 'promise is one working day: 9am to 9pm, seven days a week. Until it is checked '
            + 'the balance is exactly as it was, and nothing is lost while it is waiting.',
            'When the money is credited, the screen says so — how much arrived, and any '
            + 'bonus that came with it.',
          ],
        },
        {
          heading: '5. A bonus is credit, not cash',
          paragraphs: [
            'We sometimes encourage larger recharges with a bonus — today at 1, 3, 6 and 12 '
            + 'months. A bonus is extra balance, which means more days, and it is neither cash '
            + 'nor refundable.',
            'What the bonus is, is worked out on the server and never in your browser. A '
            + 'claim is priced by the offer in force when it reached us, so changing the offer '
            + 'later never changes a claim that is already waiting.',
            'Only what actually arrived is credited, plus its bonus. The difference between '
            + 'what was promised and what arrived is recorded on our side as revenue, and is '
            + 'not something your balance has to reconcile.',
          ],
        },
        {
          heading: '6. What happens when the balance runs out',
          paragraphs: [
            'If the balance cannot cover the next day, nothing is deleted and the account is '
            + 'not closed — saving stops. Everything already recorded stays readable, reports '
            + 'still export, lists still print; new writing does not go through.',
            'Adding money turns the saving back on. Nothing has to be set up again.',
          ],
        },
        {
          heading: '7. Prices can change',
          paragraphs: [
            'There is a dated price list. A new list never applies backwards: it governs the '
            + 'days from the date it takes effect, and every earlier day keeps the price it '
            + 'was charged at.',
            'We tell you before a price changes. A price change never reduces the money you '
            + 'have already added — it only changes how many days that money covers.',
          ],
        },
      ],
    },
  },

  {
    kind: 'refunds',
    slug: POLICY_SLUGS.refunds,
    version: '2026-09-18',
    bn: {
      title: 'টাকা ফেরত ও বাতিল',
      lead: 'ব্যালান্সের টাকা ফেরতযোগ্য নয় — কিন্তু আমরা ভুল করলে সেটি সংশোধন করা হয়।',
      sections: [
        {
          heading: '১. কেন ব্যালান্স ফেরত দেওয়া হয় না',
          paragraphs: [
            'ব্যালান্সের টাকা ইতিমধ্যে দিন কিনে ফেলেছে। যেসব দিন কেটে গেছে সেগুলো ফেরানো '
            + 'সম্ভব নয়, তাই পুরো টাকা ফেরত দেওয়ার প্রশ্ন ওঠে না। এটাই প্রিপেইড মডেলের '
            + 'শর্ত, এবং রিচার্জ করার আগে এটি লেখা আছে — আপনি জেনেই টাকা পাঠাচ্ছেন।',
            'যে টাকা এখনো খরচ হয়নি, সেটি ব্যালান্সে আপনার জন্যই আছে, মেয়াদহীনভাবে। '
            + 'আপনি কাজ বন্ধ করলেও টাকা হারায় না; কেন্দ্র আবার চালু করলে সেখান থেকেই '
            + 'চলতে থাকে।',
          ],
        },
        {
          heading: '২. আমরা ভুল করলে আমরা ঠিক করি',
          paragraphs: [
            'টাকা এসেছে কিন্তু জমা পড়েনি, কম পড়েছে, কেন্দ্র বন্ধ থাকার দিনও খরচ কেটে '
            + 'নেওয়া হয়েছে, বা কোনো কিছু ভেঙে গেছে — এসব ক্ষেত্রে ফেরতের বদলে আমরা '
            + 'ব্যালান্স সমন্বয় করে দিই বা দিন যোগ করে দিই।',
            'প্রতিটি সমন্বয় লিখিত কারণসহ করা হয় এবং সেটি ব্যালান্সের হিসাবের খাতায় থেকে '
            + 'যায়। অর্থাৎ যা যোগ বা বিয়োগ হলো, এবং কেন — দুটোই পরে দেখা যায়।',
          ],
        },
        {
          heading: '৩. সেবা বাতিল করলে কী হয়',
          paragraphs: [
            'বাতিল করা মানে নতুন রিচার্জ না করা। বাকি ব্যালান্স আগের মতোই দিন চালাতে '
            + 'থাকে, যত দিন সেটি টেকে। কোনো কিছু মুছে যায় না এবং ডেটা এক্সপোর্ট করা '
            + 'যায়।',
            'টাকা পাঠানো বন্ধ করার জন্য কিছু করতে হয় না — শুধু রিচার্জ না করলেই হবে। '
            + 'আপনি চাইলে ফোন করে জানাতে পারেন, আমরা মনে রাখব।',
          ],
        },
        {
          heading: '৪. ছাত্র-ছাত্রীর ফি আমাদের বিষয় নয়',
          paragraphs: [
            'অভিভাবকের কাছ থেকে কেন্দ্র যে ফি নেয়, সেটি কেন্দ্রের টাকা এবং কেন্দ্রের '
            + 'হিসাব। আমরা ওই টাকায় হাত দিই না, দেখি না, এবং কোনো ফি বাবদ কোনো দাবি '
            + 'করি না।',
            'আমাদের সাথে আপনার সম্পর্ক শুধু একটি: ব্যালান্স ক্রয়।',
          ],
        },
        {
          heading: '৫. কীভাবে জানাবেন',
          paragraphs: [
            `যেকোনো ফেরত, সমন্বয় বা বাতিলের প্রশ্নে ${SUPPORT_PHONE} নম্বরে ফোন দিন, `
            + 'অথবা হোয়াটসঅ্যাপে লিখুন। একটি কর্মদিবসের মধ্যে আমরা উত্তর দিই।',
            'যা জানাতে হবে: কেন্দ্রের নাম, কী ঘটেছে, কত টাকা, আর যদি থাকে তবে TrxID। '
            + 'অ্যাকাউন্টের পাসওয়ার্ড বা bKash-এর পিন কখনো কাউকে দেবেন না — আমরা কখনো '
            + 'চাই না।',
          ],
        },
      ],
    },
    en: {
      title: 'Refund & Cancellation',
      lead: 'Balance is not refundable — but a mistake of ours is always put right.',
      sections: [
        {
          heading: '1. Why the balance is not refundable',
          paragraphs: [
            'Money in the balance has already bought days, and a day that has passed cannot be '
            + 'returned. So a refund of the whole amount is not something we offer. This is '
            + 'the terms of a prepaid balance, and it is written before you send anything — '
            + 'you are reading it before you pay, not after.',
            'Whatever has not been spent is still yours, with no expiry. If your centre stops '
            + 'working, the money is not lost; it is there when you start again.',
          ],
        },
        {
          heading: '2. What we do instead when we were wrong',
          paragraphs: [
            'Money arrived but was not credited, or was credited short; a day was charged for '
            + 'a period your centre was closed; something failed on our side — in each of '
            + 'those cases we adjust the balance or grant days.',
            'Every adjustment carries a written reason and is recorded in the balance\'s own '
            + 'ledger, so what moved and why can both be read afterwards.',
          ],
        },
        {
          heading: '3. Leaving, and cancelling',
          paragraphs: [
            'Leaving means not recharging. The balance you already have goes on paying for '
            + 'days until it runs out. Nothing is deleted and your data can still be '
            + 'exported.',
            'There is nothing to switch off to stop paying — simply not recharging is enough. '
            + 'You can tell us by phone and we will note it.',
          ],
        },
        {
          heading: '4. Student fees are not ours',
          paragraphs: [
            'The fees a centre collects from guardians are the centre\'s money and the '
            + 'centre\'s ledger. We never touch them, never see them, and never claim any part '
            + 'of them.',
            'Our only commercial relationship with you is the purchase of balance.',
          ],
        },
        {
          heading: '5. How to reach us',
          paragraphs: [
            `Call ${SUPPORT_PHONE} or write on WhatsApp about any refund, adjustment or '
            + 'cancellation. We answer within one working day.`,
            'Tell us the centre\'s name, what happened, the amount, and the TrxID if you have '
            + 'it. Never send anybody your account password or your bKash PIN — we never ask '
            + 'for either.',
          ],
        },
      ],
    },
  },

  /* ------------------------------------------------------------- contract --- */
  {
    kind: 'terms',
    slug: POLICY_SLUGS.terms,
    version: '2026-09-18',
    bn: {
      title: 'ব্যবহারের শর্তাবলি',
      lead: 'কে ব্যবহার করতে পারবেন, কার অ্যাকাউন্ট কার, আর কী হলে অ্যাকাউন্ট বন্ধ হয়।',
      sections: [
        {
          heading: '১. কারা ব্যবহার করতে পারবেন',
          paragraphs: [
            'বাংলাদেশের একটি কোচিং সেন্টার পরিচালনার জন্য এটি বানানো। অ্যাকাউন্ট খুলতে '
            + 'হবে প্রাপ্তবয়স্ক (১৮ বছরের বেশি) ব্যক্তির, এবং তিনি কেন্দ্রের পক্ষে কথা '
            + 'বলার ক্ষমতা রাখেন।',
            'একই ফোন নম্বর বা ইমেইল দিয়ে একটির বেশি অ্যাকাউন্ট খোলার দরকার নেই, এবং '
            + 'একটি কেন্দ্রের জন্য একবারই অ্যাকাউন্ট খুলতে হয়।',
          ],
        },
        {
          heading: '২. একজন মানুষ, একটি অ্যাকাউন্ট',
          paragraphs: [
            'প্রতিটি অ্যাকাউন্ট একজন মানুষের। পাসওয়ার্ড ভাগ করে দিলে কে কী পরিবর্তন করল '
            + 'তা আর জানা যায় না, আর অ্যাকাউন্টের দায়িত্ব তখন আপনার উপরেই থাকে বলে '
            + 'ধরা হয়।',
            'শিক্ষক বা কর্মচারীর জন্য কেন্দ্র নিজে লগইন বানিয়ে দিতে পারে — সেটি অবশ্যই '
            + 'ভিন্ন অ্যাকাউন্ট হবে, একই পাসওয়ার্ড নয়।',
          ],
        },
        {
          heading: '৩. কেন্দ্র যে লগইন দেয়, সেটি কেন্দ্রের',
          paragraphs: [
            'কেন্দ্র তার কর্মীদের যে অ্যাকাউন্ট দেয়, সেটি কেন্দ্রের দায়িত্ব ও কেন্দ্রের '
            + 'নিয়ন্ত্রণে থাকে। চাকরি ছাড়ার পর কেন্দ্র চাইলে সেই লগইন বন্ধ করে দিতে '
            + 'পারে, এবং সেটি বন্ধ করার অধিকার কেন্দ্রেরই আছে।',
            'কেন্দ্রের পক্ষ থেকে দেওয়া লগইন দিয়ে ব্যক্তিগত কাজ করা যাবে না।',
          ],
        },
        {
          heading: '৪. যা করা যাবে না',
          paragraphs: [
            'অভিভাবকের ফোন নম্বর কেবল এই কেন্দ্রের নিজের যোগাযোগের জন্য — অন্য কারো '
            + 'বিজ্ঞাপনে, অন্য ব্যবসায় বা বাইরের কাউকে দেওয়ার জন্য নয়। বিস্তারিত '
            + 'নিয়ম "ব্যবহারের সীমা" পাতায়।',
            'আপনার নিজের বা আপনার কেন্দ্রের অনুমতি নেই এমন তথ্য সফটওয়্যারে তোলা যাবে '
            + 'না। সেবা নষ্ট করা, স্বয়ংক্রিয়ভাবে ডেটা তুলে নেওয়া, বা অন্য কারো '
            + 'সুযোগ নেওয়ার চেষ্টা নিষিদ্ধ।',
            'সফটওয়্যারটি কপি করে, ভাড়া দিয়ে বা নিজের নামে বিক্রি করে দেওয়া যাবে না।',
          ],
        },
        {
          heading: '৫. অ্যাকাউন্ট বন্ধ করার কারণ',
          paragraphs: [
            'নিচের কোনো একটি ঘটলে আমরা অ্যাকাউন্ট বন্ধ (অথবা শুধু SMS বন্ধ) করতে পারি: '
            + 'অভিভাবকের নম্বরে বিজ্ঞাপন বা স্প্যাম পাঠানো, অন্যের তথ্য নিজের বলে তোলা, '
            + 'সেবা আক্রমণ করার চেষ্টা, এবং দীর্ঘ সময় ধরে টাকা না দেওয়া।',
            'কোথাও আটকে গেলে আমরা আগে ফোন করি এবং ব্যাখ্যা চাই। সাময়িক সমস্যায় '
            + 'একবারেই অ্যাকাউন্ট বন্ধ করা হয় না।',
          ],
        },
        {
          heading: '৬. এর বাইরে যা আমরা বলি না',
          paragraphs: [
            'সেবাটি যেভাবে আছে সেভাবেই দেওয়া হয়। আমরা প্রতিশ্রুতি দিই না যে এটি কখনো '
            + 'থামবে না বা কখনো ভুল হবে না — তবে আমরা প্রতিশ্রুতি দিই যে বিল বাকি থাকলে '
            + 'আপনার তথ্য মুছবে না বা আটকে রাখবে না।',
            'আপনার কেন্দ্রের তথ্য আপনার কেন্দ্রের। আপনি চাইলে এক্সপোর্ট করে নিতে পারেন, '
            + 'আর চাইলে মুছে ফেলার অনুরোধ করতে পারেন — নিয়ম "অ্যাকাউন্ট মুছে ফেলা ও '
            + 'ডেটা নেওয়া" পাতায়।',
          ],
        },
        {
          heading: '৭. যোগাযোগ',
          paragraphs: [
            `যেকোনো প্রশ্নে ${SUPPORT_PHONE} — ফোন বা হোয়াটসঅ্যাপ।`,
          ],
        },
      ],
    },
    en: {
      title: 'Terms of Service',
      lead: 'Who may use it, whose account is whose, and what gets an account suspended.',
      sections: [
        {
          heading: '1. Who may use it',
          paragraphs: [
            'It is built for running a coaching centre in Bangladesh. An account must be '
            + 'opened by an adult (18 or over) who can speak for the centre.',
            'There is no need for more than one account per centre, and sharing one login '
            + 'between several people makes the account the holder\'s responsibility by '
            + 'definition.',
          ],
        },
        {
          heading: '2. One person, one account',
          paragraphs: [
            'Each account belongs to one person. When a password is shared, nobody can tell '
            + 'who changed what, and the account holder is answerable for whatever was done '
            + 'with it.',
            'A centre may create logins for its teachers and staff, but each of those must be '
            + 'its own account — never the owner\'s password passed around.',
          ],
        },
        {
          heading: '3. A centre-issued login belongs to the centre',
          paragraphs: [
            'A login a centre issues to its staff is the centre\'s responsibility and stays '
            + 'under the centre\'s control. When somebody leaves, the centre may switch that '
            + 'login off, and that decision is the centre\'s.',
            'A login issued by a centre is not for that person\'s private use.',
          ],
        },
        {
          heading: '4. What may not be done',
          paragraphs: [
            'Guardian phone numbers are for this centre\'s own communication with those '
            + 'guardians — not for advertising anything else, not for another business, and '
            + 'not passed to anybody outside. The detail is on the "Acceptable Use" page.',
            'You may not put data into the software that you or your centre have no right to '
            + 'hold, and you may not attack the service, scrape it automatically, or use it to '
            + 'reach another centre\'s information.',
            'The software itself may not be copied, resold or rented out.',
          ],
        },
        {
          heading: '5. Grounds for suspension',
          paragraphs: [
            'We may suspend an account — or only its messaging — for sending spam or '
            + 'advertising to guardian numbers, for holding somebody else\'s information '
            + 'without the right to, for attacking the service, or for a balance left unpaid '
            + 'for a long time.',
            'If something looks wrong we phone first and ask. A temporary problem never ends '
            + 'in a closed account.',
          ],
        },
        {
          heading: '6. What we do not promise',
          paragraphs: [
            'The service is provided as it is. We do not promise it will never fail or never '
            + 'break — but we do promise that an unpaid balance never deletes your records and '
            + 'never locks them away from you.',
            'Your centre\'s data is your centre\'s. You can export it, and you can ask for it '
            + 'to be removed: see "Account Deletion & Data Export".',
          ],
        },
        {
          heading: '7. Contact',
          paragraphs: [`Any question: ${SUPPORT_PHONE}, by call or WhatsApp.`],
        },
      ],
    },
  },

  {
    kind: 'privacy',
    slug: POLICY_SLUGS.privacy,
    version: '2026-09-18',
    bn: {
      title: 'গোপনীয়তা নীতি',
      lead:
        'শিক্ষার্থী আর অভিভাবকের কী তথ্য রাখা হয়, কেন, কে দেখতে পারে, আর কত দিন রাখা হয়।',
      sections: [
        {
          heading: '১. কী তথ্য রাখা হয়',
          paragraphs: [
            'কেন্দ্র ও শাখার নাম ও ঠিকানা; কর্মীদের নাম, ভূমিকা ও লগইন; শিক্ষার্থীর নাম, '
            + 'শ্রেণি বা ব্যাচ, ভর্তির তারিখ, এবং অভিভাবকের নাম ও ফোন নম্বর; হাজিরা; '
            + 'পরীক্ষার নম্বর; ফি ও পেমেন্টের হিসাব; এবং অভিভাবককে পাঠানো SMS-এর লগ '
            + '(নম্বর, সময়, খরচ, পাঠানোর ফলাফল)।',
            'এছাড়া কে কখন কী পরিবর্তন করেছে তার একটি লগ থাকে (audit log) — এটি '
            + 'কেন্দ্রের নিজের নিরাপত্তার জন্য, এবং কেন্দ্রের মালিক এটি দেখতে পারেন।',
          ],
        },
        {
          heading: '২. কেন রাখা হয়',
          paragraphs: [
            'একটাই কারণ: কেন্দ্রের নিজের কাজ চালানো — হাজিরা রাখা, ফলাফল বের করা, ফি '
            + 'হিসাব রাখা, আর অভিভাবককে জানানো। শিক্ষার্থীর বায়োডাটা কেনা-বেচার জন্য বা '
            + 'প্রচারের জন্য নয়।',
          ],
        },
        {
          heading: '৩. আমরা কারো কাছে পাঠাই না',
          paragraphs: [
            'শিক্ষার্থী বা অভিভাবকের কোনো তথ্য আমরা কোনো এআই (AI) সেবা, কোনো বিজ্ঞাপনী '
            + 'সেবা বা কোনো তথ্য-বিক্রেতার কাছে পাঠাই না।',
            'ফোনে ভরসা রেখে কাজ হয়: SMS পাঠানোর সময় শুধু নম্বর, বার্তা ও কেন্দ্রের '
            + 'পরিচয় টেলিকম অ্যাপার্টনারকে যায়। কোনো কেন্দ্রের তথ্য অন্য কেন্দ্র দেখতে '
            + 'পায় না, এবং অন্য কেন্দ্রের ডেটার সাথে আমাদের কোনো লেনদেন নেই।',
          ],
        },
        {
          heading: '৪. কেন্দ্রের ভিতরে কে দেখতে পারে',
          paragraphs: [
            'কেন্দ্রের ভিতরে প্রতিটি ব্যক্তি তার ভূমিকা অনুযায়ী দেখেন — মালিক সব দেখেন, '
            + 'শিক্ষক তার ব্যাচের হাজিরা ও নম্বর দেখেন, হিসাবের দায়িত্ব পেলে ফিও দেখেন। '
            + 'শাখা থাকলে একজন শাখা-প্রধানের চোখ তার শাখাতেই থাকে।',
            'শিক্ষার্থী বা অভিভাবক কেবল নিজের রেকর্ড দেখতে পারেন — পুরো কেন্দ্রের নয়।',
            'আমরা (CoachDesk)-এর দিক থেকে কেবল প্ল্যাটফর্মের হিসাব — কেন্দ্র কত দিন '
            + 'চলেছে, কত শিক্ষার্থী, টাকা কত — দেখা হয়। কাজের ত্রুটি ঠিক করতে কেন্দ্র '
            + 'নিজে অনুরোধ করলে তখন সেই অংশটি দেখা হয়। অন্য কোনো সময়ে এবং অন্য কোনো '
            + 'কারণে কোনো কেন্দ্রের শিক্ষার্থীর তথ্য আমরা খুলে দেখি না।',
          ],
        },
        {
          heading: '৫. কত দিন রাখা হয়',
          paragraphs: [
            'যত দিন কেন্দ্রটি গ্রাহক থাকে, তত দিন তথ্য রাখা হয়। কেন্দ্র চাইলে যেকোনো '
            + 'সময়ে ডেটা এক্সপোর্ট করে নিতে পারে।',
            'কেন্দ্র মুছে ফেলার অনুরোধ করলে, এবং হিসাব রাখার জন্য যা রাখা দরকার সেটুকু '
            + 'বাদ দিয়ে (পেমেন্ট ও রিচার্জের রেকর্ড), আমরা তথ্য মুছে ফেলি — কীভাবে, তা '
            + '"অ্যাকাউন্ট মুছে ফেলা ও ডেটা নেওয়া" পাতায় লেখা আছে।',
          ],
        },
        {
          heading: '৬. নাবালকের তথ্য',
          paragraphs: [
            'শিক্ষার্থীরা অনেক সময় নাবালক। তাদের তথ্য কেন্দ্র তার নিজের হিসাবের খাতার '
            + 'জন্য রাখে, আর সেটির দায়িত্ব কেন্দ্রের। অভিভাবক হিসাবটা জানতে পারেন এবং '
            + 'কেন্দ্রকে বলতে পারেন ভুল হলে সংশোধন করতে বা না রাখতে।',
            'আমরা কোনো শিশুর সাথে সরাসরি কথা বলি না, শিশুর কাছ থেকে কোনো সম্মতি চাই না, '
            + 'আর সম্মতির প্রশ্নটি সবসময় কেন্দ্রের প্রাপ্তবয়স্ক মানুষের কাছে — একটি '
            + 'শিশু চুক্তিতে সম্মতি দিতে পারে না।',
          ],
        },
        {
          heading: '৭. কীভাবে সুরক্ষিত রাখা হয়',
          paragraphs: [
            'পাসওয়ার্ড আমরা নিজেরা সংরক্ষণ করি না — লগইন ব্যবস্থা পাসওয়ার্ড হ্যাশ করে '
            + 'রাখে। তথ্য যাওয়া-আসার সময় (in transit) এবং সংরক্ষিত অবস্থায় (at rest) '
            + 'এনক্রিপ্টেড থাকে।',
            'প্রতিটি কেন্দ্রের তথ্য আলাদা রাখা হয় ডেটাবেসের নিয়মেই (row-level security), '
            + 'আর টাকার প্রতিটি নড়াচড়া একটি খাতায় লেখা থাকে যেখানে ব্রাউজার থেকে কিছু '
            + 'বদলানো যায় না।',
          ],
        },
        {
          heading: '৮. যা আমরা দাবি করি না',
          paragraphs: [
            'আমরা কোনো সার্টিফিকেশন বা আন্তর্জাতিক মানের দাবি করি '
            + 'না, এবং কোনো "কমপ্লায়েন্স" প্রোগ্রামের কথা বলি না — কারণ আমাদের কোনো '
            + 'তৃতীয় পক্ষ পরীক্ষা করেনি। উপরের বাক্যগুলো আমরা যা করি তার বর্ণনা, কোনো '
            + 'সনদের দাবি নয়।',
          ],
        },
        {
          heading: '৯. যোগাযোগ',
          paragraphs: [
            `তথ্য নিয়ে কোনো প্রশ্ন বা অভিযোগ থাকলে ${SUPPORT_PHONE} নম্বরে জানান। এক '
            + 'কর্মদিবসের মধ্যে উত্তর দেওয়া হয়।`,
          ],
        },
      ],
    },
    en: {
      title: 'Privacy Policy',
      lead:
        'What is held about students and guardians, why, who inside a centre can see it, and '
        + 'how long it is kept.',
      sections: [
        {
          heading: '1. What is held',
          paragraphs: [
            'The centre\'s and its branches\' names and addresses; staff names, roles and '
            + 'logins; student names, class or batch, admission date, and the guardian\'s name '
            + 'and phone number; attendance; exam marks; fee and payment records; and a log of '
            + 'the SMS sent to guardians (number, time, cost, and what the network reported).',
            'There is also a record of who changed what, which exists for the centre\'s own '
            + 'safety and can be read by the centre\'s owner.',
          ],
        },
        {
          heading: '2. Why it is held',
          paragraphs: [
            'For one purpose: running the centre\'s own work — taking attendance, producing '
            + 'results, keeping the fee book, and telling guardians. Student records are not '
            + 'bought, sold or used as advertising.',
          ],
        },
        {
          heading: '3. Who we do not send it to',
          paragraphs: [
            'No student or guardian record is sent to any AI provider, any advertising '
            + 'service, or any data broker.',
            'Sending an SMS means the number, the message and the centre\'s identity go to our '
            + 'telecom partner — nothing else does. No centre can see another centre\'s '
            + 'records, and we do not trade in them.',
          ],
        },
        {
          heading: '4. Who inside a centre can see it',
          paragraphs: [
            'Inside a centre each person sees what their role allows: an owner sees '
            + 'everything, a teacher sees their own batch\'s attendance and marks, and somebody '
            + 'given the fees duty sees the fees as well. Where there are branches, a branch '
            + 'manager stays inside their own branch.',
            'A student or guardian can see only their own record, never the centre\'s.',
            'On our side, what we read is the platform\'s own figures — how long a centre has '
            + 'been running, how many students, what the balance is. A centre\'s student '
            + 'records are opened only to fix something that centre has asked us to fix. '
            + 'Otherwise we do not open them at all.',
          ],
        },
        {
          heading: '5. How long it is kept',
          paragraphs: [
            'For as long as the centre is a customer. A centre can export its data at any '
            + 'time.',
            'If a centre asks for its data to be removed, we remove it, keeping only what has '
            + 'to be kept to account for money (payment and recharge records). The "Account '
            + 'Deletion & Data Export" page says exactly how.',
          ],
        },
        {
          heading: '6. Children\'s data',
          paragraphs: [
            'Students are often minors. Their records are held by the centre as the centre\'s '
            + 'own book, and are the centre\'s responsibility. A guardian can ask about the '
            + 'record, and can ask the centre to correct it or to stop holding a piece of it.',
            'We never approach a child, never ask a child for anything, and never take consent '
            + 'from a child. The consent question always belongs to the adult at the centre — '
            + 'a child cannot agree to a contract.',
          ],
        },
        {
          heading: '7. How it is protected',
          paragraphs: [
            'We never store passwords ourselves — the login system stores a hash of them. Data '
            + 'is encrypted in transit and at rest.',
            'Each centre\'s data is kept apart by the database itself (row-level security), '
            + 'and every movement of money is written to a ledger that cannot be altered from '
            + 'a browser.',
          ],
        },
        {
          heading: '8. What we do not claim',
          paragraphs: [
            'We claim no certification and no international standard, and we describe no '
            + 'compliance framework — because no third party has audited us for one. The '
            + 'paragraphs above describe what we do, not a licence we hold.',
          ],
        },
        {
          heading: '9. Contact',
          paragraphs: [
            `Call ${SUPPORT_PHONE} with any question or complaint about your data. We answer `
            + 'within one working day.',
          ],
        },
      ],
    },
  },

  {
    kind: 'acceptable_use',
    slug: POLICY_SLUGS.acceptable_use,
    version: '2026-09-18',
    bn: {
      title: 'ব্যবহারের সীমা',
      lead:
        'রোস্টারে থাকা অভিভাবকের নম্বর এই কেন্দ্রের নিজের যোগাযোগের জন্য — অন্য কিছুর জন্য '
        + 'নয়।',
      sections: [
        {
          heading: '১. অভিভাবকের নম্বরের একটাই কাজ',
          paragraphs: [
            'যে নম্বরগুলো কেন্দ্র ভর্তির সময় নিয়েছে, সেগুলো এই কেন্দ্রের সাথে ওই '
            + 'অভিভাবকের যোগাযোগের জন্য। এক ট্যাপে SMS পাঠানোর সুবিধা মানে হাজার নম্বর '
            + 'এক মিনিটে চলে যায় — তাই সীমাটি স্পষ্ট করে লেখা:',
            'অভিভাবকের নম্বরে কোনো বিজ্ঞাপন, অন্য কোনো প্রতিষ্ঠানের প্রচার, রাজনৈতিক '
            + 'কোনো বার্তা, বা কেন্দ্রের শিক্ষার্থী-সংক্রান্ত কাজের বাইরে কোনো কিছু পাঠানো '
            + 'যাবে না।',
            'নম্বরগুলো কোনো তালিকা হিসেবে বাইরে দেওয়া, বেচা বা অন্য প্রতিষ্ঠানের সাথে '
            + 'ভাগ করা যাবে না — অনুমতি নিয়ে হলেও নয়।',
          ],
        },
        {
          heading: '২. SMS খরচ কেন্দ্রের',
          paragraphs: [
            'প্রতিটি SMS কেন্দ্রের নিজের ক্রেডিট থেকে যায়, এবং পাঠানোর আগে খরচটা '
            + 'দেখানো হয়। কেন্দ্রের মালিক কে কী পাঠাতে পারবে তা ঠিক করে দিতে পারেন, এবং '
            + 'সেই সীমার ভিতরেই থাকতে হবে।',
          ],
        },
        {
          heading: '৩. অভিভাবক না চাইলে পাঠানো বন্ধ',
          paragraphs: [
            'কোনো অভিভাবক বললে বা বন্ধ করার অনুরোধ করলে সেই নম্বরে পাঠানো বন্ধ করতে হবে, '
            + 'এবং সফটওয়্যারে সেই অনুরোধটি লিখে রাখতে হবে। ইচ্ছাকৃতভাবে বন্ধ করা নম্বরে '
            + 'আবার পাঠানো সেবার শর্ত ভাঙা।',
          ],
        },
        {
          heading: '৪. অন্যের তথ্য নয়, সেবা নষ্ট নয়',
          paragraphs: [
            'অনুমতি নেই এমন কোনো তথ্য সফটওয়্যারে তোলা যাবে না — অন্যের তৈরি তালিকা, অন্য '
            + 'প্রতিষ্ঠানের শিক্ষার্থীর তথ্য, বা কোনো ভাবে পাওয়া নম্বর।',
            'স্বয়ংক্রিয়ভাবে ডেটা টেনে নেওয়া, সেবা আক্রমণ করা, বোঝা চাপানো বা অন্য '
            + 'কেন্দ্রের তথ্য পাওয়ার চেষ্টা করা যাবে না। সফটওয়্যারটি নিজের নামে চালানো বা '
            + 'বিক্রি করা যাবে না।',
          ],
        },
        {
          heading: '৫. নিয়ম ভাঙলে',
          paragraphs: [
            'শর্ত ভাঙলে আমরা SMS পাঠানোর সুবিধা বন্ধ করতে পারি, আর গুরুতর ক্ষেত্রে '
            + 'অ্যাকাউন্ট সাময়িকভাবে বন্ধ করতে পারি।',
            'বন্ধ করলেও কেন্দ্রের তথ্য মুছে যায় না এবং এক্সপোর্ট করা যায়। আমরা বন্ধ '
            + 'করার আগে ফোন করে ব্যাখ্যা চাই, এবং ভুল বোঝাবুঝি হলে সেটি আগে মেটানো হয়।',
          ],
        },
      ],
    },
    en: {
      title: 'Acceptable Use',
      lead:
        'The guardian numbers in a roster are for this centre\'s own communication — for '
        + 'nothing else.',
      sections: [
        {
          heading: '1. One purpose for a guardian\'s number',
          paragraphs: [
            'The numbers a centre collected at admission are there for that centre to '
            + 'communicate with that guardian. Tap-to-send SMS means a thousand numbers leave '
            + 'in a minute, so the limit is written down plainly:',
            'No advertising, no promotion of another business, no political message and '
            + 'nothing unrelated to that centre\'s own students may be sent to a guardian\'s '
            + 'number.',
            'The numbers may not be given, sold, exported or shared with another business as '
            + 'a list — not even with permission.',
          ],
        },
        {
          heading: '2. The SMS spend is the centre\'s',
          paragraphs: [
            'Every message comes out of that centre\'s own credits, and the cost is shown '
            + 'before it is sent. An owner may set what each person is allowed to send, and '
            + 'that limit holds.',
          ],
        },
        {
          heading: '3. A guardian who says stop',
          paragraphs: [
            'When a guardian asks to stop receiving messages, sending to that number must '
            + 'stop and the request must be recorded in the software. Deliberately messaging a '
            + 'number that opted out breaks these terms.',
          ],
        },
        {
          heading: '4. Not other people\'s data, and not the service itself',
          paragraphs: [
            'You may not put data into the software that you have no right to hold — somebody '
            + 'else\'s list, another institution\'s students, or numbers obtained by any other '
            + 'means.',
            'You may not scrape the service, attack it, overload it, or try to reach another '
            + 'centre\'s data. The software may not be run under another name or resold.',
          ],
        },
        {
          heading: '5. When these terms are broken',
          paragraphs: [
            'We may take the ability to send SMS away, and in a serious case suspend the '
            + 'account for a period.',
            'Even then nothing is deleted and the data can still be exported. We phone first '
            + 'and ask before suspending anything, and a misunderstanding is cleared up before '
            + 'it becomes a suspension.',
          ],
        },
      ],
    },
  },

  {
    kind: 'deletion',
    slug: POLICY_SLUGS.deletion,
    version: '2026-09-18',
    bn: {
      title: 'অ্যাকাউন্ট মুছে ফেলা ও ডেটা নেওয়া',
      lead: 'কেন্দ্র কীভাবে তার তথ্য নিয়ে বেরিয়ে যেতে পারে, আর মুছে ফেলার অনুরোধ কীভাবে হয়।',
      sections: [
        {
          heading: '১. তথ্য কেন্দ্রেরই',
          paragraphs: [
            'কেন্দ্রের হাজিরা, ফলাফল, ফি আর শিক্ষার্থীর তালিকা কেন্দ্রের নিজের — আমাদের '
            + 'নয়। কোনো কারণে আপনি চলে যেতে চাইলে তথ্য আপনার সাথেই যাবে।',
          ],
        },
        {
          heading: '২. এক্সপোর্ট',
          paragraphs: [
            'সেটিংস → এক্সপোর্ট স্ক্রিন থেকে CSV ফাইল নামানো যায়: শিক্ষার্থীর তালিকা, '
            + 'হাজিরা, ফি ও বকেয়া, খরচ, আর SMS-এর হিসাব — মাস অনুযায়ী।',
            'ফ্রি প্ল্যানে সরাসরি এক্সপোর্ট বন্ধ থাকে। সেক্ষেত্রে ফোন করে জানালে আমরা '
            + 'আপনার তথ্য একটি ফাইলে করে পাঠিয়ে দিই।',
          ],
        },
        {
          heading: '৩. মুছে ফেলার অনুরোধ',
          paragraphs: [
            `${SUPPORT_PHONE} নম্বরে ফোন করুন বা হোয়াটসঅ্যাপে লিখুন। আমরা আগে একটি সম্পূর্ণ `
            + 'কপি আপনাকে দিই, তারপর মুছে ফেলি — যাতে কোনো কিছু হারিয়ে যায় না।',
            'কর্মদিবসের হিসেবে সাত দিনের মধ্যে কাজটি শেষ করা হয়। কাজ শেষ হলে লিখিতভাবে '
            + 'জানানো হয়।',
          ],
        },
        {
          heading: '৪. কী থেকে যায়, এবং কেন',
          paragraphs: [
            'টাকা সংক্রান্ত কিছু রেকর্ড থেকে যায় — কত টাকা এসেছে, কত জমা পড়েছে, কে '
            + 'যাচাই করেছে। এটি হিসাব রাখার জন্য দরকার, এবং এই রেকর্ডে কোনো শিক্ষার্থীর '
            + 'তথ্য থাকে না।',
            'বাকি সব — শিক্ষার্থীর নাম, অভিভাবকের নম্বর, হাজিরা, নম্বর, ফি ও SMS-এর লগ '
            + '— মুছে যায়। ব্যাকআপে থাকা কপিও নির্ধারিত সময়ের মধ্যে মুছে যায়।',
          ],
        },
        {
          heading: '৫. কেন্দ্রের একজন কর্মী চলে গেলে',
          paragraphs: [
            'কেন্দ্র নিজেই কর্মীর লগইন বন্ধ করে দিতে পারে — সেটি করার অধিকার কেন্দ্রের। '
            + 'ব্যক্তি চাইলে নিজের ব্যক্তিগত অ্যাকাউন্টটি মুছে ফেলার অনুরোধ করতে পারেন, '
            + 'তবে কেন্দ্রের হিসাবে তিনি যে কাজগুলো করেছিলেন সেগুলো কেন্দ্রের রেকর্ডেই '
            + 'থাকে।',
          ],
        },
      ],
    },
    en: {
      title: 'Account Deletion & Data Export',
      lead: 'How a centre leaves with its data, and how a request to delete one is handled.',
      sections: [
        {
          heading: '1. The data is the centre\'s',
          paragraphs: [
            'The attendance, results, fees and student list belong to the centre, not to us. '
            + 'If you ever decide to leave, the records leave with you.',
          ],
        },
        {
          heading: '2. Export',
          paragraphs: [
            'Settings has an export screen that produces CSV files: students, attendance, '
            + 'fees and arrears, expenses, and the SMS ledger — month by month.',
            'The free plan does not include export. Call us instead and we will send your data '
            + 'in a file.',
          ],
        },
        {
          heading: '3. Asking for deletion',
          paragraphs: [
            `Call or message ${SUPPORT_PHONE} on WhatsApp. We send you a complete copy first, `
            + 'and only then remove anything — so that nothing is lost in the process.',
            'It is completed within seven working days, and confirmed to you in writing.',
          ],
        },
        {
          heading: '4. What stays, and why',
          paragraphs: [
            'Some money records stay: what came in, what was credited, and who verified it. '
            + 'They are needed to account for the payments, and they hold no student data at '
            + 'all.',
            'Everything else goes — student names, guardian numbers, attendance, marks, fees '
            + 'and the SMS log. Backups holding the same data are cleared within their own '
            + 'stated period.',
          ],
        },
        {
          heading: '5. When a member of staff leaves',
          paragraphs: [
            'The centre can switch that person\'s login off itself; that decision is the '
            + 'centre\'s. The person may ask for their own profile to be removed, but the work '
            + 'they did stays in the centre\'s records, because it is the centre\'s record of '
            + 'its own students.',
          ],
        },
      ],
    },
  },

  {
    kind: 'security',
    slug: POLICY_SLUGS.security,
    version: '2026-09-18',
    bn: {
      title: 'নিরাপত্তা ও যোগাযোগ',
      lead: 'কীভাবে সুরক্ষিত রাখা হয়, আর কিছু সন্দেহ হলে কাকে জানাবেন।',
      sections: [
        {
          heading: '১. কিছু মনে হলে জানান',
          paragraphs: [
            `দুর্বলতা বা সন্দেহজনক কিছু পেলে ${SUPPORT_PHONE} নম্বরে ফোন বা হোয়াটসঅ্যাপ `
            + 'করুন। একটি কর্মদিবসের মধ্যে আমরা উত্তর দিই।',
            'যা জানালে দ্রুত কাজ হয়: কী ঘটেছে, কোন স্ক্রিনে, কীভাবে আবার ঘটানো যায়, আর '
            + 'আপনার কেন্দ্রের নাম। কখনোই আপনার পাসওয়ার্ড পাঠাবেন না।',
          ],
        },
        {
          heading: '২. আমরা যা চাই না',
          paragraphs: [
            'CoachDesk থেকে কেউ কখনো আপনার অ্যাকাউন্টের পাসওয়ার্ড, bKash বা Nagad-এর পিন '
            + 'বা ফোনে আসা কোড চাইবে না। কেউ চাইলে সেটি প্রতারণা, এবং সাথে সাথে আমাদের '
            + 'জানানো উচিত।',
            'টাকা কেবল রিচার্জ স্ক্রিনে দেখানো নম্বরেই পাঠাবেন। অন্য কোনো নম্বর আমাদের নয়।',
          ],
        },
        {
          heading: '৩. কারিগরি দিক থেকে যা করা আছে',
          paragraphs: [
            'লগইন ব্যবস্থা পাসওয়ার্ড হ্যাশ করে রাখে — আমরা পাসওয়ার্ড নিজে দেখি না বা '
            + 'রাখি না। তথ্য যাওয়া-আসার সময় এবং সংরক্ষিত অবস্থায় এনক্রিপ্টেড থাকে।',
            'প্রতিটি কেন্দ্রের তথ্য ডেটাবেসের নিয়মেই আলাদা (row-level security), তাই '
            + 'অ্যাপে কোনো ভুল থাকলেও অন্য কেন্দ্রের সারি অন্য কেন্দ্রে যায় না।',
            'টাকার প্রতিটি নড়াচড়া একটি খাতায় (ledger) লেখা থাকে, এবং ব্রাউজার থেকে '
            + 'সেই খাতা বদলানো সম্ভব নয় — কেবল পড়া যায়। কে কী পরিবর্তন করেছে তার লগও '
            + 'থাকে।',
          ],
        },
        {
          heading: '৪. যা আমরা দাবি করি না',
          paragraphs: [
            'আমরা কোনো সার্টিফিকেশন, কোনো আন্তর্জাতিক মান বা কোনো কমপ্লায়েন্স প্রোগ্রামের '
            + 'দাবি করি না — কারণ আমাদের কোনো তৃতীয় পক্ষ পরীক্ষা করেনি। আমরা যা লিখেছি তা '
            + 'হলো আমাদের করা কাজের বর্ণনা।',
          ],
        },
        {
          heading: '৫. কেন্দ্রের নিজের হাতে যা আছে',
          paragraphs: [
            'প্রতিটি মানুষের জন্য আলাদা লগইন খুলুন, একই পাসওয়ার্ড কাউকে দেবেন না, চাকরি '
            + 'ছেড়ে যাওয়া কর্মীর লগইন সেটিংস থেকে বন্ধ করে দিন, আর মালিকের ইমেইলে যেন '
            + 'কোড আসে সেটি নিশ্চিত করুন।',
            'অভিভাবক বা শিক্ষার্থীর সাথে ফোন নম্বর বা পাসওয়ার্ড ভাগ করা আমাদের '
            + 'নিয়ন্ত্রণের বাইরে — সেখানে সতর্ক থাকাটাই নিরাপত্তা।',
          ],
        },
      ],
    },
    en: {
      title: 'Security & Contact',
      lead: 'How it is protected, and who to tell if something looks wrong.',
      sections: [
        {
          heading: '1. Tell us if something looks wrong',
          paragraphs: [
            `Call or message ${SUPPORT_PHONE} on WhatsApp about a vulnerability or anything `
            + 'that looks suspicious. We answer within one working day.',
            'What helps us most: what happened, which screen, how to make it happen again, and '
            + 'your centre\'s name. Never send your password.',
          ],
        },
        {
          heading: '2. What we will never ask for',
          paragraphs: [
            'Nobody from CoachDesk will ever ask for your account password, your bKash or '
            + 'Nagad PIN, or a code sent to your phone. Anybody who does is impersonating us, '
            + 'and we want to know immediately.',
            'Send money only to the number shown on the recharge screen. No other number is '
            + 'ours.',
          ],
        },
        {
          heading: '3. What is in place',
          paragraphs: [
            'The login system stores hashes of passwords — we never see or keep a password '
            + 'itself. Data is encrypted in transit and at rest.',
            'Each centre\'s rows are kept apart by rules inside the database itself '
            + '(row-level security), so even a mistake in the application cannot hand one '
            + 'centre another centre\'s row.',
            'Every movement of money is written to a ledger, and that ledger cannot be altered '
            + 'from a browser — it can only be read. A record of who changed what is kept '
            + 'alongside it.',
          ],
        },
        {
          heading: '4. What we do not claim',
          paragraphs: [
            'We claim no certification, no international standard and no compliance framework, '
            + 'because no third party has audited us for one. What is written here describes '
            + 'work we have done.',
          ],
        },
        {
          heading: '5. What is in your own hands',
          paragraphs: [
            'Give each person their own login, share no password, switch off the login of '
            + 'anybody who has left from Settings, and make sure the owner\'s email is one '
            + 'they actually read.',
            'What a centre does with a password or a phone number outside the software is '
            + 'beyond our control; care there is the security.',
          ],
        },
      ],
    },
  },
]

/** One policy by its kind. Throws rather than returning undefined — see `policyBySlug`. */
export function policyFor(kind: PolicyKind): PolicyDoc {
  const doc = POLICIES.find((p) => p.kind === kind)
  // Unreachable while POLICIES lists every kind, which `as const satisfies` above and the
  // test in tests/legal.test.ts both check. A throw rather than a `!`: an undefined reaching
  // a page is a blank legal document, and this is a page whose whole job is to say something.
  if (!doc) throw new Error(`No policy is written for ${kind}`)
  return doc
}

/**
 * One policy by the slug in the URL, or null.
 *
 * Null is the answer a route needs, because a slug nobody wrote is a 404 and not a crash —
 * `/legal/anything-at-all` is a URL a scanner will try within the hour. Returning null lets
 * the page call `notFound()` and say so.
 */
export function policyBySlug(slug: string): PolicyDoc | null {
  return POLICIES.find((p) => p.slug === slug) ?? null
}

/** The words for one reader. Total: two languages, two copies, no third case. */
export function copyFor(doc: PolicyDoc, locale: Locale): PolicyCopy {
  return locale === 'en' ? doc.en : doc.bn
}

/**
 * The version being asked for today, per kind — what `policy_acceptances` stores and what the
 * re-ask rule compares against.
 *
 * Built from POLICIES rather than written out separately, because a second list of versions
 * is exactly the copy that goes stale: somebody changes the words on one page, bumps the
 * version here, and the acceptance row records a version of a document nobody was shown.
 */
export function currentVersions(): Record<PolicyKind, string> {
  return Object.fromEntries(POLICIES.map((p) => [p.kind, p.version])) as Record<
    PolicyKind,
    string
  >
}
