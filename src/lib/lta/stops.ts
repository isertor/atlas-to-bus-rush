// Stop coordinates for the map, from LTA DataMall's BusStops dataset.
//
// The dataset is ~5k stops served 500 at a time; we page through it once,
// keep only the stops the configured plans reference, and cache the result
// in-module for a day (stop locations don't move). In mock mode we lay the
// stops out along a plausible eastbound line so the map demo still renders
// without a key — positions are deterministic, not real.

export interface StopCoord {
  lat: number;
  lng: number;
}

interface LtaBusStopRow {
  BusStopCode: string;
  Description?: string;
  Latitude?: number;
  Longitude?: number;
}

const BUS_STOPS_URL = "https://datamall2.mytransport.sg/ltaodataservice/BusStops";
const PAGE = 500;
const MAX_PAGES = 12; // ~6000 stops, the whole island
const CACHE_MS = 24 * 60 * 60 * 1000;

let cache: { at: number; coords: Record<string, StopCoord> } | null = null;

export async function getStopCoords(codes: string[]): Promise<Record<string, StopCoord>> {
  const key = process.env.LTA_ACCOUNT_KEY;
  const useMock = process.env.USE_MOCK_LTA === "1" || !key;
  if (useMock) {
    return Object.fromEntries(codes.map((c) => [c, mockStopCoord(c, codes)]));
  }

  if (cache && Date.now() - cache.at < CACHE_MS && codes.every((c) => c in cache!.coords)) {
    return pick(cache.coords, codes);
  }

  const wanted = new Set(codes);
  const coords: Record<string, StopCoord> = {};
  for (let page = 0; page < MAX_PAGES && wanted.size > 0; page++) {
    const res = await fetch(`${BUS_STOPS_URL}?$skip=${page * PAGE}`, {
      headers: { AccountKey: key as string, accept: "application/json" },
    });
    if (!res.ok) throw new Error(`LTA BusStops failed: ${res.status} ${res.statusText}`);
    const rows = ((await res.json()).value ?? []) as LtaBusStopRow[];
    if (rows.length === 0) break;
    for (const row of rows) {
      if (wanted.has(row.BusStopCode) && row.Latitude != null && row.Longitude != null) {
        coords[row.BusStopCode] = { lat: row.Latitude, lng: row.Longitude };
        wanted.delete(row.BusStopCode);
      }
    }
  }

  cache = { at: Date.now(), coords: { ...(cache?.coords ?? {}), ...coords } };
  return pick(cache.coords, codes);
}

function pick(all: Record<string, StopCoord>, codes: string[]): Record<string, StopCoord> {
  return Object.fromEntries(codes.filter((c) => c in all).map((c) => [c, all[c]]));
}

/**
 * Deterministic demo coordinates: stops spaced along an eastbound line through
 * eastern Singapore, ordered by their position in `codes` (which follows the
 * plan's journey order), with a small per-code wiggle so labels don't overlap.
 */
export function mockStopCoord(code: string, codes: string[]): StopCoord {
  const i = Math.max(0, codes.indexOf(code));
  const seed = [...code].reduce((s, c) => s + c.charCodeAt(0), 0);
  return {
    lat: 1.32 + ((seed % 7) - 3) * 0.0012 + i * 0.0035,
    lng: 103.88 + i * 0.012,
  };
}
