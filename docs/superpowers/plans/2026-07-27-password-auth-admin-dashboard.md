# Password Auth and Admin Member Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace magic-link sign-in with email+password sign-in, and add a minimal admin-only member dashboard (create + list) so the admin can create every account directly — removing per-login email dependency entirely.

**Architecture:** Same modular monolith (Next.js + Supabase) as the foundation/secure-access phase. No new tables — `profiles` gains `email`/`first_name`/`last_name` and loses `display_name`. `/auth/callback` is deleted (password auth is synchronous, no code exchange). The new admin "create member" action is the only place in the app that calls `auth.admin.createUser()` directly, so it needs an explicit in-code admin check — every other admin-only action so far has relied on RLS alone via the session-scoped client, but this one bypasses RLS by using the service-role client.

**Tech Stack:** Same as before — Next.js 16 App Router, TypeScript, Bun, Tailwind v4, Supabase Postgres/Auth.

## Global Constraints

- All UI text Norwegian, hardcoded — matches existing pages exactly in visual style (rounded-2xl border border-line bg-surface card, font-serif headings, the same gold branch-motif SVG, the same error/success banner pattern with icon).
- No public self-registration of any kind. Only the admin creates accounts.
- Migrations applied directly to the remote Supabase project (ref `aepiajqwquxwcgvxqmrl`) via `mcp__supabase__apply_migration`, with identical SQL committed to `supabase/migrations/`. Get the actual registered version from `mcp__supabase__list_migrations` before naming the local file (established pattern — a mismatch here has caused real problems twice already in this project).
- Design doc for this change: `docs/superpowers/specs/2026-07-27-password-auth-admin-dashboard-design.md`.
- Reuse `lib/supabase/client.ts`, `lib/supabase/server.ts`, `lib/supabase/service.ts` exactly as they are — no changes to those files.
- No self-service password reset/change UI in this pass — out of scope, not requested.
- No edit/disable of existing members in the dashboard — create + list only, per explicit product-owner scope choice.

---

## File Structure

```
supabase/migrations/
  <ts>_add_profile_identity_columns.sql   # alter profiles, update bootstrap trigger
app/
  logg-inn/
    page.tsx      # rewritten: email + password form
    actions.ts    # rewritten: signInWithPassword + profile check
  admin/
    medlemmer/
      page.tsx    # admin-only: list members, create-member form
      actions.ts  # opprettMedlem server action
app/auth/callback/route.ts  # DELETED
```

---

### Task 1: `profiles` schema change and bootstrap trigger update

**Files:**
- Create: `supabase/migrations/<timestamp>_add_profile_identity_columns.sql`

**Interfaces:**
- Consumes: existing `profiles` table (Task 4 of the prior plan), existing `handle_new_user()` trigger function.
- Produces: `profiles.email` (unique, not null), `profiles.first_name` (not null), `profiles.last_name` (not null); `profiles.display_name` removed. `handle_new_user()` updated to populate the new columns.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/<timestamp>_add_profile_identity_columns.sql

alter table profiles
  add column email text,
  add column first_name text,
  add column last_name text;

update profiles
set email = 'eirik.vavik@hotmail.no',
    first_name = 'Eirik',
    last_name = 'Vavik'
where user_id = (select id from auth.users where email = 'eirik.vavik@hotmail.no');

alter table profiles
  alter column email set not null,
  alter column first_name set not null,
  alter column last_name set not null;

alter table profiles
  add constraint profiles_email_unique unique (email);

alter table profiles drop column display_name;

create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email = 'eirik.vavik@hotmail.no' then
    insert into profiles (user_id, email, first_name, last_name, role)
    values (new.id, new.email, 'Eirik', 'Vavik', 'admin')
    on conflict (user_id) do nothing;
  end if;
  return new;
end;
$$;
```

- [ ] **Step 2: Apply it**

Call `mcp__supabase__apply_migration` with `name: "add_profile_identity_columns"` and the query above.

- [ ] **Step 3: Verify**

Via `mcp__supabase__execute_sql`:

```sql
select user_id, email, first_name, last_name, role from profiles;
```

Expected: exactly one row — `eirik.vavik@hotmail.no`, `Eirik`, `Vavik`, `admin`. Confirm `display_name` column no longer appears in `select * from profiles limit 0;`'s column list (or via `\d profiles` equivalent: `select column_name from information_schema.columns where table_name = 'profiles';` should list `email`, `first_name`, `last_name` and NOT `display_name`).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations
git commit -m "Add profile identity columns, replacing display_name"
```

