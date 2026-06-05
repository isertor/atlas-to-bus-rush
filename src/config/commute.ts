import type { Plan } from "@/lib/engine/types";

// ============================================================================
//  YOUR COMMUTE — EDIT THIS FILE WITH REAL DATA
// ============================================================================
//
//  Corrected route model (per your note):
//
//    Office
//      └─ walk 6 min ──▶ OFFICE STOP ── bus 21 (2 stops) ──▶ TRANSFER STOP
//                                                              ├─ PERFECT: change to 26 ─▶ HOME STOP ─ short walk ▶ Home
//                                                              └─ STAY ON 21 (26 late/packed): ride further ─▶ LATER STOP
//                                                                                                  └─ change to bus ??? ─▶ DROP STOP ─ longer walk ▶ Home
//
//  21 = first bus from the office.  26 = the long ride that takes you home.
//  The "stay on 21" plan is for when 26 is late or too crowded: you stay seated
//  on 21 past the normal transfer and change later to a third bus that leaves
//  you a bit further from home.
//
//  ⚠️ PLACEHOLDERS BELOW — replace before going live:
//    • All "00000" codes → real 5-digit LTA bus stop codes (the number on the
//      bus-stop pole; also shown in Google Maps under the stop name).
//    • "???" service → the third bus you change to in the "stay on 21" route.
//    • All `minutes` / `rideMinutes` → tune to what you actually experience.
//
//  The engine reads only this file + preferences.ts; no logic changes needed.
// ============================================================================

export const ORIGIN_NAME = "Atlas office";
export const DESTINATION_NAME = "Home";

/** The departure window you usually leave the office within (24h local time). */
export const DEPARTURE_WINDOW = { earliest: "17:30", latest: "18:30" };

// --- Stops (PLACEHOLDER codes — replace with real LTA bus stop codes) -------

const OFFICE_STOP = { code: "00000", name: "Office stop (board 21)" };
const TRANSFER_STOP = { code: "00000", name: "Transfer stop (21 → 26)" };
const HOME_STOP = { code: "00000", name: "Home stop (26 alights)" };
const LATER_STOP = { code: "00000", name: "Later stop (stay-on-21 change)" };
const DROP_STOP = { code: "00000", name: "Drop stop (further from home)" };

// --- Shared first leg: walk to the office stop, then ride 21 two stops -------

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
  rideMinutes: 6, // PLACEHOLDER — 2 stops on 21
  stops: 2,
};

export const PLANS: Plan[] = [
  {
    id: "perfect",
    label: "Perfect: 21 → 26",
    description: "Change to 26 at the transfer; drops you closest to home, but you may wait for 26.",
    decisionLegIndex: 2, // the "ride 26" leg below
    legs: [
      WALK_OFFICE_TO_STOP,
      RIDE_21_FIRST_TWO_STOPS,
      {
        kind: "ride",
        service: "26",
        board: TRANSFER_STOP,
        alight: HOME_STOP,
        rideMinutes: 18, // PLACEHOLDER — the long ride home
        stops: 8,
      },
      { kind: "walk", fromName: HOME_STOP.name, toName: DESTINATION_NAME, minutes: 3 }, // PLACEHOLDER
    ],
  },
  {
    id: "stay-on-21",
    label: "Stay on 21 → ???",
    description: "When 26 is late/packed: stay seated on 21, change later to another bus. Longer walk home.",
    decisionLegIndex: 2, // the continued "ride 21" leg below (you're already aboard)
    legs: [
      WALK_OFFICE_TO_STOP,
      RIDE_21_FIRST_TWO_STOPS,
      {
        kind: "ride",
        service: "21",
        board: TRANSFER_STOP,
        alight: LATER_STOP,
        rideMinutes: 8, // PLACEHOLDER — staying on 21 past the transfer
        stops: 3,
        alreadyAboard: true, // when deciding at the transfer, you're still on 21
      },
      {
        kind: "ride",
        service: "???", // PLACEHOLDER — the third bus you change to
        board: LATER_STOP,
        alight: DROP_STOP,
        rideMinutes: 7, // PLACEHOLDER
        stops: 3,
      },
      { kind: "walk", fromName: DROP_STOP.name, toName: DESTINATION_NAME, minutes: 9 }, // PLACEHOLDER
    ],
  },
];
