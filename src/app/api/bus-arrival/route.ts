import { NextResponse } from "next/server";
import { fetchStopArrivals } from "@/lib/lta/client";

// Thin proxy over LTA DataMall's Bus Arrival API. Keeps the AccountKey on the
// server and sidesteps the API's lack of CORS. Mostly useful for debugging a
// single stop; the app itself uses /api/recommend.
//
//   GET /api/bus-arrival?stop=83139

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const stop = new URL(req.url).searchParams.get("stop");
  if (!stop) {
    return NextResponse.json({ error: "Missing ?stop=<busStopCode>" }, { status: 400 });
  }
  try {
    const arrivals = await fetchStopArrivals(stop);
    return NextResponse.json({ stop, arrivals });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 502 },
    );
  }
}
