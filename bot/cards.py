"""
Визуализация для Telegram: карточка лота, полный разбор, симулятор «Что если?»,
результаты поиска, профиль и все inline-клавиатуры.

Здесь только представление: все числа приходят из calculator.analyze_tender().
"""
from __future__ import annotations

from typing import List, Optional, Tuple

import numpy as np
from aiogram.filters.callback_data import CallbackData
from aiogram.types import InlineKeyboardMarkup
from aiogram.utils.keyboard import InlineKeyboardBuilder

from calculator import CITIES, SCENARIO_LEVERS, TOS_WEIGHTS, js_round, meets_min_margin, timeline_frame, twin_verdict
from logistics import LogisticsMode, logistics_plan
from models import AnalysisResult, CompanyTwin, Scenario, SearchQuery, SupplierOffer, TenderSpec
from tenders import INDUSTRIES
from texts import EVENT_LABELS, TAX_LABELS, city_name, esc, fmt_date, join_items, money, num, pct, reason_text, t

# ------------------------------- callback data ------------------------------- #


class LotCB(CallbackData, prefix="lot"):
    """action: open | card | full | sim | hide | unhide; m — битовая маска сценария."""

    action: str
    key: str
    m: int = 0


class MenuCB(CallbackData, prefix="menu"):
    action: str


class SetupCB(CallbackData, prefix="st"):
    field: str
    value: str = ""


class SupplierCB(CallbackData, prefix="sup"):
    action: str  # list | choose | back
    key: str
    offer: str = ""


class LogisticsCB(CallbackData, prefix="log"):
    action: str  # list | choose | back
    key: str
    mode: str = "auto"


SEVERITY_ORDER = {"high": 0, "medium": 1, "low": 2}
LEVER_TEXT = {
    "fuel": "lever_fuel",
    "supplier": "lever_supplier",
    "payment": "lever_payment",
    "advance": "lever_advance",
    "own_transport": "lever_own_transport",
}

LOGISTICS_LABELS = {
    "city": {"kz": "🏙️ Қала ішінде", "ru": "🏙️ По городу"},
    "truck": {"kz": "🚛 Авто-фура 20 т", "ru": "🚛 Авто-фура 20 т"},
    "gazelle": {"kz": "🚚 Газель 3 т дейін", "ru": "🚚 Газель до 3 т"},
    "rail": {"kz": "🚂 Теміржол контейнері", "ru": "🚂 Ж/Д контейнер"},
    "air": {"kz": "✈️ Әуе экспрессі", "ru": "✈️ Авиа-экспресс"},
}


def _title(spec: TenderSpec, lang: str) -> str:
    return spec.title_kz if lang == "kz" and spec.title_kz else spec.title


def tos_bar(tos: float) -> str:
    filled = max(0, min(10, js_round(tos / 10)))
    return "▰" * filled + "▱" * (10 - filled)


def verdict_label(verdict: str, lang: str) -> str:
    return t(f"verdict_{verdict}", lang)


def logistics_level(res: AnalysisResult) -> str:
    if res.logistics_score >= 70:
        return "low"
    if res.logistics_score >= 40:
        return "medium"
    return "high"


def main_risk(spec: TenderSpec, res: AnalysisResult, lang: str) -> str:
    """Главный юридический/финансовый риск: сначала «high» из NLP-сита, затем причины движка."""
    hidden = sorted(spec.hidden_requirements, key=lambda h: SEVERITY_ORDER[h.severity])
    page = "бет" if lang == "kz" else "стр."
    if hidden and hidden[0].severity == "high":
        h = hidden[0]
        return f"{esc(h.reason)} ({page} {h.page})"
    by_code = {r.code: r for r in res.reasons}
    for code in ("certs", "experience", "penalty", "gap", "bankHeavy", "lowMargin", "hidden", "overRadius", "thinMargin"):
        if code in by_code:
            return reason_text(code, by_code[code].data, lang)
    if hidden:
        return f"{esc(hidden[0].reason)} ({page} {hidden[0].page})"
    return t("no_major_risk", lang)


# --------------------------------- карточка --------------------------------- #


