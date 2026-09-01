## AI Workflow Automation Platform

Multi-tenant **AI workflow automation platform**: design DAGs in a web UI, trigger runs from the dashboard, HTTP webhooks, or cron, and execute them in a Python **agentic executor** with real tool-calling and Qdrant memory. Stack: **Next.js**, **Node.js Fastify + BullMQ**, **FastAPI + local Ollama**, **Postgres + Redis + Qdrant**.

---

## What this project demonstrates

- End-to-end AI system: dashboard, API, workers, agent, and local infra.
- Agentic workflows: LLM nodes that call tools (HTTP, Slack, memory, in-run storage) until they return an answer.
- Production-style concerns: multi-tenancy, RBAC, monthly run quotas, usage metering, rate limiting, webhooks, cron, Slack OAuth, Prometheus metrics, CI.

---

## Architecture overview

### Services

- **`frontend/` – Next.js dashboard**
  - Auth: login, signup, accept-invite (copy-link tokens; no email sending).
  - Workflows list + React Flow DAG builder (webhook trigger, agent, HTTP, Slack, branch).
  - Runs list and run detail (polls while a run is active).
  - Usage, schedules, team (invites + roles), integrations (Slack connect/disconnect).

- **`backend-node/` – Fastify API + workers**
  - Auth, tenants, workflows, runs, schedules, templates, Slack OAuth.
  - Generic webhook: `POST /hooks/:workflowId`.
  - BullMQ run worker calls the Python agent.
  - Scheduler worker polls due cron rows and enqueues runs.
  - Postgres + Redis. Run/step FSMs: `PENDING → RUNNING → SUCCEEDED | FAILED` (steps may be `SKIPPED`).
  - `/metrics`, `/health`, `/readyz`. Rate limits on auth and webhooks.

- **`agent-python/` – FastAPI executor**
  - `POST /internal/runs/execute` (shared `INTERNAL_API_TOKEN`).
  - Topological DAG plan; agent tool-calling loop against Ollama; HTTP/Slack/store tools; safe AST edge conditions; Qdrant memory.

- **`infra/` – Docker Compose** for Postgres, Redis, Qdrant. App processes run via `./start-all.sh`, not this compose file. Dockerfiles exist so CI can smoke-build images.

### Request and execution flow

```text
User (Next.js)
    → POST /api/workflows/:slug/invoke   (JWT + monthly run quota)
backend-node
    → Postgres workflow_run PENDING
    → BullMQ job
run worker → agent-python POST /internal/runs/execute
agent-python
    → topological plan
    → trigger / agent (Ollama + tools) / HTTP or Slack tool / logic + edge conditions
    → POST /internal/workflow-runs/:runId/steps
backend-node
    → workflow_steps + run FSM + usage counters
frontend
    → run list + step timeline
```

Webhooks (`POST /hooks/:workflowId`) and cron skip JWT but still enforce the monthly run quota.

---

## Key capabilities

### Workflow engine

- Topological execution; edge conditions via a safe AST evaluator (`ctx`, `output`).
- Agent nodes: OpenAI-compatible tool loop, max-iteration guard, per-node model/prompt/temperature.
- Tools: `http_request`, `slack_send_message`, `search_memory`, `store_data` (in-run context only).
- Memory: per-tenant Qdrant vectors; embeddings from Ollama (`qwen3-embedding:0.6b`).

### Auth, tenancy, quotas

- Email/password signup creates a tenant + admin. One tenant per user.
- Invite flow: admin creates a token (7-day expiry); UI copies an accept URL. No email provider.
- Roles: `admin`, `editor`, `viewer` (DB-backed `assertRole`).
- Monthly **run** quota before enqueue (UI invoke, webhook, and cron).

### Slack

- Optional Slack app: Integrations page starts OAuth; tokens stored per tenant.
- Fallback: `SLACK_BOT_TOKEN`. Slack Events API is not implemented.

### Observability & CI

- Prometheus: HTTP duration, run/step counters, failures (`GET /metrics`).
- JSON logs with `runId` / `tenantId` / `traceId` on workers.
- GitHub Actions: type-check/test/build backend, ruff/pytest agent, lint/build frontend, Docker image builds.

