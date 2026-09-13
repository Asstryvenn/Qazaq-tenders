"""
Qazaq Tenders — Telegram-бот (aiogram 3.x): персональный AI-ассистент предпринимателя.

Возможности:
  • FSM-анкета «цифрового двойника» (капитал, город, мин. маржа, сфера, налоговый режим);
  • карточки лотов с TOS, прибылью, кассовым разрывом, логистикой и главным риском;
  • inline-кнопки: полный разбор, ссылка на лот, симулятор «Что если?», «Не подходит»;
  • симулятор: ⛽ топливо +15 %, 📦 закупка +10 %, ⏱ постоплата +30 дней — мгновенный пересчёт
    правкой того же сообщения (состояние — битовая маска в callback_data);
  • голосовой поиск: Whisper → NLP-фильтры → список лотов с TOS;
  • экспресс-анализ PDF/DOCX или ссылки: AI Layer → JSON → Economic Layer → вердикт;
  • уведомления о новых подходящих лотах (фоновая проверка ленты).

Запуск (polling):  python bot.py
Запуск (webhook):  uvicorn api:app  — см. api.py и README.md
"""
from __future__ import annotations

import asyncio
import logging
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

from aiogram import Bot, Dispatcher, F, Router
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.exceptions import TelegramBadRequest, TelegramForbiddenError
from aiogram.filters import Command, CommandObject, CommandStart, StateFilter
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.types import BotCommand, CallbackQuery, ErrorEvent, InlineKeyboardMarkup, Message
from aiogram.utils.chat_action import ChatActionSender

from ai_engine import AIEngine, AIError
from calculator import analyze_tender, meets_min_margin, rank_lots, scenario_from_mask, SUPPORTED_LEVERS_MASK
from cards import (
    LogisticsCB,
    LotCB,
    MenuCB,
    SetupCB,
    SupplierCB,
    assumptions_note,
    back_keyboard,
    city_keyboard,
    describe_query,
    full_breakdown,
    hidden_keyboard,
    industry_keyboard,
    lot_card,
    lot_keyboard,
    logistics_keyboard,
    logistics_view,
    main_menu_keyboard,
    margin_keyboard,
    search_keyboard,
    search_results,
    simulator_keyboard,
    simulator_view,
    suppliers_keyboard,
    suppliers_view,
    tax_keyboard,
    twin_keyboard,
    twin_view,
)
from config import Settings, load_settings
from documents import MAX_FILE_BYTES, DocumentError, detect_kind, extract_pages, find_url, pages_from_url
from models import AnalysisResult, CompanyTwin, Scenario, SearchQuery, SpecPage, TenderSpec
from logistics import logistics_plan
from storage import Storage
from suppliers import SupplierCatalog, SupplierError
from tenders import INDUSTRIES, TenderFeed, filter_lots, find_by_url, heuristic_search, industry_matches, lot_key, match_city
from texts import esc, pct, t

log = logging.getLogger("qazaq_bot")
router = Router(name="qazaq")

Row = Tuple[str, TenderSpec, AnalysisResult]


# =========================================================================== #
# Контейнер сервисов (передаётся в хэндлеры через workflow_data диспетчера)    #
# =========================================================================== #


@dataclass
class App:
    settings: Settings
    storage: Storage
    feed: TenderFeed
    ai: AIEngine
    suppliers: SupplierCatalog
    tasks: List[asyncio.Task] = field(default_factory=list)


def create_app(settings: Settings) -> App:
    return App(
        settings=settings,
        storage=Storage(settings.db_path),
        feed=TenderFeed(settings.qt_api_base),
        ai=AIEngine(settings.openai_api_key, settings.openai_model, settings.transcribe_model),
        suppliers=SupplierCatalog(settings.supplier_catalog_url, settings.supplier_catalog_api_key),
    )


class TwinForm(StatesGroup):
    """Шаги FSM-анкеты цифрового двойника."""

    capital = State()
    city = State()
    margin = State()
    industry = State()
    tax = State()


# =========================================================================== #
# Вспомогательные функции                                                     #
# =========================================================================== #


async def get_user(app: App, chat_id: int, language_code: Optional[str]) -> Dict[str, Any]:
    """Профиль пользователя; при первом обращении язык берём из настроек Telegram."""
    user = await app.storage.get_user(chat_id)
    if user is None:
        lang = "kz" if (language_code or "").startswith("kk") else "ru"
        await app.storage.ensure_user(chat_id, lang)
        user = {"chat_id": chat_id, "lang": lang, "twin": None, "alerts": False}
    return user


async def safe_edit(message: Message, text: str, kb: Optional[InlineKeyboardMarkup] = None) -> None:
    """edit_text, которому не страшно «message is not modified» (двойное нажатие кнопки)."""
    try:
        await message.edit_text(text, reply_markup=kb)
    except TelegramBadRequest as e:
        if "message is not modified" not in str(e):
            raise


