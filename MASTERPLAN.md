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

**And the number on the screen has to be that pool too, which took a migration to
make possible.** `20260811000053` made every `select` on `students` RESTRICTIVE by
branch, so a count taken through a pinned manager's own client is their building's —
correct for a roster, wrong beside a ceiling that pools. Five screens paired the two
and told a manager of Mirpur with 40 of the organisation's 300 students that 260
places were free. The fence was never fooled (`app.guard_student_capacity()` counts
past RLS under an advisory lock and raises `CD001`), so the cost was a promise the
database then broke — worst on a bulk paste, which §10 refuses whole. `public.center_student_count(uuid)`
(`20260811000076`) is the pooled half: a `security definer` wrapper over
`app.active_students`, which lives in a schema PostgREST does not serve. It asks
`app.is_staff_admin` or `app.can_manage_students` about the centre id it was handed
before it counts, and raises `42501` otherwise — `scripts/check-scoping.mjs` names a
definer function that trusts a centre id as the one hazard its parser cannot see. Every
places figure in the product now reads through it, and `tests/pinned-manager.test.ts`
sweeps `src/app` so a new screen cannot pair the pooled ceiling with a count of its own
rows. Where a branch figure and the pooled one share a screen — the dashboard's student
tile, the roster's heading — the pooled one says which it is (§9.1).

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
| ≤ 5% | urgent — persistent banner, HQ told which branches are growing ✅ |
| 0 | new student creation blocked; **[ Add capacity ]** is the only way forward |

Thresholds are constants, not literals sprinkled through screens, so they can be
tuned without hunting.

**Which branches are growing** is `branch_admissions_month` (20260811000072), drawn on
`/hq` under the boxed warning and only there — the ≤ 20% row asks for a notice, and a box
naming buildings under a notice would make the two levels read the same.

It counts **still-active students grouped by the month they were admitted**, not admissions
taken. A branch that admitted fifty in August and lost forty of them has not grown, and the
view that counted admissions would put it top of the list. Counting the active ones buys the
invariant that matters on this screen: every row added together is exactly the organisation's
active head count, which is the pool figure printed beside it, so the two can never disagree.
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
       status = suspended | cancelled  →  read-only
       otherwise                       →  full

  2. plan:
       trial_ends_at > now
         and trial_plan outranks plan   →  trial_plan
       otherwise                        →  plan

  3. student ceiling:
       plan cap is a number             →  { plan, max }
       plan is capacity-based           →  { capacity, org.student_capacity }
