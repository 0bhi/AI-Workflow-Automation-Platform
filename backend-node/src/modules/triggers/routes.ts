import { FastifyInstance } from "fastify";
import {
  getActiveWorkflowByIdAnyTenant,
  createWorkflowRun,
} from "../workflows/repository";
import { runQueue } from "../../lib/queue";
import { hooksRateLimit, contentLengthCheck } from "../../lib/rateLimit";
import { assertTenantRunQuota } from "../tenants/quota";

function makeTraceId(): string {
  return `trace_${Date.now()}`;
}

async function enqueueRun(params: {
  tenantId: string;
  workflowId: string;
  versionId: string;
  dagJson: unknown;
  isSandbox: boolean;
  triggerType: string;
  payload: unknown;
}): Promise<{ runId: string; traceId: string }> {
  await assertTenantRunQuota(params.tenantId);

  const traceId = makeTraceId();
  const mode = params.isSandbox ? ("sandbox" as const) : ("production" as const);

  const created = await createWorkflowRun({
    tenantId: params.tenantId,
    workflowId: params.workflowId,
    versionId: params.versionId,
    snapshotDagJson: params.dagJson,
    triggerType: params.triggerType,
    mode,
    traceId,
    inputPayloadJson: params.payload,
  });

  await runQueue.add("run", {
    runId: created.id,
    tenantId: params.tenantId,
    snapshotDagJson: params.dagJson,
    inputPayload: params.payload,
    traceId,
    mode,
  });

  return { runId: created.id, traceId };
}

export async function registerTriggerRoutes(app: FastifyInstance) {
  // Generic webhook trigger – POST /hooks/:workflowId
  // Public (no JWT). The URL itself acts as the secret.
  app.post<{ Params: { workflowId: string }; Body: unknown }>(
    "/hooks/:workflowId",
    { preHandler: [hooksRateLimit, contentLengthCheck] },
    async (request, reply) => {
      const { workflowId } = request.params;

      const wf = await getActiveWorkflowByIdAnyTenant(workflowId);
      if (!wf) {
        return reply
          .code(404)
          .send({ error: "Workflow not found or not active" });
      }

      try {
        const result = await enqueueRun({
          tenantId: wf.tenantId,
          workflowId: wf.workflow.id,
          versionId: wf.version.id,
          dagJson: wf.version.dagJson,
          isSandbox: wf.version.isSandbox,
          triggerType: "webhook",
          payload: request.body ?? {},
        });

        request.log.info(
          { workflowId, runId: result.runId, traceId: result.traceId },
          "Webhook trigger created run"
        );

        return reply.code(202).send({
          status: "queued",
          runId: result.runId,
          traceId: result.traceId,
        });
      } catch (err: any) {
        const status = typeof err.statusCode === "number" ? err.statusCode : 500;
        request.log.error({ err, workflowId }, "Failed to create webhook run");
        return reply.code(status).send({
          error:
            status === 429
              ? "Run quota exceeded for tenant"
              : "Failed to create workflow run",
        });
      }
    }
  );
}
