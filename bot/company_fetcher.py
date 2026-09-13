"""
Автосборка «цифрового двойника» по БИН/ИИН из реестров Республики Казахстан.

Источники (каждый включается своим ключом; без ключа или при сбое — Smart Defaults
с флагом is_estimated=True, расчёт не останавливается):

  • data.egov.kz, набор gbd_ul — DATA_EGOV_API_KEY (бесплатно после регистрации):
      наименование, дата регистрации, юридический адрес, руководитель, ОКЭД, статус.
  • КГД МФ РК, API «Поиск данных о плательщике НДС» — KGD_PORTAL_TOKEN
      (выдаётся по обращению на portal.kgd.gov.kz): постановка/снятие с учёта по НДС.
  • Госзакупки, OWS v3 — GOSZAKUP_TOKEN: РНУ (/rnu/{biin}), участник (/subject/biin/{biin}:
      дата регистрации, КАТО), исполненные договоры (/contract/supplier/{biin}).

Выбор «упрощёнка или ОУР» открыто не публикуется: для ТОО без НДС он остаётся за
пользователем и помечается как оценка. Капчи и закрытые кабинеты не обходятся.
Все источники опрашиваются параллельно — ответ приходит примерно за время самого
медленного из них (таймаут 6 с на запрос).
"""
from __future__ import annotations

import asyncio
import datetime as dt
import json
import os
import re
import time
from typing import Any, Dict, List, Literal, Optional, Tuple

import httpx
from pydantic import BaseModel, Field

from logistics import CITIES

EGOV_URL = "https://data.egov.kz/api/v4/gbd_ul/v1"
KGD_VAT_URL = "https://portal.kgd.gov.kz/services/isnaportalsync/public/search-payer-data"
OWS_URL = "https://ows.goszakup.gov.kz/v3"
USER_AGENT = "QazaqTenders/1.0 (+https://www.qazaqtenders.kz)"

SourceId = Literal["egov_gbd_ul", "kgd_vat", "goszakup_rnu", "goszakup_subject", "goszakup_contracts"]
SourceStatus = Literal["ok", "not-found", "no-key", "rate-limit", "invalid-key", "error", "network"]
TaxRegime = Literal["simplified", "general", "vat"]


class RegistryError(ValueError):
    """Некорректный БИН/ИИН (формат или контрольная цифра)."""


class RegistrySource(BaseModel):
    id: SourceId
    status: SourceStatus
    detail: str = ""


class CompanyRegistryProfile(BaseModel):
    bin: str
    entity_type: Literal["legal", "individual"]
    name: str = ""
    director_name: str = ""
    legal_address: str = ""
    oked: str = ""
    status: str = ""
    registered_on: Optional[str] = None  # ISO-дата
    experience_years: float = 0.0
    city_id: Optional[str] = None
    vat_payer: Optional[bool] = None
    suggested_tax_regime: Optional[TaxRegime] = None
    rnu_listed: Optional[bool] = None
    rnu_until: Optional[str] = None
    gov_contracts_count: Optional[int] = None
    gov_contracts_sum_kzt: Optional[float] = None
    sources: List[RegistrySource] = Field(default_factory=list)
    # Хотя бы один государственный реестр подтвердил компанию
    verified: bool = False
    # Часть полей — Smart Defaults (перечислены в estimated_fields)
    is_estimated: bool = True
    estimated_fields: List[str] = Field(default_factory=list)
    checked_at: str = ""


# ------------------------------- БИН / ИИН ------------------------------- #


def is_valid_bin(value: str) -> bool:
    """Контрольная цифра БИН/ИИН: веса 1..11 mod 11; при 10 — веса 3..11,1,2; снова 10 — ошибка."""
    d = (value or "").strip()
    if not re.fullmatch(r"\d{12}", d):
        return False
    digits = [int(c) for c in d]
    w1 = list(range(1, 12))
    w2 = [3, 4, 5, 6, 7, 8, 9, 10, 11, 1, 2]
    c = sum(w * x for w, x in zip(w1, digits)) % 11
    if c == 10:
        c = sum(w * x for w, x in zip(w2, digits)) % 11
        if c == 10:
            return False
    return c == digits[11]


