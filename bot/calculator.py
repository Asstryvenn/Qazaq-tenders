"""
Qazaq Tenders — ЭКОНОМИЧЕСКИЙ СЛОЙ (детерминированный математический модуль).

Правило архитектуры: здесь нет LLM и нет случайности. Один и тот же вход всегда даёт
один и тот же результат. AI-слой только заполняет TenderSpec, а все деньги считает этот модуль.

Модуль — точный порт TypeScript-движка сайта (lib/engine.ts, lib/kz-standards.ts,
lib/logistics.ts), поэтому бот и www.qazaqtenders.kz показывают одинаковый TOS.
Совпадение проверяет tests/test_calculator.py на эталонах, посчитанных TS-движком.

Формулы:
  1) TOS    = w1·M_rel + w2·(100 − CF_risk) + w3·L_score + w4·(100 − R_legal)
  2) Profit = S − (Cost_purchase + Cost_logistics + Cost_tax + Cost_bank + Cost_oper [+ неустойка])
  3) CF_t   = CF_0 + Σ Inflow_i − Σ Outflow_i;   если min CF_t < 0 → Trigger_Gap = True
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np
import pandas as pd

from models import (
    AnalysisResult,
    CashFlowPoint,
    CompanyTwin,
    CostBreakdown,
    Reason,
    Scenario,
    TenderSpec,
)
from logistics import CITIES, CITY_BY_ID, FREIGHT, distance_km, freight_cost, logistics_plan, logistics_quotes

# =========================================================================== #
# 1. Нормативы Республики Казахстан                                           #
# =========================================================================== #


class KZ:
    """Параметры закупок и налогов РК.

    Нормы — Закон РК «О государственных закупках» и Налоговый кодекс. Значения с пометкой
    MARKET — типичные рыночные ставки банков, а не закон; их стоит заменить реальным
    предложением банка компании.
    """

    BID_SECURITY_RATE = 0.01  # обеспечение заявки — 1 % суммы лота (возвращается)
    PERFORMANCE_SECURITY_RATE = 0.03  # обеспечение исполнения договора — 3 %
    PENALTY_PER_DAY = 0.001  # неустойка 0,1 % в день
    PENALTY_CAP = 0.10  # но всего не более 10 % суммы договора
    BANK_GUARANTEE_ANNUAL_RATE = 0.025  # MARKET: 1,5–4 % годовых
    BANK_GUARANTEE_MIN_FEE = 50_000.0  # MARKET: минимальная комиссия за гарантию, ₸
    CIT_RATE = 0.20  # КПН — 20 % от прибыли (ОУР)
    SIMPLIFIED_RATE = 0.04  # упрощённая декларация — % от дохода (базовая ставка)
    VAT_RATE = 0.16  # НДС по НК, действующему с 2026 года (было 12 %)


# Веса TOS: маржа важнее всего, затем деньги (кассовый разрыв), право и логистика.
TOS_WEIGHTS: Dict[str, float] = {"w1": 0.35, "w2": 0.30, "w3": 0.15, "w4": 0.20}

# Маржа, которая считается «отличной»: 20 % → оценка маржи 100.
TARGET_MARGIN_PCT = 20.0

# Постоянные расходы, отнесённые на один договор, — не больше этой доли его суммы:
# компания ведёт много договоров, и лот на 300 000 ₸ не может нести недели всего OPEX.
MAX_OPEX_SHARE = 0.10

# День подписания договора: в этот день возвращается обеспечение заявки.
SIGNING_DAY = 5


def js_round(x: float) -> int:
    """Округление как Math.round в JavaScript (0,5 всегда вверх), а не банковское,
    иначе результаты разойдутся с сайтом."""
    return int(math.floor(x + 0.5))


def clamp(v: float, lo: float = 0.0, hi: float = 100.0) -> float:
    return min(hi, max(lo, v))


# =========================================================================== #
# 3. Налоги, гарантии, неустойка                                              #
# =========================================================================== #


def bank_guarantee_fee(amount: float, days: float) -> float:
    """Комиссия за банковскую гарантию, открытую на `days` дней."""
    if amount <= 0:
        return 0.0
    return max(KZ.BANK_GUARANTEE_MIN_FEE, amount * KZ.BANK_GUARANTEE_ANNUAL_RATE * (days / 365))


def statutory_penalty(contract_amount: float, rate: float, late_days: float) -> float:
    """Неустойка за `late_days` просрочки с потолком 10 % суммы договора."""
    return min(contract_amount * rate * max(0, late_days), contract_amount * KZ.PENALTY_CAP)


def contract_tax(regime: str, revenue: float, profit_before_tax: float, vat_deductible_costs: float = 0.0) -> float:
    """Cost_tax по налоговому режиму.

    simplified — упрощённая декларация: % от дохода, без НДС;
    general    — ОУР без НДС: КПН 20 % с прибыли;
    vat        — ОУР + плательщик НДС: НДС только с добавленной стоимости, затем КПН.
    Цены договора и поставщика указаны с НДС.
    """
    if regime == "simplified":
        return revenue * KZ.SIMPLIFIED_RATE
    vat = (max(0.0, revenue - vat_deductible_costs) * KZ.VAT_RATE) / (1 + KZ.VAT_RATE) if regime == "vat" else 0.0
    taxable = profit_before_tax - vat
    return vat + (taxable * KZ.CIT_RATE if taxable > 0 else 0.0)


# =========================================================================== #
# 4. ФОРМУЛЫ из ТЗ                                                            #
# =========================================================================== #


def tender_opportunity_score(
    m_rel: float,
    cf_risk: float,
    l_score: float,
    r_legal: float,
    weights: Dict[str, float] = TOS_WEIGHTS,
) -> float:
    """Формула 1. TOS = w1·M_rel + w2·(100 − CF_risk) + w3·L_score + w4·(100 − R_legal).

    Все компоненты уже в шкале 0..100:
      m_rel   — оценка маржи (маржа 20 % и выше = 100);
      cf_risk — риск кассового разрыва (больше = хуже);
      l_score — логистическая оценка (ближе = лучше);
      r_legal — юридический риск (больше = хуже).
    """
    return (
        weights["w1"] * m_rel
        + weights["w2"] * (100 - cf_risk)
        + weights["w3"] * l_score
        + weights["w4"] * (100 - r_legal)
    )


def net_profit(
    contract_sum: float,
    cost_purchase: float,
    cost_logistics: float,
    cost_tax: float,
    cost_bank: float,
    cost_oper: float,
    cost_other: float = 0.0,
) -> float:
    """Формула 2. Profit = Contract_Sum − (Cost_purchase + Cost_logistics + Cost_tax + Cost_bank + Cost_oper).

    cost_bank  — проценты по кредиту на разрыв плюс комиссия за банковскую гарантию;
    cost_other — прочие потери (неустойка при просрочке в сценарии).
    """
    return contract_sum - (cost_purchase + cost_logistics + cost_tax + cost_bank + cost_oper + cost_other)


@dataclass
class CashFlowGap:
    """Результат формулы 3."""

    balances: np.ndarray  # CF_t по дням (без округления)
    trigger_gap: bool  # Trigger_Gap: был ли день с CF_t < 0
    first_gap_day: Optional[int]  # первый день с CF_t < 0
    max_deficit: float  # глубина разрыва, ₸ (0, если разрыва нет)
    days_in_deficit: int


def cash_flow_gap(cf0: float, inflows: Sequence[float], outflows: Sequence[float]) -> CashFlowGap:
    """Формула 3. CF_t = CF_0 + Σ_{i≤t} Inflow_i − Σ_{i≤t} Outflow_i.

    inflows/outflows — поступления и выплаты по дням (индекс = день). Если хоть одно
    CF_t < 0, то Trigger_Gap = True: компании не хватает своих денег, нужен кредит.
    Считаем векторно через NumPy: накопленная сумма, начиная с CF_0 (тот же порядок
    сложения, что и в пошаговом JS-цикле).
    """
    deltas = np.asarray(inflows, dtype=float) - np.asarray(outflows, dtype=float)
    balances = np.cumsum(np.concatenate(([float(cf0)], deltas)))[1:]
    negative = np.flatnonzero(balances < 0)
    return CashFlowGap(
        balances=balances,
        trigger_gap=negative.size > 0,
        first_gap_day=int(negative[0]) if negative.size else None,
        max_deficit=float(-balances[negative].min()) if negative.size else 0.0,
        days_in_deficit=int(negative.size),
    )


# =========================================================================== #
# 5. Симуляция денежного потока по дням                                        #
# =========================================================================== #


@dataclass
class _Movement:
    day: int
    amount: float  # > 0 — поступление, < 0 — выплата
    code: str


@dataclass
class _Simulation:
    timeline: List[CashFlowPoint]
    rounded: np.ndarray  # остаток по дням, округлённый до тенге (как на сайте)
    gap: CashFlowGap = field(repr=False)


def _simulate(company: CompanyTwin, movements: List[_Movement], horizon: int) -> _Simulation:
    days = horizon + 1
    daily_opex = (company.monthly_opex / 30) * company.opex_allocation
    pos = np.zeros(days)
    neg = np.zeros(days)
    events: List[List[str]] = [[] for _ in range(days)]
    for m in movements:
        if 0 <= m.day <= horizon:
            events[m.day].append(m.code)
            if m.amount > 0:
                pos[m.day] += m.amount
            elif m.amount < 0:
                neg[m.day] -= m.amount
    opex = np.full(days, daily_opex)
    opex[0] = 0.0  # в день 0 (подача заявки) постоянные расходы ещё не идут
    outflow = opex + neg

    gap = cash_flow_gap(company.working_capital, pos, outflow)
    rounded = np.floor(gap.balances + 0.5)  # = Math.round
    timeline = [
        CashFlowPoint(day=t, balance=int(rounded[t]), inflow=js_round(pos[t]), outflow=js_round(outflow[t]), events=events[t])
        for t in range(days)
    ]
    return _Simulation(timeline=timeline, rounded=rounded, gap=gap)


def _credit_cost(rounded: np.ndarray, credit_rate: float) -> float:
    """Проценты по кредитной линии за каждый день с отрицательным остатком."""
    daily = credit_rate / 365
    total = 0.0
    for b in rounded:
        if b < 0:
            total += -float(b) * daily
    return total


# =========================================================================== #
# 6. Компоненты риска                                                         #
# =========================================================================== #


def cash_flow_risk_score(rounded: np.ndarray, working_capital: float) -> Tuple[float, float, Optional[int], int]:
    """CF_risk 0..100: глубина разрыва относительно своего капитала + его длительность.
    Возвращает (risk, max_deficit, gap_day, days_in_deficit)."""
    negative = np.flatnonzero(rounded < 0)
    if negative.size == 0:
        cushion = float(rounded.min()) / max(1.0, working_capital)
        return clamp((1 - cushion) * 45), 0.0, None, 0
    max_deficit = float(-rounded[negative].min())
    depth = clamp((max_deficit / max(1.0, working_capital)) * 100)
    duration = clamp((negative.size / max(1, rounded.size)) * 100)
    return clamp(50 + depth * 0.35 + duration * 0.15), max_deficit, int(negative[0]), int(negative.size)


def logistics_score(dist_km: float, max_distance_km: float) -> float:
    """L_score = max(0, 100 − Dist / Dist_max · 100)."""
    return max(0.0, 100 - (dist_km / max(1.0, max_distance_km)) * 100)


def legal_risk_score(tender: TenderSpec, company: CompanyTwin, scenario: Scenario) -> Tuple[float, List[Reason]]:
    """R_legal 0..100 (больше = хуже): неустойка, опыт, сертификаты, скрытые требования."""
    reasons: List[Reason] = []
    risk = 0.0

    # Сколько потеряем, если поставка сорвётся на 10 % срока (с учётом потолка 10 %)
    slip = max(1, js_round(tender.delivery_days * 0.1))
    exposure = statutory_penalty(tender.contract_amount, tender.penalty_rate, slip) / max(1.0, tender.contract_amount)
    exposure_score = clamp(exposure * 100 * 12)
    risk += exposure_score * 0.35
    if exposure_score > 45:
        reasons.append(Reason(code="penalty", data={"ratePct": tender.penalty_rate * 100, "slip": slip, "pct": exposure * 100}))

    if company.experience_years < tender.required_experience_years:
        risk += 25
        reasons.append(Reason(code="experience", data={"have": company.experience_years, "need": tender.required_experience_years}))

    missing = [c for c in tender.required_certificates if c not in company.certificates]
    if missing:
        risk += min(25, len(missing) * 12)
        reasons.append(Reason(code="certs", data={"missing": missing}))

    weight = {"low": 5, "medium": 12, "high": 22}
    for hr in tender.hidden_requirements:
        risk += weight[hr.severity]
        if hr.severity != "low":
            reasons.append(Reason(code="hidden", data={"reason": hr.reason, "page": hr.page, "severity": hr.severity}))

    if scenario.late_days > 0:
        raw = tender.contract_amount * tender.penalty_rate * scenario.late_days
        penalty = statutory_penalty(tender.contract_amount, tender.penalty_rate, scenario.late_days)
        reasons.append(Reason(code="lateScenario", data={"days": scenario.late_days, "penalty": penalty, "capped": penalty < raw}))

    return clamp(risk), reasons


CONFIDENCE_WEIGHTS: Dict[str, float] = {
    "purchase_cost": 0.45,
    "cargo_tonnes": 0.15,
    "delivery_days": 0.10,
    "payment_delay_days": 0.10,
    "advance_percentage": 0.10,
    "city_id": 0.10,
}


def input_confidence(tender: TenderSpec, scenario: Scenario) -> float:
    """Достоверность входов 0..100, а не обещание точности результата.

    Поле из ТЗ/каталога несёт собственный provenance. Точный override, выбранный
    пользователем, считается верифицированным. Для старых лотов без provenance
    применяется консервативная оценка совместимости.
    """
    verified = set(scenario.verified_fields)
    if scenario.purchase_cost_override is not None:
        verified.add("purchase_cost")
    if scenario.advance_percentage_override is not None:
        verified.add("advance_percentage")
    if scenario.logistics_cost_override is not None:
        verified.add("city_id")
    if scenario.cargo_tonnes_override is not None:
        verified.add("cargo_tonnes")

    total = 0.0
    for name, weight in CONFIDENCE_WEIGHTS.items():
        if name in verified:
            score = 0.99
        elif name in tender.field_sources:
            score = tender.field_sources[name].confidence
        elif tender.is_demo:
            score = 0.75
        elif tender.estimated:
            score = 0.68 if name in ("purchase_cost", "cargo_tonnes") else 0.78
        else:
            score = 0.92
        total += weight * score
    return clamp(total * 100)


# =========================================================================== #
# 7. Главная функция: полный расчёт лота                                      #
# =========================================================================== #


def analyze_tender(tender: TenderSpec, company: CompanyTwin, scenario: Optional[Scenario] = None) -> AnalysisResult:
    """Лот + цифровой двойник (+ сценарий) → прибыль, денежный поток, риски, TOS, вердикт."""
    sc = scenario or Scenario()
    cargo = sc.cargo_tonnes_override if sc.cargo_tonnes_override is not None else tender.cargo_tonnes
    route = logistics_plan(
        company.base_city_id,
        tender.city_id,
        cargo,
        sc.transport_mode,
        tender.delivery_days,
        sc.fuel_delta_pct,
        sc.transport_delta_pct,
    )
    freight = route.selected
    explicit_mode = sc.transport_mode != "auto" and company.base_city_id != tender.city_id
    transit_delta = freight.transit_days - route.road_reference_days if explicit_mode else 0
    effective_late_days = max(0, sc.late_days + transit_delta)
    delivery_day = max(0, tender.delivery_days + sc.delivery_delta_days + sc.late_days + transit_delta)
    pay_day = delivery_day + tender.payment_delay_days + sc.payment_delay_delta
    horizon = pay_day + 5

    dist = freight.distance_km

    s = tender.contract_amount
    bid_security = s * (tender.bid_security_rate if tender.bid_security_rate is not None else KZ.BID_SECURITY_RATE)
    performance_security = s * (
        tender.performance_security_rate if tender.performance_security_rate is not None else KZ.PERFORMANCE_SECURITY_RATE
    )
    advance_pct = sc.advance_percentage_override if sc.advance_percentage_override is not None else tender.advance_percentage
    advance = s * (advance_pct / 100)

    purchase_cost = (
        sc.purchase_cost_override
        if sc.purchase_cost_override is not None
        else tender.purchase_cost * (1 + sc.supplier_delta_pct / 100)
    )
    # Для собственного транспорта не заявляем нулевую цену: остаются топливо,
    # водитель и амортизация. Пока точная внутренняя ставка не указана, берём
    # топливную долю рыночного рейса (40%).
    own_fleet_factor = FREIGHT.FUEL_SHARE if sc.own_transport and freight.mode in ("city", "truck", "gazelle") else 1.0
    logistics_cost = (
        sc.logistics_cost_override
        if sc.logistics_cost_override is not None
        else freight.cost * own_fleet_factor
    )

    costs: Dict[str, float] = {
        "purchase": purchase_cost,
        "logistics": logistics_cost,
        "operating": min((company.monthly_opex / 30) * company.opex_allocation * horizon, s * MAX_OPEX_SHARE),
        "penalty": statutory_penalty(s, tender.penalty_rate, effective_late_days),
        # Гарантия исполнения должна быть открыта, пока заказчик не заплатит
        "guarantee": bank_guarantee_fee(performance_security, pay_day - SIGNING_DAY),
        "bank": 0.0,
        "tax": 0.0,
    }

    def build_movements() -> List[_Movement]:
        # Поставщику: 60 % предоплата, 40 % перед отгрузкой
        prepay_day = max(SIGNING_DAY + 1, js_round(delivery_day * 0.15))
        balance_day = max(prepay_day + 1, js_round(delivery_day * 0.6))
        items = [
            _Movement(0, -bid_security, "bidSecurity"),
            _Movement(SIGNING_DAY, bid_security, "bidSecurityBack"),
            _Movement(SIGNING_DAY, -costs["guarantee"], "guaranteeFee"),
            _Movement(prepay_day, -costs["purchase"] * 0.6, "prepay"),
            _Movement(balance_day, -costs["purchase"] * 0.4, "balancePay"),
            _Movement(delivery_day, -costs["logistics"], "logistics"),
        ]
        if advance > 0:
            items.append(_Movement(SIGNING_DAY, advance, "advance"))
        items += [
            _Movement(pay_day, s - advance, "payment"),
            _Movement(pay_day + 1, -costs["tax"], "tax"),
        ]
        # Неустойку удерживают при фактической поставке (delivery_day уже включает просрочку)
        if costs["penalty"] > 0:
            items.append(_Movement(delivery_day, -costs["penalty"], "penalty"))
        if costs["bank"] > 0:
            items.append(_Movement(pay_day + 1, -costs["bank"], "credit"))
        return items

    def compute_tax() -> None:
        before_tax = s - costs["purchase"] - costs["logistics"] - costs["operating"] - costs["penalty"] - costs["guarantee"] - costs["bank"]
        costs["tax"] = contract_tax(company.tax_regime, s, before_tax, costs["purchase"] + costs["logistics"])

    # Проход 1 — находим дыру без учёта стоимости кредита
    compute_tax()
    costs["bank"] = _credit_cost(_simulate(company, build_movements(), horizon).rounded, company.credit_rate)
    # Проход 2 — проценты уменьшают налогооблагаемую прибыль: налог пересчитываем
    compute_tax()
    sim = _simulate(company, build_movements(), horizon)

    profit = net_profit(
        s,
        cost_purchase=costs["purchase"],
        cost_logistics=costs["logistics"],
        cost_tax=costs["tax"],
        cost_bank=costs["bank"] + costs["guarantee"],
        cost_oper=costs["operating"],
        cost_other=costs["penalty"],
    )
    margin_pct = profit / s * 100

    cf_risk, max_deficit, gap_day, days_in_deficit = cash_flow_risk_score(sim.rounded, company.working_capital)
    l_score = logistics_score(dist, company.max_distance_km)
    legal_scenario = sc.model_copy(update={"late_days": effective_late_days})
    legal_risk, legal_reasons = legal_risk_score(tender, company, legal_scenario)

    components = {
        "marginScore": clamp((margin_pct / TARGET_MARGIN_PCT) * 100),
        "cashFlowScore": 100 - cf_risk,
        "logisticsScore": l_score,
        "legalScore": 100 - legal_risk,
    }
    tos = tender_opportunity_score(components["marginScore"], cf_risk, l_score, legal_risk)

    reasons: List[Reason] = []
    if gap_day is not None:
        reasons.append(Reason(code="gap", data={"day": gap_day, "deficit": max_deficit, "payDay": pay_day}))
    if margin_pct < 5:
        reasons.append(Reason(code="lowMargin", data={"margin": margin_pct}))
    elif margin_pct < 10:
        reasons.append(Reason(code="thinMargin", data={"margin": margin_pct}))
    if dist > company.max_distance_km:
        reasons.append(Reason(code="overRadius", data={"dist": dist, "max": company.max_distance_km}))
    if costs["bank"] > 0 and costs["bank"] > profit * 0.25:
        reasons.append(Reason(code="bankHeavy", data={"bank": costs["bank"], "pct": costs["bank"] / max(1.0, profit) * 100}))
    reasons += legal_reasons
    if not reasons:
        reasons.append(Reason(code="safe", data={"min": float(sim.rounded.min())}))

    # Убыточный договор никогда не рекомендуем, как бы хорошо ни выглядели остальные компоненты
    verdict = "no-go" if profit <= 0 else "go" if tos >= 70 and gap_day is None else "caution" if tos >= 45 else "no-go"

    confidence = input_confidence(tender, sc)
    return AnalysisResult(
        tender_id=tender.id,
        net_profit=profit,
        margin_pct=margin_pct,
        costs=CostBreakdown(**costs),
        tos=js_round(tos * 10) / 10,
        components=components,
        cash_flow_risk=cf_risk,
        logistics_score=l_score,
        legal_risk=legal_risk,
        cash_flow_gap=gap_day is not None,
        max_deficit=max_deficit,
        gap_day=gap_day,
        days_in_deficit=days_in_deficit,
        pay_day=pay_day,
        delivery_day=delivery_day,
        distance_km=dist,
        trucks=freight.units,
        transport_mode=freight.mode,
        transport_units=freight.units,
        transit_days=freight.transit_days,
        logistics_rate_kind=freight.rate_kind,
        timeline=sim.timeline,
        verdict=verdict,  # type: ignore[arg-type]
        reasons=reasons,
        confidence_level=js_round(confidence * 10) / 10,
        confidence_label="verified" if confidence >= 95 else "quick_ai",
    )


# =========================================================================== #
# 8. Симулятор «Что если?»                                                    #
# =========================================================================== #

# Рычаги кнопок бота. Состояние симулятора — битовая маска, поэтому помещается в
# callback_data (≤ 64 байта) и не требует хранения на сервере.
SCENARIO_LEVERS: List[Tuple[str, int, Dict[str, object]]] = [
    ("fuel", 1, {"fuel_delta_pct": 15}),  # ⛽ Топливо +15 %
    ("supplier", 2, {"supplier_delta_pct": 10}),  # 📦 Закупка +10 %
    ("payment", 4, {"payment_delay_delta": 30}),  # ⏱ Постоплата +30 дней
    ("advance", 8, {"advance_percentage_override": 30, "verified_fields": ["advance_percentage"]}),
    # Собственный транспорт означает дорожный сценарий: иначе авто-рекомендация
    # могла выбрать Ж/Д, к которому скидка собственного автопарка неприменима.
    ("own_transport", 16, {"own_transport": True, "transport_mode": "truck", "verified_fields": ["city_id"]}),
]
# Сохраняем старый публичный контракт: ALL_LEVERS_MASK — стресс-сценарии,
# используемые parity-тестами. SUPPORTED включает также полезные 1-click условия.
ALL_LEVERS_MASK = 1 | 2 | 4
SUPPORTED_LEVERS_MASK = sum(bit for _, bit, _ in SCENARIO_LEVERS)


def scenario_from_mask(mask: int) -> Scenario:
    fields: Dict[str, object] = {}
    for _, bit, delta in SCENARIO_LEVERS:
        if mask & bit:
            for k, v in delta.items():
                if k == "verified_fields":
                    fields[k] = list(dict.fromkeys([*(fields.get(k, []) or []), *v]))  # type: ignore[arg-type]
                elif isinstance(v, bool):
                    fields[k] = v
                elif isinstance(v, str):
                    fields[k] = v
                else:
                    fields[k] = float(fields.get(k, 0) or 0) + v  # type: ignore[operator]
    return Scenario(**fields)


# =========================================================================== #
# 9. Учёт предпочтений двойника и ранжирование (Pandas)                        #
# =========================================================================== #


def meets_min_margin(result: AnalysisResult, twin: CompanyTwin) -> bool:
    return result.margin_pct >= twin.min_margin_pct


def twin_verdict(result: AnalysisResult, twin: CompanyTwin) -> str:
    """Вердикт движка с учётом минимальной маржи компании. TOS при этом не меняется
    (он одинаков с сайтом): маржа ниже желаемой лишь понижает «go» до «caution»."""
    if result.verdict == "go" and not meets_min_margin(result, twin):
        return "caution"
    return result.verdict


def timeline_frame(result: AnalysisResult) -> pd.DataFrame:
    """Денежный поток в виде таблицы: день, остаток, приход, расход, события."""
    return pd.DataFrame([p.model_dump() for p in result.timeline]).set_index("day")


def rank_lots(rows: List[Tuple[str, TenderSpec, AnalysisResult]], twin: CompanyTwin) -> List[Tuple[str, TenderSpec, AnalysisResult]]:
    """Сортирует лоты: сначала подходящие по марже и без разрыва, затем по TOS."""
    if not rows:
        return []
    df = pd.DataFrame(
        {
            "i": range(len(rows)),
            "fits": [meets_min_margin(r, twin) for _, _, r in rows],
            "no_gap": [not r.cash_flow_gap for _, _, r in rows],
            "tos": [r.tos for _, _, r in rows],
        }
    )
    order = df.sort_values(["fits", "no_gap", "tos"], ascending=[False, False, False], kind="mergesort")["i"]
    return [rows[i] for i in order]
