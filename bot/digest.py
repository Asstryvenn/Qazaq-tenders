"""
Smart Daily Digest для Telegram-бота: фильтры пользователя (/filters), сопоставление лотов и
двухблочная карточка:
  Блок 1 — ИИ-аналитика Qazaq Tenders (TOS и вердикт, чистая прибыль, кассовый разрыв, логистика);
  Блок 2 — технические детали «на всякий случай» (№, заказчик, место, бюджет и цена за единицу,
           способ закупки, срок подачи, прямые ссылки на ТЗ) и ссылка на полный симулятор.
Только теги b/i/a, весь текст экранирован, длина ≤ 4096 символов.
"""
from __future__ import annotations

import datetime as dt
import html
import re
from typing import List, Optional

from pydantic import BaseModel, Field

from calculator import CITY_BY_ID
from models import AnalysisResult, CompanyTwin, TenderSpec

TELEGRAM_LIMIT = 4096


class DigestFilters(BaseModel):
    keywords: List[str] = Field(default_factory=list)
    min_budget: float = 1_000_000
    max_budget: float = 300_000_000
    regions: List[str] = Field(default_factory=list)  # пусто — все регионы
    enabled: bool = True


def stem(word: str) -> str:
    w = word.strip().lower()
    return w[: max(4, len(w) - 2)] if len(w) >= 5 else w


def normalize_keywords(text: str) -> List[str]:
    out: List[str] = []
    for k in re.split(r"[,;\n]+", text or ""):
        k = k.strip().lower()
        if len(k) >= 3 and k not in out:
            out.append(k)
    return out[:20]


def lot_matches(spec: TenderSpec, f: DigestFilters) -> bool:
    if not (f.min_budget <= spec.contract_amount <= f.max_budget):
        return False
    if f.regions and spec.city_id not in f.regions:
        return False
    if not f.keywords:
        return True
    hay = f"{spec.title} {spec.title_kz} {spec.customer}".lower()
    return any(stem(k) in hay for k in f.keywords)


def published_within(spec: TenderSpec, hours: float, now: Optional[dt.datetime] = None) -> bool:
    if spec.is_demo or not spec.published_at:
        return False
    try:
        t = dt.datetime.fromisoformat(spec.published_at)
    except ValueError:
        return False
    if t.tzinfo is None:
        t = t.replace(tzinfo=dt.timezone(dt.timedelta(hours=5)))
    now = now or dt.datetime.now(dt.timezone.utc)
    return t <= now + dt.timedelta(hours=1) and now - t <= dt.timedelta(hours=hours)


def _esc(s: str) -> str:
    return html.escape(str(s), quote=True)


def _money(v: float, lang: str, signed: bool = False) -> str:
    sign = "−" if v < 0 else ("+" if signed and v > 0 else "")
    a = abs(v)
    fmt = lambda x: f"{x:.1f}".replace(".", ",").removesuffix(",0") if hasattr(str, "removesuffix") else f"{x:.1f}".replace(".", ",")  # noqa: E731
    if a >= 1e9:
        return f"{sign}{fmt(a / 1e9)} млрд ₸"
    if a >= 1e6:
        return f"{sign}{fmt(a / 1e6)} млн ₸"
    if a >= 1e3:
        return f"{sign}{round(a / 1e3)} {'мың' if lang == 'kz' else 'тыс'} ₸"
    return f"{sign}{round(a)} ₸"


def _exact(v: float) -> str:
    return f"{round(v):,}".replace(",", " ") + " ₸"


def _date(v: Optional[str]) -> str:
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})", v or "")
    return f"{m.group(3)}.{m.group(2)}.{m.group(1)}" if m else (v or "—")


L = {
    "ru": dict(lot="Лот", budget="Бюджет", city="Город", ai="🤖 ИИ-аналитика Qazaq Tenders", tos="TOS Индекс",
               profit="Прогнозируемая чистая прибыль", margin="маржа", gap="Кассовый разрыв", no_gap="нет", days="дн.",
               log="Логистика", tech="📄 Технические детали", number="№ объявления / лота", customer="Заказчик",
               place="Место поставки", unit="Цена за единицу", method="Способ закупки", window="Приём заявок",
               docs="📎 ТЗ / документация", open="Открыть полный симулятор на сайте Qazaq Tenders", upto="до",
               go="ВЫГОДНО", caution="С ОСТОРОЖНОСТЬЮ", nogo="НЕ ВЫГОДНО",
               modes={"truck": "Фура 20 т", "gazelle": "Газель 3 т", "rail": "Ж/Д контейнер", "air": "Авиа-экспресс", "city": "По городу"}),
    "kz": dict(lot="Лот", budget="Бюджет", city="Қала", ai="🤖 Qazaq Tenders AI-талдауы", tos="TOS индексі",
               profit="Болжамды таза пайда", margin="маржа", gap="Кассалық алшақтық", no_gap="жоқ", days="күн",
               log="Логистика", tech="📄 Техникалық мәліметтер", number="Хабарландыру / лот №", customer="Тапсырыс беруші",
               place="Жеткізу орны", unit="Бірлік бағасы", method="Сатып алу тәсілі", window="Өтінім қабылдау",
               docs="📎 ТЕ / құжаттар", open="Qazaq Tenders сайтында толық симуляторды ашу", upto="дейін",
               go="ТИІМДІ", caution="САҚТЫҚПЕН", nogo="ТИІМСІЗ",
               modes={"truck": "Фура 20 т", "gazelle": "Газель 3 т", "rail": "Теміржол контейнері", "air": "Әуе экспрессі", "city": "Қала ішінде"}),
}


