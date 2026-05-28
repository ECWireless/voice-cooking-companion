import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "voice-cooking-flow-check-"));
process.env.DATA_DIR = dataDir;
process.env.QUERY_EVENT_TRANSCRIPT_CHARS = "16";

const { createQueryEvent, listQueryEvents, seedInitialRecipe } = await import("../src/storage.js");
const { handleNextStep, handleTextQuery } = await import("../src/services/query-service.js");

seedInitialRecipe();

const sessionId = "flow-check-session";
const lookup = handleTextQuery({ sessionId, transcript: "Find lemon garlic pasta" });
assert.equal(lookup.ok, true);
assert.equal(lookup.intent, "recipe_lookup");
assert.match(lookup.answerText, /Want ingredients or the first step/);
assert.equal(lookup.session.phase, "ingredients");

const ingredients = handleTextQuery({ sessionId, transcript: "ingredients please" });
assert.equal(ingredients.ok, true);
assert.match(ingredients.answerText, /Ingredients for Weeknight Lemon Garlic Pasta/);
assert.equal(ingredients.session.phase, "ingredients");

const firstStep = handleTextQuery({ sessionId, transcript: "first step" });
assert.equal(firstStep.ok, true);
assert.equal(firstStep.intent, "next_step");
assert.match(firstStep.answerText, /^Step 1\./);
assert.equal(firstStep.session.phase, "steps");

const next = handleNextStep(sessionId, "next");
assert.equal(next.ok, true);
assert.match(next.answerText, /^Step 2\./);
assert.equal(next.session.stepIndex, 1);

const repeat = handleTextQuery({ sessionId, transcript: "repeat that" });
assert.equal(repeat.ok, true);
assert.equal(repeat.intent, "repeat_step");
assert.equal(repeat.answerText, next.answerText);

const where = handleTextQuery({ sessionId, transcript: "where am I" });
assert.equal(where.ok, true);
assert.match(where.answerText, /step 2/i);

createQueryEvent({
  requestId: "flow-check-request",
  route: "/query-audio",
  mode: "audio",
  stage: "response",
  outcome: "ok",
  statusCode: 200,
  sessionId,
  intent: "next_step",
  audioBytes: 512,
  audioMimeType: "audio/wav",
  audioFileName: "recording.wav",
  transcript: "this transcript should be truncated",
  durationMs: 42
});

const [event] = listQueryEvents(1);
assert.equal(event.requestId, "flow-check-request");
assert.equal(event.transcriptSnippet, "this transcript ");
assert.equal(event.audioBytes, 512);

fs.rmSync(dataDir, { recursive: true, force: true });
console.log("query flow checks passed");
