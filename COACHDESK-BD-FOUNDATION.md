# CoachDesk BD — Business & Technical Foundation

A complete, customizable **Coaching Center Management System (CCMS)** for Bangladesh.
Product vision and detailed design brief. Version 2.0 — 2026-08-11.

---

## 1. Product & Market

### 1.1 The strongest product vision

**Vision statement:** Replace the Excel sheet, paper register, and the extra computer
operator with one phone that runs the entire coaching center — attendance, exams, fees,
parent SMS, and reporting — in Bangla, offline-tolerant, on the cheapest Android phone.

**The positioning line:**
> "Excel māne ekjon extra oparēṭar. Āmra māne ekṭā phone." — "Excel means one extra
> operator. We mean one phone."

This is the one-sentence pitch. It converts, in Bangla, the entire value proposition: the
current workflow costs an operator's salary; we cost less than that operator.

### 1.2 The real pain points of Bangladeshi coaching centers

1. **Duplicate data entry.** Every student is re-typed into Excel, attendance registers, and
   mark sheets. Entry errors propagate everywhere, and nobody trusts the numbers.
2. **No single source of truth.** Fees in one register, marks in another, attendance on
   paper. A teacher who needs yesterday's attendance must physically find a notebook.
3. **Excel does not notify.** A mark is entered and nothing happens. Parents learn results
   weeks late, by phone. Fee chasing is manual and embarrassment-driven.
4. **The paid operator.** Centres pay a monthly salary (or overtime) to one person whose
   job is keeping the books and typing mark sheets. That salary alone justifies our price.
5. **No center-level intelligence.** The owner cannot see collection rate, retention, or
   teacher load — across batches, months, or branches — because the data is in ten files.

### 1.3 Features that beat Excel

- **Faster than paper on day one.** Tap-to-mark attendance on a phone with a 30-student
  batch in under 30 seconds; Excel cannot do that on a phone at all.
- **Customization without a computer operator.** Owner adds subjects, batches, schedules,
  exam types, and teacher permissions from a phone, no spreadsheet formula in sight.
- **Auto-parent-SMS on results.** The moment a teacher submits marks, parents receive the
  result. Excel does not send anything.
- **Live fee board.** Outstanding totals update as payments arrive; no monthly reconciliation.
- **Offline-tolerant.** A mid-range Android on 3G keeps working between the network; Excel
  dies on a laptop that is not there.
- **Built-in reports.** Collection, retention, teacher load, and student progress in one
  screen — Excel's "reports" are someone manually rebuilding a pivot table.

---

## 2. Pricing Brainstorm

### 2.1 Why per-student pricing fails

Your own example proves it: one centre has 10 subjects; students take 2, 5, or all 10. A
student enrolled in 10 subjects drives roughly 5× the attendance records, exam entries,
SMS sends, and teacher workload of a student in 2. Flat per-student pricing charges both the
same, so heavy students are undercharged and light students overcharged — and the centre
rightly resents paying for SMS they never used.

### 2.2 Which unit to charge by

| Unit | Pros | Cons | Verdict |
|---|---|---|---|
| Student | Simple, familiar | Ignores subject count, SMS volume, workload | ❌ Fails at multi-subject reality |
| Subject enrollment | Tracks actual workload, scales naturally | Slightly harder to explain | ✅ Core unit |
| Teacher seat | Very easy to count | Punishes single-teacher tutors; a teacher with 5 students pays like one with 50 | ⚠️ Add-on, not core |
| Batch | Matches how centres think | A 40-student batch costs the same as a 10-student one | ⚠️ Not granular enough alone |
| Active enrollment | Same as subject-enrollment in practice | Just a different name | Same thing |
| Hybrid | Can mirror cost structure | Needs clear rules | ✅ Recommended |

### 2.3 Plans

**Teacher Mode (individual tutor).** One teacher running their own students. **Free forever,
capped at one batch (up to ~30 students), with all features — attendance, exams, marks,
reports, parent SMS — and a small monthly allowance of free SMS credits.**

The cap is deliberately **one rule, not four**: "free for one batch." A teacher can repeat
that sentence to another teacher. "Free for 10 students, 1 batch, 1 subject, attendance
only" is four rules and sounds stingy.

Why all features and not a feature-starved tier:

- **An attendance-only free tier competes with a ৳20 notebook, and the notebook wins.**
  Attendance alone is a marginal improvement over paper. Marks + auto-parent-SMS has no
  paper equivalent — that is the switch trigger.
