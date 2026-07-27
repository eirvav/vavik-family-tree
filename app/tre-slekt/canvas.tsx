"use client";

import { useCallback, useState } from "react";
import { ReactFlow, Background, Controls, MarkerType, useNodesState, useEdgesState, useReactFlow } from "@xyflow/react";
import type { Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { PersonNode } from "./person-node";
import { DetailPanel } from "./detail-panel";
import { computeDagreLayout } from "@/lib/family-tree/layout";
import { savePersonPosition, resetLayout } from "./actions";
import { searchPeople } from "@/lib/family-tree/search";
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
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const [panelMode, setPanelMode] = useState<"compact" | "full" | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearchDropdown, setShowSearchDropdown] = useState(false);

  const positionByPersonId = new Map(positions.map((p) => [p.person_id, p]));
  const peopleById = new Map(people.map((p) => [p.id, p]));
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

  const handleNodeDragStop = useCallback(
    (_event: MouseEvent | TouchEvent, node: Node) => {
      if (!canEdit) return;
      void savePersonPosition(node.id, node.position.x, node.position.y);
    },
    [canEdit]
  );

  const handleResetLayout = useCallback(async () => {
    const { error } = await resetLayout();
    if (error) {
      window.alert(error);
      return;
    }
    window.location.reload();
  }, []);

  const handleNodeClick = useCallback((_event: React.MouseEvent, node: Node) => {
    setSelectedPersonId(node.id);
    setPanelMode("compact");
  }, []);

  const handleNodeDoubleClick = useCallback((_event: React.MouseEvent, node: Node) => {
    setSelectedPersonId(node.id);
    setPanelMode("full");
  }, []);

  const handleClosePanel = useCallback(() => {
    setSelectedPersonId(null);
    setPanelMode(null);
  }, []);

  const handleExpandPanel = useCallback(() => {
    setPanelMode("full");
  }, []);

  const handleSelectPerson = useCallback((personId: string) => {
    setSelectedPersonId(personId);
    setPanelMode("compact");
  }, []);

  const searchResults = searchPeople(people, searchQuery);

  return (
    <div className="relative h-full w-full">
      {isAdmin && (
        <button
          onClick={handleResetLayout}
          className="absolute right-4 top-4 z-10 rounded-lg border border-line bg-surface px-3 py-2 text-sm font-medium text-foreground shadow-sm hover:bg-background focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Tilbakestill oppsett
        </button>
      )}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStop={handleNodeDragStop}
        onNodeClick={handleNodeClick}
        onNodeDoubleClick={handleNodeDoubleClick}
        nodesDraggable={canEdit}
        fitView
      >
        <Background />
        <Controls />
        <SearchBar
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          searchResults={searchResults}
          showSearchDropdown={showSearchDropdown}
          setShowSearchDropdown={setShowSearchDropdown}
          initialNodes={initialNodes}
          onSelectPerson={handleSelectPerson}
        />
      </ReactFlow>
      {selectedPersonId && panelMode && (
        <DetailPanel
          person={peopleById.get(selectedPersonId)!}
          relationships={relationships}
          peopleById={peopleById}
          mode={panelMode}
          onClose={handleClosePanel}
          onExpand={handleExpandPanel}
          onSelectPerson={handleSelectPerson}
        />
      )}
    </div>
  );
}

function SearchBar({
  searchQuery,
  setSearchQuery,
  searchResults,
  showSearchDropdown,
  setShowSearchDropdown,
  initialNodes,
  onSelectPerson,
}: {
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  searchResults: Person[];
  showSearchDropdown: boolean;
  setShowSearchDropdown: (show: boolean) => void;
  initialNodes: Node[];
  onSelectPerson: (personId: string) => void;
}) {
  const reactFlow = useReactFlow();

  const handleSelectResult = useCallback(
    async (person: Person) => {
      const node = initialNodes.find((n) => n.id === person.id);
      if (node) {
        await reactFlow.setCenter(node.position.x, node.position.y, { zoom: 1.2, duration: 500 });
      }
      onSelectPerson(person.id);
      setSearchQuery("");
      setShowSearchDropdown(false);
    },
    [initialNodes, reactFlow, onSelectPerson, setSearchQuery, setShowSearchDropdown]
  );

  return (
    <div className="absolute left-4 top-4 z-10 w-72">
      <div className="relative">
        <input
          type="text"
          placeholder="Søk etter person..."
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            setShowSearchDropdown(true);
          }}
          onFocus={() => setShowSearchDropdown(true)}
          onBlur={() => setTimeout(() => setShowSearchDropdown(false), 200)}
          className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-foreground placeholder-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        />
        {showSearchDropdown && searchQuery && searchResults.length > 0 && (
          <div className="absolute top-full mt-1 w-full rounded-lg border border-line bg-surface shadow-lg">
            {searchResults.slice(0, 10).map((person) => (
              <button
                key={person.id}
                onClick={() => handleSelectResult(person)}
                className="block w-full px-3 py-2 text-left text-sm text-foreground hover:bg-background focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                {person.given_name} {person.family_name}
                {person.birth_place && <span className="text-muted"> · {person.birth_place}</span>}
              </button>
            ))}
          </div>
        )}
        {showSearchDropdown && searchQuery && searchResults.length === 0 && (
          <div className="absolute top-full mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-muted shadow-lg">
            Ingen søkeresultater
          </div>
        )}
      </div>
    </div>
  );
}
