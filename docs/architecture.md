## AI Workflow Automation Platform – Architecture Overview

This document summarizes the current implementation of the AI Workflow Automation Platform according to the architecture plan.

### Services

- **frontend**: Next.js App Router app in `frontend/` with:
  - `(auth)` segment for `login`, `signup`, and `accept-invite`.
  - `(dashboard)` shell with `workflows` list/detail, `runs` monitoring, `usage` dashboard, `schedules` management, and `team` management (members, invites, role changes).
  - Account badge in the sidebar displaying tenant name, user email, and role.
  - `components/workflow-builder/WorkflowBuilder.tsx` as the DAG builder UI.
- **backend-node**: Fastify API + workers in `backend-node/`:
  - `src/main.ts` bootstraps the app, config, metrics, and routes.
  - `src/modules/workflows` exposes workflow CRUD, DAG versioning, and `POST /api/workflows/:slug/invoke`.
  - `src/modules/runs` exposes `GET /api/runs` and `GET /api/runs/:id` backed by `workflow_runs` and `workflow_steps`.
  - `src/modules/runs/internalRoutes.ts` exposes `/internal/workflow-runs/:runId/steps` for the agent to push step updates.
  - `src/lib/fsm` implements explicit FSM helpers for workflow run and step states.
  - `src/worker/runWorker.ts` is a BullMQ worker that dequeues run jobs and calls the Python agent.
  - `src/worker/schedulerWorker.ts` polls DB-backed cron schedules and enqueues runs.
- **agent-python**: FastAPI service in `agent-python/`:
  - `app/main.py` exposes `POST /internal/runs/execute` for Node to hand off runs asynchronously.
  - `app/agents/planner.py` implements deterministic DAG planning (topological sort).
  - `app/agents/executor.py` implements a full agentic executor with OpenAI tool-calling, Slack/HTTP/storage tools, safe edge-condition evaluation, and Qdrant-backed long-term memory.
- **infra**: Docker Compose in `infra/docker-compose.yml` to run core data services:
  - Postgres, Redis, and Qdrant.
  - Application services (`backend-node`, `agent-python`, `frontend`) are run with local dev commands or `./start-all.sh` rather than inside this compose file.

### Execution Flow

1. The frontend calls:
   - `GET /api/runs` to list runs in the Runs dashboard (via `frontend/lib/api/client.ts`).
   - `POST /api/workflows/:slug/invoke` (utility available in the same client) to trigger workflows.
2. The Node backend:
   - Accepts invocations, logs a `runId` and `traceId`, and calls the Python agent service at `/internal/runs/execute`.
   - Uses the explicit FSM helpers in `src/lib/fsm` for future, stricter state transitions.
3. The Python agent service:
   - Accepts the execution request and asynchronously runs the DAG execution plan.
   - For each node:
     - Trigger nodes pass through the initial input.
     - Agent nodes run an iterative OpenAI tool-calling loop using the tools defined in `app/agents/tools.py`, retrieving and storing long-term memory via Qdrant.
     - Tool nodes execute deterministic HTTP/Slack/storage/ticket operations.
     - Logic nodes evaluate edge conditions using the safe AST-based evaluator in `app/agents/safe_eval.py`.
   - Sends step updates back to the Node backend via `/internal/workflow-runs/:runId/steps`, which drives the run and step FSMs and updates metrics/usage.

This layout keeps the DAG as the source of truth in Node, while implementing the cross-service contracts, agentic execution, and state-machine foundations required by the architecture plan.

### Multi-tenancy Model

- **Single-tenant-per-user**: every `users` row has a `tenant_id` foreign key. A user belongs to exactly one tenant; there is no cross-tenant membership.
- **Data partitioning**: all core tables (`workflows`, `workflow_runs`, `workflow_steps`, `tenant_usage`, `oauth_connections`, `workflow_schedules`, `agent_memories`) are scoped by `tenant_id`. Backend routes resolve the tenant from the authenticated JWT.
- **RBAC enforcement**: the `assertRole` helper verifies the caller's role against the DB before executing admin-only or editor-only operations. This is applied at the HTTP layer on routes for invites, template imports, schedule management, integration management, workflow creation/update/deletion, and user role changes.
- **Invite flow**: admins create invites (stored in the `invites` table) with a secure token and expiry. The invited user accepts the invite at a public endpoint, which creates their account in the admin's tenant with the specified role.
- **Quotas and usage**: per-tenant monthly run quotas are enforced before queueing runs. Usage (runs, steps, tool calls, LLM calls) is aggregated per month. There is no billing integration; quotas and metering provide the SaaS-like controls.
