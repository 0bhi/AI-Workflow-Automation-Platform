import { randomUUID } from "crypto";
import { query } from "../../db/client";
import type { Workflow, WorkflowVersion } from "./types";

export interface WorkflowWithVersion {
  workflow: Workflow;
  version: WorkflowVersion;
}

export interface WorkflowListItem {
  id: string;
  name: string;
  slug: string;
  description?: string;
  status: Workflow["status"];
}

export async function listWorkflows(
  tenantId: string
): Promise<WorkflowListItem[]> {
  const result = await query<{
    id: string;
    name: string;
    slug: string;
    description: string | null;
    status: string;
  }>(
    `
      select id, name, slug, description, status
      from workflows
      where tenant_id = $1
      order by created_at desc
    `,
    [tenantId]
  );

  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description ?? undefined,
    status: row.status as Workflow["status"]
  }));
}

export interface CreateWorkflowParams {
  tenantId: string;
  name: string;
  slug: string;
  description?: string;
}

export async function createWorkflow(
  params: CreateWorkflowParams
): Promise<Workflow> {
  const id = `wf-${randomUUID()}`;

  await query(
    `
      insert into workflows (id, tenant_id, name, slug, description, status)
      values ($1,$2,$3,$4,$5,'draft')
    `,
    [id, params.tenantId, params.name, params.slug, params.description ?? null]
  );

  const created: Workflow = {
    id,
    tenantId: params.tenantId,
    name: params.name,
    slug: params.slug,
    description: params.description,
    status: "draft",
    currentVersionId: undefined,
    createdAt: new Date().toISOString()
  };

  return created;
}

export interface UpdateWorkflowParams {
  tenantId: string;
  id: string;
  name?: string;
  description?: string | null;
  status?: Workflow["status"];
}

export async function updateWorkflow(
  params: UpdateWorkflowParams
): Promise<Workflow | null> {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (params.name !== undefined) {
    fields.push("name = $" + (fields.length + 3));
    values.push(params.name);
  }
  if (params.description !== undefined) {
    fields.push("description = $" + (fields.length + 3));
    values.push(params.description);
  }
  if (params.status !== undefined) {
    fields.push("status = $" + (fields.length + 3));
    values.push(params.status);
  }

  if (fields.length === 0) {
    const existing = await getWorkflowByIdWithActiveVersion(
      params.tenantId,
      params.id
    );
    return existing?.workflow ?? null;
  }

  const result = await query<{
    id: string;
    tenant_id: string;
    name: string;
    slug: string;
    description: string | null;
    status: string;
    current_version_id: string | null;
    created_at: string;
  }>(
    `
      update workflows
      set ${fields.join(", ")}
      where id = $1
        and tenant_id = $2
      returning id, tenant_id, name, slug, description, status, current_version_id, created_at
    `,
    [params.id, params.tenantId, ...values]
  );

  const row = result.rows[0];
  if (!row) return null;

  const wf: Workflow = {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    slug: row.slug,
    description: row.description ?? undefined,
    status: row.status as Workflow["status"],
    currentVersionId: row.current_version_id ?? undefined,
    createdAt: row.created_at
  };

  return wf;
}

export async function archiveWorkflow(
  tenantId: string,
  id: string
): Promise<void> {
  await query(
    `
      update workflows
      set status = 'archived'
      where id = $1
        and tenant_id = $2
    `,
    [id, tenantId]
  );
}

export async function getWorkflowByIdWithActiveVersion(
  tenantId: string,
  workflowId: string
): Promise<WorkflowWithVersion | null> {
  const result = await query<{
    workflow_id: string;
    workflow_name: string;
    workflow_slug: string;
    workflow_description: string | null;
    workflow_status: string;
    workflow_created_at: string;
    version_id: string;
    version_number: number;
    dag_json: unknown;
    trigger_config_json: unknown;
    is_sandbox: boolean;
    version_created_at: string;
    created_by: string;
  }>(
    `
      select
        w.id as workflow_id,
        w.name as workflow_name,
        w.slug as workflow_slug,
        w.description as workflow_description,
        w.status as workflow_status,
        w.created_at as workflow_created_at,
        v.id as version_id,
        v.version_number,
        v.dag_json,
        v.trigger_config_json,
        v.is_sandbox,
        v.created_at as version_created_at,
        v.created_by
      from workflows w
      join workflow_versions v on v.id = w.current_version_id
      join tenants t on t.id = w.tenant_id
      where t.id = $1
        and w.id = $2
        and w.status = 'active'
      limit 1
    `,
    [tenantId, workflowId]
  );

  const row = result.rows[0];
  if (!row) return null;

  const workflow: Workflow = {
    id: row.workflow_id,
    tenantId,
    name: row.workflow_name,
    slug: row.workflow_slug,
    description: row.workflow_description ?? undefined,
    status: row.workflow_status as Workflow["status"],
    currentVersionId: row.version_id,
    createdAt: row.workflow_created_at,
  };

  const version: WorkflowVersion = {
    id: row.version_id,
    workflowId: row.workflow_id,
    versionNumber: row.version_number,
    dagJson: row.dag_json,
    triggerConfigJson: row.trigger_config_json,
    isSandbox: row.is_sandbox,
    createdAt: row.version_created_at,
    createdBy: row.created_by,
  };

  return { workflow, version };
}

