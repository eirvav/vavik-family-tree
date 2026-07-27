# Tree Canvas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A read-only, searchable, pan/zoom React Flow canvas showing all people and relationships from the database, with automatic Dagre layout, shared draggable positions, compact/full detail panels, and a keyboard-accessible list-view fallback.

**Architecture:** Server Component loads all people/relationships/canvas_positions once; a Client Component wraps `@xyflow/react` and does all interactive rendering/layout/search client-side (safe at ~250 nodes — the spec explicitly says this scale doesn't need partial loading). Position edits go through a narrow server action, gated the same way every other write in this project is gated (RLS + explicit checks where RLS alone isn't the boundary).

**Tech Stack:** `@xyflow/react` (the React Flow canvas library), `@dagrejs/dagre` (automatic hierarchical layout), existing Next.js/Supabase/Tailwind stack.

## Global Constraints

- No create/edit forms for people or relationships, no relationship-creation-by-drawing-an-edge, no audit trail — all Phase 4. This phase is read-only for family data; the only write path is node position (presentation state, not family data).
- All UI text Norwegian, hardcoded, matching the established visual style (rounded-2xl border border-line bg-surface cards, the gold branch-motif icon, font-serif headings — see `app/tre/page.tsx` and the auth pages for the established design language).
- Guests can pan/zoom/select/search but cannot drag a node to reposition it. Members/admins can. Only admins can reset the whole shared layout.
- Every new table needs RLS AND explicit base-table GRANTs to `authenticated` — this project has needed a corrective grants migration three times already from skipping the grant. Do not skip it again.
- Migrations applied directly to the remote Supabase project (ref `aepiajqwquxwcgvxqmrl`), confirmed-version filenames (same established pattern).
- **Library API verification**: this plan's React Flow/Dagre code reflects the plan author's best understanding of the current `@xyflow/react`/`@dagrejs/dagre` APIs, but neither library has been hands-on-verified against the exact installed version in this project the way the Next.js APIs were earlier in this project's history. Before writing any file that imports from `@xyflow/react` or `@dagrejs/dagre`, check the actual installed package's TypeScript types (`node_modules/@xyflow/react/dist/**/*.d.ts`, `node_modules/@dagrejs/dagre/**/*.d.ts`) or its README for the exact current export names/signatures, and adjust this plan's code if it's drifted from what's actually installed. Don't silently guess past a mismatch — if something doesn't compile, that's a signal to go verify the real API, not to work around the type error.
- Seed data (Task 2) is synthetic test data only, clearly marked (a distinctive fake surname), never mixed with real family data — it exists purely so later tasks in this plan have something to render and test against.
- Design doc for this phase: `docs/superpowers/specs/2026-07-27-tree-canvas-design.md`. If anything here conflicts with that doc, the doc wins and the plan should be corrected.

---

## File Structure

```
supabase/migrations/
  <ts>_add_gender_and_canvas_positions.sql
lib/
  family-tree/
    data.ts               # server-side loaders: people, relationships, canvas_positions
    layout.ts             # dagre layout computation, pure function
    search.ts             # client-side substring search over loaded people
app/
  tre-slekt/
    page.tsx              # Server Component: loads data, renders the canvas
    canvas.tsx             # Client Component: ReactFlow wrapper, "use client"
    person-node.tsx        # Client Component: custom node renderer
    detail-panel.tsx       # Client Component: compact + full detail views
    list-view.tsx          # Client Component: accessibility fallback
    actions.ts             # server actions: save node position, reset layout
```

(`/tre-slekt` — "the family tree" — is the actual canvas route, distinct from the existing placeholder `/tre` authenticated landing page from Phase 0/1. Task 10 links `/tre` to this new route.)

---

### Task 1: `gender` column and `canvas_positions` table

**Files:**
- Create: `supabase/migrations/<timestamp>_add_gender_and_canvas_positions.sql`

**Interfaces:**
- Consumes: `people` table (Phase 2), `app_is_authorized()`/`app_is_member_or_admin()` (Phase 0/1).
- Produces: `people.gender` column, `canvas_positions` table. Task 4 (person node) reads `gender`; Task 6 (drag persistence) writes `canvas_positions`.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/<timestamp>_add_gender_and_canvas_positions.sql

create type gender as enum ('male', 'female', 'unknown');

alter table people add column gender gender not null default 'unknown';

create table canvas_positions (
  person_id uuid primary key references people(id) on delete cascade,
  x double precision not null,
  y double precision not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(user_id)
);

alter table canvas_positions enable row level security;

create policy "canvas_positions_select_authorized"
  on canvas_positions for select
  to authenticated
  using (app_is_authorized());

create policy "canvas_positions_insert_member_or_admin"
  on canvas_positions for insert
  to authenticated
  with check (app_is_member_or_admin());

