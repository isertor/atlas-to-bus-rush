// Time helpers. Singapore has no DST, but we format explicitly in its timezone
// so the app behaves correctly regardless of where the server runs.

export const SG_TZ = "Asia/Singapore";
export const MIN = 60_000;

/** Format an epoch-ms timestamp as a local SG clock time, e.g. "5:42 pm". */
export function fmtClock(ms: number): string {
  return new Intl.DateTimeFormat("en-SG", {
    timeZone: SG_TZ,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(ms));
}

/** Hour of day (0–23) in Singapore for an epoch-ms timestamp. */
export function sgHour(ms: number): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: SG_TZ, hour: "2-digit", hour12: false }).format(
      new Date(ms),
    ),
  );
}

/** Whole minutes from `now` to `ms`, rounded. Negative means in the past. */
export function minutesFromNow(ms: number, now: number): number {
  return Math.round((ms - now) / MIN);
}

/** Render a "in N min" / "now" / "N min ago" relative label. */
export function fmtRelative(ms: number, now: number): string {
  const m = minutesFromNow(ms, now);
  if (m <= 0) return m === 0 ? "now" : `${-m} min ago`;
  return `in ${m} min`;
}

/**
 * Resolve an "HH:MM" local-SG time on the same calendar day as `now` to epoch ms.
 * Used to bound the leave-by board to the configured departure window.
 */
export function sgTimeToMs(hhmm: string, now: number): number {
  const [h, m] = hhmm.split(":").map(Number);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SG_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(now)); // YYYY-MM-DD in SG
  // Build an ISO string with SG's fixed +08:00 offset.
  return new Date(`${parts}T${pad(h)}:${pad(m)}:00+08:00`).getTime();
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** True if `ms` falls within the [earliest, latest] HH:MM window on `now`'s SG day. */
export function withinWindow(
  ms: number,
  window: { earliest: string; latest: string },
  now: number,
): boolean {
  return ms >= sgTimeToMs(window.earliest, now) && ms <= sgTimeToMs(window.latest, now);
}
