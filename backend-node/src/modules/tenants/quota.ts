import { query } from "../../db/client";

export async function assertTenantRunQuota(tenantId: string): Promise<void> {
  const tenantResult = await query<{
    max_monthly_runs: number;
  }>(
    `
      select max_monthly_runs
      from tenants
      where id = $1
      limit 1
    `,
    [tenantId]
  );

  const tenant = tenantResult.rows[0];
  if (!tenant) {
    throw new Error("Tenant not found");
  }

  const runsResult = await query<{
    count: string;
  }>(
    `
      select count(*)::text as count
      from workflow_runs
      where tenant_id = $1
        and started_at >= date_trunc('month', now())
    `,
    [tenantId]
  );

  const used = Number.parseInt(runsResult.rows[0]?.count ?? "0", 10);
  if (used >= tenant.max_monthly_runs) {
    const error = new Error("Tenant run quota exceeded");
    (error as any).statusCode = 429;
    throw error;
  }
}


