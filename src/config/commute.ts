import type { Plan } from "@/lib/engine/types";
import { sgHour } from "@/lib/time";

// ============================================================================
//  YOUR COMMUTE — EDIT THIS FILE WITH REAL DATA
// ============================================================================
//
//  Two directions, same decision shape in both: a shared trunk bus, then
//  "change early" vs "stay seated and change later".
//
//  EVENING (office → home), trunk = bus 21:
//    Office ─ walk 6 ─▶ 50349 ── 21 (2 stops) ──▶ 60059
//      ├─ PERFECT: change to 26 ─▶ 84581 ─ walk 3 ▶ Home
//      └─ STAY ON 21 ─▶ Eunos 82061 ─ first of 2/24/28/30/67/7 ─▶ 84011 ─ walk 8 ▶ Home
//
//  MORNING (home → office), trunk = bus 26. Transfer 2 comes FIRST on the
//  26's route; transfer 1 is one bus stop later:
//    Home ─ walk ─▶ 84579 ── 26 ──▶ Transfer 2 (80051)
//      ├─ alight here: 13 ─▶ 60101 ─ walk 4 ▶ Office (longer ride, shorter walk)
//      └─ USUAL: STAY ON 26 one stop ─▶ Transfer 1 (80101)
//           ─ first of 31/985 ─▶ 60191 ─ walk 7 ▶ Office
//
//  STRUCTURAL RULE the engine relies on: every plan within a direction shares
//  an IDENTICAL first ride leg (same service, board AND alight). A "stay
//  seated past the first alight" continuation is its own leg flagged
//  `alreadyAboard: true` — that's what lets the leave-by board group plans by
//  the shared first bus, and journey mode evaluate both options while you
//  ride it. (Checked by src/config/commute.test.ts.)
//
//  Ride times: `rideMinutes` is a FALLBACK only — live ETAs from the API drive
//  the real numbers. For `alreadyAboard` legs you can't be GPS-matched, so
//  rideMinutes is the *typical* time used to find your bus among the alight
//  stop's live ETAs (see engine/ridetime.ts).
//
//  Transfers involve no walking (you wait at the same stop); the only walks
//  are at the ends of the journey.
//
//  ⚠️ marks guessed timings — tune them as you ride.
// ============================================================================

export type DirectionId = "to-home" | "to-office";

export interface CommuteDirection {
  id: DirectionId;
  origin: string;
  destination: string;
  /** The departure window you usually leave within (24h local time). */
  departureWindow: { earliest: string; latest: string };
  /** Display order = array order; the engine ranks them live. */
  plans: Plan[];
}

const OFFICE_NAME = "Atlas office";
const HOME_NAME = "Home";

// ---------------------------------------------------------------------------
//  EVENING — office → home (trunk: 21)
// ---------------------------------------------------------------------------

const OFFICE_STOP = { code: "50349", name: "Office stop (board 21)" };
const TRANSFER_STOP = { code: "60059", name: "Transfer stop (21 → 26)" };
const HOME_STOP = { code: "84581", name: "Home stop (26 alights)" };
const FAR_STOP = { code: "82061", name: "Eunos Int (stay-on-21 change)" };
const CHAI_CHEE = { code: "84011", name: "Chai Chee Ind Park" };

/** At Eunos Int, any of these to Chai Chee — you take whichever comes first. */
const EUNOS_ONWARD_SERVICES = ["2", "24", "28", "30", "67", "7"];

const WALK_OFFICE_TO_STOP = {
  kind: "walk" as const,
  fromName: OFFICE_NAME,
  toName: OFFICE_STOP.name,
  minutes: 6, // confirmed: 6 min walk office → bus 21
};

const RIDE_21_FIRST_TWO_STOPS = {
  kind: "ride" as const,
  service: "21",
  board: OFFICE_STOP,
  alight: TRANSFER_STOP,
  rideMinutes: 6, // fallback; ~2 stops on 21
  stops: 2,
};

// The "stay on 21 past the transfer to the far stop" leg. You're aboard, so
// rideMinutes is the TYPICAL time used to locate your bus among Eunos' 21 ETAs.
const STAY_ON_21_TO_FAR = {
  kind: "ride" as const,
  service: "21",
  board: TRANSFER_STOP,
  alight: FAR_STOP, // Eunos Int (82061)
  rideMinutes: 20, // typical ~20 min ride; refined live against Eunos 21 ETAs
  stops: 13,
  alreadyAboard: true,
};

