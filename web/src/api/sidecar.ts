/**
 * Sidecar HTTP client.
 *
 * All calls go through the Vite dev proxy (`/api` → `http://localhost:8000`)
 * in development, and through nginx with the same prefix on p1doks.com in
 * production. The URLs below never need to change between environments.
 */

import type { LapTelemetry, ParseIbtResponse } from "@/types/telemetry";

/** Root path for sidecar requests. Resolved by the Vite proxy in dev. */
const API_BASE = "/api";

/**
 * Thrown for any non-2xx response from the sidecar.
 *
 * The sidecar sends a `{ "detail": "..." }` body for FastAPI HTTPExceptions;
 * `message` captures that detail string where available.
 */
export class SidecarError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "SidecarError";
  }
}

/** Parse a response body, raising SidecarError on non-2xx. */
async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    let detail = text;
    try {
      detail = JSON.parse(text).detail ?? text;
    } catch {
      // body wasn't JSON — fall through with the raw text
    }
    throw new SidecarError(response.status, detail || response.statusText);
  }
  return (await response.json()) as T;
}

/**
 * Wrapper around `fetch` that converts network-layer failures (connection
 * refused, DNS, CORS) into a `SidecarError` with a human-readable message,
 * instead of the bare `TypeError` browsers throw. This way every call site
 * can treat `SidecarError` as the single failure type.
 */
async function fetchOrThrow(input: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch {
    throw new SidecarError(
      0,
      "Cannot reach sidecar (http://localhost:8000). Is it running?",
    );
  }
}

// ─── Endpoints ─────────────────────────────────────────────────────────────

/**
 * Liveness check. Resolves true if the sidecar is up and responding.
 * Swallows network errors to keep the UI from crashing on a cold-start.
 */
export async function checkHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Upload an IBT file and receive session + lap-list metadata.
 * The returned `file_id` is used for subsequent `fetchLapTelemetry()` calls.
 */
export async function uploadIbt(file: File): Promise<ParseIbtResponse> {
  const form = new FormData();
  form.append("file", file);

  const response = await fetchOrThrow(`${API_BASE}/parse-ibt`, {
    method: "POST",
    body:   form,
  });
  return readJson<ParseIbtResponse>(response);
}

/**
 * Fetch session metadata + lap list for an IBT that has already been
 * cached on the sidecar (i.e. uploaded earlier in this or a prior
 * session). Used by the dev-mode bootstrap rehydration in `App.tsx` —
 * the frontend remembers the two `file_id`s across page reloads and
 * calls this to restore the session info without a fresh upload.
 */
export async function fetchSession(fileId: string): Promise<ParseIbtResponse> {
  const response = await fetchOrThrow(`${API_BASE}/session/${fileId}`);
  return readJson<ParseIbtResponse>(response);
}

/**
 * Fetch full per-sample telemetry for one lap from a previously-uploaded IBT.
 */
export async function fetchLapTelemetry(
  fileId:    string,
  lapNumber: number,
): Promise<LapTelemetry> {
  const response = await fetchOrThrow(`${API_BASE}/lap-telemetry`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ file_id: fileId, lap_number: lapNumber }),
  });
  return readJson<LapTelemetry>(response);
}
