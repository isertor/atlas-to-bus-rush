import type { Preferences } from "@/config/preferences";
import { MIN } from "@/lib/time";
import type { PlanEstimate } from "./plan";

/**
 * Convert a perceived arrival time into a 0–100 optimality score, relative to
 * the best (earliest perceived) option in the set being compared. The best
 * option scores 100; every option loses `scorePenaltyPerMin` points per
 * perceived-minute it arrives later than the best.
 */
export function scoreAgainstBest(
  perceivedArriveMs: number,
  bestPerceivedArriveMs: number,
  prefs: Preferences,
): number {
  const minutesWorse = Math.max(0, (perceivedArriveMs - bestPerceivedArriveMs) / MIN);
  return Math.max(0, Math.min(100, Math.round(100 - minutesWorse * prefs.scorePenaltyPerMin)));
}

/** Lowest perceived arrival among feasible estimates, or null if none. */
export function bestPerceived(estimates: PlanEstimate[]): number | null {
  const feasible = estimates.filter((e) => e.feasible && e.perceivedArriveMs != null);
  if (feasible.length === 0) return null;
  return Math.min(...feasible.map((e) => e.perceivedArriveMs as number));
}

/** Map a 0–100 score to a coarse tone for the UI. */
export function scoreTone(score: number): "good" | "warn" | "bad" {
  if (score >= 80) return "good";
  if (score >= 50) return "warn";
  return "bad";
}
