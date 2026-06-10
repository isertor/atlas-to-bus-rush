import { NextResponse } from "next/server";
import { ALL_PLANS, DIRECTIONS, parseDirectionId } from "@/config/commute";
import type { RideLeg } from "@/lib/engine/types";
import { getStopCoords } from "@/lib/lta/stops";
import { buildMapData, stopsInPlans, type MapData } from "@/lib/map";
import { journeyPaths } from "@/lib/paths";
import { buildArrivalIndex } from "@/lib/recommend";

// Map preview for the planning screen: the direction's stops, the full route
// preview (dashed), and ONLY the trunk buses approaching your boarding stop —
// the buses you're actually about to catch, not every vehicle on the island.
// Journey mode doesn't use this — /api/track bundles its own map payload.
//
//   GET /api/map?dir=to-home|to-office

export const dynamic = "force-dynamic";

export interface MapResponse {
  now: number;
  mock: boolean;
  partial: boolean;
  map: MapData;
}

export async function GET(req: Request) {
  const commute = DIRECTIONS[parseDirectionId(new URL(req.url).searchParams.get("dir"))];
  try {
    const now = Date.now();
    const [{ index: arrivals, failures }, coords] = await Promise.all([
      buildArrivalIndex(commute.plans),
      getStopCoords(stopsInPlans(ALL_PLANS)).catch(() => ({})),
    ]);
    const firstRideIndex = commute.plans[0].legs.findIndex((l) => l.kind === "ride");
    const firstRide = commute.plans[0].legs[firstRideIndex] as RideLeg;
    const paths = await journeyPaths(commute.plans, firstRideIndex, coords, { riding: false }).catch(
      () => [],
    );
    const body: MapResponse = {
      now,
      mock: process.env.USE_MOCK_LTA === "1" || !process.env.LTA_ACCOUNT_KEY,
      partial: failures > 0,
      map: buildMapData(commute.plans, arrivals, coords, {
        specs: [{ services: [firstRide.service], stopCode: firstRide.board.code, limit: 3 }],
        paths,
      }),
    };
    return NextResponse.json(body);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 502 },
    );
  }
}