export async function getWorkflowWithActiveVersion(
  tenantId: string,
  slug: string
): Promise<WorkflowWithVersion | null> {
  const result = await query<{
    workflow_id: string;
    workflow_name: string;
    workflow_slug: string;
    workflow_description: string | null;
    workflow_status: string;
    workflow_created_at: string;
    version_id: string;
    version_number: number;
    dag_json: unknown;
    trigger_config_json: unknown;
    is_sandbox: boolean;
    version_created_at: string;
    created_by: string;
  }>(
    `
      select
        w.id as workflow_id,
        w.name as workflow_name,
        w.slug as workflow_slug,
        w.description as workflow_description,
        w.status as workflow_status,
        w.created_at as workflow_created_at,
        v.id as version_id,
        v.version_number,
        v.dag_json,
        v.trigger_config_json,
        v.is_sandbox,
        v.created_at as version_created_at,
        v.created_by
      from workflows w
      join workflow_versions v on v.id = w.current_version_id
      join tenants t on t.id = w.tenant_id
      where t.id = $1
        and w.slug = $2
        and w.status = 'active'
      limit 1
    `,
    [tenantId, slug]
  );

  const row = result.rows[0];
  if (!row) return null;

  const workflow: Workflow = {
    id: row.workflow_id,
    tenantId,
    name: row.workflow_name,
    slug: row.workflow_slug,
    description: row.workflow_description ?? undefined,
    status: row.workflow_status as Workflow["status"],
    currentVersionId: row.version_id,
    createdAt: row.workflow_created_at,
  };

  const version: WorkflowVersion = {
    id: row.version_id,
    workflowId: row.workflow_id,
    versionNumber: row.version_number,
    dagJson: row.dag_json,
    triggerConfigJson: row.trigger_config_json,
    isSandbox: row.is_sandbox,
    createdAt: row.version_created_at,
    createdBy: row.created_by,
  };

  return { workflow, version };
}

export async function getActiveWorkflowByIdAnyTenant(
  workflowId: string
): Promise<(WorkflowWithVersion & { tenantId: string }) | null> {
  const result = await query<{
    workflow_id: string;
    tenant_id: string;
    workflow_name: string;
    workflow_slug: string;
    workflow_description: string | null;
    workflow_status: string;
    workflow_created_at: string;
    version_id: string;
    version_number: number;
    dag_json: unknown;
    trigger_config_json: unknown;
    is_sandbox: boolean;
    version_created_at: string;
    created_by: string;
  }>(
    `
      select
        w.id as workflow_id,
        w.tenant_id,
        w.name as workflow_name,
        w.slug as workflow_slug,
        w.description as workflow_description,
        w.status as workflow_status,
        w.created_at as workflow_created_at,
        v.id as version_id,
        v.version_number,
        v.dag_json,
        v.trigger_config_json,
        v.is_sandbox,
        v.created_at as version_created_at,
        v.created_by
      from workflows w
      join workflow_versions v on v.id = w.current_version_id
      where w.id = $1
        and w.status = 'active'
      limit 1
    `,
    [workflowId]
  );

  const row = result.rows[0];
  if (!row) return null;

  const workflow: Workflow = {
    id: row.workflow_id,
    tenantId: row.tenant_id,
    name: row.workflow_name,
    slug: row.workflow_slug,
    description: row.workflow_description ?? undefined,
    status: row.workflow_status as Workflow["status"],
    currentVersionId: row.version_id,
    createdAt: row.workflow_created_at,
  };

  const version: WorkflowVersion = {
    id: row.version_id,
    workflowId: row.workflow_id,
    versionNumber: row.version_number,
    dagJson: row.dag_json,
    triggerConfigJson: row.trigger_config_json,
    isSandbox: row.is_sandbox,
    createdAt: row.version_created_at,
    createdBy: row.created_by,
  };

  return { workflow, version, tenantId: row.tenant_id };
}

