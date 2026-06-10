import { NextResponse } from "next/server";
import { ALL_PLANS, DIRECTIONS, parseDirectionId } from "@/config/commute";
import { PREFERENCES } from "@/config/preferences";
import {
  candidatePlans,
  nextBoardingSpecs,
  remainingStopCodes,
  trackJourney,
  type JourneyState,
  type TrackResult,
} from "@/lib/engine/track";
import { getStopCoords } from "@/lib/lta/stops";
import { buildMapData, stopsInPlans, type MapData } from "@/lib/map";
import { journeyPaths } from "@/lib/paths";
import { buildArrivalIndex } from "@/lib/recommend";

// Journey-mode endpoint: "I'm ON the bus — keep my options alive."
//
//   GET /api/track?dir=to-home&legIndex=1&boardedMs=...[&planId=...][&service=...]
//
// Everything is anchored to the boarded bus (legIndex + boardedMs), not the
// origin stop, so options no longer vanish once the bus departs. Returns the
// live stay-vs-switch options evaluated from YOUR bus's projected arrival at
// the next decision stop, plus a journey-focused map payload: only the stops
// still ahead, only the buses you could board next, the remaining route line
// (trimmed to your bus's live position), and your bus itself as "you".

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
  const commute = DIRECTIONS[parseDirectionId(params.get("dir"))];
  const state: JourneyState = {
    planId: params.get("planId"),
    legIndex,
    boardedMs,
    service: params.get("service") ?? undefined,
  };

  try {
    const now = Date.now();
    const [{ index: arrivals, failures }, coords] = await Promise.all([
      buildArrivalIndex(commute.plans),
      // Coords for BOTH directions so the mock layout stays canonical; live
      // LTA lookups are served from the cached full table anyway.
      getStopCoords(stopsInPlans(ALL_PLANS)).catch(() => ({})),
    ]);
    const result = trackJourney(commute.plans, arrivals, { now, prefs: PREFERENCES, state });
    if (!result) {
      return NextResponse.json({ error: "No plan matches that journey position" }, { status: 400 });
    }
    // Paths for the CANDIDATE plans only — once committed, the other option's
    // route must disappear from the map.
    const paths = await journeyPaths(candidatePlans(commute.plans, state), legIndex, coords, {
      riding: true,
      currentService: result.service,
      myBus: result.myBus,
    }).catch(() => []);
    const body: TrackResponse = {
      ...result,
      now,
      mock: process.env.USE_MOCK_LTA === "1" || !process.env.LTA_ACCOUNT_KEY,
      partial: failures > 0,
      map: buildMapData(commute.plans, arrivals, coords, {
        specs: nextBoardingSpecs(commute.plans, state),
        stopCodes: remainingStopCodes(commute.plans, state),
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
