import type { FastifyPluginAsync } from "fastify";
import type { AppContext } from "../app.js";
import { rotateOperatorCredential } from "../auth/operator.js";
import { hashToken } from "../auth/tokens.js";
import { HttpError } from "./httpError.js";

/**
 * Operator credential management (Phase 5). Every route here is
 * operator-only by construction: it sits behind the app-wide hook that
 * already verified the operator hash before this plugin runs.
 *
 * POST /api/operator/rotate — invalidate the current operator token and
 * issue a new one. The new plaintext appears EXACTLY once, in this response
 * (and the server log line), then only its sha256 exists. In env-override
 * mode rotation is refused with instructions — the credential's source of
 * truth is the operator's environment, not the database.
 */
export const operatorRoutes: FastifyPluginAsync<{ context: AppContext }> = async (
  app,
  { context },
) => {
  app.post("/rotate", async (_request, reply) => {
    if (context.operator.mode === "env-override") {
      throw new HttpError(
        409,
        "rotation_unavailable",
        "Operator credential is set by ADMIN_TOKEN env — rotate by changing the env value and restarting.",
      );
    }
    const tokenFile = context.operator.tokenFile;
    if (tokenFile === undefined) {
      throw new HttpError(500, "rotation_failed", "No operator token file is configured");
    }
    const token = rotateOperatorCredential(context.db, tokenFile);
    // The in-memory state must change too: hash (so the old token dies) and
    // mode (the credential now lives in the 600 file — it IS persisted).
    context.operator = { ...context.operator, mode: "persisted", tokenHash: hashToken(token), token, tokenFile };
    void reply.code(201);
    return {
      token,
      note: "New operator token — shown ONCE. Update your dashboard/API clients; the old token is now invalid.",
    };
  });

  app.get("/status", async () => ({
    mode: context.operator.mode,
    tokenFile: context.operator.tokenFile ?? null,
    envOverride: context.operator.mode === "env-override",
  }));
};
