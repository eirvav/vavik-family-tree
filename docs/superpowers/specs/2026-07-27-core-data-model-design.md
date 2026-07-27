# Core data model (people, names, relationships) — design

Status: approved
Source: `docs/family_tree_organiser_design_specification.pdf`, Phase 2 of its delivery roadmap (§19): "People, alternate names, relationships, validation, search and soft deletion."

## 1. Scope

**In scope**
- `people`, `person_names`, `relationships` tables with RLS
- Database-enforced validation: no self-relationships, no parent-child ancestry cycles, no duplicate active relationships of the same type between the same pair
- Trigram-based search infrastructure (`pg_trgm`) on names and places
- Soft deletion (`deleted_at`/`deleted_by`), matching the existing pattern from Phase 0/1
- SQL-level test coverage, matching the `supabase/tests/rls_phase1.sql` pattern

**Explicitly out of scope for this slice** (later phases per the roadmap)
- Any UI — no forms, no canvas, no detail views. Phase 3 (tree canvas) and Phase 4 (edit forms) build on top of this data layer; this phase is read/write-capable at the database level only, exercised via SQL tests.
- `stories` table and avatar configuration — Phase 5
- `audit_events` and any audit trigger — Phase 4. Nothing here is user-facing yet, so there is nothing to audit; wiring audit in before real mutations exist would be premature.
- Application-level optimistic-concurrency *enforcement* (checking a submitted version against the current one) — the `version` column exists now per the common-metadata pattern, but the check itself belongs to Phase 4's edit forms, which don't exist yet.
- Member-only field visibility — explicitly deferred per product owner decision; all content is guest-visible for this release, matching the spec's own MVP suggestion (§16.3).
- GEDCOM import/export, automatic layout, spouse-grouping — later phases, unrelated to this slice.

## 2. Decisions resolved during brainstorming

| Decision | Resolution |
|---|---|
| Member-only field visibility | Not implemented now — all content guest-visible, matching spec's MVP suggestion |
| Life status representation | Simple `is_living` boolean, matching the spec's own representative-fields naming (§14) |
| Search approach | `pg_trgm` trigram indexes, not full-text `tsvector` — better tolerance for family-name/place spelling variants than word-based full-text search |

## 3. Database schema

### `people`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid, PK | |
| `given_name` | text, not null | |
| `family_name` | text, not null | |
| `biography` | text, nullable | |
| `is_living` | boolean, not null | |
| `birth_date_precision` | `date_precision` enum, nullable | `exact`, `month_year`, `year_only`, `approximate`, `range`, `unknown` |
| `birth_date_value` | date, nullable | normalized sortable value; for imprecise precisions, the earliest representable day — never shown to the user as more precise than the editor entered |
| `birth_date_range_end` | date, nullable | only meaningful when `birth_date_precision = 'range'` |
| `birth_date_display` | text, nullable | the actual editor-authored display text (e.g. "ca. 1948") — the interface never derives this from the normalized value |
| `birth_place` | text, nullable | |
| `death_date_precision` | `date_precision` enum, nullable | same enum, independent of birth |
| `death_date_value` | date, nullable | |
| `death_date_range_end` | date, nullable | |
| `death_date_display` | text, nullable | |
| `death_place` | text, nullable | |
| `version` | int, not null, default 1 | exists now per common-metadata pattern; enforcement is Phase 4 |
| `deleted_at` / `deleted_by` | timestamptz / uuid, nullable | soft deletion |
| `created_at` / `updated_at` / `created_by` / `updated_by` | | UTC |

### `person_names`
Alternates only — former names, birth names, nicknames. The person's current/primary name lives directly on `people` (`given_name`/`family_name`), not duplicated here.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid, PK | |
| `person_id` | uuid, FK → people | |
| `name_type` | `name_type` enum | `former`, `birth`, `nickname` |
| `value` | text, not null | |
| `ordering` | int, not null, default 0 | |
| `notes` | text, nullable | |

### `relationships`
Independent of people; directional for parent-child, symmetric at the product level for partner types.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid, PK | |
| `person_a_id` | uuid, FK → people | parent, for parent-type relationships |
| `person_b_id` | uuid, FK → people | child, for parent-type relationships |
| `relationship_type` | `relationship_type` enum | `biological_parent`, `adoptive_parent`, `foster_parent`, `guardian_parent`, `spouse`, `former_spouse`, `partner`, `former_partner` |
| `start_date` / `end_date` | date, nullable | |
| `notes` | text, nullable | |
| `version` | int, not null, default 1 | |
| `deleted_at` / `deleted_by` | | soft deletion |
| `created_at` / `updated_at` / `created_by` / `updated_by` | | |

## 4. Validation

- `check (person_a_id <> person_b_id)` — no self-relationship, enforced at the database level regardless of what any future UI does.
- A trigger function on `relationships` INSERT/UPDATE that, for parent-type relationships only, walks the ancestry chain from the proposed parent upward and rejects the write if the proposed child already appears as an ancestor (would create a cycle).
- A partial unique index preventing two active (non-deleted) relationships of the identical `relationship_type` between the same ordered pair — a legitimate remarriage after divorce is a *different* type (`former_spouse` then a new `spouse` row) or a different pair ordering, not a duplicate of the same type.
- No hard-delete policy anywhere (matching the existing pattern) — soft deletion only, enforced by RLS having no DELETE policy at all.

## 5. RLS

Same pattern established in Phase 0/1: every policy routes through the existing `app_is_authorized()` / `app_is_member_or_admin()` helper functions rather than re-deriving logic inline.

| Table | SELECT | INSERT/UPDATE | DELETE |
|---|---|---|---|
| `people` | `app_is_authorized()` (guest/member/admin) | `app_is_member_or_admin()` | none (soft-delete only) |
| `person_names` | `app_is_authorized()` | `app_is_member_or_admin()` | none |
| `relationships` | `app_is_authorized()` | `app_is_member_or_admin()` | none |

Base-table GRANTs to `authenticated` must accompany these policies explicitly (this project's established gotcha: RLS policies alone don't grant Postgres table privileges — Tasks 8 and the password-auth pivot both had to add missing grants after the fact).

## 6. Search

`pg_trgm` extension enabled; GIN trigram indexes on `people.given_name`, `people.family_name`, `people.birth_place`, `people.death_place`, and `person_names.value`. No application code in this phase — the indexes exist so Phase 3's search UI can use `%` (similarity) or `ILIKE` efficiently when it's built.

## 7. Testing

`supabase/tests/core_data_model.sql`, following the exact pattern of `supabase/tests/rls_phase1.sql`: role-switching assertions proving the RLS matrix, plus assertions for the validation rules (self-relationship rejected, ancestry cycle rejected, duplicate active relationship rejected, soft-deleted rows excluded from default queries).

## 8. Acceptance criteria

- A member or admin can insert a person, an alternate name, and a relationship; a guest cannot write any of the three tables but can read all of them.
- Inserting a relationship where `person_a_id = person_b_id` fails.
- Inserting a parent-type relationship that would create an ancestry cycle fails.
- Soft-deleting a person or relationship sets `deleted_at`/`deleted_by` rather than removing the row.
- Trigram indexes exist and are usable (confirmed via `EXPLAIN` showing index usage on a similarity query, not a sequential scan).
