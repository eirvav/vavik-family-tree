-- supabase/migrations/20260726224453_grant_phase1_table_privileges.sql
--
-- Corrective migration: Tasks 4-6 (create_profiles,
-- create_guest_sessions_and_settings, create_guest_session_rpc) created
-- profiles, guest_sessions, and app_settings with RLS policies but never
-- granted the underlying table-level privileges to anon/authenticated.
-- Postgres checks GRANTs before RLS policies, so without this every
-- client-side request against these tables was rejected with
-- "permission denied" regardless of how permissive the RLS policies were.
--
-- Grants are intentionally minimal, matching only what each table's RLS
-- policies actually allow:
--   - profiles: select/insert/update (no delete - matches "hard deletion
--     unavailable", no delete RLS policy exists either). Row-level
--     narrowing is handled by profiles_select_own_or_admin,
--     profiles_update_own_or_admin, profiles_admin_insert (Task 4).
--   - guest_sessions: select only. The sole RLS policy is
--     guest_sessions_admin_select (Task 5); all writes go through the
--     SECURITY DEFINER create_guest_session() function (Task 6), which
--     runs as its owner and does not need row-level grants on the table.
--   - app_settings: select/update only. The one RLS policy,
--     app_settings_admin_all (Task 5), covers select/insert/update/delete,
--     but the table is a singleton row created once by that migration and
--     never inserted/deleted by the app, so insert/delete grants are
--     deliberately omitted to keep the privilege surface minimal.
--
-- anon gets nothing beyond schema usage: anonymous guest access always
-- goes through an authenticated anonymous Postgres session (is_anonymous
-- claim on an authenticated-role JWT), per the design spec.

grant usage on schema public to anon, authenticated;

grant select, insert, update on profiles to authenticated;
grant select on guest_sessions to authenticated;
grant select, update on app_settings to authenticated;
