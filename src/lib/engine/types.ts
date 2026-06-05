// Core domain model for the commute optimizer.
//
// Everything the decision engine reasons about is expressed in these types.
// The user's real routes live in src/config/commute.ts as `Plan`s built from
// these primitives. The engine never hard-codes any stop, service, or timing.

/** LTA "Load" codes describing how full a bus is. */
export type LoadCode =
  | "SEA" // Seats Available
  | "SDA" // Standing Available
  | "LSD" // Limited Standing (packed)
  | "UNKNOWN";

export interface StopRef {
  /** 5-digit LTA bus stop code, e.g. "83139". */
  code: string;
  /** Human label for the UI, e.g. "Opp Blk 123". */
  name: string;
}

/** A walking segment with a fixed, configured duration. */
export interface WalkLeg {
  kind: "walk";
  fromName: string;
  toName: string;
  minutes: number;
}

/** A bus ride between two stops on a single service. */
export interface RideLeg {
  kind: "ride";
  /** Bus service number, e.g. "26". For an `anyOf` leg, used only as a label. */
  service: string;
  /**
   * "Take the first bus that comes" — when set, the engine boards whichever of
   * these services arrives soonest at `board` (they must share the same `alight`
   * stop). E.g. at Eunos Int, any of 2/24/28/30/67/7 to Chai Chee.
   */
  anyOf?: string[];
  board: StopRef;
  alight: StopRef;
  /** Typical in-vehicle time board -> alight, in minutes (configured). */
  rideMinutes: number;
  /** Optional, for display only. */
  stops?: number;
  /**
   * En-route only: set true on the leg you are ALREADY riding when evaluating
   * an "at the transfer stop / on the bus" decision. The engine then assumes no
   * wait/boarding for this leg (you're on it) and uses `now` as board time.
   */
  alreadyAboard?: boolean;
}

export type Leg = WalkLeg | RideLeg;

export interface Plan {
  id: string;
  /** Short label for cards, e.g. "Perfect: 26 → 21". */
  label: string;
  /** Optional longer explanation. */
  description?: string;
  legs: Leg[];
  /**
   * Index of the first leg at/after the point where this plan diverges from the
   * others (the transfer decision point). Used by the "switch vs stay" view to
   * evaluate each plan from `now` at the transfer stop. Defaults to the first
   * ride leg if omitted.
   */
  decisionLegIndex?: number;
}

/** A single predicted bus arrival from LTA (or mock). */
export interface BusArrival {
  /** Estimated arrival, epoch milliseconds. */
  arrivalMs: number;
  load: LoadCode;
  /** Vehicle type: SD (single deck), DD (double deck), BD (bendy). */
  type?: string;
  /** "WAB" if wheelchair accessible. */
  feature?: string;
  monitored?: boolean;
  /**
   * Live GPS position of this specific bus, when available. The SAME vehicle
   * reports the SAME position whether queried via its board stop or alight
   * stop, so this is the key we use to match a bus across stops and derive its
   * live in-vehicle ride time. Absent for schedule-based (unmonitored) buses.
   */
  lat?: number;
  lng?: number;
}

/**
 * Lookup of live arrivals, keyed by `${stopCode}:${service}`, each sorted
 * ascending by arrival time. Built once per recommend request and shared
 * across all plan evaluations.
 */
export type ArrivalIndex = Record<string, BusArrival[]>;

export function arrivalKey(stopCode: string, service: string): string {
  return `${stopCode}:${service}`;
}
