# Tree Editing Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix six real problems surfaced by live use of Phase 4b's editing tools — one-parent-only child creation, wrong dashed/solid edge styling with a pushed-away former partner, no selection highlight, sibling-adding gated on having a parent on file, and a non-responsive action bar/sidebar — and remove the horizontal orientation toggle (vertical-only from here on).

**Architecture:** A new `sibling` relationship type replaces the old "mirror the selected person's parent links" trick as the thing that makes "Legg til søsken" always work. Dagre's layout gets a second, non-hierarchical kind of edge (partner and sibling types, `minlen: 0`) so related people land adjacent regardless of what their individual lineages look like. The canvas and sidebar become real flex siblings instead of independently-positioned overlays, which is what actually fixes the action-bar/sidebar collision. See `docs/superpowers/specs/2026-07-28-tree-editing-polish-design.md` for the full design.

**Tech Stack:** Next.js 16 canary, Supabase (Postgres/RLS), React Flow, Dagre, Bun — all unchanged from prior phases.

## Global Constraints

- 100% Norwegian UI text; code/comments in English.
- `bunx tsc --noEmit`, `bun test`, and `bun run lint` must all be clean at the end of every task.
- This project uses Bun — `bun install`, `bunx <pkg>`, never npm/yarn/pnpm.
- Migration filenames get server-assigned versions from `mcp__supabase__apply_migration` — always call `mcp__supabase__list_migrations` after applying and name the local `.sql` file with the real returned version, never a guessed timestamp.
- Nodes must never be draggable, for guest, member, or admin alike (unchanged, unaffected by this plan).
- Soft-deletion only, everywhere — this plan adds no new mutations beyond what Phase 4b already established, but any new code path must still respect it (no hard `DELETE`).
- "Legg til søsken" must never be disabled — this is the core fix this plan makes to Phase 4b's original (overly strict) gating.
- The tree remains vertical-only after this plan — no orientation toggle, no `orientation` parameter anywhere.

---

### Task 1: `sibling` relationship type

**Files:**
- Create: `supabase/migrations/<server-assigned-version>_add_sibling_relationship_type.sql`
- Modify: `lib/family-tree/data.ts`
- Modify: `app/tre-slekt/detail-panel.tsx`
- Modify: `lib/family-tree/connectivity.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `Relationship["relationship_type"]` gains `"sibling"` as a ninth valid value.

- [ ] **Step 1: Apply the migration**

Use `mcp__supabase__apply_migration` with this SQL, then `mcp__supabase__list_migrations` to get the real assigned version, then write the local file at `supabase/migrations/<that-version>_add_sibling_relationship_type.sql`:

```sql
-- A direct sibling relationship, so "Legg til søsken" always works even
-- when the selected person has no parent on file to mirror — previously
-- siblinghood was only ever inferred by copying the selected person's
-- existing parent links onto the new person, which is why the feature
-- used to be disabled without a recorded parent.
alter type relationship_type add value 'sibling';
```

- [ ] **Step 2: Add `"sibling"` to the `Relationship` type**

In `lib/family-tree/data.ts`, add `| "sibling"` to the `relationship_type` union on the `Relationship` type (after `"former_partner"`).

- [ ] **Step 3: Keep `bunx tsc --noEmit` green by giving the new value a sidebar label**

`app/tre-slekt/detail-panel.tsx`'s `RELATIONSHIP_LABEL_NO` is a `Record<Relationship["relationship_type"], ...>` — an *exhaustive* record, so it won't compile once the union above gains a member without an entry for it. Add:

```ts
  sibling: { asParent: "søsken", asChild: "søsken" },
```

to `RELATIONSHIP_LABEL_NO` (order doesn't matter; put it after `former_partner`'s entry). This is the sidebar's "Familie" list label only — canvas edge styling for `sibling` is a later task.

- [ ] **Step 4: Add a connectivity test confirming sibling edges count as real connections**

Append to `lib/family-tree/connectivity.test.ts` (reuse the file's existing `makePerson`/`makeRelationship` helpers):

```ts
test("treats a sibling-only link as a real connection for connectivity purposes", () => {
  const a = makePerson("a", "A");
  const b = makePerson("b", "B");
  const c = makePerson("c", "C");
  const people = [a, b, c];
  const relationships = [
    makeRelationship("r1", "a", "b", "sibling"),
    makeRelationship("r2", "b", "c", "sibling"),
  ];

  // b is a bridge between a and c, purely via sibling edges.
  const result = checkDeleteConnectivity(people, relationships, "b");
  expect(result.safe).toBe(false);
});
```

- [ ] **Step 5: Verify**

```bash
bunx tsc --noEmit
bun test
bun run lint
```

Also run `mcp__supabase__get_advisors` (type `security`) and confirm no new advisories (an `alter type ... add value` doesn't touch RLS or grants, so none are expected).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations lib/family-tree/data.ts app/tre-slekt/detail-panel.tsx lib/family-tree/connectivity.test.ts
git commit -m "Add sibling relationship type"
```

---

### Task 2: Vertical-only layout + partner/sibling adjacency

