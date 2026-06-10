import { ALL_PLANS } from "@/config/commute";
import type { BusArrival } from "@/lib/engine/types";
import { stopsInPlans } from "@/lib/map";
import { MIN } from "@/lib/time";
import { parseLoad } from "./load";
import { mockStopCoord } from "./stops";
import type { LtaBusArrivalResponse, LtaNextBus } from "./types";

const LTA_BASE = "https://datamall2.mytransport.sg/ltaodataservice/v3/BusArrival";

/**
 * Fetch the next arrivals for a single bus stop from LTA DataMall.
 * Returns a map of service number -> sorted arrivals.
 *
 * Runs server-side only (it uses the secret AccountKey). Falls back to
 * deterministic mock data when USE_MOCK_LTA=1 or no key is configured, so the
 * app and tests run without network access.
 */
export async function fetchStopArrivals(
  stopCode: string,
): Promise<Record<string, BusArrival[]>> {
  const key = process.env.LTA_ACCOUNT_KEY;
  const useMock = process.env.USE_MOCK_LTA === "1" || !key;

  if (useMock) {
    return mockStopArrivals(stopCode);
  }

  const res = await fetch(`${LTA_BASE}?BusStopCode=${encodeURIComponent(stopCode)}`, {
    headers: { AccountKey: key as string, accept: "application/json" },
    // Arrivals change constantly — never cache.
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`LTA BusArrival ${stopCode} failed: ${res.status} ${res.statusText}`);
  }

  const json = (await res.json()) as LtaBusArrivalResponse;
  const out: Record<string, BusArrival[]> = {};
  for (const svc of json.Services ?? []) {
    out[svc.ServiceNo] = [svc.NextBus, svc.NextBus2, svc.NextBus3]
      .map(toArrival)
      .filter((a): a is BusArrival => a !== null)
      .sort((a, b) => a.arrivalMs - b.arrivalMs);
  }
  return out;
}

function toArrival(nb: LtaNextBus | undefined): BusArrival | null {
  if (!nb || !nb.EstimatedArrival) return null;
  const ms = Date.parse(nb.EstimatedArrival);
  if (Number.isNaN(ms)) return null;
  const lat = Number(nb.Latitude);
  const lng = Number(nb.Longitude);
  const hasPos = Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0);
  return {
    arrivalMs: ms,
    load: parseLoad(nb.Load),
    type: nb.Type || undefined,
    feature: nb.Feature || undefined,
    monitored: nb.Monitored === 1,
    lat: hasPos ? lat : undefined,
    lng: hasPos ? lng : undefined,
  };
}

// ---------------------------------------------------------------------------
//  Mock data — deterministic, derived from the stop code + current minute so it
//  looks "live" (changes over time) but is reproducible within a minute.
// ---------------------------------------------------------------------------

const LOADS = ["SEA", "SDA", "LSD"] as const;

/** All ride services referenced anywhere in EITHER direction (incl. anyOf). */
function configuredServices(): string[] {
  const set = new Set<string>();
  for (const plan of ALL_PLANS) {
    for (const leg of plan.legs) {
      if (leg.kind === "ride") {
        set.add(leg.service);
        for (const s of leg.anyOf ?? []) set.add(s);
      }
    }
  }
  return [...set];
}

/** Which services the plans BOARD at each stop (incl. anyOf alternatives). */
function boardedServicesAt(stopCode: string): Set<string> {
  const set = new Set<string>();
  for (const plan of ALL_PLANS) {
    for (const leg of plan.legs) {
      if (leg.kind === "ride" && leg.board.code === stopCode) {
        set.add(leg.service);
        for (const s of leg.anyOf ?? []) set.add(s);
      }
    }
  }
  return set;
}

function mockStopArrivals(stopCode: string): Record<string, BusArrival[]> {
  const now = Date.now();
  const seed = [...stopCode].reduce((s, c) => s + c.charCodeAt(0), 0);
  // Demo map positions: a bus N minutes out sits N "minutes" back along the
  // mock stop line. Only attached where the journey BOARDS that service (so
  // the demo map shows the buses you'd actually be watching for, not noise),
  // and never at alight stops — so live ride-time matching stays estimated in
  // demo mode, exactly as before.
  const stopCodes = stopsInPlans(ALL_PLANS); // canonical layout, both directions
  const boardedHere = boardedServicesAt(stopCode);
  const here = mockStopCoord(stopCode, stopCodes);
  // Cover whatever services the live config uses, so the demo always connects:
  const services = configuredServices();
  // NOTE: real LTA returns only the next ~3 buses per service. We emit a longer
  // horizon here purely so the demo shows feasible multi-leg connections in all
  // views; the engine handles the sparse real-world case via its feasibility check.
  // Headway by route role, so the demo mirrors reality: the first bus (21) is
  // frequent, the connecting trunk route (26) is sparser, onward feeders medium.
  // Sparse connectors are what create the "two early 21s catch the SAME 26 →
  // identical home time" insight the app is built to surface.
  const headway = (svc: string) => (svc === "21" ? 5 : svc === "26" ? 13 : 8);

  const out: Record<string, BusArrival[]> = {};
  services.forEach((svc, i) => {
    const base = ((seed + i * 3 + svc.charCodeAt(0)) % 4) + 1; // 1..4 min to first bus
    const hw = headway(svc);
    out[svc] = [0, 1, 2, 3, 4, 5].map((n) => {
      const offsetMin = base + n * hw;
      const loadIdx = (seed + i + n) % LOADS.length;
      const withPos = boardedHere.has(svc) && n < 2 && offsetMin <= 30;
      return {
        arrivalMs: now + offsetMin * MIN,
        load: parseLoad(LOADS[loadIdx]),
        type: n % 2 === 0 ? "DD" : "SD",
        monitored: true,
        ...(withPos
          ? {
              lat: here.lat - offsetMin * 0.00035 + (((seed + svc.charCodeAt(0)) % 5) - 2) * 0.0006,
              lng: here.lng - offsetMin * 0.0011,
            }
          : {}),
      } satisfies BusArrival;
    });
  });
  return out;
}
