import type { BusArrival } from "@/lib/engine/types";
import { MIN } from "@/lib/time";
import { parseLoad } from "./load";
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
  return {
    arrivalMs: ms,
    load: parseLoad(nb.Load),
    type: nb.Type || undefined,
    feature: nb.Feature || undefined,
    monitored: nb.Monitored === 1,
  };
}

// ---------------------------------------------------------------------------
//  Mock data — deterministic, derived from the stop code + current minute so it
//  looks "live" (changes over time) but is reproducible within a minute.
// ---------------------------------------------------------------------------

const LOADS = ["SEA", "SDA", "LSD"] as const;

function mockStopArrivals(stopCode: string): Record<string, BusArrival[]> {
  const now = Date.now();
  const seed = [...stopCode].reduce((s, c) => s + c.charCodeAt(0), 0);
  // Every service we might ask about across the placeholder config:
  const services = ["26", "21", "23"];
  // NOTE: real LTA returns only the next ~3 buses per service. We emit a longer
  // horizon here purely so the demo shows feasible multi-leg connections in all
  // views; the engine handles the sparse real-world case via its feasibility check.
  const out: Record<string, BusArrival[]> = {};
  services.forEach((svc, i) => {
    const base = ((seed + i * 3 + svc.charCodeAt(0)) % 5) + 1; // 1..5 min to first bus
    out[svc] = [0, 1, 2, 3, 4, 5].map((n) => {
      const offsetMin = base + n * (6 + ((seed + n) % 4)); // ~6–9 min headways
      const loadIdx = (seed + i + n) % LOADS.length;
      return {
        arrivalMs: now + offsetMin * MIN,
        load: parseLoad(LOADS[loadIdx]),
        type: n % 2 === 0 ? "DD" : "SD",
        monitored: true,
      } satisfies BusArrival;
    });
  });
  return out;
}
