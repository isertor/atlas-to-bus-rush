import { TO_HOME } from "@/config/commute";
import { fmtClock } from "@/lib/time";
import { getRecommendation } from "@/lib/recommend";

// Slack "time to leave" nudge — STUBBED for v1.
//
// When you're ready: create a Slack Incoming Webhook, put its URL in the
// SLACK_WEBHOOK_URL env var, and schedule GET /api/notify via Vercel Cron
// (see vercel.json) a little before your usual departure. With no webhook set,
// this logs the message instead of sending, so it's safe to wire up early.

/** Build a short, phone-glanceable nudge from the current leave-by board.
 * The cron fires before the EVENING window, so this is always homeward. */
export async function buildLeaveByNudge(now = Date.now()): Promise<string | null> {
  const rec = await getRecommendation("board", TO_HOME, now);
  const top = rec.board[0];
  if (!top || top.leaveOfficeMs == null) return null;

  const b = top.best;
  const legs = b.rides.map((r) => r.service).join(" → ");
  const arrive = b.arriveHomeMs != null ? fmtClock(b.arriveHomeMs) : "?";
  return `🚌 Leave by *${fmtClock(top.leaveOfficeMs)}* — catch ${legs} (score ${b.score}), home ~${arrive}.`;
}

/** Send (or, without a webhook, log) the nudge. Returns what was produced. */
export async function sendLeaveByNudge(now = Date.now()): Promise<{ sent: boolean; text: string | null }> {
  const text = await buildLeaveByNudge(now);
  if (!text) return { sent: false, text: null };

  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) {
    console.log("[slack stub] would send:", text);
    return { sent: false, text };
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
  return { sent: res.ok, text };
}
