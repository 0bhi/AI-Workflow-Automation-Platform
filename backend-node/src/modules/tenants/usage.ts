import { randomUUID } from "crypto";
import { query } from "../../db/client";

function currentPeriod(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export interface UsageIncrement {
  runs?: number;
  steps?: number;
  toolCalls?: number;
  llmCalls?: number;
  llmTokens?: number;
  costCents?: number;
}

export async function recordRunUsage(
  tenantId: string,
  inc: UsageIncrement
): Promise<void> {
  const period = currentPeriod();
  const id = `usage_${randomUUID()}`;

  await query(
    `
      insert into tenant_usage (
        id, tenant_id, period,
        total_runs, total_steps, total_tool_calls,
        total_llm_calls, total_llm_tokens, estimated_cost_cents,
        updated_at
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
      on conflict (tenant_id, period)
      do update set
        total_runs = tenant_usage.total_runs + excluded.total_runs,
        total_steps = tenant_usage.total_steps + excluded.total_steps,
        total_tool_calls = tenant_usage.total_tool_calls + excluded.total_tool_calls,
        total_llm_calls = tenant_usage.total_llm_calls + excluded.total_llm_calls,
        total_llm_tokens = tenant_usage.total_llm_tokens + excluded.total_llm_tokens,
        estimated_cost_cents = tenant_usage.estimated_cost_cents + excluded.estimated_cost_cents,
        updated_at = now()
    `,
    [
      id,
      tenantId,
      period,
      inc.runs ?? 0,
      inc.steps ?? 0,
      inc.toolCalls ?? 0,
      inc.llmCalls ?? 0,
      inc.llmTokens ?? 0,
      inc.costCents ?? 0,
    ]
  );
}

export interface TenantUsageRecord {
  id: string;
  tenantId: string;
  period: string;
  totalRuns: number;
  totalSteps: number;
  totalToolCalls: number;
  totalLlmCalls: number;
  totalLlmTokens: number;
  estimatedCostCents: number;
  updatedAt: string;
}

export async function getTenantUsage(
  tenantId: string,
  period?: string
): Promise<TenantUsageRecord | null> {
  const p = period ?? currentPeriod();

  const result = await query<{
    id: string;
    tenant_id: string;
    period: string;
    total_runs: number;
    total_steps: number;
    total_tool_calls: number;
    total_llm_calls: number;
    total_llm_tokens: number;
    estimated_cost_cents: number;
    updated_at: string;
  }>(
    `
      select *
      from tenant_usage
      where tenant_id = $1
        and period = $2
      limit 1
    `,
    [tenantId, p]
  );

  const row = result.rows[0];
  if (!row) return null;

  return {
    id: row.id,
    tenantId: row.tenant_id,
    period: row.period,
    totalRuns: row.total_runs,
    totalSteps: row.total_steps,
    totalToolCalls: row.total_tool_calls,
    totalLlmCalls: row.total_llm_calls,
    totalLlmTokens: row.total_llm_tokens,
    estimatedCostCents: row.estimated_cost_cents,
    updatedAt: row.updated_at,
  };
}
