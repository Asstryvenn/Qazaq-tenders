"""
Источник лотов и фильтрация.

Лента берётся с сайта Qazaq Tenders (GET {QT_API_BASE}/api/tenders): сайт уже сводит
goszakup, Samruk-Kazyna, НадLoc, ERG и BI Group к единому формату TenderSpec. Когда
на сайте появится GOSZAKUP_TOKEN, бот сам начнёт получать живые лоты — без изменений кода.
Если сайт недоступен, бот работает на снимке data/sample_tenders.json.
"""
from __future__ import annotations

import hashlib
import json
import logging
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

import httpx

from calculator import CITIES
from models import SearchQuery, TenderSpec

log = logging.getLogger(__name__)
SAMPLE_PATH = Path(__file__).resolve().parent / "data" / "sample_tenders.json"


def lot_key(tender_id: str) -> str:
    """Короткий ключ лота для callback_data (лимит Telegram — 64 байта, а id бывают кириллицей)."""
    return hashlib.sha1(tender_id.encode("utf-8")).hexdigest()[:10]


# ----------------------------- сферы деятельности ----------------------------- #


@dataclass(frozen=True)
class Industry:
    id: str
    emoji: str
    kz: str
    ru: str
    # Основы слов (рус. + каз.) — ищутся подстрокой в названии лота
    keywords: Tuple[str, ...]


INDUSTRIES: Dict[str, Industry] = {
    i.id: i
    for i in [
        Industry("it", "💻", "IT және техника", "IT и оргтехника", ("компьютер", "ноутбук", "оргтехник", "сервер", "моноблок", "интерактив", "программ")),
        Industry("construction", "🏗", "Құрылыс және жөндеу", "Стройка и ремонт", ("строител", "ремонт", "кровл", "арматур", "бетон", "асфальт", "құрылыс", "жөндеу", "шатыр")),
        Industry("furniture", "🪑", "Жиһаз", "Мебель", ("мебел", "жиһаз", "стол", "стул", "шкаф", "парт")),
        Industry("office", "📎", "Кеңсе тауарлары", "Канцтовары", ("канцеляр", "бумаг", "расходн", "кеңсе")),
        Industry("medical", "💊", "Медицина", "Медицина", ("медикамент", "лекарств", "медицинск", "дәрі")),
        Industry("food", "🍞", "Азық-түлік", "Продукты питания", ("продукт", "питани", "азық", "мяс", "молок", "хлеб")),
        Industry("fuel", "⛽", "ЖЖМ", "ГСМ и топливо", ("гсм", "топлив", "бензин", "дизел", "жанармай")),
        Industry("parts", "⚙️", "Қосалқы бөлшектер", "Запчасти и техника", ("запасн", "запчаст", "шин", "аккумулятор", "подвижн", "қосалқы", "бөлшек")),
        Industry("textile", "👷", "Арнайы киім", "Спецодежда и текстиль", ("спецодежд", "одежд", "текстил", "киім")),
        Industry("services", "🧹", "Қызметтер (ҚТҚ, тазалау)", "Услуги (ТБО, уборка)", ("вывоз", "утилиз", "уборк", "охран", "тбо", "қтқ", "тазала")),
        Industry("industrial", "⛏", "Өнеркәсіп және геология", "Промышленность и геология", ("бурен", "геолог", "огнеупор", "футеров", "бұрғыла", "төзімді")),
        Industry("other", "🔎", "Барлық салалар", "Все сферы", ()),
    ]
}


def _title_hay(spec: TenderSpec) -> str:
    return f"{spec.title} {spec.title_kz}".lower()


def industry_matches(spec: TenderSpec, industry: Optional[str]) -> bool:
    ind = INDUSTRIES.get(industry or "other")
    if ind is None or not ind.keywords:
        return True
    hay = _title_hay(spec)
    return any(k in hay for k in ind.keywords)


def stem(word: str) -> str:
    """Грубая основа слова: «кровля» → «кров» (найдёт «кровли»), «мебель» → «мебе». Короткие слова — как есть."""
    w = word.lower().strip()
    return w[: max(4, len(w) - 2)] if len(w) >= 5 else w


def keyword_matches(spec: TenderSpec, keywords: Iterable[str]) -> bool:
    """Ищет основы слов в названии, заказчике и тексте спецификации."""
    hay = f"{_title_hay(spec)} {spec.customer.lower()} {' '.join(p.text for p in spec.spec_pages).lower()}"
    return any(stem(k) in hay for k in keywords if len(k.strip()) >= 3)


def filter_lots(lots: List[TenderSpec], q: SearchQuery) -> List[TenderSpec]:
    """Город и сумма — жёсткие фильтры; предмет — совпадение по ключевым словам ИЛИ по сфере."""
    topic = bool(q.keywords) or (q.industry not in (None, "other"))
    out = []
    for s in lots:
        if q.city_id and s.city_id != q.city_id:
            continue
        if q.max_amount_kzt and s.contract_amount > q.max_amount_kzt:
            continue
        if q.min_amount_kzt and s.contract_amount < q.min_amount_kzt:
            continue
        if topic:
            by_kw = bool(q.keywords) and keyword_matches(s, q.keywords)
            by_ind = q.industry not in (None, "other") and industry_matches(s, q.industry)
            if not (by_kw or by_ind):
                continue
        out.append(s)
    return out


