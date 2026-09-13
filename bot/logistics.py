"""Deterministic Kazakhstan logistics quotes shared by the Telegram economic layer.

Built-in rates are explicit market benchmarks ("Estimated Rate"). For road modes
(20-t truck, Gazelle) a live ATI.SU average market rate can be fetched with
fetch_ati_live_rates() and passed in; the quote then becomes "Verified Live (ATI.SU)".
The calculation itself stays deterministic: the same inputs, including the live rate,
always give the same result.
"""
from __future__ import annotations

import datetime as _dt
import math
import os
import time
from dataclasses import dataclass
from typing import Dict, List, Literal, Optional, Sequence, Tuple

import httpx
from pydantic import BaseModel

LogisticsMode = Literal["city", "truck", "gazelle", "rail", "air"]
TransportMode = Literal["auto", "city", "truck", "gazelle", "rail", "air"]


@dataclass(frozen=True)
class City:
    id: str
    kz: str
    ru: str
    lat: float
    lon: float


CITIES: List[City] = [
    City("astana", "Астана", "Астана", 51.169, 71.449),
    City("almaty", "Алматы", "Алматы", 43.238, 76.946),
    City("shymkent", "Шымкент", "Шымкент", 42.315, 69.587),
    City("karaganda", "Қарағанды", "Караганда", 49.806, 73.085),
    City("aktobe", "Ақтөбе", "Актобе", 50.283, 57.167),
    City("taraz", "Тараз", "Тараз", 42.9, 71.367),
    City("pavlodar", "Павлодар", "Павлодар", 52.287, 76.967),
    City("oskemen", "Өскемен", "Усть-Каменогорск", 49.948, 82.628),
    City("semey", "Семей", "Семей", 50.411, 80.227),
    City("atyrau", "Атырау", "Атырау", 47.107, 51.903),
    City("kostanay", "Қостанай", "Костанай", 53.214, 63.624),
    City("kyzylorda", "Қызылорда", "Кызылорда", 44.853, 65.509),
    City("oral", "Орал", "Уральск", 51.233, 51.367),
    City("petropavl", "Петропавл", "Петропавловск", 54.865, 69.136),
    City("aktau", "Ақтау", "Актау", 43.65, 51.16),
    City("taldykorgan", "Талдықорған", "Талдыкорган", 45.017, 78.373),
    City("turkistan", "Түркістан", "Туркестан", 43.297, 68.251),
    City("kokshetau", "Көкшетау", "Кокшетау", 53.283, 69.383),
]
CITY_BY_ID: Dict[str, City] = {city.id: city for city in CITIES}


class FREIGHT:
    ROAD_FACTOR = 1.25
    RAIL_FACTOR = 1.10
    TRUCK_CAPACITY_T = 20.0
    TARIFF_PER_KM = 450.0
    RETURN_SHARE = 0.5
    FUEL_SHARE = 0.4
    MIN_PER_TRIP = 60_000.0
    TRUCK_KM_PER_DAY = 650.0
    GAZELLE_CAPACITY_T = 3.0
    GAZELLE_PER_KM = 180.0
    GAZELLE_MIN = 30_000.0
    GAZELLE_KM_PER_DAY = 550.0
    RAIL_CAPACITY_T = 20.0
    RAIL_PER_T_PER_1000_KM = 12_000.0
    RAIL_TERMINAL_PER_CONTAINER = 120_000.0
    RAIL_MIN_BILLABLE_T = 10.0
    RAIL_KM_PER_DAY = 450.0
    AIR_PER_KG = 850.0
    AIR_MIN = 60_000.0
    CITY_CAPACITY_T = 3.0
    CITY_TRIP = 25_000.0
    CITY_HEAVY_TRIP = 60_000.0


LIVE_RATE_LABEL = "Verified Live (ATI.SU)"
ESTIMATED_RATE_LABEL = "Estimated Rate"


