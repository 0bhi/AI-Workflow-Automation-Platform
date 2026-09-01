export type WorkflowRunState = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";

const ALLOWED_RUN_TRANSITIONS: Record<WorkflowRunState, WorkflowRunState[]> = {
  PENDING: ["RUNNING"],
  RUNNING: ["SUCCEEDED", "FAILED"],
  SUCCEEDED: [],
  FAILED: [],
};

export function transitionRunState(current: WorkflowRunState, next: WorkflowRunState): WorkflowRunState {
  // Allow idempotent transitions (e.g. SUCCEEDED → SUCCEEDED) as no-ops.
  if (current === next) {
    return current;
  }

  const allowed = ALLOWED_RUN_TRANSITIONS[current];
  if (!allowed.includes(next)) {
    throw new Error(`Invalid workflow run state transition: ${current} → ${next}`);
  }
  return next;
}
