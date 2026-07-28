# Tree Layout Fix, Straight Edges, Combined Parents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the confirmed node-overlap bug (a branch's descendants can need more width than the branch's own composite node, and Dagre isn't told that), switch partner/sibling edges to straight lines matching the reference layout (with siblings-sharing-a-parent showing no direct line at all), and replace the separate "add father"/"add mother" actions with one "Legg til foreldre" action that creates both parents at once, already connected to each other.

**Architecture:** The layout fix adds one recursive width calculation to the existing Dagre-based `computeDagreLayout` — no framework change, no new dependency. The edge-routing fix is a small, self-contained change to `buildEdges`. The combined-parents feature follows the same atomic-RPC pattern already established for every other creation flow in this app (`create_related_person`, `delete_person`): one new `create_parent_pair` RPC, one new dialog component, one small action-bar change. See `docs/superpowers/specs/2026-07-28-tree-layout-and-parents-design.md` for the full design.

**Tech Stack:** Next.js 16 canary, Supabase (Postgres/RLS), React Flow, Dagre, Bun — all unchanged from prior phases.

## Global Constraints

- 100% Norwegian UI text; code/comments in English.
- `bunx tsc --noEmit`, `bun test`, and `bun run lint` must all be clean at the end of every task.
- This project uses Bun — `bun install`, `bunx <pkg>`, never npm/yarn/pnpm.
- Migration filenames get server-assigned versions from `mcp__supabase__apply_migration` — always call `mcp__supabase__list_migrations` after applying and name the local `.sql` file with the real returned version, never a guessed timestamp.
- Nodes must never overlap — this is the primary bug this plan fixes; any new layout test added here must actually assert non-overlap, not just "same rank" or "distinct x".
- Admin-only: creating people/relationships remains admin-gated via `app_is_admin()` inside every RPC, re-checked by `requireAdmin()` in every server action — the new `create_parent_pair` RPC and `createParentPair` action must follow this exact pattern, no exceptions.
- The `AddRelationshipDialog`/`ActionBar`/`actions.ts` "father"/"mother" `RelationKind` values and code paths are removed entirely in this plan — there is no path to add just one parent from the UI afterward.

---

### Task 1: Fix node overlap — recursive subtree-width layout

**Files:**
- Modify: `lib/family-tree/layout.ts`
- Modify: `lib/family-tree/layout.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `computeDagreLayout`'s public signature and return type are unchanged — this task only changes internal width bookkeeping.

- [ ] **Step 1: Add `computeSubtreeWidth` and wire it into the width Dagre sees**

In `lib/family-tree/layout.ts`, add this function after `orderGroupMembers` and before `computeDagreLayout`:

```ts
// Computes how much horizontal width a group's entire descendant subtree
// needs — not just the group's own width. A group with children whose
// combined width exceeds the group's own width (e.g. a couple with three
// children together, needing more room than the couple's own 2-person
// box) must reserve that larger amount, or Dagre has no way to know to
// keep a neighboring branch from encroaching on it. Memoized because the
// same group can appear as a "child" under more than one parent group in
// blended-family cases (see the doc comment on computeDagreLayout).
function computeSubtreeWidth(
  groupId: string,
  ownWidth: Map<string, number>,
  childrenByGroup: Map<string, Set<string>>,
  cache: Map<string, number>
): number {
  const cached = cache.get(groupId);
  if (cached !== undefined) return cached;

  const own = ownWidth.get(groupId)!;
  const children = childrenByGroup.get(groupId);
  let width = own;
  if (children && children.size > 0) {
    const childrenTotal =
      [...children].reduce(
        (sum, childId) => sum + computeSubtreeWidth(childId, ownWidth, childrenByGroup, cache),
        0
      ) +
      (children.size - 1) * NODE_GAP;
    width = Math.max(own, childrenTotal);
  }

  cache.set(groupId, width);
  return width;
}
```

Then, inside `computeDagreLayout`, replace this block:

```ts
  const graph = new dagre.graphlib.Graph();
  graph.setGraph({ rankdir: "TB", nodesep: NODE_GAP, ranksep: 100 });
  graph.setDefaultEdgeLabel(() => ({}));

  for (const [groupId, members] of groups) {
    const width = members.length * NODE_WIDTH + (members.length - 1) * NODE_GAP;
    graph.setNode(groupId, { width, height: NODE_HEIGHT });
  }

  for (const rel of relationships) {
    if (!PARENT_TYPES.has(rel.relationship_type)) continue;
    const from = dagreNodeIdFor.get(rel.person_a_id)!;
    const to = dagreNodeIdFor.get(rel.person_b_id)!;
    // Both ends collapsed into the same adjacency group (e.g. bad data
    // pairing two "siblings" who also have a parent-child edge on file) —
    // skip rather than create a self-loop Dagre can't rank.
    if (from === to) continue;
    graph.setEdge(from, to);
  }

  dagre.layout(graph);

  const result = new Map<string, { x: number; y: number }>();
  for (const [groupId, members] of groups) {
    const node = graph.node(groupId);
    const totalWidth = members.length * NODE_WIDTH + (members.length - 1) * NODE_GAP;
    let x = node.x - totalWidth / 2 + NODE_WIDTH / 2;
    for (const id of members) {
      result.set(id, { x, y: node.y });
      x += NODE_WIDTH + NODE_GAP;
    }
  }
  return result;
