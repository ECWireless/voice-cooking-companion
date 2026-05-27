import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "./config.js";

const AUDIO_FILE_PATTERN = /^[a-zA-Z0-9._-]+\.mp3$/;

export type StoredAudio = {
  mimeType: "audio/mpeg";
  url: string;
  fileName: string;
};

export function isSafeAudioFileName(fileName: string): boolean {
  return AUDIO_FILE_PATTERN.test(fileName);
}

export async function storeGeneratedMp3(bytes: ArrayBuffer): Promise<StoredAudio> {
  await fs.mkdir(config.generatedAudioDir, { recursive: true });
  const fileName = `${Date.now()}-${randomUUID()}.mp3`;
  await fs.writeFile(path.join(config.generatedAudioDir, fileName), Buffer.from(bytes));
  const url = config.publicBaseUrl ? `${config.publicBaseUrl}/audio/${fileName}` : `/audio/${fileName}`;
  return {
    mimeType: "audio/mpeg",
    url,
    fileName
  };
}

export function audioFilePath(fileName: string): string | null {
  if (!isSafeAudioFileName(fileName)) return null;
  return path.join(config.generatedAudioDir, fileName);
}
