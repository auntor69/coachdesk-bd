# Performance audit — 2026-10-19

**Status: #1, #0 and #7 are implemented and the suite is green (§5.1). Every other row of
that table is still a proposal, and two of them have since been re-checked against the code
and changed status — read §5.1 before implementing #2 or #4.**
Every number below was measured in this workspace on 2026-10-19; every one says how,
and every claim that is not a measurement is labelled a hypothesis with the check that
would settle it.

---

## 1. The short version

The **database is not the problem**, and the app is not making 63 API calls either.

| Finding | Confidence | Evidence |
|---|---|---|
| **The 63 "requests" are mostly Next.js route prefetches, not API calls.** One page load fetches the RSC payload of every route whose `<Link>` is on screen — 12 sidebar rows, 4 phone tabs, the More sheet, `/account` and `/settings/billing`: **14 distinct destinations**, 17 `.rsc` requests in the capture. | **Confirmed** as the only mechanism that produces that many same-origin requests, from the origin and sizes in the DevTools screenshot (`0.3–0.6 kB` initiator `00pvd…`, *not* `localhost`/Supabase). | §3.1 |
| **No page fetches another module's data.** Each `page.tsx` in `(app)` reads only its own tables, in one `Promise.all`. What *looks* like modules loading together (`dashboard.rsc`, `fees.rsc`, `students.rsc`…) is each destination prefetching its own shell — and six of them are prefetched **twice**. | **Confirmed by reading** every `page.tsx`; the duplicate waves are in the screenshot. | §3.1 |
| **Round trips dominate.** One Supabase round trip is ~270–300 ms **from this sandbox**, with a tail to 825 ms, for a query that returns nothing. | **Measured** (§2.3); the production figure (client → function → Supabase) is a hypothesis until read from Vercel's and Supabase's own dashboards (§7). | §2.3 |
| **The session gate costs 3 serial Supabase round trips before a page's first query** — `auth.getUser()` in the proxy, `auth.getUser()` again in `getSession`, then a `settle_billing` RPC. `getSession` itself is correctly memoised per request, so the page and its `generateMetadata` share it. | **Confirmed by reading** (`src/proxy.ts:146`, `src/lib/auth/session.ts:287/294/464`). | §3.2 |
| **The dashboard runs 17 queries** (8 for a teacher, 10 for a free-tier owner, 17 for a paying owner — the conditional rows are counted in §3.3) and the page-level `loading.tsx` **turns on prefetching for the route**, so the sidebar can start that work before the reader clicks anything. | **Confirmed by reading** `dashboard/page.tsx` (17 `.from(`) + `splitForPhone` marks the dashboard as a tab → full prefetch because `(app)/loading.tsx` exists. | §3.4 |
| **The slowest SQL is `student_risk`, and it contains a quadratic step.** 1.05 s at 150 students, **2.24 s at 250** — one arm removes **1 494 000** rows as a join filter, one per student × invoice pair. `batch_attendance_monthly` (≈0.7–1.2 s) and `student_progress_week` (≈0.75 s) are linear in the centre's **whole** attendance history, not in the 30-day window they ask about. | **Measured** with `EXPLAIN ANALYZE`, §2.2, §2.2b, §4.1. | §4.1 |
| **The fee board and the risk view do the right thing** on the date-filtered queries with accurate statistics (≈0.1–0.25 s). The 13-second figure I first measured was a *benchmark artefact* (no `ANALYZE`), recorded here so nobody chases it. | **Measured** before/after `ANALYZE`. | §2.2, §4.4 |

**Where the 4.06 s goes, best estimate** (a cold, production navigation to `/` with a
signed-in session, ordering from the DevTools trace and the measurements here):

| Stage | Estimate | Basis |
|---|---|---|
| Network + TLS + HTML + fonts/JS | 550–1 000 ms | screenshot: `Finish 10.93 s` includes idle; `DOMContentLoaded 3.95 s`; `page load 4.06 s` |
| Route prefetches (12 sidebar rows + 4 tabs + the More sheet) competing with the real navigation | 200–2 200 ms each, 0.3–0.6 kB each | screenshot: 17 `.rsc` entries, initiator a `_next` chunk |
| Session gate: proxy `getUser` → `getSession` `getUser` → `settle_billing` → `center_members`/`profiles` | 3 × RTT ≈ 0.8–1.0 s | §2.3, §3.2 |
| Dashboard's own data (`Promise.all`, 17 queries) | 0.4–1.5 s server-side | §2.2 (fixture) + §2.3 |
| Client render of 12-row sidebar, 4-tab bar, banner, cards | 100–300 ms | not measured here (no browser in this workspace) |

That is the shape of 4 s without anything pathological in the app: **the product pays one
round trip per gate, one per query group and one per prefetched route, and it pays them
in series.**

---

## 2. What was measured, and how

### 2.1 Harness

