<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Vavik Familietre

A private, invite-only family tree web app for ~250 people (the Vavik family, Norwegian). All UI text is Norwegian; code and comments stay in English.

**Stack:** Next.js 16 canary (App Router) + Supabase (Postgres/Auth/RLS) + React Flow (tree canvas) + Dagre (automatic layout). Row Level Security is the real authorization boundary — UI-level checks are secondary and never trusted alone.

**Roles:** guest (family-code entry, read-only), member (password login, can edit), admin (password login, full control including member management and family-code rotation).

**Data rules:** soft-deletion only for family data (`people`, `relationships`) — no hard DELETE policies anywhere in the current schema.

**Start here:** read `docs/ROADMAP.md` first in any fresh session — it tracks which phase this project is in, links to the detailed spec/plan for each phase, and lists standing directives and known outstanding items. Keep it updated when a phase ships.
