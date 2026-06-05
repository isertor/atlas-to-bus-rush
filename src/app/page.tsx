"use client";

import { useCallback, useEffect, useState } from "react";
import type { PlanOption, RideView } from "@/lib/engine/board";
import type { RecommendResult } from "@/lib/recommend";
import { LOAD_DISPLAY } from "@/lib/lta/load";
import { fmtClock, minutesFromNow } from "@/lib/time";

export default function Page() {
  const [data, setData] = useState<RecommendResult | null>(null);
  const [loading, setLoading] = useState(false);

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
  const top = rows[0];
  const best = top?.best;
  const alt = top?.options.find((o) => o.planId !== best?.planId && o.feasible);
  const later = rows.slice(1, 3).map((r) => r.leaveOfficeMs).filter((x): x is number => x != null);

  return (
    <main className="wrap">
      <div className="topbar">
        <span className="brand">🚌 Bus Rush</span>
        <button className="refresh" data-spin={loading} onClick={load} aria-label="Refresh">
          ↻
        </button>
      </div>

      {!data && loading ? (
        <div className="spinner" />
      ) : !best || best.leaveOfficeMs == null ? (
        <div className="empty">No buses right now.</div>
      ) : (
        <>
          <Hero leaveOfficeMs={best.leaveOfficeMs} arriveHomeMs={best.arriveHomeMs} now={now} />

          <div className="label">Your ride</div>
          <div className="group">
            {best.rides.map((r, i) => (
              <RideRow key={i} ride={r} />
            ))}
            {best.arriveHomeMs != null && (
              <div className="row home">
                <span className="lead">🏠</span>
                <span className="main">Home</span>
                <span className="time">{fmtClock(best.arriveHomeMs)}</span>
              </div>
            )}
          </div>

          {alt && alt.arriveHomeMs != null && <Alternative alt={alt} />}

          {later.length > 0 && (
            <div className="later">
              Later&nbsp;&nbsp;
              {later.map((ms, i) => (
                <span key={ms}>
                  {i > 0 ? " · " : ""}
                  <b>{fmtClock(ms)}</b>
                </span>
              ))}
            </div>
          )}
        </>
      )}

      <div className="footer">
        {data?.mock ? "Demo data · add an LTA key for live arrivals" : `Updated ${fmtClock(now)}`}
      </div>
    </main>
  );
}

function Hero({
  leaveOfficeMs,
  arriveHomeMs,
  now,
}: {
  leaveOfficeMs: number;
  arriveHomeMs: number | null;
  now: number;
}) {
  const mins = minutesFromNow(leaveOfficeMs, now);
  const isNow = mins <= 0;
  return (
    <div className={`hero${isNow ? " now" : ""}`}>
      <div className="hero-label">{isNow ? "Leave" : "Leave in"}</div>
      <div className="hero-num">
        {isNow ? "now" : <>{mins}<span className="unit">min</span></>}
      </div>
      <div className="hero-sub">
        leave by {fmtClock(leaveOfficeMs)}
        {arriveHomeMs != null ? ` · home by ${fmtClock(arriveHomeMs)}` : ""}
      </div>
    </div>
  );
}

function RideRow({ ride }: { ride: RideView }) {
  const d = LOAD_DISPLAY[ride.load];
  return (
    <div className="row">
      <span className="lead">
        <span className="svc">{ride.service}</span>
      </span>
      <div className="main">
        {ride.alreadyAboard ? "Stay on" : "Board"}
        <div className="meta">{fmtClock(ride.boardMs)}</div>
      </div>
      {ride.load !== "UNKNOWN" && (
        <span className="crowd">
          <span className={`dot ${d.tone}`} />
          {d.label}
        </span>
      )}
    </div>
  );
}

function Alternative({ alt }: { alt: PlanOption }) {
  return (
    <>
      <div className="label">Or stay on 21</div>
      <div className="alt">
        <div>
          <div className="t">First bus at Eunos</div>
          <div className="s">
            {alt.totalWaitMin > 0 ? `~${alt.totalWaitMin}m wait` : "little wait"} · longer walk home
          </div>
        </div>
        <div className="home">{fmtClock(alt.arriveHomeMs as number)}</div>
      </div>
    </>
  );
}
