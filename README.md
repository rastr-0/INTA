# Network Health Dashboard

Real-time monitoring of network availability and performance for arbitrary hosts.
The backend continuously pings hosts, runs traceroutes, and checks port availability.
Results stream live to the browser via WebSockets and are persisted in SQLite.

## Tech stack

- **Backend:** Python, FastAPI, WebSockets, SQLite
- **Frontend:** HTML / CSS / JS, Chart.js

## Quick start

```bash
# 1. Create and activate virtual environment
python3 -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate

# 2. Install dependencies
pip install -r backend/requirements.txt

# 3. Run the backend
uvicorn backend.main:app --reload --port 8000

# 4. Open the frontend
# Just open frontend/index.html in your browser (no build step needed).
```

The API will be available at `http://localhost:8000`.
Interactive API docs (Swagger UI) at `http://localhost:8000/docs`.

## Project structure

```
project/
├── backend/
│   ├── main.py          # FastAPI app entry point
│   ├── monitor.py       # Ping / traceroute / port-check logic
│   ├── database.py      # SQLite setup and queries
│   ├── models.py        # Pydantic schemas
│   └── requirements.txt
├── frontend/
│   ├── index.html
│   ├── app.js
│   └── style.css
└── README.md
```

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `MONITOR_INTERVAL` | `30` | Seconds between ping cycles |
| `DB_PATH` | `backend/data.db` | SQLite database file location |