**Files:**
- Modify: `lib/family-tree/layout.ts`
- Create: `lib/family-tree/layout.test.ts`
- Modify: `app/tre-slekt/view-wrapper.tsx`
- Modify: `app/tre-slekt/canvas.tsx`

**Interfaces:**
- Consumes: `Relationship["relationship_type"]` including `"sibling"` (Task 1).
- Produces: `computeDagreLayout(people: Person[], relationships: Relationship[]): Map<string, {x,y}>` — no more `orientation` parameter, anywhere. `FamilyTreeCanvas`'s props drop `orientation`.

- [ ] **Step 1: Rewrite `computeDagreLayout`**

Replace `lib/family-tree/layout.ts` in full:

```ts
import dagre from "@dagrejs/dagre";
import type { Person, Relationship } from "./data";

const NODE_WIDTH = 200;
const NODE_HEIGHT = 60;

const PARENT_TYPES = new Set<Relationship["relationship_type"]>([
  "biological_parent",
  "adoptive_parent",
  "foster_parent",
  "guardian_parent",
]);

// Partner and sibling relationships don't imply hierarchy, but two people
// linked by one should still land next to each other in the layout.
const ADJACENCY_TYPES = new Set<Relationship["relationship_type"]>([
  "spouse",
  "former_spouse",
  "partner",
  "former_partner",
  "sibling",
]);

/**
 * Computes a top-to-bottom generational layout for the family tree using
 * Dagre. Parent-child edges drive the ranking (who's above whom) with
 * Dagre's default minimum rank distance. Partner and sibling edges are
 * added too, but with minlen: 0, so they only pull their two endpoints
 * toward the same rank and an adjacent position — without asserting any
 * hierarchy between them the way a parent-child edge does.
 *
 * Pure function: takes the full people/relationship lists and returns a map of
 * person id -> computed {x, y}.
 */
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
    } else if (ADJACENCY_TYPES.has(rel.relationship_type)) {
      graph.setEdge(rel.person_a_id, rel.person_b_id, { minlen: 0 });
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

- [ ] **Step 2: Write `layout.test.ts`**

Create `lib/family-tree/layout.test.ts`:

```ts
import { test, expect } from "bun:test";
import { computeDagreLayout } from "./layout";
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
  type: Relationship["relationship_type"]
): Relationship {
  return { id, person_a_id: personAId, person_b_id: personBId, relationship_type: type };
}

test("ranks a parent above their child", () => {
  const parent = makePerson("parent", "Parent");
  const child = makePerson("child", "Child");
  const people = [parent, child];
  const relationships = [makeRelationship("r1", "parent", "child", "biological_parent")];

  const layout = computeDagreLayout(people, relationships);
  expect(layout.get("parent")!.y).toBeLessThan(layout.get("child")!.y);
});

test("pulls partners with no shared child onto the same rank", () => {
  const a = makePerson("a", "A");
  const b = makePerson("b", "B");
  const people = [a, b];
  const relationships = [makeRelationship("r1", "a", "b", "spouse")];

  const layout = computeDagreLayout(people, relationships);
  expect(layout.get("a")!.y).toBe(layout.get("b")!.y);
});

test("pulls former partners onto the same rank too", () => {
  const a = makePerson("a", "A");
  const b = makePerson("b", "B");
  const people = [a, b];
  const relationships = [makeRelationship("r1", "a", "b", "former_partner")];

  const layout = computeDagreLayout(people, relationships);
  expect(layout.get("a")!.y).toBe(layout.get("b")!.y);
});

