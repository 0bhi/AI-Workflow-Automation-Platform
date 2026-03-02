"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { API_BASE_URL, buildAuthHeaders } from "@lib/api/client";

interface RunStepRow {
  id: string;
  node_id: string;
  type: string;
  status: string;
  attempt: number;
  started_at: string;
  finished_at: string | null;
  input_json: unknown;
  output_json: unknown;
  error_json: unknown;
  trace_id: string | null;
}

interface RunDetail {
  id: string;
  workflowId: string;
  workflowSlug: string;
  workflowName: string;
  status: string;
  triggerType: string;
  startedAt: string;
  finishedAt: string | null;
  traceId: string | null;
  inputPayload: unknown;
  steps: RunStepRow[];
}

async function fetchRun(id: string): Promise<RunDetail | null> {
  const headers = buildAuthHeaders();
  const res = await fetch(`${API_BASE_URL}/api/runs/${id}`, {
    cache: "no-store",
    headers
  });

  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`Failed to fetch run: ${res.status}`);
  }

  return res.json();
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      className={`h-4 w-4 text-slate-400 transition-transform duration-200 ${expanded ? "rotate-90" : ""}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  );
}

function StepPayloads({ step }: { step: RunStepRow }) {
  const [expanded, setExpanded] = useState(false);

  const hasContent = step.input_json || step.output_json || step.error_json;
  if (!hasContent) return null;

  return (
    <div className="mt-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200 transition-colors"
      >
        <ChevronIcon expanded={expanded} />
        <span>{expanded ? "Hide" : "Show"} payloads</span>
      </button>
      {expanded && (
        <div className="mt-2 space-y-2">
          {step.input_json ? (
            <div>
              <p className="text-[10px] font-semibold uppercase text-slate-500 mb-1">Input</p>
              <pre className="max-h-48 overflow-auto rounded-md bg-slate-900/80 p-2 text-[11px] text-slate-200">
                {JSON.stringify(step.input_json, null, 2)}
              </pre>
            </div>
          ) : null}
          {step.output_json ? (
            <div>
              <p className="text-[10px] font-semibold uppercase text-slate-500 mb-1">Output</p>
              <pre className="max-h-48 overflow-auto rounded-md bg-slate-900/80 p-2 text-[11px] text-slate-200">
                {JSON.stringify(step.output_json, null, 2)}
              </pre>
            </div>
          ) : null}
          {step.error_json ? (
            <div>
              <p className="text-[10px] font-semibold uppercase text-red-400 mb-1">Error</p>
              <pre className="max-h-48 overflow-auto rounded-md bg-red-950/40 p-2 text-[11px] text-red-200">
                {JSON.stringify(step.error_json, null, 2)}
              </pre>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

export default function RunDetailPage({
  params
}: {
  params: { id: string };
}) {
  const router = useRouter();
  const [run, setRun] = useState<RunDetail | null | "loading">("loading");
  const [replaying, setReplaying] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const data = await fetchRun(params.id);
        if (!cancelled) {
          setRun(data);
        }
      } catch {
        if (!cancelled) {
          setRun(null);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [params.id]);

  async function handleReplay() {
    if (!run || run === "loading" || replaying) return;
    setReplaying(true);
    try {
      const headers = buildAuthHeaders();
      const res = await fetch(
        `${API_BASE_URL}/api/workflows/${run.workflowSlug}/invoke`,
        {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify(run.inputPayload ?? {})
        }
      );
      if (!res.ok) throw new Error(`Replay failed: ${res.status}`);
      const data = await res.json();
      router.push(`/runs/${data.runId}`);
    } catch {
      setReplaying(false);
    }
  }

  if (run === "loading") {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Loading run…</h1>
        <p className="text-sm text-slate-400">
          Fetching run details for the current tenant.
        </p>
      </div>
    );
  }

  if (!run) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Run not found</h1>
        <p className="text-sm text-slate-400">
          This run does not exist for the current tenant.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {run.status === "FAILED" && (
        <div className="rounded-lg border border-red-800/60 bg-red-950/50 px-4 py-3 text-sm text-red-200">
          <span className="mr-2 font-semibold">Run failed.</span>
          {run.steps.find((s) => s.status === "FAILED")
            ? "One or more steps encountered an error — see details below."
            : "The run finished with a failure status."}
        </div>
      )}

      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">
            Run {run.id}
          </h1>
          <p className="text-sm text-slate-400">
            Workflow: {run.workflowName} · Trigger: {run.triggerType}
          </p>
          {run.traceId ? (
            <p className="text-xs text-slate-500">
              Trace: {run.traceId}
            </p>
          ) : null}
          <Link
            href={`/workflows/${run.workflowId}`}
            className="mt-1 inline-block text-xs text-blue-400 hover:text-blue-300 transition-colors"
          >
            View workflow →
          </Link>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleReplay}
            disabled={replaying}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {replaying ? (
              <span className="flex items-center gap-1.5">
                <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Replaying…
              </span>
            ) : (
              "Replay"
            )}
          </button>
          <span className="rounded-full bg-slate-800 px-3 py-1 text-xs uppercase text-slate-200">
            {run.status}
          </span>
        </div>
      </header>

      <div className="card space-y-3">
        <h2 className="text-sm font-semibold">Step timeline</h2>
        <ol className="space-y-3 text-sm">
          {run.steps.map((step) => (
            <li
              key={step.id}
              className={`flex gap-3 rounded-md border bg-slate-950/70 p-3 ${
                step.status === "FAILED"
                  ? "border-red-700/70 border-l-4 border-l-red-500"
                  : "border-border/60"
              }`}
            >
              <div
                className={`mt-1 h-2 w-2 flex-shrink-0 rounded-full ${
                  step.status === "SUCCEEDED"
                    ? "bg-emerald-500"
                    : step.status === "FAILED"
                      ? "bg-red-500"
                      : step.status === "RUNNING"
                        ? "bg-blue-500"
                        : "bg-slate-500"
                }`}
              />
              <div className="flex-1 space-y-1">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-mono text-slate-400">
                      {step.node_id} · {step.type}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      Attempt {step.attempt} · Started{" "}
                      {new Date(step.started_at).toLocaleString()}
                      {step.finished_at
                        ? ` · Finished ${new Date(step.finished_at).toLocaleString()}`
                        : ""}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] uppercase ${
                      step.status === "SUCCEEDED"
                        ? "bg-emerald-900/60 text-emerald-300"
                        : step.status === "RUNNING"
                          ? "bg-blue-900/60 text-blue-300"
                          : step.status === "FAILED"
                            ? "bg-red-900/60 text-red-300"
                            : "bg-slate-800 text-slate-300"
                    }`}
                  >
                    {step.status}
                  </span>
                </div>
                {step.status === "FAILED" && step.error_json ? (
                  <pre className="mt-1 max-h-32 overflow-auto rounded-md bg-red-950/40 p-2 text-[11px] text-red-200">
                    {JSON.stringify(step.error_json, null, 2)}
                  </pre>
                ) : null}
                <StepPayloads step={step} />
              </div>
            </li>
          ))}
          {run.steps.length === 0 ? (
            <p className="text-xs text-slate-500">
              No steps recorded yet for this run.
            </p>
          ) : null}
        </ol>
      </div>
    </div>
  );
}
