/**
 * The words on `/settings/billing` — MASTERPLAN §20.4's five questions, build-order step 27.
 *
 * WHY THIS IS A MODULE AND NOT KEYS IN THE DICTIONARIES. `en.ts` and `bn.ts` are 266 KB and
 * 547 KB, and the tooling that edits this repository can write the first hundred kilobytes
 * of a file and no further — the same measured limit `./recharge.ts` and `./levers.ts`
 * record in full. The alternative to a small fragment was a partially rewritten dictionary,
 * which is the one file here where a half-applied edit takes every screen down at once.
 *
 * FIVE QUESTIONS, IN §20.4'S ORDER, and the order is the screen's whole design: how long
 * have I got, how much is left, why is it that much, how do I add more, what has happened
 * to my money. The keys are grouped in that order and not alphabetically, so the next
 * person extending this reads the screen as they read the file.
 *
 * THE MONEY AND THE COUNTS ARRIVE AS FINISHED STRINGS. `formatTaka` keeps taka in ASCII
 * digits in both languages (§money: a figure read and re-typed into bKash must not change
 * numeral system on the way), and the day counts are Bangla numerals in Bangla — both are
 * decided in the page, from the one formatter, and handed here already rendered. That is
 * also what would let a client component hold these if the screen ever grows one, since
 * every helper below is a plain string function.
 *
 * Composed with `+` rather than template literals, deliberately, for the reason the two
 * fragments beside it give: a plain concatenation survives being moved into either
 * dictionary by hand later.
 */

import type { Locale } from './locale.ts'

export type BillingWords = {
  title: string
  subtitle: string
  /** The settings hub's row for this screen. */
  hubLabel: string
  hubHint: string

  /* Question 1 — how long have I got. */
  leftTitle: string
  leftDays: (days: string) => string
  leftCovers: (date: string) => string
  leftToday: string
  /** The free tier has no balance to run down — there is nothing to count. */
  leftFree: string
  leftNoRate: string

  /* Question 2 — how much is left. */
  moneyTitle: string
  balanceLabel: string
  dailyLabel: string
  monthlyLabel: string
  noRate: string

  /* Question 3 — why is it that much. */
  whyTitle: string
  whyStudents: string
  whyTeachers: string
  whyBranches: string
  whyTier: (tier: string) => string
  whyNote: string
  bandsTitle: string

  /* Question 4 — how do I add more. */
  addTitle: string
  addBody: string

  /* Question 5 — what has happened to my money. */
  historyTitle: string
  historyBody: string
  historyOwnerOnly: string
  historyUnreadable: string
  historyEmpty: string
  totalsIn: string
  totalsBonus: string
  totalsCharged: string
  totalsGranted: string
  monthLine: (month: string, days: string, cost: string) => string
  dayLine: (count: string, cost: string) => string
  countLine: (students: string, teachers: string, branches: string) => string
  countUnknown: string
  topUpNote: string

  kindRecharge: string
  kindBonus: string
  kindAdjust: string
  kindGrant: string
  kindRefund: string
  kindReversal: string
  kindCorrection: string
  kindFailure: string
  kindRetry: string

  grantLine: (days: string) => string
  reasonLabel: string
  receiptLink: string
  receivedOn: (date: string) => string
}

const EN: BillingWords = {
  title: 'Billing',
  subtitle: 'Your balance, what a day costs, and every day it has paid for.',
  hubLabel: 'Billing',
  hubHint: 'Your balance and what a day costs',

  leftTitle: 'How long have you got',
  leftDays: (days) => days + ' days left',
  leftCovers: (date) => 'This covers you to ' + date + '.',
  leftToday: 'Your balance covers today and no more.',
  leftFree: 'Your plan is free. There is no balance to run down and nothing to top up.',
  leftNoRate: 'Your balance is read, but not what a day costs it — reload the page.',

  moneyTitle: 'How much is left',
  balanceLabel: 'In your balance',
  dailyLabel: 'A day costs',
  monthlyLabel: 'A month at this size',
  noRate: 'Not read',

  whyTitle: 'Why is it that much',
  whyStudents: 'Students',
  whyTeachers: 'Teachers',
  whyBranches: 'Branches',
  whyTier: (tier) => 'Plan: ' + tier,
  whyNote:
    'The day is a month at this size divided by thirty, floored in your favour. The '
    + 'counts above are the ones the day was priced from.',
  bandsTitle: 'How the monthly figure is worked out',

  addTitle: 'How do I add more',
  addBody:
    'Send money and the days come off it. No invoice and no due date — a recharge is '
    + 'credit you spend a day at a time.',

  historyTitle: 'What has happened to my money',
  historyBody:
    'Every recharge, and every day the balance has paid for, with the count it was '
    + 'charged at. Days are grouped by month; open one to see the days inside it.',
  historyOwnerOnly: 'Only the owner can read the balance history.',
  historyUnreadable: 'The history could not be read just now. Reload the page.',
  historyEmpty: 'Nothing has moved yet. A recharge is the first line that will appear here.',
  totalsIn: 'Money in',
  totalsBonus: 'Bonus',
  totalsCharged: 'Days paid for',
  totalsGranted: 'Days granted',
  monthLine: (month, days, cost) => month + ': ' + days + ' days, ' + cost,
  dayLine: (count, cost) => count + ' · ' + cost,
  countLine: (students, teachers, branches) =>
    students + ' students · ' + teachers + ' teachers · ' + branches + ' branches',
  countUnknown: 'The count was not recorded for this day',
  topUpNote: 'topped up as the roster grew',

  kindRecharge: 'Recharge',
  kindBonus: 'Recharge bonus',
  kindAdjust: 'Balance adjustment',
  kindGrant: 'Days granted',
  kindRefund: 'Refund',
  kindReversal: 'Reversal',
  kindCorrection: 'Correction',
  kindFailure: 'Day not charged',
  kindRetry: 'Settlement retry',

  grantLine: (days) => days + ' days',
  reasonLabel: 'Reason',
  receiptLink: 'Receipt',
  receivedOn: (date) => 'received ' + date,
}