---

### Task 2: Password-based sign-in, remove magic-link callback

**Files:**
- Modify: `app/logg-inn/actions.ts` (full rewrite)
- Modify: `app/logg-inn/page.tsx` (full rewrite)
- Delete: `app/auth/callback/route.ts`

**Interfaces:**
- Consumes: `createClient()` from `lib/supabase/server.ts` (async, unchanged).
- Produces: the `/logg-inn` route now does password auth. Nothing else in the app referenced `/auth/callback` directly except this deleted file itself and Supabase's redirect config (which is a dashboard setting the product owner controls, not code — no code change needed there, but note in your report that the `/auth/callback` redirect URLs in Supabase's dashboard are now unused and can be removed later at the owner's convenience; do not attempt to change dashboard settings yourself).

- [ ] **Step 1: Rewrite the sign-in server action**

```ts
// app/logg-inn/actions.ts
"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function loggInnMedPassord(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const passord = String(formData.get("passord") ?? "");

  if (!email || !passord) {
    redirect("/logg-inn?feil=mangler-felt");
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password: passord,
  });

  if (error || !data.user) {
    redirect("/logg-inn?feil=feil-innlogging");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("user_id")
    .eq("user_id", data.user.id)
    .maybeSingle();

  if (!profile) {
    await supabase.auth.signOut();
    redirect("/ikke-tilgang");
  }

  redirect("/tre");
}
```

- [ ] **Step 2: Rewrite the sign-in page**

```tsx
// app/logg-inn/page.tsx
import { loggInnMedPassord } from "./actions";

export default async function LoggInnPage({
  searchParams,
}: {
  searchParams: Promise<{ feil?: string }>;
}) {
  const { feil } = await searchParams;

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-8 shadow-sm sm:p-10">
        <div className="flex flex-col items-center text-center">
          <svg
            width="48"
            height="20"
            viewBox="0 0 48 20"
            fill="none"
            aria-hidden="true"
            className="text-gold"
          >
            <path
              d="M24 20V10M24 10C24 10 24 2 16 2M24 10C24 10 24 2 32 2"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
          <h1 className="mt-4 font-serif text-2xl font-medium tracking-tight text-foreground sm:text-3xl">
            Logg inn i Vavik Familietre
          </h1>
          <p className="mt-2 text-sm text-muted">
            Skriv inn e-postadressen og passordet ditt.
          </p>
        </div>

        {feil === "mangler-felt" && (
          <p className="mt-6 flex items-start gap-2 rounded-lg border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true" className="mt-0.5 shrink-0">
              <circle cx="10" cy="10" r="7.25" stroke="currentColor" strokeWidth="1.6" />
              <path d="M10 6.5V10.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              <circle cx="10" cy="13.25" r="0.9" fill="currentColor" />
            </svg>
            <span>Du må fylle ut både e-post og passord.</span>
          </p>
        )}
        {feil === "feil-innlogging" && (
          <p className="mt-6 flex items-start gap-2 rounded-lg border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true" className="mt-0.5 shrink-0">
              <circle cx="10" cy="10" r="7.25" stroke="currentColor" strokeWidth="1.6" />
              <path d="M10 6.5V10.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              <circle cx="10" cy="13.25" r="0.9" fill="currentColor" />
            </svg>
            <span>Feil e-post eller passord.</span>
          </p>
        )}

        <form action={loggInnMedPassord} className="mt-6 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="email" className="text-sm font-medium text-foreground">
              E-postadresse
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              className="w-full rounded-lg border border-line bg-background px-3.5 py-2.5 text-foreground placeholder:text-muted/70 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="passord" className="text-sm font-medium text-foreground">
              Passord
            </label>
            <input
              id="passord"
              name="passord"
              type="password"
              required
              autoComplete="current-password"
              className="w-full rounded-lg border border-line bg-background px-3.5 py-2.5 text-foreground placeholder:text-muted/70 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40"
            />
          </div>
          <button
            type="submit"
            className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Logg inn
          </button>
        </form>

        <p className="mt-8 border-t border-line pt-6 text-center text-sm text-muted">
          Er du på besøk?{" "}
          <a href="/gjest" className="font-medium text-accent underline underline-offset-2 hover:text-accent-hover">
            Se som gjest
          </a>
        </p>
      </div>
    </main>
  );
}
```

