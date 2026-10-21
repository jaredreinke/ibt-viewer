import { useEffect, useMemo, useRef } from "react";
import uPlot from "uplot";

import type { LapTelemetry, TireTempChannels } from "@/types/telemetry";
import { colors } from "@/theme/tokens";
import { linearResample } from "@/utils/interpolate";
import { broadcastXScale, registerForZoomSync } from "@/utils/syncZoom";
import { pushCursorToStore } from "@/utils/uplotCursor";

/**
 * Tire-temperature graph for one corner of the car (LF / RF / LR / RR).
 *
 * Shows the three tread temperatures — inner, mid, outer — across the lap
 * for both the target (dashed) and reference (solid) laps.
 *
 * The IN / MID / OUT legend chips are clickable toggles that show/hide the
 * corresponding pair of series (target + reference) simultaneously.
 *
 * All four corners share the same cursor sync key as the main stacked
 * graphs. Hovering a tire graph moves the track-map dot and crosshairs.
 */
export type Corner = "lf" | "rf" | "lr" | "rr";
export type Edge = "inner" | "mid" | "outer";

const CORNER_LABEL: Record<Corner, string> = {
  lf: "LF", rf: "RF", lr: "LR", rr: "RR",
};

// Series indices inside uPlot (0 = x / dist):
// 1 = target inner, 2 = target mid, 3 = target outer
// 4 = ref    inner, 5 = ref    mid, 6 = ref    outer
const EDGE_ORDER: Edge[] = ["inner", "mid", "outer"];

interface TireTempGraphProps {
  corner:        Corner;
  telA:          LapTelemetry;
  telB:          LapTelemetry;
  visibleEdges:  Set<Edge>;
  onToggleEdge:  (edge: Edge) => void;
  height?:       number;
}

