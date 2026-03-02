import { FastifyInstance } from "fastify";
import { getRunWithSteps, listRecentRuns } from "./repository";
import { resolveTenantId } from "../auth/context";

export async function registerRunRoutes(app: FastifyInstance) {
  // List recent runs for a tenant from Postgres
  app.get("/api/runs", async (request) => {
    const tenantId = resolveTenantId(request);
    return listRecentRuns(tenantId);
  });

  app.get<{
    Params: { id: string };
  }>("/api/runs/:id", async (request, reply) => {
    const tenantId = resolveTenantId(request);
    const { id } = request.params;

    const run = await getRunWithSteps(tenantId, id);
    if (!run) {
      return reply.code(404).send({ error: "Run not found for tenant" });
    }

    return reply.send(run);
  });
}

