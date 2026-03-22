export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

export function buildAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};

  if (typeof window !== "undefined") {
    try {
      const token = window.localStorage.getItem("authToken");
      if (token) {
        headers.authorization = `Bearer ${token}`;
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

export interface TenantUsage {
  tenantId: string;
  period: string;
  totalRuns: number;
  totalSteps: number;
  totalToolCalls: number;
  totalLlmCalls: number;
  totalLlmTokens: number;
  estimatedCostCents: number;
}

export async function getTenantUsage(period?: string): Promise<TenantUsage> {
  const path = period
    ? `${API_BASE_URL}/api/tenants/usage/${period}`
    : `${API_BASE_URL}/api/tenants/usage`;

  const res = await fetch(path, {
    cache: "no-store",
    headers: buildAuthHeaders()
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch tenant usage: ${res.status}`);
  }

  return res.json();
}

export interface WorkflowSchedule {
  id: string;
  tenantId: string;
  workflowId: string;
  cronExpression: string;
  timezone: string;
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  inputPayloadJson: unknown;
  createdAt: string;
  updatedAt: string;
}

export async function listSchedules(): Promise<WorkflowSchedule[]> {
  const res = await fetch(`${API_BASE_URL}/api/schedules`, {
    cache: "no-store",
    headers: buildAuthHeaders()
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch schedules: ${res.status}`);
  }

  return res.json();
}

export async function createSchedule(input: {
  workflowId: string;
  cronExpression: string;
  timezone?: string;
  inputPayloadJson?: unknown;
}): Promise<WorkflowSchedule> {
  const res = await fetch(`${API_BASE_URL}/api/schedules`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...buildAuthHeaders()
    },
    body: JSON.stringify({
      workflowId: input.workflowId,
      cronExpression: input.cronExpression,
      timezone: input.timezone,
      inputPayloadJson: input.inputPayloadJson
    })
  });

  if (!res.ok) {
    throw new Error(`Failed to create schedule: ${res.status}`);
  }

  return res.json();
}

export async function updateSchedule(
  id: string,
  patch: {
    enabled?: boolean;
    cronExpression?: string;
    timezone?: string;
    inputPayloadJson?: unknown;
  }
): Promise<WorkflowSchedule> {
  const res = await fetch(`${API_BASE_URL}/api/schedules/${id}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      ...buildAuthHeaders()
    },
    body: JSON.stringify(patch)
  });

  if (!res.ok) {
    throw new Error(`Failed to update schedule: ${res.status}`);
  }

  return res.json();
}

export async function deleteSchedule(id: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/schedules/${id}`, {
    method: "DELETE",
    headers: buildAuthHeaders()
  });

  if (!res.ok && res.status !== 204) {
    throw new Error(`Failed to delete schedule: ${res.status}`);
  }
}

// ---------------------------------------------------------------------------
// Auth / identity
// ---------------------------------------------------------------------------

export interface AuthMe {
  sub: string;
  email: string;
  role: string;
  tenantId: string;
  tenantName: string | null;
  tenantSlug: string | null;
  tenantPlan: string | null;
}

export async function getAuthMe(): Promise<AuthMe> {
  const res = await fetch(`${API_BASE_URL}/api/auth/me`, {
    cache: "no-store",
    headers: buildAuthHeaders(),
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch auth info: ${res.status}`);
  }

  return res.json();
}

// ---------------------------------------------------------------------------
// Team / users
// ---------------------------------------------------------------------------

export interface TenantUser {
  id: string;
  email: string;
  role: string;
  createdAt: string;
}

export async function listTenantUsers(): Promise<TenantUser[]> {
  const res = await fetch(`${API_BASE_URL}/api/tenants/users`, {
    cache: "no-store",
    headers: buildAuthHeaders(),
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch users: ${res.status}`);
  }

  return res.json();
}

export interface PendingInvite {
  id: string;
  email: string;
  role: string;
  token: string;
  expiresAt: string;
  createdAt: string;
}

export async function listPendingInvites(): Promise<PendingInvite[]> {
  const res = await fetch(`${API_BASE_URL}/api/tenants/invites`, {
    cache: "no-store",
    headers: buildAuthHeaders(),
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch invites: ${res.status}`);
  }

  return res.json();
}

export async function sendInvite(input: {
  email: string;
  role: string;
}): Promise<PendingInvite> {
  const res = await fetch(`${API_BASE_URL}/api/auth/invite`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...buildAuthHeaders(),
    },
    body: JSON.stringify(input),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as any).error ?? `Failed to send invite: ${res.status}`);
  }

  return res.json();
}

export async function updateUserRole(
  userId: string,
  role: string
): Promise<{ id: string; role: string }> {
  const res = await fetch(`${API_BASE_URL}/api/tenants/users/${userId}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      ...buildAuthHeaders(),
    },
    body: JSON.stringify({ role }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as any).error ?? `Failed to update role: ${res.status}`);
  }

  return res.json();
}

export async function acceptInvite(input: {
  token: string;
  password: string;
}): Promise<{ token: string; tenantId: string; email: string }> {
  const res = await fetch(`${API_BASE_URL}/api/auth/accept-invite`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as any).error ?? `Failed to accept invite: ${res.status}`);
  }

  return res.json();
}