- [ ] **Step 3: Delete the callback route**

```bash
git rm app/auth/callback/route.ts
```

If `app/auth/` is now empty, git will not track the empty directory — that's fine, no further action needed.

- [ ] **Step 4: Verify it compiles**

```bash
bunx tsc --noEmit
```

Expected: no new errors (the pre-existing, already-tracked `lib/guest-code.test.ts` `bun:test` type error is fine and unrelated).

- [ ] **Step 5: Commit**

```bash
git add app/logg-inn
git commit -m "Replace magic-link sign-in with email and password"
```

(The `git rm` from Step 3 stages itself; include it in the same commit.)

---

### Task 3: Admin member dashboard — list and create

**Files:**
- Create: `app/admin/medlemmer/page.tsx`
- Create: `app/admin/medlemmer/actions.ts`

**Interfaces:**
- Consumes: `createClient()` (`lib/supabase/server.ts`), `createServiceClient()` (`lib/supabase/service.ts`).
- Produces: the `/admin/medlemmer` route.

- [ ] **Step 1: Create-member server action, with an explicit admin check**

```ts
// app/admin/medlemmer/actions.ts
"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export async function opprettMedlem(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/logg-inn");
  }

  // Explicit check required here: this action calls the service-role
  // client below, which bypasses RLS entirely. Unlike the family-code
  // form (which is safe relying on RLS alone via the session-scoped
  // client), skipping this check would let any authenticated or guest
  // caller create arbitrary accounts.
  const { data: callerProfile } = await supabase
    .from("profiles")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();

  if (callerProfile?.role !== "admin") {
    redirect("/tre");
  }

  const email = String(formData.get("email") ?? "").trim();
  const fornavn = String(formData.get("fornavn") ?? "").trim();
  const etternavn = String(formData.get("etternavn") ?? "").trim();
  const passord = String(formData.get("passord") ?? "");
  const rolle = formData.get("rolle") === "admin" ? "admin" : "member";

  if (!email || !fornavn || !etternavn || !passord) {
    redirect("/admin/medlemmer?feil=mangler-felt");
  }

  const service = createServiceClient();
  const { data: created, error: createError } = await service.auth.admin.createUser({
    email,
    password: passord,
    email_confirm: true,
  });

  if (createError || !created.user) {
    redirect("/admin/medlemmer?feil=opprettelse-feilet");
  }

  const { error: profileError } = await service.from("profiles").insert({
    user_id: created.user.id,
    email,
    first_name: fornavn,
    last_name: etternavn,
    role: rolle,
  });

  if (profileError) {
    redirect("/admin/medlemmer?feil=opprettelse-feilet");
  }

  redirect("/admin/medlemmer?opprettet=1");
}
```

- [ ] **Step 2: List + create page**

