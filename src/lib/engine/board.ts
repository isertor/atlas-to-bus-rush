import type { Preferences } from "@/config/preferences";
import { MIN } from "@/lib/time";
import { evaluatePlan, type PlanEstimate } from "./plan";
import { bestPerceived, scoreAgainstBest } from "./score";
import { arrivalKey, type ArrivalIndex, type LoadCode, type Plan, type RideLeg } from "./types";

// ---------------------------------------------------------------------------
//  Serializable result shapes consumed by the API + UI.
// ---------------------------------------------------------------------------

export interface RideView {
  service: string;
  boardName: string;
  alightName: string;
  boardMs: number;
  alightMs: number;
  waitMin: number;
  load: LoadCode;
  alreadyAboard: boolean;
  rideTimeSource: "live" | "estimated";
  waitSource: "live" | "estimated";
}

export interface PlanOption {
  planId: string;
  label: string;
  description?: string;
  feasible: boolean;
  reason?: string;
  leaveOfficeMs: number | null;
  firstBoardMs: number | null;
  arriveHomeMs: number | null;
  /** Real arrival + crowd/wait penalties. Used for cross-option scoring. */
  perceivedArriveMs: number | null;
  score: number;
  totalWaitMin: number;
  /** True if any connection wait was estimated (not live yet). */
  estimated: boolean;
  rides: RideView[];
}

export interface LeaveByRow {
  /** Arrival of the shared first bus this row is built around. */
  firstBoardMs: number;
  firstService: string;
  leaveOfficeMs: number | null;
  /** Whether leaving for this bus falls in the user's usual departure window. */
  withinWindow: boolean;
  /** Best plan to take if you catch this first bus. */
  best: PlanOption;
  /** All plans ranked, for "see alternatives". */
  options: PlanOption[];
}

function toView(est: PlanEstimate, plan: Plan, score: number): PlanOption {
  return {
    planId: est.planId,
    label: plan.label,
    description: plan.description,
    feasible: est.feasible,
    reason: est.reason,
    leaveOfficeMs: est.leaveOfficeMs,
    firstBoardMs: est.firstBoardMs,
    arriveHomeMs: est.arriveHomeMs,
    perceivedArriveMs: est.perceivedArriveMs,
    score,
    totalWaitMin: est.totalWaitMin,
    estimated: est.estimated,
    rides: est.rides.map((r) => ({
      service: r.service,
      boardName: r.board.name,
      alightName: r.alight.name,
      boardMs: r.boardMs,
      alightMs: r.alightMs,
      waitMin: Math.round(r.waitMin),
      load: r.load,
      alreadyAboard: r.alreadyAboard,
      rideTimeSource: r.rideTimeSource,
      waitSource: r.waitSource,
    })),
  };
}

/** Score a set of estimates against their shared best and sort best-first. */
function rankEstimates(
  estimates: PlanEstimate[],
  plansById: Map<string, Plan>,
  prefs: Preferences,
): PlanOption[] {
  const best = bestPerceived(estimates);
  return estimates
    .map((est) => {
      const score =
        est.feasible && est.perceivedArriveMs != null && best != null
          ? scoreAgainstBest(est.perceivedArriveMs, best, prefs)
          : 0;
      return toView(est, plansById.get(est.planId)!, score);
    })
    .sort((a, b) => b.score - a.score || (a.arriveHomeMs ?? Infinity) - (b.arriveHomeMs ?? Infinity));
}

/** The first ride leg of a plan (the bus you board first). */
function firstRide(plan: Plan): RideLeg | null {
  return (plan.legs.find((l) => l.kind === "ride") as RideLeg | undefined) ?? null;
}

/**
 * Build the leave-by board: for each upcoming arrival of the shared first bus
 * (within the departure window), the best plan to take and when to leave the
 * office. This is the "always-on" recommendation list.
 */
