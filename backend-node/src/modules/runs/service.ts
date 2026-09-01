import { pool, query } from "../../db/client";
import type { WorkflowRunState } from "../../lib/fsm/runState";
import { transitionRunState } from "../../lib/fsm/runState";
import type { StepState } from "../../lib/fsm/stepState";
import { transitionStepState } from "../../lib/fsm/stepState";
import { recordRunUsage } from "../tenants/usage";
import {
  workflowStepsTotal,
  failuresTotal,
  workflowRunsTotal,
} from "../../lib/metrics";

export async function upsertStepAndUpdateRun(opts: {
  runId: string;
  nodeId: string;
  type: string;
  status: StepState;
  inputJson: unknown;
  outputJson: unknown;
  errorJson: unknown;
  traceId: string | null;
  llmTokenUsage?: number | null;
}) {
  const client = await pool.connect();
  try {
    await client.query("begin");

    const latestAttemptRow = await client.query<{
      attempt: number;
      status: StepState;
    }>(
      `
        select attempt, status
        from workflow_steps
        where run_id = $1
          and node_id = $2
        order by attempt desc
        limit 1
      `,
      [opts.runId, opts.nodeId]
    );

    const existing = latestAttemptRow.rows[0] ?? null;
    const attempt = existing?.attempt ?? 1;

    if (existing) {
      transitionStepState(existing.status, opts.status);
    } else if (opts.status !== "PENDING" && opts.status !== "RUNNING") {
      transitionStepState("PENDING", opts.status);
    }

    const stepId = `${opts.runId}:${opts.nodeId}:${attempt}`;

    await client.query(
      `
        insert into workflow_steps (
          id,
          run_id,
          node_id,
          type,
          status,
          attempt,
          input_json,
          output_json,
          error_json,
          trace_id,
          llm_token_usage
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        on conflict (run_id, node_id, attempt)
        do update set
          status = excluded.status,
          input_json = excluded.input_json,
          output_json = excluded.output_json,
          error_json = excluded.error_json,
          trace_id = excluded.trace_id,
          llm_token_usage = coalesce(excluded.llm_token_usage, workflow_steps.llm_token_usage),
          finished_at = case
            when excluded.status in ('SUCCEEDED','FAILED','SKIPPED') then now()
            else workflow_steps.finished_at
          end
      `,
      [
        stepId,
        opts.runId,
        opts.nodeId,
        opts.type,
        opts.status,
        attempt,
        opts.inputJson ?? null,
        opts.outputJson ?? null,
        opts.errorJson ?? null,
        opts.traceId ?? null,
        opts.llmTokenUsage ?? null,
      ]
    );

    const statsRow = await client.query<{
      total: string;
      succeeded: string;
      failed: string;
      running: string;
      pending: string;
      skipped: string;
    }>(
      `
        with latest as (
          select distinct on (node_id) node_id, status
          from workflow_steps
          where run_id = $1
          order by node_id, attempt desc
        )
        select
          count(*)::text                                     as total,
          count(*) filter (where status = 'SUCCEEDED')::text as succeeded,
          count(*) filter (where status = 'FAILED')::text    as failed,
          count(*) filter (where status = 'RUNNING')::text   as running,
          count(*) filter (where status = 'PENDING')::text   as pending,
          count(*) filter (where status = 'SKIPPED')::text   as skipped
        from latest
      `,
      [opts.runId]
    );

    const stats = statsRow.rows[0];

    const runRow = await client.query<{
      status: WorkflowRunState;
      tenant_id: string;
    }>(
      `
        select status, tenant_id
        from workflow_runs
        where id = $1
        for update
      `,
      [opts.runId]
    );

    const currentRunStatus = runRow.rows[0]?.status ?? "PENDING";
    const tenantId = runRow.rows[0]?.tenant_id;

    let nextRunStatus: WorkflowRunState | null = null;

    if (currentRunStatus === "PENDING") {
      nextRunStatus = transitionRunState(currentRunStatus, "RUNNING");
    }

    if (opts.status === "FAILED") {
      nextRunStatus = transitionRunState(
        nextRunStatus ?? currentRunStatus,
        "FAILED"
      );
    } else if (opts.status === "SUCCEEDED") {
      const allSettled =
        stats &&
        Number(stats.total) > 0 &&
        Number(stats.running) === 0 &&
        Number(stats.pending) === 0 &&
        Number(stats.failed) === 0;

      if (allSettled) {
        nextRunStatus = transitionRunState(
          nextRunStatus ?? currentRunStatus,
          "SUCCEEDED"
        );
      }
    }

    if (nextRunStatus) {
      await client.query(
        `
          update workflow_runs
          set status = $2,
              finished_at = case
                when $2 in ('SUCCEEDED','FAILED') then now()
                else finished_at
              end
          where id = $1
        `,
        [opts.runId, nextRunStatus]
      );
    }

    await client.query("commit");

    workflowStepsTotal
      .labels(tenantId ?? "unknown", opts.type, opts.status)
      .inc();

    if (opts.status === "FAILED") {
      failuresTotal.labels(tenantId ?? "unknown", "step_failure").inc();
    }

    if (currentRunStatus === "PENDING" && nextRunStatus === "RUNNING") {
      workflowRunsTotal.labels(tenantId ?? "unknown", "internal", "started").inc();
    }

    if (nextRunStatus === "SUCCEEDED") {
      workflowRunsTotal.labels(tenantId ?? "unknown", "internal", "succeeded").inc();
    }

    if (nextRunStatus === "FAILED") {
      workflowRunsTotal.labels(tenantId ?? "unknown", "internal", "failed").inc();
      failuresTotal.labels(tenantId ?? "unknown", "run_failure").inc();
    }

    if (tenantId) {
      const usagePromises: Promise<void>[] = [];

      if (currentRunStatus === "PENDING" && nextRunStatus) {
        usagePromises.push(recordRunUsage(tenantId, { runs: 1 }));
      }

      if (opts.status === "SUCCEEDED") {
        const inc: {
          steps: number;
          toolCalls?: number;
          llmCalls?: number;
          llmTokens?: number;
        } = {
          steps: 1,
        };
        if (opts.type.startsWith("tool")) {
          inc.toolCalls = 1;
        }
        if (opts.type.startsWith("agent")) {
          inc.llmCalls = 1;
          if (opts.llmTokenUsage) {
            inc.llmTokens = opts.llmTokenUsage;
          }
        }
        usagePromises.push(recordRunUsage(tenantId, inc));
      }

      Promise.all(usagePromises).catch(() => {});
    }
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}
