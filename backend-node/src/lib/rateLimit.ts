import type { FastifyRequest, FastifyReply, HookHandlerDoneFunction } from "fastify";

interface WindowEntry {
  timestamps: number[];
}

const windows = new Map<string, WindowEntry>();

const CLEANUP_INTERVAL_MS = 60_000;

setInterval(() => {
  const cutoff = Date.now() - 120_000;
  for (const [key, entry] of windows) {
    entry.timestamps = entry.timestamps.filter((t) => t > cutoff);
    if (entry.timestamps.length === 0) {
      windows.delete(key);
    }
  }
}, CLEANUP_INTERVAL_MS).unref();

function getClientIp(request: FastifyRequest): string {
  const forwarded = request.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    return forwarded.split(",")[0]?.trim() ?? request.ip;
  }
  return request.ip;
}

export function createRateLimiter(maxRequests: number, windowMs: number) {
  return function rateLimitHook(
    request: FastifyRequest,
    reply: FastifyReply,
    done: HookHandlerDoneFunction
  ) {
    const ip = getClientIp(request);
    const key = `${ip}:${maxRequests}:${windowMs}`;
    const now = Date.now();
    const windowStart = now - windowMs;

    let entry = windows.get(key);
    if (!entry) {
      entry = { timestamps: [] };
      windows.set(key, entry);
    }

    entry.timestamps = entry.timestamps.filter((t) => t > windowStart);

    if (entry.timestamps.length >= maxRequests) {
      reply
        .code(429)
        .header("Retry-After", String(Math.ceil(windowMs / 1000)))
        .send({ error: "Too many requests" });
      return;
    }

    entry.timestamps.push(now);
    done();
  };
}

export const authRateLimit = createRateLimiter(10, 60_000);
export const hooksRateLimit = createRateLimiter(60, 60_000);

const MAX_BODY_BYTES = 1 * 1024 * 1024; // 1MB

export function contentLengthCheck(
  request: FastifyRequest,
  reply: FastifyReply,
  done: HookHandlerDoneFunction
) {
  const contentLength = request.headers["content-length"];
  if (contentLength && Number(contentLength) > MAX_BODY_BYTES) {
    reply.code(413).send({ error: "Payload too large (max 1MB)" });
    return;
  }
  done();
}
