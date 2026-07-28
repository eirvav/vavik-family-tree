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

// Orders a group's members by a deterministic depth-first traversal over
// the group's own internal adjacency edges (ADJACENCY_TYPES relationships
// where both ends are in this group), so directly-connected people (e.g.
// two siblings, or a couple) end up next to each other in the final
// left-to-right position — not just on the same rank. Iterating `people`
// array order alone (how membership itself is determined) says nothing
// about adjacency within the group.
//
// This is a best-effort linearization: a "star" topology (one hub person
// directly linked to three-or-more others who aren't linked to each
// other) can't have every pair adjacent in a 1D layout no matter the
// ordering — that's a structural limit of laying out a graph on a line,
// not a bug. DFS still correctly handles the common chain/pair cases
// (couples, couples-with-shared-children, sibling pairs) exactly.
function orderGroupMembers(members: string[], relationships: Relationship[]): string[] {
  const memberSet = new Set(members);
  const adjacency = new Map<string, string[]>();
  for (const id of members) adjacency.set(id, []);
  for (const rel of relationships) {
    if (!ADJACENCY_TYPES.has(rel.relationship_type)) continue;
    if (!memberSet.has(rel.person_a_id) || !memberSet.has(rel.person_b_id)) continue;
    adjacency.get(rel.person_a_id)!.push(rel.person_b_id);
    adjacency.get(rel.person_b_id)!.push(rel.person_a_id);
  }

  const visited = new Set<string>();
  const ordered: string[] = [];
  for (const start of members) {
    if (visited.has(start)) continue;
    const stack = [start];
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (visited.has(current)) continue;
      visited.add(current);
      ordered.push(current);
      const neighbors = adjacency.get(current)!;
      // Push in reverse so the stack (LIFO) visits them in original order.
      for (let i = neighbors.length - 1; i >= 0; i--) {
        if (!visited.has(neighbors[i])) stack.push(neighbors[i]);
      }
    }
  }
  return ordered;
}

// Computes how much horizontal width a group's entire descendant subtree
// needs — not just the group's own width. A group with children whose
// combined width exceeds the group's own width (e.g. a couple with three
// children together, needing more room than the couple's own 2-person
// box) must reserve that larger amount, or Dagre has no way to know to
// keep a neighboring branch from encroaching on it. Memoized because the
// same group can appear as a "child" under more than one parent group in
// blended-family cases (see the doc comment on computeDagreLayout).
function computeSubtreeWidth(
  groupId: string,
  ownWidth: Map<string, number>,
  childrenByGroup: Map<string, Set<string>>,
  cache: Map<string, number>,
  inProgress: Set<string> = new Set()
): number {
  const cached = cache.get(groupId);
  if (cached !== undefined) return cached;

  // Cyclic group graph (possible from a sibling edge that connects an
  // ancestor group to a descendant group — no person-level ancestry check
  // rejects this, since it only looks at parent-child chains, not what
  // happens after siblings/partners collapse into shared groups) — fall
  // back to own width rather than recursing forever.
  if (inProgress.has(groupId)) return ownWidth.get(groupId)!;
  inProgress.add(groupId);

  const own = ownWidth.get(groupId)!;
  const children = childrenByGroup.get(groupId);
  let width = own;
  if (children && children.size > 0) {
    const childrenTotal =
      [...children].reduce(
        (sum, childId) =>
          sum + computeSubtreeWidth(childId, ownWidth, childrenByGroup, cache, inProgress),
        0
      ) +
      (children.size - 1) * NODE_GAP;
    width = Math.max(own, childrenTotal);
  }

  inProgress.delete(groupId);
  cache.set(groupId, width);
  return width;
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
 * Each group's declared Dagre width is not just its own width, though —
 * it's the width of its entire descendant subtree (computeSubtreeWidth),
 * so a branch whose children collectively need more room than the branch
 * itself doesn't get an undersized column and overlap its neighbor. A
 * child with two parents in different, unconnected groups (e.g. separated
 * parents with no relationship recorded between them) has its width
 * counted by both parent groups independently — a conservative,
 * redundant over-reservation rather than a tight optimum, which is safe
 * (extra whitespace) where under-reservation would be the bug.
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

  // Re-order each group's members by adjacency (see orderGroupMembers) —
  // the loop above only determined group MEMBERSHIP, not visual order.
  for (const [groupId, members] of groups) {
    if (members.length > 1) {
      groups.set(groupId, orderGroupMembers(members, relationships));
    }
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

  // Each group's own width (just the group's own members, no descendants) —
  // used both as the base case for computeSubtreeWidth and, unchanged from
  // before, to expand a group's assigned position back into its individual
  // members' x positions.
  const ownWidth = new Map<string, number>();
  for (const [groupId, members] of groups) {
    ownWidth.set(groupId, members.length * NODE_WIDTH + (members.length - 1) * NODE_GAP);
  }

  // groupId -> set of child group ids (deduplicated — a child with two
  // parents in the same group would otherwise redirect two separate
  // parent-child relationship rows onto the same from/to pair).
  const childrenByGroup = new Map<string, Set<string>>();
  for (const rel of relationships) {
    if (!PARENT_TYPES.has(rel.relationship_type)) continue;
    const from = dagreNodeIdFor.get(rel.person_a_id)!;
    const to = dagreNodeIdFor.get(rel.person_b_id)!;
    // Both ends collapsed into the same adjacency group (e.g. bad data
    // pairing two "siblings" who also have a parent-child edge on file) —
    // skip rather than create a self-loop Dagre can't rank.
    if (from === to) continue;
    if (!childrenByGroup.has(from)) childrenByGroup.set(from, new Set());
    childrenByGroup.get(from)!.add(to);
  }

  const subtreeWidthCache = new Map<string, number>();
  for (const [groupId] of groups) {
    graph.setNode(groupId, {
      width: computeSubtreeWidth(groupId, ownWidth, childrenByGroup, subtreeWidthCache),
      height: NODE_HEIGHT,
    });
  }

  for (const [from, children] of childrenByGroup) {
    for (const to of children) {
      graph.setEdge(from, to);
    }
  }

  dagre.layout(graph);

  const result = new Map<string, { x: number; y: number }>();
  for (const [groupId, members] of groups) {
    const node = graph.node(groupId);
    const totalWidth = ownWidth.get(groupId)!;
    let x = node.x - totalWidth / 2 + NODE_WIDTH / 2;
    for (const id of members) {
      result.set(id, { x, y: node.y });
      x += NODE_WIDTH + NODE_GAP;
    }
  }
  return result;
}
