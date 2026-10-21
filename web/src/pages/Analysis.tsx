import { useMemo, useState, useCallback } from "react";
import ChannelGraph from "@/components/ChannelGraph";
import DeltaGraph from "@/components/DeltaGraph";
import Panel from "@/components/Panel";
import TireTempGraph, { type Corner, type Edge } from "@/components/TireTempGraph";
import TrackMap from "@/components/TrackMap";
import { useTelemetryStore } from "@/store/useTelemetryStore";
import { colors } from "@/theme/tokens";
import type { LapChannels, LapTelemetry, ParseIbtResponse } from "@/types/telemetry";
import { formatLapTime } from "@/utils/formatLapTime";
import { computeMiniSectors, type MiniSector } from "@/utils/miniSectors";
import { applyZoom } from "@/utils/syncZoom";

/**
 * Main analysis screen — three-column layout.
 *
 * This file is post-hoc analysis only — there is no live iRacing data, no
 * streaming values. Everything shown here is read from the two IBT files
 * the user picked on the previous screen. Any "at cursor" readouts later
 * will read values from the stored arrays at the cursor position.
 *
 *   top bar:  sector / corner scroll strip (coming soon)
 *   left:     session info, lap list, large track map (which also serves
 *             as the cursor position indicator — no separate mini map)
 *   centre:   stacked per-channel graphs (distance x-axis, both laps)
 *   right:    delta-at-cursor + future channel toggles / sector times
 */
interface AnalysisProps {
  onBack: () => void;
}

export default function Analysis({ onBack }: AnalysisProps) {
  const slotA  = useTelemetryStore((s) => s.slotA);
  const slotB  = useTelemetryStore((s) => s.slotB);

  // Shared sort state: when true, sectors are ordered biggest loss → smallest.
  const [sortByLoss, setSortByLoss] = useState(false);
  const toggleSort = useCallback(() => setSortByLoss((v) => !v), []);

  if (!slotA.telemetry || !slotB.telemetry || !slotA.source || !slotB.source) {
    return (
      <div className="flex h-full items-center justify-center text-text-secondary">
        Telemetry missing — returning to selector…
      </div>
    );
  }

  // eslint-disable-next-line react-hooks/rules-of-hooks
  const sectors = useMemo(
    () => computeMiniSectors(slotA.telemetry!, slotB.telemetry!),
    [slotA.telemetry, slotB.telemetry],
  );

  return (
    <div className="flex h-full w-full flex-col">
      <TopBar
        targetTime={slotA.telemetry.lap_time}
        refTime={slotB.telemetry.lap_time}
        sectors={sectors}
        sortByLoss={sortByLoss}
        onToggleSort={toggleSort}
        onSelectSector={(s) => applyZoom(s ? { min: s.zoomStart, max: s.zoomEnd } : null)}
      />

      <div className="grid flex-1 grid-cols-[360px_1fr] gap-2 overflow-hidden p-2">
        {/* Left column: pinned. min-h-0 lets the grid track constrain height. */}
        <LeftPanel onBack={onBack} sectors={sectors} sortByLoss={sortByLoss} onToggleSort={toggleSort} />

        {/* Centre column scrolls vertically. min-h-0 + min-w-0 are required
            for overflow to activate inside a grid track — grid items default
            to min-width/height: auto which lets them blow past their track. */}
        <div className="min-h-0 min-w-0 overflow-x-hidden overflow-y-auto pr-1">
          <CenterPanel telA={slotA.telemetry} telB={slotB.telemetry} />
        </div>
      </div>
    </div>
  );
}

// ─── Top bar: sector strip ─────────────────────────────────────────────────

interface TopBarProps {
  targetTime:     number;
  refTime:        number;
  sectors:        MiniSector[];
  sortByLoss:     boolean;
  onToggleSort:   () => void;
  onSelectSector: (s: MiniSector | null) => void;
}

