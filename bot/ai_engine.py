"""
Qazaq Tenders — AI-СЛОЙ (OpenAI).

Три задачи, и ни одна из них не считает деньги:
  1. transcribe()          — голос → текст (Whisper);
  2. parse_search_query()  — текст запроса → SearchQuery (город, сумма, предмет);
  3. extract_tender()      — текст техспецификации → TenderSpec (факты + NLP-«сито» рисков).

Ответы модели ограничены строгой JSON-схемой (response_format=json_schema, strict=True),
поэтому в экономический слой попадают только валидные типизированные данные. Всё, чего нет
в документе, модель возвращает как null, а допущение фиксирует уже код, а не модель.
"""
from __future__ import annotations

import hashlib
import json
import logging
import re
from typing import Any, Dict, List, Optional, Tuple

import openai
from openai import AsyncOpenAI

from calculator import CITIES, CITY_BY_ID
from models import HiddenRequirement, SearchQuery, SpecPage, TenderSpec
from tenders import INDUSTRIES

log = logging.getLogger(__name__)

MAX_PROMPT_CHARS = 120_000
# Страницы с этими словами важнее всего, если документ не помещается в контекст
KEY_TERMS = (
    "оплат", "срок", "неустойк", "штраф", "пен", "обеспечен", "аванс", "сумм", "требован", "опыт", "сертификат",
    "лиценз", "гарант", "поставк", "төлем", "мерзім", "айыппұл", "кепіл", "талап", "тәжірибе",
)
# Подсказка Whisper: словарь предметной области улучшает распознавание
WHISPER_PROMPT = "Госзакупки, тендер, лот, goszakup, Астана, Алматы, Шымкент, Караганда, млн тенге, мемлекеттік сатып алу, теңге."
_KEY_RE = re.compile(r"sk-[A-Za-z0-9_\-]{8,}")


class AIError(Exception):
    """code: no_key | invalid_key | quota | rate_limit | network | bad_response | no_budget | unknown."""

    def __init__(self, code: str, detail: str = "") -> None:
        detail = _KEY_RE.sub("sk-***", detail)  # OpenAI иногда цитирует ключ в тексте ошибки
        super().__init__(f"{code}: {detail}" if detail else code)
        self.code = code
        self.detail = detail


def _map_error(e: Exception) -> AIError:
    if isinstance(e, (openai.AuthenticationError, openai.PermissionDeniedError)):
        return AIError("invalid_key", str(e))
    if isinstance(e, openai.RateLimitError):
        quota = getattr(e, "code", None) == "insufficient_quota" or "insufficient_quota" in str(e)
        return AIError("quota" if quota else "rate_limit", str(e))
    if isinstance(e, (openai.APIConnectionError, openai.APITimeoutError)):
        return AIError("network", str(e))
    return AIError("unknown", str(e))


def _nullable(schema: Dict[str, Any]) -> Dict[str, Any]:
    t = schema.get("type")
    out = dict(schema, type=[t, "null"] if isinstance(t, str) else t)
    if "enum" in out:
        out["enum"] = list(out["enum"]) + [None]
    return out


CITY_IDS = [c.id for c in CITIES]
CITY_HINT = ", ".join(f"{c.id} ({c.ru})" for c in CITIES)
INDUSTRY_HINT = ", ".join(f"{i.id} ({i.ru})" for i in INDUSTRIES.values())

SEARCH_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "keywords": {"type": "array", "items": {"type": "string"}},
        "industry": _nullable({"type": "string", "enum": list(INDUSTRIES)}),
        "city_id": _nullable({"type": "string", "enum": CITY_IDS}),
        "max_amount_kzt": _nullable({"type": "number"}),
        "min_amount_kzt": _nullable({"type": "number"}),
    },
    "required": ["keywords", "industry", "city_id", "max_amount_kzt", "min_amount_kzt"],
}

SEARCH_SYSTEM = f"""Ты разбираешь поисковый запрос предпринимателя к госзакупкам Казахстана. Запрос на русском или
казахском, возможно распознан из речи с ошибками. Верни JSON:
- keywords: 1–5 основ слов ПРЕДМЕТА закупки в нижнем регистре, на русском И казахском
  (например «мебель» → «мебел», «жиһаз», «стол»). Без слов «тендер», «найди», городов и сумм.
- industry: одна категория из списка или null. Категории: {INDUSTRY_HINT}
- city_id: город поставки из списка или null. Города: {CITY_HINT}
- max_amount_kzt / min_amount_kzt: границы суммы лота в тенге («до 10 млн» → 10000000,
  «10 млн теңгеге дейін» → 10000000, «от 5 млн» → min 5000000) или null."""

