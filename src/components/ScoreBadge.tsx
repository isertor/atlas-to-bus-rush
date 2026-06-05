import { scoreTone } from "@/lib/engine/score";

export function ScoreBadge({ score }: { score: number }) {
  return (
    <div className={`score ${scoreTone(score)}`} title="Optimality score (0–100)">
      {score}
      <small>SCORE</small>
    </div>
  );
}
