# Tree Layout Fix, Straight Edges, Combined Parents — Design

## Purpose

Live use of the tree canvas (verified directly against the real family data, admin-authenticated) surfaced three problems:

1. **Nodes overlap.** Confirmed with exact pixel measurements and the underlying relationship data: a couple with three children together (Son #1 + Partner of Son #1, who have three kids) gets collapsed into one composite Dagre node for layout purposes, but that node's declared width only accounts for the couple themselves (2 people wide), not the wider subtree of children hanging beneath them. Dagre doesn't know to reserve extra room for that branch, so the neighboring branch's column encroaches on it. This isn't a one-off — it recurs any time a branch's descendants need more horizontal room than the branch's own composite width.
2. **Edge lines don't match the desired style.** Partner and sibling edges currently render as curved bezier lines (React Flow's default edge type, unset). The desired style — confirmed against a reference screenshot — uses straight lines and, for parent-child, the existing stem-into-bus routing.
3. **Adding a father and a mother separately never connects them as partners of each other.** There's no way today to link two independently-added parents to each other; the fix is a single action that creates both at once, already connected.

## 1. Fixing overlap: recursive subtree-width layout

`computeDagreLayout` gains a step between building composite groups (existing union-find logic, unchanged) and calling `dagre.layout()`: compute each group's **subtree width** recursively, bottom-up, over the group-level parent→children tree (the same redirected edges already used to build Dagre's graph).

```
subtreeWidth(group) =
  if group has no children: group's own width (member count × NODE_WIDTH + gaps)
  else: max(group's own width, sum of each child's subtreeWidth + (childCount - 1) × NODE_GAP)
```

This value — not the group's own width — is what gets passed to `graph.setNode(groupId, { width: subtreeWidth, height: NODE_HEIGHT })`. Dagre uses declared node width to compute minimum separation between same-rank neighbors, so an honest width means Dagre now actually reserves enough room for what's underneath each branch. Nothing else changes: Dagre still owns rank assignment and left-to-right ordering, and the *expansion* step (converting a composite group's assigned center-x back into each member's individual x) still uses the group's own width, not its subtree width — the extra reserved space protects against the neighboring branch, it doesn't spread the couple further apart.

Two implementation notes:
- The parent-child graph is guaranteed acyclic (the existing ancestry-cycle trigger enforces this at the database level), so the recursion terminates; each group's subtree width is memoized to avoid recomputing shared branches.
- A child with two parents who aren't themselves linked (e.g. separated parents with no recorded relationship to each other) can appear under two different composite groups. In that case both parent groups independently count that child's subtree width in their own reservation — a conservative, redundant over-reservation rather than a tight optimum. This trades a small amount of extra whitespace in rare blended-family cases for guaranteed correctness (over-reserving is safe; under-reserving is the bug being fixed).

## 2. Edge routing

- **Partners:** `type: "straight"` — a direct line between the two nodes. Since partner pairs are already same-rank and adjacent (existing layout adjacency work), this renders as a clean horizontal line.
- **Parent → children:** unchanged (`type: "smoothstep"`), which already produces the vertical-stem-into-horizontal-bus-into-individual-drops pattern.
- **Siblings who share an active recorded parent:** no edge is rendered at all — the shared parent's bus already shows the connection, and a separate sibling line would be redundant clutter, matching the reference image (which never draws a direct sibling line even where full siblings are present).
- **Siblings with no shared recorded parent** (the case the direct `sibling` relationship type exists to support): `type: "straight"`, same as a partner line — the only case where a sibling edge is drawn at all.

`buildEdges` determines "shares an active recorded parent" by checking, for each `sibling`-type relationship, whether the relationships list contains an active parent-type edge into both people from the same third person — computed at build time from the already-loaded relationships, not stored as a separate flag.

## 3. Combined "Legg til foreldre" action

The action bar's parent entry stops opening a Far/Mor popover. It becomes one button, "Legg til foreldre", opening a single dialog that creates both people at once:

- Far's given/family name, Mor's given/family name (gender still fixed male/female respectively, no selector — unchanged from today's per-parent dialog).
- One relationship-type selector (biologisk/adoptiv/foster/verge, default biologisk) applied to **both** parent-child links — parents are essentially always the same type.
- One relationship-type selector (ektefelle/tidligere ektefelle/partner/tidligere partner, default ektefelle) for the father–mother relationship to each other.

This is backed by a new atomic RPC, `create_parent_pair`, mirroring `create_related_person`'s transactional pattern (admin-gated via `app_is_admin()`, single transaction): creates both new people, the relationship between them, and both parent-child edges to the selected person in one call — a partial failure can't leave one parent created without the other or without their connection to each other.

The existing `"father"`/`"mother"` `RelationKind` values and their single-parent creation path (`createRelatedPerson`'s father/mother branch, and the action bar's Forelder popover) are removed entirely — there is no path to add just one parent from the action bar anymore, per the decision that a person always has exactly two parents in this data model.

## Testing

- `lib/family-tree/layout.ts`: new tests for the subtree-width calculation — a composite group with children needing more width than the group's own width doesn't overlap an adjacent branch; the existing 7 layout tests (rank ordering, same-rank adjacency, DFS member ordering) continue to pass unchanged since none of them involve a branch wider than its own composite width.
- Manual verification: the exact "Son #1 + Partner of Son #1 with three children, next to Son #2 + Partner of Son #2" scenario already confirmed live, re-checked after the fix to confirm no overlap; partner and no-shared-parent-sibling lines render straight; siblings-with-shared-parent show no separate line; "Legg til foreldre" creates both parents connected to each other and to the selected person in one action.