A throw-away script (deleted afterwards, `git status` clean) boots the real schema
through `scripts/lib/pg-harness.mjs` (PGlite — Postgres compiled to WASM, all 98
migrations applied, 5.0–5.7 s to boot), seeds one centre as the owner and runs each
query through `asUser()` so **RLS policies actually execute**, then times
`EXPLAIN (ANALYZE)` three times per query and reports the median.

*The fixture*, deliberately mid-tier for this product (the ৳1 999 centre):

| rows | |
|---|---|
| students | 150 |
| batches / teachers / subjects | 8 / 8 / 8 |
| enrolments | 600 (4 batches each) |
| fee invoices | 3 600 (6 months × 600) |
| fee payments | 2 321 (65 % of invoices paid) |
| attendance sessions / records | 240 / 18 000 (30 days) |
| database size | 25 MB |

**Caveats, stated because they bound every number below.**
PGlite is single-connection, has no parallel workers and no JIT; it is slower per row than
hosted Postgres, so **absolute milliseconds are an upper bound** and only the *ratios*
should be carried over. The fixture has no branches, no exams and no `progress_updates`,
so `student_risk`'s marks arm and `student_progress_week` are measured on the empty side.

### 2.2 Query timings (RLS on, owner session, median of 3)

| Query | Where it runs | Before `ANALYZE` | After `ANALYZE` | Plans on the realistic (post-`ANALYZE`) run |
|---|---|---|---|---|
| `students` head count | dashboard | 3.5 ms | 3.2 ms | seq scan (150 rows) |
| fee board — outstanding, paged 1 000 | `/fees` | **12 800 ms** | **219 ms** | seq `fee_invoices` + hash join on aggregated `fee_payments` |
| fee board — settled this month | `/fees` | 2 700 ms | 116 ms | same |
| `fee_collections_month` | `/fees`, dashboard | 100 ms | 85 ms | seq `fee_payments` |
| **`student_risk`** | dashboard **and** `/at-risk` | 9 200 ms | **1 050 ms** | seq `attendance_records` + seq `enrollments` ×4 + `fee_invoice_balances` |
| **`batch_attendance_monthly`** | dashboard | 640 ms | **710 ms** | one `GroupAggregate` over a seq scan of 18 000 `attendance_records` |
| **`student_progress_week`** | dashboard | — | **755 ms** | seq `attendance_records` + seq `enrollments` ×5 |
| `center_profit_month` | dashboard | — | 155 ms | five view scans |
| `fee_charges_month` + category split | dashboard | — | 440 ms | `fee_invoices` + `fee_payments` twice |
| `app.active_students()` / `active_teachers()` | **every request** | 0.2 ms | 0.2 ms | index-only |
| `settle_billing(...)` — paid-up centre | **every request** | 0.6 ms | 0.6 ms | price card + 2 counts + ledger sum + lock |

The 13-second first result is a **statistics** problem, not a query problem: on a freshly
seeded table `pg_class.reltuples` is 0, Postgres assumes the correlated payments subquery
returns one row and runs it **once per invoice** (7 047 402 rows removed by join filter in
the plan). `ANALYZE` flips it to a hash join. Production tables have autovacuum statistics,
so **treat the post-`ANALYZE` column as the production estimate** — but see §6 risk 4 for
the one place this artefact is still worth a guard.

### 2.2b Scaling check — what the same views cost at 250 students

The fixture above is the small end of a real centre. Re-run at **250 students, 1 000
enrolments, 6 000 invoices, 30 000 attendance records** (still no exams, no payments):

| Query | Time | The two nodes that own it |
|---|---|---|
| fee board — outstanding | **202 ms** | hash join of the centre's payments with its invoices — healthy |
| `student_risk` | **2 236 ms** | `Seq Scan attendance_records` **1 226 ms** (30 000 rows); free arm: **`Rows Removed by Join Filter: 1 494 000`** — one comparison per (student × invoice) pair, 823 ms |
| `batch_attendance_monthly` | **1 212 ms** | one `GroupAggregate` over `attendance_records`, **1 199 ms** |

Two facts worth carrying forward:

* The attendance scan is **linear in total records, not in the window** — 30 days and 30
  rows-per-student still scan the table. It grows with the centre's whole history.
* The fee arm of `student_risk` has a **quadratic** step: `students` × `fee_invoices`.
  1 494 000 rows removed at 250 × 6 000. A centre with 12 months of data (24 000
  invoices) and 500 students would compare 12 000 000 pairs per dashboard load.

That second one is the only shape in this audit that gets *worse* as a good customer
keeps using the product. It is the first SQL item to fix, ahead of any attendance index.

### 2.3 Network round trip

Seven sequential `GET`s to the project's PostgREST from this workspace (no session, anon
key, RLS filters to zero rows, so this is *network + gateway + empty query*):

```
coaching_centers         median 302 ms   (min 275, max 825)
fee_invoice_balances     median 292 ms   (min 271, max 398)
students                 median 272 ms   (min 245, max 780)
```

