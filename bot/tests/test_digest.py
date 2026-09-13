"""Smart Daily Digest в боте: фильтры и двухблочная карточка (валидный Telegram HTML)."""
import datetime as dt
import json
import re
from pathlib import Path

import pytest

from calculator import analyze_tender
from digest import DigestFilters, digest_card, filters_view, lot_matches, normalize_keywords, published_within, stem
from models import CompanyTwin, TenderDocument, TenderSpec

LOTS = [TenderSpec.model_validate(x) for x in json.loads((Path(__file__).resolve().parents[1] / "data" / "sample_tenders.json").read_text("utf-8"))["tenders"]]
TWIN = CompanyTwin.from_answers(50, "almaty", 10, "other", "vat")

SPEC = LOTS[0].model_copy(update={
    "is_demo": False,
    "title": 'Поставка компьютеров <Dell> & мониторов',
    "announcement_no": "17342493-1",
    "published_at": "2026-09-13T18:45:00+05:00",
    "purchase_method": "Запрос ценовых предложений",
    "unit_price_kzt": 310000,
    "quantity": 40,
    "unit": "Штука",
    "delivery_place": "г. Талдыкорган, склад заказчика",
    "bid_start_at": "2026-09-13T09:00:00+05:00",
    "documents": [TenderDocument(name="techspec.pdf", url="https://v3bl.goszakup.gov.kz/files/download_file/1/2"), TenderDocument(name="x", url="javascript:alert(1)")],
})


def assert_telegram_html(text: str) -> None:
    assert len(text) <= 4096
    stack = []
    for close, tag, attrs in re.findall(r"<(/?)([a-z]+)([^>]*)>", text):
        assert tag in {"b", "i", "a", "code", "pre", "u", "s"}, tag
        if close:
            assert stack.pop() == tag
        else:
            if tag == "a":
                assert re.fullmatch(r' href="https?://[^"<>]+"', attrs), attrs
            stack.append(tag)
    assert not stack
    assert not re.search(r"[<>]", re.sub(r'</?(b|i|a|code|pre|u|s)( href="[^"]*")?>', "", text))


def test_filters_match_by_stem_budget_region():
    assert stem("компьютеры") == "компьюте"  # найдёт «компьютеров», «компьютерного»
    f = DigestFilters(keywords=["компьютеры"], regions=[SPEC.city_id])
    assert lot_matches(SPEC, f)
    assert not lot_matches(SPEC, f.model_copy(update={"regions": ["aktau"]}))
    assert not lot_matches(SPEC, f.model_copy(update={"keywords": ["мебель"]}))
    assert not lot_matches(SPEC, f.model_copy(update={"min_budget": SPEC.contract_amount + 1}))
    assert normalize_keywords("Сервера, компьютеры;; ок") == ["сервера", "компьютеры"]


def test_published_window_and_demo_lots():
    now = dt.datetime(2026, 9, 14, 3, 0, tzinfo=dt.timezone.utc)  # 08:00 Алматы
    assert published_within(SPEC, 24, now)
    assert not published_within(SPEC, 6, now)
    assert not published_within(SPEC.model_copy(update={"is_demo": True}), 24, now)


@pytest.mark.parametrize("lang", ["ru", "kz"])
def test_two_block_card_is_valid_telegram_html(lang):
    card = digest_card(SPEC, analyze_tender(SPEC, TWIN), TWIN, lang, "https://www.qazaqtenders.kz")
    assert_telegram_html(card)
    first, second = ("ИИ-аналитика", "Технические детали") if lang == "ru" else ("AI-талдауы", "Техникалық мәліметтер")
    assert card.index(first) < card.index(second)
    assert "TOS" in card and "/tender/" in card and "techspec.pdf" in card
    assert "javascript:" not in card
    if lang == "ru":
        assert "&lt;Dell&gt; &amp; мониторов" in card and "Запрос ценовых предложений" in card and "13.09.2026 —" in card


@pytest.mark.parametrize("spec", LOTS, ids=lambda s: s.id)
def test_cards_for_all_sample_lots(spec):
    assert_telegram_html(digest_card(spec, analyze_tender(spec, TWIN), TWIN, "ru", "https://www.qazaqtenders.kz"))


def test_huge_lot_is_cut_to_limit():
    long = SPEC.model_copy(update={"title": "Очень длинное название " * 400, "customer": "Заказчик " * 300})
    assert_telegram_html(digest_card(long, analyze_tender(long, TWIN), TWIN, "ru", "https://www.qazaqtenders.kz"))


def test_filters_view_is_valid_html():
    assert_telegram_html(filters_view(DigestFilters(keywords=["сервера"], regions=["astana"]), "ru"))
