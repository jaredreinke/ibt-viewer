"""List all channels present in an IBT file, filtered to tire-related ones."""

import sys
import irsdk

path = r"C:\Users\jared\Downloads\DiogoC.Pinto 2026-04-11 20-57 spielberg-gp porsche9922cup 1.28.685 a19C t21C rh62% f2.414L.ibt"

ibt = irsdk.IBT()
ibt.open(path)
try:
    # pyirsdk's IBT exposes the var headers via `_var_headers` (list) and
    # we can inspect each header's name/type/description.
    headers = ibt._var_headers
    names = [h.name for h in headers]

    # Print tire-related channel names so we can see exactly what iRacing
    # provides in this IBT.
    print("=== TIRE / TYRE CHANNELS ===")
    tire_names = [n for n in names if any(
        k in n for k in ["tire", "Tire", "tyre", "Tyre", "temp", "Temp", "LF", "RF", "LR", "RR", "wear", "Wear"]
    )]
    for n in sorted(tire_names):
        print(f"  {n}")

    print(f"\nTotal tire-ish channels: {len(tire_names)}")
    print(f"Total channels in file:  {len(names)}")

    # Print a sample of values for each LF temp channel we can find, to
    # see which one actually varies during the lap.
    print("\n=== LF TEMP CHANNELS — first sample + min/max across file ===")
    lf_temps = [n for n in names if n.startswith("LFtemp")]
    for n in lf_temps:
        vals = ibt.get_all(n)
        if vals:
            lo = min(vals)
            hi = max(vals)
            print(f"  {n:20s}  first={vals[0]:.3f}  min={lo:.3f}  max={hi:.3f}  range={hi-lo:.3f}")
finally:
    ibt.close()
