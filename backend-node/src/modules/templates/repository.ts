import { randomUUID } from "crypto";
import { query } from "../../db/client";

export interface WorkflowTemplate {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  category: string;
  dagJson: unknown;
  createdAt: string;
}

export async function listTemplates(): Promise<WorkflowTemplate[]> {
  const result = await query<{
    id: string;
    name: string;
    slug: string;
    description: string | null;
    category: string;
    dag_json: unknown;
    created_at: string;
  }>(
    `
      select id, name, slug, description, category, dag_json, created_at
      from workflow_templates
      order by category, name
    `
  );

  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    category: row.category,
    dagJson: row.dag_json,
    createdAt: row.created_at,
  }));
}

export async function importTemplatesForTenant(
  tenantId: string,
  templateIds?: string[]
): Promise<Array<{ id: string; name: string; slug: string; description?: string; status: string }>> {
  let templates: Array<{
    id: string;
    name: string;
    slug: string;
    description: string | null;
    dag_json: unknown;
  }>;

  if (templateIds && templateIds.length > 0) {
    const placeholders = templateIds.map((_, i) => `$${i + 1}`).join(", ");
    const result = await query<{
      id: string;
      name: string;
      slug: string;
      description: string | null;
      dag_json: unknown;
    }>(
      `select id, name, slug, description, dag_json from workflow_templates where id in (${placeholders})`,
      templateIds
    );
    templates = result.rows;
  } else {
    const result = await query<{
      id: string;
      name: string;
      slug: string;
      description: string | null;
      dag_json: unknown;
    }>(
      `select id, name, slug, description, dag_json from workflow_templates order by name`
    );
    templates = result.rows;
  }

  const created: Array<{ id: string; name: string; slug: string; description?: string; status: string }> = [];

  for (const tpl of templates) {
    const workflowId = `wf-${randomUUID()}`;
    const versionId = `wv-${randomUUID()}`;

    const existing = await query<{ id: string }>(
      `select id from workflows where tenant_id = $1 and slug = $2 limit 1`,
      [tenantId, tpl.slug]
    );
    if (existing.rows[0]) {
      continue;
    }

    await query(
      `
        insert into workflows (id, tenant_id, name, slug, description, status)
        values ($1, $2, $3, $4, $5, 'active')
      `,
      [workflowId, tenantId, tpl.name, tpl.slug, tpl.description]
    );

    await query(
      `
        insert into workflow_versions (
          id, workflow_id, version_number, dag_json,
          trigger_config_json, is_sandbox, created_by
        ) values ($1, $2, 1, $3, '{}'::jsonb, false, 'system')
      `,
      [versionId, workflowId, tpl.dag_json]
    );

    await query(
      `update workflows set current_version_id = $1 where id = $2`,
      [versionId, workflowId]
    );

    created.push({
      id: workflowId,
      name: tpl.name,
      slug: tpl.slug,
      description: tpl.description ?? undefined,
      status: "active",
    });
  }

  return created;
}
