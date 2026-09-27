import "dotenv/config";
import { buildApp } from "./app.js";

/**
 * Entry point. Loads .env, builds the app (config → SQLite → providers →
 * queue → worker → routes), and handles graceful shutdown so an in-flight
 * task finishes instead of being killed mid-write.
 */
async function main(): Promise<void> {
  const { app, context } = await buildApp();

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`${signal} received — shutting down gracefully`);
    context.scheduler.stop();
    context.runner.stop();
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  try {
    await app.listen({ port: context.config.PORT, host: "0.0.0.0" });
    app.log.info(
      `ConsentArk API ready on :${context.config.PORT} — admin token ${
        context.config.ADMIN_TOKEN === "dev-admin-token-change-me"
          ? "⚠️  is the dev default, change ADMIN_TOKEN"
          : "configured"
      }`,
    );
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

void main();
