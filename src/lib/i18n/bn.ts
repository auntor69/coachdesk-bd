/**
 * Every string a signed-in reader sees, in Bangla. The source of truth.
 *
 * Bangla and not English, because Bangla is what the product was written in and
 * what the centre owner reads. Translating out of the original is a smaller lie
 * than translating into it: an English key list would have been written by
 * someone thinking in English about a Dhaka coaching centre, and "guardian",
 * "batch" and "fee" would have quietly drifted from অভিভাবক, ব্যাচ and ফি.
 *
 * `en.ts` is typed as this object's shape, so a key added here without an
 * English counterpart fails `tsc` rather than rendering a blank on a teacher's
 * screen. That is the entire mechanism — there is no runtime fallback to Bangla,
 * because a fallback turns a missing translation into something only a user
 * notices.
 *
 * Grouped by screen, with a `common` group for the words that genuinely repeat.
 * A string used twice is not automatically shared: "সেভ করুন" on a form and on a
 * settings page are the same word and belong in `common`, but a heading that
 * happens to collide with another screen's heading is a coincidence and moving it
 * into `common` makes both screens harder to change.
 *
 * Every entry below was lifted out of a screen, not composed here. That is not
 * pedantry: the first draft of this file said 'সংরক্ষণ করুন' for "save", which is
 * correct Bangla and appears nowhere in the product, because a Dhaka centre says
 * 'সেভ করুন'. A dictionary written from the English key list would have quietly
 * changed the register of the whole app.
 *
 * Functions, not templates with placeholders, wherever the server can resolve the
 * sentence. `n => \`${n} জন\`` is checked by the compiler at both ends: the shape
 * of the argument is part of the type, so an English translation that forgets the
 * count cannot compile. A `{n}` template gets none of that.
 *
 * The exception is a sentence only the browser can write — a counter that ticks as
 * an owner works down a list, a tick that appears when a message is handed to the
 * phone. A function cannot cross into a client component at all (see `T` in
 * ./index.ts), so those few are `{n}` templates and are filled by ./fill.ts. They
 * are marked as such where they appear.
 */
