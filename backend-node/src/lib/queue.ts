import { Queue, Worker, Job } from "bullmq";
import { env } from "../config/env";
import IORedis from "ioredis";

export const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });

export const RUN_QUEUE_NAME = `${env.QUEUE_PREFIX}-workflow-runs`;
export const DEAD_LETTER_QUEUE_NAME = `${env.QUEUE_PREFIX}-dead-letter`;

export const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: "exponential" as const, delay: 2000 },
};

export interface RunJobPayload {
  runId: string;
  tenantId: string;
  snapshotDagJson: unknown;
  inputPayload: unknown;
  traceId: string | null;
  mode: "production" | "sandbox" | "test";
}

export const runQueue = new Queue<RunJobPayload>(RUN_QUEUE_NAME, {
  connection,
  defaultJobOptions: DEFAULT_JOB_OPTIONS,
});

export function createRunWorker(
  handler: (job: Job<RunJobPayload>) => Promise<void>
) {
  return new Worker<RunJobPayload>(RUN_QUEUE_NAME, handler, {
    connection,
  });
}


