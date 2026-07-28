# Phase 4b: Editing via Floating Action Bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admins build out the real family tree from the canvas — add father/mother/sibling/partner/child off a selected person via a floating bottom action bar, edit personal info and biography in a redesigned two-tab sidebar, and delete a person (blocked if it would disconnect the tree). Members get a narrower capability: editing a person's biography only.

**Architecture:** New Postgres RPCs (`create_related_person`, `delete_person`, `update_person_biography`) do the multi-row, permission-gated mutations atomically; RLS on `people`/`relationships` is tightened to admin-only for INSERT/UPDATE, with the biography RPC as the one member-accessible path. A pure `checkDeleteConnectivity` function (unit-tested) decides whether a delete is safe. New client components (`ActionBar`, `AddRelationshipDialog`, `DeletePersonDialog`) drive the new server actions in `app/tre-slekt/actions.ts`; `DetailPanel` is rewritten as a two-tab sidebar. Every mutation calls `router.refresh()`, and `FamilyTreeCanvas` is extended to re-sync its nodes/edges whenever the refreshed `people`/`relationships` props change. See `docs/superpowers/specs/2026-07-28-editing-floating-action-bar-design.md` for the full design.

**Tech Stack:** Next.js 16 canary (Server Actions), Supabase (Postgres/RLS, security-definer RPCs), React Flow, Dagre, Bun — all unchanged from prior phases.

## Global Constraints

- 100% Norwegian UI text; code/comments in English.
- `bunx tsc --noEmit`, `bun test`, and `bun run lint` must all be clean at the end of every task.
- This project uses Bun — `bun install`, `bunx <pkg>`, never npm/yarn/pnpm.
- Migration filenames get server-assigned versions from `mcp__supabase__apply_migration` — always call `mcp__supabase__list_migrations` after applying and name the local `.sql` file with the real returned version, never a guessed timestamp.
- Nodes must never be draggable, for guest, member, or admin alike (unchanged from Phase 4a — no task here touches `nodesDraggable`).
- Soft-deletion only, everywhere — no hard `DELETE` anywhere in this feature, including inside RPCs. Deleting a person sets `deleted_at`/`deleted_by` on the person and on their relationships; it never issues a SQL `DELETE`.
- The tree must always remain a single connected component (or empty) — there is no "create a stand-alone person" action anywhere in this feature, and deleting a person is refused (not cascaded) if it would disconnect anyone else from the rest of the tree.
- Permissions are enforced at the RLS layer, not just hidden in the UI: admins can create people/relationships, edit personal info, and delete; members can only edit biography (via `update_person_biography`); guests are read-only. Every server action also re-checks the caller's role explicitly, matching the pattern already used in `app/admin/medlemmer/actions.ts`.

---

### Task 1: Data model — `birth_family_name`, admin-only RLS, and the three RPCs

**Files:**
- Create: `supabase/migrations/<server-assigned-version>_editing_permissions_and_rpcs.sql`
- Modify: `lib/family-tree/data.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `Person.birth_family_name: string | null` (on the `Person` type and in `getFamilyTreeData()`'s select). Three new Postgres functions callable via `supabase.rpc(...)`: `create_related_person(p_given_name, p_family_name, p_gender, p_edges)` → returns the new person's `uuid`; `update_person_biography(p_person_id, p_biography)` → `void`; `delete_person(p_person_id)` → `void`. A new `app_is_admin()` SQL helper.

- [ ] **Step 1: Apply the migration**

Use `mcp__supabase__apply_migration` with this SQL, then `mcp__supabase__list_migrations` to get the real assigned version, then write the local file at `supabase/migrations/<that-version>_editing_permissions_and_rpcs.sql`:

```sql
-- Phase 4b: editing via floating action bar.

-- 1. Surname at birth (fødselsnavn) — shown/edited in the personal info tab.
alter table people add column birth_family_name text;

-- 2. Admin-only helper, distinct from app_is_member_or_admin() (which only
-- checks for an active profile, not a specific role).
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
      and status = 'active'
      and role = 'admin'
  );
$$;

-- 3. Tighten people/relationships INSERT and UPDATE to admin-only. Editing
-- (Phase 4b) is an admin-only capability except for biography text, which
-- members reach through update_person_biography() below instead.
drop policy "people_insert_member_or_admin" on people;
create policy "people_insert_admin"
  on people for insert
  to authenticated
  with check (app_is_admin());

drop policy "people_update_member_or_admin" on people;
create policy "people_update_admin"
  on people for update
  to authenticated
  using (app_is_admin())
  with check (app_is_admin());

drop policy "relationships_insert_member_or_admin" on relationships;
create policy "relationships_insert_admin"
  on relationships for insert
  to authenticated
  with check (app_is_admin());

drop policy "relationships_update_member_or_admin" on relationships;
create policy "relationships_update_admin"
  on relationships for update
  to authenticated
  using (app_is_admin())
  with check (app_is_admin());

