# Plans, SMS, WhatsApp, and calling — the sustainable version

> **`MASTERPLAN.md` is canonical as of 2026-08-29.** This document keeps its value
> for messaging: how an SMS actually reaches a guardian from a centre's own number,
> why WhatsApp detection is not free, and what a desktop does with a button only a
> phone can honour. Nothing here has been re-derived since.
>
> **Where this file and the masterplan disagree, the masterplan wins**, and the
> known disagreements are: this document has no student-capacity concept, no Pro
> trial, no Institution branch pricing, and it names the enforcement function
> `overLimit()` — the live function is `limitRefusal()` in
> `src/app/(app)/settings/actions.ts`. For numbers, `src/lib/plans.ts` is the source
> of truth ahead of both documents.

Written 2026-08-23, in answer to four questions: what the tiers should be, how SMS
actually reaches a guardian from a centre's own number, how WhatsApp can be
detected and charged for, and what the desktop does with a button that only a
phone can honour.

**Revised 2026-08-26.** Every table now states what the code actually does rather
than what was proposed, because a decision document that has been half-implemented
is worse than none — the stale version had Teacher Pro at 250 students where the
product enforces 150, and centre bands of 1,999/3,999/7,999 where a 400-student
centre is billed 7,300. Superseded figures are struck through rather than deleted,
so a number you remember reading can be found and seen to be dead. Three proposals
are marked **withdrawn** with the reasoning kept: they are decisions, not omissions,
and an unrecorded no reads as a not-yet.

This is a decision document, not a spec. Where a decision is the founder's, it
says so and stops.

---

## 1. The tiers

### What the code said when this was written — all three now fixed

`src/lib/plans.ts` is the single source of truth. These were its values on
2026-08-23. The problems are kept because the reasoning still matters, not because
anything is outstanding:

| | free | plus | center | institution |
|---|---|---|---|---|
| batches | 1 | 6 | ∞ | ∞ |
| students | 60 | 300 | ∞ | ∞ |
| SMS/month | 50 | 200 | 0 | 0 |
| price | 0 | 300 flat | 8/enrollment | 6/enrollment |
| features | all | all | all | all + branches |

1. **The paying tiers got less free SMS than the free tier** — 0 against 50.
   **Resolved, but not the way this document expected.** Every allowance is now 0
   on every tier, and that is a factual decision rather than a pricing one: no
   BTRC sender ID exists, so no aggregator account exists, so there is no gateway
   for an automated message to leave through. A non-zero number here would be a
   counter decrementing against nothing, and a teacher shown *পাঠানো হয়েছে* while
   the parent heard nothing is the one failure this product cannot afford.
2. **Every tier carried `features: {...ALL_FEATURES}`**, so nothing was behind the
   paywall except scale and a 499 tier would have sold nothing free did not.
   **Fixed:** `FREE_FEATURES`, `PRO_FEATURES` and `CENTER_FEATURES` are now three
   distinct objects and each tier names one.
3. `teacher_plus` at 300 Tk / 6 batches / 300 students. **Fixed:** 499 / 5 / 150.

### The tiers as shipped

Every number below is live in `plans.ts` and enforced; this table and that file
must not disagree, and if they ever do, the file is right.

| | Teacher Free | Teacher Pro | Center / Institution |
|---|---|---|---|
| batches | 1 | 5 | unlimited |
| students | 30 | **150** | unlimited |
| students per batch | 30 | **30** | unlimited |
| subjects | 1 | 5 | unlimited |
| teachers | 1 | **1, at any price** | unlimited |
| automated SMS/month | 0 | 0 | 0 |
| may buy credits | no | yes | yes |
| price | 0 | 499/mo | 1,999 floor, then per student |
| support | none | yes | highest priority |

Two notes on the numbers, then the feature split.

**Why Pro is 150 students and 30 per batch, not 250 and 50.** An earlier draft of
this section said five batches of fifty. That put a teacher's ceiling above a small
centre's floor, which made the price indefensible: 250 students on Pro would be
৳499 while 250 students on a centre plan is several thousand, for a customer who
could stand in either tier and pick. Five batches of thirty is the realistic
ceiling for one person who is actually teaching all of them; past it they have
hired somebody, and a person with staff is a centre by definition. The tiers no
longer overlap, so the gap needs no defending.

