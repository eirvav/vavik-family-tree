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
