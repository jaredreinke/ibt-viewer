"""
IBT file parser.

Reads an iRacing .ibt telemetry file and produces two things:

1. A lightweight "summary" for the lap picker UI: track/car metadata plus a
   list of laps with their times and validity flags.
2. Full per-sample telemetry for a single lap, with all channels the viewer
   needs for the stacked graphs, track map, and tire-temp grid.

Design decisions
----------------
- **Stateless.** Each call re-opens the IBT. pyirsdk is fast enough that
  caching is not worth the complexity at MVP stage. If parsing shows up as a
  bottleneck later, add an LRU cache keyed on file path + mtime.
- **Unit conversion happens here.** The frontend never touches radians or m/s;
  we hand it km/h, degrees, and 0-100% values already normalised.
- **Tire temps are relabelled** from iRacing's raw `CL`/`CM`/`CR` (left/mid/
  right edge of the tire tread) to `inner`/`mid`/`outer` (relative to the car
  centreline). Which tread edge maps to "inner" depends on which side of the
  car the wheel is on — see TIRE_MAP below.
- **Track map uses dead-reckoning** from Speed + YawNorth rather than Lat/Lon.
  Lat/Lon is populated for most but not all iRacing tracks; dead-reckoning
  gives us a clean, closed shape on every circuit. Lat/Lon is still returned
  in the telemetry payload so the frontend can use it if it wants.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

import irsdk
import numpy as np


# ─── Constants ──────────────────────────────────────────────────────────────

# Minimum LapDistPct that a lap must reach before we consider it "complete".
# iRacing samples at 60 Hz, so a lap might stop slightly short of 1.0 even
# when fully driven — 0.95 is a safe floor.
COMPLETE_LAP_THRESHOLD = 0.95

# Maximum LapDistPct at which a lap is allowed to START to still be considered
# a clean, flying lap. Laps that begin mid-track are either outlaps from the
# pit exit or teleport artefacts from Offline Testing "Reset to pits".
LAP_START_THRESHOLD = 0.10

# Minimum duration (seconds) for a lap to be considered a real driven lap.
# iRacing's Offline Testing mode increments the Lap counter on pit resets
# and tow events, which can produce "laps" that are only 10-30 seconds long
# but still appear to cover most of LapDistPct (because the teleport jumps
# forward). A 30-second floor filters those without cutting real fast laps
# at even the shortest circuits (Lime Rock is still ~50 s).
MIN_LAP_DURATION_SEC = 30.0

# A "teleport backward" threshold in LapDistPct units. Inside a real driven
# lap, LapDistPct is strictly non-decreasing (modulo tiny floating-point
# noise). If any consecutive pair jumps backward by more than this amount,
# it's a pit-reset or tow teleport and the "lap" is not a real driven lap.
TELEPORT_BACKWARD_THRESHOLD = 0.1

# Physical-consistency buffer. Average speed across a lap can't exceed peak
# speed; if it does (by more than this multiplicative buffer for measurement
# noise) the "lap" is a session-reset artefact and its distance/time are
# inconsistent. 1.0 is the theoretical limit; 1.05 allows 5 % slack.
AVG_VS_PEAK_SPEED_BUFFER = 1.05

# Minimum number of samples for a lap to be considered at all. Anything shorter
# is likely a session-start artefact (entering the pit box, garage exit, etc).
MIN_LAP_SAMPLES = 10

# Maps each corner of the car to how iRacing's per-tread-edge temperature
# channels translate to `inner`/`mid`/`outer` relative to the car's
# centreline. We use the SURFACE temperature channels (`L`/`M`/`R`) rather
# than the carcass channels (`CL`/`CM`/`CR`): surface temps respond
# dynamically to braking/cornering load whereas carcass temps are a
# slow-moving average (verified experimentally — CL/CM/CR is pinned to
# one value per lap in the files we've checked).
#
# Rule of thumb: the tread edge closer to the car's body is the "inner"
# edge. For the LEFT front tire, the RIGHT edge (`R`) faces the car body,
# so `R` is "inner" for LF.
TIRE_MAP: dict[str, dict[str, str]] = {
    "lf": {"inner": "R", "mid": "M", "outer": "L"},
    "lr": {"inner": "R", "mid": "M", "outer": "L"},
    "rf": {"inner": "L", "mid": "M", "outer": "R"},
    "rr": {"inner": "L", "mid": "M", "outer": "R"},
}

# Unit conversion constants.
MPS_TO_KMH = 3.6            # metres per second  → kilometres per hour
RAD_TO_DEG = 180.0 / np.pi  # radians            → degrees


# ─── Helpers ────────────────────────────────────────────────────────────────

def _normalize_control(values: np.ndarray) -> np.ndarray:
    """
    Normalise a throttle/brake/clutch channel to 0.0 – 1.0.

    iRacing reports pedal channels on different scales depending on API
    version and car: usually 0-1, occasionally 0-100, 0-255, or 0-65535.
    We infer the scale from the maximum observed value.
    """
    if values.size == 0:
        return values
    peak = float(np.nanmax(values))
    if peak <= 1.0:
        divisor = 1.0
    elif peak <= 100.0:
        divisor = 100.0
    elif peak <= 255.0:
        divisor = 255.0
    else:
        divisor = 65535.0
    return np.clip(values / divisor, 0.0, 1.0)


def _get_channel(ibt: irsdk.IBT, name: str, dtype=np.float64) -> np.ndarray:
    """
    Safely read an IBT channel as a numpy array, returning an empty array
    if the channel is absent. Absence is common — not every sim build or
    car populates every channel (e.g. `Clutch` on some paddle-shift cars).
    """
    raw = ibt.get_all(name)
    return np.asarray(raw, dtype=dtype) if raw else np.array([], dtype=dtype)


def _read_session_yaml(ibt: irsdk.IBT) -> str:
    """
    Read the raw session-info YAML string out of the IBT's shared-memory
    buffer. pyirsdk's IBT class does not expose a parsed YAML dict, so we
    pull the bytes ourselves and let callers regex for the fields they need.
    """
    try:
        offset = ibt._header.session_info_offset
        length = ibt._header.session_info_len
        return ibt._shared_mem[offset:offset + length].rstrip(b"\x00").decode(
            "utf-8", errors="replace"
        )
    except Exception:
        return ""


def _extract_metadata(yaml_text: str) -> dict[str, str]:
    """
    Extract a few top-level fields from the session YAML using regexes.
    We do not use a real YAML parser because the file is huge (tens of KB)
    and we only need a handful of fields.

    IMPORTANT: Python's `\\s*` matches newlines by default, which previously
    caused empty fields to bleed the *next* line's value into the match
    (e.g. an empty `TrackConfigName:` would absorb `TrackCity: Talladega`).
    We use `[ \\t]*` instead so an empty field yields no match at all.
    """
    def pick(pattern: str) -> str:
        m = re.search(pattern, yaml_text)
        return m.group(1).strip() if m else ""

    return {
        "track_name":    pick(r"TrackDisplayName:[ \t]*(.+)"),
        "track_config":  pick(r"TrackConfigName:[ \t]*(.+)"),
        "car_name":      pick(r"CarScreenName:[ \t]*(.+)"),
        "session_type":  pick(r"SessionType:[ \t]*(.+)"),
        # First UserName in the YAML is the driver in the cockpit.
        "driver_name":   pick(r"UserName:[ \t]*(.+)"),
    }


# ─── Lap detection ──────────────────────────────────────────────────────────

@dataclass
class LapRange:
    """
    A slice of the IBT's sample arrays corresponding to a single lap.

    `start` / `end` are indices into the full per-tick arrays returned by
    `pyirsdk.IBT.get_all()`, with the usual Python half-open semantics
    (`arr[start:end]`).
    """
    lap_number: int
    start: int
    end: int


def _find_lap_ranges(lap_channel: np.ndarray) -> list[LapRange]:
    """
    Walk the `Lap` channel and return a LapRange for every contiguous run
    of samples that share a lap number.

    The iRacing `Lap` channel increments at the start/finish line, so each
    run of identical values is one lap's worth of samples.
    """
    if lap_channel.size == 0:
        return []

    ranges: list[LapRange] = []
    current_lap = int(lap_channel[0])
    run_start = 0

    for i in range(1, lap_channel.size):
        if int(lap_channel[i]) != current_lap:
            ranges.append(LapRange(current_lap, run_start, i))
            current_lap = int(lap_channel[i])
            run_start = i

    ranges.append(LapRange(current_lap, run_start, lap_channel.size))
    return ranges


def _classify_lap(
    lap_range: LapRange,
    dist_pct: np.ndarray,
    time_axis: np.ndarray,
    dist_m:    np.ndarray,
    speed:     np.ndarray,
    total_laps: int,
) -> dict:
    """
    Given a lap's sample range, decide whether it is valid (a complete
    timed lap), an outlap, or an inlap, and compute its lap time.

    "Lap time" is the duration of the sample window; this matches what
    iRacing reports as an official time for a complete lap, and is a
    reasonable-but-approximate number for incomplete laps.

    Laps that were interrupted by an iRacing "active reset" (pit reset,
    tow to pits, reset to start/finish line in Offline Testing) are marked
    as incomplete. Active resets preserve monotonic LapDistPct but produce
    a lap whose reported distance-covered is physically impossible to have
    driven at the observed peak speed — we reject laps where the average
    speed required (distance / duration) exceeds the observed peak speed.
    """
    slice_dist  = dist_pct [lap_range.start:lap_range.end]
    slice_time  = time_axis[lap_range.start:lap_range.end]
    slice_distm = dist_m   [lap_range.start:lap_range.end] if dist_m.size else np.array([])
    slice_speed = speed    [lap_range.start:lap_range.end] if speed.size  else np.array([])

    sample_count = slice_dist.size
    if sample_count < MIN_LAP_SAMPLES:
        # Too few samples to classify meaningfully — treat as incomplete.
        return {
            "lap_number":    lap_range.lap_number,
            "lap_time":      0.0,
            "valid":         False,
            "is_outlap":     lap_range.lap_number <= 1,
            "is_inlap":      lap_range.lap_number >= total_laps,
            "is_incomplete": True,
            "sample_count":  sample_count,
        }

    lap_time   = float(slice_time[-1] - slice_time[0])
    start_pct  = float(slice_dist[0])
    end_pct    = float(slice_dist[-1])
    max_pct    = float(slice_dist.max())

    # Teleport detection: LapDistPct is strictly non-decreasing within a real
    # lap, so a big backward jump means a pit-reset / tow happened mid-lap.
    has_teleport = bool(np.any(np.diff(slice_dist) < -TELEPORT_BACKWARD_THRESHOLD))

    # Physical-consistency check: `avg_speed = distance / duration` cannot
    # exceed the peak speed observed within the lap. If it does, the "lap"
    # was seeded by an iRacing active reset (pit reset, tow, reset to S/F
    # line in Offline Testing) — the `Lap` counter incremented without the
    # driver actually driving the distance, so the recorded time + distance
    # are inconsistent. Garage61 calls this state "Incomplete".
    physically_inconsistent = False
    if slice_distm.size and slice_speed.size and lap_time > 0:
        dist_covered = float(slice_distm[-1] - slice_distm[0])
        peak_speed   = float(slice_speed.max())
        avg_speed    = dist_covered / lap_time if lap_time > 0 else 0.0
        # Only check when we actually have forward progression to reason about;
        # a zero/negative dist_covered is its own failure mode handled below.
        if peak_speed > 0 and avg_speed > peak_speed * AVG_VS_PEAK_SPEED_BUFFER:
            physically_inconsistent = True

    # A lap is "incomplete" (aborted mid-way) when any signal we have says
    # the driver did not drive the full lap: a teleport event, a physically
    # impossible average speed, or a too-short duration given a full-distance
    # reading.
    is_incomplete = (
        has_teleport
        or physically_inconsistent
        or lap_time < MIN_LAP_DURATION_SEC
    )

    # A lap is a "clean, full lap" iff it starts near the line, ends near the
    # line, and was not aborted by any incomplete signal.
    completed = (
        start_pct < LAP_START_THRESHOLD
        and max_pct  >= COMPLETE_LAP_THRESHOLD
        and end_pct  >= COMPLETE_LAP_THRESHOLD
        and not is_incomplete
    )

    # Outlap: first lap of a session, or a short one that starts mid-track
    # (typical of leaving the pit lane and joining track partway through).
    is_outlap = (lap_range.lap_number <= 1) or (
        start_pct > LAP_START_THRESHOLD and not completed
    )
    # Inlap: the last lap in the file if it didn't fully complete.
    is_inlap = (lap_range.lap_number >= total_laps) and not completed

    return {
        "lap_number":    lap_range.lap_number,
        "lap_time":      round(lap_time, 3),
        "valid":         completed and not is_outlap,
        "is_outlap":     is_outlap,
        "is_inlap":      is_inlap,
        "is_incomplete": is_incomplete,
        "sample_count":  sample_count,
    }


# ─── Public API ─────────────────────────────────────────────────────────────

def parse_summary(filepath: str | Path) -> dict:
    """
    Parse the IBT at `filepath` and return a summary: session metadata plus
    a list of laps. Does NOT return per-sample telemetry — call
    `parse_lap_telemetry()` for that.

    Returns a dict shaped like:

        {
            "session": {
                "track_name":    str,
                "track_config":  str,
                "car_name":      str,
                "session_type":  str,
                "driver_name":   str,    # driver in the cockpit
                "sample_rate":   int,    # samples per second
                "total_samples": int,
            },
            "laps": [
                {
                    "lap_number":   int,
                    "lap_time":     float,  # seconds
                    "valid":        bool,
                    "is_outlap":    bool,
                    "is_inlap":     bool,
                    "sample_count": int,
                },
                ...
            ],
        }
    """
    ibt = irsdk.IBT()
    ibt.open(str(filepath))
    try:
        total_samples = ibt._disk_header.session_record_count
        if total_samples == 0:
            raise ValueError("IBT file contains no samples")

        lap_channel = _get_channel(ibt, "Lap", dtype=np.int32)
        time_axis   = _get_channel(ibt, "SessionTime")
        dist_pct    = _get_channel(ibt, "LapDistPct")
        dist_m      = _get_channel(ibt, "LapDist")
        speed_mps   = _get_channel(ibt, "Speed")

        if lap_channel.size == 0 or time_axis.size == 0 or dist_pct.size == 0:
            raise ValueError("Required channels missing from IBT file")

        # Sample rate from the IBT header (usually 60 Hz).
        sample_rate = int(getattr(ibt._disk_header, "session_record_rate", 60))

        metadata = _extract_metadata(_read_session_yaml(ibt))

        lap_ranges = _find_lap_ranges(lap_channel)
        total_laps = max((r.lap_number for r in lap_ranges), default=0)

        laps = [
            _classify_lap(r, dist_pct, time_axis, dist_m, speed_mps, total_laps)
            for r in lap_ranges
        ]

        return {
            "session": {
                **metadata,
                "sample_rate":   sample_rate,
                "total_samples": int(total_samples),
            },
            "laps": laps,
        }
    finally:
        ibt.close()


def parse_lap_telemetry(filepath: str | Path, lap_number: int) -> dict:
    """
    Parse the IBT at `filepath` and return full per-sample telemetry for the
    given `lap_number`.

    All channels are returned in display-ready units (km/h, degrees, 0-100%)
    so the frontend can plot them directly. See module docstring for the
    tire-temp relabelling convention.

    Raises ValueError if the lap is not present or has no samples.
    """
    ibt = irsdk.IBT()
    ibt.open(str(filepath))
    try:
        lap_channel = _get_channel(ibt, "Lap", dtype=np.int32)
        if lap_channel.size == 0:
            raise ValueError("IBT file has no Lap channel")

        lap_ranges = _find_lap_ranges(lap_channel)
        target = next(
            (r for r in lap_ranges if r.lap_number == lap_number), None
        )
        if target is None:
            raise ValueError(f"Lap {lap_number} not found in IBT file")

        s, e = target.start, target.end

        # ── Core channels used for plotting and the x-axis ─────────────────
        session_time = _get_channel(ibt, "SessionTime")[s:e]
        dist_pct     = _get_channel(ibt, "LapDistPct")[s:e]
        dist_m       = _get_channel(ibt, "LapDist")[s:e]
        speed_mps    = _get_channel(ibt, "Speed")[s:e]
        gear         = _get_channel(ibt, "Gear", dtype=np.int32)[s:e]
        rpm          = _get_channel(ibt, "RPM")[s:e]
        steer_rad    = _get_channel(ibt, "SteeringWheelAngle")[s:e]
        steer_torque = _get_channel(ibt, "SteeringWheelTorque")[s:e]
        steer_ffb    = _get_channel(ibt, "SteeringWheelPctTorque")[s:e]

        # ── Pedal inputs (normalised to 0-100 %) ───────────────────────────
        # ThrottleRaw is the raw pedal position; Throttle is engine demand
        # (sometimes clipped by traction control). Prefer Raw when present.
        throttle_raw  = _get_channel(ibt, "ThrottleRaw")
        throttle_base = throttle_raw if throttle_raw.size else _get_channel(ibt, "Throttle")
        throttle      = _normalize_control(throttle_base[s:e]) * 100.0
        brake         = _normalize_control(_get_channel(ibt, "Brake")[s:e]) * 100.0
        clutch        = _normalize_control(_get_channel(ibt, "Clutch")[s:e]) * 100.0
        ffb_pct       = _normalize_control(steer_ffb) * 100.0

        # ── Geospatial (optional; not all tracks populate Lat/Lon) ─────────
        lat = _get_channel(ibt, "Lat")[s:e]
        lon = _get_channel(ibt, "Lon")[s:e]

        # ── Track map via dead-reckoning (Speed + YawNorth) ────────────────
        # YawNorth is the car's heading in radians, clockwise from geographic
        # North. Integrate Speed·sin(yaw)·dt east-ward and Speed·cos(yaw)·dt
        # north-ward to get a lap-relative XY track shape.
        yaw_north = _get_channel(ibt, "YawNorth")[s:e]
        if yaw_north.size == speed_mps.size and speed_mps.size > 1:
            dt = np.concatenate(([0.0], np.diff(session_time)))
            track_x = np.cumsum(speed_mps * np.sin(yaw_north) * dt)
            track_y = np.cumsum(speed_mps * np.cos(yaw_north) * dt)
        else:
            track_x = np.array([])
            track_y = np.array([])

        # ── Tire temperatures ──────────────────────────────────────────────
        # Relabel CL/CM/CR → inner/mid/outer according to TIRE_MAP so the UI
        # doesn't need to know the per-wheel convention.
        tire_temps: dict[str, dict[str, list[float]]] = {}
        for corner, edge_map in TIRE_MAP.items():
            prefix = corner.upper()  # "LF", "RF", ...
            tire_temps[corner] = {
                label: _get_channel(ibt, f"{prefix}temp{edge}")[s:e].tolist()
                for label, edge in edge_map.items()
            }

        # ── Derived display values ─────────────────────────────────────────
        speed_kmh        = speed_mps * MPS_TO_KMH
        steering_deg     = steer_rad * RAD_TO_DEG
        time_in_lap      = session_time - (session_time[0] if session_time.size else 0.0)
        # LapDist can reset at the start line; zero it to lap start for a
        # clean x-axis starting at 0 metres.
        dist_m_in_lap    = dist_m - (dist_m[0] if dist_m.size else 0.0)

        return {
            "lap_number":   lap_number,
            "lap_time":     float(time_in_lap[-1]) if time_in_lap.size else 0.0,
            "sample_count": int(e - s),
            "channels": {
                "time_in_lap":        time_in_lap.tolist(),
                "dist_m":             dist_m_in_lap.tolist(),
                "dist_pct":           dist_pct.tolist(),
                "speed_kmh":          speed_kmh.tolist(),
                "throttle_pct":       throttle.tolist(),
                "brake_pct":          brake.tolist(),
                "clutch_pct":         clutch.tolist(),
                "gear":               gear.tolist(),
                "rpm":                rpm.tolist(),
                "steering_deg":       steering_deg.tolist(),
                "steering_torque_nm": steer_torque.tolist(),
                "steering_ffb_pct":   ffb_pct.tolist(),
                "lat":                lat.tolist(),
                "lon":                lon.tolist(),
                "track_x":            track_x.tolist(),
                "track_y":            track_y.tolist(),
                "tire_temps":         tire_temps,
            },
        }
    finally:
        ibt.close()
