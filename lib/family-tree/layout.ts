import dagre from "@dagrejs/dagre";
import type { Person, Relationship } from "./data";

const NODE_WIDTH = 200;
const NODE_HEIGHT = 60;

const PARENT_TYPES = new Set<Relationship["relationship_type"]>([
  "biological_parent",
  "adoptive_parent",
  "foster_parent",
  "guardian_parent",
]);

/**
 * Computes a generational layout for the family tree using Dagre. Only
 * parent-child edges drive the ranking — partner edges are intentionally
 * excluded because they'd confuse a strictly hierarchical layout algorithm.
 * Partners still end up positioned near each other in practice because they
 * usually share children, not because of an explicit partner-edge constraint.
 *
 * Orientation controls the direction: "tb" (top-to-bottom, parents above
 * children) or "lr" (left-to-right, ancestors on the left).
 *
 * Pure function: takes the full people/relationship lists and returns a map of
 * person id -> computed {x, y}, independent of any saved canvas positions.
 */
export function computeDagreLayout(
  people: Person[],
  relationships: Relationship[],
  orientation: "tb" | "lr"
): Map<string, { x: number; y: number }> {
  const graph = new dagre.graphlib.Graph();
  graph.setGraph({ rankdir: orientation === "tb" ? "TB" : "LR", nodesep: 40, ranksep: 100 });
  graph.setDefaultEdgeLabel(() => ({}));

  for (const person of people) {
    graph.setNode(person.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }

  for (const rel of relationships) {
    if (PARENT_TYPES.has(rel.relationship_type)) {
      graph.setEdge(rel.person_a_id, rel.person_b_id);
    }
  }

  dagre.layout(graph);

  const result = new Map<string, { x: number; y: number }>();
  for (const person of people) {
    const node = graph.node(person.id);
    result.set(person.id, { x: node.x, y: node.y });
  }
  return result;
}
