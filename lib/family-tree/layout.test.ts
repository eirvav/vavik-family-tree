import { test, expect } from "bun:test";
import { computeDagreLayout } from "./layout";
import type { Person, Relationship } from "./data";

function makePerson(id: string, givenName: string): Person {
  return {
    id,
    given_name: givenName,
    family_name: "Vavik",
    birth_family_name: null,
    gender: "unknown",
    is_living: true,
    birth_date_display: null,
    death_date_display: null,
    biography: null,
    birth_place: null,
    death_place: null,
  };
}

function makeRelationship(
  id: string,
  personAId: string,
  personBId: string,
  type: Relationship["relationship_type"]
): Relationship {
  return { id, person_a_id: personAId, person_b_id: personBId, relationship_type: type };
}

test("ranks a parent above their child", () => {
  const parent = makePerson("parent", "Parent");
  const child = makePerson("child", "Child");
  const people = [parent, child];
  const relationships = [makeRelationship("r1", "parent", "child", "biological_parent")];

  const layout = computeDagreLayout(people, relationships);
  expect(layout.get("parent")!.y).toBeLessThan(layout.get("child")!.y);
});

test("pulls partners with no shared child onto the same rank", () => {
  const a = makePerson("a", "A");
  const b = makePerson("b", "B");
  const people = [a, b];
  const relationships = [makeRelationship("r1", "a", "b", "spouse")];

  const layout = computeDagreLayout(people, relationships);
  expect(layout.get("a")!.y).toBe(layout.get("b")!.y);
});

test("pulls former partners onto the same rank too", () => {
  const a = makePerson("a", "A");
  const b = makePerson("b", "B");
  const people = [a, b];
  const relationships = [makeRelationship("r1", "a", "b", "former_partner")];

  const layout = computeDagreLayout(people, relationships);
  expect(layout.get("a")!.y).toBe(layout.get("b")!.y);
});

test("pulls siblings with no parent on file onto the same rank", () => {
  const a = makePerson("a", "A");
  const b = makePerson("b", "B");
  const people = [a, b];
  const relationships = [makeRelationship("r1", "a", "b", "sibling")];

  const layout = computeDagreLayout(people, relationships);
  expect(layout.get("a")!.y).toBe(layout.get("b")!.y);
});

test("pulls a 3-person sibling/partner chain onto the same rank with distinct, non-overlapping x positions", () => {
  const a = makePerson("a", "A");
  const b = makePerson("b", "B");
  const c = makePerson("c", "C");
  const people = [a, b, c];
  const relationships = [
    makeRelationship("r1", "a", "b", "sibling"),
    makeRelationship("r2", "b", "c", "spouse"),
  ];

  const layout = computeDagreLayout(people, relationships);
  const ay = layout.get("a")!.y;
  const by = layout.get("b")!.y;
  const cy = layout.get("c")!.y;
  expect(ay).toBe(by);
  expect(by).toBe(cy);

  const ax = layout.get("a")!.x;
  const bx = layout.get("b")!.x;
  const cx = layout.get("c")!.x;
  expect(new Set([ax, bx, cx]).size).toBe(3);
});

test("ranks a group below an external parent attached to one of its members", () => {
  const d = makePerson("d", "D");
  const a = makePerson("a", "A");
  const b = makePerson("b", "B");
  const people = [d, a, b];
  const relationships = [
    makeRelationship("r1", "a", "b", "sibling"),
    makeRelationship("r2", "d", "a", "biological_parent"),
  ];

  const layout = computeDagreLayout(people, relationships);
  expect(layout.get("a")!.y).toBe(layout.get("b")!.y);
  expect(layout.get("d")!.y).toBeLessThan(layout.get("a")!.y);
});

test("doesn't crash on a parent-child edge between two people already collapsed into the same adjacency group", () => {
  // Inconsistent data on purpose: a and b are marked as siblings (so they
  // collapse into one composite node), but there's also a biological_parent
  // edge directly between them. Both endpoints resolve to the same
  // composite Dagre node id, so that edge must be skipped as a self-loop
  // rather than passed to graph.setEdge (which Dagre can't rank).
  const a = makePerson("a", "A");
  const b = makePerson("b", "B");
  const people = [a, b];
  const relationships = [
    makeRelationship("r1", "a", "b", "sibling"),
    makeRelationship("r2", "a", "b", "biological_parent"),
  ];

  expect(() => computeDagreLayout(people, relationships)).not.toThrow();

  const layout = computeDagreLayout(people, relationships);
  expect(layout.get("a")!.y).toBe(layout.get("b")!.y);
  expect(layout.get("a")!.x).not.toBe(layout.get("b")!.x);
});

