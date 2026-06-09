import json
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Optional

DB_PATH = Path(__file__).parent / "data.db"


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db() -> None:
    with _connect() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS hosts (
                id        INTEGER PRIMARY KEY AUTOINCREMENT,
                address   TEXT NOT NULL UNIQUE,
                label     TEXT,
                added_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
                active    BOOLEAN DEFAULT 1
            );

            CREATE TABLE IF NOT EXISTS measurements (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                host_id     INTEGER REFERENCES hosts(id),
                timestamp   DATETIME DEFAULT CURRENT_TIMESTAMP,
                latency_ms  REAL,
                packet_loss REAL,
                status      TEXT
            );

            CREATE TABLE IF NOT EXISTS traceroutes (
                id        INTEGER PRIMARY KEY AUTOINCREMENT,
                host_id   INTEGER REFERENCES hosts(id),
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                hops      TEXT
            );

            CREATE TABLE IF NOT EXISTS port_checks (
                id        INTEGER PRIMARY KEY AUTOINCREMENT,
                host_id   INTEGER REFERENCES hosts(id),
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                port      INTEGER,
                open      BOOLEAN
            );
        """)


def add_host(address: str, label: Optional[str] = None) -> dict:
    with _connect() as conn:
        cur = conn.execute(
            "INSERT INTO hosts (address, label) VALUES (?, ?)",
            (address, label),
        )
        return dict(conn.execute(
            "SELECT * FROM hosts WHERE id = ?", (cur.lastrowid,)
        ).fetchone())


def get_hosts(active_only: bool = True) -> list[dict]:
    with _connect() as conn:
        if active_only:
            rows = conn.execute(
                "SELECT * FROM hosts WHERE active = 1 ORDER BY added_at"
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM hosts ORDER BY added_at"
            ).fetchall()
        return [dict(r) for r in rows]


def get_host(host_id: int) -> Optional[dict]:
    with _connect() as conn:
        row = conn.execute(
            "SELECT * FROM hosts WHERE id = ?", (host_id,)
        ).fetchone()
        return dict(row) if row else None


def deactivate_host(host_id: int) -> bool:
    with _connect() as conn:
        cur = conn.execute(
            "UPDATE hosts SET active = 0 WHERE id = ?", (host_id,)
        )
        return cur.rowcount > 0


# ── Measurements ───────────────────────────────────────────────────────────────

def save_measurement(
    host_id: int,
    latency_ms: Optional[float],
    packet_loss: Optional[float],
    status: str,
) -> dict:
    with _connect() as conn:
        cur = conn.execute(
            """INSERT INTO measurements (host_id, latency_ms, packet_loss, status)
               VALUES (?, ?, ?, ?)""",
            (host_id, latency_ms, packet_loss, status),
        )
        return dict(conn.execute(
            "SELECT * FROM measurements WHERE id = ?", (cur.lastrowid,)
        ).fetchone())


def get_measurements(host_id: int, limit: int = 100) -> list[dict]:
    with _connect() as conn:
        rows = conn.execute(
            """SELECT * FROM measurements WHERE host_id = ?
               ORDER BY timestamp DESC LIMIT ?""",
            (host_id, limit),
        ).fetchall()
        return [dict(r) for r in rows]


# ── Traceroutes ────────────────────────────────────────────────────────────────

def save_traceroute(host_id: int, hops: list[dict]) -> dict:
    with _connect() as conn:
        cur = conn.execute(
            "INSERT INTO traceroutes (host_id, hops) VALUES (?, ?)",
            (host_id, json.dumps(hops)),
        )
        return dict(conn.execute(
            "SELECT * FROM traceroutes WHERE id = ?", (cur.lastrowid,)
        ).fetchone())


def get_latest_traceroute(host_id: int) -> Optional[dict]:
    with _connect() as conn:
        row = conn.execute(
            """SELECT * FROM traceroutes WHERE host_id = ?
               ORDER BY timestamp DESC LIMIT 1""",
            (host_id,),
        ).fetchone()
        if row is None:
            return None
        result = dict(row)
        result["hops"] = json.loads(result["hops"])
        return result


# ── Port checks ────────────────────────────────────────────────────────────────

def save_port_check(host_id: int, port: int, open: bool) -> dict:
    with _connect() as conn:
        cur = conn.execute(
            "INSERT INTO port_checks (host_id, port, open) VALUES (?, ?, ?)",
            (host_id, port, open),
        )
        return dict(conn.execute(
            "SELECT * FROM port_checks WHERE id = ?", (cur.lastrowid,)
        ).fetchone())


def get_latest_port_checks(host_id: int) -> list[dict]:
    """Returns the most recent result for each port checked for this host."""
    with _connect() as conn:
        rows = conn.execute(
            """SELECT pc.*
               FROM port_checks pc
               INNER JOIN (
                   SELECT port, MAX(timestamp) AS max_ts
                   FROM port_checks WHERE host_id = ?
                   GROUP BY port
               ) latest ON pc.port = latest.port AND pc.timestamp = latest.max_ts
               WHERE pc.host_id = ?
               ORDER BY pc.port""",
            (host_id, host_id),
        ).fetchall()
        return [dict(r) for r in rows]