function TopBar({ targetTime, refTime, sectors, sortByLoss, onToggleSort, onSelectSector }: TopBarProps) {
  const [activeSector, setActiveSector] = useState<string | null>(null);

  function handleSelect(s: MiniSector) {
    if (activeSector === s.id) {
      setActiveSector(null);
      onSelectSector(null);
    } else {
      setActiveSector(s.id);
      onSelectSector(s);
    }
  }

  function handleLap() {
    setActiveSector(null);
    onSelectSector(null);
  }

  const fullDelta = targetTime - refTime;
  const faster = fullDelta < 0;
  const slower = fullDelta > 0;

  // When sorted, show sectors biggest loss first (most positive delta first).
  const displaySectors = sortByLoss
    ? [...sectors].sort((a, b) => a.delta - b.delta)
    : sectors;

  return (
    <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3" style={{ borderBottomColor: colors.border, background: colors.panel }}>
      {/* Sort button — toggles sector order by biggest loss. */}
      <button
        onClick={onToggleSort}
        title={sortByLoss ? "Showing biggest losses first — click to restore order" : "Sort by biggest loss"}
        className={`shrink-0 flex items-center justify-center rounded-md border p-1.5 transition-colors ${
          sortByLoss
            ? "border-accent bg-accent/20 text-accent"
            : "border-border bg-transparent text-text-dim hover:text-text-secondary"
        }`}
        style={sortByLoss ? { borderColor: colors.accent } : {}}
      >
        <IconSort />
      </button>

      {/* Lap button — always shown, clears zoom back to full lap. */}
      <button
        onClick={handleLap}
        className={`shrink-0 flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[13px] font-bold uppercase tracking-wider transition-colors ${
          activeSector === null
            ? "border-text-dim bg-raised text-text-primary"
            : "border-border bg-transparent text-text-dim hover:text-text-secondary"
        }`}
      >
        Lap
        <span
          className="tabular-nums"
          style={{ color: faster ? colors["delta-slow"] : slower ? colors["delta-fast"] : colors["text-dim"] }}
        >
          {formatSectorDelta(fullDelta)}
        </span>
      </button>

      {/* Scrollable sector strip. */}
      <div className="flex flex-1 items-center gap-1 overflow-x-auto scrollbar-none">
        {displaySectors.map((s) => (
          <SectorChip
            key={s.id}
            sector={s}
            active={activeSector === s.id}
            onClick={() => handleSelect(s)}
          />
        ))}
      </div>
    </div>
  );
}

/** One sector chip: label + delta, with a coloured background matching the Gaps table. */
function SectorChip({
  sector, active, onClick,
}: { sector: MiniSector; active: boolean; onClick: () => void }) {
  const faster  = sector.delta < -0.0005;
  const slower  = sector.delta > 0.0005;
  const deltaColor = faster ? colors["delta-slow"] : slower ? colors["delta-fast"] : colors["text-dim"];
  const deltaBg    = faster ? `${colors["delta-slow"]}22` : slower ? `${colors["delta-fast"]}22` : "transparent";
  const deltaStr   = formatSectorDelta(sector.delta);

  return (
    <button
      onClick={onClick}
      className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-0.5 text-[13px] font-bold transition-all"
      style={{
        backgroundColor: active ? "rgba(255,255,255,0.08)" : deltaBg,
        outline: active ? "1px solid rgba(255,255,255,0.2)" : "none",
      }}
    >
      <span className="uppercase tracking-wider" style={{ color: colors["text-secondary"] }}>
        {sector.id}
      </span>
      <span className="tabular-nums" style={{ color: deltaColor }}>
        {deltaStr}
      </span>
    </button>
  );
}

/** Format a sector delta: "+0.032s", "-0.197s", "0.000s". */
function formatSectorDelta(delta: number): string {
  if (!Number.isFinite(delta)) return "—";
  const sign = delta < -0.0005 ? "-" : delta > 0.0005 ? "+" : "";
  return `${sign}${Math.abs(delta).toFixed(3)}s`;
}

// ─── Left panel: laps + gaps + large track map ────────────────────────────

interface LeftPanelProps {
  onBack:        () => void;
  sectors:       MiniSector[];
  sortByLoss:    boolean;
  onToggleSort:  () => void;
}

function LeftPanel({ onBack, sectors, sortByLoss, onToggleSort }: LeftPanelProps) {
  const slotA = useTelemetryStore((s) => s.slotA);
  const slotB = useTelemetryStore((s) => s.slotB);
  if (!slotA.source || !slotA.telemetry || !slotB.source || !slotB.telemetry) return null;

  return (
    <aside className="flex min-h-0 flex-col gap-2 overflow-hidden">
      <LapsCard
        onBack={onBack}
        sourceA={slotA.source}
        lapA={slotA.telemetry}
        sourceB={slotB.source}
        lapB={slotB.telemetry}
      />
      <GapsCard sectors={sectors} sortByLoss={sortByLoss} onToggleSort={onToggleSort} />
      <Panel title="Track Map" subtle className="flex-1" bodyClass="p-2">
        <TrackMap telA={slotA.telemetry} telB={slotB.telemetry} />
      </Panel>
    </aside>
  );
}

// ─── Laps card ────────────────────────────────────────────────────────────

interface LapsCardProps {
  onBack:  () => void;
  sourceA: ParseIbtResponse;
  lapA:    LapTelemetry;
  sourceB: ParseIbtResponse;
  lapB:    LapTelemetry;
}

/**
 * Shows the two loaded laps with their times, drivers, and the gap between
 * them. The gear-cog in the header goes back to the file selector.
 */