def entity_type(bin_: str) -> Literal["legal", "individual"]:
    """5-я цифра БИН: 4/5/6 — юрлицо, филиал, ИП(С). Иначе это ИИН физлица или ИП."""
    return "legal" if bin_[4] in "456" else "individual"


def registration_from_bin(bin_: str, today: Optional[dt.date] = None) -> Optional[dt.date]:
    """Первые 4 цифры БИН — год и месяц регистрации (ГГММ). Для ИИН это дата рождения, не используем."""
    if entity_type(bin_) != "legal":
        return None
    today = today or dt.date.today()
    yy, mm = int(bin_[:2]), int(bin_[2:4])
    if not 1 <= mm <= 12:
        return None
    year = 2000 + yy if 2000 + yy <= today.year else 1900 + yy
    return dt.date(year, mm, 1)


# ----------------------------- регион и даты ----------------------------- #

# Первые две цифры КАТО → областной центр, который используется как база логистики
KATO_REGION_CITY: Dict[str, str] = {
    "71": "astana", "75": "almaty", "79": "shymkent", "11": "kokshetau", "15": "aktobe", "19": "almaty",
    "23": "atyrau", "27": "oral", "31": "taraz", "35": "karaganda", "39": "kostanay", "43": "kyzylorda",
    "47": "aktau", "55": "pavlodar", "59": "petropavl", "61": "turkistan", "63": "oskemen", "10": "semey",
    "33": "taldykorgan", "62": "karaganda",
}


def city_from_kato(code: Any) -> Optional[str]:
    digits = re.sub(r"\D", "", str(code or ""))
    return KATO_REGION_CITY.get(digits[:2]) if len(digits) >= 2 else None


def city_from_address(text: str) -> Optional[str]:
    """«751110000, г.Алматы, …» или «Карагандинская обл., …» → id города."""
    if not text:
        return None
    m = re.match(r"\s*(\d{9})\b", text)
    if m:
        return city_from_kato(m.group(1))
    low = text.lower()
    regions = {"акмолин": "kokshetau", "алматинск": "almaty", "жетісу": "taldykorgan", "жетысу": "taldykorgan",
               "восточно-казахстан": "oskemen", "западно-казахстан": "oral", "северо-казахстан": "petropavl",
               "абай": "semey", "улытау": "karaganda", "мангист": "aktau", "жамбыл": "taraz"}
    for stem, city in regions.items():
        if stem in low:
            return city
    for c in CITIES:
        for name in (c.ru.lower(), c.kz.lower()):
            if name[:5] in low:
                return c.id
    return None


def _parse_date(value: Any) -> Optional[dt.date]:
    if not value:
        return None
    s = str(value).strip()
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})", s)
    if m:
        return dt.date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    m = re.match(r"(\d{2})\.(\d{2})\.(\d{4})", s)
    if m:
        return dt.date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
    return None


# --------------------------------- HTTP --------------------------------- #


async def _get_json(client: httpx.AsyncClient, url: str, **kwargs: Any) -> Tuple[SourceStatus, Any, str]:
    try:
        r = await client.get(url, **kwargs)
    except httpx.HTTPError as e:
        return "network", None, type(e).__name__
    if r.status_code == 404:
        return "not-found", None, ""
    if r.status_code in (401, 403):
        return "invalid-key", None, f"HTTP {r.status_code}"
    if r.status_code == 429:
        return "rate-limit", None, ""
    if r.status_code >= 400:
        return "error", None, f"HTTP {r.status_code}"
    try:
        return "ok", r.json(), ""
    except ValueError:
        return "error", None, "bad json"