create policy "canvas_positions_update_member_or_admin"
  on canvas_positions for update
  to authenticated
  using (app_is_member_or_admin())
  with check (app_is_member_or_admin());

grant select, insert, update on canvas_positions to authenticated;
```

Note: `canvas_positions` SELECT uses the flat `app_is_authorized()` (not the member/admin-see-all-including-deleted split used for `people`/`relationships`) since positions have no soft-delete concept at all — there's nothing to hide from guests here.

- [ ] **Step 2: Apply it**

`apply_migration` with `name: "add_gender_and_canvas_positions"`, then confirm registered version via `list_migrations` before naming the local file.

- [ ] **Step 3: Verify**

```sql
select column_name, data_type from information_schema.columns where table_name = 'people' and column_name = 'gender';
select grantee, privilege_type from information_schema.role_table_grants where table_name = 'canvas_positions' and grantee = 'authenticated';
select polname from pg_policy where polrelid = 'canvas_positions'::regclass;
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations
git commit -m "Add people.gender and canvas_positions table"
```

---

### Task 2: Install dependencies, seed synthetic test data

**Files:**
- Modify: `package.json`, `bun.lock`
- No committed seed file — seed data is inserted via a one-off script, not a migration (migrations are schema-only in this project; test data must never become a permanent part of the single production database's migration history).

**Interfaces:**
- Produces: `@xyflow/react`, `@dagrejs/dagre` as dependencies; a synthetic test family in the database for Tasks 3+ to render against.

- [ ] **Step 1: Install dependencies**

```bash
bun add @xyflow/react @dagrejs/dagre
bun add -d @types/dagre
```

Check whether `@dagrejs/dagre` ships its own types (many modern packages do, making `@types/dagre` unnecessary or even wrong) — if `bun add -d @types/dagre` reports a conflict or the package already includes a `.d.ts`, skip the separate types package.

- [ ] **Step 2: Seed a synthetic test family**

Write and run a one-off script (not committed, not a migration) that inserts a small multi-generation test family via the service-role client, so later tasks have real data to render. Use a distinctive, obviously-fake surname (e.g. "Testslekt") so it's unmistakable as synthetic. Something like:

```ts
// Run via: bun run --env-file=.env.local <script path>
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const people = [
  { id: "f0000001-0000-0000-0000-000000000001", given_name: "Ola", family_name: "Testslekt", gender: "male", is_living: false, birth_date_precision: "year_only", birth_date_value: "1930-01-01", birth_date_display: "1930" },
  { id: "f0000001-0000-0000-0000-000000000002", given_name: "Kari", family_name: "Testslekt", gender: "female", is_living: false, birth_date_precision: "year_only", birth_date_value: "1932-01-01", birth_date_display: "1932" },
  { id: "f0000001-0000-0000-0000-000000000003", given_name: "Per", family_name: "Testslekt", gender: "male", is_living: true, birth_date_precision: "year_only", birth_date_value: "1955-01-01", birth_date_display: "1955" },
  { id: "f0000001-0000-0000-0000-000000000004", given_name: "Anne", family_name: "Testslekt", gender: "female", is_living: true, birth_date_precision: "year_only", birth_date_value: "1958-01-01", birth_date_display: "1958" },
  { id: "f0000001-0000-0000-0000-000000000005", given_name: "Lise", family_name: "Testslekt", gender: "female", is_living: true, birth_date_precision: "year_only", birth_date_value: "1980-01-01", birth_date_display: "1980" },
  { id: "f0000001-0000-0000-0000-000000000006", given_name: "Jon", family_name: "Testslekt", gender: "male", is_living: true, birth_date_precision: "year_only", birth_date_value: "1982-01-01", birth_date_display: "1982" },
];

const relationships = [
  { person_a_id: people[0].id, person_b_id: people[2].id, relationship_type: "biological_parent" },
  { person_a_id: people[1].id, person_b_id: people[2].id, relationship_type: "biological_parent" },
  { person_a_id: people[0].id, person_b_id: people[1].id, relationship_type: "spouse" },
  { person_a_id: people[2].id, person_b_id: people[3].id, relationship_type: "spouse" },
  { person_a_id: people[2].id, person_b_id: people[4].id, relationship_type: "biological_parent" },
  { person_a_id: people[3].id, person_b_id: people[4].id, relationship_type: "biological_parent" },
  { person_a_id: people[2].id, person_b_id: people[5].id, relationship_type: "biological_parent" },
  { person_a_id: people[3].id, person_b_id: people[5].id, relationship_type: "biological_parent" },
];

const { error: peopleError } = await supabase.from("people").insert(people);
if (peopleError) { console.error("people:", peopleError.message); process.exit(1); }

const { error: relError } = await supabase.from("relationships").insert(relationships);
if (relError) { console.error("relationships:", relError.message); process.exit(1); }

