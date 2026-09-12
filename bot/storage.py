"""
Хранилище бота на SQLite: профили (цифровые двойники), кэш лотов для inline-кнопок,
скрытые и уже показанные лоты, суточные лимиты AI.

SQLite синхронный, поэтому каждый запрос уходит в поток через asyncio.to_thread и не
блокирует event loop aiogram. Для одного процесса бота этого достаточно; при
горизонтальном масштабировании замените на PostgreSQL с тем же интерфейсом.
"""
from __future__ import annotations

import asyncio
import sqlite3
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Optional, Set, TypeVar

from models import CompanyTwin, TenderSpec

T = TypeVar("T")
ALMATY = timezone(timedelta(hours=5))

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    chat_id    INTEGER PRIMARY KEY,
    lang       TEXT    NOT NULL DEFAULT 'ru',
    twin_json  TEXT,
    alerts     INTEGER NOT NULL DEFAULT 0,
    created_at TEXT    NOT NULL,
    updated_at TEXT    NOT NULL
);
CREATE TABLE IF NOT EXISTS lots (
    key        TEXT PRIMARY KEY,
    spec_json  TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS hidden (
    chat_id INTEGER NOT NULL,
    key     TEXT    NOT NULL,
    PRIMARY KEY (chat_id, key)
);
CREATE TABLE IF NOT EXISTS seen (
    chat_id INTEGER NOT NULL,
    key     TEXT    NOT NULL,
    PRIMARY KEY (chat_id, key)
);
CREATE TABLE IF NOT EXISTS ai_usage (
    chat_id INTEGER NOT NULL,
    day     TEXT    NOT NULL,
    count   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (chat_id, day)
);
"""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class Storage:
    def __init__(self, path: str) -> None:
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self._db = sqlite3.connect(path, check_same_thread=False)
        self._db.row_factory = sqlite3.Row
        self._lock = threading.Lock()
        with self._lock:
            self._db.execute("PRAGMA journal_mode=WAL")
            self._db.executescript(SCHEMA)
            self._db.commit()

    async def _run(self, fn: Callable[[sqlite3.Connection], T]) -> T:
        def locked() -> T:
            with self._lock:
                result = fn(self._db)
                self._db.commit()
                return result

        return await asyncio.to_thread(locked)

    # ------------------------------ пользователи ------------------------------ #

    async def get_user(self, chat_id: int) -> Optional[Dict[str, Any]]:
        row = await self._run(lambda db: db.execute("SELECT * FROM users WHERE chat_id = ?", (chat_id,)).fetchone())
        if row is None:
            return None
        twin = CompanyTwin.model_validate_json(row["twin_json"]) if row["twin_json"] else None
        return {"chat_id": row["chat_id"], "lang": row["lang"], "twin": twin, "alerts": bool(row["alerts"])}

    async def ensure_user(self, chat_id: int, lang: str) -> None:
        now = _now()
        await self._run(
            lambda db: db.execute(
                "INSERT OR IGNORE INTO users (chat_id, lang, created_at, updated_at) VALUES (?, ?, ?, ?)",
                (chat_id, lang, now, now),
            )
        )

    async def save_twin(self, chat_id: int, twin: CompanyTwin) -> None:
        await self._run(
            lambda db: db.execute(
                "UPDATE users SET twin_json = ?, updated_at = ? WHERE chat_id = ?",
                (twin.model_dump_json(), _now(), chat_id),
            )
        )

    async def set_lang(self, chat_id: int, lang: str) -> None:
        await self._run(lambda db: db.execute("UPDATE users SET lang = ?, updated_at = ? WHERE chat_id = ?", (lang, _now(), chat_id)))

    async def set_alerts(self, chat_id: int, on: bool) -> None:
        await self._run(lambda db: db.execute("UPDATE users SET alerts = ?, updated_at = ? WHERE chat_id = ?", (int(on), _now(), chat_id)))

    async def alert_users(self) -> List[Dict[str, Any]]:
        rows = await self._run(lambda db: db.execute("SELECT * FROM users WHERE alerts = 1 AND twin_json IS NOT NULL").fetchall())
        return [
            {"chat_id": r["chat_id"], "lang": r["lang"], "twin": CompanyTwin.model_validate_json(r["twin_json"])}
            for r in rows
        ]

    # ---------------------------------- лоты ---------------------------------- #

    async def put_lot(self, key: str, spec: TenderSpec) -> None:
        data = spec.model_dump_json(by_alias=True)
        await self._run(
            lambda db: db.execute(
                "INSERT INTO lots (key, spec_json, created_at) VALUES (?, ?, ?) "
                "ON CONFLICT(key) DO UPDATE SET spec_json = excluded.spec_json",
                (key, data, _now()),
            )
        )

    async def get_lot(self, key: str) -> Optional[TenderSpec]:
        row = await self._run(lambda db: db.execute("SELECT spec_json FROM lots WHERE key = ?", (key,)).fetchone())
        return TenderSpec.model_validate_json(row["spec_json"]) if row else None

    async def hide(self, chat_id: int, key: str) -> None:
        await self._run(lambda db: db.execute("INSERT OR IGNORE INTO hidden (chat_id, key) VALUES (?, ?)", (chat_id, key)))

    async def unhide(self, chat_id: int, key: str) -> None:
        await self._run(lambda db: db.execute("DELETE FROM hidden WHERE chat_id = ? AND key = ?", (chat_id, key)))

    async def hidden_keys(self, chat_id: int) -> Set[str]:
        rows = await self._run(lambda db: db.execute("SELECT key FROM hidden WHERE chat_id = ?", (chat_id,)).fetchall())
        return {r["key"] for r in rows}

    async def mark_seen(self, chat_id: int, keys: Iterable[str]) -> None:
        items = [(chat_id, k) for k in keys]
        await self._run(lambda db: db.executemany("INSERT OR IGNORE INTO seen (chat_id, key) VALUES (?, ?)", items))

    async def seen_keys(self, chat_id: int) -> Set[str]:
        rows = await self._run(lambda db: db.execute("SELECT key FROM seen WHERE chat_id = ?", (chat_id,)).fetchall())
        return {r["key"] for r in rows}

    # --------------------------------- лимиты --------------------------------- #

    async def use_ai(self, chat_id: int, limit: int) -> bool:
        """Атомарно списывает одно AI-действие. False — суточный лимит исчерпан.
        Сутки считаются по времени Астаны (UTC+5)."""
        day = datetime.now(ALMATY).date().isoformat()

        def op(db: sqlite3.Connection) -> bool:
            row = db.execute("SELECT count FROM ai_usage WHERE chat_id = ? AND day = ?", (chat_id, day)).fetchone()
            used = row["count"] if row else 0
            if limit > 0 and used >= limit:
                return False
            db.execute(
                "INSERT INTO ai_usage (chat_id, day, count) VALUES (?, ?, 1) "
                "ON CONFLICT(chat_id, day) DO UPDATE SET count = count + 1",
                (chat_id, day),
            )
            return True

        return await self._run(op)
