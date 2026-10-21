import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import { colors } from "@/theme/tokens";
import { useTelemetryStore } from "@/store/useTelemetryStore";
import type { LapTelemetry } from "@/types/telemetry";
import { getAnyRegisteredChart } from "@/utils/syncZoom";

/**
 * Unified track map.
 *
 * A single Leaflet map underpins both view modes. The only difference
 * between "satellite" and "lines" modes is whether the satellite tile
 * layer is attached — the map, polylines, cursor marker, and zoom state
 * are always the same instance, so toggling modes is a background swap
 * with nothing else moving.
 *
 *   - Hover:        moves the synced cursor (tooltip + graph crosshairs)
 *   - Wheel:        zoom at mouse (Leaflet default)
 *   - Click + drag: pan (Leaflet default)
 *   - Toggle:       top-right button switches Satellite ↔ Lines by
 *                   adding/removing the tile layer
 *
 * Racing lines are drawn from Lat/Lon. If the IBT has no GPS data
 * (unusual — most real tracks have it), we show a friendly fallback.
 */
interface TrackMapProps {
  telA: LapTelemetry;
  telB: LapTelemetry;
}

type MapMode = "satellite" | "lines";

/** ESRI's free World Imagery tile service — satellite, no API key. */
const SATELLITE_TILE_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const SATELLITE_ATTRIBUTION =
  "Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics";

/** Below this lat threshold, we treat the IBT as having no GPS data. */
const MIN_VALID_LAT = 0.5;

export default function TrackMap({ telA, telB }: TrackMapProps) {
  const [mode, setMode] = useState<MapMode>("satellite");

  const hostRef      = useRef<HTMLDivElement>(null);
  const mapRef       = useRef<L.Map          | null>(null);
  const tileLayerRef = useRef<L.TileLayer    | null>(null);
  const markerRef    = useRef<L.CircleMarker | null>(null);

  // Zip lat/lon into Leaflet tuples (+ dist_m for range slicing).
  const data = useMemo(() => {
    const a = zipLatLngDist(telA.channels.lat, telA.channels.lon, telA.channels.dist_m);
    const b = zipLatLng(telB.channels.lat, telB.channels.lon);
    return {
      latLngsA: a.map((p) => [p[0], p[1]] as [number, number]),
      distA:    a.map((p) => p[2]),
      latLngsB: b,
    };
  }, [telA, telB]);

  const hasGps =
    data.latLngsA.length > 0 &&
    Math.abs(data.latLngsA[0]![0]) > MIN_VALID_LAT;

  // Store subscriptions for cursor + zoom sync.
  const cursorPct   = useTelemetryStore((s) => s.cursor.pct);
  const setCursor   = useTelemetryStore((s) => s.setCursor);
  const clearCursor = useTelemetryStore((s) => s.clearCursor);
  const zoom        = useTelemetryStore((s) => s.zoom);

  // ── Create the map once per lap pair ─────────────────────────────────
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !hasGps) return;

    const map = L.map(host, {
      zoomControl:        false,
      attributionControl: false,
      preferCanvas:       true,
      maxZoom:             22,
      zoomSnap:             0,
      wheelPxPerZoomLevel:  80,
    });

    // Racing lines — constant pixel weight, never fatten with zoom.
    L.polyline(data.latLngsB, {
      color:       colors.speed,
      weight:      2,
      opacity:     1,
      interactive: false,
    }).addTo(map);
    L.polyline(data.latLngsA, {
      color:       colors.target,
      weight:      2,
      dashArray:   "6 4",
      opacity:     1,
      interactive: false,
    }).addTo(map);

    // Cursor marker.
    markerRef.current = L.circleMarker(data.latLngsA[0] as L.LatLngTuple, {
      radius:      5,
      color:       "#ffffff",
      weight:      1.5,
      fillColor:   colors["delta-slow"],
      fillOpacity: 1,
      interactive: false,
    }).addTo(map);

    // Fit to full target lap on mount.
    map.fitBounds(L.latLngBounds(data.latLngsA), { padding: [20, 20] });

    // Hover → update synced cursor.
    map.on("mousemove", (e: L.LeafletMouseEvent) => {
      const idx = nearestLatLngIndex(data.latLngsA, e.latlng.lat, e.latlng.lng);
      if (idx < 0) return;
      const pct = data.latLngsA.length > 1 ? idx / (data.latLngsA.length - 1) : 0;
      setCursor({
        pct,
        x:       e.originalEvent.clientX,
        y:       e.originalEvent.clientY,
        active:  true,
      });
      const u = getAnyRegisteredChart();
      if (u) {
        const xs = u.data[0];
        if (xs && xs.length > 0) {
          const targetX = pct * (xs[xs.length - 1] as number);
          const left    = u.valToPos(targetX, "x");
          u.setCursor({ left, top: 0 });
        }
      }
    });
    map.on("mouseout", () => {
      clearCursor();
      const u = getAnyRegisteredChart();
      if (u) u.setCursor({ left: -10, top: -10 });
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current       = null;
      markerRef.current    = null;
      tileLayerRef.current = null;
    };
  }, [data, hasGps, setCursor, clearCursor]);

  // ── Toggle satellite tiles without recreating the map ────────────────
  // Attached in a separate effect so mode changes don't tear down the
  // whole map — zoom, pan, and cursor position persist across toggles.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (mode === "satellite" && !tileLayerRef.current) {
      tileLayerRef.current = L.tileLayer(SATELLITE_TILE_URL, {
        attribution:   SATELLITE_ATTRIBUTION,
        maxZoom:       22,
        maxNativeZoom: 20,
        detectRetina:  true,
      }).addTo(map);
    } else if (mode === "lines" && tileLayerRef.current) {
      tileLayerRef.current.remove();
      tileLayerRef.current = null;
    }
  }, [mode]);

  // ── Move cursor marker on store cursor updates ───────────────────────
  useEffect(() => {
    if (!mapRef.current || !markerRef.current || data.latLngsA.length === 0) return;
    const n   = data.latLngsA.length;
    const idx = Math.max(0, Math.min(n - 1, Math.round(cursorPct * (n - 1))));
    const pt  = data.latLngsA[idx];
    if (pt) markerRef.current.setLatLng(pt as L.LatLngTuple);
  }, [cursorPct, data]);

  // ── Fit map to zoomed dist range (sector click) ──────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || data.latLngsA.length === 0) return;

    if (zoom === null) {
      // Full lap.
      map.fitBounds(L.latLngBounds(data.latLngsA), { padding: [20, 20], animate: true });
      return;
    }

    // Slice latLngsA to the dist range.
    const pts = data.latLngsA.filter((_, i) => {
      const d = data.distA[i]!;
      return d >= zoom.min && d <= zoom.max;
    });
    if (pts.length < 2) return;
    map.fitBounds(L.latLngBounds(pts), { padding: [24, 24], animate: true });
  }, [zoom, data]);

  if (!hasGps) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-xs text-text-dim">
        No GPS data in this IBT — track map unavailable. (Fantasy circuits
        don't populate Lat/Lon.)
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <div
        ref={hostRef}
        className="h-full w-full"
        // Background visible in "lines" mode (no satellite tiles). Matches
        // the panel so the map looks like a native dark canvas.
        style={{ background: colors.panel }}
      />

      {/* Top-right mode toggle. z-[400] sits above Leaflet's panes. */}
      <button
        onClick={() => setMode((m) => (m === "satellite" ? "lines" : "satellite"))}
        title={mode === "satellite" ? "Switch to lines view" : "Switch to satellite view"}
        className="absolute right-2 top-2 z-[400] flex items-center gap-1 rounded-md border border-border bg-panel/90 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-text-secondary shadow hover:text-text-primary"
      >
        {mode === "satellite" ? <IconLines /> : <IconMap />}
        <span>{mode === "satellite" ? "Lines" : "Map"}</span>
      </button>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Zip lat[] / lon[] into [lat, lon] tuples, skipping zero pairs. */
function zipLatLng(lat: readonly number[], lon: readonly number[]): [number, number][] {
  const n = Math.min(lat.length, lon.length);
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const la = lat[i] as number;
    const lo = lon[i] as number;
    if (la === 0 && lo === 0) continue;
    out.push([la, lo]);
  }
  return out;
}

