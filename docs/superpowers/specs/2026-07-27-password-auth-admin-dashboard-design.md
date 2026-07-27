# Password auth and admin member dashboard — design

Status: approved
Supersedes: the login-method portion of `docs/superpowers/specs/2026-07-27-foundation-secure-access-design.md` (magic link → password). Everything else in that doc (RLS model, guest flow, roles, database structure) is unchanged and still in effect.

## 1. Why

During production testing of the magic-link flow, Supabase's default email sender hit its rate limit (`429: email rate limit exceeded`) from repeated sign-in attempts in a short window. Rather than immediately configuring custom SMTP (Resend), the product owner chose to remove per-login email dependency entirely: switch to email+password login, with the admin creating every account directly (no public self-registration, matching the project's existing "no public signup" principle). This also pulls forward a small piece of the spec's Phase 6 (administration) — a minimal member-management dashboard — since it's now needed to create accounts at all.

## 2. Scope

**In scope**

- Replace magic-link sign-in with email+password sign-in (`supabase.auth.signInWithPassword`)
- `profiles` schema change: add `email`, `first_name`, `last_name`; drop `display_name`
- Admin-only `/admin/medlemmer` page: create a new member (email, first name, last name, password, role) and list existing members with their roles
- Bootstrap trigger updated to populate the new columns instead of `display_name`
- Set a password on the existing bootstrap admin account (created earlier via magic link, has no password yet)
- Remove `/auth/callback` entirely — password auth doesn't need a code-exchange redirect

**Out of scope (not requested, not needed for this change)**

- Public self-registration of any kind
- Self-service password reset/change (admin can rotate a member's password later via the same admin API if ever needed, but no UI for it now)
- Editing or disabling existing members from the dashboard (create + list only, per product owner's explicit scope choice)
- Any changes to guest access, RLS policies, or the database structure beyond the `profiles` column changes above

## 3. Database changes

Migration alters `profiles`:

```sql
alter table profiles
  add column email text,
  add column first_name text,
  add column last_name text;

update profiles set email = 'eirik.vavik@hotmail.no', first_name = 'Eirik', last_name = 'Vavik' where user_id = (select id from auth.users where email = 'eirik.vavik@hotmail.no');

alter table profiles
  alter column email set not null,
  alter column first_name set not null,
  alter column last_name set not null,
  add constraint profiles_email_unique unique (email);

alter table profiles drop column display_name;
```

`handle_new_user()` (the bootstrap trigger) is updated to insert `email`, `first_name = 'Eirik'`, `last_name = 'Vavik'` instead of `display_name`. No other RLS policy or function references `display_name`, so nothing else changes.

## 4. Authentication

### Sign-in

`app/logg-inn/page.tsx` becomes an email+password form. Its server action calls `supabase.auth.signInWithPassword({ email, password })` using the regular session-scoped client. On success, it checks the `profiles` table for a matching row (same "no profile → reject" rule as before) and redirects to `/tre`; on missing profile, signs out and redirects to `/ikke-tilgang`; on wrong credentials, redirects back with a Norwegian error ("Feil e-post eller passord."). This all happens synchronously in one server action — no redirect-based code exchange, so `/auth/callback` is deleted.

### Bootstrap admin password

The existing bootstrap admin account (`eirik.vavik@hotmail.no`, created earlier via magic-link testing) has no password yet, since it never went through a password-based signup. A one-time script sets an initial password via `auth.admin.updateUserById(userId, { password })` using the service-role client. The password is generated randomly and communicated once, directly, outside of any form — this is an administrative account operation (equivalent to a sysadmin resetting a user's credential), not the assistant authenticating on the user's behalf.

## 5. Admin member dashboard (`/admin/medlemmer`)

Admin-only page (redirects non-admins to `/tre`, matching the existing pattern used elsewhere).

**List**: reads `profiles` via the regular session-scoped client — the existing `profiles_select_own_or_admin` RLS policy already permits an admin to see all rows, so no service-role client is needed for this part.

**Create**: a form (email, first name, last name, password, role) whose server action:
1. Explicitly checks the caller is an admin (query the caller's own `profiles.role` via the session-scoped client) **before** doing anything else. This check is required here — unlike the existing "sett familiekode" action, which safely relies on RLS alone because it uses the session-scoped client end to end, this action must call `createServiceClient()` to reach `auth.admin.createUser()` (an operation only available through the service-role/admin API, with no RLS equivalent), and the service-role client bypasses RLS entirely. Skipping this check would let any authenticated or guest caller create arbitrary accounts.
2. Calls `auth.admin.createUser({ email, password, email_confirm: true })` via the service-role client.
3. Inserts the corresponding `profiles` row (email, first_name, last_name, role) via the same service-role client, in the same action, so both operations succeed or fail together from the caller's perspective (no partial state where an auth user exists with no profile).

## 6. Acceptance criteria for this change

- The bootstrap admin can sign in with email + password and reach `/tre`.
- A member account created via the admin dashboard can sign in with the email/password the admin set.
- A non-admin (member or guest) cannot reach `/admin/medlemmer`, and calling its create action directly (bypassing the UI) is rejected by the explicit admin check, not just by RLS.
- No email is sent as part of ordinary sign-in; only account creation is admin-driven.
- Guest access (phrase entry, RLS, session lifetime) is completely unaffected by this change.
