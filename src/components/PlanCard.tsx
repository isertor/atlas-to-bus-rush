import type { PlanOption } from "@/lib/engine/board";
import { fmtClock, fmtRelative } from "@/lib/time";
import { CrowdBadge } from "./CrowdBadge";
import { ScoreBadge } from "./ScoreBadge";

interface Props {
  option: PlanOption;
  now: number;
  recommended?: boolean;
  /** "leave" shows leave-by time prominently; "arrive" emphasises arrival. */
  emphasis?: "leave" | "arrive";
}

export function PlanCard({ option, now, recommended, emphasis = "leave" }: Props) {
  if (!option.feasible) {
    return (
      <div className="card">
        <div className="top">
          <div className="label">{option.label}</div>
        </div>
        <div className="muted" style={{ marginTop: 8 }}>
          Not available — {option.reason ?? "no feasible connection"}.
        </div>
      </div>
    );
  }

  return (
    <div className={`card${recommended ? " recommended" : ""}`}>
      <div className="top">
        <div>
          {recommended && <span className="suggested">Suggested</span>}
          <div className="label">{option.label}</div>
          {option.description && <div className="desc">{option.description}</div>}
        </div>
        <ScoreBadge score={option.score} />
      </div>

      <div className="headline">
        {emphasis === "leave" && option.leaveOfficeMs != null && (
          <div className="stat">
            <div className="k">Leave by</div>
            <div className="v">{fmtClock(option.leaveOfficeMs)}</div>
          </div>
        )}
        {option.arriveHomeMs != null && (
          <div className="stat">
            <div className="k">Home ~</div>
            <div className="v">{fmtClock(option.arriveHomeMs)}</div>
          </div>
        )}
        {option.totalWaitMin > 0 && (
          <div className="stat">
            <div className="k">Waiting</div>
            <div className="v">{option.totalWaitMin}m</div>
          </div>
        )}
      </div>

      <div className="legs">
        {option.rides.map((r, i) => {
          const rideMin = Math.round((r.alightMs - r.boardMs) / 60000);
          return (
            <div className="leg" key={i}>
              <span className="svc">{r.service}</span>
              <span className="detail">
                {r.alreadyAboard ? "stay on" : "board"} {fmtClock(r.boardMs)} ({fmtRelative(r.boardMs, now)})
                <span className="ride">
                  {" · "}
                  {rideMin}m ride{" "}
                  <span className={`src ${r.rideTimeSource}`}>
                    {r.rideTimeSource === "live" ? "live" : "est"}
                  </span>
                </span>
                {r.waitMin > 0 ? <span className="wait"> · wait {r.waitMin}m</span> : null}
              </span>
              <CrowdBadge load={r.load} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
