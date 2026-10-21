import type { CSSProperties, ReactNode } from "react";

/**
 * Dark card with a blue left-accent border.
 *
 * Visual language matches the reference design: near-black background with a
 * subtle top-to-bottom gradient, a 3 px blue accent on the left edge, and a
 * soft drop shadow. The `subtle` prop tones down the title text for secondary
 * cards (Laps, Gaps) vs primary ones (Track Map, Telemetry).
 */
interface PanelProps {
  title?:       string;
  subtle?:      boolean;
  headerRight?: ReactNode;
  className?:   string;
  bodyClass?:   string;
  children?:    ReactNode;
}

const CARD_STYLE: CSSProperties = {
  border:     "1px solid rgba(255,255,255,0.07)",
  background: "linear-gradient(135deg, rgba(255,255,255,0.025) 0%, rgba(255,255,255,0.005) 100%), #141414",
  boxShadow:  "0 10px 15px rgba(0,0,0,0.4), 0 4px 6px rgba(0,0,0,0.25)",
};

export default function Panel({
  title,
  subtle,
  headerRight,
  className = "",
  bodyClass = "p-3",
  children,
}: PanelProps) {
  return (
    <div
      className={`flex flex-col rounded-md ${className}`}
      style={CARD_STYLE}
    >

      {title !== undefined && (
        <div
          className={`flex items-center justify-between border-b px-3 py-2 text-[11px] font-semibold uppercase tracking-wider ${
            subtle ? "text-text-dim" : "text-text-secondary"
          }`}
          style={{ borderBottomColor: "rgba(255,255,255,0.07)" }}
        >
          <span>{title}</span>
          {headerRight && <span>{headerRight}</span>}
        </div>
      )}
      <div className={`flex-1 ${bodyClass}`}>{children}</div>
    </div>
  );
}