class LiveRoadRate(BaseModel):
    """Средняя рыночная ставка ATI.SU за рейс одной машины на конкретном маршруте, ₸."""

    mode: Literal["truck", "gazelle"]
    from_id: str
    to_id: str
    distance_km: int
    per_trip_kzt: float
    source: Literal["ati.su"] = "ati.su"
    fetched_at: str = ""


@dataclass(frozen=True)
class FreightQuote:
    distance_km: float
    trucks: int
    cost: float


@dataclass(frozen=True)
class LogisticsQuote:
    mode: LogisticsMode
    distance_km: int
    units: int
    capacity_tonnes: Optional[float]
    cost: float
    transit_days: int
    rate_kind: Literal["benchmark", "live"] = "benchmark"
    rate_label: str = ""


@dataclass(frozen=True)
class LogisticsPlan:
    selected: LogisticsQuote
    recommended_mode: LogisticsMode
    quotes: List[LogisticsQuote]
    road_reference_days: int


def _js_round(value: float) -> int:
    return int(math.floor(value + 0.5))


def direct_distance_km(from_id: str, to_id: str) -> float:
    if from_id == to_id:
        return 0.0
    a, b = CITY_BY_ID.get(from_id), CITY_BY_ID.get(to_id)
    if a is None or b is None:
        raise ValueError(f"Unknown city: {from_id if a is None else to_id}")
    radius = 6371.0
    rad = lambda degrees: degrees * math.pi / 180  # noqa: E731
    d_lat, d_lon = rad(b.lat - a.lat), rad(b.lon - a.lon)
    h = math.sin(d_lat / 2) ** 2 + math.cos(rad(a.lat)) * math.cos(rad(b.lat)) * math.sin(d_lon / 2) ** 2
    return 2 * radius * math.asin(math.sqrt(h))


def distance_km(from_id: str, to_id: str) -> int:
    """Road distance: Haversine × 1.25; local delivery uses a 15 km allowance."""
    return 15 if from_id == to_id else _js_round(direct_distance_km(from_id, to_id) * FREIGHT.ROAD_FACTOR)


def freight_cost(dist_km: float, tonnes: float, fuel_delta_pct: float = 0.0, transport_delta_pct: float = 0.0) -> FreightQuote:
    trucks = max(1, math.ceil(max(0.0, tonnes) / FREIGHT.TRUCK_CAPACITY_T))
    tariff = FREIGHT.TARIFF_PER_KM * (1 + FREIGHT.FUEL_SHARE * fuel_delta_pct / 100) * (1 + transport_delta_pct / 100)
    per_trip = max(FREIGHT.MIN_PER_TRIP, dist_km * tariff * (1 + FREIGHT.RETURN_SHARE))
    return FreightQuote(distance_km=dist_km, trucks=trucks, cost=trucks * per_trip)


