# CoachDesk BD

The operating system for coaching centers in Bangladesh: admissions and roster with bulk
import, batches, attendance, exams and marks, a fee board with invoices, installments,
scholarships and a four-stage chase list, payroll, expenses, notices, weekly progress
reports, multi-branch HQ, and a full audit log — in Bengali and English, offline-first, on
any phone the staff already owns.

`PROJECT.txt` is the product's own one-page description. `MASTERPLAN.md` is the build log:
which migration and which screen exists for what, and why.

## Stack

- Next.js (App Router) + React, TypeScript, Tailwind CSS
- Supabase — Postgres with row-level security, Auth
- Vercel for hosting and the two cron jobs (`/api/cron/settle`, `/api/cron/sms`)

Two rules run through everything. Money is integer poisha, and no float touches a balance —
not in the app, not in the database. Billing is prepaid: one balance per centre, charged for
each day it is open by a database function, and when the balance cannot cover a day the app
goes read-only — access is derived from money, not a subscription date.

## Running it

1. `npm install`
2. Copy `.env.example` to `.env.local` and fill in the Supabase keys. `db:push` also needs a
   direct Postgres connection string (`SUPABASE_DB_URL`).
3. `npm run db:push` applies `supabase/migrations/*.sql` in filename order and records them
   in Supabase's own migration ledger.
4. `npm run dev`, then open http://localhost:3000.

## Tests

`npm test` is the full gate and needs no network: SQL lint, migration replay, tenant
scoping, server-export shape, the PGlite RLS suite, billing, recharge, legal, the founder
levers, and the unit tests.

Faster subsets while working:

- `npm run test:unit` — the TypeScript unit suites alone
- `npm run test:scoping` — every query against a centre-scoped relation
- `npm run test:rls` — the long one: every table against every role, in PGlite

`npm run test:live` checks RLS and PostgREST embeds against a real Supabase project, and
reads `.env.local` for its connection.