function LapsCard({ onBack, sourceA, lapA, sourceB, lapB }: LapsCardProps) {
  const gap = lapB.lap_time - lapA.lap_time;

  return (
    <Panel
      title="Laps"
      subtle
      headerRight={
        <button
          onClick={onBack}
          title="Back to file selector"
          className="rounded p-0.5 text-text-dim hover:text-text-primary transition-colors"
        >
          <IconGear />
        </button>
      }
    >
      <div className="flex flex-col gap-2">
        {/* Target lap — dashed yellow indicator */}
        <LapRow
          index={1}
          lapNumber={lapA.lap_number}
          lapTime={lapA.lap_time}
          driverName={sourceA.session.driver_name}
          isTarget
        />
        {/* Reference lap — solid cyan indicator */}
        <LapRow
          index={2}
          lapNumber={lapB.lap_number}
          lapTime={lapB.lap_time}
          driverName={sourceB.session.driver_name}
          gap={gap}
        />
      </div>
    </Panel>
  );
}

interface LapRowProps {
  index:      number;
  lapNumber:  number;
  lapTime:    number;
  driverName: string;
  isTarget?:  boolean;
  gap?:       number;
}

function LapRow({ index, lapNumber, lapTime, driverName, isTarget, gap }: LapRowProps) {
  const lineColor = isTarget ? colors.target : colors.speed;

  return (
    <div className="flex items-start gap-2">
      {/* Line swatch: dashed for target, solid for reference */}
      <div className="mt-1 shrink-0">
        <svg width="18" height="10" aria-hidden="true">
          <line
            x1="0" y1="5" x2="18" y2="5"
            stroke={lineColor}
            strokeWidth="2"
            strokeDasharray={isTarget ? "4 3" : undefined}
          />
        </svg>
      </div>

      <div className="min-w-0 flex-1">
        {/* Lap number + time + optional gap */}
        <div className="flex items-baseline gap-1.5 text-sm">
          <span className="font-semibold tabular-nums text-text-dim">{index}</span>
          <span className="font-mono font-semibold tabular-nums text-text-primary">
            {formatLapTime(lapTime)}
          </span>
          <span className="text-xs tabular-nums text-text-dim">L{lapNumber}</span>
          {gap != null && (
            <span
              className="text-xs tabular-nums"
              style={{
                color:
                  gap < -0.0005 ? colors["delta-fast"]
                  : gap > 0.0005 ? colors["delta-slow"]
                  : colors["text-dim"],
              }}
            >
              ({formatSectorDelta(gap)})
            </span>
          )}
        </div>
        {/* Driver name */}
        {driverName && (
          <div className="truncate text-xs text-text-dim">{driverName}</div>
        )}
      </div>
    </div>
  );
}

// ─── Gaps card ────────────────────────────────────────────────────────────

interface GapsCardProps {
  sectors:      MiniSector[];
  sortByLoss:   boolean;
  onToggleSort: () => void;
}

