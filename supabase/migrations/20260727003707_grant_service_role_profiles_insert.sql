-- The admin member-creation action (app/admin/medlemmer/actions.ts) inserts
-- the new member's profiles row via the service-role client, immediately
-- after auth.admin.createUser() — the new user has no session/RLS context
-- yet at that point. service_role bypasses RLS but still needs the
-- underlying table privilege, which was never granted for `profiles`
-- (Task 8 of the prior plan only granted service_role SELECT on
-- app_settings). Without this, member creation silently failed after
-- already creating the auth user, leaving an orphaned account with no
-- profile.
grant select, insert on profiles to service_role;