**Both student caps exist and both are enforced**, because they stop different
things: the per-batch cap stops one lecture hall pretending to be a class, the
total stops five batches of five hundred. Enforced server-side in
`settings/actions.ts` — `overLimit()` for the four countable caps on every create
*and* every reactivate path, and `fullBatches()` for the per-batch one, which names
the batch that is full rather than saying "this plan is full" and making the owner
guess which of three to change. The page-level guards that grey out buttons are
courtesy; the action checks are the enforcement, because a Server Action is a
public HTTP endpoint.

**30 students on free is tight, and that is the point.** A real class in Dhaka is
40–60. So free cannot run a teacher's actual class — it can run one section of
it, or a trial month. That is what makes it marketing rather than a free product.
Deliberate, and I think correct.

### What free must *not* have (the paywall, as built)

`ALL_FEATURES` is gone; `PlanFeatures` is a per-tier object. Flag names are given
so this table can be checked against `plans.ts` rather than trusted.

| flag | free | pro | centre | state |
|---|---|---|---|---|
| `attendance` | ✓ | ✓ | ✓ | the hook; never gate it |
| `feeTracking` | ✓ | ✓ | ✓ | same |
| `exams` | ✓ | ✓ | ✓ | same |
| `manualMessaging` | ✓ | ✓ | ✓ | tap-to-send, unmetered, always free |
| `printedReceipts` | ✗ | ✓ | ✓ | gated on the screens |
| `exportReports` | ✗ | ✓ | ✓ | gated |
| `parentSummary` | ✗ | ✓ | ✓ | gated |
| `buySmsCredits` | ✗ | ✓ | ✓ | flag only — no top-up screen exists to gate |
| `automatedSms` | ✗ | ✗ | ✗ | false everywhere; no gateway exists |
| `staffManagement` | ✗ | ✗ | ✓ | gated, via `hasStaff` |
| `centerWideReporting` | ✗ | ✗ | ✓ | flag only — see below |
| `multipleBranches` | ✗ | ✗ | institution | flag only; no branch screen exists |

**Three flags are declared and never read, and all three are correct.**
`automatedSms` and `buySmsCredits` have nothing to gate until there is an
aggregator account and a top-up screen. `centerWideReporting` is subtler: on a
teacher tier `maxTeachers` is 1, so "the whole centre" and "my own students" are
the same set of rows, and a centre-wide view would show a solo teacher exactly
their own data. There is nothing to withhold. It earns its keep the day a teacher
tier could have two people in it, which is never — so it may end up permanently
inert, and that is fine. Recorded here because an unread flag looks like a missing
check on the next read, and this saves someone rediscovering it.

**~~4-stage fee reminders — free gets 1 stage.~~ Withdrawn — do not build this.**
It was in this table and it was never implemented; `reminder-schedule.ts` has no
plan awareness at all, and it should not gain any. The four stages (due−3, the due
date, late, then repeating) only decide **who appears on today's chase list**.
Gating them would not restrict sending — free already has unlimited tap-to-send by
the decision in §2, deliberately and permanently — it would withhold the
three-day heads-up about a family the teacher already has in their own roster. The
teacher then does not chase, the fee arrives late or not at all, and we caused
that. Charging for scale is fair; charging a teacher to be told a fact about their
own students, on a channel that costs us nothing to serve, is not. The four things
free genuinely does without are the four flags above, which are all things that
cost us something or belong to an organisation. That list is complete; this was a
fifth lock on a door that already has four.

**Why the receipt is the right thing to gate.** It is the one feature that makes
a teacher look institutional in front of a parent. A teacher who has handed out
30 printed slips cannot go back to a notebook — the parents now expect paper. It
is felt every single time money changes hands, which is the highest-frequency
moment in the product, and it costs us nothing to serve, so gating it is pure
margin. It is also *visible while locked*: the free user sees the button, taps it,
and reads "receipts are part of Pro" — which is worth more than hiding it.

