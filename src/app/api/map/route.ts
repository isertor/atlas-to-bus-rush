import { NextResponse } from "next/server";
import { PLANS } from "@/config/commute";
import { getStopCoords } from "@/lib/lta/stops";
import { buildMapData, type MapData } from "@/lib/map";
import { buildArrivalIndex, stopsInPlans } from "@/lib/recommend";

// Map preview for the planning screen: journey stops + live bus positions.
// Journey mode doesn't use this — /api/track bundles the map in its response.
//
//   GET /api/map

export const dynamic = "force-dynamic";

export interface MapResponse {
  now: number;
  mock: boolean;
  partial: boolean;
  map: MapData;
}

export async function GET() {
  try {
    const now = Date.now();
    const [{ index: arrivals, failures }, coords] = await Promise.all([
      buildArrivalIndex(PLANS),
      getStopCoords(stopsInPlans(PLANS)).catch(() => ({})),
    ]);
    const body: MapResponse = {
      now,
      mock: process.env.USE_MOCK_LTA === "1" || !process.env.LTA_ACCOUNT_KEY,
      partial: failures > 0,
      map: buildMapData(PLANS, arrivals, coords),
    };
    return NextResponse.json(body);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 502 },
    );
  }
}
