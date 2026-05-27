import type { FastifyInstance } from "fastify";
import { requireApiToken } from "../auth.js";
import { handleNextStep, handleTextQuery } from "../services/query-service.js";
import { sessionIdFromJsonRequest } from "../session.js";
import type { QueryResult } from "../types.js";

type QueryBody = {
  inputMode?: unknown;
  query?: unknown;
  sessionId?: unknown;
  session?: unknown;
};

function baseError(sessionId: string, answerText: string): QueryResult {
  return {
    ok: false,
    answerText,
    session: {
      id: sessionId,
      activeRecipeId: null,
      stepIndex: 0,
      phase: "ingredients"
    }
  };
}

export async function registerQueryRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: QueryBody }>(
    "/query",
    {
      preHandler: requireApiToken
    },
    async (request, reply) => {
      const body = request.body && typeof request.body === "object" ? (request.body as Record<string, unknown>) : null;
      const sessionId = sessionIdFromJsonRequest(request, body);
      const inputMode = body?.inputMode;

      if (inputMode !== "query" && inputMode !== "next_step") {
        return reply.status(400).send(baseError(sessionId, 'Provide inputMode as "query" or "next_step".'));
      }

      if (inputMode === "next_step") {
        const result = handleNextStep(sessionId);
        return reply.status(result.ok ? 200 : 400).send(result);
      }

      if (typeof body?.query !== "string" || !body.query.trim()) {
        return reply.status(400).send(baseError(sessionId, 'Provide query text in the query field when inputMode is "query".'));
      }

      const result = handleTextQuery({ sessionId, transcript: body.query });
      return reply.status(result.ok ? 200 : 400).send(result);
    }
  );
}
