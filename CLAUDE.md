@AGENTS.md

# Package manager

This project uses **Bun**, not npm/yarn/pnpm. Use `bun install`, `bun add`, `bun run <script>`, `bunx <pkg>`, etc. The lockfile is `bun.lock`.

# Git commits

Never add a `Co-Authored-By: Claude` (or similar) trailer to commit messages in this repo. eirvav is the sole contributor.

# Git & GitHub operations

Manage pushing, creating PRs, and merging autonomously in this repo — proceed without asking for confirmation on these specific actions. This does not relax the usual care around destructive operations (force-push, `--no-verify`, discarding uncommitted work): investigate and report those rather than acting unilaterally.

# No subagents

Do not use subagents (the Agent tool / superpowers:subagent-driven-development) in this repo. Implement and review code directly, inline, in the main session.

# UI/UX standing directives

- Prioritize UX and visual polish over speed of delivery — the app should feel easy and pleasant to use, not merely functional.
- Light mode only. No dark mode, no `prefers-color-scheme` dark variant — light is the only theme.
- The tree canvas's nodes must NOT be draggable/repositionable by the user. Layout is always computed automatically (Dagre), with a user-facing toggle between a top-to-bottom and a left-to-right orientation.
- A floating, rounded, canvas-position-independent action bar pinned to the bottom of the screen (Figma/tldraw style) is the primary way to add/edit/delete people and relationships. Selecting a person surfaces contextual actions (edit person, add father/mother/sibling/partner/child, delete person); with nothing selected, only "add person" is available and the rest are disabled.
