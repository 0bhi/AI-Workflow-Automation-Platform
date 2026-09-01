"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { listRuns, type RunSummary } from "@lib/api/client";

export default function RunsPage() {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchRuns() {
      try {
        const data = await listRuns();
        if (!cancelled) {
          setRuns(data);
          setError(null);
        }
      } catch (err: any) {
        if (!cancelled) {
          setRuns([]);
          setError(err.message ?? "Failed to load runs");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void fetchRuns();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto">
      <div className="space-y-6">
        <header>
          <h1 className="text-2xl font-semibold">Runs</h1>
          <p className="text-sm text-slate-400">
            Inspect workflow runs, statuses, and step details.
          </p>
        </header>
        <div className="card overflow-hidden">
          {loading ? (
            <p className="px-4 py-6 text-sm text-slate-400">Loading runs…</p>
          ) : error ? (
            <p className="px-4 py-6 text-sm text-red-400">{error}</p>
          ) : runs.length === 0 ? (
            <p className="px-4 py-6 text-sm text-slate-400">
              No runs yet. Invoke a workflow from the builder or POST to its webhook URL.
            </p>
          ) : (
            <table className="min-w-full text-sm">
              <thead className="bg-slate-900/60 text-xs uppercase text-slate-400">
                <tr>
                  <th className="px-4 py-2 text-left">Run ID</th>
                  <th className="px-4 py-2 text-left">Workflow</th>
                  <th className="px-4 py-2 text-left">Status</th>
                  <th className="px-4 py-2 text-left">Trigger</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id} className="border-t border-border/60">
                    <td className="px-4 py-2 font-mono text-xs text-slate-300">
                      <Link
                        href={`/runs/${run.id}`}
                        className="text-primary hover:underline"
                      >
                        {run.id}
                      </Link>
                    </td>
                    <td className="px-4 py-2">{run.workflowName}</td>
                    <td className="px-4 py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${
                          run.status === "SUCCEEDED"
                            ? "bg-emerald-900/60 text-emerald-300"
                            : run.status === "RUNNING"
                              ? "bg-blue-900/60 text-blue-300"
                              : run.status === "FAILED"
                                ? "bg-red-900/60 text-red-300"
                                : "bg-slate-800 text-slate-300"
                        }`}
                      >
                        {run.status}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-slate-400">
                      {run.triggeredBy}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
