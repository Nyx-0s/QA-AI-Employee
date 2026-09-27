import { describe, expect, it } from "vitest";
import { formatAge, formatCountdown, isExpiringSoon } from "../src/lib/time.js";

const NOW = new Date("2026-09-15T12:00:00Z");

describe("formatAge", () => {
  it("renders just now / minutes / hours / days", () => {
    expect(formatAge("2026-09-15T11:59:40Z", NOW)).toBe("just now");
    expect(formatAge("2026-09-15T11:44:00Z", NOW)).toBe("16m ago");
    expect(formatAge("2026-09-15T09:00:00Z", NOW)).toBe("3h ago");
    expect(formatAge("2026-09-13T12:00:00Z", NOW)).toBe("2d ago");
  });

  it("handles invalid input", () => {
    expect(formatAge("not-a-date", NOW)).toBe("unknown");
  });
});

describe("formatCountdown", () => {
  it("shows time left inside the window", () => {
    // 24h window starting 4h ago → 20h left
    expect(formatCountdown("2026-09-15T08:00:00Z", 24, NOW)).toBe("20h 0m left");
    // 59 minutes elapsed of a 24h window → 23h 1m left
    expect(formatCountdown("2026-09-15T11:01:00Z", 24, NOW)).toBe("23h 1m left");
  });

  it("says expired past the deadline", () => {
    expect(formatCountdown("2026-09-14T00:00:00Z", 24, NOW)).toBe("expired");
  });

  it("handles invalid input", () => {
    expect(formatCountdown("nope", 24, NOW)).toBe("unknown");
  });
});

describe("isExpiringSoon", () => {
  it("is true within the last 10% of the window", () => {
    // 24h window; 23.9h elapsed → 0.1h remaining = exactly 10% → urgent.
    expect(isExpiringSoon("2026-09-14T12:06:00Z", 24, NOW)).toBe(true);
  });

  it("is false early in the window", () => {
    expect(isExpiringSoon("2026-09-15T06:00:00Z", 24, NOW)).toBe(false);
  });

  it("is true when expired", () => {
    expect(isExpiringSoon("2026-09-01T00:00:00Z", 24, NOW)).toBe(true);
  });
});