**One caution.** Gating the receipt means a free teacher takes money and has
nothing to give. That is a slightly worse product than they had with a notebook,
because a paper book at least had a carbon copy. I would gate the **printed
A4 two-copy sheet** and leave a **plain on-screen confirmation with the receipt
number** available on free — the number is already generated for every payment by
the trigger, so the parent can still be told "your receipt number is 47". Free
gets a number to quote; Pro gets the paper. That keeps free honest without giving
away the thing that sells Pro.

### Centre pricing: the calculator, and what it actually charges

You want a centre to pick students/batches/teachers and be shown a price. The
engine exists — `monthlyBillBdt()` in `plans.ts` — and it has changed twice since
this section was first written, in ways that matter enough to record.

**It counts distinct students, not enrollments.** That was a correction, not a
preference. A centre charges by subject, so a student taking Physics, Chemistry and
Maths is three enrollments and was being billed three times: ৳75 a month for one
child, which is not a number anybody was quoted. One child, one charge.

**The bands are marginal, like income tax — not a flat rate per band.** With flat
per-band rates a centre at 301 students would pay *less* than one at 300, which is
a pricing page that makes the founder look like they cannot count. Each rate
applies only to the students inside its own band, so the bill is continuous and
always rises with size.

| band | students | rate each |
|---|---|---|
| first | 1 – 100 | ৳25 |
| next | 101 – 300 | ৳18 |
| next | 301 – 600 | ৳12 |
| beyond | 601+ | ৳8 |

Plus ৳1,999 floor (applied to the student charge, so seats are never swallowed by
it), 2 teacher seats included, ৳100/month per seat after that.

**~~Small 1,999 / Growing 3,999 / Large 7,999 / Institution from 14,999.~~
Superseded — do not quote these.** They were flat per-band figures from the first
draft and they do not match what the code charges, in both directions. What it
actually bills:

| students | monthly | effective per student |
|---|---|---|
| 50 | **1,999** (floor; raw ৳1,250) | 40.0 |
| 100 | 2,500 | 25.0 |
| 150 | 3,400 | 22.7 |
| 300 | 6,100 | 20.3 |
| 400 | **7,300** | 18.3 |
| 600 | 9,700 | 16.2 |
| 900 | **12,100** | 13.4 |
| 1,200 | 14,500 | 12.1 |

A 400-student centre bills 7,300 where the old table said 3,999 — so asking an
owner "would you pay 3,999 for 400 students?" would have validated a price 46%
under what we charge. At the top it goes the other way: 1,200 students bills
14,500, *below* the old "Institution, from 14,999". Teacher seats are on top: 300
students with 8 teachers is 6,100 + 600 = ৳6,700.

The taper is deliberate. ৳25 flat is right at fifty students and wrong at nine
hundred — a large centre facing ৳22,500 a month builds a spreadsheet instead, and
the ninth-hundredth student does not cost us what the fiftieth did.

**The rates are still uncalibrated, and this is still the thing I most want a real
owner's answer on.** The structure is sound and the arithmetic is right; ৳25 /
৳18 / ৳12 / ৳8 and the ৳1,999 floor are a founder's judgement with no market
survey behind them. Note that the first twenty customers will all sit in the first
two bands, so the ৳12 and ৳8 rates are theoretical until year two — the numbers
worth checking in a real conversation are **the ৳1,999 floor and the ৳25 first
band**, not the whole table.

---

## 2. SMS: whose number does it come from?

This is the most important question you asked, and the answer is not the one you
expect. **A centre cannot send SMS from their own mobile number through us, and
neither can we. It is not a feature we have not built — it is not possible.**

### Why

Bangladesh's SMS regulation (BTRC) works like this: application-to-person SMS
must go out through a licensed aggregator, from a **registered alphanumeric
sender ID** (an 11-character mask like `UDVASH` or `CoachDesk`), not from a
mobile number. Getting a sender ID requires a trade licence, TIN, and BTRC
paperwork per brand. A personal 017xxxxxxxx number is a *subscriber* number; the
network will not originate A2P traffic from it. There is no API anywhere that
takes "my number" and sends a text as me.

