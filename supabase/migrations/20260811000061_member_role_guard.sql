-- ---------------------------------------------------------------------------
-- A manager could make themselves the owner. Section 12.
--
-- `members_admin_write`, written in 20260811000002, was:
--
--   for all to authenticated
--   using (app.is_staff_admin(coaching_center_id))
--   with check (app.is_staff_admin(coaching_center_id))
--
-- and `app.is_staff_admin` is `has_role(center, array['owner','manager'])`. The
-- row that decides what a session may do was therefore writable by any session
-- that already held staff admin, with no rule about the `role` column on either
-- side of the write. Six statements, all of which worked from an ordinary signed-in
-- manager's session against real policies:
--
--   update center_members set role = 'owner' where user_id = <self>
--   insert into center_members (..., role) values (..., 'owner')   -- for self
--   update center_members set role = 'owner' where user_id = <a teacher>
--   update center_members set role = 'manager' where user_id = <the owner>
--   delete from center_members where user_id = <the owner> and role = 'owner'
--   insert into center_members (..., role) values (..., 'manager') -- a colleague
--
-- The first is the whole hole in one line: a manager who is told they may edit the
-- roster is also being told they may stop being a manager. Everything the owner
-- alone is supposed to decide — the plan, the money, who else administers the
-- centre — follows from a role check, so a session that can write its own role
-- has every one of those and no screen would show it happening.
--
-- THE RULE: an admin role is the owner's to give. A row carrying `owner` or
-- `manager` may only be written by an owner of that centre; a manager keeps
-- untouched write over the teacher, guardian and student memberships, which is
-- the roster work the permission was granted for.
--
-- Written as two permissive policies rather than one condition because permissive
-- policies OR, and the two rules are about different people: the first is what a
-- manager may do, the second is that an owner is not narrowed by it. An owner also
-- satisfies the first for a teacher row, which is duplication and not a conflict.
--
-- SELF-PROMOTION NEEDS NO CLAUSE OF ITS OWN, and it is worth saying why, because a
-- `user_id <> auth.uid()` looks like the obvious guard. A manager's own membership
-- row *is* a manager row, so the USING clause below already hides it from them —
-- they cannot reach the row to change it, whatever they would change it to. A
-- separate self clause would restate that for managers and wrongly forbid it for
-- owners, who are allowed to hand their own centre to a co-owner.
--
-- WHAT DOES NOT CHANGE. `app.claim_new_center()` writes the founding owner row and
-- is SECURITY DEFINER, so signup is untouched. `bootstrap_center` likewise. The
-- founder panel reaches this table through service_role, which bypasses RLS. And
-- every write in src/ is `role: 'teacher'` — 20260811000053's branch scope still
-- applies on top of all of it, restrictive as before.
-- ---------------------------------------------------------------------------

drop policy members_admin_write on center_members;

create policy members_staff_write on center_members
  for all to authenticated
  using (
    app.is_staff_admin(coaching_center_id)
    and center_members.role not in ('owner', 'manager')
  )
  with check (
    app.is_staff_admin(coaching_center_id)
    and center_members.role not in ('owner', 'manager')
  );

create policy members_owner_write on center_members
  for all to authenticated
  using (app.is_owner(coaching_center_id))
  with check (app.is_owner(coaching_center_id));

comment on policy members_staff_write on center_members is
  'A manager runs the roster: teacher, guardian and student memberships. The role '
  'column is excluded from both sides, so an admin membership is neither reachable '
  'nor creatable here - including the manager''s own row, which is what stops '
  'self-promotion without a clause about self.';

comment on policy members_owner_write on center_members is
  'An admin role is the owner''s to give. Appointing a manager, promoting a '
  'co-owner and removing either are owner-only, and this is the policy the '
  'section 6.2 screen writes through.';