console.log("Seeded", people.length, "people and", relationships.length, "relationships");
```

This gives a 3-generation family: a couple (Ola & Kari), their child Per married to Anne, and two grandchildren (Lise & Jon) — enough to exercise generational layout, spouse pairing, and multiple children.

- [ ] **Step 3: Verify**

```sql
select count(*) from people where family_name = 'Testslekt';
select count(*) from relationships r join people p on p.id = r.person_a_id where p.family_name = 'Testslekt';
```

Expected: 6 people, 8 relationships.

- [ ] **Step 4: Commit**

```bash
git add package.json bun.lock
git commit -m "Add React Flow and Dagre dependencies"
```

(The seed script itself is not committed — it's a one-off utility, not application code. Keep it in the scratchpad or delete it after running.)

---

### Task 3: Server-side data loading and canvas page skeleton

**Files:**
- Create: `lib/family-tree/data.ts`
- Create: `app/tre-slekt/page.tsx`
- Create: `app/tre-slekt/canvas.tsx`

**Interfaces:**
- Consumes: `createClient()` from `lib/supabase/server.ts` (existing).
- Produces: `getFamilyTreeData()` returning `{ people, relationships, positions }`. `canvas.tsx` exports a `FamilyTreeCanvas` component accepting that shape as props — every later task in this plan builds on this component's props shape, so get it right here: `people: Person[]`, `relationships: Relationship[]`, `positions: CanvasPosition[]`, each field typed to match the actual database column names (no renaming/reshaping — keep it a direct, typed passthrough of what Supabase returns).

- [ ] **Step 1: Write the data loader**

```ts
// lib/family-tree/data.ts
import { createClient } from "@/lib/supabase/server";

export type Person = {
  id: string;
  given_name: string;
  family_name: string;
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

export type CanvasPositionRow = {
  person_id: string;
  x: number;
  y: number;
};

export async function getFamilyTreeData() {
  const supabase = await createClient();

  const [peopleResult, relationshipsResult, positionsResult] = await Promise.all([
    supabase
      .from("people")
      .select("id, given_name, family_name, gender, is_living, birth_date_display, death_date_display, biography, birth_place, death_place")
      .is("deleted_at", null),
    supabase
      .from("relationships")
      .select("id, person_a_id, person_b_id, relationship_type")
      .is("deleted_at", null),
    supabase.from("canvas_positions").select("person_id, x, y"),
  ]);

  if (peopleResult.error) throw new Error(peopleResult.error.message);
  if (relationshipsResult.error) throw new Error(relationshipsResult.error.message);
  if (positionsResult.error) throw new Error(positionsResult.error.message);

  return {
    people: (peopleResult.data ?? []) as Person[],
    relationships: (relationshipsResult.data ?? []) as Relationship[],
    positions: (positionsResult.data ?? []) as CanvasPositionRow[],
  };
}
```

- [ ] **Step 2: Write the page**

```tsx
// app/tre-slekt/page.tsx
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getFamilyTreeData } from "@/lib/family-tree/data";
import { FamilyTreeCanvas } from "./canvas";

export default async function TreSlektPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/logg-inn");
  }

  const isGuest = Boolean(user.is_anonymous);
  let canEdit = false;
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

    canEdit = true;
    isAdmin = profile.role === "admin";
  }

  const { people, relationships, positions } = await getFamilyTreeData();

  return (
    <main className="flex h-screen w-full flex-col">
      <FamilyTreeCanvas
        people={people}
        relationships={relationships}
        positions={positions}
        canEdit={canEdit}
        isAdmin={isAdmin}
      />
    </main>
  );
}
```

- [ ] **Step 3: Write a minimal canvas skeleton** (just enough to prove the pipeline works — full node/edge rendering is Task 4+)

Before writing this file, check `node_modules/@xyflow/react/dist/**/*.d.ts` (or run `bunx tsc --noEmit` against a draft and read the errors) to confirm the exact current export names for `ReactFlow`, `useNodesState`, `useEdgesState`, and the stylesheet import path — the code below is the plan author's best understanding, not hands-on-verified against this project's installed version.

```tsx
// app/tre-slekt/canvas.tsx
"use client";

import { ReactFlow, Background, Controls, useNodesState, useEdgesState } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { Person, Relationship, CanvasPositionRow } from "@/lib/family-tree/data";

