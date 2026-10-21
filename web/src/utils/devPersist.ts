/**
 * Dev-only bootstrap persistence.
 *
 * During development the Zustand store is in-memory only, so any Vite HMR
 * full-reload, manual page refresh, or preview-eval reset wipes the loaded
 * telemetry and kicks the user back to the file selector. That's a real
 * friction point when iterating on the Analysis view.
 *
 * This module stores the *minimum* information needed to rehydrate the
 * Analysis screen — the two content-hashed `file_id`s and the chosen lap
 * numbers — in `localStorage`. On app mount, `App.tsx` reads this and
 * re-fetches the session summaries + telemetry from the sidecar. Because
 * the sidecar keys cached IBTs by content hash on disk, any previously
 * uploaded file is still available after a restart.
 *
 * We deliberately persist only IDs, never the heavy telemetry arrays —
 * localStorage stays tiny and the source of truth remains the sidecar.
 *
 * Guarded by `import.meta.env.DEV` so nothing ships to production.
 */

const KEY = "ibt-viewer-bootstrap-v1";

export interface Bootstrap {
  fileIdA: string;
  lapA:    number;
  fileIdB: string;
  lapB:    number;
}

/** Read the persisted bootstrap, or null if none / not in dev. */
export function loadBootstrap(): Bootstrap | null {
  if (!import.meta.env.DEV) return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Bootstrap>;
    // Basic shape check — if the schema ever changes, older values are ignored.
    if (
      typeof parsed.fileIdA === "string" && typeof parsed.fileIdB === "string" &&
      typeof parsed.lapA    === "number" && typeof parsed.lapB    === "number"
    ) {
      return parsed as Bootstrap;
    }
    return null;
  } catch {
    return null;
  }
}

/** Save the bootstrap (no-op in production). */
export function saveBootstrap(b: Bootstrap): void {
  if (!import.meta.env.DEV) return;
  try { localStorage.setItem(KEY, JSON.stringify(b)); } catch { /* quota or disabled */ }
}

/** Clear the bootstrap (no-op in production). */
export function clearBootstrap(): void {
  if (!import.meta.env.DEV) return;
  try { localStorage.removeItem(KEY); } catch { /* disabled */ }
}
