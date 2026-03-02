import { fetch } from "undici";
import { env } from "../config/env";
import { createRunWorker, type RunJobPayload } from "../lib/queue";
import { getToolsContextForTenant } from "../modules/tenants/toolsContext";

async function handleRunJob(job: { data: RunJobPayload }) {
  const { runId, tenantId, snapshotDagJson, inputPayload, traceId, mode } =
    job.data;
  const startMs = Date.now();

  console.log(
    JSON.stringify({
      event: "run_job_start",
      runId,
      tenantId,
      traceId,
      mode,
    })
  );

  const toolsContext = await getToolsContextForTenant(tenantId);

  const res = await fetch(`${env.AGENT_SERVICE_URL}/internal/runs/execute`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      run_id: runId,
      tenant_id: tenantId,
      snapshot_dag_json: snapshotDagJson,
      input_payload: inputPayload,
      tools_context: toolsContext,
      trace_id: traceId,
      mode,
    }),
  });

  const durationMs = Date.now() - startMs;

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(
      JSON.stringify({
        event: "run_job_agent_error",
        runId,
        tenantId,
        status: res.status,
        durationMs,
        body: body.slice(0, 500),
      })
    );
    throw new Error(
      `Agent service returned ${res.status} for run ${runId}`
    );
  }

  console.log(
    JSON.stringify({
      event: "run_job_complete",
      runId,
      tenantId,
      durationMs,
    })
  );
}

createRunWorker(async (job) => {
  try {
    await handleRunJob(job);
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "run_job_failed",
        runId: job.data.runId,
        tenantId: job.data.tenantId,
        attempt: job.attemptsMade + 1,
        error: err instanceof Error ? err.message : String(err),
      })
    );
    throw err;
  }
});
