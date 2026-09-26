"""SQLite persistence (docs/CONTRACT.md §10). One connection, used only from the event-loop thread.
Timestamps are wall-clock epoch seconds. Schema changes are appended to MIGRATIONS, never edited."""
import json
import sqlite3
from dataclasses import dataclass
from pathlib import Path

from app.models import Settings

MIGRATIONS: list[str] = [
    """
    CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE gm_pin (id INTEGER PRIMARY KEY CHECK (id = 1), hash TEXT NOT NULL);
    CREATE TABLE gm_sessions (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        created_at REAL NOT NULL,
        expires_at REAL NOT NULL,
        last_seen_at REAL,
        address TEXT,
        user_agent TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE devices (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        view TEXT NOT NULL,
        max_fps INTEGER NOT NULL DEFAULT 15,
        low_motion INTEGER NOT NULL DEFAULT 0,
        created_at REAL NOT NULL,
        last_seen_at REAL,
        address TEXT,
        approved_address TEXT
    );
    CREATE TABLE phones (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        host TEXT NOT NULL,
        port INTEGER NOT NULL,
        manual INTEGER NOT NULL,
        torch_on INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE slots (
        slot INTEGER PRIMARY KEY CHECK (slot BETWEEN 1 AND 4),
        phone_id TEXT UNIQUE REFERENCES phones(id) ON DELETE SET NULL,
        room TEXT NOT NULL DEFAULT ''
    );
    INSERT INTO slots (slot) VALUES (1), (2), (3), (4);
    """,
]


@dataclass
class DeviceRow:
    id: str
    token_hash: str
    name: str
    view: str
    max_fps: int
    low_motion: bool
    created_at: float
    last_seen_at: float | None
    address: str | None
    approved_address: str | None


@dataclass
class GmSessionRow:
    id: str
    token_hash: str
    created_at: float
    expires_at: float
    last_seen_at: float | None
    address: str | None
    user_agent: str


@dataclass
class PhoneRow:
    id: str
    name: str
    host: str
    port: int
    manual: bool


@dataclass
class SlotRow:
    slot: int
    phone_id: str | None
    room: str


_DEVICE_FIELDS = {"name", "view", "max_fps", "low_motion", "last_seen_at", "address", "approved_address"}


