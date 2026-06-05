import { arrivalKey, type ArrivalIndex, type BusArrival } from "./types";

// Live in-vehicle ride time, derived from the API instead of hardcoded.
//
// The SAME physical bus appears in the arrival predictions for every stop it
// hasn't reached yet, each time carrying its current GPS position. So the bus
// you board at stop A also shows up in stop B's predictions (B downstream of A)
// with the same position but a later ETA. Match on position → the ETA at B is
// your live alight time, and (ETA_B − ETA_A) is the live ride time, traffic and
// all. Falls back to null when the bus has no GPS (schedule-based) or no match
// exists, so callers can use a configured estimate instead.

/** Round a coordinate so tiny float differences between responses still match. */
function posKey(a: BusArrival): string | null {
  if (a.lat == null || a.lng == null) return null;
  return `${a.lat.toFixed(5)},${a.lng.toFixed(5)}`;
}

/**
 * Find the boarded bus's predicted arrival at the alight stop and return its
 * ETA (epoch ms), or null if it can't be matched.
 */
export function liveAlightMs(
  arrivals: ArrivalIndex,
  alightStopCode: string,
  service: string,
  boardBus: BusArrival,
): number | null {
  const target = posKey(boardBus);
  if (target == null) return null;

  const atAlight = arrivals[arrivalKey(alightStopCode, service)] ?? [];
  const matches = atAlight
    .filter((a) => posKey(a) === target)
    // The alight must be at/after boarding (allow a small slack for jitter).
    .filter((a) => a.arrivalMs >= boardBus.arrivalMs - 30_000)
    .sort((x, y) => x.arrivalMs - y.arrivalMs);

  return matches[0]?.arrivalMs ?? null;
}

/**
 * Estimate when the bus you're ALREADY riding reaches a far-downstream stop,
 * when you can't GPS-match it (you're on it, and it may be beyond the API's
 * next-3 window). Strategy (per the long "stay on 21" leg):
 *
 *   - You expect the ride to take ~`expectedRideMs` (a configured typical time).
 *   - Among the service's predicted arrivals at the far stop, DISCARD the
 *     implausibly-early ones — those are buses ahead of you, not yours.
 *   - Of what's left, pick the arrival closest to your expected time.
 *
 * Returns null when nothing plausible is predicted yet (fall back to the
 * configured estimate).
 */
export function refineAboardAlightMs(
  arrivals: ArrivalIndex,
  alightStopCode: string,
  service: string,
  boardMs: number,
  expectedRideMs: number,
): number | null {
  const list = arrivals[arrivalKey(alightStopCode, service)] ?? [];
  const expected = boardMs + expectedRideMs;
  // A bus arriving in under half the expected ride is ahead of you, not yours.
  const earliest = boardMs + expectedRideMs * 0.5;
  const plausible = list.filter((a) => a.arrivalMs >= earliest);
  if (plausible.length === 0) return null;
  return plausible.reduce(
    (best, a) => (Math.abs(a.arrivalMs - expected) < Math.abs(best - expected) ? a.arrivalMs : best),
    plausible[0].arrivalMs,
  );
}
