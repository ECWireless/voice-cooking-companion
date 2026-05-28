import { storeGeneratedMp3, type StoredAudio } from "../audio.js";
import { config } from "../config.js";
import type { RecipeInput } from "../types.js";

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

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : [];
}

export async function coerceRecipeMarkdown(markdown: string): Promise<RecipeInput> {
  const apiKey = requireOpenAIKey();

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    signal: AbortSignal.timeout(30000),
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: config.queryModel,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Convert recipe markdown or plain text into JSON only. Do not invent missing recipe facts. Return keys: title, description, ingredients, instructions, tags, notes. Ingredients, instructions, and tags must be arrays of strings."
        },
        {
          role: "user",
          content: markdown
        }
      ]
    })
  });

  if (!response.ok) throw new Error(`Recipe coercion failed: ${await readOpenAIError(response)}`);
  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("Recipe coercion returned no content.");

  const parsed = JSON.parse(content) as Record<string, unknown>;
  return {
    title: typeof parsed.title === "string" ? parsed.title.trim() : "",
    description: typeof parsed.description === "string" ? parsed.description.trim() : "",
    ingredients: stringList(parsed.ingredients),
    instructions: stringList(parsed.instructions),
    tags: stringList(parsed.tags),
    notes: typeof parsed.notes === "string" ? parsed.notes.trim() : ""
  };
}
