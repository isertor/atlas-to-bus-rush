import type { Plan } from "@/lib/engine/types";
import { arrivalKey, type ArrivalIndex } from "@/lib/engine/types";
import type { StopCoord } from "@/lib/lta/stops";

// Map payload: only what's relevant to the rider RIGHT NOW.
//
// Bus positions come straight from the BusArrival feed (each predicted bus
// carries its current lat/lng) — but the feed predicts up to 3 vehicles per
// service per stop, which painted the whole island with chips. So buses are
// selected by WATCH SPECS: "the next N of service S approaching stop X",
// where the specs come from the journey state (the buses you could actually
// board next, at the stops where you'd board them). The bus being ridden is
// returned separately by the track endpoint and rendered as "you".

export interface MapStop {
  code: string;
  name: string;
  lat: number;
  lng: number;
}

export interface MapBus {
  service: string;
  lat: number;
  lng: number;
  /** The watched stop this vehicle is approaching. */
  nextStopCode: string;
  etaMs: number;
  load: string;
}

/** A route polyline. `current` = the leg being ridden (solid, burns down as
 * the bus advances); `onward` = the rest of the journey (dashed). */
export interface MapPath {
  kind: "current" | "onward";
  points: [number, number][];
}

export interface MapData {
  stops: MapStop[];
  buses: MapBus[];
  paths: MapPath[];
}

/** "Show the next `limit` buses of any of `services` approaching `stopCode`." */
export interface WatchSpec {
  services: string[];
  stopCode: string;
  limit?: number;
}

/** Stops in journey order with display names (first occurrence wins). */
function stopRefs(plans: Plan[]): { code: string; name: string }[] {
  const seen = new Map<string, string>();
  for (const plan of plans) {
    for (const leg of plan.legs) {
      if (leg.kind === "ride") {
        if (!seen.has(leg.board.code)) seen.set(leg.board.code, leg.board.name);
        if (!seen.has(leg.alight.code)) seen.set(leg.alight.code, leg.alight.name);
      }
    }
  }
  return [...seen].map(([code, name]) => ({ code, name }));
}

/**
 * Every distinct stop code referenced by the given plans — both board AND
 * alight stops — in journey order. The canonical ordering matters: mock
 * coordinates are laid out by position in this list, so every caller (stop
 * markers, mock bus positions) must derive it from the same plans.
 */
export function stopsInPlans(plans: Plan[]): string[] {
  return stopRefs(plans).map((s) => s.code);
}

/** The watched buses: per spec, the soonest few GPS-carrying vehicles. */
export function relevantBuses(arrivals: ArrivalIndex, specs: WatchSpec[]): MapBus[] {
  const out = new Map<string, MapBus>(); // dedupe by service@position
  for (const spec of specs) {
    const limit = spec.limit ?? 2;
    for (const service of spec.services) {
      const withPos = (arrivals[arrivalKey(spec.stopCode, service)] ?? [])
        .filter((a) => a.lat != null && a.lng != null)
        .sort((a, b) => a.arrivalMs - b.arrivalMs)
        .slice(0, limit);
      for (const a of withPos) {
        const key = `${service}@${(a.lat as number).toFixed(5)},${(a.lng as number).toFixed(5)}`;
        const prev = out.get(key);
        if (!prev || a.arrivalMs < prev.etaMs) {
          out.set(key, {
            service,
            lat: a.lat as number,
            lng: a.lng as number,
            nextStopCode: spec.stopCode,
            etaMs: a.arrivalMs,
            load: a.load,
          });
        }
      }
    }
  }
  return [...out.values()];
}

export function buildMapData(
  plans: Plan[],
  arrivals: ArrivalIndex,
  coords: Record<string, StopCoord>,
  opts: {
    specs: WatchSpec[];
    /** When set, only these stops are drawn (journey mode: the REMAINING stops). */
    stopCodes?: Set<string>;
    paths?: MapPath[];
  },
): MapData {
  const stops: MapStop[] = stopRefs(plans)
    .filter((s) => (opts.stopCodes ? opts.stopCodes.has(s.code) : true))
    .filter((s) => s.code in coords)
    .map((s) => ({ ...s, ...coords[s.code] }));
  return { stops, buses: relevantBuses(arrivals, opts.specs), paths: opts.paths ?? [] };
}

/**
 * Trim a polyline to start at the vertex nearest `pos`, prepending `pos`
 * itself — "the line behind the bus clears as it advances".
 */
export function slicePathAt(points: [number, number][], pos: { lat: number; lng: number }): [number, number][] {
  if (points.length === 0) return points;
  let bestI = 0;
  let bestD = Infinity;
  points.forEach(([lat, lng], i) => {
    const d = (lat - pos.lat) ** 2 + (lng - pos.lng) ** 2;
    if (d < bestD) {
      bestD = d;
      bestI = i;
    }
  });
  return [[pos.lat, pos.lng], ...points.slice(bestI)];
}