export default function TireTempGraph({ corner, telA, telB, visibleEdges, onToggleEdge, height = 120 }: TireTempGraphProps) {
  const hostRef  = useRef<HTMLDivElement>(null);
  const badgeRef = useRef<HTMLDivElement>(null);
  const plotRef  = useRef<uPlot | null>(null);

  // Mirror visibleEdges into a ref so the setCursor closure is never stale.
  const visibleEdgesRef = useRef(visibleEdges);
  useEffect(() => { visibleEdgesRef.current = visibleEdges; }, [visibleEdges]);

  // Shared x-axis = target lap's distance, reference lap resampled onto it.
  const aligned = useMemo(() => {
    const x  = Float64Array.from(telA.channels.dist_m);
    const a  = telA.channels.tire_temps[corner] as TireTempChannels;
    const b  = telB.channels.tire_temps[corner] as TireTempChannels;
    const xB = telB.channels.dist_m;

    return [
      x,
      Float64Array.from(a.inner),
      Float64Array.from(a.mid),
      Float64Array.from(a.outer),
      linearResample(xB, b.inner, x),
      linearResample(xB, b.mid,   x),
      linearResample(xB, b.outer, x),
    ] as uPlot.AlignedData;
  }, [telA, telB, corner]);

  // Create / recreate the uPlot instance whenever the data changes.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const opts: uPlot.Options = {
      width:  host.clientWidth,
      height,
      legend: { show: false },
      padding: [8, 6, 4, 6],
      scales: {
        x: { time: false },
        y: { auto: true },
      },
      axes: [
        {
          show: false,
          stroke: colors["text-dim"],
          grid:   { stroke: colors.border, width: 1 },
        },
        {
          stroke: colors["text-dim"],
          grid:   { stroke: colors.border, width: 1 },
          ticks:  { stroke: colors.border, width: 1 },
          size:   34,
          font:   "10px Inter, system-ui, sans-serif",
        },
      ],
      series: [
        { label: "dist" },
        // Target lap — dashed, per-tread-edge colour
        { label: "inner",     stroke: colors["tire-inner"], width: 0.9, dash: [3, 3], points: { show: false }, show: visibleEdgesRef.current.has("inner") },
        { label: "mid",       stroke: colors["tire-mid"],   width: 0.9, dash: [3, 3], points: { show: false }, show: visibleEdgesRef.current.has("mid")   },
        { label: "outer",     stroke: colors["tire-outer"], width: 0.9, dash: [3, 3], points: { show: false }, show: visibleEdgesRef.current.has("outer") },
        // Reference lap — solid, same hues
        { label: "inner ref", stroke: colors["tire-inner"], width: 1.3, points: { show: false }, show: visibleEdgesRef.current.has("inner") },
        { label: "mid ref",   stroke: colors["tire-mid"],   width: 1.3, points: { show: false }, show: visibleEdgesRef.current.has("mid")   },
        { label: "outer ref", stroke: colors["tire-outer"], width: 1.3, points: { show: false }, show: visibleEdgesRef.current.has("outer") },
      ],
      cursor: {
        sync: { key: "ibt-viewer" },
        drag: { x: true, y: false },
        y:    false,
      },
      hooks: {
        setCursor: [
          (u) => {
            pushCursorToStore(u);
            renderBadge(u, badgeRef.current, visibleEdgesRef.current);
          },
        ],
        setScale: [
          (u, scaleKey) => {
            if (scaleKey !== "x") return;
            const { min, max } = u.scales.x;
            if (min != null && max != null) broadcastXScale(u, min, max);
          },
        ],
      },
    };

    plotRef.current = new uPlot(opts, aligned, host);
    const unregister = registerForZoomSync(plotRef.current);

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry && plotRef.current) {
        plotRef.current.setSize({ width: entry.contentRect.width, height });
      }
    });
    observer.observe(host);

    return () => {
      observer.disconnect();
      unregister();
      plotRef.current?.destroy();
      plotRef.current = null;
    };
  }, [aligned, height]);

  // Apply edge visibility changes without rebuilding the plot.
  useEffect(() => {
    const u = plotRef.current;
    if (!u) return;
    EDGE_ORDER.forEach((edge, i) => {
      const show = visibleEdges.has(edge);
      u.setSeries(i + 1, { show }); // target: indices 1-3
      u.setSeries(i + 4, { show }); // ref:    indices 4-6
    });
  }, [visibleEdges]);

  return (
    <div className="flex h-full flex-col rounded-md border border-border bg-raised">
      {/* Header: corner label + clickable IN/MID/OUT legend chips. */}
      <div className="flex shrink-0 items-center justify-between border-b border-border px-2 py-1 text-[10px] uppercase tracking-wider">
        <span className="font-semibold text-text-secondary">{CORNER_LABEL[corner]}</span>
        <div className="flex items-center gap-2 text-text-dim">
          <LegendChip color={colors["tire-inner"]} label="in"  active={visibleEdges.has("inner")} onToggle={() => onToggleEdge("inner")} />
          <LegendChip color={colors["tire-mid"]}   label="mid" active={visibleEdges.has("mid")}   onToggle={() => onToggleEdge("mid")}   />
          <LegendChip color={colors["tire-outer"]} label="out" active={visibleEdges.has("outer")} onToggle={() => onToggleEdge("outer")} />
        </div>
      </div>
      <div className="relative flex-1">
        <div ref={hostRef} className="h-full w-full" style={{ height }} />
        {/* Hover badge: shows IN / MID / OUT temps for both laps. */}
        <div
          ref={badgeRef}
          className="pointer-events-none absolute hidden rounded border border-border bg-panel/95 px-1.5 py-1 text-[10px] tabular-nums shadow-lg"
          style={{ whiteSpace: "nowrap" }}
        />
      </div>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Clickable legend chip — coloured dot + label. Dims when the series is off.
 */
function LegendChip({
  color, label, active, onToggle,
}: {
  color:    string;
  label:    string;
  active:   boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className="flex cursor-pointer select-none items-center gap-1 transition-opacity"
      style={{ opacity: active ? 1 : 0.35 }}
      title={active ? `Hide ${label}` : `Show ${label}`}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
      <span>{label}</span>
    </button>
  );
}

/**
 * Position and fill the hover badge with IN / MID / OUT temps for both laps.
 * Only shows rows for currently-visible edges. Manipulates the DOM directly
 * to keep up with 60 Hz cursor moves without re-rendering the React tree.
 */
function renderBadge(
  u:            uPlot,
  badge:        HTMLDivElement | null,
  visibleEdges: Set<Edge>,
): void {
  if (!badge) return;

  const idx = u.cursor.idx;
  if (idx == null) {
    badge.style.display = "none";
    return;
  }

  const rows: string[] = [];
  const edgeMeta: { edge: Edge; label: string; color: string; tIdx: number; rIdx: number }[] = [
    { edge: "inner", label: "IN",  color: colors["tire-inner"], tIdx: 1, rIdx: 4 },
    { edge: "mid",   label: "MID", color: colors["tire-mid"],   tIdx: 2, rIdx: 5 },
    { edge: "outer", label: "OUT", color: colors["tire-outer"], tIdx: 3, rIdx: 6 },
  ];

  for (const { edge, label, color, tIdx, rIdx } of edgeMeta) {
    if (!visibleEdges.has(edge)) continue;
    const tVal = (u.data[tIdx] as number[] | undefined)?.[idx];
    const rVal = (u.data[rIdx] as number[] | undefined)?.[idx];
    if (tVal == null || rVal == null) continue;
    rows.push(
      `<div class="flex items-center gap-1.5">` +
        `<span style="color:${color};min-width:2.4em">${label}</span>` +
        `<span style="color:${colors.target}">${tVal.toFixed(1)}°</span>` +
        `<span style="color:${colors["text-dim"]}">·</span>` +
        `<span style="color:${color}">${rVal.toFixed(1)}°</span>` +
      `</div>`,
    );
  }

  if (rows.length === 0) {
    badge.style.display = "none";
    return;
  }

  badge.innerHTML = rows.join("");

  const xPx = (u.cursor.left ?? 0) + 10;
  const yPx = 8;
  badge.style.left    = `${Math.max(0, xPx)}px`;
  badge.style.top     = `${yPx}px`;
  badge.style.display = "block";
}
