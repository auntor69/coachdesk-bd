/**
 * The words on the recharge card and the founder's queue — MASTERPLAN §11.9's screen.
 *
 * WHY THIS IS A MODULE AND NOT FOUR THOUSAND LINES INTO `en.ts`. The two dictionaries are
 * 266 KB and 546 KB, and the tooling that edits this repository can write the first
 * hundred kilobytes of a file and no further — measured, not guessed: a one-line patch at
 * `settings.plan` in `en.ts` (line 3,657) is silently dropped while the same patch near the
 * top lands. The alternative to a small module was a partially rewritten dictionary, which
 * is the one file in this project where a half-applied edit takes every screen down at
 * once rather than one.
 *
 * It is a fragment and it stays one: the natural home for these keys is
 * `dict(locale).settings.plan.recharge`, with the founder's half under
 * `dict(locale).founder`, and moving them there is a mechanical edit with no logic in it.
 * Until then both screens import `rechargeWords(locale)` and get the same shape the
 * dictionary would have given them — typed, exhaustive over the two locales, and with no
 * sentence composed anywhere else.
 *
 * Composed with `+` rather than template literals, deliberately: this file is written
 * through the same tooling that could not patch the dictionaries, and a plain concatenation
 * survives being moved into either of them by hand later.
 */

import type { Locale } from './locale'

/** What a rejection may say, in the order §11.9 lists them. */
export type RejectReason = 'not_received' | 'wrong_amount' | 'duplicate' | 'other'

/**
 * The same four as a list: what the founder's `<select>` offers, and what the action checks
 * a posted reason against.
 *
 * `satisfies` catches a misspelt entry, not a missing one — the same limit `SLOT_ORDER` in
 * lib/bd/schedule.tsx names. What catches a *missing* one is `reason` below: it is a
 * `Record<RejectReason, string>`, so a new reason fails to compile there first and the
 * misspelt-list error is the second thing the author sees rather than the only thing.
 *
 * In this module rather than in the founder's component because both sides need it: a
 * value exported from a `'use client'` file arrives at a Server Action as a client
 * reference, not as a list. See the note at the top on why these words live here at all.
 */
export const REJECT_REASONS = [
  'not_received',
  'wrong_amount',
  'duplicate',
  'other',
] as const satisfies readonly RejectReason[]

export type RechargeWords = {
  title: string
  body: string
  factBalance: string
  factDaily: string
  factDays: string
  factDaysUnknown: string

  sizedBy: (students: string, teachers: string) => string
  offerTitle: string
  offerMonths: (months: number) => string
  offerCredit: (credit: string) => string
  offerBonus: (bonus: string, bps: number) => string
  offerNoBonus: string
  typedLabel: string
  typedHint: string
  nextTier: (taka: string, bps: number) => string
  daysAtSize: (days: string) => string

  sendTitle: string
  sendBody: (phone: string) => string
  reference: (code: string) => string
  trxLabel: string
  trxHint: string
  senderLabel: string
  senderHint: string
  confirm: string
  confirming: string
  nonRefundable: string

  /**
   * The consent line above the button: "I have read [terms] and [refunds] and accept".
   *
   * IN THREE PIECES BECAUSE THE LINKS GO IN THE MIDDLE. Two documents are linked by name
   * into one sentence, and the names are the pages' own titles (copied out of
   * src/lib/legal/policies.ts by the panel), so the form cannot hold this as one finished
   * string without holding either the titles or the markup. `agreeLead`, the two links
   * joined by `agreeJoin`, then `agreeTail` (MASTERPLAN §11.6, §14.1).
   */
  agreeLead: string
  agreeJoin: string
  agreeTail: string
  /** Shown when a version of either document has changed since this centre last agreed. */
  agreeChanged: string
  /** What the action answers when the box was not ticked. */
  agreeRequired: string

  waitingTitle: string
  noneSent: string
  stateSubmitted: string
  stateApproved: string
  stateRejected: string
  stateExpired: string
  reason: Record<RejectReason, string>
  creditedLine: (arrived: string, bonus: string) => string

  filed: (reference: string) => string
  capReached: string
  badAmount: string
  tooSmall: (taka: string) => string
  tooLarge: (taka: string) => string
  badTrx: string
  badPhone: string
  failed: string
  unreadable: string
  ownerOnly: string

  /** The founder's half: the queue, and the two decisions on it. */
  queueTitle: string
  queueBody: string
  queueEmpty: string
  queueUnreadable: string
  queueCentre: (name: string, size: string) => string
  queueSent: (amount: string, when: string) => string
  queueTrx: (trx: string, sender: string) => string
  queueQuoted: (quoted: string, bonus: string) => string
  arrivedLabel: string
  arrivedHint: string
  approve: string
  approving: string
  reject: string
  reasonLabel: string
  noteLabel: string
  queueFailed: string
}

