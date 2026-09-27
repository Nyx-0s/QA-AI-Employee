/**
 * Nudge calendar — follow-up scheduling for the sales ledger.
 *
 * Rule (from the tracker brief): if a draft is approved + sent, the
 * nudge-due date = sent date + 5 BUSINESS days (Mon–Fri, ignoring
 * weekends; US federal holidays are NOT modeled — documented
 * simplification). The NO-REPLY tag is applied only when the nudge-due
 * date passes with no reply; this module computes the date, the ledger
 * records it at SENT time, and the tracker checks it daily afterwards.
 *
 * Run tests: node sales/nudge-calendar.mjs --test
 */

/**
 * Add N business days (Mon–Fri) to an ISO date string (YYYY-MM-DD).
 * Pure function; no timezone dependence (date-only math in UTC).
 */
export function addBusinessDays(isoDate, n) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) throw new Error(`bad date: ${isoDate}`);
  let added = 0;
  while (added < n) {
    date.setUTCDate(date.getUTCDate() + 1);
    const day = date.getUTCDay(); // 0 = Sun, 6 = Sat
    if (day !== 0 && day !== 6) added++;
  }
  return date.toISOString().slice(0, 10);
}

/**
 * Nudge-due date for a sent draft = sent + 5 business days.
 */
export function nudgeDueDate(sentIsoDate) {
  return addBusinessDays(sentIsoDate, 5);
}

/**
 * Should the NO-REPLY tag be applied? True only when today is strictly
 * AFTER the nudge-due date and no reply evidence exists.
 */
export function isNudgeDue(nudgeDueIso, todayIso) {
  return new Date(`${todayIso}T00:00:00Z`) > new Date(`${nudgeDueIso}T00:00:00Z`);
}

// ── fixed-date tests ────────────────────────────────────────────────────
if (process.argv.includes("--test")) {
  const assertEq = (got, want, msg) => {
    if (got !== want) {
      console.error(`NUDGE TEST FAIL: ${msg} — got ${got}, want ${want}`);
      process.exit(1);
    }
    console.log(`  ok: ${msg} → ${got}`);
  };

  // Sent Wednesday → +5 business days = next Wednesday (skips one weekend).
  assertEq(nudgeDueDate("2026-09-16"), "2026-09-23", "Wed sent skips weekend");
  // Sent Friday → weekend skipped, due next Friday.
  assertEq(nudgeDueDate("2026-09-18"), "2026-09-25", "Fri sent skips Sat+Sun");
  // Sent Saturday (weekend send) → counting starts Monday; Sat itself is
  // not a business day, so +5 business days lands on the following Friday.
  assertEq(nudgeDueDate("2026-09-19"), "2026-09-25", "Sat sent counts Mon–Fri");
  // Sent Sunday → same: +5 business days from Monday = following Friday.
  assertEq(nudgeDueDate("2026-09-20"), "2026-09-25", "Sun sent counts Mon–Fri");
  // Sent Monday → due next Monday (5 business days).
  assertEq(nudgeDueDate("2026-09-14"), "2026-09-21", "Mon sent → next Mon");
  // Crossing a month boundary.
  assertEq(nudgeDueDate("2026-09-29"), "2026-10-06", "crosses month boundary");
  // isNudgeDue: due date itself is NOT yet due (no nudge on the due day);
  // the day after is.
  assertEq(isNudgeDue("2026-09-23", "2026-09-23"), false, "due day itself not yet due");
  assertEq(isNudgeDue("2026-09-23", "2026-09-24"), true, "day after due date is due");
  assertEq(isNudgeDue("2026-09-23", "2026-09-22"), false, "before due date not due");
  // Today is a weekend: rule is date-based, weekend checks happen on the
  // next business day the tracker runs — documented, no special-casing.
  console.log("nudge-calendar tests: ALL PASS");
}