const BN: BillingWords = {
  title: 'বিলিং',
  subtitle: 'আপনার ব্যালেন্স, দিনপ্রতি খরচ, আর কোন কোন দিনের টাকা গেল।',
  hubLabel: 'বিলিং',
  hubHint: 'ব্যালেন্স আর দিনপ্রতি খরচ',

  leftTitle: 'আর কত দিন',
  leftDays: (days) => days + ' দিন বাকি',
  leftCovers: (date) => 'এতে ' + date + ' পর্যন্ত চলবে।',
  leftToday: 'ব্যালেন্সে আর মাত্র আজকের দিন আছে।',
  leftFree: 'আপনার প্ল্যান বিনামূলের। খরচ হবে এমন কোনো ব্যালেন্স নেই, যোগ করারও কিছু নেই।',
  leftNoRate: 'ব্যালেন্স পড়া গেছে, কিন্তু দিনপ্রতি খরচ নয় — পাতা একবার রিলোড করুন।',

  moneyTitle: 'কত টাকা আছে',
  balanceLabel: 'ব্যালেন্সে আছে',
  dailyLabel: 'দিনপ্রতি খরচ',
  monthlyLabel: 'এখনকার আকারে মাসে',
  noRate: 'পড়া যায়নি',

  whyTitle: 'খরচটা কেন এত',
  whyStudents: 'শিক্ষার্থী',
  whyTeachers: 'শিক্ষক',
  whyBranches: 'শাখা',
  whyTier: (tier) => 'প্ল্যান: ' + tier,
  whyNote:
    'এখনকার আকারে মাসের খরচকে ত্রিশ দিয়ে ভাগ করা হয়, আর ভাগশেষ আপনার পক্ষে ফেলা হয়। '
    + 'উপরের সংখ্যাগুলোই সেই হিসাবের ভিত্তি।',
  bandsTitle: 'মাসের অঙ্কটি কীভাবে হলো',

  addTitle: 'আরও কীভাবে যোগ করব',
  addBody:
    'টাকা পাঠালে সেটা থেকেই দিন কাটতে থাকবে। কোনো বিল নেই, কোনো নির্দিষ্ট তারিখ নেই — '
    + 'রিচার্জ মানে এমন ব্যালেন্স যা দিনে দিনে খরচ হয়।',

  historyTitle: 'আপনার টাকার হিসাব',
  historyBody:
    'প্রতিটি রিচার্জ, আর ব্যালেন্স থেকে খরচ হওয়া প্রতিটি দিন — যে সংখ্যায় সে দিনের '
    + 'খরচ হলো তা সহ। দিনগুলো মাস অনুযায়ী সাজানো; ভেতরের দিন দেখতে একটি খুলুন।',
  historyOwnerOnly: 'ব্যালেন্সের হিসাব কেবল মালিক দেখতে পারেন।',
  historyUnreadable: 'এখন হিসাবটি পড়া গেল না। পাতা একবার রিলোড করুন।',
  historyEmpty: 'এখনও কিছু লেখা নেই। প্রথম রিচার্জই এখানে প্রথম লাইন হবে।',
  totalsIn: 'জমা হয়েছে',
  totalsBonus: 'বোনাস',
  totalsCharged: 'দিনের খরচ',
  totalsGranted: 'বোনাস দিন',
  monthLine: (month, days, cost) => month + ': ' + days + ' দিন, ' + cost,
  dayLine: (count, cost) => count + ' · ' + cost,
  countLine: (students, teachers, branches) =>
    students + ' শিক্ষার্থী · ' + teachers + ' শিক্ষক · ' + branches + ' শাখা',
  countUnknown: 'সে দিনের সংখ্যা লেখা হয়নি',
  topUpNote: 'শিক্ষার্থী বাড়ায় পরে যোগ হয়েছে',

  kindRecharge: 'রিচার্জ',
  kindBonus: 'রিচার্জ বোনাস',
  kindAdjust: 'ব্যালেন্স সমন্বয়',
  kindGrant: 'দিন দেওয়া হয়েছে',
  kindRefund: 'ফেরত',
  kindReversal: 'বাতিল',
  kindCorrection: 'সংশোধন',
  kindFailure: 'দিনের টাকা কাটা হয়নি',
  kindRetry: 'আবার চেষ্টা',

  grantLine: (days) => days + ' দিন',
  reasonLabel: 'কারণ',
  receiptLink: 'রসিদ',
  receivedOn: (date) => 'পাওয়া গেছে ' + date,
}

/** The words for one locale, by the same shape in both. Total over `Locale`. */
export function billingWords(locale: Locale): BillingWords {
  return locale === 'bn' ? BN : EN
}
