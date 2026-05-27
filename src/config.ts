import "dotenv/config";
import path from "node:path";

function numberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boolFromEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw) return fallback;
  return raw === "1" || raw.toLowerCase() === "true";
}

const openaiApiKey = process.env.OPENAI_API_KEY?.trim() || "";

export const config = {
  host: process.env.HOST || "0.0.0.0",
  port: numberFromEnv("PORT", 3000),
  apiToken: process.env.API_TOKEN?.trim() || "",
  publicBaseUrl: process.env.PUBLIC_BASE_URL?.replace(/\/+$/, "") || "",
  openaiApiKey,
  transcriptionModel: process.env.OPENAI_TRANSCRIPTION_MODEL || "whisper-1",
  queryModel: process.env.OPENAI_QUERY_MODEL || "gpt-4.1-nano",
  ttsModel: process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts",
  ttsVoice: process.env.OPENAI_TTS_VOICE || "alloy",
  dataDir: path.resolve(process.env.DATA_DIR || "./data"),
  generatedAudioDir: path.resolve(process.env.GENERATED_AUDIO_DIR || "./generated-audio"),
  generatedAudioTtlHours: numberFromEnv("GENERATED_AUDIO_TTL_HOURS", 24),
  maxAudioBytes: numberFromEnv("MAX_AUDIO_BYTES", 8 * 1024 * 1024),
  enableRecipeLlmCoercion: boolFromEnv("ENABLE_RECIPE_LLM_COERCION", Boolean(openaiApiKey)),
  debugQuery: process.env.DEBUG_QUERY === "1"
};
