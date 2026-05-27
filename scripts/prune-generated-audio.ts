import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../src/config.js";

const cutoffMs = Date.now() - config.generatedAudioTtlHours * 60 * 60 * 1000;

async function pruneGeneratedAudio(): Promise<void> {
  await fs.mkdir(config.generatedAudioDir, { recursive: true });
  const entries = await fs.readdir(config.generatedAudioDir, { withFileTypes: true });
  let deleted = 0;
  let kept = 0;

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".mp3")) continue;
    const filePath = path.join(config.generatedAudioDir, entry.name);
    const stat = await fs.stat(filePath);
    if (stat.mtimeMs < cutoffMs) {
      await fs.unlink(filePath);
      deleted += 1;
    } else {
      kept += 1;
    }
  }

  console.log(
    JSON.stringify({
      ok: true,
      generatedAudioDir: config.generatedAudioDir,
      ttlHours: config.generatedAudioTtlHours,
      deleted,
      kept
    })
  );
}

await pruneGeneratedAudio();
