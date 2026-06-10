import { describe, expect, it } from "vitest";
import { PREFERENCES } from "@/config/preferences";
import { MIN } from "@/lib/time";
import { candidatePlans, trackJourney } from "./track";
import { arrivalKey, type ArrivalIndex, type Plan } from "./types";

const NOW = Date.parse("2026-06-05T17:30:00+08:00");

// Same self-contained shape as board.test.ts: shared first ride, then either a
// transfer to 26 or staying aboard to a later stop and grabbing 70.
const OFFICE = { code: "OFF", name: "Office stop" };
const TRANSFER = { code: "TRF", name: "Transfer" };
const HOME = { code: "HOM", name: "Home stop" };
const LATER = { code: "LAT", name: "Later stop" };
const DROP = { code: "DRP", name: "Drop stop" };

const FIRST_RIDE = {
  kind: "ride" as const,
  service: "21",
  board: OFFICE,
  alight: TRANSFER,
  rideMinutes: 6,
};

const TEST_PLANS: Plan[] = [
  {
    id: "perfect",
    label: "Perfect: 21 → 26",
    decisionLegIndex: 2,
    legs: [
      { kind: "walk", fromName: "Office", toName: OFFICE.name, minutes: 6 },
      FIRST_RIDE,
      { kind: "ride", service: "26", board: TRANSFER, alight: HOME, rideMinutes: 18 },
      { kind: "walk", fromName: HOME.name, toName: "Home", minutes: 3 },
    ],
  },
  {
    id: "stay-on-21",
    label: "Stay on 21 → 70",
    decisionLegIndex: 2,
    legs: [
      { kind: "walk", fromName: "Office", toName: OFFICE.name, minutes: 6 },
      FIRST_RIDE,
      { kind: "ride", service: "21", board: TRANSFER, alight: LATER, rideMinutes: 8, alreadyAboard: true },
      { kind: "ride", service: "70", anyOf: ["70", "71"], board: LATER, alight: DROP, rideMinutes: 7 },
      { kind: "walk", fromName: DROP.name, toName: "Home", minutes: 9 },
    ],
  },
];

function at(mins: number[]) {
  return mins.map((m) => ({ arrivalMs: NOW + m * MIN, load: "SEA" as const }));
}

// Boarded the 21 a minute ago; typical ride to the transfer is 6 min, so the
// transfer's 21 ETA at +5 is OUR bus. 26 reaches the transfer 2 min after us.
function fixture(): ArrivalIndex {
  return {
    [arrivalKey("OFF", "21")]: at([4, 13]), // office ETAs no longer include our bus
    [arrivalKey("TRF", "21")]: at([5, 14]),
    [arrivalKey("TRF", "26")]: at([7, 20]),
    [arrivalKey("LAT", "21")]: at([13, 22]),
    [arrivalKey("LAT", "70")]: at([16, 31]),
    [arrivalKey("LAT", "71")]: at([20, 35]),
    [arrivalKey("HOM", "26")]: at([25]),
  };
}

const DECIDING = { planId: null, legIndex: 1, boardedMs: NOW - 1 * MIN };

describe("trackJourney — deciding on the shared trunk", () => {
  it("anchors to MY bus via the alight stop's ETAs, not the origin stop", () => {
    const res = trackJourney(TEST_PLANS, fixture(), { now: NOW, prefs: PREFERENCES, state: DECIDING });
    expect(res).not.toBeNull();
    // boarded at -1, typical ride 6 → expected +5; TRF 21 ETA at +5 matches.
    expect(res!.myEtaMs).toBe(NOW + 5 * MIN);
    expect(res!.myEtaSource).toBe("live");
    expect(res!.alightCode).toBe("TRF");
  });

  it("keeps BOTH options alive with connection margins measured from my arrival", () => {
    const res = trackJourney(TEST_PLANS, fixture(), { now: NOW, prefs: PREFERENCES, state: DECIDING })!;
    expect(res.options).toHaveLength(2);

    const perfect = res.options.find((o) => o.planId === "perfect")!;
    // 26 hits the transfer at +7, I arrive at +5 → 2 min margin.
    expect(perfect.connectMin).toBe(2);
    expect(perfect.feasible).toBe(true);

    const stay = res.options.find((o) => o.planId === "stay-on-21")!;
    // Aboard to LAT: expected +5+8=+13 matches LAT's 21 ETA at +13; the first
    // of 70/71 there is 70 at +16 → 3 min margin AT THE LATER STOP.
    expect(stay.connectMin).toBe(3);
    expect(stay.rides.some((r) => r.service === "70")).toBe(true);
  });

  it("ranks exactly one option best and includes the ridden bus as the first ride", () => {
    const res = trackJourney(TEST_PLANS, fixture(), { now: NOW, prefs: PREFERENCES, state: DECIDING })!;
    expect(res.options.filter((o) => o.best)).toHaveLength(1);
    for (const opt of res.options) {
      expect(opt.rides[0].alreadyAboard).toBe(true);
      expect(opt.rides[0].service).toBe("21");
      expect(opt.rides[0].alightMs).toBe(res.myEtaMs);
    }
  });

  it("falls back to the configured ride time when no downstream ETA is plausible", () => {
    const arrivals = fixture();
    delete arrivals[arrivalKey("TRF", "21")];
    const res = trackJourney(TEST_PLANS, arrivals, { now: NOW, prefs: PREFERENCES, state: DECIDING })!;
    expect(res.myEtaMs).toBe(NOW + 5 * MIN); // boarded -1 + typical 6
    expect(res.myEtaSource).toBe("estimated");
  });
});

describe("trackJourney — committed stages", () => {
  it("riding the final bus: only walks remain, home = my alight + walk", () => {
    const state = { planId: "perfect", legIndex: 2, boardedMs: NOW + 7 * MIN };
    const res = trackJourney(TEST_PLANS, fixture(), { now: NOW, prefs: PREFERENCES, state })!;
    expect(res.options).toHaveLength(1);
    // Boarded 26 at +7, typical 18 → expected +25; HOM ETA at +25 matches.
    expect(res.myEtaMs).toBe(NOW + 25 * MIN);
    expect(res.options[0].arriveHomeMs).toBe(NOW + 28 * MIN); // +3 walk
    expect(res.options[0].connectMin).toBeNull();
  });

  it("respects the actually-boarded service on an anyOf leg", () => {
    const state = { planId: "stay-on-21", legIndex: 3, boardedMs: NOW + 20 * MIN, service: "71" };
    const res = trackJourney(TEST_PLANS, fixture(), { now: NOW, prefs: PREFERENCES, state })!;
    expect(res.service).toBe("71");
    expect(res.alightCode).toBe("DRP");
    // No DRP ETAs for 71 → estimated: +20 boarded + 7 typical + 9 walk.
    expect(res.options[0].arriveHomeMs).toBe(NOW + 36 * MIN);
  });
});

describe("candidatePlans", () => {
  it("includes every plan sharing the ridden leg while deciding, one after committing", () => {
    expect(candidatePlans(TEST_PLANS, DECIDING).map((p) => p.id)).toEqual(["perfect", "stay-on-21"]);
    expect(
      candidatePlans(TEST_PLANS, { planId: "stay-on-21", legIndex: 2, boardedMs: NOW }).map((p) => p.id),
    ).toEqual(["stay-on-21"]);
  });
});