-- 4. Biography-only path for members: a security-definer RPC that checks
-- the caller itself (member or admin) rather than relying on the
-- now-admin-only table policy above, and only ever touches the biography
-- column (plus bookkeeping columns). Admins also use this RPC for
-- biography edits.
create or replace function update_person_biography(p_person_id uuid, p_biography text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not app_is_member_or_admin() then
    raise exception 'Not authorized';
  end if;

  update people
  set biography = p_biography,
      updated_at = now(),
      updated_by = auth.uid(),
      version = version + 1
  where id = p_person_id
    and deleted_at is null;

  if not found then
    raise exception 'Person not found';
  end if;
end;
$$;

grant execute on function update_person_biography(uuid, text) to authenticated;

-- 5. Atomic "create a person and link them to the tree" RPC. Takes a JSON
-- array of edges so the caller (a TypeScript server action) can decide how
-- many relationships to create — one for father/mother/partner/child, one
-- per existing parent for sibling — while the person and all of their
-- relationships are still inserted in a single transaction. p_edges shape:
-- [{ "other_person_id": uuid, "relationship_type": text, "new_person_is_a": boolean }]
-- new_person_is_a = true means the new person is person_a (the parent) in
-- that edge; false means the new person is person_b (the child/partner).
create or replace function create_related_person(
  p_given_name text,
  p_family_name text,
  p_gender gender,
  p_edges jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
  edge jsonb;
begin
  if not app_is_admin() then
    raise exception 'Not authorized';
  end if;

  insert into people (given_name, family_name, gender, is_living, created_by, updated_by)
  values (p_given_name, p_family_name, p_gender, true, auth.uid(), auth.uid())
  returning id into new_id;

  for edge in select * from jsonb_array_elements(p_edges)
  loop
    if (edge->>'new_person_is_a')::boolean then
      insert into relationships (person_a_id, person_b_id, relationship_type, created_by, updated_by)
      values (new_id, (edge->>'other_person_id')::uuid, (edge->>'relationship_type')::relationship_type, auth.uid(), auth.uid());
    else
      insert into relationships (person_a_id, person_b_id, relationship_type, created_by, updated_by)
      values ((edge->>'other_person_id')::uuid, new_id, (edge->>'relationship_type')::relationship_type, auth.uid(), auth.uid());
    end if;
  end loop;

  return new_id;
end;
$$;

grant execute on function create_related_person(text, text, gender, jsonb) to authenticated;

-- 6. Atomic "soft-delete a person and all their active relationships" RPC.
-- The caller (a TypeScript server action) is responsible for running the
-- connectivity check BEFORE calling this — this function does not check
-- connectivity itself, it just performs the delete once the caller has
-- decided it's safe.
create or replace function delete_person(p_person_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not app_is_admin() then
    raise exception 'Not authorized';
  end if;

  update relationships
  set deleted_at = now(), deleted_by = auth.uid()
  where (person_a_id = p_person_id or person_b_id = p_person_id)
    and deleted_at is null;

  update people
  set deleted_at = now(), deleted_by = auth.uid()
  where id = p_person_id
    and deleted_at is null;
end;
$$;

grant execute on function delete_person(uuid) to authenticated;
```

- [ ] **Step 2: Add `birth_family_name` to the `Person` type and the select query**

Replace `lib/family-tree/data.ts` in full:

```ts
import { createClient } from "@/lib/supabase/server";

export type Person = {
  id: string;
  given_name: string;
  family_name: string;
  birth_family_name: string | null;
  gender: "male" | "female" | "unknown";
  is_living: boolean;
  birth_date_display: string | null;
  death_date_display: string | null;
  biography: string | null;
  birth_place: string | null;
  death_place: string | null;
};

export type Relationship = {
  id: string;
  person_a_id: string;
  person_b_id: string;
  relationship_type:
    | "biological_parent"
    | "adoptive_parent"
    | "foster_parent"
    | "guardian_parent"
    | "spouse"
    | "former_spouse"
    | "partner"
    | "former_partner";
};

export async function getFamilyTreeData() {
  const supabase = await createClient();

  const [peopleResult, relationshipsResult] = await Promise.all([
    supabase
      .from("people")
      .select(
        "id, given_name, family_name, birth_family_name, gender, is_living, birth_date_display, death_date_display, biography, birth_place, death_place"
      )
      .is("deleted_at", null),
    supabase
      .from("relationships")
      .select("id, person_a_id, person_b_id, relationship_type")
      .is("deleted_at", null),
  ]);

  if (peopleResult.error) throw new Error(peopleResult.error.message);
  if (relationshipsResult.error) throw new Error(relationshipsResult.error.message);

  return {
    people: (peopleResult.data ?? []) as Person[],
    relationships: (relationshipsResult.data ?? []) as Relationship[],
  };
}
```

- [ ] **Step 3: Verify**

```bash
bunx tsc --noEmit
bun test
bun run lint
```

Also run `mcp__supabase__get_advisors` (type `security`) and confirm no new advisories were introduced by this migration.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations lib/family-tree/data.ts
git commit -m "Add birth_family_name, admin-only editing RLS, and editing RPCs"
```

---

### Task 2: Delete-connectivity check (pure function + tests)

**Files:**
- Create: `lib/family-tree/connectivity.ts`
- Test: `lib/family-tree/connectivity.test.ts`

**Interfaces:**
- Consumes: `Person`, `Relationship` from `./data` (Task 1).
- Produces: `checkDeleteConnectivity(people: Person[], relationships: Relationship[], personId: string): ConnectivityCheckResult` where `ConnectivityCheckResult = { safe: true } | { safe: false; disconnectedPeople: Person[] }`.

- [ ] **Step 1: Write the failing tests**

Create `lib/family-tree/connectivity.test.ts`:

```ts
import { test, expect } from "bun:test";
import { checkDeleteConnectivity } from "./connectivity";
import type { Person, Relationship } from "./data";

function makePerson(id: string, givenName: string): Person {
  return {
    id,
    given_name: givenName,
    family_name: "Vavik",
    birth_family_name: null,
    gender: "unknown",
    is_living: true,
    birth_date_display: null,
    death_date_display: null,
    biography: null,
    birth_place: null,
    death_place: null,
  };
}

function makeRelationship(
  id: string,
  personAId: string,
  personBId: string,
  type: Relationship["relationship_type"] = "biological_parent"
): Relationship {
  return { id, person_a_id: personAId, person_b_id: personBId, relationship_type: type };
}

test("allows deleting a person with no relationships", () => {
  const alice = makePerson("alice", "Alice");
  const result = checkDeleteConnectivity([alice], [], "alice");
  expect(result.safe).toBe(true);
});

test("allows deleting a leaf person (no children of their own)", () => {
  const grandparent = makePerson("grandparent", "Grandparent");
  const parent = makePerson("parent", "Parent");
  const child = makePerson("child", "Child");
  const people = [grandparent, parent, child];
  const relationships = [
    makeRelationship("r1", "grandparent", "parent"),
    makeRelationship("r2", "parent", "child"),
  ];

  const result = checkDeleteConnectivity(people, relationships, "child");
  expect(result.safe).toBe(true);
});

test("blocks deleting a bridging person and reports who'd be disconnected", () => {
  const grandparent = makePerson("grandparent", "Grandparent");
  const parent = makePerson("parent", "Parent");
  const me = makePerson("me", "Me");
  const people = [grandparent, parent, me];
  const relationships = [
    makeRelationship("r1", "grandparent", "parent"),
    makeRelationship("r2", "parent", "me"),
  ];

  const result = checkDeleteConnectivity(people, relationships, "parent");
  expect(result.safe).toBe(false);
  if (!result.safe) {
    expect(result.disconnectedPeople.map((p) => p.id)).toEqual(["grandparent"]);
  }
});

test("keeps the larger branch and flags the smaller one on a two-branch split", () => {
  // hub -- a1 -- a2
  // hub -- b1
  const hub = makePerson("hub", "Hub");
  const a1 = makePerson("a1", "A1");
  const a2 = makePerson("a2", "A2");
  const b1 = makePerson("b1", "B1");
  const people = [hub, a1, a2, b1];
  const relationships = [
    makeRelationship("r1", "hub", "a1"),
    makeRelationship("r2", "a1", "a2"),
    makeRelationship("r3", "hub", "b1"),
  ];

  const result = checkDeleteConnectivity(people, relationships, "hub");
  expect(result.safe).toBe(false);
  if (!result.safe) {
    expect(result.disconnectedPeople.map((p) => p.id).sort()).toEqual(["b1"]);
  }
});

test("allows deleting one of two parents who share a child (redundant connection remains)", () => {
  const father = makePerson("father", "Father");
  const mother = makePerson("mother", "Mother");
  const child = makePerson("child", "Child");
  const people = [father, mother, child];
  const relationships = [
    makeRelationship("r1", "father", "child"),
    makeRelationship("r2", "mother", "child"),
  ];

  const result = checkDeleteConnectivity(people, relationships, "father");
  expect(result.safe).toBe(true);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
bun test lib/family-tree/connectivity.test.ts
```

Expected: FAIL — `connectivity.ts` doesn't exist yet.

- [ ] **Step 3: Implement `checkDeleteConnectivity`**

Create `lib/family-tree/connectivity.ts`:

```ts
import type { Person, Relationship } from "./data";

export type ConnectivityCheckResult =
  | { safe: true }
  | { safe: false; disconnectedPeople: Person[] };

/**
 * Checks whether removing `personId` (and their relationships) from the
 * tree would split the remaining people into more than one connected
 * component. If so, returns the people in every component except the
 * largest one — the group that would lose contact with the rest of the
 * tree, and so should be deleted first.
 */
export function checkDeleteConnectivity(
  people: Person[],
  relationships: Relationship[],
  personId: string
): ConnectivityCheckResult {
  const remainingPeople = people.filter((p) => p.id !== personId);
  const remainingIds = new Set(remainingPeople.map((p) => p.id));

  const adjacency = new Map<string, Set<string>>();
  for (const id of remainingIds) adjacency.set(id, new Set());

  for (const rel of relationships) {
    if (rel.person_a_id === personId || rel.person_b_id === personId) continue;
    if (!remainingIds.has(rel.person_a_id) || !remainingIds.has(rel.person_b_id)) continue;
    adjacency.get(rel.person_a_id)!.add(rel.person_b_id);
    adjacency.get(rel.person_b_id)!.add(rel.person_a_id);
  }

  const visited = new Set<string>();
  const components: string[][] = [];

  for (const id of remainingIds) {
    if (visited.has(id)) continue;
    const component: string[] = [];
    const queue = [id];
    visited.add(id);
    while (queue.length > 0) {
      const current = queue.shift()!;
      component.push(current);
      for (const neighbor of adjacency.get(current)!) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
    components.push(component);
  }

  if (components.length <= 1) {
    return { safe: true };
  }

  components.sort((a, b) => b.length - a.length);
  const disconnectedIds = new Set(components.slice(1).flat());
  const peopleById = new Map(remainingPeople.map((p) => [p.id, p]));
  const disconnectedPeople = [...disconnectedIds].map((id) => peopleById.get(id)!);

  return { safe: false, disconnectedPeople };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
bun test lib/family-tree/connectivity.test.ts
```

Expected: all 5 tests PASS.

- [ ] **Step 5: Verify the whole project**

```bash
bunx tsc --noEmit
bun test
bun run lint
```

- [ ] **Step 6: Commit**

```bash
git add lib/family-tree/connectivity.ts lib/family-tree/connectivity.test.ts
git commit -m "Add pure delete-connectivity check with tests"
```

---

### Task 3: Server action — `createRelatedPerson`

**Files:**
- Create: `app/tre-slekt/actions.ts`

**Interfaces:**
- Consumes: `create_related_person` RPC (Task 1); `Person`, `Relationship` types (Task 1).
- Produces: `createRelatedPerson(input): Promise<{ ok: true; newPersonId: string } | { ok: false; error: string }>` where `input: { selectedPersonId: string; kind: "father" | "mother" | "sibling" | "partner" | "child"; givenName: string; familyName: string; gender: "male" | "female" | "unknown"; relationshipType: string }`. `relationshipType` is ignored when `kind === "sibling"` (it's derived from the selected person's existing parent links instead).

- [ ] **Step 1: Create `app/tre-slekt/actions.ts` with `createRelatedPerson`**

```ts
"use server";

import { createClient } from "@/lib/supabase/server";
import type { Relationship } from "@/lib/family-tree/data";

const PARENT_RELATIONSHIP_TYPES = new Set<Relationship["relationship_type"]>([
  "biological_parent",
  "adoptive_parent",
  "foster_parent",
  "guardian_parent",
]);

type RelationKind = "father" | "mother" | "sibling" | "partner" | "child";

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "Ikke logget inn." };

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();

  if (profile?.role !== "admin") {
    return { ok: false as const, error: "Kun administratorer kan gjøre dette." };
  }

  return { ok: true as const, supabase };
}

export async function createRelatedPerson(input: {
  selectedPersonId: string;
  kind: RelationKind;
  givenName: string;
  familyName: string;
  gender: "male" | "female" | "unknown";
  relationshipType: string;
}): Promise<{ ok: true; newPersonId: string } | { ok: false; error: string }> {
  const authCheck = await requireAdmin();
  if (!authCheck.ok) return authCheck;
  const { supabase } = authCheck;

  const givenName = input.givenName.trim();
  const familyName = input.familyName.trim();
  if (!givenName || !familyName) {
    return { ok: false, error: "Fornavn og etternavn må fylles ut." };
  }

  type Edge = { other_person_id: string; relationship_type: string; new_person_is_a: boolean };
  let edges: Edge[];

  if (input.kind === "father" || input.kind === "mother") {
    // New person is the parent (person_a); the selected person is the child (person_b).
    edges = [{ other_person_id: input.selectedPersonId, relationship_type: input.relationshipType, new_person_is_a: true }];
  } else if (input.kind === "child") {
    // Selected person is the parent (person_a); the new person is the child (person_b).
    edges = [{ other_person_id: input.selectedPersonId, relationship_type: input.relationshipType, new_person_is_a: false }];
  } else if (input.kind === "partner") {
    edges = [{ other_person_id: input.selectedPersonId, relationship_type: input.relationshipType, new_person_is_a: false }];
  } else {
    // sibling: link the new person as a child of each of the selected
    // person's existing active parents, mirroring that parent link's type.
    const { data: parentLinks, error: parentError } = await supabase
      .from("relationships")
      .select("person_a_id, relationship_type")
      .eq("person_b_id", input.selectedPersonId)
      .in("relationship_type", [...PARENT_RELATIONSHIP_TYPES])
      .is("deleted_at", null);

    if (parentError) {
      return { ok: false, error: "Kunne ikke hente foreldre." };
    }
    if (!parentLinks || parentLinks.length === 0) {
      return { ok: false, error: "Personen har ingen registrerte foreldre å knytte søsken til." };
    }

    edges = parentLinks.map((link) => ({
      other_person_id: link.person_a_id,
      relationship_type: link.relationship_type,
      new_person_is_a: false,
    }));
  }

  const { data: newPersonId, error } = await supabase.rpc("create_related_person", {
    p_given_name: givenName,
    p_family_name: familyName,
    p_gender: input.gender,
    p_edges: edges,
  });

  if (error || !newPersonId) {
    return { ok: false, error: "Kunne ikke opprette personen." };
  }

  return { ok: true, newPersonId: newPersonId as string };
}
```

- [ ] **Step 2: Verify**

```bash
bunx tsc --noEmit
bun test
bun run lint
```

There's no UI wired up yet, so this can't be exercised manually until Task 6 — type-checking clean is the bar for this task.

- [ ] **Step 3: Commit**

```bash
git add app/tre-slekt/actions.ts
git commit -m "Add createRelatedPerson server action"
```

---

### Task 4: Server actions — `updatePersonInfo`, `updatePersonBiography`, `deletePerson`

**Files:**
- Modify: `app/tre-slekt/actions.ts`

**Interfaces:**
- Consumes: `requireAdmin()` helper (Task 3); `update_person_biography` and `delete_person` RPCs (Task 1); `checkDeleteConnectivity` (Task 2); `getFamilyTreeData` (Task 1).
- Produces: `updatePersonInfo(input): Promise<{ ok: true } | { ok: false; error: string }>`; `updatePersonBiography(input): Promise<{ ok: true } | { ok: false; error: string }>` (member-or-admin, not admin-only); `deletePerson(personId: string): Promise<{ ok: true } | { ok: false; error: string }>`.

- [ ] **Step 1: Add the three actions to `app/tre-slekt/actions.ts`**

Add this import at the top, alongside the existing ones:

```ts
import { getFamilyTreeData } from "@/lib/family-tree/data";
import { checkDeleteConnectivity } from "@/lib/family-tree/connectivity";
```

Append to the end of the file:

```ts
export async function updatePersonInfo(input: {
  personId: string;
  givenName: string;
  familyName: string;
  birthFamilyName: string;
  gender: "male" | "female" | "unknown";
  birthDateDisplay: string;
  isLiving: boolean;
  deathDateDisplay: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const authCheck = await requireAdmin();
  if (!authCheck.ok) return authCheck;
  const { supabase } = authCheck;

  const givenName = input.givenName.trim();
  const familyName = input.familyName.trim();
  if (!givenName || !familyName) {
    return { ok: false, error: "Fornavn og etternavn må fylles ut." };
  }

  const { error } = await supabase
    .from("people")
    .update({
      given_name: givenName,
      family_name: familyName,
      birth_family_name: input.birthFamilyName.trim() || null,
      gender: input.gender,
      birth_date_display: input.birthDateDisplay.trim() || null,
      is_living: input.isLiving,
      death_date_display: input.isLiving ? null : input.deathDateDisplay.trim() || null,
    })
    .eq("id", input.personId);

  if (error) {
    return { ok: false, error: "Kunne ikke lagre personinfo." };
  }

  return { ok: true };
}

export async function updatePersonBiography(input: {
  personId: string;
  biography: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Ikke logget inn." };

  const { error } = await supabase.rpc("update_person_biography", {
    p_person_id: input.personId,
    p_biography: input.biography.trim() || null,
  });

  if (error) {
    return { ok: false, error: "Kunne ikke lagre biografien." };
  }

  return { ok: true };
}

export async function deletePerson(personId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const authCheck = await requireAdmin();
  if (!authCheck.ok) return authCheck;
  const { supabase } = authCheck;

  const { people, relationships } = await getFamilyTreeData();
  const target = people.find((p) => p.id === personId);
  if (!target) {
    return { ok: false, error: "Fant ikke personen." };
  }

  const check = checkDeleteConnectivity(people, relationships, personId);
  if (!check.safe) {
    const names = check.disconnectedPeople.map((p) => `${p.given_name} ${p.family_name}`).join(", ");
    return {
      ok: false,
      error: `Kan ikke slette ${target.given_name} ${target.family_name} — ${names} ville da miste kontakt med resten av treet. Slett dem først.`,
    };
  }

  const { error } = await supabase.rpc("delete_person", { p_person_id: personId });
  if (error) {
    return { ok: false, error: "Sletting feilet." };
  }

  return { ok: true };
}
```

- [ ] **Step 2: Verify**

```bash
bunx tsc --noEmit
bun test
bun run lint
```

- [ ] **Step 3: Commit**

```bash
git add app/tre-slekt/actions.ts
git commit -m "Add updatePersonInfo, updatePersonBiography, deletePerson server actions"
```

---

### Task 5: Sidebar redesign — two-tab `DetailPanel`, and canvas re-sync on data change

**Files:**
- Modify: `app/tre-slekt/detail-panel.tsx`
- Modify: `app/tre-slekt/canvas.tsx`

**Interfaces:**
- Consumes: `updatePersonInfo`, `updatePersonBiography` (Task 4); `Person`, `Relationship` (Task 1).
- Produces: `DetailPanel` props become `{ person, relationships, peopleById, canEdit, isAdmin, onClose, onSelectPerson }` (drops `mode`/`onExpand`). `FamilyTreeCanvas`'s `selectedPersonId` state (no more `panelMode`).

- [ ] **Step 1: Rewrite `DetailPanel` as a two-tab sidebar**

Replace `app/tre-slekt/detail-panel.tsx` in full:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Person, Relationship } from "@/lib/family-tree/data";
import { updatePersonInfo, updatePersonBiography } from "./actions";

const RELATIONSHIP_LABEL_NO: Record<Relationship["relationship_type"], { asParent: string; asChild: string }> = {
  biological_parent: { asParent: "forelder", asChild: "barn" },
  adoptive_parent: { asParent: "adoptivforelder", asChild: "adoptivbarn" },
  foster_parent: { asParent: "fosterforelder", asChild: "fosterbarn" },
  guardian_parent: { asParent: "verge", asChild: "myndling" },
  spouse: { asParent: "ektefelle", asChild: "ektefelle" },
  former_spouse: { asParent: "tidligere ektefelle", asChild: "tidligere ektefelle" },
  partner: { asParent: "partner", asChild: "partner" },
  former_partner: { asParent: "tidligere partner", asChild: "tidligere partner" },
};

const GENDER_LABEL_NO: Record<Person["gender"], string> = {
  male: "Mann",
  female: "Kvinne",
  unknown: "Ikke oppgitt",
};

export function DetailPanel({
  person,
  relationships,
  peopleById,
  canEdit,
  isAdmin,
  onClose,
  onSelectPerson,
}: {
  person: Person;
  relationships: Relationship[];
  peopleById: Map<string, Person>;
  canEdit: boolean;
  isAdmin: boolean;
  onClose: () => void;
  onSelectPerson: (personId: string) => void;
}) {
  const [tab, setTab] = useState<"info" | "bio">("info");

  const related = relationships
    .filter((r) => r.person_a_id === person.id || r.person_b_id === person.id)
    .map((r) => {
      const isA = r.person_a_id === person.id;
      const otherId = isA ? r.person_b_id : r.person_a_id;
      const other = peopleById.get(otherId);
      // person_a_id is the parent for parent/child relationship types (matches
      // the Dagre layout direction in lib/family-tree/layout.ts), so when the
      // viewed person IS person_a, the OTHER person is their child.
      const label = isA ? RELATIONSHIP_LABEL_NO[r.relationship_type].asChild : RELATIONSHIP_LABEL_NO[r.relationship_type].asParent;
      return other ? { other, label } : null;
    })
    .filter((x): x is { other: Person; label: string } => x !== null);

  return (
    <aside className="absolute right-0 top-0 h-full w-96 overflow-y-auto border-l border-line bg-surface p-6 shadow-lg">
      <button onClick={onClose} className="text-sm text-muted hover:text-foreground" aria-label="Lukk">
        Lukk ✕
      </button>
      <h2 className="mt-4 font-serif text-xl font-medium text-foreground">
        {person.given_name} {person.family_name}
      </h2>

      <div role="group" aria-label="Faner" className="mt-4 inline-flex gap-1 rounded-full border border-line bg-background p-1">
        <button
          onClick={() => setTab("info")}
          aria-pressed={tab === "info"}
          className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
            tab === "info" ? "bg-accent text-white shadow-sm" : "text-muted hover:text-foreground"
          }`}
        >
          Personinfo
        </button>
        <button
          onClick={() => setTab("bio")}
          aria-pressed={tab === "bio"}
          className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
            tab === "bio" ? "bg-accent text-white shadow-sm" : "text-muted hover:text-foreground"
          }`}
        >
          Biografi
        </button>
      </div>

      {tab === "info" ? (
        <PersonInfoTab person={person} isAdmin={isAdmin} related={related} onSelectPerson={onSelectPerson} />
      ) : (
        <BiographyTab person={person} canEdit={canEdit} />
      )}
    </aside>
  );
}

