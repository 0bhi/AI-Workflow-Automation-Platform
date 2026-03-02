/**
 * Prometheus-compatible metrics for the workflow platform.
 *
 * Exposes counters, histograms, and gauges that are scraped via /metrics.
 * Uses prom-client for the registry and metric types.
 */

import client from "prom-client";

export const register = new client.Registry();

register.setDefaultLabels({ service: "backend-node" });
client.collectDefaultMetrics({ register });

// --- Counters ---

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

export const toolCallsTotal = new client.Counter({
  name: "tool_calls_total",
  help: "Total number of tool invocations",
  labelNames: ["tenant_id", "tool_name"] as const,
  registers: [register],
});

export const llmCallsTotal = new client.Counter({
  name: "llm_calls_total",
  help: "Total number of LLM API calls made by agent nodes",
  labelNames: ["tenant_id", "model"] as const,
  registers: [register],
});

export const llmTokensTotal = new client.Counter({
  name: "llm_tokens_total",
  help: "Total LLM tokens consumed",
  labelNames: ["tenant_id", "model"] as const,
  registers: [register],
});

export const failuresTotal = new client.Counter({
  name: "failures_total",
  help: "Total number of workflow execution failures",
  labelNames: ["tenant_id", "error_type"] as const,
  registers: [register],
});

export const authAttemptsTotal = new client.Counter({
  name: "auth_attempts_total",
  help: "Total authentication attempts",
  labelNames: ["method", "success"] as const,
  registers: [register],
});

// --- Histograms ---

export const httpRequestDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "Duration of HTTP requests in seconds",
  labelNames: ["method", "route", "status_code"] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

export const workflowRunDuration = new client.Histogram({
  name: "workflow_run_duration_seconds",
  help: "Duration of workflow run execution in seconds",
  labelNames: ["tenant_id", "trigger_type"] as const,
  buckets: [0.1, 0.5, 1, 5, 10, 30, 60, 120, 300],
  registers: [register],
});

export const agentIterationsHistogram = new client.Histogram({
  name: "agent_iterations_total",
  help: "Number of agent loop iterations per agent node execution",
  labelNames: ["tenant_id"] as const,
  buckets: [1, 2, 3, 5, 8, 10, 15],
  registers: [register],
});

// --- Gauges ---

export const activeRunsGauge = new client.Gauge({
  name: "active_workflow_runs",
  help: "Number of currently running workflow runs",
  labelNames: ["tenant_id"] as const,
  registers: [register],
});

export const queueSizeGauge = new client.Gauge({
  name: "queue_waiting_jobs",
  help: "Number of jobs waiting in the run queue",
  registers: [register],
});
