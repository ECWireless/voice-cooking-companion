import type { FastifyInstance, FastifyRequest } from "fastify";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import { audioFilePath } from "../audio.js";
import { requireApiToken } from "../auth.js";
import { config } from "../config.js";
import { synthesizeSpeech, transcribeAudio } from "../services/openai.js";
import { handleNextStep, handleTextQuery } from "../services/query-service.js";
import { fallbackSessionId, sessionIdFromFormRequest, sessionIdFromJsonRequest } from "../session.js";
import { createQueryEvent, listQueryEvents } from "../storage.js";
import type { QueryEventInput, QueryEventMode, QueryEventStage, QueryResult } from "../types.js";

type QueryBody = {
  inputMode?: unknown;
  query?: unknown;
  sessionId?: unknown;
  session?: unknown;
};

type AudioUpload = {
  bytes: Buffer;
  fileName: string;
  mimeType: string;
};

type AudioRequestContext = {
  request: FastifyRequest;
  startedAt: number;
  mode: QueryEventMode;
  sessionId: string;
  stage: QueryEventStage;
  audioFile?: AudioUpload;
  transcript?: string;
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

function summarizeAudioError(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("openai_api_key")) return "Audio processing is not configured yet.";
  if (message.includes("file too large") || message.includes("request file too large")) return "That audio file is too large.";
  if (message.includes("could not be decoded") || message.includes("format is not supported")) {
    return "That audio recording couldn't be decoded. Please try again.";
  }
  return "Sorry, I couldn't process that audio request.";
}

function statusCodeFromError(error: unknown, fallback: number): number {
  if (!error || typeof error !== "object") return fallback;
  const statusCode = (error as { statusCode?: unknown }).statusCode;
  return typeof statusCode === "number" && statusCode >= 400 && statusCode < 500 ? statusCode : fallback;
}

function elapsedMs(startedAt: number): number {
  return Date.now() - startedAt;
}

function shortError(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error.";
}

function logQueryEvent(input: QueryEventInput, request?: FastifyRequest): void {
  createQueryEvent(input);
  request?.log.info(
    {
      requestId: input.requestId,
      route: input.route,
      mode: input.mode,
      stage: input.stage,
      outcome: input.outcome,
      statusCode: input.statusCode,
      sessionId: input.sessionId,
      intent: input.intent,
      audioBytes: input.audioBytes,
      audioMimeType: input.audioMimeType,
      durationMs: input.durationMs
    },
    "query event"
  );
}

function logAudioEvent(
  context: AudioRequestContext,
  outcome: QueryEventInput["outcome"],
  statusCode: number,
  result?: QueryResult,
  error?: unknown
): void {
  logQueryEvent(
    {
      requestId: context.request.id,
      route: "/query-audio",
      mode: context.mode,
      stage: context.stage,
      outcome,
      statusCode,
      sessionId: context.sessionId,
      intent: result?.intent,
      audioBytes: context.audioFile?.bytes.length,
      audioMimeType: context.audioFile?.mimeType,
      audioFileName: context.audioFile?.fileName,
      transcript: context.transcript,
      errorMessage: error ? shortError(error) : undefined,
      durationMs: elapsedMs(context.startedAt)
    },
    context.request
  );
}

function isSupportedAudioFile(fileName: string, mimeType: string): boolean {
  const normalizedType = mimeType.split(";")[0]?.trim().toLowerCase() || "";
  if (["audio/wav", "audio/mpeg", "audio/webm", "audio/ogg", "audio/mp4", "audio/x-m4a", "audio/aac", "audio/x-aac"].includes(normalizedType)) {
    return true;
  }
  if (normalizedType) return false;

  const lowerName = fileName.toLowerCase();
  return [".wav", ".mp3", ".webm", ".ogg", ".m4a", ".aac"].some((extension) => lowerName.endsWith(extension));
}

async function withSynthesizedAudio(result: QueryResult): Promise<QueryResult> {
  if (!result.ok) return result;
  const audio = await synthesizeSpeech(result.answerText);
  return {
    ...result,
    audio: {
      mimeType: audio.mimeType,
      url: audio.url
    }
  };
}

async function collectMultipartAudio(request: FastifyRequest): Promise<{
  fields: Record<string, string>;
  audioFile: AudioUpload | null;
}> {
  const fields: Record<string, string> = {};
  let audioFile: AudioUpload | null = null;

  for await (const part of request.parts()) {
    if (part.type === "file") {
      if (part.fieldname !== "audio" && part.fieldname !== "file") {
        await part.file.resume();
        continue;
      }
      audioFile = {
        bytes: await part.toBuffer(),
        fileName: part.filename || "recording.wav",
        mimeType: part.mimetype || ""
      };
      continue;
    }

    if (typeof part.value === "string") fields[part.fieldname] = part.value;
  }

  return { fields, audioFile };
}

