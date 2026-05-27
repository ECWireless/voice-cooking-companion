import fastify from "fastify";
import fastifyMultipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import path from "node:path";
import { config } from "./config.js";
import { registerQueryRoutes } from "./routes/query.js";
import { registerRecipeRoutes } from "./routes/recipes.js";
import { seedInitialRecipe } from "./storage.js";

const projectRoot = process.cwd();

export async function buildServer() {
  seedInitialRecipe();

  const app = fastify({
    logger: {
      serializers: {
        req(request) {
          return {
            method: request.method,
            url: request.url.split("?")[0],
            host: request.host,
            remoteAddress: request.ip
          };
        }
      }
    }
  });

  await app.register(fastifyMultipart, {
    limits: {
      fileSize: config.maxAudioBytes,
      files: 1
    }
  });

  await app.register(fastifyStatic, {
    root: path.join(projectRoot, "public"),
    prefix: "/"
  });

  app.get("/health", async () => ({ ok: true }));

  await registerRecipeRoutes(app);
  await registerQueryRoutes(app);

  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = await buildServer();
  await app.listen({ host: config.host, port: config.port });
}
