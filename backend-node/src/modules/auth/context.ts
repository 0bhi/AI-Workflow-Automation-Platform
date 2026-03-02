import type { FastifyRequest } from "fastify";
import { verifyAuthToken } from "./jwt";

export function resolveTenantId(request: FastifyRequest): string {
  const authHeader = request.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice("Bearer ".length);
    const payload = verifyAuthToken(token);
    if (payload?.tenantId) {
      return payload.tenantId;
    }
  }

  const headerTenant = request.headers["x-tenant-id"] as string | undefined;
  if (headerTenant) {
    return headerTenant;
  }

  throw new Error("Missing tenant context");
}


