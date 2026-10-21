/// <reference types="vite/client" />
/**
 * Global app state, backed by Zustand.
 *
 * The store holds everything that's shared across panels: which two laps
 * are loaded, their telemetry, the synced cursor position, x-axis mode,
 * and which channel rows the user has toggled on/off.
 *
 * Panels pull the slices they care about via `useTelemetryStore(selector)`
 * so they only re-render when the value they read actually changes.
 */

import { create } from "zustand";
import type {
  ChannelId,
  LapTelemetry,
  ParseIbtResponse,
  XAxisMode,
} from "@/types/telemetry";
import { clearBootstrap, saveBootstrap } from "@/utils/devPersist";

// ─── Slot type ─────────────────────────────────────────────────────────────

/**
 * One of the two laps being compared. `A` is the "target" (solid trace),
 * `B` is the "reference" (dashed trace).
 */
export type Slot = "A" | "B";

/**
 * Everything we know about one slot: the parsed session (source IBT), the
 * chosen lap number, and the fetched per-sample telemetry once analysis
 * has started.
 */
interface SlotState {
  source:    ParseIbtResponse | null;
  lapNumber: number | null;
  telemetry: LapTelemetry | null;
}

const emptySlot: SlotState = { source: null, lapNumber: null, telemetry: null };

// ─── Store shape ───────────────────────────────────────────────────────────

/** All channel rows shown by default. User can toggle individual rows off. */
const DEFAULT_VISIBLE_CHANNELS: ChannelId[] = [
  "delta", "speed", "throttle", "brake",
  "gear", "rpm", "steering", "ffb",
];

/**
 * Synced cursor state.
 *
 * Rather than a single percent value, we track the full hover state so a
 * floating tooltip can render next to the mouse.
 *
 *   pct    — fraction along the target lap's dist_m axis (0 – 1)
 *   x / y  — viewport pixels of the hover point (for tooltip positioning)
 *   active — false whenever the mouse is not over any synced graph; used
 *            to hide the tooltip as soon as hover ends
 */
export interface CursorState {
  pct:    number;
  x:      number;
  y:      number;
  active: boolean;
}

const DEFAULT_CURSOR: CursorState = { pct: 0, x: 0, y: 0, active: false };

/**
 * Shared zoom window across the Analysis view.
 *
 * `min` / `max` are in the target lap's `dist_m` units (metres along the
 * lap). `null` means no zoom is active — show the full lap. The track map
 * and the stacked graphs both react to this.
 */
export interface ZoomRange { min: number; max: number }

interface TelemetryStore {
  // ── Data ────────────────────────────────────────────────────────────────
  slotA: SlotState;
  slotB: SlotState;

  // ── UI state ────────────────────────────────────────────────────────────
  /** Shared cursor + hover state. */
  cursor: CursorState;
  /** Current x-axis zoom range. `null` = full lap (no zoom). */
  zoom: ZoomRange | null;
  /** X-axis unit for the stacked graphs. */
  xAxisMode: XAxisMode;
  /** Which channel rows are rendered. */
  visibleChannels: Set<ChannelId>;

  // ── Setters (narrow, type-safe) ─────────────────────────────────────────
  setSource:          (slot: Slot, source: ParseIbtResponse) => void;
  setLapNumber:       (slot: Slot, lapNumber: number)         => void;
  setTelemetry:       (slot: Slot, telemetry: LapTelemetry)   => void;
  clearSlot:          (slot: Slot)                            => void;