test("pulls siblings with no parent on file onto the same rank", () => {
  const a = makePerson("a", "A");
  const b = makePerson("b", "B");
  const people = [a, b];
  const relationships = [makeRelationship("r1", "a", "b", "sibling")];

  const layout = computeDagreLayout(people, relationships);
  expect(layout.get("a")!.y).toBe(layout.get("b")!.y);
});
```

- [ ] **Step 3: Run the new tests**

```bash
bun test lib/family-tree/layout.test.ts
```

Expected: all 4 PASS.

- [ ] **Step 4: Remove the orientation toggle from `view-wrapper.tsx`**

In `app/tre-slekt/view-wrapper.tsx`:
1. Change the import line to `import { useState } from "react";` (drop `useEffect`, no longer needed here).
2. Remove the `orientation` state line and the `useEffect` that reads it from `localStorage`, and the `handleSetOrientation` function.
3. Remove the entire `{viewMode === "tre" && (...)}` block that renders the "Retning på treet" toggle (the second `role="group"` div, with the two direction buttons) — delete it completely.
4. On `<FamilyTreeCanvas>`, remove the `orientation={orientation}` prop.

The file's `<div className="flex items-center gap-3 ...">` header row keeps only the Tre/Liste toggle after this; everything else (view-mode state, `ListView`, the `absolute inset-0` show/hide wrapper divs) is unchanged.

- [ ] **Step 5: Remove `orientation` from `FamilyTreeCanvas` and simplify the data-sync effect**

In `app/tre-slekt/canvas.tsx`:

1. Leave the `@xyflow/react` import as-is: `import { ReactFlow, Background, Controls, MarkerType, useNodesState, useEdgesState, useReactFlow } from "@xyflow/react";` — `useReactFlow` is still needed by `SearchBar`'s `setCenter` call later in this file. Change the React import to drop `useRef`, `Dispatch`, and `SetStateAction` — none of them are used anywhere else in this file once `OrientationEffectHandler` (which only existed to receive a typed `setNodes`/`setEdges` prop pair and track a ref) is deleted in this same step: `import { useCallback, useEffect, useState } from "react";`.

2. Remove `orientation` from the `FamilyTreeCanvas` props type and destructured parameters:

```tsx
export function FamilyTreeCanvas({
  people,
  relationships,
  canEdit,
  isAdmin,
}: {
  people: Person[];
  relationships: Relationship[];
  canEdit: boolean;
  isAdmin: boolean;
}) {
```

3. Update the `computeDagreLayout` call to drop the orientation argument:

```ts
  const dagreLayout = computeDagreLayout(people, relationships);
```

4. Delete the entire `OrientationEffectHandler` function and its `<OrientationEffectHandler ... />` call site inside `<ReactFlow>`. Replace both with a single inline `useEffect` directly inside `FamilyTreeCanvas`, placed right after the `useNodesState`/`useEdgesState` lines:

```ts
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initialEdges);

  useEffect(() => {
    setNodes(buildNodes(people, dagreLayout));
    setEdges(buildEdges(relationships) as Edge[]);
    // Depends on the `people`/`relationships` PROPS (not `dagreLayout`,
    // which is recomputed fresh every render and would make this loop) —
    // their reference only changes when the server data actually changes,
    // via router.refresh(). No camera fitView call here: mutations must
    // never reset the admin's pan/zoom; the `<ReactFlow fitView>` prop
    // below already handles the initial camera fit on first mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [people, relationships]);
```

Remove the now-unused `<OrientationEffectHandler ... />` element from inside `<ReactFlow>` (it previously sat between `<Controls />` and `<SearchBar ... />` — just delete those lines; `<Controls />` and `<SearchBar ... />` remain, now adjacent).

- [ ] **Step 6: Verify**

```bash
bunx tsc --noEmit
bun test
bun run lint
```

Manually verify in the browser: the tree renders top-to-bottom; there is no orientation toggle button anywhere in the header; adding/editing/deleting a person still updates the canvas without resetting pan/zoom (this behavior is inherited unchanged from the Phase 4b work — this task only removes the now-dead orientation-tracking branch of that same effect).

- [ ] **Step 7: Commit**

```bash
git add lib/family-tree/layout.ts lib/family-tree/layout.test.ts app/tre-slekt/view-wrapper.tsx app/tre-slekt/canvas.tsx
git commit -m "Remove horizontal orientation; add partner/sibling layout adjacency"
```

---

### Task 3: Sibling always available + second parent on child creation

**Files:**
- Modify: `app/tre-slekt/actions.ts`
- Modify: `app/tre-slekt/action-bar.tsx`
- Modify: `app/tre-slekt/add-relationship-dialog.tsx`
- Modify: `app/tre-slekt/canvas.tsx`

**Interfaces:**
- Consumes: `"sibling"` relationship type (Task 1).
- Produces: `createRelatedPerson`'s input gains an optional `secondParentId?: string` (used only when `kind === "child"`). `AddRelationshipDialog` gains a required `partners: Person[]` prop.

- [ ] **Step 1: Make the "sibling" branch always create a direct sibling edge**

In `app/tre-slekt/actions.ts`, replace the `else` (sibling) branch of `createRelatedPerson` — the part that currently returns an error when there's no parent on file:

```ts
  } else {
    // sibling: always create a direct sibling edge to the selected person
    // (this is what makes the feature work with no parent on file). If the
    // selected person has active parent(s) recorded, additionally mirror
    // those same links onto the new sibling — extra detail when available,
    // never a precondition.
    edges = [{ other_person_id: input.selectedPersonId, relationship_type: "sibling", new_person_is_a: false }];

    const { data: parentLinks, error: parentError } = await supabase
      .from("relationships")
      .select("person_a_id, relationship_type")
      .eq("person_b_id", input.selectedPersonId)
      .in("relationship_type", [...PARENT_RELATIONSHIP_TYPES])
      .is("deleted_at", null);

    if (parentError) {
      return { ok: false, error: "Kunne ikke hente foreldre." };
    }

    for (const link of parentLinks ?? []) {
      edges.push({
        other_person_id: link.person_a_id,
        relationship_type: link.relationship_type,
        new_person_is_a: false,
      });
    }
  }
```

(`new_person_is_a: false` for the sibling edge is an arbitrary but harmless choice — `sibling` is symmetric, so which side is `person_a` vs `person_b` carries no meaning, same as the existing `partner` branch above it.)

- [ ] **Step 2: Add optional second-parent support to the "child" branch**

In the same function, add `secondParentId` to the input type:

```ts
export async function createRelatedPerson(input: {
  selectedPersonId: string;
  kind: RelationKind;
  givenName: string;
  familyName: string;
  gender: "male" | "female" | "unknown";
  relationshipType: string;
  secondParentId?: string;
}): Promise<{ ok: true; newPersonId: string } | { ok: false; error: string }> {
```

Change the `"child"` branch to optionally append a second edge:

```ts
  } else if (input.kind === "child") {
    // Selected person is the parent (person_a); the new person is the child (person_b).
    edges = [{ other_person_id: input.selectedPersonId, relationship_type: input.relationshipType, new_person_is_a: false }];
    if (input.secondParentId) {
      edges.push({ other_person_id: input.secondParentId, relationship_type: input.relationshipType, new_person_is_a: false });
    }
  } else if (input.kind === "partner") {
```

(Reorder if needed so this still reads top-to-bottom as father/mother → child → partner → sibling, matching the existing branch order in the file.)

- [ ] **Step 3: Remove the "no parent, no sibling" gating from the action bar**

In `app/tre-slekt/action-bar.tsx`, remove the `hasParent` computation and the `disabled`/`disabledReason` props on the "Legg til søsken" button — it's just a plain button now, same as the others:

```tsx
export function ActionBar({
  selectedPerson,
  onAdd,
  onDelete,
}: {
  selectedPerson: Person;
  onAdd: (kind: Kind) => void;
  onDelete: () => void;
}) {
  return (
    <div className="absolute bottom-6 left-[calc(50%-12rem)] z-10 flex -translate-x-1/2 items-center gap-1 rounded-full border border-line bg-surface p-1.5 shadow-lg">
      <ActionButton label="Legg til far" onClick={() => onAdd("father")} />
      <ActionButton label="Legg til mor" onClick={() => onAdd("mother")} />
      <ActionButton label="Legg til søsken" onClick={() => onAdd("sibling")} />
      <ActionButton label="Legg til partner" onClick={() => onAdd("partner")} />
      <ActionButton label="Legg til barn" onClick={() => onAdd("child")} />
      <span className="mx-1 h-6 w-px bg-line" aria-hidden="true" />
      <ActionButton label="Slett person" onClick={onDelete} destructive />
    </div>
  );
}
```

(`relationships` is dropped from the props entirely — it existed only to compute `hasParent`. `ActionButton`'s `disabled`/`disabledReason` props can stay defined on the helper — they're just unused by any call site now; that's fine and won't trigger a lint warning since they're optional parameters, not unused variables. The visual redesign — icons, combined father/mother button, responsive positioning — is a later task; this step only removes the gating.)

Update the one call site in `app/tre-slekt/canvas.tsx` (inside the `{isAdmin && selectedPerson && (...)}` block) to stop passing `relationships`:

```tsx
        <ActionBar
          selectedPerson={selectedPerson}
          onAdd={(kind) => setActiveDialog({ type: "add", kind })}
          onDelete={() => setActiveDialog({ type: "delete" })}
        />
```

- [ ] **Step 4: Compute the selected person's partners in `canvas.tsx` and pass them to the dialog**

In `app/tre-slekt/canvas.tsx`, add a `PARTNER_RELATIONSHIP_TYPES` set near the top of the file (it doesn't exist yet in this file as of Task 2 — `PARENT_RELATIONSHIP_TYPES` does):

```ts
const PARTNER_RELATIONSHIP_TYPES = new Set<Relationship["relationship_type"]>([
  "spouse",
  "partner",
  "former_spouse",
  "former_partner",
]);
```

Right after the `selectedPerson` line, add:

```ts
  const selectedPersonPartners = selectedPerson
    ? relationships
        .filter(
          (r) =>
            PARTNER_RELATIONSHIP_TYPES.has(r.relationship_type) &&
            (r.person_a_id === selectedPerson.id || r.person_b_id === selectedPerson.id)
        )
        .map((r) => peopleById.get(r.person_a_id === selectedPerson.id ? r.person_b_id : r.person_a_id))
        .filter((p): p is Person => p !== undefined)
    : [];
```

Pass it to the dialog:

```tsx
        {activeDialog?.type === "add" && selectedPerson && (
          <AddRelationshipDialog
            key={activeDialog.kind}
            kind={activeDialog.kind}
            selectedPerson={selectedPerson}
            partners={selectedPersonPartners}
            onClose={() => setActiveDialog(null)}
            onCreated={(newPersonId) => {
              setActiveDialog(null);
              setSelectedPersonId(newPersonId);
            }}
          />
        )}
```

- [ ] **Step 5: Add the "second parent" dropdown to `AddRelationshipDialog`**

In `app/tre-slekt/add-relationship-dialog.tsx`:

1. Add `partners: Person[]` to the props type and destructured parameters.
2. Add state: `const [secondParentId, setSecondParentId] = useState("");`
3. In `handleSubmit`, pass it through: add `secondParentId: secondParentId || undefined,` to the object passed to `createRelatedPerson`.
4. Render the dropdown right after the type-selector block, only for the "child" kind and only when there's at least one partner to offer:

```tsx
        {kind === "child" && partners.length > 0 && (
          <label className="mt-3 flex flex-col gap-1 text-sm">
            Sammen med (valgfritt)
            <select
              value={secondParentId}
              onChange={(e) => setSecondParentId(e.target.value)}
              className="rounded-lg border border-line bg-background px-3 py-1.5 text-foreground"
            >
              <option value="">Ingen valgt</option>
              {partners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.given_name} {p.family_name}
                </option>
              ))}
            </select>
          </label>
        )}
