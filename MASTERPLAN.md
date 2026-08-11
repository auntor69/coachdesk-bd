# Coach Desk — Masterplan

Software for coaching centres and private tuition businesses in Bangladesh.
Sold locally, in BDT, collected via bKash. Built solo on free tiers.

---

## 1. What we are building

**Long answer to "a whole digital system?":** yes, that is the destination — attendance,
fees, exams, parent communication, and centre analytics in one place. But we do **not**
build it in that order, and the difference decides whether this makes money.

If you build the full system first, you spend three months guessing, launch something broad
and shallow, and discover the owners only cared about two screens. So:

**The wedge is fee collection.** A centre with 200 students chases late fees by phone and
WhatsApp every month, loses track, and writes some off. That is the bleeding wound. We fix
that first, get paid for it, and expand into the rest of the system from inside a paying
account.

Everything in Tier 1 below exists to make the fee board work. Everything in Tier 2 exists to
keep them from leaving. Tier 3 is what turns one centre into a platform.

**Who buys:** the centre owner or manager. One person, decides alone, handles cash daily,
already pays for things like rent, printing, and staff. Not a procurement committee.

**Who uses daily:** teachers (attendance, marks), the front desk (fee entry), guardians
(receive messages). Three very different users, three very different UI needs.

---

## 2. Feature map

### Tier 1 — MVP, the thing we sell (weeks 1–2)

| Feature | Why it exists |
|---|---|
| Student roster by batch | Everything hangs off this |
| Attendance, 20-second entry | The daily habit that keeps the app open |
| **Fee board** — paid / due / late by N days / total outstanding BDT | This is the product. This is the demo |
| Cash payment marking + bKash reference field | Owners must be able to record cash without disclosure |
| Automated guardian reminders (due −3d, due date, +7d) | Converts effort into collected money automatically |
| Owner dashboard — collected, outstanding, attendance rate | The screen that justifies renewal every month |
| Bangla + English UI | Non-negotiable for teachers and guardians |

### Tier 2 — retention, added while they are already paying (weeks 3–6)

- Exam and test marks entry, per batch
- **At-risk student flags** — attendance falling + marks falling + fees late. The owner's
  early warning before a student quietly drops out
- Weekly guardian progress summary, generated from real attendance and marks data
- Printable/PDF monthly fee receipt and collection register
- Multi-batch, multi-teacher permissions
- Offline attendance entry that syncs when the network returns

### Tier 3 — platform, only after 15+ paying centres (month 3+)

