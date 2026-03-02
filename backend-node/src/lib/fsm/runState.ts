export type WorkflowRunState =
  | "PENDING"
  | "RUNNING"
  | "WAITING_FOR_EXTERNAL"
  | "RETRYING"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED";

const ALLOWED_RUN_TRANSITIONS: Record<WorkflowRunState, WorkflowRunState[]> = {
  PENDING: ["RUNNING"],
  RUNNING: ["WAITING_FOR_EXTERNAL", "RETRYING", "SUCCEEDED", "FAILED", "CANCELLED"],
  WAITING_FOR_EXTERNAL: ["RUNNING", "FAILED", "CANCELLED"],
  RETRYING: ["RUNNING", "FAILED"],
  SUCCEEDED: [],
  FAILED: [],
  CANCELLED: [],
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