```

- [ ] **Step 6: Verify**

```bash
bunx tsc --noEmit
bun test
bun run lint
```

Manually verify in the browser as admin: "Legg til søsken" is now always clickable, even on a person with no parent on file, and creates a person linked by a direct sibling edge; selecting a person who has a partner on file and clicking "Legg til barn" shows the "Sammen med" dropdown, and choosing a partner there creates the child linked to both.

- [ ] **Step 7: Commit**

```bash
git add app/tre-slekt/actions.ts app/tre-slekt/action-bar.tsx app/tre-slekt/add-relationship-dialog.tsx app/tre-slekt/canvas.tsx
git commit -m "Make sibling creation always available; support a second parent on child creation"
```

---

### Task 4: Edge styling — solid current partners, dashed former, labeled siblings

**Files:**
- Modify: `app/tre-slekt/canvas.tsx`

**Interfaces:**
- Consumes: `PARTNER_RELATIONSHIP_TYPES` (Task 3, in this same file).
- Produces: no interface changes — this task only changes what `buildEdges` returns for existing relationship types.

- [ ] **Step 1: Split current vs. former partner styling in `buildEdges`**

In `app/tre-slekt/canvas.tsx`, replace the single `PARTNER_RELATIONSHIP_TYPES` set (added in Task 3) and the `RELATIONSHIP_LABELS` constant with:

```ts
const CURRENT_PARTNER_TYPES = new Set<Relationship["relationship_type"]>(["spouse", "partner"]);
const FORMER_PARTNER_TYPES = new Set<Relationship["relationship_type"]>(["former_spouse", "former_partner"]);
const PARTNER_RELATIONSHIP_TYPES = new Set<Relationship["relationship_type"]>([
  ...CURRENT_PARTNER_TYPES,
  ...FORMER_PARTNER_TYPES,
]);

