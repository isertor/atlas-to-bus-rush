// Route geometry from LTA DataMall's BusRoutes dataset.
//
// BusRoutes lists every service's ordered stop sequence (per direction 1/2).
// Drawing a polyline through each intermediate stop's coordinates follows the
// roads closely enough for a commute map — Singapore's stops are ~300m apart.
// The dataset is ~26k rows; we page it once (parallel batches), keep only the
// services the commute uses, and cache for a day. Mock mode returns null so
// callers fall back to straight key-stop segments.

import { ALL_PLANS } from "@/config/commute";
import { fetchAllPages, isMockLta } from "./stops";

interface LtaBusRouteRow {
  ServiceNo: string;
  Direction: number;
  StopSequence: number;
  BusStopCode: string;
}

const BUS_ROUTES_URL = "https://datamall2.mytransport.sg/ltaodataservice/BusRoutes";
const MAX_PAGES = 64; // ~32k rows, the whole dataset
const CACHE_MS = 24 * 60 * 60 * 1000;

/** service → direction → stop codes in sequence order. */
type RouteTable = Map<string, Map<number, string[]>>;

let cache: { at: number; table: RouteTable } | null = null;
let inflight: Promise<RouteTable> | null = null;

function commuteServices(): Set<string> {
  const set = new Set<string>();
  for (const plan of ALL_PLANS) {
    for (const leg of plan.legs) {
      if (leg.kind === "ride") {
        set.add(leg.service);
        for (const s of leg.anyOf ?? []) set.add(s);
      }
    }
  }
  return set;
}

async function loadRoutes(): Promise<RouteTable> {
  const key = process.env.LTA_ACCOUNT_KEY as string;
  const wanted = commuteServices();
  const rows = await fetchAllPages<LtaBusRouteRow>(BUS_ROUTES_URL, key, MAX_PAGES);
  const grouped = new Map<string, Map<number, { seq: number; code: string }[]>>();
  for (const row of rows) {
    if (!wanted.has(row.ServiceNo)) continue;
    const byDir = grouped.get(row.ServiceNo) ?? new Map();
    grouped.set(row.ServiceNo, byDir);
    const list = byDir.get(row.Direction) ?? [];
    byDir.set(row.Direction, list);
    list.push({ seq: row.StopSequence, code: row.BusStopCode });
  }
  const table: RouteTable = new Map();
  for (const [service, byDir] of grouped) {
    const dirs = new Map<number, string[]>();
    for (const [dir, list] of byDir) {
      dirs.set(
        dir,
        list.sort((a, b) => a.seq - b.seq).map((x) => x.code),
      );
    }
    table.set(service, dirs);
  }
  return table;
}

async function getRouteTable(): Promise<RouteTable> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.table;
  if (!inflight) {
    inflight = loadRoutes()
      .then((table) => {
        cache = { at: Date.now(), table };
        return table;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/**
 * Ordered stop codes a `service` passes from `fromCode` to `toCode`
 * (inclusive), or null when unknown (mock mode, dataset miss, or the stops
 * aren't on the same direction in that order). Callers fall back to a
 * straight segment.
 */
export async function routeStops(
  service: string,
  fromCode: string,
  toCode: string,
): Promise<string[] | null> {
  if (isMockLta()) return null;
  try {
    const byDir = (await getRouteTable()).get(service);
    if (!byDir) return null;
    for (const codes of byDir.values()) {
      const i = codes.indexOf(fromCode);
      if (i === -1) continue;
      const j = codes.indexOf(toCode, i + 1);
      if (j !== -1) return codes.slice(i, j + 1);
    }
    return null;
  } catch {
    return null; // a flaky route fetch must never take down the map
  }
}
