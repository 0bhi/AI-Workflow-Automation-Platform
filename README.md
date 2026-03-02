## AI Workflow Automation Platform

Multi-tenant **AI workflow automation platform** that lets you design workflow DAGs in a web UI, trigger runs via HTTP/webhooks, and execute them through a Python **agentic executor** with real tool-calling and vector memory. It wires together a **Next.js dashboard**, a **Node.js Fastify API + BullMQ workers**, a **FastAPI-based agent service using OpenAI**, and **Postgres + Redis + Qdrant** into one end‑to‑end system.

---

## What this project demonstrates

- **End‑to‑end AI system**: Next.js app, Node backend, Python agent, and infra all working together.
- **Agentic workflows**: LLM-driven agent nodes that call tools (HTTP, Slack, memory, storage, tickets, extraction) in a loop until they reach a final answer.
- **Production‑style concerns**: Multi-tenancy, RBAC, quotas, usage metering, rate limiting, webhooks, cron scheduling, Slack OAuth, metrics, and CI.

Use this as a **portfolio project** to show experience designing and shipping realistic AI + tools systems, not just isolated models.

---

## Architecture overview

### Services

- **`frontend/` – Next.js dashboard**
  - App Router + Tailwind UI.
  - Auth UX: `login` / `signup` pages that talk to the backend auth API.
  - Dashboard shell with:
    - Workflows list and detail views.
    - Runs list and run detail views.
  - **ReactFlow-based DAG builder** (`components/workflow-builder/WorkflowBuilder.tsx`):
    - Drag‑and‑drop trigger, agent, tool, and logic nodes onto a canvas.
    - Configure agent nodes (model, system prompt, temperature).
    - Configure HTTP + Slack tool nodes.
    - Edit edge conditions for logic branching.
    - Save DAGs back to the backend and invoke workflows from the UI.

- **`backend-node/` – Fastify API + workers**
  - HTTP API for:
    - **Auth**: signup/login, JWT issuance, multi-tenant users, invite + accept‑invite.
    - **Tenants**: quota checks and usage metering.
    - **Workflows**: CRUD, DAG versioning, list/get, and `POST /api/workflows/:slug/invoke`.
    - **Runs**: list runs and fetch run + step details.
    - **Schedules**: DB-backed cron schedules that enqueue runs.
    - **Integrations**: Slack OAuth install/callback + listing/removal of per‑tenant connections.
    - **Triggers**: generic webhook, Slack Events API, SES email inbound.
  - **Workers**:
    - BullMQ run worker sends execution jobs to the Python agent.
    - Scheduler worker polls the DB for due cron schedules and enqueues runs.
  - **Persistence & infra**:
    - Postgres (workflows, workflow_versions, workflow_runs, workflow_steps, tenants, users, tenant_usage, oauth_connections, invitations, schedules, etc.).
    - Redis + BullMQ for queues.
  - **Run & step state machines**:
    - Explicit FSMs for `workflow_runs` and `workflow_steps` to keep state transitions valid.
    - `internal` endpoint that the agent calls to upsert step rows and advance the run FSM.
  - **Observability & safeguards**:
    - Prometheus metrics exposed at `/metrics`.
    - Health/readiness checks at `/health` and `/readyz` (Postgres + Redis).
    - In‑memory rate limiting hooks for auth and webhook endpoints.
    - Content-length guard on webhook payloads.