def _city(city_id: str, lang: str) -> str:
    c = CITY_BY_ID.get(city_id)
    return (c.kz if lang == "kz" else c.ru) if c else city_id


def digest_card(spec: TenderSpec, res: AnalysisResult, twin: CompanyTwin, lang: str, site_url: str) -> str:
    t = L["kz" if lang == "kz" else "ru"]
    title = (spec.title_kz if lang == "kz" and spec.title_kz else spec.title).strip()
    verdict, emoji = {"go": (t["go"], "🟢"), "caution": (t["caution"], "🟡")}.get(res.verdict, (t["nogo"], "🔴"))
    gap = f"{res.days_in_deficit} {t['days']}, {t['upto']} −{_money(res.max_deficit, lang)}" if res.cash_flow_gap else t["no_gap"]
    logistics = f"{t['modes'].get(res.transport_mode, res.transport_mode)} · {_money(res.costs.logistics, lang)} · {res.transit_days} {t['days']} · {res.logistics_rate_label}"
    unit = "—"
    if spec.unit_price_kzt is not None:
        unit = _exact(spec.unit_price_kzt) + (f" × {spec.quantity:g}{(' ' + spec.unit) if spec.unit else ''}" if spec.quantity else "")
    tech = [
        # № объявления — только если он не совпадает с началом номера лота (в e-магазинах часто одинаковы)
        (t["number"], " · ".join(x for x in ((spec.announcement_no if spec.announcement_no and not spec.external_id.startswith(spec.announcement_no) else ""), spec.external_id) if x) or "—"),
        (t["customer"], spec.customer or "—"),
        (t["place"], spec.delivery_place or _city(spec.city_id, lang)),
        (t["budget"], _exact(spec.contract_amount)),
        (t["unit"], unit),
        (t["method"], spec.purchase_method or "—"),
        (t["window"], f"{_date(spec.bid_start_at)} — {_date(spec.deadline)}"),
    ]
    docs = [d for d in spec.documents if re.match(r"^https?://", d.url)][:4]
    url = f"{site_url.rstrip('/')}/tender/{spec.id}"
    head = "\n".join([
        f"📌 <b>{t['lot']}:</b> {_esc(title[:180])} ({t['budget']}: {_esc(_money(spec.contract_amount, lang))})",
        f"📍 <b>{t['city']}:</b> {_esc(_city(twin.base_city_id, lang))} → {_esc(_city(spec.city_id, lang))}",
        "",
        f"<b>{t['ai']}</b>",
        f"📊 {t['tos']}: <b>{round(res.tos)}/100</b> — {emoji} <b>{verdict}</b>",
        f"💰 {t['profit']}: <b>{_esc(_money(res.net_profit, lang, True))}</b> ({t['margin']} {res.margin_pct:.1f}%)".replace(".", ",", 1) if False else
        f"💰 {t['profit']}: <b>{_esc(_money(res.net_profit, lang, True))}</b> ({t['margin']} {f'{res.margin_pct:.1f}'.replace('.', ',')}%)",
        f"🕳 {t['gap']}: {_esc(gap)}",
        f"🚚 {t['log']}: {_esc(logistics)}",
        "",
        f"<b>{t['tech']}</b>",
        f"<i>{_esc(title[:400])}</i>",
        *[f"• {k}: {_esc(v[:300])}" for k, v in tech],
    ])
    doc_line = ("\n" + t["docs"] + ": " + ", ".join(f'<a href="{_esc(d.url)}">{_esc(d.name[:60])}</a>' for d in docs)) if docs else ""
    link = f'\n🔗 <a href="{_esc(url)}">{t["open"]}</a>'
    text = head + doc_line + link
    return text if len(text) <= TELEGRAM_LIMIT else head[: TELEGRAM_LIMIT - len(link) - 2] + "…" + link


def digest_header(count: int, lang: str) -> str:
    return (
        f"☀️ <b>Таңғы дайджест</b>: сүзгілеріңіз бойынша {count} жаңа лот"
        if lang == "kz"
        else f"☀️ <b>Утренний дайджест</b>: {count} новых лотов по вашим фильтрам"
    )


def filters_view(f: DigestFilters, lang: str) -> str:
    kz = lang == "kz"
    regions = ", ".join(_city(r, lang) for r in f.regions) or ("барлық өңірлер" if kz else "все регионы")
    words = ", ".join(f.keywords) or ("барлық тақырыптар" if kz else "все темы")
    state = ("✅ қосулы, күн сайын 08:00" if kz else "✅ включена, каждый день в 08:00") if f.enabled else ("⏸ өшірулі" if kz else "⏸ выключена")
    return "\n".join([
        f"📬 <b>{'Ақылды тарату' if kz else 'Умная рассылка'}</b> — {state}",
        f"🔑 {'Кілт сөздер' if kz else 'Ключевые слова'}: {_esc(words)}",
        f"💰 {'Бюджет' if kz else 'Бюджет'}: {_esc(_money(f.min_budget, lang))} — {_esc(_money(f.max_budget, lang))}",
        f"📍 {'Өңірлер' if kz else 'Регионы'}: {_esc(regions)}",
        "",
        ("Өзгерту:" if kz else "Изменить:"),
        "<code>/filters keywords сервера, компьютеры</code>",
        "<code>/filters budget 1-300</code>",
        "<code>/filters regions astana, almaty</code> · <code>/filters regions all</code>",
        "<code>/filters on</code> · <code>/filters off</code> · <code>/filters now</code>",
    ])