def _analyze_rows(lots: List[TenderSpec], twin: CompanyTwin) -> List[Row]:
    rows: List[Row] = []
    for spec in lots:
        try:
            rows.append((lot_key(spec.id), spec, analyze_tender(spec, twin)))
        except ValueError as e:  # неизвестный город и т. п. — пропускаем лот, а не всю ленту
            log.warning("skip %s: %s", spec.id, e)
    return rows


async def analyze_rows(lots: List[TenderSpec], twin: CompanyTwin) -> List[Row]:
    # Расчёт — чистый CPU; в отдельном потоке он не тормозит ответы другим пользователям
    return await asyncio.to_thread(_analyze_rows, lots, twin)


async def send_card(bot: Bot, app: App, chat_id: int, key: str, spec: TenderSpec, res: AnalysisResult, twin: CompanyTwin, lang: str, header: str = "") -> None:
    await app.storage.put_lot(key, spec)
    await bot.send_message(chat_id, lot_card(spec, res, twin, lang, header=header), reply_markup=lot_keyboard(key, spec, lang))


def ai_error_text(e: AIError, lang: str) -> str:
    key = f"ai_err_{e.code}"
    return t(key if key in _AI_KEYS else "ai_err_unknown", lang)


_AI_KEYS = {"ai_err_invalid_key", "ai_err_quota", "ai_err_rate_limit", "ai_err_network", "ai_err_bad_response", "ai_err_no_budget", "ai_err_unknown"}


def doc_error_text(e: DocumentError, lang: str) -> str:
    return {
        "unsupported": t("doc_unsupported", lang),
        "too_big": t("doc_too_big", lang),
        "no_text": t("doc_no_text", lang),
        "broken": t("doc_broken", lang),
        "blocked_host": t("url_blocked", lang),
        "http": t("url_http", lang, detail=esc(e.detail)),
    }.get(e.code, t("url_bad", lang))


async def charge_ai(message: Message, app: App, lang: str) -> bool:
    """Проверяет, что AI настроен и суточный лимит не исчерпан; списывает одно действие."""
    if not app.ai.available:
        await message.answer(t("ai_off", lang))
        return False
    if not await app.storage.use_ai(message.chat.id, app.settings.ai_daily_limit):
        await message.answer(t("ai_quota", lang, limit=app.settings.ai_daily_limit))
        return False
    return True


# =========================================================================== #
# /start, меню, помощь, язык                                                   #
# =========================================================================== #


@router.message(CommandStart())
async def cmd_start(message: Message, state: FSMContext, app: App) -> None:
    await state.clear()
    user = await get_user(app, message.chat.id, message.from_user.language_code if message.from_user else None)
    lang = user["lang"]
    name = esc(message.from_user.first_name if message.from_user else "")
    if user["twin"] is None:
        await message.answer(t("welcome", lang, name=name))
        await start_setup(message, state, lang)
    else:
        await message.answer(t("welcome_back", lang, name=name))
        await message.answer(t("menu", lang), reply_markup=main_menu_keyboard(lang, user["alerts"]))


@router.message(Command("menu"))
async def cmd_menu(message: Message, state: FSMContext, app: App) -> None:
    await state.clear()
    user = await get_user(app, message.chat.id, None)
    await message.answer(t("menu", user["lang"]), reply_markup=main_menu_keyboard(user["lang"], user["alerts"]))


@router.message(Command("help"))
async def cmd_help(message: Message, app: App) -> None:
    user = await get_user(app, message.chat.id, None)
    await message.answer(t("help", user["lang"]))


@router.message(Command("cancel"))
async def cmd_cancel(message: Message, state: FSMContext, app: App) -> None:
    await state.clear()
    user = await get_user(app, message.chat.id, None)
    await message.answer(t("cancelled", user["lang"]), reply_markup=main_menu_keyboard(user["lang"], user["alerts"]))


@router.callback_query(MenuCB.filter())
async def on_menu(cb: CallbackQuery, callback_data: MenuCB, state: FSMContext, bot: Bot, app: App) -> None:
    if not isinstance(cb.message, Message):
        await cb.answer()
        return
    msg = cb.message
    user = await get_user(app, msg.chat.id, cb.from_user.language_code)
    lang, twin, action = user["lang"], user["twin"], callback_data.action

    if action == "menu":
        await safe_edit(msg, t("menu", lang), main_menu_keyboard(lang, user["alerts"]))
    elif action == "help":
        await msg.answer(t("help", lang))
    elif action == "lang":
        lang = "ru" if lang == "kz" else "kz"
        await app.storage.set_lang(msg.chat.id, lang)
        await safe_edit(msg, t("menu", lang), main_menu_keyboard(lang, user["alerts"]))
        await cb.answer(t("lang_set", lang))
        return
    elif action == "twin":
        if twin is None:
            await start_setup(msg, state, lang)
        else:
            await msg.answer(twin_view(twin, lang), reply_markup=twin_keyboard(lang))
    elif action == "edit_twin":
        await start_setup(msg, state, lang)
    elif twin is None:  # остальным действиям нужен двойник
        await cb.answer(t("need_twin_short", lang), show_alert=True)
        await start_setup(msg, state, lang)
        return
    elif action == "digest":
        await cb.answer()
        await send_digest(bot, app, msg.chat.id, lang, twin)
        return
    elif action == "search":
        await msg.answer(t("search_prompt", lang))
    elif action == "alerts":
        on = not user["alerts"]
        if on:
            # Отмечаем текущую ленту как «виденную»: уведомлять будем только о новых лотах
            lots, _ = await app.feed.get()
            await app.storage.mark_seen(msg.chat.id, [lot_key(s.id) for s in lots])
        await app.storage.set_alerts(msg.chat.id, on)
        await safe_edit(msg, t("menu", lang), main_menu_keyboard(lang, on))
        await msg.answer(
            t("alerts_on", lang, tos=int(app.settings.alert_min_tos), margin=pct(twin.min_margin_pct, 0)) if on else t("alerts_off", lang)
        )
    await cb.answer()


