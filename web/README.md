# IBT Viewer — Web Frontend

React + TypeScript + Vite app that renders the two-lap telemetry comparison.

## Stack

- **React 18** + **TypeScript** + **Vite** — app framework
- **Tailwind CSS 3** — styling, with design tokens in `src/theme/tokens.ts`
- **Zustand** — global state (loaded laps, cursor position, visible channels)
- **uPlot** — performance-critical time-series charts (added in feature pass)

## Running

The frontend talks to the Python sidecar. Start the sidecar first
(see `../sidecar/README.md`), then:

```bash
cd web
npm install
npm run dev
```

Opens on <http://localhost:5173>. The Vite dev server proxies `/api/*`
to `http://localhost:8000`, so the sidecar must be running.

## Layout

```
src/
├── api/           HTTP client for the sidecar
├── components/    Reusable UI pieces (graphs, track map, panels, …)
├── pages/         Top-level screens (FileSelect, Analysis)
├── store/         Zustand global state
├── theme/         Design tokens (colours, shadows) — the source of truth
└── types/         Shared telemetry types, mirroring the sidecar schema
```

## Scripts

- `npm run dev` — Vite dev server with HMR
- `npm run build` — production bundle into `dist/`
- `npm run preview` — serve the prod bundle locally
- `npm run typecheck` — run `tsc --noEmit`
