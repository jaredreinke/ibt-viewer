/**
 * Shared uPlot cursor helpers.
 *
 * The stacked-graph view has many uPlot instances that share one logical
 * crosshair. uPlot handles the intra-chart sync automatically via its
 * `cursor.sync.key` option — this helper is the glue that pushes the
 * current cursor's logical position (LapDistPct) AND viewport position
 * (pixels) into the Zustand store, so non-uPlot consumers — the hover
 * tooltip, the track map dot — can react to cursor movement.
 */

import type uPlot from "uplot";
import { useTelemetryStore } from "@/store/useTelemetryStore";

/**
 * uPlot `setCursor` hook: converts the current cursor's x-value (distance
 * in metres along the target lap) into LapDistPct (0 – 1) and writes it
 * into the store, along with viewport-relative mouse coordinates that the
 * floating tooltip needs.
 *
 * When the cursor leaves the chart, uPlot sets `cursor.idx` to null — we
 * treat that as "hover ended" and clear the active flag so the tooltip
 * disappears.
 */
export function pushCursorToStore(u: uPlot): void {
  const idx = u.cursor.idx;

  if (idx == null) {
    useTelemetryStore.getState().clearCursor();
    return;
  }

  const xs = u.data[0];
  if (!xs || xs.length === 0) return;

  const x    = xs[idx] as number;
  const xMax = xs[xs.length - 1] as number;
  const pct  = xMax > 0 ? x / xMax : 0;

  // `u.over` is the transparent DOM layer uPlot overlays on top of its
  // canvas for pointer events. Its bounding rect + cursor.left/top gives
  // us the viewport pixel position we need for tooltip placement.
  const rect = u.over.getBoundingClientRect();
  const px   = rect.left + (u.cursor.left ?? 0);
  const py   = rect.top  + (u.cursor.top  ?? 0);

  useTelemetryStore.getState().setCursor({
    pct,
    x:      px,
    y:      py,
    active: true,
  });
}