def lot_card(spec: TenderSpec, res: AnalysisResult, twin: CompanyTwin, lang: str, header: str = "", show_estimated: bool = True) -> str:
    lines: List[str] = []
    if header:
        lines += [header, ""]
    lines.append(f"🏛 <b>{esc(_title(spec, lang))}</b>")
    if spec.customer:
        lines.append(f"{t('customer', lang)}: {esc(spec.customer)}")
    meta = [f"📍 {city_name(spec.city_id, lang)}", f"💰 {money(spec.contract_amount, lang)}"]
    if spec.deadline:
        meta.append(t("deadline", lang, date=fmt_date(spec.deadline)))
    lines.append(" · ".join(meta))
    lines.append("━━━━━━━━━━━━━━━")

    verdict = twin_verdict(res, twin)
    lines.append(f"🎯 <b>TOS {num(res.tos, 1)}</b>/100 {tos_bar(res.tos)}")
    lines.append(verdict_label(verdict, lang))
    confidence_kind = t("confidence_verified" if res.confidence_label == "verified" else "confidence_smart", lang)
    lines.append(t("confidence_line", lang, value=num(res.confidence_level, 1), kind=confidence_kind))
    lines.append(t("profit_line", lang, profit=money(res.net_profit, lang), margin=pct(res.margin_pct)))
    if spec.field_sources.get("purchase_cost", None) and spec.field_sources["purchase_cost"].is_smart_default:
        lines.append(t("smart_values", lang, purchase=money(res.costs.purchase, lang), cargo=num(spec.cargo_tonnes, 2)))
    if not meets_min_margin(res, twin):
        lines.append(t("below_min", lang, min=pct(twin.min_margin_pct, 0)))
    if res.cash_flow_gap:
        lines.append(t("gap_yes", lang, day=res.gap_day, deficit=money(res.max_deficit, lang)))
    else:
        lines.append(t("gap_no", lang))
    lines.append(t(
        "logistics_line",
        lang,
        dist=num(res.distance_km),
        mode=LOGISTICS_LABELS[res.transport_mode][lang],
        days=res.transit_days,
        cost=money(res.costs.logistics, lang),
        level=t(f"level_{logistics_level(res)}", lang),
    ))
    lines.append(t("main_risk", lang, text=main_risk(spec, res, lang)))

    notes = []
    if spec.is_demo:
        notes.append(t("demo_note", lang))
    elif spec.estimated and show_estimated:
        notes.append(t("estimated_note", lang))
    if notes:
        lines += [""] + notes
    return "\n".join(lines)


def _is_public_url(url: str) -> bool:
    return url.startswith("https://") or url.startswith("http://")


def lot_keyboard(key: str, spec: TenderSpec, lang: str) -> InlineKeyboardMarkup:
    kb = InlineKeyboardBuilder()
    kb.button(text=t("btn_full", lang), callback_data=LotCB(action="full", key=key))
    if _is_public_url(spec.source_url):
        kb.button(text=t("btn_link", lang), url=spec.source_url)
    kb.button(text=t("btn_sim", lang), callback_data=LotCB(action="sim", key=key, m=0))
    kb.button(text=t("btn_logistics", lang), callback_data=LogisticsCB(action="list", key=key))
    kb.button(text=t("btn_suppliers", lang), callback_data=SupplierCB(action="list", key=key))
    kb.button(text=t("btn_hide", lang), callback_data=LotCB(action="hide", key=key))
    kb.adjust(2)
    return kb.as_markup()


def suppliers_view(spec: TenderSpec, offers: List[SupplierOffer], lang: str) -> str:
    lines = [t("suppliers_title", lang), f"<b>{esc(_title(spec, lang))}</b>", ""]
    if not offers:
        return "\n".join(lines + [t("suppliers_empty", lang)])
    demo = any(offer.is_demo for offer in offers)
    lines.append(t("suppliers_demo_disclaimer" if demo else "suppliers_disclaimer", lang))
    for i, offer in enumerate(offers, 1):
        phone = f" · ☎️ {esc(offer.phone)}" if offer.phone else ""
        status = "DEMO · Smart AI" if offer.is_demo else ("Verified" if offer.status == "verified" else "Smart AI")
        st_kz = " · СТ-KZ ✅" if offer.has_st_kz_certificate else ""
        lines += [
            "",
            f"{i}. <b>{esc(offer.supplier_name)}</b>{phone}",
            f"{esc(offer.product_name)}",
            f"💰 <b>{money(offer.total_price_kzt, lang)}</b> · {t('supplier_unit', lang)} {money(offer.unit_price_kzt or offer.total_price_kzt, lang)}",
            f"⚖️ {num(offer.cargo_tonnes or spec.cargo_tonnes, 2)} т · {status}{st_kz} · {esc(offer.city or '—')}",
            f"🕒 {esc(offer.updated_at)} · {esc(offer.source)}",
        ]
    return "\n".join(lines)


