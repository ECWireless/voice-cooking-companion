import type { FastifyInstance } from "fastify";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import { audioFilePath } from "../audio.js";
import { requireApiToken } from "../auth.js";
import { config } from "../config.js";
import { synthesizeSpeech, transcribeAudio } from "../services/openai.js";
import { handleNextStep, handleTextQuery } from "../services/query-service.js";
import { fallbackSessionId, sessionIdFromFormRequest, sessionIdFromJsonRequest } from "../session.js";
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

function summarizeAudioError(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("openai_api_key")) return "Audio processing is not configured yet.";
  if (message.includes("file too large") || message.includes("request file too large")) return "That audio file is too large.";
  if (message.includes("could not be decoded") || message.includes("format is not supported")) {
    return "That audio recording couldn't be decoded. Please try again.";
  }
  return "Sorry, I couldn't process that audio request.";
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

  app.post<{ Body: QueryBody }>(
    "/query-audio",
    {
      preHandler: requireApiToken
    },
    async (request, reply) => {
      const contentType = request.headers["content-type"] || "";

      if (typeof contentType === "string" && contentType.includes("application/json")) {
        const body = request.body && typeof request.body === "object" ? (request.body as Record<string, unknown>) : null;
        const sessionId = sessionIdFromJsonRequest(request, body);

        if (body?.inputMode !== "next_step") {
          return reply.status(400).send(baseError(sessionId, 'For JSON requests, provide inputMode as "next_step".'));
        }

        if (!config.openaiApiKey) {
          return reply.status(500).send(baseError(sessionId, "Audio processing is not configured yet."));
        }

        try {
          const result = await withSynthesizedAudio(handleNextStep(sessionId));
          return reply.status(result.ok ? 200 : 400).send(result);
        } catch (error) {
          return reply.status(500).send(baseError(sessionId, summarizeAudioError(error)));
        }
      }

      if (!(typeof contentType === "string" && contentType.includes("multipart/form-data"))) {
        const sessionId = fallbackSessionId();
        return reply
          .status(400)
          .send(baseError(sessionId, 'Send multipart audio for spoken queries, or JSON with inputMode="next_step" for button advancement.'));
      }

      const fields: Record<string, string> = {};
      let audioFile: { bytes: Buffer; fileName: string; mimeType: string } | null = null;

      try {
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

        const sessionId = sessionIdFromFormRequest(request, fields);

        if (!audioFile) {
          return reply.status(400).send(baseError(sessionId, "Attach an audio file in the audio field."));
        }

        if (!isSupportedAudioFile(audioFile.fileName, audioFile.mimeType)) {
          return reply.status(400).send(baseError(sessionId, "Sorry, that audio format is not supported."));
        }

        if (audioFile.bytes.length <= 0 || audioFile.bytes.length > config.maxAudioBytes) {
          return reply.status(400).send(baseError(sessionId, "Sorry, that audio file is too large or empty."));
        }

        if (!config.openaiApiKey) {
          return reply.status(500).send(baseError(sessionId, "Audio processing is not configured yet."));
        }

        const transcript = await transcribeAudio(audioFile);
        const result = await withSynthesizedAudio(handleTextQuery({ sessionId, transcript }));
        return reply.status(result.ok ? 200 : 400).send(result);
      } catch (error) {
        const sessionId = sessionIdFromFormRequest(request, fields);
        return reply.status(500).send(baseError(sessionId, summarizeAudioError(error)));
      }
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