# =========================================================================== #
# FSM: цифровой двойник компании                                               #
# =========================================================================== #


async def start_setup(message: Message, state: FSMContext, lang: str) -> None:
    await state.clear()
    await state.set_state(TwinForm.capital)
    await message.answer(t("ask_capital", lang))


@router.message(Command("setup"))
async def cmd_setup(message: Message, state: FSMContext, app: App) -> None:
    user = await get_user(app, message.chat.id, message.from_user.language_code if message.from_user else None)
    if user["twin"] is not None:
        await message.answer(twin_view(user["twin"], user["lang"]), reply_markup=twin_keyboard(user["lang"]))
        return
    await start_setup(message, state, user["lang"])


def parse_number(text: str) -> Optional[float]:
    """«25», «7,5», «25 000 000», «1,2 млрд» → число (для капитала — в млн ₸)."""
    m = re.search(r"\d+(?:[   ]\d{3})*(?:[.,]\d+)?", text or "")
    if not m:
        return None
    value = float(re.sub(r"[   ]", "", m.group(0)).replace(",", "."))
    if "млрд" in text.lower():
        value *= 1000
    return value


@router.message(TwinForm.capital, F.text)
async def form_capital(message: Message, state: FSMContext, app: App) -> None:
    lang = (await get_user(app, message.chat.id, None))["lang"]
    value = parse_number(message.text or "")
    if value is not None and value >= 100_000:  # похоже, ввели в тенге, а не в миллионах
        value /= 1_000_000
    if value is None or not 0.1 <= value <= 100_000:
        await message.answer(t("bad_capital", lang))
        return
    await state.update_data(capital=value)
    await state.set_state(TwinForm.city)
    await message.answer(t("ask_city", lang), reply_markup=city_keyboard(lang))


async def _after_city(message: Message, state: FSMContext, lang: str, city_id: str) -> None:
    await state.update_data(city=city_id)
    await state.set_state(TwinForm.margin)
    await message.answer(t("ask_margin", lang), reply_markup=margin_keyboard())


@router.callback_query(TwinForm.city, SetupCB.filter(F.field == "city"))
async def form_city_cb(cb: CallbackQuery, callback_data: SetupCB, state: FSMContext, app: App) -> None:
    lang = (await get_user(app, cb.from_user.id, None))["lang"]
    await cb.answer()
    if isinstance(cb.message, Message):
        await cb.message.edit_reply_markup(reply_markup=None)
        await _after_city(cb.message, state, lang, callback_data.value)


@router.message(TwinForm.city, F.text)
async def form_city_text(message: Message, state: FSMContext, app: App) -> None:
    lang = (await get_user(app, message.chat.id, None))["lang"]
    city_id = match_city(message.text or "")
    if city_id is None:
        await message.answer(t("bad_city", lang), reply_markup=city_keyboard(lang))
        return
    await _after_city(message, state, lang, city_id)


async def _after_margin(message: Message, state: FSMContext, lang: str, value: float) -> None:
    await state.update_data(margin=value)
    await state.set_state(TwinForm.industry)
    await message.answer(t("ask_industry", lang), reply_markup=industry_keyboard(lang))


@router.callback_query(TwinForm.margin, SetupCB.filter(F.field == "margin"))
async def form_margin_cb(cb: CallbackQuery, callback_data: SetupCB, state: FSMContext, app: App) -> None:
    lang = (await get_user(app, cb.from_user.id, None))["lang"]
    await cb.answer()
    if isinstance(cb.message, Message):
        await cb.message.edit_reply_markup(reply_markup=None)
        await _after_margin(cb.message, state, lang, float(callback_data.value))


@router.message(TwinForm.margin, F.text)
async def form_margin_text(message: Message, state: FSMContext, app: App) -> None:
    lang = (await get_user(app, message.chat.id, None))["lang"]
    value = parse_number(message.text or "")
    if value is None or not 0 <= value <= 90:
        await message.answer(t("bad_margin", lang), reply_markup=margin_keyboard())
        return
    await _after_margin(message, state, lang, value)


