import { pool } from "../db/client";
import { connection as redisConnection } from "./queue";

export interface HealthStatus {
  postgres: boolean;
  redis: boolean;
}

export async function checkHealth(): Promise<HealthStatus> {
  const status: HealthStatus = { postgres: false, redis: false };

  const pgCheck = pool
    .query("SELECT 1")
    .then(() => {
      status.postgres = true;
    })
    .catch(() => {});

  const redisCheck = redisConnection
    .ping()
    .then(() => {
      status.redis = true;
    })
    .catch(() => {});

  await Promise.all([pgCheck, redisCheck]);

  return status;
}
