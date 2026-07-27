# Tree canvas (React Flow) — design

Status: approved
Source: `docs/family_tree_organiser_design_specification.pdf`, Phase 3 of its delivery roadmap (§19): "React Flow canvas, custom nodes, details panel, shared positions and automatic layout."

## 1. Scope

**In scope**
- `people.gender` column addition (enum: `male`, `female`, `unknown`) — needed for the placeholder avatar, absent from Phase 2 since avatars were out of scope then
- `canvas_positions` table (person_id, x, y, updated_at, updated_by) — presentation state, kept separate from canonical family data per spec §6.1
- React Flow canvas (`@xyflow/react`) rendering all people/relationships as nodes/edges
- Custom person node: placeholder avatar (male/female/unknown silhouette), name, birth–death years, living/deceased indicator
- Compact detail panel (single click) and full detail view (double click / explicit action)
- Automatic layout via Dagre on first load; manual drag persists to `canvas_positions` for members/admins; guests can pan/zoom/select but not drag
- Search bar (name/alternate name/place, using Phase 2's trigram indexes) that pans/zooms to a selected result
- Accessibility fallback: a flat, keyboard-navigable, searchable list view as an alternative to the canvas
- Synthetic seed data (fake test people/relationships) for verification — never mixed with real production data

**Explicitly out of scope for this slice** (later phases per the roadmap)
- Any create/edit forms for people or relationships — Phase 4
- Creating a relationship by drawing an edge — Phase 4 (the spec's §7.2 "creating an edge launches a relationship form" is part of Phase 4's editing work)
- Audit trail, undo/restore — Phase 4
- The real generated avatar system — Phase 5. This phase's avatar is a simple placeholder silhouette only, explicitly temporary.
- Stories, biography display beyond the `biography` text field already in `people` — Phase 5
- Recovery/soft-delete UI — Phase 4/6

## 2. Decisions resolved during brainstorming

| Decision | Resolution |
|---|---|
| Seed data for testing | Synthetic test data only; real ~250-person family data waits for Phase 4's actual forms |
| Node avatar | Simple gender-based placeholder silhouette now, not the real generated avatar system (Phase 5) |
| Automatic layout | Dagre (`@dagrejs/dagre`), a standard React Flow pairing for hierarchical layouts |

## 3. Database changes

```sql
create type gender as enum ('male', 'female', 'unknown');
alter table people add column gender gender not null default 'unknown';

create table canvas_positions (
  person_id uuid primary key references people(id) on delete cascade,
  x double precision not null,
  y double precision not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(user_id)
);
```

RLS on `canvas_positions` follows the same pattern as `people`/`relationships`: `app_is_authorized()`-style read (guests can see the shared layout too, since it's just presentation, not sensitive), `app_is_member_or_admin()` for insert/update, no delete policy. Base-table grants to `authenticated` accompany the policies, per this project's established (twice-learned) pattern.

## 4. Application structure

- `app/tre-canvas/page.tsx` (or similar route — exact naming decided at plan time) — Server Component that loads all people/relationships/canvas_positions server-side and passes them to a Client Component canvas.
- A Client Component wrapping `@xyflow/react`'s `<ReactFlow>`, with a custom node type rendering the placeholder avatar + name + dates + status dot.
- Edge rendering: solid + arrowhead for parent-child, dashed + no arrowhead for partner-type, with a text label for the non-default relationship types (`former_spouse`, `former_partner`, `adoptive_parent`, `foster_parent`, `guardian_parent`) — color is never the sole differentiator.
- Compact detail panel: a slide-in side panel on single-click selection, showing name, dates, places, and immediate family as clickable links that re-focus the canvas on that person.
- Full detail view: opened from the compact panel, showing everything the compact panel does plus biography text and the complete relationship list.
- Layout: Dagre computes initial positions from the relationship graph (parents above children, partners side by side) when no saved `canvas_positions` exist for a person; a saved position always wins over the computed one. Dragging a node (members/admins only) writes its new position to `canvas_positions`. A "Tilbakestill oppsett" control re-runs Dagre for everyone and clears saved positions (admin-only, since it affects the shared layout for the whole family).
- Search: a persistent bar above the canvas, client-side filtering against the server-loaded person list by name/alternate-name/place substrings (trigram indexes are a Phase 2 database-level asset; this phase's search UI can start with simple substring filtering over the already-loaded ~250 people client-side, which is trivially fast at this scale — no need to round-trip to Postgres per keystroke). Selecting a result pans/zooms the canvas to that node and opens its compact panel.
- Accessibility fallback: a view toggle switches the same loaded data into a flat, sortable, keyboard-navigable table/list — no canvas, no drag, full parity for anyone who can't use an infinite canvas well.

## 5. Testing

- Given this phase introduces real UI for the first time since the auth pages, verification is a mix of: SQL-level tests for the two new schema pieces (matching the established pattern), and manual browser verification of canvas rendering, search, layout persistence, and the accessibility list view — following the same Browser-tool verification approach used for Phase 0/1's auth flows.
- Synthetic seed data (a small multi-generation test family) is inserted for this manual verification and left in place only as long as needed to develop against — cleaned up or clearly marked before Phase 4 begins real data entry.

## 6. Acceptance criteria

- All people/relationships from the database render as nodes/edges on the canvas without manual layout.
- A guest can pan, zoom, select nodes, and search, but cannot drag a node to change its position.
- A member/admin can drag a node; the new position persists and is visible to other users on reload.
- Selecting a node opens the compact panel; escalating to the full view shows the biography and complete relationship list.
- The accessibility list view shows the same people, fully keyboard-navigable, with no drag interaction required.
- Parent-child and partner relationships are visually distinguishable by line style (not color alone).