```tsx
// app/admin/medlemmer/page.tsx
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { opprettMedlem } from "./actions";

export default async function MedlemmerPage({
  searchParams,
}: {
  searchParams: Promise<{ feil?: string; opprettet?: string }>;
}) {
  const { feil, opprettet } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/logg-inn");
  }

  const { data: callerProfile } = await supabase
    .from("profiles")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();

  if (callerProfile?.role !== "admin") {
    redirect("/tre");
  }

  const { data: medlemmer } = await supabase
    .from("profiles")
    .select("user_id, email, first_name, last_name, role")
    .order("last_name", { ascending: true });

  return (
    <main className="flex flex-1 justify-center px-4 py-16">
      <div className="w-full max-w-2xl">
        <h1 className="font-serif text-2xl font-medium tracking-tight text-foreground sm:text-3xl">
          Medlemmer
        </h1>
        <p className="mt-2 text-sm text-muted">
          Opprett og se faste medlemmer av Vavik Familietre.
        </p>

        <section className="mt-8 rounded-2xl border border-line bg-surface p-8 shadow-sm">
          <h2 className="font-serif text-lg font-medium tracking-tight text-foreground">
            Eksisterende medlemmer
          </h2>
          <ul className="mt-4 flex flex-col gap-2">
            {(medlemmer ?? []).map((medlem) => (
              <li
                key={medlem.user_id}
                className="flex items-center justify-between rounded-lg border border-line bg-background px-4 py-3 text-sm"
              >
                <span className="text-foreground">
                  {medlem.first_name} {medlem.last_name}{" "}
                  <span className="text-muted">({medlem.email})</span>
                </span>
                <span className="rounded-full border border-line px-2.5 py-0.5 text-xs font-medium text-muted">
                  {medlem.role === "admin" ? "Administrator" : "Medlem"}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-8 rounded-2xl border border-line bg-surface p-8 shadow-sm">
          <h2 className="font-serif text-lg font-medium tracking-tight text-foreground">
            Opprett nytt medlem
          </h2>

          {opprettet === "1" && (
            <p className="mt-4 flex items-start gap-2 rounded-lg border border-accent/30 bg-accent-soft px-4 py-3 text-sm text-accent-hover">
              <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true" className="mt-0.5 shrink-0">
                <path d="M5.5 10.5L8.5 13.5L14.5 6.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span>Medlemmet er opprettet.</span>
            </p>
          )}
          {feil === "mangler-felt" && (
            <p className="mt-4 flex items-start gap-2 rounded-lg border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">
              <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true" className="mt-0.5 shrink-0">
                <circle cx="10" cy="10" r="7.25" stroke="currentColor" strokeWidth="1.6" />
                <path d="M10 6.5V10.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                <circle cx="10" cy="13.25" r="0.9" fill="currentColor" />
              </svg>
              <span>Du må fylle ut alle feltene.</span>
            </p>
          )}
          {feil === "opprettelse-feilet" && (
            <p className="mt-4 flex items-start gap-2 rounded-lg border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">
              <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true" className="mt-0.5 shrink-0">
                <circle cx="10" cy="10" r="7.25" stroke="currentColor" strokeWidth="1.6" />
                <path d="M10 6.5V10.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                <circle cx="10" cy="13.25" r="0.9" fill="currentColor" />
              </svg>
              <span>Kunne ikke opprette medlemmet. Sjekk at e-posten ikke er i bruk.</span>
            </p>
          )}

          <form action={opprettMedlem} className="mt-4 flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="email" className="text-sm font-medium text-foreground">
                E-postadresse
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                className="w-full rounded-lg border border-line bg-background px-3.5 py-2.5 text-foreground placeholder:text-muted/70 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40"
              />
            </div>
            <div className="flex gap-4">
              <div className="flex flex-1 flex-col gap-1.5">
                <label htmlFor="fornavn" className="text-sm font-medium text-foreground">
                  Fornavn
                </label>
                <input
                  id="fornavn"
                  name="fornavn"
                  type="text"
                  required
                  className="w-full rounded-lg border border-line bg-background px-3.5 py-2.5 text-foreground placeholder:text-muted/70 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40"
                />
              </div>
              <div className="flex flex-1 flex-col gap-1.5">
                <label htmlFor="etternavn" className="text-sm font-medium text-foreground">
                  Etternavn
                </label>
                <input
                  id="etternavn"
                  name="etternavn"
                  type="text"
                  required
                  className="w-full rounded-lg border border-line bg-background px-3.5 py-2.5 text-foreground placeholder:text-muted/70 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40"
                />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="passord" className="text-sm font-medium text-foreground">
                Passord
              </label>
              <input
                id="passord"
                name="passord"
                type="password"
                required
                autoComplete="new-password"
                className="w-full rounded-lg border border-line bg-background px-3.5 py-2.5 text-foreground placeholder:text-muted/70 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="rolle" className="text-sm font-medium text-foreground">
                Rolle
              </label>
              <select
                id="rolle"
                name="rolle"
                defaultValue="member"
                className="w-full rounded-lg border border-line bg-background px-3.5 py-2.5 text-foreground focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40"
              >
                <option value="member">Medlem</option>
                <option value="admin">Administrator</option>
              </select>
            </div>
            <button
              type="submit"
              className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              Opprett medlem
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
```

