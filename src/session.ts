import { randomUUID } from "node:crypto";
import type { FastifyRequest } from "fastify";

export function fallbackSessionId(): string {
  return `sess_${randomUUID()}`;
}

export function sessionIdFromJsonRequest(request: FastifyRequest, body: Record<string, unknown> | null): string {
  const fromBody = typeof body?.sessionId === "string" ? body.sessionId.trim() : "";
  if (fromBody) return fromBody;

  const nested = body?.session;
  if (nested && typeof nested === "object") {
    const fromNested = (nested as { id?: unknown }).id;
    if (typeof fromNested === "string" && fromNested.trim()) return fromNested.trim();
  }

  const fromHeader = request.headers["x-session-id"];
  const headerValue = Array.isArray(fromHeader) ? fromHeader[0] : fromHeader;
  if (headerValue?.trim()) return headerValue.trim();

  return fallbackSessionId();
}
