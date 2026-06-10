import { NextResponse } from "next/server";
import { ALL_PLANS, DIRECTIONS, parseDirectionId } from "@/config/commute";
import { getStopCoords } from "@/lib/lta/stops";
import { buildMapData, stopsInPlans, type MapData } from "@/lib/map";
import { buildArrivalIndex } from "@/lib/recommend";

// Map preview for the planning screen: journey stops + live bus positions.
// Journey mode doesn't use this — /api/track bundles the map in its response.
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
    const body: MapResponse = {
      now,
      mock: process.env.USE_MOCK_LTA === "1" || !process.env.LTA_ACCOUNT_KEY,
      partial: failures > 0,
      map: buildMapData(commute.plans, arrivals, coords),
    };
    return NextResponse.json(body);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 502 },
    );
  }
}
