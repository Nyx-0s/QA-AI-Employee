import { jsonrepair } from "jsonrepair";

type AnyRecord = Record<string, any>;

const SEVERITIES = [
  "LOW",
  "MEDIUM",
  "HIGH",
  "CRITICAL"
] as const;

const CATEGORIES = [
  "BUSINESS_RULE",
  "VALIDATION",
  "FUNCTIONAL",
  "NETWORK",
  "CONSOLE",
  "PERFORMANCE",
  "SECURITY",
  "UI",
  "UNKNOWN"
] as const;

const TEAMS = [
  "FRONTEND",
  "BACKEND",
  "QA",
  "DEVOPS",
  "SECURITY",
  "PRODUCT",
  "UNKNOWN"
] as const;

export class JsonParser {
  static parse(text: string): any {
    const attempts = [
      text,
      text.replace(/```json/gi, "").replace(/```/g, "").trim(),
      (text.match(/\{[\s\S]*\}/)?.[0] ?? text).trim()
    ];

    for (const candidate of attempts) {
      try {
        return this.normalize(JSON.parse(candidate));
      } catch {}

      try {
        return this.normalize(JSON.parse(jsonrepair(candidate)));
      } catch {}
    }

    throw new Error("Unable to parse AI JSON.");
  }

  /**
   * Normalizes a parsed AI response into the typed AIReasoning schema:
   *
   * {
   *   summary: string,
   *   risk: LOW|MEDIUM|HIGH|CRITICAL,
   *   category?: ...,
   *   confidence: 0-100,
   *   rootCauses: [{ cause, confidence, evidence }],
   *   remediations: [{ priority, team, action }]
   * }
   *
   * Legacy responses that used string rootCauses / recommendations
   * are converted into the new shape.
   */
  private static normalize(obj: AnyRecord): AnyRecord {
    obj.summary =
      typeof obj.summary === "string" && obj.summary.trim()
        ? obj.summary.trim()
        : "No meaningful AI summary generated.";

    obj.risk = this.oneOf(
      String(obj.risk ?? "").toUpperCase(),
      SEVERITIES,
      "LOW"
    );

    if (obj.category !== undefined) {
      obj.category = this.oneOf(
        String(obj.category).toUpperCase(),
        CATEGORIES,
        "UNKNOWN"
      );
    }

    obj.confidence = this.confidence(obj.confidence);

    // Legacy schema returned "recommendations"; the new schema uses "remediations".
    if (
      !Array.isArray(obj.remediations) &&
      Array.isArray(obj.recommendations)
    ) {
      obj.remediations = obj.recommendations;
    }

    delete obj.recommendations;

    obj.rootCauses = (
      Array.isArray(obj.rootCauses) ? obj.rootCauses : []
    )
      .map((item: any) => {
        if (typeof item === "string") {
          return { cause: item, confidence: 0, evidence: [] };
        }

        const cause =
          typeof item?.cause === "string"
            ? item.cause
            : typeof item?.description === "string"
              ? item.description
              : JSON.stringify(item);

        return {
          cause,
          confidence: this.confidence(item?.confidence),
          evidence: Array.isArray(item?.evidence)
            ? item.evidence.map(String).filter(Boolean)
            : []
        };
      })
      .slice(0, 3);

    obj.remediations = (
      Array.isArray(obj.remediations) ? obj.remediations : []
    )
      .map((item: any) => {
        if (typeof item === "string") {
          return { priority: "MEDIUM", team: "UNKNOWN", action: item };
        }

        const action =
          typeof item?.action === "string" && item.action.trim()
            ? item.action.trim()
            : typeof item?.description === "string"
              ? item.description
              : JSON.stringify(item);

        return {
          priority: this.oneOf(
            String(item?.priority ?? "").toUpperCase(),
            SEVERITIES,
            "MEDIUM"
          ),
          team: this.oneOf(
            String(item?.team ?? "").toUpperCase(),
            TEAMS,
            "UNKNOWN"
          ),
          action
        };
      })
      .slice(0, 3);

    return obj;
  }

  private static confidence(value: unknown): number {
    let parsed = Number(value);

    if (Number.isNaN(parsed)) {
      parsed = 0;
    }

    if (parsed > 0 && parsed <= 1) {
      parsed = parsed * 100;
    }

    return Math.max(0, Math.min(100, Math.round(parsed)));
  }

  private static oneOf<T extends string>(
    value: string,
    allowed: readonly T[],
    fallback: T
  ): T {
    return (allowed as readonly string[]).includes(value)
      ? (value as T)
      : fallback;
  }
}