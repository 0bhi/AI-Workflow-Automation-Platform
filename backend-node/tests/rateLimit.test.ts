import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRateLimiter } from "../src/lib/rateLimit";
import type { FastifyRequest, FastifyReply, HookHandlerDoneFunction } from "fastify";

function mockRequest(ip: string): FastifyRequest {
  return {
    ip,
    headers: {},
  } as unknown as FastifyRequest;
}

function mockReply(): FastifyReply & { sentCode: number | null; sentBody: any } {
  const reply = {
    sentCode: null as number | null,
    sentBody: null as any,
    code(n: number) {
      this.sentCode = n;
      return this;
    },
    header(_k: string, _v: string) {
      return this;
    },
    send(body: any) {
      this.sentBody = body;
      return this;
    },
  };
  return reply as any;
}

describe("createRateLimiter", () => {
  it("allows requests under the limit", () => {
    const limiter = createRateLimiter(3, 60_000);
    const req = mockRequest("10.0.0.1");

    for (let i = 0; i < 3; i++) {
      const reply = mockReply();
      const done = vi.fn();
      limiter(req, reply, done);
      expect(done).toHaveBeenCalled();
      expect(reply.sentCode).toBeNull();
    }
  });

  it("blocks requests over the limit with 429", () => {
    const limiter = createRateLimiter(2, 60_000);
    const req = mockRequest("10.0.0.2");

    // First two succeed
    for (let i = 0; i < 2; i++) {
      const reply = mockReply();
      const done = vi.fn();
      limiter(req, reply, done);
    }

    // Third should be blocked
    const reply = mockReply();
    const done = vi.fn();
    limiter(req, reply, done);
    expect(reply.sentCode).toBe(429);
    expect(done).not.toHaveBeenCalled();
  });

  it("isolates rate limits per IP", () => {
    const limiter = createRateLimiter(1, 60_000);

    const req1 = mockRequest("10.0.0.3");
    const req2 = mockRequest("10.0.0.4");

    const reply1 = mockReply();
    const done1 = vi.fn();
    limiter(req1, reply1, done1);
    expect(done1).toHaveBeenCalled();

    const reply2 = mockReply();
    const done2 = vi.fn();
    limiter(req2, reply2, done2);
    expect(done2).toHaveBeenCalled();

    // req1 again should be blocked
    const reply1b = mockReply();
    const done1b = vi.fn();
    limiter(req1, reply1b, done1b);
    expect(reply1b.sentCode).toBe(429);
  });
});
