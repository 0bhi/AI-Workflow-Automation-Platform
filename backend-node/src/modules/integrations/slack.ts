import { FastifyInstance } from "fastify";
import { randomUUID } from "crypto";
import { z } from "zod";
import { fetch } from "undici";
import { env } from "../../config/env";
import { query } from "../../db/client";
import { resolveTenantId } from "../auth/context";
import { assertRole, ADMIN } from "../auth/rbac";

const SLACK_OAUTH_URL = "https://slack.com/api/oauth.v2.access";
const SLACK_SCOPES = "chat:write,channels:read,users:read";

export async function registerSlackIntegrationRoutes(app: FastifyInstance) {
  // Initiate Slack OAuth install flow (admin-only)
  app.get("/api/integrations/slack/install", async (request, reply) => {
    const { tenantId } = await assertRole(request, ADMIN);

    if (!env.SLACK_CLIENT_ID) {
      return reply.code(500).send({ error: "Slack OAuth not configured" });
    }

    const state = Buffer.from(JSON.stringify({ tenantId })).toString("base64url");
    const authorizeUrl = new URL("https://slack.com/oauth/v2/authorize");
    authorizeUrl.searchParams.set("client_id", env.SLACK_CLIENT_ID);
    authorizeUrl.searchParams.set("scope", SLACK_SCOPES);
    authorizeUrl.searchParams.set("redirect_uri", env.SLACK_OAUTH_REDIRECT_URI);
    authorizeUrl.searchParams.set("state", state);

    return reply.redirect(302, authorizeUrl.toString());
  });

  // OAuth callback — exchange code for token and store
  app.get<{
    Querystring: { code?: string; state?: string; error?: string };
  }>("/api/integrations/slack/callback", async (request, reply) => {
    const { code, state, error: oauthError } = request.query;

    if (oauthError) {
      return reply.redirect(302, `${env.FRONTEND_URL}/workflows?oauth_error=${oauthError}`);
    }

    if (!code || !state) {
      return reply.code(400).send({ error: "Missing code or state" });
    }

    let tenantId: string;
    try {
      const decoded = JSON.parse(Buffer.from(state, "base64url").toString());
      tenantId = decoded.tenantId;
      if (!tenantId) throw new Error("Missing tenantId in state");
    } catch {
      return reply.code(400).send({ error: "Invalid state parameter" });
    }

    const tokenRes = await fetch(SLACK_OAUTH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.SLACK_CLIENT_ID,
        client_secret: env.SLACK_CLIENT_SECRET,
        code,
        redirect_uri: env.SLACK_OAUTH_REDIRECT_URI,
      }).toString(),
    });

    const tokenData = (await tokenRes.json()) as Record<string, any>;

    if (!tokenData.ok) {
      request.log.error({ tokenData }, "Slack OAuth token exchange failed");
      return reply.redirect(302, `${env.FRONTEND_URL}/workflows?oauth_error=token_exchange_failed`);
    }

    const accessToken = tokenData.access_token as string;
    const teamId = tokenData.team?.id as string | undefined;
    const teamName = tokenData.team?.name as string | undefined;
    const scope = tokenData.scope as string | undefined;

    const connectionId = `oauth_${randomUUID()}`;
    await query(
      `
        insert into oauth_connections (
          id, tenant_id, provider, access_token, scope, team_id, team_name, metadata_json
        )
        values ($1, $2, 'slack', $3, $4, $5, $6, $7)
        on conflict (tenant_id, provider)
        do update set
          access_token = excluded.access_token,
          scope = excluded.scope,
          team_id = excluded.team_id,
          team_name = excluded.team_name,
          metadata_json = excluded.metadata_json,
          updated_at = now()
      `,
      [
        connectionId,
        tenantId,
        accessToken,
        scope ?? null,
        teamId ?? null,
        teamName ?? null,
        JSON.stringify({ authed_user: tokenData.authed_user }),
      ]
    );

    request.log.info({ tenantId, teamId }, "Slack OAuth connection saved");
    return reply.redirect(302, `${env.FRONTEND_URL}/workflows?oauth_success=slack`);
  });

  // List current integrations for the tenant
  app.get("/api/integrations", async (request) => {
    const tenantId = resolveTenantId(request);

    const result = await query<{
      id: string;
      provider: string;
      scope: string | null;
      team_id: string | null;
      team_name: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `
        select id, provider, scope, team_id, team_name, created_at, updated_at
        from oauth_connections
        where tenant_id = $1
        order by created_at desc
      `,
      [tenantId]
    );

    return result.rows.map((r) => ({
      id: r.id,
      provider: r.provider,
      scope: r.scope,
      teamId: r.team_id,
      teamName: r.team_name,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  });

  // Disconnect an integration (admin-only)
  app.delete<{
    Params: { provider: string };
  }>("/api/integrations/:provider", async (request, reply) => {
    const { tenantId } = await assertRole(request, ADMIN);
    const { provider } = request.params;

    await query(
      `delete from oauth_connections where tenant_id = $1 and provider = $2`,
      [tenantId, provider]
    );

    return reply.code(204).send();
  });
}

/**
 * Retrieve the stored Slack bot token for a tenant from the DB.
 * Falls back to the global env var if no per-tenant token exists.
 */
export async function getSlackTokenForTenant(tenantId: string): Promise<string | null> {
  const result = await query<{ access_token: string }>(
    `select access_token from oauth_connections where tenant_id = $1 and provider = 'slack' limit 1`,
    [tenantId]
  );

  if (result.rows[0]) {
    return result.rows[0].access_token;
  }

  return env.SLACK_BOT_TOKEN ?? null;
}