def suppliers_keyboard(key: str, offers: List[SupplierOffer], lang: str) -> InlineKeyboardMarkup:
    kb = InlineKeyboardBuilder()
    for i, offer in enumerate(offers, 1):
        kb.button(text=t("supplier_choose", lang, n=i, price=money(offer.total_price_kzt, lang)), callback_data=SupplierCB(action="choose", key=key, offer=offer.id))
        if not offer.is_demo:
            kb.button(text=t("supplier_link", lang, n=i), url=offer.url)
    kb.button(text=t("btn_back_card", lang), callback_data=SupplierCB(action="back", key=key))
    kb.adjust(2)
    return kb.as_markup()


def logistics_view(spec: TenderSpec, twin: CompanyTwin, scenario: Scenario, result: AnalysisResult, lang: str) -> str:
    cargo = scenario.cargo_tonnes_override if scenario.cargo_tonnes_override is not None else spec.cargo_tonnes
    plan = logistics_plan(twin.base_city_id, spec.city_id, cargo, scenario.transport_mode, spec.delivery_days, scenario.fuel_delta_pct, scenario.transport_delta_pct)
    lines = [t("logistics_title", lang), f"<b>{esc(_title(spec, lang))}</b>", ""]
    for quote in plan.quotes:
        active = "✅ " if quote.mode == result.transport_mode else ""
        recommended = f" · {t('logistics_recommended', lang)}" if quote.mode == plan.recommended_mode else ""
        lines.append(
            f"{active}<b>{LOGISTICS_LABELS[quote.mode][lang]}</b> — {money(quote.cost, lang)} · "
            f"{quote.distance_km} км · {quote.transit_days} {t('logistics_days', lang)}{recommended}"
        )
    lines += ["", t("logistics_disclaimer", lang)]
    return "\n".join(lines)


def logistics_keyboard(key: str, modes: List[LogisticsMode], selected: LogisticsMode, lang: str) -> InlineKeyboardMarkup:
    kb = InlineKeyboardBuilder()
    for mode in modes:
        kb.button(
            text=("✅ " if mode == selected else "") + LOGISTICS_LABELS[mode][lang],
            callback_data=LogisticsCB(action="choose", key=key, mode=mode),
        )
    kb.button(text=t("btn_back_card", lang), callback_data=LogisticsCB(action="back", key=key))
    kb.adjust(2, 2, 1)
    return kb.as_markup()


def back_keyboard(key: str, lang: str) -> InlineKeyboardMarkup:
    kb = InlineKeyboardBuilder()
    kb.button(text=t("btn_sim", lang), callback_data=LotCB(action="sim", key=key, m=0))
    kb.button(text=t("btn_back_card", lang), callback_data=LotCB(action="card", key=key))
    kb.adjust(1)
    return kb.as_markup()


def hidden_keyboard(key: str, lang: str) -> InlineKeyboardMarkup:
    kb = InlineKeyboardBuilder()
    kb.button(text=t("btn_unhide", lang), callback_data=LotCB(action="unhide", key=key))
    return kb.as_markup()


# ------------------------------- полный разбор ------------------------------- #


def sparkline(values: np.ndarray, width: int = 24) -> str:
    """Мини-график остатка денег по дням символами ▁▂▃▄▅▆▇█."""
    if values.size == 0:
        return ""
    idx = np.linspace(0, values.size - 1, num=min(width, values.size)).round().astype(int)
    v = values[idx].astype(float)
    lo, hi = float(v.min()), float(v.max())
    if hi == lo:
        return "▄" * v.size
    blocks = "▁▂▃▄▅▆▇█"
    levels = np.rint((v - lo) / (hi - lo) * 7).astype(int)
    return "".join(blocks[i] for i in levels)