export function buildLeaveByBoard(
  plans: Plan[],
  arrivals: ArrivalIndex,
  opts: {
    now: number;
    prefs: Preferences;
    maxRows?: number;
    /** Optional usual departure window — used to *annotate* rows, not filter them. */
    isWithinWindow?: (leaveOfficeMs: number) => boolean;
  },
): LeaveByRow[] {
  const { now, prefs } = opts;
  const maxRows = opts.maxRows ?? 4;
  const plansById = new Map(plans.map((p) => [p.id, p]));

  // Group plans by their shared first ride (service @ stop).
  const groups = new Map<string, Plan[]>();
  for (const plan of plans) {
    const fr = firstRide(plan);
    if (!fr) continue;
    const key = arrivalKey(fr.board.code, fr.service);
    groups.set(key, [...(groups.get(key) ?? []), plan]);
  }

  const rows: LeaveByRow[] = [];
  for (const [key, groupPlans] of groups) {
    const fr = firstRide(groupPlans[0])!;
    // Always show the next upcoming buses from now (the window is context only).
    const candidates = (arrivals[key] ?? []).filter((a) => a.arrivalMs >= now);

    for (const cand of candidates) {
      const estimates = groupPlans.map((p) =>
        evaluatePlan(p, arrivals, { now, prefs, anchorFirstBoardMs: cand.arrivalMs }),
      );
      const options = rankEstimates(estimates, plansById, prefs);
      const best = options[0];
      // Skip rows where no plan is feasible (e.g. the connecting bus isn't yet
      // within LTA's ~3-bus lookahead for a first bus that's far out).
      if (!best || !best.feasible) continue;
      rows.push({
        firstBoardMs: cand.arrivalMs,
        firstService: fr.service,
        leaveOfficeMs: best.leaveOfficeMs,
        withinWindow:
          best.leaveOfficeMs != null && opts.isWithinWindow
            ? opts.isWithinWindow(best.leaveOfficeMs)
            : false,
        best,
        options,
      });
    }
  }

  const shown = rows.sort((a, b) => a.firstBoardMs - b.firstBoardMs).slice(0, maxRows);

  // Re-score each row's headline best plan ACROSS the shown departures, so the
  // score reflects which leave-time gets you home best overall — not just the
  // best plan for that one bus (which is always 100 within its own row).
  const globalBest = Math.min(
    ...shown.map((r) => r.best.perceivedArriveMs ?? Infinity).filter((n) => Number.isFinite(n)),
  );
  if (Number.isFinite(globalBest)) {
    for (const row of shown) {
      if (row.best.perceivedArriveMs != null) {
        row.best.score = scoreAgainstBest(row.best.perceivedArriveMs, globalBest, prefs);
      }
    }
  }

  return shown;
}

/**
 * "Leave now / Check now": forward-simulate every plan assuming you leave the
 * office at `now`, ranked best-first.
 */
export function decideLeaveNow(
  plans: Plan[],
  arrivals: ArrivalIndex,
  opts: { now: number; prefs: Preferences },
): PlanOption[] {
  const plansById = new Map(plans.map((p) => [p.id, p]));
  const estimates = plans.map((p) => evaluatePlan(p, arrivals, { now: opts.now, prefs: opts.prefs }));
  return rankEstimates(estimates, plansById, opts.prefs);
}

/**
 * "Switch vs stay": you're at (or approaching) the transfer stop right now.
 * Evaluate each plan from its decision leg with the clock at `now`, ranked
 * best-first. The top option is the live recommendation.
 */
export function decideAtTransfer(
  plans: Plan[],
  arrivals: ArrivalIndex,
  opts: { now: number; prefs: Preferences },
): PlanOption[] {
  const plansById = new Map(plans.map((p) => [p.id, p]));
  const estimates = plans.map((p) => {
    const fromLegIndex = p.decisionLegIndex ?? p.legs.findIndex((l) => l.kind === "ride");
    return evaluatePlan(p, arrivals, { now: opts.now, prefs: opts.prefs, fromLegIndex });
  });
  return rankEstimates(estimates, plansById, opts.prefs);
}
