-- CoachDesk BD — a one-time code before the account exists (MASTERPLAN section 5.4)
--
-- THE HOLE THIS CLOSES. Today an owner signs up by typing a phone number and a
-- password, and nothing checks that the number is theirs. Because profiles.phone is
-- unique across the platform, registering somebody else's number does not merely
-- impersonate them — it denies that number to its real owner for ever, which is the
-- identifier we recognise returning customers by. It is a squatting attack with a
-- one-line cost to mount.
--
-- WHAT IS HERE. One table and two functions. The table holds a hash of a six-digit
-- code with its expiry, its attempt count and the IP that asked for it; the two
-- functions issue and check one. Nothing else in the schema changes: signup still
-- creates the account through the admin endpoint, and this is the gate in front of it.
--
-- WHERE THE CODE ITSELF LIVES: nowhere. It is generated in Node, hashed there, and
-- only the hash is ever passed to Postgres — so the plaintext is not in this table, not
-- in a parameter of a call that reaches the statement log, and not recoverable by
-- anything holding the database. src/lib/auth/otp.ts is the only file that has seen it,
-- and the only thing it does with it is hand it to the SMS transport.
--
-- WHY THE HASH IS UNSALTED, said plainly rather than left to look like an oversight.
-- It is sha256 over phone, purpose and code with no per-row salt and no server pepper.
-- A six-digit code is 10^6 preimages, so a leaked hash is a solved hash whatever is
-- mixed in; salt buys nothing against an attacker who can read the column, and reading
-- the column needs the service-role key, which already reads profiles and every centre's
-- money. The defence is that the row is unreachable — schema `app` is not in PostgREST's
-- exposed list, the table is revoked from both browser roles, and five attempts burn the
-- code. A pepper in an environment variable would add a way to brick signup on a
-- rotation and nothing else.
--
-- WHY THE TABLE IS IN `app` AND THE FUNCTIONS ARE IN `public`. PostgREST serves
-- `public`, so a table there is one missing revoke away from being a public list of
-- everyone mid-signup and the IP they did it from. `app` is not served at all. The two
-- functions have to be in `public` because that is where the API can find them, and
-- they are revoked from anon and authenticated by name — see the grant block, and
-- 20260811000016's note on why revoking PUBLIC alone is not a closed door here.
--
-- TEACHERS ARE NOT IN THIS FILE AND MUST NOT BE PUT IN IT. Section 5.4 is explicit:
-- their phone is optional, so there may be no number to send to, and the account is
-- being issued by an employer inside a centre that already exists. Teacher account
-- creation must never require a code.
-- ---------------------------------------------------------------------------

create table if not exists app.phone_verifications (
  id uuid primary key default gen_random_uuid(),

  -- Canonical E.164 and checked as such, because the whole point of a per-number
  -- ceiling is that 01712345678, +8801712345678 and ০১৭১২৩৪৫৬৭৮ are one number and
  -- not three ceilings. normalizeBdMobile is what produces this shape; the constraint
  -- is here so a caller that forgets to call it fails rather than opens a third door.
  phone text not null check (phone ~ '^\+8801[3-9][0-9]{8}$'),

  -- 'signup' is the only one today. A column rather than an assumption, so adding
  -- "confirm a number change" later does not share a ceiling with signing up.
  purpose text not null check (purpose in ('signup')),

  code_hash text not null,
  attempts integer not null default 0 check (attempts >= 0),
  expires_at timestamptz not null,

  -- Set the moment the code stops being usable, for any of the four reasons: it was
  -- right, it ran out of attempts, it expired, or a newer code replaced it. One column
  -- rather than a status, because every caller only ever asks "is this still live".
  consumed_at timestamptz,

  -- For the per-IP ceiling and nothing else. Nullable because a request that arrives
  -- without a usable forwarded-for header should still be able to sign up — a missing
  -- header is a proxy's doing, not the visitor's.
  request_ip text,

  created_at timestamptz not null default now()
);

comment on table app.phone_verifications is
  'One-time codes for phone ownership, hashed. Section 5.4. Rows older than an hour '
  'are deleted by issue_phone_code, which is the only thing that writes here.';

-- The cooldown read, the per-number ceiling and the verify read are all this index.
create index if not exists phone_verifications_phone_idx
  on app.phone_verifications (phone, purpose, created_at desc);

