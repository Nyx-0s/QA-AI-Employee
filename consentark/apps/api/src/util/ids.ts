import { nanoid } from "nanoid";

/** New opaque id, optionally prefixed (e.g. `tsk_...`). */
export function newId(prefix?: string): string {
  const id = nanoid(12);
  return prefix ? `${prefix}_${id}` : id;
}

/** URL-safe slug from an employee name: "Data Clerk 01" → "data-clerk-01". */
export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug.length > 0 ? slug : "employee";
}

/**
 * A slug that is not already taken ("data-clerk" → "data-clerk-2" → …).
 * Shared by the hire route and the hire CLI so both produce identical ids.
 */
export function uniqueSlug(name: string, isTaken: (slug: string) => boolean): string {
  let id = slugify(name);
  while (isTaken(id)) id = `${id}-2`;
  return id;
}

/** Truncate long text for human-readable log lines. */
export function truncate(text: string, max = 200): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}
