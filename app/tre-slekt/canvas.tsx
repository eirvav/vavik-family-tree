"use client";

import { ReactFlow, Background, Controls, MarkerType, useNodesState, useEdgesState } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { PersonNode } from "./person-node";
import { computeDagreLayout } from "@/lib/family-tree/layout";
import type { Person, Relationship, CanvasPositionRow } from "@/lib/family-tree/data";

const nodeTypes = { person: PersonNode };

const PARENT_RELATIONSHIP_TYPES = new Set<Relationship["relationship_type"]>([
  "biological_parent",
  "adoptive_parent",
  "foster_parent",
  "guardian_parent",
]);

const PARTNER_RELATIONSHIP_TYPES = new Set<Relationship["relationship_type"]>([
  "spouse",
  "former_spouse",
  "partner",
  "former_partner",
]);

// Norwegian labels shown on edges for relationship types that aren't the "default"
// within their category (biological_parent / spouse need no label).
const RELATIONSHIP_LABELS: Partial<Record<Relationship["relationship_type"], string>> = {
  adoptive_parent: "adoptivforelder",
  foster_parent: "fosterforelder",
  guardian_parent: "verge",
  former_spouse: "tidligere ektefelle",
  former_partner: "tidligere partner",
};

export function FamilyTreeCanvas({
  people,
  relationships,
  positions,
  canEdit,
  isAdmin,
}: {
  people: Person[];
  relationships: Relationship[];
  positions: CanvasPositionRow[];
  canEdit: boolean;
  isAdmin: boolean;
}) {
  const positionByPersonId = new Map(positions.map((p) => [p.person_id, p]));
  const dagreLayout = computeDagreLayout(people, relationships);

  const initialNodes = people.map((person) => {
    const saved = positionByPersonId.get(person.id);
    const fallback = dagreLayout.get(person.id) ?? { x: 0, y: 0 };
    return {
      id: person.id,
      type: "person",
      position: saved ? { x: saved.x, y: saved.y } : fallback,
      data: { person },
    };
  });

  const initialEdges = relationships.map((rel) => {
    const isParentEdge = PARENT_RELATIONSHIP_TYPES.has(rel.relationship_type);
    const isPartnerEdge = PARTNER_RELATIONSHIP_TYPES.has(rel.relationship_type);
    const label = RELATIONSHIP_LABELS[rel.relationship_type];

    return {
      id: rel.id,
      source: rel.person_a_id,
      target: rel.person_b_id,
      ...(isParentEdge && {
        type: "smoothstep",
        markerEnd: { type: MarkerType.ArrowClosed },
      }),
      ...(isPartnerEdge && {
        style: { strokeDasharray: "5,5" },
      }),
      ...(label && { label }),
    };
  });

  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, , onEdgesChange] = useEdgesState(initialEdges);

  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        fitView
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}
