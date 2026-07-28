# Phase 4b: Editing via floating action bar — Design

## Purpose

Phase 4a made the tree canvas static (no drag, orientation toggle only). Phase 4b adds the actual editing workflow: admins build out the real ~250-person Vavik family tree by incrementally adding people and relationships from the canvas, using a floating action bar (Figma/tldraw-style) and a redesigned two-tab sidebar. Members get a narrower capability: editing a person's biography text. Guests remain read-only.

Today the tree holds 6 placeholder people and 8 relationships from earlier-phase verification testing — these will be edited in place (via this feature) to become the real seed of the tree, rather than deleted and re-entered.

## Core rule: the tree only grows from itself

There is no "create a stand-alone person" action anywhere in this phase. Every new person is created *through* a relationship action (add father/mother/sibling/partner/child) off an already-selected person. Symmetrically, deleting a person is blocked if it would disconnect any other part of the tree from the rest — see "Delete & the connectivity rule" below. Together these two rules guarantee the tree is always a single connected component (or empty).

## Permissions

Three roles, matching the existing guest/member/admin model:

- **Guest**: read-only, as today.
- **Member**: can open the sidebar and edit a person's **biography** text only. No action bar, no personal-info editing, no add/delete.
- **Admin**: full access — action bar (add relationships, delete person) plus personal-info editing plus biography editing.

This is enforced at the RLS layer, not just hidden in the UI:

- A new `app_is_admin()` SQL helper (`profiles.role = 'admin'` for the caller), alongside the existing `app_is_member_or_admin()`.
- The `people` and `relationships` table policies for INSERT and UPDATE are tightened from "member or admin" to **admin only**. This covers creating people, creating relationships, editing personal info, and soft-deleting (soft delete is an UPDATE setting `deleted_at`/`deleted_by`).
- A new security-definer RPC, `update_person_biography(person_id uuid, biography text)`, is the one mutation path open to members: it checks the caller is an active member-or-admin, then updates only `biography`, `updated_at`, `updated_by`, `version` on the target row. Admins also call this RPC for biography edits (no need for a separate admin path).

Server actions additionally re-check the caller's role before acting (matching the existing pattern in `app/admin/medlemmer/actions.ts`), so the UI, server action, and RLS all agree — no reliance on any single layer.

## Data model changes

One new column: `people.birth_family_name text`, nullable. Captures a person's surname at birth (fødselsnavn), shown and edited alongside the other personal-info fields. No other schema changes; birth/death dates continue to use only the existing `*_date_display` free-text columns (the `*_date_precision`/`*_date_value` structured columns stay unused in this phase, consistent with how the canvas already only reads `*_date_display`).

## Sidebar (replaces the current compact/full `DetailPanel`)

Clicking a person opens the right-hand sidebar. It has two tabs:

**Personinfo** (personal information):
- Fornavn, etternavn, etternavn ved fødsel, kjønn (mann/kvinne/ikke oppgitt), fødselsdato (text), "avdød" toggle — switching it on reveals a dødsdato (text) field.
- The existing "Familie" relationship list (links to related people, reusing the current parent/child/partner label logic) stays part of this tab, unchanged.
- Read-only by default. Admins see an Edit button that switches the tab into an editable form with Save/Cancel. Members see the same tab but no Edit button — read-only for them.