function PersonInfoTab({
  person,
  isAdmin,
  related,
  onSelectPerson,
}: {
  person: Person;
  isAdmin: boolean;
  related: { other: Person; label: string }[];
  onSelectPerson: (personId: string) => void;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [givenName, setGivenName] = useState(person.given_name);
  const [familyName, setFamilyName] = useState(person.family_name);
  const [birthFamilyName, setBirthFamilyName] = useState(person.birth_family_name ?? "");
  const [gender, setGender] = useState<Person["gender"]>(person.gender);
  const [birthDateDisplay, setBirthDateDisplay] = useState(person.birth_date_display ?? "");
  const [isLiving, setIsLiving] = useState(person.is_living);
  const [deathDateDisplay, setDeathDateDisplay] = useState(person.death_date_display ?? "");

  const handleCancel = () => {
    setGivenName(person.given_name);
    setFamilyName(person.family_name);
    setBirthFamilyName(person.birth_family_name ?? "");
    setGender(person.gender);
    setBirthDateDisplay(person.birth_date_display ?? "");
    setIsLiving(person.is_living);
    setDeathDateDisplay(person.death_date_display ?? "");
    setError(null);
    setEditing(false);
  };

  const handleSave = () => {
    setError(null);
    startTransition(async () => {
      const result = await updatePersonInfo({
        personId: person.id,
        givenName,
        familyName,
        birthFamilyName,
        gender,
        birthDateDisplay,
        isLiving,
        deathDateDisplay,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEditing(false);
      router.refresh();
    });
  };

  if (editing) {
    return (
      <div className="mt-4 flex flex-col gap-3">
        {error && <p className="text-sm text-error">{error}</p>}
        <label className="flex flex-col gap-1 text-sm">
          Fornavn
          <input
            value={givenName}
            onChange={(e) => setGivenName(e.target.value)}
            className="rounded-lg border border-line bg-background px-3 py-1.5 text-foreground"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Etternavn
          <input
            value={familyName}
            onChange={(e) => setFamilyName(e.target.value)}
            className="rounded-lg border border-line bg-background px-3 py-1.5 text-foreground"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Etternavn ved fødsel
          <input
            value={birthFamilyName}
            onChange={(e) => setBirthFamilyName(e.target.value)}
            className="rounded-lg border border-line bg-background px-3 py-1.5 text-foreground"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Kjønn
          <select
            value={gender}
            onChange={(e) => setGender(e.target.value as Person["gender"])}
            className="rounded-lg border border-line bg-background px-3 py-1.5 text-foreground"
          >
            <option value="male">Mann</option>
            <option value="female">Kvinne</option>
            <option value="unknown">Ikke oppgitt</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Fødselsdato
          <input
            value={birthDateDisplay}
            onChange={(e) => setBirthDateDisplay(e.target.value)}
            placeholder="f.eks. 12. mars 1955"
            className="rounded-lg border border-line bg-background px-3 py-1.5 text-foreground"
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={!isLiving} onChange={(e) => setIsLiving(!e.target.checked)} />
          Avdød
        </label>
        {!isLiving && (
          <label className="flex flex-col gap-1 text-sm">
            Dødsdato
            <input
              value={deathDateDisplay}
              onChange={(e) => setDeathDateDisplay(e.target.value)}
              placeholder="f.eks. 3. januar 2010"
              className="rounded-lg border border-line bg-background px-3 py-1.5 text-foreground"
            />
          </label>
        )}
        <div className="flex gap-2">
          <button
            onClick={handleSave}
            disabled={isPending}
            className="flex-1 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-60"
          >
            Lagre
          </button>
          <button
            onClick={handleCancel}
            disabled={isPending}
            className="flex-1 rounded-lg border border-line px-4 py-2 text-sm font-medium text-foreground hover:bg-background"
          >
            Avbryt
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-4 flex flex-col gap-1">
      {isAdmin && (
        <button
          onClick={() => setEditing(true)}
          className="mb-2 self-start rounded-lg border border-line px-3 py-1 text-xs font-medium text-foreground hover:bg-background"
        >
          Rediger
        </button>
      )}
      <p className="text-sm text-foreground">
        {person.given_name} {person.family_name}
      </p>
      {person.birth_family_name && <p className="text-sm text-muted">Født {person.birth_family_name}</p>}
      <p className="text-sm text-muted">{GENDER_LABEL_NO[person.gender]}</p>
      <p className="text-sm text-muted">
        {[person.birth_date_display, person.death_date_display].filter(Boolean).join(" – ") || "Ukjente datoer"}
      </p>
      <p className="text-sm text-muted">{person.is_living ? "Lever" : "Avdød"}</p>

      <h3 className="mt-6 text-sm font-medium text-foreground">Familie</h3>
      <ul className="mt-2 flex flex-col gap-1">
        {related.map(({ other, label }) => (
          <li key={other.id}>
            <button
              onClick={() => onSelectPerson(other.id)}
              className="text-sm text-accent underline underline-offset-2 hover:text-accent-hover"
            >
              {other.given_name} {other.family_name}
            </button>
            <span className="ml-1 text-xs text-muted">({label})</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function BiographyTab({ person, canEdit }: { person: Person; canEdit: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [biography, setBiography] = useState(person.biography ?? "");

  const handleCancel = () => {
    setBiography(person.biography ?? "");
    setError(null);
    setEditing(false);
  };

  const handleSave = () => {
    setError(null);
    startTransition(async () => {
      const result = await updatePersonBiography({ personId: person.id, biography });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEditing(false);
      router.refresh();
    });
  };

  if (editing) {
    return (
      <div className="mt-4 flex flex-col gap-3">
        {error && <p className="text-sm text-error">{error}</p>}
        <textarea
          value={biography}
          onChange={(e) => setBiography(e.target.value)}
          rows={12}
          className="rounded-lg border border-line bg-background px-3 py-2 text-sm text-foreground"
        />
        <div className="flex gap-2">
          <button
            onClick={handleSave}
            disabled={isPending}
            className="flex-1 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-60"
          >
            Lagre
          </button>
          <button
            onClick={handleCancel}
            disabled={isPending}
            className="flex-1 rounded-lg border border-line px-4 py-2 text-sm font-medium text-foreground hover:bg-background"
          >
            Avbryt
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-4 flex flex-col gap-2">
      {canEdit && (
        <button
          onClick={() => setEditing(true)}
          className="self-start rounded-lg border border-line px-3 py-1 text-xs font-medium text-foreground hover:bg-background"
        >
          Rediger
        </button>
      )}
      <p className="whitespace-pre-wrap text-sm text-foreground">{person.biography || "Ingen biografi ennå."}</p>
    </div>
  );
}
```

- [ ] **Step 2: Simplify selection state in `FamilyTreeCanvas` and drop the compact/full split**

In `app/tre-slekt/canvas.tsx`:

1. Remove the `panelMode` state line entirely:

```ts
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearchDropdown, setShowSearchDropdown] = useState(false);
```

2. Replace `handleNodeClick`, `handleNodeDoubleClick`, `handleClosePanel`, `handleExpandPanel`, `handleSelectPerson` with:

```ts
  const handleNodeClick = useCallback((_event: React.MouseEvent, node: Node) => {
    setSelectedPersonId(node.id);
  }, []);

  const handleClosePanel = useCallback(() => {
    setSelectedPersonId(null);
  }, []);

  const handleSelectPerson = useCallback((personId: string) => {
    setSelectedPersonId(personId);
  }, []);
```

3. On the `<ReactFlow>` element, remove the `onNodeDoubleClick={handleNodeDoubleClick}` prop (keep `onNodeClick={handleNodeClick}`).

4. Replace the `<DetailPanel>` render block at the bottom with:

```tsx
      {selectedPersonId && (
        <DetailPanel
          person={peopleById.get(selectedPersonId)!}
          relationships={relationships}
          peopleById={peopleById}
          canEdit={canEdit}
          isAdmin={isAdmin}
          onClose={handleClosePanel}
          onSelectPerson={handleSelectPerson}
        />
      )}
```

- [ ] **Step 3: Re-sync nodes/edges when `people`/`relationships` change, not just `orientation`**

In `app/tre-slekt/canvas.tsx`, update `OrientationEffectHandler` (rename its usage site is unchanged, only the function body/signature change) to also take `relationships` and depend on the `people`/`relationships` props themselves (not the locally-recomputed `dagreLayout`, which is a new object every render and would cause the effect to loop):

```tsx
function OrientationEffectHandler({
  people,
  relationships,
  orientation,
  dagreLayout,
  setNodes,
}: {
  people: Person[];
  relationships: Relationship[];
  orientation: "tb" | "lr";
  dagreLayout: Map<string, { x: number; y: number }>;
  setNodes: Dispatch<SetStateAction<Node[]>>;
}) {
  const reactFlow = useReactFlow();

  useEffect(() => {
    setNodes(
      people.map((person) => ({
        id: person.id,
        type: "person",
        position: dagreLayout.get(person.id) ?? { x: 0, y: 0 },
        data: { person },
      }))
    );
    void reactFlow.fitView({ duration: 500 });
    // Depends on the `people`/`relationships` PROPS (not `dagreLayout`,
    // which is recomputed fresh every render and would make this loop) —
    // their reference only changes when the server data actually changes
    // (via router.refresh()), or when the user toggles orientation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orientation, people, relationships]);

  return null;
}
```

And update its call site to pass `relationships`:

```tsx
        <OrientationEffectHandler
          people={people}
          relationships={relationships}
          orientation={orientation}
          dagreLayout={dagreLayout}
          setNodes={setNodes}
        />
```

- [ ] **Step 4: Verify**

```bash
bunx tsc --noEmit
bun test
bun run lint
```

Manually verify in the browser: clicking a person opens the sidebar with Personinfo/Biografi tabs; as admin, Personinfo has a "Rediger" button that opens an editable form, saves, and the change persists after reload; as admin, Biografi also has a working edit flow; toggling the "Avdød" checkbox while editing reveals/hides the death-date field.

- [ ] **Step 5: Commit**

```bash
git add app/tre-slekt/detail-panel.tsx app/tre-slekt/canvas.tsx
git commit -m "Rewrite DetailPanel as a two-tab sidebar with inline editing"
```

---

### Task 6: Floating action bar + add-relationship dialog

**Files:**
- Create: `app/tre-slekt/action-bar.tsx`
- Create: `app/tre-slekt/add-relationship-dialog.tsx`
- Modify: `app/tre-slekt/canvas.tsx`

**Interfaces:**
- Consumes: `createRelatedPerson` (Task 3); `selectedPersonId`/`peopleById`/`relationships` state (Task 5).
- Produces: `ActionBar` renders the 6 admin actions; `AddRelationshipDialog` creates a person via `createRelatedPerson` and reports the new id back via `onCreated`.

- [ ] **Step 1: Create `ActionBar`**

Create `app/tre-slekt/action-bar.tsx`:

```tsx
"use client";

import type { Person, Relationship } from "@/lib/family-tree/data";

type Kind = "father" | "mother" | "sibling" | "partner" | "child";

const PARENT_RELATIONSHIP_TYPES = new Set<Relationship["relationship_type"]>([
  "biological_parent",
  "adoptive_parent",
  "foster_parent",
  "guardian_parent",
]);

export function ActionBar({
  selectedPerson,
  relationships,
  onAdd,
  onDelete,
}: {
  selectedPerson: Person;
  relationships: Relationship[];
  onAdd: (kind: Kind) => void;
  onDelete: () => void;
}) {
  const hasParent = relationships.some(
    (r) => r.person_b_id === selectedPerson.id && PARENT_RELATIONSHIP_TYPES.has(r.relationship_type)
  );

  return (
    <div className="absolute bottom-6 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full border border-line bg-surface p-1.5 shadow-lg">
      <ActionButton label="Legg til far" onClick={() => onAdd("father")} />
      <ActionButton label="Legg til mor" onClick={() => onAdd("mother")} />
      <ActionButton
        label="Legg til søsken"
        onClick={() => onAdd("sibling")}
        disabled={!hasParent}
        disabledReason="Legg til en forelder først"
      />
      <ActionButton label="Legg til partner" onClick={() => onAdd("partner")} />
      <ActionButton label="Legg til barn" onClick={() => onAdd("child")} />
      <span className="mx-1 h-6 w-px bg-line" aria-hidden="true" />
      <ActionButton label="Slett person" onClick={onDelete} destructive />
    </div>
  );
}

function ActionButton({
  label,
  onClick,
  disabled,
  disabledReason,
  destructive,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  disabledReason?: string;
  destructive?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={disabled ? disabledReason : undefined}
      className={`rounded-full px-3.5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        destructive ? "text-error hover:bg-error/10" : "text-foreground hover:bg-background"
      }`}
    >
      {label}
    </button>
  );
}
```

- [ ] **Step 2: Create `AddRelationshipDialog`**

Create `app/tre-slekt/add-relationship-dialog.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Person } from "@/lib/family-tree/data";
import { createRelatedPerson } from "./actions";

type Kind = "father" | "mother" | "sibling" | "partner" | "child";

const KIND_LABEL_NO: Record<Kind, string> = {
  father: "Legg til far",
  mother: "Legg til mor",
  sibling: "Legg til søsken",
  partner: "Legg til partner",
  child: "Legg til barn",
};

const PARENT_TYPE_OPTIONS = [
  { value: "biological_parent", label: "Biologisk" },
  { value: "adoptive_parent", label: "Adoptiv" },
  { value: "foster_parent", label: "Foster" },
  { value: "guardian_parent", label: "Verge" },
];

const PARTNER_TYPE_OPTIONS = [
  { value: "spouse", label: "Ektefelle" },
  { value: "former_spouse", label: "Tidligere ektefelle" },
  { value: "partner", label: "Partner" },
  { value: "former_partner", label: "Tidligere partner" },
];

export function AddRelationshipDialog({
  kind,
  selectedPerson,
  onClose,
  onCreated,
}: {
  kind: Kind;
  selectedPerson: Person;
  onClose: () => void;
  onCreated: (newPersonId: string) => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [givenName, setGivenName] = useState("");
  const [familyName, setFamilyName] = useState(kind === "partner" ? "" : selectedPerson.family_name);
  const [gender, setGender] = useState<Person["gender"]>(
    kind === "father" ? "male" : kind === "mother" ? "female" : "unknown"
  );

  const showGenderSelector = kind === "sibling" || kind === "partner" || kind === "child";
  const showTypeSelector = kind !== "sibling";
  const typeOptions = kind === "partner" ? PARTNER_TYPE_OPTIONS : PARENT_TYPE_OPTIONS;
  const [relationshipType, setRelationshipType] = useState(typeOptions[0].value);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await createRelatedPerson({
        selectedPersonId: selectedPerson.id,
        kind,
        givenName,
        familyName,
        gender,
        relationshipType,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onCreated(result.newPersonId);
      router.refresh();
    });
  };

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-foreground/20 px-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm rounded-2xl border border-line bg-surface p-6 shadow-lg">
        <h2 className="font-serif text-lg font-medium text-foreground">{KIND_LABEL_NO[kind]}</h2>
        {error && <p className="mt-3 text-sm text-error">{error}</p>}
        <label className="mt-4 flex flex-col gap-1 text-sm">
          Fornavn
          <input
            value={givenName}
            onChange={(e) => setGivenName(e.target.value)}
            required
            autoFocus
            className="rounded-lg border border-line bg-background px-3 py-1.5 text-foreground"
          />
        </label>
        <label className="mt-3 flex flex-col gap-1 text-sm">
          Etternavn
          <input
            value={familyName}
            onChange={(e) => setFamilyName(e.target.value)}
            required
            className="rounded-lg border border-line bg-background px-3 py-1.5 text-foreground"
          />
        </label>
        {showGenderSelector && (
          <label className="mt-3 flex flex-col gap-1 text-sm">
            Kjønn
            <select
              value={gender}
              onChange={(e) => setGender(e.target.value as Person["gender"])}
              className="rounded-lg border border-line bg-background px-3 py-1.5 text-foreground"
            >
              <option value="male">Mann</option>
              <option value="female">Kvinne</option>
              <option value="unknown">Ikke oppgitt</option>
            </select>
          </label>
        )}
        {showTypeSelector && (
          <label className="mt-3 flex flex-col gap-1 text-sm">
            Relasjonstype
            <select
              value={relationshipType}
              onChange={(e) => setRelationshipType(e.target.value)}
              className="rounded-lg border border-line bg-background px-3 py-1.5 text-foreground"
            >
              {typeOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="mt-5 flex gap-2">
          <button
            type="submit"
            disabled={isPending}
            className="flex-1 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-60"
          >
            Opprett
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="flex-1 rounded-lg border border-line px-4 py-2 text-sm font-medium text-foreground hover:bg-background"
          >
            Avbryt
          </button>
        </div>
      </form>
    </div>
  );
}
```

- [ ] **Step 3: Wire both into `FamilyTreeCanvas`**

In `app/tre-slekt/canvas.tsx`:

1. Add imports:

```ts
import { ActionBar } from "./action-bar";
import { AddRelationshipDialog } from "./add-relationship-dialog";
```

2. Add dialog state alongside the other `useState` calls:

```ts
  const [activeDialog, setActiveDialog] = useState<
    | { type: "add"; kind: "father" | "mother" | "sibling" | "partner" | "child" }
    | { type: "delete" }
    | null
  >(null);
```

3. Render `ActionBar` and `AddRelationshipDialog` right after the `{selectedPersonId && (<DetailPanel ... />)}` block added in Task 5:

```tsx
      {isAdmin && selectedPersonId && (
        <ActionBar
          selectedPerson={peopleById.get(selectedPersonId)!}
          relationships={relationships}
          onAdd={(kind) => setActiveDialog({ type: "add", kind })}
          onDelete={() => setActiveDialog({ type: "delete" })}
        />
      )}
      {activeDialog?.type === "add" && selectedPersonId && (
        <AddRelationshipDialog
          kind={activeDialog.kind}
          selectedPerson={peopleById.get(selectedPersonId)!}
          onClose={() => setActiveDialog(null)}
          onCreated={(newPersonId) => {
            setActiveDialog(null);
            setSelectedPersonId(newPersonId);
          }}
        />
      )}
```

- [ ] **Step 4: Verify**

```bash
bunx tsc --noEmit
bun test
bun run lint
```

Manually verify in the browser as admin: selecting a person shows the floating action bar at the bottom with 6 buttons; "Legg til søsken" is disabled with a tooltip when the person has no parent on file; clicking "Legg til far" opens a dialog with no gender selector but a relationship-type selector, and submitting creates a new person, selects them, and opens their sidebar; clicking "Legg til barn" shows a gender selector; as a member (not admin), the action bar never appears even with a person selected.

- [ ] **Step 5: Commit**

```bash
git add app/tre-slekt/action-bar.tsx app/tre-slekt/add-relationship-dialog.tsx app/tre-slekt/canvas.tsx
git commit -m "Add floating action bar and add-relationship dialog"
```

---

### Task 7: Delete-person dialog

**Files:**
- Create: `app/tre-slekt/delete-person-dialog.tsx`
- Modify: `app/tre-slekt/canvas.tsx`

**Interfaces:**
- Consumes: `deletePerson` (Task 4); `activeDialog` state (Task 6).
- Produces: `DeletePersonDialog` confirms and deletes, reporting success via `onDeleted`.

- [ ] **Step 1: Create `DeletePersonDialog`**

Create `app/tre-slekt/delete-person-dialog.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Person } from "@/lib/family-tree/data";
import { deletePerson } from "./actions";

export function DeletePersonDialog({
  person,
  onClose,
  onDeleted,
}: {
  person: Person;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = () => {
    setError(null);
    startTransition(async () => {
      const result = await deletePerson(person.id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onDeleted();
      router.refresh();
    });
  };

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-foreground/20 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-6 shadow-lg">
        <h2 className="font-serif text-lg font-medium text-foreground">
          Slett {person.given_name} {person.family_name}?
        </h2>
        <p className="mt-2 text-sm text-muted">Dette kan ikke angres fra denne skjermen.</p>
        {error && <p className="mt-3 text-sm text-error">{error}</p>}
        <div className="mt-5 flex gap-2">
          <button
            onClick={handleConfirm}
            disabled={isPending}
            className="flex-1 rounded-lg bg-error px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
          >
            Slett
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="flex-1 rounded-lg border border-line px-4 py-2 text-sm font-medium text-foreground hover:bg-background"
          >
            Avbryt
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire it into `FamilyTreeCanvas`**

In `app/tre-slekt/canvas.tsx`:

1. Add the import:

```ts
import { DeletePersonDialog } from "./delete-person-dialog";
```

2. Render it right after the `AddRelationshipDialog` block from Task 6:

```tsx
      {activeDialog?.type === "delete" && selectedPersonId && (
        <DeletePersonDialog
          person={peopleById.get(selectedPersonId)!}
          onClose={() => setActiveDialog(null)}
          onDeleted={() => {
            setActiveDialog(null);
            setSelectedPersonId(null);
          }}
        />
      )}
```

- [ ] **Step 3: Verify**

```bash
bunx tsc --noEmit
bun test
bun run lint
```

Manually verify in the browser as admin:
- Deleting a leaf person (no one depends on them for connectivity) succeeds, the sidebar/action bar close, and the person disappears from the canvas.
- Attempting to delete a person who bridges two parts of the tree (e.g. a parent whose own parent is also on file, with no other connection) is refused, and the dialog shows an error naming who would be disconnected.
- Deleting that same bridging person's "outer" relative first, then deleting the original target, succeeds.

- [ ] **Step 4: Commit**

```bash
git add app/tre-slekt/delete-person-dialog.tsx app/tre-slekt/canvas.tsx
git commit -m "Add delete-person dialog with connectivity blocking"
```

---

### Task 8: End-to-end manual verification

**Files:** none.

- [ ] **Step 1: Verify the full admin flow**

Log in as an admin test account. Confirm:
- With no person selected, the floating action bar does not render.
- Selecting a person shows the action bar with all 6 actions; "Legg til søsken" is disabled until a parent exists.
- Each of Legg til far / mor / barn / partner creates a person with the expected fixed-or-selectable gender and relationship-type options, links them correctly (verify direction and label in the new person's "Familie" list), and selects the new person afterward.
- Legg til søsken creates a person linked to each of the selected person's existing parents, mirroring their relationship types.
- The Personinfo tab's "Rediger" flow saves given/family/birth-family name, gender, birth date, and the avdød toggle (with death date) correctly, and the display view reflects the saved values after Lagre.
- The Biografi tab's "Rediger" flow saves free text correctly.
- Deleting a leaf person works; deleting a bridging person is blocked with an accurate message; deleting outer-in resolves the block.

- [ ] **Step 2: Verify the member flow**

Log in as a member test account (create one via `/admin/medlemmer` with role "Medlem" first if none exists). Confirm:
- The floating action bar never appears, regardless of selection.
- The Personinfo tab has no "Rediger" button (read-only).
- The Biografi tab does have a "Rediger" button, and saving a biography change works and persists.

- [ ] **Step 3: Verify the guest flow**

Log in as a guest (family code). Confirm the sidebar opens read-only on both tabs, with no edit buttons anywhere and no action bar.

- [ ] **Step 4: Confirm RLS at the database layer**

Run `mcp__supabase__get_advisors` (type `security`) and confirm no new advisories. Optionally spot-check with `mcp__supabase__execute_sql` that `people_insert_admin`, `people_update_admin`, `relationships_insert_admin`, and `relationships_update_admin` policies exist (query `pg_policies`).

- [ ] **Step 5: Update `docs/ROADMAP.md`**

Mark Phase 4b as ✅ Done in the status table, fill in the Detail index row (`4b | 2026-07-28-editing-floating-action-bar-design.md | 2026-07-28-editing-floating-action-bar.md`), and update the "Standing directives" section if anything here superseded the original Phase 4b line (e.g. drop the now-stale "with nothing selected, only add person is available" wording if it's still referenced anywhere in `CLAUDE.md`).

- [ ] **Step 6: Report results**, including what was tested and any concerns.

---

## Self-Review Notes

- **Spec coverage:** every section of the design doc maps to a task — `birth_family_name` + admin-only RLS + all three RPCs (Task 1), the connectivity rule (Task 2, consumed by Task 4/7), `createRelatedPerson` and its father/mother/sibling/partner/child branching (Task 3), `updatePersonInfo`/`updatePersonBiography`/`deletePerson` (Task 4), the two-tab sidebar with per-tab edit gating (Task 5), the floating action bar and quick-create dialog with its field-by-kind table (Task 6), the delete confirmation and connectivity-blocked messaging (Task 7), and full role-by-role verification plus the roadmap update (Task 8).
- **Placeholder scan:** no TBD/TODO; the only deferred literal is the migration's server-assigned version number, which is this project's documented standing convention (call `list_migrations` after applying), not a vague requirement.
- **Type consistency:** `ActionResult`-shaped returns (`{ ok: true; ... } | { ok: false; error: string }`) are used identically across `createRelatedPerson`, `updatePersonInfo`, `updatePersonBiography`, and `deletePerson`, and every dialog component destructures `result.ok`/`result.error` the same way. `Kind`/`RelationKind` (`"father" | "mother" | "sibling" | "partner" | "child"`) is spelled identically in `actions.ts`, `action-bar.tsx`, `add-relationship-dialog.tsx`, and `canvas.tsx`'s `activeDialog` state. `Person.birth_family_name` is introduced in Task 1 and consumed consistently in Task 2 (test fixtures), Task 4 (`updatePersonInfo`), and Task 5 (`DetailPanel`). RPC parameter names (`p_given_name`, `p_family_name`, `p_gender`, `p_edges`, `p_person_id`, `p_biography`) match exactly between the SQL functions in Task 1 and the `supabase.rpc(...)` calls in Tasks 3 and 4.
