"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import type { LeaveByRow, PlanOption, RideView } from "@/lib/engine/board";
import type { RecommendResult } from "@/lib/recommend";
import { fmtClock, minutesFromNow } from "@/lib/time";

export default function Page() {
  const [data, setData] = useState<RecommendResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/recommend?mode=board`, { cache: "no-store" });
      if (res.ok) setData(await res.json());
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
  const rows = data?.board ?? [];
  const active = rows[Math.min(sel, rows.length - 1)];

  return (
    <main className="wrap">
      <header>
        <h1>Heading home</h1>
        <span className="clock">
          {fmtClock(now)} · {data?.mock ? "demo" : "live"}
        </span>
      </header>
      <div className="sub">Bus 21 at the office — pick the one you&rsquo;ll catch.</div>

      {!data && loading ? (
        <div className="spinner" />
      ) : rows.length === 0 ? (
        <div className="empty">No buses right now.</div>
      ) : (
        <>
          <div className="buses">
            {rows.slice(0, 3).map((row, i) => (
              <BusCard key={row.firstBoardMs} row={row} now={now} i={i} active={i === sel} onPick={() => setSel(i)} />
            ))}
          </div>
          {active && <Panel row={active} now={now} />}
        </>
      )}

      <div className="footer">
        {data?.mock ? "Demo data — add an LTA key for live arrivals" : "Live from LTA"}
      </div>
    </main>
  );
}

const WHEN = ["next", "then", "later"];

function BusCard({
  row,
  now,
  i,
  active,
  onPick,
}: {
  row: LeaveByRow;
  now: number;
  i: number;
  active: boolean;
  onPick: () => void;
}) {
  const mins = Math.max(0, minutesFromNow(row.firstBoardMs, now));
  const home = row.best.arriveHomeMs;
  return (
    <button className={`bus${active ? " active" : ""}`} onClick={onPick}>
      <div className="svc">21 · {WHEN[i]}</div>
      <div className="in">
        {mins}
        <small>min</small>
      </div>
      <div className="at">{fmtClock(row.firstBoardMs)}</div>
      {home != null && <div className="mini">home {fmtClock(home)}</div>}
    </button>
  );
}

function Panel({ row, now }: { row: LeaveByRow; now: number }) {
  const leave = row.leaveOfficeMs;
  const leaveMin = leave != null ? minutesFromNow(leave, now) : null;
  const walkMin = leave != null ? Math.max(0, Math.round((row.firstBoardMs - leave) / 60_000)) : null;

  const perfect = row.options.find((o) => o.planId === "perfect" && o.feasible);
  const stay = row.options.find((o) => o.planId.startsWith("stay") && o.feasible);
  const bestId = row.options[0]?.planId;

  return (
    <div className="panel">
      <div className="leave">
        <div className="a">
          {leaveMin == null ? (
            "—"
          ) : leaveMin <= 0 ? (
            <b>Leave now</b>
          ) : (
            <>
              Leave in <b>{leaveMin} min</b>
            </>
          )}
          {leave != null && <span style={{ color: "var(--faint)" }}> · by {fmtClock(leave)}</span>}
        </div>
        {walkMin != null && (
          <div className="walk">
            walk {walkMin} min
            <br />
            board {fmtClock(row.firstBoardMs)}
          </div>
        )}
      </div>

      <div className="cmp-k">Transfer · compare</div>
      {perfect && <Route opt={perfect} now={now} best={bestId === perfect.planId} />}
      {stay && <Route opt={stay} now={now} best={bestId === stay.planId} />}
    </div>
  );
}

// crowd of the bus that carries you home (last boarded ride)
function homeCrowd(opt: PlanOption): { word: string; tone: string } | null {
  const last = [...opt.rides].reverse().find((r) => !r.alreadyAboard);
  if (!last || last.load === "UNKNOWN") return null;
  if (last.load === "SEA") return { word: "seat", tone: "" };
  if (last.load === "SDA") return { word: "standing", tone: "" };
  return { word: "packed", tone: "bad" };
}

function shortStop(name: string): string {
  return name.split("(")[0].trim();
}

type Node =
  | { k: "chip"; v: string }
  | { k: "way"; v: string }
  | { k: "wait"; v: number; tone: string }
  | { k: "walk" }
  | { k: "home"; v: string };

function buildNodes(opt: PlanOption): Node[] {
  const rides = opt.rides;
  const nodes: Node[] = [{ k: "chip", v: rides[0].service }];
  for (let i = 1; i < rides.length; i++) {
    const r: RideView = rides[i];
    if (r.alreadyAboard) {
      nodes.push({ k: "way", v: shortStop(r.alightName) });
    } else {
      if (r.waitMin > 0) nodes.push({ k: "wait", v: r.waitMin, tone: r.waitMin <= 6 ? "ok" : "warn" });
      nodes.push({ k: "chip", v: r.service });
    }
  }
  nodes.push({ k: "walk" });
  if (opt.arriveHomeMs != null) nodes.push({ k: "home", v: fmtClock(opt.arriveHomeMs) });
  return nodes;
}

function Route({ opt, now: _now, best }: { opt: PlanOption; now: number; best: boolean }) {
  const nodes = buildNodes(opt);
  const crowd = homeCrowd(opt);
  const title = opt.rides.filter((r) => !r.alreadyAboard).map((r) => r.service).join(" → ");
  return (
    <div className={`route${best ? " best" : ""}`}>
      <div className="route-top">
        <span className="route-name">{title}</span>
        <span className="route-home">
          {opt.arriveHomeMs != null ? fmtClock(opt.arriveHomeMs) : "—"}
          {crowd && <span className={`crowd ${crowd.tone}`}>{crowd.word}</span>}
        </span>
      </div>
      <div className="path">
        {nodes.map((n, i) => (
          <Fragment key={i}>
            {i > 0 && <span className="link" />}
            <NodeView n={n} />
          </Fragment>
        ))}
      </div>
    </div>
  );
}

function NodeView({ n }: { n: Node }) {
  switch (n.k) {
    case "chip":
      return <span className="chip">{n.v}</span>;
    case "way":
      return <span className="way">{n.v}</span>;
    case "wait":
      return <span className={`wait ${n.tone}`}>{n.v}m</span>;
    case "walk":
      return <span className="walk">🚶</span>;
    case "home":
      return <span className="home-pin">🏠</span>;
  }
}
