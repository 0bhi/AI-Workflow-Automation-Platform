"use client";

import { useEffect, useMemo, useState } from "react";
import {
  API_BASE_URL,
  buildAuthHeaders,
  createSchedule,
  deleteSchedule,
  listSchedules,
  type WorkflowSchedule,
  type WorkflowSummary,
  updateSchedule
} from "@lib/api/client";

async function fetchWorkflows(): Promise<WorkflowSummary[]> {
  const res = await fetch(`${API_BASE_URL}/api/workflows`, {
    cache: "no-store",
    headers: buildAuthHeaders()
  });

  if (!res.ok) {
    throw new Error(`Failed to load workflows: ${res.status}`);
  }

  return res.json();
}

export default function SchedulesPage() {
  const [schedules, setSchedules] = useState<WorkflowSchedule[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [createWorkflowId, setCreateWorkflowId] = useState<string>("");
  const [createCron, setCreateCron] = useState<string>("*/5 * * * *");
  const [createTimezone, setCreateTimezone] = useState<string>("UTC");
  const [createPayload, setCreatePayload] = useState<string>("{}");
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [wf, sched] = await Promise.all([
          fetchWorkflows(),
          listSchedules()
        ]);
        if (!cancelled) {
          setWorkflows(wf);
          setSchedules(sched);
          if (wf.length > 0 && !createWorkflowId) {
            setCreateWorkflowId(wf[0].id);
          }
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err.message ?? "Failed to load schedules");
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
  }, [createWorkflowId]);

  const workflowNameById = useMemo(() => {
    const map = new Map<string, string>();
    workflows.forEach((wf) => {
      map.set(wf.id, wf.name);
    });
    return map;
  }, [workflows]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!createWorkflowId) return;

    setCreating(true);
    setCreateError(null);

    try {
      let payload: unknown = {};
      if (createPayload.trim()) {
        try {
          payload = JSON.parse(createPayload);
        } catch {
          throw new Error("Input payload must be valid JSON");
        }
      }

      const sched = await createSchedule({
        workflowId: createWorkflowId,
        cronExpression: createCron,
        timezone: createTimezone,
        inputPayloadJson: payload
      });
      setSchedules((prev) => [sched, ...prev]);
    } catch (err: any) {
      setCreateError(err.message ?? "Failed to create schedule");
    } finally {
      setCreating(false);
    }
  }

  async function handleToggleEnabled(sched: WorkflowSchedule) {
    try {
      const updated = await updateSchedule(sched.id, {
        enabled: !sched.enabled
      });
      setSchedules((prev) =>
        prev.map((s) => (s.id === updated.id ? updated : s))
      );
    } catch {
      // eslint-disable-next-line no-console
      console.error("Failed to toggle schedule");
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Delete this schedule?")) return;
    try {
      await deleteSchedule(id);
      setSchedules((prev) => prev.filter((s) => s.id !== id));
    } catch {
      // eslint-disable-next-line no-console
      console.error("Failed to delete schedule");
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Schedules</h1>
        <p className="text-sm text-slate-400">
          Loading workflow schedules for this tenant…
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Schedules</h1>
        <p className="text-sm text-red-400">
          Failed to load schedules: {error}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Schedules</h1>
        <p className="text-sm text-slate-400">
          Create cron-based schedules that enqueue workflow runs on an interval.
        </p>
      </header>

      <section className="card space-y-4">
        <h2 className="text-sm font-semibold">New schedule</h2>
        {workflows.length === 0 ? (
          <p className="text-xs text-slate-500">
            You need at least one workflow before you can create a schedule.
          </p>
        ) : (
          <form className="grid gap-3 md:grid-cols-2" onSubmit={handleCreate}>
            <div className="space-y-1 text-xs md:col-span-1">
              <label className="block text-slate-300">
                Workflow
                <select
                  className="mt-1 w-full rounded-md border border-border bg-slate-900/60 px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                  value={createWorkflowId}
                  onChange={(e) => setCreateWorkflowId(e.target.value)}
                >
                  {workflows.map((wf) => (
                    <option key={wf.id} value={wf.id}>
                      {wf.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="space-y-1 text-xs md:col-span-1">
              <label className="block text-slate-300">
                Cron expression
                <input
                  className="mt-1 w-full rounded-md border border-border bg-slate-900/60 px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                  value={createCron}
                  onChange={(e) => setCreateCron(e.target.value)}
                  placeholder="*/5 * * * *"
                  required
                />
              </label>
              <p className="mt-1 text-[11px] text-slate-500">
                Standard 5-field cron: minute hour day-of-month month day-of-week
                (e.g. <code className="rounded bg-slate-800 px-1">0 * * * *</code> for hourly).
              </p>
            </div>
            <div className="space-y-1 text-xs md:col-span-1">
              <label className="block text-slate-300">
                Timezone label
                <input
                  className="mt-1 w-full rounded-md border border-border bg-slate-900/60 px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                  value={createTimezone}
                  onChange={(e) => setCreateTimezone(e.target.value)}
                  placeholder="UTC"
                />
              </label>
              <p className="mt-1 text-[11px] text-slate-500">
                Stored with the schedule for display; the demo cron evaluator runs in UTC.
              </p>
            </div>
            <div className="space-y-1 text-xs md:col-span-1">
              <label className="block text-slate-300">
                Input payload (JSON)
                <textarea
                  className="mt-1 w-full rounded-md border border-border bg-slate-900/60 px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                  rows={3}
                  value={createPayload}
                  onChange={(e) => setCreatePayload(e.target.value)}
                />
              </label>
            </div>
            {createError ? (
              <p className="text-xs text-red-400 md:col-span-2">{createError}</p>
            ) : null}
            <div className="flex items-center gap-2 md:col-span-2">
              <button
                type="submit"
                className="btn-primary text-xs disabled:opacity-60"
                disabled={creating}
              >
                {creating ? "Creating…" : "Create schedule"}
              </button>
            </div>
          </form>
        )}
      </section>

      <section className="card space-y-3">
        <header className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Existing schedules</h2>
          <p className="text-xs text-slate-500">
            Toggle, edit via API, or delete schedules as needed.
          </p>
        </header>
        {schedules.length === 0 ? (
          <p className="text-xs text-slate-500">
            No schedules defined yet for this tenant.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead className="bg-slate-900/70 text-[11px] uppercase text-slate-400">
                <tr>
                  <th className="px-3 py-2 text-left">Workflow</th>
                  <th className="px-3 py-2 text-left">Cron</th>
                  <th className="px-3 py-2 text-left">Timezone</th>
                  <th className="px-3 py-2 text-left">Last run</th>
                  <th className="px-3 py-2 text-left">Next run</th>
                  <th className="px-3 py-2 text-left">Enabled</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {schedules.map((sched) => (
                  <tr
                    key={sched.id}
                    className="border-t border-border/60 bg-slate-950/60"
                  >
                    <td className="px-3 py-2 align-top">
                      <div className="flex flex-col">
                        <span className="text-slate-100">
                          {workflowNameById.get(sched.workflowId) ??
                            sched.workflowId}
                        </span>
                        <span className="text-[10px] font-mono text-slate-500">
                          {sched.id}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2 align-top font-mono text-[11px] text-slate-200">
                      {sched.cronExpression}
                    </td>
                    <td className="px-3 py-2 align-top text-slate-300">
                      {sched.timezone}
                    </td>
                    <td className="px-3 py-2 align-top text-slate-400">
                      {sched.lastRunAt
                        ? new Date(sched.lastRunAt).toLocaleString()
                        : "—"}
                    </td>
                    <td className="px-3 py-2 align-top text-slate-400">
                      {sched.nextRunAt
                        ? new Date(sched.nextRunAt).toLocaleString()
                        : "—"}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <button
                        type="button"
                        onClick={() => void handleToggleEnabled(sched)}
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          sched.enabled
                            ? "bg-emerald-900/60 text-emerald-300"
                            : "bg-slate-800 text-slate-300"
                        }`}
                      >
                        {sched.enabled ? "Enabled" : "Disabled"}
                      </button>
                    </td>
                    <td className="px-3 py-2 align-top text-right">
                      <button
                        type="button"
                        onClick={() => void handleDelete(sched.id)}
                        className="text-[11px] text-slate-400 hover:text-red-400"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