export async function getActiveWorkflowsByTriggerType(
  triggerType: string
): Promise<Array<WorkflowWithVersion & { tenantId: string }>> {
  const result = await query<{
    workflow_id: string;
    tenant_id: string;
    workflow_name: string;
    workflow_slug: string;
    workflow_description: string | null;
    workflow_status: string;
    workflow_created_at: string;
    version_id: string;
    version_number: number;
    dag_json: unknown;
    trigger_config_json: unknown;
    is_sandbox: boolean;
    version_created_at: string;
    created_by: string;
  }>(
    `
      select
        w.id as workflow_id,
        w.tenant_id,
        w.name as workflow_name,
        w.slug as workflow_slug,
        w.description as workflow_description,
        w.status as workflow_status,
        w.created_at as workflow_created_at,
        v.id as version_id,
        v.version_number,
        v.dag_json,
        v.trigger_config_json,
        v.is_sandbox,
        v.created_at as version_created_at,
        v.created_by
      from workflows w
      join workflow_versions v on v.id = w.current_version_id
      where w.status = 'active'
        and exists (
          select 1
          from jsonb_array_elements(v.dag_json->'nodes') as n
          where n->>'type' = $1
        )
    `,
    [triggerType]
  );

  return result.rows.map((row) => {
    const workflow: Workflow = {
      id: row.workflow_id,
      tenantId: row.tenant_id,
      name: row.workflow_name,
      slug: row.workflow_slug,
      description: row.workflow_description ?? undefined,
      status: row.workflow_status as Workflow["status"],
      currentVersionId: row.version_id,
      createdAt: row.workflow_created_at,
    };

    const version: WorkflowVersion = {
      id: row.version_id,
      workflowId: row.workflow_id,
      versionNumber: row.version_number,
      dagJson: row.dag_json,
      triggerConfigJson: row.trigger_config_json,
      isSandbox: row.is_sandbox,
      createdAt: row.version_created_at,
      createdBy: row.created_by,
    };

    return { workflow, version, tenantId: row.tenant_id };
  });
}

export interface CreateRunParams {
  tenantId: string;
  workflowId: string;
  versionId: string;
  snapshotDagJson: unknown;
  triggerType: string;
  mode: "production" | "sandbox" | "test";
  traceId: string | null;
  inputPayloadJson: unknown;
}

export async function createWorkflowRun(params: CreateRunParams) {
  const id = `run_${randomUUID()}`;

  await query(
    `
      insert into workflow_runs (
        id,
        tenant_id,
        workflow_id,
        version_id,
        snapshot_dag_json,
        trigger_type,
        status,
        mode,
        trace_id,
        input_payload_json
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    `,
    [
      id,
      params.tenantId,
      params.workflowId,
      params.versionId,
      params.snapshotDagJson,
      params.triggerType,
      "PENDING",
      params.mode,
      params.traceId,
      params.inputPayloadJson,
    ]
  );

  return { id };
}

export async function createWorkflowVersion(params: {
  tenantId: string;
  workflowId: string;
  dagJson: unknown;
  createdBy: string;
}): Promise<WorkflowWithVersion> {
  const workflowResult = await query<{
    id: string;
    tenant_id: string;
    slug: string;
  }>(
    `
      select id, tenant_id, slug
      from workflows
      where id = $1
        and tenant_id = $2
      limit 1
    `,
    [params.workflowId, params.tenantId]
  );

  const wfRow = workflowResult.rows[0];
  if (!wfRow) {
    throw new Error("Workflow not found for tenant");
  }

  const versionResult = await query<{
    max_version: number | null;
  }>(
    `
      select max(version_number) as max_version
      from workflow_versions
      where workflow_id = $1
    `,
    [params.workflowId]
  );

  const currentMax = versionResult.rows[0]?.max_version ?? 0;
  const nextVersionNumber = currentMax + 1;
  const versionId = `wv-${randomUUID()}`;

  await query(
    `
      insert into workflow_versions (
        id,
        workflow_id,
        version_number,
        dag_json,
        trigger_config_json,
        is_sandbox,
        created_by
      )
      values ($1,$2,$3,$4,'{}'::jsonb,false,$5)
    `,
    [versionId, params.workflowId, nextVersionNumber, params.dagJson, params.createdBy]
  );

  await query(
    `
      update workflows
      set current_version_id = $1
      where id = $2
    `,
    [versionId, params.workflowId]
  );

  const updated = await getWorkflowByIdWithActiveVersion(
    params.tenantId,
    params.workflowId
  );

  if (!updated) {
    throw new Error("Failed to load workflow after version creation");
  }

  return updated;
}

