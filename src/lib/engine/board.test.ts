import { describe, expect, it } from "vitest";
import { PLANS } from "@/config/commute";
import { PREFERENCES } from "@/config/preferences";
import { MIN } from "@/lib/time";
import { buildLeaveByBoard, decideAtTransfer, decideLeaveNow } from "./board";
import { arrivalKey, type ArrivalIndex } from "./types";

const NOW = Date.parse("2026-06-05T17:30:00+08:00");

// Arrivals for the placeholder config (stops 00001..00004, services 26/21/23).
function fixture(): ArrivalIndex {
  return {
    [arrivalKey("00001", "26")]: [3, 12, 21].map((m) => ({ arrivalMs: NOW + m * MIN, load: "SEA" })),
    [arrivalKey("00002", "21")]: [25, 40].map((m) => ({ arrivalMs: NOW + m * MIN, load: "SEA" })),
    [arrivalKey("00004", "23")]: [30, 45].map((m) => ({ arrivalMs: NOW + m * MIN, load: "SEA" })),
  };
}

describe("buildLeaveByBoard", () => {
  it("produces one row per upcoming first bus, each with a best plan and leave-by", () => {
    const rows = buildLeaveByBoard(PLANS, fixture(), { now: NOW, prefs: PREFERENCES });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.best.feasible).toBe(true);
      expect(row.best.score).toBeGreaterThanOrEqual(0);
      expect(row.best.score).toBeLessThanOrEqual(100);
      expect(row.leaveOfficeMs).not.toBeNull();
      // leave-by must be before the first bus arrives
      expect(row.leaveOfficeMs as number).toBeLessThanOrEqual(row.firstBoardMs);
    }
    // rows are chronological by first bus
    const times = rows.map((r) => r.firstBoardMs);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it("annotates rows with whether leaving falls in the usual window (without filtering)", () => {
    const rows = buildLeaveByBoard(PLANS, fixture(), {
      now: NOW,
      prefs: PREFERENCES,
      // pretend only the very first departure is 'within window'
      isWithinWindow: (ms) => ms <= NOW + 5 * MIN,
    });
    expect(rows.length).toBeGreaterThan(1); // all upcoming buses still shown
    expect(rows[0].withinWindow).toBe(true);
    expect(rows[rows.length - 1].withinWindow).toBe(false);
  });
});

describe("decideLeaveNow / decideAtTransfer", () => {
  it("ranks all plans best-first with the top scoring 100", () => {
    const opts = decideLeaveNow(PLANS, fixture(), { now: NOW, prefs: PREFERENCES });
    expect(opts.length).toBe(PLANS.length);
    expect(opts[0].score).toBe(100);
    // sorted descending by score
    for (let i = 1; i < opts.length; i++) {
      expect(opts[i - 1].score).toBeGreaterThanOrEqual(opts[i].score);
    }
  });

  it("at-transfer evaluates from the decision point for each plan", () => {
    const opts = decideAtTransfer(PLANS, fixture(), { now: NOW, prefs: PREFERENCES });
    expect(opts.length).toBe(PLANS.length);
    // the 'stay on 26' plan's first resolved ride is the already-aboard leg
    const stay = opts.find((o) => o.planId === "stay-on-26");
    expect(stay?.rides[0].alreadyAboard).toBe(true);
  });
});
