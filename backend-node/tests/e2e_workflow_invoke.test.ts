import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { fetch } from "undici";
import { randomUUID } from "crypto";

import { query } from "../src/db/client";
import { signAuthToken } from "../src/modules/auth/jwt";

type DagSnapshot = {
  nodes: Array<{
    id: string;
    type: string;
    label: string;
    config: Record<string, unknown>;
  }>;
  edges: Array<{
    id: string;
    from_: string;
    to: string;
    condition: string | null;
  }>;
};

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:4000";
const AGENT_URL = process.env.AGENT_URL ?? "http://localhost:5000";
const RUN_E2E = process.env.RUN_WORKFLOW_E2E === "1";

async function waitForHttp(url: string, timeoutMs = 20_000, intervalMs = 250) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { method: "GET" });
      if (res.ok) return;
    } catch {
      // ignore
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function waitForRunTerminalStatus(runId: string, timeoutMs = 30_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const rows = await query<{ status: string }>(
      `select status from workflow_runs where id = $1`,
      [runId]
    );
    const status = rows.rows[0]?.status;
    if (status && ["SUCCEEDED", "FAILED", "CANCELLED"].includes(status)) {
      return status;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Timed out waiting for run ${runId} to reach terminal status`);
}

const describeE2E = RUN_E2E ? describe : describe.skip;

describeE2E("workflow invoke → python executor → step persistence (e2e)", () => {
  let tenantId: string;
  let tenantSlug: string;
  let userId: string;
  let token: string;

  beforeAll(async () => {
    if (!RUN_E2E) return;

    await waitForHttp(`${BACKEND_URL}/health`);
    await waitForHttp(`${AGENT_URL}/health`);

    // Seed multi-tenant auth + an active workflow.
    tenantId = `tenant_e2e_${randomUUID()}`;
    tenantSlug = `tenant-e2e-${randomUUID()}`;
    userId = `user_e2e_${randomUUID()}`;

    await query(
      `
        insert into tenants (id, name, slug, plan)
        values ($1, $2, $3, $4)
      `,
      [tenantId, "E2E Tenant", tenantSlug, "free"]
    );

    await query(
      `
        insert into users (id, email, password_hash, tenant_id, role)
        values ($1, $2, $3, $4, $5)
      `,
      [userId, `e2e-${randomUUID()}@example.com`, "irrelevant", tenantId, "admin"]
    );

    token = signAuthToken({ sub: userId, tenantId, role: "admin" });
  });

  afterAll(async () => {
    if (!RUN_E2E) return;
    // Intentionally do not delete seeded rows to keep debugging simple.
  });

  async function createAndActivateWorkflow(dag: DagSnapshot) {
    const workflowId = `wf_e2e_${randomUUID()}`;
    const workflowSlug = `wf-e2e-${randomUUID()}`;
    const versionId = `wv_e2e_${randomUUID()}`;

    await query(
      `
        insert into workflows (id, tenant_id, name, slug, description, status)
        values ($1, $2, $3, $4, $5, 'active')
      `,
      [workflowId, tenantId, "E2E Workflow", workflowSlug, null]
    );

    await query(
      `
        insert into workflow_versions (
          id, workflow_id, version_number, dag_json, trigger_config_json, is_sandbox, created_by
        )
        values ($1, $2, 1, $3::jsonb, '{}'::jsonb, false, 'e2e-test')
      `,
      [versionId, workflowId, JSON.stringify(dag)]
    );

    await query(
      `
        update workflows
        set current_version_id = $1
        where id = $2
      `,
      [versionId, workflowId]
    );

    return { workflowId, workflowSlug };
  }

  async function invokeWorkflowAndGetRunId(workflowSlug: string, input: unknown) {
    const res = await fetch(`${BACKEND_URL}/api/workflows/${encodeURIComponent(workflowSlug)}/invoke`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(input),
    });

    expect(res.status).toBe(202);
    const json = (await res.json()) as any;
    expect(json?.runId).toBeTruthy();
    return String(json.runId);
  }

  async function getRunSteps(runId: string) {
    const rows = await query<{ node_id: string; status: string; type: string }>(
      `
        select node_id, status, type
        from workflow_steps
        where run_id = $1
        order by started_at asc
      `,
      [runId]
    );
    return rows.rows;
  }

  it("success case: trigger → tool.db_write completes and run SUCCEEDS", async () => {
    if (!RUN_E2E) return;

    const dag: DagSnapshot = {
      nodes: [
        {
          id: "trigger.start",
          type: "trigger",
          label: "Start",
          config: {},
        },
        {
          id: "tool.db_write",
          type: "tool.db_write",
          label: "Store in DB (demo)",
          config: {},
        },
      ],
      edges: [
        { id: "e1", from_: "trigger.start", to: "tool.db_write", condition: null },
      ],
    };

    const { workflowSlug } = await createAndActivateWorkflow(dag);
    const runId = await invokeWorkflowAndGetRunId(workflowSlug, { hello: "world" });

    const status = await waitForRunTerminalStatus(runId);
    expect(status).toBe("SUCCEEDED");

    const steps = await getRunSteps(runId);
    const nodeStatuses = new Map(steps.map((s) => [s.node_id, s.status]));

    expect(nodeStatuses.get("trigger.start")).toBe("SUCCEEDED");
    expect(nodeStatuses.get("tool.db_write")).toBe("SUCCEEDED");
  }, 60_000);

  it("failure case: later tool.http_request missing url makes run FAILED", async () => {
    if (!RUN_E2E) return;

    const dag: DagSnapshot = {
      nodes: [
        {
          id: "trigger.start",
          type: "trigger",
          label: "Start",
          config: {},
        },
        {
          id: "tool.db_write",
          type: "tool.db_write",
          label: "Store in DB (demo)",
          config: {},
        },
        {
          id: "tool.http_request",
          type: "tool.http_request",
          label: "HTTP request (invalid config)",
          config: {
            // Intentionally omit `url` to trigger executor error.
            method: "GET",
          },
        },
      ],
      edges: [
        { id: "e1", from_: "trigger.start", to: "tool.db_write", condition: null },
        { id: "e2", from_: "tool.db_write", to: "tool.http_request", condition: null },
      ],
    };

    const { workflowSlug } = await createAndActivateWorkflow(dag);
    const runId = await invokeWorkflowAndGetRunId(workflowSlug, { order: 123 });

    const status = await waitForRunTerminalStatus(runId);
    expect(status).toBe("FAILED");

    const steps = await getRunSteps(runId);
    const nodeStatuses = new Map(steps.map((s) => [s.node_id, s.status]));

    expect(nodeStatuses.get("trigger.start")).toBe("SUCCEEDED");
    expect(nodeStatuses.get("tool.db_write")).toBe("SUCCEEDED");
    // This is the critical assertion that often breaks if the run-state FSM
    // transitions too early (e.g. marking SUCCEEDED after the first node).
    expect(nodeStatuses.get("tool.http_request")).toBe("FAILED");
  }, 60_000);
});

