"""Реестры РК по БИН/ИИН: разбор источников, Smart Defaults, влияние на расчёт."""
import asyncio
import datetime as dt
import json
from pathlib import Path

import httpx
import pytest

from calculator import analyze_tender
from company_fetcher import (
    RegistryError,
    city_from_address,
    city_from_kato,
    clear_registry_cache,
    entity_type,
    fetch_company,
    is_valid_bin,
    registration_from_bin,
)
from models import CompanyTwin, TenderSpec

BIN = "180540012343"  # валидная контрольная цифра, вымышленная компания (как DEMO_COMPANY сайта)
LOTS = [TenderSpec.model_validate(x) for x in json.loads((Path(__file__).resolve().parents[1] / "data" / "sample_tenders.json").read_text("utf-8"))["tenders"]]


def run(coro):
    return asyncio.run(coro)


@pytest.fixture(autouse=True)
def _fresh():
    clear_registry_cache()
    yield
    clear_registry_cache()


def router(routes):
    """MockTransport: (host, путь-префикс) → функция(request) → Response."""

    def handler(request: httpx.Request) -> httpx.Response:
        for (host, prefix), fn in routes.items():
            if request.url.host == host and request.url.path.startswith(prefix):
                return fn(request)
        return httpx.Response(404)

    return httpx.MockTransport(handler)


EGOV_ROW = {
    "bin": BIN, "nameru": "ТОО «Алтын Логистик»", "director": "Ахметов Арман Болатұлы",
    "addressru": "751110000, г.Алматы, Бостандыкский район, пр. Абая 10", "datereg": "12.05.2018",
    "okedru": "Оптовая торговля", "statusru": "Действующий",
}


def full_routes(rnu_items=None):
    return router({
        ("data.egov.kz", "/api/v4/gbd_ul"): lambda r: httpx.Response(200, json=[EGOV_ROW]),
        ("portal.kgd.gov.kz", "/services/isnaportalsync/public/search-payer-data"): lambda r: httpx.Response(
            200, json={"iinBin": BIN, "nameRu": "ТОО", "ndsRegistrationDate": "2019-01-10", "ndsDeregistrationDate": None}
        ),
        ("ows.goszakup.gov.kz", f"/v3/rnu/{BIN}"): (lambda r: httpx.Response(200, json={"items": rnu_items})) if rnu_items else (lambda r: httpx.Response(404)),
        ("ows.goszakup.gov.kz", f"/v3/subject/biin/{BIN}"): lambda r: httpx.Response(200, json={"regdate": "2018-05-12", "kato_code": "751110000"}),
        ("ows.goszakup.gov.kz", f"/v3/contract/supplier/{BIN}"): lambda r: httpx.Response(
            200, json={"items": [{"contract_sum_wnds": 12_000_000}, {"contract_sum_wnds": 8_500_000}]}
        ),
    })


# ------------------------------- БИН и Smart Defaults ------------------------------- #


def test_bin_checksum_and_entity_type():
    assert is_valid_bin(BIN) and not is_valid_bin("180540012344") and not is_valid_bin("12345")
    assert entity_type(BIN) == "legal"
    assert registration_from_bin(BIN, dt.date(2026, 9, 14)) == dt.date(2018, 5, 1)


def test_region_from_kato_and_address():
    assert city_from_kato("711210000") == "astana" and city_from_kato("551010000") == "pavlodar"
    assert city_from_address("595241100, Северо-Казахстанская область, Мамлютский район") == "petropavl"
    assert city_from_address("Карагандинская обл., г. Темиртау") == "karaganda"
    assert city_from_address("") is None


def test_invalid_bin_raises():
    with pytest.raises(RegistryError):
        run(fetch_company("123456789012", egov_key="", kgd_token="", goszakup_token=""))


def test_no_keys_gives_smart_defaults_with_estimated_flag():
    p = run(fetch_company(BIN, egov_key="", kgd_token="", goszakup_token=""))
    assert p.verified is False and p.is_estimated is True
    assert {s.status for s in p.sources} == {"no-key"}
    assert p.registered_on == "2018-05-01" and "registered_on" in p.estimated_fields  # из БИН
    assert p.vat_payer is None and p.rnu_listed is None and p.suggested_tax_regime is None


