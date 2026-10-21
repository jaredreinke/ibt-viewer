"""
Ad-hoc sanity test for the parser.

Runs `parse_summary` and `parse_lap_telemetry` against two real IBTs, then
prints a concise report so we can eyeball whether lap detection, unit
conversion, and channel extraction all look right before wiring up the HTTP
layer or the frontend.

Run from the sidecar directory with the venv activated:

    python test_parse.py
"""

from __future__ import annotations

import sys
from pathlib import Path

import parser as ibt_parser

# Windows default console is cp1252; force UTF-8 so arrow/degree chars render.
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# Two real IBTs to probe: one short Diogo reference lap, one full user session.
TEST_FILES = {
    "diogo (target)": Path(
        r"C:\Users\jared\Downloads\DiogoC.Pinto 2026-04-11 20-57 spielberg-gp "
        r"porsche9922cup 1.28.685 a19C t21C rh62% f2.414L.ibt"
    ),
    "jared (reference)": Path(
        r"C:\Users\jared\Documents\iRacing\telemetry\porsche9922cup_spielberg gp "
        r"2026-04-18 12-34-48.ibt"
    ),
}


def fmt_lap_time(seconds: float) -> str:
    """Render a lap time as M:SS.sss for human-readable output."""
    if seconds <= 0:
        return "  —  "
    m, s = divmod(seconds, 60.0)
    return f"{int(m)}:{s:06.3f}"


def best_valid_lap(laps: list[dict]) -> dict | None:
    """Pick the fastest valid lap out of a summary's lap list."""
    candidates = [lap for lap in laps if lap["valid"] and lap["lap_time"] > 0]
    if not candidates:
        return None
    return min(candidates, key=lambda lap: lap["lap_time"])


def run():
    for label, path in TEST_FILES.items():
        print(f"\n{'=' * 70}\n{label}\n{path}\n{'=' * 70}")
        if not path.exists():
            print(f"  [!] File missing — skipping")
            continue

        # ── /parse-ibt equivalent ──────────────────────────────────────────
        summary = ibt_parser.parse_summary(path)
        session = summary["session"]
        laps    = summary["laps"]

        print(f"  Track : {session['track_name']} ({session['track_config']})")
        print(f"  Car   : {session['car_name']}")
        print(f"  Type  : {session['session_type']}")
        print(f"  Rate  : {session['sample_rate']} Hz")
        print(f"  Total : {session['total_samples']} samples, "
              f"{len(laps)} laps")

        print(f"\n  {'Lap':>4}  {'Time':>8}  {'Samples':>7}  "
              f"{'Valid':>5}  {'Out':>3}  {'In':>3}  {'Incomp':>6}")
        for lap in laps:
            print(f"  {lap['lap_number']:>4}  "
                  f"{fmt_lap_time(lap['lap_time']):>8}  "
                  f"{lap['sample_count']:>7}  "
                  f"{('yes' if lap['valid'] else 'no'):>5}  "
                  f"{('yes' if lap['is_outlap'] else 'no'):>3}  "
                  f"{('yes' if lap['is_inlap'] else 'no'):>3}  "
                  f"{('yes' if lap['is_incomplete'] else 'no'):>6}")

        # ── /lap-telemetry equivalent — pick fastest valid lap ─────────────
        fast = best_valid_lap(laps)
        if fast is None:
            print(f"\n  [!] No valid laps to fetch telemetry for")
            continue

        telemetry = ibt_parser.parse_lap_telemetry(path, fast["lap_number"])
        ch        = telemetry["channels"]

        print(f"\n  Telemetry for lap {fast['lap_number']} "
              f"({fmt_lap_time(telemetry['lap_time'])}):")
        print(f"    samples        : {telemetry['sample_count']}")
        print(f"    dist_m range   : 0 → {ch['dist_m'][-1]:.1f} m")
        print(f"    speed_kmh max  : {max(ch['speed_kmh']):.1f}")
        print(f"    throttle peak  : {max(ch['throttle_pct']):.1f}%")
        print(f"    brake peak     : {max(ch['brake_pct']):.1f}%")
        print(f"    gear range     : {min(ch['gear'])} → {max(ch['gear'])}")
        print(f"    rpm peak       : {max(ch['rpm']):.0f}")
        print(f"    steering range : {min(ch['steering_deg']):.0f}° → "
              f"{max(ch['steering_deg']):.0f}°")
        print(f"    tire LF mid max: {max(ch['tire_temps']['lf']['mid']):.1f} °C")
        print(f"    track x range  : {min(ch['track_x']):.0f} → "
              f"{max(ch['track_x']):.0f} m")
        print(f"    track y range  : {min(ch['track_y']):.0f} → "
              f"{max(ch['track_y']):.0f} m")
        lat_populated = any(abs(v) > 0.0 for v in ch["lat"])
        print(f"    lat/lon        : "
              f"{'populated' if lat_populated else 'zeroed (fallback to dead-reckoning)'}")


if __name__ == "__main__":
    run()
