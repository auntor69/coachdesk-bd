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

  shell: {
    logout: 'Log out',
    mainMenu: 'Main menu',
    welcome: 'Welcome',
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

    saved: (n: number) =>
      `Attendance saved — ${n} ${n === 1 ? 'student' : 'students'}`,
    rowLabel: (name: string) => `${name} — attendance`,
    saveFor: (batch: string) => `${batch} — Save attendance`,

    errors: {
      forbidden: 'You do not have permission to do this.',
      noBatch: 'Batch not found.',
      noStudents: 'No students were sent.',
      rosterUnreadable: 'Could not read the student list.',
      emptyBatch: 'This batch has no students.',
      saveFailed: 'Attendance was not saved. Please try again.',
    },
  },

  roster: {
    alreadyTaken:
      'This batch already has attendance for this date. Saving again replaces what was there.',
    note: 'Note',
    notePlaceholder: 'e.g. class ended early for a holiday',
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
    methods: {
      cash: 'Cash',
      bkash: 'bKash',
      nagad: 'Nagad',
      rocket: 'Rocket',
      bank_transfer: 'Bank',
      other: 'Other',
    },
  },

  chase: {
    noNumber: 'No guardian number on file.',
    addNumber: 'Add one',
    optedOut:
      'This family has asked not to be texted — a call is still fine.',
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
    noneNothingOwed: 'No fees are outstanding.',
    noneAllRecent:
      'Everyone who owes has been told recently. Give them a few days.',
    noneNotDueYet: 'The fees still owed have not reached their deadline yet.',

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

  exams: {
    title: 'Exams',
    subtitle: 'Enter marks, tell the guardians',
    new: 'New',
    emptyTitle: 'No exams yet',
    emptyBody:
      'Create an exam and every student in the batch arrives together, ready to be marked.',
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
      /**
       * "adds room" rather than "unlocks features", because it does not unlock
       * any — the free plan holds a smaller centre, not a worse product, and an
       * owner who has been told otherwise stops believing the next sentence too.
       */
      planLimit:
        'This plan is full. Changing plan makes room — every feature stays open either way.',
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
      /** The free plan allows exactly one, so the singular is the common case. */
      plan: (name: string, batches: number) =>
        `${name} plan: ${batches} ${batches === 1 ? 'batch' : 'batches'}, every feature open, SMS metered.`,
      planUnlimited: (name: string) =>
        `${name} plan: as many batches as you need, every feature open, SMS metered.`,
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
        `The ${name} plan holds ${limit} ${limit === 1 ? 'subject' : 'subjects'}. Every feature stays open — only the number is capped.`,
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
        `The ${name} plan holds ${limit} ${limit === 1 ? 'batch' : 'batches'}. Attendance, exams, SMS, fees — every feature stays open, only the number of batches is capped.`,
      needSubjectTitle: 'Add a subject first',
      needSubjectBody:
        'A batch belongs to a subject. Without one, marks and fees have nowhere to land.',
      addSubject: 'Add a subject',

      created: 'Batch created',
      errors: {
        nameRequired: 'Give the batch a name.',
        pickSubject: 'Choose a subject.',
        feeUnreadable: 'Write the monthly fee properly.',
        endBeforeStart: 'The end time has to be after the start time.',
        daysNeedTimes:
          'If you choose which days the class meets, give the start and end times too.',
        duplicate: 'You already have a batch with this name.',
        scheduleFailed:
          'The batch was created, but its class days were not saved. Fix that from settings.',
      },
    },

    students: {
      added: 'Student added',
      errors: {
        nameRequired: 'Give the student’s name.',
        /** ASCII digits in the example — see the Bangla for why they differ. */
        guardianPhone:
          'Give the guardian’s mobile number properly (e.g. 01712345678).',
        studentPhone: 'That student number is not right.',
        duplicateCode: 'A student with this ID already exists.',
        notFound: 'Student not found.',
      },
    },

    import: {
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
        roomShort: (room: number, fresh: number) =>
          `This plan has room for ${room} more ${
            room === 1 ? 'student' : 'students'
          }, but ${fresh} in the list ${fresh === 1 ? 'is' : 'are'} new.`,
        failed: 'The list was not added. Please try again.',
      },
    },

    sms: {
      optedOut: 'SMS turned off',
      optedIn: 'SMS turned on',
    },

    teachers: {
      title: 'Teachers & permissions',
      newTitle: 'New teacher',
      soloTitle: 'Teachers & permissions is for coaching centres',
      soloBody: (plan: string, center: string) =>
        `${plan} is built for one teacher — you. Adding staff, and controlling what each of them can see and do, comes with the ${center} plan. Every other feature is already open.`,
      addedWithLogin: 'Teacher and their login created',
      addedNoLogin: 'Teacher added (no login)',
      linked: (name: string) =>
        `Teacher added — joined to an existing account (${name})`,
      permissionsSaved: 'Permissions saved',
      activated: 'Turned on',
      deactivated: 'Turned off',
      noName: 'no name given',
      confirmLink: (name: string) =>
        `This number already has an account — ${name}. If that is your teacher, tick the box below and save again. They will sign in with their old password.`,
      errors: {
        nameRequired: 'Give the teacher’s name.',
        phoneInvalid: 'That number is not right (e.g. 01712345678).',
        loginNeedsPhone:
          'A login needs a mobile number — the number is their ID.',
        loginFailed: 'The login was not created. Please try again.',
        notFound: 'Teacher not found.',
      },
    },

    center: {
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
  },
}
