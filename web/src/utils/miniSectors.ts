/**
 * Mini-sector computation.
 *
 * Each sector spans from the braking entry of one turn through the following
 * straight to the braking entry of the next turn:
 *
 *   sector[i].start = 1 s before throttle lifts for turn i
 *   sector[i].end   = 1 s before throttle lifts for turn i+1
 *                     (last sector ends at the lap finish line)
 *
 * There are no separate "straight" sectors — the straight after a turn
 * belongs to that turn's sector.
 *
 * Adjacent turns separated by < MERGE_GAP_S seconds (chicanes) are merged
 * into a single sector labelled "T3-4" style.
 */

import type { LapTelemetry } from "@/types/telemetry";
import { linearResample } from "./interpolate";

// ─── Thresholds ──────────────────────────────────────────────────────────────

const THROTTLE_OFF  = 15;   // % — below here throttle is "off"
const THROTTLE_ON   = 85;   // % — above here throttle is "fully on"
const LOOKBACK_S    = 1.0;  // seconds before lift → sector/zoom start
const LOOKFORWARD_S = 1.0;  // seconds after apply → zoom end
const MERGE_GAP_S   = 0.8;  // merge adjacent turns if gap < this
const MIN_LIFT_S    = 0.15; // ignore blips shorter than this

// ─── Public types ────────────────────────────────────────────────────────────

export interface MiniSector {
  id:        string;   // "T1", "T2", "T3-4", …
  /** Timing boundaries: braking entry → next braking entry (full sector). */
  distStart: number;
  distEnd:   number;
  /** Zoom boundaries: just the corner itself — braking entry → 1 s after full throttle. */
  zoomStart: number;
  zoomEnd:   number;
  timeA:     number;   // target lap time in sector (seconds)
  timeB:     number;   // reference lap time in sector (seconds)
  delta:     number;   // timeA − timeB: negative = target faster
}

// ─── Entry point ─────────────────────────────────────────────────────────────

export function computeMiniSectors(
  telA: LapTelemetry,
  telB: LapTelemetry,
): MiniSector[] {
  const throttle = telA.channels.throttle_pct;
  const time     = telA.channels.time_in_lap;
  const dist     = telA.channels.dist_m;
  const n        = throttle.length;
  if (n < 2) return [];

  // 1. Find the distance of every sector boundary (1 s before each lift).
  const boundaries = findBoundaryDists(throttle, time, dist);
  if (boundaries.length === 0) return [];

  // 2. Merge boundaries that are < MERGE_GAP_S apart.
  const merged = mergeBoundaries(boundaries, time, dist);

  // 3. Build sectors: timing spans boundary[i]→boundary[i+1];
  //    zoom spans boundary[i]→cornerEnd[i] (tight corner view).
  const lapEnd = dist[n - 1]!;
  const zones: { start: number; end: number; zoomEnd: number; indices: number[] }[] = [];
  for (let i = 0; i < merged.length; i++) {
    zones.push({
      start:   merged[i]!.dist,
      end:     i + 1 < merged.length ? merged[i + 1]!.dist : lapEnd,
      zoomEnd: merged[i]!.cornerEndDist,
      indices: merged[i]!.rawIndices,
    });
  }

  // 4. Label and attach timing.
  return zones.map((z) => {
    const first = z.indices[0]! + 1;
    const last  = z.indices[z.indices.length - 1]! + 1;
    const id    = first === last ? `S${first}` : `S${first}-${last}`;
    const timing = sectorTimes(z.start, z.end, telA, telB);
    return { id, zoomStart: z.start, zoomEnd: z.zoomEnd, ...timing };
  });
}

// ─── Step 1: boundary distances ──────────────────────────────────────────────

interface RawBoundary {
  dist:         number;  // 1 s before lift — sector + zoom start
  cornerEndDist: number; // 1 s after full throttle — zoom end
  rawIndex:     number;
}

