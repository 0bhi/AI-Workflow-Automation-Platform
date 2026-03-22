import { randomBytes, randomUUID } from "crypto";
import { FastifyInstance } from "fastify";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { signAuthToken, type AuthTokenPayload, verifyAuthToken } from "./jwt";
import { query } from "../../db/client";
import { ADMIN, EDITOR, VIEWER, assertRole, type Role } from "./rbac";
import { authRateLimit } from "../../lib/rateLimit";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(4)
});

const inviteBodySchema = z.object({
  email: z.string().email(),
  role: z.enum(["admin", "editor", "viewer"]).default("viewer"),
});

const acceptInviteBodySchema = z.object({
  token: z.string().min(1),
  password: z.string().min(4),
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

    const userResult = await query<{
      id: string;
      email: string;
      role: string;
      tenant_id: string;
    }>(
      `select id, email, role, tenant_id from users where id = $1 limit 1`,
      [payload.sub]
    );

    const user = userResult.rows[0];
    if (!user) {
      return reply.code(401).send({ error: "User not found" });
    }

    const tenantResult = await query<{ name: string; slug: string; plan: string }>(
      `select name, slug, plan from tenants where id = $1 limit 1`,
      [user.tenant_id]
    );

    const tenant = tenantResult.rows[0];

    return reply.send({
      sub: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenant_id,
      tenantName: tenant?.name ?? null,
      tenantSlug: tenant?.slug ?? null,
      tenantPlan: tenant?.plan ?? null,
    });
  });

  // ---------------------------------------------------------------------------
  // Invite a user to the current tenant (admin-only)
  // ---------------------------------------------------------------------------
  app.post<{ Body: unknown }>(
    "/api/auth/invite",
    { preHandler: [authRateLimit] },
    async (request, reply) => {
      const { tenantId } = await assertRole(request, ADMIN);
      const { email, role } = inviteBodySchema.parse(request.body);
      const lowerEmail = email.toLowerCase();

      const existingUser = await query<{ id: string }>(
        `select id from users where email = $1 and tenant_id = $2 limit 1`,
        [lowerEmail, tenantId]
      );
      if (existingUser.rows[0]) {
        return reply.code(409).send({ error: "User already exists in this tenant" });
      }

      const existingInvite = await query<{ id: string }>(
        `select id from invites where tenant_id = $1 and email = $2 and accepted_at is null limit 1`,
        [tenantId, lowerEmail]
      );
      if (existingInvite.rows[0]) {
        return reply.code(409).send({ error: "A pending invite already exists for this email" });
      }

      const inviteId = `invite_${randomUUID()}`;
      const inviteToken = randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      await query(
        `
          insert into invites (id, tenant_id, email, role, token, expires_at)
          values ($1, $2, $3, $4, $5, $6)
        `,
        [inviteId, tenantId, lowerEmail, role, inviteToken, expiresAt.toISOString()]
      );

      request.log.info({ tenantId, email: lowerEmail, role }, "Invite created");

      return reply.code(201).send({
        id: inviteId,
        email: lowerEmail,
        role,
        token: inviteToken,
        expiresAt: expiresAt.toISOString(),
      });
    }
  );

  // ---------------------------------------------------------------------------
  // Accept an invitation and create an account
  // ---------------------------------------------------------------------------
  app.post<{ Body: unknown }>(
    "/api/auth/accept-invite",
    { preHandler: [authRateLimit] },
    async (request, reply) => {
      const { token: inviteToken, password } = acceptInviteBodySchema.parse(request.body);

      const inviteResult = await query<{
        id: string;
        tenant_id: string;
        email: string;
        role: string;
        expires_at: string;
        accepted_at: string | null;
      }>(
        `select id, tenant_id, email, role, expires_at, accepted_at from invites where token = $1 limit 1`,
        [inviteToken]
      );

      const invite = inviteResult.rows[0];
      if (!invite) {
        return reply.code(404).send({ error: "Invite not found" });
      }

      if (invite.accepted_at) {
        return reply.code(400).send({ error: "Invite has already been accepted" });
      }

      if (new Date(invite.expires_at) < new Date()) {
        return reply.code(400).send({ error: "Invite has expired" });
      }

      const existingUser = await query<{ id: string }>(
        `select id from users where email = $1 and tenant_id = $2 limit 1`,
        [invite.email, invite.tenant_id]
      );
      if (existingUser.rows[0]) {
        return reply.code(409).send({ error: "User already exists for this email in the tenant" });
      }

      const userId = `user_${randomUUID()}`;
      const passwordHash = await bcrypt.hash(password, 10);
      const role = invite.role as Role;

      await query(
        `insert into users (id, email, password_hash, tenant_id, role) values ($1, $2, $3, $4, $5)`,
        [userId, invite.email, passwordHash, invite.tenant_id, role]
      );

      await query(
        `update invites set accepted_at = now() where id = $1`,
        [invite.id]
      );

      const authPayload: AuthTokenPayload = { sub: userId, tenantId: invite.tenant_id, role };
      const authToken = signAuthToken(authPayload);

      request.log.info(
        { tenantId: invite.tenant_id, email: invite.email, role },
        "Invite accepted, user created"
      );

      return reply.code(201).send({
        token: authToken,
        tenantId: invite.tenant_id,
        email: invite.email,
      });
    }
  );
}
