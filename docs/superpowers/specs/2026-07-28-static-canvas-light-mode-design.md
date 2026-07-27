# Static Canvas, Orientation Toggle, and Light-Mode-Only Design

## Goal

Replace the tree canvas's manual drag-to-reposition feature with a fully automatic, static layout that the user can orient top-to-bottom or left-to-right, and drop dark mode so the app is light-only. This clears the way for the next phase (a floating action bar driving all person/relationship editing), which needs a canvas that isn't also a free-form drag surface.

## Architecture

The canvas keeps its current rendering stack (React Flow + Dagre) and pan/zoom behavior. What changes is where node positions come from and how many themes exist.

**Before:** node position = saved `canvas_positions` row if one exists, else the Dagre-computed position; a drag persisted a new saved position; an admin-only "reset" cleared saved positions back to Dagre.

**After:** node position is *always* the Dagre-computed position for the current orientation. There is no saved-position concept at all.

### Schema

`canvas_positions` is dropped. It only ever existed to support drag persistence, which no longer exists. Its RLS policies and grants are attached to the table and are dropped automatically with it.

```sql
-- supabase/migrations/<timestamp>_drop_canvas_positions.sql
drop table if exists canvas_positions;
```

### Layout orientation

`computeDagreLayout` (`lib/family-tree/layout.ts`) gains an `orientation` parameter:

```ts
export function computeDagreLayout(
  people: Person[],
  relationships: Relationship[],
  orientation: "tb" | "lr"
): Map<string, { x: number; y: number }> {
  const graph = new dagre.graphlib.Graph();
  graph.setGraph({
    rankdir: orientation === "tb" ? "TB" : "LR",
    nodesep: 40,
    ranksep: 100,
  });
  // ...unchanged below this line
}
```

Everything else about the function (which relationship types drive edges, how nodes/edges are registered) is unchanged.

### Component changes

- **`app/tre-slekt/canvas.tsx`**: remove `positions` prop, `positionByPersonId`, the saved-position branch in `initialNodes`, `onNodeDragStop`/`handleNodeDragStop`, the "Tilbakestill oppsett" button, and the `savePersonPosition`/`resetLayout` imports. Set `nodesDraggable={false}` unconditionally (nodes are never draggable, for guest or admin alike). Add local state for `orientation: "tb" | "lr"`, initialized from `localStorage.getItem("familietre-orientasjon")` (falling back to `"tb"`), written back on change. Pass `orientation` into `computeDagreLayout`.
- **`app/tre-slekt/actions.ts`**: deleted. It contained only `savePersonPosition` and `resetLayout`.
- **`lib/family-tree/data.ts`**: remove the `CanvasPositionRow` type and the `canvas_positions` query in `getFamilyTreeData()`. `FamilyTreeCanvas`'s `positions` prop is removed from every caller.
- **`app/tre-slekt/page.tsx`** / **`view-wrapper.tsx`**: stop passing `positions`. `canEdit`/`isAdmin` continue to be computed and threaded through unchanged — sub-project B (the floating action bar) needs them right away, so they aren't removed just to be re-added.
- **`app/globals.css`**: delete the entire `@media (prefers-color-scheme: dark)` block. The existing `:root` light tokens (parchment background, spruce-green accent, antique-gold, etc.) become the only theme; no new palette work in this pass.

### Orientation toggle UI

A small two-option control in the same header row as the existing Tre/Liste toggle — two icon buttons (a "top-to-bottom" glyph and a "left-to-right" glyph, in the same thin-stroke icon style already used elsewhere), styled as a matching segmented control. Clicking an option updates the orientation state, re-runs `computeDagreLayout`, and writes the choice to `localStorage`. Purely client-side: no server action, no schema.

### What's unchanged

- Pan and zoom (scroll-to-zoom, drag-empty-space-to-pan, the `+`/`-`/fit-view controls) — only *node* dragging is removed, not canvas navigation.
- Search, detail panels (compact/full), the accessibility list view, and the family-name index grouping.
- `Person`/`Relationship` types, RLS on `people`/`relationships`, the soft-deletion model.

## Testing

- `bunx tsc --noEmit`, `bun test`, `bun run lint`.
- Manual: verify the tree renders with automatic layout in both orientations; verify no node can be dragged (as guest, member, or admin); verify the orientation choice survives a page reload (localStorage); verify light mode renders correctly regardless of OS/browser dark-mode setting.

## Out of scope

Everything about *adding, editing, or deleting* people and relationships — that's sub-project B (the floating action bar), designed separately.
