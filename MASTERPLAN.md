# CoachDesk BD — Masterplan

Software for coaching centres, coaching institutions, and private tutors in
Bangladesh. Sold locally, in BDT, collected by bKash. Built solo, on free tiers.

**This document is the source of truth for product, pricing, entitlement,
roles, and billing architecture.** Where any other document, comment, or piece
of code disagrees with it, this document is the intent and the other thing is a
bug — with one exception, stated below.

**The one exception:** `src/lib/plans.ts` is the source of truth for *numbers*.
Rates, caps, floors, and band boundaries live there and are imported by every
screen, every server action, and the founder panel. This document explains and
constrains those numbers; it does not duplicate them as an authority. If a
figure here disagrees with `plans.ts`, `plans.ts` is right and this document
needs an edit.

- **Revised 2026-08-29** — rewritten end to end. Pricing restructured around
  purchased student capacity rather than plan caps; Pro trial defined as a
  temporary entitlement rather than a tier; Institution defined as a
  multi-branch organisation rather than a bigger Center; roles rebalanced so
  teachers take attendance and managers handle money. Obsolete assumptions from
  the 2026-08-11 version are retired explicitly in §13 rather than deleted.

- **Revised 2026-09-05 — one prepaid balance, burned by the day.** The money
  model is now a single mechanism and it is stated once, in §11.6: *money in →
  taka in the balance → each day takes its own cost off → when the balance
  cannot cover the next day, saving stops until they top up.* Size changes the
  daily rate and nothing else. There is no invoice, no due date, no coverage
  period to lapse, no grace window, no credit in either direction, and no seat
  to buy — purchased student capacity is retired in §18, along with the
  contextual seat purchase that used to sit inside Add Student. §§3.3–3.7 now
  point at §11.6 for the model and keep only what is still true of them.
  Everything §2 sells is unchanged: the ৳1,999 floor, the marginal bands and the
  teacher seat still compute the monthly figure a customer is quoted. That
  figure is simply divided by thirty and taken a day at a time.

- **Revised 2026-09-18 — step 25's two halves, and the suite's own clock.** The recharge
  claim and the founder's queue are built: a customer files what they sent (priced
  server-side, credited nothing) and the founder opens their own bKash and either credits
  the amount that arrived or closes the claim with a reason from §11.9's four. Two forms per
  claim, so a rejection's reason can never ride along on a credit, and the four names are
  held against `recharge_claims.reject_reason` by a test that reads the migration — the
  reason exists in three places and only a test keeps them one list. `20260811000084` is
  written and **not yet applied**, which is why §15's ❌ list and §16.1's row 25 still read
  "not built": applying it, regenerating `src/lib/supabase/types.ts` and deleting
  `lib/billing/provisional-types.ts` are one commit and it is the next one. Separately,
  `scripts/lib/pg-harness.mjs` pins its session to `Asia/Dhaka`, because the suite was 2
  failures and an abort between 6pm UTC and midnight — two fixtures aged rows with the
  database's UTC `current_date` while asserting against a schema that forbids exactly that,
  the accountant hired at midnight local having joined "tomorrow" and so being unable to
  leave. The rule the product already states, that the day is a Dhaka calendar day and never
  the database clock, is now  the rule the test database runs on.

- **Revised 2026-09-18 — the pages that had to exist before the first taka (step 25a, §14.1).**
  All seven are written, in Bangla and English, from one file
  (`src/lib/legal/policies.ts`) that carries each document's own version beside its words —
  per page and not one number for the site, because a reader re-asked to accept the billing
  terms because the privacy page gained a paragraph is a dialog nobody reads. They are served
  by a public route group at `/legal` (`src/app/(legal)/legal`, one dynamic segment, so seven
  documents are not seven copies of the same header), opened in `src/proxy.ts` beside the
  login form, and they say what §14.1 asks each one to say: **Prepaid Billing Terms** (not
  refundable, never expires, the daily burn, the rate following the centre's own size, a bonus
  being credit and not cash, read-only and nothing deleted when the balance dries, verification
  by hand inside one working day), **Refund & Cancellation** (what is offered instead — an
  adjustment with a written reason), **Terms of Service** (18+, one account per human, a
  centre-issued login belongs to the centre, the grounds for suspension), **Privacy Policy**
  (what is held, why, for how long, who inside a centre sees it, that no student record goes to
  any AI provider, and that consent always belongs to the adult at the centre), **Acceptable
  Use** (guardian numbers are for this centre's own communication, never a mailing list),
  **Account Deletion & Data Export**, and **Security & Contact** with the one number §14.1
  names. **Consent is a row and not a checkbox:** `20260811000085` adds `policy_kind` and
  `policy_acceptances` — one row per person, per policy, per version they agreed to, read and
  written by the person themselves (`app.is_member` on any centre the row names), editable and
  deletable by nobody, with the `ip` column declared and deliberately never written. Two
  partial unique indexes rather than one constraint, because `coaching_center_id` is null on
  every signup acceptance and Postgres treats nulls as distinct — the same person would
  otherwise have been able to agree to the same wording on every reload. Recorded at signup
  (the tick is required before the account exists, and the row is written in the same call that
  proves the address) and at the first recharge, where the non-refundable sentence §11.6
  commits to now links to the terms it is promising, and re-asked when a version changes. **No
  compliance claim we have not been audited against**, held by a test that refuses `GDPR`,
  `ISO`, `SOC 2`, `PCI`, `HIPAA` and their Bangla forms in either language. One latent defect
  found on the way and fixed: `RechargeForm` was being handed `RechargeWords`, whose helpers
  are functions, across the Server/Client boundary — which React refuses to serialise — so the
  panel now composes every figure and sentence and the form takes strings, the same negotiation
  `recharge-queue.tsx` already made. Counts: **85 migrations, 1,638 unit tests, 1,466 RLS
  assertions, 15 new consent assertions** (`scripts/test-legal.mjs`, wired into `npm test` as
  `test:legal`), plus 33 billing and 55 recharge checks, all green. Two things are still
  outstanding and both are the same commit: **`20260811000084` and `20260811000085` are written
  and not yet applied**, so §15's ❌ list, §16.1's rows 25 and 25a, and `test:scoping` — which
  reports six queries against relations the generated types do not have — are all waiting on a
  push and `npm run gen:types`.

---

## 0. How to read this

Every claim about the product carries a status marker, because this document
covers both what is built and what is decided-but-unbuilt, and confusing the
two is how a founder ends up demonstrating a feature that does not exist.

| | meaning |
|---|---|
| ✅ **Built** | in the repository, enforced server-side, covered by tests |
| ⚠️ **Partial** | some of it is real; the gap is named on the spot |
| ❌ **Decided, not built** | agreed design, no code yet |
| 🚧 **Blocked** | cannot be built until something outside the code exists |
| ⛔ **Obsolete** | was decided, is now retired — kept so the reasoning survives |

Nothing in here may be marked ✅ on the strength of a screen. A disabled button
is not enforcement. If the only thing stopping an action is the frontend, the
status is ⚠️ and the missing server check is named.

§§1–19 are the product: what it sells, what it charges, what it refuses. §20 is the
interface — the information architecture, the frame, and the redesign the current screens
need. They are one document deliberately: a screen is designed from the rule it presents,
and a rule that cannot be presented well is a rule worth re-reading.

---

## 1. Product overview

CoachDesk BD is a Bengali-first PWA that runs the daily operations of a
Bangladeshi coaching business: the roster, attendance, exam marks, fee
collection, and the messages that go to guardians.

**The wedge is fee collection.** A centre with 200 students chases late fees by
phone and WhatsApp every month, loses track, and writes some off. That is the
bleeding wound, it is measurable in taka, and it is what the demo shows. Every
other feature exists either to make the fee board work or to stop the customer
leaving once it does.

**Three customer shapes, one product:**

- **A private tutor** running one or two batches out of a room. Wants a register
  that is faster than paper and a way to see who has not paid. Will not pay much,
  and mostly should not have to — this is the top of the funnel.
- **A coaching centre**: one location, a few staff, 100–600 students, a front
  desk that handles cash. This is the paying customer and the whole product is
  shaped around them.
- **A coaching institution**: one brand, several branches in several cities, an
  HQ that needs to see all of them and cannot get a straight answer today. This
  is the largest cheque and a genuinely different product surface — see §5.

**Who buys:** the owner, or the institution's central administrator. One person
decides. Not a procurement committee.

**Who uses it daily:** teachers (attendance, marks), the front desk or manager
(fees, receipts, messages), the owner (the dashboard). Guardians receive
messages and do not log in — see the next paragraph.

**There is no student or guardian panel, deliberately.** Guardians in this market
will not maintain an account, and building for a user who never returns is the
most expensive mistake available. They get messages on the number they already
use. The `student` and `guardian` roles exist in the schema and in RLS so the
door is bolted rather than merely shut, but no screen is built for them.

---

## 2. The four plans

There are **four** plans and no others:

1. **Teacher Free**
2. **Teacher Pro**
3. **Coaching Center**
4. **Institution**

**A Pro trial is not a fifth plan.** It is a temporary state that grants Teacher
Pro's entitlements to a new account for a fixed number of days. See §2.2 — this
distinction is load-bearing and the code must not grow a fifth tier to express
it.

### 2.1 Teacher Free — ৳0, forever

**Not a trial.** This tier has no end date and must stay genuinely useful for as
long as someone wants to use it. It is the top of the funnel and the reason a
teacher shows the app to the centre they also teach at.

**Limits:** 1 batch · 30 students · 30 students per batch · 1 teacher · 1 subject.

**Included:** attendance, exams and marks, fee tracking, a receipt *number* on
every payment, and tap-to-send SMS / WhatsApp / call from the teacher's own
phone. Unmetered, because it costs us nothing — see §3.9.

**Withheld:** printed A4 receipt, CSV/report export, weekly guardian progress
summary, staff management, SMS credits, centre-wide reporting, branches.

**Why 30 students is tight on purpose:** a real Dhaka class is 40–60 students.
Free runs *one section*, or one month of one section. It is marketing that
happens to be a working product, not a free product with a marketing budget.

### 2.2 Teacher Pro trial — a state, not a tier ✅

A new self-serve signup gets **14 days of Teacher Pro** automatically. No card,
no payment step, no separate product.

```
signup → Pro trial (14 days) → expires → Teacher Free
```

**14 days and not 30**, for a teacher: a private tutor's value shows up in the
first week of attendance and the first receipt they print. Thirty days is the
right length for a *centre* trial, where the value is only visible across a full
fee cycle (§9), and those are hand-run by the founder — a different mechanism
with a different clock.

**The trial grants exactly Teacher Pro's entitlements. Not a subset, not a
superset, and above all not its own set.** There must be no `trial_features`
object, no `isTrial` branch inside a feature check, and no fifth `PlanId`. The
rule is one line:

```
active Pro subscription OR active Pro trial → Teacher Pro entitlements
otherwise                                    → Teacher Free entitlements
```

Implemented as a single resolver — see §4.2. Every existing feature gate then
works unchanged, because it asks what the *effective* plan is and never asks
whether the customer is trialling.

**On expiry the account really loses Pro.** Printed receipts stop, export
returns 403, the progress summary locks. This has to be true or the trial sells
nothing.

**Expiry never deletes anything.** See §4.5 — this is the part that has to be
designed carefully, and it is designed once, for every downgrade, not specially
for trials.

Built across `20260811000039` and the app shell. `bootstrap_center` stamps
`trial_plan = 'teacher_plus'` and `trial_ends_at = now() + 14 days` on every new
centre, so the fortnight starts in SQL and needs no first request to trigger it;
`effectiveEntitlement` compares that instant on every session, so the trial ends
on time whether or not anything ran. The fourteen days are granted to every
signup and not only to a teacher-mode one — a centre that turns out to be a
centre keeps them, and the tier it converts to is a conversation, not a timer.

And the customer is told, which is the half that sells it: `trialStanding` reads
the two columns, and a banner in the shell names the tier, the day it ends and
the days left for the whole fortnight, then explains for a week afterwards which
three things stopped and that nothing was deleted. It is deliberately not part of
`Entitlement` — see §4.2 on why nothing downstream learns *why* it may do what it
may do. The notice stands down while the read-only banner is up: one ask per
screen, and a bill outranks an upsell.

### 2.3 Teacher Pro — ৳499/month

An **individual teacher's** plan. Flat price, no usage component.

**Limits:** 5 batches · 150 students · 30 students per batch · **1 teacher** ·
5 subjects.

**Adds over Free:** printed A4 receipts, CSV/report export, weekly guardian
progress summary, SMS credits (when a gateway exists — 🚧, see §3.9).

**`maxTeachers` is 1 at any price, and this is the wall between the tiers.** A
teacher who needs a colleague needs a centre plan. No amount of money moves this
to two, because the moment it does, Pro is a cheap Center and the ৳1,999 tier
sells nothing.

**150 students, not 250.** Pro's ceiling must sit *below* the point where the
Center floor is cheaper, or a 250-student customer gets to stand in either tier
and will pick ৳499. At 150 students a Center would bill ৳3,400 — the gap is wide
enough that nobody is choosing on price alone.

### 2.4 Coaching Center — from ৳1,999/month + student usage

**One operational coaching centre. One location.** Multi-location is Institution
and is a different product, not a bigger number (§2.5).

**Limits:**

| | |
|---|---|
| Batches | **100** |
| Students | **no ceiling** — the roster sets the daily rate (§3.3). *Never* "unlimited" |
| Students per batch | **no limit** |
| Teachers | 2 included, then ৳100/seat/month |
| Subjects | **200** — an abuse ceiling, not a feature (§2.7) |
| Branches | 1 (the centre itself) |

**Adds over Pro:** staff management (create teacher accounts, assign batches,
grant permissions), centre-wide reporting.

**Price:** a ৳1,999/month floor plus marginal per-student bands (§3.1) plus
teacher seats — and that monthly figure is then divided by thirty and taken off
the balance a day at a time (§11.6). The floor is what a small centre pays, and
it is the software fee: past roughly 80 students the usage bands overtake it and
become the whole of the rate.

### 2.5 Institution — custom, from ৳4,999/month + student usage

**Institution is not "Center with bigger limits."** It is a multi-branch
organisation, and the thing being sold is HQ visibility across branches that
currently cannot be compared at all.

```
ABC Education  (HQ: Dhaka)
├── Dhaka        1,300 students
├── Chattogram     600
├── Cumilla        500
└── Sylhet         200
```

**What Institution provides that Center does not:**

- Multiple branches, each with its own roster, batches, teachers, and fees
- An HQ dashboard aggregating every branch
- Branch management — create, rename, deactivate
- Branch-level administrators, scoped to their own branch
- Branch comparison (collection rate, attendance, headcount, arrears)
- Organisation-wide student count and reporting
- Organisation-wide fee and revenue visibility
- **One balance and one head count for the whole organisation, never per branch**
  — §3.6, the most important design decision in this section

**Limits:**

| | |
|---|---|
| Batches | **100 per branch**, not 100 in total |
| Students | no ceiling; one organisation-wide head count sets one rate (§3.6) |
| Students per batch | no limit |
| Teachers | 2 included org-wide, then ৳100/seat/month |
| Subjects | 200 org-wide — abuse ceiling |
| Branches | **3 included**, then ~৳750/branch/month |

**Price:** *custom, from ৳4,999/month.* Quoted, not published as a fixed public
number. The quote depends on branch count, roster size, and staff size. The engine
computes a defensible starting figure — ৳4,999 floor, plus student bands, plus
teacher seats, plus extra branches — and the founder can quote above it. The
branch allowance and per-branch fee are named constants so a negotiated deal does
not require a code change to *describe*, only to honour.

**Do not price Institution as Center × branches.** Four branches is not four
centres: it is one customer, one balance, one pooled roster, and a reporting
surface that no single centre needs. Multiplying tells a 4-branch institution to
buy four accounts instead — and four accounts would each pay their own ৳4,999
floor and each start their bands again at ৳25, which is exactly the outcome the
single pooled count (§3.6) exists to prevent.

### 2.6 Comparison table

| | **Teacher Free** | **Pro trial** | **Teacher Pro** | **Coaching Center** | **Institution** |
|---|---|---|---|---|---|
| Price | ৳0 forever | ৳0, 14 days | ৳499/mo flat² | from ৳1,999/mo + usage² | from ৳4,999/mo + usage² |
| Is it a plan? | yes | **no — a state** | yes | yes | yes |
| Batches | 1 | 5 | 5 | 100 | 100 **per branch** |
| Students | 30 | 150 | 150 | **no ceiling** — sets the rate | no ceiling, one org-wide count |
| Students per batch | 30 | 30 | 30 | no limit | no limit |
| Teachers | 1 | 1 | **1, at any price** | 2 + ৳100/seat | 2 + ৳100/seat |
| Subjects | 1 | 5 | 5 | 200¹ | 200¹ |
| Branches | — | — | — | 1 | 3 + ~৳750/branch |
| Attendance | ✅ | ✅ | ✅ | ✅ | ✅ |
| Exams & marks | ✅ | ✅ | ✅ | ✅ | ✅ |
| Fee tracking | ✅ | ✅ | ✅ | ✅ | ✅ |
| Receipt number | ✅ | ✅ | ✅ | ✅ | ✅ |
| Tap-to-send SMS/WA/call | ✅ unmetered | ✅ | ✅ | ✅ | ✅ |
| Printed A4 receipt | ❌ | ✅ | ✅ | ✅ | ✅ |
| CSV / report export | ❌ | ✅ | ✅ | ✅ | ✅ |
| Guardian progress summary | ❌ | ✅ | ✅ | ✅ | ✅ |
| SMS credits | ❌ | ✅ 🚧 | ✅ 🚧 | ✅ 🚧 | ✅ 🚧 |
| Staff management | ❌ | ❌ | ❌ | ✅ | ✅ |
| Centre-wide reporting | ❌ | ❌ | ❌ | ✅ | ✅ |
| Branch management + HQ | ❌ | ❌ | ❌ | ❌ | ✅ |

¹ Technical ceiling, never advertised. See §2.7.

² Every paid figure is a *monthly* price, and no month is ever charged. It is
divided by thirty and taken off the balance one day at a time (§11.6). Nothing on
this table is a subscription that renews or lapses.

Every paid tier is a strict feature superset of the one below it. A test asserts
this, and it must keep passing: a tier that withholds something a cheaper tier
grants is a support conversation nobody can win.

### 2.7 Ceilings that are engineering, not marketing

Some numbers exist to stop a bug or a bored user filling a table, not to sell an
upgrade. They are set high enough that no honest customer meets them.

- **Subjects: 200** per centre or institution. Subjects are *shared across
  batches* — 100 batches taught from 20 subjects is completely ordinary — so
  subject count must never be tied to batch count. It was, in an earlier draft;
  it is not now.
- **Batches: 100** per centre, per branch for an institution.
- **Students per batch: no limit** for Center and Institution. A 200-seat exam
  batch is a real thing in this market. Free and Pro keep 30 because there the
  number is a real commercial cap.

**Never advertise these as plan features.** "Up to 200 subjects" on a pricing
page invites the question of what happens at 201 and implies a paid tier with
more, which does not exist. In the UI these produce a refusal that reads like a
mistake report, not a paywall: *"That is more subjects than a centre can have.
Check the list for duplicates."*

---

## 3. Money

**Read §11.6 first.** It states the money model in one sentence — *money in → taka in the
balance → each day takes its own cost off → when the balance cannot cover the next day,
saving stops until they top up* — and everything in §3 is what goes into that daily figure.
§3.1 and §3.2 compute the monthly price a customer is quoted; §11.6 divides it by thirty.

### 3.1 Marginal student pricing

Per-student rates are **marginal bands**, the same shape as income tax. Each
band's rate applies only to the students inside it.

| Students | Rate each |
|---|---|
| 1–100 | ৳25 |
| 101–300 | ৳18 |
| 301–600 | ৳12 |
| 601+ | ৳8 |

Marginal and not flat-per-tier, because with flat tiers a centre at 101 students
would pay **less** than one at 100 — 101 × ৳18 = ৳1,818 against 100 × ৳25 = ৳2,500 — a
pricing page that makes the founder look like they cannot count. Marginal bands make the
bill continuous and always rising. `plans.ts` has always implemented it correctly; the
2026-09-05 directive's §5 *wording* described flat brackets, and this table is the one that
is right.

**These rates are uncalibrated.** The structure is sound; the numbers are a
founder's judgement with no market survey behind them. The first twenty customers
all sit in the first two bands, so ৳12 and ৳8 are theoretical until year two.
Recorded as an open item in §11, not as a settled fact.

**Worked bills** (Center, no extra teacher seats), with the daily figure they become:

| Students | Monthly | Per day | Which part bites |
|---|---|---|---|
| 50 | ৳1,999 | ৳66.63 | floor |
| 79 | ৳1,999 | ৳66.63 | floor, just |
| 100 | ৳2,500 | ৳83.33 | bands |
| 150 | ৳3,400 | ৳113.33 | bands |
| 300 | ৳6,100 | ৳203.33 | bands |
| 600 | ৳9,700 | ৳323.33 | bands |
| 1,200 | ৳14,500 | ৳483.33 | bands |

### 3.2 What the floor buys

The floor is a minimum, not an add-on: the bill is
`max(floor, bandSum(students)) + teacherSeats + branchFees`.

**And the floor is the software fee.** There is no second product, no separate subscription
and no "software charge plus seats" — a question the owner asked directly, and this is the
answer. A centre of thirty students pays ৳1,999 a month for the software; a centre of three
hundred pays ৳6,100 and the software is inside it.

**A floor therefore already includes some students, and that number is derived,
never typed.** At ৳1,999 the first band covers 79 students (79 × ৳25 = ৳1,975;
the 80th tips it to ৳2,000). At Institution's ৳4,999 the floor covers 238.

This matters for what §3.4 shows: while the floor is biting, an extra student changes the
daily rate by nothing at all, so the rail says nothing rather than inventing a movement. The
derived figure keeps that honest and cannot drift, because it is computed from the same bands
the bill is.

### 3.3 There is no student ceiling on a per-student tier ⛔→✅

**Rewritten 2026-09-05. Purchased student capacity is retired** (§18). What stood here was
the central architectural decision of the previous revision — *the plan decides which
features exist, the capacity decides how many students have been paid for, and they are two
columns* — and it was the right decision for a model that sold seats. The daily balance
does not sell seats, so there is nothing for a second column to hold.

> **The plan decides which features and permissions exist.
> The roster decides what a day costs.**
> There is no third number.

| Tier | Student ceiling |
|---|---|
| Teacher Free | **30** — a plan cap, fixed, not purchasable |
| Teacher Pro | **150** — a plan cap, fixed, not purchasable |
| Center, Institution | **none** |

The teacher caps stay because they are what makes the teacher tiers a smaller product; they
are enforced at Layer 1 and nothing about them moves. What goes is the ceiling on the
per-student tiers, and with it `student_capacity`, `StudentCeiling`'s `capacity` arm,
`quoteSeats`, `capacityBands`, `nextSeatCostBdt` and the whole places-remaining vocabulary.

**"Unlimited students" is still retired, and this is not its return.** The old objection was
that a plan promising unlimited students promises an unlimited bill and enforces nothing.
Both halves are answered now rather than dodged: the bill is not unlimited because it is
paid a day at a time out of money the centre has already handed over, and what is enforced
is not a count but the balance — a centre with nothing left cannot save anything at all
(§11.7). A ceiling was a proxy for the fence. The fence is now direct.

**What this costs, stated plainly:** a bill that used to be bounded by a number the owner
had bought is now bounded by their own roster. Two hundred students pasted in by mistake is
two hundred students' worth of daily rate. The answer is not a ceiling — a ceiling with
nothing to buy past it is a refusal with no way through — but **§20.5's obligation: the cost
of growth is visible at the moment of growth, and days-left is on screen wherever the roster
changes.** Plus the human path: deactivate the mistake, ring the founder, and the days come
back as a grant with a reason (§11.8).

### 3.4 Adding one student: the cost is shown, never charged at the door ✅→⚠️

**Rewritten 2026-09-05.** The rule that mattered survives word for word:

> **The customer thinks about adding a student, never about managing seats.**

What is retired is the machinery that used to honour it. There is no refusal at the door,
no ৳18 marginal seat, no payment inside the dialog and no "automatically continue the
student creation process", because there is nothing left to buy. §9's contextual purchase
was the right answer to the wrong model, and the model changed underneath it.

What must **not** happen is unchanged, and is now impossible by construction:

> reach the limit → get refused → go to the plan page → work out how many seats
> → pay → come back to students → find the button again → add the student

What happens instead:

```
[+ Add Student] ──→ student form, as normal. Always.
```

**And the rail beside it says what the roster now costs.** Not a price to pay — a
consequence to see:

```
101 students → ৳87.27/day
357 days left · to 27 August 2027
```

That is the whole of §9's principle — *billing should happen exactly where the user
encounters the need* — carried over into a model where the need is information rather than
a transaction. §20.5 holds the interface obligation and §14 still forbids showing the band
table: this is the owner's own number, not our pricing engine.

**The floor is why the first eighty students are free of arithmetic.** ৳1,999 covers 79
students, so a centre of fifty adding one more sees no change in the daily rate at all, and
the rail says nothing rather than inventing a movement. `seatsCoveredByFloor()` derives the
79 rather than storing it, for the reason its own docblock gives.

### 3.5 Bulk import: no payment step, and the same all-or-nothing ✅→⚠️

**Rewritten 2026-09-05.** Centres load students in bulk — from Excel, from a paper register
typed up at night, up to about 500 at a time. Steps 4, 5 and 6 of the old order (price it,
show the total, take payment) are gone with purchased capacity. Everything else stands, and
the reason it stands has nothing to do with billing.

**Order of operations, and none of it may be reordered:**

1. **Parse and validate the whole paste.** Bad rows are shown to the owner.
2. **Subtract rows already on the roster** — matched on name + guardian phone — so an owner
   who pastes the same register twice creates nothing the second time.
3. **Show what the paste does to the daily rate**, before anything is created:
   `+180 students → ৳86.66/day becomes ৳197.30/day · 360 days left becomes 158`.
   A single number that large has to be seen before it is true, and the band breakdown is
   shown for the same reason it always was: an unexplained figure invites the suspicion it
   was invented.
4. **Create every validated student, or none of them.**

**All or nothing.** A partial import is the worst available outcome: the owner cannot tell
which half arrived, re-pasting is the obvious next move, and re-pasting is when duplicate
children appear in a roster whose head count sets the price.

**Worked example**, now in rate rather than in seats. 120 students on the roster, a paste of
180 new ones:

```
monthly(120) = 100×25 + 20×18            = ৳2,860  → ৳95.33/day
monthly(300) = 100×25 + 200×18           = ৳6,100  → ৳203.33/day
```

Which reads on screen as: *180 more students takes you from ৳95 to ৳203 a day. Your ৳15,600
balance goes from 163 days to 76 days — to 20 November 2026.* Then one button, and no money
moves.

**The refusal that remains** is the balance, not the count: an import is a write, so a
centre that cannot cover today cannot import at all (§4.4). And a centre that *can* cover
today may still paste itself dry tomorrow — which is what step 3 exists to prevent, and
§11.8's founder grant exists to repair.

### 3.6 Institution: one balance, one head count, never per branch ✅

**Amended 2026-09-05.** There is no capacity pool because there is no capacity — but the
decision this section made survives intact and now applies to two things instead of one:
**the head count that sets the daily rate, and the balance that pays it, both belong to the
organisation and never to a branch.**

What we must **not** build:

```
Dhaka       = its own balance, its own rate
Chattogram  = its own balance, its own rate
Cumilla     = its own balance, its own rate
```

Because branch populations move constantly — a batch opens in Chattogram, an SSC cohort
graduates out of Cumilla — and per-branch money turns every ordinary enrolment into an HQ
reallocation request, plus three separate dry dates for one organisation to keep track of.
It creates administrative work that exists only because of how we chose to count.

Instead there is **one organisation-wide figure**, with branches as its breakdown:

```
2,600 students · ৳1,038/day · ৳311,400 balance · 300 days, to 2 July 2027

  Dhaka       1,300
  Chattogram    600
  Cumilla       500
  Sylhet        200
```

Chattogram enrolling 100 more takes the organisation to 2,700 and the rate to ৳1,070/day
from that day — no purchase at HQ, no reallocation between branches, no conversation about
whose seats those were. **A branch manager cannot recharge and does not see the balance**
(§3.7); what they see when it runs dry is the read-only note pointing at HQ.

`coaching_center_id` is already the organisation in this schema — branches are rows in
`branches` — so one balance per organisation needs no new scoping and gets §12's existing
fences for free.

**And the head count on the screen has to be the pooled one, which took a migration to make
possible — and it is now the input to the price, not just to a ceiling.**
`20260811000053` made every `select` on `students` RESTRICTIVE by
branch, so a count taken through a pinned manager's own client is their building's —
correct for a roster, wrong beside anything organisation-wide. Five screens paired the two
and told a manager of Mirpur with 40 of the organisation's 300 students that 260
places were free. The fence was never fooled (`app.guard_student_capacity()` counts
past RLS under an advisory lock and raises `CD001`), so the cost was a promise the
database then broke — worst on a bulk paste, which §10 refuses whole. `public.center_student_count(uuid)`
(`20260811000076`) is the pooled half: a `security definer` wrapper over
`app.active_students`, which lives in a schema PostgREST does not serve. It asks
`app.is_staff_admin` or `app.can_manage_students` about the centre id it was handed
before it counts, and raises `42501` otherwise — `scripts/check-scoping.mjs` names a
definer function that trusts a centre id as the one hazard its parser cannot see. Every
organisation-wide student figure in the product reads through it, `public.settle_billing`
reads `app.active_students` directly because it runs as the definer already, and
`tests/pinned-manager.test.ts`
sweeps `src/app` so a new screen cannot pair an organisation-wide figure with a count of its
own rows. Where a branch figure and the pooled one share a screen — the dashboard's student
tile, the roster's heading — the pooled one says which it is (§9.1).

### 3.7 Institution: branch staff and the billing owner ✅→⚠️

**Amended 2026-09-05.** Branch staff press **+ Add Student** and should not have to know
that billing architecture exists. That now costs nothing to honour, because the door is
never locked: the form opens for everybody, always, and the organisation's rate rises that
day (§3.4).

What survives is the constraint that mattered: **a branch manager is not the billing owner.**
So the fork on *who is looking* is no longer about a refusal, it is about what a screen shows:

| | while the balance covers today | when it does not |
|---|---|---|
| **Branch manager** | student form, normally. **No balance, no rate, no days-left figure** — money is not theirs to see or to spend. | the read-only note, saying HQ needs to recharge |
| **HQ admin** | student form, plus the rate and days-left rail from §3.4 | the read-only note with the recharge screen behind it |

**The places request is retired** (§18). It existed so a branch manager could ask HQ to buy
capacity; there is no capacity to buy, and a manager who needs the organisation topped up is
making a phone call about money, which is what §11.8 says a phone call is for. Nothing
replaces it, and that is a screen, a table and a resolution workflow deleted rather than
rebuilt.

**The warnings change what they count, and keep their thresholds.** Places remaining becomes
**days remaining**, which is a better number in every way: it is exact, it moves for a reason
the owner can see, and it says when rather than how much.

| Days left | Behaviour |
|---|---|
| ≤ 14 | notice on the dashboard and on the billing screen |
| ≤ 7 | stronger notice, and the recharge screen leads with it |
| ≤ 3 | urgent — persistent banner, the founder's number on it |
| ≤ 1 | urgent, and the dry date is stated as a date |
| 0 | read-only (§4.4). The banner is the only thing that changed on the screen. |

Thresholds are constants, not literals sprinkled through screens, so they can be tuned
without hunting. Shown to HQ and to the owner; a branch manager gets the read-only note and
not the countdown, for the same reason they do not see the balance.

**Which branches are growing** is `branch_admissions_month` (20260811000072), drawn on
`/hq` under the boxed warning and only there — the ≤ 14-day row asks for a notice, and a box
naming buildings under a notice would make the two levels read the same. It is now a
*cost* question rather than a capacity one — where did the daily rate go — and it answers it
unchanged.

It counts **still-active students grouped by the month they were admitted**, not admissions
taken. A branch that admitted fifty in August and lost forty of them has not grown, and the
view that counted admissions would put it top of the list. Counting the active ones buys the
invariant that matters on this screen: every row added together is exactly the organisation's
active head count, which is the organisation-wide figure printed beside it, so the two can never disagree.
The cost is that the past is not fixed — a student admitted in March who leaves in October
takes their row out of March — which is right for "where did the places we are using now go"
and wrong for "how many families walked in in March", a question the roster answers.

The window is the last three months **from today**, not from the month picker above it: the
pool is a live count, and a historical intake under it would invite the subtraction. Head
office is a row, never a wildcard. Naming comes from the money table's own rows, so a branch
is called the same thing in both places. A failed read says so — "nothing is growing" and
"we could not tell you" are opposite advice, and the box is attached to a warning an owner is
acting on this week.

### 3.8 The payment model ✅

Money moves in person and by bKash. The founder records it. That is the model
until there are enough customers to justify a gateway, and the *record* has to be
good enough that a gateway can be dropped in later without changing anything that
reads it.

**Every payment must record:**

| Field | Why |
|---|---|
| who paid | the centre or institution |
| when | `paid_at`, and separately when we recorded it |
| amount | in taka, immutable |
| method + reference | bKash/cash/bank + the transaction id |
| **what it bought** | subscription period, student capacity, branches, or a mix |
| **seats added** | how many student places, if any |
| **rate applied** | which band(s) priced them, at what rate |
| coverage period | from and to, for a subscription payment |
| branch | where relevant — which branch asked |
| recorded by | which account entered it |
| status | recorded, and whether it has been voided by a counter-entry |

**Every field above is stored.** The last of them, the rate applied, is
`payment_intents.priced_lines` — the quote's own lines, one per band, frozen with the
amount they explain and checked against it, because it is the one field that cannot be
worked out afterwards: places are priced marginally from the ceiling the centre had at
the time, and settling the purchase raises that ceiling before anybody prints the
receipt.

**And the last row's second half is built too.** `20260811000074` dropped the
`check (amount_bdt > 0)` that migration 1 had carried — the constraint that made this
section's own promise undeliverable, while the table comment claimed it — and replaced
it with `<> 0`, the rule `fee_payments` has held from the start. A credit is money we
owe back, sitting on the row that says what we have been paid, so `sum(amount_bdt)` per
centre is net of credits and that is the honest answer to what a customer has actually
given us. Three constraints keep it from being anything else: a negative row carries **no
coverage window**, because `paid_through` is `max(covers_period_end)` in two independent
derivations and a -৳1 row dated to 2099 would buy permanent free access while looking
less like tampering than editing `status` by hand; it carries **no intent**, because an
intent means "this receipt settled that purchase" and a credit settles nothing, and the
printable would otherwise render as a sheet selling 180 places with a minus in front of
the total; and it **must carry a note**, required here and optional on every positive
row, because a credit is a decision somebody made and this table has no UPDATE path to
annotate it later. A credit also cannot exceed what the centre has paid. Nobody with a
browser can write one — INSERT was revoked from `authenticated` and `anon` in
`20260811000024`, so it is service_role only, which today means the founder panel behind
`requirePlatformAdmin()`. `payment_intents.amount_bdt` stays `> 0`: a quote for negative
money is not a thing this product sells.

**Payments are immutable.** No edit path, no delete path, from any browser
session. A mistake is corrected by a *negative counter-entry* that references the
original, never by changing history. This is already true of fee payments and
must be equally true of platform payments and capacity purchases.

**Two things a payment can buy, and they are separate line items:**

- **Coverage** — this month's subscription, with a from/to period.
- **Capacity** — N student places, priced from the bands, permanent (they do not
  expire with the month; you do not lose students because a month ended).

**Future automated billing must reuse this model unchanged.** A gateway callback
writes the same row, with the same fields, and sets `method` and `reference` from
the gateway instead of from a founder's typing. Nothing that reads a payment may
care which produced it. That is the whole compatibility requirement, and it is why
"what it bought" is a structured field rather than a free-text note.

### 3.9 Messaging costs, and why SMS credits are 🚧

Two channels, two economics, and the product must not confuse them.

**Tap-to-send is free and unmetered on every tier.** The app builds the message
and hands it to the owner's own phone through `sms:`, `wa.me`, or `tel:`. It
leaves their number, on their existing package, at their cost — which is already
paid. Nothing to meter, nothing to charge, and it works today.

**Automated SMS needs a BTRC-registered sender ID** obtained through a licensed
aggregator, which needs a business identity we do not yet have. So:
`sms_credit_balance` defaults to 0, every tier grants 0 per month, and no screen
can top it up. Every metered send therefore fails its credit check and disables
its own button. **That is correct behaviour, not a bug** — a teacher shown
"পাঠানো হয়েছে" while the parent heard nothing is the one failure this product
cannot survive.

`buySmsCredits` is `true` on the paid tiers as a statement of intent. It gates
nothing today because there is nothing to gate. The day an aggregator is live, the
success-detection pattern must be configured *before* the first paid send.

---

## 4. Entitlement

### 4.1 Six concepts, kept separate

The old model had one column doing four jobs. These are the six, and the point of
naming them is that each has exactly one home:

| Concept | Question it answers | Where it lives |
|---|---|---|
| **Plan** | which features and caps does this tier have? | `plans.ts` — code, not data |
| **Subscription** | which plan is this customer on, with what status and coverage? | the organisation row |
| **Trial** | is a temporary better plan in force, and until when? | the organisation row |
| **Entitlement** | what is *actually* allowed right now? | derived — §4.2 |
| **Capacity** | how many student places are paid for? | the organisation row + a grant ledger |
| **Payment** | what money arrived, and what did it buy? | the payment ledger |

**Entitlement is derived and never stored.** The moment it is stored it can
disagree with the things it was derived from, and a customer whose trial ended is
either still using Pro or has lost Free — both are worse than a recomputation.

### 4.2 The resolver ✅

One function, one place, consulted by the session and by nothing else:

```
effectiveEntitlement(org, now):

  1. access:
       status = suspended | cancelled    →  read-only
       dailyRate > 0 and balance < owed   →  read-only     (§11.7)
       otherwise                          →  full

  2. plan:
       trial_ends_at > now
         and trial_plan outranks plan   →  trial_plan
       otherwise                        →  plan

  3. student ceiling:
       plan cap is a number             →  { plan, max }
       per-student tier                 →  { none }
```

Step 1 gained its second line on 2026-09-05 and lost a longer one: a coverage date
plus a grace window used to sit there. The balance comparison is spelled out in
§11.7 and is a *comparison*, not a state — so a centre lapses on the right day with
no row written and no job run, exactly as a trial expires in §4.3.

The rank test in step 2 is why a trial can only ever raise what is allowed. That
still matters on the teacher tiers, where 30 and 150 are real ceilings and a stale
`trial_plan` must never take places away from a trialling teacher.
`app.admitted_ceiling` applies the same test in SQL (§4.5).

**Step 3's second arm used to be `{ capacity, org.student_capacity }`.** On a
per-student tier there is now no ceiling at all: the roster sets the daily rate
instead of running out (§3.3), so there is nothing for the trigger to admit against
and `student_capacity` is retired (§18). The arm stays in the type as `{ none }`
rather than being deleted, because a Center that returns "no ceiling" and a Center
whose ceiling could not be read must not collapse into the same answer.

Everything downstream — every feature gate, every cap check, every permission
helper — reads the *result*. None of them learns whether it was a trial, whether
the balance ran out, or which branch asked. That is what stops trial logic from
metastasising into forty call sites.

**Fail closed, in the established direction.** An unreadable organisation row
resolves to Teacher Free, the most restrictive tier — never to the loosest. An
unreadable *count* on a capped tier refuses the action rather than treating the
count as zero, because one failed count would not let one extra student past a cap,
it would let eighty.

**The rate is the one thing that fails closed by not being needed.** When
`charged_through` is today — the ordinary case, every day, for every paying centre —
`owed` is zero and step 1's second line is decided without the count running at all.
So a transient count failure cannot lock out a centre that has paid. Where the rate
genuinely is needed and cannot be read, the answer is read-only: that is the
established direction, and it is one day's inconvenience against an unbounded free
ride (§11.7).

### 4.3 Trial lifecycle ✅

| Event | What happens |
|---|---|
| Teacher signs up | `trial_plan = teacher_plus`, `trial_ends_at = now + 14 days` |
| Days 1–14 | resolver returns Teacher Pro. Every Pro feature works |
| Day 10 | in-app notice: 4 days left, what will change, how to keep it |
| Day 14 | resolver stops returning the trial plan. **No job has to run** |
| After | Teacher Free entitlements. All data intact (§4.5) |
| They pay | founder sets `plan = teacher_plus`; trial fields cleared |

Every row of that table is built. `bootstrap_center` writes the two columns
(`20260811000039`), `effectiveEntitlement` reads them on every session, and the
notice is a banner in the app shell fed by `trialStanding` — running for the whole
fortnight rather than only from day 10, because a trial nobody knew they had sells
nothing, and for a week after expiry, because "printed receipts stopped working" is
otherwise indistinguishable from a bug. The last row is `setCenterPlan` on the
founder panel, which clears both fields when it sets a paid tier — and pointedly does
not when it sets the free one, so a founder correcting a status typo on a three-day-old
signup does not take the fortnight off them. "Every Pro feature works" includes its 150
student places, which took `app.admitted_ceiling` to be true at the trigger and not only
on the screen (§4.5).

**The notice asks the row, not the entitlement.** `Entitlement` carries no trial
flag on purpose (§4.2), so the banner reads `trial_plan` and `trial_ends_at` itself —
and gets the *running* answer from the same helper the resolver uses, so a banner can
never promise a fortnight of Pro that the feature gates are refusing. A `trial_plan`
no better than the paid tier is silent in both directions: a stale row left behind
after a payment must not read as a demotion, or as an ended trial to a customer who
just bought the tier.

**Expiry is a comparison, not a cron job.** `trial_ends_at > now` is evaluated on
every session read, so a trial ends on time even if no scheduled task ever runs,
the app was closed for a week, or a job silently failed. A background job that
"expires trials" is a second source of truth and will eventually disagree with the
clock. Anything a job does here is cosmetic — sending the day-10 notice, tidying
stale rows — and never load-bearing.

**A centre trial is a different mechanism.** `status = 'trial'` is the founder-run
30-day sales trial from §9: hand-loaded data, weekly check-ins, priced in the room
on day 28. It sets no entitlement of its own — a trialling centre is on the Center
plan with a status that says nobody has paid yet. Do not merge the two clocks;
they answer different questions, for different customers, on different timescales.

### 4.4 Access is the balance, and the four statuses are what remains ✅

**Rewritten 2026-09-05.** Access used to be a date comparison against a coverage period,
with a grace window behind it. It is now the balance comparison in §11.7, and the change
runs in one direction: **coverage stops gating anything, and nothing else about read-only
moves.**

| Status | What it still does | Reached how |
|---|---|---|
| `trial` | nothing to access — descriptive | signup, or the founder starting a sales trial |
| `active` | nothing to access — descriptive | the ordinary state of a paying centre |
| `suspended` | **read-only, by hand** | a founder decision |
| `cancelled` | **read-only, by hand** | the customer left |

Two of the four are now descriptive, and that is the honest reading rather than a
deletion (§38): a paying centre is `active` and a lapsed one is still `active` with a dry
balance, because *lapsed* is no longer a state anybody stores. `suspended` and `cancelled`
remain real and remain the two switches a human throws — a centre being cut off for a
reason that is not money still has to be possible.

**A sales trial is no longer a status either — it is granted days.** The founder advances
`charged_through` thirty days with a written reason, and the trial ends by itself when the
balance cannot carry the next day. One mechanism instead of two, and the trial burns like
everything else so nothing has to remember to end it.

**Read-only means read-only, not locked out.** Attendance history, marks, the fee board and
the roster all stay visible. What stops is *writing*: no new students, no attendance, no
payments recorded, no messages sent. Plus a banner that says plainly what happened and how
to fix it, with the founder's number on it — and, when a claim is in flight, that the money
has been received and is being checked (§11.8).

Locking a lapsed customer out entirely is the wrong lever. Their data is their term's
attendance and their outstanding fee book; taking it hostage turns a late-payment
conversation into an angry one, and they will not come back. Read-only is uncomfortable
enough — they cannot run the centre on it — without being a threat. Under a prepaid
balance this state is **routine rather than exceptional**, which is why the read-only sweep
across every write screen matters more now than when it started, not less.

**What `GRACE_DAYS` becomes: nothing.** Withdrawn on the owner's instruction. A charge
allowed to sit unpaid is credit, and this is a prepaid product. `paid_through` and the
trigger that maintains it (`20260811000059`) stay as *history* — a receipt still records
what it was for — but they stop being read by the resolver, and a recharge writes no
coverage period at all (§11.9). The two derivations must never both be live: the commit
that lands the balance derivation is the commit that removes the date one, with its tests.
**That commit landed 2026-09-17** — `coverageLapsed` and `GRACE_DAYS` are gone from
`entitlement.ts`, with the nine tests that measured them replaced by the balance's own,
and `paid_through` is still selected and still written by the old buy flow until step 25
replaces it, and read by nothing that decides access.

**No dunning, no auto-charge, no card on file.** There is nothing to dun for: nothing is
ever owed to us that has not already been paid. What the founder has instead is the
recharge conversation, and under fifty customers that is a feature rather than a cost —
it is when churn gets caught, and a customer who has not topped up in six weeks is
visible without a report being written. What must be automatic is only the *consequence*
of a dry balance, because that is the part a founder cannot be trusted to do consistently
to a customer they like.

### 4.5 Downgrade and expiry — nothing is ever deleted ✅

The rule, in one line: **limits apply to new actions, never retroactively to
existing records.**

A teacher who created 90 students and 4 batches during a Pro trial, and then
dropped to Free:

| | | |
|---|---|---|
| Their 90 students | **all still there**, all still visible, all still editable | `students_guard_capacity` fires `before insert or update of status, coaching_center_id` only, so a rename or a phone correction never meets the ceiling |
| Their 4 batches | **all still there**, attendance and marks intact | nothing deactivates a batch when a plan moves |
| Adding student 91 | refused | `app.guard_student_capacity` (CD001), with `limitRefusal` saying it in a sentence first |
| Adding a 5th batch | refused | `batchRoomRefusal`, per branch only where branches were bought (§8.4) |
| Printing a receipt | refused — Pro feature | `has(plan, 'printedReceipts')` on the receipt sheet and the register |
| Exporting | refused — Pro feature | `has(plan, 'exportReports')` on the screen **and** inside `/api/export`, because a bookmarked URL is not a screen |
| Deleting a student to get under the cap | allowed, but never required | a status other than `active` frees the place and keeps the attendance and the marks |

A downgrade is also not allowed to be silent. The account lands on a screen that
says what is now read-only and what it costs to have it back, because a customer
who discovers a locked export at 9pm the night before a parents' meeting will not
read it as a billing state. They will read it as the software breaking.

Which is why every one of those refusals is a screen and not a 403: each names the
plan the reader is on, the plan the feature needs, and links to `/settings/billing`,
where the ladder is. The two moments the tier actually moves say so without being
asked — the read-only banner when the balance runs out
(§4.4, §11.7) and the trial banner for the fortnight and the week after it (§4.3).

**A trial grants the trial tier's places, and the database agrees.** This was the one
place the two halves of the product contradicted each other. `app.student_ceiling`
resolves from the paid `plan` column, so a signup on their free fortnight of Pro was
shown 150 places by the app and refused at 31 by the trigger — with a hint telling
them to buy the places they had just been given. 20260811000060 splits the question
in two: `app.student_ceiling` says what the plan itself allows, and
`app.admitted_ceiling` says what may be admitted right now, which is what the trigger
reads. The rank test is native enum comparison (`trial_plan > plan`, the same guard
`effectiveEntitlement` applies), so a stale trial cannot lower a ceiling and a
teacher still carrying a signup trial is never refused at 31.

**Both functions now only have teacher tiers to answer for.** They used to read
`student_capacity` and take the greater of it and the plan's own included figure,
which is what made a Center's ceiling a purchase. A per-student tier has no ceiling
at all (§3.3), so on Center and Institution both functions say "no limit" and the
trigger admits — the fence there is the daily rate, not a refusal. What must not
happen is the removal being done by loosening the trigger: the ceiling arm stays, and
it is the *tier* that stops having one (§18's landing order).


---

## 5. Identity and authentication

### 5.1 Two things that are not the same thing ✅

A **teacher record** is a row in the register: a name, the subjects they teach,
the batches they hold, the marks they enter. A **login account** is a credential
that opens the app.

These are separate on purpose, and the separation is not new — `teachers.user_id`
has been nullable since the first migration, with the comment *"A teacher row can
exist before that person ever signs in."* What was missing was the second half: a
way to give that person an account **afterwards**, without a phone number. That is
`giveTeacherLogin`, on the teacher list.

| | |
|---|---|
| Manager adds a teacher to the register | no account, no phone needed ✅ |
| Manager later opens that teacher and taps **Create Login Account** | ✅ built |
| Teacher's phone number | **optional**, always |
| Teacher OTP | **never required** — see §5.4 |

With a number, the action looks for an account that already has it and offers to
link that person rather than creating a second one — never on the first submit,
because one mistyped digit would hand a stranger a teacher account inside this
centre. With the box empty it generates a username by §5.2 and says it back once,
which is the only time it is shown. Either way the membership row that follows is
filed under the branch the teacher already works at, and only if they are switched
on: an inactive teacher has no membership by design, and writing one here would let
somebody back in through a door an owner has just been given a button for.

The `user_id` arriving on a row that had none is what §10's log calls
`loginCreated`, so this is the action that arm was written for.

The reason the manager can do this at all is that the organisation vouches for
the person. A centre creating an account for its own physics teacher is not a
stranger claiming an identity; it is an employer issuing one. That is why the
verification burden sits on the owner's signup and not on the teacher's.

### 5.2 Usernames must be memorable ✅

A teacher account needs an identifier. It cannot be the phone number, because the
phone number is optional. So the server generates one from their name:

```
রহিম উদ্দিন      -> rahim
a second রহিম    -> rahim01
a third          -> rahim02
```

Rules, all of them load-bearing:

- **Generated on the server.** A username the browser proposes is a username an
  attacker chose.
- **Transliterated from the name, ASCII, lowercase.** `rahim`, not `usr_8f92a1c`.
  A username is read aloud across a staffroom and typed by somebody who is not
  looking at the screen. A random string fails at exactly that moment.
- **Numeric suffix only on collision**, and only as many digits as needed.
- **Unique at the database level**, not merely checked before insert. A unique
  index is the only thing that survives two managers creating `rahim` in the same
  second; a `SELECT` that found nothing is not a reservation.
- **Never reused.** A deactivated teacher keeps their username, so an old
  attendance record never resolves to a different person.

Where a Bangla name transliterates to nothing usable — punctuation, an initial, a
name typed in a script the map does not cover — the fallback is the centre's own
short code plus a number, never a random hex string.

### 5.3 Signing in with any of the three ✅

One field, labelled **"Email, mobile number or username"**. The server decides which
it received: an `@` makes it an email, a shape that normalises as a BD mobile makes
it a staff login keyed by that number, and anything else is a username. No radio
button, no second tab, no "are you a teacher?" question — because the person signing
in does not think of themselves as an auth strategy.

Emails are the owner's identifier since §5.4's rewrite (2026-09-13): self-serve
signup creates a real, verified Gmail-style address. The number and the username
remain the identifiers of accounts a *centre* mints for its staff — `giveTeacherLogin`
and `appointManager` still key those accounts on a phone number when there is one and
on a username when there is not, because §5.1's part-timer must never be forced to
hand over a number or an email to get a login. Both continue to work through the
reserved-domain trick: the synthetic addresses `8801712345678@phone.coachdesk.invalid`
and `rahim@user.coachdesk.invalid` are unroutable by DNS, so nothing addressed to
them can ever reach a real inbox, and no real email can collide with them. Existing
passwords all keep working; nobody was re-signed-up.

Three identifiers is the ceiling, not the start of a list. Nothing else may be added
to this field — every one of them has to be normalised, logged, explained on a
login screen, and refused with one shared sentence that does not say which half was
wrong, because that difference is how you enumerate who has an account.

### 5.4 Owner signup verifies an email address ✅

**Rewritten 2026-09-13.** The phone OTP gate below was built, tested, and then
retired unread — it never switched on, because switching it on needed a BTRC
sender ID, which needed an aggregator account, which needed an NID, and none of
that was ever going to arrive in time to matter. The owner's decision replaces it
outright: **signup is by email, verified by email**, through Supabase's own
confirmation flow. A Gmail address costs nothing to verify. A mobile number cost
a taka a message and an external approval to even try.

The hole the old gate existed to close is closed by verification itself, in the
general form: nobody finishes signup without reading the inbox, so nobody can
register an identifier they do not own — not to impersonate its real holder, and
not to squat it. And signup no longer offers a phone number at all, so there is
no number field to squat.

**The flow, and it is the same shape the phone gate had:**

| | |
|---|---|
| Step 1 | name, email, password. `signUp` creates the account **unconfirmed** and Supabase sends the confirmation email |
| Step 2 | the email carries a **six-digit code** (and a link to `/auth/confirm` as its fallback). The code is typed into the same form — `verifyOtp` checks it and returns the session |
| One call | the code is checked and the session established inside one Server Action; `awaitingCode` in the returned state only decides which inputs are drawn, exactly as before — there is no verified flag for a browser to carry between requests |
| If confirmation is off | `signUp` returns the session directly and the second step never appears |
| Already registered, unconfirmed | the resend path: `resend({ type: 'signup' })` re-arms the code rather than telling somebody who cannot sign in to sign in |
| Wrong code | Supabase counts the attempts; the screen says the code does not match, never which half of anything was wrong |

The name and the locale travel in `signUp`'s metadata, so the `on_auth_user_created`
trigger writes the profile row before the email is even confirmed — the same
trigger, unchanged, that fired for admin-created accounts.

**Teachers are exempt, deliberately and permanently, and now by construction.**
Staff accounts are minted by the centre through the admin API, which creates them
confirmed and sends nothing: no email arrives at a teacher who may not have one,
no code stands between a manager and a login for their physics teacher. This is
the old §5.4 rule, held by the shape of the code rather than by a gate with an
exemption in it.

**Delivery is Gmail, on a dedicated address — configured 2026-09-14, on the owner's
instruction that the mail carry a code and nothing else.** `coachdeskbd@gmail.com` is the
sender, as custom SMTP in the Supabase dashboard with an app password that lives in the
dashboard and nowhere else. The **Confirm Signup template is code-only**: a bilingual,
branded HTML letter whose one payload is `{{ .Token }}` — no `{{ .ConfirmationURL }}`
anywhere, because a link and a code in one mail is two doors where one was asked for,
and the link is the door that breaks on a phone. The copy of record is
`docs/email-confirm-signup.html`, pasted into the dashboard; what is in the dashboard is
what that file says.

**The code's length is the platform's, not the product's.** Supabase generates the code
and has been observed generating *eight* digits where six were assumed — so no screen
names a count and the input accepts up to ten (`src/lib/auth/email-otp.ts`). A form that
truncated the code the mail actually carried would be a signup nobody could finish, and
it would read as "wrong code" every time. The default sender's ~2/hour limit is gone
with custom SMTP; a resend is still refused inside GoTrue's own sixty-second window,
which is the number the button counts down. `/auth/confirm` stays in the app as a
defensive fallback only — if a platform-generated link ever appears again it lands
somewhere that works, rather than a dead tab.

**What was retired with the phone gate** (migration `20260811000079`):
`app.phone_verifications` and its two functions, `src/lib/auth/otp.ts`,
`src/lib/auth/otp-gate.ts`, and the `previewPhone` action. `profiles.phone`
survives — it is the staff record's contact number, not a login identifier — and
`bd/phone.ts` survives with it, because `giveTeacherLogin` and `appointManager`
still mint number-keyed staff accounts (§5.1, §5.3).

### 5.5 A login the centre minted cannot found a centre ✅

§5.1 lets a manager issue a credential out of nothing but a teacher's name, and
§5.2 makes it memorable. Both are right. What follows from them is that
`rahim@user.coachdesk.invalid` has a password the manager chose and can still read
off the roster — so that credential belongs to the centre, not to the person
holding it.

Nothing about that was a problem until you follow where such a login lands when
its centre switches it off. Switching a teacher off **deletes** their
`center_members` row (§5.1: an inactive teacher has no membership by design), so a
teacher off for the summer holds a working account with zero memberships, and
`homePathForRole(null)` sends exactly that session to `/onboarding` — the
create-a-coaching-centre form. None of it reached the old centre; the membership
was gone and RLS refused. What it reached was `bootstrap_center`, which asked only
whether the claimant already **owns** a centre. So every staff login a manager
minted was also a self-serve centre signup: past §5.4's verification, because that
gate is on signup and this account was created by an admin call, with the 14-day
Teacher Pro trial of §4.3 stamped on it, on a password somebody else knows.

**The credential is refused, not the person.** A teacher who wants their own
batches signs up with their own email and gets the form exactly as before — §2
keeps Teacher Free open to anybody, and §5.1 has always held a teacher *record*
apart from a *login account*. What cannot happen is founding a centre on a key a
third party holds.

Three layers ask, and only the third is a fence. The screen does not draw the
form; `createCenter` re-checks so the answer arrives as a sentence under the field
rather than a Postgres error string; and `20260811000077_center_issued_login.sql`
refuses inside the function. That last one is the one that counts, because
`bootstrap_center` is `grant execute … to authenticated` — a browser holding the
anon key can POST `/rest/v1/rpc/bootstrap_center` with its own JWT, so a check in
TypeScript alone would be advice (§24).

**Both signals, either one enough.** The login address is authoritative, being
what actually signs the person in; `profiles.username` is the readable copy
migration 38's trigger writes and `app.guard_profile_identity` keeps a browser out
of. They are read with `or`, so a disagreement between them refuses rather than
admits.

**The guard was widened to both synthetic domains on 2026-09-13, and the reason is
§5.4's rewrite.** It used to refuse only the username domain, because phone-keyed
logins were then also self-serve signups — an owner — and refusing `%.invalid`
outright would have refused every owner on the platform. Since signup is by email,
the *only* accounts left on either reserved domain are centre-minted staff logins,
which is exactly the population the fence exists for. The guard now refuses the
shared `%.coachdesk.invalid` suffix — both domains at once, no real email can end
in `.invalid` (RFC 2606), and a minted login can no longer found a centre whichever
of the two shapes it was keyed on.

**And that screen now has a way out, which is the part nothing else in the product
offered.** `/login` redirects a live session to `homePathFor`, which for an account
with no membership is `/onboarding` — so before this, a signed-in reader who did
not want to found a coaching centre could not reach a sign-out button anywhere.
Not a dead end in a corner: it is where every switched-off teacher lands. The
button is on both arms of the screen, because one arm without it strands whichever
reader gets that arm.

The words are read in the reader's own language, unlike the rest of `(auth)`: a
signup has expressed no preference yet and gets Bangla, but this person has a
profile and a locale in it. What they are told is the fact they are actually
missing — no centre has this login switched on, nothing they recorded is lost, ask
whoever runs it to switch them back on — and never "try another centre", which is
the sentence §5.1's teacher-removal thread deliberately stopped telling.

---

## 6. Roles and permissions

### 6.1 The ladder as it exists ✅

Five roles in one enum, ranked: `owner` 40, `manager` 30, `teacher` 20,
`guardian` 10, `student` 0. Guardian and student have no screens and no panel —
they exist so the RLS policies are written for them, which means the door is
bolted rather than merely shut.

On the teacher tiers this ladder is decoration: there is one person, and
`hasStaff()` returns false, which closes every staff-shaped screen. That is not a
missing feature. A solo plan showing a staff list would be showing the reader a
list containing themselves.

### 6.2 The roles the spec adds ⚠️

Accountant, Receptionist, Coordinator, Branch Admin, Institution HQ Admin. Not all
of these need to appear in the UI now — but the permission system has to be able
to express them without a migration each time, which the current one cannot: it
hard-codes five booleans in `teacher_permissions` and hangs everything off the
role name.

The direction is **capability-based, not role-based**. A role becomes a named
bundle of capabilities rather than a branch in an `if`. Two consequences worth
being explicit about:

1. **Branch Admin and HQ Admin do not need new enum values.** A `manager` with a
   `branch_id` is a branch admin; a `manager` with no `branch_id` is centre-wide.
   The scoping column already exists on `center_members` and is already tenant-safe
   through a composite foreign key. This keeps every existing Center account
   working unchanged.
2. **Accountant and Receptionist do.** They are not teachers, they hold no batches,
   and putting them in `teachers` to borrow its permission row would corrupt the
   teacher seat count that Center billing depends on. They belong with employees
   (§9.4).

**What exists now.** `center_members.capabilities` is a `text[]` — six words, no
enum, no table — and the vocabulary lives in `src/lib/staff/capabilities.ts`
rather than in the schema, so a seventh narrowing costs a constant and not a
migration. It is a **veto and not a grant**: null is the whole of the role, which
is why every account that predates the column kept working. `app.member_allows`
enforces it as a restrictive policy per table, and because a person often holds
two memberships at one centre the app-side answer is the *intersection* of them —
a teacher row cannot lift a narrowing the manager row imposes. Five bundles
(Deputy, Accountant, Coordinator, Receptionist, Observer) are offered as tick-box
shortcuts and none of them is stored: the boxes are the truth and the name is a
summary, because the moment an owner unticks one box the name would be a lie.
Only an owner may write the column.

**What is left.** The five booleans in `teacher_permissions` are still booleans,
so the sentence above about hard-coding remains true of teachers. Folding them in
means four SQL resolvers and around seventy policy references, and it buys
expressiveness the manager side already has — so it waits until something needs
it.

### 6.3 Attendance belongs to teachers ✅

**The teacher is the normal person who takes attendance.** They are in the room.
They know who is absent. A manager sitting in an office does not, and a product
that presents the manager as the attendance-taker is describing a workflow where
somebody copies a paper sheet into a computer an hour later — which is the exact
job this app is supposed to delete.

Teachers take attendance for the batches they are assigned to, enforced in the
database by `app.teaches_batch()`.

The fix was presentation and accounting, not removal:

| | |
|---|---|
| Teacher opens attendance for their batch | the normal path, unchanged |
| Manager opens attendance | sees a **review** view: what was taken, what is missing, who has not submitted |
| Manager edits a record | allowed — **and recorded as an override**, with who and when |
| Manager takes attendance from scratch | allowed, because the teacher is ill and the class still happened |

**The manager's access is not removed.** An override that is impossible is an
override a centre works around by sharing the teacher's password, and then nobody
knows who marked what. Better that it exists, is logged, and is visibly not the
default. The word for it in the UI is *correction*, not *attendance*.

How the four rows are actually decided, since none of them may read a rank —
§6.2 forbids that, and a manager who also teaches is a normal teacher on their own
batch:

- `attendance_records.called_by` and `called_at` hold the first writer and are
  frozen for ever; `marked_by` and `marked_at` move to the latest one. So
  `marked_by <> called_by` **is** an override, and the trigger that fires on it
  writes the audit line — inside the transaction that made the change.
- `registerAct({taken, ownBatch})` decides the word for the screen from the same
  two facts: a register nobody has filed yet is attendance whoever opens it, and
  only writing over somebody else's is a correction. That is row four working by
  construction rather than by a special case.
- `markHistory()` reads a saved mark back the same way, so a corrected row says
  who changed it — the teacher who took it, or somebody else — with the time,
  beside the child's name. It is deliberately softer than the trigger on a row
  whose `called_by` predates the column: nobody is named an overrider on evidence
  the row does not hold.

RLS still gives a manager and a teacher the same write power, which is the
decision above rather than a gap. What a manager may not do is do it quietly.

### 6.4 Money belongs to owners and managers ✅

Fee collection, invoices, discounts, expenses, payroll and every report that
totals taka are owner and manager work. A teacher gets none of it unless somebody
explicitly ticks `can_view_fees`, which is false by default and stays that way.

This is already true and already enforced server-side. It is written down so it
does not get "helpfully" widened later: the teacher who can see what every family
owes is the teacher who mentions it in front of a class.

### 6.5 What a teacher may see ✅

A teacher sees the students enrolled in the batches they are assigned to, and no
others. Not the centre's roster, not another teacher's marks, not a guardian phone
number belonging to a child they do not teach. Enforced in RLS, not in a query
filter, and covered by the live RLS suite.

---

## 7. The register: students, batches, scheduling, guardians

### 7.1 Student lifecycle ✅

All six exist: `active`, `suspended` (temporarily barred, still enrolled, still
owing), `inactive`, `transferred` (moved to another branch of the same institution),
`graduated`, `dropped`. `src/lib/students/status.ts` is the one list, and it carries a
compile guard — a status added to the enum without a label there fails `tsc` rather
than rendering as a raw string. The edit form offers all six, `updateStudent`
validates against the same list, and both dictionaries name them in plain words
(`suspended` reads "Barred for now", not the database word).

**Only `active` students are chargeable.** This is the sentence that makes per-student
pricing survivable: a centre that has taught for three years and accumulated eight hundred
former students is not billed for eight hundred. It is billed for the two hundred
sitting in rooms this month. A student who leaves stops costing anything the next day;
a student who returns starts costing again the day they are switched back on. **Neither
is ever refused** — on a per-student tier there is no ceiling to be full (§3.3), so a
reactivation is a rate change and not a transaction. On the two teacher tiers, where 30
and 150 are real ceilings, a reactivation past the ceiling is still refused, and the way
through is the tier above rather than a purchase at the door.

### 7.2 Branch transfer must not be a delete ✅

Moving a student between branches changes `branch_id` on the existing row. It does
not create a second student.

The temptation is to copy-and-delete, and it is wrong for a reason that shows up
six months later: the attendance, the marks, the invoices and the payments all
point at the old id. A recreated student has no history, and their family's payment
record — the thing a fee dispute is settled with — silently becomes somebody
else's. Worse, the org's chargeable-student count double-counts them for a period.

So: one row, `branch_id` updated, and a **transfer history record** saying which
branch, which direction, when, and who did it. The history is auditable because
the first question after a transfer goes wrong is always *who moved this child*.

Built that way. `updateStudent` writes `branch_id` on the one row and is the only
place a student moves between buildings; 20260811000042's trigger writes the history
itself, so a move recorded nowhere is not something the app can produce — there is no
save path that skips it. The student's own screen reads the history back behind the
same permission that reveals the rest of their file.

### 7.3 Scheduling — audit says it partly exists ✅⚠️

`batch_schedules` already holds a recurring weekly timetable: batch, day of week
(0 = Sunday, because the BD week runs Saturday to Thursday), start time, end time,
unique per batch-day-time, with a check that the end is after the start.

That is real and it works. What is **not** there, and is documented as future work
rather than built now:

| | |
|---|---|
| Rooms | ❌ no room entity, so no room double-booking check |
| Teacher clash detection | ✅ one teacher cannot be in two rooms at four o'clock |
| One-off changes | ❌ no per-date override, no cancellation, no holiday calendar |
| Term dates | ❌ a schedule is open-ended |

Clash detection was the one worth doing first, and it was cheap: the data to detect
it was already in the table. It is built, and where it is built is the whole of the
decision.

A batch's routine is written across two tables in three separate transactions —
`batches`, then a delete of the old day rows, then the new ones — because supabase-js
cannot wrap them in one. So any check that reads `batches` reads a half-written
routine: on create the batch exists before its days do, and on edit the new teacher is
in place while the old days are still there. Checking at either of those moments
refuses saves that are perfectly legal two statements later.

The day rows are written **last** in both paths. That is the one moment the picture is
whole, so `batch_schedules` is where the trigger fires and nowhere else
(`20260811000071`, SQLSTATE `CD002`). Every clash between two batches that name their
days is caught there, by a rule a race cannot get past, with no false refusal anywhere.

The one case the trigger cannot see is a batch that names no days, because "no day
rows" means "meets every day" and such a batch writes no row to fire on. That case
belongs to the form (`src/lib/settings/clash.ts`), which is also the only place that
can name the batch, the day and the hour in the reader's own language instead of
raising. Both halves are asserted against the same cases —
`tests/clash.test.ts` for the sentence, thirty assertions in `scripts/test-rls.mjs`
for the refusal.

Overlap is half-open (`start < other.end and other.start < end`), so a class that
begins as another ends is legal. Back-to-back batches are how a coaching centre
actually runs; a rule that refused them would be worked around within a week and would
then be protecting nothing. A switched-off batch holds no hours, and reopening one is
checked when its week is written back.

### 7.4 Admission and enrolment ✅

A student is created and enrolled in one step, and the batch carries the subject —
choosing a subject separately is how a student ends up in the maths batch under
physics and then missing from the marks sheet. Bulk import follows the same rule.

There is no separate admissions pipeline (enquiry → follow-up → admitted) and none
is planned for now. A coaching centre's admission is a conversation at a desk
followed by a name in a register.

### 7.5 Guardians ✅

One guardian row per student is created on import, marked primary, carrying the
number the register was keeping. A second guardian is added by hand by somebody who
knows which parent actually answers. Result dispatch prefers the primary guardian
and falls back to `students.guardian_phone`, so a missing guardian row degrades
rather than breaks.

The per-parent SMS opt-out lives on the guardian row. That is why the row matters
even though the fallback exists.

### 7.6 Minors' data — the standing rule ✅

Student records stay minimal. We hold a name, a guardian's number, batches, marks
and money. We do not hold addresses, photographs, birth dates, NIDs or anything
else a centre might volunteer, because every field is a field that can leak and
none of those are needed to collect a fee or tell a parent about an exam.

---

## 8. Institution: real branches

### 8.1 What a branch is ✅

An Institution is one organisation with several physical locations under one owner,
one balance, and one head count that prices all of them together (§3.6). A branch is
not a tag on a student and not a dropdown that filters a list. It is the scope that
decides what a signed-in person can read at all.

**The groundwork is genuinely in place**, and it is better than it looks: a
`branches` table with a unique `(id, coaching_center_id)` key, and `branch_id` on
five tables — `center_members`, `teachers`, `batches`, `students`, `notices` —
each wired through a **composite** foreign key
`(branch_id, coaching_center_id) → branches (id, coaching_center_id)`. That
composite is the part that matters: it makes it structurally impossible to attach
one centre's row to another centre's branch, which a plain `branch_id` FK would
happily allow.

Five more tables carry it now — `employees`, `expenses`, and the three money
snapshots `fee_invoices`, `fee_payments`, `salary_payments`, which record the branch
a figure belongs to at the moment it is written rather than inferring it later from a
student who may since have transferred.

**And the database reads it.** One function decides, `app.branch_ok(center, branch)`:
a member with no branch on their membership reaches every branch, a pinned member
reaches only theirs and never an unfiled row, and a non-member is left to the
permissive policies to refuse. HQ therefore wins over a pin — a person with two
memberships in the same organisation, one pinned and one not, is HQ, because the
function asks whether *any* of their memberships reaches the row. It is
`security definer` so a restrictive policy can call it, and it returns one boolean
about the caller's own membership, which they could read from their own row anyway.

What is left is not in the database. It is the drill-down: a branch name opens that
branch's record rather than that branch's workspace, because switching the scope of
every branch-level screen needs `app.branch_ok` to read a *chosen* branch and not
just a pinned one. §8.3 carries that as the open item, with the reason a `branch_id`
in a query string cannot be it.

### 8.2 What has to become branch-scoped ✅

Students, batches, teachers, employees, attendance, exams, marks, fee invoices,
fee payments, expenses, payroll, reports, dashboards, and permissions. The rule:

> A branch-scoped member reads and writes their branch. An HQ member reads and
> writes all of them. There is no third answer, and the check is in the database.

Not in a query filter. A branch-scoped `.eq('branch_id', …)` in application code is
one forgotten call site away from a cross-branch leak, and the call site that
forgets will be a report — the screen where the leak is largest and least visible.

**Cross-branch leakage is the failure mode to test for explicitly**, from the
direction of a hostile client: a branch manager posting another branch's id, asking
for another branch's student, another branch's payment total, another branch's
payroll. The RLS suite gets a case per table, not one case for the idea.

**This is built.** `20260811000053_branch_scoping.sql` adds **26 policies named
`<table>_branch_scope`**, one per table above: `branches`, `center_members`,
`teachers`, `teacher_permissions`, `teacher_subjects`, `employees`, `batches`,
`batch_schedules`, `students`, `guardians`, `enrollments`, `student_transfers`,
`attendance_sessions`, `attendance_records`, `absence_notices`, `exams`,
`exam_results`, `result_notices`, `progress_updates`, `fee_invoices`,
`fee_payments`, `fee_reminders`, `salary_terms`, `salary_payments`, `expenses`,
`notices`.

Every one of them is **RESTRICTIVE**, which is the design decision that made this
safe to add late: a restrictive policy is ANDed with whatever permissive policies a
table already carries, so the migration narrows all 102 of them without rewriting
one. A capability or permission that was already refusing somebody keeps refusing
them; branch is a second question asked after the first still passes.

**Thirteen tables are deliberately unscoped**, each with its reason in the
migration rather than by omission: one bill and one owner (`coaching_centers`,
`subscriptions`, `payments`, `upgrade_requests`, `plan_allowances`); one person with
many memberships (`profiles`); catalogues shared by the whole organisation
(`subjects`, `exam_types`, `sms_templates`); one queue with one sender
(`sms_dispatches`, `sms_logs`, `sms_credit_ledger`); and one stated deferral
(`audit_log`, safe today only because `audit_log_owner_read` opens it to owners,
and an owner is HQ by definition).

**A row is filed under the branch that wrote it**, by trigger, on the six tables an
add form creates: every form in this product posts a row with no branch on it, and a
restrictive policy alone would have left a pinned manager able to read their branch
and write nothing at all — refused at the insert, by a database error, on a form that
never mentioned a branch. An HQ member's writes keep the null, deliberately.

**Three number series became SECURITY DEFINER** in the same migration — receipt,
salary voucher, expense voucher. A series belongs to the centre, and a branch-pinned
caller taking `max(no) + 1` through their own policies gets their branch's maximum,
so two branches would have issued the same receipt number on the same day.

The leak suite `§8.2` asks for by name is in `scripts/test-rls.mjs`: two structurally
identical branches inside one centre, a manager pinned to one, and then **a case per
table** — their own row is visible, the other branch's is not — with the HQ control
run over the same 26 tables, because if this migration had changed anything for an
unpinned member it would have changed everything for every centre in the country,
all of which are HQ-only today. Then the hostile half, each refusal paired with the
write it must not break, and the per-table stamp assertions read back as superuser so
they are about what landed rather than what the session can see. A table added to the
schema without a decision about branches shows up there as a missing fixture key
rather than as a leak in production.

**Two open items, both named in the migration and both waiting on a screen:** a
branch snapshot column on `sms_dispatches` and `sms_logs`, so a delivery report can
be read per building after the fact, and a write-time branch column on `audit_log`.
Neither is a hole in the rule above — the queue and the log are unscoped on purpose
today — and each lands with the commit that builds the screen that needs it.

### 8.3 What HQ sees ✅

The organisation-wide view is the reason somebody buys this tier: revenue and
expenses per branch, students per branch, collection rate per branch, and the
organisation's own head count with what the day costs beside it. A branch comparison
table where the branches are rows, so the owner can see which one is carrying the others.

Built as `/hq`, off `branch_profit_month` and `branch_charges_month`, with the
organisation figure under the table rather than as a column in it — §17 forbids a
per-branch quota and a column would invite one, which under the balance would be worse
than before: a per-branch *price* would tell four branch managers they each have their own
bill to manage, and there is one. Head office is a row like any branch, because a student filed
there is a real student in no building. It has a nav tab under *Organisation* since
§20.8 step 1, shown only to an HQ member who may read money on a plan with branches,
and it is still reached from the dashboard's profit block and from the branches screen.

Nine columns as of §20.8 step 8: branch, students, **teachers**, cash in, spending,
salaries, profit, owed, collection rate. Teachers because two branches with the same
profit and half the staff between them are not the same branch — counted as standing
staff, one head query per building, and a dash rather than a nought where a policy
withheld the count. The two head figures in the foot are the organisation's own reads
and never sums of the columns: head office is a row here, so the only way a foot can
differ from its column is a building this reader was not shown.

**A branch name opens that branch's record, not that branch's workspace ⚠️.** §20.6
asks for a drill-down into the branch itself. What exists to open today is
`/settings/branches#branch-<id>`, and that is what the name links to. A filtered copy
of every branch-level screen would need the scope-narrowing mechanism §8.2 puts in the
database — `app.branch_ok` reading a *chosen* branch rather than the member's own — and
inventing one in a query string is precisely the cross-branch leak that section
forbids. It stays out until the mechanism exists.

### 8.4 What stays per-branch ✅ (decided)

Batches: **100 per branch**, not 100 for the organisation. Rooms and timetables are
physical and do not pool. Student places are the opposite — they pool, because a
place is a licence, not a chair. See §3.6.

---

## 9. Financial management

This is the section the old masterplan did not have at all, and it is now half the
product. CoachDesk is a **coaching centre management, academic and financial
management system**. For a Center or an Institution the finance module is not an
add-on; it is the reason the owner opens the app on the first of the month.

The questions it has to answer, in the owner's words:

- How much money came in this month?
- How much of what we billed did we actually collect, and who has not paid?
- What did we spend, and on what?
- What is the salary bill?
- Did we make a profit?
- Which branch is doing well? *(Institution)*
- How many student places do we have left? *(Center and Institution)*

### 9.1 Three numbers that must never be confused ✅

| Number | What it means | Where it comes from |
|---|---|---|
| **Charged** | what we billed | `fee_invoices.amount_bdt − discount_bdt` |
| **Collected** | what actually arrived | sum of `fee_payments.amount_bdt` |
| **Outstanding** | the gap | charged − collected, per invoice |

Reports must label which one they are showing. "Revenue" that silently means
*charged* tells an owner they had a good month while the cash never came, and that
is the single most expensive lie a finance screen can tell.

And they do: the word *revenue* appears nowhere in either dictionary. Every money
figure in this product names which of the three it is — "Cash in" against "Bills
unpaid" and "Bills paid" on the HQ table, "Collected" against the month's billing on
the fee board, "Spending, excluding salaries" where the profit view drops a category
— and where two figures on one screen answer different questions, the screen says so
in a sentence rather than leaving an owner to discover it by subtracting. The one
that reads as a footnote is load-bearing: an owner who found out by comparing two
screens that spending excludes salaries would stop trusting both.

### 9.2 Money is append-only ✅ — and it already is

This is the part of the audit that came back better than expected. The fee tables
were built for this from the start:

- `fee_payments.amount_bdt` has `check (amount_bdt <> 0)` — **not** `> 0`. Negative
  entries are already legal, which means a refund is already representable as a
  counter-entry rather than an edit.
- The table has **no `updated_at`**, because nothing updates it.
- Migration `…24` / `…17` **revoked DELETE, UPDATE and TRUNCATE** from browser
  sessions on payment rows, handing back only `reference` and `note` — a mistyped
  bKash transaction id is a real thing that needs fixing and fixing it changes no
  number.
- Receipt numbers are assigned by a trigger under a transaction-scoped advisory
  lock, so the series is gapless and two clerks at one desk cannot collide.
- Invoices have `voided_at` rather than a delete.

So the doctrine is already load-bearing, and it extends unchanged to the new
tables: **a correction to money is a new row that points at the old one.**

**Refunds, shown the way a parent sees them:**

```
Payment   +৳10,000
Refund     -৳3,000
─────────────────
Net        ৳7,000
```

Both lines stay on the record. The original receipt a family is holding must still
be findable, or the refund looks like a deletion and the centre has an argument.

Both lines exist on our own books too, since `20260811000074`: a **platform** payment
may be negative for the same reason a fee payment may, under tighter constraints
because a credit against a subscription can buy time as well as money. §3.8 holds the
rules.

### 9.3 Fees: due dates, part payments, discounts ✅

| | Status |
|---|---|
| Due date per invoice | ✅ `fee_invoices.due_date` exists |
| Partial payments | ✅ many payments per invoice, already works |
| Fixed-taka discount | ✅ `discount_bdt`, bounded by `check (discount_bdt <= amount_bdt)` |
| Percentage discount | ✅ `discount_percent`, held to the figure by `fee_invoices_discount_percent_agrees` |
| Named scholarship / waiver, reusable across students | ✅ `fee_scholarships`, granted per bill, totalled by `fee_waiver_month` |
| Overdue tracking and an arrears list | ✅ built |
| Instalment plans (a schedule agreed in advance) | ✅ N bills, not one bill with a schedule — `instalment_plan_id`, `instalment_no`, `instalment_of` |
| Payment methods | ✅ cash, bKash, Nagad, Rocket, bank transfer, other — `card` missing |
| Refunds | ✅ a negative payment against the bill, from the register — `lib/fees/refund.ts` holds the floor |

A scholarship is not a discount typed twice. It is a named thing — *sibling
waiver*, *merit 50%*, *hardship* — that a report needs to total separately, because
"why is our collection rate 82%" has a very different answer depending on whether
the missing 18% was waived on purpose or simply never paid.

Built as a standing rule the owner names once and grants per bill, not as a
property of a student: `/fees/scholarships` names them, the waiver panel on each
board row offers taka, a share, or one of the awards, and the bill stores the
figure, the share and which award it came from. The rule is frozen once created —
retire an award and make its replacement — because every bill it ever labelled
holds the figure it waived, and a rate that can be edited afterwards turns months
of history into a lie. Applying an award to a student's every future invoice
automatically is not built; §9.3 asks for reusable, not automatic.

An instalment plan is **N bills, not one bill with a schedule**, and that decides
everything else about it. A schedule table beside the invoice would need its own
allocation rule — which part does a ৳500 payment pay? — and its own arrears
arithmetic, and then there would be two answers to "what does this family owe"
with no way to tell which is right. Three rows instead reuse every mechanism
already keyed to an invoice: partial payments, the arrears list and its index on
`due_date`, receipts, the collection register, waivers, cancelling, month close
and the profit view. "Part two is overdue" needed no new code at all.

The one-off charge form offers 2 to 12 parts and shows the schedule before the
owner presses — each part's figure and the date it falls due, one month apart,
with `period_month` following the due date so no month shows a spike it could not
have collected. The split is in whole poisha and the remainder goes to the
**earliest** parts, a poisha at a time: ৳5,000 over three is 1,666.67 / 1,666.67 /
1,666.66. What matters is that the parts sum to what the owner typed, but
earliest-first is the direction an owner can explain, because the last instalment
is never the surprising one. The board labels each bill *part 2 of 3*, since
"Admission fee ৳2,000, overdue" reads identically whether it is a whole fee nobody
paid or the first third of an agreement being honoured, and those want opposite
conversations with the family.

**No total is stored anywhere.** A plan row holding "৳6,000 agreed" would be a
second answer to what the family owes, and the first thing to disagree with the
bills the moment one is cancelled or waived. The split is arithmetic the app does
once, in poisha, guarded by tests asserting the parts add back up; the schema's
job is only that a part cannot be renumbered, duplicated or quietly rewritten
afterwards — so the three columns are in the frozen list with what was billed, and
cancelling the rest of an agreement a family walked away from is the remedy.

### 9.4 Employees are not teachers ✅

A centre employs an accountant, a receptionist, a coordinator, a cleaner, a
security guard. None of them teach, none of them hold a batch, and none of them
should occupy a **teacher seat** — which is a billable unit at ৳100/month. Putting
a cleaner in `teachers` to reuse its permission row would silently raise the
customer's bill and corrupt the seat count Center pricing depends on.

So: a separate employee/staff record, carrying role, join date, salary terms,
active flag and branch. Some employees also get login accounts (the accountant
does; the cleaner does not), which is the same record-versus-account split as §5.1
and reuses it rather than reinventing it.

### 9.5 Payroll — two modes, and the simple one is the default ✅

Full mode:

```
Basic          ৳12,000
Allowances      ৳2,000
Other           ৳  500
──────────────────────
Gross          ৳14,500
Deductions      ৳  500
──────────────────────
Net paid       ৳14,000
```

Simple mode: **one number.** Most Bangladeshi coaching centres pay a flat monthly
amount, or a per-class rate, and have never written the word *allowance* down. A
form that demands a breakdown of a single figure will be filled with the same
number in the Basic box and zeroes everywhere else, which is worse than not asking:
it teaches the owner that the software does not understand their business.

So the detailed fields exist, default to zero, and stay collapsed until asked for.
`gross` and `net` are derived, never typed.

A **salary payment** is a separate record from the salary *terms* — paid on this
date, for this month, this amount, by this method, recorded by this person — and it
prints a receipt an employee can sign. Same append-only rule as fees.

### 9.6 Expenses ✅

Every taka that leaves, with a category: rent, electricity, internet, marketing,
printing, stationery, equipment, maintenance, transport, software, salary,
miscellaneous. Categories are a fixed list plus a free-text note, not free-text
alone — a category somebody types is a category no report can group.

Recurring expenses (rent, internet) are flagged as recurring so the owner is not
re-typing rent every month, but each month's actual payment is still its own row.
A template is not a transaction.

### 9.7 Revenue sources ✅

Student fees are most of it, but not all: admission fees, registration fees, exam
fees, form fees, and other income. Categorised for the same reason expenses are —
an owner who wants to know whether admission season carried the year needs those
separable from monthly tuition.

Raised from `/fees/charge`: pick a batch or the whole centre, name the fee, set one
amount, and one press bills every student ticked. A non-tuition bill carries no
enrolment — the check constraint on `revenue_category` requires it — which is also
what keeps it outside the `(enrollment_id, period_month)` slot month-close needs, so
two exam fees in one month are two real bills and neither can stop a family's monthly
fee being raised. That is why the month key cannot make this form safe to repeat and
a per-submission uuid does it instead, keyed per centre per student so one press
billing forty families is one key and a double tap loses on the first row.

Read back under the billed line on the home screen, split six ways, off the view the
month's own total is selected from — so the split cannot drift from the figure it sums
to. Only past one category: a month billed entirely as monthly fees needs no table.

Income with no student behind it — hall rent, book sales — still has no home in the
schema. It is outside the collected column and therefore outside the profit line, so
a centre with much of it reads low. Documented in 20260811000048, unbuilt.

### 9.8 Profit ✅

```
Revenue collected        (§9.1, the collected column)
− Expenses               (§9.6)
− Payroll                (§9.5, salary payments actually made)
─────────────────────────
= Profit
```

Payroll is inside this, not beside it. A profit figure that excludes salaries is
the number that convinces an owner to expand into a loss.

### 9.9 Receipts for everything ✅

A printable record for a fee payment ✅, a refund ✅, a salary payment ✅, an expense ✅
and a plan purchase ✅. In Bangladesh a receipt is the transaction; a payment without
paper did not fully happen. Each one carries a letterhead, a number, the date, the
amount in figures, and who received or paid it.

The refund needs no sheet of its own: it *is* a `fee_payments` row with a negative
amount (§3.8), so the receipt names itself a refund and prints the figure unsigned.
The payslip is the same layout turned around — two copies on one A4, the employee's
signature on the office copy, the breakdown as it was copied onto the payment row
rather than as the agreement reads today, and the month's total frozen at that
voucher. It is printed by a staff admin and handed over, so it needs no new policy;
a teacher still cannot read `salary_payments` at all (§6.2).

The expense voucher is the one sheet where the centre is the paying side, and that
turns it round again: the office copy comes first and the recipient's second, there
are three signature lines rather than two — who took the cash, who handed it over,
who approved it — and the line that would be a month's total on a payslip is instead
this category's spending up to this voucher, which is the duplicate check for the
rent being written down twice. Frozen by voucher number and not by date, because
`spent_on` is backdatable and a row entered next week must not change what today's
paper said. `recurring` is deliberately not printed: it is a hint about next month,
not a record of what happened.

The fifth sheet is the only one whose letterhead is not the centre's. `payments` holds
money the centre paid *us* — a subscription month or a block of student places — so
CoachDesk is the issuer and the centre becomes the billed-to block. That makes it the
simplest of the five: one copy, no cut line, no signature. The other party is us, we
already hold the row, and the proof is the wallet's transaction number rather than
anybody's pen. It is the one printable behind no plan gate, because withholding a
receipt from a customer who has just paid is the worst sentence this product could
print; `payments_owner_read` is the whole guard.

`payments` has no receipt series — only `fee_payments` got one — so the number is
chosen rather than read: the `CD-XXXXXXXX` purchase code when there is an intent, since
that is what the owner quoted in the bKash reference and what the founder panel lists;
the provider's own transaction number otherwise; and no number at all when there is
neither, because a code minted off a payment id would look searchable and match
nothing. What the sheet will not do is work out the rate the places sold at. §3.8 asks
for it and nothing stores it, and recomputing looks harmless while being wrong twice:
`student_capacity` has already risen by print time, so the bands would price the *next*
purchase, and a per-place average matches no published band when one purchase straddles
two. Recorded as a schema gap in §15, not papered over.

### 9.10 The dashboards ✅

**Center:** this month's collection, outstanding, expenses, payroll, profit; the
arrears list; and the one figure that is about us rather than about them — places
remaining on a teacher tier, the balance with what today costs on a per-student one.

**Institution HQ:** the same for the organisation, plus the branch comparison table
of §8.3. HQ never has to open each branch to find out how the group is doing.

Both are built, and the centre's is `/dashboard` itself rather than a finance screen of
its own — a second page would print "collected this month" twice in two places, which is
the discrepancy §9.1 exists to prevent. Outstanding is the largest figure on it because
it is the number the product is sold on, with the reminder door directly underneath: the
one thing on an owner's home screen that brings money in rather than reporting on it.
Collection, spending, payroll and profit come off `center_profit_month` in a single row
already subtracted by Postgres, never re-added in JavaScript.

The last figure is the one that changed shape with the balance, and it is two different
sentences on two different kinds of plan. A teacher tier still has a ceiling, so it still
reads as places remaining, and it sits on the free plan too because that is where the
ceiling is nearest. A per-student tier has no ceiling to count down, so what stands there
instead is the balance and today's rate — which is the same warning in a more honest
form: an owner who is nearly out of places and an owner who is nearly out of money both
need to know before saving stops, and only one of the two is now true (§11.7). Neither
version is a bill: nothing is owed, and the number is what is left of money already paid.

The organisation's copy is the total row of `/hq`'s table, with the organisation's own
balance and rate beneath it. Two figures there deliberately do not match their
centre-dashboard counterparts and the screen says so in a legend: cash in is keyed to when
the money arrived while the two bill columns are keyed to the month billed for, and the
head count in the total row is the organisation's own rather than the sum of the column,
because a student filed at head office is in one and not the other.

What the profit line cannot see, it warns about. A month with no payroll row reads as a
month with no staff and nothing in the schema can tell those apart, so the card counts
live agreements and payments filed and says which is missing; a centre paying wages
through the expense category instead has that money in neither term, and that is counted
and said too. Every term has to be readable as well — a manager whose owner unticked
`fees`, `expenses` or `payroll` is shown no profit rather than one that is confidently
wrong in a direction they cannot see (§6.2).

---

## 10. The audit log ✅

One append-only log of who did what, covering every action where the answer to
*"who changed this?"* has money or a child's record behind it:

fee amount changes · payments recorded · payment voids and refunds · discounts and
scholarships granted · awards created, renamed and retired · salary terms changed ·
salary paid · expenses recorded ·
permission changes · login accounts created or deactivated · branch transfers ·
attendance overrides (§6.3) · student status changes · capacity purchases · plan
changes · what the centre asked to pay us and how that request ended.

Each entry: actor, action, target, before, after, when. It is written by the same
transaction that made the change, so a change cannot exist without its log line.

The reason this is not optional in a financial product: the first serious support
conversation with a Center will be *"my manager says he never entered that"*, and
without a log the founder's answer is a shrug.

**Built** as seventeen triggers over one generic function (`20260811000046`, with one
each from `20260811000057`, `20260811000064` and `20260811000069`), with the
actor read off a request header because `set_config` cannot survive a PostgREST
request boundary (`20260811000056`). The log stores what it can be certain of — table,
operation, and only the columns that moved; naming the *action* is `src/lib/audit.ts`,
where it is tested, and the owner reads it at `/settings/activity`. Insert, update,
delete and truncate are revoked from every browser session, and the read policy is the
owner alone: the manager is the subject of the question this log answers.

Two of those seventeen spent a while recorded and unreadable, which is worth keeping
written down. `payment_intents` and `fee_scholarships` attached their triggers in their
own migrations without being added to `AUDITED_TABLES`, and the screen gates the table's
name on that list — so a settled payment request and a retired award both read as
"Changed" by somebody, with nothing saying what, and neither could be filtered to. The
database half was never wrong. `scripts/check-migrations.mjs` now compares the triggers
in the schema against that list, because the missing check was the one pointing from the
database at the app rather than the other way round.

Attendance overrides are the last item on that list to arrive, and they only could
once §6.3 gave the register a way to tell an override from a mark
(`20260811000064`). The trigger's condition is that condition and nothing looser —
`new.status is distinct from old.status and new.marked_by is distinct from
new.called_by` — because a trigger on `attendance_records` that fired on any change
would log every student on every day, and a log that long is a log nobody opens.
A teacher fixing their own tick five minutes later is therefore not in it.

That line names the child, though not from the snapshot: `enrollment_id` does not move
on a correction, so it is not among the columns stored and `src/lib/audit.ts` cannot
reach it. The reader resolves it instead — mark to enrolment to student, one embed
inside the round trip that already names an invoice's student and a payment's. A record
since deleted comes back with nothing and the line keeps its action and its from-to,
which is the same fallback every other subject on the screen has.

---

## 11. Platform billing: how the customer pays us

### 11.1 bKash is deliberately not implemented 🚧

**The bKash integration is not built and must not be guessed at.** The merchant
account and API credentials are being arranged; until they exist:

- **Do not invent bKash API shapes.** A guessed request body is a rewrite, not a
  head start.
- **Do not guess credentials or endpoints.**
- **No SMS-reading**, no scraping of bKash account history, no parsing of a
  personal wallet's notifications. These are unofficial, they break, and they put
  the customer's money on a foundation of screen-scraping.
- **Never trust a frontend "payment succeeded."**
- **Do not hard-code a personal bKash number as the payment mechanism.**

What gets built instead is the layer that will still be correct afterwards.

### 11.2 Payment intents ✅ — and after 2026-09-05 there is one kind of purchase

Every purchase creates a **payment intent** on the server before the customer is sent
anywhere. The intent owns the amount. The browser never does.

**The list of purchase kinds used to be four** — a subscription month, a single student
place, a bulk-import block, an extra branch. It is now **one: a top-up of the balance.**
Places are retired (§3.3), and a teacher seat or an extra branch is no longer bought at
all — it raises the daily rate from the day it exists and the balance carries it (§11.6).
That is the single largest simplification the prepaid model buys, and it lands on machinery
that already exists rather than replacing it.

States, and they are a state machine, not a status label:

```
pending → initiated → successful
                   ↘  failed
                   ↘  cancelled
                   ↘  expired
       successful  →  refunded
```

| Field | Why |
|---|---|
| org, purchase kind, quantity | what was bought |
| `amount_bdt` computed server-side | §11.4 |
| state, timestamps per transition | so a stuck payment is diagnosable |
| provider, provider transaction id | reconciliation — and under §11.9 this is the bKash TrxID the customer typed, which is why the claim needs no unique index of its own |
| **idempotency key** | a retry, a double tap, or a webhook delivered twice must land once |
| what it grants | **the poisha credited, bonus included** — attached to the ledger **only** on `successful` |
| the tier it moves onto, on a first paid top-up only | so a tier move and the money that pays for it are one purchase, settled one way |

**Idempotency is keyed on the provider transaction id** with a unique index behind
it, and the duplicate path reads back the original result rather than erroring. This
pattern already exists in the codebase — the founder panel's manual payment
recording does exactly this — so it is a reuse, not an invention. **A recharge claim
(§11.9) is one of these intents, not a second table**: the customer-declared TrxID is
the provider transaction id, the founder's approval is the transition to `successful`,
and the ledger entry is what `successful` grants.

**An intent may carry a tier** (`target_plan`), and then the settlement moves the plan
before it credits the balance, because the rate is read off the plan. Null on every
ordinary top-up, never the free tier. The tier the amount was computed from and the tier
being bought must be the same tier, checked once as a column constraint and once where
the quote is priced: quoting the tier a centre is on while asking for a better one is
Centre money for Institution product. The read-back that answers a reused idempotency key
compares the tier too, because at 400 students on one branch Centre and Institution bill
the identical ৳7,300 a month, so purpose, quantity and amount cannot tell those two
purchases apart.

### 11.3 The provider interface ✅ (manual only)

One interface, several implementations:

```
createPayment(intent)  -> a redirect or instruction for the customer
verifyPayment(ref)     -> the provider's own answer, fetched by us
handleCallback(payload)-> verified, then reconciled against the intent
```

Implementations: **manual** (the founder confirms a bKash transfer they can see in
their own app — this is how the first fifty customers pay, and it works today),
then bKash, then anything else. The manual provider is not a mock. It is a real
provider whose verification step is a human being, and it must satisfy the same
interface so that switching to the API changes one file.

### 11.4 What the server must never take from the browser

| Never trusted | Because |
|---|---|
| "payment succeeded" | trivially forged |
| the amount | the price is ours to compute |
| the plan | otherwise anyone is an Institution |
| the head count, and the daily rate derived from it | otherwise the rate is whatever the browser says it is |
| the balance, and `charged_through` | they are the gate now (§11.7); both are server-maintained and neither is writable by `authenticated` |
| the entitlement | it is derived, never submitted |
| the branch id | otherwise branch isolation is a suggestion |

### 11.5 The founder panel is real, not a facade ✅

It records money that actually arrived, write-once, with an idempotency key, and it
is the only door to a **status** change and to a plan change nobody paid for — gated
behind a platform-admin check and a database grant, not a hidden route. A plan change
somebody *did* pay for now arrives the other way, through a settled subscription intent
carrying its tier (§11.2); both are service-role writes past the billing guard, so the
fence in §12.2 is unchanged and there are two doors through it rather than one. The
panel must never grow a button that *says* a payment succeeded without one having. Its
plan-change function deliberately does no limit enforcement and warns instead, because a
founder moving a customer down a tier is a decision, not a validation error.

**And a self-serve downgrade is still not offered, for a reason that changed on
2026-09-05.** It used to be the arithmetic: a mid-term downgrade owed a credit for unused
coverage and nothing could work out what that was worth. Under one balance there is no
credit to compute — the rate simply changes from that day forward and the same taka lasts
longer, which is the whole point of §11.6. What is left is not a money problem at all: a
downgrade *removes features and branches from view*, and an owner tapping it on a phone to
save money would find their four branches gone and their branch admins locked out. That is
a conversation, not a button (§9.2). The founder panel keeps it, and the customer-facing
answer is "call us" — which at fifty customers is also how we hear why.

### 11.6 One balance, burned by the day 🚧

**Decided 2026-09-05, and this is the whole money model. Every other subsection of §11
is a fence on it or a screen over it.**

> Money in → taka in the balance → each day takes its own cost off → when the balance
> cannot cover the next day, saving stops until they top up. Size changes the daily
> rate, nothing else.

There is no invoice, no due date, no bill, no coverage period, no grace window, no
credit in either direction, and no seat to buy. A centre holds taka; a day costs taka;
the taka runs out. That is the entire mechanism, and it is the one every Bangladeshi
phone user already holds: `রিচার্জ` needs no explaining.

**The daily rate is the monthly price divided by thirty.** §3.1's marginal bands and
§3.2's floor are unchanged — they still compute the figure a customer is *quoted*,
because "৳2,600 a month" is how an owner thinks about cost. The product simply divides
it and takes a day at a time:

| | |
|---|---|
| 100 students, 3 teachers | `max(1999, 100 × 25) + 1 × 100` = **৳2,600/month** |
| Divided by thirty | **৳86.66/day** (8,666 poisha) |
| A ৳31,200 balance | **360 days — covers you to 31 August 2027** |

**Price in months, bill in days.** Never lead with the daily rate: an owner comparing
us with a competitor compares monthly figures, and ৳86.66 sounds like a trick. Days
appear once the money is theirs, where they are the honest and useful unit.

**Why days rather than a month, and why it is not a smaller version of the same thing:**

- **Mid-month admission needs no arithmetic.** A student joining on the 9th is not a
  pro-rata line on anything. The rate rises that day — 101 students is ৳2,618/month, so
  ৳87.27/day — and days-left drops from 360 to 357. Nothing is invoiced, adjusted or
  reconciled, because there was never a period to divide.
- **A student leaving is rewarded the same day.** Tidying the register lowers tomorrow's
  cost. Under a monthly bill, tidying it late in the month gains nothing, so nobody does
  it and our head counts drift from reality.
- **There is no billing boundary to game**, so §18's peak-active-count arithmetic is
  retired rather than fixed. See §11.8.
- **A tier or teacher change costs nothing to compute.** Yesterday's rate was
  yesterday's; tomorrow's is tomorrow's. This closes §11.5's open item outright: nothing
  needs to work out what a centre's unused coverage is worth, because coverage is not a
  thing anyone holds.
- **Read-only becomes a routine state rather than a failure.** §4.4's machinery — every
  screen reads, nothing saves — is what a dry balance falls into, and it was built for
  exactly this.

**The rules, as decided:**

| Question | Answer |
|---|---|
| Does the balance expire? | **Never.** |
| Is it refundable? | **No** — said on the recharge screen, before the tap, in both languages. |
| Can it go negative? | **Never by anything a customer does.** See §11.7. |
| Is there a grace period? | **No.** Withdrawn on the owner's instruction: a charge allowed to sit unpaid is credit, and this is a prepaid product. What replaces it is warning early — the dry date is known exactly, so §20.4 warns at 14, 7, 3 and 1 days. |
| What buys the software itself? | **The ৳1,999 floor is the software fee.** There is no second product and no separate subscription. The floor stops biting at 80 students, where the per-student charge overtakes it. |
| Does a free plan burn anything? | **No.** `pricing === 'free'` is a zero daily rate, so Teacher Free never lapses and never sees a balance screen at all. No special case in the code — the arithmetic returns zero. |
| Does Teacher Pro work the same way? | **Identically.** ৳499/month is 1,663 poisha/day. One billing model for every paid tier is the point. |

Non-refundable is not a trick; it is the only honest answer while §11.3's provider is a
human with a personal bKash app, because a refund is a manual outbound transfer with no
reconciliation behind it. It has to be said at the moment of payment or it becomes one.

**The discount ladder is a recharge bonus, and it is a bonus on money, not on time.**
Owners think in months, so the suggested amounts are one, three, six and twelve times
their own monthly figure; the bonus is credit added on top:

| Suggested | Pay | Bonus | Credit | ≈ days at today's size |
|---|---|---|---|---|
| 1 month | ৳2,600 | — | ৳2,600 | 30 |
| 3 months | ৳7,800 | 5% | ৳8,190 | 94 |
| 6 months | ৳15,600 | 10% | ৳17,160 | 198 |
| 12 months | ৳31,200 | 20% | ৳37,440 | 432 |

A typed amount gets the highest band it reaches, which is what the owner asked for
("discounts based on how many amount they want to recharge") and what the month labels
describe. The bonus is a percentage of **money**, deliberately, because a bonus on
*time* would have to pin the head count for the period and that is a second mechanism —
committed capacity with overage — which this model exists to avoid. So a centre that
buys twelve months and then triples in size has 20% more taka, not 432 more days, and
the screen says so in those words: **"about 432 days at your current size"**, with the
figure re-derived every day on the dashboard so the end is never a surprise.

The one soft spot: the bands are measured in days at *today's* rate, so a centre that
emptied its roster before recharging would reach 20% for less money. It is closed by
the same human who verifies the transfer — §11.9's approval screen shows the size the
quote was priced from beside the amount. When approval is ever automated, the band must
move to a thirty-day high-water rate; until then, naming it here is the fence.


### 11.7 The ledger, the two levers, and the fences on them

**A balance is money, so it is a list of entries and never a column.** `balance =
sum(entries)`, entries are append-only, and this is the discipline `fee_payments` has
carried since `20260811000017` — a reuse, not an invention. A `balance_poisha` column on
the centre is maintained by trigger *for reading*, the way `paid_through` already is
(`20260811000059`), so a session guard costs one column and not a scan; a test asserts
the column equals the sum, and the ledger is the one that is right.

**Every entry carries where the balance stood on both sides of it.** `balance_before`
and `balance_after`, with `balance_before + amount_poisha = balance_after` as a CHECK
constraint — so the running total is not merely derivable from the list, it is *asserted
by every row of it*, and an entry inserted out of order or written against a stale read
fails at the database rather than leaving a ledger that only adds up if you squint.
`sms_credit_ledger` (`20260811000001:622`) is the in-repo precedent and it stores only
`balance_after`; this is that shape plus the half that makes the chain checkable.

The row, in full, because a ledger missing one of these columns is a ledger that cannot
answer a question somebody will ask:

| Column | Why it is there |
|---|---|
| `id`, `coaching_center_id` | one entry, one organisation. Composite FK and RLS as everywhere else |
| `kind` | the enum below. Never free text — a report groups by it |
| `amount_poisha` | signed integer. A CHECK pins which sign each `kind` may carry, so a "recharge" can never be negative and a "daily charge" can never be positive |
| `balance_before`, `balance_after` | the chain above |
| `charge_date` | the Dhaka day a settlement is *for*, null on everything else. Unique per centre with `kind='daily_charge'` |
| `price_version_id` | which published rate card produced the amount (§11.10). Required on a settlement and on a recharge; null on a founder adjustment, which is a decision and not a price |
| `usage_students`, `usage_teachers`, `usage_branches` | the head counts the amount was computed from, snapshotted (§11.12). A rate nobody can reconstruct is a number a customer cannot dispute |
| `description` | one sentence for the customer's own history screen, in the customer's language where it is generated and in the founder's words where a human typed it |
| `payment_id`, `payment_intent_id`, `reverses_entry_id` | what this entry relates to. `reverses_entry_id` is how a correction points at what it corrects |
| `created_by`, `actor` | the profile id where a human did it, and which of `system`/`founder`/`migration` it was. Both, because "the cron did it" and "nobody was signed in" are different answers |
| `created_at` | `timestamptz`, insert-only |
| `metadata jsonb` | the transaction id a claim arrived with, the reason a founder typed, the migration that wrote it. Never a figure the arithmetic reads — a number the balance depends on does not live in jsonb |

The kinds, and the whole list, because an enum is where this stays honest:
`recharge`, `promotion_bonus`, `daily_charge`, `founder_money_adjustment`,
`founder_grant_days` *(no money; see the levers below)*, `refund`, `reversal`,
`correction`, `settlement_failure` *(zero-amount, for the record)*,
`settlement_retry`, `migration_opening_balance`.

**A correction is a new entry, never an edit.** ৳500 credited twice is fixed by a
`reversal` of −৳500 pointing at the duplicate through `reverses_entry_id` — so the
mistake and its repair are both in the customer's history, which is what a customer
ringing about a figure they screenshotted actually needs. §12's rule, in this table.

**Amounts are poisha — hundredths of a taka — and integers.** ৳2,600 ÷ 30 is ৳86.666…,
which is not a whole taka, so whole taka cannot be the unit. This corrects the earlier
wording here. `dailyRatePoisha = floor(monthlyBdt × 100 / 30)`, floored so the rounding
is always the customer's, and the ~20 poisha a month it gives away is below the
resolution of anything anyone looks at. No floats, anywhere, ever.

**Two levers, and each has exactly one job:**

| | |
|---|---|
| `balance_poisha` | money available to settle days that are not yet paid for |
| `charged_through` | the last Dhaka date that *is* paid for |

`charged_through` moves forward two ways: by spending money, or by being granted. A
trial, a goodwill extension or a closure allowance given forward is **days, not fake
money** — it cannot be spent on anything else, it cannot be confused with taka a
customer actually paid, and it costs nothing to represent. Money already burned that is
being given back is a **money** adjustment. Both are founder-only, both require a
written reason, both are audited (§10).

**A day is a Dhaka calendar day**, and the SQL must say so:
`(now() at time zone 'Asia/Dhaka')::date`. Never `current_date` — the database runs UTC,
so between midnight and 6am in Dhaka `current_date` is yesterday, and a billing bug that
only appears before dawn is the worst kind there is.

**Settlement is a consequence of use, not a job.** §4.3 already states the principle for
trials — *expiry is a comparison, not a cron job* — and this is the same call.
`public.settle_billing(center)` is `security definer`, granted to `authenticated`, accepts
no amount, verifies the caller's membership, and then — in `public` rather than the `app`
schema this section first named, because PostgREST serves only `public` and both the cron
and `requireWritable` reach it through that door; the counting helpers it calls stay in
`app`, where nothing browser-shaped can name them:

1. takes the per-centre advisory lock;
2. computes today's rate from `app.active_students`, `app.active_teachers` and the branch
   count — **the same functions the capacity trigger reads**, so there is one head count
   in the system and not a billing copy of it;
3. for every unsettled whole past day, inserts one charge at today's rate, for as long as
   the balance affords it;
4. for **today**, tops the charge up to today's rate if a smaller one was already taken;
5. advances `charged_through` to the last day it actually paid for.

`requireWritable` calls it, which is what closes the only gaming vector daily billing
has. A fixed-hour job would charge a roster that had been emptied across midnight at the
floor rate; taking the charge **at the first write of the day, from the size at that
moment, and topping it up when the size grows**, makes a day's total the high-water rate
for that day with no stored high-water mark to drift. To be charged the floor an owner
must be empty when they start work, and an empty roster cannot take attendance, collect a
fee, send an SMS or record a mark.

A nightly cron calls the same function so that a centre nobody logged into still shows a
current figure to its owner and to the founder panel. **It is not load-bearing.** If it
never runs — no `CRON_SECRET`, a missed delivery, a Vercel outage — access is still
correct, because access is a comparison and not a row.

**Access is derived and never stored:**

```
owed   = greatest(0, today − charged_through) × dailyRate
access = read_only  when status in ('suspended','cancelled')
                    or  dailyRate > 0 and balance < owed
         full       otherwise
```

A centre that never opens the app still lapses on exactly the right day, with no row
written and no job run: `owed` grows by itself. And the common path —
`charged_through = today`, so `owed = 0` — never needs the rate at all, which is why an
unreadable head count cannot lock a paying centre out on a bad afternoon. Where the rate
*is* needed and cannot be read, the answer is `read_only`, as everywhere else.

**Charge the whole day or nothing.** ৳50 against an ৳86.66 day buys no day: the ৳50 stays
theirs, the screen says "not enough for one day", and it is spendable the moment they top
up. Letting the last day go through at whatever was left would put an amount in the ledger
that matches no rate, and a ledger nobody can audit is not a ledger.

The threats, and the fence for each:

| Attack | Fence |
|---|---|
| Browser writes itself credit | **`insert`, `update` and `delete` on the ledger are revoked from `authenticated` and `anon` outright.** Only service_role credits. A customer submits a *claim* — "I sent ৳7,800, trxID `ABC123`" — into a review queue; credit exists only after the founder approves it (§11.9). |
| The same bKash transfer credited twice, or fifty times | Unique index on the provider transaction id, **globally and not per centre**, over *approved* claims only — so a claim rejected in error can be re-submitted, while an approved transfer can never be replayed. The duplicate path reads back the original answer (§11.2). |
| A charge edited or deleted to win days back | Immutability trigger shaped exactly like `app.guard_payment_immutable` (`20260811000025:138`): no UPDATE of amount, kind, date or centre, no DELETE, for any role that is not service_role/postgres. Append-only means a correction is a counter-entry and never an edit. |
| Client supplies the amount | It never does. `settle_billing` takes no amount and prices everything from the database; a recharge credits the amount on the **server-priced intent** (§11.4); a check constraint pins the sign each kind may carry. |
| Two requests race the balance negative | Both take the per-centre advisory lock and the insert is conditional on the balance covering it, in one statement — the pattern `app.assign_receipt_no()` already uses. **Nothing a customer does can take the balance below zero; that is a database invariant, not a UI check.** A founder's correcting adjustment may, deliberately, and the account is read-only until it is positive again. |
| Centre A spends centre B's balance | `coaching_center_id` scoping, composite foreign key, RLS — as everywhere else. |
| Someone approves their own recharge claim | Platform-admin only, and the approver may not be a member of the claiming centre. Both are written to the audit log (§10). |
| The daily charge runs twice | A unique index on (centre, charge date) for the day's base charge, and the top-up path is convergent: it inserts only the difference between what today has been charged and what today costs, so a second call inserts nothing. A double cron delivery settles once. |
| A hostile client calls `settle_billing` directly | It is `security definer` but takes only a centre id, verifies the caller's membership, and derives every figure itself. The worst it can do is charge the caller's own centre for a day it already owed. |

**The balance is now the gate, and that is a deliberate reversal.** The earlier note here
said credit buys capacity and the capacity trigger from `20260811000036` refuses the 101st
student, two layers on purpose. Purchased capacity is retired (§18), so there is no seat
left to refuse — what refuses now is that a centre whose balance cannot cover today cannot
save *anything*. That is a stronger fence and not a weaker one: one comparison instead of
two stored numbers that had to agree, and it fails closed in the same direction §4.2 does.
§2's rule still holds — *"All restrictions MUST be genuinely enforced server-side"* — and
it holds at Layer 1, because the refusal lives in `requireWritable` and in the revoked
grants on the ledger rather than in a screen.

What does **not** change: §2.7's engineering ceilings. A hundred batches, two hundred
subjects and the per-batch limit on the teacher tiers stay exactly where they are, at
Layer 1, because they are guardrails against a pasted syllabus rather than a price.

### 11.8 What a clever owner can and cannot get for free

**Raised by the owner, 2026-09-05:** would a centre losing one student and gaining another
just rename the existing record rather than pay again? Under the daily model the answer
became a much better one than the fence I had drafted.

**Recycling a record gains nothing, because nothing is bought per child.** A hundred active
students cost the same taka a day whoever they are. There is no seat to re-use, so there is
no saving to chase, so there is nothing to defend against. The exploit was created by the
model, and the model changed.

Which settles the owner's other proposal — locking the name at admission — as
**unnecessary, and it would have been actively harmful.** Bangla/English transliteration and
plain typos are endemic and the name is typed on a phone keyboard; it appears on every
receipt, every exam sheet and every SMS a guardian reads; and it would not have stopped the
abuse anyway, since a recycler simply does not edit the name. So the name stays editable,
**every identity edit is written to the audit log with who and when and shown on the
student's own record**, and the admission form carries a "check this is right" beat where it
costs nothing.

The "this looks like a different family" prompt survives, but for a **bookkeeping** reason
and not a pricing one: dues, receipts, attendance and marks would silently move to the new
child. The signal is narrow — name and guardian phone both changed at once, on a student who
has fee history — the honest path is the first button, and both buttons are audited.

**The peak-active-count arithmetic is retired, not fixed.** It existed because a monthly
bill computed from *active students right now* could be dodged by emptying the roster the
night before. Daily billing has no period boundary, so there is nothing to stand next to.
§18 records it.

The remaining ways to try, and what stops each:

| Try | What stops it |
|---|---|
| Deactivate students while still teaching them | **The fence is that an unpaid student is unusable, not that we catch you.** A deactivated child takes no attendance, carries no fee row, receives no SMS and holds no exam mark. There is nothing to detect because there is nothing to gain. |
| Empty the roster across midnight and refill at dawn | Settlement happens at the **first write of the day** and tops up when the size grows, so a day's charge is that day's high-water rate (§11.7). Being empty when work starts means not being able to work. |
| Shrink first to reach a bigger recharge bonus | Named in §11.6 and fenced by the founder's eyes: the approval screen shows the size the quote was priced from, beside the amount. Automation would need a thirty-day high-water rate; manual approval does not. |
| Buy twelve months, then triple in size | Not a hole. The bonus is 20% more **money**, not 432 more days, and the screen says "about 432 days at your current size" and re-derives it daily. |
| Run an API request that credits the balance | Grants are revoked (§11.7). There is no endpoint, no Server Action and no RLS policy that lets `authenticated` write a ledger row at all. |

**The closure case is real and it is answered by a human.** A centre shut for three weeks
around Eid is charged for three weeks, and they will say so. A self-serve pause is
deliberately **not built**: to have any fence at all a pause must make the account
read-only, and once it does, a centre that pauses day by day pays only for days it writes —
which cuts a fully-using customer's price by about a third and makes revenue
unforecastable. So the answer is founder discretion: a money credit for days already
burned, or granted days forward, each with a written reason, from the panel, on a phone call
the founder actively wants at this scale. If it becomes a monthly conversation at fifty
customers, a real pause with a per-year cap gets built then, and not before.

**The founder-unavailable case is the worst experience in the model and it is not solved by
credit.** A centre can run dry while its money sits unverified in the founder's bKash. What
is built instead: warnings at 14, 7, 3 and 1 days (§20.4); the recharge screen saying
plainly that verification is by hand and asking them to top up before they run out; and the
read-only banner naming the claim in flight — *"we have your ৳7,800 from 2 hours ago and are
checking it"* — with 01756211762 beside it. That is information, not credit. A self-serve
emergency button is **not** built: the founder grants days in one tap instead, which is the
same outcome for the customer, one door instead of two, and a human decision — which is
what the owner asked the whole approval flow to be.

### 11.9 The recharge, step by step 🚧

**Designed by the owner, endorsed with six additions.** One screen, no separate
calculator, and the calculator that exists today at §20.4 folds into it.

1. The owner opens **Recharge**. It already knows their daily rate, days left and dry
   date, and it shows what makes the rate up — their students, their teachers, their
   branches. Not the band table (§14 forbids that); their own numbers.
2. They pick one of the four suggested amounts (§11.6) or type their own. **The server
   prices it** into a payment intent: amount to pay, bonus, credit, approximate days. The
   intent records the head count it was priced from.
3. The screen shows: send **exactly ৳7,800** to **01756211762** using **Send Money** in
   bKash or Nagad, and put reference **`CD-7K2M`** — short, uppercase, from an alphabet
   with no `0/O/1/I/L` in it.
4. They send it, then enter the **transaction ID** and **the number they sent from**, and
   tap Confirm. Both are required. *(Open question, and the only one that changes this
   screen's shape: whether personal-to-personal Send Money offers a free-text reference
   field at all. The design survives either answer because the transaction ID is the
   required key and the reference code is the convenience.)*
5. The claim is `submitted`. The screen says verification is by hand, gives a window
   rather than a promise, says plainly that **nothing is lost while it is pending**, and
   shows 01756211762.
6. The **founder panel** lists submitted claims: centre, amount, bonus, credit,
   transaction ID, sender's number, when, **and the centre's current size**. The founder
   opens their own bKash app, checks, and approves or rejects.
7. Approval, in one transaction: a `payments` row for the **money that actually arrived**
   and a ledger `recharge` entry for the **credit granted**. Rejection needs a reason from
   a short list, because a rejection without one becomes a phone call.

The six additions to the owner's design, each with its reason:

- **Transaction ID required, not just our reference code** — a personal Send Money may not
  offer a reference field, and without a provider-side identifier there is nothing to make
  unique.
- **Sender's number recorded** — two ৳1,999 transfers in the same minute have to be
  tellable apart.
- **Transaction ID unique globally** (over approved claims) — the anti-replay fence
  (§11.7).
- **No half-hour promise** — a window, a live status, and the plain statement that nothing
  is lost.
- **Approval may override the amount** — customers send the wrong figure constantly. The
  panel prices the bonus from what *arrived* and shows both numbers side by side.
- **Rejection carries a reason.**

**Cash received is not credit granted.** ৳7,800 arrives, ৳8,190 is credited. The founder's
revenue reporting reads `payments`; the customer's balance reads the ledger; deferred
revenue is the sum of unspent balances. Three genuinely different numbers, and the panel
must not conflate them.

A recharge `payments` row carries **no coverage period**, because a recharge covers no
period — the same rule §3.8 already applies to a credit row. `paid_through` therefore stops
being maintained by recharges and stops gating anything (§4.4).

At most **three open claims per centre**. A centre with fifty is confused or is filling the
queue, and both want stopping at the door.

### 11.10 Prices have versions, and old entries are never repriced 🚧

**The problem this exists for.** The bands in §3.1 are a founder's judgement with no
market survey behind them (§14), so they *will* change — and the day they do, a centre
holding ৳31,200 of credit bought at ৳25 has a reasonable expectation about what that
money buys, while the ledger has two years of entries computed from a rate card that no
longer exists. Without versions, a price change is a silent rewrite of history: last
March's ৳86.66 day becomes unexplainable, and a customer who screenshotted their balance
screen is holding a document the product now contradicts.

**One published rate card at a time, seeded by migration.** `public.price_versions` —
`id`, `effective_from date` (unique — one card per date), `student_bands jsonb`,
`center_monthly_floor_poisha`, `institution_monthly_floor_poisha`,
`teacher_plus_monthly_poisha`, `teacher_seat_poisha`, `free_teacher_seats`,
`branch_poisha`, `included_branches`, `published_at`, `note`. Select-only to
`authenticated`; **no app write path at all**, for
the reason `plan_allowances` already gives in its own migration: *repricing should be a
reviewed diff, not an UPDATE somebody ran once.* A new price is a new migration and a new
row, and the old row stays exactly as it was for ever. The column list grew three
monthly figures rather than the one this section first sketched — plans.ts holds three
(the Center floor, the Institution floor, Teacher Pro's flat ৳499), and a card that
cannot price a teacher tier cannot price the product; Teacher Free burns nothing and is
deliberately not a column at all, because a price of nothing is the absence of a price.

**And `plans.ts` is still the engine.** §17 says `src/lib/plans.ts` owns the numbers and
that does not change — what changes is that `public.settle_billing` runs in SQL and cannot
import TypeScript, so the rate has to exist in the database too. That is two copies of
the numbers, which is the bug `seatsCoveredByFloor`'s docblock is written against, so it
is closed the way this repo already closes it: **`tests/plan-allowances.test.ts` parses
the seed statement out of the `.sql` file with a regex and compares it against
`plans.ts`.** The price-version test is that test again, over the new table —
`tests/price-versions.test.ts`, holding every band and every scalar of the founding
card to the engine. A third copy
of the numbers written into the test itself would pass while both of the others drifted —
that sentence is in the existing test and it is the whole reason this pattern exists.

**Built (2026-09-13, migrations 80–81):** the table and its founding card, the
`price_version_id` column on `billing_ledger` — required on a `daily_charge` and on a
`recharge`, null on every other kind, exactly as the row spec in §11.7 asks — and the
reconciliation test. What remains of this section is the founder's price pin
(`price_version_lock` / `price_lock_until`), which lands with the founder levers in
step 26 where its screen is.

**Which version an entry used is on the entry** (`price_version_id`, §11.7), on both
sides: a settlement records the card it charged from, and a recharge records the card the
quote was priced against. So "why was 14 March ৳86.66" is answered by joining two rows,
for ever, without recomputing anything.

**What a price rise does to money already paid, stated as policy because it is a promise:**

| | |
|---|---|
| Credit already in the balance | **buys days at the new rate.** It is taka, not days, and §11.6 says so before the tap: *"about 432 days at your current size"* — size and rate both move |
| Days already charged | **never repriced.** Settled entries are immutable (§11.7); a rate change is not retroactive and cannot be |
| A quote already given | honoured for as long as the intent lives — `payment_intents.expires_at` is already 7 days |
| A centre we have promised a rate to | `coaching_centers.price_version_lock` plus `price_lock_until`: a founder-only pin to one card with an expiry, audited, and it *cannot outlive its own date* — a lock with no expiry is a price we forgot we promised |

**Announced, not sprung.** `effective_from` is a future date on the day the migration
lands, and every centre with a live balance is told before it arrives — which is a founder
obligation rather than a code path, and is written here so it is not discovered later.

### 11.11 The bonus is a promotion, not a formula 🚧

**§11.6's four amounts and 0/5/10/20% are an example of a promotion, not the definition
of one.** They are today's offer. Written as a percentage in code they become a number
nobody can change without a deploy, and — worse — a number in *two* places, because the
recharge screen quotes it and the approval path credits it.

`public.promotions`: `id`, `code`, `name`, `starts_at`, `ends_at`, `tiers jsonb`
*(minimum poisha → bonus basis points)*, `price_version_id`, `active`, `created_by`,
`created_at`. Basis points and not percent, because 2.5% is not an integer and this
document has already decided floats have no place in the money path.

**Three amounts, three columns, never one.** A recharge stores what arrived, what was
credited, and how much of that was bonus:

| | ৳7,800 sent |
|---|---|
| `payments.amount_bdt` | **৳7,800** — cash that actually reached a bKash account. This is revenue |
| ledger `recharge` | **+৳7,800** — the money |
| ledger `promotion_bonus` | **+৳390** — the gift, with `metadata.promotion_id` |
| balance | **৳8,190** |

Two entries and not one, because one entry of ৳8,190 makes the founder's own accounts
unanswerable: cash received, credit granted and deferred revenue are three different
numbers (§11.9) and a single row conflates all three. It also makes "how much have we
given away this quarter" a `sum` rather than a reconstruction.

**The browser never says what the bonus is.** The recharge screen *displays* a quote the
server priced; the approval path re-derives the bonus from the amount that actually
arrived and the promotion live at that moment, and writes both. A client-supplied bonus is
in §11.4's list of things the server must never take, alongside a client-supplied amount.

**A completed recharge is never re-priced.** Ending a promotion, editing its tiers or
deleting the row changes nothing that has already been credited — the entries are
immutable and the `promotion_id` in their metadata points at a row whose own history says
what it was on the day. A promotion is edited by superseding it, for the same reason a
price is (§11.10).

**Who can create one:** platform admin only, audited (§10), and never the same person as
the approver of a claim it applies to where that can be arranged. Nothing about a
promotion is reachable from a centre's own session, read or write.

### 11.12 What counts, and what every lifecycle event does to the count 🚧

**One counting function, and billing does not get its own copy.** `app.active_students`,
`app.active_teachers` and the branch count are what the capacity trigger already reads
(§11.7 step 2), so there is one head count in this system. A billing-side count would be a
second answer to the same question and the two would disagree the first week.

**Active means active right now, never lifetime.** `app.active_teachers` already filters
`and t.active`, and that is the rule for all three: a centre pays for what is switched on
today. Every row below follows from that one sentence rather than from a special case.

| Event | Effect on tomorrow's rate | Why |
|---|---|---|
| Student marked inactive | **drops** | The register is the truth. §11.6: tidying up lowers tomorrow's cost, which is the only reason anybody tidies up |
| Student deleted | **drops** | Same as above. The owner's own design: a leaver is deleted and the cost goes with them |
| Student re-admitted in July | **rises** | A returning child is a child. Their old record is reused (§7.1) so the history survives, and they count again from the day they are active again |
| Student moved between branches | **no change** | One head count for the organisation (§3.6). A transfer is not a create and not a delete, and `20260811000053`'s trigger moves the row rather than copying it |
| Duplicate records merged | **drops by one** | Two rows were two students to the counter, which is the honest reading while both were active. Merging is a correction and takes effect from the day it happens — **not backdated**, because a backdated head count would reprice settled days and §11.10 forbids that |
| Teacher switched off | **drops** | The seat is genuinely freed the moment the switch flips — this is why `deleteTeacher` refusing on history bought nothing |
| Teacher switched back on | **rises** | Same day, same rate |
| Teacher record deleted | **no further change** | They were already off: removal is only permitted on an off teacher (§5.5), so the rate moved at the switch and not here |
| Branch archived | **drops** | Institution's branch fee is per live branch. An archived branch's students are moved or deactivated first, so their count moves with them and not twice |
| Bulk import of 200 | **rises, at once, for all 200** | All-or-nothing: the paste lands whole or not at all (§10), so there is no partial state to price. This is the one place the rate can jump without the owner meaning it to — §20.5's informed consent at the door is the fence, and a founder grant is the repair |
| A create that failed halfway | **no change** | There is no halfway. Every create is one transaction |
| Organisation moved to another plan | **rate changes tomorrow** | Yesterday was yesterday's rate (§11.6). Nothing is pro-rated because there is no period to divide |

**Today's charge is the high-water of today, and that is the only stored-looking rule
here.** §11.7 step 4: the first write of the day charges today at the size at that moment,
and a later write tops it up if the size has grown. So a centre that adds forty students at
noon pays today at forty-more, and a centre that deletes forty at noon pays today at the
morning's size and the *lower* rate from tomorrow. Both directions are deliberate:

- It cannot be bypassed, because it is one `insert … select` inside `settle_billing` under
  the per-centre advisory lock, and `requireWritable` is the only door to a write.
- It is **snapshotted on the entry** — `usage_students`, `usage_teachers`,
  `usage_branches` (§11.7) — so no high-water mark is stored anywhere to drift, and the
  billing history screen can show the count each day was charged at.
- It is **visible to the customer**: §20.4's history lists each day with its count and its
  rate. A charge a customer cannot reconstruct is a charge they have to trust us about.

**If the count cannot be read, nothing is charged.** A failed count does not become zero
and does not become yesterday's figure. The day is left unsettled, a
`settlement_failure` entry records the attempt, and `charged_through` does not move —
which means access stays whatever the *existing* `charged_through` already earned. §11.13
is what happens next. Guessing here would be the one bug that charges a customer for a
number nobody can explain.

### 11.13 When settlement cannot be trusted 🚧 → ✅ (built 2026-09-13)

**Access already survives this, and that is the design.** §11.7: access is
`balance < owed` where `owed = (today − charged_through) × rate`, a comparison over two
columns. So a settlement that never ran does not hand out free product — `owed` grows by
itself — and a settlement that ran twice charges once, because the day's base charge is
unique per `(centre, charge_date)`. The failure modes below are therefore about **the
books**, not about the fence, and that is what makes them safe to repair by hand.

**A settlement attempt has a status, and a failed one leaves a row.** Charging is one
statement, so there is no half-charged day; what there is, is a day that could not be
charged. `settlement_runs`: `id`, `coaching_center_id`, `charge_date`, `status`
(`settled` / `insufficient_balance` / `usage_unavailable` / `error`), `attempt`,
`price_version_id`, the three usage counts, `amount_poisha`, `error_detail`, `ran_by`
(`system` / `founder` / `session`), `created_at`, unique on
`(coaching_center_id, charge_date, attempt)`.

Two of those four statuses are ordinary and must not read as alarms:

| Status | What it is |
|---|---|
| `insufficient_balance` | **the product working.** The balance cannot cover a whole day (§11.7: charge the whole day or nothing), so nothing is charged and the centre is read-only until they top up. Expected, frequent, not an incident |
| `usage_unavailable` | the count could not be read. **This is an incident**, and the only one that needs a human |
| `error` | anything the function itself raised |
| `settled` | the day was charged |

**Reconciliation is a query, not a job.** Three questions, each answerable in SQL and each
on the founder panel — built as `public.platform_reconciliation()`, gated on
`app.is_platform_admin()` exactly as `platform_centers()` is, drawn on `/founder`:

1. Does `balance_poisha` equal `sum(amount_poisha)` for every centre? *(A trigger maintains
   the column; this is the test that it is telling the truth.)*
2. Does every row's `balance_before + amount_poisha` equal its `balance_after`, and open
   where the one before it closed? *(The chain from §11.7 — the CHECK holds the first
   half, the walk holds the second, which no constraint can express.)*
3. Does the line lag a day that was paid for, or run past today and past every payment
   with nothing to explain it? *(The literal "gap in charged days" of the first draft
   cannot be asked — a centre that ran dry for three days has three legitimate uncharged
   days between charged ones, and flagging them would cry wolf on the product working.
   The checkable invariant is that `charged_through` never sits behind a paid day.)*

The walk orders by `created_at`, which migration 81 switched to `clock_timestamp()` —
`now()` is frozen per transaction, so the two charges a catch-up writes in one call
shared a stamp and read in a random order, finding breaks that were not there.

Any answer that is not "none" is a **reconciliation alert** on the founder panel, and the
panel is where it lives rather than an email, because an email nobody reads is worse than a
figure on a screen the founder opens daily anyway.

**A founder can retry one day, by hand, and it is the same function.** `settle_billing` is
already idempotent per day, so a manual retry is a call with a written reason that inserts
a new `settlement_runs` attempt — never an edit of the failed one, and never a path that
writes a charge the function would not have written itself. The two levers (§11.7) remain
the only way to *change* a figure, and both need a reason and are audited.

**The cron is a convenience and says so out loud.** `/api/cron/settle` calls the same
function for every centre so an owner who has not logged in still sees a current figure. It
is not load-bearing: no `CRON_SECRET`, a missed delivery or a Vercel outage changes no
access decision. The one thing it must never do is a *different* calculation from the
session path — same function, one implementation, or the nightly figure and the on-use
figure are two billing engines.

**What is logged, and what is not.** A settlement failure logs the centre id, the date, the
status and the SQLSTATE. It does not log a student's name, a guardian's phone number, a
transaction id or a balance — a log is a place data leaks from, and none of those four are
needed to fix a settlement.

### 11.14 Off the postpaid model: what every old field becomes 🚧

**There is a live customer on the old model.** UDVASH is a real centre with a real
admission of 2026-09-03 in it, so this is not a greenfield switch — and §14's rule holds:
*do not delete old billing data until the new system is verified, and do not leave two
billing systems active accidentally.* The second half is the dangerous one, because the old
model's fence and the new model's fence would both be live and would disagree on the day it
mattered. That is why §16.1 step 24 deletes the `paid_through` derivation **in the same
commit** that reads access from the balance.

| Old | New | Disposition |
|---|---|---|
| `payments.amount_bdt` | unchanged — still the cash that arrived, still revenue | **preserve.** A recharge writes one of these too (§11.9) |
| `payments.covers_period_start/end` | **nothing.** A recharge covers no period | **preserve the columns, stop writing them.** Historic rows keep their windows; the columns become read-only history. Dropping them would destroy the only record of what pre-balance customers were sold |
| `coaching_centers.paid_through` | `charged_through` — a different question with a similar shape ("paid up to" vs "charged up to") | **archive.** Stops being read at step 24, stops being maintained when its trigger goes, kept as a column so the backfill is auditable |
| `app.refresh_paid_through` + the derivation inside `platform_centers()` | one trigger from the ledger | **replace both.** Migration 74's own docblock records that `paid_through` is derived in *two* independent places; two becomes one, and the one lives with the ledger |
| `GRACE_DAYS = 7` in `entitlement.ts` | **nothing.** No grace in any form (§17) | **delete, with its tests, in step 24** |
| `coverageLapsed()` | `balance < owed` | **replace** |
| `coaching_centers.status` | unchanged. `suspended`/`cancelled` still force read-only and still outrank a healthy balance | **preserve** |
| `status = 'trial'` as access-granting | founder-granted days (§11.7), which is money-free and has an end date | **migrate:** any live `trial` centre gets granted days to the same end date, then reads as `active` |
| `coaching_centers.student_capacity` | **nothing.** No seat to buy | **archive, last (§16.1 step 28)** |
| `plan_allowances.included_students` | **nothing on a per-student tier.** Still the ceiling on the teacher tiers | **preserve** — §2.7's engineering ceilings do not move |
| `subscriptions` (empty) | **nothing** | **leave.** §17 already records why: an empty table is a record of what was tried, and dropping one is a migration that cannot be undone |
| `payment_intents.purpose`/`quantity`/`grants_capacity` | one purpose: a top-up | **preserve the columns**, and the enum keeps its old values so historic intents still read. New intents use the top-up purpose only (§11.2) |
| `payment_intents.provider`/`provider_ref` | unchanged, and this is where a bKash trxID lives | **preserve.** §11.3's provider abstraction is already the right shape |
| Negative `payments` rows (migration 74) | still how money owed back is recorded; a ledger `refund` entry accompanies it | **preserve** |

**The opening balance, and it is deliberately generous.** Every centre with
`paid_through` in the future has bought days nobody can take away, so the backfill is:

```
charged_through      = greatest(coalesce(paid_through, today), today)
migration_opening_balance = 0
```

`greatest(…, today)` is the whole of the safety: a centre whose coverage already lapsed
gets `charged_through = today` and owes nothing for the past, because charging a customer
retroactively for days they were never billed for would be the worst possible first act of
a new billing system. A centre with coverage to 30 September keeps every one of those days,
as granted days rather than as money — they did not buy taka, they bought a period, and
converting one into the other would invent a figure. One `migration_opening_balance` entry
per centre, zero-amount where there is no money to carry, so **every centre has a first
ledger row and none has a balance that came from nowhere.**

**Verified before anything is deleted, in this order:**

1. The ledger and the burn land additive (steps 21–22). Nothing reads them.
2. `settle_billing` is run against every live centre on a **restored copy** of production,
   and the resulting `charged_through` is diffed against `paid_through` centre by centre.
   §24's rule — no production data in development — is why this is a restore into a
   throwaway Supabase project and not a local dump anybody keeps.
3. The two derivations are compared *in production* for at least one full day, with the old
   one still the fence: `platform_centers()` gains a column showing what the balance
   *would* say. A disagreement is a bug found before it locks anybody out.
4. Only then step 24 flips the fence and deletes the old derivation.

**Rollback is one revert, and that is a property of the order rather than a plan.** Steps
21–23 add tables and a function and change no behaviour, so reverting them is dropping
things nothing reads. Step 24 is the only irreversible-feeling commit, and even it is a
`git revert` plus re-running the old trigger's backfill, because `paid_through` and the
`payments` rows behind it are still there — which is the entire reason they are preserved
rather than dropped.

---

## 12. The security model

### 12.1 Two layers, and only one of them is trustworthy

**Layer 1 — the database.** Grants, revokes, RLS policies, triggers, constraints.
This layer holds against a hostile client because the client never talks to it
directly.

**Layer 2 — the application.** Server Actions, page guards, the entitlement
resolver, the friendly refusal messages. This layer makes the product usable and
explains itself. It is not security on its own, because **every Server Action is a
public HTTP endpoint** and a route guard protects a page, not a function.

The honest statement of where the product stands: plan, status and SMS credits are
tamper-proof at Layer 1 today — `UPDATE` is revoked on `coaching_centers`,
re-granted column by column, and a trigger raises `42501` if a session tries to
write the billing columns. **The numeric caps are Layer 1 too, as of
20260811000075.** Student places had been since 20260811000036; batches, subjects,
teacher records and children in one batch were counted only by the Server Actions
until now, and `batches`, `subjects`, `teachers` and `enrollments` all still grant
`insert` to `authenticated` — so an owner's own token, posted at PostgREST, walked
past every limit their plan sold them. Five ceilings, five triggers, one advisory
lock each.

The trigger and the action must never be able to refuse different things, which is
the whole design constraint: the counts mirror `limitRefusal`, `batchRoomRefusal` and
`fullBatches` column for column, the ceiling is read from `plan_allowances` through
the same live-trial resolution the screens use, and the refusal carries which of the
four it was — `limit=batches|subjects|teachers|seats` — so Layer 2 can still answer in
the owner's own words instead of relaying a SQLSTATE. A null allowance is no ceiling
rather than a ceiling of nothing, because a Coaching Center buys teachers by the head.

The exemption list is `postgres` and `supabase_admin`, and deliberately **not**
`service_role`: the service key is what every Server Action holds, so a fence that
let it through would be guarding only the caller nobody uses.

**What is still Layer 2 only: the feature flags.** No trigger enforces one. A flag
gates a screen and a write path rather than a row shape, so the analogue of a count
does not exist for it — the closest thing is the read-only enforcement the
entitlement resolver puts in front of twenty write paths, and that is an application
check. This is written down as a known limit and not as a plan; closing it would mean
teaching the database what each flag means, which is duplicating the resolver in SQL.

### 12.2 What a browser must never be able to do

Raise its own plan · change its own status · grant itself student capacity · mark a
payment successful · alter a subscription · edit or delete a financial record ·
grant itself a permission · **hand itself a role** · read or write another branch ·
read or write another organisation. Each of these gets a test that attempts it as an
authenticated non-privileged user and asserts the database refuses.

The role line was added because it was missing and the gap was real. `center_members`
carried one write policy, `for all` on `app.is_staff_admin`, which admits owner *and*
manager and said nothing about the `role` column — so a manager could run
`update center_members set role = 'owner' where user_id = <self>` from an ordinary
session, and everything above that reduces to a role check. 20260811000061 makes a
row carrying `owner` or `manager` owner-only on both sides of the write, which also
puts a manager's own membership out of their reach; a manager keeps the teacher,
guardian and student memberships that are the roster work the permission is for.
Twelve assertions in the RLS suite, six hostile and six controls, each rolled back so
that a leak on one line cannot flatter the next.

Making an admin role owner-only also made the owner the only person who can remove an
owner, so 20260811000062 closes the state that follows: a centre must keep at least
one *active* owner. With none, `app.is_owner` is false for everybody and the plan, the
roster of administrators and the audit log are all beyond reach — a support ticket
needing our service_role key, reachable by one owner tidying up their own roster. The
guard is an AFTER trigger so it asks the table rather than the row, counts the active
rows the policies count, and stays silent while the centre itself is being deleted,
since a guard that raised during the cascade would make every centre permanent.
Stepping down is still allowed the moment there is somebody to step down to.

**Existing protections are not to be weakened to make new features convenient.** If
a new feature needs a locked column, it gets a server path, not a re-grant.

### 12.3 Fail closed, always ✅

The doctrine, already followed throughout: **a failed read is not an empty answer.**
A count that came back `null` because the query errored must never be treated as
zero — zero means "you have room". The refusal is *"could not check your limit"*,
which is honest and safe. Applied to capacity, an unreadable capacity figure blocks
the purchase rather than granting the seat.

`planFor(anything unknown)` returns Teacher Free. An unreadable membership yields no
permissions. A plan without staff answers false to all five staff permission
helpers.

### 12.4 Concurrency is a security property here ✅

Two managers adding the last available student place at the same moment must not
both succeed. Reading a count and then inserting is not enough — the gap between the
two is where the extra student gets in.

The mechanism already exists in this codebase and is the one to copy: receipt
numbering takes a **transaction-scoped advisory lock** keyed on the centre before it
reads `max()`, so the second writer waits a few milliseconds rather than colliding.
Capacity enforcement does the same thing — lock the organisation row, count the
active students, compare against paid capacity, insert or raise — inside a **BEFORE
INSERT trigger** so it holds no matter which code path inserts the student, including
the bulk-import function and any future one.

Built, and now five times over: students on their own lock, then batches, subjects,
teacher records and seats in a batch each on theirs, keyed on the centre except seats,
which are keyed on the batch so two managers filling two different batches do not
queue behind each other. The counting helpers are deliberately **volatile**, which
looks like a missed optimisation and is not: a stable function reads the snapshot the
statement began with and cannot see the rows that same statement is inserting, so a
five-hundred-row paste would pass one ceiling five hundred times.

This is also what makes bulk import all-or-nothing: it is already a single
transaction, so a capacity check inside it either passes for the whole batch or
rolls the whole batch back. Zero students created on failure is the default
behaviour of the design, not a cleanup step.

### 12.5 Secrets ✅

The service-role key is server-only: never imported into a client component, never
returned from an action, never logged, never committed. `.env*` is gitignored with a
single `.env.example` exception. SMS and payment provider credentials live under the
same rule. Tokens, not passwords, for anything scriptable.

---

## 13. Tech stack — corrected ⛔→✅

The old masterplan described a stack this product does not use. Superseded:

| | Old plan ⛔ | Reality ✅ |
|---|---|---|
| Frontend | React + Vite PWA | **Next.js 16** (App Router, RSC, Server Actions), React 19 |
| Styling | — | Tailwind v4 |
| Hosting | Cloudflare Pages | **Vercel** |
| Vercel | *"excluded deliberately — Hobby forbids commercial use"* | in use; commercial use needs a paid plan, which is a cost line, not an architecture |
| Guardian messaging | Email (Brevo/Resend) + Telegram | **tap-to-send SMS / WhatsApp / call** from the owner's own phone |
| Backend | Supabase | Supabase — unchanged ✅ |

The email-and-Telegram plan died for a good reason and it is worth keeping the
reason: Bangladeshi guardians do not read email, and Telegram is not installed on
the phones in question. SMS is what a parent reads, so the product routes around the
absence of an SMS gateway by handing the message to the owner's own phone rather
than pretending to send it.

Notable current configuration: typed routes, `authInterrupts` (so `forbidden()`
works), and an offline mode that replays pending requests when the network returns —
safe only because idempotency keys were added to both payment tables first. The
service worker may cache static assets and the offline page and **nothing
authenticated**: no HTML, no RSC payloads, no API responses.

---

## 14. Going to market

Unchanged from the old plan where it was right, and it was mostly right.

**We do the data entry.** A centre becomes a customer when somebody sits down with
their register — a notebook, or a spreadsheet a nephew made — and puts it in the
software. We do that, by hand, before the owner ever logs in. An empty account is
homework, and homework dies in a drawer. This is why bulk import exists as a
database function rather than a form.

**Three design-partner conversations before the price is fixed.** The ৳1,999 floor,
the ৳25 first band, the ৳4,999 Institution floor and the ৳750 branch fee are a
founder's judgement with no market survey behind them. They are structurally sound
and numerically unproven, and the first twenty customers will all sit in the first
two bands.

**No card on file, no auto-charge.** Customers pay monthly by bKash. Friction is
acceptable under fifty customers, because the monthly conversation is when churn
gets caught. What must be automatic is only the *consequence* of not paying.

**Free is marketing.** One batch, thirty students, no printed receipt, no export, no
parent summary. It is a working product and an advertisement at the same time, and
the things it withholds are precisely the things that make a teacher look
institutional in front of a parent.

### 14.1 The pages that must exist before the first taka ❌

**None of them exists.** `src/app` has no marketing or public route group at all — the
whole product is behind a login — so today a customer sends ৳7,800 to a personal bKash
number against no written terms whatsoever. That is the single largest non-technical risk
in this document, and it is worse here than on an ordinary SaaS for one specific reason:
**the balance is non-refundable and never expires** (§11.6). A non-refundable prepayment
with no terms behind it is a dispute we would lose by having nothing to point at.

| Page | Why it cannot wait |
|---|---|
| **Prepaid Billing Terms** | non-refundable, never expires, the daily burn, that the rate follows the centre's own size, that a promotion bonus is credit and not cash, what happens when the balance dries up (read-only, nothing deleted), and that verification is by hand within a stated window |
| **Refund & Cancellation** | says plainly that credit is not refundable and what *is* offered instead — a founder adjustment where we got something wrong. §11.6 already commits to saying this before the tap; this is the page that tap links to |
| **Terms of Service** | who may use it, one account per human, that a centre-issued login belongs to the centre, suspension grounds |
| **Privacy Policy** | what is held about students and guardians, why, for how long, who inside a centre can see it, and that we do not send student records to any AI provider (§24). Minors' data is §7.6 and this is where a parent can read it |
| **Acceptable Use** | no using guardian numbers for anything but this centre's own communication — which matters, because tap-to-send SMS makes a roster into a mailing list |
| **Account Deletion & Data Export** | how a centre leaves with its data. The export screen already exists; the promise does not |
| **Security & Contact** | how to report a vulnerability, and one real phone number — 01756211762 is already the number a customer chases a recharge on |

**Consent is a row, not a checkbox.** `policy_acceptances`: `id`, `profile_id`,
`coaching_center_id`, `policy_kind`, `policy_version`, `accepted_at`, and — only where
there is a legal reason to hold it — `ip`. Versioned, because a term we change is a term
somebody agreed to a different form of, and "they ticked a box once" is not an answer when
the box has been re-worded twice. Recorded at signup and at the first recharge, and
re-asked when a version changes. Nothing about a student or a guardian is in this table:
the person accepting is the account holder, and a child cannot consent to a contract.

**Written in both languages, and the Bangla is the one that matters** — the reader is a
coaching-centre owner in Mymensingh, not a lawyer in Dhaka.

**What these pages must not claim.** No certification, no standard, no compliance framework
we have not actually been audited against (§24). "We encrypt data in transit and at rest" is
true because Supabase does; "GDPR compliant" and "ISO 27001" are not ours to say and would
be the kind of false statement that turns a small dispute into a large one.

---

## 15. Where the build actually is

A summary; §16 has the order. Detail lives in the audit delivered alongside this
document.

**Built and enforced ✅** — the four plan definitions and one pricing engine;
numeric caps and feature flags checked server-side on every write path, failing
closed; plan/status/SMS-credit/capacity columns tamper-proof at the database;
attendance including an offline mode; exams and marks; fee invoices, partial
payments, a waiver typed as a figure, taken as a share of the bill, or granted from an
award the centre named once and can total by name, voiding, arrears, month close, and the bills that are
not a monthly fee — admission, registration, exam, form and other income — raised for
one batch or a whole centre in a single press that is safe to repeat, and read back
per category under the month's billed line, or agreed in advance and collected in two
to twelve parts, which is N bills rather than a schedule beside one and so is arrears,
receipts, waivers and month close already working, each labelled *part 2 of 3* on the
board and frozen at the number it was raised as; append-only payments
with gapless receipt numbers; printable receipts and the collection register;
a payslip an employee signs, off the breakdown copied onto the payment row and not
off the agreement as it reads today; a voucher for money the centre paid out, whose
office copy comes first because the centre is the paying side, with three signature
lines and the month's spending in that category frozen at that voucher rather than at
a backdatable date; a receipt for money the centre paid us, the one sheet on our own
letterhead and the one behind no plan gate, numbered by the purchase code the owner
quoted rather than by an identifier invented for the paper, and showing the rate each
band of places was sold at, read off the quote it was sold from rather than averaged
out of the total;
tap-to-send messaging; bulk import in one transaction; teacher records that can exist
without accounts, server-generated usernames and signing in with either one;
teacher→batch→student scoping in RLS; tenant-safe composite branch keys; employees,
payroll and expenses; profit; branch money side by side at HQ; the two dashboards, the
centre's on the home screen so that no figure on it is printed twice anywhere else and
the organisation's as the total row of the branch comparison, each saying which of its
own terms it could not read rather than subtracting a missing one; student capacity as a
column of its own, with the ceiling resolved server-side, the race closed by an
advisory lock, and the three ways past it (one student, an import, a branch that has
run out) each priced and sold; payment intents behind a provider interface with the
manual bKash transfer as its first provider and the founder confirming the money
arrived; the entitlement resolver, with read-only enforced in front of twenty write
paths, and a subscription that suspends itself seven days after the period it was
paid for; a fourteen-day Teacher Pro trial that starts itself at signup, ends on the
clock, says so on screen while it runs and for a week after, and grants its places at
the trigger as well as on the screen; a founder panel that records real money and
bills each customer for the buildings they actually run, from the same count the
owner's own branches screen prices; an
append-only audit log written by seventeen triggers inside the transaction that made
the change, named for the reader in one tested module that a gate now checks against the
triggers themselves, resolved to the person each
line is about even where the stored snapshot cannot say, and read by the owner alone;
an admin role that only an owner may hand out, and a centre that cannot be left
without one; capabilities as a `text[]` on the membership rather than an enum, so an
owner can appoint an accountant who never sees the roster or a receptionist who
never sees the money, with the narrowing enforced per table as a restrictive policy
and every screen it would otherwise fill with noughts refusing at the door; and
attendance that says who took the register rather than only who last touched it,
so a manager's correction is allowed, logged, and named a correction on the screen
that makes it (§6.3); and owner signup that verifies an email address — Supabase's
own confirmation flow, a six-digit code checked inside the same call that establishes
the session, with staff accounts minted confirmed and exempt by construction (§5.4).
And one teacher can no longer be in two rooms at
four o'clock: the rule is enforced on the day rows, which are the last thing a save
writes and so the only moment a batch's routine is whole, and stated a second time in
the form so the refusal can name the batch, the day and the hour instead of raising
(§7.3). And an owner five per cent from full is told which of their buildings the places
went to, counted as students still on the register so the breakdown adds up to the
organisation-wide figure beside it, and never as a quota (§3.7). And a student moving between branches is
one row with its `branch_id` changed rather than a new child with no history, with the
move recorded by a trigger rather than by the code that saved it, so a move nobody
logged is not a thing the app can produce (§7.2). And an owner can move their own centre
up a tier without the founder doing it from their laptop: the months are quoted from the
tier being bought, the purchase carries that tier, and the settlement moves the plan when
the money lands — the same intent, the same idempotency key and the same service-role
write as any other purchase (§11.2). And money can now go back the other way: a platform
payment may be negative, so the credit a mid-term move or a downgrade owes has a row to
live on instead of a phone call — no coverage window and no intent on it, because
`paid_through` is a `max()` of the windows and a minus sign dated 2099 would buy permanent
access; a reason required at the table, because there is no UPDATE path to add one later; a
floor held by a trigger under an advisory lock, so no centre can be credited past what it
has paid; and the sheet it prints is headed as a credit note rather than as a receipt for
minus money, off one function the list and the printable both read (§9.2).
And the four ceilings a plan sells besides student places — batches, subjects, teacher
records and children in one batch — are counted by the database now and not only by the
Server Actions, which is the last of §12.1's Layer 1 work: those four tables still grant
`insert` to `authenticated`, so an owner's own token posted straight at the API walked past
every limit they had been sold. The triggers count exactly what the actions count, resolve
the ceiling through the same live trial, say in the error which of the four refused so a
screen can answer it in the owner's own words, and exempt the migration runner but not the
service key — a key every form holds, so exempting it would have left the fence guarding
only the caller nobody uses. A branch is a bucket in that count solely on an institution
plan, where head office is a place of its own rather than a wildcard (§8, §16 step 20).
1,466 RLS assertions and 1,601 unit tests green across 81 migrations and 44 tables in
`public` plus one in `app`, and four derived gates and two that ask the live API. One of those gates now refuses
a query whose table name it cannot read, having discovered it had been counting five
fewer than existed — and the RLS suite found a manager who could promote themselves
to owner, which is what a suite is for. The SQL gate now also hands out our own
`CD` SQLSTATEs: one rule per code, every code named in `src/lib`, which caught a plan
ceiling about to be raised on the code the teacher clash already owned.
And the app has a menu at last: a sidebar on a laptop, the phone's four daily tabs with a
no-JavaScript sheet behind them, and in it the six screens — spending, salaries, drifting
away, notices, the week, the head office — that had been built, guarded and tested for
weeks while being reachable only from a card on the dashboard. Each row asks exactly what
its own page asks, from the session the layout already holds and so at no cost in queries; a
capability the owner unticked removes a row, and a plan the centre has not bought greys one
and leaves it there, because that row is the only place the product mentions the tier
(§20.1–20.3).
And the heading no longer scrolls away with the first ten rows: `components/page-header.tsx`
is drawn by forty-four of the forty-nine screens under `(app)`, which is all of them but the
four printed sheets and the fee register, whose `<h1>` is the centre's own name on a page
handed across a desk. It is one 56px line that sticks to the top of the workspace and
returns a *fragment*, because a sticky box only travels inside its containing block — which
is why no screen may hand it to a grid as a twelfth-column cell, why every sticky rail in
the app starts at `top-16`, and why a screen with a narrow form caps the card and not the
column: a `max-w-*` on the column holding the bar stops its full-bleed background at 672px
and leaves rows scrolling up through bare page either side. Its gate names the five
exceptions rather than counting the adopters, so the next screen added without a heading
fails a test instead of shipping (§20.1).
And a register written with dashes now reads as columns rather than as one long name:
`Rahim Ahmed - Abdul Karim - 01712345678` was arriving as a single student called
"Rahim Ahmed - Abdul Karim" with no guardian — the father's name welded onto the child's,
on every row of the paste, into the one field §7.1 makes unfixable after creation. A dash
is a column only with space on both sides, in all three of hyphen, en dash and em dash,
which is what keeps `Abdul-Karim` and `আব্দুল-করিম` one name; the same alphabet the phone
finder already accepts *inside* a number, applied to the gap *between* fields (§21).

**Two things this document had assumed about the code that turned out to be false**, both
checked rather than reasoned about, and both recorded here so nobody spends a day
implementing what is already there. **The search boxes make no requests to debounce.**
`components/search-box.tsx` is a `<form method="get">` with `name="q"`, a `defaultValue`,
a `maxLength`, `enterKeyHint="search"`, a visible submit and a second form for Clear — no
JavaScript, no keystroke handler, and `lib/search.ts` filters in memory over rows the page
had already fetched. So there is nothing to debounce and no request to abort, and adding a
client-side search would *lose* three properties: the query is in the URL, so it is
bookmarkable, shareable and survives a back button; it works with JavaScript off; and the
service worker's shell can answer it. **And the paged reads refuse rather than truncate.**
`lib/supabase/page.ts` holds `PAGE_SIZE = 1000` and `MAX_PAGED_ROWS = 20_000`, a
`PageFailure` of `'unreadable' | 'tooLarge'` with `worstFailure()` letting `tooLarge` win,
and a `pageOrNull` that returns null rather than a short list — because a query that
outgrows its ceiling does not break, it starts lying, and every screen in this product
already tells a failed read apart from an empty one.

**Partly built ⚠️** — branches (isolation, money, staff, the HQ comparison and the growth
breakdown yes; the drill-down into one branch's workspace no, because `app.branch_ok`
reads the membership's own branch and not a chosen one — §8.3); scheduling (weekly
recurrence and teacher clashes,
no rooms or overrides); plan selection (an owner may buy a move up and buy places; a move
*down* is still a conversation — the credit it owes has a row and the founder can write it,
but nothing on the owner's own screen works out what their unused coverage is worth);
income with no student behind it (hall rent, book sales and the like have a category
but no row to hang it on — every revenue row is a bill against a child).

**Built ✅** — **the retirement of capacity: step 28 of §16.1, and with it the last of §18's
fourteen bullets. Nothing the old seat model sold is a live door any more.**
Steps 21 through 27 have landed and are read by the application: the ledger (21),
`price_versions` with the reconciliation test that holds it to `plans.ts` (21a),
`public.settle_billing` charging whole days at the high-water rate with the top-up as a row
of its own (22), `settlement_runs` with `platform_reconciliation()` (22a), the derived daily
rate (23), `session.access` from the balance **in the commit that deleted `coverageLapsed`,
`GRACE_DAYS` and the `paid_through` derivation with their tests** (24), the recharge claim
with its founder queue and `promotions` (25), the seven legal pages with `policy_acceptances`
(25a), the two founder levers — a money adjustment and granted days, each with a written
reason (26, `20260811000086`), and `/settings/billing` rebuilt on §20.4's five questions
with the day-by-day history read off the ledger (27). Migrations 82–86 are applied to the
project, `src/lib/supabase/types.ts` is regenerated, and `lib/billing/provisional-types.ts`
is gone with them, and `20260811000087` now too. Step 28 is built, and it landed in three
passes rather than one. The buy controls went first — `plan-cards.tsx`, `ask-row.tsx`,
`buy-subscription.tsx` and the four places components, all deleted — after which nothing in
`src` can quote a seat or a branch, and the pricing engine's `seats()` and `branches()` are
left with no caller. Then the vocabulary: `ceiling`, `studentRoom`, `capacityPressure`,
`quoteSeats`, `capacityBands`, `nextSeatCostBdt` and `ASK_PLACES`, which had no consumers
left to break. Then the mechanism itself, which is what the migration is for:
`app.student_ceiling` stopped reading `coaching_centers.student_capacity`, so a per-student
tier has **no student ceiling at all** (§3.3) instead of the 79 or 238 the floor used to
leave it at, and the teacher tiers keep the allowance §2.7 always had.
`settle_payment_intent` refuses an intent priced to add places rather than taking money for
a ceiling it can no longer raise, and the guard's refusal stopped offering to sell one — its
sentence names a higher plan now, which is the thing that can still help. **The column is
archived and not dropped** (§11.14) and the enum keeps all four of its values, so a historic
intent still reads: `src/lib/supabase/types.ts` regenerated from the live project with not
one line changed, which is the proof that 87 added and removed nothing. The one item that could
not wait for either has already been done: §14.1's terms existed before the first taka could
arrive, and the recharge screen's non-refundable line links into them. Observability (§34) is
three files containing a `console.error` and two cron entries in `vercel.json`: the SMS
drainer, and the nightly settle that §11.7 describes. Also: the five `teacher_permissions`
booleans folded into the capability vocabulary — they work, and four `app.can_*` resolvers
enforce them in the database, but they are still five columns rather than words in a
`text[]`, and §6.2 says why that waits;
an award that applies itself to a
student's every future bill; rooms, per-date overrides and a holiday
calendar. The `subscriptions` table is still unread and unwritten and
`payments.subscription_id` still always null — deliberately, and §17 says why: what a
member's session needs to know is the one date on the centre, and that date is derived
from the payments themselves.

**Blocked 🚧** — automated SMS (a BTRC sender ID needs an aggregator account which
needs an NID); the real bKash integration (credentials pending — held by the owner's
decision of 2026-09-13 along with automated SMS, both deliberately, until the legal
and integration work is worth doing); price validation (needs the
design-partner conversations).

---

## 16. Build order

Sequenced so that each step is enforceable when it lands, and nothing depends on a
blocked thing. **Foundations before features**: identity and entitlement before
money, money before reporting.

| # | Step | Why here |
|---|---|---|
| 1 | This masterplan | everything else is measured against it |
| 2 | Schema: capacity, trial, statuses, usernames, employees, expenses, payroll, audit, branch scoping | one migration wave, so the app is never half-shaped |
| 3 | Entitlement resolver + trial as a state | every later gate calls it |
| 4 | Plan/status/capacity columns into the billing guard | close the fence before filling the field |
| 5 | Capacity trigger with the advisory lock | the race, closed in the database |
| 6 | Teacher record → login account, server-generated usernames | unblocks phone-optional staff |
| 7 | Sign-in on phone **or** username | must not break existing accounts |
| 8 | Owner/manager OTP behind a provider interface | the security hole; delivery stays stubbed |
| 9 | Capability-based permissions | before new roles need them |
| 10 | Teacher-centric attendance + manager override marker | presentation and accounting |
| 11 | Center capacity UI: the in-place top-up dialog | the first thing a customer touches |
| 12 | Bulk import priced and gated on payment | all-or-nothing already holds |
| 13 | Branch scoping end to end + cross-branch leak tests | before any branch reporting exists |
| 14 | Shared capacity pool + the three warning thresholds | needs 5 and 13 |
| 15 | Employees, expenses, payroll | the finance module's own foundations |
| 16 | Revenue categories, collected-vs-charged, profit | needs 15 |
| 17 | Center dashboard, then Institution HQ dashboard | reporting last, on settled data |
| 18 | Audit log wired into every step above | written with each change, not bolted on |
| 19 | Payment intents + manual provider | real, and bKash-shaped |
| 20 | Cap and feature-flag enforcement pushed into Layer 1 | finishes what capacity started |

All twenty have landed. That is not the same as finished — §15 says what each one left
partly built — but no step of the order is now waiting on another, which is why the work
below it can be taken in the order of what the product most visibly lacks.

**Steps 11, 12 and 14 describe a mechanism that no longer exists** (the top-up dialog, the
priced import, the shared capacity pool as a quota). They are left in the table because it
is a record of what was built and when, not a plan — and because the code they produced is
what §18 now names for removal. The order that replaces them is below.

**Core, and nothing beyond it:** the four plans, the trial, entitlement, capacity
with atomic enforcement, single and bulk top-up, branch isolation, the shared pool,
teacher accounts and usernames, phone-or-username sign-in, owner OTP,
teacher-centric attendance, fees with part payments, discounts and instalment plans,
refunds, expenses, employees, payroll, revenue and profit, the two dashboards, the
audit log, payment intents, teacher clash detection, per-branch capacity *reporting*
(never per-branch quotas).

### 16.1 The order the prepaid balance lands in ⚠️ current work

**Decided 2026-09-05.** Sequenced on one rule: **every intermediate state must be safe,
which means additive before subtractive.** Until step 28 the old capacity fence is still
standing, so a half-landed balance can only ever be stricter than the model it replaces —
never looser.

| # | Step | Why here |
|---|---|---|
| 21 ✅ | The ledger: poisha, append-only, `balance_before`/`balance_after` chained by CHECK, immutability trigger, `balance_poisha` + `charged_through` on the centre row maintained by trigger, and the backfill (§11.14) | additive; nothing reads it yet, so it cannot lock anybody out while it is proven |
| 21a ✅ | `price_versions`, seeded by migration, with the reconciliation test against `plans.ts` (§11.10) | step 22 charges from it, so it has to exist first — and the test has to exist before there are two copies of four numbers |
| 22 ✅ | `public.settle_billing` — advisory lock, one base charge per (centre, Dhaka date), the high-water top-up as its own row, whole days only, usage snapshot and price version on every entry | the burn, still read by nothing |
| 22a ✅ | `settlement_runs` and the reconciliation on the founder panel (§11.13), as `platform_reconciliation()` | the same commit as the burn, because a failure with no row is a failure nobody finds |
| 23 ✅ | The daily rate in `plans.ts`, **derived** from `monthlyBillBdt` and never typed in | `seatsCoveredByFloor`'s docblock sets the precedent: three numbers that must change together is a bug waiting |
| 24 ✅ | `session.access` from the balance, **in the commit that deleted the `paid_through` derivation and `GRACE_DAYS`, with their tests** — after §11.14's four verification steps | the one step that is not additive, and the reason is §4.4: two live derivations of access would disagree on the day it mattered |
| 25 ✅ | The recharge claim as a payment intent (§11.9), `promotions` (§11.11), the founder review queue, approval under `requirePlatformAdmin` with audit | money in. Before this, the only way to credit a balance is a founder writing SQL — which is exactly why 21–24 must be provably right first |
| 25a ✅ | The seven legal pages and `policy_acceptances` (§14.1) | **the same week as step 25 and not later.** The first taka must not arrive against no written terms, and the recharge screen's non-refundable line has to link somewhere |
| 26 ✅ | The two founder levers: a money adjustment and granted days, each with a written reason (`20260811000086`) | the answer to every scenario §11.8 could not fence — a closure, a mis-paste, a founder who was asleep |
| 27 ✅ | `/settings/billing` rebuilt on §20.4's five questions, with the day-by-day history showing each day's count and rate (§11.12); the plan page's 1,253 lines demolished to a redirect; the calculator folded in | the screen can only be built once there is a balance to draw |
| 28 ✅ | **Capacity retired in code** — §18's fourteen bullets, `student_capacity` last (`20260811000087`) | subtractive, and deliberately after the burn is proven in production on a real centre |

Steps 21–24 are one week's work and the whole of the risk. Step 28 was a day and could not be
started early: removing the ceiling before the rate is charged is the one ordering mistake
that would give the product away — and it was not one, because the ordering held. The burn
charged real centres a real rate for two days before the ceiling changed what it means.

**Alongside, not after:** the read-only sweep on `fees`, `fees/reminders` and
`teach/[batchId]`. Read-only stops being an edge case the day step 24 lands — a centre
that has not topped up is read-only on an ordinary Tuesday — so the three screens a centre
uses every day are the three that must not look broken in it (§4.4).

**Future, documented and not built:** rooms and room double-booking, holiday
calendars, term dates, an admissions pipeline, automated SMS and the parent summary
as a scheduled job, a student or guardian panel *(decided against, not deferred)*,
multi-currency, accounting-package export, biometric attendance, per-operator SMS
pricing.

**Do not build a future feature because it is written down here.** The list exists so
that a good idea has somewhere to live that is not the codebase.

---

## 17. Decisions worth not re-litigating

| Decision | Reason |
|---|---|
| No student or guardian panel | every parent-facing surface is a support channel and a privacy exposure; the parent's interface is a printed slip and an SMS |
| Pro trial is a **state**, not a plan | a fifth `PlanId` would fork every gate in the app |
| Teacher Pro is one teacher **at any price** | the wall between solo and organisation; making it purchasable rebuilds the tier overlap |
| No student ceiling on a per-student tier, and never "unlimited students" | a ceiling was only ever a proxy for what growth costs; the daily rate says it directly, and "unlimited" is a promise the pricing engine contradicts |
| The balance and the head count are the **organisation's**, never the branch's | one customer, one contract, one price — and a branch manager who could see or spend the balance is a second treasurer |
| Batches cap **per branch** | rooms are physical |
| Marginal bands, not flat per-tier rates | flat brackets make 101 students cheaper than 100 — ৳1,818 against ৳2,500 |
| The floor applies to the **student charge**, not the total | otherwise teacher seats vanish inside it |
| Price in months, burn in days | an owner compares monthly figures with a competitor; days are the honest unit only once the money is theirs |
| The daily rate is `floor(monthly × 100 / 30)` poisha | integers, and floored in the customer's favour: rounding up would make a year cost ৳434 more than twelve months and a 31-day month dearer than a 30-day one |
| Settlement happens **on use**, and the cron is cosmetic | a job that does not run must never hand out free product, and a job that runs twice must never charge twice; a comparison plus one row per (centre, date) is both at once |
| Trial expiry is a comparison, not a cron job | a cron that does not run hands out a free tier forever |
| No grace, in any form | a charge allowed to sit unpaid is credit, and this is a prepaid product |
| Suspended means **read-only**, not locked out | holding a centre's register hostage is how a customer becomes an enemy |
| Limits apply to new actions, never retroactively | nobody's data disappears on a downgrade |
| Refunds are counter-entries | the receipt in a parent's hand must stay findable |
| Manager attendance override stays, and is logged | an impossible override is worked around by password sharing |
| Teachers never need a phone or an OTP | the part-time teacher who will not be in a database is a customer's constraint, not ours |
| Usernames are memorable and server-generated | they are read aloud across a staffroom |
| Zero SMS credits on every tier | correct behaviour while no gateway exists; a counter decrementing against nothing is a lie |
| Teacher clashes are refused on the **day rows**, not on `batches` | the routine is written across two tables in three transactions, and the day rows are the last of them — checking anywhere earlier refuses saves that are legal two statements later |
| Back-to-back classes are not a clash | overlap is half-open; a rule that refused them would be worked around within a week |
| The growth breakdown counts **active students**, not admissions taken | a branch that admitted fifty and lost forty has not grown, and the active count makes the breakdown add up to the organisation-wide figure printed beside it |
| Views carry Supabase's default `anon` grant, and are protected by `security_invoker` | the privilege is not the fence — the caller's own policies are; and `check-embeds.mjs` can only verify a select shape it is allowed to ask for |
| `subscriptions` stays empty — and after 2026-09-05 so does the idea of a subscription | what every member's session has to know is now two numbers on the centre row, the balance and `charged_through`, both maintained by trigger from the ledger exactly as `paid_through` was maintained from the payments (§11.7). A subscription row would be a third answer to a question that already has one, and the two would disagree the first time an entry was written out of order. The table's own columns date it twice over: `billed_enrollments`, `unit_price_bdt`, `floor_price_bdt` and `renews_at` encode per-enrollment pricing that renews itself — §3 replaced the pricing with marginal bands, and §11.6 replaced the renewal with a balance that does not renew because it never expires. It is kept, unread, because dropping a table is a migration that cannot be undone and the columns are the record of what was tried |
| A tier move rides on the money that pays for it | it moves the plan through `settle_payment_intent` like every other paid thing, so the billing guard stays the only fence and no browser is ever nearer the `plan` column than a form that asks. Under one balance a *renewal* no longer exists to ride on, so the tier moves on the first top-up that pays for it |
| One purchase kind: a top-up | a seat, a branch and a place were three things to buy, three prices to keep honest and three ways to be refused at a door. They are now one thing the balance carries and a rate that changes (§11.2) |
| `src/lib/plans.ts` owns the numbers | one pricing engine; this document defers to it |

---

## 18. Retired assumptions ⛔

Listed so a future reader does not resurrect them from an old commit or an old doc.

- ⛔ React + Vite. It is Next.js 16.
- ⛔ Cloudflare Pages. It is Vercel.
- ⛔ *"Vercel is excluded deliberately."* It is not.
- ⛔ Guardian messaging by email and Telegram. It is tap-to-send SMS/WhatsApp.
- ⛔ A guardian-facing view. Decided against.
- ⛔ Per-enrollment pricing. A student taking three subjects is one student, not
  three — the old model billed ৳75 for one child at the ৳25 rate.
- ⛔ Flat tiers at ৳1,999 / ৳3,999 / ৳7,999. Replaced by floor + marginal bands.
- ⛔ "Unlimited students" on Center and Institution.
- ⛔ A 30-day product trial. The product trial is 14 days; the founder's 30-day sales
  trial is a different thing wearing `status='trial'`.
- ⛔ Teacher Pro at 300 students. It is 150, so the tiers do not overlap.
- ⛔ `overLimit()` as the enforcement function name — it is `limitRefusal()`.
  `docs/PLANS-AND-MESSAGING.md` still says otherwise and is wrong.

**Retired 2026-09-05 by the prepaid daily balance (§11.6).** All of these were correct for
a model that sold coverage periods and seats. None of them survives the change, and each is
named so the code that implements it can be found and removed rather than left to disagree
with §11.

- ⛔ **Purchased student capacity.** `coaching_centers.student_capacity`, the `capacity` arm
  of `StudentCeiling`, `quoteSeats`, `capacityBands`, `capacityCostBdt`, `nextSeatCostBdt`,
  `ASK_PLACES`, `capacityPressure` and every "places remaining" figure. Replaced by: there is
  no ceiling on a per-student tier (§3.3).
- ⛔ **The contextual seat purchase inside Add Student** — §9's *"automatically continue the
  student creation process"*. The principle survives in §3.4 as information; the transaction
  does not exist because there is nothing to buy.
- ⛔ **The bulk-import payment step.** Steps 4–6 of the old §3.5.
- ⛔ **The branch places request** and its resolution workflow (§3.7).
- ⛔ **Coverage periods as the gate.** `payments.covers_period_start/end` and
  `coaching_centers.paid_through` stay as *history* — a receipt records what it was for — but
  the entitlement resolver stops reading them, and a recharge writes no period at all.
- ⛔ **`GRACE_DAYS`, and grace in any form.** A charge allowed to sit unpaid is credit, and
  this is a prepaid product. Replaced by warning at 14/7/3/1 days (§3.7).
- ⛔ **Monthly invoices, bills, due dates and dunning.** There is no period to invoice.
- ⛔ **The peak-active-count billing rule.** It fenced a month boundary; daily billing has
  no boundary (§11.8).
- ⛔ **A whole-taka balance ledger.** ৳2,600 ÷ 30 is not a whole taka. Poisha, integer
  (§11.7).
- ⛔ **Mid-term downgrade credit arithmetic** — §11.5's open item. Nothing needs to work out
  what unused coverage is worth, because nobody holds coverage.
- ⛔ **`status='trial'` as an access-granting state.** A sales trial is granted days on
  `charged_through` (§4.4).
- ⛔ **A self-serve grace or emergency button.** Not built, on the owner's instruction, and
  the reason is recorded in §11.8 so it is not proposed again.
- ⛔ **A self-serve holiday pause.** Not built; founder discretion instead, with the reason
  in §11.8.
- ⛔ **Three of the four purchase kinds.** A student place, a teacher seat and an extra
  branch were each something to buy at a door that could refuse. Only a top-up remains
  (§11.2); the other three are rate changes the balance carries. `teacherChargeBdt`,
  `branchChargeBdt` and `nextBranchCostBdt` **survive** — they price the rate and answer
  "what would the next one cost", which §3.4 says must be shown. What goes is the
  transaction, not the arithmetic.
- ⛔ **Coverage as what a settled intent grants.** `settle_payment_intent` stops writing a
  period and starts writing a ledger entry. The tier move it also performs is unchanged.
- ⛔ **Locking a student's name at admission to stop seat recycling.** There is no seat to
  recycle. The name stays editable and identity edits are audited (§11.8).

**Retired 2026-09-13 by email signup (§5.4's rewrite).** The phone OTP gate was the
right answer to the wrong constraint: it closed a real hole, it was fully built and
tested, and it could never be switched on because an SMS route needed approvals that
were never coming. Email verification replaces it at zero marginal cost. Each is named
so the code that implements it can be found and removed rather than left to disagree
with §5.

- ⛔ **A phone number as a self-serve signup identifier.** Signup is by email; the
  number field is gone from the form and the phone arm is gone from sign-in. Staff
  logins minted by a centre may still be keyed on a number (§5.1) — that is the
  employer's register, not a self-serve claim.
- ⛔ **The phone OTP gate and its table.** `app.phone_verifications`,
  `issue_phone_code`, `verify_phone_code`, `src/lib/auth/otp.ts`, `otp-gate.ts`,
  `previewPhone` — built in `20260811000065`, removed unread by `20260811000079`.
  Supabase's email confirmation does the same job with none of the machinery:
  the code is checked inside one Server Action call, exactly the shape the phone
  gate had, minus a table, two functions, four ceilings and a transport.
- ⛔ **`phoneGateOn()` and `OTP_DEV_TRANSPORT`.** The condition that could never be
  true and the dev-only transport that existed only because of it.

---

## 19. Testing this document

A requirement without a test is a preference. The suites that keep this honest:

**Pricing** — every band boundary (100, 101, 300, 301, 600, 601); the floor at 1, 50,
79, 80; teacher seats at 0, 2, 3; Institution branches at 3 and 4; the bulk delta across
a band edge; monotonicity — the monthly figure must never fall as students rise. Then the
daily rate on top of it: `floor(monthly × 100 / 30)` at every one of those sizes, never a
float, never rounded up, and zero on both free tiers; thirty days of it never exceeding the
month it came from; and the bonus ladder — ৳2,600 / ৳7,800 / ৳15,600 / ৳31,200 crediting
৳2,600 / ৳8,190 / ৳17,160 / ৳37,440, a typed amount taking the highest band it reaches, and
an amount below one month taking no bonus at all. And what a purchase may claim: an intent
priced at one tier and asked for another is not quoted, the free tier is never a target, a
tier moves only on a top-up that pays for it, and the two tiers that bill the same number at
400 students are told apart before an idempotency key hands one back for the other.

**Entitlement** — trial active, trial expired, suspended, cancelled, unknown plan,
unreadable membership. Then the balance, which is now the interesting half: a balance that
covers today, a balance one poisha short of it, `charged_through` a week ahead because a
founder granted days, and — the case that must never regress — **a free tier with an empty
balance resolving to `full`**, because the rate is zero and zero is covered. Each asserts an
entitlement, not a screen.

**Settlement** — the fence that replaced the seat. One row per (centre, Dhaka date) under
concurrency: two sessions opening at once charge the day once. A day charged small and then
topped up as the roster grows, ending at that day's **high-water** rate, and the same day
never charged twice. The midnight-empty-roster vector: a roster emptied and refilled pays
the refilled rate. A balance that cannot cover a whole day charges nothing and leaves the
remainder theirs. The Dhaka date, asserted from a UTC session between midnight and 6am,
where `current_date` is yesterday. And the backfill:
`charged_through = greatest(coalesce(paid_through, today), today)` charging nobody
retroactively and starting nobody read-only.

**Ceilings that remain** — refusal at 30 and at 150 on the teacher tiers; reactivating an
inactive student refused when full; **two concurrent inserts at the last place, exactly one
succeeding**; a trialling teacher's thirty-first student admitted, the same insert refused
the day the trial ends, and the thirty-one already on the roster untouched by either. Plus
the two that are no longer refusals: a Center admitting its 101st student is **allowed**,
and a bulk import of 500 either creates all five hundred or none — with no payment step to
fail (§3.5).

**Branches** — a branch member cannot read, write, or report on another branch's
students, batches, payments, expenses or payroll. One case per table, attempted as a
hostile authenticated client. And the growth breakdown: a row per branch with head
office among them, a student who has left removed from the month they were admitted in,
a pinned manager reading their own branch and no other, and every row added together
equalling the organisation's active head count — the organisation-wide figure printed beside it.

**Auth** — phone login still works; username login works; OTP expiry, attempt
ceiling, resend cooldown, and the same number in three formats resolving to one;
teacher account creation succeeding with **no phone and no OTP**; username collision
producing `rahim01` under concurrency.

**Security** — every row of §12.2, each asserting a database-level refusal.

**Scheduling** — one teacher, two rooms, four o'clock: the same hour on the same day
refused *by its SQLSTATE*; back-to-back written; one minute of overlap and a class
wholly inside another both refused; a batch that names no days treated as every day at
its own hours and free at every other; a switched-off batch holding nothing, and
reopening it caught when its week is written back; clearing a week and writing the same
one back allowed, because that is how a batch is edited.

**Finance** — charged vs collected vs outstanding on part payments; a refund netting
correctly with both rows intact; profit including payroll.

**The interface** — what can be tested about a screen without a browser, and it is more
than nothing: that the printables are one function the list and the sheet both read and
neither tests the sign itself; that a dictionary group handed to a client component has
string leaves only; that every navigable route exists, which `Route` types already force
at build time; and that a page hiding an action sits over a server that refuses it —
asserted against the action, never against the markup. A layout is judged by eye. What a
layout *claims* is judged by §12.2.

**The navigation** — the one part of the interface where two files hold halves of the same
rule, so it gets its own suite (`tests/navigation.test.ts`, 13 tests). Every row points at a
page that exists under `(app)`; each gated row asks *the same call its page guards itself
with*, read out of the page's own source, in both directions — a page that grows a gate the
menu does not know about fails, and so does a menu row asking for something its page no
longer checks. A capability hides a row and a plan feature greys it, and neither may be
written as the other (§20.3). No gate may contain an `await`. The phone's first four tabs
are named, so reordering the table is a decision rather than an accident, and no locked row
may take one of them. Every label and group heading exists in both dictionaries, no heading
is unused, and the sheet and the sidebar draw a row through one component so an active row
cannot look different in the two. The suite was negative-tested: five mutations applied to
the shell, five caught.

---

## 20. The interface

The app was built page by page and it shows. Every screen rendered inside a centred
`max-w-3xl` column with a fixed row of tabs across the bottom of it
(`src/components/app-shell.tsx`), which is a phone layout drawn at every width. On a
1,440px monitor two thirds of the glass was empty, the work happened in a 768px ribbon down
the middle, and a manager who wanted a batch and its fees in one view scrolled instead.
Most of the rest follows from that one decision: cards stacked because there is a single
column to stack them in, headings sized for a thumb, Settings grown into the drawer where
anything without an obvious home was put, and the plan page — the last thing a customer
reads before paying us — shaped like a long form.

What follows is the contract for fixing it. Architecture first, layout second, styling
last. Colours and corner radii are not the problem, and changing them is not the work.

**The frame is built and so are the nine steps below it** (§20.1, §20.2, §20.3 — all ✅;
§20.8 steps 1–9 ✅). Every screen a centre uses daily now has a shape of its own at
1,216px rather than a phone's column stretched to fit, the bulk-import screen included —
it was a step 5 workflow step 5 did not reach, and it is now the paste and everything read
back off it in seven columns beside the batches it joins in five. The page-furniture bar
§20.1 asks for exists too, as `components/page-header.tsx`, and forty-four screens draw it —
every one of the money screens, every one of the settings screens, the board, the branch
comparison, the two teaching screens, all four exam screens, and the six that finished the
rollout: the notices, the at-risk list, the progress report, the two account screens and the
student profile. A heading that scrolls away is not the exception any more; it does not
happen. The five that draw no bar are the four printed sheets and the fee register, and
`PageHeader` is `print:hidden`, so a bar on those would be furniture that exists only on the
screen they are printed from.

### 20.1 Desktop is not a large phone ✅

Two frames, one product.

**Wide screen**: a persistent left sidebar carrying the navigation, and a workspace that
uses the width it is given. The page's furniture — its title, its one primary action, its
filters — sits in a bar that does not scroll away. Content gets a maximum width **per
region, not per page**: a table may run the full width because columns are what it is
for; prose is capped near 70ch because a 1,400px line cannot be read; a form is capped
near 40rem because a text input as wide as a desk is harder to fill in, not easier. No
single number is right for all three, which is why one `max-w-3xl` on the shell was wrong.

**Phone**: the bottom tab bar stays — it is correct there, and it is what most teachers
will use. The tab bar was never the mistake. Showing it at 1,440px, and building every page
to suit it, was.

**What shipped, and where it differs from the paragraphs above.** The shell now draws a
`w-64` sidebar from `lg` up and the workspace ceiling moves to `max-w-7xl`; below `lg`
nothing about the old frame changed. Two deliberate departures:

- **The phone got a sheet, not a drawer.** A drawer duplicates the sidebar behind a
  hamburger and needs client state to open. Eleven destinations do not fit in a bar at
  375px, so the bar keeps the four a centre touches daily — dashboard, register, marks,
  money — and the rest sit behind a fifth "More" tab that is a `<details>`. It opens with
  no JavaScript, which on a 3G connection is the first ten seconds, and it reuses the
  sidebar's own row component so a row cannot be worded or styled differently in the two
  places.
- **Per-region widths are the rule now, and the numbers differ per screen.** The shell stopped
  being the thing that caps content, and every screen in §20.8's nine steps sets its own: a
  table runs the full width because columns are what it is for, a form is capped near
  `max-w-xl` and splits into two columns of six where it has nine fields, prose is capped near
  `max-w-2xl` wherever it is a sentence rather than a figure, and a list beside its own
  controls is 7/5 or 8/4 depending on what the narrow half has to hold at 704px. Whether that
  narrow half is *pinned* is a separate question with a rule of its own: only when what it holds
  is bounded, because a stuck column taller than the viewport cannot be scrolled to its own
  bottom.
- **The furniture is a component, not a slot in the shell.** The shell's `children` are
  opaque — it cannot know a screen's title — and threading one up through a context buys
  nothing `components/page-header.tsx` does not. It also keeps the title beside each of a
  screen's own refusal arms, so a page with three endings draws three bars and each names
  the screen that refused. It is sticky from `lg` and never below it: a phone already
  carries a sticky header and a fixed tab bar, and a third band leaves a 6.5" screen
  showing about six rows of anything.
- **Its height is part of the contract, and it is one line.** `lg:min-h-14` is 56px, so
  every sticky rail in the app sits at `top-16` — the bar and 8px — and a bar that grew a
  second line would slide over the first line of all of them. That is why the crumb sits
  beside the title rather than above it, why the subtitle sits below the bar rather than in
  it, and why a filter moved into the bar is label-less with an `aria-label`. It is also
  why the bar returns a **fragment**: a sticky box only travels inside its containing block,
  so a bar wrapped in a short `<div>` — or dropped into a page grid as a `col-span-12` cell
  — sticks for the height of that box and then leaves with it. Grid-rooted screens hoist
  the bar out of the grid and nest the grid under it. `tests/page-header.test.ts` holds both
  halves repo-wide: no rail anywhere uses `top-8`, no screen wraps the bar or makes it a
  cell, and no screen that draws it keeps an `<h1>` of its own.

**Printables keep their own frame.** The five sheets in §9.9 are `print:` layouts with the
shell `print:hidden` around them. Nothing here touches them, and no redesign may put the
navigation on a receipt.

### 20.2 Navigation follows the work, not the tables ✅ (four groups of the eight)

The tabs today are named after screens. The replacement is named after jobs, and the
grouping is the point: money in one place, people in another, so nobody has to guess
whether chasing arrears lives under Students or under Fees.

| Group | Holds | Why together |
|---|---|---|
| Dashboard | today's collection, absences, arrears, what needs deciding | the only screen opened with no question already in mind |
| Students | the roster, admission, one student's whole record, transfers, import | the register is one thing, not four |
| Academic | batches, the routine, attendance, exams, marks | what a teacher owns (§6.3) |
| Finance | invoices, collection, waivers, expenses, payroll, profit | every figure that has to reconcile against another |
| People | teachers, employees, accounts, capabilities | a person's record and their access, side by side (§5.1) |
| Reports | the registers, the month, the audit log | reading, never writing |
| Organisation | branches, the HQ comparison, consolidated finance | Institution only; absent entirely elsewhere (§8.3) |
| Billing | the plan, capacity, purchases, receipts, credits | the one group that is about us rather than about the centre |

**Settings stops being a drawer.** What stays is configuration: the centre's own record,
the locale, the messaging templates. Anything that *does* something moves to the group
that owns it — capacity to Billing, staff accounts to People, the routine to Academic.

**Two levels and no more**: a group, and the pages inside it. A third level is where
discoverability dies, and every screen this product has fits in two.

**What shipped, and why it is four groups rather than eight.** The table above describes
groups over pages that do not all exist yet: there is no roster index at all
(`(app)/students` has only `[studentId]`), no reports section, and billing is one page
inside Settings. Eight headings over eleven destinations would have been eight headings
with one row under most of them. So the shipped grouping is the same idea at the size the
product actually is:

| Shipped group | Rows |
|---|---|
| *(no heading)* | Home, Attendance, Exams |
| Money | Fees, Spending, Salaries |
| Families | Drifting away, Notices, The week |
| Organisation | Head office, Settings |

The eight-group table stays as written, because it is the destination and each of its rows
arrives with the pages behind it. Money is Finance under a shorter name; Families is the
parent-facing half of Reports; the first group is unheaded because a heading over Home is a
heading over the whole app.

**The defect this actually fixed.** Six screens — spending, salaries, drifting away,
notices, the week, the head office — had been built, tested and guarded for weeks and were
in no menu anywhere. The only route to any of them was a card on the dashboard, which is
how the dashboard became the product's menu and how recording an expense became two hops
through a summary of something else. That is what step 1 of §20.8 was really about; the
sidebar was the frame it needed.

### 20.3 The navigation is shaped by the reader, and controls nothing ✅

Four things shape it: role, the capabilities on the membership (§6.2), the plan, and
whether the centre runs branches.

| Reader | Sees |
|---|---|
| Teacher | Dashboard, their batches, attendance, exams and marks, the students in those batches, their own profile |
| A narrowed membership (accountant, receptionist, observer) | what their capabilities allow, and not a screen rendered as a row of noughts |
| Manager | everything about the centre |
| Owner | the above, plus Billing and the audit log |
| Owner of an Institution | the above, plus Organisation |
| Platform admin | the founder panel, which is a different shell |

**Hiding a group is a courtesy, never a control.** Every page behind it already refuses at
the server and again at the database (§12.1), and the navigation is a third layer that is
not trustworthy and is not asked to be. A teacher who types `/payroll` must meet
`pageRole()`, not a missing tab. Nothing in this redesign may become the only thing
between somebody and a screen they may not have.

A group empty for its reader is not drawn. A group their **plan** does not include is
drawn, and says what would unlock it — the one place a locked door beats a hidden one,
because that door is also the upgrade path.

**How the two paragraphs above are held apart in code.** Every row in the table carries the
same check its own page makes, and which of the two fields it goes in is the whole rule:

- `when` — a capability or a membership fact. **Hides the row.** A manager whose owner
  unticked `fees` would otherwise get a fee board that 20260811000063's policies filter
  down to nothing, which reads as a centre that has collected nothing and is owed nothing:
  a worse answer than no row. Same for spending, salaries, notices and the week. A manager
  pinned to one branch loses Head office for the same reason and not as a secret.
- `needs` — a plan feature. **Greys the row and leaves it there**, badged *Upgrade* in both
  languages, still a link, because the screen behind it refuses nobody and already draws
  the card naming the tier that has it. Four rows are like this: spending, salaries, the
  week, the head office.

Swapping one for the other type-checks perfectly and is silent either way — a plan check in
`when` costs us the only place the product ever mentions payroll to a free-plan owner, and a
capability in `needs` advertises a colleague's job to somebody the owner deliberately
narrowed. So `tests/navigation.test.ts` asserts both directions per row, against the page's
own source: 13 tests, and five deliberate mutations were each confirmed to fail them.

**A locked row never takes one of the phone's four tabs.** The first four are unlocked in
the table's order, but that order is not fixed — a manager who has lost `fees` drops to
three and spending slides into the fourth slot, locked. One tab in four of a 375px screen is
too much room to give an advertisement, so the split skips locked rows into More.

**None of it costs a query.** `can`, `has`, `isHqMember` and `canReadMoney` are pure
functions of the session the layout already holds, so eleven rows and their gates are
decided from data already in hand. Only a teacher pays, for the two grants that live on a
teacher row rather than on the membership, and those three checks share one memoised query.
A gate that needed an `await` would put a round trip per row on the critical path of every
screen in the product, which is why the test asserts there is not one.

### 20.4 Billing: five questions, in this order ⚠️ rebuilt on the balance

**Rewritten 2026-09-05.** The old six questions were the right questions for a plan page.
Under §11.6 there is no plan to manage and no renewal date to print, so the screen becomes an
answer to five:

1. **How long have I got** — *143 days · covers you to 26 January 2027.* The headline, in the
   reader's own numerals, and the only number most visits are for.
2. **How much is left** — ৳12,400, and what a day costs: ৳86.66.
3. **Why is it that much** — 100 students, 3 teachers, 1 branch. Their figures, not our bands.
4. **How do I add more** — one primary action, four suggested amounts, the bonus stated.
5. **What has happened to my money** — recharges with their receipts, days collapsed by month
   (*September: 30 days, ৳2,600*), and any grant with the reason it was given.

The old questions 1–2 (*what am I on*, *what am I using against ceilings*) are answered
elsewhere or not at all: the tier is a line in question 3, and there are no ceilings left on a
per-student tier to draw a bar against (§3.3). Question 4's *what changes if I move up* and 5's
*what will that cost* survive **only on the teacher tiers**, where tiers are still a real
choice — a Center has already chosen and is now managing its size, which is question 3.

**Do not expose the billing engine.** §3.1's marginal bands are how we compute; they are
not how a customer thinks. "First band 100 at ৳25, next band 200 at ৳18, rate each,
teacher seat calculation" is our arithmetic showing through the glass. What the screen
says is:

> 120 students, 3 teachers → **৳3,060/month**, about ৳102 a day. `[View pricing details]`

The bands live behind that disclosure, in full, for the owner who wants to check the
figure — and the disclosure is the same engine, never a second copy of the numbers. One
pricing module answers the public calculator, the owner's screen and the founder's
billing, because three places that each know the bands will disagree inside a month.

**The countdown is the screen's second job**, on §3.7's thresholds: a notice at 14 days, a
stronger one at 7, a persistent banner with the founder's number at 3, the dry date as a date
at 1, and the read-only banner at 0. It appears on the dashboard as well, because a billing
screen nobody opens warns nobody.

**And the calculator folds in.** §11.9's recharge screen already has to show the rate, the
days and the amounts; a separate calculator page would be a second place that prices the
same thing. The calculator the plan screen carried is the billing screen's own now, behind
its disclosure (§33).

**What shipped on the old screen, and what of it survives.** Recorded because the rebuild has
to keep the parts that were right rather than start from a blank file (§38). Question 1 was a
three-fact strip under the heading — the tier, the price,
and the date the money runs to — because the paid-through date used to be printed only
inside the subscription card, which a manager cannot see and an owner with nothing left to
buy never renders; **the strip survives, with days-left in place of the paid-through date.**
Question 2's rows said when a figure had met its ceiling and when it
had passed one, in the reader's own numerals; **that survives only for the teacher tiers.**
Question 4 was computed rather than compared: the
features the next tier adds, filtered from the same list and the same labels as the card in
the rail, and the ceilings it raises — so a feature cannot be present in one list and absent
from the other; **survives, teacher tiers only.** Question 5 was that block's own heading, one
figure from the same
`priceLine()` the tier list uses. Question 6 was one anchor, to the purchase control below or
to the contact card, never a second priced dropdown beside the first. The four-tier grid
§20.4 rejects still exists, folded into a disclosure that is open only on the free plan,
where comparing tiers is the errand; **survives unchanged, for the same reason.**

Two rules are enforced by the screen rather than merely respected by it. §33: the rate bands
and the working moved behind the calculator's disclosure, which is where the tallest block on
the page had been sitting, in full, from the one engine. §2.7 and §8: the difference block
drops any ceiling that is finite on a per-student tier, so "5 → 100 batches" and
"5 → 200 subjects" never print — a centre told it is being given ninety-nine more batches has
been sold a number we would refuse it at. `tests/plan-page.test.ts` asserts the second rule
against `PLANS` itself rather than against the rendered string, so a tier that gains a finite
cap fails there instead of quietly advertising it. **Both rules carry over to the rebuild and
the test moves with them.**

### 20.5 The cost of growth is visible where growth happens

**Rewritten 2026-09-05.** §9's principle was *billing should happen exactly where the user
encounters the need*, and it was built: the ceiling was met inside `[+ Add Student]`, priced
there, paid there, and the interrupted work continued by itself. There is no ceiling and no
payment now (§3.3), so the principle carries over with the transaction removed — the need is
to **know**, and knowing still has to happen in the same place:

- **The rail beside the add-student form says what the roster costs.** `101 students →
  ৳87.27/day · 357 days left`. Silent while the floor is biting, because a rate that has not
  moved must not be reported as though it had (§3.2).
- **The import quotes the change before it commits it** (§3.5, step 3). A paste that doubles
  the daily rate is the one place in the product where an owner can hurt themselves quickly,
  and it is the one place a number has to be read before a button is pressed.
- **The work in hand is not lost.** Whatever the manager had already typed survives any
  refusal and is still on the screen when it returns. A flow that clears the form has
  moved the friction rather than removed it. This is not free: React 19 resets every
  `<form action>` on submit, before the action runs and whatever it returns, so a refusal
  used to wipe the name, the guardian, the batch ticks and the four optional fields. The
  form holds its own values now, and remounts the ticks and the branch select on a refusal
  because those two are restored from mount-time defaults rather than from React state.
  **This survives untouched** — the refusal it protects against is now the balance rather
  than the ceiling, and the form does not care which.
- **The refusal names what to do, not what we call it.** "Your balance covers up to today.
  Recharge to keep saving." Never "capacity exceeded" or "entitlement lapsed", which are our
  words for our problems.
- **No navigation away.** Settings → Plans → calculate → purchase → back → find the button
  again is the specific experience this exists to prevent, and it is prevented more completely
  now than it was: there is nothing to go and buy mid-task.
- **Zero is not reachable, so it is not said.** This bullet used to ask for the ৳0 place
  below the floor's covered seats to open the form rather than a dialog asking for
  nothing. It cannot happen, and now for a simpler reason: there is no dialog. Kept as a
  record that the case was checked rather than forgotten.
- **The import is all or nothing.** 500 rows land whole or not at all, in a single
  transaction. Partially created students are the failure mode this is designed against, and
  the database enforces it — unchanged by the money model, because it never was about money.

### 20.6 Organisation level and branch level are visibly different places

An Institution's first screen is the organisation, not a centre that happens to have
branches. A table with a row per branch — Students, Teachers, Revenue, Expenses, Profit —
with the organisation's own total as the last row rather than a separate card, and a click
into any branch drilling down to that branch's own workspace (§8.3).

The reader must never be in doubt which level they are reading. Same figures at two levels
is how somebody reports a branch's profit as the organisation's. The level is stated in the
page's header bar, and the branch context persists visibly while they are inside it.

Nothing here asks the owner to recalculate anything. A branch gaining a student changes the
organisation's figures because the head count is one head count (§3.6) — and, on a
per-student tier, because that same student is on tomorrow's rate whichever building they
sit in — and the reporting is derived, not maintained by hand.

### 20.7 House rules

**Avoid**: a card around everything; nested rounded containers; a heading larger than the
figure beneath it; giant vertical gaps; decorative icons that label nothing; charts that
carry less information than the sentence they replaced; two columns of white space around
one column of content; a form dressed as a dashboard; tab bars on desktop.

**Prefer**: a real table when the data is tabular, with alignment that lets a column be
scanned; figures set in tabular numerals (`num`, already in the sheet); typographic
hierarchy in place of borders; contextual actions on the row they act on; progressive
disclosure for the detail a minority wants; one unambiguous primary action per screen and
everything else quieter; search and filters wherever a list can outgrow a screen; empty
states that say what to do next rather than that there is nothing; and density where
density helps — a manager reconciling a month wants forty rows visible, not eight.

**Dense enough to be useful, clean enough never to feel overwhelming.** The two ambitions
are not opposed; they are resolved by hierarchy, which is why hierarchy is the work.

**On icons, since "decorative icons that label nothing" is easy to read as "no icons".** An
icon earns its place when it *is* the label and the label is a word the row has no room
for. That is one situation in this product: a dense sheet whose row offers two errands —
the roster's eye and pencil, where two worded buttons would take about 150px of a 640px
table and a child's name is what the width is for. The conditions are the whole rule, and
all four are asserted rather than remembered. It must carry the word it replaced, as
`aria-label` and as `title`, both read out of the same dictionary key the drawn button
uses. It must be `aria-hidden` in the SVG itself, with no `<title>` inside it, or a screen
reader has two names for one control and picks by engine. It may only appear on a shape
that is drawn where there is a pointer to hover with — from `xl` here, and never as the
only form of a control a thumb has to find. And the same icon beside the same word must be
drawn on the narrow shape, which is what teaches the bare one. An icon that fails any of
those is the decoration the Avoid list means. There is no icon set: `components/icons.tsx`
holds the two shapes, inline, sharing one `<svg>` wrapper so the pair cannot drift into two
stroke weights, and taking `currentColor` so a shape follows the button it sits in.

### 20.8 Order of work

Worst first, and each step has to leave the app working — the redesign is a refactor, not a
rewrite, and nothing in §15's built list may stop working because a screen moved.

| # | Area | Why here |
|---|---|---|
| 1 ✅ | The shell: sidebar, workspace, header bar, responsive frame | every other screen inherits it, so it cannot be second |
| 2 ✅ | The centre dashboard | the first thing anyone sees, and until now the thinnest use of the width |
| 3 ✅ | Plan and billing (§20.4) | the screen a customer reads before paying us |
| 4 ✅ | Add student, including the capacity step (§20.5) | the most-used write path in the product |
| 5 ✅ | Student management: list, filters, one student's record | the register is the reason they bought it |
| 6 ✅ | Finance: invoices, collection, expenses, payroll, profit | the most figures per screen, so the most to gain from a table |
| 7 ✅ | Teachers, employees, accounts, capabilities | one person's record and access in one place (§5.1, §6.2) |
| 8 ✅ | Organisation and branches (§20.6) | needs 2 and 6 to have settled first |
| 9 ✅ | Settings, once everything that is a workflow has left it | what remains is small, and it should be |

Step 1 is done: the frame, the navigation, and the six screens that were in no menu.

**Step 2 is done, and what it did was split the page by errand rather than by size.** The
dashboard was one column at every width, so widening the workspace in step 1 made it worse
on a laptop: thirteen blocks stretched to 1,280px, a ৳ figure at 4xl with nine hundred
pixels of white beside it, and the month's profit two screens below the tiles it explains.
It is now a twelve-column grid from `lg` up — eight columns of *today* (what is owed, the
door that chases it, whether the registers are in, who is drifting, and who owes since
when) beside four columns of *the centre* (the three counts, the places left, the month's
profit, the branch comparison, and the two doors that tell families how the term went).
That is §20.7's one primary action made structural: chasing money is in the wide column and
everything quieter is beside it. The tile that says "places left" is the one of the four
that does not survive §16.1's step 28 unchanged: on a per-student tier there is no ceiling
to count down and what stands in its place is the balance with today's rate under it
(§9.10). Same tile, same corner of the same rail, a different number in it.

Three things worth recording, because they are decisions and not consequences:

- **The phone did not change, at all.** Not "was preserved" — the same thirteen blocks in
  the same order. Each carries an `order-N` matching the sequence the page has always drawn
  them in, and the two column wrappers are `display: contents` below `lg`, so on a phone
  they generate no box and every block is a direct child of the one column again. From `lg`
  the wrappers become the columns and each child's order still ascends inside its own, so
  one number does both jobs and there is no second ordering to keep in step. The phone
  layout was never the mistake (§20.1).
- **The overdue list is a real table now, and shows eight rows rather than five.** §20.7
  asks for a table where the data is tabular and density where density helps; five names
  was a sample, eight is a morning's work, and the room came free when the rail took the
  other half of the page. One `<table>` at both widths rather than a list on a phone and a
  table on a laptop — three columns fit 375px — with the head hidden below `sm` where
  stacked rows explain themselves, and present for a screen reader either way.
- **No data layer was touched.** Every query, every capability gate, every null-means-a-dash
  rule is the one that was there. §38: a bad layout is not a reason to delete working
  behaviour. The reason the counts below did not move is that this was a layout change and
  nothing else, held by the 1,195 tests that already covered the page's rules.

**Step 3 is done, and §20.4 above records what the screen now says.** Three decisions worth
keeping here rather than there:

- **The same one number, two shapes, again.** Ten blocks, an `order-N` each, two wrappers
  that are `display: contents` below `lg` — step 2's arrangement, reused rather than
  reinvented, seven columns of what an owner came to do beside five of what they check while
  they are here. Seven and five and not eight and four because the rail holds sentences
  rather than figures. `tests/plan-page.test.ts` carries the dashboard's ordering assertions
  and was negative-tested against eleven mutations, all eleven caught — two of which it
  missed on the first pass, both because a class name and a dictionary key are also
  substrings of a comment and a longer key beside them.
- **A §33 breach was already live.** The calculator printed the full band table and the seat
  rate inline, on the one screen where a centre decides whether to start paying us. Nothing
  was deleted; it is behind the disclosure §20.4 always asked for.
- **`multipleBranches` became sellable.** It was kept out of the advertised feature list
  because no screen stood behind it; step 1 gave `/hq` a way in and a greyed row, so it
  joined — which is also what makes the centre→institution difference non-empty rather than a
  card saying nothing changes.

No query, capability gate or null-means-a-dash rule was touched (§38): the ten reads, the
capacity gating and the receipt composition are the ones that were there.

Step 4 is add student and the capacity step it interrupts (§20.5) — the most-used write path
in the product, and the one place where the billing has to happen mid-sentence. Built: the
screen has two shapes, the wall carries the price and the purchase, and the form keeps what
was typed under a refusal. §20.5's ৳0 bullet was corrected rather than implemented — the
case is unreachable, and the bullet now says why.

Step 5 is student management: the roster, its filters, and one student's own record. Built:
the roster is a real sheet from `xl` and cards below it, both drawn from the same rows; a
student who has left can be put aside without being unfindable; and the record page holds the
numbers to ring beside the panels rather than above them.

Three decisions worth recording here:

- **The roster is two renderings of one row, and that is the risk.** A column added to the
  sheet and forgotten on the card is a fact that exists on a laptop and not on the phone the
  owner actually carries, and nothing in the type system notices. `tests/students-roster.test.ts`
  asserts the same five columns and every fallback beside them in both shapes, and the sheet is
  `hidden xl:block` rather than `lg` because an eight-of-twelve column is 469px at `lg` and
  640px at `xl` — five columns of a school name and a mobile number do not fit the first.
- **The heading counted 280 of 312 while the list under it was all 312.** There was no way at
  all to narrow it. There is now, offered only when somebody has actually left and only while
  neither problem filter is on — both are active-only already, so "current students" over one
  would narrow nothing and tapping it would quietly drop the filter being read. Everyone
  remains the default: a re-admission in July has to find last year's record rather than type
  a second one.
- **The record page kept its phone order exactly.** Eight blocks, orders 1–8 in the sequence
  the page has always drawn them, and the rail is written *first* in the DOM because `order`
  moves nothing for a keyboard or a screen reader and the guardian's number is a `tel:` link.
  Five columns of what is read while talking to a parent — the scope note, the numbers, the
  moves, the flags — beside seven of the panels that carry rows, so attendance and marks are
  one glance instead of two.

No query, capability gate or unreadable-versus-empty rule was touched on either screen (§38).

Step 6 is finance: invoices, collection, expenses, payroll, profit — ten screens, the most
figures per screen in the product. Built: the fee board, the day's register, charging a
month, closing a month, the arrears list, the chase list, spending, salaries, paying a
month's salaries, and the named waivers. Every one of them was a single column at every
width, which on the finance screens is not merely thin: it is a total that scrolls away from
the rows it totals.

Four decisions worth recording here rather than in a commit message:

- **A running total belongs beside the boxes, not under them.** Three of these screens are a
  long list of inputs with one figure that answers "how much" — 250 names to charge, 300
  arrears boxes, a month's salaries. On a phone that figure is at the bottom and an owner
  types into the list with no idea where they are. From `lg` it is in a rail beside the list,
  and on the two screens where the list is longer than the viewport the rail is
  `lg:sticky lg:top-8`, so the answer is on screen while the question is being typed.
- **Sticky is a decision per screen, not a house style.** `/fees/arrears` and `/fees/reminders`
  stick their rails; `/fees/scholarships` deliberately does not, because its rail holds a form
  *and* a month's report and together they are taller than a laptop screen — a stuck block
  taller than the viewport cannot be scrolled past, which is worse than one that scrolls.
- **Five layout idioms, not one.** `contents` + `order-N` where a column holds several blocks
  that must interleave with the other column's on a phone; plain `lg:order-*` where each
  column is one block; two grid rows summing to twelve where the source order already is the
  phone order; a full-width row above an 8/4 split; and plain auto-placement where three
  blocks fall 7+5 then 7. The first is the expensive one and is used only where it is needed,
  because a wrapper that is `display: contents` below `lg` has to have every child's order
  ascend inside it at both widths.
- **A failed read is not an empty list, and this step made that a rule.** Several of these
  screens rendered a broken read as "nothing yet" — which on the waivers screen actively
  misleads, because `fee_scholarships_center_name_key` folds case and an owner told the list
  was empty gets refused by an index when they re-add a name that was already there. Each
  read that can fail now has its own sentence, in both languages.

No query, capability gate, money rule or unreachable-versus-empty distinction was touched on
any of the ten (§38). The figures are the ones Postgres computed; the redesign moved where
they are drawn.

Step 7 is teachers, employees, accounts and capabilities — one person's record and their
access in one place (§5.1, §6.2). Five screens: the teacher roster and the staff roster, the
administrators screen, and the two add forms. Built.

Five decisions worth recording here rather than in a commit message:

- **The right layout differed on all five, and each one came from arithmetic.** The two
  rosters keep one column and spend the width *inside* the row that is open — a teacher's
  panel is two columns from `lg` and three from `xl`, because the panel is where the subjects,
  the permissions and the login live. The administrators screen is seven columns of roster
  beside five of appoint-somebody from `xl`. The add-teacher form splits itself in half from
  `lg`. The add-staff form splits nothing and pairs its short boxes two across from `sm`.
  There is no house answer to "how should a screen use 1,216px", only the measurement.
- **§26 names two defects and this step had one of each.** Width on the administrators screen
  and the add-staff form: a select, a building and six labelled boxes handed 1,184px, with
  save buttons run the full width of it. Height on the add-teacher form: a name, a number, a
  building, the subject ticks, five permissions with a line of explanation each and the login
  opt-in came to about 1,400px in one column, so the submit sat two scrolls below the name and
  the login decision — the one an owner comes to that screen to make — was off screen when the
  form loaded. The same fix would have been wrong for both.
- **A rail needs rail content, and twice there was none.** The add-teacher form has no
  server-side aside to put beside it, so the split went onto the `<form>` element instead of
  the page, and the two halves are the two things being created: a *record* of a teacher on
  the left, a *login* and what it may do on the right. The add-staff form has one subject
  only — no login to decide, no salary to set, both being other screens on purpose — so it got
  no second column at all and the width went inside. Two columns of white space around one
  column of content is worse than one column (§20.7).
- **What a manager may do was the fourth item in a line that truncated.** On the screen whose
  entire subject is what each administrator may do. It is now a word on the right of the row,
  and never a blank one: an owner's cell says Owner because nothing narrows an owner, and a
  manager's says the bundle they were given, the words for a hand-picked set, or Deputy owner
  for all six — a cell labelled by its position that comes up empty reads as a fact that
  failed to arrive.
- **Three of these screens had a refusal with no heading at all.** The locked-plan card on
  both add forms and on the administrators screen, reached by a bookmark or a back button:
  a reader landed on a card about their plan with nothing above it naming the screen that had
  refused them. Every return shape of all five now carries the same `text-xl font-bold text-ink
  lg:text-2xl`, and each refusal is capped rather than set across the page. The add-teacher
  screen also gained the seat count its own list screen already prints, in the list's words
  and from the list's dictionary keys, so the two cannot drift. The add-staff screen
  deliberately gained no such line and its test fails if one appears: `staffManagement` is
  bought or it is not, nothing here is priced per head, and a count on this screen would
  imply a ceiling that does not exist.

No query, capability gate or unreadable-versus-empty rule was touched on any of the five
(§38). Every layout test in this step was negative-tested with a throwaway harness until every
mutation of the layout *and* of the logic behind it was caught — 63 on the administrators
screen, 58 on the add-teacher form, 51 on the add-staff form, and its own set on each roster.
The recurring lesson is worth writing down once: a code comment is a substring like any other,
so an assertion that counts a class name or greps for a call will match the paragraph
explaining it, and three of these tests passed for that reason before they were made to fail.

Step 8 is the organisation and its branches (§20.6) — two screens: `/hq`, where the buildings
are compared, and `/settings/branches`, where they are named. Built.

**The first thing this step found was a missing column, not a missing layout.** §20.6 asks for
a row per branch carrying Students, Teachers, Revenue, Expenses and Profit. The table had
eight columns and no Teachers, so an owner comparing two branches on profit alone could not
see that one of them earns it with half the staff — which is the entire question the screen
exists to answer. §20.9's rule outranks the redesign here: the layout was not the defect, the
content was, and a beautiful eight-column table would have been the wrong deliverable.

Four decisions worth recording:

- **There is no rail on `/hq`, and the arithmetic says so.** Nine columns want 52rem — 832px —
  and a laptop gives the workspace 704px. Nothing can sit beside a table that already
  overflows, and a four-column rail would leave the table narrower here than it is on a phone.
  The bleed (`-mx-4 px-4 lg:-mx-8 lg:px-8`) buys no width either; it only lets the horizontal
  scroll run edge to edge instead of stopping inside a 32px margin. The width being wasted was
  *under* the table — five blocks of one or two sentences each, running the full 1,216px, one
  below the other — and they are two subjects: what the figures above mean (the legend, the
  dashed-column note, the payroll warning) and what §3.7 asks a head office to do about the
  organisation's own figures (what is left of the balance and what a day costs, which branches
  are growing, which ones are asking for more). Two
  columns from `lg`, and no `order-N` anywhere, because source order already is reading order.
- **A count that fails is not a count of nobody, per branch and per column separately.** Both
  head queries run per building in the round that was already running for students, and each
  cell reads its own figure: a branch whose student count arrived and whose teacher count did
  not shows the students and a dash, never the number beside it. The foot's two figures are
  the organisation's own unfiltered reads, because §17 prices the whole organisation as one
  and the seats are counted the same way.
- **The branches screen was the one-column defect in its purest form**: a row 1,216px wide
  carrying a building's name and a head count, with the form for the next building below all
  six of them. The form is now the rail — 384px, which is what two fields and a price want —
  sticky, because "what does the next one cost" is asked at the bottom of a list of eleven as
  often as at the top, and `xl` rather than `lg` for the same reason as the administrators
  screen: five of twelve at `lg` is 279px, and a form in it would be narrower than the same
  form on a phone. **The pinned manager takes the rail's place rather than sitting above their
  one row**, so the reader with no controls is not reading a page of white space either —
  written second in the DOM and painted third (`xl:order-3`), because on a phone whose decision
  this is comes before the row it applies to.
- **Two defects behind the layout, found by reading rather than by looking.** The comment under
  `/hq`'s table claimed the foot's head count differs from its column because "a student filed
  at head office is in one and not the other" — false, since head office is one of the rows
  counted, so such a student is in both; the true reason is a building the reader was not
  shown, and that is what it now says. And `Field` falls back to `id ?? name`, so a branch row
  that passed no `id` rendered `id="name"` — this list opens as many panels as the reader taps,
  so two open rows carried the same DOM id and every label on the screen pointed at the first
  one. Each row's fields are now keyed by branch id.

The drill-down §20.6 asks for is deliberately not built and is recorded as ⚠️ in §8.3: a branch
name opens that branch's *record*, because opening its *workspace* needs a scope-narrowing
mechanism in the database and a `branch_id` in a query string is the cross-branch leak §8.2
forbids by name. No query, capability gate, money rule or unreadable-versus-empty distinction
was touched on either screen (§38): the plan gate, the HQ check, `canReadMoney`, the month
validation, the closed-buildings-sink ordering, the fail-closed `branches === null` card and
the no-delete rule are the ones that were there. Both layout test files were negative-tested
with a throwaway harness until every mutation was caught — 14 on `/hq`, 17 on the branches
screen. One lesson, cheap in hindsight: a mutation harness that replaces the *first* match of a
string is testing whichever line happens to come first, and a four-space `teachers: 'Teachers',`
is a substring of a six-space one, so the mutation that appeared to escape had never been
applied to the key under test.

Step 9 is settings — what is left once everything that is a workflow has moved out of it into
steps 3 to 8. Seven areas: the hub, subjects and exam kinds, the centre's own details, the
activity log, the SMS screen and its opt-out roster, the timetable and its two forms, and the
download screen. Built.

**The step confirmed its own premise: what remains really is small, and small is why it was
wrong.** None of these screens had the dashboard's problem of thirteen blocks at 1,280px. They
had the opposite one — a list of six one-line rows down the middle of a page, with the form
that adds the seventh below all six, and nothing at all in the other 700px. So the answer on
five of the seven is the same shape and it is now an idiom rather than a decision taken five
times: a twelve-column wrapper from `xl`, the list in seven columns, the form or the note in a
sticky five, source order matching reading order so no `order-N` is needed anywhere. `xl` and
not `lg` on every one of them, for the arithmetic step 7 and step 8 already recorded: five of
twelve at `lg` is 279px, and a form in it is narrower than the same form on a phone.

Where the answer differed, it differed for a measured reason:

- **The timetable is two columns of rows at `2xl`, not at `xl`.** A batch row carries a name, a
  subject, a slot with two times in it, the days, a teacher and a price. `BatchSlot` renders
  "সকাল · ৭:৩০ সকাল–৯:০০ সকাল" at about 210px, so "subject · slot" wants ~330px and "days ·
  teacher" ~320px; two columns at `xl` are 468px each, which wraps the second line and turns
  every row into five. At `2xl` they are 596px and both lines hold. The page is capped at
  `max-w-2xl` below that, because the defect was never that the rows were too narrow.
- **Both batch forms are two columns of six, and neither is a rail.** Nine fields down a
  1,216px page is a phone form stretched to fit — a name box a hand wide and a save button two
  screens under it. What the batch *is* goes left (name, subject, teacher, building) and when it
  meets and what it costs go right, in the order the phone already had, so the create form and
  the edit form still match field for field. `xl:sticky` and a 7/5 split are both negative-
  asserted in these tests: neither half is commentary on the other, which is the one thing that
  separates this idiom from the rail one, and the two must not blur.
- **The download screen is a menu, so it is a grid of cards.** Five descriptions and five
  buttons ran down the middle, with the month picker that decides what all five of them fetch
  scrolling off the top. Two columns from `xl` puts the whole screen in one view, so the picker
  stays in sight and the rail it would otherwise need is unnecessary; each card in a row shares
  a height with `h-full` and `mt-auto`, so the buttons land on one line rather than at five
  heights. The picker itself is capped to the width of what it asks — one month and a button.
- **The activity log is three aligned columns at `lg`, not a table.** Each entry is its own
  `<li>` with its own grid, so the column widths are fixed in rem rather than `max-content`;
  a table would have been the reflex and would have made 400 rows one scroll container.
- **The opt-out roster uses `sm:contents`** to promote a phone card's inner block into cells of
  the desktop row, which is how one piece of markup serves both shapes without an `order-N` or a
  duplicated list.

Two defects behind the layout, both found by reading rather than looking. `Alert` takes no
`className`, so a refusal on either batch form was a 1,216px amber banner for a one-line
sentence; it is wrapped in a capped `<div>` placed outside the grid, so there is no empty cell
when there is no error. And the download screen's own docblock said it draws "three
descriptions and three links" — there have been five since the attendance and marks builders
landed, which is the sort of comment that is read as documentation and is wrong.

No query, capability gate, plan gate or unreadable-versus-empty distinction was touched on any
screen in this step (§38). The three that are worth naming, because a redesign is exactly when
they get dropped: the batch list draws a row as a link only for `isStaffAdmin`, since
`can_manage_batches` grants INSERT and no UPDATE (20260811000019) and repricing the class an
owner already sells is not "open a new batch"; the edit screen is therefore `pageRole('manager')`
while the two either side of it are the permission; and the download screen's gate is the role
rather than a permission, because nothing here is narrowed to one teacher's batches and a
teacher handed `can_manage_students` must not be able to walk out with the whole roster in a
file. Every layout test file in the step was negative-tested with a throwaway harness until
every mutation of the layout *and* of the logic behind it was caught — 106 on the timetable and
its two forms, 44 on the download screen, and its own set on each of the other five.

**And the bulk import, which belonged to step 5 and is finished here.** `/settings/students/import`
is the one screen a centre uses once and remembers: five hundred pasted lines, a live preview of
what each one parsed to, a price when the list does not fit, and the batches they join. All of it
ran down one column at every width, so at 1,216px the single question a paste cannot answer —
which batches these students join — sat below a hundred problem rows, and the button reading
"add 40 students" sat a scroll below the count that produced the 40. It is now seven columns of
paste-and-what-was-read-off-it beside five of where-they-go, with the Add button ending the
narrow column rather than sitting under both.

- **The narrow half is deliberately not pinned, and that is the sixth idiom rather than a lapse.**
  The other five rails in settings are `xl:sticky xl:top-16`; this one holds one tick per active
  batch and §6 lets a centre open a hundred, so a pinned column taller than the viewport cannot be
  scrolled to its own bottom — where the only control that submits lives. `xl:sticky`, `order-N`
  and `xl:max-h-*` are all negative-asserted, the last because capping the column into a nested
  scroll box is the tempting way to make pinning work and is worse than not pinning. **The rule
  generalises: a rail may be sticky only when what it holds is bounded.**
- **Nothing moved to get the shape.** The split is a wrapper and two `<div>`s; phone DOM order is
  byte-for-byte what it was, which is also tab order. Any arrangement that relocated the priced
  block or either preview list was rejected for that reason alone.
- **The submit is `full`, not the house `sm:w-auto sm:self-start`.** It ends a 386px column now
  rather than answering the whole width, and a column's terminal action is a target.

§10 is why this screen's tests outnumber its layout assertions two to one. Every limit it draws is
re-decided inside `importStudents`, which is a public HTTP endpoint (§24): the permission, the
active-student count, the room, the per-batch cap and the 500-row ceiling. Those assertions are
scoped to a slice of the function rather than the file, because `addStudent` and `updateStudent`
re-check the same permission and the same per-batch cap and would satisfy a whole-file `includes`
while this one was wrong. And the whole paste lands or none of it does, so an over-room list
disables the button instead of being trimmed to fit — a redesign that "helpfully" trimmed it would
be a half-created register, which is the one outcome §10 names. No gate, query or guard was touched
(§38): the page is `can_manage_students` while buying places is the owner and asking is the manager;
a count that did not arrive still takes the paste box away rather than reading as zero; the roster
is a hint capped at 1,000 whose null means *no hint* rather than *no matches*; and the price is
quoted off the paid ceiling, not the trial's, because `settle_payment_intent` reads the paid row.

**The page furniture, which is step 1's last unbuilt piece rather than a tenth step.** Step 1
built the shell and left the bar inside it undrawn, so every screen wrote its own heading block —
a crumb, an `<h1>` and a subtitle in a `<div>` at the top of the column — which scrolled away
with the first ten rows. At 1,216px that costs a reader forty rows into the arrears register the
one thing they need on screen: which month they are writing, and the way back to the board.
`components/page-header.tsx` is that block in one place, and forty-four screens draw it. The first ten
were the one-list screens — subjects, exam kinds, branches, the centre's details, SMS, the download
screen, the activity log, the bulk import and the chase list — and the twenty after them are every
screen that handles money or settings: the fee board, the arrears register, the one-off charge, the
month close, the waivers, spending, the wage bill, the month's payslips, the settings hub, the plan
screen, and the batch, student, staff, teacher and manager screens with their new-and-edit forms.
The four after those are the daily-work screens, and they are where the bar was hardest to place:
the board, the branch comparison, the day's classes and one batch's register. The last four are
the exam screens. Each drops its
hand-rolled block, its now-unused `Link` import, and
where it had one the `max-w-2xl` on its root column — which moves onto the card, so the bar still
reaches the workspace edges while the prose stays a sentence wide.

The last six are the ones nobody uses to run a centre and everybody eventually opens: the
notices, the at-risk list, the progress report, the two account screens and the student
profile. Two of them were capped wrong rather than merely unconverted — `account` and
`progress` had `max-w-2xl` on the column, which is the shape that stops the bar's background
at 672px — and the student profile was the last screen carrying its heading as a
twelfth-column grid cell, which is the shape that let a student's name scroll away forty rows
into their own fee list. Its edit button moved into the bar's `actions`, still gated on
`mayEdit`: `20260811000019` grants `can_manage_students` SELECT and INSERT and no UPDATE, so a
permitted teacher reads that page and gets no link to a screen that would refuse them.

The four daily-work screens also settled what the bar's title is for, because each of them had
been titled by something other than the screen. The board and the day's classes both opened with
"Good morning, Rahim" — the same sentence on two screens a teaching owner moves between, and the
reader's own name is already in the sidebar's account block — so the greeting stays the board's
alone and the classes screen is titled by what it is. The branch comparison keeps the §20.6 level
line, but under the bar rather than in it: the heading is one truncating line, so a level appended
to it is the half that gets cut, which is the doubt that line exists to remove. And the register
folded three stacked paragraphs — subject, slot, date — into one subtitle sentence, because a
reader checks those together or not at all.

Neither of the two teaching screens gained a rail, and the reason is the general one. A day is
two to six rows and the other batches are a closed disclosure, which is a line of chrome rather
than rail content; a register is forty rows of a name and four 44px buttons, and the notices under
it are the same errand a minute later — they say "save the register first" until it is saved. So
both went back to a `max-w-2xl` column rather than being spread over 1,216px, which is §20.8's
last idiom read the other way round: the defect there was never that the rows were too narrow,
and here it was that a tap target sat 900px from the name it belongs to.

**The exam list is the one screen in the four that spends the width, and it does it with a
second column of rows.** A row there is a title over its batch, subject and date with the
marked fraction and the SMS state at the far end, and across 1,216px that put "12/40" eight
hundred pixels from the exam it belongs to. A table was the obvious answer and is the wrong
one: the row carries seven facts, and seven columns at 375px is horizontal scroll on the
screen teachers actually use — the board's arrears table gets away with `hidden
sm:table-header-group` because it has three. Capping the list at 672px was the other
obvious answer and is the shape §20 exists to end. So `grid gap-2 xl:grid-cols-2` with
`h-full` on the row link: one column to `lg`, two from `xl`, twenty rows tall rather than
forty, and no field stranded from its own row. Two and not three, because at `2xl` a third
column is 390px and a row needs about 460 before the title truncates mid-word. The other
three exam screens are a form, a marks sheet and a correction form, so all three give the
width back — the sheet especially, because its note field is a `w-full` input that reaches
1,160px uncapped for a five-word note. The marks screen also folded four stacked paragraphs
of exam identity into one subtitle and moved its "Correct this exam" link into the bar's
`actions`, still a quiet text link rather than a button, because the errand on that screen
is entering marks and not fixing the heading.

Making the crumb work on those screens changed the component's signature: `back.href` is now
`Route<RouteType>` inferred from the argument rather than a bare `Route`. Bare, the type
resolves its dynamic-route branch against `string`, which is `never` — so `/exams` compiled
and `` `/exams/${id}` `` did not, and half the screens that need a crumb are sub-screens of a
dynamic route. `next/link` infers its own href the same way; a path matching no route at all
still fails the build.

Two properties of it are contracts on the rest of the app rather than details of the component,
and §20.1 states both: it returns a fragment, because a sticky box only travels inside its
containing block; and it is one line of 56px, which is why every sticky rail in the app moved
from `top-8` to `top-16` in the same change. A filter that moves into the bar therefore goes in
label-less with an `aria-label` — the activity log's table picker and the download screen's month
are both that shape now — and a fragment target's `scroll-mt` is `scroll-mt-20` at every width
rather than `lg:scroll-mt-4`, because 56px of bar now sits over the anchor it jumps to. On the
grid-rooted screens the bar is hoisted out of the grid and the grid nested under it, which retires
the `order-1 lg:col-span-12` heading cell those screens carried — the remaining `order-N` are left
at the numbers they had rather than renumbered from 1, because only their relative order matters
and moving six blocks down to reclaim a 1 is six chances to swap two of them. Nothing is left:
every screen under `(app)` draws the bar except four printed sheets and the fee register, and
`tests/page-header.test.ts` now asserts those five by name instead of counting adopters, so a
screen added tomorrow without a heading fails a gate rather than shipping. Three shapes are
banned repo-wide by the same file, because each un-does the bar without looking wrong in a
screenshot: handing it to a grid as a cell, wrapping it in a box of its own, and capping the
column that holds it.

### 20.9 The rule that outranks everything above

**No interface may be built on business logic that is wrong, and no business logic may be
built that the interface contradicts.** A beautiful screen over a rule that does not hold is
worse than the current screen, because it is convincing. If the two disagree, the database
is right and the screen is a bug — but only after checking that the rule in the database is
the rule this document specifies.

Two obligations follow, and they are testable rather than aspirational:

- **Every redesigned screen is exercised against the real entitlement system.** A trialling
  teacher, a lapsed centre in read-only, a narrowed accountant, a branch-pinned manager. A
  layout that only works for an owner with everything enabled has not been tested.
- **A screen that hides an action must be over a server that refuses it.** §12.2 is the list;
  the interface is not on it. Where a redesign needs a capability that does not exist yet,
  the capability is built first — server-side and tested — and the screen follows.

The first obligation has a gate as of 2026-09-04, because the reader it protects is the one
nobody demonstrates the product to. `tests/page-header.test.ts` now walks every arm of every
screen's own function rather than reading the file as one string, and requires each arm to
draw the page bar — inline, through a `{header}` const, through a local shell handed a
refusal, or through a block an arm returns outright the way `fees/arrears` refuses three
different reads with one card. A paywall arm, a read-only arm, a narrowed-permission arm and
a dropped read therefore all name which screen refused, exactly as the arm an owner with
everything enabled sees does; before this, a single bar anywhere in the file satisfied the
check. A screen whose shape the walk cannot read fails rather than going unchecked. The five
printed sheets stay out of it for the reason they carry no bar at all — it is `print:hidden`,
so on a sheet it would be furniture that exists only on the screen it is printed from. Each
of those five names what happened its own way, and two, the voucher and the payslip, write a
real `<h1>` on their paywall.

One finding from the audit behind that gate is left open rather than fixed. `payroll`'s
five-column rail holds three conditional blocks and nothing else, so it renders as an empty
box beside a seven-column bill for a centre in read-only with no staff records at all — no
agreements, nobody missed. Deliberately left: a lapsed centre had staff, and a new one can
write, so reaching it needs a centre that never hired anybody and has already stopped paying.
The bill column already says the only true thing about that screen, which is that there are
no agreements on it yet.

The same obligation reaches the links *inside* a screen, and as of 2026-09-04 the part of it
that can be mechanised is. A crumb is one promise per screen and could be checked by
comparing two guards; an in-page link cannot, because the page guard is only a floor and the
real gate is a local const — `canWrite`, `mayEdit`, `mayStaff`, `staffOnly` — that no
source-reading test can evaluate. An audit of all thirty-four such links across the app
returned thirty-one false positives for exactly that reason. So the gate in
`tests/navigation.test.ts` narrows to the class where the mistake is real and the check is
honest: **a link into a `pageCapability` screen may only be drawn on a screen whose own source
asks about that capability.** It reads the file for the question rather than the JSX condition
for the answer, and the screen's own test asserts which check was turned on. Eleven links are
in scope; owner-only screens are exempt because nothing narrows an owner.

Three of those eleven were defects, and all three were the same slip — the link gated on the
*role* while the screen behind it asks for a *box*. The fee board offered "Spending →" and
"Salaries →" under the month's takings to anybody who may collect, which is `isStaffAdmin`;
`/expenses` and `/payroll` are `pageCapability`, so an owner who granted `fees` and left the
two money-out boxes unticked was handing that manager two refusals. `/settings/staff` offered
the same salaries link, and `staff` is writing down who works here while `payroll` is agreeing
what they are paid. The third was not a capability at all: the new-batch screen's "add a
subject first" card put its only button on `/settings/subjects`, which is manager-only, while
the screen opens to a teacher holding `can_manage_batches` — a box that grants INSERT on
batches and nothing on subjects (20260811000019). That teacher now reads a sentence naming who
to ask. The shell was already correct throughout: every capability row in `app-nav.tsx` carries
a `when`, which is why the drift was in the page bodies, where the reader is already inside and
a link looks like part of the page. 10 of 10 mutations caught.

And where a decision in this document turns out to produce a bad experience, the decision is
what gets revisited. Documenting a rule does not make it good. But it is revisited *here*,
in this file, and then in the code — never worked around in one screen, which is how two
truths start.

---

## 21. Version history

| Date | Change |
|---|---|
| 2026-08-11 | First masterplan: positioning, the wedge, three tiers, go-to-market. Stack recorded as React + Vite on Cloudflare Pages. |
| 2026-08-23 | `docs/PLANS-AND-MESSAGING.md` written: per-tier feature flags, the 150-student Pro ceiling, marginal bands, the SMS reality. |
| 2026-08-29 | **This revision.** Reconciled with the final product direction: capacity as a purchased quantity separate from plan; the Pro trial as a state; Institution as a genuine multi-branch product with a shared pool; the financial module (employees, payroll, expenses, revenue, profit, dashboards); identity split into record versus account with memorable usernames and phone-or-username sign-in; owner/manager OTP named as a live security gap; the audit log; payment intents with bKash explicitly deferred; the stack corrected to Next.js 16 on Vercel; retired assumptions listed. |
| 2026-09-02 | §§11, 15, 16, 17 and 19 brought level with the build. A subscription may carry the tier it moves a centre onto, and the settlement moves the plan when the money lands, so the founder panel is no longer the only door to a plan change — it is now the only door to a plan change nobody paid for. `subscriptions` recorded as deliberately empty, with coverage derived from the payments into one date on the centre. The credit a downgrade or a mid-term move owes is named as the next thing the money model cannot yet express, and is a phone call until it can. |
| 2026-09-02 | **§20 added: the interface.** The masterplan now owns the information architecture as well as the rules — the sidebar-and-workspace frame in place of a phone layout drawn at every width, navigation named after jobs rather than screens and shaped by role without ever being a control, the six questions the plan page has to answer without exposing the pricing bands that answer them, buying at the point of need, organisation level held visibly apart from branch level, the house rules, and the order the screens get rebuilt in. §0 says why it is the same document. Version history moved to §21. The credit is struck off §16 as built: a platform payment may be negative, the floor is held by a trigger under an advisory lock, and it prints as a credit note — what is left of that thread is an owner being able to ask for one themselves. Counts: 1,388 RLS assertions, 1,166 unit tests, 74 migrations. |
| 2026-09-02 | **§12.1 rewritten: the caps are Layer 1.** 20260811000075 puts the four ceilings a plan sells besides student places — batches, subjects, teacher records, children in one batch — into triggers, because the tables they count still grant `insert` to `authenticated` and an owner's own token could be posted straight at the API. They mirror the Server Actions' counts exactly, resolve the ceiling through the same live trial, name which limit refused so Layer 2 keeps its own wording, treat a null allowance as no ceiling rather than none allowed, and exempt the migration runner but not the service key. §12.4's ❌ becomes ✅ — five ceilings, five advisory locks, and the counting helpers volatile on purpose so a bulk paste cannot pass one ceiling five hundred times. Feature flags are now the only cap left in Layer 2 alone, and §12.1 says why that stays. §16 records all twenty steps of the build order as landed. Counts: 1,418 RLS assertions, 1,176 unit tests, 75 migrations. |
| 2026-09-02 | **§20.8 step 1 is built, and §§20–20.3 now record what shipped rather than what was wanted.** A `w-64` sidebar from `lg` up, the workspace ceiling off `max-w-3xl` and onto `max-w-7xl`, and — the actual defect — the six finished screens that were in no menu anywhere: spending, salaries, drifting away, notices, the week and the head office, reachable until now only from a dashboard card, which is how the dashboard became the menu. Eleven destinations do not fit a 375px bar, so the phone keeps its four daily tabs and the rest sit behind a `<details>` sheet that opens with no JavaScript — a sheet, not the drawer §20.1 asked for, and §20.1 now says why. Four groups rather than §20.2's eight, because the other four have no pages behind them yet. §20.3's hide-versus-lock sentence is now a rule in code: a capability hides a row, a plan greys it and leaves it there badged *Upgrade*, since that row is the only place a free-plan owner ever learns this product does payroll — and locked rows are kept out of the phone's four tabs, where a quarter of the screen is too much to give an advertisement. Held by `tests/navigation.test.ts`, which asserts each row against its own page's source in both directions and was itself negative-tested against five mutations. All of it decided from the session already in hand: no round trip per row. Counts: 1,418 RLS assertions, 1,195 unit tests, 75 migrations. |
| 2026-09-02 | **§20.8 step 2 is built: the centre dashboard is a workspace rather than a column.** Step 1 widened the shell, which made this screen worse — thirteen blocks stretched to 1,280px, a 4xl ৳ figure with nine hundred pixels of white beside it, the month's profit two screens below the tiles it explains. It is now twelve columns from `lg` up, split by errand: eight columns of today's work (what is owed, the door that chases it, today's registers, the batch rates, who is drifting, and a real table of who owes since when) beside four of the centre's state (the three counts, the places left, the profit working, the branch comparison, and the two doors that tell families how the term went). §20.7's one primary action, made structural. The phone did not change at all — the same thirteen blocks in the same order, because each carries an `order-N` matching what it always was and the two column wrappers are `display: contents` below `lg`, so one number serves both shapes and there is no second ordering to drift. The overdue list became a `<table>` showing eight rows instead of five, three columns that fit 375px, head hidden below `sm` and present for a screen reader either way; the three glance tiles are boxes across on a phone and one card of ruled rows in the rail. No query, capability gate or null-means-a-dash rule was touched (§38), which is why the counts are unchanged: 1,418 RLS assertions, 1,195 unit tests, 75 migrations. Next is step 3, the plan and billing screen. |
| 2026-09-02 | **§20.8 step 3 is built: the plan screen answers §20.4's six questions, and stops answering two it should not.** Question 1 moved out of a subtitle clause into a three-fact strip — tier, price, paid up to — because the date the money runs to was printed only inside the subscription card, which a manager never sees and an owner with nothing left to buy never renders. Question 2's rows now mark a met ceiling and a passed one, in the reader's own numerals. Question 4 stopped being four cards to diff by eye and became a computed difference: the features the next tier adds and the ceilings it raises, from the same list, labels and `priceLine()` as the card in the rail, so the two can never disagree; question 5 is that block's heading and question 6 is one anchor to the control below rather than a second priced dropdown. The tier grid survives inside a disclosure, open only on the free plan. Two rules are now structural rather than intended: §33 — the band table and the seat rate had been printing inline on the very screen where a centre decides to start paying us, and are now behind the calculator's disclosure, in full, from the one engine; §2.7 and §8 — the difference block drops any ceiling that is finite on a per-student tier, so no owner is ever sold the ninety-nine batches we would refuse them at, asserted against `PLANS` itself rather than the rendered string. Ten blocks, one `order-N` each and two `display: contents` wrappers, seven columns beside five; `tests/plan-page.test.ts` negative-tested against eleven mutations, all caught. No query, capability gate or null-means-a-dash rule was touched (§38). Counts: 1,418 RLS assertions, 1,210 unit tests, 75 migrations. |
| 2026-09-03 | **§20.8 step 4 is built: add student is a workspace, and the ceiling is no longer a dead end.** Two shapes from one component. With places left it is twelve columns — the form in seven, and in five the capacity warning, the paste-a-register door and a card saying what saving actually does (a guardian's number nobody answers and a student in no batch are the two ways a record looks finished and is not). The warning is `order-2` and draws *above* the form on a phone: eighteen places short of the ceiling is something to read before typing a name. At the ceiling there is no form to draw, so the screen is one capped column and the whole of it is the way out — §3.4's missing half. The price of one more place is now in the refusal itself, from the same `nextSeatCostBdt` the control quotes with and off the *paid* ceiling rather than the effective one, so a trial over a paid subscription cannot hide the way out; the buy control is inline; and the reference the founder needs to match the transfer prints below it, read off `payment_intents` the way /settings/plan reads it, because an owner who leaves for bKash comes back to this URL. `buyStudentPlaces` now revalidates this path, or the confirmation says "send the money as shown below" above nothing. §22 is held in words next to the control: nothing here adds a place, so if a family is waiting the note says to take the guardian's number and admit the student when the places arrive. A manager still gets the ask and every tier gets the route that costs nothing — turn a student off — while /settings/plan drops to last, since for a centre it is no longer the errand. **The form now survives a refusal, which it did not.** React 19 wraps every action as `requestFormReset(form); return action(formData)` and calls native `form.reset()` at the end of the commit, so a mistyped mobile number used to cost an owner the whole record with a family at the desk (§20.5). Read out of react-dom's own source rather than assumed: `updateInput` mirrors a controlled `value` into the DOM's `defaultValue` every commit, so text fields survive once controlled — but it writes `defaultChecked` only when `checked == null`, so a *controlled* checkbox is unticked by the reset while React still says it is ticked, and FormData is read from the DOM. Controlling the batch ticks would therefore have filed the student into no batch, silently, on the second submit; they and the branch select are remounted on a refusal instead so their mount-time defaults are rewritten from the values that were kept. `OpenPurchase` moved to its own file for the third caller; `BranchPicker` gained an `onPick` for the one caller that has to put the answer back; `PlacesWarning` gained a `className` so the new layout can place it without a wrapper that would cost a gap on every screen where it returns null. §20.5's ৳0 bullet was corrected rather than implemented — `studentCeiling` floors a centre at the seats its monthly floor covers, so nobody is ever refused while their next place is free. `tests/add-student.test.ts` negative-tested against sixteen mutations, all caught, including the two that first slipped through: a bare search for the revalidate matched four other actions' copies of it, and the honest note passed a length check that said nothing about what it has to say. No query, capability gate or null-means-a-dash rule was touched (§38). Counts: 1,418 RLS assertions, 1,221 unit tests, 75 migrations. Next is step 5, student management. |
| 2026-09-03 | **§20.8 step 5 is built: the register reads like a register, and a student's record puts the phone number beside the fees.** The roster listed 312 cards under a heading that said 280 of 312, with no way to narrow it and five facts per student stacked three deep — on a 640px laptop column that is a sheet, so from `xl` it is one: `table-fixed` with the five widths shared out by hand and summed to 100%, `truncate` on a block child inside each cell so one long school name cannot re-shape every other column, and the same cards below `xl`. The name is the link and the row is not — a stretched `after:inset-0` overlay would make the guardian's number unselectable, and that number is what the sheet gets read for. Both shapes are drawn from the same rows and `tests/students-roster.test.ts` holds them to the same five columns and every fallback beside them, because two renderings of one row is the kind of thing that drifts; "tap a student" is `xl:hidden`, since beside the sheet the name says what it does by being a link *(superseded 2026-09-04: the hint is gone and every row draws its own buttons — see the last row of this log)*. Leavers can now be put aside, offered only when somebody has left and only while neither problem filter is on — both are active-only already — and the control carries the search where the warning filters deliberately drop it, since it counts nothing and narrows whatever is already on screen. Everyone stays the default: a July re-admission has to find last year's record rather than type a second one. **The record page kept its phone order exactly** — eight blocks, orders 1–8 in the sequence it has always drawn, five columns of what is read while talking to a parent (the teacher-scope note, the numbers to ring, the moves, the flags) beside seven of the panels that carry rows, so attendance and marks are one glance. The rail is written *first* in the DOM, not just ordered first: `order` moves nothing for a keyboard or a screen reader, and a rail written last is four taps past the fee list. A read that failed still returns one capped column, because a 7/5 split with an empty rail beside a single sentence is a third of a laptop screen saying nothing. `Th`/`Td` are now shared by five pages instead of a fifth copy of the same padding. Both test files were negative-tested, eight mutations and nine, all caught. No query, capability gate or unreadable-versus-empty rule was touched on either screen (§38) — the fee panel still tells its three empties apart, and the six unreadable branches are the ones that were there. Counts: 1,418 RLS assertions, 1,236 unit tests, 75 migrations. Next is step 6, finance. |
| 2026-09-03 | **§20.8 step 6 is built: the finance screens put the total beside the figures it totals.** Ten screens — the fee board, the day's register, charging a month, closing a month, the arrears list, the chase list, spending, salaries, paying a month's salaries, and the named waivers — every one of them a single column at 1,280px, which on a screen of money is not merely thin: the answer scrolls away from the question. Three of them are a long list of boxes with one figure that says how much, and that figure is now in a rail beside the list rather than under 250 names: charging a month, the arrears list, and a month's salaries. **Sticky became a decision per screen rather than a house style.** `/fees/arrears` and `/fees/reminders` stick their rails at `lg:top-8`, which is level with the workspace's own `lg:py-8` because the mobile header is `lg:hidden` and nothing occludes the top at that width; `/fees/scholarships` deliberately does not, because its rail holds the add-a-waiver form *and* the month's cost report and together they are taller than a laptop screen — a stuck block taller than the viewport cannot be scrolled past, which is worse than one that scrolls. **Five layout idioms, and which one a screen gets is arithmetic rather than taste.** `contents` + `order-N` where a column holds several blocks that have to interleave with the other column's in the phone order (the board, the chase list, the waivers); plain `lg:order-*` where each column is one block (`/payroll/pay`); two grid rows summing to twelve where the source order already *is* the phone order (`/fees/close`); a full-width settings row above an 8/4 split (`/fees/arrears`); and plain auto-placement where three blocks fall 7+5 then 7 (`/fees/charge`). The chase list takes eight columns and not seven for a measured reason: its three desktop action chips come to about 409px in English and 399px in Bangla, and a seven-of-twelve column is 401px at the `lg` boundary — the trio wraps in seven and fits in eight. **A failed read is not an empty list, and this step made that a rule with teeth.** The named-waivers screen rendered a broken read as "No named waivers yet", and `fee_scholarships_center_name_key` folds case, so an owner who believed it and re-added hardship was refused by a unique index on the screen that had just invited them to type it; each read that can fail now has its own sentence in both languages. Every screen carries source-reading layout tests that were themselves negative-tested until every mutation of the layout *and* of the logic behind it was caught — 45 on the chase list, 52 on the waivers, and its own set on each of the other eight. No query, capability gate, money rule or unreadable-versus-empty distinction was touched on any of the ten (§38): a void is still a negative counter-entry, the poisha are still added by `sumTaka`, and the figures are the ones Postgres computed. And a tidy that was cheaper to do than to record: six page headings across four of these screens still deviated from the house hand `text-xl font-bold text-ink lg:text-2xl`, in two different ways — the fee board's two and the payroll refusal's one were `font-bold` with no `lg:text-2xl`, so they stayed at 20px on a 1,280px workspace, while `/fees/arrears`'s two and `/fees/charge`'s one scaled up but said `font-semibold`. All six now say the same thing, and every page title in finance is one string. What is still outstanding is the page-furniture bar §20.1 asks for, which no screen yet draws. Counts: 1,418 RLS assertions, 1,319 unit tests, 75 migrations. Next is step 7, teachers and employees and the accounts they sign in with. |
| 2026-09-03 | **§20.8 step 7 is built: a person's record and their access are one screen, and the right layout differed on all five.** The teacher roster and the staff roster keep one column and spend the width *inside* the row that is open — two columns from `lg`, three from `xl` — because the panel is where the subjects, the permissions, the branch and the login actually are. The administrators screen is seven columns of roster beside five of appoint-somebody from `xl`, and `xl` rather than `lg` is arithmetic: five of twelve is 279px at `lg`, which is a squeeze and not a rail. **What a manager may do had been the fourth item in a dot-joined line that truncated**, on the screen whose entire subject is what each administrator may do; it is now a word on the right of the row and never a blank one — an owner's cell says Owner, because nothing narrows an owner, and a manager's says the bundle, the words for a hand-picked set, or Deputy owner for all six. Two consequences worth naming: a manager with all six capabilities now reads *Deputy owner* where the old label answered null, and the word *Administrator* no longer appears on a manager's row, because the screen is titled Administrators and that space now says which kind. **The two add forms had the two different defects §26 names.** Add-staff had the width one: a role, a job title, a phone number and a joining date, each holding ten or twenty characters and each given a box 1,216px wide. It has one subject — a record, not a login and not a salary, both of which are other screens on purpose — so it gets no rail at all and the width goes inside: capped at `max-w-3xl`, two columns from `sm` because the fields are short and waiting for `lg` leaves a tablet on one box per line, `sm:items-end` because three of the six carry a line of hint above the control and three do not, and the name and the note spanning both. The branch select needed no guard for that grid: it draws a hidden input when there is nothing to ask, and a hidden input is `display:none`, so it is not a grid item and the fields under it close up rather than leaving a hole. Add-teacher had the height one: a name, a number, a building, the subject ticks, five permissions with a line of explanation each and the login opt-in came to about 1,400px in one column, so the submit sat two scrolls below the name and the login decision — the one an owner comes to that screen to make — was off screen when the form loaded. There is no server-side aside to put beside it, so the split went onto the `<form>` rather than the page (one form has to hold both halves) and the two halves are the two things being created: a *record* on the left, a *login* and what it may do on the right. Capped at `max-w-5xl` so neither half runs to 596px on a wide monitor, subject ticks paired from `xl` where the half is 468px, and no `order-N` anywhere on either form — source order is reading order, so the tab order is the one it had in a single column. **Three of these screens had a refusal with no heading at all**, reached by a bookmark or a back button: a reader landed on a card about their plan with nothing above it naming the screen that had refused them. Every return shape of all five now carries `text-xl font-bold text-ink lg:text-2xl` and every refusal is capped. The add-teacher screen also picked up the seat count its own list screen prints, from the list's dictionary keys so the two cannot drift; the add-staff screen deliberately did not, and its test fails if one appears — `staffManagement` is bought or it is not, nothing there is priced per head, and a count would imply a ceiling that does not exist. No query, capability gate or unreadable-versus-empty rule was touched on any of the five (§38): every field name, every permission default, the password floor, the joining date's floor and today's cap, and the phone box's deliberate absence of `required` (§19) are the ones that were there. Every layout test in the step was negative-tested with a throwaway harness until every mutation of the layout *and* of the logic behind it was caught — 63 on the administrators screen, 58 on add-teacher, 51 on add-staff, and its own set on each roster. One lesson worth writing down once, because it cost three passes: a code comment is a substring like any other, so an assertion that counts a class name or greps for a call will happily match the paragraph explaining it. Counts: 1,418 RLS assertions, 1,388 unit tests, 75 migrations. Next is step 8, the organisation and its branches (§20.6). |
| 2026-09-03 | **§20.8 step 8 is built: the branch table gained the column §20.6 asked for, and the branches screen gained a rail.** The defect on `/hq` was content before it was layout — eight columns and no Teachers, on the one screen whose whole purpose is comparing buildings, so an owner reading equal profits could not see that one branch earns it with half the staff. Nine columns now, and the two head counts are read per building in the round that was already counting students, each cell reading its own figure: a branch whose student count arrived and whose teacher count did not shows the students and a dash, never the number beside it. The foot's two figures are the organisation's own unfiltered reads rather than sums of the columns, because §17's pool is one allowance for the whole organisation and the seats are counted the same way — and the comment there had been claiming the opposite for the wrong reason, that "a student filed at head office is in one and not the other", which is false, since head office is one of the rows counted. **No rail on this screen, from arithmetic:** nine columns want 52rem and a laptop gives the workspace 704px, so nothing can sit beside a table that already overflows, and the bleed buys no width — it only lets the scroll run edge to edge instead of stopping inside a 32px margin. What was wasting 1,216px was *under* the table, five one- and two-sentence blocks in a single stack, and they are two subjects: what the figures above mean, and what §3.7 asks a head office to do about the pool. Two columns from `lg`, no `order-N` anywhere, because source order already is reading order. The month became the table's `<caption>` instead of a line floating above it, and the level is named in a letterhead above the title, because this product draws the same five figures at two levels and the sidebar's centre name looks identical on the branch-level screens beside it. **A branch name opens that branch's record, not its workspace, and §8.3 now records that as ⚠️ with the reason:** the drill-down §20.6 wants needs `app.branch_ok` to read a *chosen* branch, and inventing that in a query string is the cross-branch leak §8.2 forbids by name. On `/settings/branches` the one-column defect was at its purest — a row 1,216px wide carrying a building's name and a head count, with the add form below all six buildings. The form is the rail now, 384px and sticky, since "what does the next one cost" is asked at the bottom of a list of eleven as often as at the top; `xl` and not `lg`, because five of twelve at `lg` is 279px and a form in it would be narrower than the same form on a phone. The pinned manager's card takes the rail's place rather than sitting above their one row, written second in the DOM and painted third, so a phone still reads whose decision this is before the row it applies to. Two smaller defects fixed on the way: the locked-plan shape had no `<h1>` at all, so an owner on a Center plan read the refusal without being told which screen refused them, and `Field`'s `id ?? name` fallback meant two open branch panels rendered the same DOM id with every label pointing at the first — each row's fields are keyed by branch id now. No query, capability gate, money rule or unreadable-versus-empty distinction was touched on either screen (§38). Both layout test files were negative-tested until every mutation was caught, 14 and 17; the one that appeared to escape had never been applied, because a harness replacing the first match of `teachers: 'Teachers',` finds a six-space line before the four-space key under test. Counts: 1,418 RLS assertions, 1,412 unit tests, 75 migrations. Next is step 9, settings — what is left once everything that is a workflow has moved out of it. |
| 2026-09-03 | **§20.8 step 9 is built, which closes the redesign's own list: settings is seven areas and five of them are now one idiom.** The hub, subjects and exam kinds, the centre's details, the activity log, the SMS screen with its opt-out roster, the timetable with its two forms, and the download screen. The step confirmed its premise — what remains in settings is small, and small is why it was wrong: six one-line rows down the middle of a 1,216px page with the form that adds the seventh below all six, and nothing at all in the other 700px. So five of the seven take the same shape, and it is an idiom now rather than a decision taken five times: twelve columns from `xl`, the list in seven, the form or the note in a sticky five, source order matching reading order so no `order-N` is needed anywhere. `xl` and not `lg` on every one, for the arithmetic steps 7 and 8 already recorded — five of twelve at `lg` is 279px, and a form in it is narrower than the same form on a phone. **Where the answer differed it differed by measurement.** The timetable splits at `2xl` and not `xl`, because `BatchSlot` renders "সকাল · ৭:৩০ সকাল–৯:০০ সকাল" at about 210px, so "subject · slot" wants ~330px and "days · teacher" ~320px, and 468px columns wrap the second line into five-line rows where 596px hold; below that the page is capped at `max-w-2xl`, since the defect was never that the rows were too narrow. Both batch forms are two columns of six with `xl:sticky` and a 7/5 split negative-asserted, because neither half is commentary on the other and that is the one thing separating this idiom from the rail one. The download screen is a menu, so it is a grid: two columns from `xl` put all five sheets in one view, which is what makes the month picker stay in sight and the rail unnecessary, and `h-full` with `mt-auto` lands the five buttons on one line instead of five heights. The activity log is three aligned columns at `lg` with widths fixed in rem, because each entry is its own `<li>` and therefore its own grid; the opt-out roster uses `sm:contents` so one piece of markup serves both shapes. **Two defects behind the layout, found by reading rather than looking.** `Alert` takes no `className`, so a refusal on either batch form was a 1,216px amber banner for a one-line sentence — it is wrapped in a capped `<div>` outside the grid, so there is no empty cell when there is no error. And the download screen's docblock said it draws "three descriptions and three links": there have been five since the attendance and marks builders landed, which is the sort of comment that is read as documentation and is wrong. No query, capability gate, plan gate or unreadable-versus-empty distinction was touched on any screen in the step (§38). The three worth naming, because a redesign is when they get dropped: the batch list makes a row a link only for `isStaffAdmin`, since `can_manage_batches` grants INSERT and no UPDATE (20260811000019) and repricing the class an owner already sells is not "open a new batch"; the edit screen is `pageRole('manager')` while the two either side of it are the permission; and the download screen's gate is the role too, because nothing there is narrowed to one teacher's batches and a teacher handed `can_manage_students` must not be able to walk out with the whole roster in a file. Every layout test file was negative-tested until every mutation of the layout and of the logic behind it was caught — 106 on the timetable and its forms, 44 on the download screen, its own set on each of the other five. **What §20.8 has not delivered, stated plainly rather than left to be discovered:** the page-furniture bar §20.1 asks for is built on no screen, and the bulk-import screen is a step 5 workflow step 5 did not reach. Counts: 1,418 RLS assertions, 1,478 unit tests, 75 migrations. |
| 2026-09-03 | **The bulk import reads beside the batches it is joining, which closes §20.8 step 5 and leaves the redesign one gap.** `/settings/students/import` was the last screen in the product still running down one column at every width, and the cost was specific rather than aesthetic: at 1,216px the one question a paste cannot answer — which batches these students join — sat under a hundred problem rows and a preview of five hundred names, and the button whose face reads "add 40 students" sat a scroll below the count that produced the 40. It is seven columns of paste-and-what-was-read-off-it beside five of where-they-go from `xl`, with the Add button ending the narrow column instead of sitting under both. **The narrow half is deliberately not pinned, and that is the sixth idiom rather than an oversight.** The other five rails in settings are `xl:sticky xl:top-8`; this one holds one tick per active batch and §6 lets a centre open a hundred, so a pinned column taller than the viewport cannot be scrolled to its own bottom — where the only control that submits lives. `xl:sticky`, `order-N` and `xl:max-h-*` are all negative-asserted, the last because capping the column into a nested scroll box is the tempting way to make pinning work and is worse than not pinning at all. The rule generalises and is now written in §20.1: a rail may be sticky only when what it holds is bounded. **Nothing moved to get the shape** — the split is a wrapper and two `<div>`s, so phone DOM order, which is also tab order, is byte-for-byte what it was; every arrangement that would have relocated the priced over-room block or either preview list was rejected for that reason alone. The submit is `full` rather than the house `sm:w-auto sm:self-start`, because it ends a 386px column now instead of answering the whole width. The page caps its subtitle and both dead-end cards at `max-w-2xl` and takes the `lg:text-2xl` heading the rest of settings uses. **§10 and §24 are why the guards outnumber the layout assertions two to one.** Every limit this screen draws is re-decided inside `importStudents`, a public HTTP endpoint: the permission, the active-student count, the room, the per-batch cap and the 500-row ceiling — and those assertions are scoped to a slice of that one function rather than to the file, because `addStudent` and `updateStudent` re-check the same permission and the same per-batch cap and would have satisfied a whole-file `includes` while this one was wrong; that isolation was itself verified by mutating the neighbouring copy and confirming the test stayed green. The whole paste lands or none of it does, so an over-room list disables the button rather than being trimmed to fit, which a later pass might have thought helpful and which is exactly the half-created register §10 forbids. No gate, query or guard was touched (§38): the page is `can_manage_students` while buying places is the owner and asking is the manager, a count that did not arrive still takes the paste box away rather than reading as zero, the roster is a hint capped at 1,000 whose null means *no hint* rather than *no matches*, and the price is quoted off the paid ceiling and not the trial's because `settle_payment_intent` reads the paid row. 11 layout-and-logic tests, negative-tested with a throwaway harness until all 60 mutations were caught. Counts: 1,418 RLS assertions, 1,489 unit tests, 75 migrations. What is left of §20.8 is the page-furniture bar §20.1 asks for, which no screen draws. |
| 2026-09-04 | **The page heading stops scrolling away: §20.1's furniture bar is built and ten screens draw it.** Step 1 built the shell and left the bar inside it undrawn, so every screen wrote its own heading block — a crumb, an `<h1>` and a subtitle in a `<div>` at the top of the column — and it left with the first ten rows. The cost is specific rather than aesthetic: a reader forty rows into `/fees/arrears` had nothing on screen saying which month they were writing and no way back to the board without scrolling up, and the same is true of every list in the product. `components/page-header.tsx` is that block in one place — title, crumb, subtitle and a slot for the screen's primary action — sticky to the top of the workspace from `lg` and never below it, because a phone already carries a sticky header and a fixed tab bar and a third band leaves a 6.5" screen showing about six rows of anything. Ten screens adopt it: subjects, exam kinds, branches, the centre's details, SMS, the download screen, the activity log, the bulk import and the chase list, each dropping its hand-rolled block, its now-unused `Link` import and, where it had one, the `max-w-2xl` on its root column — which moves onto the card so the bar reaches the workspace edges while the prose stays a sentence wide. **Two properties of it are contracts on the rest of the app, and both are asserted repo-wide rather than commented.** It returns a **fragment**, because a sticky box only travels inside its containing block: wrapped in a `flex flex-col` `<div>` with its subtitle it would have a block about 90px tall and stick for 34px before leaving, and handed to a page grid as a `col-span-12` cell it would have a block one grid row deep — so the four grid-rooted screens hoist the bar out and nest their grid under it. And it is **one line of 56px** (`lg:min-h-14`), which is why every sticky rail in the app moved from `top-8` to `top-16` in the same change: a bar that grew a second line would slide over the first line of all of them, and a rail left at `top-8` has its own first line painted over — on the chase list that is the count of families to chase, on the arrears list the total about to be written. `tests/page-header.test.ts` holds the repo-wide half of both: no `.tsx` under `src/` uses `top-8`, no screen wraps the bar or makes it a cell, and no screen that draws it keeps an `<h1>` of its own. **Three consequences worth recording because they look like unrelated choices.** A filter that moves into the bar is label-less with an `aria-label`, since a stacked label is the second line the contract forbids — the activity log's table picker and the download screen's month are both that shape. A fragment target's offset is `scroll-mt-20` at every width with no `lg:` override, because 56px of bar now sits over the anchor it jumps to. And the download screen's locked title demotes from `<h1>` to `<h2>`, because the bar above it is the heading and two page titles is what a screen reader then lists. The bar is `print:hidden` on both halves of the fragment: §9.9's five sheets carry their own letterhead. No query, gate, guard or unreadable-versus-empty distinction was touched on any of the ten (§38) — the diff is markup, and the ten screens' own layout-and-logic tests were re-anchored rather than relaxed. 11 assertions on the bar itself, negative-tested with a throwaway harness until all 31 mutations were caught. What is left is the same edit on the remaining screens. Counts: 1,418 RLS assertions, 1,500 unit tests, 75 migrations. |
| 2026-09-04 | **Three defects an owner found by using the product, and every one of them was a control that existed and could not be reached.** They are recorded together because the pattern is one thing: a capability the code has, with no drawn way to it. **A teacher's username was said once and never again.** It appears in the sentence that reports the account was made, and that sentence is gone on the next render — so a week later the owner cannot tell the teacher what to type, and their only route back was to reset a password for a login they could not name. Migration 38 already writes `profiles.username` and says in its own comment that the column exists so a screen can read it; nothing was reading it. So this is a read and not a new column: no migration, no denormalised copy on `teachers`, nothing new to keep in step. `profiles` stays self-read — a staff-admin policy wide enough to answer this would hand over `full_name`, `phone`, `locale` and `is_platform_admin` with it, and a `SECURITY DEFINER` RPC would add an anon-reachable endpoint — so `usernamesFor` takes the service-role client as an argument, selects exactly `id` and `username`, and the caller's id list is the fence: both call sites hand it ids they just read under the active centre's own id. Empty in means no round trip, because PostgREST renders an empty `.in()` as `in.()`, which is a parse error rather than a query matching nothing. Both rosters draw it `break-all` and not `truncate`: the teacher cell is 176px and a username runs to thirty characters, so an ellipsis here would be the same defect in a new place. **A teacher record could be switched off and never removed.** Off stays the right verb for a teacher who left — their name stays on last term's registers and on the papers they set — but a name typed twice sat on the roster for ever, and on a capped plan the owner had to look at it. Two guards before any counting: they must be off first, because the off branch is what deletes their `center_members` row, so RLS access is provably gone before the record is (an orphan membership would leave `app.has_role('teacher')` true for somebody with no teacher row), and never your own row. Then four counts read server-side, because a Server Action is a public endpoint and a hidden button is not a permission — paid, registers taken, papers set, batches taught, refused in that order, because three of those four foreign keys are `set null` and the database would let the deletion through and quietly leave the history with nobody's name on it; only `batches` is repairable, so it is named last. The auth account is left alone: `profiles` is one row per human and not per appointment, so deleting it would be this centre reaching across a tenant boundary, and leaving it means re-adding the same teacher tomorrow reuses the login they already know. No migration — `teachers_staff_admin_write` already grants DELETE and the restrictive `teachers_branch_scope` already narrows it. The arm button is drawn for a still-on teacher too and answers with a sentence, because a control that appears only after an unrelated step is the very defect being fixed. **And the only way into a student's record was to click their name.** The owner said they found it by being an engineer. So the card stops being one big invisible link: it is a `<div>` with the name as a visible link and a button row under the facts — View for every reader of this screen, Edit only for the owners and managers the edit screen admits, since 20260811000019 gives `can_manage_students` SELECT and INSERT and deliberately no UPDATE and a button to a refusal is worse than no button. Dropping the whole-card link also un-buries the guardian's number, because text inside a link cannot be selected on a phone and that number is what the roster gets read for. From `xl` the sheet takes a sixth column carrying one button and not two: two would want about 150px of a 640px sheet, and the name in the first cell is already a visible link there, so the cell carries whichever of the pair the name does not. That column's heading is read aloud and never drawn — a word above it would be the widest thing in the narrowest column. Two button constants rather than one, for arithmetic: `min-h-tap` is 3rem and would add 24px to each of the forty rows §20.7 wants visible, so the sheet takes `min-h-9` at the width where the pointer is a mouse while the cards below `xl` keep the full thumb target. Neither is brand-filled — three hundred rows of a coloured button is a screen nobody can read, and the one thing on a roster row that should draw the eye is a child's name — and both are `whitespace-nowrap`, because a button that wraps in Bangla and not in English is a row that is a different height in one language. The `openHint` line goes from both dictionaries: an instruction that teaches an invisible control is a control that should have been drawn. No query, capability gate, money rule or unreadable-versus-empty distinction was touched on any of the three screens (§38). Each change was negative-tested with a throwaway harness until every mutation was caught — 20, then 30, then 31. Counts: 1,418 RLS assertions, 1,547 unit tests, 75 migrations. |
| 2026-09-04 | **The heading rollout is finished, and its gate stops being a floor.** The last six screens that still hand-rolled a heading are converted — the notices, the at-risk list, the progress report, the two account screens and the student profile — which is every screen under `(app)` but four printed sheets and the fee register: `PageHeader` is `print:hidden`, so a bar on a sheet would be furniture that exists only on the screen it is printed from, and the register's `<h1>` is the centre's own name on a page handed across a desk. **Two of the six were capped wrong rather than merely unconverted, and that is not a cosmetic difference.** `account` and `progress` carried `max-w-2xl` on the root column; the bar's background spans the workspace with `lg:-mx-8`, so a capped column stops that background at 672px and leaves rows scrolling up through bare page either side of it. The cap moved onto the cards, which is where a name box wanted it anyway. **The student profile was the last screen carrying its heading as a twelfth-column grid cell**, and a grid cell's containing block is one grid row — so the student's name and code left the screen forty rows into that child's own fee list, which is exactly where somebody on the phone to a guardian is. Its grid is nested under the bar now; the retired cell's `order-1` is left vacant rather than renumbering seven blocks to reclaim a number nothing reads; and the edit button moved into the bar's `actions`, still gated on `mayEdit`, because `20260811000019` grants `can_manage_students` SELECT and INSERT and no UPDATE — a permitted teacher may read that page and may not save it, and a button to a screen that refuses them is worse than no button. **The gate changed shape with the rollout.** `>= 38 screens carry the bar` was a floor, and a floor can never catch the next screen added without a heading; it is an exact list of the five exceptions now. A third un-doing shape is banned repo-wide beside the two already there — a `max-w-*` on the column that holds the bar — since that is precisely the mistake two of these six had made, and none of the three fails to compile or looks wrong in a screenshot. The profile's own layout test follows the hoist: no cell spans the grid, the phone order is 2 to 8, and the heading block is guarded whole — the name, the tag on a student who has left, the code, the crumb, the thumb target and the gated button. Its failed-read assertions are re-anchored off a slice that ends at `notFound()`: the main arm's root is a tall flex column too, so the old slice, which ran to the grid, would have gone on passing while pointing at the wrong arm. 21 of 21 mutations caught. Counts: 1,418 RLS assertions, 1,548 unit tests, 75 migrations. |
| 2026-09-04 | **§20.9's first obligation stops being aspirational.** Every screen returns early several times before the arm an owner with everything enabled sees, and the heading gate read each page as one string — so a paywall arm, a read-only arm, a narrowed-permission arm or a dropped read could ship with no heading and no gate would say so, which is the reader who most needs to be told which screen just refused them. `tests/page-header.test.ts` now slices each page's own default-exported function and walks its arms, counting a bar drawn inline, through a `{header}` const, through a local shell handed a refusal, or through a block an arm returns outright as `fees/arrears` does for three separate failed reads; a page written in a shape the walk cannot parse fails rather than passing quietly. All forty-nine screens were audited arm by arm first and only the five printed sheets came back bare, each naming what happened its own way — so they stay out, for the same reason they carry no bar at all. One finding is recorded open in §20.9 instead of fixed: `payroll`'s rail is three conditional blocks, so it is an empty column for a read-only centre that never hired anybody. 7 of 7 mutations caught. Counts: 1,418 RLS assertions, 1,549 unit tests, 75 migrations. |
| 2026-09-04 | **A crumb is a promise too, and one of them was lying.** §20.9's persona pass found the student profile — open to any teacher — offering `← Student roster`, which is `can_manage_students`, a box an owner ticks per teacher. A teacher without it reaches a child from the dashboard's at-risk card, drawn off the risk view's own rows rather than a role, so the only way out of that screen answered "you do not have access to this"; the rule was already written three fields above it for the receipt link. The crumb is now chosen by `canManageStudents` — the roster for whoever holds it, the dashboard for whoever does not, which is where that card is and the one screen every reader of this page can open — and costs no query a staff-admin or a teacher was not already making. `tests/navigation.test.ts` gains the direction it never had: it held the menu to the screens it points at, and nothing held a screen's own way back. Every crumb target must now be openable by every reader the screen itself admits, with rank, roster permission and capability compared separately, because rank implies no capability below owner and a manager clears a roster box without it being ticked. All forty-two crumbs checked, that one was the only offender, and a screen whose guard the comparison cannot read fails rather than being skipped. 7 of 7 mutations caught. Counts: 1,418 RLS assertions, 1,551 unit tests, 75 migrations. |
| 2026-09-04 | **Three links promised a screen that then refused the reader, and all three were gated on the role instead of the box.** The fee board put "Spending →" and "Salaries →" under the month's takings behind `canWrite`, which is `isStaffAdmin` — a role — while `/expenses` and `/payroll` are `pageCapability`, an independent tick per manager. So an owner who granted `fees` and left the two money-out boxes unticked was handing that manager a board they should read and two links that answer "you do not have access to this". `/settings/staff` offered the same salaries link on the same mistake: `staff` is writing down who works here, `payroll` is agreeing what they are paid. The third was not a capability — the new-batch screen's "add a subject first" card put its only button on `/settings/subjects`, which is manager-only, while the screen opens to a teacher holding `can_manage_batches`, a box that grants INSERT on batches and nothing on subjects; that teacher now reads a sentence naming who to ask, in both languages. **The gate is deliberately narrower than the crumb gate.** A crumb is one promise per screen and two guards can be compared; an in-page link cannot be, because the page guard is only a floor and the real gate is a local const no source-reading test can evaluate — an audit of all thirty-four such links returned thirty-one false positives on exactly that. So `tests/navigation.test.ts` holds the one class where the check is honest: a link into a `pageCapability` screen may only be drawn on a screen whose source asks about that capability, read as a question in the file rather than an answer in the JSX, with the screen's own test asserting which check was turned on. Eleven links in scope, owner-only screens exempt because nothing narrows an owner. The shell was already right — every capability row in `app-nav.tsx` carries a `when` — which is why the drift was in the page bodies. 10 of 10 mutations caught. Counts: 1,418 RLS assertions, 1,555 unit tests, 75 migrations. |
| 2026-09-04 | **§8.1 and §8.2 were marked ⚠️ and ❌ on a product where branch scoping is built, tested and shipped — the drift §25 forbids, pointing the wrong way.** A section that says "not built" about something that is invites two failures: somebody builds it again, or somebody reads the marker as a live security finding and reports a hole that closed months ago. §8.1's body was the worse half, because it was specific: *"nothing reads it — three references in the whole of `src/`, all in one file"* and *"a branch manager can see every branch"*. Forty-five files in `src/` reference it, and a branch manager can see one branch. What `20260811000053_branch_scoping.sql` actually does is now written down: 26 policies named `<table>_branch_scope`, one per table §8.2 lists, every one of them **RESTRICTIVE** so it is ANDed with the 102 permissive policies already there rather than replacing one — which is what made it safe to add to a live schema, since a capability that was already refusing somebody keeps refusing them and branch is a second question asked after the first still passes. One function decides, `app.branch_ok(center, branch)`, and HQ wins over a pin because it asks whether *any* of the caller's memberships reaches the row. The thirteen unscoped tables are recorded with their categories — one bill and one owner, one person with many memberships, shared catalogues, one queue, one stated deferral — because a reader auditing the file should not have to treat its silence as a finding. Two things the migration had to fix on the way are recorded too: a trigger files a new row under the branch that wrote it, since every add form in this product posts a row with no branch and a restrictive policy alone would have left a pinned manager able to read their branch and write nothing at all; and three number series became `security definer`, because a branch-pinned caller taking `max(no) + 1` through their own policies gets their branch's maximum and two branches would have issued one receipt number twice. The leak suite §8.2 asks for by name is in `scripts/test-rls.mjs` and is a case per table in three directions — the pinned read, the HQ control over the same 26 tables, and the hostile write with each refusal paired with the write it must not break. **The two open items stay visible and are both waiting on a screen, not on a decision:** a branch snapshot column on `sms_dispatches` and `sms_logs`, and a write-time branch column on `audit_log`, which is safe today only because that table opens to owners and an owner is HQ by definition. §8.3's ⚠️ is untouched and is now the only one in §8: a branch name opens that branch's record rather than its workspace, because the drill-down needs `app.branch_ok` to read a *chosen* branch and a `branch_id` in a query string is the leak the section forbids. Documentation only — no code, no counts moved. |
| 2026-09-04 | **Then the same sweep over every other marker, because one stale ❌ is a mistake and four is a habit.** §3.8 was marked ❌ *(partly ✅)* over one sentence that was true when written and is not now: *"a platform payment cannot yet be voided by a counter-entry, because `payments.amount_bdt` is positive by check"*. `20260811000074` dropped that check — by name rather than `if exists`, since a rename would have left `> 0` standing under a passing migration — and the section now records what replaced it: a credit is money we owe back sitting on the row that says what we have been paid, so a centre's `sum(amount_bdt)` is net of credits and that is the intended reading. Three constraints keep a credit from being anything else, and the first is the one that matters most: **no coverage window**, because `paid_through` is `max(covers_period_end)` in two independent derivations and a -৳1 row dated to 2099 would buy permanent free access while looking less like tampering than editing `status` by hand. Also no intent, because an intent means "this receipt settled that purchase" and the printable would otherwise render as a sheet selling 180 places with a minus in front of the total; and a required note, because a credit is a decision somebody made and this table has no UPDATE path to explain it afterwards. §9.3's last ⚠️ row said refunds were *"representable, no UI"* — there is a refund form on the register, mounted on the payment row, with `lib/fees/refund.ts` holding the floor at what actually came in. §9.1 was ✅ on the rule and ⚠️ on surfacing it; the word *revenue* appears nowhere in either dictionary, every money figure names which of the three numbers it is, and where two figures on one screen answer different questions the screen says so in a sentence — so the ⚠️ was describing a screen this product does not have. And §11's founder paragraph still gave the old reason for not offering an owner a move *down* a tier. The reason has narrowed rather than gone: the credit has a row now, so what is missing is the arithmetic, and a number nobody can check is not a refund an owner should be able to ask for themselves. **The markers that stay are the ones that earn it:** §6.2 ⚠️ (five `teacher_permissions` booleans, still columns rather than words, and it says why that waits), §7.3 ✅⚠️ (no rooms, no per-date overrides, no term dates), §8.3 ⚠️ (the drill-down). Documentation only. |
| 2026-09-04 | **The pooled ceiling was being compared against one branch, and 20260811000076 is the missing half.** §3.6 is the rule this broke: a student place is a licence and licences pool across the organisation, so `session.ceiling` is one figure for the whole institution — while `20260811000053` made every `select` on `students` RESTRICTIVE by branch, so a count taken through a pinned manager's own client is one building's. Five sites paired them: the dashboard places line, the plan screen's usage table, the roster's warning, the add-student card, and both `limitRefusal` and `importStudents` inside `settings/actions.ts`. A manager of Mirpur with 40 of the organisation's 300 students read **260 of 300 places left** when there were five. **The fence never moved** — `app.guard_student_capacity()` counts past RLS under an advisory lock and raises `CD001`, and `test-rls.mjs` proves it — so nothing was over-admitted; what broke was the promise, worst on the bulk paste, where §10 refuses the whole list and three hundred typed lines are lost to a number the screen got wrong. **`public.center_student_count(uuid)` is a wrapper, not a new fence.** `app.active_students` was already the right count and already granted to `authenticated`, but `app` is not a schema PostgREST serves, so `src/` had never been able to ask; the counting function is untouched because three triggers depend on its volatility — row 200 of a 500-row import has to see rows 1..199. It is `security definer` with an empty search path, and because `scripts/check-scoping.mjs` names a definer function that trusts a centre id as the one hazard its parser cannot catch, the first thing the body does is ask `app.is_staff_admin` or `app.can_manage_students` about that id and raise `42501` otherwise. Standard SQLSTATE, not a `CD###`: `check-sql.mjs` requires every product code to be named in `src/lib`, and this is a refusal to read rather than one of the product's rules. Both revokes, and `check-embeds.mjs` now asks the live anon endpoint as well — 7/7 SHUT. **Where two scopes share a screen, the screen says so (§9.1).** The dashboard's student tile stays this building's on purpose, because `/hq` refuses a pinned manager and tells them their figures are on their dashboard, so the line beneath it reads "5 of 300 places left across the organisation" and carries the pool note. The roster drops the ceiling instead of pairing it — "40/300 students" is two true halves making a false claim in a subtitle with no room to explain itself — and names the branch, with the organisation's pressure in the rail. `?? 0` survives only where it hides a warning and never where it grants room: a failed count takes the paste box away and refuses both actions with `limitUnknown`, because one wrongly admitted row is one thing and eighty is another. **§20.9's branch-pinned manager now has a gate**, `tests/pinned-manager.test.ts`: it sweeps every `.ts`/`.tsx` under `src/app` for a places figure built from an unpooled count, holds the file list to exactly six so a seventh has to be justified, and asserts the qualifier wherever a branch count survives beside the pool. Negative-tested with a throwaway harness until all 25 mutations were caught, including a fabricated new screen. **A live check was also wrong about a real roster:** `test-rls-live.mjs` asserted no student anywhere is named *Nadia Islam*, which was a statement about a fixture when written and a statement about a paying customer's admission of 2026-09-03 by the time it went red — every policy it guarded was working. Probe names are baselined before the import now and every claim is a delta, and an unbaselined name throws rather than baselining itself mid-run. 12 new tests. Counts: 1,567 unit tests, 162 live RLS assertions, 76 migrations. |
| 2026-09-04 | **The same owner came back to the two fixes above and was right about both.** The first was arithmetic dressed up as a design decision. The roster's desktop sheet shipped one button where the card shipped two, on the reasoning that the coloured name in the first cell was already the other one — and the answer to that is that reading a record and rewriting one are two errands, and a reader who has to deduce the second from a text colour has not been offered it. The 150px objection was real and the owner supplied the way past it: two squares carrying an eye and a pencil want 80px, so the sheet gates only `mayEdit` now, exactly as the card does, with no ternary swapping one control for the other. The actions column goes from 14% to 15% and the 1% comes off the class column; the name keeps its 24% and the guardian's number its 19%, which is the one width the sheet may never re-cut because `Guardian’s number` is its longest heading. Below `xl` the words stay, with the icon beside them — that is where the original report came from, where a thumb is doing the work, and where an icon next to its label is what teaches the bare icon on the sheet. **The first SVG in the product, so §20.7 now says when an icon is allowed** rather than leaving `decorative icons that label nothing` to be read as *no icons*: it must be the label, carry the word it replaced as both `aria-label` and `title` off the same dictionary key, be `aria-hidden` with no `<title>` inside the svg or a screen reader has two names for one control, appear only on a shape drawn where there is a pointer, and be repeated beside its word on the narrow shape. `components/icons.tsx` is two shapes sharing one `<svg>` wrapper — no icon package, and `currentColor` so the shape follows the button's hover instead of sitting one colour inside a box that moved. `rowView` and `rowEdit` also tighten from 12 characters to 10, because 22px per button that the label used to have now belongs to the icon. **The second was worse than a design mistake: the confirm screen for removing a teacher was making a claim that was frightening, irrelevant and, for some teachers, false.** It ended *"Their login is not deleted — they may use it at another centre"*, in the one place a reader is deciding whether to press a red button. Irrelevant, because `deleteTeacher` deletes the `center_members` row and RLS refuses the account thereafter — and the access had already ended one step earlier, since removal is only permitted on a teacher who is off and the off branch is what deletes that row. And false for a teacher with no phone number: `giveTeacherLogin` can only re-find an existing account by phone, so a username-only login is reachable from nowhere else at all. **The mechanism was right and is untouched (§38).** The auth account does survive deliberately — `profiles` is one row per human and not per appointment, so deleting it here would be this centre reaching across a tenant boundary to break somebody else's teacher — and that is a fact about our schema rather than a fact the owner needs, so it stays in `deleteTeacher`'s docblock and leaves the confirm screen. Both sentences now say the thing the owner needs instead: they cannot reach your centre either way, and that ended when you turned them off. Both languages, and the gate holds both — neither string may mention a login or another centre in either language, and both must name whose access ended, so the order sentence and the confirm sentence cannot drift into telling an owner the access ends at two different moments. Negative-tested with throwaway harnesses until all 22 roster mutations and all 6 copy mutations were caught. Counts: 1,568 unit tests, 162 live RLS assertions, 76 migrations. |
| 2026-09-04 | **A staff login the centre minted was also a self-serve centre signup, and the teacher holding it had no way to sign out.** §5.5 records the whole of it. The mechanism is two features meeting: §5.1 issues a teacher a credential out of nothing but their name, with a password the manager chose and can still read off the roster, and switching that teacher off **deletes** their `center_members` row — so the ordinary end of a term, not a removal, leaves a working account with zero memberships, and `homePathForRole(null)` sends exactly that session to `/onboarding`. Nothing of the old centre was reachable: the membership was gone and RLS refused. What was reachable was `bootstrap_center`, which asked only whether the claimant already **owns** a centre. So every minted staff login could found its own, past §5.4's phone gate — that gate is on signup and this account was made by an admin call — with §4.3's 14-day Teacher Pro trial stamped on it, on a password somebody else knows. **The credential is refused, not the person:** a teacher who wants their own batches signs up with their own number and gets the form exactly as before, because refusing anyone who had ever been a member would have closed §2's Teacher Free tier against the very teacher §5.1 exists to accommodate. Three layers ask and only one is a fence — the screen does not draw the form, `createCenter` re-checks so the refusal arrives as a sentence under the field instead of a Postgres string, and `20260811000077` refuses inside the function, which is the one that counts because that RPC is `grant execute … to authenticated` and the anon key reaches it directly (§24). **Both signals, either one enough:** the login address, which is what actually signs the person in, `or` `profiles.username`, the copy migration 38's trigger writes and `app.guard_profile_identity` keeps a browser out of — so a disagreement between them refuses rather than admits. The domain literal is duplicated into SQL because Postgres has nowhere to import a constant from, and it is the username domain and not the shared `.invalid` suffix: `like '%.invalid'` would refuse every owner on the platform, which is why one of the five new pglite checks is a positive control that an ordinary phone signup still succeeds. **The other half is a button.** `/login` bounces a live session to `homePathFor`, which for a member-less account is this same page, so that reader could not reach a sign-out anywhere in the product; it is on both arms now, because one arm without it strands whichever reader gets that arm. The refusal arm is the first screen in `(auth)` to read `dict(session.locale)` — a signup has expressed no preference and gets Bangla, but this person has a profile with a locale in it — and it says what is actually missing rather than "try another centre", the sentence the teacher-removal thread deliberately stopped telling. 6 source-reading tests over the screen, the action and the comment-stripped migration, negative-tested until 25 of 25 mutations were caught, plus 5 checks against real Postgres proving each arm of the guard fires alone and the one-centre-per-owner rule still runs behind it, at 4 of 4. Counts: 1,423 pglite RLS checks, 1,574 unit tests, 162 live RLS assertions, 77 migrations. |
| 2026-09-14 | **The verification mail carries a code and nothing else.** The owner's instruction, after seeing Supabase's default letter: no link, `coachdeskbd@gmail.com` as the sender, and a mail worth receiving. The template is now a bilingual, branded HTML letter — `docs/email-confirm-signup.html` is the copy of record, pasted into the dashboard's Confirm Signup slot — whose one payload is `{{ .Token }}`. **And the bug this surfaced before any customer could:** the platform generates eight-digit codes where six were assumed, so the signup input capped at six and would have truncated the last two digits of every real code — a signup nobody could finish, reading as "wrong code" every time. The input now accepts up to ten, no sentence on any screen names a count, the "or tap the link" line is gone (there is no link), and a check-your-spam-folder hint stands in its place. `/auth/confirm` remains as a defensive fallback only. |
| 2026-09-14 | **The burn lands: steps 21a, 22 and 22a of §16.1, still read by nothing.** `price_versions` (80) publishes the founding card in poisha — the bands, both floors, Teacher Pro's flat figure, the seat and the branch — seeded by migration with no app write path, held to `plans.ts` by `tests/price-versions.test.ts` exactly as `plan-allowances` has been since 36; the column list grew from one monthly figure to three because a card that cannot price a teacher tier cannot price the product. `billing_ledger.price_version_id` arrives with its FK in the same file, required on a daily_charge and a recharge and null on every other kind. `public.settle_billing` (81) charges whole past days and today at the current size under the ledger's own advisory lock, prices from the card and the same counting functions the capacity trigger reads, tops a day up to its high-water rate when the roster grows, and records every attempt — including the refusals — on `app.settlement_runs`. **Two bugs the tests caught before anything shipped:** migration 78's unique index could not coexist with the top-up (it forbade the second row the top-up is), so it is replaced by uniqueness over the day's *base* charge with a `top_up` flag naming which half of a day's cost a row carries; and `created_at` defaulted to `now()`, frozen per transaction, so the two charges a catch-up writes in one call shared a stamp and the chain walk read them in a random order — `clock_timestamp()` now. **And the function lives in `public`, not the `app` schema this document first named:** PostgREST serves only `public`, and a live smoke found the burn unreachable through the only door the cron and `requireWritable` have. `platform_reconciliation()` answers §11.13's three questions, gated like `platform_centers`, drawn on `/founder` — and the "gap in charged days" question narrowed to the invariant that never lies, *the line never lags a paid day*, because a centre that ran dry for three days has three legitimate uncharged days and flagging them would cry wolf on the product working. The reconciliation's Q3 also learned that a `paid_through` in the future *explains* a `charged_through` past today — that is §11.14's promise to old-model customers, not an alert. **Step 23 landed with them: `dailyRatePoisha` in `plans.ts`** — `floor(monthly × 100 / 30)`, derived from `monthlyBillBdt` and never typed in, held by `tests/daily-rate.test.ts` to §19's properties and to the same worked figures the RLS suite asserts of the SQL half, so the two doors into the one engine answer alike. Counts: 1,466 RLS assertions, 1,595 unit tests, 81 migrations. |
| 2026-09-13 | **Signup is by email, and the phone OTP gate is retired unread.** The gate of 2026-08-11's `20260811000065` was built and tested and could never switch on — it needed a BTRC sender ID, which needed an aggregator, which needed an NID. The owner's decision: an email address is free to verify and a mobile number is not, so §5.4 is rewritten around Supabase's own confirmation flow — `signUp` creates the account unconfirmed, a six-digit code arrives by email, `verifyOtp` checks it and establishes the session inside the same Server Action call, and staff accounts minted by a centre are created confirmed and send nothing, which is the teacher exemption held by construction rather than by a gate with a hole in it. `app.phone_verifications`, both its functions, `otp.ts`, `otp-gate.ts` and `previewPhone` are removed by `20260811000079`; `profiles.phone` and number-keyed staff logins survive, because a teacher's contact number is a fact about the register and not a credential. Sign-in takes email, number or username — the third and last identifiers that field will ever hold (§5.3). Delivery is the dedicated `coachdeskbd@gmail.com` as custom SMTP with an app password that lives in the dashboard and nowhere else; until it is configured the built-in sender works at ~2/hour, enough to test. And `bootstrap_center`'s centre-issued-login guard was widened the same day to refuse both reserved domains — since self-serve signup no longer creates phone-keyed accounts, every `%.coachdesk.invalid` login is a centre-minted one, which is exactly the population §5.5's fence exists for (§5.5). The same day the owner held automated SMS and the real bKash API by decision, not by block, until the legal and integration work is worth doing. |
| 2026-09-05 | **The read-only rollout, and the owner solved the billing hectic-ness better than the spec did.** §4.4's standing question moved from a hidden button to a whole arm on eighteen screens, above every read the arm would otherwise pay for: three of them keep a page bar and a note and nothing else, and two are mixed — /notices keeps the log of what the centre already told whom, and /settings/center keeps the centre's name and the wallet a parent sends fees to, because those are the two facts a lapsed owner reads out over the phone. §§11.6–11.8 are new and they came out of the owner's own reading of the product: a prepaid account balance replaces §9's pay-per-student mechanism, never expiring, non-refundable, and paying the monthly subscription too, so a centre with credit never reaches the read-only state at all. The balance is a ledger with an advisory lock and an immutability trigger rather than a column, and it is deliberately not the fence — capacity is. §11.8 separates the seat recycling the owner asked about, which is the deal being sold and only corrupts their own books, from the billing-date gaming next door to it, which is real and is answered by charging on the peak active count over the period rather than the instant reading. *(Three sentences of this row are superseded four days later by the row below: the balance **is** the fence, the ledger is poisha and not whole taka, the peak-active-count rule is retired, and "never reaches the read-only state at all" describes a centre with credit — a centre without it reaches read-only on an ordinary Tuesday.)* |
| 2026-09-05 | **One prepaid balance, burned by the day — the money model is now a single mechanism, and this revision is the document catching up with that decision.** The owner asked for one solution rather than a set of them, twice, and was right that there were two: §5 priced a subscription with marginal bands while §9 sold student places as a separate contextual purchase, so the product had a monthly bill *and* a thing to buy, and the plan screen read as confusing because it was describing both. The model is now one sentence — **money in → taka in the balance → each day takes its own cost off → when the balance cannot cover the next day, saving stops until they top up** — with size changing the daily rate and nothing else. §11.6 holds it and every other section defers to it. **What went, and each of them was load-bearing somewhere:** purchased student capacity and its whole vocabulary of places (`student_capacity`, `quoteSeats`, `capacityBands`, `nextSeatCostBdt`, `ASK_PLACES`, `capacityPressure`), the contextual seat purchase inside Add Student, the bulk-import payment step, the branch places request, coverage periods as the gate, `GRACE_DAYS` and grace in any form, monthly invoices and due dates and dunning, the peak-active-count billing rule, the whole-taka ledger, mid-term downgrade credit arithmetic, `status='trial'` as access-granting, a self-serve grace button, a self-serve holiday pause, and name-locking — fourteen retirements listed in §18 with the code each one names. Three of the four purchase kinds go with them: a seat, a branch and a place were each a door that could refuse, and they are now rate changes the balance carries, which leaves §11.2's payment intent with exactly one kind and makes a recharge claim one of those intents rather than a second table. **What arrived:** poisha and integer arithmetic, because ৳2,600 ÷ 30 is neither a whole taka nor a whole poisha and `floor(monthly × 100 / 30)` is the only rounding that does not make a year dearer than twelve months; `public.settle_billing`, which charges whole past days at today's rate under a per-centre advisory lock and **tops today up if the roster grows**, so a day costs its own high-water rate with no high-water mark stored anywhere to drift; access as a comparison (`balance < owed`) so a centre lapses on the right day with no job run and no row written, exactly as a trial expires; two founder levers, a money adjustment and granted days, each needing a written reason and each audited, which is the answer to a Ramadan closure, a 200-row mis-paste and a founder who was asleep; and a discount ladder that is a bonus on the credit rather than a discounted rate, 0/5/10/20% at one/three/six/twelve months, so nothing has to remember which taka was bought at which price. **The one genuine gaming surface daily billing has is the midnight empty roster**, and it is closed by charging from the size at the first write of the day rather than at a fixed hour: to be charged the floor you must be empty when work starts, and an empty roster cannot take attendance, collect a fee or record a mark. **The cost of retiring capacity is stated rather than hidden:** a mis-paste is now an unbounded rate instead of a refusal, answered by §20.5's informed consent at the door and repaired by a founder grant. §16.1 is the order it lands in, and the rule behind that order is that every intermediate state must be safe — the ledger, the burn, the rate and the access derivation are additive, so until capacity is removed last the stricter fence is still standing. | 2026-09-05 | **A register written with dashes was welding the father's name onto the child's, and the accounting half of the prepaid model is now written down rather than assumed.** The defect first, because it is the one that was losing data: `COLUMN` in `lib/bd/roster.ts` was `/[,;\t|]/`, so `Rahim Ahmed - Abdul Karim - 01712345678` — which is how half the registers in this country are written — parsed as **one** field. The line imported cleanly: a student called "Rahim Ahmed - Abdul Karim", no guardian, the right phone number, no problem reported. On every row of the paste, into the one field §7.1 fixes at creation and never lets an owner edit. A dash is a column now only with **space on both sides**, which is not fussiness but the whole of the distinction: `Abdul-Karim Chowdhury` and `আব্দুল-করিম চৌধুরী` are one name and must stay one, so a dash between two letters is not a separator — the same rule a human reader applies. All three dashes, because a phone keyboard hands you whichever it likes: hyphen-minus off an English layout, en dash off a Bangla one, em dash out of Word. That is the same alphabet `isPhoneSeparator` already accepts *inside* a number, applied to the gap *between* fields. Six new test blocks: the four dash forms and a serial-prefixed one all yielding name, guardian and `+8801712345678`; the Bangla forms and a number typed `017 ১২৩৪ 5678`; both compound names surviving intact; a dash line with no guardian being a student and not a problem; and — the one that matters most — the five verdicts unchanged, since a separator changing must not change what the parser refuses. **Then §§11.10–11.14 and §14.1, which are the questions the money model raised and did not answer.** §11.10: prices have versions, `price_versions` is seeded by migration and select-only with no app write path, and the four numbers live in SQL *and* in `plans.ts` the way `plan_allowances` already does it — a test that regexes the seed statement out of the `.sql` file and compares it, because a third copy would pass while both of the others drifted. A settled day is never repriced, existing credit buys days at the new rate, and a quote is honoured while its intent lives. §11.11: the bonus is a **promotion**, a row with a code, a window and tiers in basis points, not a formula in a branch — and a recharge writes **two** ledger entries, the cash and the bonus, because ৳7,800 is revenue and ৳390 is not, and one merged ৳8,190 makes every revenue figure in the product a lie. The browser never says what the bonus is. §11.12: one counting function, the same one the capacity trigger reads, and a twelve-row table saying what each lifecycle event does to the count — a merge drops it and is **not** backdated, a branch archive drops it, a 200-row import raises it at once with §20.5's consent as the fence — plus the high-water rule with its three properties, and the flat refusal that if the count cannot be read then nothing is charged. §11.13: `settlement_runs`, four statuses, and `insufficient_balance` named explicitly as **the product working** rather than an incident, since it will be the most frequent row in the table; `usage_unavailable` is the only one that needs a human. Three reconciliation queries on the founder panel — the column against the sum, the `before + amount = after` chain in `created_at` order, and gaps in charged days — and a manual retry that is a new attempt through the same idempotent function with a written reason, never a second calculation. What must never be logged is named: no student name, no guardian number, no transaction id, no balance. §11.14: the fifteen-row old→new matrix, which is the only way step 24 is safe — preserve `payments.amount_bdt`, stop writing `covers_period_*`, archive `paid_through`, replace **both** of its derivations with one ledger trigger, delete `coverageLapsed` and `GRACE_DAYS` with their tests in that same commit, migrate `status='trial'` into granted days, and back-fill `charged_through = greatest(coalesce(paid_through, today), today)` with a zero `migration_opening_balance` per centre so every centre has a first ledger row and none has a balance that came from nowhere. Verified on a restore into a throwaway Supabase project, never on a local copy of production data. §14.1: seven legal pages led by **Prepaid Billing Terms**, `policy_acceptances` with a version per acceptance, both languages with Bangla the one that matters, and no compliance claim we have not been audited against. §16.1 gains four steps for all of it, and 25a — the legal pages — is pinned to the same week as step 25 rather than left to follow it, because the first taka must not arrive against nothing written. §15 also records two things this document had assumed about the code and that are false: the search boxes make no requests to debounce (a no-JavaScript GET form and an in-memory filter, and a client-side search would cost the URL state, the back button and the offline shell), and the paged reads already refuse rather than truncate. Counts: 1,423 pglite RLS checks, **1,599 unit tests**, 162 live RLS assertions, 77 migrations. Suite green. Next is step 21, the ledger. |
| 2026-09-20 | **Both halves of step 26: the two founder levers, and the sign a grant of days was never allowed to carry.** §11.7 says a grant is *days, not fake money* — "it cannot be spent on anything else, it cannot be confused with taka a customer actually paid" — and `20260811000078` had declared the kind with a comment pricing it "at the rate in force so that the balance stays the only currency" and pinned its sign to `amount_poisha > 0`. The masterplan is the intent and the comment was the bug (§0): `20260811000086` corrects the sign to `= 0`, lets the entry name a `charge_date` — the last day the grant reaches — and adds the second arm to `app.ledger_apply_to_center`, which until now advanced `charged_through` on a daily charge and nothing else. **A grant starts at today when the line is behind it**, which is the whole difference between a lever and a gesture: a centre that ran dry a fortnight ago is read-only, and three days added to the line it lapsed at would leave it read-only while the founder rang back to apologise again. **Both levers are definer functions rather than writes through the admin key** — `founder_adjust_balance(center, poisha, reason)` and `founder_grant_days(center, days, reason)`, each asking `app.is_platform_admin()` inside itself, writing `auth.uid()` and the founder's own words onto the row, and taking no date from the caller: the grant works the day out from the line the row actually holds and `(now() at time zone 'Asia/Dhaka')::date`, never `current_date`. A blank reason, a zero adjustment and a negative grant are refused in SQL as well as in the form, the balance is read under the ledger's own advisory lock, and an adjustment that would leave it below nothing raises `23514` — the strictest reading of §11.7's "a correcting adjustment may, deliberately" against the table's own `billing_ledger_no_overdraft`, with the disagreement named in the migration rather than quietly resolved. §11.13's third question narrows as `20260811000081` said it would: a granted line past today is an explanation, not a finding. **The founder's card gets the two forms, under a line that says what the centre holds and how far its days already reach** — every sentence composed on the server except the one that has to redraw as the founder types, the day a grant will reach, which crosses as `{date}` and is filled by `lib/i18n/fill.ts` from `grantReach` in `lib/billing/levers.ts`; the SQL half's own answer is asserted equal to it in `scripts/test-levers.mjs`, so the screen and the database cannot promise two different days. The levers' words are a fragment of their own (`lib/i18n/levers.ts`) for the reason `./recharge.ts` records: the dictionaries are 266 KB and 547 KB and the tooling that edits this repository writes only the first hundred kilobytes of a file. Also in this commit: `balance_poisha` and `charged_through` gain audit rules, so the centre's own activity screen says *prepaid balance changed* with the figure on it rather than *something changed*; the levers' words exist in both languages; and the gate in `tests/founder-queue.test.ts` now names the balances read in the same round trip. Counts: 86 migrations, 1,466 RLS assertions, 1,657 unit tests, 27 lever checks — all green. Next is step 27, the billing screen. |
| 2026-09-23 | **§20.8 step 27 is built: the billing screen answers §20.4's five questions off the balance, and the plan page is a redirect.** The screen reads the balance rather than a subscription date, so the questions arrive in the order the money makes them urgent: how long have I got, with the days left in the reader's own numerals and the date the money reaches written under them; how much is left, then what that is worth as a day and a month at the size the centre is now; why is it that much, from the tier and the three counts it was priced from; how do I add more; and what has happened to my money. **Two of the answers are deliberately not numbers.** A centre on the free tier is told it has no balance to run down rather than shown a countdown that will never start, and a paid one whose rate could not be read gets a sentence where a zero would be a figure — the same distinction §11.12 draws, on the screen built to be trusted about money. **The history is a fold and not a group-by.** §11.7 tops a day up when the roster grows, so one Dhaka day is a base `daily_charge` and a second row that says so; `lib/billing/history.ts` sums the pair into **one** day at the high-water count, because that is what the customer paid for and two lines would charge them twice for a single day. A topped-up day is marked so the reader can see why its figure moved; an unreadable count stays null rather than becoming a zero, and §11.14's `migration_opening_balance` is counted and never drawn. The ledger read is the owner's — `billing_ledger_owner_read` — and a manager's screen does not ask for it at all rather than being handed an empty list that reads as *nothing has ever happened*. **The pricing bands are behind a disclosure and they are the plan page's own calculator**, which is §33 and the fold being one decision: one engine priced both screens and there was never a second copy of the numbers to fold in. Question 4 mounts the recharge panel itself, so the product has one recharge form rather than two. **And the demolition landed with the screen rather than after it: `/settings/plan` is a redirect.** Its body is one `redirect()` call and the docblock saying why the route stays, because a URL people bookmarked and `settings/plan/receipt/*` were addresses rather than artefacts. The module under it moved wholesale into `settings/billing/` — actions, the purchase cards, the calculator, the receipt — so the relative imports inside needed no edit and four importers were the whole of the wiring. **What the demolition deliberately left standing is the four cards step 28 retires.** `recharge-panel.tsx` says in its own words that retiring the coverage-based buy flow is step 28, so the places card with the pending purchase, the branch asks and their two answers and the buy form, the subscription request, and the four-tier ladder in a disclosure are `settings/billing/plan-cards.tsx` now, drawn at the foot of the five questions; `ask-row.tsx` came with them because it is the only control that answers a manager's places ask, and a centre able to ask with nobody able to answer is worse than the screen step 27 set out to delete. What went instead is what the new screen answers better: the three-fact strip, the usage table, the two feature tick lists and the receipts list. **One live defect went with the route.** `deleteTeacher` revalidated `/settings/plan`, which renders a redirect and no figure at all, so the day's rate could be served stale from the Router Cache on the one screen that shows it; it revalidates `/settings/billing` now and `tests/teachers-page.test.ts` holds the list. Eleven in-app links were repointed and every revalidation that named the old route moved with them; the settings hub's plan row was removed rather than repointed, since two rows to one screen is not a hub; and `tests/plan-page.test.ts` went with the screen it tested. `tests/billing-page.test.ts` holds the new one: the five questions in order, the balance read off the session rather than recomputed, the bands inside the disclosure, the fold's five real row shapes, and that a manager's history is never asked for. The screen's words are a fragment beside `recharge.ts` and `levers.ts`, for the measured reason those two record. Counts: 86 migrations, 1,466 RLS assertions, 1,672 unit tests, 27 lever checks — all green. Next is step 28, the retirement of capacity: §18's fourteen bullets, `student_capacity` last. |
| 2026-09-23 | **The nightly settle exists, after §11.7 and §11.13 described it in the present tense for two days of build order.** `/api/cron/settle` calls the same function the session calls, for every centre, so an owner who has not logged in — and the founder panel — reads a current line instead of whatever it said the last time somebody opened the app. **It may not have a second calculation, and §11.13 says so in its own words.** So the call goes through `settleDay`, the session's own helper, which now takes the caller (`session` for a member opening a page, `system` for the cron) and answers with the settlement *and* the two fields only a log reads: the SQLSTATE PostgREST reported and its message. The RPC cast and the parse stay in one file, and the session destructures what it needs from the same attempt — `const { settlement: settled } = await settleDay(...)` — which is what keeps one call shape between a page load and the timer. **The free tier is skipped by the rule that was already there.** `dailyBurn` asked a question that only a session could ask, because it wanted a whole billing record; the rule inside it is now `burnsMoney(plan)`, so the cron asks the same question about a row from `coaching_centers` rather than restating `pricing !== 'free'` for itself. That is not a second opinion about the money — it is the same one, in one place, for the day the free tier gains a rate. **No status filter, deliberately.** A suspended or cancelled centre still owes for the days it ran, and its access is decided by `status` before any balance is consulted; a filter here would be a second opinion about the money, and the day it drifted from the resolver would be the day a centre was charged for a life it had stopped living. **What is logged is §11.13's four fields and nothing else.** The centre id, the date, the status and the SQLSTATE — never a student's name, a guardian's phone number, a transaction id or a balance, because a log is a place data leaks from. The SQLSTATE is logged where it exists and invented nowhere: a call that never reached the function carries PostgREST's own code, and a failure *inside* the function logs `none` because that night's `settlement_runs` row already holds `sqlerrm [sqlstate]` in `error_detail` — a second copy in a log that gets rotated away is not a record. The response body is counts for the same reason: Vercel keeps it. **The wall clock is the one hard limit, and "not load-bearing" is what makes it safe.** A run spends at most six seconds and considers at most five hundred rows, walking the stalest line first, so a small fleet finishes in a moment and a large one stops politely instead of being killed — and a run that is killed loses nothing at all, because access is a comparison over two columns and the next session catches up every day it owes in one call. `maxDuration` is not exported, for the reason the SMS worker records: it would raise the ceiling on a plan that allows it and fail the deployment on a plan that does not. **The schedule is `10 18 * * *`, and the arithmetic is the point.** Vercel reads cron schedules as UTC and Dhaka is UTC+6, so this is 00:10 where the centres are: ten minutes after the day flips, which is the earliest a run can charge *today* and the latest it can be without an owner opening the app first. Charging the day at its smallest size is not a discount — §11.7 makes the day's total the high-water rate, so the morning's first write tops it up to whatever the roster has grown to. Nine assertions in `tests/settle-cron.test.ts`, negative-tested against ten mutations — an endpoint that falls open with no secret, the session caller in place of the machine, the free tier restated as a plan name, a fifth field in the log line, a budget longer than the host will live, the ordering dropped, its own RPC call, an actor named on a machine write, a route segment config, and a schedule pointing at a path with no route — all ten caught. One operator step and it is the same one the SMS drainer already has: `CRON_SECRET` must exist in the Vercel project, or the nightly run is a visible 401 in the dashboard rather than a job that only appears to be working. Counts: 86 migrations, 1,466 RLS assertions, 1,681 unit tests, 27 lever checks — all green. Next is still step 28, the retirement of capacity: §18's fourteen bullets, `student_capacity` last. |
| 2026-09-25 | **§16.1 step 28 is built — capacity is retired in code, and the ceiling outlived it by one migration.** Three passes, and the order was the point. The controls went first — `plan-cards.tsx`, `ask-row.tsx` and `buy-subscription.tsx` deleted, `contact-card.tsx` kept because it is the one block §20.4 says survives — so that by the time anything was subtracted from the schema, no screen could reach it. Then the vocabulary, which is what made the subtraction safe: `ceiling`, `studentRoom`, `capacityPressure`, `quoteSeats`, `capacityBands`, `nextSeatCostBdt` and `ASK_PLACES` out of `plans.ts` (1,019 lines to 740), with `entitlement.ts` losing the third field its resolver used to answer and `session.ts` losing the column it selected to feed it. **Then `20260811000087`, and the one genuinely dangerous line in the whole cut.** §18 replaces purchased capacity with "there is no ceiling on a per-student tier" (§3.3), and that is *not* the same as the allowance it used to be floored at: `plan_allowances.included_students` is 79 for `center` and 238 for `institution`, so deleting the `student_capacity` term rather than loosening it would have refused a 500-student centre its 80th active student — in the middle of an admission season, on the day the product stopped selling seats. The per-student tiers therefore answer `integer`'s maximum, the same spelling 20260811000075 already uses for "no ceiling sorts last", and the teacher tiers keep 30 and 150. A sentinel and not a null, deliberately: null is what `app.student_ceiling` returns for a centre that does not exist, and `app.guard_student_capacity` reads that null as "this insert has no tenant" and raises 23503 — one value carrying two meanings inside the function every admission passes through is how a missing centre becomes an admitted student. **What the migration does not do is drop anything.** §11.14 says *archive* the column and *preserve* `payment_intents.purpose`, `quantity`, `grants_capacity` and all four enum values, so the payments that bought those places still explain themselves — and `src/lib/supabase/types.ts` regenerated from the live project with **not one line changed**, which is the proof that 87 added and removed nothing. **The refusal is a money rule rather than a capacity one.** `settle_payment_intent` raises on `grants_capacity > 0` before it writes a receipt, because the ceiling that intent names can no longer be raised and settling it would take the customer's money and hand over nothing; it is keyed to the *purpose* and not the plan, and the RLS suite asserts both tiers for exactly that reason — on `center` the ceiling is uncapped, so a check that watched whether the ceiling had moved would settle it happily. The read-back a retry gets is untouched, because a webhook delivered twice must not become a second charge. **And the guard survives, which is the half §18 keeps:** the plan allowance on the teacher tiers is §2.7's engineering cap, so `app.guard_student_capacity`, its trigger, its advisory lock and `CD001` all stay — what went is the sentence, which offered to sell places that no longer exist and now names a higher plan instead. One live defect went with it: the guard's hint was the last user-facing promise of a purchase left in the database. Counts: 87 migrations applied to the project, 1,469 RLS assertions, 1,663 unit tests, 27 lever checks — all green, `tsc` clean. §15 and §16.1 move with it. Next is §18's bullet 4 read as history rather than a workflow — `capacity_requests` can no longer be filed or answered from any screen, and `/hq` and the founder panel read the rows that already exist — and then the real bKash integration, held by the owner's decision of 2026-09-13. |
| 2026-09-30 | **The bonus ladder is re-anchored to months — the founder's own reading of the offer, found broken on a real centre.** The LAUNCH tiers were absolute poisha floors (৳7,800 / ৳15,600 / ৳31,200) calibrated on §11.6's ৳2,600 worked example, but the recharge screen prices every centre's buttons at multiples of **its own** monthly figure — so UDVASH's centre, billed ৳2,099 a month, is shown "3 months" at ৳6,297, which sits under the first floor and answers **0%**, and Teacher Pro at ৳499 a month can never reach any rung at twelve months of money. The defect is visible to the founder; the fix is their decision of 2026-09-30: **the bonus rewards commitment, not size — 1 month none, 3–5 months 5%, 6–11 months 10%, 12+ months 20%, with months derived as amount ÷ the centre's own monthly figure**. `20260811000088` moves the tiers' shape (`min_poisha` → `min_months`), replaces the two-argument `app.bonus_poisha` with a three-argument one that drops the old overload entirely — a stale caller must fail loudly rather than silently read months as taka again — and adds `app.monthly_bill_poisha`, the SQL mirror of `monthlyBillBdt` (floor, marginal bands, seats, branches), so the approval and the settlement price from one function instead of two copies. **The approval counts the claim's own snapshot, by the rule §11.12 already set:** the claim's stored `usage_students/teachers/branches` against the claim's own `price_version_id` card — never today's roster and never the newest card, so a customer approved tomorrow is not repriced by growth between the quote and the decision; counts or card unreadable prices no bonus, the same fail-closed direction every unreadable count takes. Months are floored in the customer's disfavour (2.9 months of money is 2 months of commitment; the ৳7,799 centre did not buy the third month), the bonus in poisha is floored in their favour, and the approval's answer now names the month it counted from (`monthlyPoisha`) so the decision explains itself. The worked example is invariant by construction: the fixture centre is 100/3/1 = ৳2,600 a month, so ৳7,800 stays 3 months and every existing literal in the suites holds. The TS mirror in `recharge.ts` moved in the same commit (`BonusTier` reshaped, quote, suggestions and `nextTier` all month-aware, `monthlyPoisha` a required input) — no window where the screen and the database disagree. Counts: 88 migrations, 1,469 RLS assertions, 1,663 unit tests, 63 recharge checks — all green, `tsc` clean. |
| 2026-09-29 | **The dictionary pass step 28's own tests recorded as owed — the retired places copy is out of both dictionaries, and §18's bullet 4 is now purely the read it says survives.** What was left after the three passes was the words: `tests/add-student.test.ts` said so in its own comment ("retired words waiting on the dictionary pass"), and the orphaned block was real — `settings.plan.places` still carried the whole buy flow (title, label, quote, submit, waitingTitle, refHint, lapsedNote, the ask refusals and the two answers), none of it drawn by any screen except the three keys `/hq`'s asks card uses (`asksTitle`, `askLine`, and the link label `title`). **`asksTitle` and `askLine` stay; the rest of the block went, from `en` and `bn` alike, and the link label is repointed** — "Buy student places" was a promise the product no longer makes, so `/hq`'s card now closes on "The branches waiting". The same sweep took the rest of the vocabulary whose screens step 28 had already taken: `dashboard.placesLeft`, `placesPooled`, `placesFull`, `placesLink`, `placesTight`, `placesTightBody` and `placesFullBody` (the ceiling they describe no longer exists); `settings.errors.placesFull` (the per-student tiers are uncapped — a comment now explains what replaced it and why the teacher tiers' refusal is `cap` fed by the surviving guard); `settings.students.places`, `placesNext`, `placesBuyNote`, `placesAsk`, `placesAsking`, `placesAsked`, `placesAskWithdraw`, `placesFreeLink` and `placesPlanLink`; the import screen's priced-shortfall block (`shortTitle` through `shortPlanLink`, thirteen keys that priced a shortfall nothing can produce); `platform.purchaseHolds` (the founder's confirmation no longer promises a count the purchase did not grant); and `hq.poolNote` with all six `growing*` keys (§17's pool note described a pool that was one organisation's ceiling, and the growth box went with it). **One dead read went with the words: `openAsk()` in `lib/billing/asks.ts`**, the single-branch half of the read that stopped a screen offering the ask button twice — there is no ask button on any screen, so the half had no caller and `openAsks()` (the /hq list) is now the module's only export, with its docblock rewritten to say the filing side is gone and the rows are history. `tests/pinned-manager.test.ts`'s qualifier test now asserts the absence rather than the presence — `placesPooled` and `poolNote` must not come back — and keeps `usedHere`, the one branch qualifier still drawn. Counts: 87 migrations applied to the project, 1,469 RLS assertions, 1,663 unit tests, 27 lever checks — all green, `tsc` clean. Next is the real bKash integration, held by the owner's decision of 2026-09-13. |
| 2026-10-04 | **The audit the owner asked for found a second salary one tap away, and the fence is arithmetic because the schema deliberately has none.** `/payroll/pay` re-prefills the whole agreed figure after a success, so a second tap on a settled row wrote a second full salary — and `20260811000044` has no unique index on (payee, for_month) on purpose (half on the 5th, half on the 20th, a reversing third), so the database was never going to refuse it. `20260811000051`'s idempotency index only answers a retry of one submit; the duplicate is permanent (`salary_payments` revokes DELETE), `center_profit_month` subtracts it as a real cost, and a voucher number is burned for a payment nobody made. **The rule is overpayment, not repetition.** `needsRepeatConfirmation` reads what the month already holds — a replay's own row excluded, so the token's second arrival still gets the voucher written the first time — against the live monthly agreement's net, through `sumTaka`; `./actions.ts` reads both before the insert, fails closed if either read fails, and refuses a positive payment that would take the month past the agreement until the form carries an explicit tick. The tick is drawn on every row that already has money on the month, so the refusal is never a dead end: the second half of a salary passes unticked as the ordinary instalment it is, an advance, a bonus or a settlement is one deliberate tick, a negative correction is never refused, and a per-class rate or no agreement has nothing to measure against and passes. Ten new tests, unit and source-shape, and the whole money-path read-again — fees, expenses, teach, exams, notices, progress, settings, the billing helpers — found nothing else above this. **Two more findings fixed in the same pass:** old `/settings/plan/receipt/*` links 404'd even though the plan redirect's own note names that sheet as the reason the route survived — a forwarding page under the old path restores it, and the two route gates learned to read a prefix redirect; and `PROJECT.txt` still counted 87 migrations and 1,663 unit tests, now 88 and 1,675 (the README was still create-next-app boilerplate and is now the real one). **One finding left standing with a recommendation rather than a quiet deletion:** step 28 deleted the buy controls, but `buySubscription` and `cancelPurchase` are still exported from `settings/billing/actions.ts` — public endpoints for a flow no screen reaches, kept alive by the `settings.plan.subscribe.*` words — and `session.ts`'s `paidThrough` docblocks still describe that flow as live; they should go together in their own commit. Also unchanged and still on the operator: `NEXT_PUBLIC_SALES_PHONE` in Vercel, which gates the recharge screen's contact buttons. Counts: 88 migrations, 1,675 unit tests, 63 recharge checks, 15 legal checks, 27 lever checks — all green, `tsc` clean; the RLS suite was not re-run because no SQL changed. |
| 2026-10-06 | **The owner could not find the number to send money to, and that is the whole recharge flow — so the number is now the largest figure on the card, and the audit's last finding went with it.** `NEXT_PUBLIC_SALES_PHONE` is set in the deployment, which unblocked the send block, and the first thing the block did was bury the number inside the form's own grey instruction sentence — "send exactly the amount above to 017…" — printed as a footnote, at `text-sm`, naming an amount nobody had chosen yet at that point on the page. **It is now a bordered block of its own:** the number at `text-3xl font-bold` in the reader's own digits, `select-all` because an owner reads it off one phone and types it into another, the two wallets named beside it as chips, and the amount line pointing *below*, where the amount actually is. **And it says bKash AND Nagad.** Everything here said bKash — `sendBody`, the TrxID hint, the "bad TrxID" refusal — so a Nagad customer was told, in three places, that this was not for them; `sendBody` and the dead `reference` went with it, replaced by `walletBkash`/`walletNagad`/`sendHow`/`sendAmount`. **Two status sentences that were one:** a lapsed balance used to reach `unreadable` — "your balance could not be read, reload the page" — over a balance that had been read perfectly well and simply held nothing, which is advice that changes nothing and teaches a customer the screen is guessing; `dried` says the true thing (read-only, send to the number below, nothing is lost while it is checked) and `unavailable` covers the deployment with no number configured, which is neither. **`unreadable` itself was wrong in the same way** and now names the price rather than the balance, because the price is what the panel actually failed to read — the balance arrives on the session and is drawn above either way. **THE AUDIT'S LAST FINDING, CLOSED AS ITS OWN COMMIT:** `buySubscription`, `cancelPurchase` and `UUID_RE` are out of `settings/billing/actions.ts` — public endpoints for the flow step 28 deleted, with six now-unused imports — their `settings.plan.subscribe.*` words are out of both dictionaries (which no screen had drawn since step 28), and `session.ts`'s `paidThrough` docblocks no longer describe a buy flow as live; `paidThrough` itself stays because a founder-recorded receipt still advances it and two screens still draw it. Three more dead words went from `recharge.ts` on the way past (`factDaysUnknown`, `offerCredit` and the i18n `nextTier`, none of them read by anything). One test was added where the complaint came from: `tests/billing-page.test.ts` now pins the send block's shape — the number at `text-3xl`, both wallets named, the amount line present, and the two failure sentences kept apart — so the footnote cannot come back. Counts: 88 migrations, 1,676 unit tests, 63 recharge checks, 33 billing checks, 15 legal checks, 27 lever checks, 105 server exports — all green, `tsc` clean; the RLS suite was not re-run because no SQL changed. |
| 2026-10-06 | **The tick was a hint and the button did not know about it — so the owner's sentence was exact: pay a salary, and the same full-colour button is still sitting over an unticked box.** PR #10's fence was real and server-side (`needsRepeatConfirmation` refuses an overshoot) but on the screen it was only a checkbox and a sentence that arrived *after* a tap: nothing was disabled, so the control that must not be tapped looked exactly like the one that may. **The lock is now the action's own rule, run in the browser.** `pay-row.tsx` holds the boxes' total (reported up by `Amounts`, which owns the figures) and a controlled tick, and disables the submit through `needsRepeatConfirmation` — the same function `./actions.ts` refuses with — so a dead button and a refusal can never disagree about one payment. It is measured on the live amount and not on `needsRepeat`, which is what keeps the ordinary second instalment payable: ৳7,000 after ৳6,000 sits under the agreement and never locks, while the second full salary that re-prefills itself locks on the first paint and unlocks the moment the tick is on. An amber line beside the box says what unlocks it, because a control that cannot be tapped has to say why. **And the tick no longer survives the payment it unlocked**, which is a real hole the lock alone would have left open: after a success the boxes remount to the agreement's figures, so a tick still standing was `confirmed: true` and the second full salary went through already confirmed — precisely the tap nobody meant. It is cleared in the same effect that mints the next idempotency token, at the moment the question becomes a new one. One word added to both dictionaries (`salaryPayForm.unlockHint`). **The whole-site button sweep that came with the request found nothing else:** every write submit already carries a busy guard (`disabled={pending}` or its per-row equivalent), every unguarded submit button in the app is a `method="get"` filter that writes nothing, and every raw `<button>` carries an explicit `type`, so none of them is an accidental form submit. Three source-shape tests in `tests/payroll-month.test.ts` pin the lock, the tick reset, and the pair the page hands down. Counts: 88 migrations, 1,679 unit tests, 105 server exports — all green, `tsc` clean; the RLS suite was not re-run because no SQL changed. |
