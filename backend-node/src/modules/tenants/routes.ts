import { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveTenantId } from "../auth/context";
import { assertRole, ADMIN, type Role } from "../auth/rbac";
import { query } from "../../db/client";
import { getTenantUsage } from "./usage";

export async function registerTenantRoutes(app: FastifyInstance) {
  // ---------------------------------------------------------------------------
  // Tenant info for the current user
  // ---------------------------------------------------------------------------
  app.get("/api/tenants/me", async (request) => {
    const tenantId = resolveTenantId(request);

    const tenantResult = await query<{
      id: string;
      name: string;
      slug: string;
      plan: string;
      max_monthly_runs: number;
      created_at: string;
    }>(
      `select id, name, slug, plan, max_monthly_runs, created_at from tenants where id = $1 limit 1`,
      [tenantId]
    );

    const tenant = tenantResult.rows[0];
    if (!tenant) {
      return { error: "Tenant not found" };
    }

    return {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      plan: tenant.plan,
      maxMonthlyRuns: tenant.max_monthly_runs,
      createdAt: tenant.created_at,
    };
  });

  // ---------------------------------------------------------------------------
  // List users in the current tenant (admin-only)
  // ---------------------------------------------------------------------------
  app.get("/api/tenants/users", async (request) => {
    const { tenantId } = await assertRole(request, ADMIN);

    const result = await query<{
      id: string;
      email: string;
      role: string;
      created_at: string;
    }>(
      `select id, email, role, created_at from users where tenant_id = $1 order by created_at`,
      [tenantId]
    );

    return result.rows.map((r) => ({
      id: r.id,
      email: r.email,
      role: r.role,
      createdAt: r.created_at,
    }));
  });

  // ---------------------------------------------------------------------------
  // List pending invites for the current tenant (admin-only)
  // ---------------------------------------------------------------------------
  app.get("/api/tenants/invites", async (request) => {
    const { tenantId } = await assertRole(request, ADMIN);

    const result = await query<{
      id: string;
      email: string;
      role: string;
      token: string;
      expires_at: string;
      created_at: string;
    }>(
      `select id, email, role, token, expires_at, created_at
       from invites
       where tenant_id = $1 and accepted_at is null
       order by created_at desc`,
      [tenantId]
    );

    return result.rows.map((r) => ({
      id: r.id,
      email: r.email,
      role: r.role,
      token: r.token,
      expiresAt: r.expires_at,
      createdAt: r.created_at,
    }));
  });

  // ---------------------------------------------------------------------------
  // Update a user's role (admin-only)
  // ---------------------------------------------------------------------------
  app.patch<{ Params: { userId: string }; Body: unknown }>(
    "/api/tenants/users/:userId",
    async (request, reply) => {
      const { tenantId, userId: callerId } = await assertRole(request, ADMIN);
      const { userId } = request.params;

      const body = z
        .object({ role: z.enum(["admin", "editor", "viewer"]) })
        .parse(request.body);

      const targetUser = await query<{ id: string; tenant_id: string }>(
        `select id, tenant_id from users where id = $1 limit 1`,
        [userId]
      );

      const target = targetUser.rows[0];
      if (!target || target.tenant_id !== tenantId) {
        return reply.code(404).send({ error: "User not found in this tenant" });
      }

      if (userId === callerId) {
        return reply.code(400).send({ error: "Cannot change your own role" });
      }

      await query(`update users set role = $1 where id = $2`, [
        body.role,
        userId,
      ]);

      return { id: userId, role: body.role };
    }
  );

  // ---------------------------------------------------------------------------
  // Usage
  // ---------------------------------------------------------------------------
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
