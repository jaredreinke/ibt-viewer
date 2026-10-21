/**
 * Zoom sync across all uPlot charts in the Analysis view.
 *
 * uPlot's built-in `cursor.sync.key` syncs the crosshair across charts but
 * NOT the x-axis range when the user drag-zooms. We bolt that on with a
 * small module-level registry: every chart adds itself on mount, and when
 * one of them fires its `setScale` hook for the x axis, we broadcast the
 * new range to every other registered chart.
 *
 * A single `broadcasting` guard prevents the cascading setScale calls from
 * triggering each other recursively.
 */

import type uPlot from "uplot";
import { useTelemetryStore } from "@/store/useTelemetryStore";

const registry: Set<uPlot> = new Set();
let broadcasting = false;

/**
 * Data-range reference cached from the first chart registered. Used to
 * detect when a chart's x-scale has reverted to the full data range (i.e.
 * double-click reset) so we can clear the store's zoom state and let
 * non-uPlot consumers (track map) snap back to "full lap" view.
 */
let fullRange: { min: number; max: number } | null = null;

/**
 * Return the first chart in the zoom-sync registry, or null if none are
 * registered yet. Used by non-uPlot consumers (e.g. the track map hover
 * handler) to drive the shared crosshair by calling `u.setCursor` on any
 * one chart — uPlot's built-in cursor.sync then propagates to the rest.
 */
export function getAnyRegisteredChart(): uPlot | null {
  for (const u of registry) return u;
  return null;
}

/** Add a chart to the sync group. Returns a cleanup function. */
export function registerForZoomSync(u: uPlot): () => void {
  registry.add(u);

  // Cache the full data range from the first chart (they all share the
  // target lap's dist_m as x, so any of them works). We use this to
  // detect a reset-to-auto and clear store.zoom accordingly.
  if (fullRange === null) {
    const xs = u.data[0];
    if (xs && xs.length > 0) {
      fullRange = {
        min: xs[0] as number,
        max: xs[xs.length - 1] as number,
      };
    }
  }

  return () => { registry.delete(u); };
}

/**
 * Apply the given x-range to every other chart in the registry, and push
 * it into the Zustand store so non-uPlot consumers (track map) can react.
 *
 * Called from the originating chart's `setScale` hook. The `broadcasting`
 * flag short-circuits the downstream charts' hooks so we don't loop.
 *
 * If the range equals the full data range (double-click reset / initial
 * state), the store's `zoom` is cleared to `null` to mean "show full lap".
 */
export function broadcastXScale(
  sender: uPlot,
  min:    number,
  max:    number,
): void {
  if (broadcasting) return;
  broadcasting = true;
  try {
    const eps    = 1e-6;
    const isFull =
      fullRange !== null &&
      Math.abs(min - fullRange.min) < eps &&
      Math.abs(max - fullRange.max) < eps;

    useTelemetryStore.getState().setZoom(isFull ? null : { min, max });

    for (const u of registry) {
      if (u === sender) continue;
      const curr = u.scales.x;
      if (curr.min === min && curr.max === max) continue;
      u.setScale("x", { min, max });
    }
  } finally {
    broadcasting = false;
  }
}

/**
 * Push a zoom range (or full-lap reset) to ALL registered charts and the
 * store. Used by external consumers — sector chip clicks, "Full Track"
 * button — that aren't themselves uPlot charts.
 *
 * Pass `null` to reset every chart to its full data range.
 */
export function applyZoom(range: { min: number; max: number } | null): void {
  if (broadcasting) return;
  broadcasting = true;
  try {
    useTelemetryStore.getState().setZoom(range);
    for (const u of registry) {
      if (range === null) {
        // Reset to full data extent using the cached full range.
        if (fullRange) u.setScale("x", { min: fullRange.min, max: fullRange.max });
      } else {
        u.setScale("x", { min: range.min, max: range.max });
      }
    }
  } finally {
    broadcasting = false;
  }
}
