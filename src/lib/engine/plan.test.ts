import { describe, expect, it } from "vitest";
import { PREFERENCES } from "@/config/preferences";
import { MIN } from "@/lib/time";
import { evaluatePlan } from "./plan";
import { arrivalKey, type ArrivalIndex, type Plan } from "./types";

const NOW = Date.parse("2026-06-05T17:30:00+08:00");

const PLAN: Plan = {
  id: "test",
  label: "26 → 21",
  decisionLegIndex: 2,
  legs: [
    { kind: "walk", fromName: "Office", toName: "Stop 1", minutes: 5 },
    {
      kind: "ride",
      service: "26",
      board: { code: "00001", name: "Stop 1" },
      alight: { code: "00002", name: "Stop 2" },
      rideMinutes: 6,
    },
    {
      kind: "ride",
      service: "21",
      board: { code: "00002", name: "Stop 2" },
      alight: { code: "00003", name: "Stop 3" },
      rideMinutes: 14,
    },
    { kind: "walk", fromName: "Stop 3", toName: "Home", minutes: 3 },
  ],
};

function idx(entries: Record<string, { atMin: number; load?: "SEA" | "SDA" | "LSD" }[]>): ArrivalIndex {
  const out: ArrivalIndex = {};
  for (const [key, arr] of Object.entries(entries)) {
    out[key] = arr.map((a) => ({ arrivalMs: NOW + a.atMin * MIN, load: a.load ?? "SEA" }));
  }
  return out;
}

describe("evaluatePlan", () => {
  const arrivals = idx({
    [arrivalKey("00001", "26")]: [{ atMin: 8 }],
    [arrivalKey("00002", "21")]: [{ atMin: 20 }],
  });

  it("forward sim: chains rides, walks, and waits to an arrival time", () => {
    const est = evaluatePlan(PLAN, arrivals, { now: NOW, prefs: PREFERENCES });
    expect(est.feasible).toBe(true);
    // walk5 -> board 26 @+8 (wait 8-6=... ready=5+safety1=6, bus@8 wait 2)
    // alight 26 @14, ready 21 @15, 21 @20 (wait 5), alight @34, walk3 -> 37
    expect(est.arriveHomeMs).toBe(NOW + 37 * MIN);
    expect(est.leaveOfficeMs).toBe(NOW); // forward sim leaves now
    expect(est.totalWaitMin).toBe(7); // 2 + 5
  });

  it("anchor mode back-calculates the office leave-by time", () => {
    const est = evaluatePlan(PLAN, arrivals, {
      now: NOW,
      prefs: PREFERENCES,
      anchorFirstBoardMs: NOW + 8 * MIN,
    });
    // leaveBy = board(8) - walkBefore(5) - safety(1) = +2 min
    expect(est.leaveOfficeMs).toBe(NOW + 2 * MIN);
    expect(est.firstBoardMs).toBe(NOW + 8 * MIN);
  });

  it("is infeasible when a connecting service has no upcoming arrival", () => {
    const noConn = idx({ [arrivalKey("00001", "26")]: [{ atMin: 8 }] });
    const est = evaluatePlan(PLAN, noConn, { now: NOW, prefs: PREFERENCES });
    expect(est.feasible).toBe(false);
    expect(est.reason).toContain("21");
  });

  it("crowding is display-only: load does not change the perceived arrival/score", () => {
    const seats = idx({
      [arrivalKey("00001", "26")]: [{ atMin: 8, load: "SEA" }],
      [arrivalKey("00002", "21")]: [{ atMin: 20, load: "SEA" }],
    });
    const packed = idx({
      [arrivalKey("00001", "26")]: [{ atMin: 8, load: "LSD" }],
      [arrivalKey("00002", "21")]: [{ atMin: 20, load: "LSD" }],
    });
    const a = evaluatePlan(PLAN, seats, { now: NOW, prefs: PREFERENCES });
    const b = evaluatePlan(PLAN, packed, { now: NOW, prefs: PREFERENCES });
    // Same timings → same perceived arrival regardless of how packed the buses are.
    expect(b.perceivedArriveMs).toBe(a.perceivedArriveMs);
    // ...but the load is still reported per ride for the UI to display.
    expect(b.rides[0].load).toBe("LSD");
  });

  it("waiting dominates the perceived arrival (wait is penalised heavily)", () => {
    const est = evaluatePlan(PLAN, arrivals, { now: NOW, prefs: PREFERENCES });
    // perceived = arrival + waitPenalty * wait, with no crowd component
    const expected =
      (est.arriveHomeMs as number) + est.totalWaitMin * PREFERENCES.waitPenaltyPerMin * MIN;
    expect(est.perceivedArriveMs).toBe(expected);
  });

  it("uses live GPS-matched alight time over the configured rideMinutes when available", () => {
    // 26 boards at 00002 @ +8 with a GPS position; the same bus reaches the
    // alight stop 00003 @ +25 (17 min ride) — not the configured 14 min.
    const pos: [number, number] = [1.34, 103.9];
    const live: ArrivalIndex = {
      [arrivalKey("00001", "26")]: [{ arrivalMs: NOW + 8 * MIN, load: "SEA" }],
      [arrivalKey("00002", "21")]: [{ arrivalMs: NOW + 20 * MIN, load: "SEA", lat: pos[0], lng: pos[1] }],
      [arrivalKey("00003", "21")]: [{ arrivalMs: NOW + 39 * MIN, load: "SEA", lat: pos[0], lng: pos[1] }],
    };
    const est = evaluatePlan(PLAN, live, { now: NOW, prefs: PREFERENCES });
    const ride21 = est.rides.find((r) => r.service === "21");
    expect(ride21?.rideTimeSource).toBe("live");
    // alight = live ETA at 00003 (+39), not board(+20) + configured 14 = +34
    expect(ride21?.alightMs).toBe(NOW + 39 * MIN);
  });

  it("an anyOf leg boards whichever candidate service arrives first", () => {
    const anyOfPlan: Plan = {
      id: "anyof",
      label: "any",
      legs: [
        { kind: "walk", fromName: "Office", toName: "Stop 1", minutes: 5 },
        {
          kind: "ride",
          service: "2", // label
          anyOf: ["2", "24", "28"],
          board: { code: "00001", name: "Eunos" },
          alight: { code: "00009", name: "Chai Chee" },
          rideMinutes: 8,
        },
        { kind: "walk", fromName: "Chai Chee", toName: "Home", minutes: 8 },
      ],
    };
    const arr = idx({
      [arrivalKey("00001", "2")]: [{ atMin: 20 }],
      [arrivalKey("00001", "24")]: [{ atMin: 9 }], // soonest → should be chosen
      [arrivalKey("00001", "28")]: [{ atMin: 14 }],
    });
    const est = evaluatePlan(anyOfPlan, arr, { now: NOW, prefs: PREFERENCES });
    expect(est.feasible).toBe(true);
    expect(est.rides[0].service).toBe("24");
    expect(est.rides[0].boardMs).toBe(NOW + 9 * MIN);
  });

  it("from the transfer (fromLegIndex), evaluates only the remaining journey", () => {
    const est = evaluatePlan(PLAN, arrivals, {
      now: NOW,
      prefs: PREFERENCES,
      fromLegIndex: 2,
    });
    // start at 21 leg: ready now+transfer1=1, 21 @20 wait19, alight@34, walk3 -> 37
    expect(est.arriveHomeMs).toBe(NOW + 37 * MIN);
  });
});