def _quote(
    from_id: str,
    to_id: str,
    tonnes: float,
    mode: LogisticsMode,
    fuel_delta_pct: float,
    transport_delta_pct: float,
    live: Optional[LiveRoadRate] = None,
) -> LogisticsQuote:
    cargo = max(0.001, tonnes)
    same_city = from_id == to_id
    direct = direct_distance_km(from_id, to_id)
    road_km = 15 if same_city else _js_round(direct * FREIGHT.ROAD_FACTOR)
    rail_km = 15 if same_city else _js_round(direct * FREIGHT.RAIL_FACTOR)
    air_km = 15 if same_city else _js_round(direct)
    market = max(0.1, 1 + transport_delta_pct / 100)

    if mode == "city":
        units = max(1, math.ceil(cargo / FREIGHT.CITY_CAPACITY_T))
        per_trip = FREIGHT.CITY_TRIP if cargo <= FREIGHT.CITY_CAPACITY_T else FREIGHT.CITY_HEAVY_TRIP
        return LogisticsQuote(mode, 15, units, FREIGHT.CITY_CAPACITY_T, units * per_trip * market, 1, rate_label="fixed city rate")
    # Живая ставка ATI.SU для этого маршрута заменяет эталонный тариф
    if mode in ("truck", "gazelle") and live is not None and live.mode == mode and live.from_id == from_id and live.to_id == to_id:
        capacity = FREIGHT.TRUCK_CAPACITY_T if mode == "truck" else FREIGHT.GAZELLE_CAPACITY_T
        km_per_day = FREIGHT.TRUCK_KM_PER_DAY if mode == "truck" else FREIGHT.GAZELLE_KM_PER_DAY
        units = max(1, math.ceil(cargo / capacity))
        adjust = (1 + FREIGHT.FUEL_SHARE * fuel_delta_pct / 100) * market
        return LogisticsQuote(
            mode, live.distance_km, units, capacity, units * live.per_trip_kzt * adjust,
            max(1, math.ceil(live.distance_km / km_per_day)), rate_kind="live", rate_label=LIVE_RATE_LABEL,
        )
    if mode == "truck":
        q = freight_cost(road_km, cargo, fuel_delta_pct, transport_delta_pct)
        return LogisticsQuote(mode, road_km, q.trucks, FREIGHT.TRUCK_CAPACITY_T, q.cost, max(1, math.ceil(road_km / FREIGHT.TRUCK_KM_PER_DAY)), rate_label="450 KZT/km + 50% return")
    if mode == "gazelle":
        units = max(1, math.ceil(cargo / FREIGHT.GAZELLE_CAPACITY_T))
        tariff = FREIGHT.GAZELLE_PER_KM * (1 + FREIGHT.FUEL_SHARE * fuel_delta_pct / 100) * market
        cost = units * max(FREIGHT.GAZELLE_MIN, road_km * tariff)
        return LogisticsQuote(mode, road_km, units, FREIGHT.GAZELLE_CAPACITY_T, cost, max(1, math.ceil(road_km / FREIGHT.GAZELLE_KM_PER_DAY)), rate_label="180 KZT/km")
    if mode == "rail":
        units = max(1, math.ceil(cargo / FREIGHT.RAIL_CAPACITY_T))
        billable = max(FREIGHT.RAIL_MIN_BILLABLE_T, cargo)
        cost = (billable * FREIGHT.RAIL_PER_T_PER_1000_KM * rail_km / 1000 + units * FREIGHT.RAIL_TERMINAL_PER_CONTAINER) * market
        return LogisticsQuote(mode, rail_km, units, FREIGHT.RAIL_CAPACITY_T, cost, max(3, math.ceil(rail_km / FREIGHT.RAIL_KM_PER_DAY) + 2), rate_label="12,000 KZT/t per 1,000 km + terminals")
    cost = max(FREIGHT.AIR_MIN, cargo * 1000 * FREIGHT.AIR_PER_KG) * market
    return LogisticsQuote("air", air_km, 1, None, cost, 1, rate_label="850 KZT/kg")


def logistics_quotes(
    from_id: str,
    to_id: str,
    tonnes: float,
    fuel_delta_pct: float = 0.0,
    transport_delta_pct: float = 0.0,
    live_rates: Sequence[LiveRoadRate] = (),
) -> List[LogisticsQuote]:
    if from_id not in CITY_BY_ID or to_id not in CITY_BY_ID:
        raise ValueError(f"Unknown city: {from_id if from_id not in CITY_BY_ID else to_id}")
    if from_id == to_id:
        return [_quote(from_id, to_id, tonnes, "city", fuel_delta_pct, transport_delta_pct)]
    def live_for(mode: str) -> Optional[LiveRoadRate]:
        return next((r for r in live_rates if r.mode == mode and r.from_id == from_id and r.to_id == to_id), None)

    return [_quote(from_id, to_id, tonnes, mode, fuel_delta_pct, transport_delta_pct, live_for(mode)) for mode in ("truck", "gazelle", "rail", "air")]


def recommend_logistics_mode(quotes: List[LogisticsQuote], tonnes: float, delivery_days: int) -> LogisticsMode:
    if len(quotes) == 1:
        return quotes[0].mode
    by = {quote.mode: quote for quote in quotes}
    if delivery_days <= 2:
        return "air"
    if tonnes <= 3:
        return "gazelle"
    if tonnes >= 10 and by["rail"].cost < by["truck"].cost and by["rail"].transit_days <= max(3, delivery_days):
        return "rail"
    return "truck"