- **`agent-python/` – FastAPI agent executor**
  - `POST /internal/runs/execute`:
    - Called by the Node run worker for each enqueued run.
    - Accepts the DAG snapshot, input payload, per‑tenant tools context, and trace ID.
    - Immediately schedules an async execution task so the Node service is never blocked.
  - **Planner (`app/agents/planner.py`)**:
    - Deterministic topological sort over DAG nodes/edges to produce an execution plan.
  - **Executor (`app/agents/executor.py`)**:
    - Executes the DAG in order, with four node types:
      - `trigger`: passes through the initial input.
      - `agent`: full OpenAI **tool‑calling loop**; the LLM:
        - Sees available tools as function definitions.
        - Calls tools with arguments.
        - Receives tool results and continues reasoning.
        - Stops when it returns a final answer or hits a max‑iteration guard.
      - `tool`: non‑agentic, deterministic execution of specific tools (HTTP, Slack, storage, tickets).
      - `logic`: edge‑condition‑based branching (actual branching is handled via edge conditions).
    - Uses a **safe AST-based expression evaluator** for edge conditions (no `eval`).
    - Sends **step updates** back to Node’s `/internal/workflow-runs/:runId/steps` endpoint with:
      - Node status (SUCCEEDED/FAILED/SKIPPED/RETRYING).
      - Input/output/error JSON.
      - Trace metadata.
  - **Tool registry (`app/agents/tools.py`)**:
    - OpenAI tool definitions + async handlers for:
      - `http_request` – arbitrary HTTP calls to external APIs / webhooks.
      - `slack_send_message` – post messages to a Slack channel using per‑tenant or global tokens.
      - `store_data` – persist structured data into the per-run context.
      - `search_memory` – search long‑term vector memory for the tenant.
      - `create_ticket` – simulate ticket creation with stable IDs.
      - `extract_fields` – structured field extraction helper.
  - **Memory system (`app/agents/memory.py`)**:
    - Long‑term **vector memory per tenant** using Qdrant.
    - Embeddings via OpenAI (`text-embedding-3-small` by default).
    - Stores summaries of step inputs/outputs.
    - On each agent call, retrieves relevant prior memories and injects them into the prompt.

- **`infra/` – local data infrastructure**
  - `infra/docker-compose.yml` runs:
    - Postgres (`ai_workflows` DB).
    - Redis.
    - Qdrant (vector DB) with a persistent volume.
  - **Note**: app services (frontend, backend, agent) are run with `npm run dev` / `uvicorn`, not as Docker containers in this compose file.

---

## Request and execution flow

```text
User in browser (Next.js dashboard)
    ⇣
frontend → backend-node     POST /api/workflows/:slug/invoke
    ⇣
backend-node
  - authenticates user + tenant (JWT)
  - validates workflow + active DAG version
  - checks tenant run quota
  - creates a workflow_run row
  - enqueues a BullMQ job on the run queue
    ⇣
run worker → agent-python   POST /internal/runs/execute
    ⇣
agent-python
  - builds a topological execution plan
  - for each node in the plan:
      - trigger nodes: pass through input
      - agent nodes: run OpenAI tool-calling loop
          while model calls tools:
            execute tool handler → append result → continue
      - tool nodes: execute HTTP / Slack / storage / ticket tools
      - logic nodes: evaluated via safe edge conditions
  - sends step updates to backend-node internal step endpoint
    ⇣
backend-node
  - updates workflow_steps and workflow_runs FSM state
  - increments usage metrics (runs, steps, tool/LLM calls)
  - exposes Prometheus metrics
    ⇣
frontend
  - shows run list and per-step details for the current tenant
```

---

## Key capabilities

### Workflow engine & agent intelligence

- **DAG workflow engine**
  - Topological sort-based execution plan.
  - Edge conditions using a safe AST evaluator over `ctx` and upstream node `output`.
  - Deterministic execution order.

- **Agentic tool calling**
  - OpenAI chat completions with tool definitions.
  - Iterative tool-calling loop with:
    - Tool call logging (arguments + results).
    - Max-iteration safety guard.
  - Supports model, system prompt, temperature, and allowed-tools configuration per node.

- **Memory**
  - Long‑term vector memory per tenant via Qdrant.
  - Stores step summaries (input + output).
  - Retrieves relevant memories as system‑level context on later runs.

### Multi-tenancy, auth, quotas, and usage

- **Auth & tenancy**
  - Email/password signup + login with bcrypt and JWT.
  - Each signup creates a new tenant and admin user.
  - Invite flow: admins can invite new users (admin/editor/viewer) into a tenant.