export const TO_HOME: CommuteDirection = {
  id: "to-home",
  origin: OFFICE_NAME,
  destination: HOME_NAME,
  departureWindow: { earliest: "17:30", latest: "18:30" },
  plans: [
    {
      id: "perfect",
      label: "Perfect: 21 → 26",
      strategy: "Change to 26",
      description:
        "Change to 26 at the transfer; drops you closest to home, but you may wait for 26.",
      decisionLegIndex: 2, // the "ride 26" leg
      legs: [
        WALK_OFFICE_TO_STOP,
        RIDE_21_FIRST_TWO_STOPS,
        {
          kind: "ride",
          service: "26",
          board: TRANSFER_STOP,
          alight: HOME_STOP,
          rideMinutes: 18, // fallback; the long ride home
          stops: 8,
        },
        { kind: "walk", fromName: HOME_STOP.name, toName: HOME_NAME, minutes: 3 }, // ⚠️
      ],
    },
    {
      id: "stay-21-eunos",
      label: "Stay on 21 → Eunos",
      strategy: "Stay on 21",
      description:
        "Stay seated on 21 to Eunos Int, then take the first of 2/24/28/30/67/7 to Chai Chee. Longer walk home.",
      decisionLegIndex: 2, // the continued "ride 21" leg (already aboard)
      legs: [
        WALK_OFFICE_TO_STOP,
        RIDE_21_FIRST_TWO_STOPS,
        STAY_ON_21_TO_FAR,
        {
          kind: "ride",
          service: "2", // label; the engine picks whichever of anyOf comes first
          anyOf: EUNOS_ONWARD_SERVICES,
          board: FAR_STOP,
          alight: CHAI_CHEE,
          rideMinutes: 8, // fallback; refined live per chosen service
          stops: 3,
        },
        { kind: "walk", fromName: CHAI_CHEE.name, toName: HOME_NAME, minutes: 8 }, // ⚠️
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
//  MORNING — home → office (trunk: 26)
//
//  The 26 reaches TRANSFER 2 first; TRANSFER 1 is one bus stop further. So the
//  decision while riding is: alight at transfer 2 for the 13 (longer ride,
//  4 min walk), or stay seated one more stop to transfer 1 for the first of
//  31/985 (the usual; 7 min walk).
// ---------------------------------------------------------------------------

const MORNING_HOME_STOP = { code: "84579", name: "Home stop (board 26)" };
const TRANSFER_2 = { code: "80051", name: "Transfer 2 (26 → 13)" };
const TRANSFER_1 = { code: "80101", name: "Transfer 1 (26 → 31/985)" };
const DROP_1 = { code: "60191", name: "31/985 drop (7 min walk)" };
const DROP_2 = { code: "60101", name: "13 drop (4 min walk)" };

/** At transfer 1, either of these works — you take whichever comes first. */
const T1_ONWARD_SERVICES = ["31", "985"];

const WALK_HOME_TO_STOP = {
  kind: "walk" as const,
  fromName: HOME_NAME,
  toName: MORNING_HOME_STOP.name,
  minutes: 3, // ⚠️ guessed; opposite side of the evening alight stop
};

const RIDE_26_TO_T2 = {
  kind: "ride" as const,
  service: "26",
  board: MORNING_HOME_STOP,
  alight: TRANSFER_2, // the FIRST decision point on the 26's route
  rideMinutes: 15, // ⚠️ guessed fallback; refined live
};

// Stay seated on 26 one more stop, transfer 2 → transfer 1 (the usual option).
const STAY_ON_26_TO_T1 = {
  kind: "ride" as const,
  service: "26",
  board: TRANSFER_2,
  alight: TRANSFER_1,
  rideMinutes: 2, // ⚠️ one stop; refined live against transfer 1's 26 ETAs
  stops: 1,
  alreadyAboard: true,
};

export const TO_OFFICE: CommuteDirection = {
  id: "to-office",
  origin: HOME_NAME,
  destination: OFFICE_NAME,
  departureWindow: { earliest: "07:45", latest: "09:00" }, // ⚠️ guessed window
  plans: [
    {
      id: "office-31-985",
      label: "Usual: 26 → 31/985",
      strategy: "Stay on → 31/985",
      description:
        "Stay on 26 one stop past transfer 2, then whichever of 31/985 comes first at transfer 1. 7 min walk to the office.",
      decisionLegIndex: 2, // the continued "ride 26" leg (already aboard)
      legs: [
        WALK_HOME_TO_STOP,
        RIDE_26_TO_T2,
        STAY_ON_26_TO_T1,
        {
          kind: "ride",
          service: "31", // label; the engine picks whichever of anyOf comes first
          anyOf: T1_ONWARD_SERVICES,
          board: TRANSFER_1,
          alight: DROP_1,
          rideMinutes: 8, // ⚠️ guessed fallback; refined live per chosen service
        },
        { kind: "walk", fromName: DROP_1.name, toName: OFFICE_NAME, minutes: 7 },
      ],
    },
    {
      id: "office-13",
      label: "Change at transfer 2 → 13",
      strategy: "Change to 13",
      description:
        "Alight at transfer 2 and take 13. Longer ride, slightly shorter 4 min walk.",
      decisionLegIndex: 2, // the "ride 13" leg
      legs: [
        WALK_HOME_TO_STOP,
        RIDE_26_TO_T2,
        {
          kind: "ride",
          service: "13",
          board: TRANSFER_2,
          alight: DROP_2,
          rideMinutes: 10, // ⚠️ guessed fallback ("longer ride"); refined live
        },
        { kind: "walk", fromName: DROP_2.name, toName: OFFICE_NAME, minutes: 4 },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------

export const DIRECTIONS: Record<DirectionId, CommuteDirection> = {
  "to-home": TO_HOME,
  "to-office": TO_OFFICE,
};

/** Every plan across both directions (mock data + stop-coordinate prefetch). */
export const ALL_PLANS: Plan[] = [...TO_HOME.plans, ...TO_OFFICE.plans];

/** The direction you almost certainly want right now: office-bound mornings. */
export function defaultDirectionId(now = Date.now()): DirectionId {
  return sgHour(now) < 12 ? "to-office" : "to-home";
}

export function parseDirectionId(raw: string | null, now = Date.now()): DirectionId {
  return raw === "to-home" || raw === "to-office" ? raw : defaultDirectionId(now);
}