export function FamilyTreeCanvas({
  people,
  relationships,
  positions,
  canEdit,
  isAdmin,
}: {
  people: Person[];
  relationships: Relationship[];
  positions: CanvasPositionRow[];
  canEdit: boolean;
  isAdmin: boolean;
}) {
  const positionByPersonId = new Map(positions.map((p) => [p.person_id, p]));

  const initialNodes = people.map((person, index) => {
    const saved = positionByPersonId.get(person.id);
    return {
      id: person.id,
      position: saved ? { x: saved.x, y: saved.y } : { x: (index % 10) * 200, y: Math.floor(index / 10) * 150 },
      data: { label: `${person.given_name} ${person.family_name}` },
    };
  });

  const initialEdges = relationships.map((rel) => ({
    id: rel.id,
    source: rel.person_a_id,
    target: rel.person_b_id,
  }));

  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, , onEdgesChange] = useEdgesState(initialEdges);

  return (
    <div className="h-full w-full">
      <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} fitView>
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}
```

`canEdit`/`isAdmin` are unused in this skeleton — later tasks (5, 6) use them. Keep them as props now so the component's public interface doesn't change shape later.

- [ ] **Step 4: Verify it compiles and renders**

```bash
bunx tsc --noEmit
```

Then manually load `/tre-slekt` in the browser (signed in as the admin from earlier phases) and confirm the 6 seeded Testslekt people appear as plain default nodes with 8 edges connecting them, even without custom styling yet. Use the Browser tool to check for console errors.

- [ ] **Step 5: Commit**

```bash
git add lib/family-tree app/tre-slekt
git commit -m "Add family tree data loader and canvas skeleton"
```

---

### Task 4: Custom person node and edge styling

**Files:**
- Create: `app/tre-slekt/person-node.tsx`
- Modify: `app/tre-slekt/canvas.tsx`

**Interfaces:**
- Consumes: `Person` type (Task 3).
- Produces: a `nodeTypes` map passed to `<ReactFlow>`; styled edges.

- [ ] **Step 1: Write the custom node component**

Check `node_modules/@xyflow/react/dist/**/*.d.ts` for the exact current `NodeProps`/`Handle`/`Position` export shapes before finalizing — custom node components in React Flow receive a `data` prop whose shape you control, but the wrapper props (`id`, `selected`, etc.) come from the library and should be verified against what's actually installed.

```tsx
// app/tre-slekt/person-node.tsx
"use client";

import { Handle, Position } from "@xyflow/react";
import type { Person } from "@/lib/family-tree/data";

const GENDER_ICON: Record<Person["gender"], string> = {
  male: "♂",
  female: "♀",
  unknown: "•",
};

