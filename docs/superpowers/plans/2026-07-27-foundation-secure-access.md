# Foundation and Secure Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Next.js ⇄ Supabase foundation and the full secure-access layer (permanent magic-link auth, guest-code anonymous auth, roles, RLS) for the Vavik Familietre app, with nothing yet built on top of it except a placeholder authenticated page.

**Architecture:** Modular monolith — Next.js App Router on Vercel, Supabase Postgres/Auth as the only backend. `@supabase/ssr` provides cookie-based browser/server clients; a service-role client is used only in the two narrow server-only paths that need it (reading the guest-code hash, and the guest-session-creation RPC). RLS is the actual authorization boundary; every policy calls one of four small SQL helper functions instead of duplicating role logic.

**Tech Stack:** Next.js 16 (App Router, TypeScript), Bun, Tailwind CSS v4, Supabase (Postgres + Auth), `@supabase/supabase-js`, `@supabase/ssr`, `server-only`. Test runner: Bun's built-in `bun:test` (no new test dependency).

## Global Constraints

- All user-facing UI text is in Norwegian, hardcoded directly in components — no i18n library.
- The Supabase secret/service-role key must never be imported by anything reachable from a Client Component. Guard server-only modules with the `server-only` package.
- This Next.js version renamed `middleware.ts` → `proxy.ts` and the exported function `middleware` → `proxy`. Do not create a `middleware.ts` file.
- `searchParams` and `params` page props are Promises in this Next.js version — always `await` them.
- Migrations are applied directly to the single remote Supabase project (ref `aepiajqwquxwcgvxqmrl`) via the `mcp__supabase__apply_migration` tool, and the identical SQL is also committed under `supabase/migrations/` for version control. There is no local Supabase CLI/Docker stack in this workflow — do not add one.
- No CAPTCHA and no rate limiting on the guest-code entry point. This is an intentional, documented deviation from the source spec — do not add it back in without being asked.
- First admin bootstrap is hardcoded to `eirik.vavik@hotmail.no` in a migration. This is temporary scaffolding, replaced in a later phase by real invitations — do not build an invitation system now.
- Design doc for this slice: `docs/superpowers/specs/2026-07-27-foundation-secure-access-design.md`. If anything here conflicts with that doc, the doc wins and the plan should be corrected.
- The three user-facing pages (`/logg-inn`, `/gjest`, `/tre`, `/ikke-tilgang`) should get a real visual pass using the `frontend-design:frontend-design` skill before being considered done — the JSX in this plan is the functional/structural baseline, not final styling.

---

## File Structure

```
lib/
  supabase/
    client.ts       # browser client (createBrowserClient)
    server.ts       # server client (createServerClient, cookie-bound)
    service.ts       # service-role client, server-only, secret key
  guest-code.ts       # scrypt hash/verify helpers for the family phrase
proxy.ts               # root — session-refresh only, NOT an auth gate
supabase/
  migrations/
    <ts>_create_profiles.sql
    <ts>_create_guest_sessions_and_settings.sql
    <ts>_create_guest_session_rpc.sql
    <ts>_create_bootstrap_admin_trigger.sql
  tests/
    rls_phase1.sql    # manual RLS assertions, run via execute_sql
app/
  logg-inn/
    page.tsx
    actions.ts
  auth/
    callback/
      route.ts
  gjest/
    page.tsx
    actions.ts
  tre/
    page.tsx
    actions.ts
  ikke-tilgang/
    page.tsx
lib/guest-code.test.ts
```

---

### Task 1: Environment variables, dependencies, and Norwegian shell

**Files:**
- Modify: `.env.local`, `.env`
- Modify: `package.json`
- Modify: `app/layout.tsx`

**Interfaces:**
- Produces: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `NEXT_PUBLIC_SITE_URL` env vars, used by every later task.

- [ ] **Step 1: Rename and add env vars (values only, never print them)**

Run, without echoing values:

```bash
sed -i '' 's/^supabase_publishable_key=/NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=/' .env.local .env
sed -i '' 's/^supabase_secret_key=/SUPABASE_SECRET_KEY=/' .env.local .env
```

Then append to both `.env.local` and `.env`:

```
NEXT_PUBLIC_SUPABASE_URL=https://aepiajqwquxwcgvxqmrl.supabase.co
NEXT_PUBLIC_SITE_URL=https://vavik-familie.vercel.app
```

Confirm with `grep -o '^[A-Za-z_]*' .env.local` (names only) that four vars exist: `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SITE_URL`.

- [ ] **Step 2: Add these same three keys as Vercel project environment variables (production)**

