import type { FastifyInstance } from "fastify";
import { getRecipe, listRecipes } from "../storage.js";

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
}
