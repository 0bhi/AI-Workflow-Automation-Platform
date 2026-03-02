import { query } from "./client";

async function seed() {
  // Idempotent seed for a demo tenant and three showcase workflows.
  const tenantId = "demo-tenant";

  await query("begin");

  try {
    await query(
      `
        insert into tenants (id, name, slug, plan)
        values ($1, $2, $3, $4)
        on conflict (id) do update
          set name = excluded.name,
              slug = excluded.slug,
              plan = excluded.plan
      `,
      [tenantId, "Demo Tenant", "demo-tenant", "demo"]
    );

    // Workflow 1: Email → summarize → classify → notify
    await upsertWorkflowWithVersion({
      tenantId,
      workflowId: "wf-email-summarize",
      slug: "email-summarize-classify-notify",
      name: "Email → summarize → classify → notify",
      description: "Ingest emails, summarize them, classify, and send a notification.",
      versionId: "wv-email-summarize-v1",
      createdBy: "system",
      dagJson: {
        nodes: [
          {
            id: "trigger.email_received",
            type: "trigger.email_received",
            label: "Email received",
            config: {},
          },
          {
            id: "agent.summarize",
            type: "agent.summarize",
            label: "Summarize email",
            config: {},
          },
          {
            id: "agent.classify",
            type: "agent.classify",
            label: "Classify email",
            config: {},
          },
          {
            id: "tool.db_write",
            type: "tool.db_write",
            label: "Store in DB",
            config: {},
          },
          {
            id: "tool.slack_send_message",
            type: "tool.slack_send_message",
            label: "Notify via Slack",
            config: {},
          },
        ],
        edges: [
          { id: "e1", from_: "trigger.email_received", to: "agent.summarize" },
          { id: "e2", from_: "agent.summarize", to: "agent.classify" },
          { id: "e3", from_: "agent.classify", to: "tool.db_write" },
          { id: "e4", from_: "tool.db_write", to: "tool.slack_send_message" },
        ],
      },
    });

    // Workflow 2: Upload doc → extract fields → update CRM
    await upsertWorkflowWithVersion({
      tenantId,
      workflowId: "wf-upload-extract",
      slug: "upload-extract-update-crm",
      name: "Upload doc → extract fields → update CRM",
      description: "Extract structured fields from uploaded documents and sync to CRM.",
      versionId: "wv-upload-extract-v1",
      createdBy: "system",
      dagJson: {
        nodes: [
          {
            id: "trigger.file_upload",
            type: "trigger.file_upload",
            label: "File upload",
            config: {},
          },
          {
            id: "agent.extract_fields",
            type: "agent.extract_fields",
            label: "Extract fields",
            config: {},
          },
          {
            id: "tool.crm_update",
            type: "tool.crm_update",
            label: "Update CRM",
            config: {},
          },
        ],
        edges: [
          { id: "e1", from_: "trigger.file_upload", to: "agent.extract_fields" },
          { id: "e2", from_: "agent.extract_fields", to: "tool.crm_update" },
        ],
      },
    });

    // Workflow 3: Slack message → generate ticket → assign
    await upsertWorkflowWithVersion({
      tenantId,
      workflowId: "wf-slack-ticket",
      slug: "slack-generate-ticket-assign",
      name: "Slack message → generate ticket → assign",
      description: "Turn Slack messages into tickets and assign to the right owner.",
      versionId: "wv-slack-ticket-v1",
      createdBy: "system",
      dagJson: {
        nodes: [
          {
            id: "trigger.slack_event",
            type: "trigger.slack_event",
            label: "Slack message",
            config: {},
          },
          {
            id: "agent.plan_and_execute",
            type: "agent.plan_and_execute",
            label: "Plan ticket creation",
            config: {},
          },
          {
            id: "tool.ticket_create",
            type: "tool.ticket_create",
            label: "Create ticket",
            config: {},
          },
          {
            id: "tool.ticket_assign",
            type: "tool.ticket_assign",
            label: "Assign ticket",
            config: {},
          },
        ],
        edges: [
          { id: "e1", from_: "trigger.slack_event", to: "agent.plan_and_execute" },
          { id: "e2", from_: "agent.plan_and_execute", to: "tool.ticket_create" },
          { id: "e3", from_: "tool.ticket_create", to: "tool.ticket_assign" },
        ],
      },
    });

    // Seed workflow templates
    const templates = [
      {
        id: "tpl-email-summarize",
        slug: "email-summarize-classify-notify",
        name: "Email → summarize → classify → notify",
        description: "Ingest emails, summarize them, classify, and send a notification.",
        category: "email",
        dagJson: {
          nodes: [
            { id: "trigger.email_received", type: "trigger.email_received", label: "Email received", config: {} },
            { id: "agent.summarize", type: "agent.summarize", label: "Summarize email", config: {} },
            { id: "agent.classify", type: "agent.classify", label: "Classify email", config: {} },
            { id: "tool.db_write", type: "tool.db_write", label: "Store in DB", config: {} },
            { id: "tool.slack_send_message", type: "tool.slack_send_message", label: "Notify via Slack", config: {} },
          ],
          edges: [
            { id: "e1", from_: "trigger.email_received", to: "agent.summarize" },
            { id: "e2", from_: "agent.summarize", to: "agent.classify" },
            { id: "e3", from_: "agent.classify", to: "tool.db_write" },
            { id: "e4", from_: "tool.db_write", to: "tool.slack_send_message" },
          ],
        },
      },
      {
        id: "tpl-upload-extract",
        slug: "upload-extract-update-crm",
        name: "Upload doc → extract fields → update CRM",
        description: "Extract structured fields from uploaded documents and sync to CRM.",
        category: "documents",
        dagJson: {
          nodes: [
            { id: "trigger.file_upload", type: "trigger.file_upload", label: "File upload", config: {} },
            { id: "agent.extract_fields", type: "agent.extract_fields", label: "Extract fields", config: {} },
            { id: "tool.crm_update", type: "tool.crm_update", label: "Update CRM", config: {} },
          ],
          edges: [
            { id: "e1", from_: "trigger.file_upload", to: "agent.extract_fields" },
            { id: "e2", from_: "agent.extract_fields", to: "tool.crm_update" },
          ],
        },
      },
      {
        id: "tpl-slack-ticket",
        slug: "slack-generate-ticket-assign",
        name: "Slack message → generate ticket → assign",
        description: "Turn Slack messages into tickets and assign to the right owner.",
        category: "support",
        dagJson: {
          nodes: [
            { id: "trigger.slack_event", type: "trigger.slack_event", label: "Slack message", config: {} },
            { id: "agent.plan_and_execute", type: "agent.plan_and_execute", label: "Plan ticket creation", config: {} },
            { id: "tool.ticket_create", type: "tool.ticket_create", label: "Create ticket", config: {} },
            { id: "tool.ticket_assign", type: "tool.ticket_assign", label: "Assign ticket", config: {} },
          ],
          edges: [
            { id: "e1", from_: "trigger.slack_event", to: "agent.plan_and_execute" },
            { id: "e2", from_: "agent.plan_and_execute", to: "tool.ticket_create" },
            { id: "e3", from_: "tool.ticket_create", to: "tool.ticket_assign" },
          ],
        },
      },
    ];

    for (const tpl of templates) {
      await query(
        `
          insert into workflow_templates (id, name, slug, description, category, dag_json)
          values ($1, $2, $3, $4, $5, $6)
          on conflict (id) do update
            set name = excluded.name,
                slug = excluded.slug,
                description = excluded.description,
                category = excluded.category,
                dag_json = excluded.dag_json
        `,
        [tpl.id, tpl.name, tpl.slug, tpl.description, tpl.category, tpl.dagJson]
      );
    }

    await query("commit");
    // eslint-disable-next-line no-console
    console.log("Seed completed successfully");
  } catch (err) {
    await query("rollback");
    // eslint-disable-next-line no-console
    console.error("Seed failed", err);
    process.exit(1);
  }
}

interface WorkflowSeedParams {
  tenantId: string;
  workflowId: string;
  slug: string;
  name: string;
  description: string;
  versionId: string;
  createdBy: string;
  dagJson: unknown;
}

async function upsertWorkflowWithVersion(params: WorkflowSeedParams) {
  const {
    tenantId,
    workflowId,
    slug,
    name,
    description,
    versionId,
    createdBy,
    dagJson,
  } = params;

  await query(
    `
      insert into workflows (id, tenant_id, name, slug, description, status)
      values ($1,$2,$3,$4,$5,'active')
      on conflict (id) do update
        set name = excluded.name,
            slug = excluded.slug,
            description = excluded.description,
            status = 'active'
    `,
    [workflowId, tenantId, name, slug, description]
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
      on conflict (id) do update
        set dag_json = excluded.dag_json,
            trigger_config_json = excluded.trigger_config_json,
            is_sandbox = excluded.is_sandbox
    `,
    [versionId, workflowId, dagJson, createdBy]
  );

  await query(
    `
      update workflows
      set current_version_id = $1
      where id = $2
    `,
    [versionId, workflowId]
  );
}

void seed();


