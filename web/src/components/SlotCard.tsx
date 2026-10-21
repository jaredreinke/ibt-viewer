import { useState } from "react";
import LapList from "./LapList";
import Panel from "./Panel";
import UploadZone from "./UploadZone";
import { SidecarError, uploadIbt } from "@/api/sidecar";
import { useTelemetryStore, type Slot } from "@/store/useTelemetryStore";

/**
 * One of the two lap-selection slots on the FileSelect screen.
 *
 * Encapsulates the full per-slot flow:
 *   1. Show upload zone until a file has been parsed
 *   2. Upload → call sidecar → store ParseIbtResponse in the slot
 *   3. After upload: show session header + scrollable lap list
 *   4. User picks a lap → store the selected lap number in the slot
 *   5. "Change file" button clears the slot and returns to step 1
 */
interface SlotCardProps {
  /** Which slot this card represents. */
  slot: Slot;
  /** Human label — "Target lap" or "Reference lap". */
  label: string;
}

export default function SlotCard({ slot, label }: SlotCardProps) {
  const slotKey      = slot === "A" ? "slotA" : "slotB";
  const slotState    = useTelemetryStore((s) => s[slotKey]);
  const setSource    = useTelemetryStore((s) => s.setSource);
  const setLapNumber = useTelemetryStore((s) => s.setLapNumber);
  const clearSlot    = useTelemetryStore((s) => s.clearSlot);

  const [uploading, setUploading] = useState(false);
  const [error,     setError]     = useState<string | null>(null);

  /** Upload the chosen file and populate this slot's source + laps. */
  async function handleFile(file: File) {
    setUploading(true);
    setError(null);
    try {
      const response = await uploadIbt(file);
      setSource(slot, response);
    } catch (err) {
      setError(
        err instanceof SidecarError
          ? err.message
          : "Unknown error — is the sidecar running?",
      );
    } finally {
      setUploading(false);
    }
  }

  // ── State 1: no file yet → show upload zone ─────────────────────────────
  if (!slotState.source) {
    return (
      <Panel title={label} bodyClass="p-0">
        <div className="p-4">
          <UploadZone
            onFile={handleFile}
            disabled={uploading}
            hint="(or click to browse)"
          />
          {error && (
            <div className="mt-3 rounded-md border border-delta-slow/40 bg-delta-slow/10 p-2 text-xs text-delta-slow">
              {error}
            </div>
          )}
        </div>
      </Panel>
    );
  }

  // ── State 2: file parsed → show session header + lap list ───────────────
  const { session, laps } = slotState.source;

  return (
    <Panel title={label} bodyClass="p-0">
      <div className="flex items-start justify-between border-b border-border px-4 py-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-text-primary">
            {session.track_name || "Unknown track"}
            {session.track_config && (
              <span className="ml-2 text-text-dim">({session.track_config})</span>
            )}
          </div>
          <div className="truncate text-xs text-text-secondary">
            {session.car_name || "Unknown car"} • {session.session_type || "—"}
          </div>
        </div>
        <button
          onClick={() => clearSlot(slot)}
          className="shrink-0 rounded-md border border-border bg-raised px-2 py-1 text-xs text-text-secondary hover:text-text-primary"
        >
          Change file
        </button>
      </div>

      <div className="h-96">
        <LapList
          laps={laps}
          selectedLap={slotState.lapNumber}
          onSelect={(lapNumber) => setLapNumber(slot, lapNumber)}
        />
      </div>
    </Panel>
  );
}