The user must do this themselves in the Vercel dashboard (or you can if you have Vercel CLI access with the user's confirmation) — this repo's `.env.local`/`.env` are gitignored and never reach Vercel automatically. Flag this explicitly rather than assuming it's done.

- [ ] **Step 3: Install dependencies**

```bash
bun add @supabase/supabase-js @supabase/ssr server-only
```

- [ ] **Step 4: Add a test script**

Add to `package.json` `"scripts"`:

```json
"test": "bun test"
```

- [ ] **Step 5: Set Norwegian document language and app title**

In `app/layout.tsx`, change `lang="en"` to `lang="no"`, and update the `metadata` export:

```ts
export const metadata: Metadata = {
  title: "Vavik Familietre",
  description: "Privat familietre for Vavik-familien",
};
```

- [ ] **Step 6: Commit**

```bash
git add package.json bun.lock app/layout.tsx
git commit -m "Add Supabase dependencies and Norwegian app shell"
```

(`.env.local`/`.env` are gitignored — nothing to add there.)

---

### Task 2: Supabase browser and server clients

**Files:**
- Create: `lib/supabase/client.ts`
- Create: `lib/supabase/server.ts`
- Create: `lib/supabase/service.ts`

**Interfaces:**
- Produces: `createClient()` (browser, from `lib/supabase/client.ts`), `createClient()` (server, async, from `lib/supabase/server.ts`), `createServiceClient()` (from `lib/supabase/service.ts`). All later tasks that talk to Supabase from Next.js import one of these three — never construct a client ad hoc elsewhere.

- [ ] **Step 1: Browser client**

```ts
// lib/supabase/client.ts
import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  );
}
```

- [ ] **Step 2: Server client**

```ts
// lib/supabase/server.ts
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component render — proxy.ts refreshes
            // the session on the next request instead.
          }
        },
      },
    }
  );
}
```

- [ ] **Step 3: Service-role client (server-only, secret key)**

```ts
// lib/supabase/service.ts
import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

export function createServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
```

- [ ] **Step 4: Verify it compiles**

```bash
bunx tsc --noEmit
```

Expected: no errors referencing these three files (unrelated pre-existing errors, if any, are not this task's concern).

- [ ] **Step 5: Commit**

```bash
git add lib/supabase
git commit -m "Add Supabase browser, server, and service-role clients"
```

---

### Task 3: Session-refresh proxy

**Files:**
- Create: `proxy.ts` (project root)

**Interfaces:**
- Consumes: nothing from earlier tasks besides the env vars.
- Produces: nothing other tasks call directly — this runs automatically per-request.

- [ ] **Step 1: Write `proxy.ts`**

```ts
// proxy.ts
import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Refreshes the session cookie if it's expired. The return value is
  // deliberately unused: every Server Component/Action re-checks auth
  // itself, since proxy coverage can silently drop on a routing refactor.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
```

- [ ] **Step 2: Verify the dev server starts and proxy doesn't crash the app**

```bash
bun run dev &
sleep 3
curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:3000/
kill %1
```

Expected: HTTP status printed (200 or a redirect code), no crash in the terminal output.

- [ ] **Step 3: Commit**

```bash
git add proxy.ts
git commit -m "Add Supabase session-refresh proxy"
```

---

### Task 4: `profiles` table, roles, and admin/member RLS

**Files:**
- Create: `supabase/migrations/<timestamp>_create_profiles.sql` (use `date -u +%Y%m%d%H%M%S` for `<timestamp>`)

**Interfaces:**
- Produces: `app_role` enum (`member`, `admin`); `profiles` table (`user_id` PK, `display_name`, `role`, `status`, `created_at`, `updated_at`); SQL functions `app_is_admin()`, `app_is_member_or_admin()` — every later RLS policy in this plan calls one of these two.

- [ ] **Step 1: Write the migration file**

```sql
-- supabase/migrations/<timestamp>_create_profiles.sql

create type app_role as enum ('member', 'admin');

create table profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  role app_role not null default 'member',
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table profiles enable row level security;

create or replace function app_is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from profiles
    where user_id = auth.uid()
      and role = 'admin'
      and status = 'active'
  );
$$;

create or replace function app_is_member_or_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from profiles
    where user_id = auth.uid()
      and status = 'active'
  );
$$;

create or replace function profiles_guard_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if app_is_admin() then
    return new;
  end if;

  if new.user_id <> old.user_id then
    raise exception 'cannot reassign profile ownership';
  end if;

  if new.role <> old.role or new.status <> old.status then
    raise exception 'only an administrator may change role or status';
  end if;

  return new;
end;
$$;

create trigger profiles_guard_update_trigger
  before update on profiles
  for each row
  execute function profiles_guard_update();

create policy "profiles_select_own_or_admin"
  on profiles for select
  to authenticated
  using (user_id = auth.uid() or app_is_admin());

create policy "profiles_update_own_or_admin"
  on profiles for update
  to authenticated
  using (user_id = auth.uid() or app_is_admin())
  with check (user_id = auth.uid() or app_is_admin());

create policy "profiles_admin_insert"
  on profiles for insert
  to authenticated
  with check (app_is_admin());
```

No delete policy exists anywhere in this plan for `profiles` — the spec requires hard deletion to stay unavailable to ordinary API roles, and Postgres RLS default-denies any operation with no matching policy.

- [ ] **Step 2: Apply it to the remote project**

Use the `mcp__supabase__apply_migration` tool with `name: "create_profiles"` and `query` set to the file contents above.

- [ ] **Step 3: Verify**

Use `mcp__supabase__list_tables` (schema `public`) and confirm `profiles` is listed. Use `mcp__supabase__execute_sql` with `select app_is_admin();` (expect `false`, since there's no authenticated context in that call) to confirm the function exists and runs.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations
git commit -m "Add profiles table, roles, and admin RLS"
```

---

### Task 5: `guest_sessions`, `app_settings`, and guest-authorization RLS

**Files:**
- Create: `supabase/migrations/<timestamp>_create_guest_sessions_and_settings.sql`

**Interfaces:**
- Consumes: `app_is_admin()`, `app_is_member_or_admin()` from Task 4.
- Produces: `guest_sessions` table, `app_settings` singleton table, `app_is_authorized_guest()`, `app_is_authorized()` — the function every future family-data table's RLS (Phase 2+) will call.

- [ ] **Step 1: Write the migration file**

```sql
-- supabase/migrations/<timestamp>_create_guest_sessions_and_settings.sql

create table guest_sessions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  issued_by uuid references profiles(user_id)
);

alter table guest_sessions enable row level security;

create policy "guest_sessions_admin_select"
  on guest_sessions for select
  to authenticated
  using (app_is_admin());

-- No insert/update/delete policy for any client role: only the
-- SECURITY DEFINER create_guest_session() function (Task 6) writes here.

create table app_settings (
  id smallint primary key default 1,
  guest_code_hash text,
  guest_session_lifetime_days int not null default 7,
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(user_id),
  constraint app_settings_singleton check (id = 1)
);

insert into app_settings (id) values (1);

alter table app_settings enable row level security;

create policy "app_settings_admin_all"
  on app_settings for all
  to authenticated
  using (app_is_admin())
  with check (app_is_admin());

create or replace function app_is_authorized_guest()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
    and exists (
      select 1 from guest_sessions
      where user_id = auth.uid()
        and revoked_at is null
        and expires_at > now()
    );
$$;

create or replace function app_is_authorized()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select app_is_member_or_admin() or app_is_authorized_guest();
$$;
```

- [ ] **Step 2: Apply it**

`mcp__supabase__apply_migration` with `name: "create_guest_sessions_and_settings"`.

- [ ] **Step 3: Verify**

`mcp__supabase__execute_sql` with `select * from app_settings;` — expect exactly one row, `id = 1`, `guest_code_hash` null, `guest_session_lifetime_days = 7`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations
git commit -m "Add guest_sessions and app_settings tables with authorization functions"
```

---

### Task 6: `create_guest_session` RPC (service-role only)

**Files:**
- Create: `supabase/migrations/<timestamp>_create_guest_session_rpc.sql`

**Interfaces:**
- Consumes: `guest_sessions` table from Task 5.
- Produces: Postgres function `create_guest_session(p_user_id uuid, p_lifetime_days int) returns void`, callable only by `service_role`. Task 9's guest server action calls this via `createServiceClient().rpc("create_guest_session", { p_user_id, p_lifetime_days })`.

- [ ] **Step 1: Write the migration file**

```sql
-- supabase/migrations/<timestamp>_create_guest_session_rpc.sql

create or replace function create_guest_session(p_user_id uuid, p_lifetime_days int)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into guest_sessions (user_id, issued_at, expires_at, revoked_at)
  values (p_user_id, now(), now() + make_interval(days => p_lifetime_days), null)
  on conflict (user_id) do update
    set issued_at = excluded.issued_at,
        expires_at = excluded.expires_at,
        revoked_at = null;
end;
$$;

revoke all on function create_guest_session(uuid, int) from public;
grant execute on function create_guest_session(uuid, int) to service_role;
```

- [ ] **Step 2: Apply it**

`mcp__supabase__apply_migration` with `name: "create_guest_session_rpc"`.

- [ ] **Step 3: Verify with a throwaway call, then clean up**

```sql
select create_guest_session('00000000-0000-0000-0000-000000000000', 7);
select * from guest_sessions where user_id = '00000000-0000-0000-0000-000000000000';
delete from guest_sessions where user_id = '00000000-0000-0000-0000-000000000000';
```

Run via `mcp__supabase__execute_sql` (this runs with full privileges, bypassing the `service_role`-only grant — that grant is enforced for the app's Postgres roles, not for this admin tool). Expect the select to show one row with `expires_at` roughly 7 days out, then confirm the delete removes it.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations
git commit -m "Add create_guest_session RPC restricted to service_role"
```

---

### Task 7: Bootstrap admin trigger

**Files:**
- Create: `supabase/migrations/<timestamp>_create_bootstrap_admin_trigger.sql`

**Interfaces:**
- Consumes: `profiles` table from Task 4.
- Produces: trigger `on_auth_user_created` on `auth.users`. Nothing else in this plan depends on it directly, but it must run before the first real sign-in test (Task 11's manual verification).

- [ ] **Step 1: Write the migration file**

```sql
-- supabase/migrations/<timestamp>_create_bootstrap_admin_trigger.sql

-- Temporary bootstrap scaffolding: the only way a permanent user gets a
-- profile in this phase, since invitations don't exist yet (later phase).
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email = 'eirik.vavik@hotmail.no' then
    insert into profiles (user_id, display_name, role)
    values (new.id, 'Eirik Vavik', 'admin')
    on conflict (user_id) do nothing;
  end if;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function handle_new_user();
```

- [ ] **Step 2: Apply it**

`mcp__supabase__apply_migration` with `name: "create_bootstrap_admin_trigger"`.

- [ ] **Step 3: Verify the trigger exists**

`mcp__supabase__execute_sql`:

```sql
select tgname from pg_trigger where tgname = 'on_auth_user_created';
```

Expect one row back.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations
git commit -m "Add bootstrap trigger for first admin profile"
```

---

### Task 8: RLS test script

**Files:**
- Create: `supabase/tests/rls_phase1.sql`

**Interfaces:**
- Consumes: everything from Tasks 4–7.
- Produces: a repeatable manual test script. No other task depends on this file programmatically.

- [ ] **Step 1: Write the test script**

```sql
-- supabase/tests/rls_phase1.sql
-- Manual RLS assertions for the foundation/secure-access phase.
-- Run the whole file in one execute_sql call. It wraps itself in a
-- transaction that always rolls back, so it never leaves test data behind.
-- Every failed assertion raises an exception, so "no output" means "passed".

begin;

-- Fixture: a fake admin, a fake member, a fake disabled member, and an
-- auth.users row for each so the FK on profiles is satisfied.
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'admin@example.test'),
  ('22222222-2222-2222-2222-222222222222', 'member@example.test'),
  ('33333333-3333-3333-3333-333333333333', 'disabled@example.test'),
  ('44444444-4444-4444-4444-444444444444', 'guest-anon@example.test');

insert into profiles (user_id, display_name, role, status) values
  ('11111111-1111-1111-1111-111111111111', 'Test Admin', 'admin', 'active'),
  ('22222222-2222-2222-2222-222222222222', 'Test Member', 'member', 'active'),
  ('33333333-3333-3333-3333-333333333333', 'Test Disabled', 'member', 'disabled');

insert into guest_sessions (user_id, expires_at) values
  ('44444444-4444-4444-4444-444444444444', now() + interval '1 day');

-- Assertion 1: unauthenticated (no jwt claims set) resolves to unauthorized.
set local role anon;
set local request.jwt.claims = '';
do $$
begin
  if app_is_authorized() then
    raise exception 'FAIL: unauthenticated resolved as authorized';
  end if;
end $$;

-- Assertion 2: anonymous identity WITHOUT a guest_sessions row is unauthorized.
set local role authenticated;
set local request.jwt.claims = '{"sub":"55555555-5555-5555-5555-555555555555","is_anonymous":true}';
do $$
begin
  if app_is_authorized() then
    raise exception 'FAIL: anonymous without guest_sessions resolved as authorized';
  end if;
end $$;

-- Assertion 3: anonymous identity WITH a valid guest_sessions row is authorized.
set local request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444","is_anonymous":true}';
do $$
begin
  if not app_is_authorized() then
    raise exception 'FAIL: authorized guest resolved as unauthorized';
  end if;
  if app_is_admin() then
    raise exception 'FAIL: guest resolved as admin';
  end if;
end $$;

-- Assertion 4: active member resolves as member_or_admin but not admin.
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222"}';
do $$
begin
  if not app_is_member_or_admin() then
    raise exception 'FAIL: active member not resolved as member_or_admin';
  end if;
  if app_is_admin() then
    raise exception 'FAIL: member resolved as admin';
  end if;
  if not app_is_authorized() then
    raise exception 'FAIL: member not resolved as authorized';
  end if;
end $$;

-- Assertion 5: disabled member resolves as NOT authorized at all.
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333"}';
do $$
begin
  if app_is_member_or_admin() then
    raise exception 'FAIL: disabled member resolved as member_or_admin';
  end if;
  if app_is_authorized() then
    raise exception 'FAIL: disabled member resolved as authorized';
  end if;
end $$;

-- Assertion 6: active admin resolves as admin.
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
do $$
begin
  if not app_is_admin() then
    raise exception 'FAIL: active admin not resolved as admin';
  end if;
end $$;

-- Assertion 7: a member cannot read guest_sessions (admin-only select policy).
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222"}';
do $$
declare
  visible_rows int;
begin
  select count(*) into visible_rows from guest_sessions;
  if visible_rows <> 0 then
    raise exception 'FAIL: member could see % guest_sessions row(s)', visible_rows;
  end if;
end $$;

-- Assertion 8: a member cannot change their own role via UPDATE.
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222"}';
do $$
begin
  begin
    update profiles set role = 'admin' where user_id = '22222222-2222-2222-2222-222222222222';
    raise exception 'FAIL: member successfully self-promoted to admin';
  exception
    when others then
      if sqlerrm not like '%only an administrator%' then
        raise;
      end if;
  end;
end $$;

rollback;
```

- [ ] **Step 2: Run it**

Pass the file contents to `mcp__supabase__execute_sql`. Expected: the call completes with no `FAIL:` exception raised. If any assertion raises, fix the migration in the relevant earlier task (do not weaken the test), re-apply via a **new** migration (never edit an already-applied migration file), and re-run this script.

- [ ] **Step 3: Commit**

```bash
git add supabase/tests
git commit -m "Add RLS assertions for foundation/secure-access phase"
```

---

### Task 9: Guest-code hashing helper

**Files:**
- Create: `lib/guest-code.ts`
- Create: `lib/guest-code.test.ts`

**Interfaces:**
- Produces: `hashGuestCode(code: string): string`, `verifyGuestCode(code: string, stored: string): boolean`. Task 11 (guest sign-in) and Task 12 (admin sets the code) both import these.

- [ ] **Step 1: Write the failing test**

```ts
// lib/guest-code.test.ts
import { test, expect } from "bun:test";
import { hashGuestCode, verifyGuestCode } from "./guest-code";

test("verifyGuestCode accepts the exact code that was hashed", () => {
  const hash = hashGuestCode("Trondheim1948");
  expect(verifyGuestCode("Trondheim1948", hash)).toBe(true);
});

test("verifyGuestCode rejects a wrong code", () => {
  const hash = hashGuestCode("Trondheim1948");
  expect(verifyGuestCode("wrong-code", hash)).toBe(false);
});

test("verifyGuestCode is case-insensitive and trims whitespace", () => {
  const hash = hashGuestCode("Trondheim1948");
  expect(verifyGuestCode("  trondheim1948  ", hash)).toBe(true);
});

test("hashGuestCode produces a different hash each time (random salt)", () => {
  const a = hashGuestCode("Trondheim1948");
  const b = hashGuestCode("Trondheim1948");
  expect(a).not.toBe(b);
  expect(verifyGuestCode("Trondheim1948", a)).toBe(true);
  expect(verifyGuestCode("Trondheim1948", b)).toBe(true);
});

test("verifyGuestCode rejects a malformed stored value", () => {
  expect(verifyGuestCode("anything", "not-a-valid-hash")).toBe(false);
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
bun test lib/guest-code.test.ts
```

Expected: FAIL — `guest-code.ts` doesn't exist yet.

- [ ] **Step 3: Implement**

```ts
// lib/guest-code.ts
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const KEY_LENGTH = 64;

function normalize(code: string): string {
  return code.trim().toLowerCase();
}

export function hashGuestCode(code: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(normalize(code), salt, KEY_LENGTH);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyGuestCode(code: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) {
    return false;
  }

  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(normalize(code), salt, KEY_LENGTH);

  if (actual.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(actual, expected);
}
```

- [ ] **Step 4: Run the tests and verify they pass**

```bash
bun test lib/guest-code.test.ts
```

Expected: all 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/guest-code.ts lib/guest-code.test.ts
git commit -m "Add guest-code hashing with scrypt"
```

---

### Task 10: Member magic-link sign-in

**Files:**
- Create: `app/logg-inn/page.tsx`
- Create: `app/logg-inn/actions.ts`
- Create: `app/auth/callback/route.ts`

**Interfaces:**
- Consumes: `createClient()` from `lib/supabase/server.ts` (Task 2).
- Produces: the `/logg-inn` route and `/auth/callback` route that Task 12's unauthenticated redirect targets.

- [ ] **Step 1: Sign-in server action**

```ts
// app/logg-inn/actions.ts
"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function sendMagicLink(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();

  if (!email) {
    redirect("/logg-inn?feil=mangler-epost");
  }

  const supabase = await createClient();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL!;

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${siteUrl}/auth/callback` },
  });

  if (error) {
    redirect("/logg-inn?feil=sending-feilet");
  }

  redirect("/logg-inn?sendt=1");
}
```

- [ ] **Step 2: Sign-in page**

```tsx
// app/logg-inn/page.tsx
import { sendMagicLink } from "./actions";

export default async function LoggInnPage({
  searchParams,
}: {
  searchParams: Promise<{ sendt?: string; feil?: string }>;
}) {
  const { sendt, feil } = await searchParams;

  return (
    <main>
      <h1>Logg inn i Vavik Familietre</h1>
      {sendt === "1" && <p>Sjekk innboksen din for en innloggingslenke.</p>}
      {feil === "mangler-epost" && <p>Du må skrive inn en e-postadresse.</p>}
      {feil === "sending-feilet" && (
        <p>Kunne ikke sende innloggingslenke. Prøv igjen.</p>
      )}
      {feil === "lenke-ugyldig" && (
        <p>Innloggingslenken var ugyldig eller utløpt. Prøv å logge inn på nytt.</p>
      )}
      <form action={sendMagicLink}>
        <label htmlFor="email">E-postadresse</label>
        <input id="email" name="email" type="email" required autoComplete="email" />
        <button type="submit">Send innloggingslenke</button>
      </form>
      <p>
        Er du på besøk? <a href="/gjest">Se som gjest</a>
      </p>
    </main>
  );
}
```

- [ ] **Step 3: Callback route**

```ts
// app/auth/callback/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("user_id")
          .eq("user_id", user.id)
          .maybeSingle();

        if (!profile) {
          await supabase.auth.signOut();
          return NextResponse.redirect(`${origin}/ikke-tilgang`);
        }
      }

      return NextResponse.redirect(`${origin}/tre`);
    }
  }

  return NextResponse.redirect(`${origin}/logg-inn?feil=lenke-ugyldig`);
}
```

- [ ] **Step 4: Verify it compiles**

```bash
bunx tsc --noEmit
```

Expected: no errors in these three files.

- [ ] **Step 5: Commit**

```bash
git add app/logg-inn app/auth
git commit -m "Add member magic-link sign-in flow"
```

---

### Task 11: Guest phrase entry

**Files:**
- Create: `app/gjest/page.tsx`
- Create: `app/gjest/actions.ts`

**Interfaces:**
- Consumes: `createClient()` (`lib/supabase/server.ts`), `createServiceClient()` (`lib/supabase/service.ts`), `verifyGuestCode()` (`lib/guest-code.ts`), `create_guest_session` RPC (Task 6).
- Produces: the `/gjest` route.

- [ ] **Step 1: Guest verification server action**

```ts
// app/gjest/actions.ts
"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { verifyGuestCode } from "@/lib/guest-code";

export async function bekreftGjestekode(formData: FormData) {
  const kode = String(formData.get("kode") ?? "").trim();

  if (!kode) {
    redirect("/gjest?feil=mangler-kode");
  }

  const service = createServiceClient();
  const { data: settings } = await service
    .from("app_settings")
    .select("guest_code_hash, guest_session_lifetime_days")
    .eq("id", 1)
    .single();

  if (!settings?.guest_code_hash || !verifyGuestCode(kode, settings.guest_code_hash)) {
    redirect("/gjest?feil=feil-kode");
  }

  const supabase = await createClient();
  const {
    data: { user: existingUser },
  } = await supabase.auth.getUser();

  let guestUserId = existingUser?.is_anonymous ? existingUser.id : null;

  if (!guestUserId) {
    const { data, error } = await supabase.auth.signInAnonymously();
    if (error || !data.user) {
      redirect("/gjest?feil=noe-gikk-galt");
    }
    guestUserId = data.user!.id;
  }

  const { error: rpcError } = await service.rpc("create_guest_session", {
    p_user_id: guestUserId,
    p_lifetime_days: settings.guest_session_lifetime_days,
  });

  if (rpcError) {
    redirect("/gjest?feil=noe-gikk-galt");
  }

  redirect("/tre");
}
```

- [ ] **Step 2: Guest page**

```tsx
// app/gjest/page.tsx
import { bekreftGjestekode } from "./actions";

export default async function GjestPage({
  searchParams,
}: {
  searchParams: Promise<{ feil?: string }>;
}) {
  const { feil } = await searchParams;

  return (
    <main>
      <h1>Se Vavik Familietre som gjest</h1>
      <p>Skriv inn familiekoden du har fått av en administrator.</p>
      {feil === "mangler-kode" && <p>Du må skrive inn en kode.</p>}
      {feil === "feil-kode" && <p>Feil kode. Prøv igjen.</p>}
      {feil === "noe-gikk-galt" && <p>Noe gikk galt. Prøv igjen.</p>}
      <form action={bekreftGjestekode}>
        <label htmlFor="kode">Familiekode</label>
        <input id="kode" name="kode" type="text" required autoComplete="off" />
        <button type="submit">Fortsett</button>
      </form>
      <p>
        Er du et fast medlem av familien? <a href="/logg-inn">Logg inn</a>
      </p>
    </main>
  );
}
```

- [ ] **Step 3: Verify it compiles**

```bash
bunx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add app/gjest
git commit -m "Add guest phrase entry flow"
```

---

### Task 12: Placeholder landing page, sign-out, admin code-setting, unauthorized page

**Files:**
- Create: `app/tre/page.tsx`
- Create: `app/tre/actions.ts`
- Create: `app/ikke-tilgang/page.tsx`

**Interfaces:**
- Consumes: `createClient()` (`lib/supabase/server.ts`), `hashGuestCode()` (`lib/guest-code.ts`).
- Produces: the `/tre` and `/ikke-tilgang` routes — the redirect targets used by Task 10 and Task 11.

- [ ] **Step 1: Actions for `/tre`**

```ts
// app/tre/actions.ts
"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hashGuestCode } from "@/lib/guest-code";

export async function loggUt() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/logg-inn");
}

export async function settFamiliekode(formData: FormData) {
  const kode = String(formData.get("kode") ?? "").trim();

  if (!kode) {
    redirect("/tre?feil=mangler-kode");
  }

  const supabase = await createClient();
  const hash = hashGuestCode(kode);

  // Relies entirely on the app_settings_admin_all RLS policy (Task 5) to
  // reject this for non-admins — there is no separate role check here.
  const { error } = await supabase
    .from("app_settings")
    .update({ guest_code_hash: hash, updated_at: new Date().toISOString() })
    .eq("id", 1);

  if (error) {
    redirect("/tre?feil=lagring-feilet");
  }

  redirect("/tre?lagret=1");
}
```

- [ ] **Step 2: `/tre` page**

```tsx
// app/tre/page.tsx
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loggUt, settFamiliekode } from "./actions";

export default async function TrePage({
  searchParams,
}: {
  searchParams: Promise<{ feil?: string; lagret?: string }>;
}) {
  const { feil, lagret } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/logg-inn");
  }

  const isGuest = Boolean(user.is_anonymous);
  let rolle = "Gjest";
  let isAdmin = false;

  if (!isGuest) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!profile) {
      redirect("/ikke-tilgang");
    }

    rolle = profile.role === "admin" ? "Administrator" : "Medlem";
    isAdmin = profile.role === "admin";
  }

  return (
    <main>
      <h1>Velkommen til Vavik Familietre</h1>
      <p>Du er innlogget som: {rolle}</p>
      <form action={loggUt}>
        <button type="submit">Logg ut</button>
      </form>

      {isAdmin && (
        <section>
          <h2>Sett familiekode</h2>
          <p>Denne koden deler du med familiemedlemmer som skal se treet som gjest.</p>
          {lagret === "1" && <p>Familiekoden er lagret.</p>}
          {feil === "mangler-kode" && <p>Du må skrive inn en kode.</p>}
          {feil === "lagring-feilet" && <p>Kunne ikke lagre koden. Prøv igjen.</p>}
          <form action={settFamiliekode}>
            <label htmlFor="kode">Ny familiekode</label>
            <input id="kode" name="kode" type="text" required autoComplete="off" />
            <button type="submit">Lagre</button>
          </form>
        </section>
      )}
    </main>
  );
}
```

- [ ] **Step 3: Unauthorized page**

```tsx
// app/ikke-tilgang/page.tsx
export default function IkkeTilgangPage() {
  return (
    <main>
      <h1>Du har ikke tilgang</h1>
      <p>
        Denne kontoen er ikke godkjent for Vavik Familietre. Ta kontakt med en
        administrator hvis du mener dette er feil.
      </p>
      <p>
        <a href="/logg-inn">Tilbake til innlogging</a>
      </p>
    </main>
  );
}
```

- [ ] **Step 4: Verify it compiles**

```bash
bunx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add app/tre app/ikke-tilgang
git commit -m "Add placeholder tree page, sign-out, and admin guest-code form"
```

---

### Task 13: Visual pass on the four user-facing pages

**Files:**
- Modify: `app/logg-inn/page.tsx`, `app/gjest/page.tsx`, `app/tre/page.tsx`, `app/ikke-tilgang/page.tsx`

**Interfaces:**
- Consumes: the working pages from Tasks 10–12. This task only changes markup/styling, not any server action signature or redirect behavior.

- [ ] **Step 1: Invoke the `frontend-design:frontend-design` skill**

Use it to get aesthetic direction for a private, warm, trustworthy family-archive feel (not a generic SaaS look) — this is a private single-family app, not a product landing page. Apply the resulting direction consistently across all four pages using Tailwind classes already available via `app/globals.css`.

- [ ] **Step 2: Re-verify behavior didn't regress**

```bash
bunx tsc --noEmit
bun test
```

Expected: same pass results as before this task — styling changes must not touch the `action={...}` bindings, input `name` attributes, or redirect logic.

- [ ] **Step 3: Commit**

```bash
git add app/logg-inn app/gjest app/tre app/ikke-tilgang
git commit -m "Apply visual design pass to auth and guest-entry pages"
```

---

### Task 14: End-to-end manual verification

**Files:** none — this task only runs and observes the deployed/dev app.

- [ ] **Step 1: Set the family guest code once, as the admin, locally**

Run the dev server (`bun run dev`), sign in at `/logg-inn` with `eirik.vavik@hotmail.no`, click the magic link from the inbox, land on `/tre` as Administrator, and use the "Sett familiekode" form to set an initial phrase (e.g. a real family word — pick something outside of any fixture text used in Task 8's test script).

- [ ] **Step 2: Verify the admin path end to end**

Confirm: landed on `/tre`, role shows "Administrator", "Logg ut" returns to `/logg-inn`.

- [ ] **Step 3: Verify the guest path end to end**

Open a private/incognito browser window, go to `/gjest`, enter the phrase from Step 1, confirm redirect to `/tre` showing "Gjest", and confirm the admin's "Sett familiekode" section is not shown to a guest.

- [ ] **Step 4: Verify the rejection paths**

Confirm: wrong guest phrase shows the Norwegian error and does not redirect; attempting `/logg-inn` with any email other than `eirik.vavik@hotmail.no` results in landing on `/ikke-tilgang` after clicking that email's magic link (use a second real inbox you control, or skip if none is available and note it as unverified).

- [ ] **Step 5: Deploy and repeat Steps 2–4 against the live Vercel URL**

Push the branch (or merge to `main`, per whatever the user's normal deploy trigger is) and re-run the same checks against `https://vavik-familie.vercel.app`, confirming the Resend SMTP configuration (set up by the user per the design doc) actually delivers the magic-link email in production, not just via Supabase's default sender in local dev.

- [ ] **Step 6: Record results**

Report back plainly which of Steps 2–4 passed against production, and flag anything that didn't (e.g. if Resend isn't configured yet, magic links may still be going through Supabase's rate-limited default sender).

---

## Self-Review Notes

- **Spec coverage:** every "In scope" bullet from the design doc (§1) maps to a task above: client wiring (Task 2), proxy (Task 3), profiles/roles (Task 4), guest_sessions/app_settings (Task 5), guest RPC (Task 6), bootstrap (Task 7), RLS tests (Task 8), guest-code hashing (Task 9), both auth flows (Tasks 10–11), landing/unauthorized pages (Task 12), visual polish (Task 13), and manual verification against the MVP acceptance criteria that apply to this slice (Task 14).
- **Placeholder scan:** no TBD/TODO markers; every step has literal code or literal shell commands.
- **Type consistency:** `createClient()` (server) is always awaited (`await createClient()`) everywhere it's used, matching its async signature from Task 2. `createServiceClient()` is synchronous and used without `await`, matching Task 2. `hashGuestCode`/`verifyGuestCode` signatures match between Task 9's definition and their call sites in Tasks 11–12.
