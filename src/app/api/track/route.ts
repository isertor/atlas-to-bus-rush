import { NextResponse } from "next/server";
import { PLANS } from "@/config/commute";
import { PREFERENCES } from "@/config/preferences";
import { trackJourney, type JourneyState, type TrackResult } from "@/lib/engine/track";
import { getStopCoords } from "@/lib/lta/stops";
import { buildMapData, type MapData } from "@/lib/map";
import { buildArrivalIndex, stopsInPlans } from "@/lib/recommend";

// Journey-mode endpoint: "I'm ON the bus — keep my options alive."
//
//   GET /api/track?legIndex=1&boardedMs=...[&planId=...][&service=...]
//
// Everything is anchored to the boarded bus (legIndex + boardedMs), not the
// origin stop, so options no longer vanish once the bus departs. Returns the
// live stay-vs-switch options evaluated from YOUR bus's projected arrival at
// the next decision stop, plus the map payload (stops + live bus positions)
// in the same response — one poll, one set of LTA calls.

export const dynamic = "force-dynamic";

export interface TrackResponse extends TrackResult {
  now: number;
  mock: boolean;
  partial: boolean;
  map: MapData;
}

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const legIndex = Number(params.get("legIndex"));
  const boardedMs = Number(params.get("boardedMs"));
  if (!Number.isInteger(legIndex) || legIndex < 0 || !Number.isFinite(boardedMs)) {
    return NextResponse.json({ error: "legIndex and boardedMs are required" }, { status: 400 });
  }
  const state: JourneyState = {
    planId: params.get("planId"),
    legIndex,
    boardedMs,
    service: params.get("service") ?? undefined,
  };

  try {
    const now = Date.now();
    const [{ index: arrivals, failures }, coords] = await Promise.all([
      buildArrivalIndex(PLANS),
      getStopCoords(stopsInPlans(PLANS)).catch(() => ({})),
    ]);
    const result = trackJourney(PLANS, arrivals, { now, prefs: PREFERENCES, state });
    if (!result) {
      return NextResponse.json({ error: "No plan matches that journey position" }, { status: 400 });
    }
    const body: TrackResponse = {
      ...result,
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
