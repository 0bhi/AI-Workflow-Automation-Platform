"use client";

import { useCallback, useMemo, useState } from "react";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  Panel,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange
} from "reactflow";
import "reactflow/dist/style.css";
import { API_BASE_URL, invokeWorkflow } from "@lib/api/client";

type NodeKind = "trigger" | "agent" | "tool" | "logic";

export interface DagNode {
  id: string;
  type: string;
  label: string;
  config: Record<string, unknown>;
}

export interface DagEdge {
  id: string;
  from_: string;
  to: string;
  condition: string | null;
}

export interface DagSnapshot {
  nodes: DagNode[];
  edges: DagEdge[];
}

interface PaletteNode {
  id: string;
  type: NodeKind;
  label: string;
}

const PALETTE: PaletteNode[] = [
  { id: "trigger.email_received", type: "trigger", label: "Email received" },
  { id: "trigger.http_webhook", type: "trigger", label: "HTTP webhook" },
  { id: "agent.plan_and_execute", type: "agent", label: "Plan & execute" },
  { id: "agent.summarize", type: "agent", label: "Summarize" },
  { id: "tool.slack_send_message", type: "tool", label: "Slack send" },
  { id: "tool.http_request", type: "tool", label: "HTTP request" },
  { id: "logic.branch_if", type: "logic", label: "Branch if" }
];

function normalizeKind(type: string): NodeKind {
  if (type.startsWith("trigger")) return "trigger";
  if (type.startsWith("agent")) return "agent";
  if (type.startsWith("logic")) return "logic";
  return "tool";
}

let idCounter = 1;
function createNodeId(baseId: string) {
  const id = `${baseId}-${idCounter}`;
  idCounter += 1;
  return id;
}

function createUniqueDagId(baseId: string) {
  return `${baseId}_${idCounter}`;
}

function dagToReactFlow(initialDag?: DagSnapshot | null): {
  nodes: Node[];
  edges: Edge[];
} {
  if (!initialDag) {
    return { nodes: [], edges: [] };
  }

  const rfNodes: Node[] = [];
  const dagIdToNodeId: Record<string, string> = {};

  initialDag.nodes.forEach((n, index) => {
    const col = index % 3;
    const row = Math.floor(index / 3);
    const id = createNodeId(n.id);
    dagIdToNodeId[n.id] = id;

    rfNodes.push({
      id,
      type: "default",
      position: {
        x: col * 220,
        y: row * 140
      },
      data: {
        label: n.label,
        dagId: n.id,
        kind: normalizeKind(n.type),
        config: n.config ?? {}
      }
    });
  });

  const rfEdges: Edge[] = initialDag.edges.map((e) => ({
    id: e.id,
    source: dagIdToNodeId[e.from_] ?? e.from_,
    target: dagIdToNodeId[e.to] ?? e.to,
    data: {
      condition: e.condition ?? null
    }
  }));

  return { nodes: rfNodes, edges: rfEdges };
}

// ── Shared input class names for the dark-theme config form ──

const inputCls =
  "w-full rounded-lg border border-slate-700/60 bg-slate-800/60 px-2.5 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 focus:border-sky-500/50 focus:outline-none focus:ring-1 focus:ring-sky-500/30";
const textareaCls = `${inputCls} min-h-[64px] resize-y`;
const selectCls = `${inputCls} appearance-none`;
const readOnlyCls =
  "w-full rounded-lg border border-slate-700/30 bg-slate-900/60 px-2.5 py-1.5 text-xs text-slate-400 cursor-default";
const labelCls = "block space-y-1 text-xs";
const labelTextCls = "text-slate-400";

function ConfigField({
  label,
  children
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className={labelCls}>
      <span className={labelTextCls}>{label}</span>
      {children}
    </label>
  );
}

