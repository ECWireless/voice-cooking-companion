import type { FastifyReply, FastifyRequest } from "fastify";
import { config } from "./config.js";

export async function requireApiToken(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!config.apiToken) return;

  const query = request.query as { token?: unknown };
  const fromQuery = typeof query.token === "string" ? query.token : "";
  const fromHeader = request.headers["x-api-token"];
  const headerValue = Array.isArray(fromHeader) ? fromHeader[0] : fromHeader;

  if (fromQuery === config.apiToken || headerValue === config.apiToken) return;

  await reply.status(401).send({
    ok: false,
    answerText: "API token is required."
  });
}
