# 🚌 Bus Rush — Atlas → Home commute optimizer

A phone-first web app that calls Singapore LTA's free **Bus Arrival API** and answers the
three questions you actually care about on the commute — in **both directions** (the
subtitle line is a one-tap direction toggle; it defaults to office-bound before noon SGT,
homeward after). Both directions share the same decision shape: a trunk bus, then
"change early" vs "stay seated and change later". For the evening run:

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
- **`track.ts`** — `trackJourney()`: journey mode. Once you tap *"I just boarded"*, the
  evaluation anchor flips from the office stop's ETAs to **your bus** (boarding time matched
  against downstream stops' live ETAs), so the option you committed to never disappears when
  the bus leaves the first stop. Returns both options with **connection margins** ("26 reaches
  the transfer 1 min after you — tight") measured from *your* projected arrival.

Everything is tunable in **`src/config/preferences.ts`**: crowd penalties (how many "perceived
minutes" a packed bus costs you), wait penalty, safety/transfer buffers, score steepness.

### The three views

| Tab | Mode | Answers |
|-----|------|---------|
| **Leave-by** | `board` | Next departures, each with a *leave-by* time and a cross-departure optimality score. |
| **Leave now** | `leave-now` | "I'm leaving now — which route is best right now?" |
| **On the bus** | `at-transfer` | "I'm on 26 at the transfer — switch to 21 now, or stay on?" |

### Journey mode + live map

Tap **"I just boarded"** on the planning screen and the app switches to journey mode:

- Polls `GET /api/track?legIndex=&boardedMs=[&planId=][&service=]` every **15s** (planning
  board stays at 30s). The response bundles the decision options *and* the map payload, so
  journey mode costs one round of LTA calls per poll.
- The journey survives refreshes / phone locks (localStorage, 3h TTL) and advances by
  explicit taps: *"I'm on the 26"* / *"Staying on past the transfer"* / *"I boarded the 24"*
  (every `anyOf` onward service gets its own button) / *"I'm home — end trip"*.
- The **map** (Leaflet + free OSM/CARTO raster tiles — no API key) shows the journey's stops,
  every relevant bus as a numbered chip placed at its **live GPS position from the BusArrival
  feed**, and you as a pulsing blue dot (browser geolocation). Your bus renders in ink, the
  services you're trying to catch in purple — so you can literally watch the 26 behind you and
  decide to stay on and re-board it later. Stop coordinates come from LTA's BusStops dataset,
  fetched server-side and cached for 24h (`/api/map` powers the planning-screen preview).

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

Edit **`src/config/commute.ts`** only — it defines both directions (`TO_HOME`, `TO_OFFICE`)
as plain data. Tune the `minutes` / `rideMinutes` marked ⚠️ to match reality. Notes:

- The **first ride leg of every plan within a direction must be IDENTICAL** (same service,
  board AND alight stop). The leave-by board and journey mode are built from that shared
  first ride — `src/config/commute.test.ts` fails CI if an edit breaks this.
- Each plan's `decisionLegIndex` marks where it diverges (the transfer decision point).
- A "stay seated past the shared alight" continuation is its own ride leg flagged
  `alreadyAboard: true` (e.g. evening 21 → Eunos, morning 26 → transfer 1).

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

- Live load of the bus you're *currently* on (LTA's feed only gives loads for *upcoming* buses;
  the leg you're already riding shows `UNKNOWN` crowding).
- Auto-advancing journey stages from GPS (today the taps are explicit; your position is shown
  on the map but doesn't drive state).
- Historical crowding patterns for "26 is usually packed at 6pm".
