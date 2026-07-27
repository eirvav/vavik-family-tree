"use client";

import { ReactFlow, Background, Controls, useNodesState, useEdgesState } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { Person, Relationship, CanvasPositionRow } from "@/lib/family-tree/data";

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

  const initialNodes = people.map((person, index) => {
    const saved = positionByPersonId.get(person.id);
    return {
      id: person.id,
      position: saved ? { x: saved.x, y: saved.y } : { x: (index % 10) * 200, y: Math.floor(index / 10) * 150 },
      data: { label: `${person.given_name} ${person.family_name}` },
    };
  });

  const initialEdges = relationships.map((rel) => ({
    id: rel.id,
    source: rel.person_a_id,
    target: rel.person_b_id,
  }));

  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, , onEdgesChange] = useEdgesState(initialEdges);

  return (
    <div className="h-full w-full">
      <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} fitView>
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}