def logistics_plan(
    from_id: str,
    to_id: str,
    tonnes: float,
    requested: TransportMode = "auto",
    delivery_days: int = 30,
    fuel_delta_pct: float = 0.0,
    transport_delta_pct: float = 0.0,
    live_rates: Sequence[LiveRoadRate] = (),
) -> LogisticsPlan:
    quotes = logistics_quotes(from_id, to_id, tonnes, fuel_delta_pct, transport_delta_pct, live_rates)
    recommended = recommend_logistics_mode(quotes, tonnes, delivery_days)
    selected = next((quote for quote in quotes if quote.mode == requested), next(quote for quote in quotes if quote.mode == recommended))
    road_mode: LogisticsMode = "gazelle" if tonnes <= 3 else "truck"
    road = next((quote for quote in quotes if quote.mode == road_mode), quotes[0])
    return LogisticsPlan(selected=selected, recommended_mode=recommended, quotes=quotes, road_reference_days=road.transit_days)


# =========================================================================== #
# ATI.SU — живые рыночные ставки автоперевозок (Фура 20 т, Газель 3 т)          #
# =========================================================================== #

ATI_AVERAGE_PRICES_URL = "https://api.ati.su/priceline/license/v1/average_prices"

# ID городов в справочнике ATI.SU (получены через /gw/gis-dict/v1/cities/by-coordinate).
ATI_CITY_IDS: Dict[str, int] = {
    "astana": 3100, "almaty": 1004, "shymkent": 3148, "karaganda": 3103, "aktobe": 1005, "taraz": 3147,
    "pavlodar": 3055, "oskemen": 3058, "semey": 12209, "atyrau": 3048, "kostanay": 131, "kyzylorda": 3093,
    "oral": 1116, "petropavl": 2558, "aktau": 512, "taldykorgan": 23806, "turkistan": 3149, "kokshetau": 3101,
}

# Тентованный кузов: фура 20 т и газель 3 т (допустимые тоннажи API: 1.5 | 3 | 5 | 10 | 20)
ATI_AUTO_PROFILES: Dict[str, Dict[str, object]] = {
    "truck": {"CarType": "tent", "Tonnage": 20},
    "gazelle": {"CarType": "tent", "Tonnage": 3},
}

# API отдаёт цены в рублях (PricesInRub). Курс ₽→₸ — настройка, а не рыночные данные:
# задайте ATI_RUB_TO_KZT актуальным курсом.
DEFAULT_RUB_TO_KZT = 6.3

AtiStatus = Literal["live", "no-key", "no-license", "rate-limit", "invalid-key", "http-error", "network", "no-data", "unknown-city"]


@dataclass(frozen=True)
class AtiRateResult:
    status: AtiStatus
    rate: Optional[LiveRoadRate] = None
    bottom_kzt: float = 0.0
    upper_kzt: float = 0.0
    loads_count: int = 0
    detail: str = ""


_ATI_CACHE: Dict[Tuple[str, str, str], Tuple[float, AtiRateResult]] = {}
_ATI_TTL_LIVE = 6 * 3600
_ATI_TTL_FAIL = 600  # после оплаты лицензии живые ставки подхватятся в течение 10 минут


def clear_ati_cache() -> None:
    _ATI_CACHE.clear()


def _rub_to_kzt() -> float:
    try:
        value = float(os.getenv("ATI_RUB_TO_KZT") or DEFAULT_RUB_TO_KZT)
    except ValueError:
        return DEFAULT_RUB_TO_KZT
    return value if value > 0 else DEFAULT_RUB_TO_KZT