  setCursor:          (next: Partial<CursorState>)            => void;
  clearCursor:        ()                                      => void;
  setZoom:            (range: ZoomRange | null)               => void;
  setXAxisMode:       (mode: XAxisMode)                       => void;
  toggleChannel:      (channel: ChannelId)                    => void;
  resetUi:            ()                                      => void;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Immutably update whichever slot the caller specified. */
function updateSlot(
  state:   TelemetryStore,
  slot:    Slot,
  patch:   Partial<SlotState>,
): Partial<TelemetryStore> {
  const key = slot === "A" ? "slotA" : "slotB";
  return { [key]: { ...state[key], ...patch } } as Partial<TelemetryStore>;
}

// ─── Store ─────────────────────────────────────────────────────────────────

export const useTelemetryStore = create<TelemetryStore>((set) => ({
  slotA: emptySlot,
  slotB: emptySlot,

  cursor:          DEFAULT_CURSOR,
  zoom:            null,
  xAxisMode:       "distance",
  visibleChannels: new Set(DEFAULT_VISIBLE_CHANNELS),

  setSource: (slot, source) =>
    set((state) => updateSlot(state, slot, { source, lapNumber: null, telemetry: null })),

  setLapNumber: (slot, lapNumber) =>
    set((state) => updateSlot(state, slot, { lapNumber, telemetry: null })),

  setTelemetry: (slot, telemetry) =>
    set((state) => updateSlot(state, slot, { telemetry })),

  clearSlot: (slot) =>
    set((state) => updateSlot(state, slot, emptySlot)),

  setCursor: (next) =>
    set((state) => {
      // Merge + clamp pct.
      const merged: CursorState = {
        pct:    next.pct    !== undefined ? Math.max(0, Math.min(1, next.pct)) : state.cursor.pct,
        x:      next.x      !== undefined ? next.x                              : state.cursor.x,
        y:      next.y      !== undefined ? next.y                              : state.cursor.y,
        active: next.active !== undefined ? next.active                         : state.cursor.active,
      };
      // If nothing actually changed, return the same reference so Zustand
      // skips listeners. Prevents the bi-directional sync (map hover ↔
      // uPlot cursor) from ping-ponging updates.
      if (
        merged.pct    === state.cursor.pct &&
        merged.x      === state.cursor.x &&
        merged.y      === state.cursor.y &&
        merged.active === state.cursor.active
      ) {
        return { cursor: state.cursor };
      }
      return { cursor: merged };
    }),

  clearCursor: () =>
    set((state) => ({ cursor: { ...state.cursor, active: false } })),

  setZoom: (zoom) => set({ zoom }),

  setXAxisMode: (xAxisMode) => set({ xAxisMode }),

  toggleChannel: (channel) =>
    set((state) => {
      const next = new Set(state.visibleChannels);
      if (next.has(channel)) next.delete(channel);
      else next.add(channel);
      return { visibleChannels: next };
    }),

  resetUi: () =>
    set({
      cursor:          DEFAULT_CURSOR,
      zoom:            null,
      xAxisMode:       "distance",
      visibleChannels: new Set(DEFAULT_VISIBLE_CHANNELS),
    }),
}));

// ─── Convenience selectors ─────────────────────────────────────────────────

/** True once both slots have fetched telemetry — i.e. ready to analyse. */
export const selectBothLoaded = (s: TelemetryStore): boolean =>
  s.slotA.telemetry !== null && s.slotB.telemetry !== null;

/** True once both slots have a lap chosen — i.e. ready to click Analyze. */
export const selectCanAnalyze = (s: TelemetryStore): boolean =>
  s.slotA.source !== null && s.slotA.lapNumber !== null &&
  s.slotB.source !== null && s.slotB.lapNumber !== null;

/**
 * Dev-only debug hook: exposes the Zustand store on `window.__ibt` so test
 * scripts and the Claude Preview `preview_eval` tool can seed state without
 * going through the UI. Guarded by `import.meta.env.DEV` so it never ships
 * to production bundles.
 */
if (import.meta.env.DEV) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__ibt = { store: useTelemetryStore };

  /**
   * Dev-only bootstrap persistence.
   *
   * Whenever both slots reach a "ready to analyse" state (source + lap
   * chosen), snapshot their file_ids + lap numbers to localStorage so
   * `App.tsx` can rehydrate after a reload. Clear the snapshot whenever
   * that condition breaks (e.g. user clicks "Change" on a slot). See
   * `utils/devPersist.ts` for the full rationale.
   */
  useTelemetryStore.subscribe((state) => {
    const a = state.slotA;
    const b = state.slotB;
    if (a.source && a.lapNumber !== null && b.source && b.lapNumber !== null) {
      saveBootstrap({
        fileIdA: a.source.file_id,
        lapA:    a.lapNumber,
        fileIdB: b.source.file_id,
        lapB:    b.lapNumber,
      });
    } else {
      clearBootstrap();
    }
  });
}
