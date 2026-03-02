export type StepState = "PENDING" | "RUNNING" | "RETRYING" | "SUCCEEDED" | "FAILED" | "SKIPPED";

const ALLOWED_STEP_TRANSITIONS: Record<StepState, StepState[]> = {
  PENDING: ["RUNNING", "SKIPPED", "SUCCEEDED", "FAILED"],
  RUNNING: ["SUCCEEDED", "FAILED", "RETRYING"],
  RETRYING: ["RUNNING", "FAILED"],
  SUCCEEDED: [],
  FAILED: [],
  SKIPPED: [],
};

export function transitionStepState(current: StepState, next: StepState): StepState {
  const allowed = ALLOWED_STEP_TRANSITIONS[current];
  if (!allowed.includes(next)) {
    throw new Error(`Invalid workflow step state transition: ${current} → ${next}`);
  }
  return next;
}


