import { describe, expect, it } from "vitest";
import { MIN } from "@/lib/time";
import { arrivalKey, type ArrivalIndex } from "./engine/types";
import { relevantBuses, slicePathAt } from "./map";

const NOW = Date.parse("2026-06-10T08:00:00+08:00");

function bus(mins: number, lat?: number, lng?: number) {
  return { arrivalMs: NOW + mins * MIN, load: "SEA" as const, lat, lng };
}

describe("relevantBuses", () => {
  const arrivals: ArrivalIndex = {
    // 3 GPS-carrying 26s approaching the transfer + 1 without GPS
    [arrivalKey("TRF", "26")]: [bus(2, 1.31, 103.88), bus(9, 1.3, 103.87), bus(16, 1.29, 103.86), bus(23)],
    [arrivalKey("TRF", "13")]: [bus(4, 1.311, 103.881)],
    [arrivalKey("FAR", "70")]: [bus(20, 1.33, 103.9)],
  };

  it("returns only watched services at watched stops, capped at the limit", () => {
    const out = relevantBuses(arrivals, [{ services: ["26"], stopCode: "TRF", limit: 2 }]);
    expect(out).toHaveLength(2); // soonest 2 of the 3 with GPS
    expect(out.every((b) => b.service === "26" && b.nextStopCode === "TRF")).toBe(true);
    expect(out.map((b) => b.etaMs)).toEqual([NOW + 2 * MIN, NOW + 9 * MIN]);
  });

  it("ignores buses without GPS and unwatched stops entirely", () => {
    const out = relevantBuses(arrivals, [{ services: ["26", "13"], stopCode: "TRF" }]);
    expect(out.some((b) => b.service === "70")).toBe(false);
    expect(out.filter((b) => b.service === "13")).toHaveLength(1);
  });
});

describe("slicePathAt", () => {
  const path: [number, number][] = [
    [1.3, 103.8],
    [1.31, 103.81],
    [1.32, 103.82],
    [1.33, 103.83],
  ];

  it("trims the line behind the bus and starts it at the bus", () => {
    const out = slicePathAt(path, { lat: 1.318, lng: 103.818 }); // nearest = index 2
    expect(out[0]).toEqual([1.318, 103.818]);
    expect(out.slice(1)).toEqual(path.slice(2));
  });

  it("keeps the whole line when the bus is at the start", () => {
    const out = slicePathAt(path, { lat: 1.3, lng: 103.8 });
    expect(out.slice(1)).toEqual(path);
  });
});
