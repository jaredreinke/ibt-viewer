/**
 * Delta-time computation.
 *
 * Produces the "delta" trace — at each distance along the target lap, how
 * far ahead (negative) or behind (positive) the target lap is compared to
 * the reference lap. This is the headline comparison any telemetry viewer
 * shows above the other channel graphs.
 *
 *     delta(distance) = target.time_at(distance) - reference.time_at(distance)
 *
 * Since the two laps are sampled at their own per-tick distance values, we
 * resample the reference's `time_in_lap` onto the target's `dist_m` axis
 * with linear interpolation, then subtract element-wise.
 */

import type { LapTelemetry } from "@/types/telemetry";
import { linearResample } from "./interpolate";

export interface DeltaSeries {
  /** Shared x-axis (same as target's dist_m). */
  x:     Float64Array;
  /** delta[i] = targetTime[i] - referenceTime[i]. Seconds. */
  delta: Float64Array;
}

/**
 * Build a per-sample delta-time series for `target` vs `reference`.
 *
 * Both arguments must have non-empty `dist_m` and `time_in_lap` channels.
 * The output `x` array matches the target's distance axis.
 */
export function computeDeltaTime(
  target:    LapTelemetry,
  reference: LapTelemetry,
): DeltaSeries {
  const x         = Float64Array.from(target.channels.dist_m);
  const timeA     = target.channels.time_in_lap;
  const timeBOnA  = linearResample(
    reference.channels.dist_m,
    reference.channels.time_in_lap,
    x,
  );

  const delta = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) {
    delta[i] = (timeA[i] as number) - (timeBOnA[i] as number);
  }

  return { x, delta };
}
