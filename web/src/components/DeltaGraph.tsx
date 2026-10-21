import { useEffect, useMemo, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

import type { LapTelemetry } from "@/types/telemetry";
import { colors } from "@/theme/tokens";
import { computeDeltaTime } from "@/utils/delta";
import { broadcastXScale, registerForZoomSync } from "@/utils/syncZoom";
import { pushCursorToStore } from "@/utils/uplotCursor";

/**
 * Delta-time graph — the headline row in the stacked-graph view.
 *
 * Shows the running time gap between the two laps as a function of distance
 * around the circuit. Negative values (drawn below the zero line) mean the
 * target lap is ahead; positive values mean it's behind.
 *
 * Visually this is taller than the other channel rows and uses a purple
 * neon palette (with a fill underneath the trace) to match Coach Dave
 * Delta's treatment of the delta signal.
 */
interface DeltaGraphProps {
  telA:   LapTelemetry;
  telB:   LapTelemetry;
  /** Row height in pixels. Delta is intentionally taller than other rows. */
  height?: number;
}

export default function DeltaGraph({ telA, telB, height = 130 }: DeltaGraphProps) {
  const hostRef  = useRef<HTMLDivElement>(null);
  const badgeRef = useRef<HTMLDivElement>(null);
  const plotRef  = useRef<uPlot | null>(null);

  // Compute the delta series once per telemetry pair. Float64Array inputs
  // keep downstream uPlot allocations minimal.
  const aligned = useMemo(() => {
    const { x, delta } = computeDeltaTime(telA, telB);
    return [x, delta] as uPlot.AlignedData;
  }, [telA, telB]);

  // Symmetric y-range so the zero line sits in the middle of the plot —
  // visually emphasizes "above = losing time" vs "below = gaining".
  const yBound = useMemo(() => {
    let max = 0;
    for (let i = 0; i < aligned[1]!.length; i++) {
      const v = Math.abs(aligned[1]![i] as number);
      if (v > max) max = v;
    }
    // Round up to the nearest 0.1 s for a tidy scale; minimum of 0.3 s so a
    // very close lap pair still has a bit of vertical air.
    return Math.max(0.3, Math.ceil(max * 10) / 10);
  }, [aligned]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const opts: uPlot.Options = {
      width:  host.clientWidth,
      height,
      legend:  { show: false },
      padding: [8, 10, 8, 10],
      scales: {
        x: { time: false },
        // Symmetric, zero-centered y-scale.
        y: {
          auto:  false,
          range: [-yBound, yBound],
        },
      },
      axes: [
        {
          show:   false,
          stroke: colors["text-dim"],
          grid:   { stroke: colors.border, width: 1 },
        },
        {
          stroke: colors["text-dim"],
          grid:   { stroke: colors.border, width: 1 },
          ticks:  { stroke: colors.border, width: 1 },
          size:   44,
          font:   "10px Inter, system-ui, sans-serif",
          values: (_u, splits) => splits.map((v) => (v > 0 ? "+" : "") + v.toFixed(2)),
        },
      ],
      series: [
        { label: "dist" },
        {
          label:  "Delta",
          stroke: colors.delta,
          width:  1.3,
          points: { show: false },
        },
      ],
      cursor: {
        sync: { key: "ibt-viewer" },
        drag: { x: true, y: false },
        // Vertical crosshair only.
        y: false,
      },
      hooks: {
        setCursor: [
          (u) => {
            pushCursorToStore(u);
            renderDeltaBadge(u, badgeRef.current);
          },
        ],
        // Propagate drag-zoom and double-click reset to the other charts.
        setScale: [
          (u, scaleKey) => {
            if (scaleKey !== "x") return;
            const { min, max } = u.scales.x;
            if (min != null && max != null) broadcastXScale(u, min, max);
          },
        ],
        // Draw a horizontal reference line at delta = 0 so you always
        // know which side is gain vs loss.
        draw: [
          (u) => {
            const ctx = u.ctx;
            const y0  = u.valToPos(0, "y", true);
            ctx.save();
            ctx.strokeStyle = colors.border;
            ctx.lineWidth   = 1;
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.moveTo(u.bbox.left, y0);
            ctx.lineTo(u.bbox.left + u.bbox.width, y0);
            ctx.stroke();
            ctx.restore();
          },
        ],
      },
    };

    plotRef.current = new uPlot(opts, aligned, host);
    const unregister = registerForZoomSync(plotRef.current);

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry && plotRef.current) {
        plotRef.current.setSize({
          width:  entry.contentRect.width,
          height,
        });
      }
    });
    observer.observe(host);

    return () => {
      observer.disconnect();
      unregister();
      plotRef.current?.destroy();
      plotRef.current = null;
    };
  }, [aligned, yBound, height]);

  return (
    <div className="flex h-full items-stretch">
      {/* Left label column — bolder than channel rows because delta is primary. */}
      <div className="flex w-24 shrink-0 flex-col justify-center border-r border-border px-3">
        <div className="text-[12px] font-bold uppercase tracking-wider text-delta">
          DELTA
        </div>
        <div className="text-[10px] text-text-dim">seconds</div>
      </div>
      <div className="relative flex-1" style={{ height }}>
        <div ref={hostRef} className="h-full w-full" />
        <div
          ref={badgeRef}
          className="pointer-events-none absolute hidden rounded border border-border bg-panel/95 px-1.5 py-0.5 text-[11px] font-bold tabular-nums shadow-lg"
          style={{ whiteSpace: "nowrap" }}
        />
      </div>
    </div>
  );
}

/**
 * Render the delta badge next to the cursor with a sign-coloured value.
 * Negative = target ahead (green); positive = target behind (red); zero
 * sticks to the neutral purple.
 */
function renderDeltaBadge(u: uPlot, badge: HTMLDivElement | null): void {
  if (!badge) return;

  const idx = u.cursor.idx;
  if (idx == null) {
    badge.style.display = "none";
    return;
  }

  const v = (u.data[1] as number[] | undefined)?.[idx];
  if (v == null || Number.isNaN(v)) {
    badge.style.display = "none";
    return;
  }

  const sign  = v < 0 ? "-" : v > 0 ? "+" : "";
  const text  = `${sign}${Math.abs(v).toFixed(3)}s`;
  const color =
    v < -0.02 ? colors["delta-fast"] :
    v >  0.02 ? colors["delta-slow"] : colors.delta;

  badge.textContent   = text;
  badge.style.color   = color;
  badge.style.left    = `${Math.max(0, (u.cursor.left ?? 0) + 8)}px`;
  badge.style.top     = `${Math.max(2, u.valToPos(v, "y") - 20)}px`;
  badge.style.display = "block";
}
