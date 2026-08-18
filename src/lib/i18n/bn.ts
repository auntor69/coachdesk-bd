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
 * Functions, not templates with placeholders. `n => \`${n} জন\`` is checked by
 * the compiler at both ends: the shape of the argument is part of the type, so
 * an English translation that forgets the count cannot compile.
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
