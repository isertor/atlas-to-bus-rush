import type { Preferences } from "@/config/preferences";
import { MIN } from "@/lib/time";
import type { RideView } from "./board";
import { evaluatePlan, type PlanEstimate } from "./plan";
import { refineAboardAlightMs } from "./ridetime";
import { arrivalKey, type ArrivalIndex, type Plan, type RideLeg, type WalkLeg } from "./types";

// ---------------------------------------------------------------------------
//  Journey tracking: "I'm ON a bus" mode.
//
//  The leave-by board anchors everything to the OFFICE stop's ETAs, so the
//  moment your bus departs, its row vanishes — and with it the option you
//  committed to. Tracking flips the anchor: the journey is pinned to the bus
//  you BOARDED (its boarding time + the live ETAs at downstream stops), so the
//  committed option, the connection's arrival at the transfer, and the
//  stay-vs-switch margin all keep updating while you ride.
// ---------------------------------------------------------------------------

/** Where the rider is in the journey. Persisted client-side, sent per poll. */
export interface JourneyState {
  /**
   * The committed plan, or null while still on the shared trunk deciding
   * (e.g. riding 21 before the transfer: switch to 26 vs stay on).
   */
  planId: string | null;
  /** Index of the ride leg currently being ridden (in the reference plan). */
  legIndex: number;
  /** When the rider boarded that leg (epoch ms). */
  boardedMs: number;
  /**
   * Actual boarded service for an `anyOf` leg (rider takes whichever came
   * first; the engine can't know which). Defaults to the leg's `service`.
   */
  service?: string;
}

export interface TrackOption {
  planId: string;
  label: string;
  description?: string;
  feasible: boolean;
  reason?: string;
  /** Predicted time home, walking included. */
  arriveHomeMs: number | null;
  perceivedArriveMs: number | null;
  totalWaitMin: number;
  estimated: boolean;
  best: boolean;
  /**
   * Minutes between the rider's arrival at the decision stop and the next
   * connecting bus there (the "1 min wait — might miss it" number). Null when
   * the option has no fresh boarding (e.g. stay seated, or walk-only finish).
   */
  connectMin: number | null;
  /** Whether that connection wait is from live ETAs or an estimate. */
  connectSource: "live" | "estimated" | null;
  /** Remaining rides INCLUDING the one being ridden now (first entry). */
  rides: RideView[];
}

export interface TrackResult {
  /** The service being ridden right now. */
  service: string;
  /** Stop where the current leg ends (the next decision/alight point). */
  alightCode: string;
  alightName: string;
  /** Predicted arrival of YOUR bus at that stop. */
  myEtaMs: number;
  myEtaSource: "live" | "estimated";
  /** Live GPS of the bus you're on, when it could be matched. "You are here." */
  myBus: { lat: number; lng: number } | null;
  options: TrackOption[];
}

function rideView(partial: Omit<RideView, "waitMin" | "load" | "waitSource"> & Partial<RideView>): RideView {
  return { waitMin: 0, load: "UNKNOWN", waitSource: "live", ...partial };
}

/** Sum of walk minutes in `legs` (used when only walks remain after alighting). */
function walkMinutes(legs: Plan["legs"]): number {
  return legs.filter((l): l is WalkLeg => l.kind === "walk").reduce((s, l) => s + l.minutes, 0);
}

/**
 * Plans that contain the exact leg being ridden at `legIndex` — while deciding
 * on the shared trunk, that's every plan; once committed, just the one.
 */
export function candidatePlans(plans: Plan[], state: JourneyState): Plan[] {
  if (state.planId != null) {
    return plans.filter((p) => p.id === state.planId);
  }
  const ref = plans[0];
  const refLeg = ref?.legs[state.legIndex];
  if (!refLeg || refLeg.kind !== "ride") return [];
  return plans.filter((p) => {
    const leg = p.legs[state.legIndex];
    return (
      leg?.kind === "ride" &&
      leg.service === refLeg.service &&
      leg.board.code === refLeg.board.code &&
      leg.alight.code === refLeg.alight.code
    );
  });
}

/**
 * Evaluate the rest of the journey from aboard the current bus.
 *
 * 1. Project YOUR bus's arrival at the current leg's alight stop: match your
 *    boarding time + typical ride against that stop's live ETAs for your
 *    service (same approach as the long stay-on leg), falling back to the
 *    configured estimate.
 * 2. For each candidate plan, forward-simulate the remaining legs with the
 *    clock starting at that projected arrival — so the connecting bus's wait
 *    is "after MY bus gets there", not "after now".
 */
