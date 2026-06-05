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
