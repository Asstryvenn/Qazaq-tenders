"""Supplier catalogue adapter with an explicit, deterministic demo fallback.

Live rows come only from the configured contracted catalogue. When it is absent,
empty or unavailable, fictional rows are returned with `is_demo=True` and
`status="smart_ai"`; callers must never present them as verified quotations.
"""
from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from typing import List
from urllib.parse import urlparse

import httpx

from models import SupplierOffer, TenderSpec


class SupplierError(Exception):
    """Kept for backwards compatibility; normal upstream failures now use fallback."""


DEMO_REGIONS = [
    ("Алматы", "ДЕМО · ТОО Алматы ТехСнаб", 0.96, True, "almaty"),
    ("Астана", "ДЕМО · ТОО Astana Supply Lab", 1.01, True, "astana"),
    ("Шымкент", "ДЕМО · ТОО Оңтүстік Қамту", 0.94, False, "shymkent"),
    ("Караганда", "ДЕМО · ТОО Saryarqa Industrial", 0.99, True, "karaganda"),
    ("Павлодар", "ДЕМО · ТОО Павлодар-ПромСнаб", 1.04, True, "pavlodar"),
]


def demo_supplier_offers(tender: TenderSpec, limit: int = 12) -> List[SupplierOffer]:
    query = ", ".join(item.name for item in tender.items[:5]) or tender.title
    digest = hashlib.sha256(query.lower().encode("utf-8")).digest()
    baseline = max(100_000.0, tender.purchase_cost or tender.contract_amount * 0.78)
    quantity = max(1.0, sum(item.quantity for item in tender.items) or 1.0)
    cargo = max(0.01, tender.cargo_tonnes)
    now = datetime.now(timezone.utc).isoformat()
    offers: List[SupplierOffer] = []
    for index, (city, name, factor, st_kz, slug) in enumerate(DEMO_REGIONS[:limit]):
        jitter = 0.97 + digest[index] / 255 * 0.06
        total = round(baseline * factor * jitter / 1000) * 1000
        offer_id = "demo-" + hashlib.sha1(f"{query}:{slug}".encode("utf-8")).hexdigest()[:11]
        offers.append(
            SupplierOffer(
                id=offer_id,
                supplier_name=name,
                product_name=query[:220],
                total_price_kzt=total,
                unit_price_kzt=round(total / quantity),
                quantity=quantity,
                phone="+7 (000) 000-00-00",
                email=f"demo+{slug}@qazaqtenders.kz",
                url="https://www.qazaqtenders.kz/",
                city=city,
                availability="demo",
                updated_at=now,
                source="Qazaq Tenders · demo fallback",
                cargo_tonnes=round(cargo * (0.96 + index * 0.02), 2),
                has_st_kz_certificate=st_kz,
                status="smart_ai",
                is_demo=True,
            )
        )
    return offers


class SupplierCatalog:
    def __init__(self, endpoint: str = "", api_key: str = "") -> None:
        self.endpoint = endpoint.strip()
        self.api_key = api_key.strip()

    @property
    def available(self) -> bool:
        parsed = urlparse(self.endpoint)
        return parsed.scheme == "https" and bool(parsed.netloc and self.api_key)

    async def search(self, tender: TenderSpec, limit: int = 12) -> List[SupplierOffer]:
        if not self.available:
            return demo_supplier_offers(tender, limit)
        query = ", ".join(item.name for item in tender.items[:5]) or tender.title
        try:
            async with httpx.AsyncClient(timeout=15, follow_redirects=False) as client:
                response = await client.get(
                    self.endpoint,
                    params={"q": query[:500], "city": tender.city_id, "limit": min(30, max(1, limit))},
                    headers={"Authorization": f"Bearer {self.api_key}", "Accept": "application/json"},
                )
                response.raise_for_status()
                payload = response.json()
        except (httpx.HTTPError, ValueError):
            return demo_supplier_offers(tender, limit)

        rows = payload.get("offers", []) if isinstance(payload, dict) else []
        offers: List[SupplierOffer] = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            try:
                offer = SupplierOffer.model_validate(row)
            except Exception:
                continue
            url = urlparse(offer.url)
            if url.scheme != "https" or not url.netloc or offer.total_price_kzt <= 0:
                continue
            offer.id = hashlib.sha1(f"{offer.source}:{offer.id}".encode()).hexdigest()[:16]
            offer.is_demo = False
            # Only an explicit upstream verification flag earns Verified status.
            offer.status = "verified" if row.get("verified") is True or row.get("status") == "verified" else "smart_ai"
            offers.append(offer)
        return sorted(offers, key=lambda item: item.total_price_kzt)[:limit] or demo_supplier_offers(tender, limit)
