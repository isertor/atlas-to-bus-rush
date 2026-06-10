import type { Plan } from "@/lib/engine/types";

// ============================================================================
//  YOUR COMMUTE — EDIT THIS FILE WITH REAL DATA
// ============================================================================
//
//    Office
//      └─ walk 6 min ──▶ OFFICE STOP ── bus 21 (2 stops) ──▶ TRANSFER STOP
//                                                              ├─ PERFECT: change to 26 ─▶ HOME STOP ─ short walk ▶ Home
//                                                              └─ STAY ON 21 (26 late/packed): ride ~20 min further ─▶ FAR STOP
//                                                                                                  └─ take WHICHEVER connecting bus
//                                                                                                     comes soonest ─▶ its drop stop ─ walk ▶ Home
//
//  21 = first bus from the office.  26 = the long ride that takes you home.
//  When 26 is late/packed you stay seated on 21 to a FAR stop and grab whichever
//  onward service comes soonest (you prefer waiting less and walking a bit more).
//
//  Each candidate onward service is its own "stay on 21 → X" plan below. The
//  engine ranks every plan WAIT-FIRST, so the least-wait option naturally wins;
//  a longer walk from its drop point is only a minor tiebreak. Add one plan per
//  onward service you'd actually take at the far stop.
//
//  ⚠️ PLACEHOLDERS — replace before going live:
//    • All "00000" codes → real 5-digit LTA bus stop codes (REQUIRED).
//    • "A"/"B" services → the real onward services at the far stop.
//
//  Ride times: `rideMinutes` is a FALLBACK only — live ETAs from the API drive
//  the real numbers. For the "stay on 21" leg you're already aboard (can't be
//  GPS-matched), so its rideMinutes is the *typical* time (~20 min) used to find
//  your bus among the far stop's live 21 ETAs (see engine/ridetime.ts).
//
//  Transfers involve no walking (you wait at the same stop); the only walks are
//  office → first stop and final stop → home.
// ============================================================================

export const ORIGIN_NAME = "Atlas office";
export const DESTINATION_NAME = "Home";

/** The departure window you usually leave the office within (24h local time). */
export const DEPARTURE_WINDOW = { earliest: "17:30", latest: "18:30" };

// --- Stops (PLACEHOLDER codes — replace with real LTA bus stop codes) -------

const OFFICE_STOP = { code: "50349", name: "Office stop (board 21)" };
const TRANSFER_STOP = { code: "60059", name: "Transfer stop (21 → 26)" };
const HOME_STOP = { code: "84581", name: "Home stop (26 alights)" };
const FAR_STOP = { code: "82061", name: "Eunos Int (stay-on-21 change)" };
const CHAI_CHEE = { code: "84011", name: "Chai Chee Ind Park" };

/** At Eunos Int, any of these to Chai Chee — you take whichever comes first. */
const EUNOS_ONWARD_SERVICES = ["2", "24", "28", "30", "67", "7"];

// --- Shared start: walk to the office stop, then ride 21 two stops -----------

const WALK_OFFICE_TO_STOP = {
  kind: "walk" as const,
  fromName: ORIGIN_NAME,
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

// The "stay on 21 past the transfer to the far stop" leg, shared by every
// stay-on-21 variant. You're aboard, so rideMinutes is the TYPICAL time used to
// locate your bus among the far stop's live 21 ETAs.
const STAY_ON_21_TO_FAR = {
  kind: "ride" as const,
  service: "21",
  board: TRANSFER_STOP,
  alight: FAR_STOP, // Eunos Int (82061)
  rideMinutes: 20, // typical ~20 min ride; refined live against Eunos 21 ETAs
  stops: 13,
  alreadyAboard: true,
};

export const PLANS: Plan[] = [
  {
    id: "perfect",
    label: "Perfect: 21 → 26",
    description: "Change to 26 at the transfer; drops you closest to home, but you may wait for 26.",
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
      { kind: "walk", fromName: HOME_STOP.name, toName: DESTINATION_NAME, minutes: 3 }, // PLACEHOLDER
    ],
  },
  {
    id: "stay-21-eunos",
    label: "Stay on 21 → Eunos",
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
      { kind: "walk", fromName: CHAI_CHEE.name, toName: DESTINATION_NAME, minutes: 8 }, // ⚠️ PLACEHOLDER walk-home time
    ],
  },
];