def _items(data: Any) -> List[Dict[str, Any]]:
    if isinstance(data, list):
        return [x for x in data if isinstance(x, dict)]
    if isinstance(data, dict):
        if isinstance(data.get("items"), list):
            return [x for x in data["items"] if isinstance(x, dict)]
        if any(k in data for k in ("supplier_biin", "pid", "bin", "regdate")):
            return [data]
    return []


async def _egov(client: httpx.AsyncClient, bin_: str, key: str) -> Tuple[RegistrySource, Optional[Dict[str, Any]]]:
    if not key:
        return RegistrySource(id="egov_gbd_ul", status="no-key"), None
    query = json.dumps({"size": 1, "query": {"bool": {"must": [{"match": {"bin": bin_}}]}}})
    status, data, detail = await _get_json(client, EGOV_URL, params={"apiKey": key, "source": query})
    row = None
    if status == "ok":
        row = next((r for r in _items(data) if str(r.get("bin", "")).strip() == bin_), None)
        if row is None:
            status = "not-found"
    return RegistrySource(id="egov_gbd_ul", status=status, detail=detail), row


async def _kgd_vat(client: httpx.AsyncClient, bin_: str, token: str) -> Tuple[RegistrySource, Optional[bool]]:
    if not token:
        return RegistrySource(id="kgd_vat", status="no-key"), None
    status, data, detail = await _get_json(client, KGD_VAT_URL, headers={"X-Portal-Token": token}, params={"taxpayerCode": bin_})
    vat: Optional[bool] = None
    if status == "ok" and isinstance(data, dict):
        reg, dereg = _parse_date(data.get("ndsRegistrationDate")), _parse_date(data.get("ndsDeregistrationDate"))
        vat = bool(reg) and (dereg is None or dereg < reg)
    return RegistrySource(id="kgd_vat", status=status, detail=detail), vat


async def _goszakup(client: httpx.AsyncClient, bin_: str, token: str) -> Dict[str, Any]:
    if not token:
        return {"sources": [RegistrySource(id=s, status="no-key") for s in ("goszakup_rnu", "goszakup_subject", "goszakup_contracts")]}
    headers = {"Authorization": f"Bearer {token}"}
    (st_r, d_r, det_r), (st_s, d_s, det_s), (st_c, d_c, det_c) = await asyncio.gather(
        _get_json(client, f"{OWS_URL}/rnu/{bin_}", headers=headers),
        _get_json(client, f"{OWS_URL}/subject/biin/{bin_}", headers=headers),
        _get_json(client, f"{OWS_URL}/contract/supplier/{bin_}", headers=headers, params={"limit": 200}),
    )
    out: Dict[str, Any] = {"sources": [
        RegistrySource(id="goszakup_rnu", status=st_r, detail=det_r),
        RegistrySource(id="goszakup_subject", status=st_s, detail=det_s),
        RegistrySource(id="goszakup_contracts", status=st_c, detail=det_c),
    ]}
    today = dt.date.today()
    if st_r == "ok":
        ends = [_parse_date(i.get("end_date")) for i in _items(d_r)]
        active = [e for e in ends if e is None or e >= today]
        out["rnu_listed"] = bool(active)
        dated = [e for e in active if e is not None]
        out["rnu_until"] = max(dated).isoformat() if dated else None
    elif st_r == "not-found":  # в реестре нет — это подтверждённый «чистый» результат
        out["rnu_listed"] = False
    if st_s == "ok":
        subject = next(iter(_items(d_s)), None)
        if subject:
            out["subject_regdate"] = _parse_date(subject.get("regdate") or subject.get("crdate"))
            kato = subject.get("kato_code") or next((a.get("kato_code") for a in subject.get("address") or [] if isinstance(a, dict)), None)
            out["subject_city"] = city_from_kato(kato)
    if st_c == "ok":
        contracts = _items(d_c)
        out["contracts_count"] = len(contracts)
        out["contracts_sum"] = float(sum(float(c.get("contract_sum_wnds") or 0) for c in contracts))
    return out


