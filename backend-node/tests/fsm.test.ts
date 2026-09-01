import { describe, it, expect } from "vitest";
import { transitionRunState } from "../src/lib/fsm/runState";
import { transitionStepState } from "../src/lib/fsm/stepState";

describe("WorkflowRunState FSM", () => {
  it("allows PENDING → RUNNING", () => {
    expect(transitionRunState("PENDING", "RUNNING")).toBe("RUNNING");
  });

  it("allows RUNNING → SUCCEEDED", () => {
    expect(transitionRunState("RUNNING", "SUCCEEDED")).toBe("SUCCEEDED");
  });

  it("allows RUNNING → FAILED", () => {
    expect(transitionRunState("RUNNING", "FAILED")).toBe("FAILED");
  });

  it("rejects PENDING → SUCCEEDED (must go through RUNNING)", () => {
    expect(() => transitionRunState("PENDING", "SUCCEEDED")).toThrow(/Invalid/);
  });

  it("rejects SUCCEEDED → RUNNING (cannot reopen a succeeded run)", () => {
    expect(() => transitionRunState("SUCCEEDED", "RUNNING")).toThrow(/Invalid/);
  });

  it("allows SUCCEEDED → FAILED so a late step failure is not rolled back", () => {
    expect(transitionRunState("SUCCEEDED", "FAILED")).toBe("FAILED");
  });

  it("rejects FAILED → RUNNING (terminal state)", () => {
    expect(() => transitionRunState("FAILED", "RUNNING")).toThrow(/Invalid/);
  });

  it("allows idempotent transition (SUCCEEDED → SUCCEEDED)", () => {
    expect(transitionRunState("SUCCEEDED", "SUCCEEDED")).toBe("SUCCEEDED");
  });
});

describe("StepState FSM", () => {
  it("allows PENDING → RUNNING", () => {
    expect(transitionStepState("PENDING", "RUNNING")).toBe("RUNNING");
  });

  it("allows PENDING → SKIPPED", () => {
    expect(transitionStepState("PENDING", "SKIPPED")).toBe("SKIPPED");
  });

  it("allows RUNNING → SUCCEEDED", () => {
    expect(transitionStepState("RUNNING", "SUCCEEDED")).toBe("SUCCEEDED");
  });

  it("allows RUNNING → FAILED", () => {
    expect(transitionStepState("RUNNING", "FAILED")).toBe("FAILED");
  });

  it("rejects SUCCEEDED → RUNNING (terminal state)", () => {
    expect(() => transitionStepState("SUCCEEDED", "RUNNING")).toThrow(/Invalid/);
  });

  it("rejects SKIPPED → RUNNING (terminal state)", () => {
    expect(() => transitionStepState("SKIPPED", "RUNNING")).toThrow(/Invalid/);
  });
});