async function handleAudioNextStep(request: FastifyRequest, body: Record<string, unknown> | null): Promise<{
  result: QueryResult;
  statusCode: number;
}> {
  const startedAt = Date.now();
  const sessionId = sessionIdFromJsonRequest(request, body);
  const context: AudioRequestContext = {
    request,
    startedAt,
    mode: "audio_next_step",
    sessionId,
    stage: "validate"
  };

  if (body?.inputMode !== "next_step") {
    const result = baseError(sessionId, 'For JSON requests, provide inputMode as "next_step".');
    logAudioEvent(context, "error", 400, result, new Error("Invalid JSON inputMode."));
    return { result, statusCode: 400 };
  }

  if (!config.openaiApiKey) {
    const result = baseError(sessionId, "Audio processing is not configured yet.");
    logAudioEvent(context, "error", 500, result, new Error("OPENAI_API_KEY is not configured."));
    return { result, statusCode: 500 };
  }

  try {
    context.stage = "query";
    const textResult = handleNextStep(sessionId);
    context.stage = "synthesize";
    const result = await withSynthesizedAudio(textResult);
    context.stage = "response";
    logAudioEvent(context, result.ok ? "ok" : "error", result.ok ? 200 : 400, result, result.ok ? undefined : new Error(result.answerText));
    return { result, statusCode: result.ok ? 200 : 400 };
  } catch (error) {
    const result = baseError(sessionId, summarizeAudioError(error));
    logAudioEvent(context, "error", 500, result, error);
    return { result, statusCode: 500 };
  }
}

async function handleMultipartAudioQuery(request: FastifyRequest): Promise<{
  result: QueryResult;
  statusCode: number;
}> {
  const startedAt = Date.now();
  const context: AudioRequestContext = {
    request,
    startedAt,
    mode: "audio",
    sessionId: fallbackSessionId(),
    stage: "request"
  };
  let fields: Record<string, string> = {};

  try {
    const multipart = await collectMultipartAudio(request);
    fields = multipart.fields;
    context.sessionId = sessionIdFromFormRequest(request, fields);
    context.audioFile = multipart.audioFile ?? undefined;
    context.stage = "validate";

    if (!context.audioFile) {
      const result = baseError(context.sessionId, "Attach an audio file in the audio field.");
      logAudioEvent(context, "error", 400, result, new Error("Missing audio file."));
      return { result, statusCode: 400 };
    }

    if (!isSupportedAudioFile(context.audioFile.fileName, context.audioFile.mimeType)) {
      const result = baseError(context.sessionId, "Sorry, that audio format is not supported.");
      logAudioEvent(context, "error", 400, result, new Error(`Unsupported audio type: ${context.audioFile.mimeType || context.audioFile.fileName}`));
      return { result, statusCode: 400 };
    }

    if (context.audioFile.bytes.length <= 0 || context.audioFile.bytes.length > config.maxAudioBytes) {
      const result = baseError(context.sessionId, "Sorry, that audio file is too large or empty.");
      logAudioEvent(context, "error", 400, result, new Error(`Invalid audio size: ${context.audioFile.bytes.length}`));
      return { result, statusCode: 400 };
    }

    if (!config.openaiApiKey) {
      const result = baseError(context.sessionId, "Audio processing is not configured yet.");
      logAudioEvent(context, "error", 500, result, new Error("OPENAI_API_KEY is not configured."));
      return { result, statusCode: 500 };
    }

    context.stage = "transcribe";
    context.transcript = await transcribeAudio(context.audioFile);
    context.stage = "query";
    const textResult = handleTextQuery({ sessionId: context.sessionId, transcript: context.transcript });
    context.stage = "synthesize";
    const result = await withSynthesizedAudio(textResult);
    context.stage = "response";
    logAudioEvent(context, result.ok ? "ok" : "error", result.ok ? 200 : 400, result, result.ok ? undefined : new Error(result.answerText));
    return { result, statusCode: result.ok ? 200 : 400 };
  } catch (error) {
    context.sessionId = sessionIdFromFormRequest(request, fields);
    const statusCode = statusCodeFromError(error, 500);
    const result = baseError(context.sessionId, summarizeAudioError(error));
    logAudioEvent(context, "error", statusCode, result, error);
    return { result, statusCode };
  }
}