export const bn = {
  common: {
    save: 'সেভ করুন',
    saving: 'সেভ হচ্ছে…',
    add: 'যোগ করুন',
    adding: 'যোগ হচ্ছে…',
    creating: 'তৈরি হচ্ছে…',
    cancel: 'বাতিল',
    edit: 'সম্পাদনা',
    view: 'দেখুন',
    seeAll: 'সব দেখুন',
    optional: 'ঐচ্ছিক',
    /** Where a name is missing but a row still has to say something. */
    unknown: 'অজানা',
    /**
     * How far past a deadline something is. Genuinely shared: the fee board's row
     * and the reminder worklist's row show the same overdue invoice and have to
     * agree about it, and they are two different client components, so one of them
     * would otherwise be reading the other's group.
     *
     * A `{n}` template rather than a function because both readers are client
     * components — see ./fill.ts. The number arrives already in the right script:
     * a day count takes Bangla numerals, unlike a count of people.
     *
     * Two strings because English needs two. Bangla would happily say "১ দিন দেরি"
     * and the plural form covers it, but "1 days late" is the first thing an
     * English-medium teacher notices, and a template cannot branch. Which one to
     * use is decided in one place — see `lateLabel` in the fees folder — so the two
     * screens cannot disagree about a day.
     */
    dayLate: 'একদিন দেরি',
    daysLate: '{n} দিন দেরি',
    /**
     * The tail of 26 different error messages. Kept as its own string so the
     * specific half of each message stays with the screen that knows what went
     * wrong, instead of 26 near-identical sentences in this file.
     */
    tryAgain: 'আবার চেষ্টা করুন',
    /** The last resort, when nothing more specific is known. */
    somethingWentWrong: 'কিছু একটা সমস্যা হয়েছে',
  },

  /**
   * The frame every signed-in screen sits in. Nav labels are short because they
   * sit under a glyph in a 48px tab on a 375px phone — four tabs means about
   * nine characters each before they truncate.
   */
  shell: {
    logout: 'লগআউট',
    mainMenu: 'প্রধান মেনু',
    /** Greets a reader whose name and phone are both missing. */
    welcome: 'স্বাগতম',
    nav: {
      home: 'হোম',
      attendance: 'হাজিরা',
      fees: 'ফি',
      settings: 'সেটিংস',
      exams: 'পরীক্ষা',
      mine: 'আমার',
      myChild: 'সন্তান',
    },
  },

  /**
   * The four marks. These are the app's vocabulary, not one screen's: the roster,
   * the rate card, a guardian's history and an SMS all name the same four states,
   * and a centre that calls them different things in two places has two systems.
   */
  attendance: {
    present: 'উপস্থিত',
    absent: 'অনুপস্থিত',
    late: 'দেরি',
    excused: 'ছুটি',
  },

  /**
   * A teacher's home: today's batches, one tap from the register. Kept in one
   * group with the register's own headings because it is one errand — open the
   * app, find the 4pm batch, mark it, come back — and a teacher who reads
   * 'নেওয়া হয়েছে' on the list should read the same word on the way back.
   */
  teach: {
    /** The page title, and the label on the register's back link to it. */
    title: 'আজকের ক্লাস',
    /**
     * A function rather than a template, because this is where the two languages
     * stop lining up: টি is the same for one batch and for nine, and English
     * needs a plural. The count stays ASCII — Bangla numerals are for dates and
     * times, never for something a teacher is counting.
     */
    pending: (n: number) => `আজ ${n}টি ব্যাচের হাজিরা বাকি`,
    allTaken: 'আজকের সব হাজিরা নেওয়া হয়েছে',
    noClassToday: 'আজ কোনো ক্লাস নেই',
    /** The empty state a centre lands on before it has any batches at all. */
    firstBatchTitle: 'শুরু করতে একটি ব্যাচ বানান',
    firstBatchBody:
      'ব্যাচ মানে একটি নির্দিষ্ট সময়ের ক্লাস — যেমন “সকাল ৭টা গণিত”। ব্যাচ বানালে শিক্ষার্থী যোগ করা যাবে।',
    addBatch: 'ব্যাচ যোগ করুন',
    students: (n: number) => `${n} জন শিক্ষার্থী`,
    /** The same count on the collapsed list, where the row is half as wide. */
    studentsShort: (n: number) => `${n} জন`,
    /**
     * The pair on the right of each row. They have to differ at a glance and not
     * only by colour: one is a filled green button, the other a pale badge with a
     * tick, and the words carry the difference for anyone who reads neither.
     */
    taken: 'নেওয়া হয়েছে',
    take: 'হাজিরা নিন',
    otherBatches: 'আজ ক্লাস নেই এমন ব্যাচ',

    /** The register's own page title. */
    rosterTitle: 'হাজিরা',
    /** Appended to the date when a teacher is backfilling an earlier class. */
    pastDate: 'পুরোনো তারিখ',
    noStudentsTitle: 'এই ব্যাচে শিক্ষার্থী নেই',
    noStudentsBody: 'শিক্ষার্থী যোগ করলে এখানে হাজিরা নেওয়া যাবে।',

    /**
     * Three the register shows but cannot be handed: each takes an argument, and
     * a function cannot cross into a client component. So they live on this side
     * of the boundary and are resolved before they travel — `saved` by the action
     * that knows the count, the other two by the page, which knows the batch and
     * every name on the roster.
     */
    saved: (n: number) => `হাজিরা সেভ হয়েছে — ${n} জন`,
    /** The radiogroup's label, which is all a screen reader has to place the row. */
    rowLabel: (name: string) => `${name} — হাজিরা`,
    /**
     * The batch name is in the submit button on purpose: a teacher with four
     * batches in a morning needs to know which register they are about to write.
     */
    saveFor: (batch: string) => `${batch} — হাজিরা সেভ করুন`,

    /**
     * What the save action returns when it refuses. Nested in the screen's group
     * rather than the register's: the action resolves the string on the server and
     * returns it already written, so these never cross the wire unread.
     *
     * Whole sentences, not `${specific} ${common.tryAgain}`. Bangla ends a
     * sentence with a danda and English with a full stop, and composing around
     * that difference costs more than the six strings it would save.
     */
    errors: {
      forbidden: 'আপনার এই কাজের অনুমতি নেই।',
      noBatch: 'ব্যাচ পাওয়া যায়নি।',
      noStudents: 'কোনো শিক্ষার্থী পাওয়া যায়নি।',
      rosterUnreadable: 'শিক্ষার্থীর তালিকা পড়া যায়নি।',
      emptyBatch: 'এই ব্যাচে কোনো শিক্ষার্থী নেই।',
      saveFailed: 'হাজিরা সেভ হয়নি। আবার চেষ্টা করুন।',
    },
  },

  /**
   * What the register renders for itself — its own group and not part of `teach`,
   * because it is the one client component in the flow and this group crosses the
   * wire. A screen's worth of strings it does not use would be paid for on every
   * load, on 3G, with a class waiting.
   *
   * Strings only, and that is a rule rather than a coincidence: a group handed to
   * a client component may not hold a function, so anything taking a count or a
   * name stays in `teach` above and arrives already written.
   */
  roster: {
    alreadyTaken:
      'এই ব্যাচের হাজিরা আগে নেওয়া হয়েছে। বদলে আবার সেভ করলে আগের হাজিরা বদলে যাবে।',
    note: 'নোট',
    notePlaceholder: 'যেমন: ছুটির কারণে ক্লাস তাড়াতাড়ি শেষ',
  },

  /**
   * The three ways an owner reaches a family. Vocabulary rather than one screen's
   * words, like `attendance` above: the board's "last chased" line, the worklist's
   * tick and the chips themselves all name the same three channels, and a centre
   * that reads 'এসএমএস' in one place and 'খুদেবার্তা' in another is being shown two
   * products.
   *
   * "এসএমএস" and not the formal "খুদেবার্তা", which nobody says out loud. Keyed by
   * fee_reminders.channel, so a channel added to the enum without a label here is a
   * compile error rather than a blank chip.
   */
  channels: {
    sms: 'এসএমএস',
    whatsapp: 'হোয়াটসঅ্যাপ',
    call: 'কল',
  },

  /**
   * The fee board — the screen the product is sold on — and everything its three
   * writes say back.
   *
   * Money is never in a template here. `formatTaka` produces ASCII digits in both
   * languages and the caller passes the finished figure in, because an owner checks
   * this board against a bKash statement and a total in Bangla numerals is a total
   * they have to translate before they can compare it.
   *
   * Counts of people stay ASCII too, and for the same reason — an owner reads "12
   * জনের বাকি" off this card and types 12 somewhere else. Days and dates take
   * Bangla numerals; see `digits` in lib/bd/time.ts.
   */
  fees: {
    title: 'ফি',
    subtitle: 'কে দিয়েছে, কার বাকি',
    outstanding: 'মোট বকেয়া',
    unpaidCount: (n: number) => `${n} জনের বাকি`,
    overdueCount: (n: number) => `${n} জনের সময় পেরিয়ে গেছে`,
    /**
     * Prefixes rather than whole sentences, because the amount that follows is
     * bold and a filled template cannot carry a `<span>`. Both languages happen to
     * want the figure last here and first in `inCredit`, which is why these are two
     * keys and not one with the number in the middle.
     */
    collectedThisMonth: 'এই মাসে জমা হয়েছে',
    inCredit: 'বেশি জমা আছে',
    emptyTitle: 'এখনো কোনো ইনভয়েস নেই',
    emptyBody:
      'উপরের বোতাম দিয়ে এই মাসের ইনভয়েস তৈরি করুন। প্রতিটি চালু ভর্তির জন্য একটি ইনভয়েস তৈরি হবে, ব্যাচের মাসিক ফি অনুযায়ী।',

    /** When a reminder went out, as a person would say it. Anything older is a date. */
    today: 'আজ',
    yesterday: 'গতকাল',

    /**
     * What the writes return. Resolved in the action, so they arrive at the row
     * already written and a function here costs nothing.
     *
     * The count in `invoicesCreated` is ASCII and the total is pre-formatted; both
     * are figures an owner reconciles against something outside this app.
     */
    invoicesCreated: (count: number, total: string) =>
      `${count}টি ইনভয়েস তৈরি হয়েছে — মোট ${total}।`,
    invoicesAllExisted:
      'এই মাসের সব ইনভয়েস আগেই তৈরি করা হয়েছে। নতুন কিছু যোগ হয়নি।',
    /**
     * The student's name comes first because that is the fear being answered: an
     * owner taking cash across a desk needs to see the money landed on the right
     * child before the next parent starts talking.
     */
    received: (name: string, amount: string) => `${name} — ${amount} জমা হয়েছে।`,
    receivedInFull: (name: string, amount: string) =>
      `${name} — ${amount} জমা হয়েছে। ফি সম্পূর্ণ পরিশোধ ✓`,
    stillOwed: (amount: string) => `এখনো ${amount} বাকি আছে।`,
    overpaid: (amount: string) =>
      `প্রয়োজনের চেয়ে ${amount} বেশি জমা হয়েছে। ভুল হলে এখনই দেখে নিন।`,

    errors: {
      forbidden: 'ফি-এর হিসাব শুধু মালিক বা ম্যানেজার রাখতে পারেন।',
      dueDayRange: 'তারিখ ১ থেকে ২৮-এর মধ্যে দিন।',
      rosterUnreadable: 'শিক্ষার্থীর তালিকা পড়া যায়নি। আবার চেষ্টা করুন।',
      nothingToBill:
        'ইনভয়েস তৈরি করার মতো কিছু নেই। ব্যাচে মাসিক ফি বসানো আছে কি না দেখুন।',
      invoicesFailed: 'ইনভয়েস তৈরি হয়নি। আবার চেষ্টা করুন।',
      noInvoice: 'কোন ইনভয়েস, তা পাওয়া যায়নি।',
      amountUnreadable: 'টাকার পরিমাণ ঠিকভাবে লিখুন।',
      amountZero: 'টাকার পরিমাণ শূন্য হতে পারে না।',
      amountNegative: 'টাকার পরিমাণ শূন্যের বেশি হতে হবে।',
      invoiceMissing: 'ইনভয়েসটি পাওয়া যায়নি।',
      invoiceVoided: 'এই ইনভয়েসটি বাতিল করা হয়েছে।',
      paymentFailed: 'টাকা জমা হয়নি। আবার চেষ্টা করুন।',
    },
  },

  /**
   * One row of the board, which is a client component, so: strings only, and the
   * ones with a figure in them are `{}` templates filled in the browser. See
   * ./fill.ts for why they are templates and not functions.
   */
  feeRow: {
    paidOf: '{paid} / {net} দেওয়া হয়েছে',
    settled: '{paid} জমা হয়েছে · মোট {net}',
    discount: '({amount} ছাড়)',
    inCredit: '{amount} বেশি জমা আছে',

    chaseTitle: 'অভিভাবককে মনে করিয়ে দিন',
    /**
     * No verb. Tapping a chip proves the message was written and handed to the
     * phone, not that a parent read it — "সর্বশেষ: আজ · কল" claims exactly what is
     * known and nothing more.
     */
    lastChase: 'সর্বশেষ',
    justNow: 'এইমাত্র',

    amount: 'কত টাকা জমা হলো',
    method: 'কীভাবে',
    reference: 'ট্রানজেকশন আইডি',
    receiving: 'জমা হচ্ছে…',
    receive: 'জমা নিন',
    /**
     * Keyed by fee_payments.method, so the radio group is one list in both
     * languages and a method added to the enum without a label is a compile error.
     * The wallet names stay as they are written on the apps themselves — a Dhaka
     * owner reads "বিকাশ" on a poster and "bKash" on the phone, and both are right
     * in their own script.
     */
    methods: {
      cash: 'নগদ টাকা',
      bkash: 'বিকাশ',
      nagad: 'নগদ',
      rocket: 'রকেট',
      bank_transfer: 'ব্যাংক',
      other: 'অন্য',
    },
  },

  /** The three chips, and the two reasons there might be none. */
  chase: {
    noNumber: 'অভিভাবকের নম্বর নেই।',
    addNumber: 'যোগ করে নিন',
    optedOut: 'এই পরিবার এসএমএস পেতে চায় না — ফোন করা যাবে।',
  },

  /**
   * What the worklist writes for itself as an owner works down it. All four change
   * after the page has rendered, which is the whole reason this screen is a client
   * component at all — everything static about it is resolved in `reminders` below.
   */
  chaseList: {
    allDone: 'সবাইকে বলা হয়ে গেছে ✓',
    moreLeft: 'আরও {n} জন বাকি',
    /** From the second time round only. "১ বার" on a first reminder is noise. */
    times: '{n} বার',
    sent: '{channel} পাঠানো হয়েছে ✓',
  },

  /**
   * Today's chase list: who to message now, and why this group of them.
   *
   * The stage headings each have to stay true across a whole window, not just the
   * day it opened — 'due' covers the deadline and the six days after it, so "আজ শেষ
   * তারিখ" would be a lie to five families out of six. The exact number of days is
   * on the row, where it belongs.
   */
  reminders: {
    title: 'আজকের রিমাইন্ডার',
    subtitle: 'আজ কাদের মনে করিয়ে দেওয়ার কথা',
    dueTitle: 'আজ মনে করাতে হবে',
    /**
     * Follows the count, which is set four times larger — so the number stays in
     * its own element and only the word after it comes from here.
     *
     * A function of the count even though Bangla ignores it: English says "family"
     * for one and "families" for the rest, and the page is a server component, so
     * this is the cheap half of the two ways to write a count-dependent string —
     * the compiler checks the argument at both ends. See ./fill.ts for the other.
     */
    people: (_n: number) => 'জনকে',
    atStake: 'বাকি এই তালিকায়',

    noneTitle: 'আজ কাউকে মনে করানোর দরকার নেই',
    /**
     * Three different situations, and an owner deserves to know which one they are
     * in: "nothing to do" reads as a broken screen to someone who can see twelve
     * unpaid rows on the board.
     */
    noneNothingOwed: 'কোনো ফি বাকি নেই।',
    noneAllRecent: 'যাদের বাকি আছে, সবাইকে সম্প্রতি বলা হয়েছে। কয়েক দিন সময় দিন।',
    noneNotDueYet: 'যে ফি বাকি আছে, তার শেষ তারিখ এখনো আসেনি।',

    heldCount: (n: number) => `${n} জনকে সম্প্রতি বলা হয়েছে`,
    waitingCount: (n: number) => `${n} জনের শেষ তারিখ এখনো আসেনি`,

    unreachableTitle: (n: number) => `${n} জনের অভিভাবকের নম্বর নেই`,
    unreachableBody: (names: string) =>
      `নম্বর ছাড়া মনে করিয়ে দেওয়ার উপায় নেই — ${names}`,
    addNumbers: 'নম্বর যোগ করুন',
    backToBoard: 'ফি বোর্ডে ফিরুন',

    /**
     * The door onto this screen, on the fee board and on the dashboard. It borrows
     * `title` and `noneTitle` rather than restating them, because it is a door to
     * this screen and not a second screen — only the count's tail is its own, and
     * only because the number beside it is red and bold and so cannot be inside a
     * filled string.
     */
    entryDueSuffix: 'জনকে আজ মনে করিয়ে দেওয়ার কথা',

    stages: {
      soon: 'শেষ তারিখের আগে',
      due: 'শেষ তারিখ এসে গেছে',
      late: 'এক সপ্তাহের বেশি দেরি',
      owing: 'অনেক দিন ধরে বাকি',
    },
    stageNotes: {
      soon: 'এখনো দেরি হয়নি — আগে মনে করিয়ে দিলে সময়মতো পাওয়ার সম্ভাবনা বেশি',
      due: 'এই সপ্তাহেই জমা দেওয়ার কথা',
      late: 'শেষ তারিখ এক সপ্তাহের বেশি আগে পেরিয়ে গেছে',
      owing: 'দুই সপ্তাহ পর আবার মনে করিয়ে দেওয়ার সময়',
    },
  },

  /** The once-a-month form, folded away above the board. A client component. */
  invoices: {
    open: '+ মাসের ইনভয়েস তৈরি করুন',
    month: 'কোন মাসের',
    dueDay: 'শেষ তারিখ',
    dueDayHint: 'মাসের কত তারিখের মধ্যে ফি দিতে হবে',
    dayOption: '{d} তারিখ',
    submit: 'ইনভয়েস তৈরি করুন',
    safeToRepeat:
      'প্রতিটি চালু ভর্তির জন্য একটি ইনভয়েস। আগে তৈরি হয়ে থাকলে আবার তৈরি হবে না — তাই দুইবার চাপলেও সমস্যা নেই।',
  },
} as const

/**
 * The same tree with every string literal widened back to `string`.
 *
 * `bn` is `as const`, which is what makes its keys exact — but it also makes its
 * *values* exact, and a dictionary typed as `typeof bn` would demand that the
 * English `save` be the literal 'সংরক্ষণ করুন'. This widens the leaves and leaves
 * the shape alone.
 *
 * The function branch keeps a count-dependent string's signature identical in
 * every locale: once `bn` holds `n => \`${n} জন\``, an English version that takes
 * no argument — or takes a string — stops compiling. Nothing in this file needs
 * it yet; the first screen with a plural in it will.
 */
type Translated<T> = T extends string
  ? string
  : T extends (...args: infer A) => infer R
    ? (...args: A) => R
    : T extends object
      ? { [K in keyof T]: Translated<T[K]> }
      : T

/**
 * The shape every locale must fill.
 *
 * Derived from `bn` rather than declared separately, so there is one list of keys
 * in the codebase and it is the one with the real strings in it. A hand-written
 * interface would be a second list to forget to update.
 */
export type Dictionary = Translated<typeof bn>
