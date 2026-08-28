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
    /**
     * `saving` when there is no network, and a different sentence rather than a
     * variation on it.
     *
     * `experimental.useOffline` holds a save that had no signal and replays it when one
     * comes back, so nothing is lost — but "সেভ হচ্ছে…" for ten minutes is a lie, and a
     * teacher reading it concludes the app has hung. What they do about that is
     * force-quit, which is the one action that loses the sheet localStorage was keeping
     * for them. This says what is happening and that it needs nothing from them.
     *
     * Shared, because it is the same promise on every screen that makes it — and
     * because the two screens that make it most, the register and the marks sheet, are
     * exactly the two a teacher fills standing up with thirty rows on screen. See
     * next.config.ts for what actually holds the request.
     */
    willSend: 'সংযোগ ফিরলে পাঠানো হবে…',
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
   * The box that finds one student in a screen full of them.
   *
   * One group shared by every list that has a search box, for the same reason
   * there is one `matchesSearch` behind all of them: a box labelled differently on
   * the fee board and on the roster reads as two features, and an owner who learns
   * that one of them searches phone numbers has no reason to believe the other
   * does.
   *
   * NOT IN `common`, and the reason is structural rather than tidiness. `common`
   * is handed whole to client components (`common={d.common}`), and `T` poisons
   * function leaves — so a group containing `showing` below could never cross that
   * boundary. Kept apart, it can hold the count function it needs.
   */
  search: {
    /** Above the box, and read out by a screen reader in place of it. */
    label: 'খুঁজুন',
    /**
     * What is searchable, said as a list rather than as "খুঁজুন" again.
     *
     * The three things an owner actually has in front of them: the name they were
     * told, the code on last month's slip, and the number that rang them. Nobody
     * discovers that a phone number works by guessing.
     */
    placeholder: 'নাম, আইডি বা ফোন নম্বর',
    /**
     * The same box on a sheet of payments, where none of those three is what the
     * reader has in their hand.
     *
     * An owner searching the collection register is holding a bKash statement or a
     * parent's slip, so what they have is a transaction ID or a receipt number —
     * and offering them "ফোন নম্বর" on a sheet that carries no phone column would
     * be the box promising something it cannot do. The matcher is the same; only
     * the fields underneath and this line differ, which is why it is a second
     * string here and not a second component.
     */
    placeholderPayments: 'নাম, রসিদ নম্বর বা ট্রানজেকশন আইডি',
    /**
     * The same box on the exam list, which holds no student at all.
     *
     * Three fields, and every one of them is on the row already: the title the
     * teacher typed, the batch, the subject. Not the date — the row shows it in
     * Bangla numerals and the column behind it is an ISO string, so a reader typing
     * what they can see would find nothing.
     */
    placeholderExams: 'পরীক্ষার নাম, ব্যাচ বা বিষয়',
    /**
     * The submit button, which is not decoration — see the note on the register's
     * month form. A bare input with no button needs JavaScript to do what Enter
     * does on a hardware keyboard and nothing does on Android Chrome.
     */
    go: 'খুঁজুন',
    /** Empties the box. Says what comes back, not what is being removed. */
    clear: 'সব দেখান',
    /**
     * The count above a filtered list.
     *
     * The whole reason the filter is honest. Every figure on these screens is
     * still the centre's — the outstanding total does not become Ali's outstanding
     * because somebody typed his name — so the list has to say out loud that it is
     * showing a part of itself. Without this line a fee board filtered to one
     * family looks like a centre with one family and a total that makes no sense.
     *
     * Prose counts, so Bangla numerals.
     */
    showing: (shown: number, total: number) =>
      `${digits(total, 'bn')}টির মধ্যে ${digits(shown, 'bn')}টি দেখানো হচ্ছে`,
    /**
     * Nothing matched.
     *
     * Says the search found nothing, never that there is nothing — the list
     * underneath is empty because of the box above it, and an owner who reads
     * "কোনো ফি বাকি নেই" here would close the screen believing it.
     */
    none: 'এই খোঁজে কিছু পাওয়া যায়নি।',
    /** Under `none`: the thing to try, not an apology. */
    noneHint: 'বানান দেখে নিন, বা কম অক্ষর লিখে খুঁজুন।',
  },

  /**
   * The frame every signed-in screen sits in. Nav labels are short because they
   * sit under a glyph in a 48px tab on a 375px phone — four tabs means about
   * nine characters each before they truncate.
   */
  shell: {
    logout: 'লগআউট',
    /**
     * The header link to the account screen, and the only place in the app that says
     * whose phone this is. Icon-only on purpose — a third worded button would push
     * the centre's name off a 320px screen — so this string is the whole of its
     * accessible name and has to work read aloud on its own.
     */
    account: 'আমার অ্যাকাউন্ট',
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
   * The one screen every role can reach, and the only place anybody can change
   * their own password.
   *
   * It exists because two sentences elsewhere in this file promised it. teacherForm
   * .passwordHint tells an owner the teacher can change the password themselves
   * later, and settings.teachers.reset.errors.self tells the owner that their own
   * password is not changed from the staff list. Both were true about intent and
   * false about the product until this screen.
   *
   * Deliberately not called "settings": /settings is the centre's setup and half the
   * roles here never see it. This is the person, not the coaching centre.
   */
  account: {
    title: 'আমার অ্যাকাউন্ট',
    /**
     * A student or guardian has no bottom bar — their nav is a single tab, which the
     * shell does not draw — so without this link the only way off this screen is the
     * browser's back arrow. Points at whatever their role's home is.
     */
    back: 'নিজের স্ক্রিনে ফিরুন',
    nameTitle: 'আপনার নাম',
    /**
     * The second sentence is the one that stops a teacher writing to the owner twice.
     * `profiles.full_name` is the person and `teachers.name` is the centre's label for
     * a colleague; they are edited on different screens by different people on
     * purpose, and a teacher who fixes their own spelling here would otherwise wonder
     * why the staff list still has it wrong.
     */
    nameBody:
      'অ্যাপ প্রতিটি স্ক্রিনের উপরে এই নামেই আপনাকে সম্বোধন করে। কোচিং সেন্টারের শিক্ষক তালিকায় আপনার নামের বানান আলাদাভাবে রাখা থাকে, আর সেটি কেবল মালিক বদলাতে পারেন।',
    nameLabel: 'নাম',
    nameSubmit: 'নাম সেভ করুন',
    nameDone: 'আপনার নাম সেভ হয়েছে।',
    phoneLabel: 'লগইন নম্বর',
    /**
     * Said plainly because a number is an unusual thing to log in with, and because
     * this screen cannot change it: the number is the account's identity in three
     * places at once, and moving it is not a form, it is a migration.
     */
    phoneHint: 'এই নম্বর দিয়েই আপনি লগইন করেন। নম্বর বদলাতে হলে কোচিংয়ের মালিককে বলুন।',
    passwordTitle: 'পাসওয়ার্ড বদলান',
    /**
     * The second sentence is the honest one. A password change does not throw other
     * phones out — GoTrue leaves live sessions alone — and a shared centre phone is
     * exactly where somebody would assume it does.
     */
    passwordBody:
      'নতুন পাসওয়ার্ড সাথে সাথেই কাজ করবে। অন্য কোনো ফোনে আগে থেকে লগইন থাকলে সেটি নিজে নিজে বন্ধ হবে না — ওই ফোনে গিয়ে লগআউট করতে হবে।',
    current: 'এখনকার পাসওয়ার্ড',
    /**
     * Asked even though the reader is already signed in, and that is the point: a
     * coaching centre's phone is passed around, so an open session proves somebody
     * is signed in and not that it is you.
     */
    currentHint: 'এটি সত্যিই আপনি কি না নিশ্চিত হতে',
    next: 'নতুন পাসওয়ার্ড',
    nextHint: 'অন্তত {n} অক্ষর',
    confirm: 'নতুন পাসওয়ার্ডটি আবার লিখুন',
    submit: 'পাসওয়ার্ড বদলান',
    done: 'পাসওয়ার্ড বদলে গেছে। পরের বার নতুনটি দিয়ে লগইন করুন।',
    errors: {
      nameRequired: 'আপনার নাম লিখুন।',
      nameFailed: 'নাম সেভ করা যায়নি। আবার চেষ্টা করুন।',
      /**
       * Never says which of the two was wrong in a way that helps a stranger — but
       * this one is safe to name, because reaching it means already holding the
       * session.
       */
      wrongCurrent: 'এখনকার পাসওয়ার্ডটি ঠিক নেই।',
      mismatch: 'দুবার লেখা নতুন পাসওয়ার্ড এক হয়নি।',
      same: 'নতুন পাসওয়ার্ড আগেরটার মতোই। অন্য কিছু দিন।',
      failed: 'পাসওয়ার্ড বদলানো যায়নি। আবার চেষ্টা করুন।',
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
   * What the app says when the network is gone.
   *
   * `banner` appears on every screen; the rest is the /offline page, which the service
   * worker serves for a cold start with no signal. That page renders *both* languages
   * and this group is read for both — it is a cached file handed to whoever opens the
   * app next, so it is the one screen in the product that cannot know who is reading
   * it. See src/app/offline/page.tsx.
   *
   * Every sentence here is about the same fear and answers it the same way: the work
   * is not lost. A teacher who has marked twenty-eight of thirty students and then
   * seen "no connection" needs to be told that before anything else, because the
   * alternative they are weighing is going back to the paper register.
   */
  offline: {
    /** Across the top of whatever screen they are on, the moment the network drops. */
    banner: 'সংযোগ নেই — যা লিখছেন তা ফোনে সেভ থাকছে, সংযোগ ফিরলে পাঠানো হবে',
    title: 'সংযোগ নেই',
    /**
     * Deliberately about the register rather than about the network. "Check your
     * connection" is advice they do not need — they know — and it says nothing about
     * the thing they are actually worried about.
     */
    body:
      'ইন্টারনেট ছাড়া নতুন পাতা খোলা যায় না। তবে আপনার আধা-নেওয়া হাজিরা বা নম্বর '
      + 'এই ফোনেই সেভ আছে — সংযোগ ফিরলে অ্যাপে ঢুকে সেভ করলেই চলে যাবে।',
    retry: 'আবার চেষ্টা করুন',
    /**
     * Replaces `retry` while the phone reports no network at all, so nobody taps a
     * button that cannot work. Not "you are offline" — they can see that from the
     * heading; this is the button saying it knows.
     */
    stillOffline: 'এখনও সংযোগ নেই',
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
    /**
     * Today has batches and not one of them has a student in it. Said separately
     * because `allTaken` here would claim attendance that was never taken — which is
     * exactly what a centre in its first week saw.
     */
    emptyToday: 'আজকের ব্যাচগুলোতে এখনও কেউ নেই',
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
    /**
     * The third possibility on that row: a batch with nobody enrolled. Neither a
     * button nor a tick, because there is no register behind it to take or to have
     * taken — and the row is the only place that can say which batch is empty.
     */
    emptyBatch: 'কেউ নেই',
    otherBatches: 'আজ ক্লাস নেই এমন ব্যাচ',

    /**
     * The two reads behind this screen, when they did not arrive.
     *
     * `batchesUnreadable` is drawn instead of the whole list, because both of the
     * empty cards above it are sentences about whose batches these are — “make a
     * batch to get started” to an owner who has nine, under a button that makes a
     * tenth, and “none of the batches are yours yet” to a teacher standing in front
     * of one. The line over them both said “no classes today”.
     *
     * `markedUnknown` replaces the count. Today's marked registers are a separate
     * read, and an empty answer from it puts every class back in the “still to
     * mark” tally with a green button beside it — the same counter that cannot be
     * trusted as the one `emptyToday` was written for, only pointing the other way.
     */
    batchesUnreadable:
      'আজকের ক্লাস এখন পড়া গেল না, তাই দেখানো হয়নি। আপনার কোনো ক্লাস নেই, তা নয় — একটু পরে আবার চেষ্টা করুন।',
    markedUnknown:
      'আজ কোন কোন ক্লাসের হাজিরা নেওয়া হয়েছে, তা পড়া গেল না। ক্লাসে ঢুকে খাতাটি দেখে নিন।',

    /** The register's own page title. */
    rosterTitle: 'হাজিরা',
    /** Appended to the date when a teacher is backfilling an earlier class. */
    pastDate: 'পুরোনো তারিখ',
    noStudentsTitle: 'এই ব্যাচে শিক্ষার্থী নেই',
    /**
     * The old copy said to add students, which is the wrong instruction nearly every
     * time: the names are already on the roster, they were never put in a batch.
     */
    noStudentsBody:
      'শিক্ষার্থীরা হয়তো তালিকায় আছেই — এই ব্যাচে ভর্তি করলেই এখানে তাদের হাজিরা নেওয়া যাবে।',
    noStudentsAction: 'শিক্ষার্থী তালিকা',

    /** See en.teach.unreadable for what each of the two reads used to say instead. */
    unreadable:
      'হাজিরার খাতা এখন পড়া গেল না, তাই দেখানো হয়নি — কিছুই হারায়নি। একটু পরে আবার চেষ্টা করুন।',

    /**
     * The two days a register cannot be taken for, said as sentences.
     *
     * A form that renders and then fails on save is the version of this that
     * teaches a teacher nothing except not to trust the screen. So the page draws
     * the reason instead of the roster, and always with the way out next to it —
     * today's register is one tap away and a teacher who reached tomorrow by
     * accident should not have to find it themselves.
     *
     * `closedAdmin` is the other half: an owner *may* write into last month, so
     * they get the form and a line saying which day they are actually on. Nobody
     * fixing a register three weeks late is doing it by accident, and being told
     * so is worth more than being stopped.
     */
    futureTitle: 'এই ক্লাস এখনও হয়নি',
    futureBody:
      'যে ক্লাস এখনও হয়নি তার হাজিরা নেওয়া যায় না — ক্লাসে তো এখনও কেউ আসেনি। ক্লাস শেষ হলে হাজিরা নিন।',
    closedTitle: 'এই তারিখের হাজিরা বন্ধ',
    closedBody:
      'আজকের ক্লাস আর শেষ ক্লাসের হাজিরা নেওয়া বা ঠিক করা যায়। এর চেয়ে পুরোনো হাজিরা বদলাতে মালিককে বলুন।',
    closedAdmin:
      'এটি পুরোনো তারিখ। মালিক হিসেবে আপনি এখনও এখানে হাজিরা লিখতে পারবেন, তবে প্রতিটি নাম একবারই বদলানো যাবে।',
    takeToday: 'আজকের হাজিরা নিন',

    /**
     * The strings the register shows but cannot be handed: each takes an argument,
     * and a function cannot cross into a client component. So they live on this
     * side of the boundary and are resolved before they travel — the two counts by
     * the action that knows them, the rest by the page, which knows the batch, the
     * last class and every name on the roster.
     */
    saved: (n: number) => `হাজিরা সেভ হয়েছে — ${n} জন`,
    /**
     * The save that could not do everything it was asked. Not an error: what the
     * teacher changed is saved, and this is the part that was already settled — so
     * the sentence leads with the good news and then says what did not move, which
     * is the order they need it in to know whether to go and ask the owner.
     */
    savedExcept: (n: number) =>
      `হাজিরা সেভ হয়েছে। ${n} জনের হাজিরা আগেই একবার বদলানো হয়েছে, তাই সেটি আর বদলায়নি।`,
    /** The radiogroup's label, which is all a screen reader has to place the row. */
    rowLabel: (name: string) => `${name} — হাজিরা`,
    /**
     * The batch name is in the submit button on purpose: a teacher with four
     * batches in a morning needs to know which register they are about to write.
     */
    saveFor: (batch: string) => `${batch} — হাজিরা সেভ করুন`,
    /**
     * The link to the other register still open. The date is already formatted by
     * the page — Bangla numerals and a Bangla month, because this one is a date and
     * not a count.
     */
    lastClass: (date: string) => `শেষ ক্লাসের হাজিরা — ${date}`,

    /**
     * The three counted lines the absence list needs, on this side of the wire for
     * the same reason as everything above them.
     *
     * `toldOn` is deliberately the same sentence `exams.toldOn` uses. A teacher who
     * has learnt what the tick means on the marks sheet should not have to learn it
     * again on the register, and one wording for one fact is what keeps the two
     * screens from disagreeing about whether a family has been told.
     */
    toldOn: (date: string) => `${date} তারিখে জানানো হয়েছে ✓`,
    noPhoneCount: (n: number) => `${n} জনের অভিভাবকের নম্বর নেই`,
    optedOutCount: (n: number) => `${n} জনের SMS বন্ধ আছে`,

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
      /**
       * The date the page would have forgiven. Refused here rather than quietly
       * replaced with today, which is how a bad link overwrote a good register.
       */
      badDate: 'তারিখটি ঠিক নেই। আবার চেষ্টা করুন।',
      futureDate: 'যে ক্লাস এখনও হয়নি তার হাজিরা নেওয়া যায় না।',
      closedDate:
        'এই তারিখের হাজিরা আর বদলানো যাবে না। আজকের বা শেষ ক্লাসের হাজিরা নিন।',
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
    alreadyTaken: 'এই ব্যাচের হাজিরা আগে নেওয়া হয়েছে।',
    /**
     * The budget, said once, next to the sentence that says the register exists.
     * One change per name and not one per register, because the reason the owner
     * asked for a correction at all is a student walking in five minutes late —
     * and a second late arrival must not find the register already spent.
     */
    finalEdit: 'প্রতিটি নাম আর একবার বদলানো যাবে।',
    /**
     * The answer to "can I press present as many times as I like?" — yes, and it
     * costs nothing, because nothing leaves the phone until save. Worth a line of
     * its own: a teacher who thinks each tap is a write taps carefully, slowly, and
     * loses to the paper register.
     */
    tapFreely: 'যত খুশি ট্যাপ করুন — সেভ না চাপলে কিছুই জমা হয় না।',
    /** Read out for a row whose buttons are gone, where sighted readers see a chip. */
    lockedRow: 'একবার বদলানো হয়েছে, আর বদলানো যাবে না',
    note: 'নোট',
    notePlaceholder: 'যেমন: ছুটির কারণে ক্লাস তাড়াতাড়ি শেষ',
  },

  /**
   * The register's other half: telling the parents of the empty seats, today.
   *
   * Its own top-level group and not part of `teach`, for the same reason `roster`
   * is: it crosses the wire to a client component, so strings only. Every counted
   * line and every date is written by the page and handed down.
   *
   * The words are the most carefully chosen in this file. The teacher taps a chip,
   * their own phone opens, and a parent reads what is there — so this section has
   * to make three things obvious before the first tap: it is their own SMS, it
   * costs nothing, and the tick records that they sent it and not that anybody
   * read it. And `body` says what the message will *not* do, because an owner who
   * expects an accusation and gets a question will write their own instead.
   */
  absenceNotices: {
    title: 'অভিভাবককে জানান কে আসেনি',
    body:
      'যারা আজ আসেনি তাদের অভিভাবককে এখনই জানানো যায় — নাম ধরে বেছে নিন, আপনার ফোনের SMS বা হোয়াটসঅ্যাপ খুলে যাবে, লেখা বসানো থাকবে। কোনো ক্রেডিট লাগবে না, আপনার নম্বর থেকেই যাবে। বার্তায় কোনো দোষারোপ নেই — শুধু জানানো হয়, আর খোঁজ নিতে বলা হয়।',
    /** The register is saved and nobody was absent. The good outcome, said so. */
    nobodyAbsent: 'আজ এই ব্যাচের সবাই উপস্থিত ছিল। কাউকে জানানোর দরকার নেই।',
    /** Absent students exist, but not one of them has a guardian number. */
    noNumbers:
      'যারা আসেনি তাদের কারও অভিভাবকের নম্বর সেভ করা নেই। নম্বর যোগ করলে এখান থেকেই জানানো যাবে।',
    /** Before the register is saved. The list reads the saved marks, not the taps. */
    saveFirst: 'হাজিরা সেভ করলে যারা আসেনি তাদের তালিকা এখানে আসবে।',
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
     * The board could not be read, so no total and no rows are drawn.
     *
     * The sibling of `emptyBodyReadOnly`'s reasoning, which already says an empty
     * board must not look like "a screen that failed to load". This is the other
     * direction of the same rule: a screen that failed to load must not look like an
     * empty board. Both end with an owner believing their centre is settled up.
     */
    unreadable:
      'ফি বোর্ড এখন পড়া গেল না, তাই কিছু দেখানো হচ্ছে না — আধা হিসাবের চেয়ে হিসাব না দেখানোই ভালো। আবার চেষ্টা করুন।',
    /** See close.tooLarge for why this does not point anywhere. */
    tooLarge:
      'এখানে এত বিল জমেছে যে এক দফায় এই বোর্ডে যোগ করা যাচ্ছে না। আপনার হিসাবে কোনো সমস্যা নেই — আমাদের সাথে যোগাযোগ করুন, আমরা হিসাব পৌঁছে দেব।',
    /** See en.fees.chaseHistoryUnreadable for why this is said once and not per row. */
    chaseHistoryUnreadable:
      'কাকে আগে জানানো হয়েছে তা এখন পড়া গেল না, তাই সারিগুলোতে শেষ কবে তাগাদা দেওয়া হয়েছে তা লেখা নেই। পাঠানোর আগে তাগাদার তালিকা খুলে নিন, যাতে কাউকে দুইবার বলা না হয়।',
    /** See close.tooLarge for why this does not point at the chase list either. */
    chaseHistoryTooLarge:
      'ফাইলে তাগাদার সংখ্যা এত বেশি যে এই বোর্ড এক দফায় পড়তে পারছে না, তাই সারিগুলোতে শেষ কবে তাগাদা দেওয়া হয়েছে তা লেখা নেই। আপনার হিসাবে কোনো সমস্যা নেই — আমাদের সাথে যোগাযোগ করুন।',

    /**
     * The link to the month's collection register. Named for what it is on paper —
     * every centre already keeps an "আদায় খাতা", and an owner looking for the thing
     * they reconcile against a bKash statement is looking for that word.
     */
    registerLink: 'এই মাসের আদায় খাতা',

    /**
     * The way onto the month-close screen. Named for the question rather than the
     * accounting — an owner wanting to know how their month went does not look for a
     * word like "জের".
     */
    closeLink: 'এই মাসের পুরো হিসাব',

    /**
     * The way onto the old-dues screen, under the invoice generator rather than in
     * the total card. It is a setup job done once, not a reading of the month — but
     * it sits directly above the empty board, which is exactly where an owner whose
     * outstanding total says ৳০ will be looking.
     */
    arrearsLink: 'আগের বাকি তুলে দিন',

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
     * Who was left off, said next to the confirmation that it worked. A batch with no
     * monthly fee bills nobody and says nothing, so a month can come out a third
     * short under a message that reads like success. The fix is named because it is
     * one field on one screen.
     */
    invoicesSkipped: (n: number) =>
      `${n} জনের বিল হয়নি — তাদের ব্যাচে মাসিক ফি বসানো নেই।`,
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

    /**
     * What cancelling and restoring a bill say back.
     *
     * The child's name first, like `received`, and for the same reason: the fear is
     * not that the button failed, it is that it fired on the wrong row. "বাতিল হয়েছে"
     * with a name on it is checkable at a glance.
     *
     * The same sentence answers a second, replayed request — see the action. So it
     * says what is now true rather than what just happened; "আগেই বাতিল করা হয়েছে"
     * would read as a warning to an owner whose only mistake was a bad signal.
     */
    invoiceCancelled: (name: string) => `${name} — বিলটি বাতিল করা হয়েছে।`,
    invoiceRestored: (name: string) => `${name} — বিলটি আবার চালু করা হয়েছে।`,

    /**
     * What handing money back says. The name first, like `received`, and for the same
     * reason turned around: the fear is that the cash went out against the wrong child.
     *
     * "ফেরত দেওয়া হয়েছে" and not "লেখা হলো". The row records what happened at the desk,
     * and what happened is that the parent was given the money — the entry is how the
     * hisab keeps up, not the event. It also answers a replayed request unchanged, so
     * it says what is now true rather than what just happened.
     */
    refunded: (name: string, amount: string) => `${name} — ${amount} ফেরত দেওয়া হয়েছে।`,

    /**
     * What waiving part of a fee says back, and what taking the waiver away says.
     *
     * "ছাড়" is the word, not a word for a discount. It is what a centre writes in the
     * margin of its own outstanding book, and it carries the meaning an owner means:
     * money the centre decided not to ask for, not a lower price.
     *
     * "দেওয়া হলো" and not "লেখা হলো", for the reason `refunded` says "ফেরত দেওয়া হয়েছে":
     * the sentence records the decision the owner took about a family, and the row is
     * only how the hisab keeps up with it.
     *
     * `discountCleared` is the undo, and it says the bill is back at its full figure
     * rather than that a field was emptied. An owner who mistyped ৳২০০ as ৳২,০০০ and
     * put it back to zero needs to know what the family now owes, which is all of it.
     * Both sentences answer a replayed request unchanged — see the action — so they say
     * what is now true and not what just happened.
     */
    discounted: (name: string, amount: string) => `${name} — ${amount} ছাড় দেওয়া হলো।`,
    discountCleared: (name: string) =>
      `${name} — ছাড় তুলে নেওয়া হলো, বিলটি আবার পুরো টাকার।`,

    /**
     * The section under the board that holds them.
     *
     * The heading is the count, because it is a fold: an owner who cancelled one bill
     * a minute ago and an owner looking at thirty from a batch that closed both need
     * the number before they need anything else, and a separate title beside it would
     * only repeat the word.
     *
     * "এই বিলগুলো আর কারো বাকিতে নেই" is the whole point of the body — the owner needs
     * to know these names are off the total and off the chase list, because that is
     * what they pressed the button for.
     */
    cancelledCount: (n: number) => `${digits(n, 'bn')}টি বাতিল করা বিল`,
    cancelledBody:
      'এই বিলগুলো আর কারো বাকিতে নেই, মোট বকেয়ায় নেই, এবং কাউকে এগুলোর জন্য মনে করিয়ে দেওয়া হবে না। ভুলে বাতিল হলে আবার চালু করে নিন।',

    /**
     * What loading a centre's old dues says back.
     *
     * The count and the total together, like `invoicesCreated`, because this is the
     * one press in the product that puts a figure on the board the owner has never
     * seen before — they are about to check it against their own register, and the
     * two numbers they need are how many families and how much.
     *
     * `arrearsSomeExisted` is a warning and not an error: the write went through for
     * everybody else, and the families it skipped already had a bill in that month,
     * which is the upsert doing its job. An owner who pressed twice must be able to
     * tell that from a failure. `arrearsAllExisted` is the whole submission skipped,
     * which is what a replayed request looks like, so it says nothing was added
     * rather than that something went wrong.
     */
    arrearsCreated: (count: number, total: string) =>
      `${count} জনের পুরনো বাকি যোগ হয়েছে — মোট ${total}।`,
    arrearsSomeExisted: (n: number) =>
      `${n} জনের ওই মাসে আগেই বিল ছিল, তাদের হিসাব বদলানো হয়নি।`,
    arrearsAllExisted:
      'এই সবার ওই মাসের বিল আগেই আছে। নতুন কিছু যোগ হয়নি।',

    errors: {
      forbidden: 'ফি-এর হিসাব শুধু মালিক বা ম্যানেজার রাখতে পারেন।',
      dueDayRange: 'তারিখ ১ থেকে ২৮-এর মধ্যে দিন।',
      rosterUnreadable: 'শিক্ষার্থীর তালিকা পড়া যায়নি। আবার চেষ্টা করুন।',
      /**
       * The ceiling in lib/supabase/page.ts, said to the person pressing the button.
       *
       * Not a translation of "unreadable", because the two need different answers: a
       * read that failed is worth pressing again, and a roster past the ceiling never
       * will be. What matters most in the sentence is the middle clause — nothing was
       * billed — because the failure this replaces was a month quietly billed short
       * with a confirmation on screen saying it worked.
       */
      rosterTooLarge:
        'এই সেন্টারে এক বারে পড়া যায় না এত ভর্তি আছে। কোনো বিল তৈরি হয়নি — আমাদের জানান।',
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
      /**
       * The one rule cancelling has, said in terms of the money rather than the
       * database: a bill that has been paid cannot simply stop existing, because a
       * cancelled bill leaves the hisab altogether and the family's payment would go
       * with it while the cash stayed in the drawer.
       *
       * Names the control that unblocks it, since there is now one directly above the
       * cancel step on the same panel. Read after a failed write, alone on a red line,
       * so it carries the whole rule and not just the pointer.
       */
      cancelPaid:
        'এই বিলে টাকা জমা আছে, তাই এটি বাতিল করা যাবে না। উপরের "টাকা ফেরত দিন" দিয়ে টাকা ফেরতের হিসাব লিখুন, তারপর বাতিল করা যাবে।',
      cancelFailed: 'বিলটি বাতিল হয়নি। আবার চেষ্টা করুন।',
      restoreFailed: 'বিলটি আবার চালু হয়নি। আবার চেষ্টা করুন।',

      /**
       * The two ways a refund is refused, beyond the amount checks it shares with the
       * payment form.
       *
       * `refundNothing` means the owner is on the wrong row — nothing came in against
       * this bill, so there is nothing to hand back — and it says so rather than
       * repeating "টাকার পরিমাণ", which would send them back to the box to try a
       * smaller number.
       *
       * `refundTooMuch` names the ceiling instead of only refusing it. The owner is
       * standing at a drawer deciding how much to count out, and the figure is the
       * answer they need; it is pre-formatted, because it is money.
       */
      refundNothing: 'এই বিলে কোনো টাকা জমা হয়নি, তাই ফেরত দেওয়ার কিছু নেই।',
      refundTooMuch: (max: string) =>
        `এই বিলে জমা আছে ${max}, এর বেশি ফেরত দেওয়া যাবে না।`,
      refundFailed: 'টাকা ফেরতের হিসাব লেখা হয়নি। আবার চেষ্টা করুন।',

      /**
       * The three ways a waiver is refused. None of them repeats "টাকার পরিমাণ", which
       * the box already says: an owner told only that would retype the same figure.
       *
       * `discountVoided` names the step that unblocks it. A cancelled bill is off every
       * total, so a waiver on it changes nothing anybody can see — the owner meant to do
       * something, and the thing to do is put the bill back first. Said in terms of the
       * board rather than the database, because "বাতিল করা বিল" is what they are looking
       * at.
       *
       * `discountNegative` exists because the field is a number box and a minus sign is
       * one keystroke. There is no such thing as billing extra through a waiver, and the
       * sentence says what to do instead — raise the bill for more — so an owner who
       * genuinely wanted to charge more is not left thinking the app forbids it.
       *
       * `discountTooMuch` names the ceiling instead of only refusing it, exactly as
       * `refundTooMuch` does, and the ceiling is the whole fee: a centre may waive all of
       * it, and often does for a topper it wants on the roll. Pre-formatted, because it
       * is money.
       */
      discountVoided:
        'এই বিলটি বাতিল করা আছে, তাই এতে ছাড় দিলে কোনো হিসাব বদলাবে না। আগে বিলটি আবার চালু করুন।',
      discountNegative:
        'ছাড় শূন্যের কম হতে পারে না। বেশি টাকা নিতে হলে বিলটি বেশি টাকার করে দিন।',
      discountTooMuch: (max: string) =>
        `এই বিলের ফি ${max}, ছাড় এর বেশি হতে পারে না।`,
      discountFailed: 'ছাড়ের হিসাব লেখা হয়নি। আবার চেষ্টা করুন।',

      /**
       * The four ways loading old dues is refused.
       *
       * `arrearsMonthNotPast` is the one rule the screen cannot enforce for itself. Old
       * dues have to land in a month that has finished, because the invoice generator
       * owns the current month — a slot filled here would make it skip that family, and
       * their actual monthly fee would never be billed. Said in terms of what the owner
       * is choosing, not in terms of the unique key underneath it.
       *
       * `arrearsRejected` names the boxes. It is the only message on this screen that
       * has to, because the owner is looking at three hundred of them and a count on its
       * own would send them scrolling. Each name carries its own reason, since a typo and
       * a minus sign need different corrections. Nothing was saved, and the sentence says
       * so first — an owner who read "3 boxes could not be read" and nothing else would
       * assume the other 297 went in.
       */
      arrearsMonthNotPast:
        'পুরনো বাকি শেষ হয়ে যাওয়া কোনো মাসের হিসাবে লিখতে হবে — চলতি মাসের ইনভয়েস উপরের বোতাম দিয়ে তৈরি হয়।',
      arrearsNothingTyped:
        'কোনো ঘরে টাকার পরিমাণ লেখা হয়নি। যাদের বাকি আছে তাদের ঘরে টাকা লিখুন।',
      arrearsRejected: (n: number, details: string) =>
        `${n}টি ঘর ঠিক করতে হবে, কিছুই সেভ হয়নি — ${details}`,
      arrearsFailed: 'পুরনো বাকি যোগ হয়নি। আবার চেষ্টা করুন।',

      /**
       * Two or three words each, because they are read inside a list of names. What is
       * wrong with the box, not what the owner should do about it — the correction is
       * obvious from the reason, and a sentence per name would make the line unreadable
       * at three names, let alone eight.
       */
      arrearsReasons: {
        unreadable: 'পড়া যায়নি',
        negative: 'শূন্যের কম',
        tooLarge: 'অনেক বড়',
        notEnrolled: 'ব্যাচে নেই',
      },
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
   * Cancelling a bill that should not have been raised, and putting one back.
   *
   * Its own group rather than more of `feeRow`, because two different components read
   * it — the control under a board row and the struck-through row in the cancelled
   * list — and neither should carry the other's words across the wire.
   *
   * THE WORD IS "বাতিল", NOT A WORD FOR VOIDING. The schema calls the column
   * `voided_at` and will go on calling it that; an owner in Bandarban is not doing
   * accounting, they are undoing a mistake, and "বিল বাতিল" is what they would say to
   * the person sitting next to them.
   *
   * Strings only, `{}` templates where a figure goes — both readers are client
   * components. See ./fill.ts.
   */
  cancel: {
    /**
     * The way in. Deliberately a plain underlined word at the foot of the panel and
     * not a button: it sits on the same screen as "জমা নিন", which is tapped fifty
     * times a day, and the two must not look alike. Nothing here is undone by
     * tapping it — the confirm step is.
     */
    open: 'বিলটি বাতিল করুন',
    /** The step that actually asks. */
    heading: 'বিলটি বাতিল করবেন?',
    /**
     * Says what changes, in the three places the owner will look for it afterwards.
     * Not a scare warning: cancelling is reversible and the restore button is right
     * there, so the sentence describes rather than threatens.
     */
    warning:
      'বিলটি আর বাকির হিসাবে থাকবে না, মোট বকেয়া থেকে বাদ যাবে, আর অভিভাবককে এটির জন্য মনে করিয়ে দেওয়া হবে না।',
    /**
     * Optional, and it says so. A bill raised against a child who left is self-evident
     * to the person cancelling it, and a required box here would be answered with a
     * full stop. Three weeks later, though, "কেন এটা বাতিল হলো" is a real question, and
     * this is the only place the answer can come from.
     */
    reason: 'কেন বাতিল করছেন',
    reasonHint: 'যেমন: জুন মাসেই কোচিং ছেড়ে দিয়েছে',
    confirm: 'হ্যাঁ, বাতিল করুন',
    cancelling: 'বাতিল হচ্ছে…',
    /** The way out of the confirm step, and the wider tap target of the two. */
    keep: 'না, থাকুক',

    /**
     * When the bill has money on it. Shown at the confirm step instead of the form,
     * rather than by hiding the control: an owner who cannot find the button assumes
     * the app is broken, and one who is told why learns the rule at the moment it
     * matters.
     *
     * Shorter than `fees.errors.cancelPaid` and deliberately not the same literal.
     * That one is read after a failed write, alone on a red line, and has to carry the
     * whole rule; this one sits directly under the figure showing what was paid, and
     * the control it names is a finger's width above it.
     */
    paidTitle: 'এই বিলটি বাতিল করা যাবে না',
    paidNote:
      'এই বিলে টাকা জমা আছে। উপরের "টাকা ফেরত দিন" দিয়ে আগে টাকা ফেরতের হিসাব লিখুন, তারপর বাতিল করা যাবে।',

    /**
     * One row of the cancelled list: which month's bill it was, what is no longer
     * owed, and why.
     */
    forMonth: '{month} মাসের বিল',
    amount: '{amount} — আর দিতে হবে না',
    /** Above the owner's own words, when they left any. */
    reasonLabel: 'কারণ',
    restore: 'আবার চালু করুন',
    restoring: 'চালু হচ্ছে…',
  },

  /**
   * Handing money back out of the drawer.
   *
   * WHY IT IS ITS OWN GROUP and not more of `feeRow`: the panel that reads these is a
   * separate client component, so folding them into the row's words would put a refund
   * form's wording on the wire for every one of forty rows on a collection day. The six
   * method labels are the exception and stay in `feeRow.methods`, shared rather than
   * copied — one list keyed by the enum is what stops "বিকাশ" on one form and something
   * else on the other.
   *
   * THE WORD IS "ফেরত", which is what an owner says and what a parent hears. Not
   * "রিফান্ড", which is the English word in Bengali letters and reads as a bank's term
   * on a screen that is otherwise plain speech.
   *
   * The tone is deliberately not alarming. Handing back a leaving student's fee is an
   * ordinary, decent thing to do, and a form covered in warnings would make an owner
   * hesitate over it in front of the parent. Exactly one sentence says the entry cannot
   * be unwritten, because that part is true and they need it before they type a figure.
   *
   * Strings only, `{}` templates where a figure goes — the reader is a client component.
   * See ./fill.ts.
   */
  refund: {
    /**
     * The way in, and quiet for the same reason as `cancel.open`: it shares a panel
     * with "জমা নিন", which is tapped fifty times a day, and money going out must not
     * be one mistap away from money coming in. Nothing happens when it is tapped —
     * the form below it is where anything is decided.
     */
    open: 'টাকা ফেরত দিন',
    heading: 'কত টাকা ফেরত দিচ্ছেন?',
    /**
     * The ceiling, above the empty box. Netted, so a bill that has already had ৳500
     * handed back offers what is left rather than what it originally took — the owner
     * never has to work out the difference, and the server refuses anything past it.
     */
    held: 'এই বিলে জমা আছে {amount}',
    /**
     * Only when the family is actually in credit, and it is the second of the two
     * figures an owner might mean by "ফেরত": all of it, because the student left, or
     * just the extra hundred taka the parent handed over by mistake.
     */
    credit: 'এর মধ্যে {amount} বেশি জমা আছে',
    /**
     * The one hard fact, said once. A payment cannot be deleted or edited by anybody,
     * so a slipped digit here can only ever be answered by a second entry that reads,
     * forever, as money that changed hands and did not.
     */
    warning:
      'টাকা ফেরতের হিসাব পরে মুছে ফেলা বা বদলানো যায় না। তাই টাকা গুনে হাতে দিয়ে, তারপর এখানে লিখুন।',
    /** Past tense on purpose: it is written after the cash has left the drawer. */
    amount: 'কত টাকা ফেরত দিলেন',
    method: 'কীভাবে ফেরত দিলেন',
    /**
     * Optional. Nobody seeing a parent out of the door will fill it in, but "এই টাকা
     * কেন ফেরত গেল" is a real question three weeks later and this is the only place an
     * answer can come from.
     */
    note: 'কেন ফেরত দিচ্ছেন',
    noteHint: 'যেমন: কোচিং ছেড়ে দিয়েছে',
    confirm: 'ফেরতের হিসাব লিখুন',
    refunding: 'লেখা হচ্ছে…',
    /** The way out, and the wider tap target of the two. */
    keep: 'না, থাকুক',
    /**
     * The slip for money that went out. Says "ফেরতের রসিদ" and not just "রসিদ", because
     * the parent is being handed a second piece of paper and the two must not look like
     * two payments — the printed slip says so as well.
     */
    receiptLink: 'ফেরতের রসিদ দেখুন',
  },

  /**
   * A fee the centre decided not to charge.
   *
   * WHY IT IS ITS OWN GROUP, like `refund` beside it: the panel is a separate client
   * component, and folding these into the row's words would put a waiver form's whole
   * wording on the wire for every one of forty rows on a collection day.
   *
   * THE WORD IS "ছাড়" throughout — see `fees.discounted` for why. Never "ডিসকাউন্ট",
   * which is a shop's word for a sale and not a centre's word for carrying a family.
   *
   * THE TONE IS THE OPPOSITE OF THE REFUND FORM'S. Handing cash back is irreversible and
   * says so once; a waiver is a number that can be retyped or removed at any time, and it
   * is something an owner is *proud* of — the second child of a family already paying,
   * the student carried through a bad year. So nothing here warns, and the one thing the
   * panel insists on is showing what the family will be left owing before the figure is
   * stored.
   *
   * Strings only, `{}` templates where a figure goes — the reader is a client component.
   * See ./fill.ts.
   */
  discount: {
    /**
     * The way in, quiet like `cancel.open` and `refund.open` and for the same reason:
     * it shares a panel with "জমা নিন", tapped fifty times a day. Says "ছাড় দিন" on a
     * bill with no waiver on it; the panel swaps in `edit` once there is one, because
     * "ছাড় দিন" over an existing ৳২০০ invites an owner to think they are adding to it.
     */
    open: 'ছাড় দিন',
    edit: 'ছাড় বদলান',
    heading: 'কত টাকা ছাড় দিচ্ছেন?',
    /**
     * The fee, above the box — the full figure the centre charges, not what is left
     * after anything already waived. That is the number the ceiling is measured
     * against, and the one the owner is deciding a fraction of.
     */
    billed: 'এই বিলের ফি {amount}',
    /**
     * Shown only when there is already a waiver, because the box arrives with that
     * figure in it and an owner who does not know why would delete it.
     *
     * IT SAYS THE FIGURE REPLACES, NOT ADDS. This is the one thing about the form that
     * could cost a centre money: an owner who thinks they are adding ৳১০০ to an existing
     * ৳২০০ and types 100 has just given ৳১০০ less than they meant to.
     */
    current: 'এখন ছাড় আছে {amount} — নতুন যা লিখবেন, সেটিই বসবে',
    /**
     * What the family is left owing, under the box, updated as the figure is typed. The
     * whole point of the panel: the owner sees the consequence of the number before it
     * is stored, so no waiver is ever a surprise on the board afterwards.
     *
     * Before anything already paid, and it says so — the row above shows what came in,
     * and restating it here would be the second answer docs §4 forbids.
     */
    leaves: 'ছাড়ের পর ফি দাঁড়াবে {amount}',
    /** When the whole fee is waived, which is a real case and not an error. */
    leavesNothing: 'পুরো ফি ছাড় — এই বিলে আর কিছু দিতে হবে না',
    amount: 'কত টাকা ছাড় দিচ্ছেন',
    /**
     * Optional, and it says so for the reason `cancel.reason` does. But it is the field
     * that matters most here, because a cancelled bill leaves the board and a discounted
     * one stays on it: months later "এই পরিবারের বিল কম কেন" is a question the owner will
     * ask themselves, and this is the only place the answer can come from.
     */
    reason: 'কেন ছাড় দিচ্ছেন',
    reasonHint: 'যেমন: দুই ভাইবোন একসাথে পড়ে',
    confirm: 'ছাড় বসান',
    saving: 'বসানো হচ্ছে…',
    /** The way out, and the wider tap target of the two. */
    keep: 'না, থাকুক',
    /**
     * Taking a waiver back, which is typing zero — but nobody types zero to undo
     * something, so the panel offers it as its own step. Says what the bill becomes, not
     * what the field does.
     */
    clear: 'ছাড় তুলে নিন',
    clearing: 'তোলা হচ্ছে…',
    /**
     * On a cancelled bill, shown at the panel instead of the form rather than by hiding
     * the control — the argument `cancel.paidNote` makes: an owner who cannot find a
     * button assumes the app is broken, and one who is told why learns the rule where it
     * matters. Shorter than `fees.errors.discountVoided`, which is read alone on a red
     * line and has to carry the whole rule.
     */
    voidedTitle: 'বাতিল করা বিলে ছাড় দেওয়া যায় না',
    voidedNote: 'বিলটি আবার চালু করলে ছাড় দেওয়া যাবে।',
    /** Above the owner's own words, on the board, when they left any. */
    reasonLabel: 'ছাড়ের কারণ',
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
    /**
     * The same sheet, when the money went the other way.
     *
     * WHY THE SLIP MUST SAY SO. A refund is a `fee_payments` row with a negative amount,
     * so without these three keys this page would hand a parent a "ফি রসিদ" for money
     * that left the drawer — the one document in the product a family keeps, saying the
     * opposite of what happened. The figure is printed unsigned and the words carry the
     * direction, because "-৳৫০০" under a label that reads "জমার পরিমাণ" is worse than
     * either half alone.
     *
     * `refundTitle` is drawn in a box across the slip rather than tucked into a corner,
     * and it is words rather than a colour: these sheets are printed on the cheapest
     * black-and-white laser in the building.
     */
    refundTitle: 'টাকা ফেরতের রসিদ',
    refundAmount: 'ফেরত দেওয়া টাকা',
    refundFootNote:
      'এটি কম্পিউটারে তৈরি টাকা ফেরতের রসিদ। এই টাকা অভিভাবকের হাতে ফেরত দেওয়া হয়েছে — প্রমাণ হিসেবে যত্ন করে রাখুন।',
    /** The invoice's own total, so the two figures below it can be checked. */
    billed: 'মাসের মোট ফি',
    /**
     * The waiver, and what the fee came down to — printed only when the centre granted
     * one, so a normal slip is not two lines longer for nothing.
     *
     * THE PAPER IS THE PROOF, and that is the whole reason these are here. Until a waiver
     * could be granted from the board there was nothing to print; now a family paying
     * ৳১,৫০০ against a ৳২,০০০ fee has a slip that says why, in the centre's own hand, and
     * an owner who leaves next term cannot take the arrangement with them. Without it the
     * parent's copy shows ৳২,০০০ billed and ৳১,৫০০ received and reads as a part payment.
     *
     * `discountGiven` is written with a minus in front of the figure on the slip, the way
     * the line above and below it are read: a bill, a deduction, a total.
     */
    discountGiven: 'ছাড়',
    netAfterDiscount: 'ছাড়ের পর দিতে হবে',
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
    /**
     * Left blank on the paper, for a pen.
     *
     * "গ্রহণকারীর" — whoever received — and not "মালিকের", which is why the same word
     * works on both sheets. On a fee receipt the centre received the money and the
     * person who took it signs; on a refund receipt the guardian received it and the
     * guardian signs, which is the signature that matters more of the two, because it
     * is the centre's only record that the cash actually left the building.
     */
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
    /** See en.receipt.unreadable for why this names the read that failed. */
    unreadable:
      'এখনই রসিদ ছাপানো যাবে না: এই বিলের আগের জমাগুলো পড়া গেল না, তাই বাকির অঙ্ক ভুল আসত। টাকা জমা হয়েছে। একটু পরে আবার চেষ্টা করুন।',
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
     * The word on a row where the money went the other way.
     *
     * A REFUND IS A NEGATIVE PAYMENT in this product, so without this word the sheet
     * says nothing about it at all: the row carries "-৳৫০০" under a heading that reads
     * "টাকা", one minus sign at the left of a right-aligned figure in a column of
     * figures that all look like it, printed on the cheapest black-and-white laser in
     * the building. The receipt beside this screen has said so in a ruled box since the
     * refund could be taken; this is the same sentence on the sheet the owner files.
     *
     * The figure keeps its sign here, unlike on the receipt, where it is printed
     * unsigned and the words carry the direction. The receipt has one figure and
     * nothing to add it to; this page has a running total a reader works down by hand
     * against a wallet statement, and a column that does not subtract where the money
     * left cannot be followed.
     */
    refundLabel: 'ফেরত',
    /**
     * Its own column and not a footer line. An owner ticking down a printed page
     * against a wallet statement finds the row where the two stopped agreeing, and
     * that is only possible if every row carries the total up to it.
     */
    colRunning: 'ক্রমিক মোট',

    total: 'মোট আদায়',
    /**
     * What came in and what went back, printed above the total so the reader can see
     * where it came from.
     *
     * ONLY WHEN THERE WERE REFUNDS. A month with none of them is not a line shorter for
     * some fussy reason — a "ফেরত দেওয়া হয়েছে ৳০" on a sheet that had no refunds is a
     * figure an owner has to stop and check, and there is no month in which it is the
     * useful one.
     *
     * `total` stays the collection and stays the only answer to it. These two are its
     * addends, summed once in tallyRegister from the same rows, and they add to it
     * exactly. That is the same shape as a waived bill on the fee board — the fee, the
     * waiver, and what is payable — and it is there for the same reason: a figure that
     * is smaller than the reader expected needs the subtraction next to it, or it reads
     * as a mistake in the software.
     */
    grossIn: 'জমা হয়েছে',
    refunded: 'ফেরত দেওয়া হয়েছে',
    byMethod: 'কীভাবে এসেছে',
    /** Payments, not students: one family can pay twice in a month. */
    entries: (n: number) => `${n}টি জমা`,
    empty: 'এই মাসে এখনো কোনো টাকা জমা হয়নি।',

    /**
     * The register could not be read, so no lines and no total are drawn.
     *
     * Its own sentence rather than `empty`, which says something about the centre. A
     * register is printed and filed, and a sheet that reads "no money has been
     * recorded" over a total of zero is a document somebody finds next year and
     * believes.
     */
    unreadable:
      'এই মাসের খাতা এখন পড়া গেল না, তাই কোনো লাইন দেখানো হচ্ছে না — আধা খাতার চেয়ে খাতা না দেখানোই ভালো। আবার চেষ্টা করুন।',
    /** See close.tooLarge for why this does not point anywhere. */
    tooLarge:
      'এই মাসে এত জমা হয়েছে যে এক দফায় এই পাতায় যোগ করা যাচ্ছে না। আপনার হিসাবে কোনো সমস্যা নেই — আমাদের সাথে যোগাযোগ করুন, আমরা খাতা পৌঁছে দেব।',
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

  /**
   * The month's closing figures.
   *
   * MASTERPLAN §4: around day 28 of a trial the owner is shown what was outstanding
   * when the month started, what came in, and how many reminders went out — and then
   * the price, which is meant to look small next to what they have just watched
   * arrive. These words are that conversation, so they are the owner's own words for
   * their own month and not accounting vocabulary: "মাস শুরুতে বাকি ছিল", not
   * "প্রারম্ভিক জের". Somebody who has never kept a ledger has to read this off a
   * phone in one pass, with the founder sitting across the table.
   */
  close: {
    title: 'মাসের হিসাব',
    subtitle: 'মাস শুরুতে কত বাকি ছিল, কত এল, কত রয়ে গেল',
    month: 'মাস',
    show: 'দেখুন',
    backToFees: 'ফি-এর তালিকায় ফিরুন',

    /** The figure the sale is made on, which is why it is the one set four times larger. */
    collected: 'এই মাসে জমা হয়েছে',
    /**
     * Sits directly under the collected figure, and it is what keeps the rate honest.
     * Money handed over in July against August's bill is collection and it is not
     * July's collection; both halves of that subtraction are on the screen, so an
     * owner who checks the division gets the number the screen printed.
     */
    advance: 'এর মধ্যে পরের মাসের অগ্রিম',
    rate: 'আদায়ের হার',
    /**
     * Not "০%". A month with nothing billed and nothing owed collected none of
     * nothing, and a zero there would be the screen calling that a failure.
     */
    rateNone: 'এই মাসে আদায়ের কিছু ছিল না',

    opening: 'মাস শুরুতে বাকি ছিল',
    billed: 'এই মাসে বিল হয়েছে',
    closing: 'মাস শেষে বাকি রইল',
    credit: 'বেশি জমা আছে',
    /**
     * Drawn only when somebody is in credit, because that is the only time these four
     * figures do not close and an owner adding them up finds a gap. Netting them is
     * refused everywhere in this product — see tallyOutstanding — so the gap is
     * explained instead of removed.
     */
    creditNote:
      'একজনের বেশি জমা অন্যজনের বাকির সাথে মেলানো হয় না, তাই আলাদা দেখানো হলো।',

    /**
     * How many messages went out, and not one word more. Every one of them leaves the
     * owner's own phone when they tap it — there is no gateway yet — so "নিজে নিজে" or
     * anything like it would be a claim we cannot keep, said on the screen we are
     * asking to be trusted with money.
     *
     * "খবর" and not "SMS": one of these four may have gone by WhatsApp, and the owner
     * who tapped it knows which. Naming the pipe would make three of the four lines
     * wrong to somebody who does.
     */
    messagesSent: (n: number) => `অভিভাবকদের কাছে ${digits(n, 'bn')}টি খবর গেছে`,
    messagesNone: 'এই মাসে অভিভাবকদের কাছে কোনো খবর পাঠানো হয়নি',
    /**
     * The four kinds, drawn under the total only when more than one of them happened —
     * a breakdown with one row in it is the total written twice. Keyed by MessageKind,
     * so a fifth kind cannot reach this screen without a word for it.
     */
    messageKinds: {
      reminders: 'ফি-এর তাগাদা',
      notes: 'সপ্তাহের খবর',
      results: 'পরীক্ষার রেজাল্ট',
      absences: 'অনুপস্থিতির খবর',
    },

    registerLink: 'কোন তারিখে কত এল, দেখুন',
    /**
     * The next step in the conversation this screen exists for. An owner who has just
     * read their own month is the one person for whom the price page is worth
     * opening.
     */
    planLink: 'প্ল্যান আর দাম দেখুন',
    empty: 'এই মাসে কোনো বিল হয়নি, কোনো টাকাও জমা হয়নি।',

    /**
     * The ledger could not be read, so it is not drawn at all.
     *
     * Its own sentence rather than falling through to `empty`, because six zeroes and
     * a quiet month are the same picture, and this is the screen that gets read out
     * loud across a table. No total is better than a total that is two thousand out.
     */
    unreadable:
      'এই মাসের হিসাব এখন পড়া গেল না, তাই কোনো অঙ্ক দেখানো হচ্ছে না — ভুল হিসাবের চেয়ে হিসাব না দেখানোই ভালো। আবার চেষ্টা করুন।',
    /**
     * More rows than a browser will add up. Not something the owner can retry into
     * success, and deliberately not pointed at the export either: that refuses at the
     * same MAX_PAGED_ROWS ceiling, so sending them there would be sending them to the
     * same wall with an extra tap in between. A month this size needs us.
     */
    tooLarge:
      'এই মাসে এত বিল আর জমা হয়েছে যে এক দফায় এই পর্দায় যোগ করা যাচ্ছে না। আপনার হিসাবে কোনো সমস্যা নেই — আমাদের সাথে যোগাযোগ করুন, আমরা হিসাব পৌঁছে দেব।',
  },

  /**
   * The column headings inside the downloaded spreadsheets, and the few cells that
   * hold a word rather than a number.
   *
   * IN THE READER'S OWN LANGUAGE, on purpose, and this needed deciding. The other
   * option was fixed English headers — `guardian_phone`, `remaining_bdt` — on the
   * theory that a file might be fed to something. Nothing feeds these to anything:
   * the file is opened by the owner, or by whoever does their accounts, or by a
   * teacher who was handed a batch list. A Bangla-first product that answers
   * "download" with a sheet headed in snake_case has switched languages at the exact
   * moment somebody is about to email it to somebody else.
   *
   * The *values* are a different question and are settled the other way — see the
   * head of src/lib/export/reports.ts. A date goes out as 2026-08-11 and an amount as
   * 1250, because a spreadsheet sorts and totals those columns and ১১ আগস্ট cannot be
   * sorted. Words are read; numbers are computed.
   *
   * Nothing here is re-imported by the roster paste box, which parses names and
   * numbers rather than headings, so a heading changed in this group cannot break
   * anything an owner already downloaded.
   */
  exportSheet: {
    /* Shared by more than one sheet, so they cannot disagree about a column. */
    colCode: 'আইডি',
    colName: 'নাম',
    colBatch: 'ব্যাচ',
    colMonth: 'মাস',
    colStatus: 'অবস্থা',
    colGuardianPhone: 'অভিভাবকের মোবাইল',

    /* The roster. */
    colClass: 'শ্রেণি',
    colInstitution: 'স্কুল / কলেজ',
    colStudentPhone: 'শিক্ষার্থীর মোবাইল',
    colGuardianName: 'অভিভাবকের নাম',
    colSmsOff: 'SMS বন্ধ',
    /* Short, because it is a column heading in a spreadsheet and not a sentence.
       The cell under it holds the same three words the settings dropdown offers. */
    colChannel: 'যোগাযোগের মাধ্যম',
    colAdmitted: 'ভর্তির তারিখ',

    /* The month's takings. Same words as the printed register's columns, because
       an owner holding one against the other should not have to translate. */
    colDate: 'তারিখ',
    colReceipt: 'রসিদ নম্বর',
    colMethod: 'কীভাবে',
    colReference: 'ট্রানজেকশন আইডি',
    colAmount: 'টাকা',

    /* The month's fee sheet. Five money columns, because the one an owner argues
       about with a parent is never the same one twice. */
    colBilled: 'বিল',
    colDiscount: 'ছাড়',
    /* Beside the figure, and it is the owner's own words rather than anything the app
       chose. The sheet is what gets opened next year, or by whoever takes the desk
       over: 'ছাড় ৫০০' on its own is the question, and this column is the answer. */
    colDiscountReason: 'ছাড়ের কারণ',
    colNet: 'দিতে হবে',
    colPaid: 'জমা হয়েছে',
    colRemaining: 'বাকি',
    colDueDate: 'শেষ তারিখ',

    /* The month's attendance. Every state gets a column of its own as well as
       feeding the rate, so an owner who counts 'দেরি' differently from us can
       redo the sum from the same row. */
    colSessions: 'ক্লাস হয়েছে',
    colUnmarked: 'হাজিরা নেওয়া হয়নি',
    colRate: 'উপস্থিতির হার %',

    /* The month's marks. পূর্ণমান is the word already on the exam screen and on
       every question paper in the country, so it is not translated twice. */
    colExam: 'পরীক্ষা',
    colExamType: 'পরীক্ষার ধরন',
    colSubject: 'বিষয়',
    colTotalMarks: 'পূর্ণমান',
    colObtained: 'প্রাপ্ত নম্বর',
    colPercent: 'শতকরা %',
    colResult: 'ফলাফল',
    /** Only where the exam has a pass mark set; blank where it has none. */
    resultPass: 'পাস',
    resultFail: 'ফেল',

    /**
     * What an invoice's status column says. Derived from the figures beside it
     * rather than stored, so these three can never contradict the row they label.
     */
    paid: 'পরিশোধ',
    partial: 'আংশিক',
    unpaid: 'বাকি',

    /** A tick box, in a column an owner will filter on. */
    yes: 'হ্যাঁ',
    no: 'না',
  },

  /**
   * The three chips, the two reasons there might be none, and what the two message
   * chips turn into on a laptop — where `sms:` and `tel:` open nothing, so copying
   * is the honest version of the same action. See src/lib/pointer.ts.
   */
  chase: {
    noNumber: 'অভিভাবকের নম্বর নেই।',
    addNumber: 'যোগ করে নিন',
    optedOut: 'এই পরিবার এসএমএস পেতে চায় না — ফোন করা যাবে।',

    /** Short, because it sits where 'এসএমএস' and 'কল' sat and the row is 375px. */
    copySms: 'বার্তা কপি',
    copyNumber: 'নম্বর কপি',

    /** `title` tooltips, so only ever read on a device with a mouse. */
    copySmsHint: 'ফোনে পেস্ট করে পাঠিয়ে দিন।',
    copyNumberHint: 'ফোন থেকে ডায়াল করুন।',

    copied: 'কপি হয়েছে ✓',
    /** Nothing is recorded when this shows — see the English note. */
    copyFailed: 'কপি করা যায়নি',
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
     * Why the list is empty, which is a different question from whether it is.
     * Four situations and an owner deserves to know which one they are in: a bare
     * "nothing to do" reads as a broken screen to someone who can see twelve unpaid
     * rows on the board. Keyed by ChaseEmptyReason, so a fifth reason added to the
     * schedule cannot ship without copy — see chaseEmptyReason and the i18n test.
     */
    noneBecause: {
      nothingOwed: 'কোনো ফি বাকি নেই।',
      /**
       * The one of the four that is not "relax". The list is empty because the
       * phone numbers are missing, not because the money came in — and the card
       * below it names the students and links to where the numbers go. Without
       * this line the screen said "শেষ তারিখ এখনো আসেনি" directly above a card
       * listing families whose deadline had passed weeks ago.
       */
      allUnreachable: 'যাদের আজ মনে করানোর কথা, তাদের কারও অভিভাবকের নম্বর নেই।',
      allRecent: 'যাদের বাকি আছে, সবাইকে সম্প্রতি বলা হয়েছে। কয়েক দিন সময় দিন।',
      notDueYet: 'যে ফি বাকি আছে, তার শেষ তারিখ এখনো আসেনি।',
    },

    heldCount: (n: number) => `${n} জনকে সম্প্রতি বলা হয়েছে`,
    waitingCount: (n: number) => `${n} জনের শেষ তারিখ এখনো আসেনি`,

    unreachableTitle: (n: number) => `${n} জনের অভিভাবকের নম্বর নেই`,
    unreachableBody: (names: string) =>
      `নম্বর ছাড়া মনে করিয়ে দেওয়ার উপায় নেই — ${names}`,
    addNumbers: 'নম্বর যোগ করুন',
    backToBoard: 'ফি বোর্ডে ফিরুন',

    unreadable:
      'আজকের তালিকা এখন তৈরি করা গেল না, তাই দেখানো হচ্ছে না — এর মানে মনে করানোর কেউ নেই তা নয়। একটু পরে আবার চেষ্টা করুন।',
    tooLarge:
      'বাকি থাকা ফির সংখ্যা এত বেশি যে এই পর্দা একবারে হিসাব করতে পারছে না। আপনার হিসাবে কোনো সমস্যা নেই — আমাদের সাথে যোগাযোগ করুন, আমরা আজকের তালিকা পৌঁছে দেব।',

    /**
     * The door onto this screen, on the fee board and on the dashboard. It borrows
     * `title` and `noneTitle` rather than restating them, because it is a door to
     * this screen and not a second screen — only the count's tail is its own, and
     * only because the number beside it is red and bold and so cannot be inside a
     * filled string.
     */
    entryDueSuffix: 'জনকে আজ মনে করিয়ে দেওয়ার কথা',
    /** See en.reminders.entryUnknown. */
    entryUnknown: 'আজকের তালিকা দেখতে খুলুন',

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
   * The screen that loads what a centre was already owed before this app existed.
   *
   * A client component — one box per student and a total that adds up as they are
   * typed — so: strings only, and the ones with a figure in them are `{}` templates
   * filled in the browser. See ./fill.ts.
   *
   * Every sentence here is written for the owner sitting beside their paper register
   * with the founder's phone in front of them. That is the only time this screen is
   * ever opened, and if it needs explaining twice the centre does not get signed up.
   */
  arrears: {
    title: 'পুরনো বাকি',
    subtitle: 'অ্যাপ চালু করার আগে যা বাকি ছিল, একবারে তুলে দিন',
    backToFees: 'ফি বোর্ডে ফিরুন',
    /**
     * The one paragraph that has to land. An owner does not think of this as
     * "creating invoices" — they think of it as copying their খাতা in, and the
     * sentence has to say that before it says anything about months or dates.
     */
    howTo:
      'খাতা দেখে যার যত টাকা বাকি, তার ঘরে সেটা লিখুন। যাদের কিছু বাকি নেই তাদের ঘর খালি রাখুন। সেভ করলে এই টাকাগুলো ফি বোর্ডে বকেয়া হিসেবে উঠবে, আর বাকির তালিকায় পরিবারগুলো চলে আসবে।',
    month: 'কোন মাসের হিসাবে',
    /**
     * Not a hint about the input, a hint about the rule. The generator owns the
     * current month, and a bill written here into that month would make it skip the
     * family — so the list only offers finished months and this line says why.
     */
    monthHint: 'শেষ হয়ে যাওয়া একটি মাস — চলতি মাসের ফি উপরের বোতাম দিয়ে তৈরি হবে',
    dueDay: 'শেষ তারিখ ছিল',
    dueDayHint: 'ওই মাসের কত তারিখের মধ্যে দেওয়ার কথা ছিল',
    dayOption: '{d} তারিখ',
    colStudent: 'শিক্ষার্থী',
    colAmount: 'বাকি (৳)',
    /** The box's own label, read out by a screen reader. See the page. */
    amountFor: '{name}-এর বাকি',
    /**
     * What stands where the box would be when that month's slot is already filled.
     *
     * The amount is shown rather than just the fact, because checking the figure is
     * the reason an owner comes back to this screen at all. Two sentences rather than
     * one, because the way out of each is different: a live bill is already on the
     * board and needs nothing, a cancelled one is somebody having undone it and the
     * amount now has to go against a different month.
     */
    billed: '{amount} — বিল আছে',
    billedCancelled: '{amount} — বাতিল',
    filledCount: '{n} জনের বাকি লেখা হয়েছে',
    total: 'মোট',
    submit: 'পুরনো বাকি যোগ করুন',
    emptyTitle: 'ব্যাচে ভর্তি করা শিক্ষার্থী নেই',
    emptyBody:
      'আগে শিক্ষার্থীদের ব্যাচে ভর্তি করুন। পুরনো বাকি একটি চালু ভর্তির সাথে যুক্ত হয়েই বোর্ডে ওঠে।',
    /** See en.arrears.unreadable for why this is a screen and not a card. */
    unreadable:
      'তালিকাটি এখন তৈরি করা গেল না, তাই দেখানো হয়নি — কিছুই হারায়নি। একটু পরে আবার চেষ্টা করুন।',
    /** See fees.close.tooLarge for why this does not point anywhere. */
    tooLarge:
      'ফাইলে বিলের সংখ্যা এত বেশি যে এই পর্দা একবারে যাচাই করতে পারছে না। আপনার হিসাবে কোনো সমস্যা নেই — আমাদের সাথে যোগাযোগ করুন, আমরা আপনার সাথে বসে পুরনো বাকি তুলে দেব।',
    safeToRepeat:
      'ওই মাসে যার বিল আগেই আছে, তার হিসাব বদলাবে না — তাই দুইবার চাপলেও সমস্যা নেই।',
    /**
     * The correction, which needs saying because the obvious guess does not work.
     *
     * A bill keeps its month's slot even after it is cancelled — that is deliberate, so
     * the monthly generator cannot re-bill a student who left — which means cancelling
     * a wrong amount does not free the box to type the right one. Another finished
     * month does, and for an opening balance the month it is filed under carries no
     * meaning of its own.
     */
    howToFix:
      'ভুল টাকা লিখে ফেললে ফি বোর্ড থেকে ওই বিলটি বাতিল করুন, তারপর সঠিক টাকা অন্য কোনো শেষ হয়ে যাওয়া মাসের হিসাবে লিখুন — বাতিল করা বিল ওই মাসের জায়গা ছাড়ে না।',
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
    /** The rest of the batch, under the fraction. An absence counts as marked. */
    marksLeft: (n: number) => `${n} জনের নম্বর বাকি`,
    /** An exam on a batch with nobody enrolled — nothing here to mark. */
    emptyBatch: 'ব্যাচে কেউ নেই',
    /** The row's progress figures when the reads behind them did not arrive. */
    countsUnknown: 'হিসাব হয়নি',
    countsUnreadable:
      'কোন পরীক্ষা কতদূর এগিয়েছে তা এখন বের করা গেল না, তাই সেই সংখ্যাগুলো দেখানো হচ্ছে না। কোনো পরীক্ষায় ঢুকে তার নিজের নম্বর দেখুন। একটু পরে আবার চেষ্টা করুন।',
    countsTooLarge:
      'ফলাফলের সংখ্যা এত বেশি যে এই পর্দা একবারে হিসাব করতে পারছে না, তাই অগ্রগতির সংখ্যাগুলো দেখানো হচ্ছে না। কোনো পরীক্ষায় ঢুকে তার নিজের নম্বর দেখুন, বা আমাদের সাথে যোগাযোগ করুন।',
    /** Families told from the centre own phone, counted once each. */
    toldCount: (n: number) => `${n} জনকে জানানো ✓`,
    /**
     * The list was cut, with the way to reach the rest. Bangla numerals: this is
     * prose under the list, not a figure on a row.
     */
    limitNote: (n: number) =>
      `নতুন ${digits(n, 'bn')}টি দেখানো হচ্ছে। পুরনো কোনোটি দরকার হলে খুঁজে নিন।`,
    /** The floor under the search box itself. See the English note. */
    ceilingNote: (n: number) => `শুধু নতুন ${digits(n, 'bn')}টি পরীক্ষার মধ্যে খোঁজা হয়।`,

    /** The marks sheet's own page title. */
    marksTitle: 'নম্বর',
    noStudentsTitle: 'এই ব্যাচে শিক্ষার্থী নেই',
    noStudentsBody:
      'ব্যাচে শিক্ষার্থী যোগ করলে তাদের নাম এখানে নম্বর দেওয়ার জন্য চলে আসবে।',

    /** See en.exams.sheetUnreadable for why this says the marks are safe. */
    sheetUnreadable:
      'এই পরীক্ষার নম্বর এখন পড়া গেল না, তাই নম্বর বসানোর তালিকা দেখানো হয়নি — কোনো নম্বর হারায়নি। একটু পরে আবার চেষ্টা করুন।',

    newTitle: 'নতুন পরীক্ষা',
    needBatchTitle: 'আগে একটি ব্যাচ দরকার',
    needBatchBody:
      'পরীক্ষা একটি ব্যাচের জন্য হয় — ব্যাচের শিক্ষার্থীরাই নম্বর দেওয়ার তালিকায় আসে।',
    createBatch: 'ব্যাচ তৈরি করুন',
    /** See en.exams.batchesUnreadable for why it denies the wrong guess out loud. */
    batchesUnreadable:
      'আপনার ব্যাচগুলো এখন পড়া গেল না, তাই ফর্মটি দেখানো হয়নি। এর মানে কোচিংয়ে কোনো ব্যাচ নেই, তা নয় — একটু পরে আবার চেষ্টা করুন।',

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
     * On a row of the tap-to-send list, for a family already told about this
     * exam. The date is Bangla numerals like every other date; it is the answer
     * to "did somebody already do this one" and nothing is read down a phone.
     */
    toldOn: (date: string) => `${date} তারিখে জানানো হয়েছে ✓`,

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

      /**
       * তারিখ ছাড়া শুধু সম্পাদনাই আটকায় — নতুন পরীক্ষায় আজকের তারিখ ধরে নেওয়া হয়।
       * কারণটা updateExam-এ লেখা: সারিতে আগে থেকেই একটা তারিখ আছে, আর নাম ঠিক করতে
       * এসে কেউ যেন সেটা আজকের দিনে সরিয়ে না ফেলে।
       */
      dateRequired: 'পরীক্ষা কোন দিন হয়েছিল, সেই তারিখ বাছুন।',
      editFailed: 'পরীক্ষার তথ্য বদলানো যায়নি। আবার চেষ্টা করুন।',
      deleteFailed: 'পরীক্ষা মোছা যায়নি। আবার চেষ্টা করুন।',
      /**
       * এই পরীক্ষার সঙ্গে কী কী জড়িয়ে আছে, সেটাই গোনা যায়নি — তাই কোনো সিদ্ধান্তেই
       * ভরসা করা যাবে না। শিক্ষক যা লিখেছেন তাতে দোষ নেই, সেটা বাক্যেই বোঝানো হচ্ছে।
       */
      checkFailed: 'এই পরীক্ষায় আগে কী আছে তা দেখা যায়নি। আবার চেষ্টা করুন।',
      /**
       * নম্বরটা বলে দেওয়া হচ্ছে, নইলে শিক্ষককে সেটা খাতায় খুঁজতে হবে। মার্কের মতোই
       * ASCII — উপরের marksOverTotal দেখুন।
       */
      totalBelowMark: (highest: number) =>
        `এই পরীক্ষায় ${highest} নম্বর দেওয়া আছে, তাই পূর্ণমান তার চেয়ে কম হতে পারে না।`,
      /** কী এখনও বদলানো যায় সেটাও বলা, নইলে পাঠক পুরো সংশোধনই ছেড়ে দেন। */
      figuresSent:
        'ফলাফল SMS-এ চলে গেছে, তাই পূর্ণমান আর পাস নম্বর আর বদলানো যাবে না। নাম আর তারিখ এখনও ঠিক করা যায়।',
      deleteSent: 'এই পরীক্ষার ফলাফল SMS-এ অভিভাবকদের কাছে গেছে। এটি মোছা যাবে না।',
      /** সারি গোনা হচ্ছে, নম্বর নয় — তাই বাংলা অঙ্ক। */
      deleteTold: (n: number) =>
        `${digits(n, 'bn')}টি পরিবারকে এই ফলাফল আগেই জানানো হয়েছে। মোছার বদলে পরীক্ষার তথ্য ঠিক করুন।`,
      /** সবচেয়ে সাধারণ কারণ, আর একমাত্র যেটার পথ খোলা আছে — তাই পথটা বলা হচ্ছে। */
      deleteMarked: (n: number) =>
        `এই পরীক্ষায় ${digits(n, 'bn')}টি নম্বর তোলা হয়েছে। আগে নম্বরের খাতা থেকে সেগুলো মুছুন, বা মোছার বদলে পরীক্ষার তথ্য ঠিক করুন।`,

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
      'কিছু SMS ২টি হিসেব হচ্ছে — পরীক্ষার নাম বা কোচিংয়ের নাম ছোট করলে খরচ অর্ধেক হবে।',
    declined: 'এই পরীক্ষার SMS পাঠানো হয়নি। চাইলে পরে পাঠাতে পারবেন।',
    send: 'অভিভাবককে পাঠান',
    sending: 'পাঠানো হচ্ছে…',
    decline: 'এখন পাঠাবেন না',
    noUndo: 'পাঠানোর পর আর ফেরানো যায় না',
  },

  /**
   * The way a result actually reaches a parent today: the owner's own phone.
   *
   * The gate above spends credits that no centre has and no screen can buy — no
   * BTRC sender ID means no aggregator means no gateway — so until one exists this
   * section is the whole feature, not a fallback beside it. A client component, so
   * strings only; the per-row facts and `exams.toldOn` are written by the page.
   */
  resultNotices: {
    title: 'অভিভাবককে ফলাফল জানান',
    /**
     * Says all three things an owner needs before tapping: it is their own phone,
     * it costs the app nothing, and the tick is a record and not a delivery
     * report. The last one matters — we know they tapped, not that anyone read it.
     */
    body:
      'নিচের নাম থেকে বেছে নিন — আপনার ফোনের SMS বা হোয়াটসঅ্যাপ খুলে যাবে, লেখা বসানো থাকবে। কোনো ক্রেডিট লাগবে না, আপনার নম্বর থেকেই যাবে। কাকে জানানো হয়েছে তা এখানে টিক দিয়ে রাখা হবে।',
    saveMarksFirst: 'নম্বর সেভ করার পর অভিভাবকদের জানানোর তালিকা এখানে আসবে।',
    noNumbers:
      'যাদের নম্বর সেভ করা আছে, তাদের অভিভাবককে এখান থেকে জানানো যাবে। এখনও কারও নম্বর নেই।',
    /** The row's fact for a student who did not sit the paper. Never a zero. */
    absent: 'অনুপস্থিত',
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
   * ভুলে তৈরি হওয়া পরীক্ষা ঠিক করা — একই চারটি ঘর, তবে সারিটা আগে থেকেই আছে।
   *
   * এই দলটা দরকার হলো কারণ ফোনে দাঁড়িয়ে দুই ব্যাচের মাঝখানে পরীক্ষা তৈরি হয়, তাই ভুলও
   * হয়: ১০০ নম্বরের খাতায় পূর্ণমান ৫০, দুইয়ের নাম এক, আর এক ট্যাপ কাজ করেনি ভেবে
   * দুইবার তৈরি। ফর্মের লেবেল examForm থেকেই নেওয়া — একই ঘরের দুই নাম হলে শিক্ষক
   * ভাবেন দুটো আলাদা জিনিস।
   */
  examEdit: {
    back: 'পরীক্ষায় ফিরে যান',
    title: 'পরীক্ষার তথ্য ঠিক করুন',
    lead:
      'নাম, ধরন, পূর্ণমান আর তারিখ বদলানো যায়। খাতায় তোলা নম্বর যেমন আছে তেমনই থাকে।',
    /** ঘর নয়, শুধু একটা লাইন — এটাই একমাত্র জিনিস যা বদলানো যায় না। */
    onBatch: (batch: string) => `ব্যাচ: ${batch}`,
    cannotMove:
      'পরীক্ষা অন্য ব্যাচে সরানো যায় না — নম্বরগুলো এই ব্যাচের শিক্ষার্থীদের। ঠিক ব্যাচে নতুন করে পরীক্ষা তৈরি করুন।',
    dependsTitle: 'এই পরীক্ষায় এখন যা আছে',
    marked: (n: number) => `${digits(n, 'bn')}টি নম্বর তোলা হয়েছে`,
    highest: (highest: number) =>
      `সবচেয়ে বেশি ${highest}, তাই পূর্ণমান তার চেয়ে কম করা যাবে না।`,
    told: (n: number) =>
      `${digits(n, 'bn')}টি পরিবারকে নিজের ফোন থেকে ফলাফল জানানো হয়েছে। এখানে বদলালে তাদের কাছে সেটা পৌঁছায় না।`,
    frozen:
      'ফলাফল SMS-এ চলে গেছে, তাই পূর্ণমান আর পাস নম্বর আটকে গেছে। নাম আর তারিখ এখনও ঠিক করা যায়।',
  },

  /**
   * ওই পর্দার দুটি নিয়ন্ত্রণ — client component, তাই শুধু স্ট্রিং।
   *
   * উপরের দল থেকে আলাদা করে top-level রাখা হলো batchForm-এর কারণেই: `T` শুধু
   * top-level কী নেয়, আর উপরের গোনা বাক্যগুলো ফাংশন, যা ব্রাউজার ডাকতে পারে না।
   */
  examEditForm: {
    submit: 'সেভ করুন',
    /** See en.examEditForm.kindUnreadable for why it says the value is left alone. */
    kindUnreadable:
      'পরীক্ষার ধরনগুলো এখন পড়া গেল না, তাই এখানে ধরন বদলানো যাবে না। যেটা আছে সেটাই থাকবে, আর ফর্মের বাকি সব কিছু আগের মতোই সেভ হবে।',

    removeOpen: 'এই পরীক্ষা মুছে ফেলুন',
    removeHeading: 'পরীক্ষাটি মুছে ফেলবেন?',
    /**
     * কী হারাচ্ছে সেটা বলা — কিছুই নয়, কারণ নম্বর বা খবর থাকলে প্যানেলটাই খোলে না।
     * একই পরীক্ষা দুইবার তৈরি করে ফেলা মালিককে এটা স্পষ্ট করে বলতে হয়।
     */
    removeWarning:
      'পরীক্ষাটি তালিকা থেকে একেবারে চলে যাবে। আর কিছু বদলাবে না: এতে কোনো নম্বর তোলা হয়নি, কাউকে জানানোও হয়নি।',
    removeConfirm: 'মুছে ফেলুন',
    removing: 'মোছা হচ্ছে…',
    keep: 'থাকুক',
    blockedTitle: 'এই পরীক্ষা মোছা যাবে না',
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
     * The two things about the fee that are not obvious and cost money to learn late:
     * a zero bills nobody, and changing the number does not rewrite invoices already
     * issued. The field starts at zero, so the first one has to be said here.
     */
    feeHint: '০ থাকলে এই ব্যাচের কারও বিল হবে না। পরে বদলালে পুরোনো বিল বদলাবে না।',
    submit: 'ব্যাচ তৈরি করুন',

    /**
     * The edit form's own keys. Everything above is shared with it, because it is
     * the same batch and the same fields.
     */
    subjectHint: 'বিষয় বদলালে নতুন পরীক্ষা ওই বিষয়ে বসবে। আগের পরীক্ষার নম্বর যেখানে আছে সেখানেই থাকবে।',
    /** The one switch on this form that changes what other screens show. */
    runningLabel: 'ব্যাচটি চলছে',
    runningHint: 'বন্ধ করলে হাজিরার তালিকা থেকে সরে যাবে, পরের মাসের বিলও হবে না। নম্বর, হাজিরা আর পুরোনো বিল সব ঠিক থাকবে।',
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
    /** See en.studentForm.batchesUnreadable for why this is an aside, not a refusal. */
    batchesUnreadable:
      'ব্যাচের তালিকা এখন পড়া গেল না, তাই দেখানো হয়নি। শিক্ষার্থীকে এখনই যোগ করা যাবে, পরে তার নিজের পাতা থেকে ব্যাচে ঢোকানো যাবে।',
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
    /**
     * The two sentences that stop the worst quiet failure on the onboarding path.
     *
     * A student with no enrolment is inert in this product: the invoice generator
     * bills enrolments, the attendance sheet lists a batch, and the old-dues screen
     * hangs each debt on an enrolment. So a register pasted with no batch ticked
     * loads two hundred names that produce nothing — the fee board stays at ৳0 on
     * the one afternoon it is being shown to the owner who is deciding whether to
     * pay. Nothing on the screen used to mention it either way.
     *
     * Not a refusal, because loading the names first and sorting the batches
     * afterwards is a real way to work. It just has to be a choice rather than
     * something that happens by default and in silence.
     */
    noBatchPicked:
      'কোনো ব্যাচ টিক দেওয়া হয়নি। এই নামগুলো শুধু তালিকায় উঠবে — হাজিরা হবে না, ফির বিলও হবে না — যতক্ষণ প্রত্যেককে নিজের পাতা থেকে ব্যাচে ভর্তি না করা হয়।',
    /** The same thing said to a centre that has not opened its first batch yet. */
    noBatchesYet:
      'এখনো কোনো ব্যাচ নেই। নামগুলো শুধু তালিকায় উঠবে — হাজিরা হবে না, ফির বিলও হবে না — যতক্ষণ একটা ব্যাচ খুলে সবাইকে ভর্তি না করা হয়।',
    makeBatch: 'ব্যাচ খুলুন',
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
       * hint promising the teacher could change a guardian's mobile number, which no
       * checkbox has ever granted. There is an edit-a-student screen now —
       * /settings/students/[studentId], where the batch checkboxes and the guardian
       * number both live — but the page is pageRole('manager') and updateStudent is
       * staffAdmin(), so this grant does not reach it. 20260811000019 gives what the
       * screens behind this checkbox actually do, which is read the roster and admit
       * a student, and the label came down to meet it.
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
      /**
       * Same correction, and the label still stops at 'open': changing an existing
       * batch is built now — /settings/batches/[batchId] — but it is staff-admin, both
       * on the page and in updateBatch, so this checkbox does not reach it. A label
       * reading 'manage batches' would promise the edit form to somebody the action
       * refuses.
       */
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
   * Written for a plan with staff on it. A one-teacher plan normally gets
   * settings.teachers.soloTitle instead of any of this — except when it has more
   * teachers switched on than it covers, where the same list is drawn trimmed to
   * names and one button, so the permission strings go unused rather than lying.
   */
  teacherList: {
    /** A teacher who has been turned off. Their marks and hajira stay put. */
    inactive: 'বন্ধ',
    /** A record with no account behind it — see teacherForm.loginNow. */
    noLogin: 'লগইন নেই',
    /** Collapsed: reading the list is the common case, editing is the rare one. */
    edit: 'শিক্ষকের তথ্য বদলান',
    /**
     * The panel holds three errands now, so the summary above it stopped naming one
     * of them: it said "অনুমতি বদলান" while the first form inside it was the name.
     *
     * This form is first for the reason the subject row's rename is first — it is
     * the repair nearly every owner needs and the only one that can never be
     * refused. A misspelt teacher is on this list and on every batch they run.
     */
    detailsTitle: 'নাম ও বিষয়',
    nameLabel: 'নাম',
    whichSubjects: 'তিনি কোন কোন বিষয় পড়ান?',
    /** The same words the add form uses over the same five boxes. */
    permissionsTitle: 'তিনি কী কী করতে পারবেন',
    save: 'অনুমতি সেভ করুন',
    /**
     * Only on a row with no account behind it, and it is the promise teacherForm
     * .loginNowBody makes on the way in: a login can be given later. The summary is
     * the errand, not a question, because unlike the password box below it the owner
     * arrives at this one having decided.
     */
    loginSummary: 'লগইন দিন',
    loginBody:
      'লগইন দিলে তিনি নিজের ফোন থেকে হাজিরা ও নম্বর দিতে পারবেন। উপরে যেসব অনুমতি টিক দেওয়া আছে, শুধু সেগুলোই কাজ করবে।',
    loginPhone: 'মোবাইল নম্বর',
    /**
     * Two jobs in one line. The number is the login id, and this is the only screen
     * in the app where a teacher's number can be corrected — after an account exists
     * the same number lives on the profile and inside the login itself, so it stops
     * being a field and becomes an identity.
     */
    loginPhoneHint: 'এই নম্বর দিয়েই তিনি লগইন করবেন — ভুল থাকলে এখানেই ঠিক করে নিন',
    loginPassword: 'শুরুর পাসওয়ার্ড',
    loginPasswordHint: 'শিক্ষককে বলে দিন — লেখাটা দেখা যাচ্ছে',
    loginSubmit: 'লগইন তৈরি করুন',
    /** Never ticked by default — see settings.teachers.confirmLink for why. */
    loginConfirm: 'হ্যাঁ, এটাই তিনি — অ্যাকাউন্টটি যুক্ত করুন',
    /**
     * The only way back in for a teacher who has forgotten their password. Login is
     * a number and a password with no email and no OTP, so there is no link to send
     * — which makes this the whole of "forgot password" in this product, and the
     * summary is worded as the question the owner arrives with rather than as the
     * action they are about to take.
     */
    resetSummary: 'পাসওয়ার্ড ভুলে গেছেন?',
    /**
     * Two sentences, and the second is the load-bearing one. An owner whose teacher
     * has left reaches for the password box, because changing the password is what
     * locking somebody out looks like everywhere else. Here it is not: an already
     * signed-in phone stays signed in, and the control that actually cuts access is
     * the button directly below this one. Saying so here is cheaper than a support
     * message a week later asking why the ex-teacher can still see the batch.
     */
    resetBody:
      'নতুন পাসওয়ার্ড দিয়ে শিক্ষককে বলে দিন। যিনি আর পড়ান না তাঁকে সরানোর জন্য এটি নয় — তার জন্য নিচের “শিক্ষককে বন্ধ করুন” বোতামটি।',
    resetLabel: 'নতুন পাসওয়ার্ড',
    /** Shown in the clear, and that is the point — see teacherForm.passwordHint. */
    resetHint: 'শিক্ষকের সামনে বসেই দিন — লেখাটা দেখা যাচ্ছে',
    resetSubmit: 'পাসওয়ার্ড সেট করুন',
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
    /**
     * On the reader's own row, where the switch-off button would otherwise be, and
     * only on the trimmed list a one-seat plan draws. Not a refusal — the button is
     * simply not there — so it names the row rather than explaining a rule.
     */
    yourSeat: 'আপনার নিজের রেকর্ড — এই প্ল্যানের একটিমাত্র জায়গা।',
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
    /** See en.teacherForm.subjectsUnreadable for why this is an aside, not a refusal. */
    subjectsUnreadable:
      'বিষয়ের তালিকা এখন পড়া গেল না, তাই দেখানো হয়নি। শিক্ষককে এখনই যোগ করা যাবে, পরে শিক্ষকের তালিকা থেকে তাঁর বিষয়গুলো টিক দেওয়া যাবে।',
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
    title: 'পরিবারকে কীভাবে জানানো হবে',
    /**
     * Why the dropdown is here and what it does *not* do. The second sentence is
     * the load-bearing one: an owner who thinks marking WhatsApp turns SMS off
     * would use this instead of the switch beside it, and then wonder why the
     * family still got a text.
     */
    channelHint:
      'যে মাধ্যমে পরিবার সত্যিই সাড়া দেয় সেটি বেছে দিন — ফি ও সাপ্তাহিক খবরের সারিতে সেই বোতামটি আগে থাকবে। কোনো বোতাম হারিয়ে যাবে না।',
    /** The blank option. Not a fourth channel: nobody has said, and that is fine. */
    channelAny: 'জানা নেই',
    /** Screen-reader label for the dropdown; filled per row in the browser. */
    channelFor: 'কীভাবে জানানো হবে — {name}',
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
    /** See en.dashboard.outstandingUnreadable. In place of the figure, not under it. */
    outstandingUnreadable:
      'বকেয়া কত তা এখন বের করা গেল না, তাই কোনো হিসাব দেখানো হয়নি — এর মানে কিছু বাকি নেই তা নয়। একটু পরে আবার চেষ্টা করুন।',
    /** See fees.close.tooLarge for why this does not point anywhere. */
    outstandingTooLarge:
      'বাকি থাকা ফির সংখ্যা এত বেশি যে এই পর্দা একবারে যোগ করতে পারছে না। আপনার হিসাবে কোনো সমস্যা নেই — আমাদের সাথে যোগাযোগ করুন, আমরা হিসাব পৌঁছে দেব।',
    /** Three tiles across a 375px screen, so these wrap rather than truncate. */
    collected: 'এ মাসে আদায়',
    students: 'শিক্ষার্থী',
    batches: 'ব্যাচ',

    todayAttendance: 'আজকের হাজিরা',
    batchesTaken: (done: number, total: number) => `${done}/${total} ব্যাচ নেওয়া হয়েছে`,

    overdueTitle: 'সময় পেরোনো ফি',

    /**
     * THE CARD THAT DECIDES WHETHER A CENTRE EVER SEES THE PRODUCT WORK.
     *
     * Everything in here hangs off an enrolment — the generator bills enrolments, the
     * register lists a batch, the old-dues screen hangs each debt on one, and the
     * at-risk list and the weekly note are built out of attendance. So a centre can
     * finish signing up, paste two hundred names, and land on a dashboard where every
     * figure is honestly zero and nothing says which of four things has still to
     * happen. That is the afternoon somebody decides the app does not work.
     *
     * One instruction at a time, in dependency order. All four are listed so an owner
     * can see how much is left, but only the next one gets its reason and its button:
     * four buttons is a to-do list, and one is an instruction.
     *
     * Each `why` is the consequence rather than the mechanic. Nobody needs to be told
     * what a batch is; they need to be told that without one there is no attendance
     * and no bill.
     */
    setup: {
      title: 'আর একটু বাকি',
      body: 'এই কয়টা হলেই হাজিরা, ফি আর ফলাফল — সব চলতে শুরু করবে।',
      done: 'হয়েছে',
      steps: {
        students: {
          label: 'শিক্ষার্থী যোগ করুন',
          why: 'রেজিস্টার থেকে নাম বসিয়ে দিন, বা একজন একজন করে যোগ করুন।',
          action: 'শিক্ষার্থী তালিকা',
        },
        batches: {
          label: 'একটা ব্যাচ খুলুন',
          why: 'ব্যাচ ছাড়া হাজিরাও নেওয়া যায় না, ফির বিলও হয় না।',
          action: 'ব্যাচ খুলুন',
        },
        enrolments: {
          label: 'শিক্ষার্থীদের ব্যাচে ভর্তি করুন',
          why: 'যে শিক্ষার্থী কোনো ব্যাচে নেই, সে শুধু তালিকায় আছে — তার হাজিরাও হবে না, বিলও হবে না।',
          action: 'শিক্ষার্থী তালিকা',
        },
        attendance: {
          label: 'একদিনের হাজিরা নিন',
          why: 'একবার হাজিরা নিলেই হাজিরার হিসাব আর ঝরে পড়া শিক্ষার্থীর তালিকা কাজ করতে শুরু করবে।',
          action: 'হাজিরা নিন',
        },
      },
    },

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
    /** The blank list a new centre gets, where `empty` above would be a false all-clear. */
    notWatchingYet: 'এখনও দেখার কিছু নেই',
    notWatchingYetHint:
      'কোচিং যা লিখে রাখে তা থেকেই এই তালিকা তৈরি হয়, আর তার কিছু এখনও লেখা হয়নি:',
    /**
     * One line per signal that had nothing to read. Bangla numerals, matching
     * `windows` on the same screen. Each line carries its own consequence, because
     * the footnote version stands alone under a list that does have names.
     */
    blind: {
      attendance: 'শেষ ৩০ দিনে কোনো হাজিরা নেওয়া হয়নি, তাই হাজিরার কারণে কারও নাম আসবে না।',
      marks: 'শেষ ১২০ দিনে কোনো পরীক্ষা হয়নি, তাই ফলের কারণে কারও নাম আসবে না।',
      fees: 'এখনও কোনো ফির বিল তৈরি হয়নি, তাই বাকি ফির কারণে কারও নাম আসবে না।',
    },
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

    /**
     * The worklist could not be read, so no names and no all-clear are drawn.
     *
     * Its own card rather than `empty`, whose sentence — no student is showing a bad
     * sign in any of the three — is the most confident thing this product says about
     * children. It is earned only when all three signals were read, which is the
     * whole argument of blindArms; a list that did not arrive at all has not earned
     * it either.
     */
    unreadable:
      'এই তালিকা এখন পড়া গেল না, তাই দেখানো হচ্ছে না — এর মানে সব ঠিক আছে নয়। আবার চেষ্টা করুন।',
    /** See close.tooLarge for why this does not point anywhere. */
    tooLarge:
      'সতর্ক হওয়ার মতো শিক্ষার্থীর সংখ্যা এত বেশি যে এক পর্দায় দেখানো যাচ্ছে না। আমাদের সাথে যোগাযোগ করুন, আমরা তালিকা পৌঁছে দেব।',
  },

  /**
   * One student's own page — the screen a parent's phone call gets answered from.
   *
   * Nothing here is a judgement, and the omission is the design. `risk` already
   * owns every sentence that says a student is drifting, and this page borrows
   * those words rather than writing gentler ones of its own: an owner who reads
   * 'হাজিরা কমে গেছে' on the at-risk list and something softer on the child's own
   * page has been handed two opinions and no way to know which one the list acted
   * on. There is no average mark below for the same reason — `marks_pct` on the
   * view already answers "how is this child doing", with thresholds behind it.
   *
   * So what is left is labels: four panels, a word above each figure, and a
   * sentence for each panel being empty. The empty ones carry more weight than
   * they look like they do. A blank attendance panel does not mean the student
   * stopped coming — it usually means nobody has been taking the register, and
   * those two facts need different conversations with different people. Each
   * empty string below says which of the two it is.
   *
   * Figures are not interpolated, for the reason `risk` sets out at length:
   * percentages, ratios and phone numbers stay ASCII in both languages and sit in
   * their own `.num` elements beside these words. Dates and the counts inside
   * prose take Bangla numerals, which is why the two `limitNote`s and `window` go
   * through `digits` instead of hard-coding a number that would then drift from
   * the constant it describes.
   */
  studentProfile: {
    /** The browser tab and the not-found heading. The page's own is the name. */
    title: 'শিক্ষার্থীর তথ্য',
    /**
     * RLS hides a student a teacher does not teach in exactly the way it hides one
     * who was never there, so this wording has to be true of both cases. 'পাওয়া
     * যায়নি' is; 'মুছে ফেলা হয়েছে' would be a guess, and the wrong one more often
     * than not.
     */
    notFound: 'শিক্ষার্থীকে পাওয়া যায়নি',
    notFoundBody: 'তালিকায় নেই, বা এই শিক্ষার্থী আপনার ব্যাচের কেউ নন।',
    /** Back where the reader came from, named for where it goes. */
    roster: 'শিক্ষার্থীর তালিকা',
    /** Only shown to an owner or manager — a permitted teacher may read, not edit. */
    edit: 'তথ্য ঠিক করুন',
    inactive: 'নিষ্ক্রিয়',

    /**
     * The one sentence that keeps this page honest for a teacher.
     *
     * A teacher's read of enrolments, sessions and results is narrowed to the
     * batches they teach, so the attendance and marks panels below are a slice of
     * the student and nothing on screen would say so. Worse, a student in none of
     * their batches renders `attendance.noBatches` — "not enrolled in a batch" —
     * which is false about the student and true only about the reader.
     *
     * So it names the limit once, above both panels, rather than twice as a
     * disclaimer under each. Not shown to an owner or a manager, who see all of it:
     * a caveat that is always on screen is a caveat nobody reads.
     */
    teacherScope: 'হাজিরা আর ফল — আপনি যে ব্যাচগুলো পড়ান, শুধু সেগুলোর হিসাব দেখছেন।',

    /**
     * The two numbers to ring, guardian first: a centre phones the parent about a
     * fee and the student about a class, and the fee is why this screen is open.
     *
     * Both print the digits beside the label rather than hiding them in the href.
     * `tel:` opens nothing on a laptop, and an owner reads the number back to
     * whoever picks up — the same call `RiskStudentRow` makes, for the same reason.
     */
    contact: {
      guardian: 'অভিভাবক',
      student: 'শিক্ষার্থী',
      call: 'ফোন করুন',
    },

    /**
     * The at-risk sentences, on the student they are about.
     *
     * 'যা খেয়াল করার' and not 'ঝুঁকি': the /at-risk page's heading names a list an
     * owner chose to open, while this panel appears unbidden on a page somebody
     * opened for a phone number. The list's own word would read as an accusation
     * against a child whose only problem might be an unpaid August bill.
     */
    flags: {
      title: 'যা খেয়াল করার',
      none: 'হাজিরা, নম্বর আর ফি — তিনটির কোনোটিতেই এখন খারাপ লক্ষণ নেই।',
    },

    /**
     * Per batch, never one figure for the student.
     *
     * A teacher's read of this data is narrowed by RLS to the batches they teach, so
     * a single "উপস্থিতির হার" here would silently be a per-batch number wearing a
     * whole-student label. Per batch is also the more useful answer: "পদার্থে ঠিক
     * আছে, রসায়নে আসা বন্ধ করেছে" is a sentence worth saying to a parent, and an
     * average of the two is not.
     */
    attendance: {
      title: 'হাজিরা',
      /** Under the panel heading. The only place the window is stated. */
      window: (days: number) => `শেষ ${digits(days, 'bn')} দিনের হিসাব`,
      /** No enrolment at all, so there is nothing to lay out. */
      noBatches: 'কোনো ব্যাচে ভর্তি নেই, তাই হাজিরার হিসাবও নেই।',
      /**
       * A batch with no class on record in the window. Points at the register,
       * because that is what an eight-week gap almost always means — and a row
       * reading '0%' would blame the student for it.
       */
      noClasses: 'এই সময়ে এই ব্যাচের কোনো ক্লাসের হিসাব নেই',
      /** Follows 'marked / sessions' in its own element: '7 / 9 হাজিরা নেওয়া হয়েছে'. */
      marked: 'হাজিরা নেওয়া হয়েছে',
      /**
       * When the register was opened more times than this student was marked in it.
       * Names the khata and not the child: an unmarked class is a missing record,
       * and treating it as an absence is how a screen invents one.
       */
      unmarkedNote: 'কিছু ক্লাসে এই শিক্ষার্থীর হাজিরা লেখাই হয়নি — খাতাটা দেখে নিন।',
    },

    /**
     * Every result on its own line, newest first, absences included as rows.
     *
     * A child who sat none of the last three tests is the thing this panel exists to
     * make visible. Dropping those rows — or averaging them in as zeroes — turns
     * 'আসা বন্ধ করেছে' into 'খারাপ করছে', which sends an owner into the wrong
     * conversation.
     */
    marks: {
      title: 'পরীক্ষার ফল',
      none: 'এখনো কোনো পরীক্ষার নম্বর তোলা হয়নি।',
      /** Sat the exam; nobody has entered a figure yet. Not the same as absent. */
      noMark: 'নম্বর তোলা হয়নি',
      limitNote: (n: number) => `শেষ ${digits(n, 'bn')}টি পরীক্ষা দেখানো হচ্ছে।`,
    },

    /**
     * Has this family paid — which is a different question from the fee board's.
     *
     * The board is a worklist and puts the oldest debt on top. This panel is read by
     * somebody already looking at one family, and their question is almost always
     * about this month, so the newest bill goes first.
     */
    fees: {
      title: 'ফি',
      allPaid: 'সব ফি পরিশোধ ✓',
      /** Follows nothing; the date is already formatted: 'সময় পেরিয়েছে ১১ আগস্ট ২০২৬ থেকে'. */
      overdueSince: (date: string) => `সময় পেরিয়েছে ${date} থেকে`,
      none: 'এই শিক্ষার্থীর জন্য এখনো কোনো ইনভয়েস তৈরি হয়নি।',
      due: 'শেষ তারিখ',
      paid: 'জমা',
      remaining: 'বাকি',
      settled: 'পরিশোধ ✓',
      /** Follows an ASCII day count in its own element: '12 দিন দেরি'. */
      lateDays: (_n: number) => 'দিন দেরি',
      /**
       * A teacher without `can_view_fees`. Says who does keep the accounts rather
       * than what the reader is not, the same as `fees.emptyBodyReadOnly` — a
       * teacher handed this screen by their owner needs to know who to ask.
       */
      hidden: 'ফি-এর হিসাব রাখেন মালিক বা ম্যানেজার।',
      /**
       * Why this family's bill is smaller than the batch's fee.
       *
       * THIS IS THE SCREEN THE QUESTION GETS ASKED ON. An owner opens one student when a
       * parent rings, and until now the row showed only what was left owing — so a ৳২,০০০
       * fee with a ৳৫০০ waiver on it read as a plain ৳১,৫০০ bill, and the person on the
       * phone had no way to see the arrangement they were being asked about. The board has
       * shown it since the waiver could be granted; this is where it is read out.
       *
       * The fee and the waiver, in that order, and never the subtraction: the figure the
       * family owes is already the big number on the right of the same row, and printing it
       * a third time here would be the second answer docs §4 forbids.
       */
      waived: (billed: string, discount: string) => `ফি ${billed} · ছাড় ${discount}`,
      /**
       * The word before an ASCII receipt number: 'রসিদ 104'.
       *
       * EVERY SLIP THE CENTRE EVER HANDED OVER IS LISTED UNDER ITS BILL, and this is
       * the label on the row. It exists because the receipt was, in practice,
       * unreachable: the fee board carries only this month's settled bills and the
       * collection register is one month at a time behind a paid plan, so a parent
       * asking in October for the slip they were given in July had nowhere to be sent.
       * The payment row was never lost — nothing in this product deletes money — it
       * just could not be found, which for the person at the desk is the same thing.
       */
      receipt: 'রসিদ',
      /**
       * A negative payment, which is the product's only way of handing money back.
       * Named on the row rather than shown as a minus sign: the figure beside it is
       * already signed, and a parent's copy of a refund is the record they keep.
       */
      refundReceipt: 'ফেরত',
      /**
       * Said once, under the list, and only where the paper is actually available —
       * on a plan without printed slips the same tap reaches the number and the
       * upgrade, so promising a print there would be one word short of true.
       *
       * 'যতবার দরকার' is doing real work. A receipt that seemed to disappear after
       * the second printing is what put this panel here, and an owner who has been
       * bitten once needs telling that reprinting is ordinary rather than a trick
       * that ran out.
       */
      receiptHint: 'যেকোনো রসিদে চাপ দিন — যতবার দরকার, আবার ছাপানো যাবে।',
      limitNote: (n: number) => `শেষ ${digits(n, 'bn')} মাসের ইনভয়েস দেখানো হচ্ছে।`,
    },
  },

  /**
   * The weekly note home — the one message this product sends that is not about
   * money.
   *
   * Every word here is chosen against the sentence a Bangladeshi parent says when
   * a coaching centre's number shows up on their phone: "কত টাকা?" So the heading
   * does not say রিপোর্ট (which promises a document nobody will read), the lead
   * says out loud that there is no bill in it, and the footnote repeats that at the
   * bottom of the screen. An owner who thinks this is another dunning list will not
   * use it, and a parent who learns it isn't will open the next one.
   *
   * Ratios stay ASCII on the row — `5/6`, `45/50` — for the reason `risk` gives
   * about percentages and one this screen makes sharper: the parent reads that
   * figure back down the phone, and the digits on the owner's screen must be the
   * digits in the message. Counts in prose take Bangla numerals as usual.
   */
  progress: {
    /** Matches the nav entry and the page heading. Short, because the nav is. */
    title: 'সপ্তাহের খবর',
    /**
     * Says what the screen is for in the words that make it worth doing. "টাকার
     * কথা ছাড়া" is not decoration — it is the whole difference between this and
     * every other message a coaching centre has ever sent a family.
     */
    lead: 'ফল বেরোনোর আগেই অভিভাবক জানুক ছেলেমেয়ে কেমন করছে — সপ্তাহে একটা মেসেজ, টাকার কথা ছাড়া।',
    /** The seven days everything on the screen is counted over. */
    covers: (from: string, to: string) => `${from} থেকে ${to}`,

    dueTitle: 'আজ যাদের অভিভাবককে জানানো যায়',
    /** Follows a count set four times larger, in its own element. See `reminders.people`. */
    people: (_n: number) => 'জনকে',

    /** On a row, before the ASCII ratio: 'হাজিরা 5/6'. */
    attendance: 'হাজিরা',
    /**
     * Not '0/0'. A week with no register is a hole in the centre's own records, and
     * saying so is the honest version — the alternative reads to an owner as a
     * child who came to nothing, which is what a parent would then be told.
     */
    noRegister: 'হাজিরা তোলা হয়নি',
    /** Follows a count: '১ দিন দেরি'. The word matches `attendance.late`. */
    late: (_n: number) => 'দিন দেরি',
    /** Follows a count: '১ দিন ছুটি'. The word matches `attendance.excused`. */
    excused: (_n: number) => 'দিন ছুটি',
    /** No exam at all this week — different from having sat one and scored badly. */
    noExam: 'পরীক্ষা হয়নি',
    /** Follows a count: '২ পরীক্ষায় অনুপস্থিত'. Same words as `risk.reasons`. */
    examsMissed: (_n: number) => 'পরীক্ষায় অনুপস্থিত',
    /** On a row that was done recently: 'গত বৃহস্পতিবার জানানো হয়েছে'. */
    told: (when: string) => `${when} জানানো হয়েছে`,

    noneTitle: 'আজ নতুন করে কাউকে জানানোর নেই',
    /**
     * Which of the four, because "nothing to do" reads as a broken screen to an
     * owner who can see a hundred and fifty names on the students page. Same call
     * `reminders` makes about its own empty state, and keyed the same way — by
     * ProgressEmptyReason, so a fifth situation cannot ship without a sentence.
     *
     * Every one of these is true of exactly the students it describes. Two of them
     * say "যাদের এখনো জানানো বাকি", and those three words are what stops the
     * screen claiming something about a whole week when only part of it applies —
     * see progressEmptyReason for the version that got that wrong.
     */
    noneBecause: {
      noStudents: 'এখনো কোনো শিক্ষার্থী যোগ করা হয়নি।',
      nothingRecorded:
        'যাদের এখনো জানানো বাকি, তাদের এ সপ্তাহের হাজিরা বা পরীক্ষার ফল লেখা হয়নি — লেখা হলেই এই তালিকা ভরে যাবে।',
      /** Everything recorded, nobody reachable. The card below names them. */
      noNumbers: 'যাদের এখনো জানানো বাকি, তাদের অভিভাবকের নম্বর নেই।',
      allRecent: 'সবার অভিভাবককে গত কয়েক দিনেই জানানো হয়েছে।',
    },

    /** Counted, not listed: an owner does not need the names of finished families. */
    heldSent: (n: number) => `${n} জনের অভিভাবককে সম্প্রতি জানানো হয়েছে`,
    /**
     * The one line that replaces a hundred and fifty rows each saying the same
     * thing, with the link that fixes it beside it.
     */
    heldNothing: (n: number) => `${n} জনের এ সপ্তাহে হাজিরা বা পরীক্ষা কিছুই লেখা হয়নি`,
    takeRegister: 'হাজিরা নিন',

    unreachableTitle: (n: number) => `${n} জনের অভিভাবকের নম্বর নেই`,
    unreachableBody: (names: string) => `নম্বর ছাড়া জানানোর উপায় নেই — ${names}`,
    addNumbers: 'নম্বর যোগ করুন',

    /**
     * The heading over the students a search found that the worklist does not draw.
     *
     * The list above is only the families who can be messaged now, which is right for
     * an owner working down it — and wrong for an owner who has a guardian on the
     * phone asking about one child. Searched for by name, that child must not come
     * back as "কিছু পাওয়া যায়নি" when the truth is that they were told on Monday. So
     * a search reaches all four kinds of row and the three that cannot be sent are
     * listed here, with the reason under each name instead of a dead button.
     */
    matchedHeld: 'এই খোঁজে পাওয়া গেছে',
    /** Why there is no button on any of them, said once above the list. */
    matchedHeldHint: 'এদের এখন পাঠানোর কিছু নেই — নিচে কারণ লেখা আছে।',
    /**
     * The reason on a row already told, when the date did not come through.
     *
     * `told` with the date is what a row normally shows; this is the fallback, and it
     * says less rather than guessing a day.
     */
    whyTold: 'সম্প্রতি জানানো হয়েছে',
    /** Nothing recorded this week, so there is no week to describe. */
    whyNothing: 'এ সপ্তাহে হাজিরা বা পরীক্ষা কিছুই লেখা হয়নি',
    /** No number on file. Same fact as the card above, said about one child. */
    whyNoNumber: 'অভিভাবকের নম্বর নেই',

    /**
     * The footnote. States the window in Bangla numerals — no ratio on this line to
     * clash with — and says once more, at the bottom of the screen, that this
     * message asks for nothing.
     */
    windowNote: 'হিসাব শেষ ৭ দিনের: হাজিরা আর পরীক্ষার ফল। ফির কথা এই মেসেজে নেই — সেটা রিমাইন্ডারে আলাদা।',

    /** The door onto this screen, from the dashboard. Borrows `title` for the label. */
    entryDueSuffix: 'জনের অভিভাবককে সপ্তাহের খবর জানানো যায়',
    /** See en.reminders.entryUnknown. */
    entryUnknown: 'এই সপ্তাহ দেখতে খুলুন',
    seeAll: 'সবাইকে দেখুন',
    /** Unreachable through the view — students.name is not null. */
    noName: 'নাম দেওয়া নেই',

    /** See en.progress.unreadable for why this is not `noneTitle`. */
    unreadable:
      'এই সপ্তাহের হিসাব এখন বের করা গেল না, তাই কিছু দেখানো হয়নি — এর মানে জানানোর কেউ নেই তা নয়। একটু পরে আবার চেষ্টা করুন।',
    /** See close.tooLarge for why this does not point anywhere. */
    tooLarge:
      'শিক্ষার্থীর সংখ্যা এত বেশি যে এই পর্দা একবারে হিসাব করতে পারছে না। আপনার হিসাবে কোনো সমস্যা নেই — আমাদের সাথে যোগাযোগ করুন, আমরা এই সপ্তাহের তালিকা পৌঁছে দেব।',

    /**
     * The paywall, named for what is missing rather than "locked", exactly as the
     * export screen's is. The body says what a free teacher can still do, because
     * they genuinely can: the figures are on the student's own page, and reading
     * them out on the phone is what every centre does today.
     */
    lockedTitle: 'সাপ্তাহিক খবর এই প্ল্যানে নেই',
    lockedBody: (plan: string, pro: string) =>
      `${plan} প্ল্যানে হাজিরা আর নম্বর অ্যাপে দেখা যায়, কিন্তু অভিভাবককে পাঠানোর জন্য সপ্তাহের মেসেজ তৈরি হয় না। এক ট্যাপে সবার অভিভাবককে জানাতে ${pro} দরকার।`,
    seePlans: 'প্ল্যান দেখুন',
  },

  /**
   * The one screen where the centre writes the message itself.
   *
   * So the words here are careful never to say "send". Nothing is sent: the owner's
   * thumb does that from their own handset, and every sentence in this group either
   * says so or is silent about it. A "সবাইকে পাঠান" button that only wrote a row in a
   * table would be the worst lie this product could tell — forty families who were
   * never told, and a screen insisting they were. `জানিয়ে রাখুন` and `সেভ করুন`
   * throughout, never `পাঠান`.
   */
  notices: {
    title: 'নোটিশ',
    lead: 'এক ব্যাচের সব অভিভাবককে একই কথা জানান — বৃহস্পতিবার ক্লাস বন্ধ, পরীক্ষার তারিখ বদলেছে, নতুন বই আনতে হবে।',
    back: 'ড্যাশবোর্ডে ফিরুন',

    titleLabel: 'কী বিষয়ে',
    titlePlaceholder: 'ঈদের ছুটি',

    audienceLabel: 'কাদের জন্য',
    everyone: 'কোচিংয়ের সব পরিবার',
    /**
     * A batch whose name is not to hand: switched off since the notice went out,
     * or on a list that did not arrive with this page. True in both cases, which
     * is why the second one is allowed to reach it — see the note on the page.
     */
    oneBatch: 'একটি ব্যাচ',

    reachLine: '{n}টি নম্বর',
    reachSkipped: '· {n}টি পরিবারকে জানানো যাবে না',

    bodyLabel: 'যা লিখবেন',
    bodyPlaceholder:
      'ঈদের জন্য বৃহস্পতি ও শুক্রবার কোচিং বন্ধ থাকবে। শনিবার থেকে আগের সময়েই ক্লাস শুরু হবে।',
    bodyHint: 'শেষে আপনার কোচিংয়ের নাম নিজে থেকেই যোগ হয়ে যাবে।',
    submit: 'নোটিশ সেভ করুন',
    saved: 'সেভ হয়েছে। নিচ থেকে কপি করে নিজের ফোন থেকে পাঠিয়ে দিন।',

    logTitle: 'যা যা জানিয়েছেন',
    noneTitle: 'এখনো কিছু জানানো হয়নি',
    noneBody:
      'উপরে প্রথম নোটিশটি লিখুন। সেভ হলেই মেসেজ আর নম্বরগুলো কপি করার বাটন পাবেন — ফোনে পেস্ট করে পাঠিয়ে দেবেন।',

    rosterFailed:
      'পরিবারের তালিকা আসেনি, তাই নম্বরগুলো এখানে নেই। মেসেজটি কপি করা যাবে — নম্বরের জন্য একটু পরে আবার দেখুন।',
    rosterTooLarge:
      'এখানে এত পরিবার যে একবারে সব নম্বর ক্লিপবোর্ডে নেওয়া যাচ্ছে না, তাই নম্বরগুলো এখানে নেই। মেসেজটি কপি করা যাবে — নম্বরের জন্য আমাদের সাথে যোগাযোগ করুন।',

    /**
     * The two reads this screen withholds over, rather than drawing what arrived.
     *
     * `batchesUnreadable` takes the form away. Every other option list in this app
     * fails open with a line beside it, and that is wrong here for one reason: the
     * audience picker defaults to the whole centre. A batch list that did not arrive
     * leaves a form that looks finished, is already set to three hundred families,
     * and has no way left to say the thirty it was written for. The owner is the one
     * who sends, off their own handset, so the cost is not a row that can be edited
     * afterwards — it is an unrecallable message about one shut room, read by every
     * family at the centre.
     *
     * `logUnreadable` replaces “nothing has been sent out yet”, which is what a
     * failed read used to draw over a term of real announcements.
     */
    batchesUnreadable:
      'আপনার ব্যাচগুলো এখন পড়া গেল না, তাই ফর্মটি দেখানো হয়নি। ব্যাচের তালিকা না থাকলে শুধু কোচিংয়ের সব পরিবারকেই নোটিশ পাঠানো যায় — এক ব্যাচের জন্য লেখা কথা তখন সবার কাছে চলে যেত। একটু পরে আবার চেষ্টা করুন।',
    logUnreadable:
      'যা যা জানিয়েছেন তা এখন পড়া গেল না, তাই এখানে দেখানো হয়নি। কিছু হারায়নি — একটু পরে আবার চেষ্টা করুন।',

    segments: '{n}টি এসএমএস হিসেবে যাবে',
    copyMessageHint: 'ফোনে পেস্ট করে পাঠিয়ে দিন।',
    copyNumbers: 'নম্বরগুলো কপি করুন',
    copyNumbersRange: '{from}–{to} নম্বর',
    copyNumbersHint:
      'ফোনের To ঘরে পেস্ট করুন, তারপর নিচে মেসেজটি পেস্ট করুন। একবারে ২০টি, কারণ ফোন এর বেশি সাধারণত নেয় না।',
    noNumbers: 'তাদের কোনো অভিভাবকের নম্বর এখনো যোগ করা হয়নি।',

    errors: {
      titleRequired: 'নোটিশটি কী বিষয়ে, সেটি লিখুন।',
      bodyRequired: 'মেসেজটি লিখুন।',
      bodyTooLong: 'নোটিশটি পাঠানোর জন্য অনেক বড় হয়ে গেছে। ছোট করে আবার চেষ্টা করুন।',
      noBatch: 'ব্যাচটি আর তালিকায় নেই। অন্য একটি বেছে নিন।',
      failed: 'নোটিশটি সেভ করা যায়নি।',
    },
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
    /** See en.settings.listUnreadable for why one sentence covers all four screens. */
    listUnreadable:
      'এই তালিকাটি এখন পড়া গেল না, তাই দেখানো হয়নি — কিছু বদলায়নি। একটু পরে আবার চেষ্টা করুন।',
    /** The two success words the smaller forms share. */
    added: 'যোগ হয়েছে',
    saved: 'সেভ হয়েছে',
    removed: 'মুছে ফেলা হয়েছে',

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
       * প্ল্যানের হিসাবটাই করা যায়নি — গোনার উত্তর সংখ্যা নয়, ফাঁকা এসেছে। বলা
       * হচ্ছে কিছু যোগ হয়নি, কারণ মালিকের ওটাই দরকার: নইলে তিনি রিলোড করে কিছু
       * না দেখে আবার পেস্ট করবেন।
       *
       * planLimit থেকে আলাদা বাক্য, ইচ্ছে করেই। দেখা যায়নি বলে 'প্ল্যান শেষ' বললে
       * টাকা দেওয়া সেন্টারকে নেটওয়ার্কের এক ঝলকের জন্য আপগ্রেড স্ক্রিনে পাঠানো হয়,
       * আর ফ্রি ব্যবহারকারীকে একেবারেই তাড়িয়ে দেওয়া হয়।
       */
      limitUnknown:
        'প্ল্যানে জায়গা আছে কিনা এখন দেখা গেল না, তাই কিছু যোগ হয়নি। আবার চেষ্টা করুন।',
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
      exports: 'ফাইল ডাউনলোড',
      exportsHint: 'শিক্ষার্থী, আদায়, ফি, হাজিরা, নম্বর',
      /**
       * The hint when the plan does not include it, replacing the description above.
       * A row that describes a screen the reader cannot use is a dead end they only
       * discover after tapping; saying it here means the tap is a choice.
       */
      exportsLocked: 'শিক্ষক প্রো প্ল্যানে পাওয়া যাবে',
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
      /**
       * The founder's own row, and the only one on this page that appears for a
       * property of the reader rather than of the centre. It is last because it is
       * not part of running a coaching centre at all — the account that sees it is
       * the account that sells the product.
       */
      founder: 'গ্রাহক তালিকা',
      founderHint: 'সব সেন্টার, ব্যবহার আর বিল — শুধু আমার জন্য',
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
      summary: 'হাজিরা আর নম্বর থেকে সাপ্তাহিক অভিভাবক রিপোর্ট',
      staff: 'শিক্ষক যোগ করা আর অনুমতি ভাগ করা',
      export: 'Excel ফাইলে তালিকা ডাউনলোড',
      /**
       * Why the list is eight rows and not twelve.
       *
       * The plan engine knows about branches and about paid SMS; neither exists.
       * Listing them with a tick beside a paid tier would be selling something
       * that does not exist, which is the one thing a price screen cannot do and
       * survive. Rows join this list on the day the screen behind them works, not
       * on the day the tier was priced: export joined when the three sheets
       * downloaded, and the weekly parent report joined when /progress shipped
       * with its own paywall — which made its absence the opposite mistake, a
       * price screen leaving out the single thing ৳499 buys.
       */
      onlyBuilt: 'যা এখন সত্যিই কাজ করছে শুধু তাই এই তালিকায়। নতুন কিছু চালু হলে যোগ হবে।',

      ladderTitle: 'প্ল্যানগুলো',
      /** One line each: what the tier is for, not a feature list. */
      addsFree: 'দেখে নেওয়ার জন্য — ১টি ব্যাচ, ৩০ জন শিক্ষার্থী।',
      addsPro:
        'একজন শিক্ষকের পুরো কোচিং — ৫টি ব্যাচ, ১৫০ জন, ছাপানো রসিদ, আদায় খাতা আর সাপ্তাহিক অভিভাবক রিপোর্ট।',
      addsCenter: 'শিক্ষক যোগ করা যায়, ব্যাচ-শিক্ষার্থীর সীমা নেই। দাম শিক্ষার্থী সংখ্যা অনুযায়ী।',
      addsInstitution: 'একাধিক শাখা এক হিসাবের নিচে। কথা বলে ঠিক করা হয়।',
      current: 'এখন এটিতেই আছেন',

      contactTitle: 'প্ল্যান বদলাতে চান?',
      /**
       * Rewritten when the form arrived. It used to say "message or call", which was
       * only true where the founder's number had been filled in — and it never was.
       */
      contactBody:
        'কোন প্ল্যান চান বলে দিন, আমরা ফোন করব — আপনার শিক্ষার্থী আর শিক্ষকের সংখ্যা আমাদের কাছেই আছে।',
      contactWhatsapp: 'WhatsApp',
      contactCall: 'ফোন করুন',
      /**
       * Prefilled, because a message an owner has to compose is a message they do
       * not send. It names the centre and the plan so the first reply can be an
       * answer instead of two questions.
       */
      contactMessage: (center: string, plan: string) =>
        `আসসালামু আলাইকুম। আমি ${center} থেকে বলছি, এখন ${plan} প্ল্যানে আছি। প্ল্যান নিয়ে কথা বলতে চাই।`,
      /**
       * What the owner sees while a request is open.
       *
       * OUTSIDE `upgrade` BELOW, and it has to be: that group is handed to a client
       * component whole, and Next refuses to serialise a group containing a function.
       * So the one sentence here with a plan and a date in it is composed by the
       * page, on the server, and travels as a plain string. Same rule as the founder
       * panel's `money` group.
       */
      pendingRequest: (plan: string, date: string) =>
        `${date} তারিখে ${plan} চেয়েছেন। আমরা ফোন করব।`,
      /**
       * The request form. STRING LEAVES ONLY — see `pendingRequest` above.
       *
       * "চাইছি" and not "আপগ্রেড": an owner asks, and what happens next is a phone
       * call, not a switch flipping. A button that said "upgrade now" would promise
       * something no code in this product can do — the tier only moves when the
       * founder moves it.
       */
      upgrade: {
        pick: 'কোন প্ল্যান?',
        note: 'কিছু জানানোর আছে?',
        noteHint: 'না লিখলেও চলবে। কত শিক্ষার্থী হবে, কখন থেকে শুরু করতে চান।',
        send: 'প্ল্যান বদলাতে চাই',
        sending: 'পাঠানো হচ্ছে…',
        withdraw: 'অনুরোধ বাতিল করুন',
        withdrawing: 'বাতিল হচ্ছে…',
        /** A manager sees this instead of the form. The owner pays, the owner decides. */
        ownerOnly: 'প্ল্যান বদলানোর অনুরোধ শুধু সেন্টারের মালিক করতে পারেন।',
        badPlan: 'প্ল্যানটা ঠিক নেই।',
        failed: 'পাঠানো যায়নি। আবার চেষ্টা করুন।',
        sent: 'পেয়েছি। মালিকের নম্বরে ফোন করা হবে।',
        withdrawn: 'অনুরোধ বাতিল হয়েছে।',
      },
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
        notFound: 'এই বিষয় আপনার তালিকায় নেই।',
        checkFailed:
          'এই বিষয় কোথায় কোথায় ব্যবহার হচ্ছে তা দেখা যায়নি। আবার চেষ্টা করুন।',
        deleteFailed: 'বিষয়টি মুছে ফেলা যায়নি। আবার চেষ্টা করুন।',
        /**
         * Names the batch and then the way out, in that order. An owner who came
         * here to remove a duplicate needs to know it is not a duplicate before
         * they are told what to do instead.
         */
        deleteBatches: (n: number) =>
          `${digits(n, 'bn')}টি ব্যাচে এই বিষয় পড়ানো হয়। নাম বদলে নিন, অথবা ওই ব্যাচগুলো শেষ হলে বিষয়টি বন্ধ করে দিন।`,
        deleteEnrolments: (n: number) =>
          `${digits(n, 'bn')}জন শিক্ষার্থী এই বিষয়ে ভর্তি আছে। মুছে ফেলার বদলে নাম বদলে নিন।`,
        deleteExams: (n: number) =>
          `এই বিষয়ে ${digits(n, 'bn')}টি পরীক্ষা হয়েছে। নাম বদলে নিন, অথবা বিষয়টি বন্ধ করে দিন — নম্বর যে নামে হয়েছে সেই নামই থাকবে।`,
        /** The plan cap, in the owner's terms rather than the plan's. */
        offLiveBatches: (n: number) =>
          `চালু ${digits(n, 'bn')}টি ব্যাচে এখনো এই বিষয় পড়ানো হয়। আগে ওই ব্যাচগুলো অন্য বিষয়ে নিন, বা ব্যাচগুলো বন্ধ করুন।`,
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
        notFound: 'এই ধরন আপনার তালিকায় নেই।',
        checkFailed: 'এই ধরন কোথায় ব্যবহার হচ্ছে তা দেখা যায়নি। আবার চেষ্টা করুন।',
        deleteFailed: 'ধরনটি মুছে ফেলা যায়নি। আবার চেষ্টা করুন।',
        /**
         * The database would allow this one and null the column, which would take
         * the kind off every exam ever held — including the ones already sent to
         * guardians. So the refusal is ours, and it offers the off switch instead.
         */
        deleteExams: (n: number) =>
          `এই ধরনে ${digits(n, 'bn')}টি পরীক্ষা হয়েছে। নাম বদলে নিন, অথবা ধরনটি বন্ধ করে দিন — আগে হওয়া পরীক্ষাগুলোর নাম ঠিকই থাকবে।`,
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
      /**
       * What stands where the price would, on a batch that has none. ৳০ read as a
       * figure rather than as a consequence, and the consequence is that nobody in
       * that batch is ever billed — which is either exactly what the owner meant or
       * why September came out short.
       */
      noFee: 'বিল হবে না',
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
      /** See en.settings.batches.subjectsUnreadable — it denies the wrong guess. */
      subjectsUnreadable:
        'আপনার বিষয়গুলো এখন পড়া গেল না, তাই ফর্মটি দেখানো হয়নি। এর মানে কোচিংয়ে কোনো বিষয় নেই, তা নয় — একটু পরে আবার চেষ্টা করুন।',

      created: 'ব্যাচ তৈরি হয়েছে',
      editTitle: 'ব্যাচ ঠিক করুন',
      editHint: 'সময়, ফি বা শিক্ষক বদলাতে ট্যাপ করুন',
      saved: 'ব্যাচ সেভ হয়েছে',
      errors: {
        nameRequired: 'ব্যাচের নাম লিখুন।',
        pickSubject: 'বিষয় বাছুন।',
        feeUnreadable: 'মাসিক ফি ঠিকভাবে লিখুন।',
        endBeforeStart: 'শেষের সময় শুরুর সময়ের পরে হতে হবে।',
        notFound: 'ব্যাচটি পাওয়া যায়নি।',
        saveFailed: 'ব্যাচ সেভ করা যায়নি।',
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
        /**
         * The same half-success on the edit screen, where "fix it from settings" is
         * no use — settings is where they already are. So it names the one part to
         * do again instead.
         */
        scheduleSaveFailed:
          'ব্যাচ সেভ হয়েছে, কিন্তু ক্লাসের দিন সেভ হয়নি। দিনগুলো আবার বাছুন।',
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
      /**
       * The other field that breaks the product silently, and the harder one to
       * notice: a student in no batch has nothing to be present at and no bill to
       * raise, so they sit on the roster looking admitted while producing nothing.
       * Counted above the list for the same reason the missing number is — a
       * register pasted with no batch ticked leaves two hundred of them, and the
       * only symptom is a fee board that stays at ৳0.
       *
       * Active students only. Somebody who has left has no batch because they left.
       */
      noBatch: (n: number) => `${n} জন কোনো ব্যাচে নেই`,
      noBatchBody: 'ব্যাচ ছাড়া হাজিরাও হবে না, ফির বিলও হবে না। নাম ট্যাপ করে ব্যাচে ভর্তি করুন।',
      /**
       * What turns either warning from a number into an afternoon's work: it filters
       * the list to exactly the students that card counted. Without it, "১২ জন কোনো
       * ব্যাচে নেই" over three hundred names is a fact nobody can act on.
       */
      showThese: 'এদের দেখান',
      emptyTitle: 'এখনও কোনো শিক্ষার্থী নেই',
      emptyBody:
        'শিক্ষার্থী যোগ করলে হাজিরা, পরীক্ষার নম্বর আর ফি — সব এখানে আসবে।',
      /** A student who has left. Their marks, attendance and bills stay put. */
      inactive: 'বন্ধ',
      noPhone: 'নম্বর নেই',
      /** The row's own version of the count above. Sits where the batch names would. */
      noBatchRow: 'কোনো ব্যাচে নেই',
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
      /** See en.settings.students.batchesUnreadable — it says nothing changed. */
      batchesUnreadable:
        'কোচিংয়ের ব্যাচগুলো এখন পড়া গেল না, তাই ফর্মটি দেখানো হয়নি — এই শিক্ষার্থীর কোনো কিছু বদলায়নি। একটু পরে আবার চেষ্টা করুন।',
      /**
       * On the roster row, telling the reader the row is worth tapping — and where
       * it goes, which changed. The row used to open the edit form, so this used to
       * promise a correction; it now opens the student's own page, and the edit form
       * is a button on it. The rewrite is the honest half of that move: a hint
       * offering to fix a number, on a row that answers a question instead, is how a
       * reader learns to stop reading the hints.
       *
       * Shown to everyone with rows now, not only to whoever may edit. A teacher the
       * owner ticked can read this list and cannot change it, and until the student's
       * page existed their rows did nothing when tapped.
       */
      openHint: 'হাজিরা, ফল আর ফি দেখতে শিক্ষার্থীর নামে ট্যাপ করুন',
      unreadable:
        'তালিকা এখন পড়া গেল না, তাই দেখানো হচ্ছে না — আপনার শিক্ষার্থীরা ঠিকই আছে। একটু পরে আবার চেষ্টা করুন।',
      tooLarge:
        'এই তালিকায় এত শিক্ষার্থী যে এক পর্দায় দেখানো যাচ্ছে না। আমাদের সাথে যোগাযোগ করুন, আমরা ব্যবস্থা করে দেব।',
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

      /** See en.settings.import.unreadable for why this does not say which read failed. */
      unreadable:
        'এখন এই পর্দাটি তৈরি করা গেল না, তাই নাম বসানোর ঘরটি দেখানো হয়নি — কিছুই হারায়নি। একটু পরে আবার চেষ্টা করুন।',

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
      /**
       * Deliberately does not name the channel. The row's dropdown already shows
       * which one was picked, and a sentence repeating it is one more place for
       * the two to disagree after a failed write.
       */
      channelSaved: 'কীভাবে জানানো হবে তা রাখা হয়েছে',
      channelCleared: 'কোনো মাধ্যম বেছে নেওয়া নেই',

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
      /** See en.settings.sms.statusUnknown for why it names both halves. */
      statusUnknown:
        'আপনার বার্তাগুলোর অবস্থা এখন পড়া গেল না, তাই কোনো সংখ্যা দেখানো হয়নি — এর মানে লাইনে কিছু নেই বা কিছু ব্যর্থ হয়নি, তা নয়। একটু পরে আবার চেষ্টা করুন।',
      /** See fees.close.tooLarge for why this does not point anywhere. */
      statusTooLarge:
        'ফাইলে বার্তার সংখ্যা এত বেশি যে এই পর্দা একবারে গুনতে পারছে না। আপনার হিসাবে কোনো সমস্যা নেই — আমাদের সাথে যোগাযোগ করুন, আমরা সংখ্যাগুলো পৌঁছে দেব।',

      recentTitle: 'সাম্প্রতিক পাঠানো',
      /** Says where the first one will come from, not just that there are none. */
      noneYet:
        'এখনও কোনো SMS পাঠানো হয়নি। পরীক্ষার নম্বর সেভ করার পর অভিভাবকদের জানানোর সুযোগ আসবে।',
      /** See en.settings.sms.recentUnreadable for why this is not `noneYet`. */
      recentUnreadable:
        'সাম্প্রতিক কী কী পাঠানো হয়েছে তা এখন পড়া গেল না — এর মানে কিছুই পাঠানো হয়নি, তা নয়। একটু পরে আবার চেষ্টা করুন।',
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
      /** See en.settings.sms.rosterUnreadable for why it says nothing changed. */
      rosterUnreadable:
        'শিক্ষার্থীর তালিকা এখন পড়া গেল না, তাই SMS বন্ধ-চালুর সুইচগুলো দেখানো হয়নি। কারও সেটিং বদলায়নি — একটু পরে আবার চেষ্টা করুন।',
      /** See fees.close.tooLarge for why this does not point anywhere. */
      rosterTooLarge:
        'শিক্ষার্থীর সংখ্যা এত বেশি যে এই পর্দা একবারে তালিকা করতে পারছে না। আপনার হিসাবে কোনো সমস্যা নেই — আমাদের সাথে যোগাযোগ করুন, যাঁরা বলেছেন তাঁদের SMS আমরা বন্ধ করে দেব।',
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
       * A subject that is switched off, in the tick list of what a teacher teaches.
       *
       * Only drawn where this teacher is already linked to it. The picker offers the
       * live subjects, and one that has been turned off is not on offer — but a link
       * made before it was turned off is still real, and leaving it out of the form
       * would mean an owner saving a name silently cut a link they were never shown.
       * So it is shown, marked, and theirs to untick.
       */
      subjectOff: (name: string) => `${name} (বন্ধ)`,
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
      /*
       * Shown instead of soloTitle when a one-seat plan has more than one teacher
       * switched on — a centre that was moved down a tier, not one that started
       * here. It is the only reason that screen draws a list at all, so the card
       * has to say what the list is for in one read: who to switch off, that
       * nothing gets deleted, and what the extra teachers can still do meanwhile.
       *
       * The last sentence is a disclosure and not a threat. Their fee board and
       * their send button are already gone (see lib/auth/session), and an owner
       * who is not told that will hear it from the teacher instead.
       */
      trimTitle: 'এই প্ল্যানের চেয়ে বেশি শিক্ষক চালু আছে',
      trimBody: (plan: string, active: number, limit: number) =>
        `${plan} প্ল্যানে ${digits(limit, 'bn')} জন শিক্ষক, কিন্তু এখানে ${digits(active, 'bn')} জন চালু আছেন। যাঁরা আর পড়ান না তাঁদের বন্ধ করে দিন — তাঁদের দেওয়া হাজিরা আর নম্বর মুছবে না। বন্ধ করার আগে পর্যন্ত তাঁরা নিজের ব্যাচের হাজিরা দিতে পারবেন, তবে ফি দেখা বা SMS পাঠানো আর পারবেন না।`,
      addedWithLogin: 'শিক্ষক ও তাঁর লগইন তৈরি হয়েছে',
      addedNoLogin: 'শিক্ষক যোগ হয়েছে (লগইন ছাড়া)',
      /**
       * Names the account that was joined to. If the owner mistyped a digit and
       * linked somebody else, this sentence is where they find out — so it says
       * whose account it was rather than reporting a plain success.
       */
      linked: (name: string) =>
        `শিক্ষক যোগ হয়েছে — পুরনো অ্যাকাউন্ট যুক্ত করা হয়েছে (${name})`,
      /** Both halves of the row's own form, in one line — see teacherList.detailsTitle. */
      detailsSaved: 'নাম ও বিষয় সেভ হয়েছে',
      permissionsSaved: 'অনুমতি সেভ হয়েছে',
      activated: 'চালু করা হয়েছে',
      deactivated: 'বন্ধ করা হয়েছে',
      /**
       * A login handed to a teacher who was added without one. Says both halves out
       * loud — the number and the password — because the owner is about to read them
       * back out to somebody standing next to them, and the number may be one they
       * have just typed for the first time.
       */
      loginGiven: 'লগইন তৈরি হয়েছে — শিক্ষককে নম্বর আর পাসওয়ার্ডটা বলে দিন।',
      /**
       * Handing a teacher a new password, and the four reasons an account cannot be
       * handed one.
       *
       * The refusals are keyed by ResetRefusal, so a fifth reason invented in
       * lib/auth/reset.ts stops both dictionaries compiling until it has a sentence
       * — the alternative being an owner who taps the button and reads nothing.
       *
       * Two of them are answerable and say what the answer is. `notOurs` is not, and
       * does not pretend: it is the teacher who also works down the road, and until
       * an OTP route exists nobody at either centre can reset them. Better that in
       * one sentence than a button that fails every time it is pressed.
       */
      reset: {
        done: 'নতুন পাসওয়ার্ড সেট হয়েছে — শিক্ষককে বলে দিন।',
        failed: 'পাসওয়ার্ড বদলানো যায়নি। আবার চেষ্টা করুন।',
        errors: {
          noAccount: 'এই শিক্ষকের লগইন নেই, তাই পাসওয়ার্ডও নেই।',
          self: 'এটি আপনার নিজের অ্যাকাউন্ট — এখান থেকে নিজের পাসওয়ার্ড বদলানো যাবে না।',
          inactive: 'তিনি এখন বন্ধ আছেন। আগে চালু করুন, তারপর নতুন পাসওয়ার্ড দিতে পারবেন।',
          notOurs:
            'এই অ্যাকাউন্টটি শুধু এই কোচিংয়ের নয় — অন্য জায়গাতেও ব্যবহার হয়, তাই এখান থেকে পাসওয়ার্ড বদলানো যাবে না।',
        },
      },
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
        /**
         * Refused rather than treated as "change it": once an account exists, its
         * password is the reset box and its number is its identity in three places
         * at once. See giveTeacherLogin.
         */
        hasLogin: 'এই শিক্ষকের লগইন আগেই আছে। পাসওয়ার্ড ভুলে গেলে নিচের “পাসওয়ার্ড ভুলে গেছেন?” দেখুন।',
        notFound: 'শিক্ষক পাওয়া যায়নি।',
        /**
         * The one row an over-cap owner may not switch off on a one-seat plan.
         * Says which row it is and what to do instead, because "পারবেন না" alone
         * on a screen whose whole purpose is switching teachers off reads like the
         * button is broken.
         */
        keepOwnSeat:
          'এটি আপনার নিজের শিক্ষক রেকর্ড — এই প্ল্যানে এই একটি জায়গাই আছে। অন্য কাউকে বন্ধ করুন।',
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

    /**
     * The download screen, and the sentences the download route answers with when it
     * refuses.
     *
     * Both in one group because they are one feature and there is only one place a
     * reader meets it. The errors come back as plain text over HTTP — the browser
     * navigated expecting a file, so there is no page to render an error component
     * into — which is exactly why they have to be full sentences rather than codes.
     *
     * Named for the file, not for "backup". A backup implies we would restore it, and
     * nothing here reads a CSV back in. What this is: the owner's own data, in their
     * hands, in a format that outlives us.
     */
    export: {
      title: 'ফাইল ডাউনলোড',
      subtitle: 'Excel বা Google Sheets-এ খোলার মতো তালিকা',
      month: 'মাস',
      show: 'দেখুন',
      download: 'ডাউনলোড করুন',
      /** Under the roster's button: it is today's list, not the month's above it. */
      asOf: (date: string) => `${date} পর্যন্ত`,
      /**
       * Keyed by ReportId, so a sheet added to the catalogue stops compiling until
       * it has a name and a sentence in both languages. Each body says what is in
       * the file, in the order the columns come — an owner deciding which one to
       * download should not have to download all five to find out.
       */
      reports: {
        students: {
          title: 'শিক্ষার্থীর তালিকা',
          body: 'নাম, আইডি, শ্রেণি, প্রতিষ্ঠান, অভিভাবকের নাম ও মোবাইল, কোন ব্যাচে আছে, ভর্তির তারিখ। যারা এখন আর আসছে না, তারাও থাকবে — অবস্থার ঘরে লেখা থাকবে।',
        },
        collections: {
          title: 'মাসের আদায়',
          body: 'কোন তারিখে কত টাকা জমা হলো, রসিদ নম্বর, কার কাছ থেকে, বিকাশ না ক্যাশ, ট্রানজেকশন আইডি। ছাপানো আদায় খাতার হিসাবই — Excel-এ।',
        },
        dues: {
          title: 'মাসের ফি হিসাব',
          body: 'কার কত বিল হলো, কত ছাড়, কত জমা পড়েছে, কত বাকি, শেষ তারিখ আর অভিভাবকের নম্বর। বাতিল করা বিল এতে থাকবে না।',
        },
        attendance: {
          title: 'মাসের হাজিরা',
          body: 'ব্যাচ ধরে প্রতি শিক্ষার্থীর এক লাইন — কত ক্লাস হয়েছে, কত দিন এসেছে, কত দিন আসেনি, দেরি, ছুটি আর উপস্থিতির হার। সঙ্গে অভিভাবকের নম্বর, যাতে হার কম যাদের, তাদের সোজা ফোন করা যায়।',
        },
        marks: {
          title: 'মাসের নম্বর',
          body: 'মাসের প্রতিটি পরীক্ষার নম্বর — তারিখ, পরীক্ষার নাম ও ধরন, বিষয়, ব্যাচ, পূর্ণমান, প্রাপ্ত নম্বর, শতকরা আর পাস-ফেল। যাদের নম্বর তোলা হয়েছে, শুধু তারাই থাকবে।',
        },
      },
      /** A CSV is not a word an owner knows. What they need is which app opens it. */
      opensIn: 'ফাইলটি Excel, Google Sheets বা WPS Office-এ খোলা যাবে। নাম বাংলাতেই ঠিক থাকবে।',
      /**
       * The paywall, named for what is missing rather than "locked". The body says
       * what the reader can still do without paying, because it is true and because a
       * free teacher with thirty students genuinely can copy a screen by hand.
       */
      lockedTitle: 'ফাইল ডাউনলোড এই প্ল্যানে নেই',
      lockedBody: (plan: string, pro: string) =>
        `${plan} প্ল্যানে তালিকা অ্যাপেই দেখা যায়, ডাউনলোড করা যায় না। শিক্ষার্থী, আদায়, ফি, হাজিরা আর নম্বরের তালিকা Excel ফাইলে নামাতে ${pro} দরকার।`,
      seePlans: 'প্ল্যান দেখুন',
      errors: {
        signIn: 'আগে লগইন করুন।',
        noCenter: 'এই অ্যাকাউন্ট কোনো কোচিংয়ের সঙ্গে যুক্ত নয়।',
        /**
         * Names both roles, like `settings.errors.forbidden`: a teacher who reads
         * only "অনুমতি নেই" cannot tell a boundary from a bug. Nothing here is
         * narrowed to one teacher's batches, so the answer is no rather than a
         * smaller file.
         */
        forbidden: 'ফাইল ডাউনলোড শুধু মালিক বা ম্যানেজার করতে পারেন।',
        needsPlan: 'এই প্ল্যানে ফাইল ডাউনলোড করা যায় না।',
        /** A hand-edited URL, or a link from a build that has moved on. */
        unknownKind: 'কোন তালিকা চাইছেন বোঝা গেল না।',
        unreadable: 'তালিকা তৈরি করা যায়নি। আবার চেষ্টা করুন।',
        /**
         * The ceiling, quoted from the constant the loop actually stops at — so the
         * number in the sentence cannot drift from the number in the code. A file cut
         * short looks exactly like a complete one, which is why this is an error a
         * person reads rather than a shorter download.
         */
        tooLarge: (rows: number) =>
          `তালিকাটি খুব বড় (${digits(rows, 'bn')}টির বেশি সারি)। মাস ধরে ধরে নামান, বা আমাদের জানান।`,
      },
    },
  },

  /**
   * The words on one row of the subject and exam-kind lists.
   *
   * Top-level and not inside `settings.subjects`, for the reason `batchForm` is not
   * inside `settings.batches`: the row is a client component, `T` only takes a
   * top-level key, and it maps every function leaf to `never`. So the counted
   * sentences — how many batches teach it, how many exams were sat in it — stay in
   * `settings.subjects.errors` where they can be functions, and are handed to the
   * row already written out by the page.
   *
   * Shared by both lists rather than written twice, because the two errands are the
   * same errand: an owner has mistyped a name, or has stopped using one.
   */
  settingsListRow: {
    /** The chip on a row that is off. One word — it sits next to the name. */
    off: 'বন্ধ',
    turnOff: 'বন্ধ করে দিন',
    turnOn: 'আবার চালু করুন',
    /**
     * What off actually does, because the word alone sounds like deletion. The
     * distinction matters most to the owner who is afraid of losing last term's
     * marks.
     */
    offHint:
      'যেখান থেকে বাছাই করেন সেই তালিকা থেকে সরে যাবে। যেখানে আগে থেকে আছে, নাম সেখানেই থাকবে।',
    offBlockedTitle: 'এখন বন্ধ করা যাবে না',
    removeOpen: 'মুছে ফেলুন',
    removeHeading: 'একেবারে মুছে ফেলবেন?',
    removeWarning:
      'কোথাও ব্যবহার হচ্ছে না, তাই আর কিছু বদলাবে না। শুধু তালিকা থেকে সরে যাবে।',
    removeConfirm: 'হ্যাঁ, মুছে ফেলুন',
    removing: 'মোছা হচ্ছে…',
    keep: 'থাকুক',
    blockedTitle: 'এটি মুছে ফেলা যাবে না',
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

  /**
   * The founder panel — the one screen in this product whose reader is not a
   * coaching centre.
   *
   * Written in Bangla like everything else, and that is not a formality: the person
   * reading it is a Bangladeshi student selling to Bangladeshi centre owners, and
   * an English-only admin screen would be the one place the product stopped being
   * the thing it claims to be. It also keeps this group under the same test as the
   * rest of the file, so a key added here without an English twin fails the build.
   *
   * Deliberately short. There is no help text, no onboarding, no empty-state
   * illustration and no explanation of what a column means, because the only reader
   * wrote the columns. What it does spell out is the two things that are easy to
   * misread on a glance: which figure is our money and which is the centre's, and
   * that the gateway column is zero for a reason rather than by accident.
   */
  founder: {
    title: 'গ্রাহক তালিকা',
    lead: 'সব সেন্টার, কে কতটা ব্যবহার করছে, আর এই মাসে কার কত বিল।',
    download: 'CSV নামান',
    empty: 'এখনও কোনও সেন্টার নেই।',
    emptyHint: 'প্রথম গ্রাহক যোগ হলেই এখানে দেখা যাবে।',
    /**
     * The failed-read branch, and it is a separate sentence from `empty` for a
     * reason worth keeping: "no customers" and "the query broke" look identical on
     * a blank screen, and the founder is the one person who cannot afford to
     * mistake the second for the first.
     */
    unreadable: 'তালিকা পড়া যায়নি।',
    unreadableHint: 'আবার লোড করুন। ঠিক না হলে ডেটাবেস দেখতে হবে।',
    /**
     * What /api/founder answers anyone who is not the founder. Says nothing about
     * what would have been there — see the route handler for why it is a 404 and
     * not a 403.
     */
    notFound: 'কিছু পাওয়া যায়নি।',
    unnamed: 'নাম নেই',
    noOwner: 'মালিকের নাম পাওয়া যায়নি',
    /** The window every 30-day count covers, said once at the bottom. */
    window: 'হাজিরা, পরীক্ষা, আদায় আর মেসেজ — শেষ ৩০ দিনের হিসাব।',
    /**
     * Why one column is always zero. Without this line a founder reading their own
     * panel in six months will think the gateway broke, rather than remembering
     * that it was never switched on.
     */
    gatewayNote: 'গেটওয়ে SMS সব সেন্টারে শূন্য — এখনও BTRC sender ID নেওয়া হয়নি।',
    /** center_status, in the words the founder would use about a customer. */
    status: {
      trial: 'ট্রায়াল',
      active: 'চালু',
      suspended: 'বন্ধ',
      cancelled: 'বাতিল',
    },
    /**
     * The strip across the top. `mrr` is ours and `collected` is theirs, and the two
     * labels say so — a founder who reads ৳4,50,000 as revenue for a month when it
     * is what parents paid twelve centres has misunderstood their own business.
     */
    totals: {
      centers: 'সেন্টার',
      active: 'চালু',
      trial: 'ট্রায়ালে',
      quiet: 'চুপচাপ',
      students: 'শিক্ষার্থী',
      teachers: 'শিক্ষক',
      mrr: 'মাসিক বিল (আমাদের)',
      pipeline: 'ট্রায়ালের সম্ভাবনা',
      collected: 'সেন্টারগুলো আদায় করেছে',
      /**
       * Four tap-to-send figures and not one "মেসেজ", because they answer four
       * different questions: `taps` is a centre using this to get paid, `notes` is
       * a teacher using it to keep parents, `results` is the marks hook, and
       * `absences` is the daily habit leaving the building. Which of the four a
       * customer does is the most useful thing on this screen when deciding what to
       * build next, and a total would hide exactly that.
       */
      taps: 'ফি রিমাইন্ডার গেছে',
      notes: 'সপ্তাহের খবর গেছে',
      results: 'রেজাল্ট গেছে',
      absences: 'অনুপস্থিতির খবর গেছে',
      paid: 'আমরা পেয়েছি',
      /**
       * The call list, and the money on it. `owing` counts live customers whose
       * paid-up date has passed; `owed` is one month of their billing and not their
       * arrears to date — see PlatformTotals for why the honest figure is the one
       * that can be checked.
       */
      owing: 'বিল বাকি',
      owed: 'বাকি (এক মাসের)',
      /**
       * The only tile that is a job rather than a measurement.
       *
       * "চাইছে" — present tense, still waiting. Every other figure in this strip
       * describes something that already happened; this one is a customer sitting by
       * their phone, which is why it sits in the first row beside the counts and not
       * down among the money.
       */
      asking: 'প্ল্যান চাইছে',
      /**
       * The other job on this strip, and the only one with a date attached.
       *
       * Counts trials in their last week AND trials already past thirty days, because
       * both are the same phone call and an overdue one is more urgent rather than
       * less. See TRIAL_ENDING_SOON_DAYS in lib/platform/centers.
       */
      ending: 'ট্রায়াল শেষ হচ্ছে',
    },
    /** One row's labels. Terse — they sit in a line under the centre's name. */
    bill: 'মাসে',
    size: {
      students: 'শিক্ষার্থী',
      batches: 'ব্যাচ',
      teachers: 'শিক্ষক',
    },
    usage: {
      attendance: 'হাজিরা',
      exams: 'পরীক্ষা',
      payments: 'আদায়',
      collected: 'টাকা উঠেছে',
      taps: 'রিমাইন্ডার',
      notes: 'সপ্তাহের খবর',
      results: 'রেজাল্ট',
      absences: 'অনুপস্থিতি',
      sms: 'গেটওয়ে',
      credits: 'ক্রেডিট',
    },
    signedUp: (date: string) => `যোগ দিয়েছে ${date}`,
    lastActive: (date: string) => `শেষ কাজ ${date}`,
    /** A centre that signed up and never came back. Not a day count. */
    neverActive: 'একবারও ব্যবহার করেনি',
    quiet: (days: number) => `${digits(days, 'bn')} দিন চুপচাপ`,
    /**
     * The trial clock, on the chip row of a trial card.
     *
     * THREE SENTENCES AND NOT ONE, because a countdown, a deadline today and an
     * overrun are three different phone calls. One sentence with a signed number in
     * it would be none of them, and "-৬ দিন বাকি" is not something a person says.
     *
     * Thirty days from the day they signed up, never a date somebody typed in — see
     * TRIAL_DAYS in lib/platform/centers for why that is derived and not stored.
     */
    trialLeft: (days: number) => `ট্রায়াল শেষ ${digits(days, 'bn')} দিনে`,
    trialToday: 'ট্রায়াল আজই শেষ',
    trialOver: (days: number) => `ট্রায়াল ${digits(days, 'bn')} দিন আগে শেষ`,
    /**
     * The date itself, down in the small print beside `paidThrough` and for the same
     * reason: the chip is the nudge, this is what gets said out loud — "আপনার ট্রায়াল
     * ২৬ তারিখ পর্যন্ত" — while the founder has them on the line.
     */
    trialEnds: (date: string) => `ট্রায়াল শেষ ${date}`,
    paidNothing: 'এখনও টাকা দেয়নি',
    paidTotal: (amount: string) => `দিয়েছে ${amount}`,
    /** How far the money they have given us reaches. The renewal date, in effect. */
    paidThrough: (date: string) => `${date} পর্যন্ত দেওয়া`,
    /**
     * A live centre past its paid-up date. Red on the card, one word in the CSV.
     *
     * "বিল বাকি" and not "বাকেয়া": the second is the correct accounting word and the
     * first is what a coaching centre owner and a founder actually say to each other
     * on the phone. This screen is read by one person and it is not an accountant.
     */
    owed: {
      badge: 'বিল বাকি',
      yes: 'বাকি',
      no: 'দেওয়া আছে',
    },
    /**
     * The sentences the two forms come back with.
     *
     * FUNCTIONS, AND THAT IS WHY THEY ARE HERE RATHER THAN IN `money` BELOW. A group
     * containing a function cannot be handed to a client component at all — Next
     * refuses to serialise it — so `money` is kept to string leaves and passed whole,
     * while every sentence with a taka figure or a month in it is composed by the
     * Server Action, on the server, and travels back inside its own result. See the
     * note at the top of src/app/founder/center-billing.tsx.
     */
    paymentSaved: (amount: string, from: string, to: string) =>
      `${amount} লেখা হয়েছে — ${from} থেকে ${to} পর্যন্ত।`,
    /** One month covered, where "August to August" would read like a mistake. */
    paymentSavedMonth: (amount: string, month: string) =>
      `${amount} লেখা হয়েছে — ${month}-এর জন্য।`,
    planSaved: (plan: string, state: string) => `এখন ${plan} · ${state}।`,
    tooMuch: (max: string) =>
      `একবারে ${max}-এর বেশি লেখা যাবে না। অঙ্কটা আরেকবার দেখুন।`,
    overLimit: (plan: string) =>
      `${plan}-এর সীমার চেয়ে বেশি শিক্ষার্থী বা শিক্ষক আছে। পুরনো কিছু মুছে যায়নি, `
      + `কিন্তু নতুন যোগ করা এখন আটকাবে।`,
    /**
     * The two forms behind "টাকা ও প্ল্যান" on each card.
     *
     * STRING LEAVES ONLY. This is the one group in the file that is handed straight to
     * a client component, so a function added here would break the founder panel at
     * render time rather than at compile time. Anything needing a number in it goes
     * above, next to `paidTotal`.
     */
    money: {
      open: 'টাকা ও প্ল্যান',
      payTitle: 'পেমেন্ট লিখুন',
      amount: 'কত টাকা',
      /** Said because the field is not empty, and a prefilled figure gets trusted. */
      amountHint: 'এই মাসের বিল বসানো আছে — অন্য অঙ্ক হলে বদলে নিন।',
      method: 'কীভাবে এসেছে',
      coversFrom: 'কোন মাস থেকে',
      months: 'কত মাসের',
      reference: 'ট্রানজেকশন আইডি',
      referenceHint: 'বিকাশ/নগদের TrxID। ক্যাশ হলে খালি রাখুন।',
      note: 'নোট',
      pay: 'পেমেন্ট লিখুন',
      paying: 'লেখা হচ্ছে…',
      planTitle: 'প্ল্যান ও অবস্থা',
      plan: 'প্ল্যান',
      state: 'অবস্থা',
      apply: 'বদলান',
      applying: 'বদলানো হচ্ছে…',
      /**
       * Money in, account still switched off — the pay-first-at-signup case half
       * done. A warning rather than something the action fixes itself, because
       * turning a customer on is a decision.
       */
      notActive: 'টাকা লেখা হয়েছে, কিন্তু সেন্টারটা এখনও চালু করা হয়নি — নিচে অবস্থা বদলান।',
      forbidden: 'এটা করার অনুমতি নেই।',
      noCenter: 'সেন্টারটা পাওয়া যায়নি।',
      badAmount: 'টাকার অঙ্কটা পড়া যায়নি।',
      badMethod: 'কীভাবে এসেছে সেটা ঠিক নেই।',
      badPeriod: 'মাসটা ঠিক নেই। আবার বেছে নিন।',
      badMonths: 'কত মাসের, সেটা ঠিক নেই।',
      badPlan: 'প্ল্যানটা ঠিক নেই।',
      badStatus: 'অবস্থাটা ঠিক নেই।',
      failed: 'লেখা যায়নি। আবার চেষ্টা করুন।',
    },
    /**
     * "সেন্টার প্ল্যান চেয়েছে" — an owner raised their hand on /settings/plan.
     *
     * OUTSIDE `asked`, and for the same reason `paymentSaved` sits outside `money`:
     * this one takes an argument, and `asked` goes to a client component whole. The
     * date is appended by the page rather than passed in here, so a request with no
     * timestamp still reads as a sentence.
     */
    askedFor: (plan: string) => `${plan} চেয়েছে`,
    /**
     * The tick-off button on a request.
     *
     * STRING LEAVES ONLY — handed straight to a client component, like `money`.
     *
     * "কথা হয়েছে" and not "হয়ে গেছে": the button does not mean the customer was
     * upgraded, it means the founder rang them. Half of these calls end in "next
     * term", and the queue has to empty for those too.
     */
    asked: {
      markHandled: 'কথা হয়েছে',
      marking: 'লেখা হচ্ছে…',
      handled: 'তালিকা থেকে সরানো হলো।',
      failed: 'করা যায়নি। আবার চেষ্টা করুন।',
    },
    /**
     * Read back after a founder-issued password reset, and the reason it carries a
     * name rather than a tick.
     *
     * OUTSIDE `lockout` because it takes an argument, exactly like `askedFor` sits
     * outside `asked`. The founder typed a number off a phone call, and this name is
     * the one chance they get to notice they typed it wrong — while the person who
     * rang is still on the line, not a week later.
     */
    resetDone: (name: string) =>
      `${name} — নতুন পাসওয়ার্ড দেওয়া হলো। এখনই ফোনে পড়ে শোনান।`,
    /**
     * The way back in for a locked-out owner, manager or teacher.
     *
     * STRING LEAVES ONLY — handed straight to a client component, like `money`.
     *
     * WHY THIS COPY EXISTS: login is a number and a password, so there is no "forgot
     * password" mail to send anybody. The owner's own screen resets a teacher who
     * belongs to no other centre and refuses everyone else — an owner, a manager, a
     * teacher who works at two centres — and those refusals say to ring the founder.
     * This is what the founder opens when that call comes.
     *
     * `passwordHint` admits the password is on screen, because the founder has to say
     * it out loud down the phone. `body` says the other phones stay signed in: GoTrue
     * does not end live sessions on a password change, and an owner ringing about a
     * handset they have lost is asking for a different thing than a way back in.
     */
    lockout: {
      summary: 'কেউ ঢুকতে পারছে না',
      body:
        'যে নম্বর দিয়ে তারা লগইন করে সেটি আর একটি নতুন পাসওয়ার্ড লিখুন, তারপর '
        + 'ফোনেই পড়ে শোনান। এই সেন্টারের মালিক, ম্যানেজার বা শিক্ষক — যে কারও '
        + 'চলবে। আগে থেকে লগইন করা অন্য ফোন নিজে থেকে লগআউট হবে না।',
      phone: 'লগইন নম্বর',
      phoneHint: 'যে নম্বর থেকে ফোন করছে, সাধারণত সেটিই।',
      password: 'নতুন পাসওয়ার্ড',
      passwordHint: 'স্ক্রিনে দেখা যাবে, কারণ এটি পড়ে শোনাতে হবে।',
      submit: 'পাসওয়ার্ড দিন',
      saving: 'দেওয়া হচ্ছে…',
      failed: 'করা যায়নি। আবার চেষ্টা করুন।',
      errors: {
        noAccount: 'এই নম্বরে কোনো অ্যাকাউন্ট নেই। নম্বরটি আবার মিলিয়ে নিন।',
        self:
          'এটি আপনার নিজের অ্যাকাউন্ট। নিজের পাসওয়ার্ড বদলানোর জায়গা এটি নয় — '
          + 'অ্যাকাউন্ট স্ক্রিন থেকে বদলান।',
        platformAdmin:
          'এই অ্যাকাউন্ট পুরো প্ল্যাটফর্মের, কোনো সেন্টারের নয়। এখান থেকে এটির '
          + 'পাসওয়ার্ড দেওয়া যাবে না।',
        notStaff:
          'এই নম্বরের অ্যাকাউন্ট এই সেন্টারে কাজ করে না। নম্বর আর সেন্টার — '
          + 'দুটোই মিলিয়ে নিন।',
      },
    },
    /**
     * The download's column headings. Localised, while every value in the file
     * stays machine-readable — same split as the centre exports on /api/export, and
     * for the same reason: a heading is read by a person and a cell is read by a
     * spreadsheet.
     */
    csv: {
      name: 'সেন্টার',
      area: 'এলাকা',
      status: 'অবস্থা',
      plan: 'প্ল্যান',
      bill: 'মাসিক বিল',
      owner: 'মালিক',
      ownerPhone: 'মালিকের নম্বর',
      centerPhone: 'সেন্টারের নম্বর',
      students: 'শিক্ষার্থী',
      teachers: 'শিক্ষক',
      batches: 'ব্যাচ',
      signedUp: 'যোগ দিয়েছে',
      /** Blank unless the centre is on trial. See the note in lib/platform/centers. */
      trialEnds: 'ট্রায়াল শেষ',
      attendance: 'হাজিরা (৩০ দিন)',
      exams: 'পরীক্ষা (৩০ দিন)',
      payments: 'আদায় সংখ্যা (৩০ দিন)',
      collected: 'আদায় টাকা (৩০ দিন)',
      taps: 'ফি রিমাইন্ডার (৩০ দিন)',
      notes: 'সপ্তাহের খবর (৩০ দিন)',
      results: 'রেজাল্ট SMS (৩০ দিন)',
      absences: 'অনুপস্থিতির খবর (৩০ দিন)',
      sms: 'গেটওয়ে SMS (৩০ দিন)',
      smsCredits: 'SMS ক্রেডিট',
      lastActive: 'শেষ কাজ',
      quietDays: 'চুপচাপ কত দিন',
      paid: 'মোট দিয়েছে',
      lastPaid: 'শেষ পেমেন্ট',
      paidThrough: 'কোন তারিখ পর্যন্ত দেওয়া',
      owes: 'বিল বাকি',
      /**
       * The three columns that are not measurements. Last on the row on purpose —
       * everything before them is what the centre did, these are what it asked for,
       * and a founder sorting the sheet by "wants" gets the call list.
       */
      wants: 'যে প্ল্যান চেয়েছে',
      wantsSince: 'কবে চেয়েছে',
      wantsNote: 'যা লিখেছে',
    },
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
