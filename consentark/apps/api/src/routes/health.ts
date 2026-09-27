import type { FastifyPluginAsync } from "fastify";
import type { AppContext } from "../app.js";

/**
 * GET /api/health — the only unauthenticated route. Reports API liveness
 * and the reachability of both LLM backends so setup problems are visible
 * immediately (e.g. "Colibrì not running" before the first task fails).
 */
export const healthRoutes: FastifyPluginAsync<{ context: AppContext }> = async (
  app,
  { context },
) => {
  app.get("/", async () => {
    const [cloud, local] = await Promise.all([
      context.providers.cloud.health(),
      context.providers.local.health(),
    ]);
    return {
      ok: true,
      version: context.version,
      time: new Date().toISOString(),
      backends: {
        cloud: {
          configured: context.config.FREELLMAPI_KEY.length > 0,
          ...cloud,
        },
        local: { ...local },
      },
      queue: { size: context.queue.size() },
    };
  });
};