def full_breakdown(spec: TenderSpec, res: AnalysisResult, twin: CompanyTwin, lang: str) -> str:
    c = res.costs
    m = lambda v: money(v, lang)  # noqa: E731
    tax_label = TAX_LABELS.get(twin.tax_regime, {}).get(lang, twin.tax_regime)
    lines = [
        t("full_title", lang),
        f"<b>{esc(_title(spec, lang))}</b>",
        "",
        t("profit_formula", lang),
        f"{t('c_revenue', lang)}: {m(spec.contract_amount)}",
        f"− {t('c_purchase', lang)}: {m(c.purchase)}",
        f"− {t('c_logistics', lang)}: {m(c.logistics)} ({LOGISTICS_LABELS[res.transport_mode][lang]} · {num(res.distance_km)} км · {res.transit_days} {t('logistics_days', lang)})",
        f"− {t('c_tax', lang)}: {m(c.tax)} ({tax_label})",
        f"− {t('c_bank', lang)}: {m(c.bank + c.guarantee)}",
        f"− {t('c_operating', lang)}: {m(c.operating)}",
    ]
    if c.penalty > 0:
        lines.append(f"− {t('c_penalty', lang)}: {m(c.penalty)}")
    lines.append(f"= <b>{t('c_profit', lang)}: {m(res.net_profit)}</b> · M = {pct(res.margin_pct)}")

    # Денежный поток — через Pandas: остаток по дням и ключевые события
    df = timeline_frame(res)
    balances = df["balance"].to_numpy()
    min_day = int(df["balance"].idxmin())
    lines += [
        "",
        t("cf_formula", lang),
        t("cf_min", lang, cf0=m(twin.working_capital), min=m(float(balances.min())), day=min_day),
        t("cf_pay", lang, day=res.pay_day),
    ]
    if res.cash_flow_gap:
        negative_days = df.index[df["balance"] < 0]
        lines.append(
            t(
                "cf_gap",
                lang,
                days=res.days_in_deficit,
                first=int(negative_days.min()),
                last=int(negative_days.max()),
                deficit=m(res.max_deficit),
                bank=m(c.bank),
            )
        )
    else:
        lines.append(t("cf_nogap", lang))
    lines.append(f"<code>{sparkline(balances)}</code>")

    events = df[df["events"].map(len) > 0]
    lines.append(t("cf_events", lang))
    for day, row in events.head(9).iterrows():
        labels = ", ".join(EVENT_LABELS.get(e, {}).get(lang, e) for e in row["events"])
        lines.append(f"• {t('day_short', lang, day=day)} — {labels} → {m(row['balance'])}")

    comp = res.components
    w = TOS_WEIGHTS
    lines += [
        "",
        t("tos_formula", lang),
        f"= {num(w['w1'], 2)}·{num(comp['marginScore'])} + {num(w['w2'], 2)}·{num(comp['cashFlowScore'])} + "
        f"{num(w['w3'], 2)}·{num(comp['logisticsScore'])} + {num(w['w4'], 2)}·{num(comp['legalScore'])} = <b>{num(res.tos, 1)}</b>",
        "",
        t("factors", lang),
    ]
    for r in res.reasons[:6]:
        lines.append(f"• {reason_text(r.code, r.data, lang)}")
    return "\n".join(lines)


# ------------------------------ симулятор «Что если?» ------------------------------ #


def _delta(new: float, old: float, fmt) -> str:  # noqa: ANN001
    d = new - old
    if abs(d) < 1e-9:
        return ""
    return f" ({fmt(d)})"


