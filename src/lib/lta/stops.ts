// Stop coordinates for the map, from LTA DataMall's BusStops dataset.
//
// The dataset is ~5–6k stops served 500 at a time. We page through it ONCE
// (in parallel batches) and cache the WHOLE code→coord table for a day: route
// polylines need coordinates for every intermediate stop of a service, not
// just the journey's key stops, and stop locations don't move. In mock mode we
// lay the key stops out along a plausible eastbound line so the map demo still
// renders without a key — positions are deterministic, not real.

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
const MAX_PAGES = 16; // safety bound, ~8000 stops
const BATCH = 8; // concurrent page fetches
const CACHE_MS = 24 * 60 * 60 * 1000;

let cache: { at: number; coords: Record<string, StopCoord> } | null = null;
let inflight: Promise<Record<string, StopCoord>> | null = null;

export function isMockLta(): boolean {
  return process.env.USE_MOCK_LTA === "1" || !process.env.LTA_ACCOUNT_KEY;
}

async function fetchPage<T>(url: string, skip: number, key: string): Promise<T[]> {
  const res = await fetch(`${url}?$skip=${skip}`, {
    headers: { AccountKey: key, accept: "application/json" },
  });
  if (!res.ok) throw new Error(`LTA ${url} $skip=${skip} failed: ${res.status} ${res.statusText}`);
  return ((await res.json()).value ?? []) as T[];
}

/** Page through an LTA dataset in parallel batches until an empty page. */
export async function fetchAllPages<T>(url: string, key: string, maxPages = MAX_PAGES): Promise<T[]> {
  const all: T[] = [];
  for (let start = 0; start < maxPages; start += BATCH) {
    const batch = await Promise.all(
      Array.from({ length: Math.min(BATCH, maxPages - start) }, (_, i) =>
        fetchPage<T>(url, (start + i) * PAGE, key),
      ),
    );
    for (const rows of batch) all.push(...rows);
    if (batch.some((rows) => rows.length < PAGE)) break; // hit the end
  }
  return all;
}

async function loadAllStops(key: string): Promise<Record<string, StopCoord>> {
  const rows = await fetchAllPages<LtaBusStopRow>(BUS_STOPS_URL, key);
  const coords: Record<string, StopCoord> = {};
  for (const row of rows) {
    if (row.Latitude != null && row.Longitude != null && (row.Latitude !== 0 || row.Longitude !== 0)) {
      coords[row.BusStopCode] = { lat: row.Latitude, lng: row.Longitude };
    }
  }
  return coords;
}

/**
 * Coordinates for the given stop codes (missing codes are simply absent).
 * Mock mode synthesizes a deterministic layout instead of calling LTA.
 */
export async function getStopCoords(codes: string[]): Promise<Record<string, StopCoord>> {
  if (isMockLta()) {
    return Object.fromEntries(codes.map((c) => [c, mockStopCoord(c, codes)]));
  }
  const all = await getAllStopCoords();
  return Object.fromEntries(codes.filter((c) => c in all).map((c) => [c, all[c]]));
}

/** The full cached code→coord table (live mode only). */
export async function getAllStopCoords(): Promise<Record<string, StopCoord>> {
  const key = process.env.LTA_ACCOUNT_KEY as string;
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.coords;
  // Coalesce concurrent cold-cache requests into one paging pass.
  if (!inflight) {
    inflight = loadAllStops(key)
      .then((coords) => {
        cache = { at: Date.now(), coords };
        return coords;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
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
