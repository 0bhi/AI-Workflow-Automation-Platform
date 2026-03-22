import { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveTenantId } from "../auth/context";
import { assertRole, ADMIN, EDITOR } from "../auth/rbac";
import {
  listSchedules,
  createSchedule,
  updateSchedule,
  deleteSchedule,
} from "./repository";

const createScheduleSchema = z.object({
  workflowId: z.string().min(1),
  cronExpression: z.string().min(5),
  timezone: z.string().optional(),
  inputPayloadJson: z.unknown().optional(),
});

const updateScheduleSchema = z.object({
  enabled: z.boolean().optional(),
  cronExpression: z.string().min(5).optional(),
  timezone: z.string().optional(),
  inputPayloadJson: z.unknown().optional(),
});

export async function registerScheduleRoutes(app: FastifyInstance) {
  app.get("/api/schedules", async (request) => {
    const tenantId = resolveTenantId(request);
    return listSchedules(tenantId);
  });

  app.post<{ Body: unknown }>("/api/schedules", async (request, reply) => {
    const { tenantId } = await assertRole(request, ADMIN, EDITOR);
    const body = createScheduleSchema.parse(request.body);

    const schedule = await createSchedule({
      tenantId,
      workflowId: body.workflowId,
      cronExpression: body.cronExpression,
      timezone: body.timezone,
      inputPayloadJson: body.inputPayloadJson,
    });

    return reply.code(201).send(schedule);
  });

  app.patch<{ Params: { id: string }; Body: unknown }>(
    "/api/schedules/:id",
    async (request, reply) => {
      const { tenantId } = await assertRole(request, ADMIN, EDITOR);
      const { id } = request.params;
      const body = updateScheduleSchema.parse(request.body);

      const updated = await updateSchedule({
        tenantId,
        id,
        ...body,
      });

      if (!updated) {
        return reply.code(404).send({ error: "Schedule not found" });
      }

      return reply.send(updated);
    }
  );

  app.delete<{ Params: { id: string } }>(
    "/api/schedules/:id",
    async (request, reply) => {
      const { tenantId } = await assertRole(request, ADMIN);
      const { id } = request.params;
      await deleteSchedule(tenantId, id);
      return reply.code(204).send();
    }
  );
}