- Guardian-facing view (their child's attendance, marks, fee history)
- Admission and enquiry pipeline — track leads who visited but did not enrol
- Teacher salary and payout tracking
- Multi-branch rollups for centres with 2+ locations
- Question bank and printable test generator
- Cross-centre anonymised benchmarks ("your retention vs similar centres")

### Explicitly NOT building

- WhatsApp Business API — charges per conversation, destroys the margin. Use prefilled
  `wa.me` links the owner taps, plus free channels.
- Native Android/iOS apps — PWA only. No Play Store fee, instant updates.
- An AI chatbot or AI tutor. Nobody is paying for that here.
- Online card payments in v1 — bKash reference + cash marking covers it.
- A self-serve signup flow in month 1. You onboard by hand. See §6.

---

## 3. Tech stack

Chosen for zero cost, commercial-use legality, and mid-range Android on patchy data.

| Layer | Choice | Why |
|---|---|---|
| Frontend | **React + Vite PWA**, TypeScript, Tailwind | Installable, offline-capable, no app store |
| Hosting | **Cloudflare Pages** | Free tier **permits commercial use** |
| Backend/DB | **Supabase** — Postgres, Auth, RLS, Realtime | Auth and row-level security included |
| Scheduled jobs | **Cloudflare Workers + Cron Triggers** | Free; runs the reminder engine |
| Guardian messaging | Email (Brevo/Resend free) + Telegram + tap-to-send WhatsApp links | Avoids per-message cost |
| Payments in | **bKash Personal Retail Account** | Works for an individual with no trade licence |
| AI (optional) | Gemini free tier, batched | Only for phrasing weekly summaries |
| Repo | GitHub, private | Free |

**Vercel is excluded deliberately.** Its Hobby plan forbids commercial use — it defines
commercial as any deployment used for financial gain, including taking payments. The day you
charge a centre, a Hobby deployment is a terms violation. Cloudflare's free tier allows it.

**Supabase free-tier limits to respect:** 500MB database, 1GB storage, 2 active projects per
free org, and **auto-pause after 7 days of inactivity**. Daily attendance use prevents the
pause. Move to Pro ($25/mo) at two paying centres — two centres cover it.

**Why almost no AI in the core:** free LLM quotas run ~5–15 requests/minute and 100–1,000/day
per project, so per-user AI calls collapse the moment you have real usage. Fee arithmetic and
attendance must be deterministic anyway — a wrong number here loses the customer permanently.

---

## 4. Getting customers

You asked: reach out, give a 3-day temporary account, and if they like it they buy.

**Right instinct, wrong numbers, and wrong order.** Three specific corrections:

### Correction 1 — a 3-day trial cannot work for this product

Coach Desk's value is only visible across a **fee cycle**. In 3 days an owner sees an empty
app and some data entry work. They see nothing collected, because no fee was due yet.

The trial must be **30 days**, ideally timed to start just before their monthly fee due
date. That way the trial ends the day after they have watched the system collect money and
hand them a "৳X collected, ৳Y still outstanding" number. That number is the close.

### Correction 2 — do not hand them an empty account

An empty account is homework. Owners are busy and it dies in a drawer.

**You enter their students yourself.** Take their register — paper, Excel, whatever — and
load it in. Then hand them an app already containing their real batches, their real
students, and their real outstanding fees. The reaction to seeing their own centre already
inside the software is the entire sales pitch, and no competitor bothers to do it because it
does not scale. At your size, not scaling is an advantage.

### Correction 3 — first customers before polish, not after

Do not build for a month and then look for centres. **Find centre #1 in week 1**, while the
app is still ugly, and build the rest with them watching. They will tell you which two
screens matter. You are a student in Bangladesh — you have been through this system, you
know centres, and their owners know students. That access is your unfair advantage and it
expires the further you get from campus.

### The actual acquisition sequence

**Stage 1 — design partners (centres 1–3).** People you or your friends already know. The
ask is not "buy my software," it is: *"I'm building this for coaching centres. Can I set it
up with your students for free for a month and you tell me what's wrong with it?"* Nearly
impossible to refuse. Free, in exchange for weekly feedback and permission to use their
numbers as a case study. Do not charge these three.

**Stage 2 — referral chain (centres 4–15).** This sector is densely networked; owners know
each other, and many teach at multiple centres. At the end of every successful month, ask
one question: *"Which other centre owner should I show this to?"* One name per happy customer
is enough to compound. Ask for the introduction directly — a WhatsApp intro from a peer beats
any cold approach you could make.

**Stage 3 — local density (centres 16+).** Coaching centres cluster physically — same streets,
same buildings, near the same colleges. Once three centres in one area use it, walking into
the fourth is a warm call: you can name their neighbours. Target one cluster at a time, not
one city at a time.

**Stage 4 — inbound (month 4+).** Publish what you learn: fee-collection rates, retention
patterns, a free monthly fee-register template in Bangla. Teachers and owners search for
this. Slow, compounding, free.

### The demo that closes

Not a slideshow. Sit with the owner, open the fee board on your phone with their real data,
and let them look at the outstanding total. Most owners do not know that number precisely.
Seeing it is the moment. Then show one reminder message going out.

Total demo: under five minutes. Then stop talking.

### The trial-to-paid mechanics

1. **Day 0** — you load their data, set fee amounts and due dates, train the front desk for
   20 minutes. Trial starts.
2. **Days 1–30** — you check in weekly, by message, in person if nearby. Fix what breaks the
   same day. This responsiveness is the product at this stage.
3. **Fee-cycle day** — reminders fire automatically. The owner sees payments come in against
   a live board.
4. **Day ~28** — show them their own numbers: total collected, how much was outstanding at
   the start of the month, how many reminders went out without them lifting a finger. Then
   quote the price. The price should be obviously smaller than what they just watched
   arrive.
5. **No card on file, no auto-charge.** They pay you monthly by bKash. Friction is fine when
   the customer count is under 50 — and it forces a monthly conversation where you hear
   problems before they churn.

**Pricing shape:** monthly, per active student, in BDT, with a floor for small centres. Do
not fix the number now — set it in the room with design partner #1 once you have watched a
real fee cycle and know how much money the system actually moved. Charge for value observed,
not value guessed.

### Honest risk on this plan

The uncomfortable part is that all of it needs conversations, and you said you were unsure
about outreach. There is no version of "revenue soonest" that skips talking to owners. What
this plan does is make those conversations as easy as they can be: warm contacts first, real
data in hand instead of a pitch, and a referral ask instead of a cold approach. If after
three attempts you find you genuinely hate it, say so — the Past-Paper Pattern Engine from
the research doc grows through campus group chats instead, with no selling. But it takes
months to reach revenue, not weeks.

---

## 5. Build sequence

> Your instinct to start coding today is wrong. A few hours of setup and one 15-minute
> conversation with a centre owner are worth more than a month of coding before anyone has
> seen the product.

1. **This week — the three design-partner conversations.** Find the owners, or friends who
   know owners. Get the truth about how fees actually work: monthly, or per exam? Who chases
   late payers, when, and over what channel? What does the outstanding book look like? What
   would they pay? Two or three of these conversations will reorder everything below. This
   is the one step you cannot skip or delegate.
2. **Data model + Supabase project.** `centres`, `batches`, `students`, `guardians`,
   `attendance`, `fees`, `scores` — with row-level security from the first migration, so no
   centre can ever read another's students.
3. **Attendance entry** (teacher PWA). The daily habit. If it is not faster than paper,
   nothing else in the product matters.
4. **The fee board.** Paid / due / late by N days / total outstanding, cash marking plus a
   bKash reference field. This is what you demo and what you sell.
5. **Reminder cron.** Cloudflare Workers at due −3d, due date, and +7d. This runs the fee
   cycle without the owner lifting a finger.
6. **Owner dashboard.** Collected, outstanding, attendance rate by batch. The renewal
   justification, on one phone screen.
7. **Onboard design partner #1.** Load their real students by hand, run one real fee cycle,
   watch teachers use it, fix what hurts, then set the price in the room.

## 6. Weekly operating rhythm (once centres are live)

- **Monday:** reminder-job report — all messages sent, any failures, who paid over the
  weekend. Numbers only.
- **In-week:** fix anything a centre hits the same day. Add Tier 2 features strictly in the
  order owners ask for them, not the order in this document.
- **Month end:** the fee-cycle close conversation for any trial centre, plus one referral
  ask per paying centre.
- **Never spend money.** Running cost stays at ৳0 until Supabase Pro is funded by two
  paying centres.

## 7. When to pivot or stop

- **Built it, and no centre uses it daily after 30 days:** you misjudged the problem, not
  the execution. Go back to the design-partner conversations.
- **A centre stops opening it:** call them that week. One direct conversation tells you
  whether it is a missing feature or a dead product faster than any amount of analytics.
- **Two owners in a row cannot describe their own fee problem back to you:** this is not the
  product. Move to the next idea in the research doc (Past-Paper Pattern Engine, Ledger Bot).
  The attempt is not wasted — the Supabase schema, auth, RLS, and PWA work carry over almost
  unchanged.

## 8. Version history

- **2026-08-11** — masterplan written. Product: Coach Desk. Wedge: fee collection, not a
  broad "school management system." Trial: 30 days with data pre-loaded by us, not 3 days
  self-serve. Monetisation: monthly per active student via bKash Personal Retail Account.
  Immediate next step: design-partner conversations before writing more code.
- **2026-08-11 (v2)** — scope corrected: full Coaching Center Management System (CCMS), not
  a fee tracker. Pricing corrected: per subject-enrollment + separate SMS credits, not per
  student. Vercel Hobby free OK for dev/testing until first paying customer, then Pro.
  Auto-parent-SMS on marks is the marketing hook. Full design brief:
  `COACHDESK-BD-FOUNDATION.md`.



