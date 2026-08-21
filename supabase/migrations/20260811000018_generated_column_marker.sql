-- CoachDesk BD — telling the type generator what a trigger does.
--
-- 20260811000017 gave fee_payments a receipt_no that is NOT NULL and assigned by a
-- BEFORE INSERT trigger. To the catalogue those two facts are indistinguishable
-- from "the caller must supply this": there is no DEFAULT, no identity, and
-- pg_trigger can say the table has a trigger but never which column it writes.
--
-- So scripts/gen-types.mjs emitted `receipt_no: number` as a required field on
-- Insert, and every insert in src/app/(app)/fees/actions.ts stopped typechecking —
-- demanding a value the caller is specifically not allowed to choose. Writing one
-- in by hand would be worse than the error: it would take the number out of the
-- lock's hands and hand two parents the same receipt.
--
-- The fix is for the column to say so itself. gen-types.mjs now treats `@generated`
-- anywhere in a column's COMMENT as "the database fills this in", the same as a
-- DEFAULT. The declaration belongs here, next to the trigger that does the
-- assigning, because this is the only place that knows — and in the database rather
-- than in a hand-kept list in the generator that the next migration forgets.
--
-- Its own migration rather than an edit to 17, because scripts/db-push.mjs tracks
-- applied files by name and not by checksum. Editing 17 would silently never
-- re-apply: a fresh database would get the comment, the live one never would, and
-- the two would disagree with nothing anywhere reporting it. An applied migration
-- is history and gets appended to, not rewritten.

comment on column public.fee_payments.receipt_no is
  'Per-centre receipt serial, printed on the slip the guardian keeps. Assigned by '
  'app.assign_receipt_no() under an advisory lock; immutable once issued, and not '
  'writable by a browser session. @generated';
