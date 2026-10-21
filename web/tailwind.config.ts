import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Config } from "tailwindcss";
import { colors } from "./src/theme/tokens";

/**
 * Tailwind configuration.
 *
 * All design tokens (colours, typography, effects) live in
 * `src/theme/tokens.ts` so they can be imported by components that build
 * canvas/SVG content (the uPlot graphs and the track map) without duplicating
 * the palette in CSS.
 *
 * Content globs are resolved relative to *this file*, not the process CWD.
 * When the dev server is launched from a different working directory (as the
 * preview tooling does), a plain `./src/**` pattern silently matches zero
 * files and Tailwind emits an empty stylesheet — pinning the paths to
 * `__dirname` avoids that entire class of bug.
 */
const here = typeof __dirname === "string"
  ? __dirname
  : path.dirname(fileURLToPath(import.meta.url));

export default {
  content: [
    path.join(here, "index.html"),
    path.join(here, "src/**/*.{ts,tsx}"),
  ],
  theme: {
    extend: {
      colors,
      fontFamily: {
        // Sans stack matches Coach Dave Delta's UI vibe. Tabular numerics are
        // turned on globally below for digit-stable readouts.
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        // Soft neon glow used on delta traces and status pills.
        "glow-purple": "0 0 12px rgba(168, 85, 247, 0.45)",
        "glow-green":  "0 0 12px rgba(16, 185, 129, 0.45)",
        "glow-red":    "0 0 12px rgba(239, 68, 68, 0.45)",
      },
    },
  },
  plugins: [],
} satisfies Config;