# ------------------------------- живые источники (mock) ------------------------------- #


def test_all_registries_fill_the_twin_and_mark_verified():
    p = run(fetch_company(BIN, egov_key="e", kgd_token="k", goszakup_token="g", transport=full_routes()))
    assert p.verified and p.name == "ТОО «Алтын Логистик»" and p.director_name.startswith("Ахметов")
    assert p.city_id == "almaty" and p.registered_on == "2018-05-12" and p.experience_years > 7
    assert p.vat_payer is True and p.suggested_tax_regime == "vat"
    assert p.rnu_listed is False  # 404 в РНУ — подтверждено «чистый»
    assert p.gov_contracts_count == 2 and p.gov_contracts_sum_kzt == pytest.approx(20_500_000)
    assert p.estimated_fields == [] and p.is_estimated is False


def test_active_rnu_record_is_detected():
    future = (dt.date.today() + dt.timedelta(days=200)).isoformat()
    p = run(fetch_company(BIN, egov_key="e", kgd_token="k", goszakup_token="g",
                          transport=full_routes(rnu_items=[{"supplier_biin": BIN, "end_date": future}])))
    assert p.rnu_listed is True and p.rnu_until == future


def test_expired_rnu_record_is_not_a_listing():
    past = (dt.date.today() - dt.timedelta(days=10)).isoformat()
    p = run(fetch_company(BIN, egov_key="e", kgd_token="k", goszakup_token="g",
                          transport=full_routes(rnu_items=[{"supplier_biin": BIN, "end_date": past}])))
    assert p.rnu_listed is False


def test_deregistered_vat_payer_is_not_vat():
    t = router({("portal.kgd.gov.kz", "/services"): lambda r: httpx.Response(
        200, json={"ndsRegistrationDate": "2019-01-10", "ndsDeregistrationDate": "2024-03-01"})})
    p = run(fetch_company(BIN, egov_key="", kgd_token="k", goszakup_token="", transport=t))
    assert p.vat_payer is False and p.suggested_tax_regime is None and "tax_regime" in p.estimated_fields


@pytest.mark.parametrize("code,status", [(403, "invalid-key"), (429, "rate-limit"), (500, "error")])
def test_registry_failures_fall_back_softly(code, status):
    t = router({("data.egov.kz", "/"): lambda r: httpx.Response(code), ("portal.kgd.gov.kz", "/"): lambda r: httpx.Response(code)})
    p = run(fetch_company(BIN, egov_key="e", kgd_token="k", goszakup_token="", transport=t))
    assert p.verified is False and p.is_estimated is True
    assert {s.status for s in p.sources if s.id in ("egov_gbd_ul", "kgd_vat")} == {status}


def test_network_error_falls_back_softly():
    def boom(request):
        raise httpx.ConnectError("down", request=request)

    p = run(fetch_company(BIN, egov_key="e", kgd_token="k", goszakup_token="g", transport=httpx.MockTransport(boom)))
    assert p.is_estimated and all(s.status == "network" for s in p.sources)


# ------------------------------- Economic Layer ------------------------------- #


def _twin(**kw):
    return CompanyTwin.from_answers(25, "almaty", 10, "other", "vat").model_copy(update=kw)


def test_rnu_listing_blocks_the_tender():
    spec = LOTS[0]
    clean, listed = analyze_tender(spec, _twin()), analyze_tender(spec, _twin(rnu_listed=True))
    assert listed.verdict == "no-go" and listed.reasons[0].code == "rnu"
    assert listed.legal_risk == 100 and listed.tos < clean.tos


@pytest.mark.parametrize("spec", LOTS, ids=lambda s: s.id)
def test_half_supplier_prepayment_never_deepens_the_cash_gap(spec):
    full = analyze_tender(spec, _twin(supplier_prepay_pct=100))
    half = analyze_tender(spec, _twin(supplier_prepay_pct=50))
    assert half.max_deficit <= full.max_deficit
    assert half.costs.purchase == pytest.approx(full.costs.purchase)
