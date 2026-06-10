import type { Plan } from "@/lib/engine/types";
import { arrivalKey, type ArrivalIndex } from "@/lib/engine/types";
import type { StopCoord } from "@/lib/lta/stops";

// Map payload: the journey's key points + every live-GPS bus relevant to it.
//
// Bus positions come straight from the BusArrival feed (each predicted bus
// carries its current lat/lng). The same physical vehicle appears in the
// predictions of every stop it hasn't reached yet, so we dedupe by
// service+position and keep its soonest ETA — that's the stop it reaches next.

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
  /** Soonest predicted stop for this vehicle (among the journey's stops). */
  nextStopCode: string;
  etaMs: number;
  load: string;
}

export interface MapData {
  stops: MapStop[];
  buses: MapBus[];
}

/** Every ride service a plan references (incl. anyOf alternatives). */
function servicesInPlans(plans: Plan[]): Set<string> {
  const set = new Set<string>();
  for (const plan of plans) {
    for (const leg of plan.legs) {
      if (leg.kind === "ride") {
        set.add(leg.service);
        for (const s of leg.anyOf ?? []) set.add(s);
      }
    }
  }
  return set;
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

export function buildMapData(
  plans: Plan[],
  arrivals: ArrivalIndex,
  coords: Record<string, StopCoord>,
): MapData {
  const stops: MapStop[] = stopRefs(plans)
    .filter((s) => s.code in coords)
    .map((s) => ({ ...s, ...coords[s.code] }));

  const buses = new Map<string, MapBus>();
  const services = servicesInPlans(plans);
  for (const { code } of stopRefs(plans)) {
    for (const service of services) {
      for (const a of arrivals[arrivalKey(code, service)] ?? []) {
        if (a.lat == null || a.lng == null) continue;
        const key = `${service}@${a.lat.toFixed(5)},${a.lng.toFixed(5)}`;
        const prev = buses.get(key);
        if (!prev || a.arrivalMs < prev.etaMs) {
          buses.set(key, {
            service,
            lat: a.lat,
            lng: a.lng,
            nextStopCode: code,
            etaMs: a.arrivalMs,
            load: a.load,
          });
        }
      }
    }
  }

  return { stops, buses: [...buses.values()] };
}
