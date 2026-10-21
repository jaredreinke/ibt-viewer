/**
 * Format a lap time (in seconds) as a human-readable `M:SS.sss` string.
 *
 * Examples:
 *   formatLapTime(85.321)  → "1:25.321"
 *   formatLapTime(128.05)  → "2:08.050"
 *   formatLapTime(0)       → "—"   (used for incomplete laps)
 */
export function formatLapTime(seconds: number): string {
  if (!seconds || seconds <= 0 || !Number.isFinite(seconds)) return "—";

  const minutes = Math.floor(seconds / 60);
  const remainder = seconds - minutes * 60;

  // Pad whole seconds to 2 digits, milliseconds to 3. The toFixed(3) output
  // is e.g. "8.050" or "23.789" — we pad the seconds portion manually.
  const [secPart, msPart] = remainder.toFixed(3).split(".");
  const paddedSec = secPart!.padStart(2, "0");

  return `${minutes}:${paddedSec}.${msPart}`;
}