@router.callback_query(TwinForm.industry, SetupCB.filter(F.field == "industry"))
async def form_industry(cb: CallbackQuery, callback_data: SetupCB, state: FSMContext, app: App) -> None:
    lang = (await get_user(app, cb.from_user.id, None))["lang"]
    await cb.answer()
    if not isinstance(cb.message, Message) or callback_data.value not in INDUSTRIES:
        return
    await cb.message.edit_reply_markup(reply_markup=None)
    await state.update_data(industry=callback_data.value)
    await state.set_state(TwinForm.tax)
    await cb.message.answer(t("ask_tax", lang), reply_markup=tax_keyboard(lang))


@router.callback_query(TwinForm.tax, SetupCB.filter(F.field == "tax"))
async def form_tax(cb: CallbackQuery, callback_data: SetupCB, state: FSMContext, app: App) -> None:
    user = await get_user(app, cb.from_user.id, None)
    lang = user["lang"]
    await cb.answer()
    if not isinstance(cb.message, Message) or callback_data.value not in ("simplified", "general", "vat"):
        return
    data = await state.get_data()
    await state.clear()
    twin = CompanyTwin.from_answers(
        capital_mln=data["capital"],
        city_id=data["city"],
        min_margin_pct=data["margin"],
        industry=data["industry"],
        tax_regime=callback_data.value,
        name=cb.from_user.full_name,
    )
    old: Optional[CompanyTwin] = user["twin"]
    if old is not None:  # при редактировании сохраняем уточнённые через /set поля
        twin = twin.model_copy(
            update={
                "name": old.name or twin.name,
                "experience_years": old.experience_years,
                "certificates": old.certificates,
                "max_distance_km": old.max_distance_km,
                "credit_rate": old.credit_rate,
                "opex_allocation": old.opex_allocation,
            }
        )
    await app.storage.save_twin(cb.message.chat.id, twin)
    await cb.message.edit_reply_markup(reply_markup=None)
    await cb.message.answer(f"{t('twin_saved', lang)}\n\n{twin_view(twin, lang)}")
    await cb.message.answer(t("menu", lang), reply_markup=main_menu_keyboard(lang, user["alerts"]))


@router.callback_query(SetupCB.filter())
async def form_stale(cb: CallbackQuery, app: App) -> None:
    """Кнопка из старой анкеты (например, после перезапуска бота)."""
    lang = (await get_user(app, cb.from_user.id, None))["lang"]
    await cb.answer(t("setup_expired", lang), show_alert=True)


SET_FIELDS = {
    # параметр: (поле двойника, множитель, мин, макс)
    "capital": ("working_capital", 1e6, 0.1e6, 1e11),
    "margin": ("min_margin_pct", 1, 0, 90),
    "opex": ("monthly_opex", 1e6, 0, 1e9),
    "alloc": ("opex_allocation", 0.01, 0.01, 1),
    "radius": ("max_distance_km", 1, 10, 5000),
    "exp": ("experience_years", 1, 0, 60),
    "credit": ("credit_rate", 0.01, 0, 1),
}


@router.message(Command("set"))
async def cmd_set(message: Message, command: CommandObject, app: App) -> None:
    """Точная настройка двойника: /set opex 2,5 · /set certs ISO 9001, СТ РК · /set name ТОО «…»."""
    user = await get_user(app, message.chat.id, None)
    lang, twin = user["lang"], user["twin"]
    if twin is None:
        await message.answer(t("need_twin", lang))
        return
    field_name, _, raw = (command.args or "").strip().partition(" ")
    field_name, raw = field_name.lower(), raw.strip()
    if field_name == "certs":
        twin = twin.model_copy(update={"certificates": [c.strip() for c in re.split(r"[,;]", raw) if c.strip()][:20]})
    elif field_name == "name" and raw:
        twin = twin.model_copy(update={"name": raw[:120]})
    elif field_name in SET_FIELDS:
        attr, mult, lo, hi = SET_FIELDS[field_name]
        value = parse_number(raw)
        if value is None or not lo <= value * mult <= hi:
            await message.answer(t("set_bad", lang, field=esc(field_name)))
            return
        twin = twin.model_copy(update={attr: value * mult})
    else:
        await message.answer(t("set_usage", lang))
        return
    await app.storage.save_twin(message.chat.id, twin)
    await message.answer(twin_view(twin, lang), reply_markup=twin_keyboard(lang))


# =========================================================================== #
# Дайджест (Rich Notifications)                                               #
# =========================================================================== #


