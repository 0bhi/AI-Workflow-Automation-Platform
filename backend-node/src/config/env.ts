import dotenv from "dotenv";

dotenv.config();

export const env = {
  NODE_ENV: process.env.NODE_ENV ?? "development",
  PORT: Number(process.env.PORT ?? 4000),
  DATABASE_URL: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/ai_workflows",
  REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379/0",
  QUEUE_PREFIX: process.env.QUEUE_PREFIX ?? "aiwf",
  AGENT_SERVICE_URL: process.env.AGENT_SERVICE_URL ?? "http://localhost:5000",
  AUTH_JWT_SECRET: process.env.AUTH_JWT_SECRET ?? "dev-secret",
  SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN,
  SLACK_SIGNING_SECRET: process.env.SLACK_SIGNING_SECRET,
  SLACK_DEFAULT_CHANNEL: process.env.SLACK_DEFAULT_CHANNEL ?? "#general",
  SLACK_CLIENT_ID: process.env.SLACK_CLIENT_ID ?? "",
  SLACK_CLIENT_SECRET: process.env.SLACK_CLIENT_SECRET ?? "",
  SLACK_OAUTH_REDIRECT_URI: process.env.SLACK_OAUTH_REDIRECT_URI ?? "http://localhost:4000/api/integrations/slack/callback",
  FRONTEND_URL: process.env.FRONTEND_URL ?? "http://localhost:3000",
  SCHEDULER_POLL_INTERVAL_MS: Number(process.env.SCHEDULER_POLL_INTERVAL_MS ?? 15_000),
};


