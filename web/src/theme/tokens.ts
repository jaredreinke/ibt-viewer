/**
 * Design tokens — the single source of truth for colour and effects.
 *
 * This file is imported by:
 *   - `tailwind.config.ts` to generate CSS utility classes
 *   - components that render into canvas/SVG (uPlot charts, the track map)
 *     and therefore cannot rely on Tailwind classes
 *
 * The palette follows Coach Dave Academy Delta's visual language: deep
 * purple/navy background, muted purple panels, neon channel accents.
 */

export const colors = {
  // ── Surfaces ────────────────────────────────────────────────────────────
  // Inspired by p1doks.com: near-black body, very dark charcoal cards,
  // subtle white borders — the blue accent bar carries the brand colour.
  app:    "#0d0d0d",  // near-black body background
  panel:  "#141414",  // card base background
  raised: "#1e1e1e",  // interactive elements / hover states
  border: "#2a2a2a",  // subtle neutral border (non-accent sides)
  accent: "#3b82f6",  // blue left-border accent, active states

  // ── Text ────────────────────────────────────────────────────────────────
  "text-primary":   "#ffffff",
  "text-secondary": "#9ca3af",  // neutral gray-400 — labels, supporting copy
  "text-dim":       "#4b5563",  // neutral gray-600 — unit suffixes, helper hints

  // ── Delta (the headline channel) ────────────────────────────────────────
  delta:         "#a855f7",  // neutral (purple, glows)
  "delta-fast":  "#10b981",  // target lap is ahead of reference
  "delta-slow":  "#ef4444",  // target lap is behind reference

  // ── Target (dashed) line colour, used on every channel graph ───────────
  // All target-lap traces share this hue so the comparison between target
  // and reference is always the same visual (yellow dashed vs. channel-
  // coloured solid), no matter which channel the graph is showing.
  target:   "#facc15",  // bright yellow

  // ── Per-channel accent palette (used for the reference / comparison
  // lap — rendered as solid lines in the channel's own hue) ──────────────
  speed:    "#06b6d4",  // cyan
  throttle: "#22c55e",  // green
  brake:    "#ef4444",  // red
  clutch:   "#94a3b8",  // slate — secondary pedal
  gear:     "#ec4899",  // pink  (moved off yellow so it doesn't clash with target)
  rpm:      "#14b8a6",  // teal  (moved off orange — too close to yellow)
  steering: "#3b82f6",  // blue
  ffb:      "#8b5cf6",  // violet

  // ── Tire tread edges ────────────────────────────────────────────────────
  "tire-inner": "#3b82f6",  // blue  — hottest/stressed edge
  "tire-mid":   "#22c55e",  // green — target zone
  "tire-outer": "#ef4444",  // red   — under-worked edge

  // ── Sector / segment bar ────────────────────────────────────────────────
  "segment-faster":   "#3b82f6",
  "segment-slower":   "#ef4444",
  "segment-neutral":  "#4b5563",
  "segment-selected": "#a855f7",
} as const;

export type ColorToken = keyof typeof colors;
