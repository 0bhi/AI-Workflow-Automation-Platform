-- Core multi-tenant workflow schema

create table if not exists tenants (
  id text primary key,
  name text not null,
  slug text not null unique,
  plan text not null default 'free',
  max_concurrent_runs integer not null default 5,
  max_monthly_llm_tokens bigint not null default 1000000,
  max_monthly_runs bigint not null default 1000,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists workflows (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  name text not null,
  slug text not null,
  description text,
  status text not null default 'draft',
  current_version_id text,
  created_at timestamptz not null default now()
);

create unique index if not exists workflows_tenant_slug_idx
  on workflows (tenant_id, slug);

create table if not exists users (
  id text primary key,
  email text not null unique,
  password_hash text not null,
  tenant_id text not null references tenants(id) on delete cascade,
  role text not null default 'admin',
  created_at timestamptz not null default now()
);

alter table users add column if not exists role text not null default 'admin';

create unique index if not exists users_email_idx
  on users (email);

create table if not exists workflow_versions (
  id text primary key,
  workflow_id text not null references workflows(id) on delete cascade,
  version_number integer not null,
  dag_json jsonb not null,
  trigger_config_json jsonb not null default '{}'::jsonb,
  is_sandbox boolean not null default false,
  created_at timestamptz not null default now(),
  created_by text not null
);

create unique index if not exists workflow_versions_workflow_version_idx
  on workflow_versions (workflow_id, version_number);

create table if not exists workflow_runs (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  workflow_id text not null references workflows(id) on delete cascade,
  version_id text not null references workflow_versions(id) on delete restrict,
  snapshot_dag_json jsonb not null,
  trigger_type text not null,
  status text not null,
  mode text not null default 'production',
  trace_id text,
  -- started_at is the canonical timestamp for ordering runs
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  input_payload_json jsonb,
  output_payload_json jsonb,
  failure_reason text,
  retry_of_run_id text
);

create index if not exists workflow_runs_tenant_idx
  on workflow_runs (tenant_id, started_at desc);

create table if not exists workflow_steps (
  id text primary key,
  run_id text not null references workflow_runs(id) on delete cascade,
  node_id text not null,
  type text not null,
  status text not null,
  attempt integer not null default 1,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  input_json jsonb,
  output_json jsonb,
  error_json jsonb,
  external_operation_id text,
  tool_name text,
  llm_token_usage integer,
  trace_id text
);

create unique index if not exists workflow_steps_run_node_attempt_idx
  on workflow_steps (run_id, node_id, attempt);

create table if not exists tenant_usage (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  period text not null,
  total_runs integer not null default 0,
  total_steps integer not null default 0,
  total_tool_calls integer not null default 0,
  total_llm_calls integer not null default 0,
  total_llm_tokens integer not null default 0,
  estimated_cost_cents integer not null default 0,
  updated_at timestamptz not null default now()
);

create unique index if not exists tenant_usage_tenant_period_idx
  on tenant_usage (tenant_id, period);

create table if not exists workflow_templates (
  id text primary key,
  name text not null,
  slug text not null unique,
  description text,
  category text not null default 'general',
  dag_json jsonb not null,
  created_at timestamptz not null default now()
);

-- OAuth connections (per-tenant integration tokens)
create table if not exists oauth_connections (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  provider text not null,
  access_token text not null,
  refresh_token text,
  token_expires_at timestamptz,
  scope text,
  team_id text,
  team_name text,
  metadata_json jsonb default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists oauth_connections_tenant_provider_idx
  on oauth_connections (tenant_id, provider);

-- Workflow schedules (cron-based triggers)
create table if not exists workflow_schedules (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  workflow_id text not null references workflows(id) on delete cascade,
  cron_expression text not null,
  timezone text not null default 'UTC',
  enabled boolean not null default true,
  last_run_at timestamptz,
  next_run_at timestamptz,
  input_payload_json jsonb default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists workflow_schedules_next_run_idx
  on workflow_schedules (next_run_at)
  where enabled = true;

-- Agent memory references (metadata; vectors live in Qdrant)
create table if not exists agent_memories (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  run_id text references workflow_runs(id) on delete set null,
  node_id text,
  content_preview text,
  qdrant_point_id text,
  metadata_json jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists agent_memories_tenant_idx
  on agent_memories (tenant_id, created_at desc);

-- Tenant invitations (admin-issued, token-based)
create table if not exists invites (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  email text not null,
  role text not null default 'viewer',
  token text not null unique,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists invites_tenant_email_pending_idx
  on invites (tenant_id, email)
  where accepted_at is null;

create index if not exists invites_token_idx
  on invites (token);