function findBoundaryDists(
  throttle: number[],
  time:     number[],
  dist:     number[],
): RawBoundary[] {
  const n   = throttle.length;
  const out: RawBoundary[] = [];
  let i = 0;
  let rawIndex = 0;

  while (i < n) {
    if (throttle[i]! >= THROTTLE_OFF) { i++; continue; }

    const liftIdx = i;

    // Find where throttle comes back up — skip blips.
    let j = liftIdx;
    while (j < n && throttle[j]! < THROTTLE_ON) j++;
    if (j >= n) break;
    if (time[j]! - time[liftIdx]! < MIN_LIFT_S) { i = j; continue; }

    // Sector/zoom start: 1 s before the lift.
    const tStart = time[liftIdx]! - LOOKBACK_S;
    const startIdx = timeToIndex(time, tStart);

    // Zoom end: 1 s after throttle application.
    const tEnd   = time[j]! + LOOKFORWARD_S;
    const endIdx = timeToIndex(time, tEnd);

    out.push({
      dist:          dist[startIdx]!,
      cornerEndDist: dist[endIdx]!,
      rawIndex:      rawIndex++,
    });

    i = j + 1;
  }

  return out;
}

function timeToIndex(time: number[], t: number): number {
  const n = time.length;
  if (t <= time[0]!) return 0;
  if (t >= time[n - 1]!) return n - 1;
  let lo = 0, hi = n - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (time[mid]! <= t) lo = mid; else hi = mid;
  }
  return Math.abs(time[lo]! - t) <= Math.abs(time[hi]! - t) ? lo : hi;
}

// ─── Step 2: merge chicane boundaries ────────────────────────────────────────

interface MergedBoundary {
  dist:         number;   // sector/zoom start
  cornerEndDist: number;  // zoom end (farthest apply+1s across merged corners)
  rawIndices:   number[];
}

function mergeBoundaries(
  raw:  RawBoundary[],
  time: number[],
  dist: number[],
): MergedBoundary[] {
  if (raw.length === 0) return [];

  const distToTime = (d: number): number => {
    let lo = 0, hi = dist.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (dist[mid]! <= d) lo = mid; else hi = mid;
    }
    const frac = (d - dist[lo]!) / (dist[hi]! - dist[lo]!);
    const t    = time[lo]! + frac * (time[hi]! - time[lo]!);
    return Number.isFinite(t) ? t : time[lo]!;
  };

  const out: MergedBoundary[] = [];
  let cur: MergedBoundary = {
    dist:          raw[0]!.dist,
    cornerEndDist: raw[0]!.cornerEndDist,
    rawIndices:    [raw[0]!.rawIndex],
  };

  for (let i = 1; i < raw.length; i++) {
    const gap = distToTime(raw[i]!.dist) - distToTime(cur.dist);
    if (gap < MERGE_GAP_S) {
      // Chicane: keep earliest start, extend zoom end to cover both corners.
      cur.cornerEndDist = Math.max(cur.cornerEndDist, raw[i]!.cornerEndDist);
      cur.rawIndices.push(raw[i]!.rawIndex);
    } else {
      out.push(cur);
      cur = {
        dist:          raw[i]!.dist,
        cornerEndDist: raw[i]!.cornerEndDist,
        rawIndices:    [raw[i]!.rawIndex],
      };
    }
  }
  out.push(cur);
  return out;
}

// ─── Timing ──────────────────────────────────────────────────────────────────

function sectorTimes(
  distStart: number,
  distEnd:   number,
  telA:      LapTelemetry,
  telB:      LapTelemetry,
): Omit<MiniSector, "id"> {
  const xA    = Float64Array.from(telA.channels.dist_m);
  const tA    = telA.channels.time_in_lap;
  const tBonA = linearResample(telB.channels.dist_m, telB.channels.time_in_lap, xA);

  const i0    = nearestIndex(xA, distStart);
  const i1    = nearestIndex(xA, distEnd);
  const timeA = tA[i1]!  - tA[i0]!;
  const timeB = tBonA[i1]! - tBonA[i0]!;

  return { distStart, distEnd, timeA, timeB, delta: timeA - timeB };
}

function nearestIndex(arr: Float64Array, target: number): number {
  let lo = 0, hi = arr.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid]! < target) lo = mid + 1; else hi = mid;
  }
  return lo;
}
