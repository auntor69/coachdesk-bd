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
import { digits } from '../bd/time.ts'

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
    /**
     * The second name field on the forms that offer one — a subject, an exam
     * kind. Shared because both forms ask the same question, and because what it
     * means depends on who is reading: to a Bangla reader this is the name the
     * lists will show, to an English reader it is the one they will not see. Each
     * dictionary says the true thing for its own reader; see `localName`.
     */
    bnName: 'বাংলা নাম',
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
     * The cap on every name an owner types — a subject, a batch, a student, a
     * teacher, an exam, the centre itself. Shared because it is one rule, and
     * because two screens saying different numbers for the same cap is the
     * failure this file exists to prevent.
     *
     * A `{n}` template, filled by `nameTooLong()` in ./messages.ts from the same
     * constant the checks read. Eight files enforce this cap and one of them is a
     * browser `maxLength`; a sentence with the number typed into it would go
     * stale the first time somebody moved it, and the reader would be told ৮০
     * while being refused at sixty. Rendered with `digits`, so it is ৮০ here and
     * 80 in English.
     */
    nameTooLong: 'নাম {n} অক্ষরের মধ্যে রাখুন।',
    /**
     * The password rule, on the two screens that set one — somebody signing
     * themselves up, and an owner issuing a starting password to a teacher
     * standing next to them.
     *
     * Same shape as `nameTooLong` and for the same reason: the length lives in
     * `MIN_PASSWORD`, three files enforce it, and a message that says ৬ while the
     * check wants eight is somebody unable to log in rather than a cosmetic
     * mismatch. Filled with ./fill.ts on the server, the number through `digits`.
     */
    passwordTooShort: 'পাসওয়ার্ড কমপক্ষে {n} অক্ষরের হতে হবে।',
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
    /**
     * Only rendered for someone who belongs to more than one centre, so it can
     * say "another" without first explaining that there is more than one.
     */
    otherCenter: 'অন্য কোচিং',
    /** Marks the centre the reader is already in, beside its name in the list. */
    thisCenter: 'এখন এখানে',
    /**
     * The language switch's accessible name. `{lang}` is the endonym of the
     * language being switched to — বাংলা or English — and is filled from
     * LOCALE_NAME rather than from here, because neither name is translated.
     */
    switchTo: 'ভাষা বদলে {lang} করুন',
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
   * The 403 screen. Reached by tapping a bookmark for a screen your role does not
   * open, or by switching to the centre where you are a teacher with an owner
   * screen still in history — so it names the centre, which is the part the
   * reader is most likely to have lost track of.
   */
  denied: {
    title: 'এই পাতা খোলার অনুমতি নেই',
    atCenter: (center: string) => `${center}-এ আপনার দায়িত্বে এই পাতা দেখা যায় না।`,
    askOwner: 'দরকার হলে কোচিংয়ের মালিক অনুমতি বদলে দিতে পারেন।',
    home: 'আমার স্ক্রিনে ফিরুন',
  },

  /**
   * The 404. Its own group rather than a line borrowed from `denied`, because the
   * two say different things: that one is "you may not", this one is "it is not
   * there", and a reader who is told the wrong one goes looking for the wrong fix.
   */
  missing: {
    title: 'পাতাটি খুঁজে পাওয়া যায়নি',
    body: 'লিংকটি পুরোনো হতে পারে, বা জিনিসটি মুছে ফেলা হয়েছে।',
    home: 'আমার স্ক্রিনে ফিরুন',
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
    /**
     * The teacher's version of the same empty screen. Says who does the assigning
     * rather than that they may not — a teacher on their first day does not need
     * to be told what they are not allowed to do.
     */
    noBatchesTitle: 'এখনও কোনো ব্যাচ আপনার নামে নেই',
    noBatchesBody: 'মালিক আপনাকে ব্যাচে দিলে আজকের ক্লাস এখানে দেখা যাবে।',
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
   * The three wallets a Bangladeshi family actually sends money with, in the
   * word they use for it rather than the company's own styling.
   *
   * Keyed by coaching_centers.payment_wallet, so a fourth wallet added to the
   * enum without a word here is a compile error rather than a blank radio button
   * on the one form that decides where a month of fees goes.
   *
   * The Bangla side must match `WALLET_LABEL_BN` exactly, and a test holds it to
   * that: the owner choosing a wallet should be reading the same word the parent
   * will read in the SMS, or the screen is describing a message it does not send.
   * The English side deliberately does not — an English-medium owner reads
   * "bKash" on the app icon, while the message their parents receive still says
   * বিকাশ, because the parent is not the one who switched languages.
   */
  wallets: {
    bkash: 'বিকাশ',
    nagad: 'নগদ',
    rocket: 'রকেট',
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
    /**
     * Says who *does* raise them, rather than that the reader may not. A teacher
     * who was handed this screen by their owner does not need to be told what
     * they are not; they need to know the board is empty because nobody has
     * billed yet, and who to go and ask.
     */
    emptyBodyReadOnly:
      'আপনার ব্যাচের জন্য এখনো কোনো ইনভয়েস তৈরি হয়নি। ইনভয়েস তৈরি করবেন মালিক বা ম্যানেজার।',
    /**
     * "হিসাব", not a word for the total, because it sits above a figure that is
     * already labelled — this line's job is the boundary of the sum, not what the
     * sum is.
     */
    yoursOnly: 'শুধু আপনার নিজের ব্যাচের হিসাব',

    /**
     * The link to the month's collection register. Named for what it is on paper —
     * every centre already keeps an "আদায় খাতা", and an owner looking for the thing
     * they reconcile against a bKash statement is looking for that word.
     */
    registerLink: 'এই মাসের আদায় খাতা',

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
     * Appears only after money has actually landed, next to the confirmation. Says
     * "রসিদ" rather than "প্রিন্ট" because the owner's next thought is the piece of
     * paper the parent is waiting for, and they may well save it as a PDF and send
     * it on WhatsApp instead of printing anything.
     */
    receiptLink: 'রসিদ দেখুন',
    /**
     * Keyed by fee_payments.method, so the radio group is one list in both
     * languages and a method added to the enum without a label is a compile error.
     * The wallet names stay as they are written on the apps themselves — a Dhaka
     * owner reads "বিকাশ" on a poster and "bKash" on the phone, and both are right
     * in their own script.
     */
    methods: {
      // 'ক্যাশ', not 'নগদ টাকা', and the loanword is deliberate: Nagad's brand is
      // written নগদ, so 'নগদ টাকা' has the wallet's name inside it. On the
      // collection register those two labels sit in one column and one breakdown
      // list, and an owner counting the drawer against a line that reads নগদ has
      // no way to tell which is which. 'ক্যাশ' is what they say out loud anyway
      // and shares not one letter with the brand.
      cash: 'ক্যাশ',
      bkash: 'বিকাশ',
      nagad: 'নগদ',
      rocket: 'রকেট',
      bank_transfer: 'ব্যাংক',
      other: 'অন্য',
    },
  },

  /**
   * The fee receipt, printed two to a sheet.
   *
   * Reads like the slip books already sold in every stationery shop in the
   * country, because that is what it replaces and an owner should not have to
   * learn a new layout to hand a parent something familiar. The method labels are
   * not here — the receipt reads `feeRow.methods`, so a wallet added to the enum
   * gets one label for the whole product rather than three that drift.
   */
  receipt: {
    title: 'ফি রসিদ',
    receiptNo: 'রসিদ নং',
    date: 'তারিখ',
    student: 'শিক্ষার্থীর নাম',
    studentCode: 'আইডি',
    month: 'কোন মাসের ফি',
    amount: 'জমার পরিমাণ',
    method: 'কীভাবে',
    reference: 'ট্রানজেকশন আইডি',
    /** The invoice's own total, so the two figures below it can be checked. */
    billed: 'মাসের মোট ফি',
    /**
     * "এই রসিদ পর্যন্ত" — up to this receipt — and not "এখন". The figure is
     * calculated as of this payment and never moves again, which is the only way a
     * slip printed twice a year apart can say the same thing both times. A receipt
     * showing today's balance would contradict itself the moment the next payment
     * lands, and the parent holding it would be right and the paper wrong.
     */
    balanceAfter: 'এই রসিদ পর্যন্ত বাকি',
    paidInFull: 'সম্পূর্ণ পরিশোধ ✓',
    inCredit: 'বেশি জমা আছে',
    /** Left blank on the paper, for a pen. */
    signature: 'গ্রহণকারীর স্বাক্ষর',
    guardianCopy: 'অভিভাবকের কপি',
    officeCopy: 'অফিস কপি',
    cutHere: 'এখানে কেটে নিন',
    print: 'প্রিন্ট করুন',
    backToFees: 'ফি-এর তালিকায় ফিরুন',
    /**
     * A computer-generated slip that nobody signed is worth saying out loud, so a
     * parent knows the paper is the record and not a promise.
     */
    footNote: 'এটি কম্পিউটারে তৈরি রসিদ। টাকা জমা হওয়ার প্রমাণ হিসেবে যত্ন করে রাখুন।',
    notFound: 'রসিদটি পাওয়া যায়নি। হয়তো অন্য কোচিংয়ের, বা মুছে ফেলা হয়েছে।',
    /**
     * The paywall, on the screen that withholds it.
     *
     * Named for the paper rather than "locked", because the paper is precisely and
     * only what is missing. The number above it is real — a trigger assigns it the
     * moment the money is recorded, on every tier — so a free teacher reads it down
     * a phone line and searches by it exactly as a paying one does. Saying so is
     * the point: an owner who thinks the number is also withheld thinks the free
     * tier cannot take money.
     */
    paperTitle: 'ছাপানোর মতো রসিদ এই প্ল্যানে নেই',
    paperBody: (plan: string, pro: string) =>
      `${plan} প্ল্যানেও রসিদের নম্বর পাচ্ছেন — অভিভাবককে বলে দিতে পারেন, পরে এই নম্বর দিয়েই খুঁজে বের করতে পারেন। A4 কাগজে দুই কপি — অভিভাবকের আর অফিসের — ছাপাতে ${pro} দরকার।`,
  },

  /**
   * The month's collection register: what came in, in order, with a running total
   * and a breakdown by method.
   *
   * The breakdown is the reason this screen exists rather than being a filter on
   * the board. An owner reconciles at the end of the day or the month by holding a
   * bKash statement next to a cash box, and neither of those is one number — they
   * need "how much of this month came through bKash" separately from "how much was
   * cash", or the sum agreeing means nothing.
   */
  register: {
    title: 'আদায় খাতা',
    subtitle: 'কোন মাসে কত টাকা জমা হলো',
    month: 'মাস',
    show: 'দেখুন',
    print: 'প্রিন্ট করুন',
    backToFees: 'ফি-এর তালিকায় ফিরুন',

    colDate: 'তারিখ',
    colReceipt: 'রসিদ',
    colStudent: 'শিক্ষার্থী',
    colMethod: 'কীভাবে',
    colReference: 'ট্রানজেকশন আইডি',
    colAmount: 'টাকা',
    /**
     * Its own column and not a footer line. An owner ticking down a printed page
     * against a wallet statement finds the row where the two stopped agreeing, and
     * that is only possible if every row carries the total up to it.
     */
    colRunning: 'ক্রমিক মোট',

    total: 'মোট আদায়',
    byMethod: 'কীভাবে এসেছে',
    /** Payments, not students: one family can pay twice in a month. */
    entries: (n: number) => `${n}টি জমা`,
    empty: 'এই মাসে এখনো কোনো টাকা জমা হয়নি।',
    /**
     * Same boundary note as the fee board's. This screen is staff-admin only, so
     * the total is always the whole centre's — but the month is not, and a reader
     * who has changed it needs to see which one they are looking at.
     */
    forMonth: (month: string) => `${month} মাসের হিসাব`,
    /**
     * Locked on the free tier, and the body names what the reader still has rather
     * than only what they do not. Who paid what is on the fee board either way; the
     * month as one page — in order, with a running total and a split by wallet — is
     * the reconciliation, and that is what Pro buys.
     */
    paperTitle: 'আদায় খাতা এই প্ল্যানে নেই',
    paperBody: (plan: string, pro: string) =>
      `${plan} প্ল্যানে কে কত দিয়েছে তা ফি-এর তালিকাতেই দেখা যায়। মাসের পুরো হিসাব এক পাতায় — কোন তারিখে কত, ক্রমিক মোট, বিকাশে কত আর নগদ কত — ${pro}-তে।`,
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

  /**
   * The three exam screens, and every sentence with a number in it that the two
   * client components below need.
   *
   * That last part is why this group is larger than the screens it names. The
   * marks sheet and the SMS gate are client components, so neither may hold a
   * function (see `T` in ./index.ts) — and almost every counted sentence on the
   * gate is a count English inflects on: one guardian, three guardians; one
   * credit, three credits. The numbers are all known before the page renders,
   * so they are resolved here by the server and travel as finished strings.
   *
   * Marks stay in ASCII digits in both languages, like money and unlike a date.
   * A teacher types 45 into a numeric keypad and compares it against the পূর্ণমান
   * printed beside the field; a Bangla ৪৫ next to an input holding 45 is the same
   * mistake as a Bangla total on the fee board, and worse, because the input's
   * value is parsed as a number.
   */
  exams: {
    title: 'পরীক্ষা',
    subtitle: 'নম্বর দিন, ফলাফল অভিভাবককে জানান',
    /** On a button beside the heading, so it cannot be long. */
    new: 'নতুন',
    emptyTitle: 'এখনও কোনো পরীক্ষা নেই',
    emptyBody:
      'পরীক্ষা তৈরি করলে ব্যাচের সব শিক্ষার্থীর নাম নম্বর দেওয়ার জন্য একসাথে চলে আসবে।',
    /**
     * The same empty list for a teacher who cannot create one — the fee board's
     * emptyBodyReadOnly, in the exam's words. The sentence above is an instruction
     * pointing at a button this reader does not have.
     */
    emptyBodyReadOnly:
      'আপনার ব্যাচের জন্য এখনও কোনো পরীক্ষা তৈরি হয়নি। কে পরীক্ষা তৈরি করতে পারবে তা মালিক ঠিক করেন।',
    create: 'পরীক্ষা তৈরি করুন',

    /**
     * What a Bangladeshi question paper prints at the top of itself, which is
     * where both of these words come from. Prefixes rather than sentences: the
     * figure after each one is in its own element so it can be tabular.
     */
    fullMarks: 'পূর্ণমান',
    pass: 'পাস',
    /** Under the count of marks entered, on a list row. */
    marked: 'নম্বর দেওয়া',
    smsSent: 'SMS পাঠানো ✓',
    smsNotSent: 'SMS পাঠানো হয়নি',

    /** The marks sheet's own page title. */
    marksTitle: 'নম্বর',
    noStudentsTitle: 'এই ব্যাচে শিক্ষার্থী নেই',
    noStudentsBody:
      'ব্যাচে শিক্ষার্থী যোগ করলে তাদের নাম এখানে নম্বর দেওয়ার জন্য চলে আসবে।',

    newTitle: 'নতুন পরীক্ষা',
    needBatchTitle: 'আগে একটি ব্যাচ দরকার',
    needBatchBody:
      'পরীক্ষা একটি ব্যাচের জন্য হয় — ব্যাচের শিক্ষার্থীরাই নম্বর দেওয়ার তালিকায় আসে।',
    createBatch: 'ব্যাচ তৈরি করুন',

    /**
     * The gate's figures, written here and handed down. Each one is a count that
     * English inflects on and Bangla does not, which is the whole reason they are
     * not `{n}` templates like the fee row's.
     */
    recipients: (n: number) => `${n} জনের কাছে`,
    credits: (n: number) => `${n} ক্রেডিট`,
    balanceNow: (n: number) => `এখন আছে ${n} ক্রেডিট`,
    shortfall: (n: number) => `${n} কম পড়ছে`,
    /** How many SMS one message becomes. A long comment costs a second one. */
    segments: (n: number) => `${n}টি SMS`,
    /** Above the one real message the gate shows before it is tapped. */
    previewFor: (name: string) => `${name}-এর অভিভাবক যা পাবেন`,
    withoutMarksCount: (n: number) => `${n} জনের নম্বর এখনও দেওয়া হয়নি`,
    noPhoneCount: (n: number) => `${n} জনের অভিভাবকের নম্বর নেই`,
    optedOutCount: (n: number) => `${n} জনের SMS বন্ধ আছে`,
    /**
     * Whose note did not fit, with the names in it. The teacher is looking at the
     * marks sheet directly above this line, so a count on its own would send them
     * hunting through eight notes for the one that is a few characters too long.
     */
    notesTrimmedCount: (n: number, names: string) =>
      `${n} জনের মন্তব্য SMS-এ জায়গা হচ্ছে না — ${names}`,

    /**
     * What the three writes return, resolved in the action. `marksSaved` reads
     * "নম্বর সেভ হয়েছে — ২৮ জন, অনুপস্থিত ২" and drops the second half when
     * nobody was absent, which is why it is one function and not two strings.
     */
    marksSaved: (entered: number, absent: number) =>
      absent > 0
        ? `নম্বর সেভ হয়েছে — ${entered} জন, অনুপস্থিত ${absent}`
        : `নম্বর সেভ হয়েছে — ${entered} জন`,
    smsQueued: (sent: number, charged: number) =>
      `${sent} জন অভিভাবক · ${charged} ক্রেডিট খরচ হয়েছে`,

    errors: {
      /**
       * Its own rather than shared with the register's identical sentence. The
       * fee board already proved this line wants to be specific — "only an owner
       * or a manager can keep the fee records" — and this one will want to name
       * the batch's teacher the day exams stop being open to every teacher.
       */
      forbidden: 'আপনার এই কাজের অনুমতি নেই।',
      /**
       * The line the day arrived. The note above `forbidden` said this one would
       * want to be specific once exams stopped being open to every teacher — this
       * is that sentence, and it names the owner because the owner's checkbox is
       * the only thing that can change the answer.
       */
      noExamPermission:
        'আপনার পরীক্ষা তৈরি বা নম্বর বসানোর অনুমতি নেই। মালিককে বলুন।',
      nameRequired: 'পরীক্ষার নাম লিখুন।',
      pickBatch: 'ব্যাচ বাছুন।',
      noBatch: 'ব্যাচ পাওয়া যায়নি।',
      totalUnreadable: 'পূর্ণমান ঠিকভাবে লিখুন।',
      totalTooBig: 'পূর্ণমান ১০০০-এর মধ্যে হতে হবে।',
      passUnreadable: 'পাস নম্বর ঠিকভাবে লিখুন।',
      passOverTotal: 'পাস নম্বর পূর্ণমানের বেশি হতে পারে না।',
      createFailed: 'পরীক্ষা তৈরি করা যায়নি। আবার চেষ্টা করুন।',

      noExam: 'পরীক্ষা পাওয়া যায়নি।',
      rosterUnreadable: 'শিক্ষার্থীর তালিকা পড়া যায়নি।',
      noStudents: 'কোনো শিক্ষার্থী পাওয়া যায়নি।',
      marksNegative: 'নম্বর ঋণাত্মক হতে পারে না।',
      /**
       * The cap is named because a trigger enforces it too, and a trigger failure
       * arrives as a constraint name. ASCII, like every other mark.
       */
      marksOverTotal: (total: number) =>
        `নম্বর পূর্ণমান (${total}) এর বেশি হতে পারে না।`,
      saveFailed: 'নম্বর সেভ হয়নি। আবার চেষ্টা করুন।',

      declineFailed: 'সেভ হয়নি। আবার চেষ্টা করুন।',
      alreadySent: 'এই পরীক্ষার ফলাফল আগেই পাঠানো হয়েছে।',
      noSmsPermission: 'আপনার SMS পাঠানোর অনুমতি নেই। মালিককে বলুন।',
      noRecipients: 'পাঠানোর মতো কোনো নম্বর নেই।',
      creditsShort: (need: number, have: number) =>
        `SMS ক্রেডিট কম আছে — দরকার ${need}, আছে ${have}।`,
      sendFailed: 'পাঠানো যায়নি। আবার চেষ্টা করুন।',
      creditRace: 'ক্রেডিট হিসাব বদলেছে। আবার চেষ্টা করুন।',
      /** The one refund path. An owner who loses credits to our bug is gone. */
      sendFailedRefunded: 'পাঠানো যায়নি। ক্রেডিট ফেরত দেওয়া হয়েছে।',
    },
  },

  /**
   * The marks sheet — a client component, so strings only, and the three that
   * name a student are `{name}` templates filled in the browser.
   *
   * Those three are the one place in the app where a per-row sentence is written
   * client-side rather than by the page. The register does the opposite: it takes
   * one finished label per row. The difference is arithmetic — this sheet renders
   * three labels for each of forty students, and 120 resolved strings in the RSC
   * payload of a screen a teacher opens on 3G between two classes is a real cost,
   * where forty were not. See ./fill.ts.
   */
  marksSheet: {
    /**
     * Read-only by permission, which outranks `locked` below and is a different
     * thing from it. Locked is about time — the SMS has gone out. This is about
     * authority, and it is the only one of the two that actually greys the fields.
     */
    readOnly:
      'মালিক আপনার জন্য নম্বর বসানো বন্ধ রেখেছেন। এই পাতা দেখতে পারবেন, বদলাতে পারবেন না।',
    locked:
      'এই পরীক্ষার ফলাফল অভিভাবকদের কাছে পাঠানো হয়েছে। এখন নম্বর বদলালে অভিভাবকের কাছে থাকা SMS-এর সাথে মিলবে না।',
    markLabel: '{name} — প্রাপ্ত নম্বর',
    absentLabel: '{name} — অনুপস্থিত',
    noteLabel: '{name} — মন্তব্য',
    notePlaceholder: 'মন্তব্য — অভিভাবকের SMS-এ যাবে, যদি জায়গা থাকে',
    /**
     * The tail of "১২/৪০ জনের ফলাফল বসানো হয়েছে". Only the tail, because the
     * numerator is set bolder than the denominator — a teacher scanning the
     * sticky bar wants to see how far they have got, not read a sentence.
     *
     * "ফলাফল", not "নম্বর": the counter treats a student marked absent as done,
     * because for the purpose of "can I save this sheet yet" they are. A sheet
     * with seven marks and one absence read "৮ জনের নম্বর দেওয়া হয়েছে", which is
     * one mark more than the teacher entered. An absence is a result; it is not
     * a number. English says "marked" and never had the problem.
     */
    marked: 'জনের ফলাফল বসানো হয়েছে',
    /**
     * The same word as `exams.fullMarks`, written twice on purpose. A client
     * component can only be handed a group with no functions in it and `exams`
     * has fourteen, so the sheet cannot reach across for it. In English the two
     * are not even the same string: this one follows a "·" mid-line and is
     * lowercase, that one starts a line.
     */
    fullMarks: 'পূর্ণমান',
    save: 'নম্বর সেভ করুন',
  },

  /**
   * The gate that spends the centre's money. A client component: strings only,
   * and every sentence with a figure in it arrives already written — see the
   * `exams` group above.
   */
  smsGate: {
    sentTitle: 'অভিভাবকদের কাছে পাঠানো হয়েছে',
    /**
     * Said plainly rather than hidden, because it is the difference between a
     * bug and a queue. Until BTRC approves a sender ID in the centre's own name
     * nothing leaves the building, and an owner who thinks a message was
     * delivered will not chase the parent who never got it.
     */
    queuedNote:
      'SMS গুলো লাইনে আছে। আপনার কোচিংয়ের নামে sender ID অনুমোদন হলেই অভিভাবকের ফোনে পৌঁছাতে শুরু করবে — তখন এগুলো নিজে থেকেই চলে যাবে।',

    /** The heading on the two states where there is nothing to decide. */
    resultSms: 'ফলাফল SMS',
    noPermission:
      'আপনার SMS পাঠানোর অনুমতি নেই। কোচিংয়ের মালিক চাইলে সেটিংস থেকে অনুমতি দিতে পারেন।',
    saveMarksFirst: 'নম্বর সেভ করার পর অভিভাবকদের কাছে SMS পাঠানোর সুযোগ আসবে।',
    noNumbers: 'পাঠানোর মতো কোনো অভিভাবকের নম্বর নেই।',

    askTitle: 'অভিভাবকদের ফলাফল জানাবেন?',
    /** Two label-and-figure tiles, side by side. Both have to stay short. */
    willGoTo: 'যাবে',
    cost: 'খরচ',
    perPersonNote: 'প্রত্যেকের নাম ও নম্বর আলাদা করে বসানো হবে',
    /**
     * Not about the notes, though it used to say so. A note is dropped before it
     * can add a segment, so a two-segment message means the student's name, the
     * exam's name and the centre's name are long enough between them — and the
     * two of those the owner can shorten are named here.
     */
    longNote:
      'কিছু SMS ২টি হিসেব হচ্ছে — পরীক্ষার নাম বা কোচিংয়ের নাম ছোট করলে খরচ অর্ধেক হবে।',
    declined: 'এই পরীক্ষার SMS পাঠানো হয়নি। চাইলে পরে পাঠাতে পারবেন।',
    send: 'অভিভাবককে পাঠান',
    sending: 'পাঠানো হচ্ছে…',
    decline: 'এখন পাঠাবেন না',
    noUndo: 'পাঠানোর পর আর ফেরানো যায় না',
  },

  /** Creating an exam. Four fields, a client component. */
  examForm: {
    name: 'পরীক্ষার নাম',
    namePlaceholder: 'সাপ্তাহিক পরীক্ষা',
    batch: 'ব্যাচ',
    pickBatch: 'ব্যাচ বাছুন',
    kind: 'ধরন',
    fullMarks: 'পূর্ণমান',
    passMarks: 'পাস নম্বর',
    date: 'পরীক্ষার তারিখ',
    /** Says where it goes, because creating an exam was never the errand. */
    submit: 'পরীক্ষা তৈরি করে নম্বর দিন',
  },

  /**
   * The owner's home screen. All server-rendered, so counts are functions.
   *
   * Every figure on this page is ASCII in both languages, and the batch-rate card
   * is why the rule is worth stating: it puts a percentage, a count of class days
   * and a count of marks in one paragraph, and a card that reads "৯ দিন ক্লাস · 91%"
   * is harder to read than either convention followed alone. Dates and months are
   * the exception, as everywhere — those are Bangla numerals for a Bangla reader.
   */
  /**
   * Creating a batch — the one setup form long enough to need its own group.
   *
   * Top-level because it is a client component and `T` only takes a top-level key.
   * The day and slot labels are *not* here: they come from `lib/bd`, which is what
   * the country calls things, and the picker has to agree with the row it creates.
   */
  batchForm: {
    nameLabel: 'ব্যাচের নাম',
    /**
     * Hint and placeholder are the same sentence on purpose: the example *is* the
     * instruction, and an owner who reads neither still sees it greyed in the box.
     * It names a time and a class, because that is how a centre says it aloud.
     */
    nameHint: 'যেমন: সকাল ৭টা — HSC গণিত',
    subject: 'বিষয়',
    pickSubject: 'বিষয় বাছুন',
    needSubject: 'আগে অন্তত একটি বিষয় যোগ করুন।',
    teacher: 'শিক্ষক',
    /** The empty option. Not "কোনো শিক্ষক নেই": a decision deferred, not a fact. */
    teacherLater: 'পরে ঠিক করব',
    /** Part of the day, not a clock time — both are asked, in that order. */
    whichSlot: 'কোন বেলা',
    start: 'শুরু',
    end: 'শেষ',
    whichDays: 'কোন দিন ক্লাস',
    /** What skipping this does, said before they skip it rather than after. */
    daysHint: 'কিছু না বাছলে প্রতিদিনের ক্লাস ধরা হবে',
    feeLabel: 'মাসিক ফি (৳)',
    /**
     * The one thing about the fee that is not obvious and costs money to learn
     * late: changing it does not rewrite invoices already issued.
     */
    feeHint: 'এই ব্যাচের প্রতি মাসের ফি। পরে বদলালে পুরোনো বিল বদলাবে না।',
    submit: 'ব্যাচ তৈরি করুন',
  },

  /**
   * Adding one student by hand — the form, not what the action says back.
   *
   * The guardian's number carries every SMS this product sends, so it is the one
   * optional-looking field that is required, and the only one echoed back in the
   * format a Bangladeshi reads. Everything the centre might not know on day one
   * sits behind `moreInfo`, so the required part of the form is three fields.
   */
  studentForm: {
    nameLabel: 'শিক্ষার্থীর নাম',
    namePlaceholder: 'রাফিদ হাসান',
    guardianPhone: 'অভিভাবকের মোবাইল',
    /** Says what the number is *for*, which is why it cannot be skipped. */
    guardianPhoneHint: 'ফলাফল আর ফির SMS এই নম্বরে যাবে',
    /** Shown as they type, not after they submit — see normalizeBdMobile. */
    phoneBad: 'নম্বরটি ঠিক নেই',
    guardianName: 'অভিভাবকের নাম',
    guardianNamePlaceholder: 'মোঃ কামাল হোসেন',
    whichBatch: 'কোন ব্যাচে',
    moreInfo: 'আরও তথ্য',
    studentPhone: 'শিক্ষার্থীর নিজের মোবাইল',
    institution: 'স্কুল / কলেজ',
    institutionPlaceholder: 'ঢাকা কলেজ',
    classLevel: 'শ্রেণি',
    classPlaceholder: 'HSC ২য় বর্ষ',
    code: 'আইডি নম্বর',
    /** The centre's own roll number, if it keeps one. Unique per centre. */
    codeHint: 'সেন্টারের নিজের রোল বা আইডি, থাকলে',
    codePlaceholder: '২০২৬-০৪১',
    submit: 'শিক্ষার্থী যোগ করুন',

    /**
     * The edit form's own keys. Everything above is shared with it — the fields are
     * the same fields, and a second copy of "অভিভাবকের মোবাইল" is a second thing
     * to keep in step.
     */
    statusLabel: 'অবস্থা',
    /**
     * Says what the status *does*, because the consequence is the whole reason an
     * owner comes here: a student marked বন্ধ stops being billed next month, and
     * one left সক্রিয় keeps getting invoices after they have gone.
     */
    statusHint: 'বন্ধ করলে পরের মাস থেকে আর বিল হবে না। আগের বিল আর রসিদ ঠিক থাকবে।',
    status: {
      active: 'সক্রিয়',
      /** Reversible in the owner's head — "আপাতত আসছে না" — so the batches pause. */
      inactive: 'আপাতত বন্ধ',
      graduated: 'পাস করেছে',
      dropped: 'ছেড়ে দিয়েছে',
    },
    /** Ticking and unticking is the whole batch-change UI, so it says so. */
    batchHint: 'টিক দিলে ব্যাচে যোগ হবে, টিক তুলে দিলে ওই ব্যাচ থেকে বাদ যাবে',
  },

  /**
   * The paste box and its preview — everything an owner reads *before* the
   * import runs. What it says back afterwards is settings.import.
   *
   * Every count here is a `{n}` template rather than a function, and this is the
   * screen the exception in this file's header was written for: the tallies move
   * as the owner types into the box, so there is no server render that could
   * resolve them. ./fill.ts does it in the browser. Which means English cannot
   * inflect on any of these numbers, so each sentence is worded to read correctly
   * at one as well as at forty — '{n} will be skipped', not '{n} lines'.
   *
   * `tooMany` and `overRoom` are the same two sentences settings.import.errors
   * gives back, because the form disables the button and the action refuses again
   * on its own, so one bad paste can produce either — and being told two
   * different things about one problem reads as a second problem.
   */
  importForm: {
    /** Follows the action's success line, after a separator. */
    viewList: 'তালিকা দেখুন',
    label: 'নামের তালিকা',
    /**
     * Says what the parser forgives. An owner who believes the format is strict
     * spends the evening retyping a notebook into columns, which is the evening
     * this screen exists to give back. See bd/roster for what is actually true.
     */
    hint: 'প্রতি লাইনে একজন — নাম আর অভিভাবকের মোবাইল। ক্রমিক নম্বর, কমা বা ড্যাশ থাকলে অসুবিধা নেই, আর নাম আগে না নম্বর আগে সেটাও দেখা হয় না।',
    /**
     * Three lines, each demonstrating one thing the parser tolerates: bare
     * name-then-number, a guardian's name in the middle, and a serial number
     * written in Bangla numerals. The English list keeps the shapes and drops
     * the Bangla digits — that reader's keypad does not type them.
     */
    placeholder:
      'রাফিদ হাসান 01712345678\nসাদিয়া আক্তার, করিম মিয়া, 01812345678\n৩। তানভীর ইসলাম ০১৯১২৩৪৫৬৭৮',
    /**
     * The three tallies above the box. ASCII numerals in both languages, like
     * every count: the owner is reading them against the register in their hand.
     */
    fresh: '{n} জন নতুন',
    alreadyThere: '{n} জন আগেই আছে',
    /** Not "failed" — nothing has been written yet, so nothing has failed. */
    willSkip: '{n} লাইন বাদ পড়বে',
    tooMany: 'একবারে সর্বোচ্চ {max} লাইন দিন, বাকিগুলো পরের বার। এখানে {got} লাইন আছে।',
    overRoom: 'এই প্ল্যানে আর {room} জন যোগ করা যাবে, কিন্তু তালিকায় {fresh} জন নতুন।',
    problemsTitle: 'এই লাইনগুলো যোগ হবে না — ঠিক করে আবার দিন',
    moreProblems: 'আরও {n} লাইনে সমস্যা আছে।',
    /** Collapsed by default: reassurance, not a step. */
    readyTitle: 'যা পড়া গেছে দেখে নিন ({n})',
    guardian: 'অভিভাবক: {name}',
    alreadyOn: 'আগেই আছে',
    /**
     * A line with two numbers in it: one of them became the guardian's. This
     * names the others, so an owner can see that a student's own mobile was
     * ignored rather than quietly filed as the parent's.
     */
    dropped: 'বাদ: {numbers}',
    previewNote: 'প্রথম {shown} জন দেখানো হলো, বাকিরাও যোগ হবে।',
    whichBatch: 'সবাইকে কোন ব্যাচে ভর্তি করব',
    whichBatchBody:
      'এই তালিকার সবাই একই ব্যাচে যাবে। আলাদা ব্যাচ হলে ব্যাচ ধরে ধরে তালিকা দিন।',
    submit: '{n} জন যোগ করুন',
    /** Nothing readable in the box yet, so the button is disabled beside it. */
    submitEmpty: 'যোগ করুন',
    /**
     * Keyed by RosterProblem, so adding a parse failure in bd/roster without a
     * label for it is a type error rather than a blank line in the preview.
     */
    problem: {
      'no-phone': 'নম্বর নেই',
      'bad-phone': 'নম্বরটি ঠিক নেই',
      'no-name': 'নাম নেই',
      'name-too-long': 'নামটি অনেক বড় — এটা কি নাম?',
      duplicate: 'এই তালিকায় দুইবার',
    },
  },

  /**
   * The five permission switches, keyed by the column each one writes.
   *
   * One home for two client components. The add form ticks these boxes and the
   * list edits them afterwards, and an owner who granted 'ফি দেখা' on one screen
   * has to meet that same sentence on the other or they will not believe it is
   * the same switch. Keyed by column name, so a permission added to
   * @/lib/permissions without a label here is a type error rather than a blank
   * row in a fieldset.
   *
   * Every one has a hint, and each hint says something its label does not. Both
   * screens can afford them: the form shows them under each label, and the list
   * shows them the moment an owner opens the collapsed panel — which is the
   * moment they are deciding whether to hand something over.
   */
  teacherPermissions: {
    can_manage_exams: {
      label: 'পরীক্ষা ও নম্বর',
      hint: 'পরীক্ষা তৈরি করা আর নম্বর দেওয়া',
    },
    can_send_sms: {
      label: 'অভিভাবককে SMS',
      hint: 'নম্বর দেওয়ার পর অভিভাবককে SMS পাঠাতে পারবেন',
    },
    can_manage_students: {
      /**
       * "ভর্তি" and not "সম্পাদনা". This used to read শিক্ষার্থী যোগ ও সম্পাদনা with a
       * hint promising the teacher could change a guardian's mobile number — and
       * nobody could, at any rank: there is no edit-a-student screen in this product
       * for the owner either. 20260811000019 grants what the screens actually do,
       * which is read the roster and admit a student, and the label had to come back
       * down to meet it.
       */
      label: 'শিক্ষার্থী ভর্তি',
      /**
       * Names the number, because that is what really changes hands here: the grant
       * is the whole centre's roster, not this teacher's own batches, and an owner
       * deciding whether to tick it is deciding about every parent's contact.
       */
      hint: 'পুরো কোচিংয়ের শিক্ষার্থী তালিকা ও অভিভাবকের নম্বর দেখা, নতুন ভর্তি করা',
    },
    can_manage_batches: {
      /** Same correction: opening a batch is granted, changing one is not built. */
      label: 'নতুন ব্যাচ খোলা',
      hint: 'বিষয়, সময়, কোন দিন ক্লাস আর মাসিক ফি ঠিক করে নতুন ব্যাচ খোলা',
    },
    can_view_fees: {
      label: 'ফি দেখা',
      /**
       * Names the second limit in the money's own words. An owner ticking this
       * wants to know whether they have just handed someone their till — so the
       * sentence that answers that goes in the hint, not in a help page.
       */
      hint: 'নিজের ব্যাচের কে টাকা দিয়েছে, কত বাকি। টাকা জমা নিতে পারবেন না।',
    },
  },

  /**
   * The staff list, and the panel behind each row where permissions change.
   *
   * Only reachable on a plan with staff on it — a one-teacher plan gets
   * settings.teachers.soloTitle instead of any of this.
   */
  teacherList: {
    /** A teacher who has been turned off. Their marks and hajira stay put. */
    inactive: 'বন্ধ',
    /** A record with no account behind it — see teacherForm.loginNow. */
    noLogin: 'লগইন নেই',
    /** Collapsed: reading the list is the common case, editing is the rare one. */
    edit: 'অনুমতি বদলান',
    save: 'অনুমতি সেভ করুন',
    /**
     * Says what turning a teacher off does and, just as importantly, what it does
     * not. An owner hesitates over this button because they are afraid of
     * deleting a term's attendance along with the person.
     */
    deactivateBody:
      'বন্ধ করলে তিনি আর তাঁর ব্যাচ, শিক্ষার্থী বা অভিভাবকের নম্বর দেখতে পাবেন না। আগের হাজিরা আর নম্বর মুছে যাবে না।',
    reactivateBody: 'চালু করলে তিনি আবার তাঁর ব্যাচের হাজিরা ও নম্বর দিতে পারবেন।',
    deactivate: 'শিক্ষককে বন্ধ করুন',
    reactivate: 'আবার চালু করুন',
  },

  /**
   * Adding a teacher.
   *
   * Two separable things get made here — a record of a teacher, and a login for
   * them — and the copy has to keep them separable, because the part-timer who
   * takes two batches a week and will never open the app still has to exist.
   * loginNowBody is what stops an owner abandoning the form looking for the
   * password of somebody who does not need one.
   */
  teacherForm: {
    nameLabel: 'শিক্ষকের নাম',
    namePlaceholder: 'করিম স্যার',
    phone: 'মোবাইল নম্বর',
    /** Optional field, so the hint says what giving it would buy. */
    phoneHint: 'লগইন দিতে চাইলে এই নম্বরটাই তাঁর আইডি হবে',
    /** As they type, not on submit — the same words studentForm uses. */
    phoneBad: 'নম্বরটি ঠিক নেই',
    whichSubjects: 'কোন বিষয় পড়ান',
    whatTheyCanDo: 'কী কী করতে পারবেন',
    loginNow: 'এখনই লগইন দিন',
    loginNowBody:
      'না দিলেও শিক্ষক যোগ হবে — আপনি নিজেই তাঁর ব্যাচের হাজিরা ও নম্বর দিতে পারবেন। পরে যেকোনো সময় লগইন দেওয়া যাবে।',
    password: 'শুরুর পাসওয়ার্ড',
    /** It is typed in the clear on purpose: the teacher is standing right there. */
    passwordHint: 'শিক্ষককে বলে দিন — তিনি পরে নিজে বদলে নিতে পারবেন',
    passwordPlaceholder: 'যেমন 123456',
    passwordNote:
      'লগইন দিলে শিক্ষক নিজের ফোন থেকে হাজিরা ও নম্বর দিতে পারবেন। উপরে যেসব অনুমতি টিক দেওয়া আছে, শুধু সেগুলোই তিনি করতে পারবেন।',
    /** Never ticked by default — see settings.teachers.confirmLink for why. */
    confirmLink: 'হ্যাঁ, এটাই তিনি — অ্যাকাউন্টটি যুক্ত করুন',
    /**
     * Shown after an existing account was joined, beside the name it belonged
     * to. This is the one screen where a mistyped digit becomes visible, so it
     * says what to do about it rather than congratulating anybody.
     */
    wrongPerson:
      'নামটা মিলছে না? তাহলে নম্বরে ভুল হয়েছে — শিক্ষকের তালিকা থেকে তাঁকে বন্ধ করে দিন, তাহলে তিনি আর কিছু দেখতে পাবেন না।',
    seeList: 'শিক্ষকের তালিকা দেখুন',
    submit: 'শিক্ষক যোগ করুন',
  },

  /**
   * The centre's own name and the number a parent sends fees to.
   *
   * Every string here is on one screen, and the screen is unusual: it shows the
   * real SMS as the owner types, because the two fields compete for the same 70
   * characters. So the copy has to explain a consequence rather than label a
   * field — which is why the three verdict lines below are sentences and not
   * badges.
   */
  centerForm: {
    nameLabel: 'কোচিংয়ের নাম',
    nameHint: 'প্রতিটি SMS-এর শেষে এই নামই যাবে, তাই ছোট নাম হলে ভালো',
    /** The question, not the field: an owner is choosing an app here, not a word. */
    walletLegend: 'অভিভাবক কোথায় টাকা পাঠাবেন',
    walletHint: 'ফি-এর বার্তায় এই নম্বরটি লেখা থাকবে',
    /** Its own key rather than part of `wallets`, which is keyed by the enum. */
    walletNone: 'কোনোটাই না',
    /**
     * Filled in the browser, because which wallet is selected is client state.
     * See the note in ./index.ts about `{n}` templates — a function could not
     * cross into this form at all.
     */
    numberLabel: '{wallet} নম্বর',
    numberHint: 'যে নম্বরে টাকা আসবে — ১১ সংখ্যা, যেমন 01712345678',
    /** Also filled in the browser: the month is data, the sentence is copy. */
    previewTitle: '{month} মাসের ফি-এর বার্তা দেখতে এমন হবে',
    /**
     * Two counts on one line, each in its own element so the numbers can be
     * styled — hence two keys and no template. ASCII in both languages: this is
     * a measurement the owner checks against a phone bill.
     */
    chars: '{n} অক্ষর',
    smsCount: '{n}টি SMS',
    /**
     * The three verdicts, in order of how much they ask of the owner: nothing,
     * shorten the name if you like, shorten the name or lose the number.
     *
     * Each says what happens to the *parent*, because that is the consequence the
     * owner is deciding about. "নম্বর বাদ যাবে" on its own reads as an app fault;
     * naming WhatsApp says the fee is still collectable either way.
     */
    fitsAll: 'সব শিক্ষার্থীর বার্তায় নম্বরটি থাকবে',
    fitsSome:
      'লম্বা নামের কিছু শিক্ষার্থীর বার্তা থেকে নম্বরটি বাদ যাবে। নাম ছোট করলে সবার বার্তাতেই জায়গা হবে।',
    fitsNone:
      'নামটি লম্বা হওয়ায় SMS-এ নম্বরের জায়গা হচ্ছে না। কোচিংয়ের নাম ছোট করলে হবে — WhatsApp-এ নম্বরটি সবসময়ই যাবে।',
  },

  /**
   * The opt-out switches on the SMS screen.
   *
   * Short, because every row already carries a name and a number and the button
   * is the whole interaction — there is no save step to explain.
   */
  optOutList: {
    title: 'কে SMS পাবে না',
    /** A guardian number the centre never got. Not an error: plenty are missing. */
    noNumber: 'নম্বর নেই',
    /** On the switch itself: what is true now, not what tapping it does. */
    on: 'চালু',
    off: 'বন্ধ',
    /**
     * The screen-reader label, which has to say what the tap *does* — the visible
     * word says what the state is, and a button reading "চালু" that turns SMS off
     * is unusable without eyes on the colour. Filled in the browser: the name is
     * per row and the direction flips on every tap.
     */
    turnOn: 'SMS চালু করুন — {name}',
    turnOff: 'SMS বন্ধ করুন — {name}',
  },

  /**
   * What a sent batch of messages was about, in the ledger.
   *
   * One word each: the row already carries a date, a headcount and a credit cost,
   * and the kind is what the owner scans down the column for. Keyed by
   * sms_dispatches.kind, so a sixth kind added to the enum without a word here is
   * a compile error rather than a raw 'attendance_alert' on the receipt.
   */
  smsKinds: {
    exam_result: 'ফলাফল',
    attendance_alert: 'হাজিরা',
    fee_reminder: 'ফি',
    notice: 'নোটিশ',
    custom: 'অন্য',
  },

  dashboard: {
    title: 'ড্যাশবোর্ড',
    outstanding: 'বকেয়া ফি',
    nobodyOverdue: 'কারও সময় পেরোয়নি',
    /** Three tiles across a 375px screen, so these wrap rather than truncate. */
    collected: 'এ মাসে আদায়',
    students: 'শিক্ষার্থী',
    batches: 'ব্যাচ',

    todayAttendance: 'আজকের হাজিরা',
    batchesTaken: (done: number, total: number) => `${done}/${total} ব্যাচ নেওয়া হয়েছে`,

    overdueTitle: 'সময় পেরোনো ফি',

    addStudentsTitle: 'শিক্ষার্থী যোগ করুন',
    addStudentsBody:
      'ব্যাচ আর শিক্ষার্থী যোগ করলে হাজিরা, ফলাফল আর ফি — সব এখানে দেখাবে।',

    ratesTitle: 'ব্যাচভিত্তিক হাজিরা',
    ratesFallback: 'এ মাসে এখনো হাজিরা নেওয়া হয়নি — গত মাসের হিসাব দেখানো হচ্ছে',
    /**
     * The reading of a rate, keyed by band. Not decoration: the house rule is
     * that a present/absent colour never travels alone, and a green 91% beside a
     * red 58% is exactly that. The thresholds live with the colours in the card;
     * only the words are here.
     */
    bands: {
      good: 'ভালো',
      fair: 'মাঝারি',
      low: 'কম',
    },
    /** A batch whose every mark was 'excused' — not a batch that ran at 0%. */
    noRate: 'হিসাব নেই',
    allExcused: 'সব ছুটি মঞ্জুর করা',
    /**
     * Both follow a number that is set in its own element, so only the word is
     * here — and both are functions because English inflects on a count that
     * Bangla ignores. "৯ দিন ক্লাস · ৩৫০ হাজিরার হিসাব".
     */
    classDays: (_n: number) => 'দিন ক্লাস',
    countedMarks: (_n: number) => 'হাজিরার হিসাব',
    /** Unreachable through the view — batches.name is not null. */
    unknownBatch: 'অজানা ব্যাচ',
  },
  /**
   * The students who are quietly leaving — `student_risk` put into words.
   *
   * Every threshold is in 20260811000014_student_risk.sql and not one of them is
   * repeated here; the view says which arm fired and this group only names it. So
   * there is no '৭০%' or '৭ দিন' in any string below, on purpose: the day somebody
   * tunes a threshold in the migration, none of this wording goes stale.
   *
   * The figures are not interpolated either. They are rendered in their own `.num`
   * elements beside these words, the same as `dashboard.classDays`, because a
   * Bangla sentence with a percentage in it ends up reading "৫৫% হাজিরা, আগে ছিল
   * ৮৮%" — two numeral systems in one line, which is harder to read than either
   * convention alone. Words here, digits there.
   */
  risk: {
    /** Matches the nav entry and the page heading. */
    title: 'ঝুঁকিতে আছে',
    /**
     * Under the heading. Says what the screen is *for*, because "ঝুঁকি" alone
     * invites the reading that these students are failing — the point is that they
     * are drifting away, which is a different problem with a different fix.
     */
    lead: 'যারা চুপচাপ ছেড়ে দিতে পারে — আজই এক মিনিটের একটা ফোন যাদের ধরে রাখতে পারে।',
    /** Follows a count in its own element: '৫ জন শিক্ষার্থী'. */
    count: (_n: number) => 'জন শিক্ষার্থী',
    /** Also follows a count: '২টি লক্ষণ'. */
    signalCount: (_n: number) => 'টি লক্ষণ',
    /**
     * What to do, not how bad it is. An owner reading 'মাঝারি' has to work out for
     * themselves what that asks of them, and the whole value of this screen is
     * that the translation already happened.
     */
    levels: {
      watch: 'খেয়াল রাখুন',
      talk: 'কথা বলুন',
      call: 'আজই ফোন করুন',
    },
    /**
     * One label per arm of the view. Each is followed by the figures behind it, so
     * these stay short enough to sit on one line of a phone beside a percentage.
     */
    reasons: {
      attendanceLow: 'হাজিরা কম',
      attendanceFell: 'হাজিরা কমে গেছে',
      marksLow: 'নম্বর কম',
      marksFell: 'নম্বর পড়ে গেছে',
      /** Follows the count: '২ পরীক্ষায় অনুপস্থিত'. */
      examsMissed: (_n: number) => 'পরীক্ষায় অনুপস্থিত',
      feeLate: 'ফি বাকি',
    },
    /** Introduces the earlier figure after a separator: '· আগে ৮৮%'. */
    was: 'আগে',
    /** Follows a day count: '১২ দিন'. */
    days: (_n: number) => 'দিন',
    /**
     * When a percentage exists but nothing was marked to build it from. Same words
     * as dashboard.noRate, because a number missing on two screens for one reason
     * should not have two names.
     */
    noFigure: 'হিসাব নেই',
    /** The good case, and the one an owner should see most months. */
    empty: 'এখন কেউ ঝুঁকিতে নেই',
    emptyHint: 'হাজিরা, পরীক্ষার ফল আর ফি — তিনটির কোনোটিতেই কারও খারাপ লক্ষণ নেই।',
    /** The dashboard card's link to the full list. */
    seeAll: 'সবাইকে দেখুন',
    /** On a row, opening the guardian's number in the phone dialler. */
    callGuardian: 'অভিভাবককে ফোন',
    noPhone: 'নম্বর নেই',
    /** Unreachable through the view — students.name is not null. */
    noName: 'নাম দেওয়া নেই',
    /**
     * The footnote. The only place the windows are stated, and stated in Bangla
     * numerals because this line has no percentage in it to clash with.
     */
    windows: 'হাজিরা শেষ ৩০ দিনের হিসাব, নম্বর শেষ ১২০ দিনের।',
  },
  /**
   * A student's or guardian's own screen — the counterpart to `dashboard`.
   *
   * Deliberately small, because this reader cannot act on any of it: they cannot
   * mark attendance, record a payment or change a fee, so every string is a
   * statement of fact and none of them is a button.
   *
   * The two words that are *not* here are the point. `attendance.absent` and
   * `fees.inCredit` come from the groups the owner reads, because a parent who
   * rings the centre about a figure has to be talking about the same figure in
   * the same words.
   */
  me: {
    /** Matches shell.nav.mine — the tab and the page title should agree. */
    title: 'আমার',
    due: 'বকেয়া',
    /**
     * Follows the amount after a separator: 'বকেয়া ৳1,500 · সময় পেরিয়ে গেছে'.
     * Not a count of late invoices — a parent needs to know a date has passed,
     * not how many of them did.
     */
    overdue: 'সময় পেরিয়ে গেছে',
    allPaid: 'সব ফি পরিশোধ করা আছে ✓',
    recentResults: 'সাম্প্রতিক ফলাফল',
    /**
     * No students came back at all: either the centre has not linked this phone
     * to a child yet, or it linked a different number. Both are the centre's to
     * fix, so the sentence sends them there instead of suggesting they retry.
     */
    noRecords: 'আপনার তথ্য এখনও যোগ করা হয়নি। কোচিং সেন্টারে যোগাযোগ করুন।',
  },

  /**
   * Everything an owner configures, and everything those writes say back.
   *
   * One group for seven entities rather than seven groups, because the failures
   * are the same five sentences with a different noun in them — a refused insert
   * reads identically whether it was a subject or a teacher — and seven copies of
   * "যোগ করা যায়নি" is seven chances to fix six of them. What is genuinely the
   * entity's own sits under the entity: only a batch has a start time, only an
   * import has a row limit.
   *
   * Read by the actions, not by the forms. Every string here is returned from a
   * Server Action and arrives at the form already written, which is why the
   * counted ones are functions — see `T` in ./index.ts. The forms' own labels are
   * separate groups below, one per form, because those do cross the wire.
   */
  settings: {
    /** The two success words the smaller forms share. */
    added: 'যোগ হয়েছে',
    saved: 'সেভ হয়েছে',

    errors: {
      /**
       * Names both roles, because a manager reading "আপনার অনুমতি নেই" on the
       * one screen they are not allowed to touch has no way to tell a permission
       * boundary from a bug. `center` below draws the line one step higher and
       * says so separately.
       */
      forbidden: 'এই কাজটি শুধু মালিক বা ম্যানেজার করতে পারেন।',
      /**
       * For the screens a teacher *can* be given: শিক্ষার্থী ভর্তি আর ব্যাচ খোলা।
       * `forbidden` above would tell them only an owner or a manager may do it,
       * which is now untrue and sends them to ask for the wrong thing — the answer
       * is one checkbox on their own row, so the sentence says whose checkbox.
       */
      notPermitted: 'মালিক আপনাকে এই কাজের অনুমতি দেননি।',
      /**
       * Says what to do about it and that nothing gets taken away. An owner who
       * hits this is a paying customer three taps later or never, and "সীমা শেষ"
       * on its own reads as a wall.
       *
       * "এই প্ল্যান" and not "ফ্রি প্ল্যান": every tier below `center` has caps, so
       * this sentence is shown to paying centres too, and telling one of them
       * their free plan is full reads as the app having lost track of what they
       * bought. Which plan it is gets named on the screen, next to the number.
       *
       * It used to end "সব ফিচার খোলা থাকবে" — every feature stays open. That was
       * true when every tier carried every feature and is a lie now: a free
       * teacher has no printed receipt, no export and no parent summary. A
       * reassurance the reader can disprove in two taps is worse than none.
       */
      planLimit:
        'এই প্ল্যানের সীমা শেষ। আরও যোগ করতে প্ল্যান বদলাতে হবে।',
      /**
       * A different refusal from `planLimit`, and it has to be: the centre has
       * room for the student, just not in that batch. So it names the batch and
       * offers the move before it offers the upgrade — an owner with four batches
       * and one full one does not need to pay us anything to fix this.
       */
      batchFull: (batches: string, cap: number) =>
        `${batches} — এই ব্যাচে আর জায়গা নেই। এই প্ল্যানে এক ব্যাচে সর্বোচ্চ ${digits(cap, 'bn')} জন। অন্য ব্যাচে দিন, বা প্ল্যান বদলান।`,
      /**
       * Not a cap being hit — a feature that does not exist on this plan. Worded
       * as what the centre tier is for, because the owner did nothing wrong.
       */
      staffNeedsCenter: 'একাধিক শিক্ষক আর অনুমতি কোচিং সেন্টার প্ল্যানের ফিচার।',
      addFailed: 'যোগ করা যায়নি। আবার চেষ্টা করুন।',
      createFailed: 'তৈরি করা যায়নি। আবার চেষ্টা করুন।',
      /**
       * One sentence for both saves. The centre form used to say 'সেভ হয়নি' and
       * the permission checkboxes 'সেভ করা যায়নি' — one event described two ways,
       * which in English was always going to be the same string.
       */
      saveFailed: 'সেভ করা যায়নি। আবার চেষ্টা করুন।',
      changeFailed: 'বদলানো যায়নি। আবার চেষ্টা করুন।',
    },

    /**
     * The hub itself: one row per thing an owner can shape, each with a count so
     * the empty ones are visible. The labels are short because they sit above a
     * hint that truncates on a 375px phone.
     */
    hub: {
      /** Also the page title, and the label on every back link that returns here. */
      title: 'সেটিংস',
      smsCredits: 'SMS ক্রেডিট',
      details: 'বিস্তারিত',
      /**
       * The one hint that answers a question rather than describing a screen:
       * either the number a parent will be told to pay, or the fact that there
       * isn't one. An owner who has not set this is losing fees to a question
       * they currently answer by hand.
       *
       * The number arrives already grouped by `formatBdMobile`, so it reads the
       * way it is written on a bKash receipt in either language.
       */
      feesGoTo: (number: string) => `ফি যাবে ${number} নম্বরে`,
      noPaymentNumber: 'পেমেন্ট নম্বর এখনো দেওয়া হয়নি',
      center: 'নাম ও পেমেন্ট',
      students: 'শিক্ষার্থী',
      studentsHint: 'নাম, অভিভাবকের নম্বর, ব্যাচ',
      batches: 'ব্যাচ ও সময়',
      batchesHint: 'সকাল / দুপুর / বিকাল / সন্ধ্যা, কোন দিন ক্লাস',
      subjects: 'বিষয়',
      subjectsHint: 'গণিত, পদার্থ, ইংরেজি — আপনার নিজের তালিকা',
      teachers: 'শিক্ষক ও অনুমতি',
      teachersHint: 'কে কী করতে পারবে',
      examTypes: 'পরীক্ষার ধরন',
      examTypesHint: 'সাপ্তাহিক, মডেল টেস্ট, মাসিক — যা আপনি নেন',
      sms: 'SMS',
      smsHint: 'ক্রেডিট, কে SMS পাবে না',
      /**
       * The plan the centre is actually on. This line used to read "ফ্রি প্ল্যান:
       * ১টি ব্যাচ" to everybody, including a centre paying for unlimited batches.
       *
       * A batch count inside a sentence takes Bangla numerals, unlike the tallies
       * on the rows above it — those are read off against a register, this is
       * prose. English inflects on it, which is why both are functions.
       */
      plan: (name: string, batches: number) =>
        `${name} প্ল্যান: ${digits(batches, 'bn')}টি ব্যাচ।`,
      planUnlimited: (name: string) =>
        `${name} প্ল্যান: ব্যাচ যত লাগে।`,
      /**
       * The row that leads to the price screen. It has no hint of its own — the
       * sentence above is the hint, because the plan a centre is on is more use to
       * them than a description of the screen behind the link.
       */
      plans: 'প্ল্যান ও দাম',
    },

    /**
     * The plan screen: what this centre is on, what that includes, and what the
     * next tier costs.
     *
     * It exists because half a dozen screens now name a plan the reader had no way
     * to look up. A locked feature that says "শিক্ষক প্রো-তে পাবেন" with no price
     * anywhere in the app is a dead end, and a dead end is where a trial stops.
     *
     * Counts inside sentences take Bangla numerals; the usage tallies do not, on
     * the same split the hub uses — prose is read, a tally is checked. Taka is
     * always ASCII, in both languages, because it gets re-typed into bKash.
     */
    plan: {
      title: 'প্ল্যান ও দাম',
      onNow: (name: string) => `আপনি এখন ${name} প্ল্যানে`,
      freePrice: 'কোনো খরচ নেই',
      monthly: (taka: string) => `মাসে ${taka}`,
      /** The centre tiers have no list price — the calculator below is the price. */
      sized: 'সেন্টারের আকার অনুযায়ী',
      from: (taka: string) => `${taka} থেকে শুরু`,

      usageTitle: 'এখন যা ব্যবহার হচ্ছে',
      batches: 'ব্যাচ',
      students: 'শিক্ষার্থী',
      subjects: 'বিষয়',
      teachers: 'শিক্ষক',
      noCap: 'সীমা নেই',
      perBatchCap: (cap: number) =>
        `এক ব্যাচে সর্বোচ্চ ${digits(cap, 'bn')} জন।`,

      haveTitle: 'এই প্ল্যানে আছে',
      lackTitle: 'এই প্ল্যানে নেই',
      attendance: 'হাজিরা',
      exams: 'পরীক্ষা ও নম্বর',
      fees: 'ফি আর বাকির হিসাব',
      messaging: 'নিজের ফোন থেকে SMS, WhatsApp, কল',
      receipts: 'ছাপানো রসিদ ও আদায় খাতা',
      staff: 'শিক্ষক যোগ করা আর অনুমতি ভাগ করা',
      /**
       * Why the list is six rows and not twelve.
       *
       * The plan engine knows about export, the weekly guardian summary and
       * branches; none of the three is built. Listing them with a tick beside a
       * paid tier would be selling something that does not exist, which is the
       * one thing a price screen cannot do and survive.
       */
      onlyBuilt: 'যা এখন সত্যিই কাজ করছে শুধু তাই এই তালিকায়। নতুন কিছু চালু হলে যোগ হবে।',

      ladderTitle: 'প্ল্যানগুলো',
      /** One line each: what the tier is for, not a feature list. */
      addsFree: 'দেখে নেওয়ার জন্য — ১টি ব্যাচ, ৩০ জন শিক্ষার্থী।',
      addsPro: 'একজন শিক্ষকের পুরো কোচিং — ৫টি ব্যাচ, ১৫০ জন, ছাপানো রসিদ আর আদায় খাতা।',
      addsCenter: 'শিক্ষক যোগ করা যায়, ব্যাচ-শিক্ষার্থীর সীমা নেই। দাম শিক্ষার্থী সংখ্যা অনুযায়ী।',
      addsInstitution: 'একাধিক শাখা এক হিসাবের নিচে। কথা বলে ঠিক করা হয়।',
      current: 'এখন এটিতেই আছেন',

      contactTitle: 'প্ল্যান বদলাতে চান?',
      contactBody:
        'একটা মেসেজ দিন বা ফোন করুন — কত শিক্ষার্থী, কত শিক্ষক, সেটা শুনে দাম বলে দেওয়া হবে।',
      contactWhatsapp: 'WhatsApp',
      contactCall: 'ফোন করুন',
      /**
       * Prefilled, because a message an owner has to compose is a message they do
       * not send. It names the centre and the plan so the first reply can be an
       * answer instead of two questions.
       */
      contactMessage: (center: string, plan: string) =>
        `আসসালামু আলাইকুম। আমি ${center} থেকে বলছি, এখন ${plan} প্ল্যানে আছি। প্ল্যান নিয়ে কথা বলতে চাই।`,
    },

    subjects: {
      title: 'বিষয়',
      /** Without a plan cap, the count on its own. ASCII: it is a tally. */
      count: (n: number) => `${n}টি বিষয়`,
      /** With one, how much of it is spent — so the next add is not a surprise. */
      used: (n: number, limit: number) => `${n}/${limit}টি বিষয় ব্যবহার হয়েছে`,
      /** How many batches teach it. Follows a number set in its own element. */
      batches: (_n: number) => 'ব্যাচ',
      capTitle: 'এই প্ল্যানে আর বিষয় যোগ করা যাবে না',
      /**
       * Names the plan and its number, because `errors.planLimit` deliberately
       * does not — a form's error line is not the place for a rate card. Bangla
       * numerals here: this one is a sentence, not a tally.
       */
      cap: (name: string, limit: number) =>
        `${name} প্ল্যানে ${digits(limit, 'bn')}টি বিষয়।`,
      nameLabel: 'বিষয়ের নাম',
      /**
       * True for whoever is reading it: a Bangla reader's lists show `name_bn`,
       * an English reader's show `name`. So the English hint says the opposite
       * thing and both are correct — see `localName`.
       */
      nameHint: 'যেমন Mathematics — তালিকায় বাংলা নামটাই দেখানো হবে',
      errors: {
        nameRequired: 'বিষয়ের নাম লিখুন।',
        /** The unique index on (centre, name). More use than a Postgres string. */
        duplicate: 'এই নামে বিষয় আগেই আছে।',
      },
    },

    examTypes: {
      title: 'পরীক্ষার ধরন',
      subtitle: 'আপনার সেন্টার যে ধরনের পরীক্ষা নেয়, সেভাবেই লিখুন',
      /** How many exams of this kind have been held. Follows its own number. */
      exams: (_n: number) => 'পরীক্ষা',
      nameLabel: 'ধরনের নাম',
      errors: {
        nameRequired: 'পরীক্ষার ধরনের নাম লিখুন।',
        duplicate: 'এই নামে ধরন আগেই আছে।',
      },
    },

    batches: {
      title: 'ব্যাচ ও সময়',
      /** Without a plan cap, the count on its own. ASCII: it is a tally. */
      count: (n: number) => `${n}টি ব্যাচ`,
      /** With one, how much of it is spent — the same line the subject list shows. */
      used: (n: number, limit: number) => `${n}/${limit}টি ব্যাচ`,
      /** On the button that starts a new one. Short: it sits beside the heading. */
      new: 'নতুন',
      emptyTitle: 'এখনও কোনো ব্যাচ নেই',
      /**
       * Says what a batch is *for*, not what it is. An owner on this screen has
       * nothing else set up either, and the useful thing to tell them is which two
       * features unlock the moment they finish here.
       */
      emptyBody:
        'ব্যাচ মানে একটি নির্দিষ্ট সময়ের ক্লাস। ব্যাচ বানালে শিক্ষার্থী যোগ করা যাবে, হাজিরা নেওয়া যাবে।',
      /** What a batch with no day-schedule means — see createBatch's own note. */
      everyDay: 'প্রতিদিন',
      /** Under the fee, so it is not read as the price of the whole course. */
      monthly: 'মাসিক',
      /** How many are enrolled. Follows a number set in its own element. */
      people: (_n: number) => 'জন',
      /** A batch switched off. Its rows and its history stay exactly where they are. */
      inactive: 'বন্ধ আছে',

      newTitle: 'নতুন ব্যাচ',
      capTitle: 'এই প্ল্যানে আর ব্যাচ যোগ করা যাবে না',
      /**
       * Names the three things the cap does *not* touch. The batch limit is the one
       * an owner meets first, and it is the moment the app either reads as a trial
       * with its features locked or as a smaller version of the whole thing.
       *
       * Attendance, exams and fees, and no longer SMS — tap-to-send is on every
       * tier and always will be, but naming SMS next to a cap invited the reading
       * that a metered allowance comes with the plan, and none does.
       */
      cap: (name: string, limit: number) =>
        `${name} প্ল্যানে ${digits(limit, 'bn')}টি ব্যাচ। হাজিরা, পরীক্ষা, ফি — সবই খোলা, শুধু ব্যাচের সংখ্যায় সীমা।`,
      needSubjectTitle: 'আগে একটি বিষয় যোগ করুন',
      needSubjectBody:
        'ব্যাচ কোন বিষয়ের, সেটা ছাড়া নম্বর আর ফি ঠিক জায়গায় বসবে না।',
      addSubject: 'বিষয় যোগ করুন',

      created: 'ব্যাচ তৈরি হয়েছে',
      errors: {
        nameRequired: 'ব্যাচের নাম লিখুন।',
        pickSubject: 'বিষয় বাছুন।',
        feeUnreadable: 'মাসিক ফি ঠিকভাবে লিখুন।',
        endBeforeStart: 'শেষের সময় শুরুর সময়ের পরে হতে হবে।',
        /**
         * batch_schedules needs both times, so days without them would create
         * the batch and drop the schedule — which looks exactly like a batch
         * that meets every day.
         */
        daysNeedTimes: 'কোন দিন ক্লাস তা বাছলে শুরু ও শেষের সময়ও দিতে হবে।',
        duplicate: 'এই নামে ব্যাচ আগেই আছে।',
        /**
         * Half-succeeded, and says so. Reporting a clean success here would be
         * disproved tomorrow morning, when the batch fails to appear on the
         * teacher's list.
         */
        scheduleFailed:
          'ব্যাচ তৈরি হয়েছে, কিন্তু ক্লাসের দিন সেভ হয়নি। সেটিংস থেকে ঠিক করুন।',
      },
    },

    students: {
      title: 'শিক্ষার্থী',
      /** Without a plan cap, the count on its own. ASCII: it is a tally. */
      count: (n: number) => `${n} জন শিক্ষার্থী`,
      /** With one, how much of it is spent — the same line the batch list shows. */
      used: (n: number, limit: number) => `${n}/${limit} জন শিক্ষার্থী`,
      /** On the button beside the heading. Short: it shares a row with the count. */
      new: 'নতুন',
      /**
       * The bulk paste. Names its ceiling in the same breath, because an owner
       * holding a two-hundred-name register needs that number before they paste,
       * not in an error afterwards.
       */
      importTitle: 'রেজিস্টার থেকে একসাথে যোগ করুন',
      importBody: (max: number) => `নামের তালিকা বসিয়ে দিন — একবারে ${max} জন পর্যন্ত`,
      /**
       * The one missing field that breaks the product silently: everything looks
       * fine until a parent says they never heard anything. Counted, and shown
       * above the list rather than only on the row, because the owner has to know
       * it is worth scrolling for.
       */
      missingPhone: (n: number) => `${n} জনের অভিভাবকের নম্বর নেই`,
      missingPhoneBody: 'নম্বর ছাড়া ফলাফল বা ফির SMS যাবে না।',
      emptyTitle: 'এখনও কোনো শিক্ষার্থী নেই',
      emptyBody:
        'শিক্ষার্থী যোগ করলে হাজিরা, পরীক্ষার নম্বর আর ফি — সব এখানে আসবে।',
      /** A student who has left. Their marks, attendance and bills stay put. */
      inactive: 'বন্ধ',
      noPhone: 'নম্বর নেই',
      /** The guardian asked not to be texted. See channels for where that is set. */
      smsOff: 'SMS বন্ধ',

      newTitle: 'নতুন শিক্ষার্থী',
      capTitle: 'এই প্ল্যানে আর শিক্ষার্থী যোগ করা যাবে না',
      /** Names the plan and its number — see subjects.cap for why, not errors. */
      cap: (name: string, limit: number) =>
        `${name} প্ল্যানে ${digits(limit, 'bn')} জন শিক্ষার্থী।`,
      added: 'শিক্ষার্থী যোগ হয়েছে',

      /**
       * Changing what is already there. The heading is the student's own name, so
       * this is only what sits above it.
       */
      editTitle: 'তথ্য ঠিক করুন',
      /**
       * On the roster row, telling the owner the row is worth tapping. The number
       * on it is the field most likely to be wrong, and until this screen existed
       * there was nothing to be done about a wrong one.
       */
      editHint: 'নম্বর বা নাম ঠিক করতে ট্যাপ করুন',
      saved: 'তথ্য সেভ হয়েছে',
      errors: {
        nameRequired: 'শিক্ষার্থীর নাম লিখুন।',
        /**
         * The example is in Bangla numerals because a Bangla keyboard types them
         * and `normalizeBdMobile` accepts them. The English message shows the
         * same number in ASCII, which is what that reader's keypad gives.
         */
        guardianPhone: 'অভিভাবকের সঠিক মোবাইল নম্বর দিন (যেমন ০১৭১২৩৪৫৬৭৮)।',
        studentPhone: 'শিক্ষার্থীর নম্বরটি ঠিক নেই।',
        /** students.student_code is unique per centre when it is given at all. */
        duplicateCode: 'এই আইডিতে শিক্ষার্থী আগেই আছে।',
        notFound: 'শিক্ষার্থী পাওয়া যায়নি।',
        /** The save itself failed — see errors.addFailed for the add path's twin. */
        saveFailed: 'তথ্য সেভ করা যায়নি।',
      },
    },

    import: {
      title: 'তালিকা থেকে যোগ',
      body: 'রেজিস্টার বা এক্সেল থেকে সব নাম একসাথে বসিয়ে দিন — প্রতি লাইনে একজন।',

      /**
       * Three clauses the action joins with " · ". Separate keys because two of
       * the three are dropped when their count is zero — "৪০ জন যোগ হয়েছে · 0 জন
       * আগেই ছিল" reads as a bug in the importer.
       *
       * Counts of people stay ASCII, as everywhere: an owner reads this line and
       * checks it against the register they just pasted.
       */
      added: (n: number) => `${n} জন যোগ হয়েছে`,
      alreadyThere: (n: number) => `${n} জন আগেই ছিল`,
      enrolled: (n: number) => `${n}টি ব্যাচ ভর্তি হয়েছে`,
      errors: {
        empty: 'তালিকা খালি। প্রতি লাইনে একজনের নাম আর অভিভাবকের নম্বর দিন।',
        /**
         * Both numbers, because "too many lines" without them leaves an owner
         * counting a two-hundred-line paste by hand.
         */
        tooManyRows: (max: number, got: number) =>
          `একবারে সর্বোচ্চ ${max} লাইন দিন, বাকিগুলো পরের বার। এখানে ${got} লাইন আছে।`,
        noneReadable:
          'একটি লাইনও পড়া গেল না। প্রতি লাইনে নাম আর ১১ ডিজিটের মোবাইল নম্বর দরকার।',
        /**
         * The first half of a two-sentence refusal; the action appends
         * `errors.planLimit`. Split that way because the plan sentence is the
         * same everywhere and this one is only true of a paste.
         */
        roomShort: (room: number, fresh: number) =>
          `এই প্ল্যানে আর ${room} জন যোগ করা যাবে, কিন্তু তালিকায় ${fresh} জন নতুন।`,
        failed: 'তালিকা যোগ করা যায়নি। আবার চেষ্টা করুন।',
      },
    },

    sms: {
      optedOut: 'SMS বন্ধ করা হয়েছে',
      optedIn: 'SMS চালু করা হয়েছে',

      /** Latin in a Bangla dictionary, and allowlisted as such — see the test. */
      title: 'SMS',
      balance: 'এখন আছে',
      /**
       * Credits are money, so they stay ASCII in both languages like every other
       * figure an owner checks against something else — here, against what they
       * paid for. Serves the balance and each row's cost; they are the same unit
       * and reading two words for it would suggest they were not.
       */
      credits: (n: number) => `${n} ক্রেডিট`,
      /**
       * The monthly allowance, naming the plan the centre is on. This line used
       * to read `session.plan.nameBn` to an English reader.
       */
      monthly: (plan: string, n: number) =>
        `${plan} প্ল্যানে প্রতি মাসে ${n} ক্রেডিট`,
      /**
       * The one sentence on this screen that is teaching rather than reporting.
       * Every centre assumes 160 characters, because that is what an English SMS
       * holds; a Bangla one holds 70, and an owner who plans around the wrong
       * number concludes we are overcharging them. Takes the capacity as an
       * argument so the sentence cannot drift from the arithmetic that bills it.
       */
      segmentNote: (chars: number) =>
        `বাংলায় এক SMS = ${digits(chars, 'bn')} অক্ষর। এক জন অভিভাবককে একটি বার্তা পাঠালে ${digits(1, 'bn')} ক্রেডিট খরচ হয়।`,

      /**
       * No gateway yet, and this says so rather than letting a queued message
       * read as a delivered one. An owner who believes forty parents were told
       * will not look again for weeks.
       */
      notLiveTitle: 'পাঠানো এখনও চালু হয়নি',
      notLiveBody:
        'আপনার কোচিংয়ের নামে sender ID অনুমোদনের কাজ চলছে। ততক্ষণ পর্যন্ত যা পাঠাবেন তা লাইনে জমা থাকবে, অনুমোদন হলেই একসাথে চলে যাবে — কোনো বার্তা হারাবে না।',

      statusTitle: 'অবস্থা',
      /** Three tiles across a 375px screen, so one word each. */
      queued: 'লাইনে',
      sent: 'গেছে',
      failed: 'যায়নি',
      /**
       * Cancelled messages, as a line under the tiles rather than a fourth tile.
       *
       * Three tiles is what fits a 320px screen, and cancelled is the rarest of the
       * four things that can happen to a queued message: it needs somebody to turn
       * their SMS off in the window between a message being queued and the worker
       * reaching it. Rare is not the same as invisible, though — with no line for
       * it, a message that is neither in the line nor gone nor failed disappears
       * from this screen, and an owner who sent forty finds thirty-seven.
       *
       * Says the refund in the same breath, because that is the owner's real
       * question. Not why it was cancelled — whether they paid for it.
       */
      cancelledNote: (n: number) => `${n}টি বাতিল হয়েছে — ক্রেডিট ফেরত পেয়েছেন।`,

      recentTitle: 'সাম্প্রতিক পাঠানো',
      /** Says where the first one will come from, not just that there are none. */
      noneYet:
        'এখনও কোনো SMS পাঠানো হয়নি। পরীক্ষার নম্বর সেভ করার পর অভিভাবকদের জানানোর সুযোগ আসবে।',
      /** How many guardians one dispatch reached. A tally, so ASCII. */
      people: (n: number) => `${n} জন`,

      /**
       * The opt-out list's subtitle, resolved here rather than in the list: the
       * list is a client component, and English needs "1 student" and not
       * "1 students". Zero is its own sentence — "0 জনের SMS বন্ধ আছে" is a true
       * statement that reads like a failed lookup.
       */
      optOutNone: 'এখন সবাই SMS পাচ্ছে।',
      optOutSome: (n: number) => `${n} জনের SMS বন্ধ আছে।`,
    },

    teachers: {
      title: 'শিক্ষক ও অনুমতি',
      newTitle: 'নতুন শিক্ষক',
      /** Without a plan cap, the count on its own. ASCII: it is a tally. */
      count: (n: number) => `${n} জন শিক্ষক`,
      /** With one, how much of it is spent — the same line the roster shows. */
      used: (n: number, limit: number) => `${n}/${limit} জন শিক্ষক`,
      new: 'নতুন শিক্ষক যোগ করুন',
      emptyTitle: 'এখনও কোনো শিক্ষক যোগ হয়নি',
      emptyBody:
        'শিক্ষক যোগ করলে আপনি ঠিক করে দিতে পারবেন কে কী দেখবে আর কী করতে পারবে।',
      /**
       * How many batches one teacher runs, under their name in the list.
       *
       * Resolved here rather than in the row, even though the row is a client
       * component and could hold a template: the count is already known on the
       * server, and a function is the only way English gets to say "1 batch"
       * instead of "1 batches". See the note in ./index.ts about asking the
       * server for a plural.
       *
       * Zero is its own sentence. '0 ব্যাচ' under a teacher's name reads like a
       * number that failed to load, and the fact worth saying is that nobody has
       * given them a batch yet.
       */
      batches: (n: number) => (n === 0 ? 'কোনো ব্যাচ নেই' : `${n} ব্যাচ`),
      /**
       * Unreachable on every tier sold today — see the note on the page. Kept
       * because the day a mid tier caps staff, the list and the add form both
       * have to refuse, and they have to refuse in the same words.
       */
      capTitle: 'এই প্ল্যানে আর শিক্ষক যোগ করা যাবে না',
      cap: (name: string, limit: number, center: string) =>
        `${name} প্ল্যানে ${digits(limit, 'bn')} জন শিক্ষক। ${center} প্ল্যানে গেলে যত জন দরকার তত জন — সব ফিচার একই থাকবে।`,
      /**
       * Shown instead of the whole screen on a one-teacher plan. It names the
       * reader's own plan first, so the sentence reads as an explanation of what
       * they bought rather than an advertisement for what they did not.
       */
      soloTitle: 'শিক্ষক ও অনুমতি কোচিং সেন্টারের জন্য',
      soloBody: (plan: string, center: string) =>
        `${plan} প্ল্যান একজন শিক্ষকের জন্য — আপনি নিজেই। একাধিক শিক্ষক, আর কে কী দেখতে ও করতে পারবে সেই নিয়ন্ত্রণ ${center} প্ল্যানে।`,
      addedWithLogin: 'শিক্ষক ও তাঁর লগইন তৈরি হয়েছে',
      addedNoLogin: 'শিক্ষক যোগ হয়েছে (লগইন ছাড়া)',
      /**
       * Names the account that was joined to. If the owner mistyped a digit and
       * linked somebody else, this sentence is where they find out — so it says
       * whose account it was rather than reporting a plain success.
       */
      linked: (name: string) =>
        `শিক্ষক যোগ হয়েছে — পুরনো অ্যাকাউন্ট যুক্ত করা হয়েছে (${name})`,
      permissionsSaved: 'অনুমতি সেভ হয়েছে',
      activated: 'চালু করা হয়েছে',
      deactivated: 'বন্ধ করা হয়েছে',
      /** Stands in for a profile with no name on it, in both sentences below. */
      noName: 'নাম দেওয়া নেই',
      /**
       * Not an error and not a success: the action stopped to ask. Never links on
       * the first submit, because one mistyped digit would otherwise hand a
       * stranger a teacher account inside this centre — other people's children's
       * marks and their guardians' numbers.
       */
      confirmLink: (name: string) =>
        `এই নম্বরে আগেই একটি অ্যাকাউন্ট আছে — ${name}। এটাই যদি আপনার শিক্ষক হন, নিচে টিক দিয়ে আবার সেভ করুন। তিনি তাঁর পুরনো পাসওয়ার্ড দিয়েই ঢুকবেন।`,
      errors: {
        nameRequired: 'শিক্ষকের নাম লিখুন।',
        phoneInvalid: 'নম্বরটি ঠিক নেই (যেমন ০১৭১২৩৪৫৬৭৮)।',
        /** Because the number is the login id — there is nothing else to be. */
        loginNeedsPhone: 'লগইন দিতে হলে মোবাইল নম্বর লাগবে — নম্বরটাই তাঁর আইডি।',
        loginFailed: 'লগইন তৈরি করা যায়নি। আবার চেষ্টা করুন।',
        notFound: 'শিক্ষক পাওয়া যায়নি।',
      },
    },

    center: {
      title: 'নাম ও পেমেন্ট',
      subtitle: 'অভিভাবকের কাছে যাওয়া বার্তায় এই নাম আর নম্বরটিই থাকবে',
      /**
       * The read-only card a manager gets. Its own sentence rather than
       * `errors.ownerOnly`: nothing was refused here, so a manager should not be
       * told they are not allowed — they are being told who to ask.
       */
      readOnly: 'এগুলো শুধু কোচিংয়ের মালিক বদলাতে পারেন।',
      noNumber: 'পেমেন্ট নম্বর এখনো দেওয়া হয়নি।',
      errors: {
        /**
         * Owner, not manager — the one place in settings where the line moves,
         * because whoever can edit the payment number decides where every fee
         * reminder the centre sends points.
         */
        ownerOnly: 'নাম আর পেমেন্ট নম্বর শুধু কোচিংয়ের মালিক বদলাতে পারেন।',
        nameRequired: 'কোচিংয়ের নাম লিখুন।',
        /**
         * Told apart from the two below on purpose: "you left this blank" and
         * "what you typed is not a number" need different answers, and this is
         * where a digit gets lost. Money sent to a wrong-but-valid number is
         * gone, and the centre gets blamed for a fee that was paid.
         */
        numberInvalid: 'নম্বরটি ঠিক নেই। ১১ সংখ্যার মোবাইল নম্বর দিন, যেমন ০১৭১২৩৪৫৬৭৮।',
        walletNeedsNumber: 'কোন নম্বরে টাকা যাবে সেটিও লিখুন।',
        numberNeedsWallet: 'বিকাশ, নগদ, নাকি রকেট — বেছে নিন।',
      },
    },
  },

  /**
   * The centre pricing calculator, which runs in the browser.
   *
   * Its own top-level group and not part of `settings.plan`, for the reason
   * `chaseList` is separate from `chase`: this one crosses the client boundary, so
   * `T` poisons any function in it and every sentence here has to be a `{name}`
   * template filled by `fill`. Mixing the two in one group would mean the whole
   * group could hold no functions at all.
   *
   * The bill is shown broken down rather than as one figure, and that is a sales
   * decision as much as a design one: a single number an owner cannot reconstruct
   * invites the suspicion that it was invented on the spot, which is exactly what
   * a founder quoting a price from their own laptop needs to avoid.
   */
  planCalc: {
    title: 'সেন্টারের খরচ হিসাব করুন',
    body: 'শিক্ষার্থী আর শিক্ষকের সংখ্যা দিন। দাম সঙ্গে সঙ্গে দেখা যাবে।',
    students: 'শিক্ষার্থী কতজন',
    teachers: 'শিক্ষক কতজন',
    monthly: 'মাসে',
    breakdown: 'হিসাবটা এভাবে',
    studentPart: 'শিক্ষার্থী বাবদ',
    seatPart: 'বাড়তি শিক্ষক {n} জন',
    seatsIncluded: '{n} জন শিক্ষক এমনিতেই আছে',
    /** Only when it bites, so it explains a number that would otherwise look wrong. */
    floorNote: 'সর্বনিম্ন {floor} — ছোট সেন্টারেও এটাই',
    ratesTitle: 'জনপ্রতি রেট',
    bandRow: '{from}–{to} জন · জনপ্রতি {rate}',
    bandLast: '{from} জনের পর · জনপ্রতি {rate}',
    seatRate: '{n} জন শিক্ষক ফ্রি, এরপর জনপ্রতি {rate}',
    /**
     * The one number on the screen that is not arithmetic. Said plainly, because an
     * owner who discovers later that the quote moved stops trusting the rest.
     */
    quoteNote: 'এটি হিসাব করে দেখানো দাম। কথা বলে চূড়ান্ত করা হয়।',
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
