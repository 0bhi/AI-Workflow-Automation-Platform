import Fastify from "fastify";
import cors from "@fastify/cors";
import { env } from "./config/env";
import { registerWorkflowRoutes } from "./modules/workflows/routes";
import { registerRunRoutes } from "./modules/runs/routes";
import { registerRunInternalRoutes } from "./modules/runs/internalRoutes";
import { registerAuthRoutes } from "./modules/auth/routes";
import { registerTenantRoutes } from "./modules/tenants/routes";
import { registerTemplateRoutes } from "./modules/templates/routes";
import { registerTriggerRoutes } from "./modules/triggers/routes";
import { registerSlackIntegrationRoutes } from "./modules/integrations/slack";
import { registerScheduleRoutes } from "./modules/schedules/routes";
import { checkHealth } from "./lib/healthcheck";
import { register, httpRequestDuration } from "./lib/metrics";

async function buildServer() {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === "production" ? "info" : "debug",
    },
  });

  await app.register(cors, { origin: true });

  // Request duration tracking
  app.addHook("onRequest", (request, _reply, done) => {
    (request as any)._metricsStart = process.hrtime.bigint();
    done();
  });

  app.addHook("onResponse", (request, reply, done) => {
    const start = (request as any)._metricsStart as bigint | undefined;
    if (start) {
      const durationNs = Number(process.hrtime.bigint() - start);
      const durationS = durationNs / 1e9;
      const route = request.routeOptions?.url ?? request.url;
      httpRequestDuration
        .labels(request.method, route, String(reply.statusCode))
        .observe(durationS);
    }
    done();
  });

  app.setErrorHandler((error, _request, reply) => {
    const status =
      typeof (error as any).statusCode === "number"
        ? (error as any).statusCode
        : 500;
    reply.code(status).send({ error: error.message ?? "Internal server error" });
  });

  await registerAuthRoutes(app);
  await registerWorkflowRoutes(app);
  await registerRunRoutes(app);
  await registerRunInternalRoutes(app);
  await registerTenantRoutes(app);
  await registerTemplateRoutes(app);
  await registerTriggerRoutes(app);
  await registerSlackIntegrationRoutes(app);
  await registerScheduleRoutes(app);

  app.get("/health", async () => ({ status: "ok", service: "backend-node" }));

  app.get("/readyz", async (_request, reply) => {
    const health = await checkHealth();
    const allHealthy = health.postgres && health.redis;
    return reply
      .code(allHealthy ? 200 : 503)
      .send({ status: allHealthy ? "ready" : "degraded", ...health });
  });

  app.get("/metrics", async (_request, reply) => {
    reply.header("Content-Type", register.contentType);
    return register.metrics();
  });

  return app;
}

async function main() {
  const app = await buildServer();
  try {
    await app.listen({ port: env.PORT, host: "0.0.0.0" });
    app.log.info(`Node backend running on port ${env.PORT}`);
  } catch (err) {
    app.log.error(err, "Failed to start Node backend");
    process.exit(1);
  }
}

void main();