- [ ] **Step 3: Add a link to the dashboard from `/tre` for admins**

In `app/tre/page.tsx`, inside the existing `{isAdmin && (...)}` block, add a link near the "Sett familiekode" section (before or after it) to `/admin/medlemmer`:

```tsx
<a
  href="/admin/medlemmer"
  className="mt-4 inline-block text-sm font-medium text-accent underline underline-offset-2 hover:text-accent-hover"
>
  Administrer medlemmer
</a>
```

Place this as a sibling right after the closing `</section>` of the "Sett familiekode" block (still inside the `{isAdmin && (...)}` conditional), so it only shows for admins.

- [ ] **Step 4: Verify it compiles**

```bash
bunx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add app/admin app/tre/page.tsx
git commit -m "Add admin member dashboard (create and list)"
```

---

### Task 4: Set the bootstrap admin's password (controller-performed, not a subagent task)

This step is performed directly by the controller (you, if executing this plan in the same session that has Supabase MCP access), not delegated to a subagent, so the generated password is not written into any subagent report file.

- [ ] **Step 1: Generate and set a password for the existing bootstrap admin account**

```bash
cat > /tmp/set-admin-password.ts << 'EOF'
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const { data: users } = await supabase.auth.admin.listUsers();
const admin = users.users.find(u => u.email === "eirik.vavik@hotmail.no");
if (!admin) { console.error("admin user not found"); process.exit(1); }

const password = randomBytes(12).toString("base64url");
const { error } = await supabase.auth.admin.updateUserById(admin.id, { password });
if (error) { console.error("ERROR:", error.message); process.exit(1); }

console.log("PASSWORD:", password);
EOF
bun run --env-file=.env.local /tmp/set-admin-password.ts
```

- [ ] **Step 2: Relay the password to the product owner directly in chat** (not written to any committed file or report), and confirm they can sign in with it at `/logg-inn`.

---

### Task 5: End-to-end verification

**Files:** none.

- [ ] **Step 1: Verify password sign-in locally and/or against production**

Sign in at `/logg-inn` with the bootstrap admin's email and the password from Task 4. Confirm landing on `/tre` as Administrator.

- [ ] **Step 2: Verify wrong-password rejection**

Attempt sign-in with the correct email and a wrong password. Confirm the Norwegian error message and no session created.

- [ ] **Step 3: Verify member creation**

As the admin, go to `/admin/medlemmer`, create a test member (a real or throwaway email you control, e.g. a `+test` alias), confirm it appears in the list, then sign in as that member at `/logg-inn` with the password set for them. Confirm they land on `/tre` as "Medlem" (not Administrator, unless you chose admin role), and that `/admin/medlemmer` redirects them to `/tre` (non-admins can't reach it).

- [ ] **Step 4: Verify the explicit admin check, not just RLS**

Confirm (by reading the code, or by testing directly if practical) that `opprettMedlem` rejects a non-admin caller via its own explicit check — this is the one action in the app that must not rely on RLS alone.

- [ ] **Step 5: Confirm guest access is unaffected**

Visit `/gjest`, enter the existing family code, confirm the guest flow still works exactly as before (this change should not have touched anything guest-related).

- [ ] **Step 6: Report results plainly**, including whether this was tested locally, in production, or both, and clean up any test member account created in Step 3 if it was just for testing.

---

## Self-Review Notes

- **Spec coverage:** every requirement from the design doc (§3 schema, §4 auth, §5 dashboard, §6 acceptance criteria) maps to a task: Task 1 (schema), Task 2 (password auth), Task 3 (dashboard), Task 4 (bootstrap password), Task 5 (verification covers all of §6's acceptance criteria).
- **Placeholder scan:** no TBD/TODO; all code is complete and literal.
- **Type consistency:** `createClient()` always awaited; `createServiceClient()` used synchronously, matching the established signatures from the prior plan. `opprettMedlem`'s form field names (`email`, `fornavn`, `etternavn`, `passord`, `rolle`) match between the action and the page's `<input name=...>` attributes.