```

with:

```ts
  const graph = new dagre.graphlib.Graph();
  graph.setGraph({ rankdir: "TB", nodesep: NODE_GAP, ranksep: 100 });
  graph.setDefaultEdgeLabel(() => ({}));

  // Each group's own width (just the group's own members, no descendants) —
  // used both as the base case for computeSubtreeWidth and, unchanged from
  // before, to expand a group's assigned position back into its individual
  // members' x positions.
  const ownWidth = new Map<string, number>();
  for (const [groupId, members] of groups) {
    ownWidth.set(groupId, members.length * NODE_WIDTH + (members.length - 1) * NODE_GAP);
  }

  // groupId -> set of child group ids (deduplicated — a child with two
  // parents in the same group would otherwise redirect two separate
  // parent-child relationship rows onto the same from/to pair).
  const childrenByGroup = new Map<string, Set<string>>();
  for (const rel of relationships) {
    if (!PARENT_TYPES.has(rel.relationship_type)) continue;
    const from = dagreNodeIdFor.get(rel.person_a_id)!;
    const to = dagreNodeIdFor.get(rel.person_b_id)!;
    // Both ends collapsed into the same adjacency group (e.g. bad data
    // pairing two "siblings" who also have a parent-child edge on file) —
    // skip rather than create a self-loop Dagre can't rank.
    if (from === to) continue;
    if (!childrenByGroup.has(from)) childrenByGroup.set(from, new Set());
    childrenByGroup.get(from)!.add(to);
  }

  const subtreeWidthCache = new Map<string, number>();
  for (const [groupId] of groups) {
    graph.setNode(groupId, {
      width: computeSubtreeWidth(groupId, ownWidth, childrenByGroup, subtreeWidthCache),
      height: NODE_HEIGHT,
    });
  }

  for (const [from, children] of childrenByGroup) {
    for (const to of children) {
      graph.setEdge(from, to);
    }
  }

  dagre.layout(graph);

  const result = new Map<string, { x: number; y: number }>();
  for (const [groupId, members] of groups) {
    const node = graph.node(groupId);
    const totalWidth = ownWidth.get(groupId)!;
    let x = node.x - totalWidth / 2 + NODE_WIDTH / 2;
    for (const id of members) {
      result.set(id, { x, y: node.y });
      x += NODE_WIDTH + NODE_GAP;
    }
  }
  return result;
