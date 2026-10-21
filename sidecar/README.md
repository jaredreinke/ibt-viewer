# IBT Viewer — Sidecar

Local FastAPI service that parses iRacing `.ibt` telemetry files and serves
them to the web frontend. In production this service will be hosted alongside
p1doks.com; the API contract is identical in both environments.

## Requirements

- Python 3.11+
- `pip install -r requirements.txt`

`pyirsdk` is a Windows-first package because iRacing only runs on Windows.
It still installs and parses `.ibt` files fine on macOS/Linux — only the
live shared-memory API is Windows-only.

## Running

```bash
cd sidecar
python -m venv .venv
.venv\Scripts\activate        # Windows
# source .venv/bin/activate   # macOS/Linux
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Open <http://localhost:8000/docs> for the interactive OpenAPI explorer.

## Endpoints

### `GET /health`
Liveness probe. Returns `{"status": "ok", "version": "..."}`.

### `POST /parse-ibt`
`multipart/form-data` with a `file` field containing the `.ibt`. Returns:

```json
{
  "file_id": "sha256-hex-digest",
  "session": {
    "track_name": "Circuit of the Americas",
    "track_config": "Grand Prix",
    "car_name": "Porsche 911 GT3 R",
    "session_type": "Practice",
    "sample_rate": 60,
    "total_samples": 123456
  },
  "laps": [
    { "lap_number": 1, "lap_time": 128.4, "valid": false, "is_outlap": true,  "is_inlap": false, "sample_count": 7701 },
    { "lap_number": 2, "lap_time": 85.321, "valid": true,  "is_outlap": false, "is_inlap": false, "sample_count": 5119 }
  ]
}
```

### `POST /lap-telemetry`
JSON body: `{ "file_id": "...", "lap_number": 2 }`. Returns full per-sample
telemetry for the lap, with channels in display-ready units (km/h, degrees,
0-100%). See `parser.py` for the full channel list.

## Caching

Uploaded files land in `%TEMP%/ibt_viewer_cache/{sha256}.ibt`. Re-uploading
an identical file is free (same hash, no duplicate write). Clear the cache
by deleting that directory.
