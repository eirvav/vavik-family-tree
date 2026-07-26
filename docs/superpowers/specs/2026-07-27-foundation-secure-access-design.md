# Foundation and secure access — design

Status: approved
Source: `docs/family_tree_organiser_design_specification.pdf` (design baseline v1.0), Phases 0 and 1 of its delivery roadmap (section 19).

## 1. Scope

First implementation slice of the Family Tree Organiser. Covers the spec's Phase 0 (repository/Supabase foundation) and Phase 1 (secure access) only.

**In scope**

- Next.js ⇄ Supabase wiring: `@supabase/supabase-js` + `@supabase/ssr` browser/server clients, `proxy.ts` session refresh
- Database: `profiles`, `guest_sessions`, `app_settings` tables, `app_role` enum, RLS helper functions and policies
- Permanent-user auth: email magic link sign-in / sign-out
- Guest auth: shared family phrase → anonymous Supabase identity → gated `guest_sessions` row
- Bootstrap trigger that provisions the first admin profile on first sign-in
- Norwegian-language UI for: sign-in, guest entry, unauthorized/expired states, and a placeholder authenticated landing page
- Database tests proving the RLS policy matrix for this phase's tables

**Explicitly out of scope for this slice** (later phases per the spec's roadmap)

- `people`, `person_names`, `relationships`, `stories`, `canvas_positions`, `audit_events` — Phase 2+
- React Flow tree canvas and any UI beyond a placeholder landing page — Phase 3
- Undo/restore, audit history — Phase 4 (nothing exists yet to audit)
- Invitation flow, admin role-management UI, guest-code rotation UI — Phase 6
- CAPTCHA/rate limiting on guest code entry — explicitly deferred by product owner decision (see §7)
- Local Supabase CLI / Docker dev stack, second Supabase project — explicitly declined by product owner (see §7); migrations are applied directly to the single remote project

## 2. Decisions resolved during brainstorming

These were open "deferred decisions" in the source spec (§22), resolved for this project:

| Decision | Resolution |
|---|---|
| Permanent-user login method | Email magic link |
| Guest session lifetime | 7 days |
| Guest re-entry policy | Persist per-device (cookie) until expiry; no forced re-entry on every visit |
| CAPTCHA / rate limiting on guest code entry | **Skipped** — explicit product owner decision. Deviates from the spec's own risk mitigation for "anonymous-user abuse" (§21). Acceptable at current scale (one family, invite-only awareness of the code); revisit if abuse is observed (see `guest_sessions.issued_at` volume as an early signal). |
| Guest code format | Admin-chosen memorable phrase (not system-generated), stored only as a hash |
| First admin bootstrap | Seed/trigger-based, tied to `eirik.vavik@hotmail.no` |
| UI language | Norwegian only, hardcoded strings (no i18n library — single-language app, YAGNI) |
| App display name | "Vavik Familietre" |
| Email delivery | Custom SMTP via Resend (product owner will create the account/API key) |
| Migration workflow | Applied directly to the single remote Supabase project (`aepiajqwquxwcgvxqmrl`) via versioned migration files; no local Docker/CLI stack for now |
| Deployment target | Existing Vercel deployment at `https://vavik-familie.vercel.app` |

## 3. Database schema

### `app_role` (enum)
`member`, `admin`

### `profiles`
One row per permanent application user.

| Column | Type | Notes |
|---|---|---|
| `user_id` | uuid, PK | references `auth.users(id)` |
| `display_name` | text, not null | |
| `role` | `app_role`, not null, default `member` | |
| `status` | text, not null, default `active` | check in (`active`, `disabled`) |
| `created_at` / `updated_at` | timestamptz | UTC |

### `guest_sessions`
Authorized temporary guest identities. One row per anonymous Supabase user that successfully verified the family code.

| Column | Type | Notes |
|---|---|---|
| `user_id` | uuid, PK | the anonymous `auth.users` id |
| `issued_at` | timestamptz, not null, default now() | |
| `expires_at` | timestamptz, not null | `issued_at` + configured lifetime |
| `revoked_at` | timestamptz, nullable | admin revocation (Phase 6 UI; column exists now) |
| `issued_by` | uuid, nullable | null for self-service code entry |

### `app_settings`
Singleton row (`id = 1`), admin-only.

| Column | Type | Notes |
|---|---|---|
| `id` | smallint, PK, check (`id = 1`) | enforces singleton |
| `guest_code_hash` | text, nullable | null until an admin sets a code |
| `guest_session_lifetime_days` | int, not null, default 7 | |
| `updated_at` / `updated_by` | | |

Not included in this phase's schema (added when their owning phase starts): `people`, `person_names`, `relationships`, `stories`, `canvas_positions`, `audit_events`, `invitations`.

## 4. Authorization model

### Effective role resolution (helper functions, `SECURITY DEFINER` where they need to see `guest_sessions`/`profiles` across rows)

- `app_is_admin()` — true if `auth.uid()` has a `profiles` row with `role = 'admin'` and `status = 'active'`
- `app_is_member_or_admin()` — true if an active `profiles` row exists for `auth.uid()` (either role)
- `app_is_authorized_guest()` — true if `(auth.jwt() ->> 'is_anonymous')::boolean` and a `guest_sessions` row exists for `auth.uid()` with `revoked_at is null and expires_at > now()`
- `app_is_authorized()` — member, admin, or authorized guest

These are the **only** place role/session logic is expressed. Every RLS policy calls one of these functions rather than re-deriving the logic inline — centralizing this directly addresses the spec's own highest-impact risk ("Incorrect RLS exposes private family data").

### RLS policy summary for this phase's tables

| Table | SELECT | INSERT/UPDATE |
|---|---|---|
| `profiles` | own row always; all rows if `app_is_admin()` | own `display_name` only, or any column if `app_is_admin()` |
| `guest_sessions` | `app_is_admin()` only | not directly writable by any client role — only via the `create_guest_session()` function below |
| `app_settings` | `app_is_admin()` only | `app_is_admin()` only |

### Guest code verification (server-only path)

1. Guest submits the phrase via a Server Action.
2. The action reads `app_settings.guest_code_hash` using the service-role client (server-only, never browser-exposed) and compares against the submitted phrase's hash.
3. On match: get-or-create an anonymous Supabase session for the browser (`signInAnonymously()` if no existing anonymous cookie session).
4. The action calls a `SECURITY DEFINER` Postgres function `create_guest_session()` (invoked via the service-role client) that upserts a `guest_sessions` row for that anonymous user id, `expires_at = now() + guest_session_lifetime_days`.
5. RLS on future family-data tables (Phase 2+) will gate on `app_is_authorized()`, so this table alone is what makes an anonymous identity "count."

This matches the spec's required guest gate (§12.3): the browser-visible publishable key can create an anonymous identity on its own, but that identity is inert until the server verifies the code and inserts the `guest_sessions` row — this table's existence, not the client's claim, is what RLS trusts.

### Permanent-member sign-in

1. `/logg-inn`: email → `supabase.auth.signInWithOtp()` (magic link), delivered via Resend SMTP.
2. `/auth/callback` route handler exchanges the code for a session.
3. If the resulting user has no `profiles` row (not the bootstrap admin, no invitation system yet), the callback immediately signs them out and redirects to `/ikke-tilgang` — there is no path yet for a second permanent user to gain access other than the bootstrap trigger; that's intentional for this phase (Phase 6 adds invitations).

### First-admin bootstrap

A migration creates an `on_auth_user_created` trigger function. If the new `auth.users` row's email matches `eirik.vavik@hotmail.no` (hardcoded in the migration, documented as temporary bootstrap scaffolding), it inserts a `profiles` row with `role = 'admin'`. Any other email produces no `profiles` row. This trigger is replaced in Phase 6 by real invitation-driven provisioning.

## 5. Application structure

- `lib/supabase/client.ts`, `lib/supabase/server.ts` — the two `@supabase/ssr`-based clients
- `proxy.ts` (project root — **not** `middleware.ts`; this Next.js version renamed the convention, see AGENTS.md) — refreshes the Supabase session cookie on every request via a matcher excluding static assets. It is session refresh only, not an authorization gate: Next's own docs for this version warn that proxy coverage can silently drop after a routing refactor, so every Server Component/Action re-checks `auth.getUser()`/role independently, and RLS remains the actual enforcement boundary regardless of what proxy does.
- `app/logg-inn/page.tsx` — magic-link sign-in form
- `app/auth/callback/route.ts` — code exchange + profile check
- `app/gjest/page.tsx` + a server action — guest phrase entry
- `app/tre/page.tsx` — placeholder authenticated landing page (Server Component, shows role), real canvas arrives Phase 3
- `app/ikke-tilgang/page.tsx` — unauthorized page

All UI copy is Norwegian, hardcoded (no i18n library). Example strings: "Logg inn i Vavik Familietre", "Skriv inn familiekoden", "Du har ikke tilgang."

## 6. Testing

- `supabase/tests/rls_phase1.sql` — checked-in SQL assertions of the RLS policy matrix above, run manually (transaction + rollback) against the remote project after any policy change, since there is no local Docker/CLI stack in this workflow.
- Manual browser verification of both the magic-link and guest-phrase flows end to end.

## 7. Explicit deviations from the source spec, and why

- **No CAPTCHA/rate limiting on guest code entry.** The spec's risk table (§21) calls this out as a medium-impact mitigation for anonymous-user abuse. Product owner explicitly asked to skip it for this phase, given the small, invite-only audience. Revisit if `guest_sessions` volume or `auth.users` anonymous-user growth looks abnormal.
- **No local Supabase CLI/Docker development stack**, despite the spec's environment-separation guidance (§17.2) recommending it. Product owner chose to apply migrations directly to the single remote project instead, since there's currently no second project and no real family data at risk yet.

## 8. Acceptance criteria for this slice

- A visitor cannot read any authenticated content without either a valid permanent account or a currently-authorized guest session.
- Only `eirik.vavik@hotmail.no` can sign in and land as admin; any other email is authenticated by Supabase but rejected by the app (no profile).
- A guest who enters the correct phrase gets a 7-day session that survives page reloads on the same browser; an incorrect phrase is rejected.
- The Supabase secret/service-role key never reaches browser code.
- RLS test file demonstrates: unauthenticated → denied; anonymous without `guest_sessions` row → denied; authorized guest → can be read by `app_is_authorized()`-gated policies (there's no family data yet to actually read, but the function resolves correctly); member/admin resolve correctly via `profiles`.
