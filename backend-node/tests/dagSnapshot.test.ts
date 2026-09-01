import { describe, it, expect } from "vitest";
import { countDagNodes } from "../src/lib/dagSnapshot";

describe("countDagNodes", () => {
  it("counts unique node ids in a snapshot", () => {
    expect(
      countDagNodes({
        nodes: [
          { id: "trigger.http_webhook", type: "trigger.http_webhook" },
          { id: "agent.plan_and_execute", type: "agent.plan_and_execute" },
          { id: "tool.slack_send_message", type: "tool.slack_send_message" },
        ],
        edges: [],
      })
    ).toBe(3);
  });

  it("returns 0 for missing or invalid snapshots", () => {
    expect(countDagNodes(null)).toBe(0);
    expect(countDagNodes({})).toBe(0);
    expect(countDagNodes({ nodes: "nope" })).toBe(0);
  });
});
