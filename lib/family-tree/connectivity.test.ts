import { test, expect } from "bun:test";
import { checkDeleteConnectivity } from "./connectivity";
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
  type: Relationship["relationship_type"] = "biological_parent"
): Relationship {
  return { id, person_a_id: personAId, person_b_id: personBId, relationship_type: type };
}

test("allows deleting a person with no relationships", () => {
  const alice = makePerson("alice", "Alice");
  const result = checkDeleteConnectivity([alice], [], "alice");
  expect(result.safe).toBe(true);
});

test("allows deleting a leaf person (no children of their own)", () => {
  const grandparent = makePerson("grandparent", "Grandparent");
  const parent = makePerson("parent", "Parent");
  const child = makePerson("child", "Child");
  const people = [grandparent, parent, child];
  const relationships = [
    makeRelationship("r1", "grandparent", "parent"),
    makeRelationship("r2", "parent", "child"),
  ];

  const result = checkDeleteConnectivity(people, relationships, "child");
  expect(result.safe).toBe(true);
});

test("blocks deleting a bridging person and reports who'd be disconnected", () => {
  const grandparent = makePerson("grandparent", "Grandparent");
  const parent = makePerson("parent", "Parent");
  const me = makePerson("me", "Me");
  const people = [grandparent, parent, me];
  const relationships = [
    makeRelationship("r1", "grandparent", "parent"),
    makeRelationship("r2", "parent", "me"),
  ];

  const result = checkDeleteConnectivity(people, relationships, "parent");
  expect(result.safe).toBe(false);
  if (!result.safe) {
    expect(result.disconnectedPeople.map((p) => p.id)).toEqual(["grandparent"]);
  }
});

test("keeps the larger branch and flags the smaller one on a two-branch split", () => {
  // hub -- a1 -- a2
  // hub -- b1
  const hub = makePerson("hub", "Hub");
  const a1 = makePerson("a1", "A1");
  const a2 = makePerson("a2", "A2");
  const b1 = makePerson("b1", "B1");
  const people = [hub, a1, a2, b1];
  const relationships = [
    makeRelationship("r1", "hub", "a1"),
    makeRelationship("r2", "a1", "a2"),
    makeRelationship("r3", "hub", "b1"),
  ];

  const result = checkDeleteConnectivity(people, relationships, "hub");
  expect(result.safe).toBe(false);
  if (!result.safe) {
    expect(result.disconnectedPeople.map((p) => p.id).sort()).toEqual(["b1"]);
  }
});

test("allows deleting one of two parents who share a child (redundant connection remains)", () => {
  const father = makePerson("father", "Father");
  const mother = makePerson("mother", "Mother");
  const child = makePerson("child", "Child");
  const people = [father, mother, child];
  const relationships = [
    makeRelationship("r1", "father", "child"),
    makeRelationship("r2", "mother", "child"),
  ];

  const result = checkDeleteConnectivity(people, relationships, "father");
  expect(result.safe).toBe(true);
});
