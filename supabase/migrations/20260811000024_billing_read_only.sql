-- ---------------------------------------------------------------------------
-- The three billing tables become read-only from a browser session, in the
-- grants and not only in the policies.
--
-- WHAT WAS ALREADY TRUE. `payments`, `subscriptions` and `sms_credit_ledger` have
-- had exactly one policy each since 20260811000002, and all three are
-- SELECT-only: an owner reads their own receipts, a platform admin reads
-- everyone's, and nothing else matches. Money and what a centre is subscribed to
-- are written by us after money moves, never by the centre.
--
-- WHAT WAS NOT. Supabase's default privileges hand `authenticated` INSERT, UPDATE,
-- DELETE and TRUNCATE on every table in `public` at the moment it is created, and
-- RLS with no matching policy does not refuse those — it *filters* them. An INSERT
-- raises, because the new row satisfies no policy. An UPDATE or a DELETE finds no
-- row it is allowed to touch and reports success having changed nothing.
--
-- Zero rows changed is not a security hole today: no receipt was altered and no
-- ledger line disappeared. It is a hole in what the database *says*, and that is
-- worth closing for two reasons. A client that does not check the affected count
-- cannot tell that no-op apart from a write — which is precisely how a "correct my
-- receipt" screen gets built on a statement that never worked. And the grant sits
-- there waiting: the day anybody adds an UPDATE policy to `payments` for some
-- unrelated reason, every owner in the country can rewrite what they have paid us,
-- and the migration that opened it will not look like it did.
--
-- So: revoke, and let the statement raise 42501. The same fence 20260811000004 put
-- on coaching_centers.plan and 20260811000017 put on fee_payments, applied to the
-- three tables that hold our own revenue.
--
-- TRUNCATE IS IN THE LIST because `grant all` includes it, it fires no row-level
-- trigger and it consults no policy. Nothing in this product can issue one; a role
-- that can is one statement away from erasing every receipt we have ever written.
--
-- SELECT IS NOT IN THE LIST. The owner's own billing history and the founder panel
-- both read these tables through the policies above, and both must keep working.
--
-- service_role keeps everything: it holds its own grants from Supabase's defaults
-- and a REVOKE from `authenticated` does not touch them. That is what
-- src/app/founder/actions.ts writes through, and `requirePlatformAdmin()` on the
-- first line of each of those functions is the only thing standing in front of it —
-- see the note at the top of that file.
-- ---------------------------------------------------------------------------

revoke insert, update, delete, truncate on public.payments
  from authenticated, anon;

revoke insert, update, delete, truncate on public.subscriptions
  from authenticated, anon;

revoke insert, update, delete, truncate on public.sms_credit_ledger
  from authenticated, anon;

comment on table public.payments is
  'Money a coaching centre paid us. Read-only from a browser session: SELECT is '
  'policy-gated to the centre''s own owners and platform admins, and the write '
  'grants are revoked, so a receipt can only be written by service_role — which '
  'today means src/app/founder/actions.ts behind requirePlatformAdmin(). Never '
  'edited and never deleted; a wrong figure is corrected by a negative '
  'counter-entry that keeps both facts.';
