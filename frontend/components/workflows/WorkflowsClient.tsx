"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  API_BASE_URL,
  buildAuthHeaders,
  importStarterWorkflows,
  listTemplates,
  importTemplates,
  type WorkflowTemplate,
} from "@lib/api/client";

export interface WorkflowListItem {
  id: string;
  name: string;
  slug: string;
  description?: string;
  status: "draft" | "active" | "archived";
}

interface Props {
  initialWorkflows: WorkflowListItem[];
}

export function WorkflowsClient({ initialWorkflows }: Props) {
  const [workflows, setWorkflows] = useState<WorkflowListItem[]>(initialWorkflows);
  const [showNew, setShowNew] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<WorkflowListItem | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editStatus, setEditStatus] =
    useState<WorkflowListItem["status"]>("draft");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<Set<string>>(
    new Set()
  );
  const [loadingTemplates, setLoadingTemplates] = useState(false);

  useEffect(() => {
    async function refreshFromTenant() {
      try {
        const res = await fetch(`${API_BASE_URL}/api/workflows`, {
          cache: "no-store",
          headers: buildAuthHeaders()
        });
        if (!res.ok) {
          throw new Error(`Failed to load workflows: ${res.status}`);
        }
        const data = (await res.json()) as WorkflowListItem[];
        setWorkflows(data);
      } catch (err) {
        // non-fatal: keep whatever initialWorkflows we had
        // eslint-disable-next-line no-console
        console.error(err);
      }
    }

    // Always re-fetch on client so tenant comes from auth token/localStorage
    void refreshFromTenant();
  }, []);

  useEffect(() => {
    if (workflows.length === 0 && templates.length === 0 && !loadingTemplates) {
      setLoadingTemplates(true);
      listTemplates()
        .then((tpls) => {
          setTemplates(tpls);
          setSelectedTemplateIds(new Set(tpls.map((t) => t.id)));
        })
        .catch(() => {})
        .finally(() => setLoadingTemplates(false));
    }
  }, [workflows.length]);

  function toggleTemplate(id: string) {
    setSelectedTemplateIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleImportSelected() {
    setImporting(true);
    setImportError(null);

    try {
      const ids = Array.from(selectedTemplateIds);
      const data = await importTemplates(ids.length > 0 ? ids : undefined);
      setWorkflows(data);
      setShowNew(false);
    } catch (err: any) {
      setImportError(err.message ?? "Failed to import templates");
    } finally {
      setImporting(false);
    }
  }

  async function handleImportStarters() {
    setImporting(true);
    setImportError(null);

    try {
      const data = await importStarterWorkflows();
      setWorkflows(data);
      setShowNew(false);
    } catch (err: any) {
      setImportError(err.message ?? "Failed to import starter workflows");
    } finally {
      setImporting(false);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const headers = {
        "content-type": "application/json",
        ...buildAuthHeaders()
      };

      const res = await fetch(`${API_BASE_URL}/api/workflows`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          name,
          slug: slug || name.toLowerCase().replace(/\s+/g, "-"),
          description: description || undefined
        })
      });

      if (!res.ok) {
        throw new Error(`Failed to create workflow: ${res.status}`);
      }

      const wf = (await res.json()) as WorkflowListItem;
      setWorkflows((prev) => [wf, ...prev]);
      setShowNew(false);
      setName("");
      setSlug("");
      setDescription("");
    } catch (err: any) {
      setError(err.message ?? "Failed to create workflow");
    } finally {
      setSaving(false);
    }
  }

  async function handleArchive(id: string) {
    if (!window.confirm("Archive this workflow?")) return;
    try {
      const res = await fetch(`${API_BASE_URL}/api/workflows/${id}`, {
        method: "DELETE",
        headers: buildAuthHeaders()
      });
      if (!res.ok && res.status !== 204) {
        throw new Error(`Failed to archive workflow: ${res.status}`);
      }
      setWorkflows((prev) =>
        prev.map((wf) =>
          wf.id === id ? { ...wf, status: "archived" } : wf
        )
      );
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err);
    }
  }

  async function handleUpdate(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setSaving(true);
    setError(null);

    try {
      const headers = {
        "content-type": "application/json",
        ...buildAuthHeaders()
      };

      const res = await fetch(`${API_BASE_URL}/api/workflows/${editing.id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          name: editName,
          description: editDescription || null,
          status: editStatus
        })
      });

      if (!res.ok) {
        throw new Error(`Failed to update workflow: ${res.status}`);
      }

      const updated = (await res.json()) as WorkflowListItem;
      setWorkflows((prev) =>
        prev.map((wf) => (wf.id === updated.id ? updated : wf))
      );
      setEditing(null);
    } catch (err: any) {
      setError(err.message ?? "Failed to update workflow");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Workflows</h1>
          <p className="text-sm text-slate-400">
            Design and manage AI-powered automation workflows.
          </p>
        </div>
        <button
          className="btn-primary"
          type="button"
          onClick={() => setShowNew(true)}
        >
          New workflow
        </button>
      </header>

      {showNew ? (
        <div className="card space-y-4">
          <h2 className="text-sm font-semibold">Create workflow</h2>
          <form className="space-y-3" onSubmit={handleCreate}>
            <div className="space-y-1 text-xs">
              <label className="block text-slate-300">
                Name
                <input
                  className="mt-1 w-full rounded-md border border-border bg-slate-900/60 px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </label>
            </div>
            <div className="space-y-1 text-xs">
              <label className="block text-slate-300">
                Slug
                <input
                  className="mt-1 w-full rounded-md border border-border bg-slate-900/60 px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  placeholder="auto-generated from name if left blank"
                />
              </label>
            </div>
            <div className="space-y-1 text-xs">
              <label className="block text-slate-300">
                Description
                <textarea
                  className="mt-1 w-full rounded-md border border-border bg-slate-900/60 px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                />
              </label>
            </div>
            {error ? (
              <p className="text-xs text-red-400">{error}</p>
            ) : null}
            <div className="flex items-center gap-2">
              <button
                type="submit"
                className="btn-primary text-xs disabled:opacity-60"
                disabled={saving}
              >
                {saving ? "Creating..." : "Create"}
              </button>
              <button
                type="button"
                className="text-xs text-slate-400 hover:text-slate-200"
                onClick={() => {
                  setShowNew(false);
                  setError(null);
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {editing ? (
        <div className="card space-y-4">
          <h2 className="text-sm font-semibold">Edit workflow</h2>
          <form className="space-y-3" onSubmit={handleUpdate}>
            <div className="space-y-1 text-xs">
              <label className="block text-slate-300">
                Name
                <input
                  className="mt-1 w-full rounded-md border border-border bg-slate-900/60 px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  required
                />
              </label>
            </div>
            <div className="space-y-1 text-xs">
              <label className="block text-slate-300">
                Description
                <textarea
                  className="mt-1 w-full rounded-md border border-border bg-slate-900/60 px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  rows={2}
                />
              </label>
            </div>
            <div className="space-y-1 text-xs">
              <label className="block text-slate-300">
                Status
                <select
                  className="mt-1 w-full rounded-md border border-border bg-slate-900/60 px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                  value={editStatus}
                  onChange={(e) =>
                    setEditStatus(e.target.value as WorkflowListItem["status"])
                  }
                >
                  <option value="draft">draft</option>
                  <option value="active">active</option>
                  <option value="archived">archived</option>
                </select>
              </label>
            </div>
            {error ? (
              <p className="text-xs text-red-400">{error}</p>
            ) : null}
            <div className="flex items-center gap-2">
              <button
                type="submit"
                className="btn-primary text-xs disabled:opacity-60"
                disabled={saving}
              >
                {saving ? "Saving..." : "Save changes"}
              </button>
              <button
                type="button"
                className="text-xs text-slate-400 hover:text-slate-200"
                onClick={() => {
                  setEditing(null);
                  setError(null);
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {workflows.map((wf) => (
          <div
            key={wf.id}
            className="card flex flex-col justify-between gap-3 border border-border/60"
          >
            <Link
              href={`/workflows/${wf.id}`}
              className="block flex-1 cursor-pointer"
            >
              <h2 className="text-sm font-medium">{wf.name}</h2>
              <p className="mt-1 text-xs text-slate-400">
                {wf.description ?? "Deterministic DAG workflow"}
              </p>
              <p className="mt-1 text-[11px] uppercase text-slate-500">
                {wf.status}
              </p>
            </Link>
            <div className="flex items-center justify-end gap-2 text-[11px]">
              <button
                type="button"
                className="text-slate-400 hover:text-slate-200"
                onClick={() => {
                  setEditing(wf);
                  setEditName(wf.name);
                  setEditDescription(wf.description ?? "");
                  setEditStatus(wf.status);
                  setShowNew(false);
                  setError(null);
                }}
              >
                Edit
              </button>
              <button
                type="button"
                className="text-slate-400 hover:text-slate-200"
                onClick={() => handleArchive(wf.id)}
              >
                Archive
              </button>
            </div>
          </div>
        ))}
        {workflows.length === 0 ? (
          <div className="card col-span-full flex flex-col gap-4 text-xs">
            <div>
              <p className="text-sm font-semibold text-slate-200">
                No workflows yet for this tenant
              </p>
              <p className="mt-1 text-slate-500">
                Choose templates below to get started, or create an empty workflow.
              </p>
            </div>

            {loadingTemplates ? (
              <p className="text-slate-500">Loading templates…</p>
            ) : templates.length > 0 ? (
              <div className="space-y-2">
                <p className="text-xs font-medium text-slate-300">
                  Available templates
                </p>
                {templates.map((tpl) => (
                  <label
                    key={tpl.id}
                    className="flex items-start gap-2 rounded-md border border-border/40 p-3 hover:border-border transition-colors cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 accent-primary"
                      checked={selectedTemplateIds.has(tpl.id)}
                      onChange={() => toggleTemplate(tpl.id)}
                    />
                    <div className="flex-1">
                      <span className="text-sm font-medium text-slate-200">
                        {tpl.name}
                      </span>
                      {tpl.description ? (
                        <p className="mt-0.5 text-slate-500">
                          {tpl.description}
                        </p>
                      ) : null}
                      <span className="mt-1 inline-block rounded bg-slate-800 px-1.5 py-0.5 text-[10px] uppercase text-slate-400">
                        {tpl.category}
                      </span>
                    </div>
                  </label>
                ))}
              </div>
            ) : null}

            {importError ? (
              <p className="text-xs text-red-400">{importError}</p>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              {templates.length > 0 ? (
                <button
                  type="button"
                  className="btn-primary text-xs disabled:opacity-60"
                  onClick={handleImportSelected}
                  disabled={importing || selectedTemplateIds.size === 0}
                >
                  {importing
                    ? "Importing…"
                    : `Import ${selectedTemplateIds.size} template${selectedTemplateIds.size !== 1 ? "s" : ""}`}
                </button>
              ) : (
                <button
                  type="button"
                  className="btn-primary text-xs disabled:opacity-60"
                  onClick={handleImportStarters}
                  disabled={importing}
                >
                  {importing ? "Importing…" : "Import starter workflows"}
                </button>
              )}
              <button
                type="button"
                className="text-xs text-slate-400 hover:text-slate-200"
                onClick={() => setShowNew(true)}
              >
                Create empty workflow
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}


