# Plans, SMS, WhatsApp, and calling — the sustainable version

Written 2026-08-23, in answer to four questions: what the tiers should be, how SMS
actually reaches a guardian from a centre's own number, how WhatsApp can be
detected and charged for, and what the desktop does with a button that only a
phone can honour.

This is a decision document, not a spec. Where a decision is the founder's, it
says so and stops.

---

## 1. The tiers

### What the code says today

`src/lib/plans.ts` is already the single source of truth, and it is close to what
you described but wrong in three places:

| | free | plus | center | institution |
|---|---|---|---|---|
| batches | 1 | 6 | ∞ | ∞ |
| students | 60 | 300 | ∞ | ∞ |
| SMS/month | **50** | **200** | **0** | **0** |
| price | 0 | 300 flat | 8/enrollment | 6/enrollment |
| features | **all** | all | all | all + branches |

Three problems, in order of how much they cost:

1. **The paying tiers get less free SMS than the free tier.** 0 against 50. On
   your new rule this is deliberate and correct — a centre buys credits — but it
   must be *stated* to them, or it reads as a bug on the pricing page.
2. **Every tier has `features: {...ALL_FEATURES}`.** There is nothing behind a
   paywall except scale. So a Teacher Pro tier priced at 499 today would sell
   nothing that free does not already do. **This is the real work of your plan.**
3. `teacher_plus` at 300 Tk, 6 batches, 300 students — all three numbers differ
   from the ones you just gave.

### The tiers as you specified them

| | Teacher Free | Teacher Pro | Center / Institution |
|---|---|---|---|
| batches | **1** | **5** | custom |
| students | **30** | **50 per batch** (250) | custom |
| teachers | 1 | 1 | custom |
| free SMS/month | **30** | **50** | **0** |
| may buy credits | **no** | **yes, any amount** | yes |
| price | 0 | **499/mo** | 1,999 – 99,999 custom |
| support | none | yes | highest priority |

Two notes on the numbers, then the feature split, which is the part that needs
building.

**`maxStudents` is currently a centre-wide total, not per-batch.** Your Pro spec
is "5 batches, up to 50 per batch". Those are different rules: a teacher with 5
batches of 50 is 250 students, but a teacher with 1 batch of 250 would pass a
total-only check and fail a per-batch one. Enforcing per-batch is the stricter and
more honest reading of what you said, and it needs a new limit key
(`maxStudentsPerBatch`) rather than a bigger `maxStudents`. Both should exist:
per-batch stops one giant batch, the total stops 5 × 500.

**30 students on free is tight, and that is the point.** A real class in Dhaka is
40–60. So free cannot run a teacher's actual class — it can run one section of
it, or a trial month. That is what makes it marketing rather than a free product.
Deliberate, and I think correct.

### What free must *not* have (the paywall, at last)

`ALL_FEATURES` has to become a per-tier object. My proposal, ordered by how
strongly each one pulls a teacher to Pro:

| feature | free | pro | centre | why here |
|---|---|---|---|---|
| attendance + roll call | ✓ | ✓ | ✓ | the hook; never gate it |
| own students & fees | ✓ | ✓ | ✓ | same |
| exam marks entry | ✓ | ✓ | ✓ | same |
| **printable fee receipt** | ✗ | ✓ | ✓ | your call, and a good one — see below |
| **collection register** | ✗ | ✓ | ✓ | same family of thing |
| **CSV / report export** | ✗ | ✓ | ✓ | already a flag: `exportReports` |
| **weekly parent summary** | ✗ | ✓ | ✓ | the Tier-2 feature, unbuilt |
| **4-stage fee reminders** | ✗ (1 stage) | ✓ | ✓ | see §2 |
| **buy SMS credits** | ✗ | ✓ | ✓ | your rule |
| staff & role management | ✗ | ✗ | ✓ | the teacher/centre line |
| centre-wide dashboard | ✗ | ✗ | ✓ | same |
| multiple branches | ✗ | ✗ | institution | same |

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

### Centre pricing: the calculator you described

You want a centre to pick students/batches/teachers and be shown a price. The
existing `monthlyBillBdt()` already does per-enrollment pricing with a floor,
which is *better* than a slider on students, for one reason worth keeping: it
charges for what drives our cost (SMS volume and support load track enrollments,
not headcount), and it grows with the centre automatically instead of needing a
renegotiation each term.

My recommendation: keep per-enrollment as the *engine*, and put your calculator
on top as the *presentation*. The owner moves three sliders, we compute
`max(floor, rate × enrollments)`, and show one monthly figure with the band name
next to it. Suggested bands, which need your judgement on the real market:

| band | enrollments | monthly |
|---|---|---|
| Small centre | up to 150 | 1,999 |
| Growing | 151 – 400 | 3,999 |
| Large | 401 – 900 | 7,999 |
| Institution | 901+ | custom, from 14,999 |

**These numbers are a guess and I want to flag that clearly.** I have no data on
what a Dhaka coaching centre pays for software. The structure is sound; the
figures need one conversation with one real owner before they go on a page.

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
| tap-to-send from own phone (Option C) | ✓ unlimited | ✓ | ✓ |
| automated SMS via `CoachDesk` (A) | 30/mo, no top-up | 50/mo + credits | credits only |
| own sender ID (B) | — | — | ✓ |

The free tier gets **unlimited manual messaging and 30 automated**. That is
honest — they can run their class — while the thing they cannot do (walk away and
let it send itself) is precisely what Pro sells. And "cannot buy credits on free"
becomes a natural sentence rather than an arbitrary block: *automated sending is
a Pro feature; you get 30 to try it.*

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

1. **Per-tier features + the new limit keys** (`maxStudentsPerBatch`,
   `canBuyCredits`, `automatedSms`). Tiers as specified above. Enforced in
   `plans.ts`, in the RLS/billing guard, and on the screens — with the locked
   feature *visible and explained*, never hidden. **— Built.**
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
   new encrypted columns. Only when a centre asks; not before.
6. **Centre pricing calculator**, once the band figures are real.

Items 1–4 are done. Item 5 needs the aggregator account. Item 6 needs your
pricing decision — which makes it the next thing that needs you, not me.

---

## 6. What needs you

- **The centre band figures.** 1,999 / 3,999 / 7,999 / 14,999 above is my guess
  with no market data behind it. One conversation with one real owner fixes this.
- **Resell vs bring-your-own** for centre sender IDs (§2). Revenue and float
  versus simplicity and no liability.
- **Whether Teacher Pro is 499.** Against 30 free students and 5 batches, 499/mo
  is roughly one student's monthly fee. That is a defensible pitch — "one
  student pays for the software" — and it is the pitch I would make.
- **The free-receipt question** (§1). I recommend number-on-free,
  paper-on-Pro. If you want the harder line, gate it entirely; say which.
- Still outstanding from before: rotate the Supabase DB password, add
  `CRON_SECRET` to Vercel, BTRC sender ID needs your NID.