async def send_digest(bot: Bot, app: App, chat_id: int, lang: str, twin: CompanyTwin, top: int = 3) -> None:
    lots, live = await app.feed.get()
    hidden = await app.storage.hidden_keys(chat_id)
    pool = [s for s in lots if lot_key(s.id) not in hidden]
    matched = [s for s in pool if industry_matches(s, twin.industry)]
    if twin.industry != "other" and not matched:
        ind = INDUSTRIES[twin.industry]
        await bot.send_message(chat_id, t("digest_industry_fallback", lang, industry=ind.kz if lang == "kz" else ind.ru))
    ranked = rank_lots(await analyze_rows(matched or pool, twin), twin)
    if not ranked:
        await bot.send_message(chat_id, t("digest_empty", lang))
        return
    shown = ranked[:top]
    await bot.send_message(chat_id, t("digest_title", lang, n=len(ranked), top=len(shown)))
    for key, spec, res in shown:
        await send_card(bot, app, chat_id, key, spec, res, twin, lang)


@router.message(Command("digest"))
async def cmd_digest(message: Message, bot: Bot, app: App) -> None:
    user = await get_user(app, message.chat.id, None)
    if user["twin"] is None:
        await message.answer(t("need_twin", user["lang"]))
        return
    async with ChatActionSender.typing(bot=bot, chat_id=message.chat.id):
        await send_digest(bot, app, message.chat.id, user["lang"], user["twin"])


# =========================================================================== #
# Поиск: текст и голос (Whisper)                                              #
# =========================================================================== #


@router.message(Command("search"))
async def cmd_search(message: Message, command: CommandObject, bot: Bot, app: App) -> None:
    user = await get_user(app, message.chat.id, None)
    if command.args:
        await run_search(message, bot, app, user, command.args)
    else:
        await message.answer(t("search_prompt", user["lang"]))


async def run_search(message: Message, bot: Bot, app: App, user: Dict[str, Any], text: str, charged: bool = False) -> None:
    lang, twin = user["lang"], user["twin"]
    if twin is None:
        await message.answer(t("need_twin", lang))
        return
    q: Optional[SearchQuery] = None
    # AI-разбор, если доступен и не исчерпан лимит; иначе — детерминированный разбор
    if app.ai.available and (charged or await app.storage.use_ai(message.chat.id, app.settings.ai_daily_limit)):
        try:
            async with ChatActionSender.typing(bot=bot, chat_id=message.chat.id):
                q = await app.ai.parse_search_query(text)
        except AIError as e:
            log.warning("search parse failed: %s", e)
    if q is None:
        q = heuristic_search(text)

    lots, live = await app.feed.get()
    hidden = await app.storage.hidden_keys(message.chat.id)
    found = [s for s in filter_lots(lots, q) if lot_key(s.id) not in hidden]
    if not found:
        await message.answer(t("search_none", lang, query=describe_query(q, lang)))
        return
    rows = rank_lots(await analyze_rows(found, twin), twin)[:8]
    for key, spec, _ in rows:
        await app.storage.put_lot(key, spec)
    await message.answer(search_results(rows, q, twin, lang, live), reply_markup=search_keyboard(rows, lang))


@router.message(StateFilter(None), F.voice | F.audio)
async def on_voice(message: Message, bot: Bot, app: App) -> None:
    user = await get_user(app, message.chat.id, message.from_user.language_code if message.from_user else None)
    lang = user["lang"]
    if user["twin"] is None:
        await message.answer(t("need_twin", lang))
        return
    media = message.voice or message.audio
    if media is None:
        return
    if (media.duration or 0) > 180:
        await message.answer(t("voice_too_long", lang))
        return
    if not await charge_ai(message, app, lang):
        return
    filename = "voice.ogg" if message.voice else (getattr(media, "file_name", None) or "audio.mp3")
    async with ChatActionSender.typing(bot=bot, chat_id=message.chat.id):
        buf = await bot.download(media)
        try:
            text = await app.ai.transcribe(buf.getvalue() if buf else b"", filename=filename)
        except AIError as e:
            await message.answer(ai_error_text(e, lang))
            return
    if not text:
        await message.answer(t("voice_empty", lang))
        return
    await message.answer(t("heard", lang, text=esc(text)))
    await run_search(message, bot, app, user, text, charged=True)


# =========================================================================== #
# Экспресс-анализ PDF / DOCX / ссылки                                         #
# =========================================================================== #


async def analyze_pages(status: Message, bot: Bot, app: App, user: Dict[str, Any], pages: List[SpecPage], source_name: str, source_url: str = "") -> None:
    """AI Layer → JSON (TenderSpec) → Economic Layer → карточка с вердиктом."""
    lang, twin = user["lang"], user["twin"]
    await safe_edit(status, t("ai_extracting", lang, pages=len(pages)))
    try:
        async with ChatActionSender.typing(bot=bot, chat_id=status.chat.id):
            spec, assumptions = await app.ai.extract_tender(pages, source_name, twin.base_city_id, lang, source_url)
    except AIError as e:
        await safe_edit(status, ai_error_text(e, lang))
        return
    key = lot_key(spec.id)
    await app.storage.put_lot(key, spec)
    res = await asyncio.to_thread(analyze_tender, spec, twin)
    # Конкретный список допущений заменяет общую пометку «часть условий оценена»
    text = lot_card(spec, res, twin, lang, header=t("doc_header", lang), show_estimated=not assumptions) + assumptions_note(assumptions, lang)
    await safe_edit(status, text, lot_keyboard(key, spec, lang))


