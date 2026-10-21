/**
 * Shared telemetry types.
 *
 * The shapes here mirror the JSON returned by the Python sidecar. Keep this
 * file in sync with `sidecar/parser.py` — if you add a channel there, add
 * it here too.
 *
 * All numeric channels are stored as flat number[] arrays, which is what
 * uPlot consumes directly without any additional copying or reshaping.
 */

// ─── Session + lap list (from POST /parse-ibt) ─────────────────────────────

/** Metadata about the session the IBT was recorded in. */
export interface SessionInfo {
  track_name:    string;
  track_config:  string;
  car_name:      string;
  session_type:  string;
  driver_name:   string;   // driver in the cockpit
  sample_rate:   number;   // samples per second, usually 60
  total_samples: number;
}

/** Summary of one lap within the IBT — used by the lap picker. */
export interface LapSummary {
  lap_number:    number;
  lap_time:      number;    // seconds; 0 for incomplete laps
  valid:         boolean;   // completed a full circuit AND not an outlap/incomplete
  is_outlap:     boolean;
  is_inlap:      boolean;
  /**
   * True when the lap was aborted mid-way — iRacing's "active reset"
   * (pit reset, tow, reset to start/finish line in Offline Testing).
   * Detected by a physically-impossible avg-vs-peak-speed ratio or a
   * mid-lap backward jump in LapDistPct. Garage61 calls this "Incomplete".
   */
  is_incomplete: boolean;
  sample_count:  number;
}

/** Response body from `POST /parse-ibt`. */
export interface ParseIbtResponse {
  file_id: string;         // content-hash, used for subsequent lap fetches
  session: SessionInfo;
  laps:    LapSummary[];
}

// ─── Per-lap telemetry (from POST /lap-telemetry) ──────────────────────────

/**
 * Three tread temperatures per wheel.
 *
 * `inner`/`mid`/`outer` are relative to the car's centreline (inner = toward
 * the car body). The sidecar handles the per-wheel mapping from iRacing's
 * raw CL/CM/CR channels, so the UI doesn't need to care which side is which.
 */
export interface TireTempChannels {
  inner: number[];
  mid:   number[];
  outer: number[];
}

/** All four corners of tire-temperature data. */
export interface TireTemps {
  lf: TireTempChannels;
  rf: TireTempChannels;
  lr: TireTempChannels;
  rr: TireTempChannels;
}

/**
 * All per-sample channels for a single lap.
 *
 * Every array has the same length. Index `i` corresponds to the same
 * telemetry tick across every channel.
 */
export interface LapChannels {
  // X-axes (we pick one depending on user preference)
  time_in_lap: number[];   // seconds, zeroed at lap start
  dist_m:      number[];   // metres, zeroed at lap start
  dist_pct:    number[];   // 0 – 1

  // Primary display channels
  speed_kmh:          number[];
  throttle_pct:       number[];   // 0 – 100
  brake_pct:          number[];   // 0 – 100
  clutch_pct:         number[];   // 0 – 100
  gear:               number[];
  rpm:                number[];
  steering_deg:       number[];
  steering_torque_nm: number[];
  steering_ffb_pct:   number[];   // 0 – 100

  // Geospatial
  lat: number[];               // may be empty on tracks without lat/lon
  lon: number[];
  track_x: number[];           // dead-reckoned XY, always populated
  track_y: number[];

  // Tire temperatures (2x2 grid of panels)
  tire_temps: TireTemps;
}

/** Response body from `POST /lap-telemetry`. */
export interface LapTelemetry {
  lap_number:   number;
  lap_time:     number;
  sample_count: number;
  channels:     LapChannels;
}

// ─── Client-side derived types ─────────────────────────────────────────────

/** Which axis the stacked graphs use for x. */
export type XAxisMode = "distance" | "time";

/** Logical identifier for a channel row in the stacked-graph view. */
export type ChannelId =
  | "delta"
  | "speed"
  | "throttle"
  | "brake"
  | "clutch"
  | "gear"
  | "rpm"
  | "steering"
  | "steering_torque"
  | "ffb";
