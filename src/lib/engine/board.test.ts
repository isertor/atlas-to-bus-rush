import { describe, expect, it } from "vitest";
import { PREFERENCES } from "@/config/preferences";
import { MIN } from "@/lib/time";
import { buildLeaveByBoard, decideAtTransfer, decideLeaveNow } from "./board";
import { arrivalKey, type ArrivalIndex, type Plan } from "./types";

const NOW = Date.parse("2026-06-05T17:30:00+08:00");

// Self-contained plans mirroring the real shape (shared first ride, then a
// "perfect" transfer vs a "stay aboard then change later" alternative). Kept
// independent of src/config/commute.ts so editing the real route never breaks
// these tests.
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
      { kind: "ride", service: "70", board: LATER, alight: DROP, rideMinutes: 7 },
      { kind: "walk", fromName: DROP.name, toName: "Home", minutes: 9 },
    ],
  },
];

function fixture(): ArrivalIndex {
  const at = (mins: number[]) => mins.map((m) => ({ arrivalMs: NOW + m * MIN, load: "SEA" as const }));
  return {
    [arrivalKey("OFF", "21")]: at([3, 12, 21, 30]), // shared first bus
    [arrivalKey("TRF", "26")]: at([14, 28, 42]), // perfect connection
    [arrivalKey("LAT", "70")]: at([30, 45]), // stay-on-21 connection
  };
}

describe("buildLeaveByBoard", () => {
  it("produces one row per upcoming first bus, each with a feasible best plan and leave-by", () => {
    const rows = buildLeaveByBoard(TEST_PLANS, fixture(), { now: NOW, prefs: PREFERENCES });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.best.feasible).toBe(true);
      expect(row.best.score).toBeGreaterThanOrEqual(0);
      expect(row.best.score).toBeLessThanOrEqual(100);
      expect(row.leaveOfficeMs).not.toBeNull();
      expect(row.leaveOfficeMs as number).toBeLessThanOrEqual(row.firstBoardMs);
    }
    const times = rows.map((r) => r.firstBoardMs);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it("scores departures against each other (earliest-home is 100, others lower)", () => {
    const rows = buildLeaveByBoard(TEST_PLANS, fixture(), { now: NOW, prefs: PREFERENCES });
    expect(rows.length).toBeGreaterThan(1);
    expect(Math.max(...rows.map((r) => r.best.score))).toBe(100);
    // a later departure should not out-score the best
    expect(rows[rows.length - 1].best.score).toBeLessThanOrEqual(rows[0].best.score);
  });

  it("annotates rows with whether leaving falls in the usual window (without filtering)", () => {
    const rows = buildLeaveByBoard(TEST_PLANS, fixture(), {
      now: NOW,
      prefs: PREFERENCES,
      isWithinWindow: (ms) => ms <= NOW + 5 * MIN,
    });
    expect(rows.length).toBeGreaterThan(1);
    expect(rows[0].withinWindow).toBe(true);
    expect(rows[rows.length - 1].withinWindow).toBe(false);
  });
});

describe("decideLeaveNow / decideAtTransfer", () => {
  it("ranks all plans best-first with the top scoring 100", () => {
    const opts = decideLeaveNow(TEST_PLANS, fixture(), { now: NOW, prefs: PREFERENCES });
    expect(opts.length).toBe(TEST_PLANS.length);
    expect(opts[0].score).toBe(100);
    for (let i = 1; i < opts.length; i++) {
      expect(opts[i - 1].score).toBeGreaterThanOrEqual(opts[i].score);
    }
  });

  it("at-transfer evaluates from the decision point; the stay plan starts already aboard", () => {
    const opts = decideAtTransfer(TEST_PLANS, fixture(), { now: NOW, prefs: PREFERENCES });
    expect(opts.length).toBe(TEST_PLANS.length);
    const stay = opts.find((o) => o.planId === "stay-on-21");
    expect(stay?.rides[0].alreadyAboard).toBe(true);
  });
});
