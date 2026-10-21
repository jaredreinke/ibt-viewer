/**
 * Linear interpolation of a per-sample channel onto a new x-axis.
 *
 * The two laps we compare are sampled at the same rate (60 Hz) but they
 * don't line up on the same x-axis — a faster lap covers more distance per
 * tick, so each lap has its own `dist_m` array. uPlot needs a *shared* x
 * axis to draw two series on the same chart, so one lap's channel has to
 * be resampled onto the other's distance axis.
 *
 * This implementation walks both input and output axes in lockstep, so it
 * runs in O(N+M) instead of O(N·M) — important for 5k-sample laps rendered
 * across ~8 stacked graphs at 60 fps.
 */

/**
 * Resample `y` (defined at `xSrc[i]`) onto the `xOut` axis using linear
 * interpolation. Both input axes must be monotonically non-decreasing.
 *
 * Values of `xOut` outside the source range are clamped to the nearest
 * endpoint — reasonable for our case because the two laps always cover
 * essentially the same 0-to-full-lap distance.
 */
export function linearResample(
  xSrc: readonly number[] | Float64Array,
  ySrc: readonly number[] | Float64Array,
  xOut: readonly number[] | Float64Array,
): Float64Array {
  const nSrc = xSrc.length;
  const nOut = xOut.length;
  const result = new Float64Array(nOut);

  if (nSrc === 0 || nOut === 0) return result;
  if (nSrc === 1) {
    result.fill(ySrc[0] as number);
    return result;
  }

  let i = 0; // running index into the source axis
  for (let j = 0; j < nOut; j++) {
    const x = xOut[j] as number;

    // Advance `i` until xSrc[i+1] >= x, so we bracket x between i and i+1.
    while (i < nSrc - 2 && (xSrc[i + 1] as number) < x) i++;

    const x0 = xSrc[i]     as number;
    const x1 = xSrc[i + 1] as number;
    const y0 = ySrc[i]     as number;
    const y1 = ySrc[i + 1] as number;

    if (x <= x0)      result[j] = y0;          // clamp to start
    else if (x >= x1) result[j] = y1;          // clamp to end (will only hit
                                               // on the final segment)
    else {
      const t = (x - x0) / (x1 - x0);
      result[j] = y0 + (y1 - y0) * t;
    }
  }

  return result;
}
