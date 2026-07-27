# Static Canvas, Orientation Toggle, and Light-Mode-Only Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove drag-to-reposition and `canvas_positions` entirely in favor of an always-automatic Dagre layout with a top-to-bottom/left-to-right orientation toggle, and drop dark mode so the app is light-only.

**Architecture:** No new subsystems — this removes a feature (saved positions) and adds one small piece of client state (orientation, persisted to `localStorage`). See `docs/superpowers/specs/2026-07-28-static-canvas-light-mode-design.md` for the full design.

**Tech Stack:** Next.js 16 canary, Supabase (Postgres/RLS), React Flow, Dagre — all unchanged.

## Global Constraints

- 100% Norwegian UI text; code/comments in English.
- `bunx tsc --noEmit`, `bun test`, and `bun run lint` must all be clean at the end of every task.
- This project uses Bun — `bun install`, `bunx <pkg>`, never npm/yarn/pnpm.
- Migration filenames get server-assigned versions from `mcp__supabase__apply_migration` — always call `mcp__supabase__list_migrations` after applying and name the local `.sql` file with the real returned version, never a guessed timestamp.
- Nodes must never be draggable, for guest, member, or admin alike — this is unconditional, not gated by role.
- Pan/zoom (scroll-zoom, drag-empty-space-to-pan, the `+`/`-`/fit-view controls) must keep working exactly as before — only node dragging is removed.

---

### Task 1: Drop canvas_positions and remove drag/reset code

**Files:**
- Create: `supabase/migrations/<server-assigned-version>_drop_canvas_positions.sql`
- Modify: `lib/family-tree/data.ts`
- Modify: `app/tre-slekt/page.tsx`
- Modify: `app/tre-slekt/view-wrapper.tsx`
- Modify: `app/tre-slekt/canvas.tsx`
- Delete: `app/tre-slekt/actions.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `getFamilyTreeData()` returns `{ people, relationships }` (no `positions` field). `FamilyTreeCanvas`, `ViewWrapper` no longer accept a `positions` prop.

- [ ] **Step 1: Apply the migration**

Use `mcp__supabase__apply_migration` with this SQL, then `mcp__supabase__list_migrations` to get the real assigned version, then write the local file at `supabase/migrations/<that-version>_drop_canvas_positions.sql`:

```sql
-- canvas_positions only ever existed to support drag-to-reposition, which
-- no longer exists (the tree canvas is now always auto-laid-out). Dropping
-- the table cascades its RLS policies and grants automatically.
drop table if exists canvas_positions;
```

- [ ] **Step 2: Update the data loader**

Replace `lib/family-tree/data.ts` in full:

```ts
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

