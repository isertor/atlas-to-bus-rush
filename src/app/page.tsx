"use client";

import dynamic from "next/dynamic";
import { Fragment, useCallback, useEffect, useState } from "react";
import { PLANS } from "@/config/commute";
import type { UserPos } from "@/components/JourneyMap";
import type { MapResponse } from "@/app/api/map/route";
import type { TrackResponse } from "@/app/api/track/route";
import type { LeaveByRow, PlanOption, RideView } from "@/lib/engine/board";
import type { TrackOption } from "@/lib/engine/track";
import type { LoadCode, Plan, RideLeg } from "@/lib/engine/types";
import type { RecommendResult } from "@/lib/recommend";
import { fmtClock, minutesFromNow } from "@/lib/time";

// Leaflet touches `window`; load it client-side only.
const JourneyMap = dynamic(() => import("@/components/JourneyMap"), { ssr: false });

// ---------------------------------------------------------------------------
//  Journey state — "I'm ON a bus".
//
//  Persisted to localStorage so locking the phone or refreshing mid-ride
//  doesn't lose the trip. While a journey is active the app polls /api/track
//  (anchored to the boarded bus, not the office stop) instead of the board,
//  which is what keeps the committed option from vanishing once the bus
//  leaves the first stop.
// ---------------------------------------------------------------------------

interface Journey {
  planId: string | null; // null while still deciding on the shared trunk
  legIndex: number;
  boardedMs: number;
  service?: string; // actual boarded service on an anyOf leg
}

const JOURNEY_KEY = "bus-rush-journey-v1";
const JOURNEY_TTL_MS = 3 * 60 * 60 * 1000; // a commute is over well within 3h

function loadJourney(): Journey | null {
  try {
    const raw = localStorage.getItem(JOURNEY_KEY);
    if (!raw) return null;
    const { journey, at } = JSON.parse(raw) as { journey: Journey; at: number };
    if (Date.now() - at > JOURNEY_TTL_MS) return null;
    const leg = PLANS[0]?.legs[journey.legIndex];
    if (!leg) return null; // config changed since it was saved
    return journey;
  } catch {
    return null;
  }
}

function saveJourney(journey: Journey | null) {
  try {
    if (journey) localStorage.setItem(JOURNEY_KEY, JSON.stringify({ journey, at: Date.now() }));
    else localStorage.removeItem(JOURNEY_KEY);
  } catch {
    // private mode etc. — journey just won't survive a refresh
  }
}

const FIRST_RIDE_INDEX = Math.max(0, PLANS[0].legs.findIndex((l) => l.kind === "ride"));
const FIRST_SERVICE = (PLANS[0].legs[FIRST_RIDE_INDEX] as RideLeg).service;

/** Index of the next ride leg after `after`, or -1. */
function nextRideIndex(plan: Plan, after: number): number {
  for (let i = after + 1; i < plan.legs.length; i++) {
    if (plan.legs[i].kind === "ride") return i;
  }
  return -1;
}

/** Services of the next FRESH boarding (skipping stay-seated legs) for map highlighting. */
function watchServicesFor(journey: Journey): string[] {
  const plans = journey.planId ? PLANS.filter((p) => p.id === journey.planId) : PLANS;
  const set = new Set<string>();
  for (const plan of plans) {
    let i = nextRideIndex(plan, journey.legIndex);
    while (i !== -1) {
      const leg = plan.legs[i] as RideLeg;
      if (!leg.alreadyAboard) {
        for (const s of leg.anyOf?.length ? leg.anyOf : [leg.service]) set.add(s);
        break;
      }
      i = nextRideIndex(plan, i);
    }
  }
  return [...set];
}

