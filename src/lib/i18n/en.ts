/**
 * The same strings for the English-medium half of a Dhaka coaching centre.
 *
 * Typed as `Dictionary`, which is `bn`'s shape with the leaves widened. That
 * annotation is the whole safety net: a key added to bn.ts and forgotten here is
 * a compile error, an extra key here is a compile error, and a count-dependent
 * string whose signature drifts is a compile error. There is no runtime fallback
 * to Bangla — a fallback would turn all three into something only a teacher
 * standing in front of a class notices.
 *
 * Written as the English a Bangladeshi teacher writes, not as a dictionary
 * gloss. "Guardian" rather than "parent", because that is the word on every form
 * in the country and the one the schema uses. "Batch" is left alone for the same
 * reason — it is what a coaching centre calls a class group, and "section" or
 * "group" would be a translation of the word rather than of the thing.
 */
import type { Dictionary } from './bn.ts'

export const en: Dictionary = {
  common: {
    save: 'Save',
    saving: 'Saving…',
    willSend: 'Will send when the connection returns…',
    add: 'Add',
    adding: 'Adding…',
    creating: 'Creating…',
    cancel: 'Cancel',
    edit: 'Edit',
    view: 'View',
    seeAll: 'See all',
    optional: 'optional',
    /**
     * "Bangla name", not "local name" — the field asks for one specific language,
     * and an English-medium owner in Dhaka knows exactly which. What it costs to
     * leave blank is explained by the hint on the form, which differs by reader.
     */
    bnName: 'Bangla name',
    unknown: 'Unknown',
    dayLate: 'a day late',
    daysLate: '{n} days late',
    nameTooLong: 'Keep the name under {n} characters.',
    passwordTooShort: 'The password has to be at least {n} characters.',
    somethingWentWrong: 'Something went wrong',
  },

  search: {
    label: 'Search',
    placeholder: 'Name, ID or phone number',
    placeholderPayments: 'Name, receipt no. or transaction ID',
    go: 'Search',
    clear: 'Show all',
    showing: (shown: number, total: number) => `Showing ${shown} of ${total}`,
    none: 'Nothing matches that search.',
    noneHint: 'Check the spelling, or try fewer characters.',
  },

  shell: {
    logout: 'Log out',
    account: 'My account',
    mainMenu: 'Main menu',
    welcome: 'Welcome',
    otherCenter: 'Other centre',
    thisCenter: 'Here now',
    switchTo: 'Switch language to {lang}',
    /**
     * Short enough for a 48px tab at 375px, which is the constraint the Bangla
     * labels were written to and the one English loses most easily: "Attendance"
     * is ten characters where হাজিরা is six.
     */
    nav: {
      home: 'Home',
      attendance: 'Attendance',
      fees: 'Fees',
      settings: 'Settings',
      exams: 'Exams',
      mine: 'Mine',
      myChild: 'Child',
    },
  },

  account: {
    title: 'My account',
    back: 'Back to my screen',
    nameLabel: 'Name',
    noName: 'No name set',
    phoneLabel: 'Login number',
    phoneHint:
      'This is the number you sign in with. To change the number, ask the centre owner.',
    passwordTitle: 'Change your password',
    passwordBody:
      'The new password works straight away. Another phone that is already signed in will not be signed out on its own — you have to log out on that phone.',
    current: 'Current password',
    currentHint: 'To be sure this is really you',
    next: 'New password',
    nextHint: 'At least {n} characters',
    confirm: 'Type the new password again',
    submit: 'Change the password',
    done: 'Your password has been changed. Use the new one next time you sign in.',
    errors: {
      wrongCurrent: 'That is not your current password.',
      mismatch: 'The two new passwords do not match.',
      same: 'The new password is the same as the old one. Please pick another.',
      failed: 'The password could not be changed. Please try again.',
    },
  },

  denied: {
    title: 'You cannot open this page',
    atCenter: (center: string) => `Your role at ${center} does not open this page.`,
    askOwner: 'The centre owner can change what you are allowed to see.',
    home: 'Back to my screen',
  },

  missing: {
    title: 'We could not find that page',
    body: 'The link may be old, or what it pointed at was deleted.',
    home: 'Back to my screen',
  },

  offline: {
    banner: 'No connection — what you type is kept on this phone and sent when it returns',
    title: 'No connection',
    body:
      'A new page cannot load without the internet. Your half-marked register or '
      + 'marks sheet is still saved on this phone — open the app once you have a '
      + 'signal and saving will go through.',
    retry: 'Try again',
    stillOffline: 'Still no connection',
  },

  attendance: {
    present: 'Present',
    absent: 'Absent',
    late: 'Late',
    excused: 'Excused',
  },

  teach: {
    title: 'Today’s classes',
    pending: (n: number) =>
      `${n} ${n === 1 ? 'batch' : 'batches'} still to mark today`,
    allTaken: 'All of today’s attendance is taken',
    noClassToday: 'No classes today',
    firstBatchTitle: 'Make a batch to get started',
    firstBatchBody:
      'A batch is a class at a set time — say “7am Maths”. Once a batch exists you can add students to it.',
    addBatch: 'Add batch',
    /**
     * The same emptiness to a teacher, who cannot answer it. "Make a batch to
     * get started" is an instruction they cannot follow and the button under it
     * goes to a screen that refuses them, so they get the other half of the
     * fact — that somebody else assigns batches — and no button at all.
     */
    noBatchesTitle: 'None of the batches are yours yet',
    noBatchesBody:
      'Once the owner puts you on a batch, today’s classes show up here.',
    students: (n: number) => `${n} ${n === 1 ? 'student' : 'students'}`,
    /**
     * The same as `students`: Bangla shortens to জন on the narrow row and English
     * has nothing shorter than the word itself. Kept as two keys so the Bangla
     * side can stay short without the English side inventing an abbreviation.
     */
    studentsShort: (n: number) => `${n} ${n === 1 ? 'student' : 'students'}`,
    /**
     * 'Mark' and not 'Take attendance': the badge sits beside a batch name that
     * is already truncating at 375px. 'Taken' answers it — the two are four
     * characters apart, which is enough when one is a filled button.
     */
    taken: 'Taken',
    take: 'Mark',
    otherBatches: 'Batches with no class today',

    rosterTitle: 'Attendance',
    pastDate: 'past date',
    noStudentsTitle: 'No students in this batch',
    noStudentsBody: 'Add students and you can mark their attendance here.',

    futureTitle: 'This class has not happened yet',
    futureBody:
      'Attendance cannot be taken for a class that has not happened — nobody is in it yet. Mark it once the class is over.',
    closedTitle: 'This date is closed',
    closedBody:
      'Today’s class and your last class can be marked or corrected. To change anything older than that, ask the owner.',
    closedAdmin:
      'This is an older date. As an owner you can still write attendance here, but each name can only be changed once.',
    takeToday: 'Mark today',

    saved: (n: number) =>
      `Attendance saved — ${n} ${n === 1 ? 'student' : 'students'}`,
    savedExcept: (n: number) =>
      `Attendance saved. ${n} ${n === 1 ? 'mark had' : 'marks had'} already been corrected once, so ${n === 1 ? 'it' : 'they'} did not change.`,
    rowLabel: (name: string) => `${name} — attendance`,
    saveFor: (batch: string) => `${batch} — Save attendance`,
    lastClass: (date: string) => `Attendance for the last class — ${date}`,

    /** Worded exactly as `exams.toldOn` — see the note there. */
    toldOn: (date: string) => `Told ${date} ✓`,
    noPhoneCount: (n: number) =>
      `${n} ${n === 1 ? 'guardian' : 'guardians'} with no number`,
    optedOutCount: (n: number) =>
      `${n} ${n === 1 ? 'family has' : 'families have'} SMS turned off`,

    errors: {
      forbidden: 'You do not have permission to do this.',
      noBatch: 'Batch not found.',
      badDate: 'That date is not right. Please try again.',
      futureDate: 'Attendance cannot be taken for a class that has not happened.',
      closedDate:
        'This date can no longer be changed. Mark today’s class or your last one.',
      noStudents: 'No students were sent.',
      rosterUnreadable: 'Could not read the student list.',
      emptyBatch: 'This batch has no students.',
      saveFailed: 'Attendance was not saved. Please try again.',
    },
  },

  roster: {
    alreadyTaken: 'This batch already has attendance for this date.',
    finalEdit: 'Each name can be changed once more.',
    tapFreely: 'Tap as often as you like — nothing is sent until you press save.',
    lockedRow: 'already corrected once, cannot change again',
    note: 'Note',
    notePlaceholder: 'e.g. class ended early for a holiday',
  },

  absenceNotices: {
    title: 'Tell guardians who was not there',
    /**
     * Longer than most bodies here, and each clause earns its place: whose phone
     * sends it, that it is free, that a tick is a record and not a delivery
     * report, and — last — what the message deliberately does not say. An owner
     * who expects it to accuse the child will write their own message instead.
     */
    body:
      'Guardians of today’s absences can be told right now — pick a name and your phone’s SMS or WhatsApp opens with the message already written. No credits, and it goes from your own number. The message does not blame anybody; it says the child was not in class and asks the family to check.',
    nobodyAbsent:
      'Everybody in this batch was present today. There is nobody to tell.',
    noNumbers:
      'None of the absent students have a guardian number saved. Add one and you can message them from here.',
    saveFirst: 'Save the attendance and the list of absences shows up here.',
  },

  channels: {
    /**
     * Capitalised because these are read as labels on a chip, not in a sentence,
     * and because "SMS" is an initialism either way. "WhatsApp" keeps its own
     * capital W and A — it is a brand before it is a word.
     */
    sms: 'SMS',
    whatsapp: 'WhatsApp',
    call: 'Call',
  },

  /**
   * The Latin styling every English-medium owner in Dhaka reads on the app icon
   * — deliberately not a transliteration of the Bangla, and deliberately not what
   * the guardian receives. The SMS itself still says বিকাশ, because the parent did
   * not switch languages; see the note in bn.ts.
   */
  wallets: {
    bkash: 'bKash',
    nagad: 'Nagad',
    rocket: 'Rocket',
  },

  fees: {
    title: 'Fees',
    subtitle: 'Who has paid, who has not',
    outstanding: 'Total outstanding',
    unpaidCount: (n: number) => `${n} unpaid`,
    overdueCount: (n: number) => `${n} past the deadline`,
    /**
     * A colon where the Bangla needs none. "Collected this month ৳5,000" reads as
     * a mistake in English and "এই মাসে জমা হয়েছে ৳৫,০০০" does not, which is the
     * kind of thing a shared template with the figure in the middle would have
     * flattened into whichever language was written first.
     */
    collectedThisMonth: 'Collected this month:',
    inCredit: 'in credit',
    emptyTitle: 'No invoices yet',
    emptyBody:
      'Use the button above to raise this month’s invoices. One is created for every active enrolment, at that batch’s monthly fee.',
    /**
     * The same empty board, read by a teacher who may look and not raise. A
     * separate string rather than a clause dropped from the other one, because
     * "use the button above" *is* the other one — and a reader with no button
     * needs to be told the emptiness is somebody else's to fix, not a screen
     * that failed to load.
     */
    emptyBodyReadOnly:
      'No invoices have been raised for your batches yet. Only an owner or a manager can raise them.',
    /**
     * Under the outstanding total, for a teacher. What that figure counts is
     * their own batches and nothing else, and a fee total that is a subset has to
     * say so — the number gets read against a bKash statement, and one that is
     * quietly short is worse than no number at all.
     */
    yoursOnly: 'Your own batches only',

    registerLink: 'This month’s collection register',
    closeLink: 'This month’s full picture',

    /** The way onto the old-dues screen. See the Bangla note. */
    arrearsLink: 'Load the old dues',

    today: 'today',
    yesterday: 'yesterday',

    invoicesCreated: (count: number, total: string) =>
      `${count} ${count === 1 ? 'invoice' : 'invoices'} created — ${total} in total.`,
    invoicesAllExisted:
      'This month’s invoices were all created already. Nothing new was added.',
    received: (name: string, amount: string) => `${name} — ${amount} received.`,
    receivedInFull: (name: string, amount: string) =>
      `${name} — ${amount} received. Fee paid in full ✓`,
    stillOwed: (amount: string) => `${amount} is still owed.`,
    overpaid: (amount: string) =>
      `${amount} more than was owed has been received. Check it now if that is a mistake.`,

    invoiceCancelled: (name: string) => `${name} — the bill is cancelled.`,
    invoiceRestored: (name: string) => `${name} — the bill is back.`,

    refunded: (name: string, amount: string) => `${name} — ${amount} handed back.`,

    discounted: (name: string, amount: string) => `${name} — ${amount} waived.`,
    discountCleared: (name: string) =>
      `${name} — the waiver is off, and the bill is back at its full fee.`,

    cancelledCount: (n: number) => `${n} cancelled ${n === 1 ? 'bill' : 'bills'}`,
    cancelledBody:
      'These bills are nobody’s arrears any more. They are out of the outstanding total, and no guardian will be reminded about them. Put one back if it was cancelled by mistake.',

    /** What loading a centre's old dues says back. See the Bangla notes. */
    arrearsCreated: (count: number, total: string) =>
      `Old dues recorded for ${count} ${count === 1 ? 'student' : 'students'} — ${total} in total.`,
    arrearsSomeExisted: (n: number) =>
      `${n} already had a bill in that month and ${n === 1 ? 'was' : 'were'} left alone.`,
    arrearsAllExisted:
      'They all already have a bill in that month. Nothing new was added.',

    errors: {
      forbidden: 'Only an owner or a manager can keep the fee records.',
      dueDayRange: 'Pick a day between 1 and 28.',
      rosterUnreadable: 'Could not read the student list. Please try again.',
      nothingToBill:
        'There is nothing to invoice. Check whether the batches have a monthly fee set.',
      invoicesFailed: 'The invoices were not created. Please try again.',
      noInvoice: 'Could not tell which invoice this is.',
      amountUnreadable: 'Please write the amount properly.',
      amountZero: 'The amount cannot be zero.',
      amountNegative: 'The amount has to be more than zero.',
      invoiceMissing: 'Invoice not found.',
      invoiceVoided: 'This invoice has been cancelled.',
      paymentFailed: 'The payment was not recorded. Please try again.',
      cancelPaid:
        'This bill has money against it, so it cannot be cancelled. Use “Refund money” above to record the refund, then it can be cancelled.',
      cancelFailed: 'The bill was not cancelled. Please try again.',
      restoreFailed: 'The bill was not put back. Please try again.',

      refundNothing: 'No money came in against this bill, so there is nothing to hand back.',
      refundTooMuch: (max: string) =>
        `This bill holds ${max}. No more than that can be handed back.`,
      refundFailed: 'The refund was not recorded. Please try again.',

      discountVoided:
        'This bill is cancelled, so waiving a fee on it changes no total anybody sees. Put the bill back first.',
      discountNegative:
        'A waiver cannot be less than zero. To charge more, raise the bill for more.',
      discountTooMuch: (max: string) =>
        `The fee on this bill is ${max}. A waiver cannot be more than that.`,
      discountFailed: 'The waiver was not recorded. Please try again.',

      /** The four ways loading old dues is refused. See the Bangla notes. */
      arrearsMonthNotPast:
        'Old dues have to be recorded against a month that has already ended — this month’s invoices are raised with the button above.',
      arrearsNothingTyped:
        'No amounts were filled in. Write what is owed in the boxes of the families who are behind.',
      arrearsRejected: (n: number, details: string) =>
        `${n} ${n === 1 ? 'box needs' : 'boxes need'} fixing, and nothing was saved — ${details}`,
      arrearsFailed: 'The old dues were not recorded. Please try again.',

      /** Two or three words each, read inside a list of names. See the Bangla note. */
      arrearsReasons: {
        unreadable: 'cannot read',
        negative: 'below zero',
        tooLarge: 'far too large',
        notEnrolled: 'not in a batch',
      },
    },
  },

  feeRow: {
    paidOf: '{paid} / {net} paid',
    settled: '{paid} received · {net} in total',
    discount: '({amount} discount)',
    inCredit: '{amount} in credit',

    chaseTitle: 'Remind the guardian',
    lastChase: 'Last',
    justNow: 'just now',

    amount: 'How much came in',
    method: 'How',
    reference: 'Transaction ID',
    receiving: 'Recording…',
    receive: 'Record payment',
    receiptLink: 'View receipt',
    methods: {
      cash: 'Cash',
      bkash: 'bKash',
      nagad: 'Nagad',
      rocket: 'Rocket',
      bank_transfer: 'Bank',
      other: 'Other',
    },
  },

  cancel: {
    open: 'Cancel this bill',
    heading: 'Cancel this bill?',
    warning:
      'It will stop being anybody’s arrears, come out of the outstanding total, and no guardian will be reminded about it.',
    reason: 'Why are you cancelling it',
    reasonHint: 'e.g. left the coaching in June',
    confirm: 'Yes, cancel it',
    cancelling: 'Cancelling…',
    keep: 'No, keep it',

    paidTitle: 'This bill cannot be cancelled',
    paidNote:
      'There is money against this bill. Use “Refund money” above to record the refund first, and then it can be cancelled.',

    forMonth: 'Bill for {month}',
    amount: '{amount} — no longer owed',
    reasonLabel: 'Reason',
    restore: 'Put it back',
    restoring: 'Putting it back…',
  },

  refund: {
    open: 'Refund money',
    heading: 'How much are you handing back?',
    held: 'This bill holds {amount}',
    credit: '{amount} of that is more than was owed',
    warning:
      'A refund cannot be deleted or edited afterwards. Count the money out, hand it over, and then write it here.',
    amount: 'How much you handed back',
    method: 'How you handed it back',
    note: 'Why you are handing it back',
    noteHint: 'e.g. left the coaching',
    confirm: 'Record the refund',
    refunding: 'Recording…',
    keep: 'No, leave it',
    receiptLink: 'View refund receipt',
  },

  discount: {
    open: 'Waive part of the fee',
    edit: 'Change the waiver',
    heading: 'How much are you waiving?',
    billed: 'The fee on this bill is {amount}',
    current: 'A waiver of {amount} is on it — what you write here replaces it',
    leaves: 'After the waiver the fee is {amount}',
    leavesNothing: 'The whole fee is waived — nothing more is owed on this bill',
    amount: 'How much you are waiving',
    reason: 'Why you are waiving it',
    reasonHint: 'e.g. two siblings study here',
    confirm: 'Apply the waiver',
    saving: 'Applying…',
    keep: 'No, leave it',
    clear: 'Take the waiver off',
    clearing: 'Removing…',
    voidedTitle: 'A cancelled bill cannot be discounted',
    voidedNote: 'Put the bill back, and then it can be discounted.',
    reasonLabel: 'Reason for the waiver',
  },

  receipt: {
    title: 'Fee receipt',
    receiptNo: 'Receipt no.',
    date: 'Date',
    student: 'Student',
    studentCode: 'ID',
    month: 'Fee for',
    amount: 'Amount received',
    method: 'How',
    reference: 'Transaction ID',
    /** The same sheet when the money went the other way — see the Bangla. */
    refundTitle: 'Refund receipt',
    refundAmount: 'Amount handed back',
    refundFootNote:
      'This is a computer-generated refund receipt. This money was handed back to the guardian — please keep it as proof.',
    billed: 'Total fee for the month',
    discountGiven: 'Waived',
    netAfterDiscount: 'Payable after the waiver',
    /** "Up to this receipt", not "now" — see the Bangla for why that matters. */
    balanceAfter: 'Balance after this receipt',
    paidInFull: 'Paid in full ✓',
    inCredit: 'In credit',
    signature: 'Received by',
    guardianCopy: 'Guardian’s copy',
    officeCopy: 'Office copy',
    cutHere: 'Cut here',
    print: 'Print',
    backToFees: 'Back to fees',
    footNote:
      'This is a computer-generated receipt. Please keep it as proof of payment.',
    notFound:
      'Receipt not found. It may belong to another centre, or it may have been removed.',
    /** The paywall — see the Bangla for why it is named after the paper. */
    paperTitle: 'The printed slip comes with a paid plan',
    paperBody: (plan: string, pro: string) =>
      `${plan} still gives you the receipt number — read it out to the parent, and search by it later. The A4 sheet with both copies, guardian and office, comes with ${pro}.`,
  },

  register: {
    title: 'Collection register',
    subtitle: 'What came in, and when',
    month: 'Month',
    show: 'Show',
    print: 'Print',
    backToFees: 'Back to fees',

    colDate: 'Date',
    colReceipt: 'Receipt',
    colStudent: 'Student',
    colMethod: 'How',
    colReference: 'Transaction ID',
    colAmount: 'Amount',
    refundLabel: 'Refund',
    colRunning: 'Running total',

    total: 'Total collected',
    grossIn: 'Came in',
    refunded: 'Paid back',
    byMethod: 'How it came in',
    entries: (n: number) => `${n} ${n === 1 ? 'payment' : 'payments'}`,
    empty: 'No money has been recorded for this month yet.',
    forMonth: (month: string) => `${month}`,
    paperTitle: 'The collection register comes with a paid plan',
    paperBody: (plan: string, pro: string) =>
      `On ${plan} the fee board still shows who paid what. The month on one page — every payment in order, a running total, and how much came through each wallet — comes with ${pro}.`,
  },

  close: {
    title: 'The month',
    subtitle: 'What was owed when it started, what came in, what is left',
    month: 'Month',
    show: 'Show',
    backToFees: 'Back to fees',

    collected: 'Collected this month',
    advance: 'of that, paid ahead for a later month',
    rate: 'Collection rate',
    rateNone: 'There was nothing to collect this month',

    opening: 'Owed when the month started',
    billed: 'Billed this month',
    closing: 'Still owed at the end',
    credit: 'Held in credit',
    creditNote:
      'One family’s overpayment is never set against another family’s debt, so it is shown on its own.',

    messagesSent: (n: number) =>
      `${n} ${n === 1 ? 'message' : 'messages'} sent to parents`,
    messagesNone: 'No messages went out to parents this month',
    messageKinds: {
      reminders: 'Fee reminders',
      notes: 'Weekly notes',
      results: 'Exam results',
      absences: 'Absence alerts',
    },

    registerLink: 'See what came in, and when',
    planLink: 'See the plans and prices',
    empty: 'Nothing was billed this month, and nothing came in.',
  },

  /** See the Bangla for why the headings are translated and the values are not. */
  exportSheet: {
    colCode: 'ID',
    colName: 'Name',
    colBatch: 'Batch',
    colMonth: 'Month',
    colStatus: 'Status',
    colGuardianPhone: 'Guardian mobile',
    colClass: 'Class',
    colInstitution: 'School / college',
    colStudentPhone: 'Student mobile',
    colGuardianName: 'Guardian name',
    colSmsOff: 'SMS off',
    colChannel: 'How to reach',
    colAdmitted: 'Admitted on',
    colDate: 'Date',
    colReceipt: 'Receipt no.',
    colMethod: 'How',
    colReference: 'Transaction ID',
    colAmount: 'Amount',
    colBilled: 'Billed',
    colDiscount: 'Discount',
    colDiscountReason: 'Why discounted',
    colNet: 'Payable',
    colPaid: 'Paid',
    colRemaining: 'Remaining',
    colDueDate: 'Due date',
    colSessions: 'Classes held',
    colUnmarked: 'Not marked',
    colRate: 'Attendance %',
    colExam: 'Exam',
    colExamType: 'Exam type',
    colSubject: 'Subject',
    colTotalMarks: 'Full marks',
    colObtained: 'Marks',
    colPercent: 'Percent',
    colResult: 'Result',
    resultPass: 'Pass',
    resultFail: 'Fail',
    paid: 'Paid',
    partial: 'Part paid',
    unpaid: 'Unpaid',
    yes: 'Yes',
    no: 'No',
  },

  chase: {
    noNumber: 'No guardian number on file.',
    addNumber: 'Add one',
    optedOut:
      'This family has asked not to be texted — a call is still fine.',

    /**
     * What the two message chips become on a laptop, where `sms:` and `tel:` open
     * nothing at all. Not "SMS (does not work here)" — a different control that
     * does work, so the desktop does the thing a desktop is good at and hands the
     * job to the phone.
     */
    copySms: 'Copy message',
    copyNumber: 'Copy number',

    /**
     * The hints are `title` tooltips, so they are only ever read on the device
     * that has a pointer to hover — which is the same device these chips appear
     * on. They carry the one fact the label cannot: the sending still happens on
     * the owner's own phone, from their own number, as it always did.
     */
    copySmsHint: 'Paste it on your phone to send it.',
    copyNumberHint: 'Dial it from your phone.',

    /** Replaces the label for a moment. The tick is doing the work in both. */
    copied: 'Copied ✓',
    /**
     * Shown instead of the tick, and nothing is recorded when it appears — a
     * family the owner could not copy a number for has not been chased. Rare
     * enough to be a surprise, so it says what happened rather than what to do.
     */
    copyFailed: 'Could not copy',
  },

  chaseList: {
    allDone: 'Everyone has been told ✓',
    moreLeft: '{n} still to tell',
    times: '{n} times',
    sent: '{channel} sent ✓',
  },

  reminders: {
    title: 'Today’s reminders',
    subtitle: 'Who should hear from you today',
    dueTitle: 'To remind today',
    people: (n: number) => (n === 1 ? 'family' : 'families'),
    atStake: 'owed in this list',

    noneTitle: 'Nobody needs reminding today',
    noneBecause: {
      nothingOwed: 'No fees are outstanding.',
      allUnreachable:
        'Everyone due a reminder today has no guardian number on file.',
      allRecent: 'Everyone who owes has been told recently. Give them a few days.',
      notDueYet: 'The fees still owed have not reached their deadline yet.',
    },

    heldCount: (n: number) => `${n} told recently`,
    waitingCount: (n: number) => `${n} not yet at their deadline`,

    unreachableTitle: (n: number) =>
      `${n} with no guardian number on file`,
    unreachableBody: (names: string) =>
      `There is no way to remind them without a number — ${names}`,
    addNumbers: 'Add numbers',
    backToBoard: 'Back to the fee board',

    entryDueSuffix: 'to remind today',

    stages: {
      soon: 'Before the deadline',
      due: 'The deadline has arrived',
      late: 'More than a week late',
      owing: 'Owed for a long time',
    },
    stageNotes: {
      soon: 'Not late yet — a nudge now makes paying on time more likely',
      due: 'Due to be paid this week',
      late: 'The deadline passed more than a week ago',
      owing: 'A fortnight on, and time to remind them again',
    },
  },

  invoices: {
    open: '+ Raise this month’s invoices',
    month: 'Which month',
    dueDay: 'Deadline',
    dueDayHint: 'The day of the month the fee has to be paid by',
    /**
     * "day 10" rather than "10th". An English ordinal needs 1st/2nd/3rd/11th and a
     * rule to pick between them, for a select the owner touches once a month.
     */
    dayOption: 'day {d}',
    submit: 'Create invoices',
    safeToRepeat:
      'One invoice per active enrolment. Anything already created is left alone — so pressing this twice is safe.',
  },

  /** The old-dues screen. A client component, so strings only. See the Bangla notes. */
  arrears: {
    title: 'Old dues',
    subtitle: 'Load what was already owed before this app',
    backToFees: 'Back to fees',
    howTo:
      'Work down your register and write what each family owes in their box. Leave a box empty for anyone who is square. Once saved, these amounts show on the fee board as outstanding and the families appear on the chase list.',
    month: 'Recorded against',
    monthHint:
      'A month that has already ended — this month’s fees are raised with the button above',
    dueDay: 'The deadline was',
    dueDayHint: 'The day of that month it was meant to be paid by',
    dayOption: 'day {d}',
    colStudent: 'Student',
    colAmount: 'Owed (৳)',
    amountFor: 'Owed by {name}',
    /** What stands where the box would be. See the Bangla note. */
    billed: '{amount} — billed',
    billedCancelled: '{amount} — cancelled',
    filledCount: '{n} filled in',
    total: 'Total',
    submit: 'Add the old dues',
    emptyTitle: 'Nobody is enrolled in a batch yet',
    emptyBody:
      'Enrol the students in their batches first. Old dues attach to an active enrolment, which is how they reach the board.',
    safeToRepeat:
      'Anyone who already has a bill in that month is left alone — so pressing this twice is safe.',
    /** The correction, which needs saying. See the Bangla note. */
    howToFix:
      'Typed a wrong amount? Cancel that bill on the fee board, then record the right amount against a different finished month — a cancelled bill keeps its month’s place.',
  },

  exams: {
    title: 'Exams',
    subtitle: 'Enter marks, tell the guardians',
    new: 'New',
    emptyTitle: 'No exams yet',
    emptyBody:
      'Create an exam and every student in the batch arrives together, ready to be marked.',
    /**
     * The same empty list, read by a teacher the owner has not given exam duties
     * to. Its own string for the reason `fees.emptyBodyReadOnly` is: the other one
     * is an instruction, and the button it refers to is not on this reader's screen.
     */
    emptyBodyReadOnly:
      'No exams have been created for your batches yet. The centre’s owner decides who can create them.',
    create: 'Create an exam',

    /**
     * The words a Bangladeshi question paper prints on itself, which is where the
     * Bangla comes from too. Capitalised because both start a line; the marks
     * sheet has its own lowercase copy for mid-line use.
     */
    fullMarks: 'Full marks',
    pass: 'Pass',
    marked: 'marked',
    smsSent: 'SMS sent ✓',
    smsNotSent: 'SMS not sent',

    marksTitle: 'Marks',
    noStudentsTitle: 'No students in this batch',
    noStudentsBody:
      'Add students to the batch and their names will arrive here to be marked.',

    newTitle: 'New exam',
    needBatchTitle: 'You need a batch first',
    needBatchBody:
      'An exam belongs to a batch — the batch’s students are the ones who arrive to be marked.',
    createBatch: 'Create a batch',

    recipients: (n: number) => `${n} ${n === 1 ? 'guardian' : 'guardians'}`,
    credits: (n: number) => `${n} ${n === 1 ? 'credit' : 'credits'}`,
    balanceNow: (n: number) => `${n} ${n === 1 ? 'credit' : 'credits'} left`,
    shortfall: (n: number) => `${n} short`,
    /** SMS is its own plural in English, which is the one mercy in this group. */
    segments: (n: number) => `${n} SMS`,
    previewFor: (name: string) => `What ${name}’s guardian will get`,
    withoutMarksCount: (n: number) =>
      `${n} ${n === 1 ? 'student has' : 'students have'} no marks yet`,
    noPhoneCount: (n: number) =>
      `${n} ${n === 1 ? 'guardian' : 'guardians'} with no number`,
    optedOutCount: (n: number) =>
      `${n} ${n === 1 ? 'family has' : 'families have'} SMS turned off`,
    /**
     * Names, not just a count — see the Bangla. The verb agrees with the count
     * even though the names follow it, because "1 notes are too long" is the
     * failure this whole group of functions exists to prevent.
     */
    notesTrimmedCount: (n: number, names: string) =>
      `${n} ${n === 1 ? 'note is' : 'notes are'} too long to send — ${names}`,
    /** On a row of the tap-to-send list, for a family already told. */
    toldOn: (date: string) => `Told ${date} ✓`,

    marksSaved: (entered: number, absent: number) => {
      const who = `${entered} ${entered === 1 ? 'student' : 'students'}`
      return absent > 0 ? `Marks saved — ${who}, ${absent} absent` : `Marks saved — ${who}`
    },
    smsQueued: (sent: number, charged: number) =>
      `${sent} ${sent === 1 ? 'guardian' : 'guardians'} · ${charged} ${
        charged === 1 ? 'credit' : 'credits'
      } used`,

    errors: {
      forbidden: 'You do not have permission to do that.',
      /**
       * Not `forbidden` above, which answers a role — this one answers a checkbox.
       * The reader teaches this batch and the owner has turned "Exams & marks" off
       * for them, so naming the owner is the only actionable half of the sentence:
       * nothing they do on this screen will change it.
       */
      noExamPermission:
        'You do not have permission to create exams or enter marks. Ask the centre’s owner.',
      nameRequired: 'Give the exam a name.',
      pickBatch: 'Choose a batch.',
      noBatch: 'That batch could not be found.',
      totalUnreadable: 'Write the full marks as a number.',
      totalTooBig: 'Full marks must be 1000 or less.',
      passUnreadable: 'Write the pass mark as a number.',
      passOverTotal: 'The pass mark cannot be higher than the full marks.',
      createFailed: 'The exam could not be created. Please try again.',

      noExam: 'That exam could not be found.',
      rosterUnreadable: 'The student list could not be read.',
      noStudents: 'No students were found.',
      marksNegative: 'A mark cannot be negative.',
      marksOverTotal: (total: number) =>
        `A mark cannot be higher than the full marks (${total}).`,
      saveFailed: 'The marks were not saved. Please try again.',

      declineFailed: 'That was not saved. Please try again.',
      alreadySent: 'This exam’s results have already been sent.',
      noSmsPermission:
        'You do not have permission to send SMS. Ask the centre’s owner.',
      noRecipients: 'There are no numbers to send to.',
      creditsShort: (need: number, have: number) =>
        `Not enough SMS credit — ${need} needed, ${have} left.`,
      sendFailed: 'That could not be sent. Please try again.',
      creditRace: 'The credit balance has changed. Please try again.',
      sendFailedRefunded: 'That could not be sent. The credits have been returned.',
    },
  },

  marksSheet: {
    /**
     * Read-only because of a permission, which is a different sentence from
     * `locked` below and outranks it. Locked is about time — the SMS has gone, so
     * changing a mark now contradicts something a parent is holding. This is about
     * authority, and it is the only one of the two that actually disables the
     * inputs.
     */
    readOnly:
      'The owner has turned off marks entry for you. You can read this sheet but not change it.',
    locked:
      'These results have already gone to the guardians. Changing a mark now will not match the SMS they are holding.',
    markLabel: '{name} — marks',
    absentLabel: '{name} — absent',
    noteLabel: '{name} — note',
    notePlaceholder: 'Note — goes in the guardian’s SMS if there is room',
    marked: 'marked',
    /** Mid-line, after a "·", so lowercase — see `exams.fullMarks`. */
    fullMarks: 'full marks',
    save: 'Save marks',
  },

  smsGate: {
    sentTitle: 'Sent to the guardians',
    queuedNote:
      'The messages are queued. They will start arriving on guardians’ phones as soon as a sender ID in your centre’s name is approved — and then these will go on their own.',

    resultSms: 'Result SMS',
    noPermission:
      'You do not have permission to send SMS. The centre’s owner can grant it in settings.',
    saveMarksFirst:
      'Save the marks and the option to text the guardians will appear.',
    noNumbers: 'None of these guardians has a number on file.',

    askTitle: 'Tell the guardians the results?',
    willGoTo: 'Goes to',
    cost: 'Cost',
    perPersonNote: 'Each family gets their own child’s name and marks',
    longNote:
      'Some of these count as 2 SMS. A shorter exam name — or a shorter centre name in settings — halves the cost.',
    declined: 'No SMS was sent for this exam. You can still send it later.',
    send: 'Send to guardians',
    sending: 'Sending…',
    decline: 'Not now',
    noUndo: 'Once sent, it cannot be taken back',
  },

  /** Telling parents from the centre's own phone. See the Bangla note. */
  resultNotices: {
    title: 'Tell guardians the result',
    body:
      "Pick a name below and your phone's SMS or WhatsApp app opens with the message already written. No credits, and it goes from your own number. Whoever you tell is ticked off here.",
    saveMarksFirst: 'Save the marks and the list of guardians to tell appears here.',
    noNumbers:
      'Guardians with a saved number can be told from here. None have been recorded yet.',
    absent: 'Absent',
  },

  examForm: {
    name: 'Exam name',
    namePlaceholder: 'Weekly test',
    batch: 'Batch',
    pickBatch: 'Choose a batch',
    kind: 'Kind',
    fullMarks: 'Full marks',
    passMarks: 'Pass mark',
    date: 'Exam date',
    submit: 'Create and enter marks',
  },

  batchForm: {
    nameLabel: 'Batch name',
    nameHint: 'For instance: 7am — HSC Maths',
    subject: 'Subject',
    pickSubject: 'Pick a subject',
    needSubject: 'Add at least one subject first.',
    teacher: 'Teacher',
    teacherLater: 'Decide later',
    whichSlot: 'Which part of the day',
    start: 'Starts',
    end: 'Ends',
    whichDays: 'Which days',
    daysHint: 'Leave these untouched and the batch counts as meeting every day',
    feeLabel: 'Monthly fee (৳)',
    feeHint:
      "This batch's fee each month. Changing it later does not change bills already issued.",
    submit: 'Create batch',

    subjectHint:
      'Change the subject and new exams go under the new one. Marks already taken stay exactly where they are.',
    runningLabel: 'This batch is running',
    runningHint:
      'Switch it off and it leaves the register, and next month’s bill stops with it. Marks, attendance and bills already raised all stay.',
  },

  studentForm: {
    nameLabel: 'Student’s name',
    namePlaceholder: 'Rafid Hasan',
    guardianPhone: 'Guardian’s mobile',
    guardianPhoneHint: 'Result and fee SMS go to this number',
    phoneBad: 'That number is not right',
    guardianName: 'Guardian’s name',
    guardianNamePlaceholder: 'Md Kamal Hossain',
    whichBatch: 'Which batch',
    moreInfo: 'More details',
    studentPhone: 'Student’s own mobile',
    institution: 'School / college',
    institutionPlaceholder: 'Dhaka College',
    classLevel: 'Class',
    classPlaceholder: 'HSC 2nd year',
    code: 'ID number',
    codeHint: 'The centre’s own roll or ID, if it keeps one',
    codePlaceholder: '2026-041',
    submit: 'Add student',

    statusLabel: 'Status',
    statusHint:
      'Stop a student and next month’s bill stops with them. Bills and receipts already raised stay exactly as they are.',
    status: {
      active: 'Coming',
      inactive: 'Stopped for now',
      graduated: 'Finished',
      dropped: 'Left',
    },
    batchHint: 'Tick to put them in a batch, untick to take them out',
  },

  importForm: {
    viewList: 'See the list',
    label: 'The list of names',
    hint:
      'One student per line — the name and the guardian’s mobile. Serial numbers, commas and dashes are all fine, and it makes no difference whether the name or the number comes first.',
    placeholder:
      'Rafid Hasan 01712345678\nSadia Akter, Karim Mia, 01812345678\n3. Tanvir Islam 01912345678',
    fresh: '{n} new',
    alreadyThere: '{n} already here',
    /** Not "{n} lines": a template cannot inflect, and one line can be skipped. */
    willSkip: '{n} will be skipped',
    /**
     * The plural is safe to fix here, unlike everywhere else in this group: this
     * sentence only appears when {got} is above the 500-line cap, so the
     * singular settings.import.errors.tooManyRows allows for cannot arise.
     */
    tooMany:
      'Paste at most {max} lines at a time and the rest next time. This has {got} lines.',
    /** "are", not "is/are": overRoom needs {room} of at least 1, so {fresh} is 2 or more. */
    overRoom:
      'This plan has room for {room} more, but {fresh} in the list are new.',
    problemsTitle: 'These lines will not be added — fix them and paste again',
    moreProblems: 'And {n} more with a problem.',
    readyTitle: 'Check what was read ({n})',
    guardian: 'Guardian: {name}',
    alreadyOn: 'Already here',
    dropped: 'Ignored: {numbers}',
    previewNote: 'Showing the first {shown}; the rest are added too.',
    whichBatch: 'Which batch does everyone join',
    whichBatchBody:
      'Everyone on this list goes into the same batch. For different batches, paste one batch at a time.',
    submit: 'Add {n} to the roster',
    submitEmpty: 'Add',
    problem: {
      'no-phone': 'No number',
      'bad-phone': 'That number is not right',
      'no-name': 'No name',
      'name-too-long': 'Too long to be a name — is it one?',
      duplicate: 'Twice on this list',
    },
  },

  teacherPermissions: {
    can_manage_exams: {
      label: 'Exams & marks',
      hint: 'Create exams and enter marks',
    },
    can_send_sms: {
      label: 'SMS to guardians',
      hint: 'Send guardians an SMS once marks are in',
    },
    can_manage_students: {
      label: 'Admit students',
      hint: 'See the whole centre’s roster and guardian numbers, and admit new students',
    },
    can_manage_batches: {
      label: 'Open a new batch',
      hint: 'Set its subject, time, days and monthly fee',
    },
    can_view_fees: {
      label: 'See fees',
      /**
       * Both limits, because "See fees" on its own reads as the whole board and
       * the till. The grant is their own batches, and looking only.
       */
      hint: 'Who has paid in their own batches. Cannot take payments.',
    },
  },

  teacherList: {
    inactive: 'Off',
    noLogin: 'No login',
    edit: 'Change permissions',
    save: 'Save permissions',
    loginSummary: 'Give them a login',
    loginBody:
      'With a login they can take attendance and enter marks from their own phone. Only the permissions ticked above will work.',
    loginPhone: 'Mobile number',
    loginPhoneHint: 'This is the number they will sign in with — correct it here if it is wrong',
    loginPassword: 'Starting password',
    loginPasswordHint: 'Tell it to the teacher — it stays visible',
    loginSubmit: 'Create the login',
    loginConfirm: 'Yes, that is them — link the account',
    resetSummary: 'Forgotten their password?',
    resetBody:
      'Set a new password and tell it to them. This is not how you remove somebody who has left — the “Turn this teacher off” button below is.',
    resetLabel: 'New password',
    resetHint: 'Type it with the teacher there — it stays visible',
    resetSubmit: 'Set the password',
    deactivateBody:
      'Turned off, they can no longer see their batches, the students in them, or any guardian’s number. Attendance and marks already entered are not deleted.',
    reactivateBody:
      'Turned back on, they can take attendance and enter marks for their batches again.',
    deactivate: 'Turn this teacher off',
    reactivate: 'Turn back on',
    yourSeat: 'Your own record — this plan’s one seat.',
  },

  teacherForm: {
    nameLabel: 'Teacher’s name',
    namePlaceholder: 'Karim Sir',
    phone: 'Mobile number',
    phoneHint: 'If you give them a login, this number is their ID',
    phoneBad: 'That number is not right',
    whichSubjects: 'Which subjects do they teach',
    whatTheyCanDo: 'What they are allowed to do',
    loginNow: 'Give them a login now',
    loginNowBody:
      'The teacher is added either way — you can take attendance and enter marks for their batches yourself. A login can be given at any time later.',
    password: 'Starting password',
    passwordHint: 'Tell it to the teacher — they can change it themselves later',
    passwordPlaceholder: 'e.g. 123456',
    passwordNote:
      'With a login, the teacher can take attendance and enter marks from their own phone. They can only do what is ticked above.',
    confirmLink: 'Yes, that is them — join the account',
    wrongPerson:
      'Name does not match? Then the number was wrong — turn them off from the teacher list and they will not be able to see anything.',
    seeList: 'See the teacher list',
    submit: 'Add teacher',
  },

  centerForm: {
    nameLabel: 'Centre’s name',
    nameHint: 'This name signs every SMS, so a short one is better',
    walletLegend: 'Where guardians send the money',
    walletHint: 'This number goes into the fee message',
    walletNone: 'None of these',
    numberLabel: '{wallet} number',
    numberHint: 'The number the money arrives on — 11 digits, e.g. 01712345678',
    previewTitle: 'The {month} fee message will look like this',
    /**
     * Both counts carry their own number, so the `.num` class can sit on the
     * finished phrase. A function would be the better tool and cannot be used
     * here: this form is a client component.
     */
    chars: '{n} characters',
    smsCount: '{n} SMS',
    fitsAll: 'Every student’s message will carry the number',
    fitsSome:
      'Students with long names will lose the number from their message. Shorten the centre’s name and it fits for everybody.',
    fitsNone:
      'The name is long enough that the number has nowhere to go in an SMS. Shortening the centre’s name fixes it — on WhatsApp the number always goes.',
  },

  optOutList: {
    title: 'How each family is reached',
    channelHint:
      'Mark the way a family actually answers and that button comes first on the fee and weekly-news rows. No button ever disappears.',
    channelAny: 'Not known',
    channelFor: 'How to reach {name}',
    noNumber: 'No number',
    on: 'On',
    off: 'Off',
    turnOn: 'Turn SMS on — {name}',
    turnOff: 'Turn SMS off — {name}',
  },

  smsKinds: {
    /** Plural: one dispatch carries a whole exam's worth of them. */
    exam_result: 'Results',
    attendance_alert: 'Attendance',
    fee_reminder: 'Fees',
    notice: 'Notice',
    custom: 'Other',
  },

  dashboard: {
    title: 'Dashboard',
    outstanding: 'Fees outstanding',
    nobodyOverdue: 'Nobody has missed a deadline',
    collected: 'Collected this month',
    students: 'Students',
    batches: 'Batches',

    todayAttendance: 'Today’s attendance',
    /**
     * The noun agrees with the denominator, not with `done`. A centre with one
     * batch is the ordinary first week of this product, and "0/1 batches taken"
     * followed by "1/1 batches taken" an hour later is wrong twice on the screen
     * every new owner looks at most.
     */
    batchesTaken: (done: number, total: number) =>
      `${done}/${total} ${total === 1 ? 'batch' : 'batches'} taken`,

    overdueTitle: 'Past the deadline',

    addStudentsTitle: 'Add your students',
    addStudentsBody:
      'Add a batch and some students, and attendance, results and fees all show up here.',

    ratesTitle: 'Attendance by batch',
    ratesFallback:
      'No attendance has been taken this month — showing last month instead',
    bands: {
      good: 'Good',
      fair: 'Fair',
      low: 'Low',
    },
    noRate: 'No figure',
    allExcused: 'Every absence excused',
    classDays: (n: number) => (n === 1 ? 'class day' : 'class days'),
    countedMarks: (n: number) => (n === 1 ? 'mark counted' : 'marks counted'),
    unknownBatch: 'Unnamed batch',
  },

  risk: {
    title: 'Drifting away',
    lead: 'Students who may quietly stop coming — the ones a one-minute call today can keep.',
    count: (n: number) => (n === 1 ? 'student' : 'students'),
    signalCount: (n: number) => (n === 1 ? 'signal' : 'signals'),
    levels: {
      watch: 'Keep an eye',
      talk: 'Worth a word',
      call: 'Call today',
    },
    reasons: {
      attendanceLow: 'Attendance low',
      attendanceFell: 'Attendance dropped',
      marksLow: 'Marks low',
      marksFell: 'Marks slipped',
      examsMissed: (n: number) => (n === 1 ? 'exam missed' : 'exams missed'),
      feeLate: 'Fee unpaid',
    },
    was: 'was',
    days: (n: number) => (n === 1 ? 'day' : 'days'),
    noFigure: 'No figure',
    empty: 'Nobody is drifting right now',
    emptyHint:
      'Attendance, results and fees — no student is showing a bad sign in any of the three.',
    seeAll: 'See everyone',
    callGuardian: 'Call guardian',
    noPhone: 'No number',
    noName: 'No name given',
    windows: 'Attendance covers the last 30 days, marks the last 120.',
  },

  studentProfile: {
    title: 'Student',
    notFound: 'Student not found',
    notFoundBody: 'Not on the roster, or not one of your batches.',
    roster: 'Students',
    edit: 'Fix these details',
    inactive: 'Inactive',
    teacherScope:
      'Attendance and results cover only the batches you teach.',

    contact: {
      guardian: 'Guardian',
      student: 'Student',
      call: 'Call',
    },

    flags: {
      title: 'Worth knowing',
      none: 'Attendance, marks and fees — no bad sign in any of the three right now.',
    },

    attendance: {
      title: 'Attendance',
      window: (days: number) => `Last ${days} days`,
      noBatches: 'Not enrolled in a batch, so there is no attendance to count.',
      noClasses: 'No class on record for this batch in this window',
      marked: 'classes marked',
      unmarkedNote:
        'Some classes have no mark against this student at all — check the register.',
    },

    marks: {
      title: 'Results',
      none: 'No exam marks have been entered yet.',
      noMark: 'No mark entered',
      limitNote: (n: number) =>
        n === 1 ? 'Showing the last exam.' : `Showing the last ${n} exams.`,
    },

    fees: {
      title: 'Fees',
      allPaid: 'All fees paid ✓',
      overdueSince: (date: string) => `Overdue since ${date}`,
      none: 'No invoice has been raised for this student yet.',
      due: 'Due',
      paid: 'Paid',
      remaining: 'Owing',
      settled: 'Paid ✓',
      lateDays: (n: number) => (n === 1 ? 'day late' : 'days late'),
      hidden: 'Fees are kept by the owner or a manager.',
      waived: (billed: string, discount: string) => `Fee ${billed} · waived ${discount}`,
      receipt: 'Receipt',
      refundReceipt: 'Refund',
      receiptHint: 'Tap any receipt to print it again — as many times as you need.',
      limitNote: (n: number) =>
        n === 1 ? 'Showing the last month.' : `Showing the last ${n} months.`,
    },
  },

  progress: {
    title: 'The week',
    lead: 'Let a guardian know how their child is doing before the results come out — one message a week, with no bill in it.',
    covers: (from: string, to: string) => `${from} to ${to}`,

    dueTitle: 'Guardians who can be told today',
    people: (n: number) => (n === 1 ? 'family' : 'families'),

    attendance: 'Attendance',
    noRegister: 'No register taken',
    late: (n: number) => (n === 1 ? 'day late' : 'days late'),
    excused: (n: number) => (n === 1 ? 'day excused' : 'days excused'),
    noExam: 'No exam',
    examsMissed: (n: number) => (n === 1 ? 'exam missed' : 'exams missed'),
    told: (when: string) => `Told ${when}`,

    noneTitle: 'Nobody new to tell today',
    noneBecause: {
      noStudents: 'No students have been added yet.',
      nothingRecorded:
        'The students still to tell have no attendance or marks recorded this week — the list fills up as soon as they do.',
      noNumbers: 'The families still to tell have no guardian number on file.',
      allRecent: 'Every guardian was told within the last few days.',
    },

    heldSent: (n: number) =>
      n === 1 ? '1 guardian was told recently' : `${n} guardians were told recently`,
    heldNothing: (n: number) =>
      n === 1
        ? '1 student has no attendance or marks recorded this week'
        : `${n} students have no attendance or marks recorded this week`,
    takeRegister: 'Take attendance',

    unreachableTitle: (n: number) =>
      n === 1 ? '1 guardian has no number' : `${n} guardians have no number`,
    unreachableBody: (names: string) => `There is no way to tell them without a number — ${names}`,
    addNumbers: 'Add numbers',

    windowNote:
      'The figures cover the last 7 days: attendance and exam results. Fees are not in this message — those go out with the reminders.',

    entryDueSuffix: 'guardians can be told how the week went',
    seeAll: 'See everyone',
    noName: 'No name given',

    lockedTitle: 'This plan does not include the weekly note',
    lockedBody: (plan: string, pro: string) =>
      `On ${plan} you can read attendance and marks in the app, but the week's message to a guardian is not written for you. Telling every family in one tap comes with ${pro}.`,
    seePlans: 'See the plans',
  },

  me: {
    title: 'Mine',
    due: 'Due',
    /** 'past the deadline', not 'overdue', because that is what fees says. */
    overdue: 'past the deadline',
    allPaid: 'All fees are paid ✓',
    recentResults: 'Recent results',
    noRecords:
      'Your records have not been added yet. Please contact the coaching centre.',
  },

  settings: {
    added: 'Added',
    saved: 'Saved',

    errors: {
      forbidden: 'Only an owner or a manager can do this.',
      notPermitted: 'The owner has not given you permission to do this.',
      /**
       * "Makes room" and nothing more. This used to promise that every feature
       * stays open either way, on the grounds that the free plan held a smaller
       * centre rather than a worse product. That stopped being true the day the
       * paywall arrived — a free teacher has no printed receipt, no export and no
       * parent summary — and a reassurance the reader can disprove in two taps
       * costs more than it buys.
       */
      planLimit: 'This plan is full. Changing plan makes room.',
      batchFull: (batches: string, cap: number) =>
        `${batches} — that batch is full. This plan holds ${cap} ${cap === 1 ? 'student' : 'students'} per batch. Put them in another batch, or change plan.`,
      staffNeedsCenter: 'Staff and permissions come with the Coaching Center plan.',
      addFailed: 'That was not added. Please try again.',
      createFailed: 'That was not created. Please try again.',
      saveFailed: 'That was not saved. Please try again.',
      changeFailed: 'That did not change. Please try again.',
    },

    hub: {
      title: 'Settings',
      smsCredits: 'SMS credits',
      details: 'Details',
      feesGoTo: (number: string) => `Fees go to ${number}`,
      noPaymentNumber: 'No payment number yet',
      center: 'Name & payment',
      students: 'Students',
      studentsHint: 'Names, guardian numbers, batches',
      batches: 'Batches & times',
      batchesHint: 'Morning / noon / afternoon / evening, which days',
      subjects: 'Subjects',
      subjectsHint: 'Maths, physics, English — your own list',
      teachers: 'Teachers & permissions',
      teachersHint: 'Who is allowed to do what',
      examTypes: 'Exam kinds',
      examTypesHint: 'Weekly, model test, monthly — whatever you run',
      sms: 'SMS',
      smsHint: 'Credits, who is opted out',
      exports: 'Download files',
      exportsHint: 'Students, collections, fees, attendance, marks',
      exportsLocked: 'Comes with Teacher Pro',
      /** The free plan allows exactly one, so the singular is the common case. */
      plan: (name: string, batches: number) =>
        `${name} plan: ${batches} ${batches === 1 ? 'batch' : 'batches'}.`,
      planUnlimited: (name: string) =>
        `${name} plan: as many batches as you need.`,
      plans: 'Plan and pricing',
      /** See the Bangla for why this row is last. */
      founder: 'Customers',
      founderHint: 'Every centre, what they use and what they owe — mine only',
    },

    /** See the Bangla for why this screen exists and what it deliberately omits. */
    plan: {
      title: 'Plan and pricing',
      onNow: (name: string) => `You are on ${name}`,
      freePrice: 'No charge',
      monthly: (taka: string) => `${taka} a month`,
      sized: 'Priced by the size of the centre',
      from: (taka: string) => `From ${taka}`,

      usageTitle: 'What you are using now',
      batches: 'Batches',
      students: 'Students',
      subjects: 'Subjects',
      teachers: 'Teachers',
      noCap: 'No limit',
      perBatchCap: (cap: number) => `Up to ${cap} students in any one batch.`,

      haveTitle: 'This plan includes',
      lackTitle: 'This plan does not include',
      attendance: 'Attendance',
      exams: 'Exams and marks',
      fees: 'Fees and arrears',
      messaging: 'SMS, WhatsApp and calls from your own phone',
      receipts: 'Printed receipts and the collection register',
      staff: 'Adding teachers and sharing out permissions',
      export: 'Download lists as Excel files',
      onlyBuilt:
        'Only what actually works today is listed here. Anything new is added when it ships.',

      ladderTitle: 'The plans',
      addsFree: 'For trying it out — 1 batch, 30 students.',
      addsPro:
        'One teacher’s whole coaching — 5 batches, 150 students, printed receipts and the register.',
      addsCenter:
        'Add teachers, no cap on batches or students. Priced by how many students you have.',
      addsInstitution: 'Several branches under one account. Arranged by conversation.',
      current: 'Your plan',

      contactTitle: 'Want to change plan?',
      contactBody:
        'Tell us which plan you want and we will ring you — your student and teacher counts are already in front of us.',
      contactWhatsapp: 'WhatsApp',
      contactCall: 'Call',
      contactMessage: (center: string, plan: string) =>
        `Hello. I am from ${center}, currently on ${plan}. I would like to talk about plans.`,
      /** See the Bangla for why this sentence is not inside `upgrade`. */
      pendingRequest: (plan: string, date: string) =>
        `You asked for ${plan} on ${date}. We will ring you.`,
      upgrade: {
        pick: 'Which plan?',
        note: 'Anything we should know?',
        noteHint: 'Optional. How many students you expect, when you want to start.',
        send: 'Ask us to change my plan',
        sending: 'Sending…',
        withdraw: 'Cancel this request',
        withdrawing: 'Cancelling…',
        ownerOnly: 'Only the centre owner can ask for a plan change.',
        badPlan: 'That plan is not one of the choices.',
        failed: 'Could not send it. Try again.',
        sent: 'Got it. We will ring you on the owner’s number.',
        withdrawn: 'Request cancelled.',
      },
    },

    subjects: {
      title: 'Subjects',
      count: (n: number) => `${n} ${n === 1 ? 'subject' : 'subjects'}`,
      /** The noun agrees with the cap, not the count: "1/4 subjects used". */
      used: (n: number, limit: number) =>
        `${n}/${limit} ${limit === 1 ? 'subject' : 'subjects'} used`,
      batches: (n: number) => (n === 1 ? 'batch' : 'batches'),
      capTitle: 'This plan has no room for another subject',
      cap: (name: string, limit: number) =>
        `The ${name} plan holds ${limit} ${limit === 1 ? 'subject' : 'subjects'}.`,
      nameLabel: 'Subject name',
      /** The mirror of the Bangla hint, and true for this reader instead. */
      nameHint: 'Mathematics, for instance — this is the name your lists will show',
      errors: {
        nameRequired: 'Give the subject a name.',
        duplicate: 'You already have a subject with this name.',
      },
    },

    examTypes: {
      title: 'Exam kinds',
      subtitle: 'Name them the way your centre actually runs them',
      exams: (n: number) => (n === 1 ? 'exam' : 'exams'),
      nameLabel: 'Kind of exam',
      errors: {
        nameRequired: 'Give the exam kind a name.',
        duplicate: 'You already have a kind with this name.',
      },
    },

    batches: {
      title: 'Batches & times',
      count: (n: number) => `${n} ${n === 1 ? 'batch' : 'batches'}`,
      used: (n: number, limit: number) =>
        `${n}/${limit} ${limit === 1 ? 'batch' : 'batches'}`,
      new: 'New',
      emptyTitle: 'No batches yet',
      emptyBody:
        'A batch is a class at a fixed time. Once one exists you can enrol students into it and take attendance.',
      everyDay: 'Every day',
      monthly: 'per month',
      people: (n: number) => (n === 1 ? 'student' : 'students'),
      inactive: 'Switched off',

      newTitle: 'New batch',
      capTitle: 'This plan has no room for another batch',
      cap: (name: string, limit: number) =>
        `The ${name} plan holds ${limit} ${limit === 1 ? 'batch' : 'batches'}. Attendance, exams and fees are all open — only the number of batches is capped.`,
      needSubjectTitle: 'Add a subject first',
      needSubjectBody:
        'A batch belongs to a subject. Without one, marks and fees have nowhere to land.',
      addSubject: 'Add a subject',

      created: 'Batch created',
      editTitle: 'Fix this batch',
      editHint: 'Tap to change a time, a fee or the teacher',
      saved: 'Batch saved',
      errors: {
        nameRequired: 'Give the batch a name.',
        pickSubject: 'Choose a subject.',
        feeUnreadable: 'Write the monthly fee properly.',
        endBeforeStart: 'The end time has to be after the start time.',
        notFound: 'That batch could not be found.',
        saveFailed: 'Could not save that batch.',
        daysNeedTimes:
          'If you choose which days the class meets, give the start and end times too.',
        duplicate: 'You already have a batch with this name.',
        scheduleFailed:
          'The batch was created, but its class days were not saved. Fix that from settings.',
        scheduleSaveFailed:
          'The batch saved, but its class days did not. Choose the days again.',
      },
    },

    students: {
      title: 'Students',
      count: (n: number) => `${n} ${n === 1 ? 'student' : 'students'}`,
      /** The noun agrees with the cap, not the count: "9/60 students". */
      used: (n: number, limit: number) =>
        `${n}/${limit} ${limit === 1 ? 'student' : 'students'}`,
      new: 'New',
      importTitle: 'Add a whole register at once',
      importBody: (max: number) => `Paste a list of names — up to ${max} at a time`,
      missingPhone: (n: number) =>
        `${n} ${n === 1 ? 'student has' : 'students have'} no guardian’s number`,
      missingPhoneBody: 'Without a number, no result or fee SMS can reach them.',
      emptyTitle: 'No students yet',
      emptyBody:
        'Add students and attendance, exam marks and fees all start landing here.',
      inactive: 'Left',
      noPhone: 'No number',
      smsOff: 'SMS off',

      newTitle: 'New student',
      capTitle: 'This plan has no room for another student',
      cap: (name: string, limit: number) =>
        `The ${name} plan holds ${limit} ${limit === 1 ? 'student' : 'students'}.`,
      added: 'Student added',

      editTitle: 'Fix their details',
      openHint: 'Tap a student to see their attendance, results and fees',
      saved: 'Details saved',
      errors: {
        nameRequired: 'Give the student’s name.',
        /** ASCII digits in the example — see the Bangla for why they differ. */
        guardianPhone:
          'Give the guardian’s mobile number properly (e.g. 01712345678).',
        studentPhone: 'That student number is not right.',
        duplicateCode: 'A student with this ID already exists.',
        notFound: 'Student not found.',
        saveFailed: 'Could not save those details.',
      },
    },

    import: {
      title: 'Add from a list',
      body:
        'Paste every name straight out of the register or a spreadsheet — one student per line.',

      /**
       * Three clauses joined with " · " by the action — see the Bangla. English
       * inflects on all three counts, which is why they are functions.
       */
      added: (n: number) => `${n} ${n === 1 ? 'student' : 'students'} added`,
      alreadyThere: (n: number) =>
        `${n} ${n === 1 ? 'was' : 'were'} already on the roster`,
      /** "enrolment" throughout, as in `fees.emptyBody`. */
      enrolled: (n: number) =>
        `${n} batch ${n === 1 ? 'enrolment' : 'enrolments'} made`,
      errors: {
        empty:
          'The list is empty. Put one student’s name and their guardian’s number on each line.',
        tooManyRows: (max: number, got: number) =>
          `Paste at most ${max} lines at a time and the rest next time. This has ${got} ${
            got === 1 ? 'line' : 'lines'
          }.`,
        noneReadable:
          'Not one line could be read. Each line needs a name and an 11-digit mobile number.',
        /**
         * No noun after "more", so that importForm.overRoom — which is a
         * template and cannot inflect one — can be the same sentence. See the
         * note on that group.
         */
        roomShort: (room: number, fresh: number) =>
          `This plan has room for ${room} more, but ${fresh} in the list ${
            fresh === 1 ? 'is' : 'are'
          } new.`,
        failed: 'The list was not added. Please try again.',
      },
    },

    sms: {
      optedOut: 'SMS turned off',
      optedIn: 'SMS turned on',
      channelSaved: 'Saved how to reach this family',
      channelCleared: 'No channel marked for this family',

      title: 'SMS',
      balance: 'You have',
      credits: (n: number) => `${n} ${n === 1 ? 'credit' : 'credits'}`,
      monthly: (plan: string, n: number) =>
        `${n} ${n === 1 ? 'credit' : 'credits'} a month on the ${plan} plan`,
      /**
       * "not 160" is the whole point of the sentence for this reader in
       * particular: an English-medium owner has counted an English SMS before and
       * knows the number they are about to plan around is wrong.
       */
      segmentNote: (chars: number) =>
        `One SMS in Bangla is ${chars} characters, not 160. Telling one guardian one thing costs 1 credit.`,

      notLiveTitle: 'Sending is not switched on yet',
      notLiveBody:
        'A sender ID in your centre’s name is being approved. Until then whatever you send waits in line and goes out together the moment it clears — nothing is lost.',

      statusTitle: 'Status',
      queued: 'In line',
      sent: 'Gone',
      failed: 'Not sent',
      cancelledNote: (n: number) =>
        `${n} cancelled — ${n === 1 ? 'that credit is' : 'those credits are'} back.`,

      recentTitle: 'Recently sent',
      noneYet:
        'No SMS sent yet. The chance to tell guardians comes right after you save marks for an exam.',
      people: (n: number) => `${n} ${n === 1 ? 'guardian' : 'guardians'}`,

      optOutNone: 'Everybody is getting SMS right now.',
      optOutSome: (n: number) =>
        `SMS is off for ${n} ${n === 1 ? 'student' : 'students'}.`,
    },

    teachers: {
      title: 'Teachers & permissions',
      newTitle: 'New teacher',
      count: (n: number) => `${n} ${n === 1 ? 'teacher' : 'teachers'}`,
      /** The noun agrees with the cap, as on the roster: "3/12 teachers". */
      used: (n: number, limit: number) =>
        `${n}/${limit} ${limit === 1 ? 'teacher' : 'teachers'}`,
      new: 'Add a teacher',
      emptyTitle: 'No teachers added yet',
      emptyBody:
        'Add a teacher and you decide what each of them can see and do.',
      /** Zero gets its own sentence; see the Bangla for why. */
      batches: (n: number) =>
        n === 0 ? 'no batches yet' : `${n} ${n === 1 ? 'batch' : 'batches'}`,
      capTitle: 'This plan has no room for another teacher',
      cap: (name: string, limit: number, center: string) =>
        `The ${name} plan covers ${limit} ${limit === 1 ? 'teacher' : 'teachers'}. The ${center} plan takes as many as you need — every feature stays the same.`,
      soloTitle: 'Teachers & permissions is for coaching centres',
      soloBody: (plan: string, center: string) =>
        `${plan} is built for one teacher — you. Adding staff, and controlling what each of them can see and do, comes with the ${center} plan.`,
      trimTitle: 'More teachers switched on than this plan covers',
      trimBody: (plan: string, active: number, limit: number) =>
        `${plan} covers ${limit} ${limit === 1 ? 'teacher' : 'teachers'}, and ${active} are switched on here. Switch off the ones who no longer teach at your centre — the attendance and marks they entered stay. Until you do, they can still take attendance for their own batches, but they no longer see fees or send SMS.`,
      addedWithLogin: 'Teacher and their login created',
      addedNoLogin: 'Teacher added (no login)',
      linked: (name: string) =>
        `Teacher added — joined to an existing account (${name})`,
      permissionsSaved: 'Permissions saved',
      activated: 'Turned on',
      deactivated: 'Turned off',
      loginGiven: 'The login is ready — tell the teacher the number and the password.',
      reset: {
        done: 'New password set — tell it to the teacher.',
        failed: 'The password could not be changed. Try again.',
        errors: {
          noAccount: 'This teacher has no login, so there is no password to change.',
          self: 'This is your own account — you cannot change your own password here.',
          inactive:
            'They are turned off at the moment. Turn them back on first, then you can set a new password.',
          notOurs:
            'This account is not only this centre’s — it is used somewhere else too, so its password cannot be changed from here.',
        },
      },
      noName: 'no name given',
      confirmLink: (name: string) =>
        `This number already has an account — ${name}. If that is your teacher, tick the box below and save again. They will sign in with their old password.`,
      errors: {
        nameRequired: 'Give the teacher’s name.',
        phoneInvalid: 'That number is not right (e.g. 01712345678).',
        loginNeedsPhone:
          'A login needs a mobile number — the number is their ID.',
        loginFailed: 'The login was not created. Please try again.',
        hasLogin:
          'This teacher already has a login. If they have forgotten the password, use “Forgotten their password?” below.',
        notFound: 'Teacher not found.',
        keepOwnSeat:
          'This is your own teacher record — the one seat this plan covers. Switch a colleague off instead.',
      },
    },

    center: {
      title: 'Name & payment',
      subtitle: 'This name and this number are what reaches guardians in every message',
      readOnly: 'Only the centre’s owner can change these.',
      noNumber: 'No payment number yet.',
      errors: {
        ownerOnly:
          'Only the centre’s owner can change the name and the payment number.',
        nameRequired: 'Give the centre’s name.',
        numberInvalid:
          'That number is not right. Give an 11-digit mobile number, e.g. 01712345678.',
        walletNeedsNumber: 'Write which number the money should go to as well.',
        numberNeedsWallet: 'bKash, Nagad or Rocket — choose one.',
      },
    },

    /** See the Bangla for why the screen and the route's refusals share a group. */
    export: {
      title: 'Download files',
      subtitle: 'Lists you can open in Excel or Google Sheets',
      month: 'Month',
      show: 'Show',
      download: 'Download',
      asOf: (date: string) => `As of ${date}`,
      reports: {
        students: {
          title: 'Student list',
          body: 'Name, ID, class, institution, guardian’s name and mobile, which batches they are in, and when they were admitted. Students who have left are included too — the status column says which.',
        },
        collections: {
          title: 'The month’s collections',
          body: 'Every payment in order: date, receipt number, who paid, cash or bKash, and the transaction ID. The same figures as the printed register.',
        },
        dues: {
          title: 'The month’s fee summary',
          body: 'What each student was billed, any discount, what has come in, what is still owed, the due date and the guardian’s number. Cancelled bills are left out.',
        },
        attendance: {
          title: 'The month’s attendance',
          body: 'One line per student per batch: classes held, days present, days absent, late, excused, and the attendance rate. The guardian’s number is on the row, so a sorted list is a call list.',
        },
        marks: {
          title: 'The month’s marks',
          body: 'Every mark from the month’s exams: date, exam name and type, subject, batch, full marks, marks obtained, percentage and pass or fail. Only students whose marks were entered.',
        },
      },
      opensIn:
        'The file opens in Excel, Google Sheets or WPS Office. Bangla names come through intact.',
      lockedTitle: 'This plan does not include downloads',
      lockedBody: (plan: string, pro: string) =>
        `On ${plan} you can read every list in the app but not take it out as a file. Downloading students, collections, fees, attendance and marks comes with ${pro}.`,
      seePlans: 'See the plans',
      errors: {
        signIn: 'Sign in first.',
        noCenter: 'This account is not attached to a coaching centre.',
        forbidden: 'Only the owner or a manager can download files.',
        needsPlan: 'This plan does not include downloads.',
        unknownKind: 'That is not a list we can produce.',
        unreadable: 'The list could not be built. Please try again.',
        tooLarge: (rows: number) =>
          `That list is too big (over ${rows} rows). Download it a month at a time, or get in touch.`,
      },
    },
  },

  /** See the Bangla for why the calculator's words are a group of their own. */
  planCalc: {
    title: 'Work out what a centre costs',
    body: 'Put in how many students and teachers you have. The price updates as you type.',
    students: 'How many students',
    teachers: 'How many teachers',
    monthly: 'A month',
    breakdown: 'How that adds up',
    studentPart: 'For students',
    seatPart: '{n} extra teachers',
    seatsIncluded: '{n} teacher seats are included',
    floorNote: 'Minimum {floor} — a small centre pays this',
    ratesTitle: 'Per-student rates',
    bandRow: 'Students {from}–{to} · {rate} each',
    bandLast: 'Beyond {from} · {rate} each',
    seatRate: '{n} teachers free, then {rate} each',
    quoteNote: 'This is a calculated figure. The final price is agreed in conversation.',
  },

  /** See the Bangla for why the founder panel is translated at all. */
  founder: {
    title: 'Customers',
    lead: 'Every centre, how much they are using it, and what each owes this month.',
    download: 'Download CSV',
    empty: 'No centres yet.',
    emptyHint: 'The first customer will appear here.',
    unreadable: 'Could not read the list.',
    unreadableHint: 'Reload. If it stays broken, go and look at the database.',
    notFound: 'Not found.',
    unnamed: 'No name',
    noOwner: 'No owner on record',
    window: 'Attendance, exams, collections and messages cover the last 30 days.',
    gatewayNote: 'Gateway SMS is zero everywhere — no BTRC sender ID has been registered yet.',
    status: {
      trial: 'Trial',
      active: 'Active',
      suspended: 'Suspended',
      cancelled: 'Cancelled',
    },
    totals: {
      centers: 'Centres',
      active: 'Active',
      trial: 'On trial',
      quiet: 'Gone quiet',
      students: 'Students',
      teachers: 'Teachers',
      mrr: 'Monthly billing (ours)',
      pipeline: 'Trial pipeline',
      collected: 'Centres collected',
      /** Four tap-to-send figures, not one "Messages". See the Bangla note. */
      taps: 'Fee reminders sent',
      notes: 'Week notes sent',
      results: 'Marks sent',
      absences: 'Absences told',
      paid: 'We have received',
      /** The call list, and one month of what is on it. See the Bangla note. */
      owing: 'Owing now',
      owed: 'Owed (one month)',
      /** A job, not a measurement, and the one tile you want reading zero. */
      asking: 'Asking to upgrade',
      /** Trials in their last week, and trials already over. See the Bangla note. */
      ending: 'Trials ending',
    },
    bill: 'A month',
    size: {
      students: 'students',
      batches: 'batches',
      teachers: 'teachers',
    },
    usage: {
      attendance: 'Attendance',
      exams: 'Exams',
      payments: 'Payments',
      collected: 'Collected',
      taps: 'Reminders',
      notes: 'Week notes',
      results: 'Marks',
      absences: 'Absences',
      sms: 'Gateway',
      credits: 'Credits',
    },
    signedUp: (date: string) => `Signed up ${date}`,
    lastActive: (date: string) => `Last used ${date}`,
    neverActive: 'Never used it',
    quiet: (days: number) => `Quiet for ${days} ${days === 1 ? 'day' : 'days'}`,
    /**
     * The trial clock. Three sentences, because a countdown, a deadline today and an
     * overrun are three different phone calls. See the Bangla note.
     */
    trialLeft: (days: number) =>
      `Trial ends in ${days} ${days === 1 ? 'day' : 'days'}`,
    trialToday: 'Trial ends today',
    trialOver: (days: number) =>
      `Trial ended ${days} ${days === 1 ? 'day' : 'days'} ago`,
    trialEnds: (date: string) => `Trial ends ${date}`,
    paidNothing: 'Has not paid yet',
    paidTotal: (amount: string) => `Paid ${amount}`,
    paidThrough: (date: string) => `Paid up to ${date}`,
    owed: {
      badge: 'Owes',
      yes: 'Owes',
      no: 'Paid up',
    },
    /** Composed by the Server Action, on the server. See the Bangla note. */
    paymentSaved: (amount: string, from: string, to: string) =>
      `Recorded ${amount} — ${from} to ${to}.`,
    paymentSavedMonth: (amount: string, month: string) =>
      `Recorded ${amount} — for ${month}.`,
    planSaved: (plan: string, state: string) => `Now ${plan} · ${state}.`,
    tooMuch: (max: string) =>
      `More than ${max} at once is not allowed. Check the figure again.`,
    overLimit: (plan: string) =>
      `This centre already holds more students or teachers than ${plan} allows. `
      + `Nothing has been deleted, but adding more will now be blocked.`,
    /** String leaves only — this group is handed to a client component. */
    money: {
      open: 'Money and plan',
      payTitle: 'Record a payment',
      amount: 'Amount',
      amountHint: 'This month’s bill is prefilled — change it if they paid something else.',
      method: 'How it came',
      coversFrom: 'From which month',
      months: 'How many months',
      reference: 'Transaction ID',
      referenceHint: 'The bKash or Nagad TrxID. Leave blank for cash.',
      note: 'Note',
      pay: 'Record payment',
      paying: 'Recording…',
      planTitle: 'Plan and status',
      plan: 'Plan',
      state: 'Status',
      apply: 'Change',
      applying: 'Changing…',
      notActive: 'Payment recorded, but this centre is not switched on yet — change the status below.',
      forbidden: 'Not allowed.',
      noCenter: 'That centre was not found.',
      badAmount: 'That amount could not be read.',
      badMethod: 'That payment method is not one of the choices.',
      badPeriod: 'That month is not one of the choices. Pick again.',
      badMonths: 'That number of months is not one of the choices.',
      badPlan: 'That plan is not one of the choices.',
      badStatus: 'That status is not one of the choices.',
      failed: 'Could not save it. Try again.',
    },
    /** Outside `asked` because it takes an argument. See the Bangla note. */
    askedFor: (plan: string) => `Asked for ${plan}`,
    /** String leaves only — this group is handed to a client component. */
    asked: {
      /** Not "Upgraded" — it means the call happened. See the Bangla note. */
      markHandled: 'We have spoken',
      marking: 'Saving…',
      handled: 'Taken off the list.',
      failed: 'Could not do it. Try again.',
    },
    /** Outside `lockout` because it takes an argument. See the Bangla note. */
    resetDone: (name: string) =>
      `${name} — new password set. Read it out to them now.`,
    /** String leaves only — this group is handed to a client component. */
    lockout: {
      summary: 'Somebody cannot get in',
      body:
        'Type the number they sign in with and a new password, then read it out to '
        + 'them on the phone. An owner, a manager or a teacher of this centre — any '
        + 'of them. Another phone that is already signed in will not be signed out '
        + 'on its own.',
      phone: 'Login number',
      phoneHint: 'Usually the number they are ringing you from.',
      password: 'New password',
      passwordHint: 'Shown on screen, because you have to read it out.',
      submit: 'Set the password',
      saving: 'Setting…',
      failed: 'Could not do it. Try again.',
      errors: {
        noAccount: 'No account has that number. Check the digits again.',
        self:
          'That is your own account. This is not the screen for your own password '
          + '— change it on your account screen.',
        platformAdmin:
          'That account belongs to the platform, not to a centre. Its password '
          + 'cannot be set from here.',
        notStaff:
          'That account does not work at this centre. Check both the number and '
          + 'which centre you are on.',
      },
    },
    csv: {
      name: 'Centre',
      area: 'Area',
      status: 'Status',
      plan: 'Plan',
      bill: 'Monthly bill',
      owner: 'Owner',
      ownerPhone: 'Owner phone',
      centerPhone: 'Centre phone',
      students: 'Students',
      teachers: 'Teachers',
      batches: 'Batches',
      signedUp: 'Signed up',
      /** Blank unless the centre is on trial. See the Bangla note. */
      trialEnds: 'Trial ends',
      attendance: 'Attendance (30d)',
      exams: 'Exams (30d)',
      payments: 'Payments (30d)',
      collected: 'Collected (30d)',
      taps: 'Fee reminders (30d)',
      notes: 'Week notes (30d)',
      results: 'Marks messages (30d)',
      absences: 'Absence messages (30d)',
      sms: 'Gateway SMS (30d)',
      smsCredits: 'SMS credits',
      lastActive: 'Last used',
      quietDays: 'Days quiet',
      paid: 'Paid to us',
      lastPaid: 'Last payment',
      paidThrough: 'Paid up to',
      owes: 'Owes',
      /** Last on the row: sort by these and you have the call list. */
      wants: 'Plan asked for',
      wantsSince: 'Asked on',
      wantsNote: 'What they wrote',
    },
  },
}
