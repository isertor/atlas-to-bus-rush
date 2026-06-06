import type { Preferences } from "@/config/preferences";
import { MIN } from "@/lib/time";
import { liveAlightMs, refineAboardAlightMs } from "./ridetime";
import {
  arrivalKey,
  type ArrivalIndex,
  type BusArrival,
  type LoadCode,
  type Plan,
  type RideLeg,
  type StopRef,
} from "./types";

export interface ResolvedRide {
  service: string;
  board: StopRef;
  alight: StopRef;
  boardMs: number;
  alightMs: number;
  waitMin: number;
  load: LoadCode;
  alreadyAboard: boolean;
  /** Whether alight time came from live GPS matching or the configured estimate. */
  rideTimeSource: "live" | "estimated";
  /** Whether the wait before this ride is from live arrivals or an estimate. */
  waitSource: "live" | "estimated";
}

export interface PlanEstimate {
  planId: string;
  feasible: boolean;
  reason?: string;
  /** When to leave the office (back-calculated from the first bus). null if N/A. */
  leaveOfficeMs: number | null;
  /** Arrival time of the first bus you take. */
  firstBoardMs: number | null;
  /** Predicted time you reach home. */
  arriveHomeMs: number | null;
  /** Real arrival + crowd/wait penalties; what scoring compares. */
  perceivedArriveMs: number | null;
  totalWaitMin: number;
  crowdPenaltyMin: number;
  /** True if any connection wait had to be estimated (not live in LTA's window). */
  estimated: boolean;
  rides: ResolvedRide[];
}

export interface EvalContext {
  now: number;
  prefs: Preferences;
  /**
   * Anchor the FIRST ride to a specific bus arrival (epoch ms). When set, the
   * office leave-by time is back-calculated from it. Used to build the
   * leave-by board (one row per upcoming first-bus arrival).
   */
  anchorFirstBoardMs?: number;
  /**
   * Start evaluation at this leg index with the clock at `now` (you're already
   * partway through the journey). Used by the "switch vs stay" view at the
   * transfer stop. Legs before this index are ignored.
   */
  fromLegIndex?: number;
}

function infeasible(planId: string, reason: string): PlanEstimate {
  return {
    planId,
    feasible: false,
    reason,
    leaveOfficeMs: null,
    firstBoardMs: null,
    arriveHomeMs: null,
    perceivedArriveMs: null,
    totalWaitMin: 0,
    crowdPenaltyMin: 0,
    estimated: false,
    rides: [],
  };
}

/** Candidate services for a ride leg: the `anyOf` set, or just `service`. */
function legServices(ride: RideLeg): string[] {
  return ride.anyOf && ride.anyOf.length > 0 ? ride.anyOf : [ride.service];
}

/**
 * Find the soonest arrival at/after `readyMs` among one or more services at a
 * stop — i.e. "take the first bus that comes". Returns the chosen service and
 * its arrival, or null if none qualifies.
 */
function nextArrival(
  arrivals: ArrivalIndex,
  stopCode: string,
  services: string[],
  readyMs: number,
): { service: string; bus: BusArrival } | null {
  let best: { service: string; bus: BusArrival } | null = null;
  for (const service of services) {
    const list = arrivals[arrivalKey(stopCode, service)] ?? [];
    const found = list.find((a) => a.arrivalMs >= readyMs);
    if (found && (best === null || found.arrivalMs < best.bus.arrivalMs)) {
      best = { service, bus: found };
    }
  }
  return best;
}

/**
 * Evaluate a single plan against live arrivals, producing timings, crowding,
 * and a perceived arrival time. Pure function — fully unit-testable.
 */