**One round trip is ~270–300 ms from here**, with a long tail to 825 ms. This is the
single most important number in the audit: **any two Supabase calls made in series cost
~0.6 s before a byte of data is read.** The project's DNS resolves through a global CDN
(Cloudflare anycast), which tells us about the entry point and nothing about the region
the database and PostgREST run in.

**Not measured here, and the user should read these from their own DevTools:**
Vercel function duration (Vercel → Logs → Functions), Supabase's own query time
(Supabase → Reports → Query Performance), and TTFB. §7 says exactly which columns to read.

### 2.4 What was *not* measured

* The real production schema's statistics, row counts and index bloat — this workspace
  cannot reach the project with a session (no user credentials are available to it, by
  design).
* Client-side render and hydration times — no browser in this workspace.
* How much of the user's captured `.rsc` traffic is prefetch rather than navigation. The
  page-level evidence is in the screenshot; the split needs the `next-router-prefetch`
  filter in §7.

---

## 3. What happens when an owner opens a page

### 3.1 The 63 requests

`63 requests` in the Network panel is not 63 API calls. It decomposes as:

1. **One document + its assets** — HTML, CSS, the font, `_next/static/chunks/*`, the
   service worker, icons, manifest: ~15–20 on a cold load.
2. **1 proxy invocation** (the document itself passes through `src/proxy.ts`).
3. **Up to 17 prefetch requests for 14 distinct destinations** — and this is the part worth
   reading carefully. They are not free: in the screenshot the first wave answers in
   370–560 ms and the second in **1.2–2.2 s each**, which is what a shell render costs
   when the shell contains the session gate.
   A `<Link>` prefetches when it enters the viewport. For a **dynamic** route with a
   `loading.js` above it, Next prefetches *the layout down to the first loading
   boundary* — here `src/app/(app)/loading.tsx`, which is at the group root, so the
   shell it fetches includes the layout itself, i.e. a full render of `(app)/layout.tsx`
   → `getSession()` → the two `auth.getUser()` calls (proxy + session) → `settle_billing`
   → `center_members` + `profiles`.
   The dashboard renders **12 sidebar rows + 5 phone-bar items** (`src/components/app-shell.tsx`,
   `STAFF_ADMIN_NAV` — 12 for an owner, and the screenshot's sidebar shows exactly those
   12), the shell's two `LinkButton`s, and the page's own 3 links. Almost all of them are
   in the viewport or reachable by hover, so **the app starts up to fourteen backend
   renders of screens nobody asked for**, each one a function invocation that re-resolves
   the session. (Next deduplicates by route, so a sidebar row that shares a destination
   with a tab costs one shell, not two.)
4. The page's own data, fetched *inside the function* as PostgREST calls — these are
   **invisible in the browser's Network panel** because they never leave the server.

That is why the initiator column in the screenshot reads `00pvd…ljs` (a Next chunk) for
every `*.rsc` entry rather than the page's own URL, and why the `.rsc` files are
0.3–0.6 kB: they are the prefetched shell, not the data.

**The duplicates.** The screenshot has two waves, and six destinations appear in both
(`notices`, `progress`, `hq`, `settings`, `account`, `billing`). Each wave carries a
different `next-router-state-tree` and a different `_rsc` key, so this is Next
re-prefetching the same destination after the tree changed — and because
`staleTimes.dynamic` is **0** by default, the second fetch is not served from the
prefetch cache. The app is not querying twice; the router is. (Hypothesis for the exact
trigger; the fact that both waves are prefetch requests is in the initiator column.)

**Correcting the premise:** the modules that "appear to fetch data during initial load"
(`dashboard`, `fees`, `students`, `exams`, `payroll`, `settings`, `account`…) are **not
sharing data or fetching each other's** — each `page.tsx` in `src/app/(app)` was read;
each reads only its own tables, all inside a single `Promise.all`. What is happening is
each destination prefetching its own shell, one after another, as their links are seen.

### 3.2 The session gate — 3 serial round trips, one of them paid twice

```text
document ──▶ proxy.ts:146          auth.getUser()                 ≈ 1 RTT (auth server)
         ──▶ (app)/layout.tsx      getSession()
                                    ├─ auth.getUser()            ≈ 1 RTT (auth server)  ← again
                                    ├─ center_members + profiles  ≈ 1 RTT (2 queries, parallel)
                                    └─ settle_billing(...)        ≈ 1 RTT (RPC)
         ──▶ page.tsx              generateMetadata() → getSession()   (memoised, no cost)
                                    page's own Promise.all        ≈ 1 RTT
```

`getSession` is wrapped in React `cache` (`src/lib/auth/session.ts:287`) so the layout,
the page, `generateMetadata` and every `can*()` helper share **one** result per request —
that part is already right, and worth saying before proposing anything: **the app does
not call `getSession` twice.**

What it *does* do:

* **`auth.getUser()` twice per request.** Once in the proxy (decides the redirect) and
  once in `getSession` (decides the session). Both are network calls to Supabase's auth
  server, because `getUser` verifies the JWT rather than decoding it — a deliberate and
  correct security choice, made twice.
