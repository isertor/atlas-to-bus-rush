import type { LoadCode } from "@/lib/engine/types";

/** Normalise LTA's raw Load string into our LoadCode. */
export function parseLoad(raw: string | undefined): LoadCode {
  switch (raw) {
    case "SEA":
    case "SDA":
    case "LSD":
      return raw;
    default:
      return "UNKNOWN";
  }
}

export interface LoadDisplay {
  label: string;
  /** Short emoji/symbol for compact phone UI. */
  icon: string;
  /** Tailwind-free semantic tone used by CSS classes. */
  tone: "good" | "warn" | "bad" | "unknown";
}

export const LOAD_DISPLAY: Record<LoadCode, LoadDisplay> = {
  SEA: { label: "Seats", icon: "🟢", tone: "good" },
  SDA: { label: "Standing", icon: "🟠", tone: "warn" },
  LSD: { label: "Packed", icon: "🔴", tone: "bad" },
  UNKNOWN: { label: "—", icon: "⚪", tone: "unknown" },
};
