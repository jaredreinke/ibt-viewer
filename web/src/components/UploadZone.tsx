import { useRef, useState } from "react";

/**
 * File drop zone for .ibt uploads.
 *
 * Accepts a file via either drag-and-drop or a hidden file input (clicking
 * the zone opens the picker). Only files with a `.ibt` extension are
 * accepted; others are rejected with an inline error that clears on the
 * next drag/click.
 *
 * Parent owns the upload/parse lifecycle — this component is presentational
 * plus the single `onFile` callback.
 */
interface UploadZoneProps {
  /** Called when the user picks a valid .ibt file. */
  onFile:   (file: File) => void;
  /** Visible when true; hides the zone while upload is in progress. */
  disabled?: boolean;
  /** Short hint shown above the drop target. */
  hint?:     string;
}

export default function UploadZone({ onFile, disabled, hint }: UploadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [hovering, setHovering] = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  /** Validate + forward a file, or show an error. */
  function handleFile(file: File | undefined | null) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".ibt")) {
      setError("File must have a .ibt extension");
      return;
    }
    setError(null);
    onFile(file);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setHovering(false);
    if (disabled) return;
    handleFile(e.dataTransfer.files[0]);
  }

  return (
    <div
      onClick={() => !disabled && inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setHovering(true); }}
      onDragLeave={() => setHovering(false)}
      onDrop={onDrop}
      className={[
        "flex flex-col items-center justify-center rounded-md border-2 border-dashed p-8 text-center transition-colors",
        disabled
          ? "cursor-wait border-border bg-raised/50 text-text-dim"
          : "cursor-pointer border-border bg-raised hover:border-delta hover:bg-raised/80",
        hovering && !disabled
          ? "border-delta bg-raised/80 shadow-glow-purple"
          : "",
      ].join(" ")}
    >
      <div className="mb-1 text-sm text-text-primary">
        {disabled ? "Parsing…" : "Drop .ibt file here"}
      </div>
      {hint && !disabled && (
        <div className="text-xs text-text-dim">{hint}</div>
      )}
      {error && (
        <div className="mt-2 text-xs text-delta-slow">{error}</div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept=".ibt"
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
    </div>
  );
}