* **Settle the day on every request that can pay.** `settle_billing` is 0.6 ms of SQL
  (measured) but it is a *fourth* round trip in front of the page's data on every
  navigation, and it holds a per-centre advisory lock while it runs.
* **Every prefetched shell repeats all of the above** — the proxy does not know a request
  is a prefetch, and `getSession` is per-request.

### 3.3 The dashboard's 17 queries

`src/app/(app)/dashboard/page.tsx` — one `Promise.all` of 17 builders. A teacher runs 8
(none of `isAdmin`/`showMoney`/`seeProgress` rows); a free-tier owner runs 10 (plus the two
`isAdmin` counts — `parentSummary` and `centerWideReporting` are both false on Teacher
Free, `src/lib/plans.ts:152–156`); a paying owner runs all 17:

| # | source | gate |
|---|---|---|
| 1 | `students` head count | always |
| 2 | `batches` ids | always |
| 3 | `fee_invoice_balances` — outstanding, **paged** | always |
| 4 | `fee_collections_month` | always |
| 5 | `attendance_sessions` — today | always |
| 6 | `fee_reminders` since last month, **paged** | always |
| 7 | `batch_attendance_monthly` — two months | always |
| 8 | `student_risk` — **all rows**, **paged** | always |
| 9 | `student_progress_week` — count columns, **paged** | `seeProgress` |
| 10 | `enrollments` head count | `isAdmin` |
| 11 | `attendance_sessions` head count | `isAdmin` |
| 12 | `center_profit_month` | `showMoney` |
| 13 | `fee_charges_month` | `showMoney` |
| 14 | `fee_charges_category_month` | `showMoney` |
| 15 | `salary_terms` head count | `showMoney` |
| 16 | `salary_payments` head count | `showMoney` |
| 17 | `expenses` head count (`category = 'salary'`) | `showMoney` |

