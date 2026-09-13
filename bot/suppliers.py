"""Real-time supplier catalogue adapter.

There is no legitimate universal API containing prices and contacts of every
Kazakhstani supplier. This adapter therefore consumes a contracted catalogue or
ERP/marketplace endpoint configured by the operator. It never fabricates demo
offers: missing credentials produce an explicit unavailable state.

Expected GET response::

    {"offers": [{
      "id": "sku-42", "supplier_name": "ТОО ...", "product_name": "...",
      "total_price_kzt": 7800000, "unit_price_kzt": 78000, "quantity": 100,
      "phone": "+7...", "url": "https://...", "city": "Алматы",
      "availability": "in_stock", "updated_at": "2026-09-13T10:00:00Z",
      "source": "partner-name", "cargo_tonnes": 0.25
    }]}

The same contract is used by the Next.js /api/suppliers route.
"""
from __future__ import annotations

import hashlib
from typing import List
from urllib.parse import urlparse

import httpx

from models import SupplierOffer, TenderSpec


class SupplierError(Exception):
    pass


class SupplierCatalog:
    def __init__(self, endpoint: str = "", api_key: str = "") -> None:
        self.endpoint = endpoint.strip()
        self.api_key = api_key.strip()

    @property
    def available(self) -> bool:
        p = urlparse(self.endpoint)
        return p.scheme == "https" and bool(p.netloc and self.api_key)

    async def search(self, tender: TenderSpec, limit: int = 12) -> List[SupplierOffer]:
        if not self.available:
            raise SupplierError("not_configured")
        query = ", ".join(i.name for i in tender.items[:5]) or tender.title
        try:
            async with httpx.AsyncClient(timeout=15, follow_redirects=False) as client:
                response = await client.get(
                    self.endpoint,
                    params={"q": query[:500], "city": tender.city_id, "limit": min(30, max(1, limit))},
                    headers={"Authorization": f"Bearer {self.api_key}", "Accept": "application/json"},
                )
                response.raise_for_status()
                payload = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise SupplierError("upstream_failed") from exc

        rows = payload.get("offers", []) if isinstance(payload, dict) else []
        offers: List[SupplierOffer] = []
        for row in rows:
            try:
                offer = SupplierOffer.model_validate(row)
            except Exception:
                continue
            # Only usable, attributable offers enter the financial engine.
            u = urlparse(offer.url)
            if u.scheme != "https" or not u.netloc or offer.total_price_kzt <= 0:
                continue
            offer.id = hashlib.sha1(f"{offer.source}:{offer.id}".encode()).hexdigest()[:16]
            offers.append(offer)
        return sorted(offers, key=lambda x: x.total_price_kzt)[:limit]