def simulator_view(spec: TenderSpec, base: AnalysisResult, sim: AnalysisResult, mask: int, twin: CompanyTwin, lang: str) -> str:
    active = [t(LEVER_TEXT[name], lang) for name, bit, _ in SCENARIO_LEVERS if mask & bit]
    lines = [t("sim_title", lang), f"<b>{esc(_title(spec, lang))}</b>", ""]
    lines.append(t("sim_active", lang, items=join_items(active)) if active else t("sim_base", lang))
    lines.append("")

    def gap_str(r: AnalysisResult) -> str:
        return f"{t('yes', lang)} (−{money(r.max_deficit, lang)})" if r.cash_flow_gap else t("no", lang)

    arrow = " → " if mask else ""
    if mask:
        lines += [
            f"🎯 {t('sim_row_tos', lang)}: {num(base.tos, 1)}{arrow}<b>{num(sim.tos, 1)}</b>{_delta(sim.tos, base.tos, lambda d: num(d, 1) if d < 0 else '+' + num(d, 1))}",
            f"💵 {t('sim_row_profit', lang)}: {money(base.net_profit, lang)}{arrow}<b>{money(sim.net_profit, lang)}</b>"
            f"{_delta(sim.net_profit, base.net_profit, lambda d: money(d, lang, signed=True))}",
            f"📈 {t('sim_row_margin', lang)}: {pct(base.margin_pct)}{arrow}<b>{pct(sim.margin_pct)}</b>",
            f"🕳 {t('sim_row_gap', lang)}: {gap_str(base)}{arrow}<b>{gap_str(sim)}</b>",
            f"⚖️ {t('sim_row_verdict', lang)}: {verdict_label(twin_verdict(base, twin), lang)}{arrow}<b>{verdict_label(twin_verdict(sim, twin), lang)}</b>",
            f"🛡 {t('confidence_short', lang)}: {num(base.confidence_level, 1)}%{arrow}<b>{num(sim.confidence_level, 1)}%</b>",
        ]
    else:
        lines += [
            f"🎯 TOS: <b>{num(base.tos, 1)}</b>",
            f"💵 {t('sim_row_profit', lang)}: <b>{money(base.net_profit, lang)}</b> · {pct(base.margin_pct)}",
            f"🕳 {t('sim_row_gap', lang)}: <b>{gap_str(base)}</b>",
            f"⚖️ {verdict_label(twin_verdict(base, twin), lang)}",
            f"🛡 {t('confidence_short', lang)}: <b>{num(base.confidence_level, 1)}%</b>",
        ]
    lines += ["", f"<i>{t('sim_hint', lang)}</i>"]
    return "\n".join(lines)


def simulator_keyboard(key: str, mask: int, lang: str) -> InlineKeyboardMarkup:
    kb = InlineKeyboardBuilder()
    for name, bit, _ in SCENARIO_LEVERS:
        on = bool(mask & bit)
        kb.button(text=("✅ " if on else "") + t(LEVER_TEXT[name], lang), callback_data=LotCB(action="sim", key=key, m=mask ^ bit))
    kb.button(text=t("btn_reset", lang), callback_data=LotCB(action="sim", key=key, m=0))
    kb.button(text=t("btn_back_card", lang), callback_data=LotCB(action="card", key=key))
    kb.adjust(2, 2, 1, 2)
    return kb.as_markup()


# ------------------------------ поиск и дайджест ------------------------------ #


def describe_query(q: SearchQuery, lang: str) -> str:
    parts: List[str] = []
    if q.keywords:
        parts.append(", ".join(esc(k) for k in q.keywords[:4]))
    if q.industry and q.industry in INDUSTRIES and q.industry != "other":
        ind = INDUSTRIES[q.industry]
        parts.append(f"{ind.emoji} {ind.kz if lang == 'kz' else ind.ru}")
    if q.city_id:
        parts.append(f"📍 {city_name(q.city_id, lang)}")
    if q.min_amount_kzt:
        parts.append(t("from", lang, v=money(q.min_amount_kzt, lang)))
    if q.max_amount_kzt:
        parts.append(t("upto", lang, v=money(q.max_amount_kzt, lang)))
    return join_items(parts) or t("any_query", lang)


def search_results(rows: List[Tuple[str, TenderSpec, AnalysisResult]], q: SearchQuery, twin: CompanyTwin, lang: str, live: bool) -> str:
    lines = [t("search_found", lang, n=len(rows)), describe_query(q, lang), ""]
    for i, (_, spec, res) in enumerate(rows, start=1):
        emoji = verdict_label(twin_verdict(res, twin), lang).split(" ")[0]
        title = _title(spec, lang)
        title = title if len(title) <= 70 else title[:67] + "…"
        lines.append(f"{i}. {emoji} <b>TOS {num(res.tos)}</b> · {esc(title)}")
        lines.append(f"    💰 {money(spec.contract_amount, lang)} · 📍 {city_name(spec.city_id, lang)} · Π {money(res.net_profit, lang)}")
    if not live:
        lines += ["", t("demo_note", lang)]
    return "\n".join(lines)