FACTS_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "title": {"type": "string"},
        "customer": _nullable({"type": "string"}),
        "city_id": _nullable({"type": "string", "enum": CITY_IDS}),
        "budget_kzt": _nullable({"type": "number"}),
        "delivery_days": _nullable({"type": "integer"}),
        "payment_delay_days": _nullable({"type": "integer"}),
        "advance_pct": _nullable({"type": "number"}),
        "penalty_pct_per_day": _nullable({"type": "number"}),
        "bid_security_pct": _nullable({"type": "number"}),
        "performance_security_pct": _nullable({"type": "number"}),
        "bid_deadline": _nullable({"type": "string"}),
        "cargo_tonnes": _nullable({"type": "number"}),
        "required_experience_years": _nullable({"type": "number"}),
        "required_certificates": {"type": "array", "items": {"type": "string"}},
        "hidden_requirements": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "clause": {"type": "string"},
                    "page": {"type": "integer"},
                    "severity": {"type": "string", "enum": ["low", "medium", "high"]},
                    "reason": {"type": "string"},
                },
                "required": ["clause", "page", "severity", "reason"],
            },
        },
    },
    "required": [
        "title", "customer", "city_id", "budget_kzt", "delivery_days", "payment_delay_days", "advance_pct",
        "penalty_pct_per_day", "bid_security_pct", "performance_security_pct", "bid_deadline", "cargo_tonnes",
        "required_experience_years", "required_certificates", "hidden_requirements",
    ],
}

FACTS_SYSTEM = """Ты — юрист-аналитик госзакупок Республики Казахстан. Тебе дан текст техспецификации или объявления
лота с метками страниц [стр. N]. Извлеки ТОЛЬКО факты, которые прямо есть в тексте. Ничего не считай и не
придумывай: если факта нет — null.
- title — предмет закупки кратко; customer — заказчик.
- budget_kzt — сумма закупки/договора в тенге («46 500 000» → 46500000).
- delivery_days — срок поставки/оказания услуг в календарных днях от заключения договора (если указана только дата — null).
- payment_delay_days — через сколько дней после поставки/подписания акта платит заказчик.
- advance_pct — аванс в % (0, если прямо сказано, что аванса нет).
- penalty_pct_per_day — неустойка за просрочку в % в день («0,1 %» → 0.1).
- bid_security_pct / performance_security_pct — обеспечение заявки / исполнения договора в %.
- bid_deadline — срок подачи заявок в формате YYYY-MM-DD.
- city_id — город поставки из списка: {cities}.
- cargo_tonnes — общий вес поставки в тоннах, только если указан или однозначно следует из текста.
- hidden_requirements — пункты, которые ограничивают конкуренцию или опасны для малого бизнеса: конкретный бренд
  без аналогов; собственный склад/сервис в конкретном городе; нереальные сроки; неустойка выше 0,1 % в день или без
  потолка; оплата позже 30 дней; нет аванса при крупной сумме; опыт больше 3 лет; лицензии, не связанные с предметом.
  clause — дословная цитата (до 300 символов), page — номер из метки [стр. N], severity — low/medium/high,
  reason — одно короткое предложение на {lang_name} языке: почему это риск."""


def _select_pages(pages: List[SpecPage]) -> Tuple[List[SpecPage], bool]:
    """Если документ не помещается в контекст, берём первые 3 страницы и страницы с ключевыми терминами."""
    if sum(len(p.text) for p in pages) <= MAX_PROMPT_CHARS:
        return pages, False
    scored = sorted(
        pages,
        key=lambda p: (p.page > 3, -sum(p.text.lower().count(k) for k in KEY_TERMS)),
    )
    chosen, size = [], 0
    for p in scored:
        if size + len(p.text) > MAX_PROMPT_CHARS:
            continue
        chosen.append(p)
        size += len(p.text)
    return sorted(chosen, key=lambda p: p.page), True


def _find_page(clause: str, pages: List[SpecPage], given: int) -> int:
    """Проверяем номер страницы от модели: если цитата найдена на другой странице — исправляем."""
    probe = re.sub(r"\s+", " ", clause.strip().lower())[:60]
    if probe:
        for p in pages:
            if probe in re.sub(r"\s+", " ", p.text.lower()):
                return p.page
    valid = {p.page for p in pages}
    return given if given in valid else (pages[0].page if pages else 1)


