// Converts a clinic's own wall-clock schedule ("2026-09-08" + "16:00") into
// a real, absolute instant (epoch ms) — the one thing the whole booking-
// availability system is built on: once a slot's *start* is expressed as an
// absolute instant, "is this slot still bookable?" is just one comparison
// against "now" (also an absolute instant, see timeService.ts), with no
// further timezone arithmetic needed anywhere else in the app.
//
// A clinic's schedule is defined in ITS OWN timezone, not the visiting
// device's — a patient in a different timezone must still see "4:00 PM"
// mean 4:00 PM in Baghdad, not 4:00 PM wherever their phone happens to
// think it is. IANA zone ids (e.g. "Asia/Baghdad") are used rather than a
// fixed "+03:00" offset specifically so this keeps working correctly for
// any future zone that *does* observe DST — Iraq itself doesn't, but the
// conversion below handles either case identically via the browser's own
// Intl timezone database, not a hand-rolled UTC+N assumption.
export const DEFAULT_CLINIC_TIMEZONE = "Asia/Baghdad";

/** Every real clinic in this app today predates the `timezone` field (it
 *  didn't exist until this pass) and none has ever needed a non-Baghdad
 *  zone — so a missing/unset value falls back to the app's one established
 *  default location (see CLAUDE.md's "Karbala, Iraq is the app's
 *  designated official location") rather than crashing or guessing from
 *  the visiting device's own zone, which would silently vary the exact
 *  same clinic's working hours per patient. */
export function getClinicTimezone(clinic: { timezone?: string | null } | null | undefined): string {
  return clinic?.timezone || DEFAULT_CLINIC_TIMEZONE;
}

/** How far a wall-clock instant "as if it were UTC" actually sits from the
 *  same instant's real UTC value in `timeZone` — e.g. for Asia/Baghdad
 *  (UTC+3, no DST) this is always +3 hours, but the same code handles a
 *  DST-observing zone correctly too since it reads the real offset in
 *  effect on that specific date from the platform's own Intl timezone
 *  database rather than assuming a fixed number. */
function tzOffsetMillisAt(utcMillisGuess: number, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(new Date(utcMillisGuess));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asIfUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second")
  );
  return asIfUtc - utcMillisGuess;
}

/** "2026-09-08" + "16:00" in "Asia/Baghdad" -> the real epoch ms that wall-
 *  clock moment corresponds to, wherever in the world this code happens to
 *  run. Two-pass fixed-point resolution (not a single naive subtraction) so
 *  this also lands correctly for a date that falls right on a DST
 *  transition in some other zone — a single pass is already exact for a
 *  fixed-offset zone like Baghdad, but this keeps the function correct if
 *  `timezone` is ever set to something that does observe DST. */
export function zonedTimeToUtcMillis(dateISO: string, hhmm: string, timeZone: string): number {
  const [y, m, d] = dateISO.split("-").map(Number);
  const [hh, mm] = hhmm.split(":").map(Number);
  const naiveUtcGuess = Date.UTC(y, m - 1, d, hh, mm, 0);
  const offset1 = tzOffsetMillisAt(naiveUtcGuess, timeZone);
  const refined = naiveUtcGuess - offset1;
  const offset2 = tzOffsetMillisAt(refined, timeZone);
  return naiveUtcGuess - offset2;
}
