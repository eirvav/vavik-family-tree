# Tree Editing Polish: Siblings, Partners, Layout, Action Bar — Design

## Purpose

Phase 4b (editing via floating action bar) shipped and was merged. Using it surfaced six real problems, all reported after live use:

1. Adding a child only lets you link one parent, even when the other parent is already in the tree.
2. Every partner-type relationship renders dashed (not just former ones), and a former partner's node lands wherever their own separate lineage happens to place it — nowhere near the person they were paired with.
3. Current partners who share children have no reliably-adjacent layout — today's apparent adjacency is incidental (it only happens when Dagre's parent-child ranking coincidentally lines them up).
4. There's no visual indication on the canvas of which person is currently selected.
5. "Legg til søsken" is disabled whenever the selected person has no parent on file — which includes every root ancestor in the tree, exactly the people most likely to need a sibling added.
6. The floating action bar isn't actually responsive: it and the sidebar are both fixed-size, independently-positioned overlays, so resizing the window causes them to collide.

Additionally, the top-to-bottom/left-to-right orientation toggle (Phase 4a) is being removed — the tree is vertical-only from here on.

## 1. Sibling as a real relationship type

Add `sibling` to the `relationship_type` enum (alongside the existing 8 values). "Legg til søsken" on the action bar is **never disabled** — it always creates the new person and links them to the selected person with one direct `sibling`-type relationship. If the selected person has active parent relationship(s) on file, the new sibling is *additionally* linked to those same parent(s), mirroring the relationship type of each (this part is best-effort extra detail, not a precondition — when there's nothing to mirror, the direct sibling edge alone is sufficient and the feature still works).

This relationship type is symmetric, like the partner types — no asParent/asChild distinction needed in the sidebar's "Familie" list (labeled simply "søsken" for both people in the pair). The delete-connectivity check needs no code changes: it already treats every relationship type as a generic, undirected graph edge.

Mechanically this reuses the same atomic "one RPC call, N edges" mechanism `createRelatedPerson`/`create_related_person` already use for every other relationship kind: the sibling action always includes exactly one `sibling`-type edge in the array, plus zero or more mirrored parent-type edges when the selected person has parents on file — all inserted in the same transaction as before, so there's no partial-success state to handle.

## 2. Layout adjacency and edge styling

**Layout (`computeDagreLayout`):** partner-type edges (spouse, partner, former_spouse, former_partner) and the new sibling-type edges become inputs to the Dagre graph in addition to the existing parent-child edges, added with `minlen: 0`. Parent-child edges still drive the generational ranking (who's above whom); the new edges only pull their two endpoints toward the same rank and adjacent positions, without asserting a hierarchy between them. This directly fixes case 2 and 3 above: any two people linked by a partner or sibling edge get pulled next to each other, regardless of what else is going on in either person's individual lineage.

**Edge rendering (`buildEdges` in `canvas.tsx`):**
- Parent-child: unchanged — solid, arrow-marked.
- Current spouse/partner: solid, no label.
- Former spouse/former partner: dashed, no label (the dash alone signals "this ended" — the previous text labels, "tidligere ektefelle"/"tidligere partner", are removed).
- Sibling (new): solid, no arrow marker, labeled "søsken" (so a sibling line is visually distinguishable from a current-partner line — both solid, otherwise identical).

## 3. Second parent on child creation

The "Legg til barn" dialog gains a "Partner"/co-parent field: when the selected person has one or more active partner-type relationships on file, a single-select dropdown lists those partners (empty/no selection by default). If the admin picks one, `createRelatedPerson` creates the new child plus **two** parent edges — one to the selected person, one to the chosen partner — both using the relationship-type value already chosen in the dialog's existing type selector. If the selected person has no partners on file, the dropdown doesn't appear and behavior is unchanged from today (a single parent edge).

## 4. Selected-person canvas highlight

`PersonNode` renders a visibly different style — an accent-colored ring/border plus a subtle shadow lift — when it is the currently-selected person. `FamilyTreeCanvas` computes this by comparing each node's id to `selectedPersonId` and passing a `selected` boolean through the node's `data`, rather than using React Flow's built-in `node.selected` field (which this app doesn't otherwise use and which carries React Flow's own multi-select/marquee semantics).

## 5. Responsive layout (canvas, sidebar, action bar)

Today the sidebar (`DetailPanel`) and the action bar are both `position: absolute` overlays on top of a full-width canvas, positioned independently — any fix to their relative spacing is fragile pixel math that breaks at some other window width. This is restructured properly:

- **Tablet width and up:** `FamilyTreeCanvas`'s outer container becomes a flex row. The canvas area and the sidebar are flex siblings — the canvas actually shrinks to make room for the sidebar (React Flow reflows correctly when its container resizes), and the sidebar keeps its current `w-96`. The action bar is absolutely positioned *within the canvas area specifically* (not the full screen), so it centers correctly in whatever width the canvas actually has, at any window size — no hardcoded offset, no overlap, ever.
- **Phone width:** the sidebar becomes a full-screen overlay instead of a side-by-side flex sibling (there's no meaningful way to show both at once at that width). Since the canvas is fully hidden behind it in that mode, the action bar's buttons render pinned to the bottom of the sidebar overlay itself, rather than floating separately over a canvas the admin can't see.

The exact breakpoint is an implementation detail (Tailwind's `sm`, matching what's already used elsewhere in this codebase for responsive rules).

## 6. Action bar redesign

- Repeated "Legg til" prefixes are dropped from the button labels.
- "Legg til far"/"Legg til mor" become one combined button, **Forelder** (person-with-plus icon). Clicking it opens a small popover with two icon choices, Far and Mor; picking one closes the popover and opens the existing create-person dialog with that gender fixed, same as today.
- Remaining buttons: **Søsken**, **Partner**, **Barn** — each icon + label, in the app's existing hand-drawn inline-SVG line-icon style (matching the tree/list/orientation icons already in `view-wrapper.tsx` and the search icon in `canvas.tsx`). "Søsken" is never disabled (see Section 1).
- A divider, then **Slett** (shortened from "Slett person" now that the other labels are all single words too), trash icon, kept in the existing destructive red styling.
- Positioning: see Section 5 — no longer a fixed pixel offset.

## 7. Remove horizontal orientation — vertical-only

The top-to-bottom/left-to-right toggle from Phase 4a is removed entirely:
- `computeDagreLayout` drops its `orientation` parameter; `rankdir` is always `"TB"`.
- `view-wrapper.tsx` drops the `orientation` state, its `localStorage` persistence (`"familietre-orientasjon"`), and the toggle button UI (the up/down vs. left/right icon buttons).
- `canvas.tsx` drops the `orientation` prop on `FamilyTreeCanvas`, and the "track previous orientation, conditionally re-fit the camera" logic disappears along with it — since there's no orientation left to change, and ordinary data mutations should never reset the camera anyway (already established in the initial Phase 4b work), the node/edge re-sync effect becomes simpler: it just rebuilds nodes and edges whenever `people`/`relationships` change, with no `fitView` call at all after the initial mount (the existing `<ReactFlow fitView>` boolean prop already handles centering on first load).
- `CLAUDE.md` and `docs/ROADMAP.md`'s standing directive about the orientation toggle is updated to describe vertical-only automatic layout.

## Testing

- `lib/family-tree/layout.ts`: existing tests (if any) plus new coverage for the adjacency behavior — two people linked only by a partner or sibling edge (no shared parent) end up at the same rank.
- `lib/family-tree/connectivity.ts`: no changes needed, but worth a test confirming a sibling-only-linked pair still counts as connected (i.e., deleting one when the other has no other connections is correctly blocked/allowed per the existing rules).
- Manual verification: add a sibling to a person with no parent on file (previously impossible); add a child with two existing parents selected; resize the browser window through the responsive breakpoint and confirm no overlap at any width, including phone width; confirm the orientation toggle UI is gone and the tree only ever renders top-to-bottom.
