/**
 * Prometheus-compatible metrics for the workflow platform.
 *
 * Only metrics that are actually incremented in the request/run path are registered.
 */

import client from "prom-client";

export const register = new client.Registry();

register.setDefaultLabels({ service: "backend-node" });
client.collectDefaultMetrics({ register });

export const workflowRunsTotal = new client.Counter({
  name: "workflow_runs_total",
  help: "Total number of workflow runs created",
  labelNames: ["tenant_id", "trigger_type", "status"] as const,
  registers: [register],
});

export const workflowStepsTotal = new client.Counter({
  name: "workflow_steps_total",
  help: "Total number of workflow step executions",
  labelNames: ["tenant_id", "node_type", "status"] as const,
  registers: [register],
});

export const failuresTotal = new client.Counter({
  name: "failures_total",
  help: "Total number of workflow execution failures",
  labelNames: ["tenant_id", "error_type"] as const,
  registers: [register],
});

export const httpRequestDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "Duration of HTTP requests in seconds",
  labelNames: ["method", "route", "status_code"] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});