/** Like zipLatLng but also carries dist_m so the map can slice by range. */
function zipLatLngDist(
  lat:  readonly number[],
  lon:  readonly number[],
  dist: readonly number[],
): [number, number, number][] {
  const n = Math.min(lat.length, lon.length, dist.length);
  const out: [number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    const la = lat[i] as number;
    const lo = lon[i] as number;
    if (la === 0 && lo === 0) continue;
    out.push([la, lo, dist[i] as number]);
  }
  return out;
}

/** Index in `points` whose lat/lng is closest to (lat, lon). */
function nearestLatLngIndex(points: readonly [number, number][], lat: number, lon: number): number {
  let bestIdx = -1;
  let bestD2  = Infinity;
  for (let i = 0; i < points.length; i++) {
    const dLa = points[i]![0] - lat;
    const dLo = points[i]![1] - lon;
    const d2  = dLa * dLa + dLo * dLo;
    if (d2 < bestD2) { bestD2 = d2; bestIdx = i; }
  }
  return bestIdx;
}

/** Curving-path icon for "Lines only" mode. */
function IconLines() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12 C 5 12, 6 4, 9 4 S 14 12, 14 12" />
    </svg>
  );
}

/** Folded-map icon for "Satellite / Map" mode. */
function IconMap() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 3 L6 2 L10 4 L14 3 V13 L10 14 L6 12 L2 13 Z" />
      <path d="M6 2 V12" />
      <path d="M10 4 V14" />
    </svg>
  );
}
