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

  it("packed buses raise the perceived arrival above the real arrival", () => {
    const packed = idx({
      [arrivalKey("00001", "26")]: [{ atMin: 8, load: "LSD" }],
      [arrivalKey("00002", "21")]: [{ atMin: 20, load: "LSD" }],
    });
    const est = evaluatePlan(PLAN, packed, { now: NOW, prefs: PREFERENCES });
    expect(est.perceivedArriveMs).toBeGreaterThan(est.arriveHomeMs as number);
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
