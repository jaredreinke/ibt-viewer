/**
 * Lap-status derivation.
 *
 * Reduces a raw `LapSummary` into a single presentation status, mirroring
 * Garage61's taxonomy. The sidecar reports orthogonal boolean flags; this
 * file picks the most-specific label to show in the lap list.
 *
 * Also identifies the fastest *clean* lap in a list so it can be badged
 * "Fastest" — a clean lap is any lap whose status is "valid".
 */

import type { LapSummary } from "@/types/telemetry";

/** Mutually-exclusive display categories, ordered by specificity. */
export type LapStatus =
  | "fastest"     // fastest clean valid lap (set by annotateLapStatuses)
  | "valid"       // clean complete timed lap
  | "outlap"      // Pit exit
  | "inlap"       // Pit entry
  | "incomplete"; // aborted mid-lap (active reset)

export interface LapWithStatus extends LapSummary {
  status: LapStatus;
}

/** Short human label per status, for badges in the lap list. */
export const STATUS_LABEL: Record<LapStatus, string> = {
  fastest:    "Fastest",
  valid:      "",           // blank — no badge for a plain valid lap
  outlap:     "Pit (out)",
  inlap:      "Pit (in)",
  incomplete: "Incomplete",
};

/** Tailwind text/border colour class per status. */
export const STATUS_CLASSNAME: Record<LapStatus, string> = {
  fastest:    "text-delta-fast",
  valid:      "text-text-primary",
  outlap:     "text-text-secondary",
  inlap:      "text-text-secondary",
  incomplete: "text-text-dim",
};

/**
 * Classify a single lap. Outlap/inlap/incomplete take precedence over
 * "valid" because any of those mean the timed comparison is meaningless.
 * The "fastest" badge is applied separately by `annotateLapStatuses` after
 * seeing the whole list.
 */
function classify(lap: LapSummary): LapStatus {
  if (lap.is_incomplete) return "incomplete";
  if (lap.is_outlap)     return "outlap";
  if (lap.is_inlap)      return "inlap";
  if (lap.valid)         return "valid";
  return "incomplete";
}

/**
 * Annotate each lap with its display status, and promote the fastest
 * valid lap to "fastest". Returns a new array — does not mutate input.
 */
export function annotateLapStatuses(laps: LapSummary[]): LapWithStatus[] {
  let fastestIndex = -1;
  let fastestTime  = Number.POSITIVE_INFINITY;

  const annotated = laps.map((lap, index) => {
    const status = classify(lap);
    if (status === "valid" && lap.lap_time > 0 && lap.lap_time < fastestTime) {
      fastestTime  = lap.lap_time;
      fastestIndex = index;
    }
    return { ...lap, status };
  });

  if (fastestIndex >= 0) {
    annotated[fastestIndex] = {
      ...annotated[fastestIndex]!,
      status: "fastest",
    };
  }

  return annotated;
}