```

The rank test in step 2 is why a trial can only ever raise what is allowed, which is
what lets the ceiling be resolved from the plan in force without a stale `trial_plan`
taking places away. `app.admitted_ceiling` applies the same test in SQL (§4.5).

Everything downstream — every feature gate, every cap check, every permission
helper — reads the *result*. None of them learns whether it was a trial, whether
a payment lapsed, or which branch asked. That is what stops trial logic from
metastasising into forty call sites.

**Fail closed, in the established direction.** An unreadable organisation row
resolves to Teacher Free, the most restrictive tier — never to the loosest. An
unreadable *count* refuses the action rather than treating the count as zero,
because one failed count would not let one extra student past a cap, it would let
eighty.

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
plan the reader is on, the plan the feature needs, and links to `/settings/plan`,
where the ladder and this centre's own usage are. The two moments the tier actually
moves say so without being asked — the read-only banner when coverage lapses (§4.4)
and the trial banner for the fortnight and the week after it (§4.3).

**A trial grants the trial tier's places, and the database agrees.** This was the one
place the two halves of the product contradicted each other. `app.student_ceiling`
resolves from the paid `plan` column, so a signup on their free fortnight of Pro was
shown 150 places by the app and refused at 31 by the trigger — with a hint telling
them to buy the places they had just been given. 20260811000060 splits the question
in two: `app.student_ceiling` still says what was bought, which is what prices a
purchase, and `app.admitted_ceiling` says what may be admitted right now, which is
what the trigger reads. The rank test is native enum comparison (`trial_plan > plan`,
the same guard `effectiveEntitlement` applies), so a stale trial cannot lower a
ceiling and a centre still carrying its signup trial is never admitted Teacher Pro's
150 students on a plan that includes 79.


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

### 5.4 Owner and manager signup needs OTP ✅ (built) 🚧 (off until a gateway exists)

**It was a real security hole and it is worth remembering why.** An owner signed up by
typing a phone number and a password, and nothing checked that the number was theirs.
Anyone could register using another person's phone number — and since `profiles.phone`
is unique across the platform, doing so also **denied that number to its actual owner
forever**. Not only impersonation: a squatting attack on the identifier we use to
recognise returning customers.

So: a one-time code, sent to the number, before the account exists. That is built.

| Control | Built as |
|---|---|
| Code length | 6 digits, `OTP_LENGTH` |
| Expiry | 5 minutes, `OTP_TTL_SECONDS` |
| Verification | **server-side only.** The stored hash is `sha256(phone:purpose:code)`, so a row cannot be replayed against another number, and the browser never learns the code it is checked against |
| Max attempts | 5 per code, counted in SQL under a row lock so parallel guesses queue, and the code is burned when they run out |
| Resend cooldown | 60 seconds, checked before anything is inserted or sent |
| Per-number ceiling | 5 per number per hour, 20 per IP per hour; a missing proxy header is skipped rather than filed under one bucket every such visitor would share |
| Storage | `app.phone_verifications` — hash, expiry, attempt count, and a sweep of everything older than an hour on each insert. No cron, no table that grows for ever |
| Normalisation | canonicalised in the gate before anything is sent or stored, so `01712…`, `+88017…` and `০১৭১২…` are one number and one ceiling, not three |

**Teachers are exempt, deliberately and permanently.** Their phone is optional, so
there may be no number to send to; and the account is being issued by their
employer inside a centre that already exists. Re-introducing teacher OTP would
make the register unusable for the exact centres we are selling to — the ones
whose part-time physics teacher does not want to be in a database. This is
written here as a rule and not a preference: **teacher account creation must never
require OTP.**

Where it lives: the numbers and the answer parsers in `src/lib/auth/otp.ts`, the gate
and both transports in `src/lib/auth/otp-gate.ts`, the table and the two functions in
migration `20260811000065_phone_verification.sql`, the two-step screen in
`src/app/(auth)/actions.ts` and `src/app/(auth)/signup-form.tsx`.

**The step is not the security boundary; the code is.** The screen has two steps when
the gate is on, but the code is checked and the account created inside one Server
Action call — so there is no verified flag for a browser to carry between requests, and
`awaitingCode` in the returned state only decides which inputs are drawn. A browser
that skips the step is asked for a code it does not have.

**On exactly when there is a way to send a code.** `phoneGateOn()` reads the same three
server-only variables the SMS worker reads before claiming a batch, so the aggregator's
credentials are the deploy that shuts this hole — for everybody at once, with no code
change. Until then signup is what it always was and the hole above is still open, which
is why this section says so rather than claiming otherwise. And nothing turns the gate
off once those variables are set: every path to a false answer is the absence of a
transport, never a variable saying to skip the check.

`OTP_DEV_TRANSPORT=1` is the other way on, and it is ignored when `NODE_ENV` is
production — which is every Vercel build, previews included. Without it the flow could
not be run at all before a sender ID exists, because the condition that turns the gate
on is the same condition that turns the logging transport off. With it the code goes to
the server log and nowhere else: never a return value, never a header, never a field on
a form state. A code the browser can read is not a code.

**Delivery is the part that is still blocked.** It needs an SMS route, which needs a
BTRC-approved sender ID, which needs an aggregator account, which needs an NID. The
interface was the deliverable; the SMS provider behind it is one file, already written.

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

**Only `active` students are chargeable.** This is the sentence that makes capacity
survivable: a centre that has taught for three years and accumulated eight hundred
former students is not billed for eight hundred. It is billed for the two hundred
sitting in rooms this month. A student who leaves frees their seat; a student who
returns takes one again, and if none is free the reactivation is refused with the
top-up price beside it — the same dialog as adding a new student, because it is the
same transaction.

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
shared capacity pool with what is left of it. A branch comparison table where the
branches are rows, so the owner can see which one is carrying the others.

Built as `/hq`, off `branch_profit_month` and `branch_charges_month`, with the pool
under the table rather than as a column in it — §17 forbids a per-branch quota and a
column would invite one. Head office is a row like any branch, because a student filed
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
arrears list; places remaining.

**Institution HQ:** the same for the organisation, plus the branch comparison table
of §8.3. HQ never has to open each branch to find out how the group is doing.

Both are built, and the centre's is `/dashboard` itself rather than a finance screen of
its own — a second page would print "collected this month" twice in two places, which is
the discrepancy §9.1 exists to prevent. Outstanding is the largest figure on it because
it is the number the product is sold on, with the reminder door directly underneath: the
one thing on an owner's home screen that brings money in rather than reporting on it.
Collection, spending, payroll and profit come off `center_profit_month` in a single row
already subtracted by Postgres, never re-added in JavaScript. Places remaining sits on
every plan, including free, where the ceiling is nearest.

The organisation's copy is the total row of `/hq`'s table, and the pool beneath it. Two
figures there deliberately do not match their centre-dashboard counterparts and the
screen says so in a legend: cash in is keyed to when the money arrived while the two bill
columns are keyed to the month billed for, and the head count in the total row is the
organisation's own rather than the sum of the column, because a student filed at head
office is in one and not the other.

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
| the tier it moves onto, on a subscription only | so a renewal and a tier move are one purchase, settled one way |

**Idempotency is keyed on the provider transaction id** with a unique index behind
it, and the duplicate path reads back the original result rather than erroring. This
pattern already exists in the codebase — the founder panel's manual payment
recording does exactly this — so it is a reuse, not an invention.

**A subscription may carry a tier** (`target_plan`), and then the settlement moves the
plan before it raises the ceiling, because the ceiling is read off the plan. Null on
every renewal, never the free tier, and never on a purchase of places, seats or a
branch — a tier arriving on one of those would move the plan without anybody having
paid a month for it. The tier the bill was computed from and the tier being bought must
be the same tier, checked once as a column constraint and once where the quote is
priced: quoting the tier a centre is on while asking for a better one is Centre money
for Institution product. The read-back that answers a reused idempotency key compares
the tier too, because at 400 students on one branch Centre and Institution bill the
identical ৳7,300 a month, so purpose, quantity and amount cannot tell those two
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
| the student capacity | otherwise capacity is free |
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
founder moving a customer down a tier is a decision, not a validation error — and a
customer moving *themselves* down is not offered at all, for a reason that has narrowed
since `20260811000074`: the credit a mid-term downgrade owes now has a row to live on, so
what is missing is not the row but the arithmetic — nothing works out what a centre's
unused coverage is worth, and a number nobody can check is not a refund an owner should be
able to ask for themselves (§9.2).

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
that makes it (§6.3); and a phone gate in front of owner signup — a six-digit code with
a five-minute life, five tries counted under a row lock, a minute between sends and an
hourly ceiling per number and per IP, checked and spent inside the same call that
creates the account — which switches itself on the day the aggregator's three variables
exist, and is off until then (§5.4). And one teacher can no longer be in two rooms at
four o'clock: the rule is enforced on the day rows, which are the last thing a save
writes and so the only moment a batch's routine is whole, and stated a second time in
the form so the refusal can name the batch, the day and the hour instead of raising
(§7.3). And an owner five per cent from full is told which of their buildings the places
went to, counted as students still on the register so the breakdown adds up to the pool
figure beside it, and never as a quota (§3.7). And a student moving between branches is
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
1,418 RLS assertions and 1,195 unit tests green across 75 migrations and 42 tables in
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

**Partly built ⚠️** — branches (isolation, money, staff, the HQ comparison and the growth
breakdown yes; the drill-down into one branch's workspace no, because `app.branch_ok`
reads the membership's own branch and not a chosen one — §8.3); scheduling (weekly
recurrence and teacher clashes,
no rooms or overrides); plan selection (an owner may buy a move up and buy places; a move
*down* is still a conversation — the credit it owes has a row and the founder can write it,
but nothing on the owner's own screen works out what their unused coverage is worth);
income with no student behind it (hall rent, book sales and the like have a category
but no row to hang it on — every revenue row is a bill against a child).

**Not built ❌** — the five
`teacher_permissions` booleans folded into the capability vocabulary — they work, and
four `app.can_*` resolvers enforce them in the database, but they are still five
columns rather than words in a `text[]`, and §6.2 says why that waits;
an award that applies itself to a
student's every future bill; rooms, per-date overrides and a holiday
calendar. The `subscriptions` table is still unread and unwritten and
`payments.subscription_id` still always null — deliberately, and §17 says why: what a
member's session needs to know is the one date on the centre, and that date is derived
from the payments themselves.

**Blocked 🚧** — automated SMS, and with it the enforcement of a signup phone gate that
is otherwise built and tested (BTRC sender ID needs an aggregator account which needs an
NID); the real bKash integration (credentials pending); price validation (needs the
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

**Core, and nothing beyond it:** the four plans, the trial, entitlement, capacity
with atomic enforcement, single and bulk top-up, branch isolation, the shared pool,
teacher accounts and usernames, phone-or-username sign-in, owner OTP,
teacher-centric attendance, fees with part payments, discounts and instalment plans,
refunds, expenses, employees, payroll, revenue and profit, the two dashboards, the
audit log, payment intents, teacher clash detection, per-branch capacity *reporting*
(never per-branch quotas).

**High priority, straight after:** ~~an owner moving their own centre between tiers
without a founder doing it for them~~ — **done**, and it did not wait on bKash, because
the manual provider already settles a payment (§11.2). What it exposed instead is where
the next window opens: one formula shared by the screen and the action, so a lapsed
centre is billed from this month rather than from the month its coverage stopped. ~~And
after that, the credit a mid-term move or a downgrade owes, which §9.2's positive-only
`payments.amount_bdt` had nowhere to put~~ — **done** as well: a platform payment may now
be negative, the founder writes one against a floor the database holds under a lock, and
it prints as a credit note rather than as a receipt for minus money. What remains of that
thread is the owner's half — a move *down* still needs somebody to work out what the
unused coverage is worth, so the credit is a conversation with a row at the end of it
rather than a refund an owner can ask for themselves.

**Ahead of both of those now: the interface (§20).** It is the widest gap between what
this product does and what it appears to be, its own order of work is §20.8, and it is a
refactor of screens over rules that already hold rather than a single new rule — which is
why it can be the priority without anything in §15 stopping working.

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
| Teacher clashes are refused on the **day rows**, not on `batches` | the routine is written across two tables in three transactions, and the day rows are the last of them — checking anywhere earlier refuses saves that are legal two statements later |
| Back-to-back classes are not a clash | overlap is half-open; a rule that refused them would be worked around within a week |
| The growth breakdown counts **active students**, not admissions taken | a branch that admitted fifty and lost forty has not grown, and the active count makes the breakdown add up to the pool figure printed beside it |
| Views carry Supabase's default `anon` grant, and are protected by `security_invoker` | the privilege is not the fence — the caller's own policies are; and `check-embeds.mjs` can only verify a select shape it is allowed to ask for |
| `subscriptions` stays empty; coverage is derived from the payments | what every member's session has to know is one date — is this centre paid up — and `coaching_centers.paid_through` is that date, maintained by trigger as `max(payments.covers_period_end)`. A subscription row would be a second answer to the same question, and the two would disagree the first time a payment was recorded out of order. The table's own columns date it: `billed_enrollments`, `unit_price_bdt`, `floor_price_bdt` and `renews_at` encode per-enrollment pricing that renews itself, which §3 replaced with marginal bands and a window bought outright. It is kept, unread, because dropping a table is a migration that cannot be undone and the columns are the record of what was tried |
| A tier move is a purchase, not a setting | it moves the plan through `settle_payment_intent` like every other paid thing, so the billing guard stays the only fence and no browser is ever nearer the `plan` column than a form that asks |
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
never fall as students rise. And what a purchase may claim: a subscription priced at one
tier and asked for another is not quoted, the free tier is never a target, no other kind
of purchase carries a tier at all, and the two tiers that bill the same number at 400
students are told apart before an idempotency key hands one back for the other.

**Entitlement** — trial active, trial expired, paid, lapsed, suspended, cancelled,
unknown plan, unreadable membership. Each asserts an entitlement, not a screen.

**Capacity** — refusal at the ceiling; reactivating an inactive student refused when
full; **two concurrent inserts at the last seat, exactly one succeeding**; bulk
import of 500 rolling back to zero students when payment fails; a trialling teacher's
thirty-first student admitted, the same insert refused the day the trial ends, and the
thirty-one already on the roster untouched by either.

**Branches** — a branch member cannot read, write, or report on another branch's
students, batches, payments, expenses or payroll. One case per table, attempted as a
hostile authenticated client. And the growth breakdown: a row per branch with head
office among them, a student who has left removed from the month they were admitted in,
a pinned manager reading their own branch and no other, and every row added together
equalling the organisation's active head count — the pool figure printed beside it.

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

### 20.4 Plan and billing: six questions, in this order ✅

Currently the worst screen in the product. It is a form; it should be an answer. It has to
say, without being scrolled or clicked:

1. **What am I on** — Teacher Pro, ৳499/month, renews 14 October 2026.
2. **What am I using** — Students 87/150, Batches 3/5, Subjects 4/5, as figures against
   their ceilings rather than as prose.
3. **What do I have** — the features, not the flags.
4. **What changes if I move up** — the difference, not two feature lists to diff by eye.
5. **What will that cost** — one number.
6. **What should I do next** — one primary action, and the rest visibly secondary.

**Do not expose the billing engine.** §3.1's marginal bands are how we compute; they are
not how a customer thinks. "First band 100 at ৳25, next band 200 at ৳18, rate each,
teacher seat calculation" is our arithmetic showing through the glass. What the screen
says is:

> 120 students → estimated **৳3,060/month**. Includes 2 teacher accounts.
> Additional teacher ৳100/month. `[View pricing details]`

The bands live behind that disclosure, in full, for the owner who wants to check the
figure — and the disclosure is the same engine, never a second copy of the numbers. One
pricing module answers the public calculator, the owner's screen and the founder's
billing, because three places that each know the bands will disagree inside a month.

**Center billing reads Students → Cost → Usage → Add capacity → Payment**, with
`[Add students]` and `[Add teacher]` as the primary actions. Not a plan grid: a centre
already paying us has chosen its plan and is now managing its size.

**What shipped.** Question 1 is a three-fact strip under the heading — the tier, the price,
and the date the money runs to — because the paid-through date used to be printed only
inside the subscription card, which a manager cannot see and an owner with nothing left to
buy never renders. Question 2's rows now say when a figure has met its ceiling and when it
has passed one, in the reader's own numerals; "30 / 30" is the reason the screen gets opened
and it looked like every other line on it. Question 4 is computed rather than compared: the
features the next tier adds, filtered from the same list and the same labels as the card in
the rail, and the ceilings it raises — so a feature cannot be present in one list and absent
from the other. Question 5 is that block's own heading, one figure from the same
`priceLine()` the tier list uses. Question 6 is one anchor, to the purchase control below or
to the contact card, never a second priced dropdown beside the first. The four-tier grid
§20.4 rejects still exists, folded into a disclosure that is open only on the free plan,
where comparing tiers is the errand.

Two rules are enforced by the screen rather than merely respected by it. §33: the rate bands
and the working moved behind the calculator's disclosure, which is where the tallest block on
the page had been sitting, in full, from the one engine. §2.7 and §8: the difference block
drops any ceiling that is finite on a per-student tier, so "5 → 100 batches" and
"5 → 200 subjects" never print — a centre told it is being given ninety-nine more batches has
been sold a number we would refuse it at. `tests/plan-page.test.ts` asserts the second rule
against `PLANS` itself rather than against the rendered string, so a tier that gains a finite
cap fails there instead of quietly advertising it.

### 20.5 Buying happens where the need is met

§3.4 and §3.5 already specify this and it is already built: the ceiling is met inside
`[+ Add Student]` and inside the import, priced there, paid there, and the interrupted work
continues by itself afterwards. What §20 adds is the interface obligation that makes it
true rather than merely intended:

- **The work in hand is not lost.** Whatever the manager had already typed survives the
  payment step and is still on the screen when it returns. A flow that clears the form has
  moved the friction rather than removed it. This is not free: React 19 resets every
  `<form action>` on submit, before the action runs and whatever it returns, so a refusal
  used to wipe the name, the guardian, the batch ticks and the four optional fields. The
  form holds its own values now, and remounts the ticks and the branch select on a refusal
  because those two are restored from mount-time defaults rather than from React state.
- **The refusal names the price, not the constraint.** "You have used all 120 places. One
  more costs ৳18." Never "capacity exceeded", which is our word for our problem.
- **The dialog is a step, not a destination.** No navigation away, no new tab, nothing that
  loses the thread. Settings → Plans → calculate → purchase → back → find the button again
  is the specific experience this exists to prevent.
- **Zero is not reachable, so it is not said.** This bullet used to ask for the ৳0 place
  below the floor's covered seats (§3.4) to open the form rather than a dialog asking for
  nothing. It cannot happen: `studentCeiling` floors a centre's ceiling at the seats its
  monthly floor already covers, so a centre is never refused while its next place is free —
  there is no refusal below the floor to interrupt. Every band rate is ≥ ৳8, so the
  marginal price at a real wall is never zero either. Kept as a record that the case was
  checked rather than forgotten; a plan whose floor covers no students would bring it back.
- **The import is all or nothing.** 500 rows short on capacity buy the shortfall in one
  purchase, then the whole file lands. Partially created students are the failure mode this
  is designed against, and the database enforces it in a single transaction.

### 20.6 Organisation level and branch level are visibly different places

An Institution's first screen is the organisation, not a centre that happens to have
branches. A table with a row per branch — Students, Teachers, Revenue, Expenses, Profit —
with the organisation's own total as the last row rather than a separate card, and a click
into any branch drilling down to that branch's own workspace (§8.3).

The reader must never be in doubt which level they are reading. Same figures at two levels
is how somebody reports a branch's profit as the organisation's. The level is stated in the
page's header bar, and the branch context persists visibly while they are inside it.

Nothing here asks the owner to recalculate anything. A branch gaining a student changes the
organisation's figures because the pool is one pool (§3.6) and the reporting is derived, not
maintained by hand.

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
everything quieter is beside it.

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
  pool (the places left, which branches are growing, which ones are asking for more). Two
  columns from `lg`, and no `order-N` anywhere, because source order already is reading order.
- **A count that fails is not a count of nobody, per branch and per column separately.** Both
  head queries run per building in the round that was already running for students, and each
  cell reads its own figure: a branch whose student count arrived and whose teacher count did
  not shows the students and a dash, never the number beside it. The foot's two figures are
  the organisation's own unfiltered reads, because §17's pool is one allowance for the whole
  organisation and the seats are counted the same way.
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
