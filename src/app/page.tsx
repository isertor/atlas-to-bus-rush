"use client";

import { useCallback, useEffect, useState } from "react";
import type { RecommendResult, Mode } from "@/lib/recommend";
import { PlanCard } from "@/components/PlanCard";
import { fmtClock } from "@/lib/time";

const TABS: { mode: Mode; label: string }[] = [
  { mode: "board", label: "Leave-by" },
  { mode: "leave-now", label: "Leave now" },
  { mode: "at-transfer", label: "On the bus" },
];

export default function Page() {
  const [mode, setMode] = useState<Mode>("board");
  const [data, setData] = useState<RecommendResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (m: Mode) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/recommend?mode=${m}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  // Load on tab change, and auto-refresh every 30s.
  useEffect(() => {
    load(mode);
    const id = setInterval(() => load(mode), 30_000);
    return () => clearInterval(id);
  }, [mode, load]);

  const now = data?.now ?? Date.now();

  return (
    <main className="app">
      <header className="header">
        <h1>🚌 Bus Rush</h1>
        <div className="sub">
          {data ? `${data.origin} → ${data.destination}` : "Atlas → Home"}
          {data ? ` · updated ${fmtClock(now)}` : ""}
        </div>
      </header>

      {data?.mock && (
        <div className="mock-banner">
          Demo data — set <code>LTA_ACCOUNT_KEY</code> and <code>USE_MOCK_LTA=</code> for live arrivals.
        </div>
      )}

      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.mode} data-active={mode === t.mode} onClick={() => setMode(t.mode)}>
            {t.label}
          </button>
        ))}
      </div>

      <button className="cta" onClick={() => load(mode)} disabled={loading}>
        {loading ? "Checking…" : "Check now"}
      </button>

      {error && <div className="mock-banner">Couldn’t reach the server: {error}</div>}

      {loading && !data ? (
        <div className="spinner" />
      ) : mode === "board" ? (
        <BoardView data={data} now={now} />
      ) : (
        <OptionsView data={data} now={now} mode={mode} />
      )}
    </main>
  );
}

function BoardView({ data, now }: { data: RecommendResult | null; now: number }) {
  if (!data) return null;
  if (data.board.length === 0) {
    return <p className="muted center">No upcoming buses right now.</p>;
  }
  const w = data.departureWindow;
  return (
    <div className="stack">
      <div className="section-title">Next departures</div>
      <div className="muted">Your usual window: {w.earliest}–{w.latest}</div>
      {data.board.map((row, i) => (
        <div key={row.firstBoardMs}>
          <PlanCard option={row.best} now={now} recommended={i === 0} emphasis="leave" />
          {!row.withinWindow && (
            <div className="muted" style={{ margin: "4px 2px 0", fontSize: 12 }}>
              ⏱ outside your usual {w.earliest}–{w.latest} window
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function OptionsView({ data, now, mode }: { data: RecommendResult | null; now: number; mode: Mode }) {
  if (!data?.options) return null;
  const title = mode === "leave-now" ? "If you leave now" : "Switch early vs stay on 26";
  return (
    <div className="stack">
      <div className="section-title">{title}</div>
      {data.options.map((opt, i) => (
        <PlanCard
          key={opt.planId}
          option={opt}
          now={now}
          recommended={i === 0}
          emphasis="arrive"
        />
      ))}
    </div>
  );
}