```

(The `for (const rel of relationships) { ... graph.setEdge(from, to); }` loop is replaced by iterating the already-deduplicated `childrenByGroup` map instead — same edges end up in the graph, just built once from the map that `computeSubtreeWidth` also needs, instead of re-scanning `relationships` a second time.)

Update the function's doc comment to mention this — insert this paragraph right after the existing paragraph that ends "...so they land on the same rank and end up adjacent.":

```
 * Each group's declared Dagre width is not just its own width, though —
 * it's the width of its entire descendant subtree (computeSubtreeWidth),
 * so a branch whose children collectively need more room than the branch
 * itself doesn't get an undersized column and overlap its neighbor. A
 * child with two parents in different, unconnected groups (e.g. separated
 * parents with no relationship recorded between them) has its width
 * counted by both parent groups independently — a conservative,
 * redundant over-reservation rather than a tight optimum, which is safe
 * (extra whitespace) where under-reservation would be the bug.
```

- [ ] **Step 2: Add a regression test for the exact overlap scenario**

Append to `lib/family-tree/layout.test.ts`:

```ts
test("reserves enough width for a wide branch so it doesn't overlap its neighbor", () => {
  // topA+topB have two children, b1a and b2a. b1a partners with b1b and
  // they have THREE children together (needing more width than b1a+b1b's
  // own 2-person box); b2a partners with b2b and they have only one child.
  // This is the exact shape of the confirmed overlap bug: b1's branch
  // needs 3*200+2*40=680px for its children, more than its own 440px.
  const topA = makePerson("topA", "TopA");
  const topB = makePerson("topB", "TopB");
  const b1a = makePerson("b1a", "B1A");
  const b1b = makePerson("b1b", "B1B");
  const b2a = makePerson("b2a", "B2A");
  const b2b = makePerson("b2b", "B2B");
  const c1 = makePerson("c1", "C1");
  const c2 = makePerson("c2", "C2");
  const c3 = makePerson("c3", "C3");
  const c4 = makePerson("c4", "C4");
  const people = [topA, topB, b1a, b1b, b2a, b2b, c1, c2, c3, c4];
  const relationships = [
    makeRelationship("r1", "topA", "topB", "spouse"),
    makeRelationship("r2", "topA", "b1a", "biological_parent"),
    makeRelationship("r3", "topB", "b1a", "biological_parent"),
    makeRelationship("r4", "topA", "b2a", "biological_parent"),
    makeRelationship("r5", "topB", "b2a", "biological_parent"),
    makeRelationship("r6", "b1a", "b1b", "spouse"),
    makeRelationship("r7", "b2a", "b2b", "spouse"),
    makeRelationship("r8", "b1a", "c1", "biological_parent"),
    makeRelationship("r9", "b1b", "c1", "biological_parent"),
    makeRelationship("r10", "b1a", "c2", "biological_parent"),
    makeRelationship("r11", "b1b", "c2", "biological_parent"),
    makeRelationship("r12", "b1a", "c3", "biological_parent"),
    makeRelationship("r13", "b1b", "c3", "biological_parent"),
    makeRelationship("r14", "b2a", "c4", "biological_parent"),
    makeRelationship("r15", "b2b", "c4", "biological_parent"),
  ];

  const layout = computeDagreLayout(people, relationships);

  // All four grandchildren are at the same rank. With a uniform node width
  // of 200px, no two of them should be closer than 200px center-to-center
  // — anything less means their boxes overlap.
  const grandchildren = ["c1", "c2", "c3", "c4"];
  for (let i = 0; i < grandchildren.length; i++) {
    for (let j = i + 1; j < grandchildren.length; j++) {
      const xi = layout.get(grandchildren[i])!.x;
      const xj = layout.get(grandchildren[j])!.x;
      expect(Math.abs(xi - xj)).toBeGreaterThanOrEqual(200);
    }
  }
});
```

- [ ] **Step 3: Verify**

```bash
bunx tsc --noEmit
bun test
bun run lint
```

Expected: the new test passes, and all 7 previously-existing layout tests still pass unchanged.

- [ ] **Step 4: Commit**

```bash
git add lib/family-tree/layout.ts lib/family-tree/layout.test.ts
git commit -m "Fix node overlap: reserve subtree width, not just own width, per branch"
```

---

### Task 2: Straight edges, with no direct sibling line when a parent is shared

**Files:**
- Modify: `app/tre-slekt/canvas.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: no interface changes — `buildEdges`'s signature and the shape of what it returns are unchanged; only which edges appear and their `type` change.

