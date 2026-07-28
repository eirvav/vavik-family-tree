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
| 4b. Editing (floating action bar) | ⬜ Not started | Add/edit/delete person; add father/mother/sibling/partner/child, via a Figma/tldraw-style floating bottom action bar. Next up. |
| 5. Stories & avatars | ⬜ Not started | Stories/notes table for people; generated avatar system (not uploads, per spec). |
| 6. Administration | ⬜ Not started | Invitations, guest-code rotation UI, richer member management (currently create+list only). |
| 7. Hardening | ⬜ Not started | Accessibility polish, performance, backups, monitoring. |

## Standing directives (see also `CLAUDE.md`)

- Light mode only, no dark mode.
- Tree canvas nodes are never draggable — layout is always automatic, with the orientation toggle as the only user control over shape.
- Editing (Phase 4b onward) happens through the floating bottom action bar, not traditional forms-on-a-page.
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
| 4b | _not yet written_ | _not yet written_ |
