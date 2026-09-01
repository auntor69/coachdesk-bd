-- ---------------------------------------------------------------------------
-- A centre may not be left with nobody able to administer it.
--
-- 20260811000002 states the invariant in a comment above `app.claim_new_center`:
-- "Whoever creates a center becomes its owner in the same transaction, so a center
-- can never exist with nobody able to administer it." Nothing enforced the second
-- half of that sentence. The trigger existed to establish the first owner; nothing
-- stopped the last one going away.
--
-- IT MATTERS NOW BECAUSE OF 20260811000061. That migration made an admin membership
-- owner-only, which is right, and in doing so it made the owner the only person who
-- can remove an owner. So the way a centre loses its administration is no longer a
-- manager's escalation, it is one owner's honest mistake — demoting themselves while
-- tidying up the roster, or deactivating the wrong row on the screen §6.2 is about to
-- add. There is no way back from inside the product: with no owner, `app.is_owner` is
-- false for everybody, so the plan cannot be changed, a manager cannot be appointed,
-- and the audit log cannot be read. It is a support ticket that requires our
-- service_role key, which is the definition of a state a customer must not be able to
-- reach by clicking.
--
-- ACTIVE, not merely present. Every role helper in 20260811000002 counts `m.active`,
-- so an owner switched off is an owner who cannot administer anything — the guard
-- below counts the same rows the policies do, or it would defend a state that is
-- locked out anyway.
--
-- AFTER, not BEFORE, so the question is asked of the table rather than of the row: a
-- statement that demotes two owners at once passes on its first row and is refused on
-- its second, and a BEFORE trigger reasoning about `new` would have to model that
-- itself. The return value of an AFTER trigger is discarded, hence `return null`.
--
-- AND NOT DURING A CASCADE. `center_members.coaching_center_id` is
-- `on delete cascade`, so deleting a centre deletes its owner, and a guard that
-- raised there would make a centre undeletable — including the scratch centre
-- scripts/walk-fixture.mjs removes. By the time the cascade reaches this table the
-- parent row is gone from the transaction's own snapshot, so its absence is the
-- signal, and it is asserted in the RLS suite rather than assumed.
-- ---------------------------------------------------------------------------

create or replace function app.keep_last_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Nothing to protect unless this row was one of the owners doing the administering.
  if old.role <> 'owner' or not old.active then
    return null;
  end if;

  if not exists (select 1 from public.coaching_centers c where c.id = old.coaching_center_id) then
    return null;
  end if;

  if not exists (
    select 1
    from public.center_members m
    where m.coaching_center_id = old.coaching_center_id
      and m.role = 'owner'
      and m.active
  ) then
    raise exception
      'a coaching centre must keep at least one active owner'
      using errcode = '23514',
            hint = 'Appoint the other owner first, then step down.';
  end if;

  return null;
end;
$$;

create trigger center_members_keep_last_owner
  after update or delete on center_members
  for each row execute function app.keep_last_owner();

comment on function app.keep_last_owner() is
  'Refuses the update or delete that would leave a centre with no active owner. '
  'Silent while the centre itself is being deleted, since the cascade has already '
  'removed the parent row by the time it reaches this table.';
