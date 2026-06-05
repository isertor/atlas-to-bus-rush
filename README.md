# 🚌 Bus Rush — Atlas → Home commute optimizer

A phone-first web app that calls Singapore LTA's free **Bus Arrival API** and answers the
three questions you actually care about on the evening commute:

1. **When do I leave the office?** — a live "leave-by" board across your usual window.
2. **Switch early or stay on?** — once you're on bus 26 at the transfer stop, should you
   hop onto the perfect bus (21) now, or stay on 26 and change later to a less-ideal bus?
3. **Is 26 packed?** — every option shows live crowding (🟢 seats / 🟠 standing / 🔴 packed)
   so you can choose the longer route if it means a seat.

It does the map-checking maths for you and surfaces the decision instantly — live or on a tap.

> **Status: skeleton.** The route data in `src/config/commute.ts` is **placeholder**. Drop in
> your real stop codes / services / timings and the logic works unchanged.

---

## How it works

```
Phone (Next.js client)
   │  GET /api/recommend?mode=board | leave-now | at-transfer
   ▼
Next.js API route (server)  ──►  src/lib/recommend.ts (orchestrator)
   │                                  │
   │  holds LTA_ACCOUNT_KEY           ├─ src/lib/lta/client.ts  → LTA DataMall (or mock)
   │  (never sent to browser)         └─ src/lib/engine/*       → pure decision logic
   ▼
LTA DataMall Bus Arrival API (no CORS, key required)
```

**Why a backend?** LTA's API requires a secret `AccountKey` header and is not CORS-enabled, so a
browser can't call it directly. The Next.js API routes proxy it and run the decision engine
server-side (which also lets the Slack nudge reuse the exact same logic).

### The decision engine (`src/lib/engine/`)

Pure, unit-tested functions — no I/O, no framework:

- **`types.ts`** — the domain model. A `Plan` is an ordered list of `walk` / `ride` legs.
- **`plan.ts`** — `evaluatePlan()` walks a plan against live arrivals and produces timings,
  total wait, crowding, and a **perceived arrival time** = real arrival + crowd/wait penalties.
  Supports three evaluation modes: forward-from-now, anchored-to-a-specific-first-bus
  (for the leave-by board), and from-the-transfer (for switch-vs-stay).
- **`score.ts`** — turns perceived arrivals into a 0–100 score relative to the best option.
- **`board.ts`** — `buildLeaveByBoard()`, `decideLeaveNow()`, `decideAtTransfer()`.

Everything is tunable in **`src/config/preferences.ts`**: crowd penalties (how many "perceived
minutes" a packed bus costs you), wait penalty, safety/transfer buffers, score steepness.

### The three views

| Tab | Mode | Answers |
|-----|------|---------|
| **Leave-by** | `board` | Next departures, each with a *leave-by* time and a cross-departure optimality score. |
| **Leave now** | `leave-now` | "I'm leaving now — which route is best right now?" |
| **On the bus** | `at-transfer` | "I'm on 26 at the transfer — switch to 21 now, or stay on?" |

---

## Getting started

```bash
npm install
cp .env.example .env.local      # USE_MOCK_LTA=1 is on by default — runs with no key
npm run dev                     # http://localhost:3000
```

Other scripts: `npm test` (engine unit tests), `npm run typecheck`, `npm run build`.

### Going live with real LTA data

1. Register for a free account at <https://datamall.lta.gov.sg/> and request an API key.
2. Put it in `.env.local`:
   ```
   LTA_ACCOUNT_KEY=your-key-here
   USE_MOCK_LTA=        # blank/remove to use the real API
   ```
3. Debug a single stop anytime: `GET /api/bus-arrival?stop=83139`.

### Plugging in your real commute

Edit **`src/config/commute.ts`** only. Replace the placeholder `STOP_*` codes with real
5-digit LTA bus stop codes, the `service` numbers with your buses, and tune the `minutes` /
`rideMinutes` to match reality. Notes:

- The **first ride leg of every plan is assumed to be the same bus at the same stop** (your 26
  from stop 1). The leave-by board is built from that shared first ride.
- Each plan's `decisionLegIndex` marks where it diverges (the transfer decision point); the
  "On the bus" view evaluates from there.
- For the "stay on 26" plan, the continued 26 leg is flagged `alreadyAboard: true` so the engine
  knows you don't wait/board for it.

---

## Deploy (Vercel)

1. Push and import the repo into Vercel.
2. Set env vars in the Vercel dashboard: `LTA_ACCOUNT_KEY` (and leave `USE_MOCK_LTA` unset).
3. Deploy. The phone UI, the LTA proxy, and the API all run as one app.

### Slack "time to leave" nudge (optional, stubbed)

The plumbing is in place but inert until you opt in:

1. Create a Slack **Incoming Webhook** and set `SLACK_WEBHOOK_URL` in Vercel.
2. Set a `CRON_SECRET` (Vercel Cron sends it as a Bearer token; `/api/notify` checks it).
3. `vercel.json` already schedules `GET /api/notify` on weekdays — adjust the cron time
   (it's in **UTC**; SGT = UTC+8).

Without a webhook, `/api/notify` just returns the message it *would* have sent — safe to test.

---

## What's intentionally NOT done yet (next steps)

- Real stop codes / services / timings (you'll provide these).
- GPS-assisted position (v1 is manual taps + the always-on board, per your preference).
- Live load of the bus you're *currently* on (LTA's feed only gives loads for *upcoming* buses;
  the "stay on 26" leg shows `UNKNOWN` crowding for the segment you're already riding).
- Persisting an "I boarded 26 at HH:MM" timestamp to sharpen the at-transfer estimate.
- Historical crowding patterns for "26 is usually packed at 6pm".
