"use client";

import { useEffect, useState } from "react";
import { getTenantUsage, type TenantUsage } from "@lib/api/client";

export default function UsagePage() {
  const [usage, setUsage] = useState<TenantUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const data = await getTenantUsage();
        if (!cancelled) {
          setUsage(data);
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err.message ?? "Failed to load usage");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Usage & quotas</h1>
        <p className="text-sm text-slate-400">
          Loading current month usage for this tenant…
        </p>
      </div>
    );
  }

  if (!usage) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Usage & quotas</h1>
        <p className="text-sm text-slate-400">
          {error
            ? `Failed to load usage: ${error}`
            : "No usage records found for this tenant yet."}
        </p>
      </div>
    );
  }

  const {
    totalRuns,
    totalSteps,
    totalToolCalls,
    totalLlmCalls,
    totalLlmTokens
  } = usage;

  const values = [
    { label: "Runs", value: totalRuns },
    { label: "Steps", value: totalSteps },
    { label: "Tool calls", value: totalToolCalls },
    { label: "LLM calls", value: totalLlmCalls }
  ];

  const maxValue = Math.max(...values.map((v) => v.value), 1);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Usage & quotas</h1>
        <p className="text-sm text-slate-400">
          Current month usage for tenant <span className="font-mono">{usage.tenantId}</span>{" "}
          ({usage.period}). Monthly run quota is enforced before a run is queued.
        </p>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="card space-y-2">
          <p className="text-xs uppercase text-slate-500">Runs</p>
          <p className="text-2xl font-semibold">{totalRuns}</p>
          <p className="text-xs text-slate-500">
            Total workflow runs started during {usage.period}.
          </p>
        </div>
        <div className="card space-y-2">
          <p className="text-xs uppercase text-slate-500">Steps</p>
          <p className="text-2xl font-semibold">{totalSteps}</p>
          <p className="text-xs text-slate-500">
            Individual node executions across all runs.
          </p>
        </div>
        <div className="card space-y-2">
          <p className="text-xs uppercase text-slate-500">Tool calls</p>
          <p className="text-2xl font-semibold">{totalToolCalls}</p>
          <p className="text-xs text-slate-500">
            Deterministic tool executions (HTTP, Slack, storage).
          </p>
        </div>
        <div className="card space-y-2">
          <p className="text-xs uppercase text-slate-500">LLM calls</p>
          <p className="text-2xl font-semibold">{totalLlmCalls}</p>
          <p className="text-xs text-slate-500">
            Agent loop calls to the LLM (chat completions).
          </p>
        </div>
        <div className="card space-y-2">
          <p className="text-xs uppercase text-slate-500">LLM tokens (approx)</p>
          <p className="text-2xl font-semibold">{totalLlmTokens}</p>
          <p className="text-xs text-slate-500">
            Token usage reported by agent completions (Ollama).
          </p>
        </div>
      </section>

      <section className="card space-y-4">
        <header>
          <h2 className="text-sm font-semibold">Usage breakdown</h2>
          <p className="text-xs text-slate-500">
            Simple bar chart comparing core metrics for the current period.
          </p>
        </header>
        <div className="space-y-3">
          {values.map((item) => (
            <div key={item.label} className="space-y-1">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>{item.label}</span>
                <span className="font-mono text-slate-300">{item.value}</span>
              </div>
              <div className="h-2 w-full rounded-full bg-slate-900/80">
                <div
                  className="h-2 rounded-full bg-sky-500"
                  style={{
                    width: `${Math.max(4, (item.value / maxValue) * 100)}%`
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

