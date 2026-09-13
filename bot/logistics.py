"""Deterministic Kazakhstan logistics quotes shared by the Telegram economic layer.

Rates are explicit market benchmarks, not carrier quotations. The module compares
city delivery, 20-t truck, Gazelle, rail container and air express without network
calls, so one input always produces one result.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Dict, List, Literal, Optional

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


def _quote(from_id: str, to_id: str, tonnes: float, mode: LogisticsMode, fuel_delta_pct: float, transport_delta_pct: float) -> LogisticsQuote:
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


def logistics_quotes(from_id: str, to_id: str, tonnes: float, fuel_delta_pct: float = 0.0, transport_delta_pct: float = 0.0) -> List[LogisticsQuote]:
    if from_id not in CITY_BY_ID or to_id not in CITY_BY_ID:
        raise ValueError(f"Unknown city: {from_id if from_id not in CITY_BY_ID else to_id}")
    if from_id == to_id:
        return [_quote(from_id, to_id, tonnes, "city", fuel_delta_pct, transport_delta_pct)]
    return [_quote(from_id, to_id, tonnes, mode, fuel_delta_pct, transport_delta_pct) for mode in ("truck", "gazelle", "rail", "air")]


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


def logistics_plan(from_id: str, to_id: str, tonnes: float, requested: TransportMode = "auto", delivery_days: int = 30, fuel_delta_pct: float = 0.0, transport_delta_pct: float = 0.0) -> LogisticsPlan:
    quotes = logistics_quotes(from_id, to_id, tonnes, fuel_delta_pct, transport_delta_pct)
    recommended = recommend_logistics_mode(quotes, tonnes, delivery_days)
    selected = next((quote for quote in quotes if quote.mode == requested), next(quote for quote in quotes if quote.mode == recommended))
    road_mode: LogisticsMode = "gazelle" if tonnes <= 3 else "truck"
    road = next((quote for quote in quotes if quote.mode == road_mode), quotes[0])
    return LogisticsPlan(selected=selected, recommended_mode=recommended, quotes=quotes, road_reference_days=road.transit_days)