- [ ] **Step 1: Rewrite `buildEdges`**

In `app/tre-slekt/canvas.tsx`, replace the current `buildEdges` function:

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

with:

```ts
function buildEdges(relationships: Relationship[]) {
  // person id -> set of that person's active parent ids, used below to
  // check whether two siblings already share a recorded parent.
  const parentsOf = new Map<string, Set<string>>();
  for (const rel of relationships) {
    if (!PARENT_RELATIONSHIP_TYPES.has(rel.relationship_type)) continue;
    if (!parentsOf.has(rel.person_b_id)) parentsOf.set(rel.person_b_id, new Set());
    parentsOf.get(rel.person_b_id)!.add(rel.person_a_id);
  }

  function shareActiveParent(personAId: string, personBId: string): boolean {
    const parentsA = parentsOf.get(personAId);
    const parentsB = parentsOf.get(personBId);
    if (!parentsA || !parentsB) return false;
    for (const p of parentsA) {
      if (parentsB.has(p)) return true;
    }
    return false;
  }

  return relationships
    .filter((rel) => {
      // A sibling edge is only drawn when the pair does NOT already share
      // a recorded parent — the shared parent's own bus already shows the
      // connection, and a separate line would be redundant clutter.
      if (rel.relationship_type === "sibling") {
        return !shareActiveParent(rel.person_a_id, rel.person_b_id);
      }
      return true;
    })
    .map((rel) => {
      const isParentEdge = PARENT_RELATIONSHIP_TYPES.has(rel.relationship_type);
      const isFormerPartnerEdge = FORMER_PARTNER_TYPES.has(rel.relationship_type);
      const isSiblingEdge = rel.relationship_type === "sibling";
      const label = RELATIONSHIP_LABELS[rel.relationship_type];

      return {
        id: rel.id,
        source: rel.person_a_id,
        target: rel.person_b_id,
        ...(isParentEdge && {
          type: "smoothstep",
          markerEnd: { type: MarkerType.ArrowClosed },
        }),
        ...((PARTNER_RELATIONSHIP_TYPES.has(rel.relationship_type) || isSiblingEdge) && {
          type: "straight",
        }),
        ...(isFormerPartnerEdge && {
          style: { strokeDasharray: "5,5" },
        }),
        ...(label && { label }),
      };
    });
}
```

- [ ] **Step 2: Verify**

```bash
bunx tsc --noEmit
bun test
bun run lint
```

