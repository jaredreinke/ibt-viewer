import { useEffect, useMemo, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

import type { LapChannels, LapTelemetry } from "@/types/telemetry";
import { colors } from "@/theme/tokens";
import { linearResample } from "@/utils/interpolate";
import { broadcastXScale, registerForZoomSync } from "@/utils/syncZoom";
import { pushCursorToStore } from "@/utils/uplotCursor";

/**
 * A single stacked-graph row: one telemetry channel, two laps overlaid.
 *
 * The target lap renders as a solid line; the reference lap as a dashed
 * line of the same hue but slightly thinner and muted. Both series share
 * the target lap's `dist_m` as the x-axis, with the reference lap linearly
 * resampled onto it.
 *
 * On hover, a small value pill appears at the cursor showing the target
 * lap's value at that position (colour-matched to the channel). Clicking
 * anywhere on the graph freezes the crosshair in place — a second click
 * unfreezes. This uses uPlot's native `cursor.lock`, which also syncs the
 * locked state across every chart that shares the same cursor.sync key.
 *
 * This component is deliberately channel-agnostic: pass a `channel` key
 * and a `color`, and it handles the rest. That keeps adding a new row a
 * one-liner in the parent.
 */

/** Keys of LapChannels that hold `number[]` (filters out tire_temps etc.). */
type NumericChannel = {
  [K in keyof LapChannels]: LapChannels[K] extends number[] ? K : never;
}[keyof LapChannels];

interface ChannelGraphProps {
  /** Label shown along the left edge, uppercase tracked (e.g. "SPEED"). */
  label:     string;
  /** Unit suffix shown inside the hover badge (e.g. "km/h"). */
  unit?:     string;
  /** Which channel to plot — must be a numeric array channel on LapChannels. */
  channel:   NumericChannel;
  /** Reference / comparison lap hue — used for the solid reference trace
   *  and in the hover badge. The target trace is always dashed yellow. */
  color:     string;
  /** Target lap telemetry (yellow dashed trace). */
  telA:      LapTelemetry;
  /** Reference lap telemetry (solid channel-coloured trace). */
  telB:      LapTelemetry;
  /** Row height in pixels. */
  height?:   number;
  /**
   * How to format the channel's numeric value for the hover badge.
   * Defaults to a rounded integer — most channels look cleanest that way
   * (speed, throttle, RPM, gear). Pass a custom formatter for finer
   * precision when needed.
   */
  format?:   (value: number) => string;
}

export default function ChannelGraph({
  label,
  unit,
  channel,
  color,
  telA,
  telB,
  height = 90,
  format = (v: number) => v.toFixed(0),
}: ChannelGraphProps) {
  const hostRef  = useRef<HTMLDivElement>(null);
  const badgeRef = useRef<HTMLDivElement>(null);
  const plotRef  = useRef<uPlot | null>(null);

  // Align the reference lap to the target lap's distance axis once per data
  // change. useMemo keeps the computed arrays stable so uPlot only rebuilds
  // when the inputs actually differ.
  const aligned = useMemo(() => {
    const x  = Float64Array.from(telA.channels.dist_m);
    const yA = Float64Array.from(telA.channels[channel] as number[]);
    const yB = linearResample(
      telB.channels.dist_m,
      telB.channels[channel] as number[],
      x,
    );
    return [x, yA, yB] as uPlot.AlignedData;
  }, [telA, telB, channel]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const opts: uPlot.Options = {
      width:  host.clientWidth,
      height,
      legend:  { show: false },
      padding: [6, 10, 6, 10],
      scales: {
        x: { time: false },
        y: { auto: true },
      },
      axes: [
        {
          show: false,
          stroke: colors["text-dim"],
          grid:   { stroke: colors.border, width: 1 },
          ticks:  { stroke: colors.border, width: 1 },
        },
        {
          stroke: colors["text-dim"],
          grid:   { stroke: colors.border, width: 1 },
          ticks:  { stroke: colors.border, width: 1 },
          size:   44,
          font:   "10px Inter, system-ui, sans-serif",
        },
      ],
      series: [
        { label: "dist" },
        // Target lap — always dashed yellow, regardless of channel, so the
        // two laps are visually distinct at a glance on every graph.
        { label: "Target",    stroke: colors.target, width: 1,   dash: [5, 4], points: { show: false } },
        // Reference lap — solid, in the channel's own hue.
        { label: "Reference", stroke: color,         width: 1.3,               points: { show: false } },
      ],
      cursor: {
        sync: { key: "ibt-viewer" },
        drag: { x: true, y: false },
        // Vertical crosshair only — horizontal line added visual noise.
        y: false,
        // `focus` is intentionally off — when enabled, uPlot dims the
        // non-hovered series, which made the two traces hard to compare.
      },
      hooks: {
        setCursor: [
          (u) => {
            pushCursorToStore(u);
            renderBadge(u, badgeRef.current, color, unit, format);
          },
        ],
        // When the user drag-zooms or double-clicks this chart, propagate
        // the new x-range to every other chart in the sync group.
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

    // Keep uPlot sized to its container — the host div is grid-sized by
    // the parent, so we observe it for resize and forward to setSize.
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
  }, [aligned, color, height, unit, format]);

  return (
    <div className="flex h-full items-stretch">
      {/* Left label column, Coach Dave style: channel name over unit. */}
      <div className="flex w-24 shrink-0 flex-col justify-center border-r border-border px-3">
        <div
          className="text-[11px] font-semibold uppercase tracking-wider"
          style={{ color }}
        >
          {label}
        </div>
        {unit && (
          <div className="text-[10px] text-text-dim">{unit}</div>
        )}
      </div>

      {/* Plot host — uPlot writes into this div. The badge is a sibling
          positioned absolutely over the plot at the cursor intersection
          and shows both laps' values at the current x. */}
      <div className="relative flex-1" style={{ height }}>
        <div ref={hostRef} className="h-full w-full" />
        <div
          ref={badgeRef}
          className="pointer-events-none absolute hidden rounded border border-border bg-panel/95 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums leading-tight shadow-lg"
          style={{ whiteSpace: "nowrap" }}
        />
      </div>
    </div>
  );
}

/**
 * Position and fill the hover badge based on uPlot's current cursor state.
 *
 * The badge shows two rows — target lap (yellow, matching the dashed
 * trace) on top, reference lap (channel colour, matching the solid trace)
 * below. Directly manipulates the badge's inline HTML/style so it keeps
 * up with 60 Hz mouse moves without re-rendering the React tree.
 */
function renderBadge(
  u:        uPlot,
  badge:    HTMLDivElement | null,
  refColor: string,
  unit:     string | undefined,
  format:   (v: number) => string,
): void {
  if (!badge) return;

  const idx = u.cursor.idx;
  if (idx == null) {
    badge.style.display = "none";
    return;
  }

  const yA = (u.data[1] as number[] | undefined)?.[idx];   // target
  const yB = (u.data[2] as number[] | undefined)?.[idx];   // reference
  if (yA == null || yB == null || Number.isNaN(yA) || Number.isNaN(yB)) {
    badge.style.display = "none";
    return;
  }

  const suffix = unit ? ` ${unit}` : "";
  badge.innerHTML = (
    `<div style="color:${colors.target}">${format(yA)}${suffix}</div>` +
    `<div style="color:${refColor}">${format(yB)}${suffix}</div>`
  );

  // Anchor the badge slightly right of the cursor, vertically centred on
  // the midpoint between the two series values so it doesn't cover either
  // line. Clamp to keep it inside the plot.
  const midY = u.valToPos((yA + yB) / 2, "y");
  const xPx  = (u.cursor.left ?? 0) + 8;
  const yPx  = midY - 18;

  badge.style.left    = `${Math.max(0, xPx)}px`;
  badge.style.top     = `${Math.max(2, yPx)}px`;
  badge.style.display = "block";
}