// Norwegian labels shown on canvas edges for relationship types that
// aren't self-evident from their line style. Current partnerships need no
// label (solid line says "together"); former partnerships need no label
// either (the dashed line alone says "this ended" — see buildEdges).
const RELATIONSHIP_LABELS: Partial<Record<Relationship["relationship_type"], string>> = {
  adoptive_parent: "adoptivforelder",
  foster_parent: "fosterforelder",
  guardian_parent: "verge",
  sibling: "søsken",
};
```

(`PARTNER_RELATIONSHIP_TYPES` is still used by Task 3's `selectedPersonPartners` computation — keep that usage as-is, it just now references the combined set built from the two new ones above instead of being defined directly.)

Update `buildEdges` to only dash the *former* partner types, not current ones:

```ts
function buildEdges(relationships: Relationship[]) {
  return relationships.map((rel) => {
    const isParentEdge = PARENT_RELATIONSHIP_TYPES.has(rel.relationship_type);
    const isFormerPartnerEdge = FORMER_PARTNER_TYPES.has(rel.relationship_type);
    const label = RELATIONSHIP_LABELS[rel.relationship_type];

    return {
      id: rel.id,
      source: rel.person_a_id,
      target: rel.person_b_id,
      ...(isParentEdge && {
        type: "smoothstep",
        markerEnd: { type: MarkerType.ArrowClosed },
      }),
      ...(isFormerPartnerEdge && {
        style: { strokeDasharray: "5,5" },
      }),
      ...(label && { label }),
    };
  });
}
```

A `sibling` edge falls through both `isParentEdge` and `isFormerPartnerEdge` as `false`, so it renders as a plain solid line (React Flow's default `"default"` bezier edge type) with the `"søsken"` label from `RELATIONSHIP_LABELS` — visually distinct from an unlabeled solid current-partner line and from an arrow-marked parent-child line.

- [ ] **Step 2: Verify**

```bash
bunx tsc --noEmit
bun test
bun run lint
```

Manually verify in the browser: a current spouse/partner relationship now renders as a plain solid line with no label; a former spouse/partner renders dashed with no label (previously it showed "tidligere ektefelle"/"tidligere partner" text); a sibling relationship (created in Task 3) renders solid with a "søsken" label and no arrowhead.

- [ ] **Step 3: Commit**

```bash
git add app/tre-slekt/canvas.tsx
git commit -m "Style canvas edges: solid current partners, dashed former, labeled siblings"
```

---

### Task 5: Selected-person canvas highlight

**Files:**
- Modify: `app/tre-slekt/person-node.tsx`
- Modify: `app/tre-slekt/canvas.tsx`

**Interfaces:**
- Consumes: `selectedPersonId` (already local state in `FamilyTreeCanvas`).
- Produces: `PersonNode` accepts a `selected?: boolean` prop (React Flow passes this automatically to any custom node component based on the node's own `selected` field — no new plumbing needed beyond setting that field when building nodes).

- [ ] **Step 1: Style `PersonNode` when selected**

Replace `app/tre-slekt/person-node.tsx` in full:

```tsx
"use client";

import { Handle, Position } from "@xyflow/react";
import type { Person } from "@/lib/family-tree/data";

export const GENDER_ICON: Record<Person["gender"], string> = {
  male: "♂",
  female: "♀",
  unknown: "•",
};