def search_keyboard(rows: List[Tuple[str, TenderSpec, AnalysisResult]], lang: str) -> InlineKeyboardMarkup:
    kb = InlineKeyboardBuilder()
    for i, (key, spec, res) in enumerate(rows, start=1):
        title = _title(spec, lang)
        kb.button(text=f"{i} · TOS {num(res.tos)} · {title[:28]}", callback_data=LotCB(action="open", key=key))
    kb.adjust(1)
    return kb.as_markup()


# ------------------------------- меню и профиль ------------------------------- #


def main_menu_keyboard(lang: str, alerts: bool) -> InlineKeyboardMarkup:
    kb = InlineKeyboardBuilder()
    kb.button(text=t("btn_twin", lang), callback_data=MenuCB(action="twin"))
    kb.button(text=t("btn_digest", lang), callback_data=MenuCB(action="digest"))
    kb.button(text=t("btn_search", lang), callback_data=MenuCB(action="search"))
    kb.button(text=t("btn_alerts_on" if alerts else "btn_alerts_off", lang), callback_data=MenuCB(action="alerts"))
    kb.button(text=t("btn_lang", lang), callback_data=MenuCB(action="lang"))
    kb.button(text=t("btn_help", lang), callback_data=MenuCB(action="help"))
    kb.adjust(2)
    return kb.as_markup()


def twin_view(twin: CompanyTwin, lang: str) -> str:
    ind = INDUSTRIES.get(twin.industry, INDUSTRIES["other"])
    body = t(
        "twin_body",
        lang,
        name=esc(twin.name or "—"),
        capital=money(twin.working_capital, lang),
        city=city_name(twin.base_city_id, lang),
        radius=num(twin.max_distance_km),
        margin=pct(twin.min_margin_pct, 0),
        industry=f"{ind.emoji} {ind.kz if lang == 'kz' else ind.ru}",
        tax=TAX_LABELS.get(twin.tax_regime, {}).get(lang, twin.tax_regime),
        opex=money(twin.monthly_opex, lang),
        alloc=pct(twin.opex_allocation * 100, 0),
        credit=pct(twin.credit_rate * 100, 0),
        exp=num(twin.experience_years),
        certs=esc(", ".join(twin.certificates) or "—"),
    )
    return f"{t('twin_title', lang)}\n\n{body}\n\n{t('twin_hint', lang)}"


def twin_keyboard(lang: str) -> InlineKeyboardMarkup:
    kb = InlineKeyboardBuilder()
    kb.button(text=t("btn_edit", lang), callback_data=MenuCB(action="edit_twin"))
    kb.button(text=t("btn_menu", lang), callback_data=MenuCB(action="menu"))
    kb.adjust(2)
    return kb.as_markup()


def city_keyboard(lang: str) -> InlineKeyboardMarkup:
    kb = InlineKeyboardBuilder()
    for c in CITIES:
        kb.button(text=c.kz if lang == "kz" else c.ru, callback_data=SetupCB(field="city", value=c.id))
    kb.adjust(3)
    return kb.as_markup()


def margin_keyboard() -> InlineKeyboardMarkup:
    kb = InlineKeyboardBuilder()
    for v in (5, 8, 10, 15, 20, 25):
        kb.button(text=f"{v}%", callback_data=SetupCB(field="margin", value=str(v)))
    kb.adjust(3)
    return kb.as_markup()


def industry_keyboard(lang: str) -> InlineKeyboardMarkup:
    kb = InlineKeyboardBuilder()
    for ind in INDUSTRIES.values():
        kb.button(text=f"{ind.emoji} {ind.kz if lang == 'kz' else ind.ru}", callback_data=SetupCB(field="industry", value=ind.id))
    kb.adjust(2)
    return kb.as_markup()


def tax_keyboard(lang: str) -> InlineKeyboardMarkup:
    kb = InlineKeyboardBuilder()
    for regime in ("simplified", "general", "vat"):
        kb.button(text=TAX_LABELS[regime][lang], callback_data=SetupCB(field="tax", value=regime))
    kb.adjust(1)
    return kb.as_markup()


def assumptions_note(items: List[str], lang: str) -> str:
    if not items:
        return ""
    return "\n\n" + t("assumptions", lang, items=", ".join(t(f"as_{i}", lang) for i in items))
