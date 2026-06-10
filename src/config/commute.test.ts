import { describe, expect, it } from "vitest";
import type { RideLeg } from "@/lib/engine/types";
import { DIRECTIONS, defaultDirectionId } from "./commute";

// Config lint: structural invariants the engine relies on. Unlike the engine
// tests (which use self-contained fixture plans), these intentionally check
// the REAL config, so a route edit that breaks an engine assumption fails CI
// instead of silently producing a board with missing options.

describe.each(Object.values(DIRECTIONS))("commute config: $id", (commute) => {
  const rides = (legs: typeof commute.plans[number]["legs"]) =>
    legs.filter((l): l is RideLeg => l.kind === "ride");

  it("has at least one plan, each with at least one ride", () => {
    expect(commute.plans.length).toBeGreaterThan(0);
    for (const plan of commute.plans) {
      expect(rides(plan.legs).length).toBeGreaterThan(0);
    }
  });

  it("all plans share an IDENTICAL first ride leg (board grouping + journey deciding)", () => {
    const first = rides(commute.plans[0].legs)[0];
    for (const plan of commute.plans) {
      const r = rides(plan.legs)[0];
      expect(r.service).toBe(first.service);
      expect(r.board.code).toBe(first.board.code);
      expect(r.alight.code).toBe(first.alight.code);
      expect(r.alreadyAboard).toBeFalsy(); // you always freshly board the trunk
    }
  });

  it("alreadyAboard legs continue the SAME service from the previous alight stop", () => {
    for (const plan of commute.plans) {
      const r = rides(plan.legs);
      r.forEach((leg, i) => {
        if (!leg.alreadyAboard) return;
        expect(i).toBeGreaterThan(0); // never the first ride
        expect(leg.service).toBe(r[i - 1].service);
        expect(leg.board.code).toBe(r[i - 1].alight.code);
      });
    }
  });

  it("decisionLegIndex points at a ride leg", () => {
    for (const plan of commute.plans) {
      if (plan.decisionLegIndex == null) continue;
      expect(plan.legs[plan.decisionLegIndex]?.kind).toBe("ride");
    }
  });

  it("every plan ends by reaching the destination (a final walk after the last ride)", () => {
    for (const plan of commute.plans) {
      expect(plan.legs[plan.legs.length - 1].kind).toBe("walk");
    }
  });
});

describe("defaultDirectionId", () => {
  it("picks to-office in the SG morning, to-home in the evening", () => {
    expect(defaultDirectionId(Date.parse("2026-06-10T08:00:00+08:00"))).toBe("to-office");
    expect(defaultDirectionId(Date.parse("2026-06-10T18:00:00+08:00"))).toBe("to-home");
  });
});