export function PersonNode({ data, selected }: { data: { person: Person }; selected?: boolean }) {
  const { person } = data;
  const years = [person.birth_date_display, person.death_date_display].filter(Boolean).join(" – ");

  return (
    <div
      className={`flex items-center gap-2 rounded-xl border bg-surface px-3 py-2 transition-shadow ${
        selected
          ? "border-accent shadow-md ring-2 ring-accent ring-offset-2 ring-offset-background"
          : "border-line shadow-sm"
      }`}
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

- [ ] **Step 2: Set each node's `selected` field and keep it in sync with clicks**

In `app/tre-slekt/canvas.tsx`, update `buildNodes` to accept and use `selectedPersonId`:

```ts
function buildNodes(
  people: Person[],
  dagreLayout: Map<string, { x: number; y: number }>,
  selectedPersonId: string | null
) {
  return people.map((person) => ({
    id: person.id,
    type: "person",
    position: dagreLayout.get(person.id) ?? { x: 0, y: 0 },
    selected: person.id === selectedPersonId,
    data: { person },
  }));
}
```

Update both call sites:
1. `const initialNodes = buildNodes(people, dagreLayout, selectedPersonId);` (the initial-seed call in the component body).
2. Inside the `useEffect` added in Task 2, change `setNodes(buildNodes(people, dagreLayout));` to `setNodes(buildNodes(people, dagreLayout, selectedPersonId));`, and add `selectedPersonId` to that effect's dependency array: `}, [people, relationships, selectedPersonId]);` — this makes the effect also re-run (updating just the `selected` flag on every node, without touching positions) whenever the admin clicks a different person, so the highlight moves immediately.

- [ ] **Step 3: Verify**

```bash
bunx tsc --noEmit
bun test
bun run lint
```

Manually verify in the browser: clicking a person gives their node a visible accent-colored ring; clicking a different person moves the ring immediately (the previous person's ring disappears); clicking empty canvas space to deselect removes the ring from everyone (the `useEffect`'s `selectedPersonId` dependency becoming `null` re-runs `buildNodes` with `null`, so no node matches).

- [ ] **Step 4: Commit**

```bash
git add app/tre-slekt/person-node.tsx app/tre-slekt/canvas.tsx
git commit -m "Highlight the selected person's node on the canvas"
```

---

### Task 6: Responsive layout + action bar redesign

**Files:**
- Modify: `app/tre-slekt/canvas.tsx`
- Modify: `app/tre-slekt/detail-panel.tsx`
- Modify: `app/tre-slekt/action-bar.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `ActionBar`'s props change — `onAdd` still takes the same `Kind` union, but the "father"/"mother" split is now internal to the component (a popover), not two separate always-visible buttons.

- [ ] **Step 1: Make the canvas area and sidebar real flex siblings**

In `app/tre-slekt/canvas.tsx`, change the outer return statement's structure. The current root is a single `<div className="relative h-full w-full">` containing `<ReactFlow>`, then `{selectedPerson && <DetailPanel ... />}`, then the admin-only `ActionBar`/dialogs. Restructure so the canvas-specific content (ReactFlow, ActionBar, the two dialogs) lives inside its own flex-item wrapper, and `DetailPanel` is a sibling flex item after it, not an absolutely-positioned overlay on top of it:

```tsx
  return (
    <div className="flex h-full w-full">
      <div className="relative h-full flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={handleNodeClick}
          nodesDraggable={false}
          fitView
        >
          <Background />
          <Controls />
          <SearchBar
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            searchResults={searchResults}
            showSearchDropdown={showSearchDropdown}
            setShowSearchDropdown={setShowSearchDropdown}
            nodes={nodes}
            onSelectPerson={handleSelectPerson}
          />
        </ReactFlow>
        {isAdmin && selectedPerson && (
          <ActionBar
            selectedPerson={selectedPerson}
            onAdd={(kind) => setActiveDialog({ type: "add", kind })}
            onDelete={() => setActiveDialog({ type: "delete" })}
          />
        )}
        {activeDialog?.type === "add" && selectedPerson && (
          <AddRelationshipDialog
            key={activeDialog.kind}
            kind={activeDialog.kind}
            selectedPerson={selectedPerson}
            partners={selectedPersonPartners}
            onClose={() => setActiveDialog(null)}
            onCreated={(newPersonId) => {
              setActiveDialog(null);
              setSelectedPersonId(newPersonId);
            }}
          />
        )}
        {activeDialog?.type === "delete" && selectedPerson && (
          <DeletePersonDialog
            person={selectedPerson}
            onClose={() => setActiveDialog(null)}
            onDeleted={() => {
              setActiveDialog(null);
              setSelectedPersonId(null);
            }}
          />
        )}
      </div>
      {selectedPerson && (
        <DetailPanel
          person={selectedPerson}
          relationships={relationships}
          peopleById={peopleById}
          canEdit={canEdit}
          isAdmin={isAdmin}
          onClose={handleClosePanel}
          onSelectPerson={handleSelectPerson}
        />
      )}
    </div>
  );
```

(Nothing about *what* is rendered changes here, only *where in the tree* — `DetailPanel` moves from being the first thing after `</ReactFlow>` inside the single root div, to being a sibling of the new canvas-area wrapper div, at the same nesting level.)

- [ ] **Step 2: Make `DetailPanel` a real flex sibling from tablet width up, a full-screen overlay below it**

In `app/tre-slekt/detail-panel.tsx`, change the root `<aside>`'s className from:

```
absolute right-0 top-0 h-full w-96 overflow-y-auto border-l border-line bg-surface p-6 shadow-lg
```

to:

```
fixed inset-0 z-30 h-full w-full overflow-y-auto bg-surface p-6 sm:static sm:z-auto sm:w-96 sm:shrink-0 sm:border-l sm:border-line sm:shadow-lg
```

Below the `sm` breakpoint this is a full-screen overlay (`fixed inset-0`) sitting above the canvas; from `sm` up it participates in the flex row from Step 1 as a fixed-width (`w-96`) sibling that the canvas area shrinks to make room for, with its left border and shadow restored (they're dropped on the full-screen mobile view since there's nothing beside it to visually separate from).

- [ ] **Step 3: Redesign `ActionBar`: responsive positioning, shorter labels, icons, combined parent button**

Replace `app/tre-slekt/action-bar.tsx` in full:

```tsx
"use client";

import { useState } from "react";
import type { Person } from "@/lib/family-tree/data";

type Kind = "father" | "mother" | "sibling" | "partner" | "child";

export function ActionBar({
  selectedPerson,
  onAdd,
  onDelete,
}: {
  selectedPerson: Person;
  onAdd: (kind: Kind) => void;
  onDelete: () => void;
}) {
  const [showParentPopover, setShowParentPopover] = useState(false);

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-40 flex flex-wrap items-center justify-center gap-1 rounded-t-2xl border-t border-line bg-surface p-2 shadow-lg sm:absolute sm:inset-x-auto sm:bottom-6 sm:left-1/2 sm:z-10 sm:w-auto sm:-translate-x-1/2 sm:flex-nowrap sm:rounded-full sm:border sm:p-1.5"
      aria-label={`Handlinger for ${selectedPerson.given_name} ${selectedPerson.family_name}`}
    >
      <div
        className="relative"
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setShowParentPopover(false);
        }}
      >
        <ActionButton
          icon={<ParentIcon />}
          label="Forelder"
          onClick={() => setShowParentPopover((v) => !v)}
        />
        {showParentPopover && (
          <div className="absolute bottom-full left-1/2 mb-2 flex -translate-x-1/2 gap-1 rounded-xl border border-line bg-surface p-1.5 shadow-lg">
            <button
              onClick={() => {
                setShowParentPopover(false);
                onAdd("father");
              }}
              className="flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium text-foreground hover:bg-background"
            >
              <span aria-hidden="true">♂</span> Far
            </button>
            <button
              onClick={() => {
                setShowParentPopover(false);
                onAdd("mother");
              }}
              className="flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium text-foreground hover:bg-background"
            >
              <span aria-hidden="true">♀</span> Mor
            </button>
          </div>
        )}
      </div>
      <ActionButton icon={<SiblingIcon />} label="Søsken" onClick={() => onAdd("sibling")} />
      <ActionButton icon={<PartnerIcon />} label="Partner" onClick={() => onAdd("partner")} />
      <ActionButton icon={<ChildIcon />} label="Barn" onClick={() => onAdd("child")} />
      <span className="mx-1 hidden h-6 w-px bg-line sm:block" aria-hidden="true" />
      <ActionButton icon={<TrashIcon />} label="Slett" onClick={onDelete} destructive />
    </div>
  );
}