export function evaluatePlan(plan: Plan, arrivals: ArrivalIndex, ctx: EvalContext): PlanEstimate {
  const { now, prefs } = ctx;
  const startIndex = ctx.fromLegIndex ?? 0;
  const legs = plan.legs.slice(startIndex);

  let cursorReadyMs = now; // earliest you're "ready" at your current position
  let walkBeforeFirstRideMs = 0; // accumulated walk time before the first ride
  let leaveOfficeMs: number | null = null;
  let firstBoardMs: number | null = null;
  let firstRideSeen = false;
  let crowdPenaltyMin = 0;
  let totalWaitMin = 0;
  let estimated = false;
  const rides: ResolvedRide[] = [];

  for (const leg of legs) {
    if (leg.kind === "walk") {
      cursorReadyMs += leg.minutes * MIN;
      if (!firstRideSeen) walkBeforeFirstRideMs += leg.minutes * MIN;
      continue;
    }

    const ride = leg as RideLeg;

    // You're already on this bus (en-route "stay on" leg). Can't GPS-match the
    // bus you're on, so estimate its arrival at the far stop from the configured
    // typical time, refined against the live ETAs there when possible.
    if (ride.alreadyAboard) {
      const boardMs = cursorReadyMs;
      const expectedRideMs = ride.rideMinutes * MIN;
      const refined = refineAboardAlightMs(arrivals, ride.alight.code, ride.service, boardMs, expectedRideMs);
      const alightMs = refined ?? boardMs + expectedRideMs;
      rides.push({
        service: ride.service,
        board: ride.board,
        alight: ride.alight,
        boardMs,
        alightMs,
        waitMin: 0,
        load: "UNKNOWN", // live load of the bus you're on isn't in the next-bus feed
        alreadyAboard: true,
        rideTimeSource: refined != null ? "live" : "estimated",
        waitSource: "live", // you're aboard — there is no wait here
      });
      cursorReadyMs = alightMs;
      if (!firstRideSeen) {
        firstRideSeen = true;
        firstBoardMs = boardMs;
        leaveOfficeMs = ctx.anchorFirstBoardMs != null ? boardMs - walkBeforeFirstRideMs - prefs.safetyBufferMin * MIN : now;
      }
      continue;
    }

    let boardMs: number;
    let load: LoadCode;
    let readyForRide: number;
    let boardBus: BusArrival | null;
    let chosenService = ride.service;
    let waitSource: "live" | "estimated" = "live";

    if (!firstRideSeen && ctx.anchorFirstBoardMs != null) {
      // Leave-by board: pin the first bus, back-calculate the office leave time.
      // (The first ride is always a single service, never an `anyOf` leg.)
      boardMs = ctx.anchorFirstBoardMs;
      const list = arrivals[arrivalKey(ride.board.code, ride.service)] ?? [];
      boardBus = list.find((a) => a.arrivalMs === boardMs) ?? null;
      load = boardBus?.load ?? "UNKNOWN";
      readyForRide = boardMs; // you target this bus, so wait ≈ 0
      leaveOfficeMs = boardMs - walkBeforeFirstRideMs - prefs.safetyBufferMin * MIN;
    } else {
      const buffer = firstRideSeen ? prefs.transferBufferMin : prefs.safetyBufferMin;
      readyForRide = cursorReadyMs + buffer * MIN;
      const services = legServices(ride);
      const next = nextArrival(arrivals, ride.board.code, services, readyForRide);
      if (next) {
        chosenService = next.service; // "take the first that comes" → which one it was
        boardMs = next.bus.arrivalMs;
        boardBus = next.bus;
        load = next.bus.load;
      } else {
        // The connecting bus isn't in LTA's live next-3 window yet (it's still
        // too far out). Don't drop the whole route — estimate the wait so the
        // option still shows, flagged as estimated.
        boardMs = readyForRide + prefs.estWaitMin * MIN;
        boardBus = null;
        load = "UNKNOWN";
        waitSource = "estimated";
        estimated = true;
      }
      if (!firstRideSeen) leaveOfficeMs = now; // forward sim: you left now
    }

    // Live in-vehicle ride time: match the boarded bus at the alight stop by GPS.
    const live = boardBus ? liveAlightMs(arrivals, ride.alight.code, chosenService, boardBus) : null;
    const useLive = live != null && live > boardMs;
    const alightMs = useLive ? (live as number) : boardMs + ride.rideMinutes * MIN;

    const waitMin = Math.max(0, (boardMs - readyForRide) / MIN);
    crowdPenaltyMin += prefs.crowdPenaltyMin[load];
    totalWaitMin += waitMin;
    rides.push({
      service: chosenService,
      board: ride.board,
      alight: ride.alight,
      boardMs,
      alightMs,
      waitMin,
      load,
      alreadyAboard: false,
      rideTimeSource: useLive ? "live" : "estimated",
      waitSource,
    });
    cursorReadyMs = alightMs;
    if (!firstRideSeen) {
      firstRideSeen = true;
      firstBoardMs = boardMs;
    }
  }

  if (!firstRideSeen) {
    return infeasible(plan.id, "Plan has no ride legs");
  }

  const arriveHomeMs = cursorReadyMs;
  const perceivedArriveMs =
    arriveHomeMs + crowdPenaltyMin * MIN + totalWaitMin * prefs.waitPenaltyPerMin * MIN;

  return {
    planId: plan.id,
    feasible: true,
    leaveOfficeMs,
    firstBoardMs,
    arriveHomeMs,
    perceivedArriveMs,
    totalWaitMin: Math.round(totalWaitMin),
    crowdPenaltyMin,
    estimated,
    rides,
  };
}
