import type { Person, Relationship } from "./data";

export type ConnectivityCheckResult =
  | { safe: true }
  | { safe: false; disconnectedPeople: Person[] };

/**
 * Checks whether removing `personId` (and their relationships) from the
 * tree would split the remaining people into more than one connected
 * component. If so, returns the people in every component except the
 * largest one — the group that would lose contact with the rest of the
 * tree, and so should be deleted first.
 */
export function checkDeleteConnectivity(
  people: Person[],
  relationships: Relationship[],
  personId: string
): ConnectivityCheckResult {
  const remainingPeople = people.filter((p) => p.id !== personId);
  const remainingIds = new Set(remainingPeople.map((p) => p.id));

  const adjacency = new Map<string, Set<string>>();
  for (const id of remainingIds) adjacency.set(id, new Set());

  for (const rel of relationships) {
    if (rel.person_a_id === personId || rel.person_b_id === personId) continue;
    if (!remainingIds.has(rel.person_a_id) || !remainingIds.has(rel.person_b_id)) continue;
    adjacency.get(rel.person_a_id)!.add(rel.person_b_id);
    adjacency.get(rel.person_b_id)!.add(rel.person_a_id);
  }

  const visited = new Set<string>();
  const components: string[][] = [];

  for (const id of remainingIds) {
    if (visited.has(id)) continue;
    const component: string[] = [];
    const queue = [id];
    visited.add(id);
    while (queue.length > 0) {
      const current = queue.shift()!;
      component.push(current);
      for (const neighbor of adjacency.get(current)!) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
    components.push(component);
  }

  if (components.length <= 1) {
    return { safe: true };
  }

  components.sort((a, b) => a.length - b.length);
  const disconnectedIds = new Set(components.slice(0, -1).flat());
  const peopleById = new Map(remainingPeople.map((p) => [p.id, p]));
  const disconnectedPeople = [...disconnectedIds].map((id) => peopleById.get(id)!);

  return { safe: false, disconnectedPeople };
}
