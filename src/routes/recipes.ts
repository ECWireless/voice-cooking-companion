import type { FastifyInstance, FastifyRequest } from "fastify";
import { config } from "../config.js";
import { parseRecipeMarkdown, validateRecipeInput } from "../markdown/recipe-parser.js";
import { requireApiToken } from "../auth.js";
import { coerceRecipeMarkdown } from "../services/openai.js";
import { createRecipe, findRecipeByTitle, getRecipe, listRecipes, upsertRecipeByTitle } from "../storage.js";
import type { RecipeInput } from "../types.js";

type ImportBody = {
  markdown?: unknown;
  updateExisting?: unknown;
};

function parseBoolean(value: unknown): boolean {
  return value === true || value === "true" || value === "1" || value === "yes";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error.";
}

function uniqueWarnings(warnings: string[]): string[] {
  return [...new Set(warnings)];
}

async function markdownFromRequest(request: FastifyRequest): Promise<{
  markdown: string;
  updateExisting: boolean;
}> {
  const contentType = request.headers["content-type"] || "";

  if (typeof contentType === "string" && contentType.includes("multipart/form-data")) {
    let markdown = "";
    let updateExisting = false;

    for await (const part of request.parts()) {
      if (part.type === "file") {
        if (part.fieldname !== "file" && part.fieldname !== "markdown") {
          await part.file.resume();
          continue;
        }
        markdown = (await part.toBuffer()).toString("utf8");
        continue;
      }

      if (part.fieldname === "markdown" && typeof part.value === "string") markdown = part.value;
      if (part.fieldname === "updateExisting") updateExisting = parseBoolean(part.value);
    }

    return { markdown, updateExisting };
  }

  const body = request.body && typeof request.body === "object" ? (request.body as ImportBody) : {};
  return {
    markdown: typeof body.markdown === "string" ? body.markdown : "",
    updateExisting: parseBoolean(body.updateExisting)
  };
}

async function parseOrCoerce(markdown: string): Promise<{
  recipe: RecipeInput;
  warnings: string[];
  errors: string[];
  usedLlm: boolean;
}> {
  const local = parseRecipeMarkdown(markdown);
  if (local.errors.length === 0 || !config.openaiApiKey || !config.enableRecipeLlmCoercion) {
    return { ...local, usedLlm: false };
  }

  try {
    const coercedRecipe = await coerceRecipeMarkdown(markdown);
    const validation = validateRecipeInput(coercedRecipe);
    return {
      recipe: coercedRecipe,
      warnings: uniqueWarnings([...local.warnings, ...validation.warnings, "Recipe format was normalized with LLM assistance."]),
      errors: validation.errors,
      usedLlm: true
    };
  } catch (error) {
    return {
      ...local,
      errors: [...local.errors, `LLM coercion failed: ${errorMessage(error)}`],
      usedLlm: false
    };
  }
}

export async function registerRecipeRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/recipes", async (request) => {
    const query = request.query as { q?: string };
    return {
      recipes: listRecipes(typeof query.q === "string" ? query.q : "")
    };
  });

  app.get("/api/recipes/:id", async (request, reply) => {
    const params = request.params as { id: string };
    const id = Number.parseInt(params.id, 10);
    const recipe = Number.isFinite(id) ? getRecipe(id) : null;
    if (!recipe) return reply.status(404).send({ ok: false, error: "Recipe not found." });
    return { recipe };
  });

  app.post(
    "/api/recipes/import-markdown",
    {
      preHandler: requireApiToken
    },
    async (request, reply) => {
      const { markdown, updateExisting } = await markdownFromRequest(request);

      if (!markdown.trim()) {
        return reply.status(400).send({
          ok: false,
          errors: ["Provide recipe markdown as a file upload or markdown field."]
        });
      }

      const parsed = await parseOrCoerce(markdown);
      if (parsed.errors.length > 0) {
        return reply.status(400).send({
          ok: false,
          recipe: parsed.recipe,
          warnings: parsed.warnings,
          errors: parsed.errors,
          usedLlm: parsed.usedLlm
        });
      }

      const existing = findRecipeByTitle(parsed.recipe.title);
      if (existing && !updateExisting) {
        return reply.status(409).send({
          ok: false,
          duplicate: true,
          message: `A recipe named "${existing.title}" already exists. Confirm update to replace it.`,
          existingRecipe: existing,
          recipe: parsed.recipe,
          warnings: parsed.warnings,
          usedLlm: parsed.usedLlm
        });
      }

      const savedRecipe = existing ? upsertRecipeByTitle(parsed.recipe) : createRecipe(parsed.recipe);
      return reply.status(existing ? 200 : 201).send({
        ok: true,
        recipe: savedRecipe,
        warnings: parsed.warnings,
        usedLlm: parsed.usedLlm,
        updated: Boolean(existing)
      });
    }
  );
}
