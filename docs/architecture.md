## AI Workflow Automation Platform – Architecture

This document matches the current implementation.

### Services

- **frontend**: Next.js App Router in `frontend/`
  - Auth: `login`, `signup`, `accept-invite`.
  - Dashboard: workflows (list + React Flow builder), runs, usage, schedules, team, integrations.
- **backend-node**: Fastify API + BullMQ workers
  - Public HTTP API for auth, tenants, workflows, runs, schedules, templates, Slack OAuth.
  - `POST /hooks/:workflowId` public webhook (quota still applied).
  - `/internal/workflow-runs/:runId/steps` for agent step updates (`x-internal-token`).
  - Run worker posts to the Python agent; scheduler worker enqueues due cron runs.
- **agent-python**: FastAPI
  - `POST /internal/runs/execute` (`x-internal-token`).
  - Planner: topological sort. Executor: trigger / agent (Ollama tools) / HTTP+Slack+store / logic + safe edge conditions. Memory: Qdrant.
- **infra**: Docker Compose for Postgres, Redis, Qdrant only.

### Execution flow

1. UI `POST /api/workflows/:slug/invoke` (JWT, monthly run quota) or webhook/cron.
2. Node writes `workflow_runs` as `PENDING` and enqueues BullMQ.
3. Worker calls the agent; agent executes the DAG snapshot and posts step updates.
4. Node advances run/step FSMs (`PENDING` → `RUNNING` → `SUCCEEDED` | `FAILED`; steps may be `SKIPPED`) and increments usage.

### Multi-tenancy

- Each user belongs to exactly one tenant.
- Workflows, runs, steps, usage, OAuth connections, and schedules are scoped by `tenant_id`.
- RBAC via `assertRole` on mutating routes.
- Invites are token-based copy-links (no email).
- Long-term memory lives in Qdrant (payload `tenant_id` filter), not Postgres.

### Slack

- Per-tenant OAuth tokens in `oauth_connections`, with `SLACK_BOT_TOKEN` fallback.
- Used only for `chat.postMessage` from tool nodes. No Slack Events subscription.