function ActionButton({
  icon,
  label,
  onClick,
  destructive,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-2 text-sm font-medium transition-colors ${
        destructive ? "text-error hover:bg-error/10" : "text-foreground hover:bg-background"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function ParentIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true" className="shrink-0">
      <circle cx="8" cy="6" r="3" stroke="currentColor" strokeWidth="1.5" />
      <path d="M3 17c0-3 2.2-5.5 5-5.5s5 2.5 5 5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M15.5 4v4M13.5 6h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function SiblingIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true" className="shrink-0">
      <circle cx="6.5" cy="6" r="2.5" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="13.5" cy="6" r="2.5" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M2.5 16.5c0-2.5 1.8-4.5 4-4.5s4 2 4 4.5M11.5 16.5c0-2.5 1.8-4.5 4-4.5s4 2 4 4.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function PartnerIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true" className="shrink-0">
      <path
        d="M10 17S3 12.5 3 7.8C3 5.1 5 3.5 7.2 3.5c1.3 0 2.4.6 2.8 1.6.4-1 1.5-1.6 2.8-1.6C15 3.5 17 5.1 17 7.8 17 12.5 10 17 10 17Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChildIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true" className="shrink-0">
      <circle cx="10" cy="6" r="2.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5.5 17c0-2.8 2-5 4.5-5s4.5 2.2 4.5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true" className="shrink-0">
      <path
        d="M4 6h12M8 6V4.5a1 1 0 011-1h2a1 1 0 011 1V6M6 6l.6 9.5a1 1 0 001 .9h4.8a1 1 0 001-.9L14 6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M8.5 9v4M11.5 9v4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}
```

Positioning notes for whoever implements this: below the `sm` breakpoint the bar is `fixed inset-x-0 bottom-0` — a full-width strip pinned to the very bottom of the viewport, `z-40` so it sits above `DetailPanel`'s `z-30` full-screen overlay from Step 2 (at that width, `DetailPanel` covers the canvas entirely, so the action bar has to float on top of it to stay usable — see the design spec's Section 5). From `sm` up, it switches to `absolute bottom-6 left-1/2 -translate-x-1/2` — centered *within the canvas-area flex item* from Step 1 (that div is `relative`, which is what makes this absolute positioning resolve against the canvas's actual width, not the whole screen) — so it's correctly centered at any window size with no hardcoded offset, and `DetailPanel` is a flex sibling taking its own space rather than something to dodge.

- [ ] **Step 4: Verify**

```bash
bunx tsc --noEmit
bun test
bun run lint
```

Manually verify in the browser as admin, resizing the window through a range of widths (including something narrower than 640px):
- Above the `sm` breakpoint: selecting a person shows the sidebar as a right-hand panel that the canvas visibly shrinks to accommodate, and the action bar stays centered in the remaining canvas area at every width in between, never overlapping the sidebar.
- Below the `sm` breakpoint: selecting a person makes the sidebar cover the whole screen, and the action bar's buttons are pinned to the bottom of that overlay, still fully clickable.
- The "Forelder" button opens a small popover with Far/Mor choices; picking one opens the same create dialog as before with that gender fixed; clicking elsewhere closes the popover without adding anyone.
- All labels read "Forelder", "Søsken", "Partner", "Barn", "Slett" (no repeated "Legg til", no "person" after "Slett"), each with a small icon.

- [ ] **Step 5: Commit**

```bash
git add app/tre-slekt/canvas.tsx app/tre-slekt/detail-panel.tsx app/tre-slekt/action-bar.tsx
git commit -m "Make the canvas/sidebar layout responsive; redesign the action bar with icons"
```

---

### Task 7: End-to-end manual verification and docs update

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/ROADMAP.md`

- [ ] **Step 1: Full verification pass**

```bash
bunx tsc --noEmit
bun test
bun run lint
```

- [ ] **Step 2: Manual verification as admin**

Confirm, in one pass through the app:
- A root ancestor with no parent on file can get a sibling added (previously impossible).
- Adding a child from a person with an existing partner offers that partner in the "Sammen med" dropdown, and choosing them links the child to both.
- Current partners render with a solid unlabeled line; former partners render dashed with no text label; siblings render solid with a "søsken" label.
- Two partners (or siblings) with no shared child still land next to each other on the canvas, not scattered based on their individual lineages.
- Selecting a person visibly highlights their node; selecting someone else moves the highlight; deselecting removes it.
- The action bar and sidebar never overlap at any window width, including a narrow one where the sidebar goes full-screen.
- There is no orientation toggle anywhere, and the tree only ever renders top-to-bottom.

- [ ] **Step 3: Update `CLAUDE.md`**

In the "UI/UX standing directives" section, update the line about the orientation toggle (it currently says the tree canvas layout has "a user-facing toggle between a top-to-bottom and a left-to-right orientation" — that's now false) to describe vertical-only automatic layout instead. Add a short note that "Legg til søsken" must remain available regardless of whether the selected person has a recorded parent, and that the action bar/sidebar layout must remain responsive (no fixed-width overlays that can collide) — these are now standing constraints, not just one-time fixes.

- [ ] **Step 4: Update `docs/ROADMAP.md`**

Add a line noting this polish round (link to this plan and its design spec) under Phase 4b's existing roadmap entry, or as its own short addendum — whichever reads more naturally given the current file's structure. Remove any remaining mention of the orientation toggle from the standing directives list.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md docs/ROADMAP.md
git commit -m "Update standing directives after the tree editing polish round"
```

- [ ] **Step 6: Report results**, including what was tested and any concerns.

---

## Self-Review Notes

- **Spec coverage:** every section of the design doc maps to a task — sibling relationship type (Task 1), vertical-only + layout adjacency (Task 2), sibling-always-available + second parent (Task 3), edge styling (Task 4), selection highlight (Task 5), responsive layout + action bar redesign (Task 6), verification + docs (Task 7).
- **Placeholder scan:** no TBD/TODO; the only deferred literal is the migration's server-assigned version number, this project's standing convention.
- **Type consistency:** `Relationship["relationship_type"]` gains `"sibling"` in Task 1 and every later task that pattern-matches on relationship types (`layout.ts`'s `ADJACENCY_TYPES`, `canvas.tsx`'s `RELATIONSHIP_LABELS`) is updated consistently with it. `buildNodes`'s signature changes exactly once (Task 5, adding `selectedPersonId`) and every call site is updated in that same task. `ActionBar`'s props lose `relationships` in Task 3 and gain no new required prop until Task 6's icon rework, which doesn't change the prop list further. `computeDagreLayout`'s two-argument signature (Task 2) is used consistently by every later task that touches `canvas.tsx`.
