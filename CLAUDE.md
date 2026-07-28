@AGENTS.md

# Package manager

This project uses **Bun**, not npm/yarn/pnpm. Use `bun install`, `bun add`, `bun run <script>`, `bunx <pkg>`, etc. The lockfile is `bun.lock`.

# Git commits

Never add a `Co-Authored-By: Claude` (or similar) trailer to commit messages in this repo. eirvav is the sole contributor.

# Git & GitHub operations

Manage pushing, creating PRs, and merging autonomously in this repo — proceed without asking for confirmation on these specific actions. This does not relax the usual care around destructive operations (force-push, `--no-verify`, discarding uncommitted work): investigate and report those rather than acting unilaterally.

# Keep this file (and AGENTS.md, ROADMAP.md) current

Self-update these files without being asked whenever something durable changes: a new standing preference or correction the user gives, an architectural decision, a stack change, or a phase shipping. Don't wait for an explicit "update the docs" request — treat it as part of finishing the work. Fix stale info the moment you notice it (e.g. a removed feature still described as present) rather than leaving it for later. Keep additions short and factual; this file is instructions, not a changelog — narrative history belongs in commit messages and `docs/ROADMAP.md`'s phase links, not here.

# UI/UX standing directives

- Prioritize UX and visual polish over speed of delivery — the app should feel easy and pleasant to use, not merely functional.
- Light mode only. No dark mode, no `prefers-color-scheme` dark variant — light is the only theme.
- The tree canvas's nodes must NOT be draggable/repositionable by the user. Layout is always computed automatically (Dagre), with a user-facing toggle between a top-to-bottom and a left-to-right orientation.
- A floating, rounded, canvas-position-independent action bar pinned to the bottom of the screen (Figma/tldraw style) is the primary way to add/delete people and relationships. It's admin-only and only appears with a person selected (add father/mother/sibling/partner/child, delete person); editing an existing person's fields happens inline in the sidebar instead, not via the action bar.
- Editing permissions: admins can add/delete people and relationships and edit personal info; members can only edit a person's biography text; guests are read-only. Enforced at the RLS layer, not just the UI.
- The tree only ever grows from an existing person — there is no way to create a stand-alone/unconnected person. Deleting a person is refused (not cascaded) if it would disconnect anyone else from the rest of the tree; the admin must delete outward-in instead.
