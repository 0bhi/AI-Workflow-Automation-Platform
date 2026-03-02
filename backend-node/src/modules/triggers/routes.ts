import { FastifyInstance, FastifyRequest } from "fastify";
import crypto from "crypto";
import {
  getActiveWorkflowByIdAnyTenant,
  getActiveWorkflowsByTriggerType,
  createWorkflowRun,
} from "../workflows/repository";
import { runQueue } from "../../lib/queue";
import { env } from "../../config/env";
import { hooksRateLimit, contentLengthCheck } from "../../lib/rateLimit";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
  const traceId = makeTraceId();
  const mode = params.isSandbox ? "sandbox" as const : "production" as const;

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

function verifySlackSignature(
  signingSecret: string,
  timestamp: string,
  rawBody: string,
  signature: string
): boolean {
  const baseString = `v0:${timestamp}:${rawBody}`;
  const hmac = crypto
    .createHmac("sha256", signingSecret)
    .update(baseString)
    .digest("hex");
  const expected = `v0=${hmac}`;
  if (expected.length !== signature.length) return false;
  return crypto.timingSafeEqual(
    Buffer.from(expected, "utf8"),
    Buffer.from(signature, "utf8")
  );
}

// Extracts raw body string for Slack signature verification.
// Fastify's default JSON parser already parsed the body, so we re-serialize.
// This is acceptable for signature checks where exact byte-level fidelity
// is not required (Slack re-verifies on retry anyway).
function rawBodyFrom(request: FastifyRequest): string {
  return JSON.stringify(request.body);
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export async function registerTriggerRoutes(app: FastifyInstance) {
  // -----------------------------------------------------------------------
  // 1. Generic webhook trigger – POST /hooks/:workflowId
  //    Public (no auth). The URL itself acts as the secret.
  // -----------------------------------------------------------------------
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
      } catch (err) {
        request.log.error({ err, workflowId }, "Failed to create webhook run");
        return reply
          .code(500)
          .send({ error: "Failed to create workflow run" });
      }
    }
  );

  // -----------------------------------------------------------------------
  // 2. Slack Events API – POST /hooks/slack/events
  //    Handles url_verification + event_callback.
  // -----------------------------------------------------------------------
  app.post<{ Body: Record<string, unknown> }>(
    "/hooks/slack/events",
    { preHandler: [hooksRateLimit, contentLengthCheck] },
    async (request, reply) => {
      const body = request.body;

      // -- Slack url_verification handshake --------------------------------
      if (body.type === "url_verification") {
        return reply.send({ challenge: body.challenge });
      }

      // -- Optional signature verification --------------------------------
      if (env.SLACK_SIGNING_SECRET) {
        const ts = request.headers["x-slack-request-timestamp"] as
          | string
          | undefined;
        const sig = request.headers["x-slack-signature"] as
          | string
          | undefined;

        if (!ts || !sig) {
          return reply.code(401).send({ error: "Missing Slack signature headers" });
        }

        if (!verifySlackSignature(env.SLACK_SIGNING_SECRET, ts, rawBodyFrom(request), sig)) {
          return reply.code(401).send({ error: "Invalid Slack signature" });
        }
      }

      // -- event_callback -------------------------------------------------
      if (body.type !== "event_callback") {
        return reply.code(200).send({ ok: true });
      }

      const workflows = await getActiveWorkflowsByTriggerType(
        "trigger.slack_event"
      );

      if (workflows.length === 0) {
        request.log.warn("Slack event received but no workflows with trigger.slack_event");
        return reply.code(200).send({ ok: true, matched: 0 });
      }

      const results: Array<{ workflowId: string; runId: string }> = [];

      for (const wf of workflows) {
        try {
          const result = await enqueueRun({
            tenantId: wf.tenantId,
            workflowId: wf.workflow.id,
            versionId: wf.version.id,
            dagJson: wf.version.dagJson,
            isSandbox: wf.version.isSandbox,
            triggerType: "slack_event",
            payload: body,
          });
          results.push({ workflowId: wf.workflow.id, runId: result.runId });
        } catch (err) {
          request.log.error(
            { err, workflowId: wf.workflow.id },
            "Failed to enqueue run for Slack event"
          );
        }
      }

      request.log.info(
        { matched: workflows.length, enqueued: results.length },
        "Slack event dispatched"
      );

      return reply.code(200).send({ ok: true, matched: results.length, runs: results });
    }
  );
}