@router.message(StateFilter(None), F.document)
async def on_document(message: Message, bot: Bot, app: App) -> None:
    user = await get_user(app, message.chat.id, message.from_user.language_code if message.from_user else None)
    lang = user["lang"]
    doc = message.document
    if doc is None:
        return
    if detect_kind(doc.file_name or "", doc.mime_type or "") not in ("pdf", "docx"):
        await message.answer(t("doc_unsupported", lang))
        return
    if (doc.file_size or 0) > MAX_FILE_BYTES:
        await message.answer(t("doc_too_big", lang))
        return
    if user["twin"] is None:
        await message.answer(t("need_twin", lang))
        return
    if not await charge_ai(message, app, lang):
        return
    status = await message.answer(t("doc_reading", lang))
    try:
        buf = await bot.download(doc)
        pages = await asyncio.to_thread(extract_pages, buf.getvalue() if buf else b"", doc.file_name or "", doc.mime_type or "")
    except DocumentError as e:
        await safe_edit(status, doc_error_text(e, lang))
        return
    await analyze_pages(status, bot, app, user, pages, doc.file_name or "document")


async def analyze_link(message: Message, bot: Bot, app: App, user: Dict[str, Any], url: str) -> None:
    lang, twin = user["lang"], user["twin"]
    # Лот уже есть в ленте → считаем сразу, без AI и без траты лимита
    lots, _ = await app.feed.get()
    known = find_by_url(lots, url)
    if known is not None:
        res = await asyncio.to_thread(analyze_tender, known, twin)
        await send_card(bot, app, message.chat.id, lot_key(known.id), known, res, twin, lang)
        return
    if not await charge_ai(message, app, lang):
        return
    status = await message.answer(t("link_loading", lang))
    try:
        pages = await pages_from_url(url)
    except DocumentError as e:
        await safe_edit(status, doc_error_text(e, lang))
        return
    await analyze_pages(status, bot, app, user, pages, source_name=url, source_url=url)


@router.message(StateFilter(None), F.text.startswith("/"))
async def on_unknown_command(message: Message, app: App) -> None:
    user = await get_user(app, message.chat.id, None)
    await message.answer(t("unknown_command", user["lang"]))


@router.message(StateFilter(None), F.text)
async def on_text(message: Message, bot: Bot, app: App) -> None:
    """Любой текст: ссылка → экспресс-анализ, иначе → поиск лотов."""
    user = await get_user(app, message.chat.id, message.from_user.language_code if message.from_user else None)
    if user["twin"] is None:
        await message.answer(t("need_twin", user["lang"]))
        return
    url = find_url(message.text or "")
    if url:
        await analyze_link(message, bot, app, user, url)
    else:
        await run_search(message, bot, app, user, message.text or "")


# =========================================================================== #
# Кнопки карточки: разбор, симулятор «Что если?», скрыть                        #
# =========================================================================== #


@router.callback_query(LogisticsCB.filter())
async def on_logistics(cb: CallbackQuery, callback_data: LogisticsCB, bot: Bot, app: App) -> None:
    """Mutually exclusive transport buttons with an immediate full engine rerun."""
    if not isinstance(cb.message, Message):
        await cb.answer()
        return
    msg = cb.message
    user = await get_user(app, msg.chat.id, cb.from_user.language_code)
    lang, twin = user["lang"], user["twin"]
    spec = await app.storage.get_lot(callback_data.key)
    if twin is None or spec is None:
        await cb.answer(t("lot_gone", lang), show_alert=True)
        return
    saved = await app.storage.get_lot_scenario(msg.chat.id, callback_data.key)
    if callback_data.action == "back":
        result = await asyncio.to_thread(analyze_tender, spec, twin, saved)
        await safe_edit(msg, lot_card(spec, result, twin, lang), lot_keyboard(callback_data.key, spec, lang))
        await cb.answer()
        return

    cargo = saved.cargo_tonnes_override if saved.cargo_tonnes_override is not None else spec.cargo_tonnes
    plan = logistics_plan(twin.base_city_id, spec.city_id, cargo, saved.transport_mode, spec.delivery_days, saved.fuel_delta_pct, saved.transport_delta_pct)
    if callback_data.action == "choose":
        allowed = {quote.mode for quote in plan.quotes}
        if callback_data.mode not in allowed:
            await cb.answer(t("error", lang), show_alert=True)
            return
        saved = saved.model_copy(update={"transport_mode": callback_data.mode, "logistics_cost_override": None, "own_transport": False})
        await app.storage.save_lot_scenario(msg.chat.id, callback_data.key, saved)
        plan = logistics_plan(twin.base_city_id, spec.city_id, cargo, saved.transport_mode, spec.delivery_days, saved.fuel_delta_pct, saved.transport_delta_pct)

    result = await asyncio.to_thread(analyze_tender, spec, twin, saved)
    await safe_edit(
        msg,
        logistics_view(spec, twin, saved, result, lang),
        logistics_keyboard(callback_data.key, [quote.mode for quote in plan.quotes], result.transport_mode, lang),
    )
    await cb.answer()


