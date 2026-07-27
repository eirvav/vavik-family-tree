import type { Person } from "./data";

export function searchPeople(people: Person[], query: string): Person[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];

  return people.filter((person) => {
    const haystack = [person.given_name, person.family_name, person.birth_place, person.death_place]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(normalized);
  });
}