- **The free teacher tier's real job is to be a Trojan horse into centers.** Teachers work
  at multiple centers and talk to owners. A teacher who says "I take attendance on my
  phone" produces a weak referral. A teacher whose students' parents get instant SMS
  results makes the owner ask "can we do this for the whole center?" That question is the
  entire distribution strategy.
- **Upgrade should trigger on the customer's growth, not on an arbitrary wall.** A tutor
  who needs a second batch is earning more and can pay. A tutor blocked at student #11 just
  leaves.
- **Limit what costs money, be generous with what is free.** Database rows are effectively
  free; SMS is ৳0.30–0.60 per segment. So cap the SMS allowance, not the student count.

**Center Mode (coaching center).** Everything in Teacher Mode plus multi-teacher, subjects,
batches, schedules, permissions, parent SMS at volume, fee board, reports.
**Price: per subject enrollment per month**, with a floor (minimum) per center, and SMS
billed as **actual usage**, not included.

**SMS credits.** Sold separately, prepaid, in BDT blocks. Every SMS sent is deducted from
the center's credit balance. The center owns the cost of its own communication.

### 2.4 Tier structure that works for all three segments

| Segment | Size | Plan | What works |
|---|---|---|---|
| Small tutor | 1 teacher, 1 batch | Teacher Mode — **free forever**, all features, capped SMS allowance | Zero-friction entry, self-serve, becomes our referral channel |
| Growing tutor | 1 teacher, 2+ batches | Teacher Plus — small fixed monthly fee, SMS credits on top | Upgrade triggers on their growth, not an arbitrary wall |
| Medium center | 2–8 teachers, 50–300 students | Center Mode — per subject-enrollment + SMS credits | Scales with real workload |
| Large institution | 9+ teachers, 300–500+ students | Center Mode — same unit + volume discounts + invoicing | They can pay annually; give a discount |

**Set the numbers only after watching one real fee cycle** — value observed, not guessed.

### 2.5 SMS cost handling

- **Never bundle SMS into the subscription.** It is a variable, regulator-touched cost
  (৳0.30–0.60/segment, 70-char Bangla segments, sender-ID registration required since
  Sep 2025). Bundling it turns the product into an SMS middleman.
- Prepaid credit blocks, deducted per actual send; low-credit warning at the threshold;
  the center buys more in BDT.
- **Free Teacher Mode gets a small monthly SMS allowance** (enough for roughly one exam
  cycle for one batch), so the teacher experiences the feature that sells the center. This is
  the only free-tier cost that is genuinely variable — cap it, and top-ups are purchasable.
- **Keep the result message inside one 70-char Bangla segment where possible.** Brand name is
  mandatory and eats the budget. A template that fits one segment instead of two halves the
  cost of the entire product's headline feature — worth real effort at template design time.

---

## 3. Database & Architecture (Supabase PostgreSQL)

### 3.1 Schema design

Multi-tenancy core: every table gets `coaching_center_id`, and every access goes through
row-level security scoped to the authenticated user's center. A student belongs to exactly
one center; enrollment is the join to subjects.

```
coaching_centers      id, name, phone, address, bd_area, status, plan_id
branches              id, center_id, name, address
teachers              id, center_id, name, phone, role_flags, active
subjects              id, center_id, name, subject_type (academic/coaching)
batches               id, center_id, name, subject_id, batch_type, start_time, end_time
batch_schedules       id, batch_id, day_of_week, start_time, end_time
students              id, center_id, name, guardian_name, guardian_phone, bd_area, status
guardians             id, student_id, name, phone, relationship
enrollments           id, student_id, subject_id, batch_id, status, enrolled_at
attendance_sessions   id, center_id, batch_id, teacher_id, session_date
attendance_records    id, session_id, enrollment_id, status, marked_at, marked_by
exams                 id, center_id, subject_id, batch_id, teacher_id, title, exam_type,
                      total_marks, exam_date
exam_results          id, exam_id, enrollment_id, obtained_marks, notes
sms_logs              id, center_id, to_phone, template_id, message, status, cost_credits,
                      sent_at
subscriptions         id, center_id, plan, status, started_at, renews_at
payments              id, center_id, amount_bdt, method, reference, paid_at
teacher_permissions   id, center_id, teacher_id, can_manage_students, can_manage_exams,
                      can_send_sms, can_view_fees
```

