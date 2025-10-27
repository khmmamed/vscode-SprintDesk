import React, { useCallback, useEffect, useMemo } from 'react';
import ReactFlow, { Background, Controls, MiniMap, addEdge, updateEdge, useEdgesState, useNodesState, Connection, Edge, Handle, Position, NodeProps } from 'react-flow-renderer';

type Epic = {
  title: string;
  tasks: string[];
  color?: string;
  meta?: Record<string, string>;
  rawContent?: string;
};

type EpicsListProps = {
  epics: Epic[];
};

type EpicData = {
  title: string;
  color?: string;
  meta?: Record<string, string>;
};

const parseEpicMetadata = (raw?: string): { color?: string; meta?: Record<string, string> } => {
  if (!raw) return {};
  // remove bold markers and normalize, keep emojis for display but ignore them for key comparisons
  const text = raw.replace(/\*\*/g, '');
  const meta: Record<string, string> = {};
  let color: string | undefined;

  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    // allow optional bullet ( -, •, – ) and capture up to the first colon
    const m = line.match(/^\s*[-•–]?\s*(.+?):\s*(.+)\s*$/);
    if (!m) continue;
    const key = m[1].trim();
    const value = m[2].trim();
    meta[key] = value;

    const normalizedKey = key.toLowerCase().replace(/[^a-z]/g, '');
    if (normalizedKey === 'color') {
      const hex = value.match(/#([0-9a-f]{3,8})/i);
      if (hex) color = `#${hex[1]}`;
    }
  }

  // Fallback: search anywhere for a Color: #xxxxxx pattern
  if (!color) {
    const hex = text.match(/color[^#]*#([0-9a-f]{3,8})/i);
    if (hex) color = `#${hex[1]}`;
  }

  return { color, meta };
};

const EpicNode: React.FC<NodeProps<EpicData>> = ({ data, isConnectable }) => {
  const color = data.color ?? '#0b2cc2';
  const entries = Object.entries(data.meta ?? {}).filter(([k]) => k.toLowerCase().replace(/[^a-z]/g, '') !== 'color');
  return (
    <div style={{ minWidth: 200, background: '#fff', borderRadius: 8, border: `2px solid ${color}`, boxShadow: '0 2px 6px rgba(0,0,0,0.1)' }}>
      <div style={{ background: color, color: '#fff', padding: '6px 10px', borderTopLeftRadius: 6, borderTopRightRadius: 6, fontWeight: 600 }}>
        {data.title}
      </div>
      <div style={{ padding: '8px 10px', fontSize: 12, lineHeight: 1.5 }}>
        {entries.map(([k, v]) => {
          const nk = k.toLowerCase().replace(/[^a-z]/g, '');
          return nk === 'description' ? (
            <div key={k} style={{ marginTop: 6 }}>
              <strong>{k}:</strong>
              <div style={{ whiteSpace: 'pre-wrap' }}>{v}</div>
            </div>
          ) : (
            <div key={k}><strong>{k}:</strong> <span>{v}</span></div>
          );
        })}
      </div>
      <Handle type="target" position={Position.Left} isConnectable={isConnectable} />
      <Handle type="source" position={Position.Right} isConnectable={isConnectable} />
    </div>
  );
};

export const EpicsList: React.FC<EpicsListProps> = ({ epics }) => {
  // Create initial nodes/edges from epics; make them draggable and connections editable via state handlers
  const initialNodes = useMemo(
    () =>
      epics.map((epic, idx) => {
        const parsed = parseEpicMetadata(epic.rawContent);
        const color = epic.color ?? parsed.color;
        const meta = { ...(parsed.meta ?? {}), ...(epic.meta ?? {}) };
        return {
          id: String(idx + 1),
          type: 'epic',
          data: { title: epic.title, color, meta },
          position: { x: 100 + idx * 200, y: 100 },
        };
      }),
    [epics]
  );
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);

  const initialEdges = useMemo(
    () =>
      initialNodes.slice(0, -1).map((node, idx) => ({
        id: `e${node.id}-${initialNodes[idx + 1].id}`,
        source: node.id,
        target: initialNodes[idx + 1].id,
        animated: true,
        updatable: true,
      })),
    [initialNodes]
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const nodeTypes = useMemo(() => ({ epic: EpicNode }), []);

  useEffect(() => {
    setNodes((prev) => {
      const prevMap = new Map(prev.map((n) => [n.id, n]));
      return epics.map((epic, idx) => {
        const id = String(idx + 1);
        const existing = prevMap.get(id);
        const parsed = parseEpicMetadata(epic.rawContent);
        const color = epic.color ?? parsed.color;
        const meta = { ...(parsed.meta ?? {}), ...(epic.meta ?? {}) };
        return {
          id,
          type: 'epic',
          data: { title: epic.title, color, meta },
          position: existing?.position ?? { x: 100 + idx * 200, y: 100 },
        };
      });
    });
    setEdges((eds) => (eds.length ? eds : initialEdges));
  }, [epics, setNodes, setEdges, initialEdges]);

  const onConnect = useCallback(
    (params: Connection) =>
      setEdges((eds) => {
        const next = addEdge(params, eds);
        const i = next.length - 1;
        if (i >= 0) {
          next[i] = { ...next[i], animated: true, updatable: true } as Edge;
        }
        return next;
      }),
    [setEdges]
  );

  const onEdgeUpdate = useCallback(
    (oldEdge: Edge, newConnection: Connection) =>
      setEdges((eds) => {
        const updated = updateEdge(oldEdge, newConnection, eds);
        return updated.map((e) => ({ ...e, animated: true, updatable: true } as Edge));
      }),
    [setEdges]
  );

  return (
    <div style={{ width: '100%', height: '100vh' }}>
      <ReactFlow 
        nodes={nodes} 
        edges={edges} 
        nodeTypes={nodeTypes} 
        onNodesChange={onNodesChange} 
        onEdgesChange={onEdgesChange} 
        onConnect={onConnect} 
        onEdgeUpdate={onEdgeUpdate} 
        defaultEdgeOptions={{ animated: true }} 
        fitView
      >
        <MiniMap />
        <Controls />
        <Background />
      </ReactFlow>
    </div>
  );
};