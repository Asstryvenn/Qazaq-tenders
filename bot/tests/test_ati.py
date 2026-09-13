"""ATI.SU: живые ставки автоперевозок, мягкий фоллбэк и влияние на расчёт.

Модульные тесты подменяют ответы API (httpx.MockTransport). Интеграционные тесты
ходят в настоящий api.ati.su с ключом из bot/.env (ATI_SU_API_KEY) и пропускаются без него.
"""
import asyncio
import json
import os
from pathlib import Path

import httpx
import pytest
from dotenv import load_dotenv

from calculator import analyze_tender
from logistics import (
    ATI_CITY_IDS,
    CITIES,
    ESTIMATED_RATE_LABEL,
    LIVE_RATE_LABEL,
    LiveRoadRate,
    clear_ati_cache,
    fetch_ati_live_rates,
    logistics_plan,
)
from models import CompanyTwin, Scenario, TenderSpec

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

DATA = Path(__file__).resolve().parents[1] / "data" / "sample_tenders.json"
LOTS = [TenderSpec.model_validate(x) for x in json.loads(DATA.read_text("utf-8"))["tenders"]]


def run(coro):
    return asyncio.run(coro)


def ok_payload(avg: float, distance: int = 1215) -> dict:
    return {
        "Data": [
            {
                "DateFrom": "2026-08-14",
                "DateTo": "2026-09-13",
                "Prices": {"AveragePrice": avg, "BottomPrice": avg * 0.8, "UpperPrice": avg * 1.3},
                "PricesInRub": {"AveragePrice": avg, "BottomPrice": avg * 0.8, "UpperPrice": avg * 1.3},
                "LoadsCount": 42,
            }
        ],
        "Distance": distance,
        "WithNDS": False,
    }


@pytest.fixture(autouse=True)
def _fresh(monkeypatch):
    clear_ati_cache()
    monkeypatch.setenv("ATI_RUB_TO_KZT", "6")
    yield
    clear_ati_cache()


# ------------------------------- модульные ------------------------------- #


def test_every_supported_city_has_an_ati_id():
    assert set(ATI_CITY_IDS) == {c.id for c in CITIES}


def test_live_rate_is_parsed_with_bearer_and_route_ids():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["auth"] = request.headers["authorization"]
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json=ok_payload(95_000))

    res = run(fetch_ati_live_rates("almaty", "astana", "truck", api_key="k", transport=httpx.MockTransport(handler)))
    assert res.status == "live" and res.rate is not None
    assert res.rate.distance_km == 1215 and res.rate.per_trip_kzt == 95_000 * 6
    assert res.loads_count == 42 and res.bottom_kzt < res.rate.per_trip_kzt < res.upper_kzt
    assert seen["auth"] == "Bearer k"
    assert seen["body"]["From"] == {"CityId": 1004} and seen["body"]["To"] == {"CityId": 3100}
    assert seen["body"]["CarType"] == "tent" and seen["body"]["Tonnage"] == 20


def test_gazelle_uses_3_tonnes_and_per_km_price_is_scaled_by_distance():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json=ok_payload(70, distance=1600))

    res = run(fetch_ati_live_rates("pavlodar", "shymkent", "gazelle", api_key="k", transport=httpx.MockTransport(handler)))
    assert seen["body"]["Tonnage"] == 3
    assert res.status == "live" and res.rate.per_trip_kzt == 70 * 1600 * 6


@pytest.mark.parametrize("code,status", [(401, "invalid-key"), (403, "no-license"), (429, "rate-limit"), (500, "http-error")])
def test_api_errors_fall_back_softly(code, status):
    transport = httpx.MockTransport(lambda r: httpx.Response(code, json={"error": "x"}))
    res = run(fetch_ati_live_rates("almaty", "astana", "truck", api_key="k", transport=transport))
    assert res.status == status and res.rate is None


def test_network_error_and_missing_key_fall_back_softly():
    def boom(request):
        raise httpx.ConnectError("down", request=request)

    assert run(fetch_ati_live_rates("almaty", "astana", "truck", api_key="k", transport=httpx.MockTransport(boom))).status == "network"
    assert run(fetch_ati_live_rates("almaty", "astana", "truck", api_key="")).status == "no-key"
    assert run(fetch_ati_live_rates("almaty", "almaty", "truck", api_key="k")).status == "unknown-city"


def test_empty_data_is_no_data():
    transport = httpx.MockTransport(lambda r: httpx.Response(200, json={"Data": [], "Distance": 0}))
    assert run(fetch_ati_live_rates("almaty", "astana", "truck", api_key="k", transport=transport)).status == "no-data"


def test_engine_marks_live_logistics_verified_and_raises_confidence():
    spec = next(s for s in LOTS if s.city_id == "astana")
    twin = CompanyTwin.from_answers(50, "almaty", 10, "other", "simplified")
    base = analyze_tender(spec, twin, Scenario(transport_mode="truck"))
    live = LiveRoadRate(mode="truck", from_id="almaty", to_id="astana", distance_km=1210, per_trip_kzt=600_000)
    verified = analyze_tender(spec, twin, Scenario(transport_mode="truck", live_road_rates=[live]))

    assert base.logistics_rate_kind == "benchmark" and base.logistics_rate_label == ESTIMATED_RATE_LABEL
    assert verified.logistics_rate_kind == "live" and verified.logistics_rate_label == LIVE_RATE_LABEL
    assert verified.distance_km == 1210
    assert verified.costs.logistics == pytest.approx(verified.transport_units * 600_000)
    assert verified.confidence_level > base.confidence_level


def test_live_rate_for_another_route_is_ignored():
    stale = LiveRoadRate(mode="truck", from_id="pavlodar", to_id="shymkent", distance_km=1600, per_trip_kzt=1)
    plan = logistics_plan("almaty", "astana", 12, "truck", live_rates=[stale])
    assert plan.selected.rate_kind == "benchmark"


# ---------------------------- интеграционные ---------------------------- #

LIVE_API = pytest.mark.skipif(not os.getenv("ATI_SU_API_KEY"), reason="ATI_SU_API_KEY is not set")


@LIVE_API
@pytest.mark.parametrize("truck", ["truck", "gazelle"])
@pytest.mark.parametrize("city_from,city_to,km_lo,km_hi", [("almaty", "astana", 1000, 1450), ("pavlodar", "shymkent", 1300, 2100)])
def test_real_ati_api_for_main_kz_routes(city_from, city_to, km_lo, km_hi, truck, monkeypatch):
    monkeypatch.delenv("ATI_RUB_TO_KZT", raising=False)
    res = run(fetch_ati_live_rates(city_from, city_to, truck))
    # С лицензией «Средние ставки» — живые данные; без неё — явный статус и расчётный тариф
    assert res.status in {"live", "no-license", "rate-limit"}, (res.status, res.detail)
    if res.status == "live":
        assert km_lo <= res.rate.distance_km <= km_hi
        assert res.rate.per_trip_kzt > 0 and res.loads_count >= 0
    else:
        plan = logistics_plan(city_from, city_to, 10, truck)
        assert plan.selected.rate_kind == "benchmark"
