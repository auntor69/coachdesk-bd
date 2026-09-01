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

### 2.2 Teacher Pro trial — a state, not a tier ❌

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
| Students | **purchased capacity** — see §3.3. *Never* "unlimited" |
| Students per batch | **no limit** |
| Teachers | 2 included, then ৳100/seat/month |
| Subjects | **200** — an abuse ceiling, not a feature (§2.7) |
| Branches | 1 (the centre itself) |

**Adds over Pro:** staff management (create teacher accounts, assign batches,
grant permissions), centre-wide reporting.

**Price:** a ৳1,999/month floor plus marginal per-student bands (§3.1) plus
teacher seats. The floor is what a small centre pays; past roughly 80 students
the usage bands overtake it and become the bill.

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
- **One shared organisation-wide student capacity pool** — §3.6, the most
  important design decision in this section

**Limits:**

| | |
|---|---|
| Batches | **100 per branch**, not 100 in total |
| Students | shared organisation-wide purchased capacity (§3.6) |
| Students per batch | no limit |
| Teachers | 2 included org-wide, then ৳100/seat/month |
| Subjects | 200 org-wide — abuse ceiling |
| Branches | **3 included**, then ~৳750/branch/month |

**Price:** *custom, from ৳4,999/month.* Quoted, not published as a fixed public
number. The quote depends on branch count, capacity, and staff size. The engine
computes a defensible starting figure — ৳4,999 floor, plus student bands, plus
teacher seats, plus extra branches — and the founder can quote above it. The
branch allowance and per-branch fee are named constants so a negotiated deal does
not require a code change to *describe*, only to honour.

**Do not price Institution as Center × branches.** Four branches is not four
centres: it is one customer, one contract, one shared roster budget, and a
reporting surface that no single centre needs. Multiplying tells a 4-branch
institution to buy four accounts instead, which is exactly the outcome the
shared pool (§3.6) exists to prevent.

### 2.6 Comparison table

| | **Teacher Free** | **Pro trial** | **Teacher Pro** | **Coaching Center** | **Institution** |
|---|---|---|---|---|---|
| Price | ৳0 forever | ৳0, 14 days | ৳499/mo flat | from ৳1,999/mo + usage | from ৳4,999/mo + usage |
| Is it a plan? | yes | **no — a state** | yes | yes | yes |
| Batches | 1 | 5 | 5 | 100 | 100 **per branch** |
| Students | 30 | 150 | 150 | purchased capacity | shared org capacity |
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

### 3.1 Marginal student pricing

Per-student rates are **marginal bands**, the same shape as income tax. Each
band's rate applies only to the students inside it.

| Students | Rate each |
|---|---|
| 1–100 | ৳25 |
| 101–300 | ৳18 |
| 301–600 | ৳12 |
| 601+ | ৳8 |

Marginal and not flat-per-tier, because with flat tiers a centre at 301 students
would pay less than one at 300 — a pricing page that makes the founder look like
they cannot count. Marginal bands make the bill continuous and always rising.

**These rates are uncalibrated.** The structure is sound; the numbers are a
founder's judgement with no market survey behind them. The first twenty customers
all sit in the first two bands, so ৳12 and ৳8 are theoretical until year two.
Recorded as an open item in §11, not as a settled fact.

**Worked bills** (Center, no extra teacher seats):

| Students | Bill | Which part bites |
|---|---|---|
| 50 | ৳1,999 | floor |
| 79 | ৳1,999 | floor, just |
| 100 | ৳2,500 | bands |
| 150 | ৳3,400 | bands |
| 300 | ৳6,100 | bands |
| 600 | ৳9,700 | bands |
| 1,200 | ৳14,500 | bands |

### 3.2 What the floor buys

The floor is a minimum, not an add-on: the bill is
`max(floor, bandSum(students)) + teacherSeats + branchFees`.

**A floor therefore already includes some students, and that number is derived,
never typed.** At ৳1,999 the first band covers 79 students (79 × ৳25 = ৳1,975;
the 80th tips it to ৳2,000). At Institution's ৳4,999 the floor covers 238.

This matters for top-ups (§3.4): while the floor is biting, extra students cost
the customer nothing extra per month, so charging for those seats would be
billing twice for the same taka. The derived figure keeps that honest and cannot
drift, because it is computed from the same bands the bill is.