const EN: RechargeWords = {
  title: 'Recharge',
  body:
    'Your balance pays for itself a day at a time. Add money and the days come off it — '
    + 'no invoice, no due date.',
  factBalance: 'In your balance',
  factDaily: 'A day costs you',
  factDays: 'Days left',
  factDaysUnknown: 'Unknown',

  sizedBy: (students, teachers) =>
    students + ' students and ' + teachers + ' teachers',
  offerTitle: 'Suggested',
  offerMonths: (months) => (months === 1 ? '1 month' : months + ' months'),
  offerCredit: (credit) => credit + ' of credit',
  offerBonus: (bonus, bps) => bonus + ' bonus (' + bps / 100 + '%)',
  offerNoBonus: 'No bonus at this amount',
  typedLabel: 'Or type an amount in taka',
  typedHint: 'Digits only.',
  nextTier: (taka, bps) =>
    'Add ' + taka + ' more and the bonus becomes ' + bps / 100 + '%.',
  daysAtSize: (days) => 'About ' + days + ' days at your current size.',

  sendTitle: 'Send the money',
  sendBody: (phone) =>
    'Send exactly the amount above to ' + phone + ' using Send Money in bKash or Nagad.',
  reference: (code) => 'If there is a reference field, put ' + code + '.',
  trxLabel: 'Transaction ID',
  trxHint: 'The TrxID in your bKash message.',
  senderLabel: 'The number you sent from',
  senderHint: '01XXXXXXXXX — we check it against the account.',
  confirm: 'I have sent it',
  confirming: 'Sending…',
  nonRefundable:
    'Money added to a balance is not refundable — it pays for the days ahead.',

  agreeLead: 'I have read',
  agreeJoin: 'and',
  agreeTail: 'and accept them.',
  agreeChanged:
    'We have changed these terms since you last agreed, so please read them again.',
  agreeRequired: 'Please read and accept the two documents above the button.',

  waitingTitle: 'Recharges you have sent',
  noneSent: 'Nothing sent yet.',
  stateSubmitted: 'Waiting to be checked',
  stateApproved: 'Credited',
  stateRejected: 'Not credited',
  stateExpired: 'Closed',
  reason: {
    not_received: 'We could not find that transfer.',
    wrong_amount: 'The amount did not match.',
    duplicate: 'That transaction ID has already been credited.',
    other: 'Ring us and we will explain.',
  },
  creditedLine: (arrived, bonus) =>
    bonus === '' ? arrived + ' credited.' : arrived + ' and ' + bonus + ' bonus credited.',

  filed: (reference) =>
    'Sent. We will check the transfer by hand — your reference is ' + reference + '.',
  capReached:
    'You already have three recharges waiting. One is credited or closed before another can be sent.',
  badAmount: 'Type the amount in whole taka.',
  tooSmall: (taka) => 'The smallest recharge is ' + taka + '.',
  tooLarge: (taka) => 'The largest recharge is ' + taka + ' — send the rest as a second one.',
  badTrx: 'Enter the transaction ID from your bKash message.',
  badPhone: 'Enter the number you sent from, like 01712345678.',
  failed: 'That could not be saved. Try once more.',
  unreadable: 'Your balance could not be read just now. Reload the page.',
  ownerOnly: 'Only the owner can add money to the balance.',

  queueTitle: 'Recharges to check',
  queueBody:
    'Every claim below is a customer saying they sent money. Open your own bKash and check '
    + 'before you credit anything — the amount that arrived is the amount to enter.',
  queueEmpty: 'Nothing is waiting.',
  queueUnreadable: 'The queue could not be read.',
  queueCentre: (name, size) => name + ' · ' + size,
  queueSent: (amount, when) => amount + ' sent ' + when,
  queueTrx: (trx, sender) => 'TrxID ' + trx + ' from ' + sender,
  queueQuoted: (quoted, bonus) => 'Quoted ' + quoted + ', bonus ' + bonus,
  arrivedLabel: 'What actually arrived',
  arrivedHint: 'Blank credits what they said they sent.',
  approve: 'Credit it',
  approving: 'Crediting…',
  reject: 'Reject',
  reasonLabel: 'Why',
  noteLabel: 'Note',
  queueFailed: 'That could not be recorded.',
}