So there are exactly three real options, and the product should offer two of
them.

### Option A — shared CoachDesk sender ID *(build first)*

Every SMS goes out as `CoachDesk`, and the centre's name is inside the body:

> `উত্তরা আইডিয়াল কোচিং: রাফিদ হাসান আজ ক্লাসে অনুপস্থিত।`

- **Cost to centre:** just credits. No paperwork, works on signup day.
- **Cost to us:** one sender ID, one aggregator account, we carry the balance.
- **Downside:** the parent sees our brand, not theirs. For a small teacher this
  is fine — arguably good, it looks more official than a personal number. For a
  400-student centre with its own signage it will grate.
- This is what the code is already written for: one `SMS_SENDER_ID` env var.

### Option B — centre's own registered sender ID *(build second, for centres)*

A centre that wants `UDVASH` on the parent's phone gets it, by doing the
paperwork themselves and giving us the credentials. Mechanically this means
`coaching_centers` grows three columns — `sms_sender_id`, `sms_api_key`
(encrypted), `sms_provider` — and `sendSms()` takes a per-centre config instead
of reading `process.env`. That is a genuinely small code change (~1 day) sitting
behind a real onboarding burden.

Two ways to run it, and **this is a founder decision**:

- **Bring-your-own-account:** the centre opens their own aggregator account, pays
  the aggregator directly, and we just send through it. We make no margin on
  their SMS and carry no float. Clean, and it is what a large institution will
  demand anyway.
- **We resell under their mask:** we register the sender ID as a sub-account on
  our aggregator account, they buy credits from us, we keep the margin. More
  revenue, more of our capital tied up in float, and we are liable for their
  traffic.

I would offer bring-your-own to Institution tier (they want control and will not
accept our brand), and resell to Center tier (they want it to just work). That
way the margin is on the tier that values convenience, and control is on the tier
that values control.

### Option C — the phone's own SMS app *(already built, keep forever)*

This is what `reminder-chips.tsx` does today, and it is quietly the best thing in
the product: an `sms:` link with the body pre-written. The message goes from the
owner's actual number, at their operator's rate, with no sender ID, no
aggregator, no credits, and no regulatory exposure — because *the owner sent it*,
we just typed it for them.

**Its limit is that it cannot be automated.** No cron job, no "remind everyone due
today" in one tap, no attendance alert while the teacher is still in class. It is
one message, one tap, one human. Which is exactly right for the free tier.

### So the tiering falls out naturally

| | free | pro | centre |
|---|---|---|---|
| tap-to-send from own phone (Option C) | ✓ unlimited | ✓ unlimited | ✓ unlimited |
| automated SMS via `CoachDesk` (A) | ✗ never | 0 today, then credits | 0 today, credits only |
| own sender ID (B) | — | — | ✓ |

**The middle row is 0 everywhere today, and that is a fact rather than a price.**
No BTRC sender ID exists, so no aggregator account exists, so there is no gateway
for an automated message to leave through. `monthlySmsCredits` is 0 on all four
tiers and `automatedSms` is false on all four. The metering, the ledger, the
refund path and the claim/finish worker are all built and tested against those
numbers, so the day a gateway exists this is the only line in `plans.ts` that
changes.

An earlier draft of this table gave free 30 automated messages and Pro 50. Free
should get **none**, and not for pricing reasons: an allowance implies delivery,
and 30 messages that silently go nowhere is worse than a locked button that
explains itself. The free tier's messaging story is Option C, which is complete,
unmetered, and genuinely unlimited — the owner's own phone, their own number,
their own operator's rate.

So the sentence for the pricing page is not "you get 30 to try it". It is:
*sending from your phone is free and always will be; sending without picking up
your phone is what Pro buys.* That is the honest version, it survives the
gateway not existing yet, and it does not need rewriting on the day it does.

---

## 3. WhatsApp

Your two questions: how do we know a parent has it, and how do we make money.
Honest answers: **we cannot know**, and **we should not try to charge for it.**

### Detection is not available to us

