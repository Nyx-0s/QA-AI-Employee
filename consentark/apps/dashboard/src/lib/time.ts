/**
 * Pure time helpers for the approvals queue — unit-tested, no React.
 * All inputs/outputs are ISO-8601 strings; "now" is injectable for tests.
 */

/** Compact relative age, e.g. "just now", "4m ago", "3h ago", "2d ago". */
export function formatAge(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "unknown";
  const seconds = Math.max(0, Math.floor((now.getTime() - then) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Human time until an auto-cancel deadline. Negative elapsed → "expired".
 * The caller renders an expiring state when this returns "expired".
 */
export function formatCountdown(iso: string, timeoutHours: number, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "unknown";
  const deadlineMs = then + timeoutHours * 3_600_000;
  const remainingMs = deadlineMs - now.getTime();
  if (remainingMs <= 0) return "expired";
  const totalMinutes = Math.floor(remainingMs / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h left`;
  if (hours > 0) return `${hours}h ${minutes}m left`;
  return `${minutes}m left`;
}

/** Is this approval within 10% of its auto-cancel window (urgent styling)? */
export function isExpiringSoon(iso: string, timeoutHours: number, now: Date = new Date()): boolean {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return false;
  const deadlineMs = then + timeoutHours * 3_600_000;
  const remainingMs = deadlineMs - now.getTime();
  if (remainingMs <= 0) return true;
  const windowMs = timeoutHours * 3_600_000;
  return remainingMs <= windowMs * 0.1;
}