def _parse_ati(response: httpx.Response, city_from: str, city_to: str, truck_type: str) -> AtiRateResult:
    code = response.status_code
    if code == 401:
        return AtiRateResult("invalid-key")
    if code == 403:
        return AtiRateResult("no-license", detail="ATI.SU: лицензия «Средние ставки» не активна")
    if code == 429:
        return AtiRateResult("rate-limit")
    if code >= 400:
        return AtiRateResult("http-error", detail=f"HTTP {code}")
    try:
        payload = response.json()
    except ValueError:
        return AtiRateResult("http-error", detail="bad json")
    rows = [row for row in (payload.get("Data") or []) if ((row.get("PricesInRub") or {}).get("AveragePrice") or 0) > 0]
    if not rows:
        return AtiRateResult("no-data")
    last = rows[-1]
    prices = last["PricesInRub"]
    distance = int(round(payload.get("Distance") or 0)) or distance_km(city_from, city_to)
    rate = _rub_to_kzt()

    def per_trip(value: float) -> float:
        # Небольшое значение — ставка за км, крупное — за рейс
        return (value * distance if value < 1000 else value) * rate

    live = LiveRoadRate(
        mode=truck_type,  # type: ignore[arg-type]
        from_id=city_from,
        to_id=city_to,
        distance_km=distance,
        per_trip_kzt=round(per_trip(float(prices["AveragePrice"]))),
        fetched_at=_dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds"),
    )
    return AtiRateResult(
        "live",
        rate=live,
        bottom_kzt=round(per_trip(float(prices.get("BottomPrice") or 0))),
        upper_kzt=round(per_trip(float(prices.get("UpperPrice") or 0))),
        loads_count=int(last.get("LoadsCount") or 0),
    )


async def fetch_ati_live_rates(
    city_from: str,
    city_to: str,
    truck_type: str,
    api_key: Optional[str] = None,
    transport: Optional[httpx.AsyncBaseTransport] = None,
    timeout: float = 8.0,
) -> AtiRateResult:
    """Средняя рыночная ставка ATI.SU за последние 30 дней (Фура 20 т или Газель 3 т).

    Никогда не бросает исключений: при отсутствии ключа, лицензии, лимите или сетевой
    ошибке возвращает статус, и расчёт мягко остаётся на встроенном тарифе (Estimated Rate).
    """
    if truck_type not in ATI_AUTO_PROFILES:
        raise ValueError(f"truck_type must be truck or gazelle, got {truck_type!r}")
    key = (api_key if api_key is not None else os.getenv("ATI_SU_API_KEY", "")).strip()
    if not key:
        return AtiRateResult("no-key")
    a, b = ATI_CITY_IDS.get(city_from), ATI_CITY_IDS.get(city_to)
    if a is None or b is None or city_from == city_to:
        return AtiRateResult("unknown-city")

    cache_key = (city_from, city_to, truck_type)
    cached = _ATI_CACHE.get(cache_key)
    if cached and cached[0] > time.monotonic():
        return cached[1]

    today = _dt.date.today()
    body = {
        "From": {"CityId": a},
        "To": {"CityId": b},
        **ATI_AUTO_PROFILES[truck_type],
        "DateFrom": (today - _dt.timedelta(days=30)).isoformat(),
        "DateTo": today.isoformat(),
        "Frequency": "month",
        "WithNds": False,
        "RoundTrip": False,
    }
    try:
        async with httpx.AsyncClient(timeout=timeout, transport=transport) as client:
            response = await client.post(ATI_AVERAGE_PRICES_URL, json=body, headers={"Authorization": f"Bearer {key}"})
    except httpx.HTTPError as e:
        return AtiRateResult("network", detail=type(e).__name__)  # сеть не кэшируем
    result = _parse_ati(response, city_from, city_to, truck_type)
    _ATI_CACHE[cache_key] = (time.monotonic() + (_ATI_TTL_LIVE if result.status == "live" else _ATI_TTL_FAIL), result)
    return result


async def fetch_route_live_rates(city_from: str, city_to: str, api_key: Optional[str] = None) -> List[LiveRoadRate]:
    """Живые ставки фуры и газели для маршрута; пустой список → Estimated Rate."""
    if city_from == city_to:
        return []
    results = [await fetch_ati_live_rates(city_from, city_to, mode, api_key=api_key) for mode in ("truck", "gazelle")]
    return [r.rate for r in results if r.status == "live" and r.rate is not None]