### 3.2 Why this schema

- **Enrollment = the join.** A student in 5 subjects appears 5 times in `enrollments`, one
  per subject/batch. That single table is what makes per-subject-enrollment pricing and
  per-subject workload tracking work.
- **Attendance in two parts.** `attendance_sessions` (one row per class) + `attendance_records`
  (one row per student per class) keeps the "who was in which batch today" query cheap and
  lets a late teacher backfill a whole session.
- **SMS metered per send.** `sms_logs` records status, cost, and credits per message — this
  is what makes charging SMS separately possible at all.
- **Fees as event log.** `payments` is an append-only log, not a running balance — so the
  outstanding total is always derivable and never corrupted by a bad write.

---

## 4. User Roles & Permissions

| Role | Can do |
|---|---|
| **Super Admin** (you) | Access all centers, manage plans/subscriptions, see platform totals |
| **Coaching Owner** | Full control of their center: all batches, teachers, subjects, students, fees, SMS, reports, plan/billing |
| **Branch Manager** | Everything within their assigned branch; cannot touch other branches or billing |
| **Teacher** | Their assigned batches only: take attendance, create/manage exams for those batches, enter marks, view their own students |
| **Student** | View own attendance, marks, fee status, notices |
| **Parent/Guardian** | View own child's attendance, marks, fee status; receive SMS |

**Enforcement:** roles as PostgreSQL RLS policies (`owner`, `manager`, `teacher`, `student`,
`guardian`) — not just UI hiding. This is the "one bug that ends the business" area; a
teacher must never be able to read another teacher's student data.

---

## 5. Main Workflows

1. **Creating a coaching center.** Owner signs up (phone number → OTP) → creates the
   center → is auto-created as the Owner role.
2. **Adding teachers and subjects.** Owner adds a teacher (name, phone, role) → adds subjects
   (name, type) → assigns subjects to teachers.
3. **Creating batches and schedules.** Owner creates a batch (name, subject, teacher,
   start/end time) → adds schedule days (e.g. Sat–Thu 16:00–17:30).
4. **Taking attendance from a phone.** Teacher opens Today → selects their batch → taps
   Present/Absent per student (bulk: mark-all-present then tap exceptions) → Save. Whole
   batch under 30 seconds; works offline, syncs later.
5. **Creating an exam and entering marks.** Teacher taps Create Exam → title, type, total
   marks, subject, batch → the section's students auto-appear from the database → enters
   marks per student + optional notes → Save.
6. **Sending SMS results — the two-button gate.** Marks are saved *first*; SMS is a separate,
   deliberate second action. After saving, the teacher lands on a confirmation screen showing
   **how many parents will be messaged, how many SMS credits it will cost, and the exact
   message preview** for one student. Two buttons, equal weight, neither pre-selected:

   - **অভিভাবককে পাঠান / Send to Parents**
   - **এখন পাঠাবেন না / Don't Send**

   Rules that make this safe and cheap:
   - **Neither button is the default.** The teacher cannot leave the screen without choosing;
     no accidental blast from a stray tap, no silent non-delivery.
   - **Marks are already saved** before this screen. A wrong choice never loses data.
   - **Per-student opt-out is respected here** — students whose guardian has opted out are
     shown as excluded from the count, not silently dropped.
   - **Send is idempotent.** One exam sends once; re-entering the screen shows "already sent"
     rather than offering a second charge. This prevents double-billing the center.
   - **"Don't Send" is not permanent.** The owner or teacher can send later from the exam
     record — useful when credits are exhausted or marks need correcting first.
   - **Cost is visible before the tap** ("৳~48 · 96 SMS"), so nobody is surprised by the bill.
   - Every send is written to `sms_logs` with who triggered it, so the center can audit.

7. **Viewing student progress reports.** Owner opens a student → sees attendance rate,
   marks across exams, fee status, and flags (e.g. attendance dropping) in one screen.

---

## 6. Mobile-First UI