def find_by_url(lots: List[TenderSpec], url: str) -> Optional[TenderSpec]:
    """Ссылка на лот, который уже есть в ленте → считаем без AI."""
    u = url.lower()
    for s in lots:
        ext = s.external_id.lower()
        if ext and (ext in u or ext.split("-")[0] in u.split("/")):
            return s
    return None


# ------------------------------ города в тексте ------------------------------ #

_TOKEN = re.compile(r"[a-zа-яёәғқңөұүһі\-]+", re.IGNORECASE)


def match_city(text: str) -> Optional[str]:
    """«в Астане», «Алматыда», «Караганде» → id города (по основе названия)."""
    tokens = _TOKEN.findall(text.lower())
    for c in CITIES:
        for name in {c.ru.lower(), c.kz.lower(), c.id}:
            stem = name[:5] if len(name) >= 6 else name
            for tok in tokens:
                if tok.startswith(stem) and (len(name) >= 6 or len(tok) <= len(name) + 3):
                    return c.id
    return None


# ------------------------------- эвристический NLP ------------------------------ #

_AMOUNT = re.compile(r"(\d+(?:[.,]\d+)?)\s*(млрд|миллиард\w*|млн|миллион\w*|тыс\w*|мың|k|к)?", re.IGNORECASE)
_UNITS = {"млрд": 1e9, "миллиард": 1e9, "млн": 1e6, "миллион": 1e6, "тыс": 1e3, "мың": 1e3, "k": 1e3, "к": 1e3}
_STOP = {
    "найди", "найти", "покажи", "подбери", "тендер", "тендеры", "тендеров", "лоты", "лотов", "закупки", "госзакупки",
    "мне", "пожалуйста", "тенге", "теңге", "миллионов", "городе", "области", "поставка", "поставку", "услуги",
    "табыңыз", "тауып", "маған", "көрсет", "көрсетіңіз", "керек", "қаласында", "жеткізу", "бер", "беріңіз",
}


def heuristic_search(text: str) -> SearchQuery:
    """Разбор запроса без AI (нет ключа или исчерпан лимит). Грубее, но детерминированно."""
    low = text.lower()
    q = SearchQuery(city_id=match_city(low))
    for m in _AMOUNT.finditer(low):
        unit = (m.group(2) or "").lower()
        mult = next((v for k, v in _UNITS.items() if unit.startswith(k)), None) if unit else None
        if mult is None:
            continue  # голое число без единиц — не сумма (может быть «3 года»)
        value = float(m.group(1).replace(",", ".")) * mult
        before, after = low[max(0, m.start() - 14) : m.start()], low[m.end() : m.end() + 16]
        if re.search(r"\bот\b|свыше|более|больше|кем емес", before) or "бастап" in after or "артық" in after:
            q.min_amount_kzt = value
        else:  # «до 10 млн», «10 млн дейін» или без предлога — верхняя граница
            q.max_amount_kzt = value
    q.industry = next((i.id for i in INDUSTRIES.values() if i.keywords and any(k in low for k in i.keywords)), None)
    if q.industry is None:
        words = [w for w in _TOKEN.findall(low) if len(w) >= 5 and w not in _STOP and match_city(w) is None]
        q.keywords = [w[:6] for w in words][:4]
    return q


# ---------------------------------- лента ---------------------------------- #


def _parse_lots(items: List[dict]) -> List[TenderSpec]:
    lots = []
    for item in items:
        try:
            lots.append(TenderSpec.model_validate(item))
        except Exception as e:  # noqa: BLE001 — один битый лот не должен ронять ленту
            log.warning("skip lot %s: %s", item.get("id"), e)
    return lots


class TenderFeed:
    """Кэширует ленту на `ttl` секунд, чтобы не дёргать сайт на каждое нажатие."""

    def __init__(self, base_url: str, ttl: float = 300) -> None:
        self.base_url = base_url
        self.ttl = ttl
        self._lots: List[TenderSpec] = []
        self._live = False
        self._at = 0.0

    async def get(self, force: bool = False) -> Tuple[List[TenderSpec], bool]:
        """Возвращает (лоты, live). live=False — демо-лоты (на сайте нет ключа API)."""
        if self._lots and not force and time.monotonic() - self._at < self.ttl:
            return self._lots, self._live
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                r = await client.get(f"{self.base_url}/api/tenders")
                r.raise_for_status()
                data = r.json()
            lots, live = _parse_lots(data.get("tenders", [])), bool(data.get("live"))
            if not lots:
                raise ValueError("empty feed")
        except Exception as e:  # noqa: BLE001
            log.warning("feed unavailable (%s) — using %s", e, "cache" if self._lots else "sample")
            if self._lots:
                return self._lots, self._live
            data = json.loads(SAMPLE_PATH.read_text("utf-8"))
            lots, live = _parse_lots(data["tenders"]), False
        self._lots, self._live, self._at = lots, live, time.monotonic()
        return lots, live
