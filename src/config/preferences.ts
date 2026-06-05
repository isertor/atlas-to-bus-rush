import type { LoadCode } from "@/lib/engine/types";

/**
 * Tunable preferences for the decision engine. These encode how *you* trade off
 * time vs. waiting vs. crowding.
 *
 * Design stance (decided with the user): **wait time is the dominant factor**,
 * arrival-home time is a minor tiebreak (a 2–4 min difference is noise next to a
 * 10–15 min wait), and **crowding is a DISPLAY-ONLY signal** — shown as a badge
 * for you to judge, never folded into the score. The app advises and shows the
 * data for both routes; it doesn't decide for you.
 *
 * "Penalty" values are in *perceived minutes* added to the real arrival time to
 * get a "perceived arrival", which is what the score ranks on.
 */
export interface Preferences {
  /** Buffer added before the first bus so you're at the stop a touch early. */
  safetyBufferMin: number;
  /** Minimum time to alight and be ready to board the next service at a transfer. */
  transferBufferMin: number;
  /**
   * Perceived-minute penalty per ride by crowding. DISPLAY-ONLY by default
   * (all zero): crowding is surfaced as a badge for you to decide on, not
   * scored. Bump these if you ever want crowding to actually move the ranking.
   */
  crowdPenaltyMin: Record<LoadCode, number>;
  /**
   * The big lever: how many perceived minutes each minute of waiting costs.
   * Set high so wait dominates the ranking and small arrival-time differences
   * don't flip the recommendation.
   */
  waitPenaltyPerMin: number;
  /** Score (0–100) drops by this many points per perceived-minute worse than the best option. */
  scorePenaltyPerMin: number;
}

export const PREFERENCES: Preferences = {
  safetyBufferMin: 1,
  transferBufferMin: 1,
  crowdPenaltyMin: {
    SEA: 0,
    SDA: 0,
    LSD: 0,
    UNKNOWN: 0,
  },
  waitPenaltyPerMin: 1.5,
  scorePenaltyPerMin: 6,
};