@router.callback_query(SupplierCB.filter())
async def on_supplier(cb: CallbackQuery, callback_data: SupplierCB, bot: Bot, app: App) -> None:
    """Shows live quotes or an explicitly labelled demo fallback and applies one to TOS."""
    if not isinstance(cb.message, Message):
        await cb.answer()
        return
    msg = cb.message
    user = await get_user(app, msg.chat.id, cb.from_user.language_code)
    lang, twin = user["lang"], user["twin"]
    spec = await app.storage.get_lot(callback_data.key)
    if twin is None or spec is None:
        await cb.answer(t("lot_gone", lang), show_alert=True)
        return

    if callback_data.action == "back":
        saved = await app.storage.get_lot_scenario(msg.chat.id, callback_data.key)
        base = await asyncio.to_thread(analyze_tender, spec, twin, saved)
        await safe_edit(msg, lot_card(spec, base, twin, lang), lot_keyboard(callback_data.key, spec, lang))
        await cb.answer()
        return

    if callback_data.action == "list":
        try:
            offers = await app.suppliers.search(spec)
        except SupplierError:
            await cb.answer(t("suppliers_unavailable", lang), show_alert=True)
            return
        await app.storage.put_supplier_offers(offers)
        await safe_edit(msg, suppliers_view(spec, offers, lang), suppliers_keyboard(callback_data.key, offers, lang))
        await cb.answer()
        return

    if callback_data.action == "choose":
        offer = await app.storage.get_supplier_offer(callback_data.offer)
        if offer is None:
            await cb.answer(t("suppliers_unavailable", lang), show_alert=True)
            return
        saved = await app.storage.get_lot_scenario(msg.chat.id, callback_data.key)
        verified = [field for field in saved.verified_fields if field not in ("purchase_cost", "cargo_tonnes")]
        if offer.status == "verified" and not offer.is_demo:
            verified.append("purchase_cost")
            if offer.cargo_tonnes is not None:
                verified.append("cargo_tonnes")
        sc = saved.model_copy(update={
            "purchase_cost_override": offer.total_price_kzt,
            "cargo_tonnes_override": offer.cargo_tonnes,
            "verified_fields": list(dict.fromkeys(verified)),
        })
        await app.storage.save_lot_scenario(msg.chat.id, callback_data.key, sc)
        result = await asyncio.to_thread(analyze_tender, spec, twin, sc)
        header = t("supplier_applied", lang, name=esc(offer.supplier_name))
        await safe_edit(msg, lot_card(spec, result, twin, lang, header=header), lot_keyboard(callback_data.key, spec, lang))
        await cb.answer()
        return

    await cb.answer()


@router.callback_query(LotCB.filter())
async def on_lot(cb: CallbackQuery, callback_data: LotCB, bot: Bot, app: App) -> None:
    if not isinstance(cb.message, Message):
        await cb.answer()
        return
    msg = cb.message
    user = await get_user(app, msg.chat.id, cb.from_user.language_code)
    lang, twin = user["lang"], user["twin"]
    if twin is None:
        await cb.answer(t("need_twin_short", lang), show_alert=True)
        return
    key, action = callback_data.key, callback_data.action
    spec = await app.storage.get_lot(key)
    if spec is None:
        await cb.answer(t("lot_gone", lang), show_alert=True)
        return

    if action == "hide":
        await app.storage.hide(msg.chat.id, key)
        await safe_edit(msg, f"{t('hidden', lang)}\n\n<s>{esc(spec.title_kz if lang == 'kz' and spec.title_kz else spec.title)}</s>", hidden_keyboard(key, lang))
        await cb.answer()
        return
    if action == "unhide":
        await app.storage.unhide(msg.chat.id, key)

    saved_scenario = await app.storage.get_lot_scenario(msg.chat.id, key)
    base = await asyncio.to_thread(analyze_tender, spec, twin, saved_scenario)
    if action == "open":  # из списка поиска — новая карточка отдельным сообщением
        await send_card(bot, app, msg.chat.id, key, spec, base, twin, lang)
    elif action == "full":
        await safe_edit(msg, full_breakdown(spec, base, twin, lang), back_keyboard(key, lang))
    elif action == "sim":
        mask = callback_data.m & SUPPORTED_LEVERS_MASK
        lever = scenario_from_mask(mask)
        updates: Dict[str, Any] = {}
        for field_name in ("fuel_delta_pct", "transport_delta_pct", "supplier_delta_pct", "payment_delay_delta", "late_days", "delivery_delta_days"):
            value = getattr(lever, field_name)
            if value:
                updates[field_name] = value
        for field_name in ("advance_percentage_override", "logistics_cost_override", "cargo_tonnes_override"):
            value = getattr(lever, field_name)
            if value is not None:
                updates[field_name] = value
        if lever.own_transport:
            updates["own_transport"] = True
        if lever.transport_mode != "auto":
            updates["transport_mode"] = lever.transport_mode
        updates["verified_fields"] = list(dict.fromkeys([*saved_scenario.verified_fields, *lever.verified_fields]))
        combined = saved_scenario.model_copy(update=updates)
        sim = await asyncio.to_thread(analyze_tender, spec, twin, combined) if mask else base
        await safe_edit(msg, simulator_view(spec, base, sim, mask, twin, lang), simulator_keyboard(key, mask, lang))
    else:  # card | unhide
        await safe_edit(msg, lot_card(spec, base, twin, lang), lot_keyboard(key, spec, lang))
    await cb.answer()