export async function getFamilyTreeData() {
  const supabase = await createClient();

  const [peopleResult, relationshipsResult] = await Promise.all([
    supabase
      .from("people")
      .select("id, given_name, family_name, gender, is_living, birth_date_display, death_date_display, biography, birth_place, death_place")
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

(`CanvasPositionRow` is deleted along with the query — nothing else in the codebase should reference it after this task.)

- [ ] **Step 3: Update the page to stop threading `positions`**

In `app/tre-slekt/page.tsx`, change:

```ts
  const { people, relationships, positions } = await getFamilyTreeData();

  return (
    <main className="flex h-screen w-full flex-col">
      <ViewWrapper
        people={people}
        relationships={relationships}
        positions={positions}
        canEdit={canEdit}
        isAdmin={isAdmin}
      />
    </main>
  );
```

to:

```ts
  const { people, relationships } = await getFamilyTreeData();

  return (
    <main className="flex h-screen w-full flex-col">
      <ViewWrapper
        people={people}
        relationships={relationships}
        canEdit={canEdit}
        isAdmin={isAdmin}
      />
    </main>
  );
```

- [ ] **Step 4: Update `ViewWrapper`**

In `app/tre-slekt/view-wrapper.tsx`:
- Change the import: `import type { Person, Relationship } from "@/lib/family-tree/data";` (drop `CanvasPositionRow`).
- Remove `positions` from the props type and the destructured parameters.
- Remove `positions={positions}` from the `<FamilyTreeCanvas>` call.

- [ ] **Step 5: Strip drag/reset from `FamilyTreeCanvas`**

In `app/tre-slekt/canvas.tsx`:
- Remove `import { savePersonPosition, resetLayout } from "./actions";`.
- Change the type import to `import type { Person, Relationship } from "@/lib/family-tree/data";` (drop `CanvasPositionRow`).
- Remove `positions` from the props type and destructured parameters.
- Remove the `positionByPersonId` line and the saved-position branch in `initialNodes` — it becomes:

```ts
  const peopleById = new Map(people.map((p) => [p.id, p]));
  const dagreLayout = computeDagreLayout(people, relationships);

  const initialNodes = people.map((person) => ({
    id: person.id,
    type: "person",
    position: dagreLayout.get(person.id) ?? { x: 0, y: 0 },
    data: { person },
  }));
```

- Remove `handleNodeDragStop` and `handleResetLayout` entirely.
- Remove the `{isAdmin && (...)}` "Tilbakestill oppsett" button block entirely.
- On `<ReactFlow>`: remove `onNodeDragStop={handleNodeDragStop}` and change `nodesDraggable={canEdit}` to `nodesDraggable={false}`.
- `isAdmin` becomes an unused prop for now (still accepted, since sub-project B needs it immediately after this plan) — keep it in the destructured props and type so the call site in `ViewWrapper` doesn't need to change again next task, but it's fine if `bun run lint` doesn't flag unused destructured props (it won't — only unused local variables from `useState`/`const` trigger that rule, not props that are merely unread in this pass).

- [ ] **Step 6: Delete the actions file**

```bash
rm app/tre-slekt/actions.ts
```

- [ ] **Step 7: Verify**

```bash
bunx tsc --noEmit
bun test
bun run lint
```

Manually verify in the browser: the canvas renders with all people positioned automatically; no "Tilbakestill oppsett" button appears for admin; attempting to drag a node (as admin) does nothing.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations lib/family-tree/data.ts app/tre-slekt
git commit -m "Drop canvas_positions and remove drag-to-reposition"
```

---

### Task 2: Orientation toggle (top-to-bottom / left-to-right)

**Files:**
- Modify: `lib/family-tree/layout.ts`
- Modify: `app/tre-slekt/canvas.tsx`
- Modify: `app/tre-slekt/view-wrapper.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `computeDagreLayout(people, relationships, orientation)` where `orientation: "tb" | "lr"`.

- [ ] **Step 1: Add the orientation parameter to `computeDagreLayout`**

In `lib/family-tree/layout.ts`, change the function signature and the one line that sets `rankdir`:

```ts
export function computeDagreLayout(
  people: Person[],
  relationships: Relationship[],
  orientation: "tb" | "lr"
): Map<string, { x: number; y: number }> {
  const graph = new dagre.graphlib.Graph();
  graph.setGraph({ rankdir: orientation === "tb" ? "TB" : "LR", nodesep: 40, ranksep: 100 });
  graph.setDefaultEdgeLabel(() => ({}));

  // ...unchanged below (setNode/setEdge loop, dagre.layout(graph), result map)
}
```

Update the doc comment above the function to mention the orientation parameter (it currently says "Computes a top-down (parents above children) generational layout" — broaden it to cover both orientations).

- [ ] **Step 2: Accept `orientation` as a prop on `FamilyTreeCanvas` and re-layout when it changes**

`FamilyTreeCanvas` does not own the orientation state itself — `ViewWrapper` does (Step 3), since orientation is a layout-wide setting whose toggle control lives in `ViewWrapper`'s header row, not inside the canvas. `FamilyTreeCanvas` just receives it as a prop.

In `app/tre-slekt/canvas.tsx`:

1. Add `useEffect` to the React import: `import { useCallback, useEffect, useState } from "react";`.
2. Add `orientation` to the props type and destructured parameters:

```ts
export function FamilyTreeCanvas({
  people,
  relationships,
  canEdit,
  isAdmin,
  orientation,
}: {
  people: Person[];
  relationships: Relationship[];
  canEdit: boolean;
  isAdmin: boolean;
  orientation: "tb" | "lr";
}) {
```

3. Pass `orientation` into `computeDagreLayout`:

```ts
  const dagreLayout = computeDagreLayout(people, relationships, orientation);
```

4. Capture `setNodes` from `useNodesState` (currently discarded with `,`) and add an effect that re-applies fresh Dagre positions whenever `orientation` changes — `initialNodes` only seeds react-flow's node state on first mount, so a later orientation change needs to push new positions explicitly:

```ts
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, , onEdgesChange] = useEdgesState(initialEdges);

  useEffect(() => {
    setNodes(
      people.map((person) => ({
        id: person.id,
        type: "person",
        position: dagreLayout.get(person.id) ?? { x: 0, y: 0 },
        data: { person },
      }))
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orientation]);
```

The effect intentionally only re-runs on `orientation` change, not on every `people`/`relationships` change — `initialNodes` already handles the first render correctly via `useNodesState`'s initializer, so this effect exists solely to handle re-layout when the user toggles orientation after the initial mount.

- [ ] **Step 3: Own orientation state in `ViewWrapper` and add the toggle UI**

In `app/tre-slekt/view-wrapper.tsx`, add the orientation state (with localStorage init/persistence) and a segmented toggle control next to the existing Tre/Liste toggle:

```tsx
"use client";

import { useEffect, useState } from "react";
import type { Person, Relationship } from "@/lib/family-tree/data";
import { FamilyTreeCanvas } from "./canvas";
import { ListView } from "./list-view";

export function ViewWrapper({
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
  const [viewMode, setViewMode] = useState<"tre" | "liste">("tre");
  const [orientation, setOrientation] = useState<"tb" | "lr">("tb");

  useEffect(() => {
    const saved = localStorage.getItem("familietre-orientasjon");
    if (saved === "tb" || saved === "lr") setOrientation(saved);
  }, []);

  const handleSetOrientation = (next: "tb" | "lr") => {
    setOrientation(next);
    localStorage.setItem("familietre-orientasjon", next);
  };

  return (
    <div className="flex h-screen w-full flex-col">
      <div className="flex items-center gap-3 border-b border-line bg-surface px-4 py-3">
        <div
          role="group"
          aria-label="Visningsmodus"
          className="inline-flex gap-1 rounded-full border border-line bg-background p-1"
        >
          <button
            onClick={() => setViewMode("tre")}
            aria-pressed={viewMode === "tre"}
            className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
              viewMode === "tre" ? "bg-accent text-white shadow-sm" : "text-muted hover:text-foreground"
            }`}
          >
            <svg width="13" height="13" viewBox="0 0 20 20" fill="none" aria-hidden="true" className="shrink-0">
              <path
                d="M10 17V9M10 9C10 9 10 2.5 4.5 2.5M10 9C10 9 10 2.5 15.5 2.5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
            Tre
          </button>
          <button
            onClick={() => setViewMode("liste")}
            aria-pressed={viewMode === "liste"}
            className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
              viewMode === "liste" ? "bg-accent text-white shadow-sm" : "text-muted hover:text-foreground"
            }`}
          >
            <svg width="13" height="13" viewBox="0 0 20 20" fill="none" aria-hidden="true" className="shrink-0">
              <path d="M4 5.5H16M4 10H16M4 14.5H16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            Liste
          </button>
        </div>

        {viewMode === "tre" && (
          <div
            role="group"
            aria-label="Retning på treet"
            className="inline-flex gap-1 rounded-full border border-line bg-background p-1"
          >
            <button
              onClick={() => handleSetOrientation("tb")}
              aria-pressed={orientation === "tb"}
              title="Topp til bunn"
              className={`flex items-center justify-center rounded-full p-2 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                orientation === "tb" ? "bg-accent text-white shadow-sm" : "text-muted hover:text-foreground"
              }`}
            >
              <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M10 3V17M10 17L6 13M10 17L14 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="sr-only">Topp til bunn</span>
            </button>
            <button
              onClick={() => handleSetOrientation("lr")}
              aria-pressed={orientation === "lr"}
              title="Venstre til høyre"
              className={`flex items-center justify-center rounded-full p-2 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                orientation === "lr" ? "bg-accent text-white shadow-sm" : "text-muted hover:text-foreground"
              }`}
            >
              <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M3 10H17M17 10L13 6M17 10L13 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="sr-only">Venstre til høyre</span>
            </button>
          </div>
        )}
      </div>
      <div className="relative flex-1">
        <div className={`absolute inset-0 ${viewMode === "tre" ? "" : "hidden"}`}>
          <FamilyTreeCanvas
            people={people}
            relationships={relationships}
            canEdit={canEdit}
            isAdmin={isAdmin}
            orientation={orientation}
          />
        </div>
        <div className={`absolute inset-0 ${viewMode === "liste" ? "" : "hidden"}`}>
          <ListView people={people} relationships={relationships} />
        </div>
      </div>
    </div>
  );
}
```

