"""
FastAPI-сервис Qazaq Tenders.

  GET  /health            — состояние (без секретов: только флаги)
  POST /analyze           — детерминированный расчёт: лот + цифровой двойник (+ сценарий) → AnalysisResult
  POST /telegram/webhook  — приём апдейтов Telegram (если задан WEBHOOK_BASE_URL)

Запуск:  uvicorn api:app --host 0.0.0.0 --port 8080
В режиме webhook отдельный `python bot.py` не нужен — бот работает внутри этого процесса.
"""
from __future__ import annotations

import asyncio
import hmac
import logging
from contextlib import asynccontextmanager
from typing import Optional, Set

from aiogram import Bot, Dispatcher
from aiogram.types import Update
from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel

from bot import build_dispatcher, create_app, create_bot
from calculator import analyze_tender
from config import load_settings
from models import AnalysisResult, CompanyTwin, Scenario, TenderSpec

log = logging.getLogger("qazaq_api")
settings = load_settings()
services = create_app(settings)
WEBHOOK_PATH = "/telegram/webhook"


class _State:
    bot: Optional[Bot] = None
    dp: Optional[Dispatcher] = None
    tasks: Set[asyncio.Task] = set()


state = _State()


@asynccontextmanager
async def lifespan(_: FastAPI):
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    if settings.webhook_base_url and settings.bot_token:
        if not settings.webhook_secret:
            raise RuntimeError("WEBHOOK_SECRET обязателен в режиме webhook")
        state.bot, state.dp = create_bot(settings), build_dispatcher(services)
        await state.dp.emit_startup(bot=state.bot, dispatcher=state.dp, bots=[state.bot], **state.dp.workflow_data)
        await state.bot.set_webhook(
            f"{settings.webhook_base_url}{WEBHOOK_PATH}",
            secret_token=settings.webhook_secret,
            allowed_updates=state.dp.resolve_used_update_types(),
        )
        log.info("webhook mode: %s%s", settings.webhook_base_url, WEBHOOK_PATH)
    yield
    if state.bot and state.dp:
        await state.dp.emit_shutdown(bot=state.bot, dispatcher=state.dp, bots=[state.bot], **state.dp.workflow_data)
        await state.bot.session.close()


app = FastAPI(title="Qazaq Tenders API", version="1.0", lifespan=lifespan)


@app.get("/health")
async def health() -> dict:
    return {
        "ok": True,
        "bot": bool(settings.bot_token),
        "openai": services.ai.available,
        "mode": "webhook" if state.bot else "api",
    }


class AnalyzeRequest(BaseModel):
    tender: TenderSpec
    twin: CompanyTwin
    scenario: Optional[Scenario] = None


@app.post("/analyze", response_model=AnalysisResult)
async def analyze(req: AnalyzeRequest) -> AnalysisResult:
    """Economic Layer как сервис: те же формулы, что в боте и на сайте."""
    try:
        return await asyncio.to_thread(analyze_tender, req.tender, req.twin, req.scenario)
    except ValueError as e:  # неизвестный город
        raise HTTPException(status_code=422, detail=str(e)) from e


@app.post(WEBHOOK_PATH)
async def telegram_webhook(request: Request) -> dict:
    if not state.bot or not state.dp:
        raise HTTPException(status_code=404)
    secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token", "")
    if not hmac.compare_digest(secret, settings.webhook_secret):
        raise HTTPException(status_code=403)
    update = Update.model_validate(await request.json(), context={"bot": state.bot})
    # Отвечаем Telegram сразу: разбор PDF через AI может идти дольше его таймаута
    task = asyncio.create_task(state.dp.feed_update(state.bot, update))
    state.tasks.add(task)
    task.add_done_callback(state.tasks.discard)
    return {"ok": True}
