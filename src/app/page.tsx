"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import type { LeaveByRow, PlanOption } from "@/lib/engine/board";
import type { LoadCode } from "@/lib/engine/types";
import type { RecommendResult } from "@/lib/recommend";
import { fmtClock, minutesFromNow } from "@/lib/time";

export default function Page() {
  const [data, setData] = useState<RecommendResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [sel, setSel] = useState(0);

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

  const now = data?.now ?? Date.now();
  const rows = (data?.board ?? []).slice(0, 3);
  const sIdx = Math.min(sel, Math.max(0, rows.length - 1));
  const active = rows[sIdx];

  return (
    <main className="wrap">
      <header>
        <h1>Heading home</h1>
        <span className={`live${error ? " off" : ""}`}>
          <span className="dot" />
          {error ? "reconnecting" : data?.mock ? "demo" : "live"}
        </span>
      </header>
      <div className="sub">{data ? `${data.origin} → ${data.destination}` : "Bus 21 from your office stop"}</div>

      {!data && loading ? (
        <div className="spinner" />
      ) : !data || (rows.length === 0 && (error || data.partial)) ? (
        <div className="note">Can&rsquo;t reach LTA right now. Retrying…</div>
      ) : rows.length === 0 ? (
        <div className="note">No 21 buses right now.</div>
      ) : (
        <>
          <Rail rows={rows} now={now} sel={sIdx} onPick={setSel} />
          {active && <Detail row={active} now={now} />}
        </>
      )}
    </main>
  );
}

/** Top rail: the upcoming bus-21 departures, each showing when it reaches your
 * stop AND when that departure lands you home. Lets you compare at a glance. */
function Rail({ rows, now, sel, onPick }: { rows: LeaveByRow[]; now: number; sel: number; onPick: (i: number) => void }) {
  const service = rows[0]?.firstService ?? "21";
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
  // Keep the routes in a FIXED order (Change to 26 on top, Stay on 21 below) so
  // they don't swap places between refreshes — we just move the highlight.
  const ROUTE_ORDER = ["perfect", "stay-21-eunos"];
  const rank = (id: string) => {
    const i = ROUTE_ORDER.indexOf(id);
    return i === -1 ? ROUTE_ORDER.length : i;
  };
  const ordered = [...row.options].sort((a, b) => rank(a.planId) - rank(b.planId));

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

function strategyName(opt: PlanOption): string {
  return opt.planId === "perfect" ? "Change to 26" : "Stay on 21";
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
};
type HomeNode = { kind: "home"; clock: string };
type JNode = BusNode | HomeNode;
/** `grow` sizes the connector to the in-vehicle ride time it spans, so the
 * timeline reflects real geography (short hops short, long rides long). */
type JConn = { kind: "ride" | "walk"; grow: number };

const MIN_MS = 60_000;

function busNode(r: PlanOption["rides"][number], now: number, withWait: boolean): BusNode {
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

function buildJourney(opt: PlanOption, now: number): { nodes: JNode[]; conns: JConn[] } {
  // Show only the buses you actively board: the first bus, then each connecting
  // bus (with its transfer wait attached). "Stay seated" legs are implicit — no
  // intermediate stop node, no "stay on" label.
  const boarded = opt.rides.filter((r) => !r.alreadyAboard);
  const nodes: JNode[] = [];
  const conns: JConn[] = [];
  boarded.forEach((r, i) => {
    if (i > 0) {
      // In-vehicle time from boarding the previous bus to boarding this one
      // (= the elapsed gap minus the transfer wait, which is drawn on the node).
      const spanMs = r.boardMs - boarded[i - 1].boardMs - (r.waitMin ?? 0) * MIN_MS;
      conns.push({ kind: "ride", grow: Math.max(spanMs, MIN_MS) / MIN_MS });
    }
    nodes.push(busNode(r, now, i > 0));
  });
  // Last leg: ride of the final bus + the walk home (no wait after boarding it).
  const last = boarded[boarded.length - 1];
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
          {strategyName(opt)}
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
        <span className="beta">{n.etaMin === 0 ? "now" : `${n.etaMin}m`}</span>
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
