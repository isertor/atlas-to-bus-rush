"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import type { LeaveByRow, PlanOption, RideView } from "@/lib/engine/board";
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
  const active = rows[Math.min(sel, rows.length - 1)];

  return (
    <main className="wrap">
      <header>
        <h1>Heading home</h1>
        <span className={`live${error ? " off" : ""}`}>
          <span className="dot" />
          {error ? "reconnecting" : data?.mock ? "demo" : "live"}
        </span>
      </header>
      <div className="sub">Bus 21 from your office stop</div>

      {!data && loading ? (
        <div className="spinner" />
      ) : !data || (rows.length === 0 && (error || data.partial)) ? (
        <div className="note">Can&rsquo;t reach LTA right now. Retrying…</div>
      ) : rows.length === 0 ? (
        <div className="note">No 21 buses right now.</div>
      ) : (
        <>
          <div className="tabs">
            {rows.map((row, i) => (
              <Tab key={row.firstBoardMs} row={row} now={now} i={i} sel={i === sel} onPick={() => setSel(i)} />
            ))}
          </div>
          {active && <Panel row={active} now={now} />}
        </>
      )}

      <div className="footer">{data?.mock ? "Demo data — add an LTA key for live arrivals" : "Live · LTA DataMall"}</div>
    </main>
  );
}

const WHEN = ["Next", "Then", "Later"];

function Tab({ row, now, i, sel, onPick }: { row: LeaveByRow; now: number; i: number; sel: boolean; onPick: () => void }) {
  const mins = Math.max(0, minutesFromNow(row.firstBoardMs, now));
  return (
    <button className={`tab${sel ? " sel" : ""}`} onClick={onPick}>
      <div className="when">{WHEN[i]}</div>
      <div className="num">
        {mins}
        <small>min</small>
      </div>
      <div className="at">{fmtClock(row.firstBoardMs)}</div>
    </button>
  );
}

function Panel({ row, now }: { row: LeaveByRow; now: number }) {
  const leave = row.leaveOfficeMs;
  const leaveMin = leave != null ? minutesFromNow(leave, now) : null;
  const toStop = leave != null ? Math.max(1, Math.round((row.firstBoardMs - leave) / 60_000)) : null;

  const bestId = row.options[0]?.planId;
  // Show the recommended route first and dominant, the other one quieter below.
  const ordered = [
    row.options.find((o) => o.planId === bestId),
    row.options.find((o) => o.planId !== bestId),
  ].filter((o): o is PlanOption => o != null);

  return (
    <div className="panel">
      <div className="leave">
        <div className="big">{leaveMin == null ? "—" : leaveMin <= 0 ? "Leave now" : `Leave in ${leaveMin} min`}</div>
        {leave != null && (
          <div className="by">
            by {fmtClock(leave)}
            {toStop != null ? ` · ${toStop} min walk` : ""}
          </div>
        )}
      </div>
      <div className="rule" />
      {ordered.map((opt) => (
        <Route key={opt.planId} opt={opt} best={opt.planId === bestId} />
      ))}
    </div>
  );
}

function strategyName(opt: PlanOption): string {
  return opt.planId === "perfect" ? "Change to 26" : "Stay on 21";
}

// crowd of the bus that carries you home (last boarded ride), live only
function homeCrowd(opt: PlanOption): { word: string; bad: boolean } | null {
  const last = [...opt.rides].reverse().find((r) => !r.alreadyAboard);
  if (!last || last.load === "UNKNOWN") return null;
  if (last.load === "SEA") return { word: "seat", bad: false };
  if (last.load === "SDA") return { word: "standing", bad: false };
  return { word: "packed", bad: true };
}

function shortStop(name: string): string {
  return name.split("(")[0].trim();
}

type DNode = { kind: "bus" | "stop" | "home"; label?: string };
type DConn = { kind: "ride" | "wait" | "walk"; min?: number; est?: boolean };

function buildDiagram(opt: PlanOption): { nodes: DNode[]; conns: DConn[] } {
  const rides = opt.rides;
  const nodes: DNode[] = [{ kind: "bus", label: rides[0].service }];
  const conns: DConn[] = [];
  for (let i = 1; i < rides.length; i++) {
    const r: RideView = rides[i];
    if (r.alreadyAboard) {
      conns.push({ kind: "ride" });
      nodes.push({ kind: "stop", label: shortStop(r.alightName) });
    } else {
      conns.push({ kind: "wait", min: r.waitMin, est: r.waitSource === "estimated" });
      nodes.push({ kind: "bus", label: r.service });
    }
  }
  conns.push({ kind: "walk" });
  nodes.push({ kind: "home", label: "home" });
  return { nodes, conns };
}

function Route({ opt, best }: { opt: PlanOption; best: boolean }) {
  const crowd = homeCrowd(opt);
  const { nodes, conns } = buildDiagram(opt);
  const home = opt.arriveHomeMs != null ? `${opt.estimated ? "~" : ""}${fmtClock(opt.arriveHomeMs)}` : "—";

  return (
    <div className={`route${best ? " best" : ""}`}>
      <div className="rlabel">
        {strategyName(opt)}
        {best && <span className="tagbest">BEST</span>}
      </div>
      <div className="rhome">
        <span className="t">{home}</span>
        {crowd && <span className={`crowd${crowd.bad ? " bad" : ""}`}>{crowd.word}</span>}
      </div>
      <div className="diagram">
        {nodes.map((n, i) => (
          <Fragment key={i}>
            {i > 0 && <Conn c={conns[i - 1]} />}
            <span className={`dnode ${n.kind}`}>{n.label}</span>
          </Fragment>
        ))}
      </div>
    </div>
  );
}

function Conn({ c }: { c: DConn }) {
  if (c.kind === "wait") {
    const m = c.min ?? 0;
    const label = c.est ? `~${m}m` : m <= 0 ? "no wait" : `wait ${m}m`;
    const long = !c.est && m > 6;
    return (
      <span className={`dconn wait${long ? " long" : ""}${c.est ? " est" : ""}`}>
        <span className="lbl">{label}</span>
      </span>
    );
  }
  if (c.kind === "walk") {
    return (
      <span className="dconn walk">
        <span className="lbl">walk</span>
      </span>
    );
  }
  return <span className="dconn" />;
}
