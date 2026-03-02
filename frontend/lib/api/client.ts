export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

export function buildAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "x-tenant-id": "demo-tenant"
  };

  if (typeof window !== "undefined") {
    try {
      const token = window.localStorage.getItem("authToken");
      const tenantId = window.localStorage.getItem("tenantId");
      if (token) {
        headers.authorization = `Bearer ${token}`;
      }
      if (tenantId) {
        headers["x-tenant-id"] = tenantId;
      }
    } catch {
      // ignore localStorage errors in non-browser contexts
    }
  }

  return headers;
}

export interface RunSummary {
  id: string;
  workflowName: string;
  status: string;
  triggeredBy: string;
}

export async function listRuns(): Promise<RunSummary[]> {
  const res = await fetch(`${API_BASE_URL}/api/runs`, {
    // Always fetch fresh data for now
    cache: "no-store",
    headers: buildAuthHeaders()
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch runs: ${res.status}`);
  }

  return res.json();
}

export async function invokeWorkflow(slug: string, payload?: unknown) {
  const res = await fetch(`${API_BASE_URL}/api/workflows/${slug}/invoke`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...buildAuthHeaders()
    },
    body: JSON.stringify(payload ?? {})
  });

  if (!res.ok) {
    throw new Error(`Failed to invoke workflow: ${res.status}`);
  }

  return res.json();
}

export interface WorkflowSummary {
  id: string;
  name: string;
  slug: string;
  description?: string;
  status: "draft" | "active" | "archived";
}

export async function importStarterWorkflows(): Promise<WorkflowSummary[]> {
  const res = await fetch(`${API_BASE_URL}/api/workflows/import-starters`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...buildAuthHeaders()
    },
    body: JSON.stringify({})
  });

  if (!res.ok) {
    throw new Error(`Failed to import starter workflows: ${res.status}`);
  }

  return res.json();
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  category: string;
  dagJson: unknown;
  createdAt: string;
}

export async function listTemplates(): Promise<WorkflowTemplate[]> {
  const res = await fetch(`${API_BASE_URL}/api/templates`, {
    cache: "no-store",
    headers: buildAuthHeaders(),
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch templates: ${res.status}`);
  }

  return res.json();
}

export async function importTemplates(
  templateIds?: string[]
): Promise<WorkflowSummary[]> {
  const res = await fetch(`${API_BASE_URL}/api/templates/import`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...buildAuthHeaders(),
    },
    body: JSON.stringify(
      templateIds && templateIds.length > 0 ? { templateIds } : {}
    ),
  });

  if (!res.ok) {
    throw new Error(`Failed to import templates: ${res.status}`);
  }

  return res.json();
}


