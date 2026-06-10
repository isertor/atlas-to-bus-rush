import type { Plan, RideLeg } from "@/lib/engine/types";
import { routeStops } from "@/lib/lta/routes";
import { getStopCoords, type StopCoord } from "@/lib/lta/stops";
import { slicePathAt, type MapPath } from "@/lib/map";

// Assembles the route polylines for the map: each ride leg becomes a path
// through the service's actual stop sequence (LTA BusRoutes), falling back to
// a straight key-stop segment when the geometry is unknown (mock mode, or a
// service/stop pair the dataset can't resolve).

async function legPoints(
  service: string,
  fromCode: string,
  toCode: string,
  keyCoords: Record<string, StopCoord>,
): Promise<[number, number][]> {
  const codes = await routeStops(service, fromCode, toCode);
  if (codes && codes.length >= 2) {
    const coords = await getStopCoords(codes); // served from the full-table cache
    const pts = codes
      .filter((c) => c in coords)
      .map((c) => [coords[c].lat, coords[c].lng] as [number, number]);
    if (pts.length >= 2) return pts;
  }
  const a = keyCoords[fromCode];
  const b = keyCoords[toCode];
  return a && b
    ? [
        [a.lat, a.lng],
        [b.lat, b.lng],
      ]
    : [];
}

/**
 * Route polylines for the journey from `fromLegIndex` across `plans`.
 *
 * Riding: the leg at `fromLegIndex` is drawn as `current` — trimmed to start
 * at `myBus` when its position is known, so the line behind the bus clears as
 * it advances — and everything after it as dashed `onward` (shared segments
 * deduped across plans). Planning (`riding: false`): every leg is `onward`,
 * a preview of the whole journey.
 */
export async function journeyPaths(
  plans: Plan[],
  fromLegIndex: number,
  keyCoords: Record<string, StopCoord>,
  opts: { riding: boolean; currentService?: string; myBus?: { lat: number; lng: number } | null },
): Promise<MapPath[]> {
  const segments = new Map<string, { kind: MapPath["kind"]; service: string; from: string; to: string }>();

  for (const plan of plans) {
    for (let i = fromLegIndex; i < plan.legs.length; i++) {
      const leg = plan.legs[i];
      if (leg?.kind !== "ride") continue;
      const ride = leg as RideLeg;
      const isCurrent = opts.riding && i === fromLegIndex;
      const service = isCurrent ? opts.currentService ?? ride.service : ride.service;
      const key = `${service}:${ride.board.code}:${ride.alight.code}`;
      // A leg shared across plans is the same line; "current" wins the dedupe.
      if (!segments.has(key) || isCurrent) {
        segments.set(key, {
          kind: isCurrent ? "current" : "onward",
          service,
          from: ride.board.code,
          to: ride.alight.code,
        });
      }
    }
  }

  const paths = await Promise.all(
    [...segments.values()].map(async (seg): Promise<MapPath | null> => {
      let points = await legPoints(seg.service, seg.from, seg.to, keyCoords);
      if (points.length < 2) return null;
      if (seg.kind === "current" && opts.myBus) points = slicePathAt(points, opts.myBus);
      return { kind: seg.kind, points };
    }),
  );
  // Draw current on top: sort onward first.
  return (paths.filter(Boolean) as MapPath[]).sort((a) => (a.kind === "onward" ? -1 : 1));
}
