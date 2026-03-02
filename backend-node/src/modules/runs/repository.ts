import { query } from "../../db/client";

export interface RunSummaryRow {
  id: string;
  workflow_name: string;
  status: string;
  trigger_type: string;
}

export interface RunSummary {
  id: string;
  workflowName: string;
  status: string;
  triggeredBy: string;
}

export interface RunStepRow {
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

export interface RunDetail {
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

export async function listRecentRuns(
  tenantId: string,
  limit = 20
): Promise<RunSummary[]> {
  const result = await query<RunSummaryRow>(
    `
      select
        r.id,
        w.name as workflow_name,
        r.status,
        r.trigger_type
      from workflow_runs r
      join workflows w on w.id = r.workflow_id
      where r.tenant_id = $1
      order by r.started_at desc
      limit $2
    `,
    [tenantId, limit]
  );

  return result.rows.map((row: RunSummaryRow) => ({
    id: row.id,
    workflowName: row.workflow_name,
    status: row.status,
    triggeredBy: row.trigger_type,
  }));
}

export async function getRunWithSteps(
  tenantId: string,
  runId: string
): Promise<RunDetail | null> {
  const runResult = await query<{
    id: string;
    workflow_id: string;
    workflow_slug: string;
    workflow_name: string;
    status: string;
    trigger_type: string;
    started_at: string;
    finished_at: string | null;
    trace_id: string | null;
    input_payload_json: unknown;
  }>(
    `
      select
        r.id,
        r.workflow_id,
        w.slug as workflow_slug,
        w.name as workflow_name,
        r.status,
        r.trigger_type,
        r.started_at,
        r.finished_at,
        r.trace_id,
        r.input_payload_json
      from workflow_runs r
      join workflows w on w.id = r.workflow_id
      where r.tenant_id = $1
        and r.id = $2
      limit 1
    `,
    [tenantId, runId]
  );

  const run = runResult.rows[0];
  if (!run) return null;

  const stepsResult = await query<RunStepRow>(
    `
      select
        id,
        node_id,
        type,
        status,
        attempt,
        started_at,
        finished_at,
        input_json,
        output_json,
        error_json,
        trace_id
      from workflow_steps
      where run_id = $1
      order by started_at asc, id asc
    `,
    [runId]
  );

  return {
    id: run.id,
    workflowId: run.workflow_id,
    workflowSlug: run.workflow_slug,
    workflowName: run.workflow_name,
    status: run.status,
    triggerType: run.trigger_type,
    startedAt: run.started_at,
    finishedAt: run.finished_at,
    traceId: run.trace_id,
    inputPayload: run.input_payload_json,
    steps: stepsResult.rows
  };
}