There is no legitimate API that answers "does this number have WhatsApp". The
WhatsApp Business API will not tell you before you send; on-WhatsApp checks were
removed from public access and using an unofficial one gets a number banned. So
any "has WhatsApp ✓" badge we drew would be a guess, and a wrong guess costs a
parent a message they never got.

What we *can* do, and should:

1. **~~Infer from behaviour, never claim.~~ Withdrawn — do not build this.** The
   idea was: `fee_reminders` logs every reminder with its channel, so an owner who
   sent WhatsApp and later sent SMS to the same family for the same invoice is weak
   evidence WhatsApp did not land; after two such fallbacks, stop offering WhatsApp
   first. It is wrong, and writing the migration is what made it obvious. **The
   overwhelmingly commoner reason for a second channel is that the family has not
   paid yet**, which is exactly what a diligent owner escalates through — so the
   product would learn to demote WhatsApp for the families it works best on, and the
   harder an owner chased, the worse the ordering would get. There is no signal in
   the log that separates "the message did not arrive" from "the message arrived and
   the money did not". Item 2 is not a cheaper substitute for this; it is the correct
   answer, because the owner *can* tell those two apart and we cannot.
2. **Let the owner mark it. — Built.** `students.preferred_channel`
   (`outreach_channel`, nullable, no default) with NULL as a real fourth answer
   meaning *nobody has said*. Set from Settings → SMS, one dropdown per row beside
   the opt-out switch. `src/lib/students/channel.ts` holds the ordering; migration
   `20260811000026` adds the column and carries it through
   `fee_invoice_balances` and `student_progress_week` so the fee board, the chase
   list and the weekly-news screen all read it. It is also a column on the roster
   export, because it is the one field on a student the centre *typed* — everything
   else could be retyped off an admission form, and which of three channels a
   particular father answers is a term's worth of learning that exists nowhere else.
3. **Reorder rather than hide. — Built, and bounded.** All three chips always
   render; **exactly one** moves, to the front, and the other two keep their
   relative order — three layouts, not six. An owner works down 150 rows with a
   thumb, and a mis-tap both opens the wrong app and writes a row claiming that
   channel was used. The chip that moved is also the one drawn in brand colour, so
   the button in an unfamiliar position is the button that looks different.

**A preference is not a permission.** `sms_opt_out` is the only column that decides
who may be messaged; `preferred_channel` can only reorder what the opt-out already
allowed. A family opted out of messages is offered the call chip and nothing else,
whatever their mark says — enforced in `chaseOrder`, in `tests/channel.test.ts`, and
by an RLS check that a teacher cannot write the column at all (who a centre talks to
and how is not a batch fact).

### Money from WhatsApp: don't, yet

The WhatsApp Business API charges per conversation and requires template
pre-approval, a Meta Business verification, and a Facebook Business Manager — a
process that takes weeks and assumes a registered company. For a solo founder
with no capital this is out of reach in 2026, and I should not pretend otherwise.

**The sustainable position:** WhatsApp stays a free, unmetered, tap-to-send
channel on every tier, exactly as it is now. It costs us nothing, it is the
channel Bangladeshi parents actually read, and giving it away free is a genuine
competitive advantage over the SMS-only tools. We monetise **SMS**, because SMS
is where the real cost is and where automation is the thing worth paying for.

Revisit only when there is a registered company and revenue — and then the pitch
is *automated* WhatsApp (a template that fires without a tap), not detection.

---

## 4. Phone versus desktop

`tel:`, `sms:` and `wa.me` links exist in `reminder-chips.tsx`,
`risk-list.tsx`, and `settings/teachers/page.tsx`. There is **no device detection
anywhere in the codebase** today. On a laptop, `tel:` typically does nothing and
`sms:` does nothing; `wa.me` works fine because WhatsApp Web exists.

You asked: remove the buttons on desktop, or warn? **Neither, quite.** Removing
them is bad — an owner who uses the laptop at their desk and the phone in class
would find the product has different features in two places, and support gets
"where did the call button go". A blocking warning is bad too: it interrupts
someone who may have a softphone and for whom `tel:` works perfectly.

