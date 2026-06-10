import { NextResponse } from "next/server";
import { sendLeaveByNudge } from "@/lib/slack";

// Triggered by Vercel Cron (see vercel.json) shortly before the usual departure
// window to push a Slack "time to leave" nudge. Safe to call anytime — without
// SLACK_WEBHOOK_URL it just returns the message it *would* have sent.
//
// Protect with a shared secret: set CRON_SECRET and Vercel Cron will send it as
// `Authorization: Bearer <CRON_SECRET>`.

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }
  const result = await sendLeaveByNudge();
  return NextResponse.json(result);
}
