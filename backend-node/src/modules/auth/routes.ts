import { randomUUID } from "crypto";
import { FastifyInstance } from "fastify";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { signAuthToken, type AuthTokenPayload, verifyAuthToken } from "./jwt";
import { query } from "../../db/client";
import { assertRole, ADMIN, type Role } from "./rbac";
import { authRateLimit } from "../../lib/rateLimit";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(4)
});

const inviteBodySchema = z.object({
  email: z.string().email(),
  role: z.enum(["admin", "editor", "viewer"])
});

const acceptInviteBodySchema = z.object({
  invitationId: z.string().min(1),
  password: z.string().min(4)
});

export async function registerAuthRoutes(app: FastifyInstance) {
  app.post<{
    Body: unknown;
  }>("/api/auth/signup", { preHandler: [authRateLimit] }, async (request, reply) => {
    const { email, password } = credentialsSchema.parse(request.body);

    const existingUser = await query<{
      id: string;
      tenant_id: string;
    }>(
      `
        select id, tenant_id
        from users
        where email = $1
        limit 1
      `,
      [email.toLowerCase()]
    );

    if (existingUser.rows[0]) {
      return reply
        .code(409)
        .send({ error: "User already exists for this email" });
    }

    const tenantId = `tenant_${randomUUID()}`;
    await query(
      `
        insert into tenants (id, name, slug, plan)
        values ($1, $2, $3, $4)
      `,
      [tenantId, email, email.split("@")[0] ?? tenantId, "free"]
    );

    const userId = `user_${randomUUID()}`;
    const passwordHash = await bcrypt.hash(password, 10);
    const role: Role = ADMIN;

    await query(
      `
        insert into users (id, email, password_hash, tenant_id, role)
        values ($1, $2, $3, $4, $5)
      `,
      [userId, email.toLowerCase(), passwordHash, tenantId, role]
    );

    const payload: AuthTokenPayload = { sub: userId, tenantId, role };
    const token = signAuthToken(payload);

    return reply.code(201).send({ token, tenantId, email });
  });

  app.post<{
    Body: unknown;
  }>("/api/auth/login", { preHandler: [authRateLimit] }, async (request, reply) => {
    const { email, password } = credentialsSchema.parse(request.body);

    const userResult = await query<{
      id: string;
      email: string;
      password_hash: string;
      tenant_id: string;
      role: string;
    }>(
      `
        select id, email, password_hash, tenant_id, role
        from users
        where email = $1
        limit 1
      `,
      [email.toLowerCase()]
    );

    const user = userResult.rows[0];
    if (!user) {
      return reply.code(401).send({ error: "Invalid email or password" });
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return reply.code(401).send({ error: "Invalid email or password" });
    }

    const payload: AuthTokenPayload = {
      sub: user.id,
      tenantId: user.tenant_id,
      role: user.role
    };
    const token = signAuthToken(payload);

    return reply
      .code(200)
      .send({ token, tenantId: user.tenant_id, email: user.email });
  });

  app.get("/api/auth/me", async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return reply.code(401).send({ error: "Missing or invalid Authorization header" });
    }

    const token = authHeader.slice("Bearer ".length);
    const payload = verifyAuthToken(token);
    if (!payload) {
      return reply.code(401).send({ error: "Invalid token" });
    }

    return reply.send(payload);
  });

  app.post<{ Body: unknown }>("/api/auth/invite", async (request, reply) => {
    const { userId, tenantId } = await assertRole(request, ADMIN);
    const { email, role } = inviteBodySchema.parse(request.body);

    const existing = await query<{ id: string }>(
      `select id from users where email = $1 limit 1`,
      [email.toLowerCase()]
    );
    if (existing.rows[0]) {
      return reply.code(409).send({ error: "A user with this email already exists" });
    }

    const pendingInvite = await query<{ id: string }>(
      `select id from invitations where tenant_id = $1 and email = $2 and accepted_at is null limit 1`,
      [tenantId, email.toLowerCase()]
    );
    if (pendingInvite.rows[0]) {
      return reply.code(409).send({ error: "A pending invitation already exists for this email" });
    }

    const invitationId = `inv_${randomUUID()}`;
    await query(
      `
        insert into invitations (id, tenant_id, email, role, invited_by)
        values ($1, $2, $3, $4, $5)
      `,
      [invitationId, tenantId, email.toLowerCase(), role, userId]
    );

    const result = await query<{
      id: string;
      tenant_id: string;
      email: string;
      role: string;
      invited_by: string;
      created_at: string;
      accepted_at: string | null;
    }>(
      `select id, tenant_id, email, role, invited_by, created_at, accepted_at from invitations where id = $1`,
      [invitationId]
    );

    return reply.code(201).send(result.rows[0]);
  });

  app.post<{ Body: unknown }>("/api/auth/accept-invite", async (request, reply) => {
    const { invitationId, password } = acceptInviteBodySchema.parse(request.body);

    const invResult = await query<{
      id: string;
      tenant_id: string;
      email: string;
      role: string;
      accepted_at: string | null;
    }>(
      `select id, tenant_id, email, role, accepted_at from invitations where id = $1 limit 1`,
      [invitationId]
    );

    const invitation = invResult.rows[0];
    if (!invitation) {
      return reply.code(404).send({ error: "Invitation not found" });
    }
    if (invitation.accepted_at) {
      return reply.code(410).send({ error: "Invitation has already been accepted" });
    }

    const existingUser = await query<{ id: string }>(
      `select id from users where email = $1 limit 1`,
      [invitation.email]
    );
    if (existingUser.rows[0]) {
      return reply.code(409).send({ error: "A user with this email already exists" });
    }

    const userId = `user_${randomUUID()}`;
    const passwordHash = await bcrypt.hash(password, 10);

    await query(
      `
        insert into users (id, email, password_hash, tenant_id, role)
        values ($1, $2, $3, $4, $5)
      `,
      [userId, invitation.email, passwordHash, invitation.tenant_id, invitation.role]
    );

    await query(
      `update invitations set accepted_at = now() where id = $1`,
      [invitationId]
    );

    const payload: AuthTokenPayload = {
      sub: userId,
      tenantId: invitation.tenant_id,
      role: invitation.role
    };
    const token = signAuthToken(payload);

    return reply.code(201).send({
      token,
      tenantId: invitation.tenant_id,
      email: invitation.email,
      role: invitation.role
    });
  });
}
