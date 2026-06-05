import { LOAD_DISPLAY } from "@/lib/lta/load";
import type { LoadCode } from "@/lib/engine/types";

export function CrowdBadge({ load }: { load: LoadCode }) {
  const d = LOAD_DISPLAY[load];
  return (
    <span className={`crowd ${d.tone}`} title={`Crowding: ${d.label}`}>
      <span aria-hidden>{d.icon}</span>
      {d.label}
    </span>
  );
}