class Storage:
    def __init__(self, conn: sqlite3.Connection) -> None:
        self._db = conn

    @classmethod
    def open(cls, path: Path) -> "Storage":
        path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(path, isolation_level=None, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        storage = cls(conn)
        storage._migrate()
        return storage

    def close(self) -> None:
        self._db.close()

    def _migrate(self) -> None:
        version = self._db.execute("PRAGMA user_version").fetchone()[0]
        for index in range(version, len(MIGRATIONS)):
            self._db.executescript(f"BEGIN; {MIGRATIONS[index]} PRAGMA user_version = {index + 1}; COMMIT;")

    # ------------------------------------------------------------------ settings

    def get_settings(self) -> Settings:
        row = self._db.execute("SELECT value FROM kv WHERE key = 'settings'").fetchone()
        return Settings.model_validate_json(row["value"]) if row else Settings()

    def update_settings(self, **fields) -> Settings:
        current = self.get_settings().model_dump()
        current.update({k: v for k, v in fields.items() if v is not None})
        settings = Settings.model_validate(current)
        self._db.execute(
            "INSERT INTO kv (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (settings.model_dump_json(),),
        )
        return settings

    def get_json(self, key: str) -> object | None:
        row = self._db.execute("SELECT value FROM kv WHERE key = ?", (key,)).fetchone()
        return json.loads(row["value"]) if row else None

    def set_json(self, key: str, value: object) -> None:
        self._db.execute(
            "INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, json.dumps(value)),
        )

    # ------------------------------------------------------------------ GM PIN and sessions

    def get_pin_hash(self) -> str | None:
        row = self._db.execute("SELECT hash FROM gm_pin WHERE id = 1").fetchone()
        return row["hash"] if row else None

    def set_pin_hash_if_absent(self, pin_hash: str) -> bool:
        cur = self._db.execute("INSERT OR IGNORE INTO gm_pin (id, hash) VALUES (1, ?)", (pin_hash,))
        return cur.rowcount == 1

    def set_pin_hash(self, pin_hash: str) -> None:
        self._db.execute("INSERT INTO gm_pin (id, hash) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET hash = excluded.hash", (pin_hash,))

    def add_gm_session(self, id: str, token_hash: str, created_at: float, expires_at: float, address: str | None, user_agent: str) -> None:
        self._db.execute(
            "INSERT INTO gm_sessions (id, token_hash, created_at, expires_at, last_seen_at, address, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (id, token_hash, created_at, expires_at, created_at, address, user_agent[:120]),
        )

    def gm_session(self, token_hash: str, now: float) -> GmSessionRow | None:
        row = self._db.execute("SELECT * FROM gm_sessions WHERE token_hash = ? AND expires_at > ?", (token_hash, now)).fetchone()
        return GmSessionRow(**dict(row)) if row else None

    def touch_gm_session(self, id: str, now: float, address: str | None = None) -> None:
        self._db.execute("UPDATE gm_sessions SET last_seen_at = ?, address = COALESCE(?, address) WHERE id = ?", (now, address, id))

    def list_gm_sessions(self, now: float) -> list[GmSessionRow]:
        self._db.execute("DELETE FROM gm_sessions WHERE expires_at <= ?", (now,))
        rows = self._db.execute("SELECT * FROM gm_sessions ORDER BY created_at").fetchall()
        return [GmSessionRow(**dict(r)) for r in rows]

    def delete_gm_session(self, id: str) -> None:
        self._db.execute("DELETE FROM gm_sessions WHERE id = ?", (id,))

    def delete_gm_sessions_except(self, keep_id: str | None) -> list[str]:
        rows = self._db.execute("SELECT id FROM gm_sessions WHERE id IS NOT ?", (keep_id,)).fetchall()
        ids = [r["id"] for r in rows]
        self._db.execute("DELETE FROM gm_sessions WHERE id IS NOT ?", (keep_id,))
        return ids

    # ------------------------------------------------------------------ devices

    def add_device(self, row: DeviceRow) -> None:
        self._db.execute(
            "INSERT INTO devices (id, token_hash, name, view, max_fps, low_motion, created_at, last_seen_at, address, approved_address)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (row.id, row.token_hash, row.name, row.view, row.max_fps, int(row.low_motion), row.created_at, row.last_seen_at, row.address, row.approved_address),
        )

    def device_by_token_hash(self, token_hash: str) -> DeviceRow | None:
        row = self._db.execute("SELECT * FROM devices WHERE token_hash = ?", (token_hash,)).fetchone()
        return self._device(row) if row else None

    def device(self, id: str) -> DeviceRow | None:
        row = self._db.execute("SELECT * FROM devices WHERE id = ?", (id,)).fetchone()
        return self._device(row) if row else None

    def update_device(self, id: str, **fields) -> DeviceRow | None:
        changes = {k: (int(v) if k == "low_motion" else v) for k, v in fields.items() if k in _DEVICE_FIELDS and v is not None}
        if changes:
            assignments = ", ".join(f"{k} = ?" for k in changes)
            self._db.execute(f"UPDATE devices SET {assignments} WHERE id = ?", (*changes.values(), id))
        return self.device(id)

    def delete_device(self, id: str) -> None:
        self._db.execute("DELETE FROM devices WHERE id = ?", (id,))

    def list_devices(self) -> list[DeviceRow]:
        return [self._device(r) for r in self._db.execute("SELECT * FROM devices ORDER BY created_at").fetchall()]

    @staticmethod
    def _device(row: sqlite3.Row) -> DeviceRow:
        data = dict(row)
        data["low_motion"] = bool(data["low_motion"])
        return DeviceRow(**data)

    # ------------------------------------------------------------------ cameras

    def list_slots(self) -> list[SlotRow]:
        rows = self._db.execute("SELECT slot, phone_id, room FROM slots ORDER BY slot").fetchall()
        return [SlotRow(slot=r["slot"], phone_id=r["phone_id"], room=r["room"]) for r in rows]

    def save_slot(self, slot: int, phone_id: str | None, room: str) -> None:
        self._db.execute("UPDATE slots SET phone_id = ?, room = ? WHERE slot = ?", (phone_id, room, slot))

    def list_phones(self) -> list[PhoneRow]:
        rows = self._db.execute("SELECT id, name, host, port, manual FROM phones ORDER BY id").fetchall()
        return [PhoneRow(id=r["id"], name=r["name"], host=r["host"], port=r["port"], manual=bool(r["manual"])) for r in rows]

    def upsert_phone(self, row: PhoneRow) -> None:
        self._db.execute(
            "INSERT INTO phones (id, name, host, port, manual) VALUES (?, ?, ?, ?, ?)"
            " ON CONFLICT(id) DO UPDATE SET name = excluded.name, host = excluded.host, port = excluded.port, manual = excluded.manual",
            (row.id, row.name, row.host, row.port, int(row.manual)),
        )

    def delete_phone(self, id: str) -> None:
        self._db.execute("DELETE FROM phones WHERE id = ?", (id,))

    def get_torch_on(self, phone_id: str) -> bool:
        row = self._db.execute("SELECT torch_on FROM phones WHERE id = ?", (phone_id,)).fetchone()
        return bool(row["torch_on"]) if row else False

    def set_torch_on(self, phone_id: str, on: bool) -> None:
        self._db.execute("UPDATE phones SET torch_on = ? WHERE id = ?", (int(on), phone_id))