### 3.3 Student capacity — plan and capacity are separate concepts ✅

**This is the central architectural decision of this revision.**

> **The plan decides which features and permissions exist.
> The capacity decides how many students have been paid for.**
> They are two columns, not one.

For **Teacher Free** and **Teacher Pro**, the student ceiling is a plan cap: 30
and 150, fixed, not purchasable. For **Center** and **Institution**, the ceiling
is **purchased capacity** — a number the customer has paid for, stored per
organisation, raised by paying, and never "unlimited".

**"Unlimited students" is retired** (⛔, §13). It was never true: we bill per
student, so a plan that promises unlimited students promises an unlimited bill and
enforces nothing. Worse, it made the caps unenforceable by construction — there
was no number for a check to compare against.

**Why not just derive capacity from the last payment?** Because a payment is
evidence of a past event and capacity is present state, and the two diverge the
moment anything is refunded, corrected, or granted by hand. Capacity is stored;
payments are the audit trail that explains it (§3.8). The invariant is that
capacity equals the sum of the grants recorded against it, and that invariant is
checkable.

**Two nulls that must not be confused.** `maxStudents === null` currently means
"unlimited". After this change, Center and Institution have neither a number nor
unlimited — they have "ask the capacity". The type must say so out loud rather
than overloading `null`:

```
StudentCeiling =
  | { kind: 'plan';     max: number }        // Free 30, Pro 150
  | { kind: 'capacity'; purchased: number }  // Center, Institution
```

A call site that forgets to handle `capacity` then fails to compile, instead of
silently treating a paying centre as unlimited.

### 3.4 Adding one student past capacity ✅

The rule: **the customer thinks about adding a student, never about managing
seats.** Capacity is our accounting concept and must not become their chore.

What must **not** happen, and is what a naive implementation produces:

> reach the limit → get refused → go to the plan page → work out how many seats
> → pay → come back to students → find the button again → add the student

The flow instead lives inside the add-student button:

```
[+ Add Student]
      │
      ├── capacity available ──→ student form, as normal
      │
      └── capacity exhausted ──→ "You have used all 120 of your student places.
                                  One more place costs ৳18."
                                  [ Pay ৳18 and add the student ]
                                        │
                                    payment recorded
                                        │
                                  capacity 120 → 121
                                        │
                                  student form opens automatically
```

The price shown is the **marginal cost of the next seat**, from the same bands
the monthly bill uses: `bill(capacity + 1) − bill(capacity)`. At capacity 120
that is ৳18. At capacity 300 it is ৳12. At capacity 50 it is **৳0**, because the
৳1,999 floor already covers 79 students and charging again would be double
billing — the dialog says the place is already paid for and opens the form.

Buyable one seat at a time, any number of times. The remainder of the current
coverage period is not pro-rated: a seat bought on the 25th costs the same as one
bought on the 1st. Deliberate — the amounts are ৳8–25, and a pro-rated line item
costs more in confusion than it saves in taka. Flagged in §11 as a decision to
revisit if a customer ever raises it.

### 3.5 Bulk import past capacity ✅

Centres load students in bulk — from Excel, from a paper register typed up at
night, up to about 500 at a time. The import must be billed as one transaction
and must never be a way around capacity.

**Order of operations, and none of it may be reordered:**

1. **Parse and validate the whole paste.** Bad rows are shown to the owner.
2. **Subtract rows already on the roster.** The import already matches on name +
   guardian phone and skips duplicates; only genuinely new students consume
   capacity, so an owner who pastes the same register twice is charged nothing the
   second time.
3. **Compute the capacity needed** — new students, minus places still free.
4. **Price it from the same bands**, as one marginal calculation across the whole
   block. Never per row in a loop; that is how rounding and band boundaries drift.
5. **Show the total** with the breakdown, before any money moves.
6. **Take payment.**
7. **Only then create the students** — all of them.

**All or nothing, in both directions:**

- Payment fails → **zero** students created. Not the ones that fit.
- Payment succeeds → **every** validated student created, in one transaction.

A partial import is the worst available outcome: the owner cannot tell which half
arrived, re-pasting is the obvious next move, and re-pasting is when duplicate
children appear in a roster that bills per child.

**Worked example.** Capacity 120, all used. Import of 200 new students → capacity
must reach 320.