- **RBAC**
  - Roles: `admin`, `editor`, `viewer`.
  - Role verification using DB‑backed roles and JWT payload.

- **Quotas & usage**
  - Per‑tenant **monthly run quota**; enforced before queueing runs.
  - Usage aggregation by month:
    - Tracks monthly totals for runs, steps, tool calls, and LLM calls.
    - Schema fields are ready for LLM tokens and estimated cost in cents, so you can wire in provider pricing later.

### Integrations, triggers, and scheduling

- **Slack OAuth integration**
  - Install flow via `/api/integrations/slack/install`.
  - Callback exchanges code for access token and stores it per tenant.
  - Backend helper to load per‑tenant Slack tokens or fall back to a global bot token.

- **Triggers & webhooks**
  - Generic webhook trigger: `POST /hooks/:workflowId` to fire a workflow directly by ID.
  - Slack Events API: `POST /hooks/slack/events` with optional signature verification.

- **Cron scheduling**
  - Schedules stored in Postgres with cron expression + timezone.
  - Scheduler worker:
    - Polls for due schedules on an interval.
    - For each due schedule:
      - Resolves the active workflow version.
      - Creates a `workflow_run` with trigger type `cron`.
      - Enqueues the run on the BullMQ queue.
      - Advances `next_run_at` so runs fire exactly once per window.

### Observability & CI

- **Metrics**
  - Prometheus metrics via `/metrics`:
    - Counters for runs, steps, tool calls, and LLM usage, plus failures.
    - HTTP request duration histograms and workflow run duration histograms.
    - Gauges for active runs and queue size.

- **Logging & audit**
  - JSON logs with fields like `event`, `runId`, `tenantId`, `traceId`.
  - Step‑level audit trail in Postgres (status, input, output, error per node attempt).

- **CI**
  - GitHub Actions workflow (`.github/workflows/ci.yml`) that:
    - Installs and tests the Node backend (type‑check + Vitest + build).
    - Installs and tests the Python agent (ruff + pytest).
    - Lints/builds the frontend.
    - Builds Docker images for each service to ensure Dockerfiles are valid.

---

## Local development

### Prerequisites

- **Node.js**: 20+
- **Python**: 3.11+ (or 3.12 for CI)
- **Docker + Docker Compose**: for Postgres, Redis, Qdrant
- **OpenAI API key**: for agent and memory

### One-command dev startup

The easiest way to run everything locally is:

```bash
./start-all.sh
```

This will:

- Start **Postgres, Redis, and Qdrant** via Docker Compose.
- Apply the Node backend DB schema (`npm run db:schema`).
- Start:
  - backend-node API (`npm run dev`)
  - backend-node run worker (`npm run dev:worker`)
  - backend-node scheduler (`npm run dev:scheduler`)
  - agent-python (`uvicorn app.main:app --reload`)
  - frontend Next.js dev server

Once it finishes, you’ll have:

- Frontend: `http://localhost:3000`
- Backend API: `http://localhost:4000`
- Agent API: `http://localhost:5000`
- Postgres: `localhost:5432`
- Redis: `localhost:6379`
- Qdrant: `http://localhost:6333`
- Metrics: `http://localhost:4000/metrics`

> Note: `start-all.sh` assumes you’ve already run `npm install` in `backend-node` + `frontend` and `pip install -r requirements.txt` in `agent-python`.

### Manual setup (alternative)

If you prefer to start things manually:

```bash
# Infra
cd infra
docker compose up -d  # Postgres, Redis, Qdrant
cd ..

# Backend
cd backend-node
npm install
npm run db:schema
npm run dev           # API on port 4000
npm run dev:worker    # in another terminal
npm run dev:scheduler # in another terminal

# Agent
cd ../agent-python
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
export OPENAI_API_KEY="your-key"
uvicorn app.main:app --host 0.0.0.0 --port 5000 --reload

# Frontend
cd ../frontend
npm install
npm run dev           # port 3000
```

### Running tests

