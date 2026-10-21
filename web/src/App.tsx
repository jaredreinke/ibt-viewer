import { useEffect, useRef, useState } from "react";
import FileSelect from "./pages/FileSelect";
import Analysis from "./pages/Analysis";
import {
  useTelemetryStore,
  selectBothLoaded,
} from "./store/useTelemetryStore";
import { fetchLapTelemetry, fetchSession } from "./api/sidecar";
import { clearBootstrap, loadBootstrap } from "./utils/devPersist";

/**
 * Top-level router.
 *
 * The MVP has only two screens and no need for URL routing: pick two laps,
 * then analyse them. We switch screens by:
 *
 *   - Advancing to `analysis` when both slots have telemetry loaded (the
 *     FileSelect page triggers the fetches and updates the store).
 *   - Returning to `select` when the user clicks "Back" on the analysis
 *     view.
 *
 * In development, the mount effect also checks `localStorage` for a
 * persisted bootstrap (two file_ids + lap numbers from a prior session).
 * If present, it asks the sidecar to reconstitute the state so reloads,
 * HMR, and preview-eval resets drop straight back into Analysis instead
 * of the file selector. See `utils/devPersist.ts` for the rationale.
 */
type Screen = "select" | "analysis";

export default function App() {
  const [screen, setScreen]   = useState<Screen>("select");
  const [booting, setBooting] = useState<boolean>(() => loadBootstrap() !== null);
  const bothLoaded            = useTelemetryStore(selectBothLoaded);

  const prevBothLoaded = useRef(false);

  // Going back clears only the telemetry arrays (not source/lapNumber) so:
  //   - the lap selector still shows the user's previous selections
  //   - bothLoaded drops to false, allowing the auto-advance to re-fire
  //     after they click Analyze again (same laps or different ones).
  function handleBack() {
    const store = useTelemetryStore.getState();
    if (store.slotA.lapNumber !== null) store.setLapNumber("A", store.slotA.lapNumber);
    if (store.slotB.lapNumber !== null) store.setLapNumber("B", store.slotB.lapNumber);
    setScreen("select");
  }

  // ─── Dev-only bootstrap rehydration ─────────────────────────────────────
  // On mount, if a bootstrap snapshot exists, re-fetch session info + lap
  // telemetry for both slots in parallel and push them into the store. The
  // existing auto-advance below will then flip the screen to "analysis".
  useEffect(() => {
    const b = loadBootstrap();
    if (!b) return;

    let cancelled = false;
    (async () => {
      try {
        const [sessionA, sessionB] = await Promise.all([
          fetchSession(b.fileIdA),
          fetchSession(b.fileIdB),
        ]);
        const [telA, telB] = await Promise.all([
          fetchLapTelemetry(b.fileIdA, b.lapA),
          fetchLapTelemetry(b.fileIdB, b.lapB),
        ]);
        if (cancelled) return;

        const s = useTelemetryStore.getState();
        // setSource() resets lapNumber+telemetry, so order matters here.
        s.setSource("A",    sessionA);
        s.setLapNumber("A", b.lapA);
        s.setTelemetry("A", telA);
        s.setSource("B",    sessionB);
        s.setLapNumber("B", b.lapB);
        s.setTelemetry("B", telB);
      } catch {
        // Stale IDs, sidecar down, or cache cleared — forget the snapshot
        // so the next reload lands on the file selector instead of looping.
        clearBootstrap();
      } finally {
        if (!cancelled) setBooting(false);
      }
    })();

    return () => { cancelled = true; };
  }, []);

  // Auto-advance to analysis only when bothLoaded transitions false → true.
  // Using an effect + ref prevents the snap-back bug where clicking "Back"
  // sets screen to "select" but the render immediately re-advances because
  // bothLoaded is still true.
  useEffect(() => {
    if (bothLoaded && !prevBothLoaded.current) {
      setScreen("analysis");
    }
    prevBothLoaded.current = bothLoaded;
  }, [bothLoaded]);

  // While rehydrating, show a minimal placeholder rather than flashing the
  // file selector for a split second before the restore completes.
  if (booting && !bothLoaded) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-app text-sm text-text-secondary">
        Restoring session…
      </div>
    );
  }

  return (
    <div className="h-full w-full bg-app text-text-primary">
      {screen === "select"
        ? <FileSelect />
        : <Analysis onBack={handleBack} />}
    </div>
  );
}
