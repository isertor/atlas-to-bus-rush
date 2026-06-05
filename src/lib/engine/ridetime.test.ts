import { describe, expect, it } from "vitest";
import { MIN } from "@/lib/time";
import { liveAlightMs, refineAboardAlightMs } from "./ridetime";
import { arrivalKey, type ArrivalIndex, type BusArrival } from "./types";

const NOW = Date.parse("2026-06-05T17:30:00+08:00");

function bus(atMin: number, pos?: [number, number]): BusArrival {
  return {
    arrivalMs: NOW + atMin * MIN,
    load: "SEA",
    lat: pos?.[0],
    lng: pos?.[1],
  };
}

describe("liveAlightMs", () => {
  it("matches the boarded bus at the alight stop by GPS and returns its ETA", () => {
    const boardBus = bus(5, [1.3001, 103.8001]);
    const index: ArrivalIndex = {
      // same bus (same position) reaches the alight stop later
      [arrivalKey("BSTOP", "21")]: [bus(17, [1.3001, 103.8001]), bus(31, [1.32, 103.85])],
    };
    expect(liveAlightMs(index, "BSTOP", "21", boardBus)).toBe(NOW + 17 * MIN);
  });

  it("returns null when the boarded bus has no GPS position", () => {
    const boardBus = bus(5); // no position
    const index: ArrivalIndex = {
      [arrivalKey("BSTOP", "21")]: [bus(17, [1.3001, 103.8001])],
    };
    expect(liveAlightMs(index, "BSTOP", "21", boardBus)).toBeNull();
  });

  it("returns null when no arrival at the alight stop matches the position", () => {
    const boardBus = bus(5, [1.3001, 103.8001]);
    const index: ArrivalIndex = {
      [arrivalKey("BSTOP", "21")]: [bus(17, [1.999, 103.999])],
    };
    expect(liveAlightMs(index, "BSTOP", "21", boardBus)).toBeNull();
  });

  it("ignores a matched arrival that is before boarding (wrong direction / stale)", () => {
    const boardBus = bus(20, [1.3001, 103.8001]);
    const index: ArrivalIndex = {
      [arrivalKey("BSTOP", "21")]: [bus(5, [1.3001, 103.8001])], // earlier than board
    };
    expect(liveAlightMs(index, "BSTOP", "21", boardBus)).toBeNull();
  });
});

describe("refineAboardAlightMs (the long 'stay on 21' leg)", () => {
  const boardMs = NOW; // you're aboard at the transfer now
  const expected = 20 * MIN; // typical ~20 min ride to the far stop

  it("discards buses ahead of you and picks the ETA nearest the expected ~20 min", () => {
    const index: ArrivalIndex = {
      // 6 & 11 min = 21s ahead of you (discard); 19 min = yours; 27 = the one after
      [arrivalKey("FAR", "21")]: [bus(6), bus(11), bus(19), bus(27)],
    };
    expect(refineAboardAlightMs(index, "FAR", "21", boardMs, expected)).toBe(NOW + 19 * MIN);
  });

  it("returns null (caller falls back to the estimate) when nothing plausible is predicted", () => {
    const index: ArrivalIndex = {
      [arrivalKey("FAR", "21")]: [bus(4), bus(8)], // both too early to be your bus
    };
    expect(refineAboardAlightMs(index, "FAR", "21", boardMs, expected)).toBeNull();
  });
});