test("reserves enough width for a wide branch so its column doesn't overlap its neighbor's", () => {
  // topA+topB have two children, b1a and b2a. b1a partners with b1b and
  // they have THREE children together (needing more width than b1a+b1b's
  // own 2-person box); b2a partners with b2b and they have only one child.
  // This is the exact shape of the confirmed overlap bug: b1's branch
  // needs 3*200+2*40=680px for its children, more than its own 440px.
  //
  // Note this is NOT caught by checking whether b1's own children (c1, c2,
  // c3) stay spaced apart from each other, or from b2's child (c4), at
  // their shared rank: Dagre's nodesep constraint between same-rank
  // siblings is a hard invariant it always enforces given each node's own
  // declared width, with or without this fix (verified directly against
  // the pre-fix commit: that check passes unmodified). The actual bug is
  // that b1's branch, as a whole vertical column (its own box plus
  // everything descending from it), encroaches horizontally on b2's column
  // even though the two branches' nodes never share a rank -- because
  // pre-fix, b1's declared Dagre width was only its own 440px box, so
  // Dagre didn't reserve enough clearance between the b1 and b2 columns
  // for b1's wider subtree to fit without spilling into b2's territory.
  const topA = makePerson("topA", "TopA");
  const topB = makePerson("topB", "TopB");
  const b1a = makePerson("b1a", "B1A");
  const b1b = makePerson("b1b", "B1B");
  const b2a = makePerson("b2a", "B2A");
  const b2b = makePerson("b2b", "B2B");
  const c1 = makePerson("c1", "C1");
  const c2 = makePerson("c2", "C2");
  const c3 = makePerson("c3", "C3");
  const c4 = makePerson("c4", "C4");
  const people = [topA, topB, b1a, b1b, b2a, b2b, c1, c2, c3, c4];
  const relationships = [
    makeRelationship("r1", "topA", "topB", "spouse"),
    makeRelationship("r2", "topA", "b1a", "biological_parent"),
    makeRelationship("r3", "topB", "b1a", "biological_parent"),
    makeRelationship("r4", "topA", "b2a", "biological_parent"),
    makeRelationship("r5", "topB", "b2a", "biological_parent"),
    makeRelationship("r6", "b1a", "b1b", "spouse"),
    makeRelationship("r7", "b2a", "b2b", "spouse"),
    makeRelationship("r8", "b1a", "c1", "biological_parent"),
    makeRelationship("r9", "b1b", "c1", "biological_parent"),
    makeRelationship("r10", "b1a", "c2", "biological_parent"),
    makeRelationship("r11", "b1b", "c2", "biological_parent"),
    makeRelationship("r12", "b1a", "c3", "biological_parent"),
    makeRelationship("r13", "b1b", "c3", "biological_parent"),
    makeRelationship("r14", "b2a", "c4", "biological_parent"),
    makeRelationship("r15", "b2b", "c4", "biological_parent"),
  ];

  const layout = computeDagreLayout(people, relationships);

  // A branch's "column" is the horizontal extent of its own box plus every
  // descendant's box, across all ranks (each box is NODE_WIDTH=200px wide,
  // so extends 100px either side of its center x).
  function columnExtent(ids: string[]) {
    const xs = ids.map((id) => layout.get(id)!.x);
    return { min: Math.min(...xs) - 100, max: Math.max(...xs) + 100 };
  }
  const b1Column = columnExtent(["b1a", "b1b", "c1", "c2", "c3"]);
  const b2Column = columnExtent(["b2a", "b2b", "c4"]);

  // The two branches' columns must not overlap horizontally at all, no
  // matter which rank each node within them occupies. A positive value
  // here means the columns overlap by that many pixels.
  const columnOverlap = Math.min(b1Column.max, b2Column.max) - Math.max(b1Column.min, b2Column.min);
  expect(columnOverlap).toBeLessThanOrEqual(0);

  // Sanity check: all four grandchildren are at the same rank and, with a
  // uniform node width of 200px, none should be closer than 200px
  // center-to-center — anything less means their boxes overlap. (This
  // alone doesn't exercise the fix — see the comment above.)
  const grandchildren = ["c1", "c2", "c3", "c4"];
  for (let i = 0; i < grandchildren.length; i++) {
    for (let j = i + 1; j < grandchildren.length; j++) {
      const xi = layout.get(grandchildren[i])!.x;
      const xj = layout.get(grandchildren[j])!.x;
      expect(Math.abs(xi - xj)).toBeGreaterThanOrEqual(200);
    }
  }
});