Manually verify in the browser: a current partner relationship renders as a plain straight solid line; a former partner renders as a straight dashed line; siblings who share a recorded parent show no direct line between them at all (only the parent's bus); a sibling relationship with no shared parent on file still renders as a straight solid "søsken"-labeled line.

- [ ] **Step 3: Commit**

```bash
git add app/tre-slekt/canvas.tsx
git commit -m "Use straight edges for partners/siblings; hide sibling line when a parent is shared"
```

---

### Task 3: `create_parent_pair` RPC and server action

**Files:**
- Create: `supabase/migrations/<server-assigned-version>_add_create_parent_pair_rpc.sql`
- Modify: `app/tre-slekt/actions.ts`

**Interfaces:**
- Consumes: `requireAdmin()` (existing helper in this file).
- Produces: `createParentPair(input): Promise<{ ok: true } | { ok: false; error: string }>` where `input: { childId: string; fatherGivenName: string; fatherFamilyName: string; motherGivenName: string; motherFamilyName: string; parentRelationshipType: string; partnerRelationshipType: string }`. `createRelatedPerson`'s `kind` union shrinks to `"sibling" | "partner" | "child"` (no more `"father"`/`"mother"`).

- [ ] **Step 1: Apply the migration**

Use `mcp__supabase__apply_migration` with this SQL, then `mcp__supabase__list_migrations` to get the real assigned version, then write the local file at `supabase/migrations/<that-version>_add_create_parent_pair_rpc.sql`:

```sql
-- Atomic "create both parents at once, already connected to each other
-- and to the selected child" RPC — replaces the old one-parent-at-a-time
-- flow, which had no way to link two independently-added parents to each
-- other. Mirrors create_related_person's transactional pattern: if
-- anything fails partway, nothing is left half-created.
create or replace function create_parent_pair(
  p_father_given_name text,
  p_father_family_name text,
  p_mother_given_name text,
  p_mother_family_name text,
  p_parent_relationship_type relationship_type,
  p_partner_relationship_type relationship_type,
  p_child_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  father_id uuid;
  mother_id uuid;
begin
  if not app_is_admin() then
    raise exception 'Not authorized';
  end if;

  if not exists (select 1 from people where id = p_child_id and deleted_at is null) then
    raise exception 'Child not found';
  end if;

  insert into people (given_name, family_name, gender, is_living, created_by, updated_by)
  values (p_father_given_name, p_father_family_name, 'male', true, auth.uid(), auth.uid())
  returning id into father_id;

  insert into people (given_name, family_name, gender, is_living, created_by, updated_by)
  values (p_mother_given_name, p_mother_family_name, 'female', true, auth.uid(), auth.uid())
  returning id into mother_id;

  insert into relationships (person_a_id, person_b_id, relationship_type, created_by, updated_by)
  values (father_id, mother_id, p_partner_relationship_type, auth.uid(), auth.uid());

  insert into relationships (person_a_id, person_b_id, relationship_type, created_by, updated_by)
  values (father_id, p_child_id, p_parent_relationship_type, auth.uid(), auth.uid());

  insert into relationships (person_a_id, person_b_id, relationship_type, created_by, updated_by)
  values (mother_id, p_child_id, p_parent_relationship_type, auth.uid(), auth.uid());
end;
$$;

grant execute on function create_parent_pair(text, text, text, text, relationship_type, relationship_type, uuid) to authenticated;
```

- [ ] **Step 2: Remove the "father"/"mother" path from `createRelatedPerson`**

In `app/tre-slekt/actions.ts`, change the `RelationKind` type:

```ts
type RelationKind = "sibling" | "partner" | "child";
```

Remove the `if (input.kind === "father" || input.kind === "mother") { ... }` branch entirely from `createRelatedPerson`. The remaining chain becomes:

```ts
  if (input.kind === "child") {
    // Selected person is the parent (person_a); the new person is the child (person_b).
    edges = [{ other_person_id: input.selectedPersonId, relationship_type: input.relationshipType, new_person_is_a: false }];
    if (input.secondParentId) {
      edges.push({ other_person_id: input.secondParentId, relationship_type: input.relationshipType, new_person_is_a: false });
    }
  } else if (input.kind === "partner") {
    edges = [{ other_person_id: input.selectedPersonId, relationship_type: input.relationshipType, new_person_is_a: false }];
  } else {
    // sibling: always create a direct sibling edge to the selected person
    // ...(rest of the existing sibling branch, unchanged)
  }
```

- [ ] **Step 3: Add `createParentPair`**

Append to `app/tre-slekt/actions.ts`:

```ts
export async function createParentPair(input: {
  childId: string;
  fatherGivenName: string;
  fatherFamilyName: string;
  motherGivenName: string;
  motherFamilyName: string;
  parentRelationshipType: string;
  partnerRelationshipType: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const authCheck = await requireAdmin();
  if (!authCheck.ok) return authCheck;
  const { supabase } = authCheck;

  const fatherGivenName = input.fatherGivenName.trim();
  const fatherFamilyName = input.fatherFamilyName.trim();
  const motherGivenName = input.motherGivenName.trim();
  const motherFamilyName = input.motherFamilyName.trim();
  if (!fatherGivenName || !fatherFamilyName || !motherGivenName || !motherFamilyName) {
    return { ok: false, error: "Alle navnefelt må fylles ut." };
  }

  const { error } = await supabase.rpc("create_parent_pair", {
    p_father_given_name: fatherGivenName,
    p_father_family_name: fatherFamilyName,
    p_mother_given_name: motherGivenName,
    p_mother_family_name: motherFamilyName,
    p_parent_relationship_type: input.parentRelationshipType,
    p_partner_relationship_type: input.partnerRelationshipType,
    p_child_id: input.childId,
  });

  if (error) {
    return { ok: false, error: "Kunne ikke opprette foreldrene." };
  }

  return { ok: true };
}
```

- [ ] **Step 4: Verify**

```bash
bunx tsc --noEmit
bun test
bun run lint
```

`bunx tsc --noEmit` will show errors in `app/tre-slekt/action-bar.tsx` and `app/tre-slekt/add-relationship-dialog.tsx` at this point (they still reference `"father"`/`"mother"`) — that's expected, Task 4 fixes those files. Confirm the errors are confined to those two files and that `app/tre-slekt/actions.ts` itself compiles with no errors (you can check this narrowly with `bunx tsc --noEmit 2>&1 | grep actions.ts` — it should show no output).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations app/tre-slekt/actions.ts
git commit -m "Add create_parent_pair RPC and server action"
```

---

### Task 4: Combined "Legg til foreldre" UI

**Files:**
- Create: `app/tre-slekt/add-parents-dialog.tsx`
- Modify: `app/tre-slekt/action-bar.tsx`
- Modify: `app/tre-slekt/add-relationship-dialog.tsx`
- Modify: `app/tre-slekt/canvas.tsx`

**Interfaces:**
- Consumes: `createParentPair` (Task 3).
- Produces: `ActionBar` gains an `onAddParents: () => void` prop and its `Kind` union shrinks to `"sibling" | "partner" | "child"`. `AddParentsDialog` is a new component: `{ childId: string; onClose: () => void; onCreated: () => void }`.

- [ ] **Step 1: Create `AddParentsDialog`**

Create `app/tre-slekt/add-parents-dialog.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createParentPair } from "./actions";

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

