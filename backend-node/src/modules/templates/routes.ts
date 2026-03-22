import { FastifyInstance } from "fastify";
import { resolveTenantId } from "../auth/context";
import { assertRole, ADMIN } from "../auth/rbac";
import { listTemplates, importTemplatesForTenant } from "./repository";

export async function registerTemplateRoutes(app: FastifyInstance) {
  app.get("/api/templates", async () => {
    return listTemplates();
  });

  app.post<{
    Body: { templateIds?: string[] };
  }>("/api/templates/import", async (request) => {
    const { tenantId } = await assertRole(request, ADMIN);
    const { templateIds } = (request.body ?? {}) as { templateIds?: string[] };
    const ids = Array.isArray(templateIds) && templateIds.length > 0
      ? templateIds
      : undefined;
    return importTemplatesForTenant(tenantId, ids);
  });
}