# ------------------------------- основной вызов ------------------------------- #

_CACHE: Dict[str, Tuple[float, CompanyRegistryProfile]] = {}


def clear_registry_cache() -> None:
    _CACHE.clear()


async def fetch_company(
    bin_value: str,
    *,
    egov_key: Optional[str] = None,
    kgd_token: Optional[str] = None,
    goszakup_token: Optional[str] = None,
    transport: Optional[httpx.AsyncBaseTransport] = None,
    timeout: float = 6.0,
) -> CompanyRegistryProfile:
    """БИН/ИИН → профиль компании из реестров РК. Бросает RegistryError только на неверный номер."""
    bin_ = re.sub(r"\D", "", bin_value or "")
    if not is_valid_bin(bin_):
        raise RegistryError("invalid-bin")
    egov_key = (egov_key if egov_key is not None else os.getenv("DATA_EGOV_API_KEY", "")).strip()
    kgd_token = (kgd_token if kgd_token is not None else os.getenv("KGD_PORTAL_TOKEN", "")).strip()
    goszakup_token = (goszakup_token if goszakup_token is not None else os.getenv("GOSZAKUP_TOKEN", "")).strip()

    hit = _CACHE.get(bin_)
    if hit and hit[0] > time.monotonic():
        return hit[1]

    async with httpx.AsyncClient(timeout=timeout, transport=transport, headers={"User-Agent": USER_AGENT}) as client:
        (egov_src, row), (kgd_src, vat), gz = await asyncio.gather(
            _egov(client, bin_, egov_key), _kgd_vat(client, bin_, kgd_token), _goszakup(client, bin_, goszakup_token)
        )

    kind = entity_type(bin_)
    estimated: List[str] = []
    row = row or {}

    registered = _parse_date(row.get("datereg")) or gz.get("subject_regdate")
    if registered is None:
        registered = registration_from_bin(bin_)
        estimated.append("registered_on")
    today = dt.date.today()
    experience = round(max(0.0, (today - registered).days / 365.25), 1) if registered else 0.0

    address = str(row.get("addressru") or "").strip()
    city = gz.get("subject_city") or city_from_address(address)
    if city is None:
        estimated.append("city_id")

    if vat is None:
        estimated.append("vat_payer")
    regime: Optional[TaxRegime] = "vat" if vat else ("simplified" if vat is False and kind == "individual" else None)
    if regime is None or (vat is False and kind == "individual"):
        estimated.append("tax_regime")

    rnu = gz.get("rnu_listed")
    if rnu is None:
        estimated.append("rnu_listed")

    sources = [egov_src, kgd_src, *gz["sources"]]
    verified = any(s.status == "ok" for s in (egov_src, kgd_src)) or any(
        s.id == "goszakup_subject" and s.status == "ok" for s in gz["sources"]
    )
    profile = CompanyRegistryProfile(
        bin=bin_,
        entity_type=kind,
        name=str(row.get("nameru") or "").strip(),
        director_name=str(row.get("director") or "").strip(),
        legal_address=address,
        oked=str(row.get("okedru") or "").strip(),
        status=str(row.get("statusru") or "").strip(),
        registered_on=registered.isoformat() if registered else None,
        experience_years=experience,
        city_id=city,
        vat_payer=vat,
        suggested_tax_regime=regime,
        rnu_listed=rnu,
        rnu_until=gz.get("rnu_until"),
        gov_contracts_count=gz.get("contracts_count"),
        gov_contracts_sum_kzt=gz.get("contracts_sum"),
        sources=sources,
        verified=verified,
        is_estimated=bool(estimated),
        estimated_fields=estimated,
        checked_at=dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
    )
    # Удачный ответ держим сутки; сбои — 10 минут, чтобы быстро подхватить новые ключи
    network_failed = any(s.status in ("network", "rate-limit") for s in sources)
    if not network_failed:
        _CACHE[bin_] = (time.monotonic() + (86_400 if verified else 600), profile)
    return profile
