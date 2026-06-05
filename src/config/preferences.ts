import type { LoadCode } from "@/lib/engine/types";

/**
 * Tunable preferences for the decision engine. These encode how *you* trade off
 * time vs. waiting vs. crowding. Adjust freely — nothing here is sacred.
 *
 * All "penalty" values are in *perceived minutes*: the engine adds them to the
 * real arrival-home time to get a "perceived arrival", which is what plans are
 * scored on. So if standing on a packed bus feels like wasting 10 extra minutes,
 * set lsd: 10.
 */
export interface Preferences {
  /** Buffer added before the first bus so you're at the stop a touch early. */
  safetyBufferMin: number;
  /** Minimum time to alight and be ready to board the next service at a transfer. */
  transferBufferMin: number;
  /** Perceived-minute penalty per ride, by how crowded that bus is. */
  crowdPenaltyMin: Record<LoadCode, number>;
  /** Waiting at a stop feels worse than riding; extra perceived min per real wait min. */
  waitPenaltyPerMin: number;
  /** Score (0–100) drops by this many points per perceived-minute worse than the best option. */
  scorePenaltyPerMin: number;
}

export const PREFERENCES: Preferences = {
  safetyBufferMin: 1,
  transferBufferMin: 1,
  crowdPenaltyMin: {
    SEA: 0, // seats available — no penalty
    SDA: 4, // standing room — mildly annoying
    LSD: 10, // packed (this is your "26 is SUPER PACKED" case)
    UNKNOWN: 2,
  },
  waitPenaltyPerMin: 0.5,
  scorePenaltyPerMin: 6,
};