-- The per-IP ceiling. Partial, because a row with no IP can never match it.
create index if not exists phone_verifications_ip_idx
  on app.phone_verifications (request_ip, created_at desc)
  where request_ip is not null;

-- The hourly sweep in issue_phone_code.
create index if not exists phone_verifications_created_idx
  on app.phone_verifications (created_at);

-- Belt and braces on a table that is already outside PostgREST's reach. If a future
-- migration grants something here by accident, RLS with no policy is zero rows rather
-- than every row; the two functions below are owned by this migration's role, and a
-- table's owner is not subject to its policies.
alter table app.phone_verifications enable row level security;

revoke all on table app.phone_verifications from anon, authenticated, public;

-- ---------------------------------------------------------------------------
-- 1. Issue a code.
--
-- Four ceilings, in the order that costs least to check: a cooldown between codes to
-- one number, a per-number hourly cap, a per-IP hourly cap, and — the one that is not
-- a ceiling but belongs with them — burning any code still live for this number, so a
-- resend replaces the guessing surface rather than widening it to two codes at once.
--
-- The counts are of codes SENT, consumed or not, because a send is what costs a taka
-- and what rings somebody's phone at midnight. Counting only failures would let a
-- script use a number as a doorbell for as long as it kept typing the codes correctly.
--
-- Returns jsonb rather than raising, because a cooldown is not an error: the caller has
-- to turn 'wait 43 seconds' into a sentence and a disabled button, and an exception
-- would reach the browser as a 500 for a thing the visitor did nothing wrong to hit.
-- ---------------------------------------------------------------------------
create or replace function public.issue_phone_code(
  p_phone text,
  p_purpose text,
  p_code_hash text,
  p_ip text,
  p_ttl_seconds integer,
  p_cooldown_seconds integer,
  p_phone_per_hour integer,
  p_ip_per_hour integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_last timestamptz;
  v_wait integer;
  v_sent integer;
begin
  -- Every ceiling is the caller's to set and src/lib/auth/otp.ts is the one place they
  -- are written down, so there are deliberately no defaults here. A null would not
  -- error, though: `null > 0` is null, which is not true, which is a ceiling silently
  -- switched off. So say so instead.
  if p_ttl_seconds is null or p_cooldown_seconds is null
     or p_phone_per_hour is null or p_ip_per_hour is null then
    raise exception 'issue_phone_code: ttl, cooldown and both hourly caps are required';
  end if;

  -- The only sweep this table gets, and it lives here because this is the only thing
  -- that ever inserts. Nothing older than an hour can affect a window: the longest one
  -- measured below is an hour, and a code lives five minutes. No cron, no pg_cron
  -- grant, and no table that grows for ever if a scheduler is ever switched off.
  delete from app.phone_verifications
   where created_at < now() - interval '1 hour';

  select max(created_at) into v_last
    from app.phone_verifications
   where phone = p_phone
     and purpose = p_purpose;

  if v_last is not null then
    v_wait := ceil(p_cooldown_seconds - extract(epoch from (now() - v_last)))::integer;
    if v_wait > 0 then
      return jsonb_build_object('ok', false, 'reason', 'cooldown', 'wait', v_wait);
    end if;
  end if;

  select count(*) into v_sent
    from app.phone_verifications
   where phone = p_phone
     and purpose = p_purpose
     and created_at > now() - interval '1 hour';

  if v_sent >= p_phone_per_hour then
    return jsonb_build_object('ok', false, 'reason', 'phone_limit');
  end if;

  -- Skipped rather than counted when the header was missing, and the partial index says
  -- the same thing: one visitor behind a proxy that strips it must still be able to sign
  -- up, and every such visitor sharing one bucket would be a shared ceiling instead.
  if p_ip is not null then
    select count(*) into v_sent
      from app.phone_verifications
     where request_ip = p_ip
       and created_at > now() - interval '1 hour';

    if v_sent >= p_ip_per_hour then
      return jsonb_build_object('ok', false, 'reason', 'ip_limit');
    end if;
  end if;

  -- One live code per number and purpose. Two would mean two chances of five guesses
  -- against a six-digit space, and a visitor who taps resend twice would not know which
  -- of the three texts to read.
  update app.phone_verifications
     set consumed_at = now()
   where phone = p_phone
     and purpose = p_purpose
     and consumed_at is null;

  insert into app.phone_verifications
    (phone, purpose, code_hash, expires_at, request_ip)
  values
    (p_phone, p_purpose, p_code_hash,
     now() + make_interval(secs => p_ttl_seconds), p_ip);

  return jsonb_build_object('ok', true, 'expiresIn', p_ttl_seconds);
end;
$$;

comment on function public.issue_phone_code(
  text, text, text, text, integer, integer, integer, integer
) is
  'Stores a hashed one-time code for a phone number, or refuses with a reason. '
  'Section 5.4. Never sees the code itself. service_role only.';

-- ---------------------------------------------------------------------------
-- 2. Check a code.
--
-- The whole function is one locked row, and the lock is the point rather than a
-- precaution. Ten guesses fired in parallel against attempts = 0 would each read zero,
-- each write one, and each be the first attempt — five tries would become as many as
-- the attacker's connection pool allows. `for update` makes them queue.
--
-- Every failure that is not 'wrong' burns the code, and 'wrong' burns it at the cap.
-- The row is never deleted here: issue_phone_code's sweep is what removes it, so an
-- attempt count survives long enough to be counted by the hourly ceiling.
-- ---------------------------------------------------------------------------
create or replace function public.verify_phone_code(
  p_phone text,
  p_purpose text,
  p_code_hash text,
  p_max_attempts integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row app.phone_verifications;
  v_attempts integer;
begin
  if p_max_attempts is null or p_max_attempts < 1 then
    raise exception 'verify_phone_code: the attempt ceiling must be a positive number';
  end if;

  select * into v_row
    from app.phone_verifications
   where phone = p_phone
     and purpose = p_purpose
     and consumed_at is null
   order by created_at desc
   limit 1
     for update;

  -- Nothing live for this number: never asked, already used, already burned, or swept.
  -- One answer for all four on purpose — telling them apart would tell a script which
  -- numbers are mid-signup, and the caller's sentence is 'ask for a new code' either way.
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'none');
  end if;

  if v_row.expires_at <= now() then
    update app.phone_verifications set consumed_at = now() where id = v_row.id;
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;

  -- attempts + 1 in SQL and read back, not v_row.attempts + 1. A guess that queued
  -- behind another one is handed the row as it now stands, and counting from the value
  -- this session happened to read first is how a queue turns back into a free-for-all.
  update app.phone_verifications
     set attempts = attempts + 1
   where id = v_row.id
  returning attempts into v_attempts;

  -- Plain equality over two sha256 hex strings. Timing tells an attacker which byte of
  -- a digest they got right, which is worth having when the input is a password and
  -- worthless when it is one of a million codes that dies after five tries.
  if v_row.code_hash = p_code_hash then
    update app.phone_verifications set consumed_at = now() where id = v_row.id;
    return jsonb_build_object('ok', true);
  end if;

  if v_attempts >= p_max_attempts then
    update app.phone_verifications set consumed_at = now() where id = v_row.id;
    return jsonb_build_object('ok', false, 'reason', 'burned');
  end if;

  return jsonb_build_object(
    'ok', false, 'reason', 'wrong', 'left', p_max_attempts - v_attempts
  );
end;
$$;

comment on function public.verify_phone_code(text, text, text, integer) is
  'Checks a hashed one-time code, counting the attempt under a row lock and burning '
  'the code when it is right, stale or out of tries. Section 5.4. service_role only.';

-- ---------------------------------------------------------------------------
-- 3. Who may call these.
--
-- Nobody with a browser. Supabase hands EXECUTE to anon and authenticated BY NAME when
-- a function is created in public, so `revoke ... from public` alone leaves both doors
-- open — see 20260811000016's note. Named revokes, then one grant.
--
-- Both are SECURITY DEFINER over a table in a schema PostgREST does not serve, so a
-- missing revoke here would be the entire security model: anon could issue codes at
-- whatever ceilings it passed itself, and verify them with p_max_attempts as large as
-- it liked. check-migrations.mjs fails the build on a public function without this
-- block, and check-embeds.mjs proves at runtime that an anonymous call is refused.
-- ---------------------------------------------------------------------------
revoke all on function public.issue_phone_code(
  text, text, text, text, integer, integer, integer, integer
) from anon, authenticated, public;

revoke all on function public.verify_phone_code(text, text, text, integer)
  from anon, authenticated, public;

grant execute on function public.issue_phone_code(
  text, text, text, text, integer, integer, integer, integer
) to service_role;

grant execute on function public.verify_phone_code(text, text, text, integer)
  to service_role;
