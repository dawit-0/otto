import { useCallback, useEffect, useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  BackgroundVariant,
  Handle,
  Position,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from 'dagre';
import type { TableInfo } from '../api';

interface Props {
  tables: TableInfo[];
  onSelectTable: (name: string) => void;
  selectedTable: string | null;
}

function TableNode({ data }: { data: { table: TableInfo; selected: boolean; onSelect: () => void } }) {
  const { table, selected, onSelect } = data;
  return (
    <div className={`table-node${selected ? ' selected' : ''}`} onClick={onSelect}>
      <Handle type="target" position={Position.Top} style={{ background: '#6366f1', width: 8, height: 8 }} />
      <div className="table-node-header">
        <span className="table-node-title">{table.name}</span>
        <span className="table-node-count">{table.row_count.toLocaleString()} rows</span>
      </div>
      <div className="table-node-columns">
        {table.columns.map((col) => {
          const isPk = col.pk;
          const isFk = table.foreign_keys.some((fk) => fk.from_column === col.name);
          return (
            <div key={col.name} className="table-node-column">
              <span className={`col-icon${isPk ? ' pk' : isFk ? ' fk' : ''}`}>
                {isPk ? '🔑' : isFk ? '→' : '·'}
              </span>
              <span className="col-name">{col.name}</span>
              <span className="col-type">{col.type || 'any'}</span>
            </div>
          );
        })}
      </div>
      <Handle type="source" position={Position.Bottom} style={{ background: '#6366f1', width: 8, height: 8 }} />
    </div>
  );
}

const nodeTypes = { tableNode: TableNode };

function layoutGraph(tables: TableInfo[], onSelectTable: (name: string) => void, selectedTable: string | null) {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'TB', nodesep: 80, ranksep: 100, marginx: 40, marginy: 40 });

  const nodeWidth = 260;

  tables.forEach((table) => {
    const nodeHeight = 44 + Math.min(table.columns.length, 10) * 24;
    g.setNode(table.name, { width: nodeWidth, height: nodeHeight });
  });

  const edges: Edge[] = [];
  tables.forEach((table) => {
    table.foreign_keys.forEach((fk) => {
      g.setEdge(table.name, fk.to_table);
      edges.push({
        id: `${table.name}.${fk.from_column}->${fk.to_table}.${fk.to_column}`,
        source: table.name,
        target: fk.to_table,
        label: `${fk.from_column} → ${fk.to_column}`,
        style: { stroke: '#6366f1', strokeWidth: 1.5 },
        labelStyle: { fill: '#a1a1aa', fontSize: 10 },
        labelBgStyle: { fill: '#18181b', fillOpacity: 0.9 },
        animated: true,
      });
    });
  });

  dagre.layout(g);

  const nodes: Node[] = tables.map((table) => {
    const pos = g.node(table.name);
    return {
      id: table.name,
      type: 'tableNode',
      position: { x: pos.x - nodeWidth / 2, y: pos.y - pos.height / 2 },
      data: {
        table,
        selected: selectedTable === table.name,
        onSelect: () => onSelectTable(table.name),
      },
    };
  });

  return { nodes, edges };
}

export default function SchemaGraph({ tables, onSelectTable, selectedTable }: Props) {
  const { nodes: layoutNodes, edges: layoutEdges } = useMemo(
    () => layoutGraph(tables, onSelectTable, selectedTable),
    [tables, onSelectTable, selectedTable]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(layoutNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layoutEdges);

  useEffect(() => {
    setNodes(layoutNodes);
    setEdges(layoutEdges);
  }, [layoutNodes, layoutEdges, setNodes, setEdges]);

  return (
    <div className="schema-graph">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
        minZoom={0.2}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#27272a" />
        <Controls />
        <MiniMap
          nodeColor="#27272a"
          maskColor="rgba(0,0,0,0.7)"
          style={{ background: '#18181b' }}
        />
      </ReactFlow>
    </div>
  );
}
