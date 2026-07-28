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