```
bandSum(320) = 100×25 + 200×18 + 20×12 = ৳6,340
bandSum(120) = 100×25 +  20×18          = ৳2,860
additional capacity                     = ৳3,480
```

Which reads, on screen, as: 180 places at ৳18 = ৳3,240, plus 20 places at ৳12 =
৳240. The bands are shown because a single ৳3,480 invites the suspicion it was
invented.

### 3.6 Institution: one shared capacity pool ✅

**Capacity belongs to the institution, never to a branch.**

What we must **not** build:

```
Dhaka       = 1,200 seats
Chattogram  =   700 seats
Cumilla     =   400 seats
```

Because branch populations move constantly — a batch opens in Chattogram, an SSC
cohort graduates out of Cumilla — and per-branch quotas turn every ordinary
enrolment into an HQ reallocation request. It creates administrative work that
exists only because of how we chose to count.

Instead there is **one organisation-wide pool**:

```
Purchased capacity: 2,600

  Dhaka       1,300
  Chattogram    600
  Cumilla       500
  Sylhet        200
  ─────────────────
  Total       2,600 / 2,600  (full)
```

Chattogram enrolling 100 more takes the organisation to 2,700 — one capacity
purchase at HQ level, no reallocation between branches, no conversation about
whose seats those were. **The seat belongs to the institution, not the branch.**

### 3.7 Institution: branch staff and the billing owner ✅

Branch staff press **+ Add Student** and should not have to know that billing
architecture exists. But a branch manager is not the billing owner and must not be
able to increase the organisation's monthly cost on their own signature.

So the branch flow forks on *who* is looking:

| | capacity available | capacity exhausted |
|---|---|---|
| **Branch manager** | student form, normally | "The organisation has used all 2,600 of its student places. Ask HQ to add capacity." + **[ Request 25 more places ]** |
| **HQ admin** | student form, normally | the pay-and-continue dialog from §3.4 |

The request is a real record, not an email: who asked, which branch, how many
places, when, and its resolution. It appears on the HQ dashboard and in the
founder panel. HQ approves it by paying; approval is what raises capacity.

**Capacity warnings**, organisation-wide, shown to HQ and to branch managers:

```
Student capacity   4,500
Current students   4,280
Remaining            220   (5%)
```

| Remaining | Behaviour |
|---|---|
| ≤ 20% | notice on the HQ dashboard and on the students screen |
| ≤ 5% | urgent — persistent banner, HQ told which branches are growing |
| 0 | new student creation blocked; **[ Add capacity ]** is the only way forward |

Thresholds are constants, not literals sprinkled through screens, so they can be
tuned without hunting.

### 3.8 The payment model ❌ (partly ✅)

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
       status = suspended | cancelled  →  read-only
       otherwise                       →  full

  2. plan:
       trial_ends_at > now             →  trial_plan
       otherwise                       →  plan

  3. student ceiling:
       plan cap is a number            →  { plan, max }
       plan is capacity-based          →  { capacity, org.student_capacity }
