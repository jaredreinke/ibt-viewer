"""
IBT Viewer sidecar — FastAPI service.

Exposes two endpoints:

    POST /parse-ibt      — upload an IBT file, get session + lap-list metadata
    POST /lap-telemetry  — given a previously-uploaded file_id and lap number,
                           get full per-sample telemetry for that lap

Uploaded files are stored in a temp directory, keyed by a SHA-256 content
hash. Re-uploading the same file is idempotent and returns the cached
file_id immediately.

Run in development with:

    uvicorn main:app --reload --port 8000

The frontend (Vite dev server on :5173) is allowed via CORS.
"""

from __future__ import annotations

import hashlib
import shutil
import tempfile
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import parser as ibt_parser


# ─── Configuration ──────────────────────────────────────────────────────────

# Where uploaded IBT files are cached. A dedicated subdir of the system temp
# dir so nothing stomps on files outside it.
CACHE_DIR = Path(tempfile.gettempdir()) / "ibt_viewer_cache"
CACHE_DIR.mkdir(parents=True, exist_ok=True)

# Development origins allowed to call this service. In production these will
# be replaced with the p1doks.com origin list.
DEV_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]


# ─── App + middleware ───────────────────────────────────────────────────────

app = FastAPI(
    title="IBT Viewer Sidecar",
    description="Local parser service for iRacing .ibt telemetry files.",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=DEV_ORIGINS,
    allow_credentials=False,
    allow_methods=["POST", "GET", "OPTIONS"],
    allow_headers=["*"],
)


# ─── Request / response models ──────────────────────────────────────────────

class LapTelemetryRequest(BaseModel):
    """Body for POST /lap-telemetry."""
    file_id:    str
    lap_number: int


class HealthResponse(BaseModel):
    """Body for GET /health."""
    status:  str
    version: str


# ─── Helpers ────────────────────────────────────────────────────────────────

def _hash_file(path: Path) -> str:
    """
    Return the SHA-256 hex digest of the file at `path`.

    Used as the file_id so repeated uploads of identical content reuse the
    same cached file without re-reading disk.
    """
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):  # 1 MiB chunks
            h.update(chunk)
    return h.hexdigest()


def _cached_path(file_id: str) -> Path:
    """Return the on-disk path for a given file_id. Does not verify existence."""
    return CACHE_DIR / f"{file_id}.ibt"


# ─── Endpoints ──────────────────────────────────────────────────────────────

@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    """Liveness probe — used by the frontend to detect a running sidecar."""
    return HealthResponse(status="ok", version=app.version)


@app.post("/parse-ibt")
async def parse_ibt(file: UploadFile = File(...)) -> dict:
    """
    Accept an IBT file upload, cache it on disk, and return session metadata
    plus the lap list needed by the lap-picker UI.

    The response includes a `file_id` that the client must echo back to
    `POST /lap-telemetry` to fetch per-sample telemetry for a specific lap.
    """
    if not file.filename or not file.filename.lower().endswith(".ibt"):
        raise HTTPException(status_code=400, detail="File must have a .ibt extension")

    # Stream upload to a temp file first so we can hash and move it into the
    # cache under its content-addressed name.
    with tempfile.NamedTemporaryFile(delete=False, suffix=".ibt") as tmp:
        shutil.copyfileobj(file.file, tmp)
        staged_path = Path(tmp.name)

    try:
        file_id   = _hash_file(staged_path)
        dest_path = _cached_path(file_id)
        if not dest_path.exists():
            shutil.move(str(staged_path), str(dest_path))
        else:
            # Identical file already in the cache — drop the duplicate.
            staged_path.unlink(missing_ok=True)

        summary = ibt_parser.parse_summary(dest_path)
        return {"file_id": file_id, **summary}
    except Exception as e:
        # Clean up on failure so we don't leave a half-ingested file behind.
        staged_path.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail=f"Failed to parse IBT: {e}") from e


@app.get("/session/{file_id}")
def get_session(file_id: str) -> dict:
    """
    Return session metadata + lap list for an already-cached IBT.
    Useful for dev re-injection without re-uploading the file.
    """
    path = _cached_path(file_id)
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Unknown file_id '{file_id}'.")
    try:
        summary = ibt_parser.parse_summary(path)
        return {"file_id": file_id, **summary}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read session: {e}") from e


@app.post("/lap-telemetry")
def lap_telemetry(req: LapTelemetryRequest) -> dict:
    """
    Return full per-sample telemetry for a single lap from a previously-
    uploaded IBT. The `file_id` must come from a prior `POST /parse-ibt`.
    """
    path = _cached_path(req.file_id)
    if not path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"Unknown file_id '{req.file_id}'. Upload the IBT again.",
        )
    try:
        return ibt_parser.parse_lap_telemetry(path, req.lap_number)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read lap: {e}") from e