This is a **real cost, already mitigated**: the `Promise.all` is already allowing PostgREST
to service them concurrently (§5.2 in the masterplan's own idiom), and every expensive one
is a view with its aggregate computed in SQL. It is still 17 requests *per dashboard
render*, and the dashboard is the most-prefetched route in the app.

**Dashboards are where the paging bites.** Rows 3, 6, 8 and 9 are paged
(`pageAll`/`pageOrNull`) at `PAGE_SIZE = 1000` — correct for a total, but the dashboard
only *draws* three reminder chips and three risk rows, and `setupSteps` needs a count,
not 1 000 rows of `student_progress_week`. On a 250-student centre that is up to 4
extra round trips **inside the function**, each ~1 RTT to PostgREST.

### 3.4 Prefetch, precisely

From `node_modules/next/dist/docs/01-app/02-guides/prefetching.md` (this repo's own
installed docs, which `AGENTS.md` says to read before writing code):

> a static route is prefetched in full, while a dynamic route is skipped unless it has a
> `loading.js` boundary […] **With `loading.js`: Layout to first loading boundary**

`src/app/(app)/loading.tsx` exists — deliberately, for the offline story and the tap
feedback, and its own header says so. The consequence that has not been accounted for is
that **it also turns on prefetching for every signed-in route**, and the sidebar gives
Next twelve of them to prefetch from one screen.

---

## 4. Root causes, ranked by measured impact

### 4.1 Confirmed — the aggregates rescan the whole centre on every dashboard view

`student_risk` (`20260811000014`), `student_progress_week` (`20260811000021`) and
`batch_attendance_monthly` (`20260811000011`) all join
`attendance_records → attendance_sessions → enrollments` and aggregate with `FILTER`
over a **date range they cannot push down before the join**. Measured on the fixture:

```
batch_attendance_monthly : 710 ms   one GroupAggregate over a seq scan of 18 000 records
student_risk             : 1 050 ms seq scan attendance_records + enrollments ×4
                                     + a fee arm that compares students × invoices
student_progress_week    : 755 ms   same attendance shape, another full pass
```

These three views are read **on the dashboard** (rows 7, 8, 9) and `student_risk` is read
**again** on `/at-risk`.

The attendance half is a funnel problem, not a missing-index problem: the planner *does*
use `attendance_sessions_center_date_idx` to find the window's 240 sessions, then
`Seq Scan attendance_records` (30 000 rows) because every record's existence has to be
checked against the enrolment the view needs anyway. Adding
`attendance_records (enrollment_id) include (session_id, status)` and
`enrollments (coaching_center_id, student_id)` did **not** change the plan or the time
(§4.4).

The fee half is the quadratic one from §2.2b — `students` × `fee_invoices` as a join
filter — and it is the one with the best fix: the dashboard needs a **count**, and the
risk view needs **one row per flagged student**. Both can be served by asking the fee
arm for a grouped aggregate over *overdue invoices only* (`fee_invoices` has
`(coaching_center_id, due_date) where voided_at is null`; the plan already uses it),
rather than joining the full invoice set back onto every student.
**Hypothesis to verify on the production plan:** the 1.49 M-row join filter comes from
`fees` being a grouped CTE joined to `flagged` on `(centre, student)`, where the planner
chooses a merge join it cannot use as an equality. Rewriting it as a `LATERAL` lookup
per student, or as a join from `fees` to `students` (the smaller side drives), should
collapse it. It is measured next round, not assumed.

Materialising the views (**§5 fix #5**) is the fallback, not the first choice: it needs a
refresh strategy and §6 risk 2 applies.

### 4.2 Confirmed — three serial gate round trips in front of every render

`proxy.getUser()` → `getSession().getUser()` → `settleDay()` → page queries. Measured
cost of one trip ≈ 270–300 ms. **One of the two `getUser()` calls and the settle are
avoidable** — and on a prefetch, the proxy's one is avoidable *today* (fix #0):

* **`getSession` can trust the proxy's verdict** by *asking the same JWT verifier once*.
  The 2026-10-13 entry in `MASTERPLAN.md` already took the first step (`hasSessionCookie`
  skips `getUser` on public routes); the remaining duplicate is the signed-in path.
  The honest options, in order of safety:
  1. `supabase.auth.getClaims()` — verifies the JWT locally against the project's JWKS
     once cached (`@supabase/supabase-js` 2.112.2 exposes it, checked in
     `node_modules/@supabase/auth-js/.../GoTrueClient.d.ts:2538`). A cached verification
     is not a *stale* verification: an expired token fails the claim check. **This is the
     only proposal here that touches the security boundary, so it is the one that needs
     its own test** — an expired token and a tampered token both refused.
  2. Or keep `getUser()` and drop the *proxy's* call on requests that will render a
     signed-in layout anyway — a redirect would then be a redirect from the layout
     instead, which is what the layout already does.
* **`settleDay` is not necessary on every request.** `dailyBurn()` (measured 0.6 ms) is
  cheap *because* it does the work; the parse of its own header says the line behind
  today is the reason to call it. The session can decide from the embedded
  `charged_through` whether a settlement is even possible before spending the trip —
  *"behind today and holding money"* is exactly the filter that was removed when a
  repeated refusal used to throw (fixed in `20260811000082`). Restoring the *filter*
  without restoring the *throw* is a one-line change with a measurable effect: **every
  page load in a paid-up centre stops paying for a write-lock RPC.**

### 4.3 Confirmed in mechanism — the popularity of `loading.tsx`

`(app)/loading.tsx` is the best design decision in the shell (it is what makes the offline
retry and the tab feedback work) and it is also **the switch that turns prefetching on for
every dynamic route**. Two levers, both sanctioned by this Next version's docs:

* `staleTimes.dynamic` is **0 by default**, so a prefetched shell is refetched *again* on
  the actual click: the work is paid twice. The docs (and this version's
  `staleTimes.md`) allow a client-cache TTL; **a small non-zero `dynamic` (e.g. 30 s) is
  the standard fix, but its risk is stale data after a write**, and this app writes from
  Server Actions all day. Not recommended without a per-action `revalidatePath` sweep
  (the actions already call `revalidatePath` in several places; that is the check to run
  before turning it on).
* **`prefetch={false}` on the destinations that are not daily work** (Settings, HQ,
  payroll, the sheet's rows below the fold) is *zero-risk*: it changes nothing except that
  the shell is fetched on hover/click instead of on sight. **This is the cheapest
  request-reduction available** and it is a prop, not a config.

**Not measured and therefore not ranked above the two above:** how much of the observed
`.rsc` traffic is prefetch vs. navigation. The user's own DevTools will say — §7.

### 4.4 Experiments that were tried and did **not** help — read before proposing indexes

Negative results are evidence, so they are recorded here.

| Experiment | Result | Conclusion |
|---|---|---|
| `fee_payments (invoice_id) include (amount_bdt, coaching_center_id)` | outer query unchanged (219 → 214 ms) | The fee board was already fine once statistics were right; the payments aggregate is a cheap seq scan at this size |
| `fee_invoices (coaching_center_id, period_month) where voided_at is null` | no plan change | The existing `(coaching_center_id, due_date)` partial index is the one the planner wants |
| `attendance_records (enrollment_id) include (session_id, status)` | `student_risk` unchanged (1 050 → 1 073 ms) | **The bottleneck is not the record lookup.** The planner seq-scans `attendance_records` and joins `enrollments` by `id`; the rows-for-one-centre predicate cannot be pushed down before that join |
| `enrollments (coaching_center_id, student_id)` | no plan change | Same reason |
| Rewriting the fee board's payments subquery as a correlated `sum()` | 219 → 230 ms | No gain; the existing shape is already the right one |
| Forcing the aggregate with `WITH paid AS MATERIALIZED` | **219 → 3 400 ms** | Actively harmful — the planner's own choice is better |

So the next lever for the three attendance views is **not an index**: it is either
materialisation (§5 fix #5, with §6 risk 2 as the gate) or a rewrite of the view's
funnel so the date window is applied before the `enrollments` join — and that rewrite
must be measured **on the production database**, whose row counts, statistics and
`work_mem` are different from this fixture's. Proposing either without that measurement
would be exactly the guess this audit exists to avoid.

### 4.5 Confirmed as *not* a problem (so nobody "fixes" it)

* **Parallelism inside a page.** Every page in `(app)` uses one `Promise.all`; nothing is
  awaited in series that could run together. The two sweeps that *look* serial
  (`getSession` then the page) are the same single round trip being *counted* once.
* **N+1 in the fee board.** Checked; the view does one aggregate.
* **Missing indexes on the expiry path.** `fee_invoices` has
  `(coaching_center_id, due_date) where voided_at is null` (initial migration), and the
  plan uses it. The measured 220 ms on 3 600 invoices is a network/TTFB problem, not a
  Postgres one.
* **The 13-second fee board** — statistics artefact, §2.2.
* **RLS policies on the hot tables** call `app.is_staff_admin`, `app.branch_ok`,
  `app.member_allows` per row. On the measured fixture they are not the slow part (the
  plan's own sub-equeries are `never executed` for an owner), **but the funnel is real and
  is the first thing to check on the production database** — `EXPLAIN` there, not here.

---

## 5. Recommended fixes, by impact per unit of risk

Each row names the file, the estimated effect and the risk. None is implemented yet.

| # | Change | Where | Est. effect | Risk |
|---|---|---|---|---|
| **0** ✅ | **Do not verify the session twice on a prefetch.** Next sends `next-router-prefetch` (verified in this install: `node_modules/next/dist/esm/client/components/app-router-headers.js`), and the proxy can skip its `getUser()` for those requests — the layout's own `getSession()` still refuses an invalid session, and the *navigation* is still checked by the proxy. Prefetching is a hint; it is not the place to pay for a redirect decision. | `src/proxy.ts` (`proxy()`), before `createServerClient` | −1 auth round trip on every prefetched shell (~14 per screen today, ~4 after #1) | **Security-adjacent but not a boundary**: the layout and RLS both still refuse. Must be proven with a signed-out prefetch test |
| **1** ✅ | **Stop prefetching the non-daily destinations.** Shipped as a positive list rather than a set of exclusions: `DAILY = { /dashboard, /teach, /exams, /fees }` in `app-nav.tsx`, and `SideRow` prefetches only a member of it (and never a locked row). The mention of `TabBar` was wrong — a bar holds the reader's own daily screens by construction, so it keeps Next's default and a student's single tab keeps its prefetch. `/account` and both `/settings/billing` links are `prefetch={false}`. | `src/components/app-nav.tsx` (`DAILY`, `SideRow`), `app-shell.tsx` (account link + 2 `LinkButton`s) | ~14 prefetched shells → 4; −10 backend invocations per screen | **None to correctness** — prefetch is a hint only. Those screens are still hover-prefetched on a desktop and fetched on tap |
| **2** ⚠ | **Skip `settle_billing` when it cannot charge** — *the trade §5.1 spells out is larger than this row claims; do not implement as written.* Call it only when `charged_through < today` **and** `balance_poisha > 0`, exactly as `dailyBurn`'s own header describes; keep the local `billingStanding` fallback for the rate. | `src/lib/auth/session.ts` (the `if (active && org && dailyBurn(org))` branch, line 464) | −1 round trip (~0.3 s) on **every** page load of a paid-up centre, and removes a write-lock RPC from the read path | **Behavioural**: the `daily_rate_poisha` on a request with nothing due becomes null, and `billingStanding` then treats a lapsed-but-unknown rate as read-only — which is the *narrow* direction and must be re-checked against the banner copy. A test must pin both outcomes |
| **3** | **One `getUser`, not two.** Use `getClaims()` in `getSession` (or drop the proxy's `getUser` on routes the layout guards anyway). | `src/proxy.ts:146`, `src/lib/auth/session.ts:294` | −1 round trip (~0.3 s) per render **and** per prefetched shell | **Security boundary** — must be proven with an expired-JWT and a tampered-JWT test, and the RLS suite still passed unchanged. Prototype behind a unit test before touching the live path |
| **4** ❌ | **Trim the dashboard's paged reads.** — **REFUTED on re-reading the code; do not implement.** `progressToTell` does not count rows, it *decides* them: `progressDecision` reads `sessions_counted`, `guardian_phone` and `last_sent_at` per row and counts only the families whose status is `send`. A `count: 'exact'` would promise every student on the roll and deliver a handful. `fee_reminders` is the same shape — `countChasesDue` needs each invoice's latest reminder stage, not a tally. Both paged reads are load-bearing. | `src/app/(app)/dashboard/page.tsx` rows 6, 9 | none | — (see §5.1) |
| **5** | **Kill the quadratic fee arm in `student_risk` first** (1 494 000 join-filter rows at 250 × 6 000, §2.2b): rewrite the `fees` CTE as one grouped aggregate over overdue invoices (`due_date < today` uses the existing partial index) joined to students by `(centre, student)`, or as a per-student `LATERAL`. Only after that, and only if the attendance scan still dominates, consider materialising the three views. Indexes are **not** the lever (§4.4). | `20260811000014` (+ `00011`, `00021` only if materialising) | 0.8 s of the 2.2 s measured `student_risk`, once per dashboard and again on `/at-risk`; the remaining ~1.2 s is the attendance scan | **Schema change**; materialisation is the riskiest (§6.2) |
| **6** | **`staleTimes.dynamic = 30`** — *after* #1, *after* checking every Server Action calls `revalidatePath`, and measured against a write-then-navigate test. | `next.config.ts` (`experimental`) | Prefetched shells stop being refetched on click: up to −0.4 s per in-app navigation | **Stale data after a write** — the one risk that matters in a fee ledger |
| **7** ✅ | **Perceived speed, independent of #1–#6.** The 17-query dashboard can stream: `<Suspense>` around the risk card, the rates card and the profit card, so the four money figures paint on the first byte and the slower three arrive after. `loading.tsx` already exists; this is the next step and needs no config. | `dashboard/page.tsx` + 3 small server components | First meaningful paint on a cold load, no request removed | Low; `forbidden()`/`notFound()` status behaviour is unchanged (already 200 + stream, per `loading.tsx`'s note) |

**Order I would implement them: 1 → 0 → 2 → 4 → 7 (all cheap, all reversible) → measure
again → 3 → 5 → 6 (each needs its own proof).**

### 5.1 What shipped, and what the later rows turned out to be

**#1 and #0 are in the tree** (`src/components/app-nav.tsx`'s `DAILY` set,
`src/components/app-shell.tsx`'s three shell links — the account circle and both top-ups —
and `src/proxy.ts`'s prefetch branch):
fourteen prefetched shells per screen become four, and each of those four no longer pays
the proxy's auth round trip. Both are guarded by tests rather than by a comment —
`tests/navigation.test.ts` pins the prefetched set to the table's own first four (so a row
added to the top of the menu cannot silently join it), and `tests/proxy.test.ts` pins the
branch's position and the header name **against the installed Next**, because a rename
upstream would switch the saving off with no error anywhere.

What this does **not** claim: no measurement of the wall-clock saving was made here (this
workspace has no browser, and the numbers in §2.3 are from a sandbox). The saving is
structural — ten fewer function invocations and four fewer auth round trips per screen —
and the check is the same one §7 asks for: Network → filter `_rsc` before and after.

**#4 is refuted, not deferred** (see the row above). The audit's own §2.1 note — that the
fixture cannot substitute for the code — is the lesson: a paged read looks like a padded
read from a query log and is a filter from the source.

**#2 is not the free win §5 implies, and needs a decision before it is written.** The
condition is right (a current line cannot be charged), but `settle_billing` does three
things on that path, not one:

1. It **tops up a day already charged** when the roster grew (§11.7 step 4, the
   `top_up` branch). Skip the call on a paid-up centre and a centre that admits forty
   students at noon is never charged for them — an under-charge, so §6 risk 3 applies.
2. It **returns the day's rate**, and it is the only thing that does. `billingStanding`
   divides the balance by that rate to get `daysLeft`, so without the call the money
   strip loses its day count and its amber warning on exactly the marginal centre that
   needs them (§3.7's first rung), and the banner loses its two figures.
3. It settles before every write, which is §16.1 step 24 and is *kept* by the proposal —
   but only because the proposal still calls it whenever a day is owed.

So #2 buys ~0.3 s per paid-up page load and costs the same-day top-up, the day count and
the low-balance warning. Any version worth shipping needs one of: a stored `daily_rate`
read with the centre row (a migration, with staleness of its own), or an
`after(() => settleDay(...))` on the three write paths that change the centre's size
(admissions, teachers, branches), with the strip accepting a rate-less render in between.
Neither is a one-line change, and both are product decisions rather than performance ones.

**#7 shipped for the three reads that were actually expensive.** `rates-block.tsx`,
`risk-block.tsx` and `progress-block.tsx` own the `batch_attendance_monthly`, `student_risk`
and `student_progress_week` reads that used to sit in the page's single `Promise.all`, and
each is behind its own `<Suspense>` with a `LoadingCard` placeholder. The page now returns
its first byte after its own ~150 ms of queries instead of after the slowest aggregate
(~2.2 s on a 250-student centre), and the slow cards stream into the space they already
occupied. The progress door had to move too, and for the same reason as the other two: at
~0.75 s it was the slowest thing left in the page's own `Promise.all`, and a route flushes
when its last blocking await returns.

Three details are load-bearing rather than cosmetic, and each has a test:

* the wrappers carry `[&:empty]:hidden`, because both blocks render null for the ordinary
  empty case (no registers taken, nobody drifting) and an empty box still contributes the
  column's `gap-5` — twenty pixels of nothing where a card should not be;
* `student_risk` is now gated on `isAdmin`, the same role the view enforces in SQL, because
  the read is its own request instead of one already in flight for a teacher;
* none of the three `.from()` calls is allowed back into `page.tsx` —
  `tests/dashboard.test.ts` asserts each lives in its block, since a regression here renders
  perfectly and is only slow.

The profit card was **not** moved. Its five reads are the cheap end of the page
(`fee_charges_month` 440 ms, `center_profit_month` 155 ms) and the rail it sits in is beside
the main column, so the remaining ~0.4 s of first-byte latency is worth less than the churn
of a fourth block that also has to draw the read-failure card. It is the next candidate if a
measurement says otherwise.

---

## 6. Risk register for anything that *reduces* latency here

1. **Caching tenant data is forbidden, full stop.** `public/sw.js` says why in its own
   header: a URL-keyed cache knows nothing about who was signed in. Any proposal that
   adds an HTTP cache, an ISR revalidate, or a shared (`use cache`) key that does not
   include the user and centre is rejected before it is measured. **The optimisations
   above are not caches** — #1 removes work, #2 and #3 remove round trips, #4 removes rows,
   #7 changes paint order.
2. **A materialised `student_risk` is a cross-tenant view unless it is per-centre.** If
   #5 goes the materialisation route, the stored relation must be either *not* a view
   (a function taking the centre, `security invoker`) or keyed so RLS applies to the
   query, never a single global snapshot served to everyone. The RLS suite (1 559
   assertions today) is the gate; a new assertion must prove two centres cannot see each
   other's rows through it.
3. **`settle_billing` is money.** #2 changes *when* the day is charged, not whether it
   is; the guarantee in §16.1 step 24 ("charged from the size at the moment work starts")
   survives only if the "behind today" branch still settles before any write can land.
   Any version of #2 that skips a chargeable day is a wrong charge and is out.
4. **A statistics guard, not an index, for the 13-second fee board.** If the production
   database ever reports the plan with `Rows Removed by Join Filter` in the millions, the
   fix is `ANALYZE`, and the permanent guard is the one already built: the pre-commit
   hook's test suite does not cover planner stats, so the check belongs in the deploy
   runbook rather than the code.
5. **`prefetch={false}` must not be applied to `/fees` or `/teach`.** Those are the two
   screens a centre opens every day, and the prefetch is what makes them feel instant.
   The list in fix #1 is exactly the screens a reader opens once a week.

---

## 7. What to read in the user's own DevTools (fills the gaps above)

To confirm or refute §3.1 and §4.2 without guessing:

1. **Network → filter `_rsc`.** Every entry whose `Initiator` is a `_next/static` chunk is
   a prefetch; entries initiated by the page itself are navigations. The screenshot shows
   ~17 of the former.
2. **Network → the document row → Timing.** `TTFB` is the function + Supabase. If TTFB is
   > 1 s and the page's own Supabase calls total < 300 ms inside Vercel's logs, the gate
   (§4.2) is the cost, not the queries.
3. **Vercel → Observability → Functions → `/`.** *Duration* per invocation. Compare with
   the 4.06 s page load: the difference is network + client.
4. **Supabase → Reports → Query Performance.** The top statements by `total_time`. If
   `student_risk`, `student_progress_week` or `batch_attendance_monthly` are not in the
   top five, §4.1 is costing less than the fixture suggests and #4 and #7 lead.
5. **Supabase → Reports → API.** `p95` latency for PostgREST and Auth separately. §2.3's
   ~300 ms is *from this sandbox*; the customer's p95 is the number that matters.

---

## 8. Reproducing the measurements

The measurement scripts were throw-away and are **not committed** — this audit changes
no code, so the diff is this document only. Redoing it is three steps:

1. Boot the real schema with `bootDatabase()` from `scripts/lib/pg-harness.mjs`
   (all 98 migrations, RLS included) and seed one centre with `generate_series`:
   150–250 students, 4 enrolments each, 6 months of invoices, 30 days of registers.
2. `analyze` **before** believing anything; then run each query through `asUser(db, owner,
   …)` so RLS executes, wrapped in `EXPLAIN (ANALYZE, BUFFERS)`.
3. For the network number, `GET <project>/rest/v1/students?select=id&limit=1` seven times
   with the anon key from the environment and take the median.

§2.2's two columns are the before/after of the one mistake that made this audit look
alarming for an hour: a freshly seeded table has no statistics, and a bad plan turned a
219 ms query into 12.8 s.

---

## 9. One-line summary for the next reader

**Nothing here is a rewrite.** The app already parallelises inside every page; what it
does not do is *stop doing work nobody asked for* (fourteen prefetched shells, a settle on
every read, a second JWT verification, a thousand rows to draw three) — and that is where
the first half-second to a second and a half of the 4.06 s is, followed by three SQL
aggregates that scan the whole centre to answer a question about 30 days, one of which
compares every student to every invoice.
