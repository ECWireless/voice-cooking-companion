import { storeGeneratedMp3, type StoredAudio } from "../audio.js";
import { config } from "../config.js";

export class OpenAIConfigError extends Error {
  constructor() {
    super("OPENAI_API_KEY is not configured.");
    this.name = "OpenAIConfigError";
  }
}

function requireOpenAIKey(): string {
  if (!config.openaiApiKey) throw new OpenAIConfigError();
  return config.openaiApiKey;
}

async function readOpenAIError(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  return text.slice(0, 500) || `${response.status} ${response.statusText}`;
}

export async function transcribeAudio(options: {
  bytes: Buffer;
  fileName: string;
  mimeType: string;
}): Promise<string> {
  const apiKey = requireOpenAIKey();
  const form = new FormData();
  const uploadBytes = new Uint8Array(options.bytes);
  const blob = new Blob([uploadBytes], { type: options.mimeType || "application/octet-stream" });
  form.set("model", config.transcriptionModel);
  form.set("file", blob, options.fileName || "recording.wav");

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    signal: AbortSignal.timeout(30000),
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`
    },
    body: form
  });

  if (!response.ok) throw new Error(`Transcription failed: ${await readOpenAIError(response)}`);
  const data = (await response.json()) as { text?: unknown };
  return typeof data.text === "string" ? data.text.trim() : "";
}

export async function synthesizeSpeech(answerText: string): Promise<StoredAudio> {
  const apiKey = requireOpenAIKey();

  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    signal: AbortSignal.timeout(30000),
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: config.ttsModel,
      voice: config.ttsVoice,
      input: answerText,
      format: "mp3"
    })
  });

  if (!response.ok) throw new Error(`TTS failed: ${await readOpenAIError(response)}`);
  return storeGeneratedMp3(await response.arrayBuffer());
}
