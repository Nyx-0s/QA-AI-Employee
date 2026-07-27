import { jsonrepair } from "jsonrepair";

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

  private static normalize(obj: any) {
    obj.summary =
      typeof obj.summary === "string" && obj.summary.trim()
        ? obj.summary.trim()
        : "No meaningful AI summary generated.";

    obj.confidence = Number(obj.confidence);

    if (obj.confidence <= 1) {
      obj.confidence = Math.round(obj.confidence * 100);
    }

    obj.confidence = Math.max(0, Math.min(100, obj.confidence));

    obj.rootCauses = (obj.rootCauses ?? []).map((x: any) => {
      if (typeof x === "string") return x;
      return x.cause ?? x.description ?? JSON.stringify(x);
    });

    obj.recommendations = (obj.recommendations ?? []).map((x: any) => {
      if (typeof x === "string") return x;
      return x.description ?? JSON.stringify(x);
    });

    return obj;
  }
}
