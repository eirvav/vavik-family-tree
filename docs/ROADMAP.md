# Vavik Familietre — Roadmap

Single source of truth for what phase this project is in. Read this first in a fresh session before doing anything else. Update the status line and add a new entry whenever a phase or sub-project ships (merges to `main`).

Each entry links to its design spec and implementation plan under `docs/superpowers/specs/` and `docs/superpowers/plans/`, where the full detail lives — this file only tracks status and a one-line summary.

## Status

| Phase | Status | Summary |
|---|---|---|
| 1. Secure access | ✅ Done | Guest (family-code), member, admin auth; password login; RLS-backed roles. |
| 2. Core data model | ✅ Done | `people`, `relationships`, `person_names`; ancestry-cycle protection; trigram search. |
| 3. Tree experience | ✅ Done | React Flow + Dagre canvas; search; detail panels; accessibility list view. |
| 4a. Static layout rework | ✅ Done | Removed drag-to-reposition; orientation toggle (top-to-bottom / left-to-right); dark mode dropped. |
| 4b. Editing (floating action bar) | ✅ Done | Admin-only floating action bar to add parents/sibling/partner/child (a single "Legg til foreldre" action creates both parents at once); two-tab (Personinfo/Biografi) sidebar with inline editing; member biography-only editing; delete with a tree-connectivity check. |
| 4b-polish. Tree editing polish | ✅ Done | Direct `sibling` relationship type (always-available, no parent required); partner/sibling layout adjacency; correct current/former partner edge styling; selected-person canvas highlight; genuinely responsive canvas/sidebar layout; redesigned action bar with icons; removed the horizontal orientation toggle (vertical-only). |
| 4b-polish-2. Layout overlap fix + straight edges + combined parents | ✅ Done | Recursive subtree-width Dagre layout (fixes a confirmed node-overlap bug, with a cycle guard for group-level cycles from collapsed siblings/partners); straight partner/sibling edges with shared-parent sibling-line suppression; combined "Legg til foreldre" action (single `create_parent_pair` RPC replacing separate add-father/add-mother). |
| 5. Stories & avatars | ⬜ Not started | Stories/notes table for people; generated avatar system (not uploads, per spec). Next up. |
| 6. Administration | ⬜ Not started | Invitations, guest-code rotation UI, richer member management (currently create+list only). |
| 7. Hardening | ⬜ Not started | Accessibility polish, performance, backups, monitoring. |

## Standing directives (see also `CLAUDE.md`)

- Light mode only, no dark mode.
- Tree canvas nodes are never draggable — layout is always automatic, vertical (top-to-bottom) only, no orientation toggle.
- Editing (Phase 4b onward) happens through the floating bottom action bar, not traditional forms-on-a-page.
- The canvas/sidebar layout must stay genuinely responsive at any window width, including phone widths.
- Prioritize UX/visual polish over speed of delivery.
- Manage git push/PR/merge autonomously in this repo (no need to ask each time).

## Known outstanding items

- The family code is currently set to the test value `testverifisering2026` from verification testing during Phase 3/4a — the user should set a real one via "Sett familiekode" on `/tre` whenever convenient. This is not something Claude should do unprompted (it's a real credential shared with real family members).

## Detail index

| Phase | Spec | Plan |
|---|---|---|
| 1 | [foundation-secure-access-design.md](superpowers/specs/2026-07-27-foundation-secure-access-design.md) | [foundation-secure-access.md](superpowers/plans/2026-07-27-foundation-secure-access.md) |
| 1 (password-auth pivot) | [password-auth-admin-dashboard-design.md](superpowers/specs/2026-07-27-password-auth-admin-dashboard-design.md) | [password-auth-admin-dashboard.md](superpowers/plans/2026-07-27-password-auth-admin-dashboard.md) |
| 2 | [core-data-model-design.md](superpowers/specs/2026-07-27-core-data-model-design.md) | [core-data-model.md](superpowers/plans/2026-07-27-core-data-model.md) |
| 3 | [tree-canvas-design.md](superpowers/specs/2026-07-27-tree-canvas-design.md) | [tree-canvas.md](superpowers/plans/2026-07-27-tree-canvas.md) |
| 4a | [static-canvas-light-mode-design.md](superpowers/specs/2026-07-28-static-canvas-light-mode-design.md) | [static-canvas-light-mode.md](superpowers/plans/2026-07-28-static-canvas-light-mode.md) |
| 4b | [editing-floating-action-bar-design.md](superpowers/specs/2026-07-28-editing-floating-action-bar-design.md) | [editing-floating-action-bar.md](superpowers/plans/2026-07-28-editing-floating-action-bar.md) |
| 4b-polish | [tree-editing-polish-design.md](superpowers/specs/2026-07-28-tree-editing-polish-design.md) | [tree-editing-polish.md](superpowers/plans/2026-07-28-tree-editing-polish.md) |
| 4b-polish-2 | [tree-layout-and-parents-design.md](superpowers/specs/2026-07-28-tree-layout-and-parents-design.md) | [tree-layout-and-parents.md](superpowers/plans/2026-07-28-tree-layout-and-parents.md) |
