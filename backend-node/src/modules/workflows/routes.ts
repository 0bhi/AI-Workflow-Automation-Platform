import { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  archiveWorkflow,
  createWorkflow,
  createWorkflowRun,
  createWorkflowVersion,
  getWorkflowByIdWithActiveVersion,
  getWorkflowWithActiveVersion,
  importStarterWorkflowsForTenant,
  listWorkflows,
  updateWorkflow
} from "./repository";
import { runQueue } from "../../lib/queue";
import { resolveTenantId } from "../auth/context";
import { assertTenantRunQuota } from "../tenants/quota";

const invokeParamsSchema = z.object({
  slug: z.string(),
});

const invokeBodySchema = z.unknown();

const dagNodeSchema = z.object({
  id: z.string(),
  type: z.string(),
  label: z.string(),
  config: z.record(z.unknown())
});

const dagEdgeSchema = z.object({
  id: z.string(),
  from_: z.string(),
  to: z.string(),
  condition: z.string().nullable().optional()
});

const dagSnapshotSchema = z.object({
  nodes: z.array(dagNodeSchema),
  edges: z.array(dagEdgeSchema)
});

const saveDagBodySchema = z.object({
  dag: dagSnapshotSchema
});

const createWorkflowBodySchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
  description: z.string().optional()
});

const updateWorkflowBodySchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  status: z.enum(["draft", "active", "archived"]).optional()
});

export async function registerWorkflowRoutes(app: FastifyInstance) {
  app.get("/healthz", async () => ({ ok: true }));

  app.get("/api/workflows", async (request) => {
    const tenantId = resolveTenantId(request);
    const items = await listWorkflows(tenantId);
    return items;
  });

  app.post("/api/workflows/import-starters", async (request, reply) => {
    const tenantId = resolveTenantId(request);

    const existing = await listWorkflows(tenantId);
    if (existing.length > 0) {
      return reply
        .code(400)
        .send({ error: "Tenant already has workflows; cannot import starters" });
    }

    try {
      const created = await importStarterWorkflowsForTenant(tenantId);
      return reply.code(201).send(created);
    } catch (err: any) {
      request.log.error(
        { err, tenantId },
        "Failed to import starter workflows for tenant"
      );
      return reply
        .code(500)
        .send({ error: "Failed to import starter workflows for tenant" });
    }
  });

  app.post<{
    Body: unknown;
  }>("/api/workflows", async (request, reply) => {
    const tenantId = resolveTenantId(request);
    const body = createWorkflowBodySchema.parse(request.body);

    try {
      const created = await createWorkflow({
        tenantId,
        name: body.name,
        slug: body.slug,
        description: body.description
      });
      return reply.code(201).send(created);
    } catch (err: any) {
      request.log.error({ err, tenantId, body }, "Failed to create workflow");
      return reply
        .code(400)
        .send({ error: "Failed to create workflow for tenant" });
    }
  });

  app.get<{
    Params: { id: string };
  }>("/api/workflows/:id", async (request, reply) => {
    const tenantId = resolveTenantId(request);
    const { id } = request.params;

    const wf = await getWorkflowByIdWithActiveVersion(tenantId, id);
    if (!wf) {
      return reply.code(404).send({ error: "Workflow not found for tenant" });
    }

    return reply.send({
      workflow: {
        id: wf.workflow.id,
        name: wf.workflow.name,
        slug: wf.workflow.slug,
        description: wf.workflow.description
      },
      version: {
        id: wf.version.id,
        versionNumber: wf.version.versionNumber,
        dagJson: wf.version.dagJson
      }
    });
  });

  app.put<{
    Params: { id: string };
    Body: unknown;
  }>("/api/workflows/:id/dag", async (request, reply) => {
    const tenantId = resolveTenantId(request);
    const { id } = request.params;
    const body = saveDagBodySchema.parse(request.body);

    const createdBy =
      (request.headers["x-user-id"] as string | undefined) ?? "ui";

    try {
      const updated = await createWorkflowVersion({
        tenantId,
        workflowId: id,
        dagJson: body.dag,
        createdBy
      });

      return reply.code(201).send({
        workflowId: updated.workflow.id,
        versionId: updated.version.id,
        versionNumber: updated.version.versionNumber
      });
    } catch (err) {
      request.log.error({ err, tenantId, id }, "Failed to save workflow DAG");
      return reply
        .code(400)
        .send({ error: "Failed to save workflow DAG for tenant" });
    }
  });

  app.patch<{
    Params: { id: string };
    Body: unknown;
  }>("/api/workflows/:id", async (request, reply) => {
    const tenantId = resolveTenantId(request);
    const { id } = request.params;
    const body = updateWorkflowBodySchema.parse(request.body);

    const updated = await updateWorkflow({
      tenantId,
      id,
      name: body.name,
      description:
        body.description === undefined ? undefined : body.description,
      status: body.status
    });

    if (!updated) {
      return reply.code(404).send({ error: "Workflow not found for tenant" });
    }

    return reply.send(updated);
  });

  app.delete<{
    Params: { id: string };
  }>("/api/workflows/:id", async (request, reply) => {
    const tenantId = resolveTenantId(request);
    const { id } = request.params;

    await archiveWorkflow(tenantId, id);
    return reply.code(204).send();
  });

  app.post<{
    Params: { slug: string };
    Body: unknown;
  }>("/api/workflows/:slug/invoke", async (request, reply) => {
    const { slug } = invokeParamsSchema.parse(request.params);
    const body = invokeBodySchema.parse(request.body);

    const tenantId = resolveTenantId(request);

    const wf = await getWorkflowWithActiveVersion(tenantId, slug);
    if (!wf) {
      return reply.code(404).send({ error: "Workflow not found or not active for tenant" });
    }

    const traceId = `trace_${Date.now()}`;

    try {
      await assertTenantRunQuota(tenantId);
    } catch (err: any) {
      const status = typeof err.statusCode === "number" ? err.statusCode : 429;
      request.log.warn(
        { tenantId, slug, err },
        "Tenant run quota exceeded or tenant missing"
      );
      return reply
        .code(status)
        .send({ error: "Run quota exceeded for tenant", code: "QUOTA_EXCEEDED" });
    }

    const createdRun = await createWorkflowRun({
      tenantId,
      workflowId: wf.workflow.id,
      versionId: wf.version.id,
      snapshotDagJson: wf.version.dagJson,
      triggerType: "http",
      mode: wf.version.isSandbox ? "sandbox" : "production",
      traceId,
      inputPayloadJson: body,
    });

    request.log.info(
      { slug, runId: createdRun.id, traceId, tenantId },
      "Invoking workflow run"
    );

    await runQueue.add("run", {
      runId: createdRun.id,
      tenantId,
      snapshotDagJson: wf.version.dagJson,
      inputPayload: body,
      traceId,
      mode: wf.version.isSandbox ? "sandbox" : "production",
    });

    return reply.code(202).send({
      status: "queued",
      workflowSlug: slug,
      runId: createdRun.id,
      traceId,
    });
  });
}


