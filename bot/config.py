"""Настройки бота из переменных окружения (файл bot/.env или окружение сервера)."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")


def _str(name: str, default: str = "") -> str:
    # .strip(): лишний пробел или перевод строки при вставке ключа — частая причина 401
    return (os.getenv(name) or default).strip()


def _int(name: str, default: int) -> int:
    try:
        return int(_str(name) or default)
    except ValueError:
        return default


def _float(name: str, default: float) -> float:
    try:
        return float(_str(name) or default)
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
    # Токен ОТДЕЛЬНОГО бота от @BotFather. Не используйте токен бота уведомлений сайта:
    # сайт читает его getUpdates для привязки чатов, и два читателя мешают друг другу (409).
    bot_token: str
    openai_api_key: str
    openai_model: str
    transcribe_model: str
    # Откуда брать ленту лотов (Next.js-сайт отдаёт единый формат /api/tenders)
    qt_api_base: str
    db_path: str
    # Сколько AI-действий (голос, документ, AI-поиск) в сутки на один чат
    ai_daily_limit: int
    # Проверка новых лотов для подписчиков, минуты; порог TOS для уведомления
    alert_interval_min: int
    alert_min_tos: float
    # Режим webhook (через api.py): публичный https-адрес и секрет. Пусто → polling.
    webhook_base_url: str
    webhook_secret: str
    # Contracted supplier/ERP catalogue implementing bot/suppliers.py contract.
    supplier_catalog_url: str = ""
    supplier_catalog_api_key: str = ""


def load_settings() -> Settings:
    return Settings(
        bot_token=_str("BOT_TOKEN"),
        openai_api_key=_str("OPENAI_API_KEY"),
        openai_model=_str("OPENAI_MODEL", "gpt-4o-mini"),
        transcribe_model=_str("OPENAI_TRANSCRIBE_MODEL", "whisper-1"),
        qt_api_base=_str("QT_API_BASE", "https://www.qazaqtenders.kz").rstrip("/"),
        db_path=_str("DB_PATH", str(BASE_DIR / "data" / "qazaq_bot.db")),
        ai_daily_limit=_int("AI_DAILY_LIMIT", 30),
        alert_interval_min=_int("ALERT_INTERVAL_MIN", 30),
        alert_min_tos=_float("ALERT_MIN_TOS", 60),
        webhook_base_url=_str("WEBHOOK_BASE_URL").rstrip("/"),
        webhook_secret=_str("WEBHOOK_SECRET"),
        supplier_catalog_url=_str("SUPPLIER_CATALOG_URL"),
        supplier_catalog_api_key=_str("SUPPLIER_CATALOG_API_KEY"),
    )
