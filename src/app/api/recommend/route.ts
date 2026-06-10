import { NextResponse } from "next/server";
import { DIRECTIONS, parseDirectionId } from "@/config/commute";
import { getRecommendation, type Mode } from "@/lib/recommend";

// The app's main data endpoint. Returns the always-on leave-by board plus,
// depending on mode, the live ranked options.
//
//   GET /api/recommend?mode=board        (default) — leave-by board only
//   GET /api/recommend?mode=leave-now    — "I'm leaving now, what's best?"
//   GET /api/recommend?mode=at-transfer  — "I'm at the transfer: switch or stay?"
//
// &dir=to-home|to-office picks the commute direction (defaults by SG time of
// day: mornings → to-office). Optional &at=<epoch-ms> overrides "now".

export const dynamic = "force-dynamic";

const MODES: Mode[] = ["board", "leave-now", "at-transfer"];

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const modeParam = params.get("mode") ?? "board";
  const mode: Mode = MODES.includes(modeParam as Mode) ? (modeParam as Mode) : "board";
  const atParam = params.get("at");
  const rawNow = atParam ? Number(atParam) : Date.now();
  const now = Number.isFinite(rawNow) ? rawNow : Date.now();
  const commute = DIRECTIONS[parseDirectionId(params.get("dir"), now)];

  try {
    const result = await getRecommendation(mode, commute, now);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 502 },
    );
  }
}
