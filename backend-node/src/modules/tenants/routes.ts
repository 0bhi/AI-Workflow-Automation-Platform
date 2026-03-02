import { FastifyInstance } from "fastify";
import { resolveTenantId } from "../auth/context";
import { getTenantUsage } from "./usage";

export async function registerTenantRoutes(app: FastifyInstance) {
  app.get("/api/tenants/usage", async (request) => {
    const tenantId = resolveTenantId(request);
    const usage = await getTenantUsage(tenantId);
    return usage ?? {
      tenantId,
      period: new Date().toISOString().slice(0, 7),
      totalRuns: 0,
      totalSteps: 0,
      totalToolCalls: 0,
      totalLlmCalls: 0,
      totalLlmTokens: 0,
      estimatedCostCents: 0,
    };
  });

  app.get<{ Params: { period: string } }>(
    "/api/tenants/usage/:period",
    async (request) => {
      const tenantId = resolveTenantId(request);
      const { period } = request.params;
      const usage = await getTenantUsage(tenantId, period);
      return usage ?? {
        tenantId,
        period,
        totalRuns: 0,
        totalSteps: 0,
        totalToolCalls: 0,
        totalLlmCalls: 0,
        totalLlmTokens: 0,
        estimatedCostCents: 0,
      };
    }
  );
}
