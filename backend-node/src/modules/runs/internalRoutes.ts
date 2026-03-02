import { FastifyInstance } from "fastify";
import { z } from "zod";
import { upsertStepAndUpdateRun } from "./service";

const stepUpdateBodySchema = z.object({
  run_id: z.string(),
  tenant_id: z.string(),
  node_id: z.string(),
  type: z.string(),
  status: z.enum([
    "PENDING",
    "RUNNING",
    "RETRYING",
    "SUCCEEDED",
    "FAILED",
    "SKIPPED",
  ]),
  input_json: z.unknown().optional(),
  output_json: z.unknown().optional(),
  error_json: z.unknown().optional(),
  trace_id: z.string().optional(),
});

export async function registerRunInternalRoutes(app: FastifyInstance) {
  app.post<{
    Params: { runId: string };
    Body: unknown;
  }>("/internal/workflow-runs/:runId/steps", async (request, reply) => {
    const { runId } = request.params;
    const body = stepUpdateBodySchema.parse(request.body);

    if (body.run_id !== runId) {
      return reply.code(400).send({ error: "run_id mismatch" });
    }

    await upsertStepAndUpdateRun({
      runId,
      nodeId: body.node_id,
      type: body.type,
      status: body.status,
      inputJson: body.input_json ?? null,
      outputJson: body.output_json ?? null,
      errorJson: body.error_json ?? null,
      traceId: body.trace_id ?? null,
    });

    request.log.debug(
      { runId, nodeId: body.node_id, status: body.status },
      "Recorded workflow step update"
    );

    return reply.code(202).send({ ok: true });
  });
}