export function trackJourney(
  plans: Plan[],
  arrivals: ArrivalIndex,
  opts: { now: number; prefs: Preferences; state: JourneyState },
): TrackResult | null {
  const { prefs, state } = opts;
  const candidates = candidatePlans(plans, state);
  const ref = candidates[0];
  const leg = ref?.legs[state.legIndex];
  if (!ref || !leg || leg.kind !== "ride") return null;

  const ride = leg as RideLeg;
  const service = state.service ?? ride.service;
  const expectedRideMs = ride.rideMinutes * MIN;
  const refined = refineAboardAlightMs(arrivals, ride.alight.code, service, state.boardedMs, expectedRideMs);
  const myEtaMs = refined ?? state.boardedMs + expectedRideMs;
  const myEtaSource: "live" | "estimated" = refined != null ? "live" : "estimated";
  // The matched prediction carries the vehicle's live GPS — that's "you".
  const matched =
    refined != null
      ? (arrivals[arrivalKey(ride.alight.code, service)] ?? []).find((a) => a.arrivalMs === refined)
      : undefined;
  const myBus = matched?.lat != null && matched.lng != null ? { lat: matched.lat, lng: matched.lng } : null;

  const currentRide = rideView({
    service,
    boardName: ride.board.name,
    alightName: ride.alight.name,
    boardMs: state.boardedMs,
    alightMs: myEtaMs,
    alreadyAboard: true,
    rideTimeSource: myEtaSource,
  });

  const evaluated = candidates.map((plan) => {
    const rest = plan.legs.slice(state.legIndex + 1);
    if (rest.some((l) => l.kind === "ride")) {
      const est = evaluatePlan(plan, arrivals, { now: myEtaMs, prefs, fromLegIndex: state.legIndex + 1 });
      return { plan, est };
    }
    // Only walks left: home = my alight time + the walk. Synthesize a minimal
    // estimate so ranking below treats it uniformly.
    const arriveHomeMs = myEtaMs + walkMinutes(rest) * MIN;
    const est: PlanEstimate = {
      planId: plan.id,
      feasible: true,
      leaveOfficeMs: null,
      firstBoardMs: null,
      arriveHomeMs,
      perceivedArriveMs: arriveHomeMs,
      totalWaitMin: 0,
      crowdPenaltyMin: 0,
      estimated: false,
      rides: [],
    };
    return { plan, est };
  });

  const feasiblePerceived = evaluated
    .filter(({ est }) => est.feasible && est.perceivedArriveMs != null)
    .map(({ est }) => est.perceivedArriveMs as number);
  const best = feasiblePerceived.length > 0 ? Math.min(...feasiblePerceived) : null;

  const options: TrackOption[] = evaluated.map(({ plan, est }) => {
    // The connection number: the first fresh boarding ahead, measured from
    // when YOU reach the stop where you board it (my bus's ETA if it's the
    // very next leg, otherwise the previous leg's alight time — e.g. the
    // Eunos onward bus is measured from your arrival at Eunos, not at the
    // transfer).
    const idx = est.rides.findIndex((r) => !r.alreadyAboard);
    const firstBoarded = idx >= 0 ? est.rides[idx] : undefined;
    const reachStopMs = idx > 0 ? est.rides[idx - 1].alightMs : myEtaMs;
    return {
      planId: plan.id,
      label: plan.label,
      description: plan.description,
      feasible: est.feasible,
      reason: est.reason,
      arriveHomeMs: est.arriveHomeMs,
      perceivedArriveMs: est.perceivedArriveMs,
      totalWaitMin: Math.round(est.totalWaitMin),
      estimated: est.estimated,
      best: est.feasible && est.perceivedArriveMs != null && est.perceivedArriveMs === best,
      connectMin: firstBoarded ? Math.max(0, Math.round((firstBoarded.boardMs - reachStopMs) / MIN)) : null,
      connectSource: firstBoarded ? firstBoarded.waitSource : null,
      rides: [
        currentRide,
        ...est.rides.map((r) =>
          rideView({
            service: r.service,
            boardName: r.board.name,
            alightName: r.alight.name,
            boardMs: r.boardMs,
            alightMs: r.alightMs,
            waitMin: Math.round(r.waitMin),
            load: r.load,
            type: r.type,
            alreadyAboard: r.alreadyAboard,
            rideTimeSource: r.rideTimeSource,
            waitSource: r.waitSource,
          }),
        ),
      ],
    };
  });

  options.sort(
    (a, b) =>
      Number(b.best) - Number(a.best) ||
      (a.perceivedArriveMs ?? Infinity) - (b.perceivedArriveMs ?? Infinity),
  );

  return {
    service,
    alightCode: ride.alight.code,
    alightName: ride.alight.name,
    myEtaMs,
    myEtaSource,
    myBus,
    options,
  };
}

/**
 * The buses worth watching on the map right now: for each candidate plan, the
 * NEXT fresh boarding (skipping stay-seated continuations) — its services at
 * its boarding stop. Later boardings are noise until you get there.
 */
export function nextBoardingSpecs(
  plans: Plan[],
  state: JourneyState,
): { services: string[]; stopCode: string }[] {
  const specs: { services: string[]; stopCode: string }[] = [];
  for (const plan of candidatePlans(plans, state)) {
    for (let i = state.legIndex + 1; i < plan.legs.length; i++) {
      const leg = plan.legs[i];
      if (leg.kind !== "ride") continue;
      if ((leg as RideLeg).alreadyAboard) continue;
      const ride = leg as RideLeg;
      specs.push({
        services: ride.anyOf?.length ? ride.anyOf : [ride.service],
        stopCode: ride.board.code,
      });
      break;
    }
  }
  return specs;
}

/** Stops still AHEAD of the rider: the current alight + everything after it.
 * Passed stops drop off the map as the journey advances. */
export function remainingStopCodes(plans: Plan[], state: JourneyState): Set<string> {
  const set = new Set<string>();
  const candidates = candidatePlans(plans, state);
  const current = candidates[0]?.legs[state.legIndex];
  if (current?.kind === "ride") set.add((current as RideLeg).alight.code);
  for (const plan of candidates) {
    for (let i = state.legIndex + 1; i < plan.legs.length; i++) {
      const leg = plan.legs[i];
      if (leg.kind === "ride") {
        set.add(leg.board.code);
        set.add(leg.alight.code);
      }
    }
  }
  return set;
}
