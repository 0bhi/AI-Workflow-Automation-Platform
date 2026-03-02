import { randomUUID } from "crypto";
import { query } from "../../db/client";

export interface WorkflowSchedule {
  id: string;
  tenantId: string;
  workflowId: string;
  cronExpression: string;
  timezone: string;
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  inputPayloadJson: unknown;
  createdAt: string;
  updatedAt: string;
}

function rowToSchedule(row: Record<string, any>): WorkflowSchedule {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    workflowId: row.workflow_id,
    cronExpression: row.cron_expression,
    timezone: row.timezone,
    enabled: row.enabled,
    lastRunAt: row.last_run_at,
    nextRunAt: row.next_run_at,
    inputPayloadJson: row.input_payload_json,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listSchedules(tenantId: string): Promise<WorkflowSchedule[]> {
  const result = await query(
    `select * from workflow_schedules where tenant_id = $1 order by created_at desc`,
    [tenantId]
  );
  return result.rows.map(rowToSchedule);
}

export async function createSchedule(params: {
  tenantId: string;
  workflowId: string;
  cronExpression: string;
  timezone?: string;
  inputPayloadJson?: unknown;
}): Promise<WorkflowSchedule> {
  const id = `sched_${randomUUID()}`;
  const nextRunAt = computeNextRun(params.cronExpression, params.timezone ?? "UTC");

  const result = await query(
    `
      insert into workflow_schedules (
        id, tenant_id, workflow_id, cron_expression, timezone, enabled, next_run_at, input_payload_json
      )
      values ($1, $2, $3, $4, $5, true, $6, $7)
      returning *
    `,
    [
      id,
      params.tenantId,
      params.workflowId,
      params.cronExpression,
      params.timezone ?? "UTC",
      nextRunAt?.toISOString() ?? null,
      params.inputPayloadJson ?? {},
    ]
  );
  return rowToSchedule(result.rows[0]);
}

export async function updateSchedule(params: {
  tenantId: string;
  id: string;
  enabled?: boolean;
  cronExpression?: string;
  timezone?: string;
  inputPayloadJson?: unknown;
}): Promise<WorkflowSchedule | null> {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (params.enabled !== undefined) {
    fields.push(`enabled = $${fields.length + 3}`);
    values.push(params.enabled);
  }
  if (params.cronExpression !== undefined) {
    fields.push(`cron_expression = $${fields.length + 3}`);
    values.push(params.cronExpression);
  }
  if (params.timezone !== undefined) {
    fields.push(`timezone = $${fields.length + 3}`);
    values.push(params.timezone);
  }
  if (params.inputPayloadJson !== undefined) {
    fields.push(`input_payload_json = $${fields.length + 3}`);
    values.push(params.inputPayloadJson);
  }

  if (fields.length === 0) return null;

  fields.push("updated_at = now()");

  const newCron = params.cronExpression;
  const newTz = params.timezone;
  if (newCron) {
    const nextRunAt = computeNextRun(newCron, newTz ?? "UTC");
    fields.push(`next_run_at = $${fields.length + 3}`);
    values.push(nextRunAt?.toISOString() ?? null);
  }

  const result = await query(
    `
      update workflow_schedules
      set ${fields.join(", ")}
      where id = $1 and tenant_id = $2
      returning *
    `,
    [params.id, params.tenantId, ...values]
  );

  return result.rows[0] ? rowToSchedule(result.rows[0]) : null;
}

export async function deleteSchedule(tenantId: string, id: string): Promise<void> {
  await query(
    `delete from workflow_schedules where id = $1 and tenant_id = $2`,
    [id, tenantId]
  );
}

export async function getDueSchedules(): Promise<WorkflowSchedule[]> {
  const result = await query(
    `
      select *
      from workflow_schedules
      where enabled = true
        and next_run_at <= now()
      order by next_run_at asc
      limit 50
    `
  );
  return result.rows.map(rowToSchedule);
}

export async function markScheduleRun(
  scheduleId: string,
  cronExpression: string,
  timezone: string
): Promise<void> {
  const nextRunAt = computeNextRun(cronExpression, timezone);
  await query(
    `
      update workflow_schedules
      set last_run_at = now(),
          next_run_at = $2,
          updated_at = now()
      where id = $1
    `,
    [scheduleId, nextRunAt?.toISOString() ?? null]
  );
}

/**
 * Minimal cron-to-next-run calculator.
 * Supports: minute hour day-of-month month day-of-week (standard 5-field cron).
 * For production, replace with a library like `cron-parser`.
 */
export function computeNextRun(cronExpr: string, _timezone: string): Date | null {
  try {
    const parts = cronExpr.trim().split(/\s+/);
    if (parts.length !== 5) return null;

    const now = new Date();
    const candidate = new Date(now.getTime() + 60_000);
    candidate.setSeconds(0, 0);

    // Simple implementation: advance minute-by-minute up to 48 hours
    const maxAttempts = 48 * 60;
    for (let i = 0; i < maxAttempts; i++) {
      if (matchesCron(parts, candidate)) return candidate;
      candidate.setTime(candidate.getTime() + 60_000);
    }
    return null;
  } catch {
    return null;
  }
}

function matchesCron(parts: string[], date: Date): boolean {
  const minute = date.getUTCMinutes();
  const hour = date.getUTCHours();
  const dayOfMonth = date.getUTCDate();
  const month = date.getUTCMonth() + 1;
  const dayOfWeek = date.getUTCDay();

  return (
    fieldMatches(parts[0], minute, 0, 59) &&
    fieldMatches(parts[1], hour, 0, 23) &&
    fieldMatches(parts[2], dayOfMonth, 1, 31) &&
    fieldMatches(parts[3], month, 1, 12) &&
    fieldMatches(parts[4], dayOfWeek, 0, 6)
  );
}

function fieldMatches(field: string, value: number, _min: number, _max: number): boolean {
  if (field === "*") return true;

  // Handle */N (step)
  if (field.startsWith("*/")) {
    const step = parseInt(field.slice(2), 10);
    return !isNaN(step) && step > 0 && value % step === 0;
  }

  // Handle comma-separated values
  const values = field.split(",");
  for (const v of values) {
    if (v.includes("-")) {
      const [lo, hi] = v.split("-").map(Number);
      if (value >= lo && value <= hi) return true;
    } else {
      if (parseInt(v, 10) === value) return true;
    }
  }

  return false;
}
