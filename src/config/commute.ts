import type { Plan } from "@/lib/engine/types";

// ============================================================================
//  YOUR COMMUTE — EDIT THIS FILE WITH REAL DATA
// ============================================================================
//
//  Everything below is PLACEHOLDER data that models the scenario you described:
//
//    Office (Atlas)
//      └─ walk ──▶ Stop 1  ── bus 26 (2 stops) ──▶ Stop 2 (transfer)
//                                                     ├─ PERFECT: change to 21 ─▶ Stop near home ─ short walk ▶ Home
//                                                     └─ STAY:    stay on 26 further ─▶ Stop 4 ── change to 23 ─▶ Stop near-ish home ─ longer walk ▶ Home
//
//  To make it real, replace the 5-digit `code`s with actual LTA bus stop codes
//  (find them at https://datamall.lta.gov.sg/ or by inspecting the arrival API),
//  the `service` numbers with your real bus numbers, and tune the `minutes` /
//  `rideMinutes` to match what you actually experience. The engine reads only
//  this file + preferences.ts — no logic needs to change.
//
//  NOTE: the first ride leg of every plan is assumed to be the SAME bus at the
//  SAME stop (your bus 26 from Stop 1). The "leave-by board" is built from that
//  shared first ride. Plans diverge at the transfer (see `decisionLegIndex`).
// ============================================================================

export const ORIGIN_NAME = "Atlas office";
export const DESTINATION_NAME = "Home";

/** The departure window you usually leave the office within (24h local time). */
export const DEPARTURE_WINDOW = { earliest: "17:30", latest: "18:30" };

// --- Reusable stop + first-leg definitions (placeholders) -------------------

const STOP_1 = { code: "00001", name: "Stop 1 (near office)" };
const STOP_2 = { code: "00002", name: "Stop 2 (transfer)" };
const STOP_3 = { code: "00003", name: "Stop 3 (near home)" };
const STOP_4 = { code: "00004", name: "Stop 4 (further)" };
const STOP_5 = { code: "00005", name: "Stop 5 (a walk from home)" };

const WALK_OFFICE_TO_STOP1 = {
  kind: "walk" as const,
  fromName: ORIGIN_NAME,
  toName: STOP_1.name,
  minutes: 5,
};

const RIDE_26_FIRST_TWO_STOPS = {
  kind: "ride" as const,
  service: "26",
  board: STOP_1,
  alight: STOP_2,
  rideMinutes: 6,
  stops: 2,
};

export const PLANS: Plan[] = [
  {
    id: "perfect",
    label: "Perfect: 26 → 21",
    description: "Change to 21 at the transfer; shortest walk home, but you may wait for 21.",
    decisionLegIndex: 2, // the "ride 21" leg below
    legs: [
      WALK_OFFICE_TO_STOP1,
      RIDE_26_FIRST_TWO_STOPS,
      {
        kind: "ride",
        service: "21",
        board: STOP_2,
        alight: STOP_3,
        rideMinutes: 14,
        stops: 6,
      },
      { kind: "walk", fromName: STOP_3.name, toName: DESTINATION_NAME, minutes: 3 },
    ],
  },
  {
    id: "stay-on-26",
    label: "Stay on 26 → 23",
    description: "Skip the 21 wait: stay on 26 further, then change to 23. Longer walk home.",
    decisionLegIndex: 2, // the continued "ride 26" leg below (you're already aboard)
    legs: [
      WALK_OFFICE_TO_STOP1,
      RIDE_26_FIRST_TWO_STOPS,
      {
        kind: "ride",
        service: "26",
        board: STOP_2,
        alight: STOP_4,
        rideMinutes: 9,
        stops: 3,
        alreadyAboard: true, // when deciding at the transfer, you're still on 26
      },
      {
        kind: "ride",
        service: "23",
        board: STOP_4,
        alight: STOP_5,
        rideMinutes: 7,
        stops: 3,
      },
      { kind: "walk", fromName: STOP_5.name, toName: DESTINATION_NAME, minutes: 9 },
    ],
  },
];
