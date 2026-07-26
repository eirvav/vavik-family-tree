-- The service-role client reads app_settings.guest_code_hash directly
-- (app/gjest/actions.ts) to verify the family code before any RLS-gated
-- identity exists. service_role bypasses RLS but still needs the
-- underlying table privilege, which Task 8's grants migration only
-- covered for `authenticated` — this closes the same gap for service_role.
grant select on app_settings to service_role;