- **Bottom navigation:** Home (today's batches), Attendance, Exams, Students, More
  (settings, reports, fees).
- **Home screen = the teacher's day:** Today's batches, one tap to start attendance.
- **Students first, action second:** on the attendance screen, the list of names is the
  primary element; actions are big tap targets.
- **Bangla + English toggle, large text, high contrast**, built for a mid-range Android on
  a bright screen outdoors.
- **PWA installable**, so teachers add it to their home screen like an app; no Play Store
  gate, instant updates.
- **Offline tolerance:** attendance and marks entries queue locally and sync when the
  network returns; the phone is the only device most centres can afford.

---

## 7. Technical Stack (free-tier first)

| Layer | Choice | Notes |
|---|---|---|
| Framework | Next.js + Tailwind CSS | Your choice; works with all below |
| Hosting | **Vercel Hobby (free)** — development & testing, while nothing is sold | **Commercial use requires Pro.** The moment the first centre pays, upgrade to Pro (~$20/mo, covered by that first payment) |
| Database/Auth | Supabase (free tier) | Postgres, Auth, RLS, Realtime |
| Cron/notifications | Cloudflare Workers + Cron Triggers (free) | Reminders, reports |
| SMS | Bulk SMS gateway via BTRC-approved aggregator (~৳0.30–0.60/segment, Bangla 70-char segments) | Prepaid credits, metered per send, resold to centers |
| AI (optional) | Gemini free tier, batched | Attendance/marks anomaly insights, parent summary phrasing; never per-pageview |
| Payments in (BDT) | bKash Personal Retail Account now; SSLCommerz/aggregator later | Individual OK; invoice once larger |
| Repo | GitHub private | Free |

### Free-tier limits to respect

- **Supabase:** 500MB DB, 1GB storage, 2 active projects per free org, **auto-pause after
  7 days of inactivity**. Daily attendance use prevents the pause. Upgrade to Pro ($25/mo)
  at ~2 paying centers; those two cover it.
- **Vercel Hobby:** 100GB data transfer, 1M edge requests/mo, build-minutes limits. Fine
  for testing; upgrade to Pro when first paying center lands.
- **SMS sender-ID registration** required since Sep 2025; register the sender ID before
  going live. Content must be 70% Bangla and include the brand name.
- **Free LLM quotas** (Gemini ~5–15 req/min) mean AI runs in batches, not per pageview.

---

## 8. Roadmap

- **Week 1–2:** First MVP — schema, auth, one Teacher Mode: students + attendance on a
  phone; deploy on Vercel Hobby.
- **Week 3–4:** Teacher Mode usable — exams, marks, reports, parent phone storage; manual
  data entry for early testers.
- **Month 2:** Multi-teacher support — batches, subjects, teacher permissions; SMS results
  via bulk gateway (sender ID registered).
- **Month 3:** Coaching Center Mode — owner controls, fee board, billing, center-level
  reports, plan/subscription management.
- **Later:** Payments (bKash/SSLCommerz), analytics, parent app, AI-based performance
  insights (batched).

---

## 9. Go-To-Market (zero investment)

1. **First teacher users:** the free Teacher Mode tier. Teachers who are already our
   friends, classmates, or neighbours' tutors adopt it free; their usage is our testing and
   their word-of-mouth is our launch.
2. **Converting them:** when a teacher's own students pass a threshold, the cap nudges them
   to pay a small fixed fee. The product grew their own client list; paying feels natural.
3. **Approaching local coaching centers:** the main hook is **auto-parent-SMS on exam
   results** — it is the single feature that sells the center. Walk in, show the owner their
   own student list already loaded, run a real fee cycle for 30 days free, then charge.
4. **Main marketing hook:** **"Marks submitted → parents SMS'd automatically."** It is
   concrete, visible, and impossible in Excel; it is the demo that closes.

---

## 10. Final Recommendations

1. **Recommended pricing architecture:** per **subject-enrollment** per month (core unit),
   with a per-center floor, separate **Teacher Mode** free tier with a student cap, and
   **SMS billed separately** as prepaid credits at actual usage. No flat per-student pricing.
2. **Simplest scalable database design:** multi-tenant with `coaching_center_id` on every
   table + RLS, enrollment as the join between students and subject-batches, attendance in
   session + record pairs, payments as an append-only log. (Full schema in §3.)
3. **Fastest MVP we can realistically build:** single-teacher mode — students + attendance
   on a phone, deployed on Vercel Hobby in week 1–2, with manual data entry for testers.
4. **Highest-probability path to first paying customer:** the free Teacher Mode tier grows
   users; then walk into one local center, load their real students, and run one real fee
   cycle free for 30 days — the auto-parent-SMS result demo is the close.
5. **One-sentence positioning:**
   > **"Run your coaching center from a phone — replace Excel, paper, and the extra
   > operator."**