export async function registerQueryRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: QueryBody }>(
    "/query",
    {
      preHandler: requireApiToken
    },
    async (request, reply) => {
      const startedAt = Date.now();
      const body = request.body && typeof request.body === "object" ? (request.body as Record<string, unknown>) : null;
      const sessionId = sessionIdFromJsonRequest(request, body);
      const inputMode = body?.inputMode;

      if (inputMode !== "query" && inputMode !== "next_step") {
        const result = baseError(sessionId, 'Provide inputMode as "query" or "next_step".');
        logQueryEvent(
          {
            requestId: request.id,
            route: "/query",
            mode: "text",
            stage: "validate",
            outcome: "error",
            statusCode: 400,
            sessionId,
            errorMessage: "Invalid inputMode.",
            durationMs: elapsedMs(startedAt)
          },
          request
        );
        return reply.status(400).send(result);
      }

      if (inputMode === "next_step") {
        const result = handleNextStep(sessionId);
        logQueryEvent(
          {
            requestId: request.id,
            route: "/query",
            mode: "text",
            stage: "response",
            outcome: result.ok ? "ok" : "error",
            statusCode: result.ok ? 200 : 400,
            sessionId,
            intent: result.intent,
            transcript: result.transcript,
            errorMessage: result.ok ? undefined : result.answerText,
            durationMs: elapsedMs(startedAt)
          },
          request
        );
        return reply.status(result.ok ? 200 : 400).send(result);
      }

      if (typeof body?.query !== "string" || !body.query.trim()) {
        const result = baseError(sessionId, 'Provide query text in the query field when inputMode is "query".');
        logQueryEvent(
          {
            requestId: request.id,
            route: "/query",
            mode: "text",
            stage: "validate",
            outcome: "error",
            statusCode: 400,
            sessionId,
            errorMessage: "Missing query text.",
            durationMs: elapsedMs(startedAt)
          },
          request
        );
        return reply.status(400).send(result);
      }

      const result = handleTextQuery({ sessionId, transcript: body.query });
      logQueryEvent(
        {
          requestId: request.id,
          route: "/query",
          mode: "text",
          stage: "response",
          outcome: result.ok ? "ok" : "error",
          statusCode: result.ok ? 200 : 400,
          sessionId,
          intent: result.intent,
          transcript: result.transcript,
          errorMessage: result.ok ? undefined : result.answerText,
          durationMs: elapsedMs(startedAt)
        },
        request
      );
      return reply.status(result.ok ? 200 : 400).send(result);
    }
  );

  app.post<{ Body: QueryBody }>(
    "/query-audio",
    {
      preHandler: requireApiToken
    },
    async (request, reply) => {
      const contentType = request.headers["content-type"] || "";

      if (typeof contentType === "string" && contentType.includes("application/json")) {
        const body = request.body && typeof request.body === "object" ? (request.body as Record<string, unknown>) : null;
        const { result, statusCode } = await handleAudioNextStep(request, body);
        return reply.status(statusCode).send(result);
      }

      if (!(typeof contentType === "string" && contentType.includes("multipart/form-data"))) {
        const startedAt = Date.now();
        const sessionId = fallbackSessionId();
        const result = baseError(sessionId, 'Send multipart audio for spoken queries, or JSON with inputMode="next_step" for button advancement.');
        logQueryEvent(
          {
            requestId: request.id,
            route: "/query-audio",
            mode: "audio",
            stage: "validate",
            outcome: "error",
            statusCode: 400,
            sessionId,
            errorMessage: "Unsupported query-audio content type.",
            durationMs: elapsedMs(startedAt)
          },
          request
        );
        return reply.status(400).send(result);
      }

      const { result, statusCode } = await handleMultipartAudioQuery(request);
      return reply.status(statusCode).send(result);
    }
  );

  app.get(
    "/api/query-events",
    {
      preHandler: requireApiToken
    },
    async (request) => {
      const query = request.query as { limit?: string };
      const limit = query.limit ? Number.parseInt(query.limit, 10) : config.queryEventLimit;
      return {
        events: listQueryEvents(Number.isFinite(limit) ? limit : config.queryEventLimit),
        transcriptSnippets: config.queryEventTranscriptChars > 0,
        transcriptSnippetChars: Math.max(0, config.queryEventTranscriptChars)
      };
    }
  );

  app.get("/audio/:name", async (request, reply) => {
    const params = request.params as { name: string };
    const filePath = audioFilePath(params.name);
    if (!filePath) return reply.status(404).send({ ok: false, error: "Audio file not found." });

    try {
      await fs.access(filePath);
    } catch {
      return reply.status(404).send({ ok: false, error: "Audio file not found." });
    }

    return reply
      .type("audio/mpeg")
      .header("Cache-Control", "private, max-age=300")
      .send(createReadStream(filePath));
  });
}