The right answer is to let the desktop do the thing a desktop is actually good
at, which is **handing the job to the phone**:

- **Call on desktop** → the number, large, selectable, with a copy button, and
  the words "call from your phone". A desktop cannot dial, but it can make the
  number trivial to get into a phone. No warning, no dead button — a different
  and genuinely useful control.
- **SMS on desktop** → the pre-written message with a copy button, same
  reasoning. Copying the text is most of the value; the owner pastes it on their
  phone.
- **WhatsApp on desktop** → unchanged. `wa.me` opens WhatsApp Web and works.

Detection should be **capability, not user-agent**: `matchMedia('(hover: hover) and (pointer: fine)')`
identifies a mouse-driven device without sniffing, and gets tablets right (a
tablet with a SIM can dial and reports coarse pointer). It must be read in an
effect and defaulted to the phone shape during SSR, or the server and client
disagree and React re-hydrates the wrong control.

### "Send to my phone" — considered, and not worth building

An earlier draft of this section suggested that once the desktop knows it is a
desktop, it could offer **"send to my phone"**: a queue of pending chases the
owner picks up on the phone in one tap. It sounded like the feature that turns the
desktop's weakness into a strength. **It should not be built, and the reason is
worth writing down so it does not get re-proposed.**

**The queue already exists and is already derived.**
`src/lib/fees/reminder-schedule.ts` computes who needs chasing today from the
unpaid invoices, the stage each family has reached, and a three-day cooldown;
`/fees/reminders` is that list on a screen, with the tap-to-send chips already on
each row. Opening that URL on the phone is "send to my phone". The capability is
not missing — there is nothing to send, because the list is not stored anywhere
to be sent. It is a function of the invoices.

**So the only thing a queue would add is the owner's hand-picked subset — and
that is exactly the part that does the damage.** A saved selection is a second
answer to "who needs chasing", sitting beside a derived one, and the two diverge
the moment anything happens: a family pays, and the fee board drops them while
the queue still holds them; a stage advances, and the derived list adds someone
the queue never had. Then the owner is chasing a parent who paid on Tuesday,
holding a printout from Monday, and the product told them to. `reminders/page.tsx`
already treats messaging the same family twice as the thing to prevent — a stale
queue is a machine for doing it.

**The real need underneath it is selection, not transport.** An owner at their
desk genuinely does want to say "these six, not those twenty". That is judgement
the schedule cannot make, and it is worth serving — but the shape is a **filter or
a sort on the existing list**, computed fresh each time it is opened, never a
stored set of rows. The list is already ordered by stage, so working down it from
the top is most of that today.

**One-line rule for whoever reads this next:** the chase list is derived from the
invoices and must stay derived. Anything that saves a copy of it is wrong, however
convenient the copy is.

---

## 5. What I would build, in order

1. **Per-tier features + the new limit keys.** Shipped as `maxStudentsPerBatch`,
   `maxSubjects`, `buySmsCredits` and `automatedSms` — note the flag is
   `buySmsCredits`, not `canBuyCredits` as an earlier draft of this line said.
   Enforced in `plans.ts`, in every server action that creates or reactivates a
   capped row, and on the screens — with the locked feature *visible and
   explained*, never hidden. **— Built.**
2. **Receipt gating**, per §1: number on free, paper on Pro. **— Built.**
3. **Device-aware chips**, per §4. Small, self-contained, no schema change.
   **— Built.**
4. **`preferred_channel` on students**, per §3, plus chip reordering.
   **— Built, minus the history inference.** The owner's mark and the reordering
   shipped (migration `20260811000026`, `src/lib/students/channel.ts`, the dropdown
   on Settings → SMS). The *"from `fee_reminders` history"* half is **withdrawn, not
   pending** — see §3 item 1 for why inferring a dead channel from a second reminder
   would systematically demote the channel that works best. Nothing is left to do
   here; do not re-open it as a to-do.
5. **Per-centre sender ID** (§2 Option B) — `sendSms()` takes a config, three
   new encrypted columns. Only when a centre asks; not before. **— Not built, and
   blocked twice over:** it needs an aggregator account, and it needs your
   resell-versus-bring-your-own answer before the shape of the columns is even
   decidable.
