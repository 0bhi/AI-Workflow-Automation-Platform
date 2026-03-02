import type { FastifyRequest } from "fastify";
import { verifyAuthToken } from "./jwt";
import { query } from "../../db/client";

export const ADMIN = "admin" as const;
export const EDITOR = "editor" as const;
export const VIEWER = "viewer" as const;

export type Role = typeof ADMIN | typeof EDITOR | typeof VIEWER;

export async function assertRole(
  request: FastifyRequest,
  ...allowedRoles: Role[]
): Promise<{ userId: string; tenantId: string; role: Role }> {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    throw Object.assign(new Error("Missing or invalid Authorization header"), {
      statusCode: 401
    });
  }

  const token = authHeader.slice("Bearer ".length);
  const payload = verifyAuthToken(token);
  if (!payload) {
    throw Object.assign(new Error("Invalid token"), { statusCode: 401 });
  }

  const result = await query<{ role: string }>(
    `select role from users where id = $1 limit 1`,
    [payload.sub]
  );

  const user = result.rows[0];
  if (!user) {
    throw Object.assign(new Error("User not found"), { statusCode: 401 });
  }

  const role = user.role as Role;
  if (!allowedRoles.includes(role)) {
    throw Object.assign(
      new Error(`Forbidden: requires one of [${allowedRoles.join(", ")}]`),
      { statusCode: 403 }
    );
  }

  return { userId: payload.sub, tenantId: payload.tenantId, role };
}