The orientation toggle only shows in Tre view (it's meaningless in List view), matching the `{viewMode === "tre" && (...)}` guard above.

- [ ] **Step 4: Verify**

```bash
bunx tsc --noEmit
bun test
bun run lint
```

Manually verify in the browser: toggling between the two orientation buttons re-lays-out the tree top-to-bottom vs. left-to-right; reloading the page after choosing left-to-right keeps that choice; the toggle only appears in Tre view, not List view.

- [ ] **Step 5: Commit**

```bash
git add lib/family-tree/layout.ts app/tre-slekt/canvas.tsx app/tre-slekt/view-wrapper.tsx
git commit -m "Add top-to-bottom/left-to-right orientation toggle"
```

---

### Task 3: Remove dark mode

**Files:**
- Modify: `app/globals.css`

**Interfaces:** none — pure CSS change.

- [ ] **Step 1: Delete the dark-mode media query block**

In `app/globals.css`, delete this entire block:

```css
@media (prefers-color-scheme: dark) {
  :root {
    --background: #191510;
    --surface: #221d16;
    --foreground: #ede6d8;
    --muted: #a79c89;
    --line: #3a3226;
    --accent: #7fa98c;
    --accent-hover: #99bfa5;
    --accent-soft: #26332b;
    --gold: #c9a857;
    --error: #d08a73;
  }
}
```

The `:root` block above it (light tokens) is untouched and becomes the only theme. Also delete the `/* Warm family-archive palette... */` comment's implication of two themes if it references dark mode — check the comment text and adjust only if it explicitly mentions a dark variant (it currently just describes the palette by name, not by light/dark, so it likely needs no wording change; read the file first and only edit if needed).

- [ ] **Step 2: Verify**

```bash
bunx tsc --noEmit
bun test
bun run lint
```

Manually verify in the browser with the OS/browser set to dark mode (or via DevTools' rendering emulation) that the app still renders in the light palette.

- [ ] **Step 3: Commit**

```bash
git add app/globals.css
git commit -m "Remove dark mode, light theme only"
```

---

### Task 4: End-to-end manual verification

**Files:** none.

- [ ] **Step 1: Verify as guest, member, and admin**

Confirm for all three roles: no node can be dragged; pan/zoom still works; the orientation toggle works and persists across reload; search, detail panels, and the list view are all unaffected; light mode renders correctly regardless of OS dark-mode setting.

- [ ] **Step 2: Confirm the schema change**

Query `canvas_positions` (e.g. via `mcp__supabase__list_tables`) and confirm the table no longer exists.

- [ ] **Step 3: Report results**, including what was tested and any concerns.

---

## Self-Review Notes

- **Spec coverage:** every requirement from the design doc maps to a task — schema/drag removal (Task 1), orientation toggle (Task 2), dark-mode removal (Task 3), verification (Task 4).
- **Placeholder scan:** no TBD/TODO; the only deferred literal value is the migration's server-assigned version number, which is a documented, standing convention in this project (call `list_migrations` after applying), not a vague requirement.
- **Type consistency:** `computeDagreLayout`'s new `orientation` parameter is threaded consistently — `ViewWrapper` owns the state, passes it down to `FamilyTreeCanvas` as a prop, which passes it into `computeDagreLayout`. `Person`/`Relationship` types are unchanged; `CanvasPositionRow` is removed everywhere in the same task it's introduced-as-removed (Task 1), so no task after it can accidentally reference a stale type.
