"""
Сквозной тест хэндлеров без Telegram: апдейты идут через настоящий Dispatcher, а запросы
к Bot API перехватывает фейковая сессия. Проверяем путь пользователя:
/start → FSM-анкета → /digest → симулятор → полный разбор → «Не подходит» → поиск.
"""
import asyncio
import itertools
from datetime import datetime
from typing import Any, List

import pytest
from aiogram import Bot
from aiogram.client.session.base import BaseSession
from aiogram.methods import AnswerCallbackQuery, EditMessageReplyMarkup, EditMessageText, SendMessage, TelegramMethod
from aiogram.types import Message, Update

import bot as qbot
from cards import LotCB, SetupCB
from config import Settings

CHAT = 777
_ids = itertools.count(100)


class FakeSession(BaseSession):
    """Записывает все вызовы Bot API и возвращает правдоподобные ответы."""

    def __init__(self) -> None:
        super().__init__()
        self.calls: List[TelegramMethod] = []

    async def make_request(self, bot: Bot, method: TelegramMethod[Any], timeout: Any = None) -> Any:
        self.calls.append(method)
        if isinstance(method, (SendMessage, EditMessageText, EditMessageReplyMarkup)):
            # Правки возвращают Union[Message, bool] — для личного чата это всегда Message
            return Message.model_validate(
                {
                    "message_id": getattr(method, "message_id", None) or next(_ids),
                    "date": int(datetime.now().timestamp()),
                    "chat": {"id": CHAT, "type": "private"},
                    "text": getattr(method, "text", None) or "",
                    "reply_markup": method.reply_markup.model_dump() if getattr(method, "reply_markup", None) else None,
                },
                context={"bot": bot},
            )
        return True  # answerCallbackQuery, sendChatAction, …

    async def close(self) -> None:  # pragma: no cover
        pass

    async def stream_content(self, *args: Any, **kwargs: Any):  # pragma: no cover
        raise NotImplementedError
        yield b""

    def texts(self) -> List[str]:
        return [m.text for m in self.calls if isinstance(m, (SendMessage, EditMessageText))]

    def last_text(self) -> str:
        return self.texts()[-1]

    def last_markup(self):
        for m in reversed(self.calls):
            if isinstance(m, (SendMessage, EditMessageText)) and m.reply_markup is not None:
                return m.reply_markup
        return None


USER = {"id": CHAT, "is_bot": False, "first_name": "Нурали", "language_code": "ru"}


def _message(text: str) -> dict:
    return {"message_id": next(_ids), "date": int(datetime.now().timestamp()), "chat": {"id": CHAT, "type": "private"}, "from": USER, "text": text}


def _callback(data: str) -> dict:
    msg = {"message_id": next(_ids), "date": int(datetime.now().timestamp()), "chat": {"id": CHAT, "type": "private"}, "text": "…"}
    return {"id": str(next(_ids)), "from": USER, "chat_instance": "ci", "message": msg, "data": data}


@pytest.fixture
def env(tmp_path):
    settings = Settings(
        bot_token="123456:TEST-token",
        openai_api_key="",  # AI выключен: поиск идёт эвристикой, сеть не нужна
        openai_model="gpt-4o-mini",
        transcribe_model="whisper-1",
        qt_api_base="http://127.0.0.1:9",  # недоступно → лента из data/sample_tenders.json
        db_path=str(tmp_path / "flow.db"),
        ai_daily_limit=30,
        alert_interval_min=30,
        alert_min_tos=60,
        webhook_base_url="",
        webhook_secret="",
    )
    return settings


def test_full_user_journey(env):
    async def journey() -> None:
        session = FakeSession()
        tg = Bot(env.bot_token, session=session)
        app = qbot.create_app(env)
        dp = qbot.build_dispatcher(app)

        async def send(payload: dict, kind: str = "message") -> None:
            update = Update.model_validate({"update_id": next(_ids), kind: payload}, context={"bot": tg})
            await dp.feed_update(tg, update)

        # 1. /start → приветствие и первый вопрос анкеты
        await send(_message("/start"))
        assert "Оборотный капитал" in session.last_text()

        # 2. FSM: капитал (ошибка → повтор), город, маржа, сфера, налоги
        await send(_message("много"))
        assert "Введите число" in session.last_text()
        await send(_message("25"))
        assert "Город базирования" in session.last_text()
        await send(_callback(SetupCB(field="city", value="astana").pack()), "callback_query")
        assert "Минимальная маржа" in session.last_text()
        await send(_message("12"))
        assert "Сфера деятельности" in session.last_text()
        await send(_callback(SetupCB(field="industry", value="construction").pack()), "callback_query")
        assert "Налоговый режим" in session.last_text()
        await send(_callback(SetupCB(field="tax", value="simplified").pack()), "callback_query")
        user = await app.storage.get_user(CHAT)
        assert user["twin"].working_capital == 25_000_000 and user["twin"].min_margin_pct == 12
        assert any("сохранён" in x for x in session.texts())

        # 3. /digest → заголовок и карточки с кнопками
        before = len(session.calls)
        await send(_message("/digest"))
        cards = [m for m in session.calls[before:] if isinstance(m, SendMessage) and "TOS" in m.text]
        assert 1 <= len(cards) <= 3
        card = cards[0]
        assert "Заказчик" in card.text and "Кассовый разрыв" in card.text and "Главный риск" in card.text
        buttons = [b for row in card.reply_markup.inline_keyboard for b in row]
        labels = [b.text for b in buttons]
        assert labels[0].startswith("📊") and any(x.startswith("🧪") for x in labels) and any(x.startswith("❌") for x in labels)
        key = LotCB.unpack(buttons[0].callback_data).key

        # 4. Симулятор: все три рычага → сравнение «было → стало»
        await send(_callback(LotCB(action="sim", key=key, m=0).pack()), "callback_query")
        assert "Что если" in session.last_text()
        await send(_callback(LotCB(action="sim", key=key, m=7).pack()), "callback_query")
        sim_text = session.last_text()
        assert "→" in sim_text and "Топливо +15%" in sim_text and "Постоплата +30 дней" in sim_text
        toggles = [b.text for row in session.last_markup().inline_keyboard for b in row]
        assert sum(t.startswith("✅") for t in toggles) == 3

        # 5. Полный разбор
        await send(_callback(LotCB(action="full", key=key).pack()), "callback_query")
        full = session.last_text()
        assert "Π = S" in full and "CFₜ" in full and "TOS =" in full

        # 6. «Не подходит» → лот скрыт и больше не приходит в дайджест
        await send(_callback(LotCB(action="hide", key=key).pack()), "callback_query")
        assert "скрыт" in session.last_text()
        assert key in await app.storage.hidden_keys(CHAT)

        # 7. Текстовый поиск (эвристика без AI)
        await send(_message("ремонт кровли в Актобе до 200 млн"))
        assert "Найдено" in session.last_text() or "ничего не найдено" in session.last_text()

        # 8. Смена языка
        await send(_callback("menu:lang"), "callback_query")
        assert (await app.storage.get_user(CHAT))["lang"] == "kz"

    asyncio.run(journey())