**Biografi**:
- Plain text biography field.
- Read-only by default, with an Edit button for both members and admins (member edits go through `update_person_biography`; admin edits can go through the same RPC, since it's authorized for both).

The old compact-vs-full distinction (single click = preview, double click = full profile) is retired — a single click always opens this full two-tab sidebar.

## Floating action bar

Rendered by `ViewWrapper`/`FamilyTreeCanvas`, fixed to the bottom-center of the viewport, rounded, and independent of canvas pan/zoom (renders outside the React Flow viewport, like the existing search bar and sidebar).

- **Admin, nothing selected**: bar doesn't render. There's no unanchored "add person" action in this phase — every addition starts from an existing person.
- **Admin, person selected**: bar shows six actions — Legg til far, Legg til mor, Legg til søsken, Legg til partner, Legg til barn, Slett person. "Legg til søsken" is disabled (with an explanatory tooltip) until the selected person has at least one active parent relationship on file, since a sibling is created as another child of that same parent.
- **Member or guest**: bar never renders, regardless of selection.

## Add-relationship dialogs (quick create)

Clicking an action-bar button opens a small dialog, not the full sidebar — fast enough to add many people in a row:

| Field | Legg til far | Legg til mor | Legg til søsken | Legg til partner | Legg til barn |
|---|---|---|---|---|---|
| Fornavn | ✓ required | ✓ required | ✓ required | ✓ required | ✓ required |
| Etternavn | ✓ prefilled from selected person, editable | ✓ prefilled, editable | ✓ prefilled, editable | ✓ blank, editable | ✓ prefilled, editable |
| Kjønn | fixed: mann (no selector) | fixed: kvinne (no selector) | selector: mann/kvinne/ikke oppgitt | selector | selector |
| Relasjonstype | biologisk / adoptiv / foster / verge (default biologisk) | same | same, applied per parent link (see below) | ektefelle / tidligere ektefelle / partner / tidligere partner (default ektefelle) | biologisk / adoptiv / foster / verge (default biologisk) |

Everything else (fødselsdato, avdød, etternavn ved fødsel, biografi) is left blank and filled in later via the sidebar.

On submit, one server action creates the person and the relationship(s) together:
- **Far/mor/barn/partner**: one relationship row linking the selected person and the new person, using the chosen relationship type. (Far/mor: selected person is `person_b`, new person is `person_a`. Barn: reversed. Partner: direction doesn't carry meaning for spouse-type relationships.)
- **Søsken**: the new person is linked as a child to *each* of the selected person's existing active parent relationships, mirroring that parent link's relationship type (e.g. if the selected person's father link is `adoptive_parent`, the new sibling gets an `adoptive_parent` link to that same father too). If the selected person has two parents on file, this creates two relationship rows.

After creation, selection moves to the new person and their sidebar opens automatically, ready for detail entry.

## Delete & the connectivity rule

Deleting a person is a two-step flow: a confirmation dialog, then a server-side connectivity check.

The delete server action loads the full active graph (all non-deleted people and relationships), removes the target person and their edges, and checks whether the *remaining* people still form a single connected component (BFS/DFS over the relationship graph). Two outcomes:

- **Safe** (still one component, or the removed person was already isolated): the person and all their active relationships are soft-deleted together in one action (`deleted_at`/`deleted_by` set on both).
- **Would split the tree**: the delete is refused. The remaining people are grouped into connected components; every component except the largest is reported as "would be disconnected," and the dialog lists those people by name (e.g. "Kan ikke slette Grandma — Grandpa Vavik ville da miste kontakt med resten av treet. Slett dem først."). The admin resolves this by deleting outward-in — the disconnected relatives first, then the original target.

## Mutation & refresh strategy

All mutations (create-relationship, edit personal info, edit biography, delete) go through server actions. On success, the client calls `router.refresh()`, which re-runs the `tre-slekt` server component and passes fresh `people`/`relationships` props down.

`FamilyTreeCanvas` currently only re-syncs its React Flow nodes/edges when `orientation` changes (via `OrientationEffectHandler`). This phase extends that effect to also re-run when the `people`/`relationships` props change (not just orientation), so a refresh actually shows the new/edited/deleted person. Client-only state — pan/zoom position, orientation choice, current selection — lives outside this data flow and is unaffected by the refresh.

## Testing

- Unit-level: the connectivity-check function (pure graph logic — given a people/relationships list and a target id, returns either "safe" or the list of people who'd be disconnected).
- Manual verification in-browser for the full flows: add father/mother/sibling/partner/child from a selected person, edit personal info and biography as admin, edit biography as member (and confirm the action bar and personal-info edit button are absent for members), attempt a blocked delete and confirm the message names the right people, and a successful delete that also removes the person's relationships.
