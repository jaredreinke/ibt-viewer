import { useState } from "react";
import SlotCard from "@/components/SlotCard";
import { fetchLapTelemetry, SidecarError } from "@/api/sidecar";
import {
  selectCanAnalyze,
  useTelemetryStore,
} from "@/store/useTelemetryStore";

/**
 * First screen: pick two IBT files and one lap from each.
 *
 * The two SlotCards handle their own upload + lap-picker lifecycle and write
 * into the global store. This page's job is just to render them alongside
 * each other and handle the "Analyze" click — which kicks off parallel
 * telemetry fetches for both picked laps. Once both fetches land, App.tsx
 * auto-advances to the Analysis screen (it subscribes to `bothLoaded`).
 */
export default function FileSelect() {
  const canAnalyze  = useTelemetryStore(selectCanAnalyze);
  const slotA       = useTelemetryStore((s) => s.slotA);
  const slotB       = useTelemetryStore((s) => s.slotB);
  const setTelemetry = useTelemetryStore((s) => s.setTelemetry);

  const [fetching, setFetching] = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  /**
   * Kick off telemetry fetches for both slots in parallel. Either slot's
   * failure aborts the other's result (the first error is reported and
   * both slot's telemetry stays empty so the user can retry).
   */
  async function onAnalyze() {
    if (!canAnalyze) return;
    setFetching(true);
    setError(null);
    try {
      const [telA, telB] = await Promise.all([
        fetchLapTelemetry(slotA.source!.file_id, slotA.lapNumber!),
        fetchLapTelemetry(slotB.source!.file_id, slotB.lapNumber!),
      ]);
      setTelemetry("A", telA);
      setTelemetry("B", telB);
    } catch (err) {
      setError(
        err instanceof SidecarError
          ? err.message
          : "Failed to load lap telemetry",
      );
    } finally {
      setFetching(false);
    }
  }

  return (
    <div className="flex h-full w-full items-center justify-center p-8">
      <div className="w-full max-w-6xl">
        <header className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight text-text-primary">
            IBT Viewer
          </h1>
          <p className="text-sm text-text-secondary">
            Pick two laps to compare. Upload two IBT files, or two laps from
            the same file.
          </p>
        </header>

        <div className="grid grid-cols-2 gap-6">
          <SlotCard slot="A" label="Target lap" />
          <SlotCard slot="B" label="Reference lap" />
        </div>

        {error && (
          <div className="mt-6 rounded-md border border-delta-slow/40 bg-delta-slow/10 p-3 text-sm text-delta-slow">
            {error}
          </div>
        )}

        <div className="mt-8 flex items-center justify-end gap-3">
          {fetching && (
            <span className="text-sm text-text-secondary">Loading telemetry…</span>
          )}
          <button
            onClick={onAnalyze}
            disabled={!canAnalyze || fetching}
            className={[
              "rounded-md px-6 py-2 font-semibold transition-all",
              canAnalyze && !fetching
                ? "bg-delta text-white shadow-glow-purple hover:opacity-90"
                : "cursor-not-allowed bg-raised text-text-dim",
            ].join(" ")}
          >
            Analyze
          </button>
        </div>
      </div>
    </div>
  );
}
