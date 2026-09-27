export * from "./employee.js";
export * from "./task.js";
export * from "./approvals.js";

import { z } from "zod";

/** Uniform error envelope for every non-2xx API response. */
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
