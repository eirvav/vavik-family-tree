"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { ReactFlow, Background, Controls, MarkerType, useNodesState, useEdgesState, useReactFlow } from "@xyflow/react";
import type { Edge, Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { PersonNode } from "./person-node";
import { DetailPanel } from "./detail-panel";
import { ActionBar } from "./action-bar";
import { AddRelationshipDialog } from "./add-relationship-dialog";
import { DeletePersonDialog } from "./delete-person-dialog";
import { computeDagreLayout } from "@/lib/family-tree/layout";
import { searchPeople } from "@/lib/family-tree/search";
import type { Person, Relationship } from "@/lib/family-tree/data";

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

function buildNodes(people: Person[], dagreLayout: Map<string, { x: number; y: number }>) {
  return people.map((person) => ({
    id: person.id,
    type: "person",
    position: dagreLayout.get(person.id) ?? { x: 0, y: 0 },
    data: { person },
  }));
}

function buildEdges(relationships: Relationship[]) {
  return relationships.map((rel) => {
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
}

export function FamilyTreeCanvas({
  people,
  relationships,
  canEdit,
  isAdmin,
  orientation,
}: {
  people: Person[];
  relationships: Relationship[];
  canEdit: boolean;
  isAdmin: boolean;
  orientation: "tb" | "lr";
}) {
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearchDropdown, setShowSearchDropdown] = useState(false);
  const [activeDialog, setActiveDialog] = useState<
    | { type: "add"; kind: "father" | "mother" | "sibling" | "partner" | "child" }
    | { type: "delete" }
    | null
  >(null);

  const peopleById = new Map(people.map((p) => [p.id, p]));
  const selectedPerson = selectedPersonId ? peopleById.get(selectedPersonId) : undefined;
  const dagreLayout = computeDagreLayout(people, relationships, orientation);

  const initialNodes = buildNodes(people, dagreLayout);
  const initialEdges = buildEdges(relationships);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initialEdges);

  const handleNodeClick = useCallback((_event: React.MouseEvent, node: Node) => {
    setSelectedPersonId(node.id);
  }, []);

  const handleClosePanel = useCallback(() => {
    setSelectedPersonId(null);
  }, []);

  const handleSelectPerson = useCallback((personId: string) => {
    setSelectedPersonId(personId);
  }, []);

  const searchResults = searchPeople(people, searchQuery);

  return (
    <div className="relative h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        nodesDraggable={false}
        fitView
      >
        <Background />
        <Controls />
        <OrientationEffectHandler
          people={people}
          relationships={relationships}
          orientation={orientation}
          dagreLayout={dagreLayout}
          setNodes={setNodes}
          setEdges={setEdges}
        />
        <SearchBar
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          searchResults={searchResults}
          showSearchDropdown={showSearchDropdown}
          setShowSearchDropdown={setShowSearchDropdown}
          nodes={nodes}
          onSelectPerson={handleSelectPerson}
        />
      </ReactFlow>
      {selectedPerson && (
        <DetailPanel
          person={selectedPerson}
          relationships={relationships}
          peopleById={peopleById}
          canEdit={canEdit}
          isAdmin={isAdmin}
          onClose={handleClosePanel}
          onSelectPerson={handleSelectPerson}
        />
      )}
      {isAdmin && selectedPerson && (
        <ActionBar
          selectedPerson={selectedPerson}
          relationships={relationships}
          onAdd={(kind) => setActiveDialog({ type: "add", kind })}
          onDelete={() => setActiveDialog({ type: "delete" })}
        />
      )}
      {activeDialog?.type === "add" && selectedPerson && (
        <AddRelationshipDialog
          key={activeDialog.kind}
          kind={activeDialog.kind}
          selectedPerson={selectedPerson}
          onClose={() => setActiveDialog(null)}
          onCreated={(newPersonId) => {
            setActiveDialog(null);
            setSelectedPersonId(newPersonId);
          }}
        />
      )}
      {activeDialog?.type === "delete" && selectedPerson && (
        <DeletePersonDialog
          person={selectedPerson}
          onClose={() => setActiveDialog(null)}
          onDeleted={() => {
            setActiveDialog(null);
            setSelectedPersonId(null);
          }}
        />
      )}
    </div>
  );
}

function OrientationEffectHandler({
  people,
  relationships,
  orientation,
  dagreLayout,
  setNodes,
  setEdges,
}: {
  people: Person[];
  relationships: Relationship[];
  orientation: "tb" | "lr";
  dagreLayout: Map<string, { x: number; y: number }>;
  setNodes: Dispatch<SetStateAction<Node[]>>;
  setEdges: Dispatch<SetStateAction<Edge[]>>;
}) {
  const reactFlow = useReactFlow();
  const previousOrientation = useRef(orientation);

  useEffect(() => {
    setNodes(buildNodes(people, dagreLayout));
    setEdges(buildEdges(relationships) as Edge[]);
    // Only re-fit the camera when orientation itself changed — an ordinary
    // data refresh (add/edit/delete a person) must not reset the admin's
    // pan/zoom, only actually re-laying the tree out top-to-bottom vs.
    // left-to-right should.
    if (previousOrientation.current !== orientation) {
      void reactFlow.fitView({ duration: 500 });
      previousOrientation.current = orientation;
    }
    // Depends on the `people`/`relationships` PROPS (not `dagreLayout`,
    // which is recomputed fresh every render and would make this loop) —
    // their reference only changes when the server data actually changes
    // (via router.refresh()), or when the user toggles orientation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orientation, people, relationships]);

  return null;
}

function SearchBar({
  searchQuery,
  setSearchQuery,
  searchResults,
  showSearchDropdown,
  setShowSearchDropdown,
  nodes,
  onSelectPerson,
}: {
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  searchResults: Person[];
  showSearchDropdown: boolean;
  setShowSearchDropdown: (show: boolean) => void;
  nodes: Node[];
  onSelectPerson: (personId: string) => void;
}) {
  const reactFlow = useReactFlow();

  const handleSelectResult = useCallback(
    (person: Person) => {
      const node = nodes.find((n) => n.id === person.id);
      if (node) {
        // Not awaited: panning is a purely cosmetic animation, and nothing
        // below depends on it finishing (opening the detail panel and
        // clearing the search box should happen immediately on selection).
        void reactFlow.setCenter(node.position.x, node.position.y, { zoom: 1.2, duration: 500 });
      }
      onSelectPerson(person.id);
      setSearchQuery("");
      setShowSearchDropdown(false);
    },
    [nodes, reactFlow, onSelectPerson, setSearchQuery, setShowSearchDropdown]
  );

  return (
    <div className="absolute left-4 top-4 z-10 w-72">
      <div className="relative">
        <svg
          width="14"
          height="14"
          viewBox="0 0 20 20"
          fill="none"
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
        >
          <circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M16 16L12.8 12.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <label htmlFor="tre-sok" className="sr-only">
          Søk etter person i familietreet
        </label>
        <input
          id="tre-sok"
          type="text"
          placeholder="Søk etter navn eller sted"
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            setShowSearchDropdown(true);
          }}
          onFocus={() => setShowSearchDropdown(true)}
          onBlur={() => setTimeout(() => setShowSearchDropdown(false), 200)}
          className="w-full rounded-lg border border-line bg-surface py-2 pl-8 pr-3 text-sm text-foreground shadow-sm placeholder:text-muted/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        />
        {showSearchDropdown && searchQuery && searchResults.length > 0 && (
          <div className="absolute top-full mt-1.5 w-full overflow-hidden rounded-lg border border-line bg-surface shadow-lg">
            {searchResults.slice(0, 10).map((person) => (
              <button
                key={person.id}
                onClick={() => handleSelectResult(person)}
                className="block w-full border-b border-line px-3.5 py-2 text-left last:border-b-0 hover:bg-background focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                <span className="font-serif text-sm text-foreground">
                  {person.given_name} {person.family_name}
                </span>
                {person.birth_place && <span className="ml-1.5 text-xs text-muted">{person.birth_place}</span>}
              </button>
            ))}
          </div>
        )}
        {showSearchDropdown && searchQuery && searchResults.length === 0 && (
          <div className="absolute top-full mt-1.5 w-full rounded-lg border border-line bg-surface px-3.5 py-2.5 text-sm text-muted shadow-lg">
            Ingen treff
          </div>
        )}
      </div>
    </div>
  );
}
