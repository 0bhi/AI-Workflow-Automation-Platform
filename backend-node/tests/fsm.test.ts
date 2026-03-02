import { describe, it, expect } from "vitest";
import { transitionRunState, type WorkflowRunState } from "../src/lib/fsm/runState";
import { transitionStepState, type StepState } from "../src/lib/fsm/stepState";

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

  it("allows RUNNING → RETRYING", () => {
    expect(transitionRunState("RUNNING", "RETRYING")).toBe("RETRYING");
  });

  it("allows RUNNING → CANCELLED", () => {
    expect(transitionRunState("RUNNING", "CANCELLED")).toBe("CANCELLED");
  });

  it("allows RETRYING → RUNNING", () => {
    expect(transitionRunState("RETRYING", "RUNNING")).toBe("RUNNING");
  });

  it("rejects PENDING → SUCCEEDED (must go through RUNNING)", () => {
    expect(() => transitionRunState("PENDING", "SUCCEEDED")).toThrow(/Invalid/);
  });

  it("rejects SUCCEEDED → RUNNING (terminal state)", () => {
    expect(() => transitionRunState("SUCCEEDED", "RUNNING")).toThrow(/Invalid/);
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

  it("allows RUNNING → RETRYING", () => {
    expect(transitionStepState("RUNNING", "RETRYING")).toBe("RETRYING");
  });

  it("rejects SUCCEEDED → RUNNING (terminal state)", () => {
    expect(() => transitionStepState("SUCCEEDED", "RUNNING")).toThrow(/Invalid/);
  });

  it("rejects SKIPPED → RUNNING (terminal state)", () => {
    expect(() => transitionStepState("SKIPPED", "RUNNING")).toThrow(/Invalid/);
  });
});
