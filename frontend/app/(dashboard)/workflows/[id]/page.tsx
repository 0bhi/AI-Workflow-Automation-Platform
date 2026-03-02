"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { WorkflowBuilder } from "@components/workflow-builder/WorkflowBuilder";
import { API_BASE_URL, buildAuthHeaders } from "@lib/api/client";

interface WorkflowDetailResponse {
  workflow: {
    id: string;
    name: string;
    slug: string;
    description?: string;
  };
  version: {
    id: string;
    versionNumber: number;
    dagJson: unknown;
  };
}

async function fetchWorkflow(id: string): Promise<WorkflowDetailResponse | null> {
  const headers = buildAuthHeaders();
  const res = await fetch(`${API_BASE_URL}/api/workflows/${id}`, {
    cache: "no-store",
    headers
  });

  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`Failed to fetch workflow: ${res.status}`);
  }

  return res.json();
}

export default function WorkflowDetailPage({
  params
}: {
  params: { id: string };
}) {
  const [data, setData] = useState<WorkflowDetailResponse | null | "loading">(
    "loading"
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const result = await fetchWorkflow(params.id);
        if (!cancelled) {
          setData(result);
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err.message ?? "Failed to load workflow");
          setData(null);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [params.id]);

  if (data === "loading") {
    return (
      <div className="flex flex-1 flex-col min-h-0 gap-0">
        <header className="flex shrink-0 items-center justify-between border-b border-slate-800/50 bg-slate-950/80 px-4 py-2.5 backdrop-blur-sm">
          <div className="flex items-center gap-4">
            <Link
              href="/workflows"
              className="text-slate-400 transition-colors hover:text-slate-200"
              aria-label="Back to workflows"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <div>
              <h1 className="text-base font-semibold tracking-tight text-slate-100">
                Loading workflow…
              </h1>
            </div>
          </div>
        </header>
        <div className="flex-1 min-h-0 flex items-center justify-center">
          <p className="text-sm text-slate-500">
            Fetching workflow details for the current tenant.
          </p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-1 flex-col min-h-0 gap-0">
        <header className="flex shrink-0 items-center justify-between border-b border-slate-800/50 bg-slate-950/80 px-4 py-2.5 backdrop-blur-sm">
          <div className="flex items-center gap-4">
            <Link
              href="/workflows"
              className="text-slate-400 transition-colors hover:text-slate-200"
              aria-label="Back to workflows"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <div>
              <h1 className="text-base font-semibold tracking-tight text-slate-100">
                Workflow not found
              </h1>
              <p className="text-xs text-slate-500">
                This workflow is not available for the current tenant.
              </p>
              {error ? (
                <p className="mt-1 text-xs text-red-400">{error}</p>
              ) : null}
            </div>
          </div>
        </header>
      </div>
    );
  }

  const { workflow, version } = data;

  return (
    <div className="flex flex-1 flex-col min-h-0 gap-0">
      <header className="flex shrink-0 items-center justify-between border-b border-slate-800/50 bg-slate-950/80 px-4 py-2.5 backdrop-blur-sm">
        <div className="flex items-center gap-4">
          <Link
            href="/workflows"
            className="text-slate-400 transition-colors hover:text-slate-200"
            aria-label="Back to workflows"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div>
            <h1 className="text-base font-semibold tracking-tight text-slate-100">
              {workflow.name}
            </h1>
            <p className="text-xs text-slate-500">v{version.versionNumber}</p>
          </div>
        </div>
      </header>
      <div className="flex-1 min-h-0">
        <WorkflowBuilder
          workflowId={workflow.id}
          workflowSlug={workflow.slug}
          initialDag={version.dagJson as any}
        />
      </div>
    </div>
  );
}