/** Browser geolocation as a live position, while `active`. */
function useGeo(active: boolean): UserPos | null {
  const [pos, setPos] = useState<UserPos | null>(null);
  useEffect(() => {
    if (!active || typeof navigator === "undefined" || !navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition(
      (p) => setPos({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      () => {},
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 15_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [active]);
  return active ? pos : null;
}

export default function Page() {
  const [journey, setJourneyState] = useState<Journey | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setJourneyState(loadJourney());
    setHydrated(true);
  }, []);

  const setJourney = useCallback((j: Journey | null) => {
    saveJourney(j);
    setJourneyState(j);
  }, []);

  if (!hydrated) {
    return (
      <main className="wrap">
        <div className="spinner" />
      </main>
    );
  }

  return journey ? (
    <JourneyScreen journey={journey} setJourney={setJourney} />
  ) : (
    <PlanScreen onBoard={() => setJourney({ planId: null, legIndex: FIRST_RIDE_INDEX, boardedMs: Date.now() })} />
  );
}

// ---------------------------------------------------------------------------
//  Planning screen — the leave-by board (unchanged behaviour) + map preview
//  + the "I just boarded" entry point into journey mode.
// ---------------------------------------------------------------------------

function PlanScreen({ onBoard }: { onBoard: () => void }) {
  const [data, setData] = useState<RecommendResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [sel, setSel] = useState(0);
  const [mapOpen, setMapOpen] = useState(false);
  const [mapData, setMapData] = useState<MapResponse | null>(null);
  const user = useGeo(mapOpen);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/recommend?mode=board`, { cache: "no-store" });
      if (!res.ok) throw new Error();
      setData(await res.json());
      setError(false);
    } catch {
      setError(true); // keep last good data on screen
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);

  // Map preview polls only while open (separate endpoint; board stays light).
  useEffect(() => {
    if (!mapOpen) return;
    let alive = true;
    const loadMap = async () => {
      try {
        const res = await fetch(`/api/map`, { cache: "no-store" });
        if (res.ok && alive) setMapData(await res.json());
      } catch {
        // keep last map
      }
    };
    loadMap();
    const id = setInterval(loadMap, 20_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [mapOpen]);

  const now = data?.now ?? Date.now();
  const rows = (data?.board ?? []).slice(0, 3);
  const sIdx = Math.min(sel, Math.max(0, rows.length - 1));
  const active = rows[sIdx];

  return (
    <main className="wrap">
      <header>
        <h1>Heading home</h1>
        <span className="hbtns">
          <button className={`mapbtn${mapOpen ? " on" : ""}`} onClick={() => setMapOpen((v) => !v)}>
            Map
          </button>
          <span className={`live${error ? " off" : ""}`}>
            <span className="dot" />
            {error ? "reconnecting" : data?.mock ? "demo" : "live"}
          </span>
        </span>
      </header>
      <div className="sub">{data ? `${data.origin} → ${data.destination}` : `Bus ${FIRST_SERVICE} from your office stop`}</div>

      {mapOpen && (
        <div className="mapcard">
          <JourneyMap
            stops={mapData?.map.stops ?? []}
            buses={mapData?.map.buses ?? []}
            user={user}
            now={mapData?.now ?? now}
            watchServices={[FIRST_SERVICE]}
          />
        </div>
      )}

      {!data && loading ? (
        <div className="spinner" />
      ) : !data || (rows.length === 0 && (error || data.partial)) ? (
        <div className="note">Can&rsquo;t reach LTA right now. Retrying…</div>
      ) : rows.length === 0 ? (
        <div className="note">No {FIRST_SERVICE} buses right now.</div>
      ) : (
        <>
          <Rail rows={rows} now={now} sel={sIdx} onPick={setSel} />
          {active && <Detail row={active} now={now} />}
          <button className="boardbtn" onClick={onBoard}>
            I just boarded the {FIRST_SERVICE} →
          </button>
        </>
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------
//  Journey screen — the SAME card language as the planning screen, anchored to
//  your bus: the map sits where the rail was, "next stop in N min" replaces
//  "Leave in N min", and the two options keep their timelines — the connection
//  margin is the familiar "wait 1m" pill on the connecting bus.
// ---------------------------------------------------------------------------

function JourneyScreen({ journey, setJourney }: { journey: Journey; setJourney: (j: Journey | null) => void }) {
  const [data, setData] = useState<TrackResponse | null>(null);
  const [error, setError] = useState(false);
  const user = useGeo(true);

  const load = useCallback(async () => {
    const params = new URLSearchParams({
      legIndex: String(journey.legIndex),
      boardedMs: String(journey.boardedMs),
    });
    if (journey.planId) params.set("planId", journey.planId);
    if (journey.service) params.set("service", journey.service);
    try {
      const res = await fetch(`/api/track?${params}`, { cache: "no-store" });
      if (!res.ok) throw new Error();
      setData(await res.json());
      setError(false);
    } catch {
      setError(true); // keep last good data on screen
    }
  }, [journey]);

  useEffect(() => {
    setData(null);
    load();
    // On board you need the connection margin fresh — poll faster than the
    // planning board (15s vs 30s); still well inside LTA's rate limits.
    const id = setInterval(load, 15_000);
    return () => clearInterval(id);
  }, [load]);

  const now = data?.now ?? Date.now();
  const service = data?.service ?? journey.service ?? FIRST_SERVICE;
  const etaMin = data ? Math.max(0, minutesFromNow(data.myEtaMs, now)) : null;
  const ordered = data ? [...data.options].sort((a, b) => routeRank(a.planId) - routeRank(b.planId)) : [];

  return (
    <main className="wrap">
      <header>
        <h1>Heading home</h1>
        <span className="hbtns">
          <button className="endbtn" onClick={() => setJourney(null)}>
            End trip
          </button>
          <span className={`live${error ? " off" : ""}`}>
            <span className="dot" />
            {error ? "reconnecting" : data?.mock ? "demo" : "live"}
          </span>
        </span>
      </header>
      <div className="sub">{data ? `On the ${service} → ${data.alightName}` : `On the ${service}`}</div>

      <div className="mapcard tall">
        <JourneyMap
          stops={data?.map.stops ?? []}
          buses={data?.map.buses ?? []}
          user={user}
          now={now}
          myService={service}
          watchServices={watchServicesFor(journey)}
        />
      </div>

      {!data ? (
        <div className="spinner" />
      ) : (
        <div className="detail">
          <div className="leave">
            <div className="big">{etaMin === 0 ? "Arriving now" : `Next stop in ${etaMin} min`}</div>
            <div className="by">
              {data.alightName} · {data.myEtaSource === "estimated" ? "~" : ""}
              {fmtClock(data.myEtaMs)}
            </div>
          </div>
          <div className="options">
            {ordered.map((opt) => (
              <JourneyOption key={opt.planId} opt={opt} journey={journey} track={data} now={now} setJourney={setJourney} />
            ))}
          </div>
        </div>
      )}
    </main>
  );
}

/** A planning-screen option card kept alive while aboard, plus its advance action. */
function JourneyOption({
  opt,
  journey,
  track,
  now,
  setJourney,
}: {
  opt: TrackOption;
  journey: Journey;
  track: TrackResponse;
  now: number;
  setJourney: (j: Journey | null) => void;
}) {
  const plan = PLANS.find((p) => p.id === opt.planId);
  if (!plan) return null;
  // BEST only matters while there's still a choice to make.
  const best = opt.best && journey.planId == null;
  const { nodes, conns } = buildJourney(opt, now);
  const home = nodes[nodes.length - 1] as HomeNode;

  const idx = nextRideIndex(plan, journey.legIndex);
  const leg = idx !== -1 ? (plan.legs[idx] as RideLeg) : null;

  return (
    <div className={`opt${best ? " best" : ""}`}>
      <div className="ohead">
        <span className="oname">
          {strategyName(opt.planId)}
          {best && <span className="badge">BEST</span>}
        </span>
        <span className="oarr">
          <span className="t">{home.clock}</span>
        </span>
      </div>
      <div className="timeline">
        {nodes.map((n, i) => (
          <Fragment key={i}>
            {i > 0 && <Conn c={conns[i - 1]} />}
            <Node n={n} />
          </Fragment>
        ))}
      </div>
      <div className="acts">
        {leg ? (
          leg.alreadyAboard ? (
            <button
              className="act"
              onClick={() => setJourney({ planId: plan.id, legIndex: idx, boardedMs: track.myEtaMs })}
            >
              Staying on past {leg.board.name}
            </button>
          ) : (
            (leg.anyOf?.length ? leg.anyOf : [leg.service]).map((s) => (
              <button
                key={s}
                className="act"
                onClick={() => setJourney({ planId: plan.id, legIndex: idx, boardedMs: Date.now(), service: s })}
              >
                I&rsquo;m on the {s}
              </button>
            ))
          )
        ) : (
          <button className="act done" onClick={() => setJourney(null)}>
            I&rsquo;m home — end trip
          </button>
        )}
      </div>
    </div>
  );
}

/** Top rail: the upcoming bus-21 departures, each showing when it reaches your
 * stop AND when that departure lands you home. Lets you compare at a glance. */
function Rail({ rows, now, sel, onPick }: { rows: LeaveByRow[]; now: number; sel: number; onPick: (i: number) => void }) {
  const service = rows[0]?.firstService ?? FIRST_SERVICE;
  return (
    <div className="railwrap">
      <div className="raillabel">Next {service} buses</div>
      <div className="rail">
        {rows.map((row, i) => {
          const mins = Math.max(0, minutesFromNow(row.firstBoardMs, now));
          const home = row.best.arriveHomeMs;
          return (
            <button key={row.firstBoardMs} className={`chip${i === sel ? " sel" : ""}`} onClick={() => onPick(i)}>
              <div className="eta">
                {mins === 0 ? "now" : mins}
                {mins !== 0 && <small>min</small>}
              </div>
              <div className="home">{home != null ? `home ${fmtClock(home)}` : "—"}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Detail({ row, now }: { row: LeaveByRow; now: number }) {
  const leave = row.leaveOfficeMs;
  const leaveMin = leave != null ? minutesFromNow(leave, now) : null;

  // `options` is ranked best-first, so the top one is the recommendation.
  const bestId = row.options[0]?.planId;
  const ordered = [...row.options].sort((a, b) => routeRank(a.planId) - routeRank(b.planId));

  return (
    <div className="detail">
      <div className="leave">
        <div className="big">{leaveMin == null ? "—" : leaveMin <= 0 ? "Leave now" : `Leave in ${leaveMin} min`}</div>
        {leave != null && <div className="by">by {fmtClock(leave)}</div>}
      </div>
      <div className="options">
        {ordered.map((opt) => (
          <Option key={opt.planId} opt={opt} best={opt.planId === bestId} now={now} />
        ))}
      </div>
    </div>
  );
}

function strategyName(planId: string): string {
  return planId === "perfect" ? "Change to 26" : "Stay on 21";
}

// Keep the routes in a FIXED order (Change to 26 on top, Stay on 21 below) so
// they don't swap places between refreshes — we just move the highlight.
const ROUTE_ORDER = ["perfect", "stay-21-eunos"];
function routeRank(planId: string): number {
  const i = ROUTE_ORDER.indexOf(planId);
  return i === -1 ? ROUTE_ORDER.length : i;
}

const LOAD_CLASS: Record<LoadCode, string> = {
  SEA: "good",
  SDA: "warn",
  LSD: "bad",
  UNKNOWN: "unk",
};

// ---------------------------------------------------------------------------
//  Journey timeline: bus → (wait) → bus → walk → home
// ---------------------------------------------------------------------------

type BusNode = {
  kind: "bus";
  service: string;
  etaMin: number;
  load: LoadCode;
  type?: string;
  /** Transfer wait before boarding this bus (connecting buses only). */
  waitMin?: number;
  waitEst?: boolean;
  /** Journey mode: the bus you're sitting on right now. */
  riding?: boolean;
};
type HomeNode = { kind: "home"; clock: string };
type JNode = BusNode | HomeNode;
/** `grow` sizes the connector to the in-vehicle ride time it spans, so the
 * timeline reflects real geography (short hops short, long rides long). */
type JConn = { kind: "ride" | "walk"; grow: number };

const MIN_MS = 60_000;

function busNode(r: RideView, now: number, withWait: boolean): BusNode {
  return {
    kind: "bus",
    service: r.service,
    etaMin: Math.max(0, minutesFromNow(r.boardMs, now)),
    load: r.load,
    type: r.type,
    waitMin: withWait ? r.waitMin : undefined,
    waitEst: withWait ? r.waitSource === "estimated" : undefined,
  };
}

/** What the timeline needs from an option — PlanOption and TrackOption both fit. */
type JourneyLike = Pick<PlanOption, "rides" | "arriveHomeMs" | "estimated">;

function buildJourney(opt: JourneyLike, now: number): { nodes: JNode[]; conns: JConn[] } {
  // Show only the buses you actively board: the first bus, then each connecting
  // bus (with its transfer wait attached). "Stay seated" legs are implicit — no
  // intermediate stop node, no "stay on" label. In journey mode the first ride
  // is the bus you're ALREADY on; it leads the timeline as a "riding" node
  // (any stay-seated continuation legs still collapse into it).
  const aboard = opt.rides[0]?.alreadyAboard ? opt.rides[0] : null;
  const boarded = opt.rides.filter((r) => !r.alreadyAboard);
  const nodes: JNode[] = [];
  const conns: JConn[] = [];
  if (aboard) nodes.push({ ...busNode(aboard, now, false), riding: true });
  boarded.forEach((r, i) => {
    if (nodes.length > 0) {
      // In-vehicle time from boarding the previous bus to boarding this one
      // (= the elapsed gap minus the transfer wait, which is drawn on the node).
      const prevBoardMs = i > 0 ? boarded[i - 1].boardMs : (aboard as RideView).boardMs;
      const spanMs = r.boardMs - prevBoardMs - (r.waitMin ?? 0) * MIN_MS;
      conns.push({ kind: "ride", grow: Math.max(spanMs, MIN_MS) / MIN_MS });
    }
    nodes.push(busNode(r, now, i > 0 || aboard != null));
  });
  // Last leg: ride of the final bus + the walk home (no wait after boarding it).
  const last = boarded[boarded.length - 1] ?? (aboard as RideView);
  const homeMs = opt.arriveHomeMs ?? last.boardMs;
  conns.push({ kind: "walk", grow: Math.max(homeMs - last.boardMs, MIN_MS) / MIN_MS });
  nodes.push({
    kind: "home",
    clock: opt.arriveHomeMs != null ? `${opt.estimated ? "~" : ""}${fmtClock(opt.arriveHomeMs)}` : "—",
  });
  return { nodes, conns };
}

function Option({ opt, best, now }: { opt: PlanOption; best: boolean; now: number }) {
  const { nodes, conns } = buildJourney(opt, now);
  const home = nodes[nodes.length - 1] as HomeNode;
  return (
    <div className={`opt${best ? " best" : ""}`}>
      <div className="ohead">
        <span className="oname">
          {strategyName(opt.planId)}
          {best && <span className="badge">BEST</span>}
        </span>
        <span className="oarr">
          <span className="t">{home.clock}</span>
        </span>
      </div>
      <div className="timeline">
        {nodes.map((n, i) => (
          <Fragment key={i}>
            {i > 0 && <Conn c={conns[i - 1]} />}
            <Node n={n} />
          </Fragment>
        ))}
      </div>
    </div>
  );
}

function Node({ n }: { n: JNode }) {
  if (n.kind === "bus") {
    const w = n.waitMin;
    const waitLabel = w == null ? null : w <= 0 && !n.waitEst ? "no wait" : `wait ${n.waitEst ? "~" : ""}${w}m`;
    const longWait = w != null && !n.waitEst && w > 8;
    return (
      <span className={`node bus load-${LOAD_CLASS[n.load]}`}>
        {waitLabel && <span className={`bwait${longWait ? " long" : ""}${n.waitEst ? " est" : ""}`}>{waitLabel}</span>}
        <span className="bnum">
          <DeckIcon type={n.type} />
          {n.service}
        </span>
        <span className="beta">{n.riding ? "riding" : n.etaMin === 0 ? "now" : `${n.etaMin}m`}</span>
      </span>
    );
  }
  return (
    <span className="node home">
      <span className="hmark" />
      <span className="hlabel">home</span>
    </span>
  );
}

function Conn({ c }: { c: JConn }) {
  return <span className={`conn ${c.kind}`} style={{ flexGrow: c.grow }} />;
}

/** Single vs double decker glyph, mirroring the LTA bus-app pattern. */
function DeckIcon({ type }: { type?: string }) {
  const dd = type === "DD";
  const bd = type === "BD";
  if (dd) {
    return (
      <svg className="deck" width="15" height="15" viewBox="0 0 24 24" aria-label="double decker" role="img">
        <rect x="4" y="2.5" width="16" height="19" rx="3" />
        <rect className="win" x="6.5" y="5" width="11" height="3.2" rx="1" />
        <rect className="win" x="6.5" y="12" width="11" height="3.2" rx="1" />
        <circle className="wheel" cx="8" cy="20.5" r="1.4" />
        <circle className="wheel" cx="16" cy="20.5" r="1.4" />
      </svg>
    );
  }
  // Single deck (and bendy as a wider single-tier stand-in).
  return (
    <svg className="deck" width="15" height="15" viewBox="0 0 24 24" aria-label={bd ? "bendy" : "single decker"} role="img">
      <rect x="4" y="6" width="16" height="12" rx="3" />
      <rect className="win" x="6.5" y="9" width="11" height="3.4" rx="1" />
      <circle className="wheel" cx="8" cy="17" r="1.4" />
      <circle className="wheel" cx="16" cy="17" r="1.4" />
    </svg>
  );
}