const BN: RechargeWords = {
  title: 'রিচার্জ',
  body:
    'আপনার ব্যালেন্স থেকেই দিনের খরচ কাটা হয়। টাকা যোগ করলে দিন চলবে — কোনো বিল নেই, '
    + 'কোনো নির্দিষ্ট তারিখ নেই।',
  factBalance: 'ব্যালেন্সে আছে',
  factDaily: 'দিনপ্রতি খরচ',
  factDays: 'দিন বাকি',
  factDaysUnknown: 'জানা নেই',

  // The count, not a sentence: the rate is what moved and this is what moved it.
  sizedBy: (students, teachers) => students + ' শিক্ষার্থী, ' + teachers + ' শিক্ষক',
  offerTitle: 'প্রস্তাবিত',
  offerMonths: (months) => months + ' মাস',
  offerCredit: (credit) => credit + ' ব্যালেন্স',
  offerBonus: (bonus, bps) => bonus + ' বোনাস (' + bps / 100 + '%)',
  offerNoBonus: 'এই অঙ্কে বোনাস নেই',
  typedLabel: 'অথবা নিজের ইচ্ছেমতো টাকা লিখুন',
  typedHint: 'শুধু সংখ্যা।',
  nextTier: (taka, bps) =>
    'আরও ' + taka + ' যোগ করলে বোনাস ' + bps / 100 + '% হয়ে যাবে।',
  daysAtSize: (days) => 'এখনকার আকারে প্রায় ' + days + ' দিন।',

  sendTitle: 'টাকা পাঠান',
  sendBody: (phone) =>
    'উপরের অঙ্কটি ঠিক ততটাই ' + phone + ' নম্বরে বিকাশ বা নগদের “সেন্ড মানি” দিয়ে পাঠান।',
  reference: (code) => 'রেফারেন্স লেখার জায়গা থাকলে ' + code + ' লিখুন।',
  trxLabel: 'ট্রানজেকশন আইডি',
  trxHint: 'বিকাশের মেসেজে যে TrxID আছে।',
  senderLabel: 'যে নম্বর থেকে পাঠিয়েছেন',
  senderHint: '০১XXXXXXXXX — আমরা অ্যাকাউন্টের সাথে মিলিয়ে দেখি।',
  confirm: 'পাঠিয়েছি',
  confirming: 'পাঠানো হচ্ছে…',
  nonRefundable:
    'ব্যালেন্সে জমা টাকা ফেরতযোগ্য নয় — এটি সামনের দিনগুলোর খরচ।',

  agreeLead: 'আমি পড়েছি',
  agreeJoin: 'ও',
  agreeTail: 'এবং সম্মতি দিচ্ছি।',
  agreeChanged:
    'আপনি সর্বশেষ সম্মতি দেওয়ার পর আমরা এই শর্তগুলো বদলেছি — আবার পড়ে নিন।',
  agreeRequired: 'বোতামের উপরে লেখা দুটি শর্ত পড়ে সম্মতি দিন।',

  waitingTitle: 'আপনার পাঠানো রিচার্জ',
  noneSent: 'এখনও কিছু পাঠানো হয়নি।',
  stateSubmitted: 'যাচাইয়ের অপেক্ষায়',
  stateApproved: 'জমা হয়েছে',
  stateRejected: 'জমা হয়নি',
  stateExpired: 'বন্ধ',
  reason: {
    not_received: 'এই ট্রান্সফারটি খুঁজে পাওয়া যায়নি।',
    wrong_amount: 'অঙ্কটি মেলেনি।',
    duplicate: 'এই ট্রানজেকশন আইডি আগেই জমা হয়েছে।',
    other: 'ফোন করুন, আমরা বুঝিয়ে বলব।',
  },
  creditedLine: (arrived, bonus) =>
    bonus === '' ? arrived + ' জমা হয়েছে।' : arrived + ' ও ' + bonus + ' বোনাস জমা হয়েছে।',

  filed: (reference) =>
    'পাঠানো হয়েছে। আমরা হাতে মিলিয়ে দেখব — আপনার রেফারেন্স ' + reference + '।',
  capReached:
    'আপনার তিনটি রিচার্জই যাচাইয়ের অপেক্ষায় আছে। একটি জমা বা বন্ধ হলে তবে আরেকটি পাঠাতে পারবেন।',
  badAmount: 'পুরো টাকায় অঙ্কটি লিখুন।',
  tooSmall: (taka) => 'সবচেয়ে কম রিচার্জ ' + taka + '।',
  tooLarge: (taka) => 'সবচেয়ে বেশি রিচার্জ ' + taka + ' — বাকিটা আলাদা করে পাঠান।',
  badTrx: 'বিকাশের মেসেজ থেকে ট্রানজেকশন আইডি লিখুন।',
  badPhone: 'যে নম্বর থেকে পাঠিয়েছেন সেটি লিখুন, যেমন 01712345678।',
  failed: 'সংরক্ষণ করা যায়নি। আরেকবার চেষ্টা করুন।',
  unreadable: 'এখন ব্যালেন্স পড়া গেল না। পাতা একবার রিলোড করুন।',
  ownerOnly: 'ব্যালেন্সে টাকা কেবল মালিক যোগ করতে পারেন।',

  queueTitle: 'যাচাইয়ের অপেক্ষায় রিচার্জ',
  queueBody:
    'নিচের প্রতিটি দাবি মানে একজন গ্রাহক বলছেন টাকা পাঠিয়েছেন। নিজের বিকাশ খুলে মিলিয়ে '
    + 'দেখে তবেই জমা দিন — যা এসেছে সেটাই লিখুন।',
  queueEmpty: 'কিছু অপেক্ষায় নেই।',
  queueUnreadable: 'তালিকাটি পড়া গেল না।',
  queueCentre: (name, size) => name + ' · ' + size,
  queueSent: (amount, when) => amount + ' পাঠানো হয়েছে ' + when,
  queueTrx: (trx, sender) => 'TrxID ' + trx + ', পাঠিয়েছেন ' + sender,
  queueQuoted: (quoted, bonus) => 'দাম ধরা হয়েছিল ' + quoted + ', বোনাস ' + bonus,
  arrivedLabel: 'আসলে কত এসেছে',
  arrivedHint: 'খালি রাখলে তিনি যা বলেছেন সেটাই ধরা হবে।',
  approve: 'জমা দিন',
  approving: 'জমা হচ্ছে…',
  reject: 'বাতিল',
  reasonLabel: 'কারণ',
  noteLabel: 'নোট',
  queueFailed: 'এটি লেখা গেল না।',
}

/**
 * The words for one locale, by the same shape in both. Total over `Locale`, so a third
 * language is a compile error here rather than an English card on a Bangla screen.
 */
export function rechargeWords(locale: Locale): RechargeWords {
  return locale === 'bn' ? BN : EN
}
