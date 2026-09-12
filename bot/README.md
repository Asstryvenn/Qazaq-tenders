# Qazaq Tenders — Telegram-бот (Python)

Персональный AI-ассистент предпринимателя: оценивает лоты госзакупок относительно **цифрового
двойника** компании и отвечает карточками с TOS, прибылью, кассовым разрывом, логистикой и главным риском.

```
Пользователь ──► Telegram ──► bot.py (aiogram 3, FSM, inline-кнопки)
                                  │
             голос / PDF / DOCX / ссылка
                                  ▼
                  ai_engine.py — AI Layer (OpenAI)
                  Whisper · поиск → SearchQuery · документ → TenderSpec (строгая JSON-схема)
                                  │  только факты, без чисел
                                  ▼
                  calculator.py — Economic Layer (NumPy / Pandas, без LLM)
                  Π, CF_t, Trigger_Gap, L_score, R_legal, TOS
                                  ▼
                  cards.py — карточка, разбор, симулятор «Что если?»
```

`calculator.py` — точный порт движка сайта (`lib/engine.ts`): бот и www.qazaqtenders.kz показывают
одинаковый TOS. Совпадение проверяют 210 эталонов, посчитанных TypeScript-движком.

## Структура

```
bot/
├── bot.py               # aiogram 3.x: /start, FSM-анкета, меню, дайджест, поиск, голос, документы, кнопки, уведомления
├── calculator.py        # формулы TOS, Profit, CF_t + нормативы РК, логистика, налоги, симулятор
├── ai_engine.py         # OpenAI: Whisper, разбор запроса, извлечение фактов и рисков из техспецификации
├── models.py            # Pydantic-контракт между слоями (TenderSpec, CompanyTwin, Scenario, AnalysisResult)
├── cards.py             # карточки и inline-клавиатуры (CallbackData)
├── texts.py             # тексты KZ/RU, форматирование ₸, причины рисков
├── tenders.py           # лента лотов (API сайта → снимок), сферы, фильтры, эвристический NLP
├── documents.py         # PDF/DOCX/HTML → страницы; загрузка ссылок с защитой от SSRF
├── storage.py           # SQLite: профили, кэш лотов, скрытые/показанные, суточный лимит AI
├── api.py               # FastAPI: /health, /analyze, /telegram/webhook
├── config.py            # настройки из .env
├── data/sample_tenders.json   # снимок ленты на случай, если сайт недоступен
├── tests/               # pytest: формулы, паритет с TS-движком, рендер, NLP, хранилище
├── requirements.txt · requirements-dev.txt · Dockerfile · .env.example
```

## Формулы (`calculator.py`)

| Формула | Функция |
|---|---|
| `TOS = w1·M_rel + w2·(100 − CF_risk) + w3·L_score + w4·(100 − R_legal)`, веса 0,35 / 0,30 / 0,15 / 0,20 | `tender_opportunity_score()` |
| `Profit = S − (Cost_purchase + Cost_logistics + Cost_tax + Cost_bank + Cost_oper)` (+ неустойка в сценарии просрочки) | `net_profit()` |
| `CF_t = CF_0 + ΣInflow − ΣOutflow`, `Trigger_Gap = ∃t: CF_t < 0` | `cash_flow_gap()` (NumPy, по дням) |
| `L_score = max(0, 100 − Dist/Dist_max·100)` | `logistics_score()` |

`M_rel` в TOS — маржа, приведённая к шкале 0..100 (маржа 20 % = 100). `Cost_bank` — проценты по кредиту
на разрыв плюс комиссия за гарантию исполнения 3 %. Налоги — упрощёнка 4 %, ОУР (КПН 20 %) или ОУР + НДС 16 %.
Минимальная маржа из профиля не меняет TOS (он одинаков с сайтом): лот ниже неё помечается ⚠️, его вердикт
понижается с «Участвовать» до «С осторожностью», и он не попадает в уведомления.

## Запуск

1. **Создайте отдельного бота** в [@BotFather](https://t.me/BotFather) и возьмите его токен.
   ⚠️ Не используйте токен бота уведомлений сайта (`TELEGRAM_BOT_TOKEN` на Vercel): сайт читает его
   `getUpdates` для привязки чатов, и два читателя одного бота мешают друг другу (ошибка 409).
2. Установите зависимости (Python 3.9+, рекомендуется 3.12):
   ```bash
   cd bot
   python3 -m venv .venv
   .venv/bin/pip install -r requirements-dev.txt
   cp .env.example .env   # впишите BOT_TOKEN и OPENAI_API_KEY
   ```
3. Запуск через polling:
   ```bash
   .venv/bin/python bot.py
   ```
4. Или webhook (сервер с HTTPS): задайте `WEBHOOK_BASE_URL` и `WEBHOOK_SECRET`, затем
   ```bash
   .venv/bin/uvicorn api:app --host 0.0.0.0 --port 8080
   ```
5. Docker: `docker build -t qazaq-bot bot && docker run --env-file bot/.env -v qazaq-data:/app/data qazaq-bot`

Без `OPENAI_API_KEY` работают анкета, дайджест, карточки, симулятор и поиск по тексту (эвристический
разбор). Голос и анализ документов требуют ключ.

## Как пользоваться

- `/start` → анкета из 5 шагов: капитал (млн ₸), город, минимальная маржа, сфера, налоговый режим.
- `/digest` — топ-3 лота для вашей сферы; под каждой карточкой кнопки
  `📊 Полный финансовый разбор` · `🚀 Ссылка на лот` · `🧪 Симулятор «Что если?»` · `❌ Не подходит`.
- Симулятор: `⛽ Топливо +15%`, `📦 Закупка +10%`, `⏱ Постоплата +30 дней` — сценарии комбинируются,
  пересчёт мгновенный (сообщение редактируется на месте, состояние хранится в callback_data).
- Голосовое «Найди мне тендеры на мебель в Астане до 10 млн тенге» → Whisper → фильтры → список с TOS.
- PDF/DOCX техспецификации или ссылка на лот → экспресс-вердикт. Бот показывает, какие условия
  не нашлись в документе и были приняты по умолчанию.
- `🔔 Уведомления` — проверка ленты каждые `ALERT_INTERVAL_MIN` минут; присылает новые лоты
  с TOS ≥ `ALERT_MIN_TOS` и маржой не ниже вашей.
- `/set opex 2,5`, `/set radius 900`, `/set exp 5`, `/set certs ISO 9001, СТ РК`, `/set credit 22` — уточнение двойника.

## Тесты

```bash
cd bot && .venv/bin/python -m pytest -q
# пересчитать эталоны TS-движка после изменений в lib/engine.ts (из корня репозитория):
node bot/tests/make_parity_fixture.mjs
```

## Ограничения

- Лента лотов берётся с сайта. Пока там не задан `GOSZAKUP_TOKEN`, лоты демонстрационные (бот это показывает).
- Сканы без текстового слоя не читаются (OCR нет). Себестоимость в документах не пишут: принимается 78 % суммы.
- Состояние анкеты хранится в памяти (`MemoryStorage`); для нескольких инстансов замените на `RedisStorage`,
  а SQLite — на PostgreSQL.
