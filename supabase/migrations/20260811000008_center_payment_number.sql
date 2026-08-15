-- CoachDesk BD — where the money should go.
--
-- The fee reminder shipped in 20260811000007 tells a parent what they owe and
-- then stops. To act on it they have to find the centre's bKash number, which
-- lives in a WhatsApp message from two months ago or on a signboard, and if they
-- ask, the owner answers the same question by hand for the fortieth time. A
-- reminder that names the number closes the loop inside one message.
--
-- Two columns, and they are deliberately not one. A number with no wallet does
-- not tell a parent which app to open, and the three apps are not
-- interchangeable — sending to a Nagad number from bKash fails. A wallet with no
-- number tells them nothing at all. So the pair is enforced below.

-- ---------------------------------------------------------------------------
-- 1. The wallet.
--
-- Its own type rather than reusing `payment_method`. They read as the same
-- vocabulary and are not: `fee_payments.method` answers "how did this taka
-- arrive" and must include cash, a bank transfer, and 'other', because an owner
-- is handed notes across a desk all day. This column answers "which app should a
-- parent open", where cash is not an answer and 'other' is a number nobody can
-- send to. Making it an enum means the database refuses the nonsense rather than
-- trusting a check constraint to keep listing it.
-- ---------------------------------------------------------------------------

create type payout_wallet as enum ('bkash', 'nagad', 'rocket');

alter table coaching_centers
  add column payment_wallet payout_wallet,
  add column payment_number text;

-- ---------------------------------------------------------------------------
-- 2. Constraints — this number is retyped by a stranger to move money.
--
-- Every other phone column in the schema is somewhere we send to, so a bad value
-- there means one undelivered message. This one is copied out of an SMS into a
-- Send Money screen by a parent who has no way to tell a typo from the truth.
-- Money sent to a wrong-but-valid number is gone, and the centre gets blamed for
-- losing a fee that was paid. So the format is checked in the database and not
-- only in the action that writes it.
--
-- E.164, matching every other phone column and what normalizeBdMobile produces.
-- [3-9] is the live BTRC operator range: 010 and 012 were never allocated and
-- 011 died with Citycell in 2016.
--
-- Eleven digits on purpose, for Rocket too. A Rocket *account* number is the
-- mobile plus a trailing check digit, but that twelve-digit form is for agents
-- and ATMs — the number a parent types into Send Money is the plain mobile, and
-- this column exists to be typed into Send Money.
-- ---------------------------------------------------------------------------

alter table coaching_centers
  add constraint coaching_centers_payment_number_format
    check (payment_number is null or payment_number ~ '^\+8801[3-9][0-9]{8}$'),
  add constraint coaching_centers_payment_pair
    check ((payment_wallet is null) = (payment_number is null));

-- ---------------------------------------------------------------------------
-- 3. The grant.
--
-- 20260811000004 revoked table-level UPDATE on this table and re-granted five
-- named columns, so a new column is unwritable until it is named here — which is
-- the failure mode that migration wanted: a save that fails loudly rather than a
-- billing column that quietly became editable.
--
-- Column grants accumulate, so this adds to that whitelist rather than replacing
-- it. Both columns stay owner-only through the existing `centers_owner_update`
-- policy, and that is load-bearing now in a way it was not when the whitelist
-- held a name and an address: a teacher who could edit this column would point
-- every fee reminder the centre sends at their own wallet.
-- ---------------------------------------------------------------------------

grant update (payment_wallet, payment_number)
  on public.coaching_centers
  to authenticated;
