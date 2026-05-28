import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import type { Recipe, RecipeInput, VoiceSessionState } from "./types.js";

fs.mkdirSync(config.dataDir, { recursive: true });

const db = new Database(path.join(config.dataDir, "cooking-companion.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(`
  CREATE TABLE IF NOT EXISTS recipes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    source_url TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    ingredients TEXT NOT NULL DEFAULT '[]',
    instructions TEXT NOT NULL DEFAULT '[]',
    tags TEXT NOT NULL DEFAULT '[]',
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS voice_sessions (
    session_id TEXT PRIMARY KEY,
    active_recipe_id INTEGER,
    phase TEXT NOT NULL DEFAULT 'ingredients',
    step_index INTEGER NOT NULL DEFAULT 0,
    pending_prompt TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(active_recipe_id) REFERENCES recipes(id) ON DELETE SET NULL
  );
`);

type RecipeRow = {
  id: number;
  title: string;
  source_url: string;
  description: string;
  ingredients: string;
  instructions: string;
  tags: string;
  notes: string;
  created_at: string;
  updated_at: string;
};

type VoiceSessionRow = {
  session_id: string;
  active_recipe_id: number | null;
  phase: string;
  step_index: number;
  pending_prompt: string | null;
};

function parseStringList(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function normalizeList(items: unknown): string[] {
  return Array.isArray(items) ? items.map((item) => String(item).trim()).filter(Boolean) : [];
}

function mapRecipe(row: RecipeRow): Recipe {
  return {
    id: row.id,
    title: row.title,
    sourceUrl: row.source_url,
    description: row.description,
    ingredients: parseStringList(row.ingredients),
    instructions: parseStringList(row.instructions),
    tags: parseStringList(row.tags),
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapSession(row?: VoiceSessionRow): VoiceSessionState {
  return {
    activeRecipeId: row?.active_recipe_id ?? null,
    phase: row?.phase === "steps" ? "steps" : "ingredients",
    index: Math.max(0, row?.step_index ?? 0),
    pendingPrompt:
      row?.pending_prompt === "ingredients_or_first_step" || row?.pending_prompt === "ingredients_or_repeat"
        ? row.pending_prompt
        : null
  };
}

export function listRecipes(query = ""): Recipe[] {
  const search = query.trim();
  const rows = search
    ? (db
        .prepare(
          `SELECT * FROM recipes
           WHERE title LIKE @like
              OR description LIKE @like
              OR ingredients LIKE @like
              OR tags LIKE @like
              OR notes LIKE @like
           ORDER BY updated_at DESC, id DESC`
        )
        .all({ like: `%${search}%` }) as RecipeRow[])
    : (db.prepare("SELECT * FROM recipes ORDER BY updated_at DESC, id DESC").all() as RecipeRow[]);
  return rows.map(mapRecipe);
}

export function getRecipe(id: number): Recipe | null {
  const row = db.prepare("SELECT * FROM recipes WHERE id = ?").get(id) as RecipeRow | undefined;
  return row ? mapRecipe(row) : null;
}

export function findRecipeByTitle(title: string): Recipe | null {
  const row = db.prepare("SELECT * FROM recipes WHERE lower(title) = lower(?) LIMIT 1").get(title.trim()) as RecipeRow | undefined;
  return row ? mapRecipe(row) : null;
}

export function createRecipe(input: RecipeInput): Recipe {
  const title = input.title.trim();
  if (!title) throw new Error("Recipe title is required.");
  const result = db
    .prepare(
      `INSERT INTO recipes (title, source_url, description, ingredients, instructions, tags, notes)
       VALUES (@title, @sourceUrl, @description, @ingredients, @instructions, @tags, @notes)`
    )
    .run({
      title,
      sourceUrl: input.sourceUrl?.trim() || "",
      description: input.description?.trim() || "",
      ingredients: JSON.stringify(normalizeList(input.ingredients)),
      instructions: JSON.stringify(normalizeList(input.instructions)),
      tags: JSON.stringify(normalizeList(input.tags)),
      notes: input.notes?.trim() || ""
    });
  return getRecipe(Number(result.lastInsertRowid)) as Recipe;
}

export function upsertRecipeByTitle(input: RecipeInput): Recipe {
  const title = input.title.trim();
  const existing = db.prepare("SELECT * FROM recipes WHERE lower(title) = lower(?) LIMIT 1").get(title) as RecipeRow | undefined;
  if (!existing) return createRecipe(input);

  db.prepare(
    `UPDATE recipes
     SET source_url = @sourceUrl,
         description = @description,
         ingredients = @ingredients,
         instructions = @instructions,
         tags = @tags,
         notes = @notes,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = @id`
  ).run({
    id: existing.id,
    sourceUrl: input.sourceUrl?.trim() || "",
    description: input.description?.trim() || "",
    ingredients: JSON.stringify(normalizeList(input.ingredients)),
    instructions: JSON.stringify(normalizeList(input.instructions)),
    tags: JSON.stringify(normalizeList(input.tags)),
    notes: input.notes?.trim() || ""
  });
  return getRecipe(existing.id) as Recipe;
}

export function getVoiceSession(sessionId: string): VoiceSessionState {
  const row = db
    .prepare("SELECT session_id, active_recipe_id, phase, step_index, pending_prompt FROM voice_sessions WHERE session_id = ?")
    .get(sessionId) as VoiceSessionRow | undefined;
  return mapSession(row);
}

export function setVoiceSession(sessionId: string, state: VoiceSessionState): VoiceSessionState {
  db.prepare(
    `INSERT INTO voice_sessions (session_id, active_recipe_id, phase, step_index, pending_prompt, updated_at)
     VALUES (@sessionId, @activeRecipeId, @phase, @stepIndex, @pendingPrompt, CURRENT_TIMESTAMP)
     ON CONFLICT(session_id) DO UPDATE SET
       active_recipe_id = excluded.active_recipe_id,
       phase = excluded.phase,
       step_index = excluded.step_index,
       pending_prompt = excluded.pending_prompt,
       updated_at = CURRENT_TIMESTAMP`
  ).run({
    sessionId,
    activeRecipeId: state.activeRecipeId,
    phase: state.phase,
    stepIndex: Math.max(0, Math.floor(state.index)),
    pendingPrompt: state.pendingPrompt
  });
  return getVoiceSession(sessionId);
}

export function seedInitialRecipe(): void {
  if (listRecipes().length > 0) return;
  createRecipe({
    title: "Weeknight Lemon Garlic Pasta",
    description: "A fast pantry dinner with lemon, garlic, butter, and parmesan.",
    ingredients: ["12 oz spaghetti", "4 cloves garlic, sliced", "1 lemon, zested and juiced", "3 tbsp butter", "1/2 cup grated parmesan", "Parsley and black pepper"],
    instructions: ["Boil the pasta until al dente, reserving one cup of pasta water.", "Melt butter and gently sizzle the garlic until fragrant.", "Toss pasta with garlic butter, lemon juice, zest, parmesan, and splashes of pasta water.", "Finish with parsley and black pepper."],
    tags: ["weeknight", "vegetarian", "pasta"],
    notes: "Seed recipe for first-run endpoint testing."
  });
}
