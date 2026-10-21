# IBT Viewer

Web-based iRacing telemetry analysis tool. Upload two `.ibt` files (or two
laps from the same file), pick a lap from each, and compare them side-by-side
with synced crosshairs, a large track map, a sector scroll bar, and stacked
per-channel graphs.

Visually inspired by Coach Dave Academy Delta; layout ideas from Garage61
(large central track map) and VRS (top sector scroll bar with per-segment
delta times).

**End goal:** a fully functioning telemetry app hosted on p1doks.com. The
MVP is a local tool; the same React app deploys to production unchanged,
with only the sidecar target URL changing.

## Architecture

Two processes talk to each other over HTTP:

```
┌──────────────┐   multipart upload    ┌────────────────────┐
│ React app    │ ────────────────────► │ Python sidecar     │
│ (Vite dev    │                       │ (FastAPI + pyirsdk)│
│  server,     │   JSON: session +     │                    │
│  :5173)      │ ◄──── laps + lap      │  :8000             │
│              │       telemetry       │                    │
└──────────────┘                       └────────────────────┘
```

- **`web/`** — React + TypeScript + Vite frontend. This is what ships to
  p1doks.com in production.
- **`sidecar/`** — Python FastAPI service wrapping `pyirsdk`. Runs locally
  in development; becomes a hosted parser service in production.

The API contract is identical in both environments, so the split is cleanly
deployable.

## Running the MVP locally

Start each process in its own terminal.

**Terminal 1 — sidecar:**

```bash
cd sidecar
python -m venv .venv
.venv\Scripts\activate       # Windows
# source .venv/bin/activate  # macOS/Linux
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

**Terminal 2 — web:**

```bash
cd web
npm install
npm run dev
```

Open <http://localhost:5173>.

## Development workflow

These are hard-won rules. Violating any of them loses time in ways that look
like bugs but aren't.

### Always run the sidecar with `--reload`

`uvicorn main:app --reload --port 8000` — never without `--reload`. Without
it, every `sidecar/*.py` edit is silently ignored until you kill + restart
the process by hand, which is a recipe for "why doesn't my new endpoint
exist" confusion. The reloader watches the `sidecar/` directory via
`watchfiles` and picks up changes in <1 s.

### State survives reloads in dev (localStorage bootstrap)

The Zustand store is in-memory, so every HMR full-reload, manual refresh,
or `preview_eval` reset would otherwise wipe the loaded telemetry and kick
you back to the file selector. To avoid that loop in dev:

- `utils/devPersist.ts` persists `{fileIdA, lapA, fileIdB, lapB}` to
  `localStorage` via a `useTelemetryStore.subscribe(...)` hook (guarded by
  `import.meta.env.DEV`, so it never ships).
- `App.tsx` reads that snapshot on mount and rehydrates via
  `fetchSession` + `fetchLapTelemetry`. Since the sidecar content-hashes
  cached IBTs on disk (`%TEMP%/ibt_viewer_cache`), any file uploaded once
  stays addressable across sidecar restarts.

Upload your two IBTs through the UI once per machine; every reload after
that drops you straight into Analysis.

To force a fresh file-selector state (e.g. testing onboarding), clear
`localStorage["ibt-viewer-bootstrap-v1"]` or use the "Back" cog in the
Laps card and click "Change" on a slot.

### Tailwind config must anchor paths to `__dirname`

`tailwind.config.ts` resolves `content` globs relative to `process.cwd()`,
not the config file. When Vite is launched from a parent directory (as the
Claude Code preview tooling does via `.claude/launch.json`), a naive
`"./src/**/*.{ts,tsx}"` pattern matches zero files and Tailwind emits an
empty stylesheet — the app renders with all Tailwind classes present but
no CSS rules backing them. Symptom: everything stacks vertically, no
colours, system fonts.

Always build content globs with `path.join(__dirname, …)` so the config
works regardless of where the dev server was launched from.

### `.claude/launch.json` uses `cwd`, not concatenated paths

If you change the launch config, set `"cwd": "IBT Viewer/web"` rather than
prefixing every `runtimeArg` with the subdir. Vite, PostCSS, and TypeScript
plugins all make assumptions that break when CWD ≠ project root.

### Recovering from a broken preview

If the preview shows stale state, a blank screen, or "connection lost":

1. Check `preview_logs` for Vite/Tailwind warnings — "content missing"
   means the Tailwind config failed to load (see above).
2. `curl http://localhost:8000/health` to confirm the sidecar is up.
3. `preview_stop` + `preview_start ibt-viewer` for a clean Vite restart
   (HMR state is cleared, localStorage bootstrap still rehydrates).
4. Only nuke `node_modules/` and re-`npm install` as a last resort —
   almost all "broken env" symptoms are CWD or config-load issues, not
   dependency corruption.

## Project brief

See the original project brief for full feature list, design-system tokens,
and build-order plan. Summary:

- Two-lap comparison (target + reference), solid/dashed traces
- Large Garage61-style track map on the left
- VRS-style sector/corner scroll bar on top with per-segment delta times
- Coach Dave Delta colour palette (deep purple, neon channel accents)
- Stacked graphs: delta, speed, throttle, brake, gear, RPM, steering, FFB
- 2×2 tire-temp grid (inner/mid/outer per wheel)
- Synced cursor across all graphs, track map, and scroll bar

## Status

Scaffolding only. The sidecar is fully implemented and should parse any
IBT. The frontend is a runnable skeleton — layout shells, theme, types,
API client, and state store in place; feature implementation next.