function GapsCard({ sectors, sortByLoss, onToggleSort }: GapsCardProps) {
  const [activeId, setActiveId] = useState<string | null>(null);

  const displaySectors = sortByLoss
    ? [...sectors].sort((a, b) => a.delta - b.delta)
    : sectors;

  function handleRowClick(s: MiniSector) {
    if (activeId === s.id) {
      setActiveId(null);
      applyZoom(null);
    } else {
      setActiveId(s.id);
      applyZoom({ min: s.zoomStart, max: s.zoomEnd });
    }
  }

  return (
    <Panel title="Gaps" subtle>
      {sectors.length === 0 ? (
        <p className="text-xs text-text-dim">No sectors detected.</p>
      ) : (
        <div className="flex flex-col">
          {/* Column headers — aligned to match the data columns. */}
          <div className="mb-1 flex items-center text-[10px] uppercase tracking-wider text-text-dim">
            <span className="w-10" />
            <span className="w-16 text-center">
              <LapDot color={colors.target} dashed />
            </span>
            <button
              onClick={onToggleSort}
              title={sortByLoss ? "Restore original order" : "Sort by biggest loss"}
              className="w-20 flex items-center justify-center transition-opacity hover:opacity-80"
              style={{ opacity: sortByLoss ? 1 : 0.5 }}
            >
              <LapDot color={colors.speed} />
            </button>
          </div>

          {displaySectors.map((s) => {
            const faster = s.delta < -0.0005;
            const slower = s.delta > 0.0005;
            const deltaColor = faster ? colors["delta-slow"] : slower ? colors["delta-fast"] : colors["text-dim"];
            const deltaBg    = faster ? `${colors["delta-slow"]}22` : slower ? `${colors["delta-fast"]}22` : "transparent";
            const isActive   = activeId === s.id;

            return (
              <div
                key={s.id}
                onClick={() => handleRowClick(s)}
                className="flex w-fit items-center rounded-sm border-t py-1 pl-1 text-xs transition-colors cursor-pointer"
                style={{
                  borderTopColor: "rgba(255,255,255,0.06)",
                  backgroundColor: isActive ? "rgba(255,255,255,0.07)" : undefined,
                }}
                onMouseEnter={e => { if (!isActive) e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.04)"; }}
                onMouseLeave={e => { if (!isActive) e.currentTarget.style.backgroundColor = ""; }}
              >
                <span className="w-10 text-[13px] font-bold uppercase tracking-wider text-text-secondary">
                  {s.id}
                </span>
                <span className="w-16 font-mono tabular-nums text-text-secondary">
                  {s.timeA.toFixed(3)}
                </span>
                <span
                  className="w-20 rounded px-1.5 py-0.5 text-right font-mono tabular-nums text-[13px] font-bold"
                  style={{ color: deltaColor, backgroundColor: deltaBg }}
                >
                  {formatSectorDelta(s.delta)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

/** Tiny coloured dot used as a legend label. */
function LapDot({ color, dashed }: { color: string; dashed?: boolean }) {
  return (
    <svg width="14" height="8" style={{ display: "inline-block", verticalAlign: "middle" }} aria-hidden="true">
      <line
        x1="0" y1="4" x2="14" y2="4"
        stroke={color}
        strokeWidth="2"
        strokeDasharray={dashed ? "4 3" : undefined}
      />
    </svg>
  );
}

// ─── Icons ────────────────────────────────────────────────────────────────

/** Feather-style settings cog — 8 teeth via the rounded-rect outer path. */
function IconGear() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

/** Sort icon — three lines all anchored to the left, decreasing in length. */
function IconSort({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <line x1="1" y1="3"  x2="13" y2="3"  />
      <line x1="1" y1="7"  x2="9"  y2="7"  />
      <line x1="1" y1="11" x2="5"  y2="11" />
    </svg>
  );
}

// ─── Centre panel: stacked telemetry graphs ────────────────────────────────

/**
 * Config for a single channel row in the stacked graph stack. Each entry
 * becomes one ChannelGraph — the only thing that varies row-to-row is the
 * channel key, colour, label, and optional unit suffix.
 */
interface ChannelRow {
  key:     keyof LapChannels;
  label:   string;
  unit?:   string;
  color:   string;
}

const CHANNEL_ROWS: readonly ChannelRow[] = [
  { key: "speed_kmh",        label: "SPEED",    unit: "km/h", color: colors.speed    },
  { key: "throttle_pct",     label: "THROTTLE", unit: "%",    color: colors.throttle },
  { key: "brake_pct",        label: "BRAKE",    unit: "%",    color: colors.brake    },
  { key: "gear",             label: "GEAR",                    color: colors.gear     },
  { key: "rpm",              label: "RPM",                     color: colors.rpm      },
  { key: "steering_deg",     label: "STEERING", unit: "°",    color: colors.steering },
  { key: "steering_ffb_pct", label: "FFB",      unit: "%",    color: colors.ffb      },
] as const;

interface CenterPanelProps {
  telA: LapTelemetry;
  telB: LapTelemetry;
}

function CenterPanel({ telA, telB }: CenterPanelProps) {
  const [visibleEdges, setVisibleEdges] = useState<Set<Edge>>(
    () => new Set<Edge>(["inner", "mid", "outer"]),
  );
  function toggleEdge(edge: Edge) {
    setVisibleEdges((prev) => {
      const next = new Set(prev);
      if (next.has(edge)) next.delete(edge); else next.add(edge);
      return next;
    });
  }

  return (
    <section className="flex flex-col gap-2">
      <Panel
        title={`Telemetry · ${telA.sample_count} / ${telB.sample_count} samples`}
        bodyClass="p-0"
      >
        <div className="flex flex-col divide-y divide-border">
          {/* Delta is always on top and taller than the channel rows. */}
          <div className="h-32 shrink-0">
            <DeltaGraph telA={telA} telB={telB} height={128} />
          </div>

          {CHANNEL_ROWS.map((row) => (
            <div key={row.key} className="h-20 shrink-0">
              <ChannelGraph
                label={row.label}
                unit={row.unit}
                channel={row.key as never}   // narrowed at the row-list level
                color={row.color}
                telA={telA}
                telB={telB}
                height={80}
              />
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Tire Temperatures" className="shrink-0">
        <div className="grid grid-cols-2 gap-2">
          {(["lf", "rf", "lr", "rr"] as Corner[]).map((corner) => (
            <TireTempGraph
              key={corner}
              corner={corner}
              telA={telA}
              telB={telB}
              visibleEdges={visibleEdges}
              onToggleEdge={toggleEdge}
            />
          ))}
        </div>
      </Panel>
    </section>
  );
}