6. **Centre pricing calculator. — Built.** `settings/billing/calculator.tsx`: students
   and staff in, the marginal bands applied, the floor called out when it is doing
   the work, the seat charge shown separately, one total out. It reads
   `STUDENT_BANDS` and `CENTER_MONTHLY_FLOOR_BDT` directly, so it cannot drift from
   what we actually bill — change a rate in `plans.ts` and both the screen and the
   invoice move together. What is still soft is the **rates**, which is a
   conversation rather than a build; it has moved to §6.
7. **A way to say yes. — Built**, and it was not on the original list because the
   gap it closes only became visible once item 6 shipped. The calculator told an
   owner exactly what Center would cost them and then the screen ended: the one
   control that turned that into money was a contact card gated on a config value
   nobody had filled in. So an owner asks in-app instead — migration    `20260811000027`, `settings/billing/upgrade-request.tsx`, and three new columns on
   `platform_centers()` that put the request on the customer's own card in the
   founder panel, next to their counts, their bill and their mobile number. Owner
   only, no plan gate — a free teacher tapping it is the most valuable caller this
   table has — and it grants nothing: `coaching_centers.plan` stays writable only by
   us, so the worst a forged request achieves is a phone call worth making.

**Everything on this list is built except item 5, and item 5 is waiting on you.**
That is the honest summary: the only engineering step left on this list needs either
an aggregator account or a decision from you. The §6 list is where the remaining work
lives.

---

## 6. What needs you

Split into things that block work and things already shipped under an assumption
you can overturn. Nothing in the second list is waiting on you — it is listed so
you know what was assumed on your behalf.

### Blocking

- **Your phone number, as one line of config.** `NEXT_PUBLIC_SALES_PHONE` is empty,
  so the WhatsApp and call buttons on the plan screen do not render. This used to be
  the item that cost revenue outright, because the whole "get in touch to upgrade"
  card was gated on it — an owner who had just read the Center price reached the
  bottom of the page and found nothing. That is fixed: the card is always there now,
  and an owner taps **"প্ল্যান বদলাতে চাই"**, picks a tier, and the request lands on
  their own card in your founder panel beside their student count, their monthly
  bill and a `tel:` link to their mobile. You ring them. So the number is no longer
  blocking a sale — it is the difference between them being able to reach you *now*
  and having to wait for you to open the panel. Still the cheapest item on the list.
- **The ৳1,999 floor and the ৳25 first band** (§1). One conversation with one real
  owner. Not the whole rate table — the ৳12 and ৳8 bands are theoretical until you
  have a nine-hundred-student customer, so they can wait. The old
  1,999/3,999/7,999/14,999 figures are superseded; do not take those to a
  conversation.
- **Resell vs bring-your-own** for centre sender IDs (§2). Revenue and float
  versus simplicity and no liability. Blocks §5 item 5, which nothing else blocks.
- **BTRC sender ID needs your NID.** Blocks every automated message, the OTP on
  signup, and therefore the `monthlySmsCredits` line in `plans.ts` being anything
  but zero.
- **Rotate the Supabase DB password**, and add `CRON_SECRET` to Vercel.

### Shipped on an assumption — say the word and it changes

- **Teacher Pro is live at ৳499.** Against 30 free students and 5 batches that is
  roughly half of one student's monthly fee at ৳1,000 a head. "Half a student pays
  for the software" is the pitch I would make, and it is the one in the code.
- **The free-receipt question is decided the way I recommended:** the receipt
  *number* is free on every tier — a trigger assigns it to every payment, so a
  free teacher can read "your receipt number is 47" aloud — and the printed A4
  two-copy sheet is Pro. If you want the harder line, gating it entirely is a
  one-word change to `FREE_FEATURES`.
- **Free gets no automated SMS allowance at all**, where an earlier draft gave it
  30. See §2: an allowance implies delivery, and there is no gateway. Free's
  messaging is tap-to-send, unlimited, permanent.
- **Reminder stages are not gated** and I recommend they never are — §1 has the
  reasoning. This reverses a line in the original table.