export function PersonNode({ data }: { data: { person: Person } }) {
  const { person } = data;
  const years = [person.birth_date_display, person.death_date_display].filter(Boolean).join(" – ");

  return (
    <div
      className="flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 shadow-sm"
      role="group"
      aria-label={`${person.given_name} ${person.family_name}${years ? `, ${years}` : ""}`}
    >
      <Handle type="target" position={Position.Top} />
      <span
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line bg-background text-sm text-muted"
        aria-hidden="true"
      >
        {GENDER_ICON[person.gender]}
      </span>
      <div className="flex flex-col">
        <span className="text-sm font-medium text-foreground">
          {person.given_name} {person.family_name}
        </span>
        {years && <span className="text-xs text-muted">{years}</span>}
      </div>
      {!person.is_living && (
        <span className="ml-1 h-2 w-2 shrink-0 rounded-full bg-muted" aria-label="Avdød" title="Avdød" />
      )}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
```

- [ ] **Step 2: Wire the custom node type and edge styling into the canvas**

Modify `app/tre-slekt/canvas.tsx`:
- Import `PersonNode` and pass `nodeTypes={{ person: PersonNode }}` to `<ReactFlow>`.
- Change each node's `type` to `"person"` and its `data` to `{ person }` (the full person object, not just a label string).
- Style edges by `relationship_type`: parent-type relationships (`biological_parent`, `adoptive_parent`, `foster_parent`, `guardian_parent`) get `type: "smoothstep"`, `markerEnd: { type: MarkerType.ArrowClosed }`, solid line; partner-type relationships (`spouse`, `former_spouse`, `partner`, `former_partner`) get a dashed `style: { strokeDasharray: "5,5" }`, no arrow marker. Non-default relationship types (`former_spouse`, `former_partner`, `adoptive_parent`, `foster_parent`, `guardian_parent`) additionally get a `label` showing the Norwegian name of the relationship type (e.g. "adoptivforelder", "tidligere ektefelle") — verify the exact `label`/`markerEnd` prop shape against the installed `@xyflow/react` types.

- [ ] **Step 3: Verify**

`bunx tsc --noEmit`, then manually check in the browser: nodes show the gender icon/name/years/deceased-dot; parent-child edges are solid with an arrowhead toward the child; spouse edges are dashed with no arrowhead.

- [ ] **Step 4: Commit**

```bash
git add app/tre-slekt
git commit -m "Add custom person node and styled relationship edges"
```

---

### Task 5: Dagre automatic layout

**Files:**
- Create: `lib/family-tree/layout.ts`
- Modify: `app/tre-slekt/canvas.tsx`

**Interfaces:**
- Consumes: `Person[]`, `Relationship[]` (Task 3).
- Produces: `computeDagreLayout(people, relationships): Map<string, { x: number; y: number }>` — a pure function, independently testable, that Task 3's fallback-position logic in `canvas.tsx` now calls instead of the placeholder grid math.

- [ ] **Step 1: Write the layout function**

Check `node_modules/@dagrejs/dagre/**/*.d.ts` for the exact current API before finalizing — the code below reflects the plan author's understanding of Dagre's typical `graphlib.Graph`/`setNode`/`setEdge`/`layout` API, not a hands-on-verified check against this project's installed version.

```ts
// lib/family-tree/layout.ts
import dagre from "@dagrejs/dagre";
import type { Person, Relationship } from "./data";

const NODE_WIDTH = 200;
const NODE_HEIGHT = 60;

const PARENT_TYPES = new Set(["biological_parent", "adoptive_parent", "foster_parent", "guardian_parent"]);

export function computeDagreLayout(
  people: Person[],
  relationships: Relationship[]
): Map<string, { x: number; y: number }> {
  const graph = new dagre.graphlib.Graph();
  graph.setGraph({ rankdir: "TB", nodesep: 40, ranksep: 100 });
  graph.setDefaultEdgeLabel(() => ({}));

  for (const person of people) {
    graph.setNode(person.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }

  for (const rel of relationships) {
    if (PARENT_TYPES.has(rel.relationship_type)) {
      graph.setEdge(rel.person_a_id, rel.person_b_id);
    }
  }

  dagre.layout(graph);

  const result = new Map<string, { x: number; y: number }>();
  for (const person of people) {
    const node = graph.node(person.id);
    result.set(person.id, { x: node.x, y: node.y });
  }
  return result;
}
```

Note: only parent-child edges drive the Dagre graph (partner edges would confuse a strictly hierarchical layout algorithm) — partners end up positioned near each other naturally because they usually share children, not because of an explicit partner-edge constraint. This is a known simplification; don't try to also feed partner edges into Dagre's ranking.

- [ ] **Step 2: Use it in the canvas as the fallback for people with no saved position**

Modify `app/tre-slekt/canvas.tsx`'s node-building logic: call `computeDagreLayout(people, relationships)` once, and for each person, use their saved `canvas_positions` row if one exists, otherwise the Dagre-computed position for that person's id.

- [ ] **Step 3: Verify**

`bunx tsc --noEmit`, then manually check in the browser (after Task 2's seed data, with no saved positions yet): the 6 Testslekt people should appear in a clear 3-generation top-down layout (Ola & Kari at top, Per & Anne below them, Lise & Jon at the bottom), not overlapping or in the placeholder grid from Task 3.

- [ ] **Step 4: Commit**

```bash
git add lib/family-tree app/tre-slekt
git commit -m "Add Dagre automatic layout for unpositioned nodes"
```

---

### Task 6: Drag-to-reposition, persistence, and reset layout

**Files:**
- Create: `app/tre-slekt/actions.ts`
- Modify: `app/tre-slekt/canvas.tsx`

**Interfaces:**
- Consumes: `createClient()` (`lib/supabase/server.ts`).
- Produces: `savePersonPosition(personId, x, y)`, `resetLayout()` server actions.

- [ ] **Step 1: Write the server actions**

```ts
// app/tre-slekt/actions.ts
"use server";

import { createClient } from "@/lib/supabase/server";

export async function savePersonPosition(personId: string, x: number, y: number) {
  const supabase = await createClient();

  // Relies entirely on the canvas_positions RLS policies (member/admin only
  // for insert/update) to reject this for guests or unauthenticated callers
  // — same pattern as the existing "sett familiekode" action, safe because
  // this uses the session-scoped client end to end, never the service role.
  const { error } = await supabase
    .from("canvas_positions")
    .upsert({ person_id: personId, x, y, updated_at: new Date().toISOString() });

  return { error: error?.message ?? null };
}

export async function resetLayout() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Ikke innlogget" };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();

  // Explicit check required here, same reasoning as the admin member-dashboard
  // action: resetting the SHARED layout for the whole family is a broader
  // action than a single row upsert, so don't rely on RLS's per-row check alone
  // to communicate "only an admin should trigger a full reset."
  if (profile?.role !== "admin") {
    return { error: "Kun administrator kan tilbakestille oppsettet" };
  }

  const { error } = await supabase.from("canvas_positions").delete().neq("person_id", "00000000-0000-0000-0000-000000000000");

  return { error: error?.message ?? null };
}
```

Note: `resetLayout`'s delete will fail with a permission error regardless, since there's no DELETE policy on `canvas_positions` (matching this project's "no hard delete" pattern) — but the explicit admin check above still matters, since it gives a clear Norwegian error message rather than a raw Postgres permission error, and it's the correct place to enforce "only an admin should even attempt this," independent of what RLS separately enforces. If resetting truly needs to delete rows, that requires a dedicated `DELETE` policy scoped to admin-only on `canvas_positions` specifically (not opening delete to `people`/`relationships`) — add that in this task's migration-adjacent step if the brief's implementer determines it's needed, since Task 1's migration only granted `select, insert, update`. Check with a quick test: attempt the delete as admin and see whether it's rejected; if so, that confirms a small follow-up grant/policy is needed specifically for this table, which is acceptable since `canvas_positions` (presentation state) is a different case from `people`/`relationships` (family data, which must never be hard-deletable).

- [ ] **Step 2: Wire drag persistence into the canvas**

In `app/tre-slekt/canvas.tsx`, add an `onNodeDragStop` handler (check the exact prop name against installed `@xyflow/react` types) that calls `savePersonPosition` only when `canEdit` is true; when `canEdit` is false (guest), pass `nodesDraggable={false}` to `<ReactFlow>` so dragging is disabled entirely at the library level, not just server-side-rejected after the fact.

- [ ] **Step 3: Add a "Tilbakestill oppsett" control, admin-only**

A small button rendered conditionally on `isAdmin`, calling `resetLayout()` and then reloading the page (or refetching data) to show the new Dagre-computed positions.

- [ ] **Step 4: Verify**

`bunx tsc --noEmit`. Manually verify in the browser: as a guest (via `/gjest`), nodes cannot be dragged at all. As the admin, dragging a node persists its new position (confirm via a page reload that it stays where dropped, and via `select * from canvas_positions` that a row exists). As the admin, "Tilbakestill oppsett" clears positions and the layout reverts to the Dagre-computed arrangement.

- [ ] **Step 5: Commit**

```bash
git add app/tre-slekt
git commit -m "Add drag-to-reposition, persistence, and admin layout reset"
```

---

### Task 7: Compact and full detail panels

**Files:**
- Create: `app/tre-slekt/detail-panel.tsx`
- Modify: `app/tre-slekt/canvas.tsx`

**Interfaces:**
- Consumes: `Person`, `Relationship` (Task 3).
- Produces: a `DetailPanel` component rendered by `canvas.tsx` when a node is selected, with a `mode: "compact" | "full"` prop.

- [ ] **Step 1: Write the detail panel**

```tsx
// app/tre-slekt/detail-panel.tsx
"use client";

import type { Person, Relationship } from "@/lib/family-tree/data";

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

export function DetailPanel({
  person,
  relationships,
  peopleById,
  mode,
  onClose,
  onExpand,
  onSelectPerson,
}: {
  person: Person;
  relationships: Relationship[];
  peopleById: Map<string, Person>;
  mode: "compact" | "full";
  onClose: () => void;
  onExpand: () => void;
  onSelectPerson: (personId: string) => void;
}) {
  const related = relationships
    .filter((r) => r.person_a_id === person.id || r.person_b_id === person.id)
    .map((r) => {
      const isA = r.person_a_id === person.id;
      const otherId = isA ? r.person_b_id : r.person_a_id;
      const other = peopleById.get(otherId);
      const label = isA ? RELATIONSHIP_LABEL_NO[r.relationship_type].asParent : RELATIONSHIP_LABEL_NO[r.relationship_type].asChild;
      return other ? { other, label } : null;
    })
    .filter((x): x is { other: Person; label: string } => x !== null);

  return (
    <aside className="absolute right-0 top-0 h-full w-80 overflow-y-auto border-l border-line bg-surface p-6 shadow-lg">
      <button onClick={onClose} className="text-sm text-muted hover:text-foreground" aria-label="Lukk">
        Lukk ✕
      </button>
      <h2 className="mt-4 font-serif text-xl font-medium text-foreground">
        {person.given_name} {person.family_name}
      </h2>
      <p className="mt-1 text-sm text-muted">
        {[person.birth_date_display, person.death_date_display].filter(Boolean).join(" – ") || "Ukjente datoer"}
      </p>
      {person.birth_place && <p className="mt-1 text-sm text-muted">Født: {person.birth_place}</p>}
      {mode === "full" && person.death_place && <p className="text-sm text-muted">Død: {person.death_place}</p>}

      {mode === "full" && person.biography && (
        <p className="mt-4 whitespace-pre-wrap text-sm text-foreground">{person.biography}</p>
      )}

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

      {mode === "compact" && (
        <button
          onClick={onExpand}
          className="mt-6 w-full rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
        >
          Se full profil
        </button>
      )}
    </aside>
  );
}
```

- [ ] **Step 2: Wire selection into the canvas**

In `app/tre-slekt/canvas.tsx`: track `selectedPersonId` and `panelMode` (`"compact" | "full" | null`) in component state. Single-click a node (React Flow's `onNodeClick`) sets `selectedPersonId` and `panelMode = "compact"`. Double-click (`onNodeDoubleClick`) or the panel's "Se full profil" button sets `panelMode = "full"`. Render `<DetailPanel>` conditionally when `panelMode` is not null, passing a `peopleById` map built once from the `people` prop.

- [ ] **Step 3: Verify**

`bunx tsc --noEmit`. Manually verify: clicking a Testslekt node opens the compact panel showing name/dates/family links; clicking a family link re-selects that person; double-clicking (or "Se full profil") shows the full view including biography (seed data doesn't set biography, so confirm the field is just absent/empty, not erroring).

- [ ] **Step 4: Commit**

```bash
git add app/tre-slekt
git commit -m "Add compact and full person detail panels"
```

---

### Task 8: Search

**Files:**
- Create: `lib/family-tree/search.ts`
- Modify: `app/tre-slekt/canvas.tsx`

**Interfaces:**
- Consumes: `Person[]` (Task 3).
- Produces: `searchPeople(people, query): Person[]`, a pure function.

- [ ] **Step 1: Write the search function**

```ts
// lib/family-tree/search.ts
import type { Person } from "./data";

export function searchPeople(people: Person[], query: string): Person[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];

  return people.filter((person) => {
    const haystack = [person.given_name, person.family_name, person.birth_place, person.death_place]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(normalized);
  });
}
```

Note: this is a simple client-side substring filter over the already-loaded ~250 people, not a database round-trip — the design doc explains why (trivially fast at this scale; the trigram indexes from Phase 2 remain available if a future phase needs server-side search over a larger dataset). This does not search `person_names` (alternate names) in this pass — that would require also loading `person_names` in Task 3's data loader, which the brief deliberately keeps out of scope for this first search pass; note it as a known limitation, not a bug, unless the implementer judges it trivial to add (loading `person_names` alongside the other three loaders in `getFamilyTreeData` and including it in the search haystack) — if so, it's a reasonable in-scope addition.

- [ ] **Step 2: Add a search bar to the canvas**

In `app/tre-slekt/canvas.tsx`: a text input rendered above the `<ReactFlow>` element (not inside it), calling `searchPeople` on change, showing a small dropdown of matches. Selecting a match: call React Flow's viewport-centering function (check the exact API — likely `useReactFlow()`'s `setCenter` or similar, verify against installed types) to pan/zoom to that node's position, and also set `selectedPersonId`/`panelMode = "compact"` as if the node were clicked directly.

- [ ] **Step 3: Verify**

`bunx tsc --noEmit`. Manually verify: typing "Per" shows matching Testslekt people; selecting one pans the canvas to center that node and opens its compact panel.

- [ ] **Step 4: Commit**

```bash
git add lib/family-tree app/tre-slekt
git commit -m "Add search with pan-to-result"
```

---

### Task 9: Accessibility list view

**Files:**
- Create: `app/tre-slekt/list-view.tsx`
- Modify: `app/tre-slekt/canvas.tsx` (or its parent page, to hold the view-mode toggle)

**Interfaces:**
- Consumes: `Person[]`, `Relationship[]` (Task 3).
- Produces: a `ListView` component, a fully keyboard-navigable alternative to the canvas.

- [ ] **Step 1: Write the list view**

```tsx
// app/tre-slekt/list-view.tsx
"use client";

import { useState } from "react";
import type { Person, Relationship } from "@/lib/family-tree/data";
import { searchPeople } from "@/lib/family-tree/search";

export function ListView({
  people,
  relationships,
  onSelectPerson,
}: {
  people: Person[];
  relationships: Relationship[];
  onSelectPerson: (personId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = query.trim() ? searchPeople(people, query) : people;
  const sorted = [...filtered].sort((a, b) => a.family_name.localeCompare(b.family_name, "nb"));

  return (
    <div className="h-full w-full overflow-y-auto p-6">
      <label htmlFor="liste-sok" className="text-sm font-medium text-foreground">
        Søk
      </label>
      <input
        id="liste-sok"
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="mt-1.5 w-full max-w-sm rounded-lg border border-line bg-background px-3.5 py-2.5 text-foreground focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40"
      />
      <ul className="mt-4 flex flex-col gap-1">
        {sorted.map((person) => (
          <li key={person.id}>
            <button
              onClick={() => onSelectPerson(person.id)}
              className="w-full rounded-lg border border-line bg-surface px-4 py-2.5 text-left text-sm text-foreground hover:bg-background focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            >
              {person.given_name} {person.family_name}
              {person.birth_date_display && <span className="ml-2 text-muted">({person.birth_date_display})</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Add a view-mode toggle**

In `app/tre-slekt/page.tsx` or `canvas.tsx` (implementer's choice, whichever keeps state management cleanest — likely the page, passing a `viewMode` prop down, or a client-side wrapper component holding both `<FamilyTreeCanvas>` and `<ListView>` and toggling between them): a simple two-button toggle ("Tre" / "Liste") switching between the canvas and the list view. Selecting a person in the list view should still open the same `DetailPanel` from Task 7 (reuse it, don't duplicate).

- [ ] **Step 3: Verify**

`bunx tsc --noEmit`. Manually verify: the toggle switches views; the list is fully navigable via Tab/Enter with no mouse; selecting a person from the list opens the same detail panel as clicking their canvas node does.

- [ ] **Step 4: Commit**

```bash
git add app/tre-slekt
git commit -m "Add accessibility list view with view-mode toggle"
```

---

### Task 10: Visual design pass and navigation link

**Files:**
- Modify: `app/tre-slekt/*.tsx` (styling only)
- Modify: `app/tre/page.tsx` (add a link to `/tre-slekt`)

**Interfaces:**
- Consumes: the working pages from Tasks 3-9. This task only changes markup/styling and adds one link — no behavior changes.

- [ ] **Step 1: Invoke the `frontend-design:frontend-design` skill**

For a cohesive pass across the search bar, view toggle, and any remaining unstyled elements — matching the warm, private-archive visual language already established in the auth pages and the existing `/tre` page. The custom node and detail panel from Tasks 4/7 already follow that language reasonably closely; focus this pass on the canvas chrome (search bar, controls, toggle) rather than redoing what's already consistent.

- [ ] **Step 2: Add a link from `/tre` to `/tre-slekt`**

In `app/tre/page.tsx`, add a prominent link/button to `/tre-slekt` (e.g. "Se familietreet") visible to everyone who lands on `/tre` (guest, member, admin) — the placeholder landing page is superseded as the "main" screen once the tree exists, but this plan doesn't redirect `/tre` to `/tre-slekt` automatically, since `/tre` still hosts the admin's family-code and member-management links; just add navigation, don't remove anything.

- [ ] **Step 3: Re-verify behavior didn't regress**

```bash
bunx tsc --noEmit
bun test
```

- [ ] **Step 4: Commit**

```bash
git add app/tre-slekt app/tre/page.tsx
git commit -m "Apply visual design pass to tree canvas and add navigation link"
```

---

### Task 11: End-to-end manual verification

**Files:** none.

- [ ] **Step 1: Verify as guest**

Via `/gjest`, confirm: the tree renders with the Testslekt seed family; pan/zoom/select/search all work; nodes cannot be dragged; the list-view toggle works.

- [ ] **Step 2: Verify as member/admin**

Sign in, confirm: dragging a node persists its position across a reload; the admin-only reset-layout control works and is not visible/usable for a plain member.

- [ ] **Step 3: Verify detail panels**

Compact panel on single click, full view on double-click/expand button, family links navigate correctly, biography shows in full view only.

- [ ] **Step 4: Verify accessibility**

Tab through the list view with no mouse; confirm every interactive element has a visible focus state and a meaningful accessible name (screen-reader label), matching the person-node `aria-label` from Task 4.

- [ ] **Step 5: Clean up or clearly document the seed data**

Since Phase 4 hasn't shipped real data-entry forms yet, the Testslekt seed data should stay in place for continued development rather than being deleted — confirm this with whoever picks up Phase 4 next, and note in the ledger that `family_name = 'Testslekt'` is how to identify and later remove it.

- [ ] **Step 6: Report results**, including what was tested locally vs. in production, and any concerns.

---

## Self-Review Notes

- **Spec coverage:** every requirement from the design doc (§3 schema, §4 application structure, §6 acceptance criteria) maps to a task: Task 1 (schema), Task 2 (deps + seed), Task 3 (data + skeleton), Task 4 (node/edge rendering), Task 5 (layout), Task 6 (drag/persist/reset), Task 7 (detail panels), Task 8 (search), Task 9 (accessibility), Task 10 (visual polish + nav), Task 11 (verification covering every §6 criterion).
- **Placeholder scan:** no TBD/TODO; all code is complete and literal, with explicit call-outs where the plan author's library-API knowledge should be verified against the installed package rather than trusted blindly (flagged as a Global Constraint, not silently assumed).
- **Type consistency:** `Person`/`Relationship`/`CanvasPositionRow` types defined once in `lib/family-tree/data.ts` (Task 3) and reused without reshaping by every later task (`person-node.tsx`, `layout.ts`, `detail-panel.tsx`, `search.ts`, `list-view.tsx`). `FamilyTreeCanvas`'s prop shape (`people`, `relationships`, `positions`, `canEdit`, `isAdmin`) is fixed in Task 3 and only added-to (never renamed) by later tasks.
