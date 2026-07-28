import dagre from "@dagrejs/dagre";
import type { Person, Relationship } from "./data";

const NODE_WIDTH = 200;
const NODE_HEIGHT = 60;
// Horizontal gap between adjacent nodes within a partner/sibling group, and
// also the graph's nodesep — kept equal so grouped and ungrouped people are
// spaced consistently.
const NODE_GAP = 40;

const PARENT_TYPES = new Set<Relationship["relationship_type"]>([
  "biological_parent",
  "adoptive_parent",
  "foster_parent",
  "guardian_parent",
]);

// Partner and sibling relationships don't imply hierarchy, but two people
// linked by one should still land next to each other in the layout.
const ADJACENCY_TYPES = new Set<Relationship["relationship_type"]>([
  "spouse",
  "former_spouse",
  "partner",
  "former_partner",
  "sibling",
]);

// Minimal union-find used to group people transitively connected by
// ADJACENCY_TYPES relationships (e.g. three siblings linked pairwise, or a
// couple who are also each other's "former_partner" and "spouse").
class UnionFind {
  private parent = new Map<string, string>();

  private ensure(id: string): string {
    if (!this.parent.has(id)) this.parent.set(id, id);
    return id;
  }

  find(id: string): string {
    this.ensure(id);
    let root = id;
    while (this.parent.get(root) !== root) {
      root = this.parent.get(root)!;
    }
    // Path compression.
    let cur = id;
    while (this.parent.get(cur) !== root) {
      const next = this.parent.get(cur)!;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }

  union(a: string, b: string): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) this.parent.set(rootA, rootB);
  }
}

/**
 * Computes a top-to-bottom generational layout for the family tree using
 * Dagre. Parent-child edges drive the ranking (who's above whom) with
 * Dagre's default minimum rank distance.
 *
 * Partner and sibling relationships don't imply hierarchy, but two people
 * linked by one (with no shared child otherwise forcing them together)
 * should still land on the same rank, next to each other. This is NOT
 * implemented via Dagre's `minlen: 0` edge label — the standard technique
 * for "same rank" adjacency — because the installed @dagrejs/dagre (pinned
 * to ^3.0.0 in package.json) has a confirmed bug: `dagre.layout()` throws
 * ("undefined is not an object (evaluating 'u.points.forEach')") inside its
 * internal translateGraph step whenever ANY edge carries an explicit
 * `minlen: 0` label, reproducible with as few as two nodes and one such
 * edge between them, regardless of which ranks the edge's endpoints
 * ultimately resolve to. This was verified directly against the installed
 * dagre.layout implementation, not assumed.
 *
 * Instead, people connected only by ADJACENCY_TYPES relationships are
 * grouped (transitively, via union-find) and collapsed into a single
 * composite Dagre node before layout. The composite node inherits the
 * union of every group member's parent/child edges, so the group as a
 * whole still respects every hierarchy constraint that applied to any of
 * its individual members. After layout, each composite node is expanded
 * back into its members, laid out side by side (sharing the composite's y)
 * so they land on the same rank and end up adjacent.
 *
 * Pure function: takes the full people/relationship lists and returns a map of
 * person id -> computed {x, y}.
 */
export function computeDagreLayout(
  people: Person[],
  relationships: Relationship[]
): Map<string, { x: number; y: number }> {
  const unionFind = new UnionFind();
  for (const person of people) unionFind.find(person.id);
  for (const rel of relationships) {
    if (ADJACENCY_TYPES.has(rel.relationship_type)) {
      unionFind.union(rel.person_a_id, rel.person_b_id);
    }
  }

  // groupId -> ordered member ids (order follows the `people` array, so
  // layout is deterministic given the same input).
  const groups = new Map<string, string[]>();
  for (const person of people) {
    const groupId = unionFind.find(person.id);
    const members = groups.get(groupId);
    if (members) members.push(person.id);
    else groups.set(groupId, [person.id]);
  }

  // person id -> id of the Dagre node that represents them (their own id if
  // they're in a singleton group, otherwise the shared group id).
  const dagreNodeIdFor = new Map<string, string>();
  for (const [groupId, members] of groups) {
    for (const id of members) dagreNodeIdFor.set(id, groupId);
  }

  const graph = new dagre.graphlib.Graph();
  graph.setGraph({ rankdir: "TB", nodesep: NODE_GAP, ranksep: 100 });
  graph.setDefaultEdgeLabel(() => ({}));

  for (const [groupId, members] of groups) {
    const width = members.length * NODE_WIDTH + (members.length - 1) * NODE_GAP;
    graph.setNode(groupId, { width, height: NODE_HEIGHT });
  }

  for (const rel of relationships) {
    if (!PARENT_TYPES.has(rel.relationship_type)) continue;
    const from = dagreNodeIdFor.get(rel.person_a_id)!;
    const to = dagreNodeIdFor.get(rel.person_b_id)!;
    // Both ends collapsed into the same adjacency group (e.g. bad data
    // pairing two "siblings" who also have a parent-child edge on file) —
    // skip rather than create a self-loop Dagre can't rank.
    if (from === to) continue;
    graph.setEdge(from, to);
  }

  dagre.layout(graph);

  const result = new Map<string, { x: number; y: number }>();
  for (const [groupId, members] of groups) {
    const node = graph.node(groupId);
    const totalWidth = members.length * NODE_WIDTH + (members.length - 1) * NODE_GAP;
    let x = node.x - totalWidth / 2 + NODE_WIDTH / 2;
    for (const id of members) {
      result.set(id, { x, y: node.y });
      x += NODE_WIDTH + NODE_GAP;
    }
  }
  return result;
}