```

Everything downstream — every feature gate, every cap check, every permission
helper — reads the *result*. None of them learns whether it was a trial, whether
a payment lapsed, or which branch asked. That is what stops trial logic from
metastasising into forty call sites.

**Fail closed, in the established direction.** An unreadable organisation row
resolves to Teacher Free, the most restrictive tier — never to the loosest. An
unreadable *count* refuses the action rather than treating the count as zero,
because one failed count would not let one extra student past a cap, it would let
eighty.

### 4.3 Trial lifecycle ⚠️ (read, never started)

| Event | What happens |
|---|---|
| Teacher signs up | `trial_plan = teacher_plus`, `trial_ends_at = now + 14 days` |
| Days 1–14 | resolver returns Teacher Pro. Every Pro feature works |
| Day 10 | in-app notice: 4 days left, what will change, how to keep it |
| Day 14 | resolver stops returning the trial plan. **No job has to run** |
| After | Teacher Free entitlements. All data intact (§4.5) |
| They pay | founder sets `plan = teacher_plus`; trial fields cleared |

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

### 4.4 Subscription lifecycle ✅

The four statuses, and what each one must actually do:

| Status | Access | Reached how |
|---|---|---|
| `trial` | full | signup, or the founder starting a sales trial |
| `active` | full | a payment recorded, covering the current period |
| `suspended` | **read-only** | coverage lapsed past the grace window, or by hand |
| `cancelled` | **read-only** | the customer left |

**Read-only means read-only, not locked out.** Attendance history, marks, the fee
board, and the roster all stay visible. What stops is *writing*: no new students,
no attendance, no payments recorded, no messages sent. Plus a banner that says
plainly what happened and how to fix it, with the founder's number on it.

Locking a lapsed customer out entirely is the wrong lever. Their data is their
term's attendance and their outstanding fee book; taking it hostage turns a
late-payment conversation into an angry one, and they will not come back. Read-only
is uncomfortable enough — they cannot run the centre on it — without being a
threat.

**Coverage, and the grace window.** A payment records the period it covers. When
today is past `covers_period_end` the account is in grace; past grace it is
suspended. Grace is a constant (proposed: **7 days**) and the transition is
computed from coverage, not from a flag somebody remembered to set.

Built in `20260811000059`: `coaching_centers.paid_through` holds
`max(payments.covers_period_end)`, maintained by a trigger and unwritable from a
browser, and `src/lib/entitlement.ts` compares it against today in Dhaka with
`GRACE_DAYS = 7`. The `status` column never moves on its own — the suspension is
recomputed on every session, so it arrives on the right day whether or not anybody
is watching and un-happens the moment a receipt is recorded. `suspended` therefore
stays what it says in the table above: the one a person set by hand. A centre with
no recorded coverage is not lapsed, which matters because the first paying customer
has no row in `payments`.

**No dunning, no auto-charge, no card on file.** With customer counts under fifty
the monthly bKash conversation is a feature: it is when churn gets caught. What
must be automatic is only the *consequence* of non-payment, because that is the
part a founder cannot be trusted to do consistently to a customer they like.

### 4.5 Downgrade and expiry — nothing is ever deleted ❌

The rule, in one line: **limits apply to new actions, never retroactively to
existing records.**

A teacher who created 90 students and 4 batches during a Pro trial, and then
dropped to Free:

| | |
|---|---|
| Their 90 students | **all still there**, all still visible, all still editable |
| Their 4 batches | **all still there**, attendance and marks intact |
| Adding student 91 | refused |
| Adding a 5th batch | refused |
| Printing a receipt | refused — Pro feature |
| Exporting | refused — Pro feature |
| Deleting a student to get under the cap | allowed, but never required |

A downgrade is also not allowed to be silent. The account lands on a screen that
says what is now read-only and what it costs to have it back, because a customer
who discovers a locked export at 9pm the night before a parents' meeting will not
read it as a billing state. They will read it as the software breaking.

---

## 5. Identity and authentication

### 5.1 Two things that are not the same thing

A **teacher record** is a row in the register: a name, the subjects they teach,
the batches they hold, the marks they enter. A **login account** is a credential
that opens the app.

These are separate on purpose, and the separation is not new — `teachers.user_id`
has been nullable since the first migration, with the comment *"A teacher row can
exist before that person ever signs in."* What was missing is the second half:
a way to give that person an account **afterwards**, without a phone number.

| | |
|---|---|
| Manager adds a teacher to the register | no account, no phone needed, works today ✅ |
| Manager later opens that teacher and taps **Create Login Account** | ❌ not built |
| Teacher's phone number | **optional**, always |
| Teacher OTP | **never required** — see 5.5 |

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

### 5.3 Signing in with either one ✅

One field, labelled **"Phone number or username"**. The server decides which it
received: if it normalises as a BD mobile it is a phone, otherwise it is a
username. No radio button, no second tab, no "are you a teacher?" question —
because the person signing in does not think of themselves as an auth strategy.

This must not break the accounts that already exist. Phone login works today by
mapping the number onto a synthetic address at a reserved TLD
(`8801712345678@phone.coachdesk.invalid`), because Supabase needs an email and
real phone auth needs a sender ID we do not have. Usernames extend the same trick
with a second reserved domain rather than replacing it, so every existing
password keeps working and nobody is re-signed-up.

### 5.4 Owner and manager signup needs OTP 🚧

**This is a real security hole in the product as it stands, and it should be
written down as one.** Today an owner signs up by typing a phone number and a
password. Nothing checks that the number is theirs. Anyone can register using
another person's phone number — and since `profiles.phone` is unique across the
platform, doing so also **denies that number to its actual owner forever**. It is
not only impersonation; it is a squatting attack on the identifier we use to
recognise returning customers.

So: a one-time code, sent to the number, before the account exists.

| Control | Requirement |
|---|---|
| Code length | 6 digits |
| Expiry | short — proposed 5 minutes |
| Verification | **server-side only.** The browser never learns the code it is checking against |
| Max attempts | small and counted per code; burn the code when exceeded |
| Resend cooldown | proposed 60 seconds |
| Per-number ceiling | a cap per number per hour, and per IP per hour |
| Storage | hashed, with the attempt count and expiry beside it |
| Normalisation | the number is canonicalised **before** anything is sent or stored, so `01712…`, `+88017…` and `০১৭১২…` are one number and not three |

**Teachers are exempt, deliberately and permanently.** Their phone is optional, so
there may be no number to send to; and the account is being issued by their
employer inside a centre that already exists. Re-introducing teacher OTP would
make the register unusable for the exact centres we are selling to — the ones
whose part-time physics teacher does not want to be in a database. This is
written here as a rule and not a preference: **teacher account creation must never
require OTP.**

**Blocked on the same thing everything else is blocked on.** OTP delivery needs an
SMS route, which needs a BTRC-approved sender ID, which needs an aggregator
account, which needs an NID. Until that exists the OTP layer is built against a
provider interface with a development transport that logs the code server-side —
never displays it in the browser, never returns it in a response body. The
interface is the deliverable; the SMS provider behind it is one file.

Provider credentials live in server-only environment variables. They are never
imported into a client component, never returned from a Server Action, and never
logged. This is the same rule the service-role key already lives under.

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

### 6.2 The roles the spec adds ❌

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

### 6.3 Attendance belongs to teachers ⚠️

**The teacher is the normal person who takes attendance.** They are in the room.
They know who is absent. A manager sitting in an office does not, and a product
that presents the manager as the attendance-taker is describing a workflow where
somebody copies a paper sheet into a computer an hour later — which is the exact
job this app is supposed to delete.

What exists today: teachers can take attendance for batches they are assigned to,
enforced in the database by `app.teaches_batch()`. That part is right.

What is wrong: a staff admin opening `/teach` sees the whole centre rather than
their own timetable, and in RLS the manager and the teacher hold **identical**
write power over attendance — same policy shape, same `FOR ALL`, no distinction
between taking a register and correcting one.

The fix is presentation and accounting, not removal:

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

### 7.1 Student lifecycle ⚠️

Today: `active`, `inactive`, `graduated`, `dropped`. Two more are needed —
**`transferred`** (moved to another branch of the same institution) and
**`suspended`** (temporarily barred, still enrolled, still owing).

**Only `active` students are chargeable.** This is the sentence that makes capacity
survivable: a centre that has taught for three years and accumulated eight hundred
former students is not billed for eight hundred. It is billed for the two hundred
sitting in rooms this month. A student who leaves frees their seat; a student who
returns takes one again, and if none is free the reactivation is refused with the
top-up price beside it — the same dialog as adding a new student, because it is the
same transaction.

### 7.2 Branch transfer must not be a delete ❌

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

### 7.3 Scheduling — audit says it partly exists ✅⚠️

`batch_schedules` already holds a recurring weekly timetable: batch, day of week
(0 = Sunday, because the BD week runs Saturday to Thursday), start time, end time,
unique per batch-day-time, with a check that the end is after the start.

That is real and it works. What is **not** there, and is documented as future work
rather than built now:

| | |
|---|---|
| Rooms | ❌ no room entity, so no room double-booking check |
| Teacher clash detection | ❌ nothing stops one teacher being scheduled in two places |
| One-off changes | ❌ no per-date override, no cancellation, no holiday calendar |
| Term dates | ❌ a schedule is open-ended |

Clash detection is the one worth doing first, and it is cheap: the data to detect
it is already in the table.

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

### 8.1 What a branch is ⚠️

An Institution is one organisation with several physical locations under one owner,
one bill, and one shared pool of student places. A branch is not a tag on a
student and not a dropdown that filters a list. It is the scope that decides what
a signed-in person can read at all.

**The groundwork is genuinely in place**, and it is better than it looks: a
`branches` table with a unique `(id, coaching_center_id)` key, and `branch_id` on
five tables — `center_members`, `teachers`, `batches`, `students`, `notices` —
each wired through a **composite** foreign key
`(branch_id, coaching_center_id) → branches (id, coaching_center_id)`. That
composite is the part that matters: it makes it structurally impossible to attach
one centre's row to another centre's branch, which a plain `branch_id` FK would
happily allow.

**The gap is that nothing reads it.** `branch_id` is loaded into the session and
then never used again — three references in the whole of `src/`, all in one file.
The branches RLS policy is centre-wide: any member of the organisation can read
and write every branch's rows. So today an Institution is a Center with a table
nobody consults, and a branch manager can see every branch.

### 8.2 What has to become branch-scoped ❌

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

### 8.3 What HQ sees ❌

The organisation-wide view is the reason somebody buys this tier: revenue and
expenses per branch, students per branch, collection rate per branch, and the
shared capacity pool with what is left of it. A branch comparison table where the
branches are rows, so the owner can see which one is carrying the others.

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

### 9.1 Three numbers that must never be confused ✅ (rule) ⚠️ (surfaced)

| Number | What it means | Where it comes from |
|---|---|---|
| **Charged** | what we billed | `fee_invoices.amount_bdt − discount_bdt` |
| **Collected** | what actually arrived | sum of `fee_payments.amount_bdt` |
| **Outstanding** | the gap | charged − collected, per invoice |

Reports must label which one they are showing. "Revenue" that silently means
*charged* tells an owner they had a good month while the cash never came, and that
is the single most expensive lie a finance screen can tell.

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

### 9.3 Fees: due dates, part payments, discounts ⚠️

| | Status |
|---|---|
| Due date per invoice | ✅ `fee_invoices.due_date` exists |
| Partial payments | ✅ many payments per invoice, already works |
| Fixed-taka discount | ✅ `discount_bdt`, bounded by `check (discount_bdt <= amount_bdt)` |
| Percentage discount | ❌ |
| Named scholarship / waiver, reusable across students | ❌ |
| Overdue tracking and an arrears list | ✅ built |
| Instalment plans (a schedule agreed in advance) | ❌ future |
| Payment methods | ✅ cash, bKash, Nagad, Rocket, bank transfer, other — `card` missing |
| Refunds | ⚠️ representable, no UI |

A scholarship is not a discount typed twice. It is a named thing — *sibling
waiver*, *merit 50%*, *hardship* — that a report needs to total separately, because
"why is our collection rate 82%" has a very different answer depending on whether
the missing 18% was waived on purpose or simply never paid.

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

### 9.7 Revenue sources ❌

Student fees are most of it, but not all: admission fees, registration fees, exam
fees, form fees, and other income. Categorised for the same reason expenses are —
an owner who wants to know whether admission season carried the year needs those
separable from monthly tuition.

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

### 9.9 Receipts for everything ⚠️

A printable record for a fee payment ✅, and — ❌ — for a salary payment, an
expense, a refund, and a student-capacity purchase. In Bangladesh a receipt is the
transaction; a payment without paper did not fully happen. Each one carries the
centre's letterhead, a number, the date, the amount in figures, and who received
or paid it.

### 9.10 The dashboards ❌

**Center:** this month's collection, outstanding, expenses, payroll, profit; the
arrears list; places remaining.

**Institution HQ:** the same for the organisation, plus the branch comparison table
of §8.3. HQ never has to open each branch to find out how the group is doing.

---

## 10. The audit log ❌

One append-only log of who did what, covering every action where the answer to
*"who changed this?"* has money or a child's record behind it:

fee amount changes · payments recorded · payment voids and refunds · discounts and
scholarships granted · salary terms changed · salary paid · expenses recorded ·
permission changes · login accounts created or deactivated · branch transfers ·
attendance overrides (§6.3) · student status changes · capacity purchases · plan
changes.

Each entry: actor, action, target, before, after, when. It is written by the same
transaction that made the change, so a change cannot exist without its log line.

The reason this is not optional in a financial product: the first serious support
conversation with a Center will be *"my manager says he never entered that"*, and
without a log the founder's answer is a shrug.

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

### 11.2 Payment intents ✅

Every purchase — a subscription month, a single student place, a bulk-import block,
an extra branch — creates a **payment intent** on the server before the customer is
sent anywhere. The intent owns the amount. The browser never does.

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
| provider, provider transaction id | reconciliation |
| **idempotency key** | a retry, a double tap, or a webhook delivered twice must land once |
| what it grants | the capacity or coverage that attaches **only** on `successful` |

**Idempotency is keyed on the provider transaction id** with a unique index behind
it, and the duplicate path reads back the original result rather than erroring. This
pattern already exists in the codebase — the founder panel's manual payment
recording does exactly this — so it is a reuse, not an invention.

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
| the student capacity | otherwise capacity is free |
| the entitlement | it is derived, never submitted |
| the branch id | otherwise branch isolation is a suggestion |

### 11.5 The founder panel is real, not a facade ✅

It records money that actually arrived, write-once, with an idempotency key, and it
is the only door to plan and status changes — gated behind a platform-admin check
and a database grant, not a hidden route. It must never grow a button that *says* a
payment succeeded without one having. Its plan-change function deliberately does no
limit enforcement and warns instead, because a founder moving a customer down a tier
is a decision, not a validation error.

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
write the billing columns. But **the numeric caps and the feature flags live only in
Layer 2.** No trigger, no CHECK and no policy enforces a batch limit or a feature
flag. A caller who could reach the table directly could exceed every cap.

That is the gap capacity enforcement closes, and it should close it for the caps
too rather than beside them.

### 12.2 What a browser must never be able to do

Raise its own plan · change its own status · grant itself student capacity · mark a
payment successful · alter a subscription · edit or delete a financial record ·
grant itself a permission · read or write another branch · read or write another
organisation. Each of these gets a test that attempts it as an authenticated
non-privileged user and asserts the database refuses.

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

### 12.4 Concurrency is a security property here ❌

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

---

## 15. Where the build actually is

A summary; §16 has the order. Detail lives in the audit delivered alongside this
document.

**Built and enforced ✅** — the four plan definitions and one pricing engine;
numeric caps and feature flags checked server-side on every write path, failing
closed; plan/status/SMS-credit/capacity columns tamper-proof at the database;
attendance including an offline mode; exams and marks; fee invoices, partial
payments, fixed-taka discounts, voiding, arrears, month close; append-only payments
with gapless receipt numbers; printable receipts and the collection register;
tap-to-send messaging; bulk import in one transaction; teacher records that can exist
without accounts, server-generated usernames and signing in with either one;
teacher→batch→student scoping in RLS; tenant-safe composite branch keys; employees,
payroll and expenses; profit; branch money side by side at HQ; student capacity as a
column of its own, with the ceiling resolved server-side, the race closed by an
advisory lock, and the three ways past it (one student, an import, a branch that has
run out) each priced and sold; payment intents behind a provider interface with the
manual bKash transfer as its first provider and the founder confirming the money
arrived; the entitlement resolver, with read-only enforced in front of twenty write
paths, and a subscription that suspends itself seven days after the period it was
paid for; a founder panel that records real money. 903 unit tests and 1,100 RLS
assertions green across 59 migrations and 42 tables, plus four derived gates and two
that ask the live API.

**Partly built ⚠️** — branches (money, staff and the HQ comparison yes, full
isolation no); discounts (fixed only); attendance roles (teacher scoping right,
manager/teacher indistinguishable in RLS, `/teach` shows admins the whole centre);
scheduling (weekly recurrence, no clashes or overrides); refunds (representable, no
UI); the trial (the resolver reads one and expiry is a comparison rather than a job,
but nothing in the product starts one); plan selection (an owner may ask for a tier
and buy places, not move themselves between tiers); the audit log (table, no
writers); dashboards (`/hq` compares the branches; §9.10's own screen is not built).

**Not built ❌** — the Teacher Pro trial; subscriptions as a living thing
(`subscriptions` still has zero reads and zero writes in the app, and
`payments.subscription_id` is always null); a customer moving their own centre
between tiers (`bootstrap_center` hard-codes `teacher_free`, and only a platform
admin or an owner's request changes it); OTP; capability-based permissions and a way
to create a manager; revenue categories; §9.10's dashboards; the audit log's
writers; transfer history; the two new student statuses; percentage discounts;
rooms and teacher-clash detection.

**Blocked 🚧** — automated SMS and therefore OTP delivery (BTRC sender ID needs an
aggregator account which needs an NID); the real bKash integration (credentials
pending); price validation (needs the design-partner conversations).

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

**Core, and nothing beyond it:** the four plans, the trial, entitlement, capacity
with atomic enforcement, single and bulk top-up, branch isolation, the shared pool,
teacher accounts and usernames, phone-or-username sign-in, owner OTP,
teacher-centric attendance, fees with part payments and discounts, refunds,
expenses, employees, payroll, revenue and profit, the two dashboards, the audit log,
payment intents.

**High priority, straight after:** percentage discounts and named scholarships,
instalment plans, teacher clash detection, salary receipts, per-branch capacity
*reporting* (never per-branch quotas).

**Future, documented and not built:** rooms and timetable conflicts, holiday
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
| "Purchased capacity", never "unlimited students" | unlimited is a promise the pricing engine contradicts |
| Capacity pools at the **organisation**, not the branch | a place is a licence, not a chair |
| Batches cap **per branch** | rooms are physical |
| Marginal bands, not flat per-tier rates | flat rates make 301 students cheaper than 300 |
| The floor applies to the **student charge**, not the total | otherwise teacher seats vanish inside it |
| Top-up price = the increase in the monthly bill | it is ৳0 below the floor's covered seats, because those are already paid for |
| Trial expiry is a comparison, not a cron job | a cron that does not run hands out a free tier forever |
| Suspended means **read-only**, not locked out | holding a centre's register hostage is how a customer becomes an enemy |
| Limits apply to new actions, never retroactively | nobody's data disappears on a downgrade |
| Refunds are counter-entries | the receipt in a parent's hand must stay findable |
| Manager attendance override stays, and is logged | an impossible override is worked around by password sharing |
| Teachers never need a phone or an OTP | the part-time teacher who will not be in a database is a customer's constraint, not ours |
| Usernames are memorable and server-generated | they are read aloud across a staffroom |
| Zero SMS credits on every tier | correct behaviour while no gateway exists; a counter decrementing against nothing is a lie |
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

---

## 19. Testing this document

A requirement without a test is a preference. The suites that keep this honest:

**Pricing** — every band boundary (100, 101, 300, 301, 600, 601); the floor at 1, 50,
79, 80; teacher seats at 0, 2, 3; Institution branches at 3 and 4; the top-up delta
at 50, 120, 300, 600; the bulk delta across a band edge; monotonicity — the bill must
never fall as students rise.

**Entitlement** — trial active, trial expired, paid, lapsed, suspended, cancelled,
unknown plan, unreadable membership. Each asserts an entitlement, not a screen.

**Capacity** — refusal at the ceiling; reactivating an inactive student refused when
full; **two concurrent inserts at the last seat, exactly one succeeding**; bulk
import of 500 rolling back to zero students when payment fails.

**Branches** — a branch member cannot read, write, or report on another branch's
students, batches, payments, expenses or payroll. One case per table, attempted as a
hostile authenticated client.

**Auth** — phone login still works; username login works; OTP expiry, attempt
ceiling, resend cooldown, and the same number in three formats resolving to one;
teacher account creation succeeding with **no phone and no OTP**; username collision
producing `rahim01` under concurrency.

**Security** — every row of §12.2, each asserting a database-level refusal.

**Finance** — charged vs collected vs outstanding on part payments; a refund netting
correctly with both rows intact; profit including payroll.

---

## 20. Version history

| Date | Change |
|---|---|
| 2026-08-11 | First masterplan: positioning, the wedge, three tiers, go-to-market. Stack recorded as React + Vite on Cloudflare Pages. |
| 2026-08-23 | `docs/PLANS-AND-MESSAGING.md` written: per-tier feature flags, the 150-student Pro ceiling, marginal bands, the SMS reality. |
| 2026-08-29 | **This revision.** Reconciled with the final product direction: capacity as a purchased quantity separate from plan; the Pro trial as a state; Institution as a genuine multi-branch product with a shared pool; the financial module (employees, payroll, expenses, revenue, profit, dashboards); identity split into record versus account with memorable usernames and phone-or-username sign-in; owner/manager OTP named as a live security gap; the audit log; payment intents with bKash explicitly deferred; the stack corrected to Next.js 16 on Vercel; retired assumptions listed. |