class AIEngine:
    def __init__(self, api_key: str, model: str = "gpt-4o-mini", transcribe_model: str = "whisper-1") -> None:
        key = (api_key or "").strip()
        self.model = model
        self.transcribe_model = transcribe_model
        self._client: Optional[AsyncOpenAI] = AsyncOpenAI(api_key=key, timeout=90, max_retries=2) if key else None
        if key:
            log.info("OpenAI key loaded (%s…)", key[:5])

    @property
    def available(self) -> bool:
        return self._client is not None

    def _require(self) -> AsyncOpenAI:
        if self._client is None:
            raise AIError("no_key")
        return self._client

    # ------------------------------ 1. Whisper ------------------------------ #

    async def transcribe(self, audio: bytes, filename: str = "voice.ogg") -> str:
        """Голосовое Telegram (OGG/Opus) → текст. Язык определяется автоматически (рус./каз.)."""
        client = self._require()
        try:
            r = await client.audio.transcriptions.create(model=self.transcribe_model, file=(filename, audio), prompt=WHISPER_PROMPT)
        except openai.OpenAIError as e:
            raise _map_error(e) from e
        return (r.text or "").strip()

    # ------------------------- общий вызов с JSON-схемой ------------------------ #

    async def _json(self, system: str, user: str, name: str, schema: Dict[str, Any]) -> Dict[str, Any]:
        client = self._require()
        try:
            r = await client.chat.completions.create(
                model=self.model,
                temperature=0,
                messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
                response_format={"type": "json_schema", "json_schema": {"name": name, "strict": True, "schema": schema}},
            )
        except openai.OpenAIError as e:
            raise _map_error(e) from e
        msg = r.choices[0].message
        if getattr(msg, "refusal", None) or not msg.content:
            raise AIError("bad_response", getattr(msg, "refusal", "") or "empty")
        try:
            return json.loads(msg.content)
        except json.JSONDecodeError as e:
            raise AIError("bad_response", str(e)) from e

    # --------------------------- 2. Поисковый запрос --------------------------- #

    async def parse_search_query(self, text: str) -> SearchQuery:
        data = await self._json(SEARCH_SYSTEM, text[:2000], "search_query", SEARCH_SCHEMA)
        q = SearchQuery(**data)
        # «it», «гп» и т. п. дают ложные совпадения подстрокой — оставляем слова от 3 букв
        q.keywords = [k.lower().strip() for k in q.keywords if len(k.strip()) >= 3][:6]
        if q.industry == "other":
            q.industry = None
        return q

    # ------------------------ 3. Факты из техспецификации ------------------------ #

    async def extract_tender(
        self,
        pages: List[SpecPage],
        source_name: str,
        fallback_city: str,
        lang: str,
        source_url: str = "",
    ) -> Tuple[TenderSpec, List[str]]:
        """Текст документа → TenderSpec + список допущений (чего не было в документе)."""
        selected, truncated = _select_pages(pages)
        body = "\n\n".join(f"[стр. {p.page}]\n{p.text}" for p in selected)
        system = FACTS_SYSTEM.format(cities=CITY_HINT, lang_name="казахском" if lang == "kz" else "русском")
        f = await self._json(system, body, "tender_facts", FACTS_SCHEMA)

        budget = f.get("budget_kzt")
        if not budget or budget <= 0:
            raise AIError("no_budget")

        assumptions: List[str] = []

        def pick(value: Any, default: Any, key: str) -> Any:
            if value is None:
                assumptions.append(key)
                return default
            return value

        delivery = int(min(365, max(1, pick(f.get("delivery_days"), 30, "delivery"))))
        payment = int(min(365, max(0, pick(f.get("payment_delay_days"), 30, "payment"))))
        city = f.get("city_id") if f.get("city_id") in CITY_BY_ID else None
        if city is None:
            assumptions.append("city")
            city = fallback_city
        penalty_pct = pick(f.get("penalty_pct_per_day"), 0.1, "penalty")
        cargo = float(max(0.1, pick(f.get("cargo_tonnes"), 2.0, "cargo")))
        # Себестоимость в документе не пишут: оцениваем как 78 % суммы (как и сайт)
        assumptions.append("purchase")
        if truncated:
            assumptions.append("truncated")

        pct_or_none = lambda v: (v / 100) if isinstance(v, (int, float)) and v >= 0 else None  # noqa: E731
        hidden = [
            HiddenRequirement(
                clause=h["clause"][:300],
                page=_find_page(h["clause"], pages, h["page"]),
                severity=h["severity"],
                reason=h["reason"][:240],
            )
            for h in f.get("hidden_requirements", [])[:12]
        ]
        digest = hashlib.sha1("".join(p.text for p in pages).encode("utf-8")).hexdigest()[:12]
        title = (f.get("title") or source_name or "—").strip()[:200]

        spec = TenderSpec(
            id=f"upload-{digest}",
            external_id=source_name[:120],
            source="link" if source_url else "upload",
            source_url=source_url,
            estimated=True,
            title=title,
            title_kz=title,
            customer=(f.get("customer") or "").strip()[:200],
            contract_amount=float(budget),
            advance_percentage=float(min(100, max(0, f.get("advance_pct") or 0))),
            bid_security_rate=pct_or_none(f.get("bid_security_pct")),
            performance_security_rate=pct_or_none(f.get("performance_security_pct")),
            delivery_days=delivery,
            payment_delay_days=payment,
            penalty_rate=float(penalty_pct) / 100,
            purchase_cost=float(budget) * 0.78,
            city_id=city,
            cargo_tonnes=cargo,
            required_experience_years=float(f.get("required_experience_years") or 0),
            required_certificates=[c.strip()[:80] for c in f.get("required_certificates", []) if c.strip()][:10],
            hidden_requirements=hidden,
            deadline=(f.get("bid_deadline") or "")[:10],
        )
        return spec, assumptions
