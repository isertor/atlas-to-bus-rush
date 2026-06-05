import { NextResponse } from "next/server";
import { getRecommendation, type Mode } from "@/lib/recommend";

// The app's main data endpoint. Returns the always-on leave-by board plus,
// depending on mode, the live ranked options.
//
//   GET /api/recommend?mode=board        (default) — leave-by board only
//   GET /api/recommend?mode=leave-now    — "I'm leaving now, what's best?"
//   GET /api/recommend?mode=at-transfer  — "I'm on 26 at the transfer: switch or stay?"
//
// Optional &at=<epoch-ms> overrides "now" for testing/demos.

export const dynamic = "force-dynamic";

const MODES: Mode[] = ["board", "leave-now", "at-transfer"];

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const modeParam = params.get("mode") ?? "board";
  const mode: Mode = MODES.includes(modeParam as Mode) ? (modeParam as Mode) : "board";
  const atParam = params.get("at");
  const now = atParam ? Number(atParam) : Date.now();

  try {
    const result = await getRecommendation(mode, Number.isFinite(now) ? now : Date.now());
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 502 },
    );
  }
}
