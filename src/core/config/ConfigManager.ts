import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const ConfigSchema = z.object({
  // Per-product values are resolved from ProductMemory when set by
  // `npm run aqw`; the .env entries are optional legacy overrides.
  BASE_URL: z.string().default(""),
  USERNAME: z.string().default(""),
  PASSWORD: z.string().default(""),

  HEADLESS: z
    .string()
    .default("false")
    .transform((v) => v.toLowerCase() === "true"),

  SLOWMO: z
    .string()
    .default("100")
    .transform((v) => Number(v)),



  REPORT_DIR: z.string().default("reports"),
  SCREENSHOT_DIR: z.string().default("screenshots"),
  VIDEO_DIR: z.string().default("videos"),
  TRACE_DIR: z.string().default("traces"),

  TIMEOUT: z
    .string()
    .default("30000")
    .transform((v) => Number(v))
});

const parsed = ConfigSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("\n❌ Invalid .env configuration\n");
  console.error(parsed.error.format());
  process.exit(1);
}

export const Config = parsed.data;