```bash
# Python agent tests
cd agent-python
pytest -v

# Node backend tests
cd ../backend-node
npm test
```

---

## Configuration

### Backend Node (`backend-node/.env`)

| Variable | Default | Description |
| --- | --- | --- |
| `DATABASE_URL` | `postgres://postgres:postgres@localhost:5432/ai_workflows` | Postgres connection string |
| `REDIS_URL` | `redis://localhost:6379/0` | Redis connection for BullMQ |
| `AGENT_SERVICE_URL` | `http://localhost:5000` | Python agent URL |
| `AUTH_JWT_SECRET` | `dev-secret` | JWT signing secret |
| `SLACK_CLIENT_ID` | — | Slack OAuth app client ID |
| `SLACK_CLIENT_SECRET` | — | Slack OAuth app client secret |
| `SLACK_BOT_TOKEN` | — | Fallback Slack bot token (if no per‑tenant token) |
| `SLACK_SIGNING_SECRET` | — | Slack Events API signature verification secret |
| `FRONTEND_URL` | `http://localhost:3000` | Frontend base URL for OAuth redirects |
| `SCHEDULER_POLL_INTERVAL_MS` | `15000` | Cron scheduler poll interval |

### Python Agent (`agent-python/.env` or environment)

| Variable | Default | Description |
| --- | --- | --- |
| `NODE_BACKEND_URL` | `http://localhost:4000` | Node backend URL for step updates |
| `OPENAI_API_KEY` | — | Required for agent execution + embeddings |
| `OPENAI_MODEL` | `gpt-4o-mini` | Default LLM model for agent nodes |
| `OPENAI_EMBEDDING_MODEL` | `text-embedding-3-small` | Embedding model for memory |
| `MAX_AGENT_ITERATIONS` | `15` | Max tool-calling loop iterations per agent node |
| `QDRANT_URL` | `http://localhost:6333` | Qdrant vector DB URL |
| `QDRANT_COLLECTION` | `agent_memory` | Qdrant collection name for memories |

---

## High-level API surface

This is not a full API spec, but a quick map of the most important endpoints.

### Workflows

- `GET /api/workflows` — List workflows for the current tenant.
- `POST /api/workflows` — Create a workflow (name, slug, description).
- `GET /api/workflows/:id` — Get workflow + active DAG version.
- `PATCH /api/workflows/:id` — Update workflow metadata / status.
- `DELETE /api/workflows/:id` — Archive a workflow.
- `PUT /api/workflows/:id/dag` — Save a new immutable DAG version.
- `POST /api/workflows/:slug/invoke` — Queue a workflow run by slug.

### Runs

- `GET /api/runs` — List recent runs for a tenant.
- `GET /api/runs/:id` — Get run details including step history.

### Schedules

- `GET /api/schedules` — List cron schedules.
- `POST /api/schedules` — Create a schedule for a workflow.
- `PATCH /api/schedules/:id` — Update schedule config.
- `DELETE /api/schedules/:id` — Delete a schedule.

### Integrations

- `GET /api/integrations` — List OAuth connections for the tenant.
- `GET /api/integrations/slack/install` — Start Slack OAuth flow.
- `GET /api/integrations/slack/callback` — OAuth callback handler.
- `DELETE /api/integrations/:provider` — Disconnect an integration.

### Webhooks & triggers

- `POST /hooks/:workflowId` — Generic public webhook trigger.
- `POST /hooks/slack/events` — Slack Events API webhook (with optional signature verification).

### Auth and tenancy

- `POST /api/auth/signup` — Email/password signup; creates a tenant + admin user.
- `POST /api/auth/login` — Login; returns JWT and tenant info.
- `GET /api/auth/me` — Introspect current auth token.
- `POST /api/auth/invite` — Admin-only; invite a user to the tenant.
- `POST /api/auth/accept-invite` — Accept an invitation and create an account.

### Observability

- `GET /health` — Backend health.
- `GET /readyz` — Backend readiness (Postgres + Redis probes).
- `GET /metrics` — Prometheus metrics for the backend.

---