interface StarterWorkflowTemplate {
  slug: string;
  name: string;
  description: string;
  dagJson: unknown;
}

const STARTER_WORKFLOWS: StarterWorkflowTemplate[] = [
  {
    slug: "email-summarize-classify-notify",
    name: "Email → summarize → classify → notify",
    description:
      "Ingest emails, summarize them, classify, and send a notification.",
    dagJson: {
      nodes: [
        {
          id: "trigger.email_received",
          type: "trigger.email_received",
          label: "Email received",
          config: {}
        },
        {
          id: "agent.summarize",
          type: "agent.summarize",
          label: "Summarize email",
          config: {}
        },
        {
          id: "agent.classify",
          type: "agent.classify",
          label: "Classify email",
          config: {}
        },
        {
          id: "tool.db_write",
          type: "tool.db_write",
          label: "Store in DB",
          config: {}
        },
        {
          id: "tool.slack_send_message",
          type: "tool.slack_send_message",
          label: "Notify via Slack",
          config: {}
        }
      ],
      edges: [
        { id: "e1", from_: "trigger.email_received", to: "agent.summarize" },
        { id: "e2", from_: "agent.summarize", to: "agent.classify" },
        { id: "e3", from_: "agent.classify", to: "tool.db_write" },
        { id: "e4", from_: "tool.db_write", to: "tool.slack_send_message" }
      ]
    }
  },
  {
    slug: "upload-extract-update-crm",
    name: "Upload doc → extract fields → update CRM",
    description:
      "Extract structured fields from uploaded documents and sync to CRM.",
    dagJson: {
      nodes: [
        {
          id: "trigger.file_upload",
          type: "trigger.file_upload",
          label: "File upload",
          config: {}
        },
        {
          id: "agent.extract_fields",
          type: "agent.extract_fields",
          label: "Extract fields",
          config: {}
        },
        {
          id: "tool.crm_update",
          type: "tool.crm_update",
          label: "Update CRM",
          config: {}
        }
      ],
      edges: [
        { id: "e1", from_: "trigger.file_upload", to: "agent.extract_fields" },
        { id: "e2", from_: "agent.extract_fields", to: "tool.crm_update" }
      ]
    }
  },
  {
    slug: "slack-generate-ticket-assign",
    name: "Slack message → generate ticket → assign",
    description: "Turn Slack messages into tickets and assign to the right owner.",
    dagJson: {
      nodes: [
        {
          id: "trigger.slack_event",
          type: "trigger.slack_event",
          label: "Slack message",
          config: {}
        },
        {
          id: "agent.plan_and_execute",
          type: "agent.plan_and_execute",
          label: "Plan ticket creation",
          config: {}
        },
        {
          id: "tool.ticket_create",
          type: "tool.ticket_create",
          label: "Create ticket",
          config: {}
        },
        {
          id: "tool.ticket_assign",
          type: "tool.ticket_assign",
          label: "Assign ticket",
          config: {}
        }
      ],
      edges: [
        { id: "e1", from_: "trigger.slack_event", to: "agent.plan_and_execute" },
        { id: "e2", from_: "agent.plan_and_execute", to: "tool.ticket_create" },
        { id: "e3", from_: "tool.ticket_create", to: "tool.ticket_assign" }
      ]
    }
  }
];

export async function importStarterWorkflowsForTenant(
  tenantId: string
): Promise<WorkflowListItem[]> {
  const created: WorkflowListItem[] = [];

  for (const template of STARTER_WORKFLOWS) {
    const workflowId = `wf-${randomUUID()}`;
    const versionId = `wv-${randomUUID()}`;

    await query(
      `
        insert into workflows (id, tenant_id, name, slug, description, status)
        values ($1,$2,$3,$4,$5,'active')
      `,
      [workflowId, tenantId, template.name, template.slug, template.description]
    );

    await query(
      `
        insert into workflow_versions (
          id,
          workflow_id,
          version_number,
          dag_json,
          trigger_config_json,
          is_sandbox,
          created_by
        )
        values ($1,$2,1,$3,'{}'::jsonb,false,$4)
      `,
      [versionId, workflowId, template.dagJson, "system"]
    );

    await query(
      `
        update workflows
        set current_version_id = $1
        where id = $2
      `,
      [versionId, workflowId]
    );

    created.push({
      id: workflowId,
      name: template.name,
      slug: template.slug,
      description: template.description,
      status: "active"
    });
  }

  return created;
}

