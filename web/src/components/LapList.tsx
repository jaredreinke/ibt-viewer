import type { LapSummary } from "@/types/telemetry";
import {
  annotateLapStatuses,
  STATUS_CLASSNAME,
  STATUS_LABEL,
  type LapStatus,
} from "@/utils/lapStatus";
import { formatLapTime } from "@/utils/formatLapTime";

/**
 * Scrollable list of laps with status badges.
 *
 * Each row shows lap number, lap time, and a short status badge ("Fastest",
 * "Incomplete", "Pit (out)", etc.). Clicking a row selects it — selection
 * is visually indicated by a border highlight. Incomplete/outlap/inlap
 * rows are still selectable (the user may want to inspect telemetry for
 * them) but are rendered in muted text so the valid laps stand out.
 */
interface LapListProps {
  laps:        LapSummary[];
  selectedLap: number | null;
  onSelect:    (lapNumber: number) => void;
}

export default function LapList({ laps, selectedLap, onSelect }: LapListProps) {
  const annotated = annotateLapStatuses(laps);

  if (annotated.length === 0) {
    return (
      <div className="p-4 text-sm text-text-dim">No laps found in this file.</div>
    );
  }

  return (
    // `h-full` + `overflow-y-auto` lets the list fill whatever height its
    // parent gives it, then scroll internally instead of growing the card.
    <div className="h-full overflow-y-auto">
      {annotated.map((lap) => (
        <LapRow
          key={`${lap.lap_number}-${lap.sample_count}`}
          lapNumber={lap.lap_number}
          lapTime={lap.lap_time}
          status={lap.status}
          selected={selectedLap === lap.lap_number}
          onClick={() => onSelect(lap.lap_number)}
        />
      ))}
    </div>
  );
}

// ─── Row ───────────────────────────────────────────────────────────────────

interface LapRowProps {
  lapNumber: number;
  lapTime:   number;
  status:    LapStatus;
  selected:  boolean;
  onClick:   () => void;
}

function LapRow({ lapNumber, lapTime, status, selected, onClick }: LapRowProps) {
  const label = STATUS_LABEL[status];
  const isMuted = status === "incomplete" || status === "outlap" || status === "inlap";

  return (
    <button
      onClick={onClick}
      className={[
        "flex w-full items-center gap-3 border-b border-border/50 px-3 py-2 text-left transition-colors",
        "hover:bg-raised",
        selected ? "bg-raised ring-1 ring-inset ring-delta" : "",
        isMuted ? "text-text-dim" : "text-text-primary",
      ].join(" ")}
    >
      <span className="w-8 text-right text-xs text-text-dim">{lapNumber}</span>
      <span className="flex-1 font-semibold tabular-nums">
        {formatLapTime(lapTime)}
      </span>
      {label && (
        <span className={`text-[10px] font-semibold uppercase tracking-wider ${STATUS_CLASSNAME[status]}`}>
          {label}
        </span>
      )}
    </button>
  );
}
