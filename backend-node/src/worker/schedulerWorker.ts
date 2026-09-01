/**
 * Scheduler worker — polls for due cron-based schedules and enqueues runs.
 *
 * Runs on a configurable interval (default 15s). For each due schedule:
 *   1. Loads the workflow's active version.
 *   2. Creates a workflow_run.
 *   3. Enqueues the run on the BullMQ queue.
 *   4. Advances the schedule's next_run_at.
 *
 * Idempotency: each poll compares next_run_at <= now() and atomically
 * advances it, so concurrent workers won't double-fire.
 */

import { assertTenantRunQuota } from "../modules/tenants/quota";
import { env } from "../config/env";
import { runQueue } from "../lib/queue";
import {
  getDueSchedules,
  markScheduleRun,
} from "../modules/schedules/repository";
import {
  getWorkflowByIdWithActiveVersion,
  createWorkflowRun,
} from "../modules/workflows/repository";

async function pollSchedules(): Promise<void> {
  const due = await getDueSchedules();

  for (const sched of due) {
    try {
      const wf = await getWorkflowByIdWithActiveVersion(
        sched.tenantId,
        sched.workflowId
      );

      if (!wf) {
        console.log(
          JSON.stringify({
            event: "schedule_skip",
            reason: "no_active_version",
            scheduleId: sched.id,
            workflowId: sched.workflowId,
          })
        );
        await markScheduleRun(sched.id, sched.cronExpression, sched.timezone);
        continue;
      }

      const traceId = `trace_${Date.now()}`;
      const mode = wf.version.isSandbox ? ("sandbox" as const) : ("production" as const);

      try {
        await assertTenantRunQuota(sched.tenantId);
      } catch (err) {
        console.log(
          JSON.stringify({
            event: "schedule_skip",
            reason: "quota_exceeded",
            scheduleId: sched.id,
            workflowId: sched.workflowId,
            error: err instanceof Error ? err.message : String(err),
          })
        );
        continue;
      }

      const created = await createWorkflowRun({
        tenantId: sched.tenantId,
        workflowId: wf.workflow.id,
        versionId: wf.version.id,
        snapshotDagJson: wf.version.dagJson,
        triggerType: "cron",
        mode,
        traceId,
        inputPayloadJson: sched.inputPayloadJson ?? {},
      });

      await runQueue.add("run", {
        runId: created.id,
        tenantId: sched.tenantId,
        snapshotDagJson: wf.version.dagJson,
        inputPayload: sched.inputPayloadJson ?? {},
        traceId,
        mode,
      });

      await markScheduleRun(sched.id, sched.cronExpression, sched.timezone);

      console.log(
        JSON.stringify({
          event: "schedule_fired",
          scheduleId: sched.id,
          workflowId: sched.workflowId,
          runId: created.id,
          traceId,
        })
      );
    } catch (err) {
      console.error(
        JSON.stringify({
          event: "schedule_error",
          scheduleId: sched.id,
          error: err instanceof Error ? err.message : String(err),
        })
      );
    }
  }
}

const POLL_MS = env.SCHEDULER_POLL_INTERVAL_MS;

console.log(
  JSON.stringify({
    event: "scheduler_started",
    pollIntervalMs: POLL_MS,
  })
);

setInterval(() => {
  pollSchedules().catch((err) => {
    console.error(
      JSON.stringify({
        event: "scheduler_poll_error",
        error: err instanceof Error ? err.message : String(err),
      })
    );
  });
}, POLL_MS);