function AgentConfigFields({
  config,
  onChange
}: {
  config: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}) {
  return (
    <>
      <ConfigField label="Model">
        <input
          type="text"
          className={inputCls}
          placeholder="gpt-4o-mini"
          value={(config.model as string) ?? ""}
          onChange={(e) => onChange("model", e.target.value)}
        />
      </ConfigField>
      <ConfigField label="System prompt">
        <textarea
          className={textareaCls}
          placeholder="You are an AI assistant..."
          value={(config.system_prompt as string) ?? ""}
          onChange={(e) => onChange("system_prompt", e.target.value)}
        />
      </ConfigField>
      <ConfigField label="Temperature">
        <input
          type="number"
          className={inputCls}
          placeholder="0.7"
          step={0.1}
          min={0}
          max={2}
          value={(config.temperature as number) ?? ""}
          onChange={(e) =>
            onChange(
              "temperature",
              e.target.value === "" ? undefined : Number(e.target.value)
            )
          }
        />
      </ConfigField>
    </>
  );
}

function HttpRequestConfigFields({
  config,
  onChange
}: {
  config: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}) {
  return (
    <>
      <ConfigField label="URL">
        <input
          type="text"
          className={inputCls}
          placeholder="https://api.example.com/v1/resource"
          required
          value={(config.url as string) ?? ""}
          onChange={(e) => onChange("url", e.target.value)}
        />
      </ConfigField>
      <ConfigField label="Method">
        <select
          className={selectCls}
          value={(config.method as string) ?? "GET"}
          onChange={(e) => onChange("method", e.target.value)}
        >
          {["GET", "POST", "PUT", "DELETE", "PATCH"].map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </ConfigField>
      <ConfigField label="Headers (JSON)">
        <textarea
          className={textareaCls}
          placeholder='{"Authorization": "Bearer ..."}'
          value={(config.headers as string) ?? ""}
          onChange={(e) => onChange("headers", e.target.value)}
        />
      </ConfigField>
      <ConfigField label="JSON body">
        <textarea
          className={textareaCls}
          placeholder='{"key": "value"}'
          value={(config.json as string) ?? ""}
          onChange={(e) => onChange("json", e.target.value)}
        />
      </ConfigField>
    </>
  );
}

function SlackConfigFields({
  config,
  onChange
}: {
  config: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}) {
  return (
    <>
      <ConfigField label="Channel">
        <input
          type="text"
          className={inputCls}
          placeholder="#general"
          value={(config.channel as string) ?? ""}
          onChange={(e) => onChange("channel", e.target.value)}
        />
      </ConfigField>
      <ConfigField label="Message text">
        <textarea
          className={textareaCls}
          placeholder="Hello from the workflow!"
          value={(config.text as string) ?? ""}
          onChange={(e) => onChange("text", e.target.value)}
        />
      </ConfigField>
    </>
  );
}

function NodeConfigForm({
  node,
  onLabelChange,
  onConfigChange
}: {
  node: Node;
  onLabelChange: (label: string) => void;
  onConfigChange: (key: string, value: unknown) => void;
}) {
  const data = node.data as any;
  const kind: NodeKind = data.kind ?? "tool";
  const dagId: string = data.dagId ?? node.id;
  const config: Record<string, unknown> = data.config ?? {};

  const kindSpecificFields = (() => {
    switch (kind) {
      case "agent":
        return <AgentConfigFields config={config} onChange={onConfigChange} />;
      case "tool":
        if (dagId.includes("http_request")) {
          return (
            <HttpRequestConfigFields
              config={config}
              onChange={onConfigChange}
            />
          );
        }
        if (dagId.includes("slack_send_message")) {
          return (
            <SlackConfigFields config={config} onChange={onConfigChange} />
          );
        }
        return (
          <p className="text-[11px] text-slate-500">
            No additional config for this tool type.
          </p>
        );
      case "trigger":
        return (
          <div className="rounded-lg border border-sky-500/20 bg-sky-950/30 px-2.5 py-2 text-[11px] text-sky-300/80">
            Trigger configuration is set via webhook URLs or integrations.
          </div>
        );
      case "logic":
        return (
          <p className="text-[11px] text-slate-500">
            Routing is configured via edge conditions. Select an edge to edit
            its condition expression.
          </p>
        );
      default:
        return null;
    }
  })();

  return (
    <div className="space-y-3 text-sm">
      <ConfigField label="Label">
        <input
          type="text"
          className={inputCls}
          value={data.label ?? ""}
          onChange={(e) => onLabelChange(e.target.value)}
        />
      </ConfigField>

      <ConfigField label="Kind">
        <input type="text" className={readOnlyCls} value={kind} readOnly />
      </ConfigField>

      <ConfigField label="DAG ID">
        <input
          type="text"
          className={`${readOnlyCls} font-mono`}
          value={dagId}
          readOnly
        />
      </ConfigField>

      <div className="border-t border-slate-800/50 pt-3">
        <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-slate-500">
          Node config
        </p>
        <div className="space-y-2.5">{kindSpecificFields}</div>
      </div>
    </div>
  );
}

interface WorkflowBuilderProps {
  workflowId: string;
  workflowSlug: string;
  initialDag?: DagSnapshot | null;
}

export function WorkflowBuilder({ workflowId, workflowSlug, initialDag }: WorkflowBuilderProps) {
  const initialState = useMemo(() => dagToReactFlow(initialDag), [initialDag]);

  const [nodes, setNodes] = useState<Node[]>(initialState.nodes);
  const [edges, setEdges] = useState<Edge[]>(initialState.edges);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(true);
  const [configOpen, setConfigOpen] = useState(true);
  const [invoking, setInvoking] = useState(false);
  const [invokeError, setInvokeError] = useState<string | null>(null);
  const [lastRunId, setLastRunId] = useState<string | null>(null);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes((nds) => applyNodeChanges(changes, nds)),
    []
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    []
  );

  const onConnect = useCallback(
    (connection: Connection) =>
      setEdges((eds) =>
        addEdge(
          {
            ...connection,
            id: `${connection.source}-${connection.target}-${eds.length + 1}`
          },
          eds
        )
      ),
    []
  );

  const handleAddNode = useCallback((paletteNode: PaletteNode) => {
    const dagId = createUniqueDagId(paletteNode.id);
    const id = createNodeId(paletteNode.id);
    const rfNode: Node = {
      id,
      type: "default",
      position: {
        x: Math.random() * 300,
        y: Math.random() * 200
      },
      data: {
        label: paletteNode.label,
        dagId,
        kind: paletteNode.type,
        config: {}
      }
    };

    setNodes((prev) => [...prev, rfNode]);
    setSelectedNodeId(id);
    setSelectedEdgeId(null);
  }, []);

  const updateSelectedNodeData = useCallback(
    (patch: Record<string, unknown>) => {
      if (!selectedNodeId) return;
      setNodes((nds) =>
        nds.map((n) =>
          n.id === selectedNodeId
            ? { ...n, data: { ...n.data, ...patch } }
            : n
        )
      );
    },
    [selectedNodeId]
  );

  const updateSelectedNodeConfig = useCallback(
    (key: string, value: unknown) => {
      if (!selectedNodeId) return;
      setNodes((nds) =>
        nds.map((n) =>
          n.id === selectedNodeId
            ? {
                ...n,
                data: {
                  ...n.data,
                  config: { ...(n.data as any).config, [key]: value }
                }
              }
            : n
        )
      );
    },
    [selectedNodeId]
  );

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId]
  );

  const selectedEdge = useMemo(
    () => edges.find((e) => e.id === selectedEdgeId) ?? null,
    [edges, selectedEdgeId]
  );

  const dagSnapshot: DagSnapshot = useMemo(() => {
    const nodeById: Record<string, Node> = {};
    nodes.forEach((n) => {
      nodeById[n.id] = n;
    });

    return {
      nodes: nodes.map((n) => ({
        id: (n.data as any).dagId ?? n.id,
        type: (n.data as any).kind ?? "tool",
        label: (n.data as any).label ?? n.id,
        config: (n.data as any).config ?? {}
      })),
      edges: edges.map((e) => {
        const sourceNode = nodeById[e.source];
        const targetNode = nodeById[e.target];
        return {
          id: e.id,
          from_: (sourceNode?.data as any)?.dagId ?? e.source,
          to: (targetNode?.data as any)?.dagId ?? e.target,
          condition: (e.data as any)?.condition ?? null
        };
      })
    };
  }, [nodes, edges]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    setSaveOk(false);

    try {
      const headers: Record<string, string> = {
        "content-type": "application/json"
      };

      if (typeof window !== "undefined") {
        const token = window.localStorage.getItem("authToken");
        const tenantId = window.localStorage.getItem("tenantId") ?? "demo-tenant";
        if (token) {
          headers.authorization = `Bearer ${token}`;
        }
        headers["x-tenant-id"] = tenantId;
      }

      const res = await fetch(`${API_BASE_URL}/api/workflows/${workflowId}/dag`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ dag: dagSnapshot })
      });

      if (!res.ok) {
        throw new Error(`Failed to save workflow DAG: ${res.status}`);
      }

      setSaveOk(true);
    } catch (err: any) {
      setSaveError(err.message ?? "Failed to save workflow");
    } finally {
      setSaving(false);
    }
  }, [dagSnapshot, workflowId]);

  const handleInvoke = useCallback(async () => {
    setInvoking(true);
    setInvokeError(null);
    setLastRunId(null);

    try {
      const result = await invokeWorkflow(workflowSlug);
      if (result && typeof result.runId === "string") {
        setLastRunId(result.runId);
      }
    } catch (err: any) {
      setInvokeError(err.message ?? "Failed to invoke workflow");
    } finally {
      setInvoking(false);
    }
  }, [workflowSlug]);

  return (
    <div className="flex h-full min-h-0 w-full flex-row">
      {/* Left: Node palette — collapsible */}
      <aside
        className={`flex shrink-0 flex-col border-r border-slate-800/50 bg-slate-950/95 transition-[width] duration-200 ${
          paletteOpen ? "w-52" : "w-11"
        }`}
      >
        <div className="flex h-11 shrink-0 items-center justify-between border-b border-slate-800/50 px-2">
          {paletteOpen && (
            <span className="truncate text-xs font-medium text-slate-300">
              Nodes
            </span>
          )}
          <button
            type="button"
            onClick={() => setPaletteOpen((o) => !o)}
            className="rounded p-1.5 text-slate-500 hover:bg-slate-800/60 hover:text-slate-300"
            aria-label={paletteOpen ? "Collapse palette" : "Expand palette"}
          >
            <svg
              className={`h-4 w-4 ${paletteOpen ? "" : "rotate-180"}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M11 19l-7-7 7-7m8 14l-7-7 7-7"
              />
            </svg>
          </button>
        </div>
        {paletteOpen && (
          <div className="flex-1 space-y-1 overflow-y-auto p-2">
            <p className="px-1 text-[11px] text-slate-500">
              Click to add to canvas
            </p>
            {PALETTE.map((node) => (
              <button
                key={node.id}
                type="button"
                onClick={() => handleAddNode(node)}
                className="flex w-full items-center justify-between rounded-lg border border-slate-700/60 bg-slate-800/40 px-2.5 py-2 text-left text-xs transition-colors hover:border-sky-500/50 hover:bg-slate-800/80"
              >
                <span className="truncate text-slate-200">{node.label}</span>
                <span className="shrink-0 font-mono text-[10px] text-slate-500">
                  {node.type}
                </span>
              </button>
            ))}
          </div>
        )}
      </aside>

      {/* Center: Canvas — takes all remaining space */}
      <section className="relative flex min-w-0 flex-1 flex-col">
        <div className="absolute inset-0 rounded-none">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            fitView
            onNodeClick={(_, node) => {
              setSelectedNodeId(node.id);
              setSelectedEdgeId(null);
            }}
            onEdgeClick={(_, edge) => {
              setSelectedEdgeId(edge.id);
              setSelectedNodeId(null);
            }}
            className="h-full w-full bg-slate-950"
          >
            <Background
              gap={20}
              size={1}
              color="rgba(71, 85, 105, 0.35)"
              className="bg-slate-950"
            />
            <MiniMap
              zoomable
              pannable
              className="!bg-slate-900/90 !rounded-lg border border-slate-700/50"
              nodeColor="#0f172a"
              maskColor="rgba(15, 23, 42, 0.7)"
            />
            <Controls
              className="!bg-slate-900/95 !border-slate-700/50 !rounded-lg [&>button]:!bg-slate-800/80 [&>button]:!border-slate-600/50 [&>button]:!text-slate-300 [&>button:hover]:!bg-slate-700/80"
              showInteractive={false}
            />
            <Panel position="top-right" className="m-3 flex items-center gap-2">
              {saveError && (
                <span className="text-[11px] text-red-400">{saveError}</span>
              )}
              {invokeError && !saveError && (
                <span className="text-[11px] text-red-400">{invokeError}</span>
              )}
              {saveOk && !invokeError && (
                <span className="text-[11px] text-emerald-400">Saved</span>
              )}
              {lastRunId && !invokeError && (
                <span className="text-[11px] text-sky-300">
                  Run queued: {lastRunId}
                </span>
              )}
              <button
                type="button"
                onClick={handleInvoke}
                className="rounded-lg border border-slate-600/60 bg-slate-800/90 px-3 py-1.5 text-xs font-medium text-slate-200 shadow-lg backdrop-blur-sm transition-colors hover:border-sky-500/50 hover:bg-slate-700/90 disabled:opacity-50"
                disabled={invoking}
              >
                {invoking ? "Running…" : "Run workflow"}
              </button>
              <button
                type="button"
                onClick={handleSave}
                className="rounded-lg border border-slate-600/60 bg-slate-800/90 px-3 py-1.5 text-xs font-medium text-slate-200 shadow-lg backdrop-blur-sm transition-colors hover:border-sky-500/50 hover:bg-slate-700/90 disabled:opacity-50"
                disabled={saving}
              >
                {saving ? "Saving…" : "Save version"}
              </button>
            </Panel>
          </ReactFlow>
        </div>
      </section>

      {/* Right: Selection config — collapsible */}
      <aside
        className={`flex shrink-0 flex-col border-l border-slate-800/50 bg-slate-950/95 transition-[width] duration-200 ${
          configOpen ? "w-72" : "w-11"
        }`}
      >
        <div className="flex h-11 shrink-0 items-center justify-between border-b border-slate-800/50 px-2">
          {configOpen && (
            <span className="truncate text-xs font-medium text-slate-300">
              Config
            </span>
          )}
          <button
            type="button"
            onClick={() => setConfigOpen((o) => !o)}
            className="rounded p-1.5 text-slate-500 hover:bg-slate-800/60 hover:text-slate-300"
            aria-label={configOpen ? "Collapse config" : "Expand config"}
          >
            <svg
              className={`h-4 w-4 ${configOpen ? "rotate-180" : ""}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 5l7 7-7 7M5 5l7 7-7 7"
              />
            </svg>
          </button>
        </div>
        {configOpen && (
          <div className="flex-1 overflow-y-auto p-3">
            {selectedNode ? (
              <NodeConfigForm
                node={selectedNode}
                onLabelChange={(label) => updateSelectedNodeData({ label })}
                onConfigChange={updateSelectedNodeConfig}
              />
            ) : selectedEdge ? (
              <div className="space-y-3 text-sm">
                <p className="font-medium text-slate-200">Edge</p>
                <p className="font-mono text-[11px] text-slate-500">
                  {selectedEdge.source} → {selectedEdge.target}
                </p>
                <label className="block space-y-1.5 text-xs">
                  <span className="text-slate-400">Condition expression</span>
                  <input
                    type="text"
                    className="w-full rounded-lg border border-slate-700/60 bg-slate-800/60 px-2.5 py-1.5 text-slate-200 placeholder:text-slate-500 focus:border-sky-500/50 focus:outline-none focus:ring-1 focus:ring-sky-500/30"
                    placeholder="e.g. output.score > 0.8"
                    value={(selectedEdge.data as any)?.condition ?? ""}
                    onChange={(e) => {
                      const value = e.target.value;
                      setEdges((current) =>
                        current.map((edge) =>
                          edge.id === selectedEdge.id
                            ? {
                                ...edge,
                                data: {
                                  ...(edge.data ?? {}),
                                  condition: value || null
                                }
                              }
                            : edge
                        )
                      );
                    }}
                  />
                  <p className="text-[11px] text-slate-500">
                    Boolean over <code className="rounded bg-slate-800 px-0.5">ctx</code> and{" "}
                    <code className="rounded bg-slate-800 px-0.5">output</code>.
                  </p>
                </label>
              </div>
            ) : (
              <p className="text-xs text-slate-500">
                Select a node or edge on the canvas to view and edit its
                configuration.
              </p>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}