export function AddParentsDialog({
  childId,
  onClose,
  onCreated,
}: {
  childId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [fatherGivenName, setFatherGivenName] = useState("");
  const [fatherFamilyName, setFatherFamilyName] = useState("");
  const [motherGivenName, setMotherGivenName] = useState("");
  const [motherFamilyName, setMotherFamilyName] = useState("");
  const [parentRelationshipType, setParentRelationshipType] = useState(PARENT_TYPE_OPTIONS[0].value);
  const [partnerRelationshipType, setPartnerRelationshipType] = useState(PARTNER_TYPE_OPTIONS[0].value);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await createParentPair({
        childId,
        fatherGivenName,
        fatherFamilyName,
        motherGivenName,
        motherFamilyName,
        parentRelationshipType,
        partnerRelationshipType,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onCreated();
      router.refresh();
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/20 px-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm rounded-2xl border border-line bg-surface p-6 shadow-lg">
        <h2 className="font-serif text-lg font-medium text-foreground">Legg til foreldre</h2>
        {error && <p className="mt-3 text-sm text-error">{error}</p>}

        <p className="mt-4 text-sm font-medium text-foreground">Far</p>
        <label className="mt-2 flex flex-col gap-1 text-sm">
          Fornavn
          <input
            value={fatherGivenName}
            onChange={(e) => setFatherGivenName(e.target.value)}
            required
            autoFocus
            className="rounded-lg border border-line bg-background px-3 py-1.5 text-foreground"
          />
        </label>
        <label className="mt-2 flex flex-col gap-1 text-sm">
          Etternavn
          <input
            value={fatherFamilyName}
            onChange={(e) => setFatherFamilyName(e.target.value)}
            required
            className="rounded-lg border border-line bg-background px-3 py-1.5 text-foreground"
          />
        </label>

        <p className="mt-4 text-sm font-medium text-foreground">Mor</p>
        <label className="mt-2 flex flex-col gap-1 text-sm">
          Fornavn
          <input
            value={motherGivenName}
            onChange={(e) => setMotherGivenName(e.target.value)}
            required
            className="rounded-lg border border-line bg-background px-3 py-1.5 text-foreground"
          />
        </label>
        <label className="mt-2 flex flex-col gap-1 text-sm">
          Etternavn
          <input
            value={motherFamilyName}
            onChange={(e) => setMotherFamilyName(e.target.value)}
            required
            className="rounded-lg border border-line bg-background px-3 py-1.5 text-foreground"
          />
        </label>

        <label className="mt-4 flex flex-col gap-1 text-sm">
          Relasjonstype (foreldre → barn)
          <select
            value={parentRelationshipType}
            onChange={(e) => setParentRelationshipType(e.target.value)}
            className="rounded-lg border border-line bg-background px-3 py-1.5 text-foreground"
          >
            {PARENT_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        <label className="mt-3 flex flex-col gap-1 text-sm">
          Relasjonstype (far ↔ mor)
          <select
            value={partnerRelationshipType}
            onChange={(e) => setPartnerRelationshipType(e.target.value)}
            className="rounded-lg border border-line bg-background px-3 py-1.5 text-foreground"
          >
            {PARTNER_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

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

- [ ] **Step 2: Replace the Forelder popover in `ActionBar`**

Replace `app/tre-slekt/action-bar.tsx` in full:

```tsx
"use client";

import type { Person } from "@/lib/family-tree/data";

type Kind = "sibling" | "partner" | "child";

export function ActionBar({
  selectedPerson,
  onAdd,
  onAddParents,
  onDelete,
}: {
  selectedPerson: Person;
  onAdd: (kind: Kind) => void;
  onAddParents: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className="fixed inset-x-0 bottom-0 z-40 flex flex-wrap items-center justify-center gap-1 rounded-t-2xl border-t border-line bg-surface p-2 shadow-lg sm:absolute sm:inset-x-auto sm:bottom-6 sm:left-1/2 sm:z-10 sm:w-auto sm:-translate-x-1/2 sm:flex-nowrap sm:rounded-full sm:border sm:p-1.5"
      aria-label={`Handlinger for ${selectedPerson.given_name} ${selectedPerson.family_name}`}
    >
      <ActionButton icon={<ParentIcon />} label="Foreldre" onClick={onAddParents} />
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

(The only changes from the current file: `Kind` drops `"father" | "mother"`; the popover `useState`/wrapping `<div>`/two popover buttons are gone; a single `ActionButton` for "Foreldre" calls the new `onAddParents` prop directly. `ActionButton` and all icon functions are unchanged.)

- [ ] **Step 3: Remove father/mother handling from `AddRelationshipDialog`**

In `app/tre-slekt/add-relationship-dialog.tsx`:

1. Change `type Kind = "father" | "mother" | "sibling" | "partner" | "child";` to `type Kind = "sibling" | "partner" | "child";`.
2. Remove the `father`/`mother` entries from `KIND_LABEL_NO`:

```ts
const KIND_LABEL_NO: Record<Kind, string> = {
  sibling: "Legg til søsken",
  partner: "Legg til partner",
  child: "Legg til barn",
};
```

3. Simplify the gender initializer (father/mother no longer exist, so the fixed-gender cases are gone — every remaining kind already shows a gender selector):

```ts
  const [gender, setGender] = useState<Person["gender"]>("unknown");
```

4. Remove the `showGenderSelector` variable and its usage — the gender selector `<label>` block should always render now. Change:

```tsx
        {showGenderSelector && (
          <label className="mt-3 flex flex-col gap-1 text-sm">
            Kjønn
            ...
          </label>
        )}
```

to just the `<label>` block unconditionally (drop the `showGenderSelector && (...)` wrapper, keep the label/select exactly as it was inside it).

`showTypeSelector`, `typeOptions`, `familyName`'s initializer (`kind === "partner" ? "" : selectedPerson.family_name`), and everything else in the file is unchanged.

- [ ] **Step 4: Wire `AddParentsDialog` into `canvas.tsx`**

In `app/tre-slekt/canvas.tsx`:

1. Add the import: `import { AddParentsDialog } from "./add-parents-dialog";`
2. Change the `activeDialog` state type:

```ts
  const [activeDialog, setActiveDialog] = useState<
    | { type: "add"; kind: "sibling" | "partner" | "child" }
    | { type: "add-parents" }
    | { type: "delete" }
    | null
  >(null);
```

3. Add `onAddParents` to the `<ActionBar>` call:

```tsx
        {isAdmin && selectedPerson && (
          <ActionBar
            selectedPerson={selectedPerson}
            onAdd={(kind) => setActiveDialog({ type: "add", kind })}
            onAddParents={() => setActiveDialog({ type: "add-parents" })}
            onDelete={() => setActiveDialog({ type: "delete" })}
          />
        )}
```

4. Add a render block for the new dialog, right after the existing `{activeDialog?.type === "add" && ...}` block:

```tsx
        {activeDialog?.type === "add-parents" && selectedPerson && (
          <AddParentsDialog
            childId={selectedPerson.id}
            onClose={() => setActiveDialog(null)}
            onCreated={() => setActiveDialog(null)}
          />
        )}
```

(No selection change on success — with two new people created, there's no single obvious "the new person" to jump to, so focus stays on the child whose parents were just added.)

- [ ] **Step 5: Verify**

```bash
bunx tsc --noEmit
bun test
bun run lint
```

Manually verify in the browser as admin: selecting a person shows a single "Foreldre" button (no popover); clicking it opens the two-parent dialog; submitting creates both people, connects them to each other with the chosen relationship type, connects both to the selected person as parents, and the canvas shows all three correctly connected with no overlap.

- [ ] **Step 6: Commit**

```bash
git add app/tre-slekt/add-parents-dialog.tsx app/tre-slekt/action-bar.tsx app/tre-slekt/add-relationship-dialog.tsx app/tre-slekt/canvas.tsx
git commit -m "Replace add-father/add-mother with a single combined add-parents action"
```

---

### Task 5: End-to-end manual verification

**Files:** none.

- [ ] **Step 1: Full verification pass**

```bash
bunx tsc --noEmit
bun test
bun run lint
```

- [ ] **Step 2: Manual verification as admin**

Confirm, in one pass through the app (against the real data if convenient, since the exact overlap scenario already exists there):
- The previously-overlapping branch (a couple with three children, next to a couple with one child) now renders with no overlap anywhere.
- Current partners render as a straight solid line; former partners as a straight dashed line.
- Siblings who share a recorded parent show no direct line; a sibling relationship with no shared parent still shows a straight "søsken"-labeled line.
- The action bar shows one "Foreldre" button (no popover); using it creates both parents in one step, connected to each other and to the selected person, with no leftover reference to "Legg til far"/"Legg til mor" anywhere in the UI.

- [ ] **Step 3: Report results**, including what was tested and any concerns.

---

## Self-Review Notes

- **Spec coverage:** every section of the design doc maps to a task — the recursive subtree-width fix (Task 1, with a regression test reproducing the exact confirmed bug), straight edges with the shared-parent sibling-line suppression (Task 2), the `create_parent_pair` RPC and action (Task 3), and the combined UI replacing the Far/Mor popover (Task 4), plus verification (Task 5).
- **Placeholder scan:** no TBD/TODO; the only deferred literal is the migration's server-assigned version number, this project's standing convention.
- **Type consistency:** `RelationKind`/`Kind` (spelled identically as a local type alias in `actions.ts`, `action-bar.tsx`, and `add-relationship-dialog.tsx`, per this codebase's existing — not newly introduced — convention of not sharing these across files) shrinks to `"sibling" | "partner" | "child"` consistently across all three in Tasks 3 and 4; no file is left referencing `"father"`/`"mother"` after Task 4. `computeSubtreeWidth`'s signature and the `ownWidth`/`childrenByGroup` maps it depends on are introduced and consumed entirely within Task 1's single file. `createParentPair`'s parameter names match exactly between the RPC (Task 3 migration) and the `supabase.rpc(...)` call (Task 3 action).