# =========================================================================== #
# Уведомления о новых лотах                                                   #
# =========================================================================== #


async def check_new_lots(bot: Bot, app: App) -> None:
    users = await app.storage.alert_users()
    if not users:
        return
    lots, _ = await app.feed.get(force=True)
    for user in users:
        chat_id, lang, twin = user["chat_id"], user["lang"], user["twin"]
        seen = await app.storage.seen_keys(chat_id)
        hidden = await app.storage.hidden_keys(chat_id)
        fresh = [s for s in lots if lot_key(s.id) not in seen and lot_key(s.id) not in hidden]
        if not fresh:
            continue
        rows = rank_lots(await analyze_rows(fresh, twin), twin)
        hits = [
            r for r in rows
            if r[2].tos >= app.settings.alert_min_tos and meets_min_margin(r[2], twin) and industry_matches(r[1], twin.industry)
        ]
        try:
            for key, spec, res in hits[:5]:
                await send_card(bot, app, chat_id, key, spec, res, twin, lang, header=t("alert_header", lang))
        except TelegramForbiddenError:  # пользователь заблокировал бота
            await app.storage.set_alerts(chat_id, False)
            continue
        await app.storage.mark_seen(chat_id, [lot_key(s.id) for s in fresh])


async def alerts_loop(bot: Bot, app: App) -> None:
    interval = max(5, app.settings.alert_interval_min) * 60
    while True:
        await asyncio.sleep(interval)
        try:
            await check_new_lots(bot, app)
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001 — фоновая задача не должна умирать
            log.exception("alerts check failed")


# =========================================================================== #
# Ошибки, запуск                                                              #
# =========================================================================== #


@router.errors()
async def on_error(event: ErrorEvent) -> bool:
    log.exception("update failed", exc_info=event.exception)
    target = event.update.message or (event.update.callback_query.message if event.update.callback_query else None)
    if isinstance(target, Message):
        try:
            await target.answer(t("error", "ru"))
        except Exception:  # noqa: BLE001
            pass
    return True


COMMANDS = {
    "ru": [("start", "Начать"), ("menu", "Главное меню"), ("digest", "Топ-3 лота для вас"), ("search", "Поиск лотов"),
           ("setup", "Цифровой двойник"), ("set", "Уточнить параметры"), ("help", "Помощь"), ("cancel", "Отменить")],
    "kk": [("start", "Бастау"), ("menu", "Басты мәзір"), ("digest", "Сізге ең қолайлы 3 лот"), ("search", "Лот іздеу"),
           ("setup", "Цифрлық егіз"), ("set", "Параметрлерді нақтылау"), ("help", "Көмек"), ("cancel", "Тоқтату")],
}


async def on_startup(bot: Bot, app: App) -> None:
    await bot.set_my_commands([BotCommand(command=c, description=d) for c, d in COMMANDS["ru"]])
    await bot.set_my_commands([BotCommand(command=c, description=d) for c, d in COMMANDS["kk"]], language_code="kk")
    app.tasks.append(asyncio.create_task(alerts_loop(bot, app)))
    me = await bot.get_me()
    log.info("bot @%s started · AI %s · feed %s", me.username, "on" if app.ai.available else "off", app.settings.qt_api_base)


async def on_shutdown(app: App) -> None:
    for task in app.tasks:
        task.cancel()


def create_bot(settings: Settings) -> Bot:
    return Bot(settings.bot_token, default=DefaultBotProperties(parse_mode=ParseMode.HTML, link_preview_is_disabled=True))


def build_dispatcher(app: App) -> Dispatcher:
    # MemoryStorage: анкета теряется при перезапуске. Для нескольких инстансов — RedisStorage.
    dp = Dispatcher(storage=MemoryStorage())
    dp["app"] = app
    dp.include_router(router)
    dp.startup.register(on_startup)
    dp.shutdown.register(on_shutdown)
    return dp


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    settings = load_settings()
    if not settings.bot_token:
        raise SystemExit("BOT_TOKEN не задан — скопируйте bot/.env.example в bot/.env")
    app = create_app(settings)
    bot = create_bot(settings)
    dp = build_dispatcher(app)
    await bot.delete_webhook(drop_pending_updates=False)  # polling и webhook несовместимы
    await dp.start_polling(bot, allowed_updates=dp.resolve_used_update_types())


if __name__ == "__main__":
    asyncio.run(main())
