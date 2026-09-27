/**
 * Minimal JSON-Schema subset validator for browser-task structured output.
 *
 * Deliberately NOT a full JSON-Schema implementation — extraction outputs
 * need type/enum/required/properties/items checks, nothing more. Returns
 * human-readable error paths so a failed validation explains itself in the
 * audit log (product requirement: readable, never a raw dump).
 */

export interface SchemaIssues {
  path: string;
  message: string;
}

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return typeof value;
}

/** Types a schema node may claim. `integer` also accepts whole numbers. */
function typeMatches(value: unknown, expected: string): boolean {
  const actual = typeOf(value);
  if (actual === expected) return true;
  if (expected === "number" && actual === "integer") return true;
  if (expected === "integer" && actual === "number" && Number.isInteger(value)) return true;
  return false;
}

/**
 * Validate `value` against a JSON-Schema subset. Returns [] when valid.
 * Supported keywords: type, enum, required, properties, items, minItems,
 * maxItems, minLength, maxLength, minimum, maximum.
 */
export function validateAgainstSchema(
  value: unknown,
  schema: unknown,
  path = "$",
): SchemaIssues[] {
  if (schema === null || typeof schema !== "object" || Array.isArray(schema)) {
    return []; // no usable schema — treat as unconstrained
  }
  const s = schema as Record<string, unknown>;
  const issues: SchemaIssues[] = [];

  if (typeof s.type === "string" && !typeMatches(value, s.type)) {
    issues.push({ path, message: `expected ${s.type}, got ${typeOf(value)}` });
    return issues; // shape mismatch — deeper checks make no sense
  }
  if (Array.isArray(s.enum) && !s.enum.some((option) => option === value)) {
    issues.push({ path, message: `value not in enum: ${JSON.stringify(value).slice(0, 60)}` });
  }
  if (typeof s.minLength === "number" && typeof value === "string" && value.length < s.minLength) {
    issues.push({ path, message: `shorter than minLength ${s.minLength}` });
  }
  if (typeof s.maxLength === "number" && typeof value === "string" && value.length > s.maxLength) {
    issues.push({ path, message: `longer than maxLength ${s.maxLength}` });
  }
  if (typeof s.minimum === "number" && typeof value === "number" && value < s.minimum) {
    issues.push({ path, message: `less than minimum ${s.minimum}` });
  }
  if (typeof s.maximum === "number" && typeof value === "number" && value > s.maximum) {
    issues.push({ path, message: `greater than maximum ${s.maximum}` });
  }
  if (Array.isArray(s.items) || (s.items && typeof s.items === "object")) {
    if (Array.isArray(value)) {
      if (typeof s.minItems === "number" && value.length < s.minItems) {
        issues.push({ path, message: `fewer than minItems ${s.minItems}` });
      }
      if (typeof s.maxItems === "number" && value.length > s.maxItems) {
        issues.push({ path, message: `more than maxItems ${s.maxItems}` });
      }
      const itemSchema = s.items as Record<string, unknown>;
      value.forEach((item, i) => {
        issues.push(...validateAgainstSchema(item, itemSchema, `${path}[${i}]`));
      });
    }
  }
  if (s.properties && typeof s.properties === "object" && !Array.isArray(value)) {
    if (value !== null && typeof value === "object") {
      const props = s.properties as Record<string, unknown>;
      if (Array.isArray(s.required)) {
        for (const key of s.required as string[]) {
          if (!(key in (value as Record<string, unknown>))) {
            issues.push({ path, message: `missing required property "${key}"` });
          }
        }
      }
      for (const [key, propSchema] of Object.entries(props)) {
        const fieldValue = (value as Record<string, unknown>)[key];
        if (fieldValue !== undefined) {
          issues.push(...validateAgainstSchema(fieldValue, propSchema, `${path}.${key}`));
        }
      }
    }
  }
  return issues;
}
