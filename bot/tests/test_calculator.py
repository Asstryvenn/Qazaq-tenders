"""Тесты экономического слоя: формулы из ТЗ и совпадение с TypeScript-движком сайта."""
import json
from pathlib import Path

import numpy as np
import pytest
from pydantic.alias_generators import to_snake

from calculator import (
    ALL_LEVERS_MASK,
    KZ,
    TOS_WEIGHTS,
    analyze_tender,
    cash_flow_gap,
    contract_tax,
    distance_km,
    freight_cost,
    net_profit,
    rank_lots,
    scenario_from_mask,
    statutory_penalty,
    tender_opportunity_score,
    timeline_frame,
)
from models import CompanyTwin, Scenario, TenderSpec

HERE = Path(__file__).resolve().parent
LOTS = {x["id"]: TenderSpec.model_validate(x) for x in json.loads((HERE.parent / "data" / "sample_tenders.json").read_text("utf-8"))["tenders"]}
FIXTURE = json.loads((HERE / "fixtures" / "ts_parity.json").read_text("utf-8"))


def _snake(d):
    return {to_snake(k): v for k, v in d.items()}


TWINS = {name: CompanyTwin(**_snake(v)) for name, v in FIXTURE["twins"].items()}
SCENARIOS = {name: Scenario(**_snake(v)) for name, v in FIXTURE["scenarios"].items()}


# ------------------------------ формулы из ТЗ ------------------------------ #


def test_tos_formula_bounds_and_weights():
    assert sum(TOS_WEIGHTS.values()) == pytest.approx(1.0)
    assert tender_opportunity_score(100, 0, 100, 0) == pytest.approx(100)
    assert tender_opportunity_score(0, 100, 0, 100) == pytest.approx(0)
    # w1·M + w2·(100−CF) + w3·L + w4·(100−R)
    assert tender_opportunity_score(50, 40, 80, 30) == pytest.approx(0.35 * 50 + 0.30 * 60 + 0.15 * 80 + 0.20 * 70)


def test_profit_formula():
    assert net_profit(100, 60, 5, 4, 3, 2) == pytest.approx(26)
    assert net_profit(100, 60, 5, 4, 3, 2, cost_other=6) == pytest.approx(20)


def test_cash_flow_gap_trigger():
    gap = cash_flow_gap(100, inflows=[0, 0, 500], outflows=[50, 80, 0])
    np.testing.assert_allclose(gap.balances, [50, -30, 470])
    assert gap.trigger_gap is True and gap.first_gap_day == 1
    assert gap.max_deficit == pytest.approx(30) and gap.days_in_deficit == 1


def test_cash_flow_no_gap():
    gap = cash_flow_gap(1000, inflows=[0, 10], outflows=[100, 0])
    assert gap.trigger_gap is False and gap.first_gap_day is None and gap.max_deficit == 0


def test_statutory_penalty_cap():
    assert statutory_penalty(1_000_000, 0.001, 5) == pytest.approx(5_000)
    assert statutory_penalty(1_000_000, 0.01, 50) == pytest.approx(1_000_000 * KZ.PENALTY_CAP)


def test_freight_minimum_and_trucks():
    q = freight_cost(15, 45)
    assert q.trucks == 3 and q.cost == pytest.approx(3 * 60_000)
    assert freight_cost(1000, 10, fuel_delta_pct=15).cost > freight_cost(1000, 10).cost


def test_tax_regimes():
    assert contract_tax("simplified", 1_000_000, 100_000) == pytest.approx(40_000)
    assert contract_tax("general", 1_000_000, 100_000) == pytest.approx(20_000)
    assert contract_tax("general", 1_000_000, -5) == 0
    assert contract_tax("vat", 1_160_000, 200_000, 580_000) > contract_tax("general", 1_160_000, 200_000)


def test_distance_symmetric_and_local():
    assert distance_km("almaty", "almaty") == 15
    assert distance_km("almaty", "astana") == distance_km("astana", "almaty")
    with pytest.raises(ValueError):
        distance_km("almaty", "atlantis")


# ------------------------------ паритет с сайтом ------------------------------ #


@pytest.mark.parametrize("case", FIXTURE["cases"], ids=lambda c: f"{c['lot']}|{c['twin']}|{c['scenario']}")
def test_matches_typescript_engine(case):
    r = analyze_tender(LOTS[case["lot"]], TWINS[case["twin"]], SCENARIOS[case["scenario"]])
    e = case["expect"]
    assert r.tos == pytest.approx(e["tos"], abs=0.1)
    assert r.net_profit == pytest.approx(e["netProfit"], abs=1)
    assert r.margin_pct == pytest.approx(e["marginPct"], abs=1e-6)
    assert r.cash_flow_gap == e["cashFlowGap"]
    assert r.gap_day == e["gapDay"]
    assert r.max_deficit == pytest.approx(e["maxDeficit"], abs=1)
    assert r.distance_km == e["distanceKm"] and r.trucks == e["trucks"]
    assert r.legal_risk == pytest.approx(e["legalRisk"], abs=1e-6)
    assert r.cash_flow_risk == pytest.approx(e["cashFlowRisk"], abs=1e-6)
    assert r.verdict == e["verdict"]
    assert (r.pay_day, r.delivery_day) == (e["payDay"], e["deliveryDay"])
    assert min(p.balance for p in r.timeline) == pytest.approx(e["minBalance"], abs=1)
    assert [x.code for x in r.reasons] == e["reasons"]
    for k, v in e["costs"].items():
        assert getattr(r.costs, k) == pytest.approx(v, abs=1), k


# ------------------------------ симулятор ------------------------------ #


@pytest.mark.parametrize("lot_id", list(LOTS))
def test_levers_move_numbers_in_the_right_direction(lot_id):
    spec, twin = LOTS[lot_id], TWINS["demo"]
    base = analyze_tender(spec, twin)
    fuel = analyze_tender(spec, twin, scenario_from_mask(1))
    supplier = analyze_tender(spec, twin, scenario_from_mask(2))
    pay = analyze_tender(spec, twin, scenario_from_mask(4))
    assert fuel.net_profit <= base.net_profit
    assert supplier.net_profit < base.net_profit
    assert pay.pay_day == base.pay_day + 30
    assert pay.max_deficit >= base.max_deficit
    both = analyze_tender(spec, twin, scenario_from_mask(ALL_LEVERS_MASK))
    assert both.net_profit <= min(fuel.net_profit, supplier.net_profit, pay.net_profit) + 1e-6


def test_mask_builds_combined_scenario():
    s = scenario_from_mask(ALL_LEVERS_MASK)
    assert (s.fuel_delta_pct, s.supplier_delta_pct, s.payment_delay_delta) == (15, 10, 30)
    assert scenario_from_mask(0) == Scenario()


def test_deterministic():
    spec, twin = next(iter(LOTS.values())), TWINS["small"]
    assert analyze_tender(spec, twin).model_dump() == analyze_tender(spec, twin).model_dump()


def test_pandas_helpers():
    twin = TWINS["demo"]
    rows = [(k, s, analyze_tender(s, twin)) for k, s in LOTS.items()]
    ranked = rank_lots(rows, twin)
    assert len(ranked) == len(rows)
    fits = [r.margin_pct >= twin.min_margin_pct for _, _, r in ranked]
    assert fits == sorted(fits, reverse=True)  # сначала подходящие по марже
    df = timeline_frame(ranked[0][2])
    assert list(df.columns) == ["balance", "inflow", "outflow", "events"] and df.index[0] == 0