---

## Local development

### Prerequisites

- Node.js 20+, Python 3.11+ (3.12 in CI), Docker Compose, Ollama.

```bash
ollama serve
ollama pull qwen3:8b
ollama pull qwen3-embedding:0.6b
```

If you previously used a different embedding size, delete the Qdrant `agent_memory` collection (or the `qdrant_data` volume).

### Setup and run

```bash
./setup.sh
./start-all.sh
```

`start-all.sh` starts Postgres/Redis/Qdrant, applies schema, seeds workflow templates, then API, run worker, scheduler, agent, and frontend.

- Frontend: `http://localhost:3000`
- Backend: `http://localhost:4000`
- Agent: `http://localhost:5000`
- Metrics: `http://localhost:4000/metrics`

### Tests

```bash
cd agent-python && pytest -v
cd ../backend-node && npm test
```

---

## Configuration

### Backend Node (`backend-node/.env`)

| Variable | Default | Description |
| --- | --- | --- |
| `DATABASE_URL` | `postgres://postgres:postgres@localhost:5432/ai_workflows` | Postgres |
| `REDIS_URL` | `redis://localhost:6379/0` | BullMQ |
| `AGENT_SERVICE_URL` | `http://localhost:5000` | Python agent |
| `AUTH_JWT_SECRET` | `dev-secret` | JWT signing |
| `INTERNAL_API_TOKEN` | `dev-internal-token` | Shared secret for agent ↔ Node internal APIs |
| `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET` | — | Slack OAuth app |
| `SLACK_BOT_TOKEN` | — | Fallback bot token |
| `FRONTEND_URL` | `http://localhost:3000` | OAuth redirect target |
| `SCHEDULER_POLL_INTERVAL_MS` | `15000` | Cron poll interval |

### Python Agent

| Variable | Default | Description |
| --- | --- | --- |
| `NODE_BACKEND_URL` | `http://localhost:4000` | Step updates |
| `INTERNAL_API_TOKEN` | `dev-internal-token` | Must match the Node token |
| `OPENAI_BASE_URL` | `http://127.0.0.1:11434/v1` | Ollama |
| `OPENAI_MODEL` | `qwen3:8b` | Agent LLM |
| `OPENAI_EMBEDDING_MODEL` | `qwen3-embedding:0.6b` | Memory embeddings |
| `QDRANT_URL` | `http://localhost:6333` | Vector DB |

---

## High-level API surface

- Workflows: `GET/POST /api/workflows`, `GET/PATCH/DELETE /api/workflows/:id`, `PUT /api/workflows/:id/dag`, `POST /api/workflows/:slug/invoke`
- Templates: `GET /api/templates`, `POST /api/templates/import`
- Runs: `GET /api/runs`, `GET /api/runs/:id`
- Schedules: `GET/POST /api/schedules`, `PATCH/DELETE /api/schedules/:id`
- Integrations: `GET /api/integrations`, `GET /api/integrations/slack/install`, `GET /api/integrations/slack/callback`, `DELETE /api/integrations/:provider`
- Webhook: `POST /hooks/:workflowId`
- Auth: signup, login, me, invite, accept-invite
- Tenant: me, users, invites, usage
- Observability: `/health`, `/readyz`, `/metrics`

---

## Manual verification checklist

1. `./setup.sh` then `./start-all.sh`.
2. Sign up at `http://localhost:3000/signup`.
3. Import a template (webhook → summarize → HTTP, or webhook → agent → Slack).
4. Open the workflow, copy the webhook URL from the trigger node, or click **Run workflow**.
5. Watch the run detail page poll until SUCCEEDED (HTTP template needs outbound access to httpbin).
6. Usage page: runs/steps should increase.
7. Team: send an invite, copy the URL, accept in another browser profile.
8. Editor can invoke; delete/invite should 403.
9. Integrations: Connect Slack if you have an app, or set `SLACK_BOT_TOKEN` and run the Slack template.
