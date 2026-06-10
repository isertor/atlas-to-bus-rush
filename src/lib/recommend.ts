import { DEPARTURE_WINDOW, DESTINATION_NAME, ORIGIN_NAME, PLANS } from "@/config/commute";
import { PREFERENCES } from "@/config/preferences";
import { fetchStopArrivals } from "@/lib/lta/client";
import { withinWindow } from "@/lib/time";
import {
  buildLeaveByBoard,
  decideAtTransfer,
  decideLeaveNow,
  type LeaveByRow,
  type PlanOption,
} from "@/lib/engine/board";
import { arrivalKey, type ArrivalIndex, type Plan } from "@/lib/engine/types";

export type Mode = "board" | "leave-now" | "at-transfer";

export interface RecommendResult {
  origin: string;
  destination: string;
  now: number;
  mode: Mode;
  /** The user's usual departure window (informational; used to annotate the board). */
  departureWindow: { earliest: string; latest: string };
  /** Always present: the leave-by board across the departure window. */
  board: LeaveByRow[];
  /** Present for "leave-now" / "at-transfer": ranked live options. */
  options?: PlanOption[];
  /** Whether this run used mock data (no real LTA key / mock flag on). */
  mock: boolean;
  /** True if one or more stop fetches failed (data is incomplete, not empty). */
  partial: boolean;
}

/**
 * Every distinct stop code referenced by the configured plans — both board AND
 * alight stops, so we can derive live ride times by matching a bus across them.
 */
function stopsInPlans(plans: Plan[]): string[] {
  const set = new Set<string>();
  for (const plan of plans) {
    for (const leg of plan.legs) {
      if (leg.kind === "ride") {
        set.add(leg.board.code);
        set.add(leg.alight.code);
      }
    }
  }
  return [...set];
}

/**
 * Fetch all needed stops and flatten into an ArrivalIndex keyed stop:service.
 * Per-stop failures are tolerated (that stop just has no arrivals) so one flaky
 * request can't blank the whole app — `failures` reports how many failed.
 */
async function buildArrivalIndex(plans: Plan[]): Promise<{ index: ArrivalIndex; failures: number }> {
  const stops = stopsInPlans(plans);
  const index: ArrivalIndex = {};
  let failures = 0;
  const results = await Promise.all(
    stops.map(async (code) => {
      try {
        return { code, byService: await fetchStopArrivals(code) };
      } catch {
        failures++;
        return { code, byService: {} as Record<string, never> };
      }
    }),
  );
  for (const { code, byService } of results) {
    for (const [service, arrivals] of Object.entries(byService)) {
      index[arrivalKey(code, service)] = arrivals;
    }
  }
  return { index, failures };
}

export async function getRecommendation(mode: Mode, now = Date.now()): Promise<RecommendResult> {
  const { index: arrivals, failures } = await buildArrivalIndex(PLANS);
  const mock = process.env.USE_MOCK_LTA === "1" || !process.env.LTA_ACCOUNT_KEY;

  const board = buildLeaveByBoard(PLANS, arrivals, {
    now,
    prefs: PREFERENCES,
    isWithinWindow: (ms) => withinWindow(ms, DEPARTURE_WINDOW, now),
  });

  const result: RecommendResult = {
    origin: ORIGIN_NAME,
    destination: DESTINATION_NAME,
    now,
    mode,
    departureWindow: DEPARTURE_WINDOW,
    board,
    mock,
    partial: failures > 0,
  };

  if (mode === "leave-now") {
    result.options = decideLeaveNow(PLANS, arrivals, { now, prefs: PREFERENCES });
  } else if (mode === "at-transfer") {
    result.options = decideAtTransfer(PLANS, arrivals, { now, prefs: PREFERENCES });
  }

  return result;
}

// Re-exported for tests / callers that build their own index.
export { buildArrivalIndex, stopsInPlans };
