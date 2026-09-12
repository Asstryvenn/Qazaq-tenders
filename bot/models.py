"""
Pydantic-модели — строгий JSON-контракт между слоями Qazaq Tenders.

    AI Layer ──(TenderSpec, JSON)──► Economic Layer ──(AnalysisResult)──► Telegram / REST API

AI-слой ТОЛЬКО заполняет TenderSpec фактами из документа и никогда ничего не считает.
Имена полей повторяют TypeScript-типы сайта (lib/types.ts). Лента
www.qazaqtenders.kz/api/tenders читается через camelCase-алиасы
(contractAmount → contract_amount), поэтому бот и сайт работают с одними и теми же лотами.

Код совместим с Python 3.9+, поэтому Optional/List, а не «X | None».
"""
from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

TaxRegime = Literal["general", "simplified", "vat"]
Severity = Literal["low", "medium", "high"]
Verdict = Literal["go", "caution", "no-go"]
Lang = Literal["kz", "ru"]


class _Camel(BaseModel):
    """Принимает и snake_case, и camelCase (формат API сайта)."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="ignore")


# --------------------------------------------------------------------------- #
# Выход AI-слоя: факты лота                                                  #
# --------------------------------------------------------------------------- #


class SpecPage(_Camel):
    """Одна страница техспецификации — из неё AI цитирует пункты со ссылкой на страницу."""

    page: int
    text: str


class HiddenRequirement(_Camel):
    """Подозрительный или ограничивающий конкуренцию пункт, найденный NLP-«ситом»."""

    clause: str
    page: int
    severity: Severity
    reason: str


class TenderSpec(_Camel):
    """Лот госзакупки в виде, пригодном для расчёта. Все суммы в тенге."""

    id: str
    external_id: str = ""
    source: str = "upload"
    source_url: str = ""
    is_demo: bool = False
    # Условия оценены по объявлению или по неполному документу (не все факты найдены)
    estimated: bool = False
    title: str
    title_kz: str = ""
    customer: str = ""
    # S — сумма договора
    contract_amount: float = Field(..., gt=0)
    # Аванс при подписании, % от S
    advance_percentage: float = 0.0
    # Обеспечение заявки / исполнения (доли). None → нормы закона 1 % / 3 %
    bid_security_rate: Optional[float] = None
    performance_security_rate: Optional[float] = None
    # D — срок поставки, дней от заключения договора
    delivery_days: int = Field(..., ge=0)
    # P_delay — отсрочка оплаты после поставки, дней
    payment_delay_days: int = Field(..., ge=0)
    # K_delay — неустойка в день, доля от S (норма закона 0,001)
    penalty_rate: float = 0.001
    # Себестоимость товара (количество × рыночная цена)
    purchase_cost: float = Field(..., ge=0)
    city_id: str
    cargo_tonnes: float = 1.0
    required_experience_years: float = 0.0
    required_certificates: List[str] = Field(default_factory=list)
    hidden_requirements: List[HiddenRequirement] = Field(default_factory=list)
    # Срок подачи заявок, ISO-дата
    deadline: str = ""
    spec_pages: List[SpecPage] = Field(default_factory=list)


# --------------------------------------------------------------------------- #
# Цифровой двойник компании                                                  #
# --------------------------------------------------------------------------- #


class CompanyTwin(BaseModel):
    """«Цифровой двойник» МСБ: всё, относительно чего оценивается лот."""

    model_config = ConfigDict(extra="ignore")

    name: str = ""
    # CF_0 — доступный оборотный капитал, ₸
    working_capital: float = Field(..., gt=0)
    base_city_id: str
    # Минимальная желаемая маржа, %: ниже неё лот помечается и не попадает в уведомления
    min_margin_pct: float = Field(10.0, ge=0, le=90)
    industry: str = "other"
    tax_regime: TaxRegime = "simplified"
    # Dist_max — радиус, в котором компания готова возить, км
    max_distance_km: float = 1500.0
    # Постоянные расходы в месяц и доля, которая приходится на один договор
    monthly_opex: float = Field(..., ge=0)
    opex_allocation: float = 0.35
    # Годовая ставка кредитной линии, которой закрывается кассовый разрыв
    credit_rate: float = 0.24
    experience_years: float = 3.0
    certificates: List[str] = Field(default_factory=list)

    @classmethod
    def from_answers(
        cls,
        capital_mln: float,
        city_id: str,
        min_margin_pct: float,
        industry: str,
        tax_regime: str,
        name: str = "",
    ) -> "CompanyTwin":
        """Собирает двойника из ответов FSM-анкеты бота.

        Постоянные расходы по умолчанию ≈ 8 % капитала в месяц (как у демо-компании сайта:
        4,2 млн при 52 млн), в пределах 0,5–10 млн ₸.
        """
        wc = capital_mln * 1_000_000
        opex = min(10_000_000.0, max(500_000.0, round(wc * 0.08, -3)))
        return cls(
            name=name,
            working_capital=wc,
            base_city_id=city_id,
            min_margin_pct=min_margin_pct,
            industry=industry,
            tax_regime=tax_regime,  # type: ignore[arg-type]
            monthly_opex=opex,
        )


# --------------------------------------------------------------------------- #
# Сценарий «Что если?» и результат расчёта                                   #
# --------------------------------------------------------------------------- #


class Scenario(BaseModel):
    """Рычаги симулятора чувствительности. Нулевой сценарий = исходные условия."""

    fuel_delta_pct: float = 0.0  # +% к цене топлива (двигает только топливную долю тарифа)
    transport_delta_pct: float = 0.0  # +% ко всему тарифу перевозчика
    supplier_delta_pct: float = 0.0  # +% к цене закупки у поставщика
    payment_delay_delta: int = 0  # +дней к отсрочке оплаты
    late_days: int = 0  # дней просрочки поставки → неустойка
    delivery_delta_days: int = 0  # продление срока по согласованию (без неустойки)


class CostBreakdown(BaseModel):
    purchase: float
    logistics: float
    tax: float
    bank: float  # проценты по кредиту на кассовый разрыв
    guarantee: float  # комиссия банка за гарантию исполнения 3 %
    operating: float
    penalty: float


class CashFlowPoint(BaseModel):
    day: int
    balance: int
    inflow: int
    outflow: int
    events: List[str] = Field(default_factory=list)


class Reason(BaseModel):
    """Структурированная причина «почему рискованно». Текст рендерит texts.py (KZ/RU)."""

    code: str
    data: Dict[str, Any] = Field(default_factory=dict)


class AnalysisResult(BaseModel):
    tender_id: str
    net_profit: float  # Π
    margin_pct: float  # M_rel, %
    costs: CostBreakdown
    tos: float
    components: Dict[str, float]
    cash_flow_risk: float
    logistics_score: float
    legal_risk: float
    cash_flow_gap: bool  # Trigger_Gap
    max_deficit: float
    gap_day: Optional[int]
    days_in_deficit: int
    pay_day: int
    delivery_day: int
    distance_km: float
    trucks: int
    timeline: List[CashFlowPoint]
    verdict: Verdict
    reasons: List[Reason]


class SearchQuery(BaseModel):
    """Параметры поиска, извлечённые NLP из текста или голосового сообщения."""

    keywords: List[str] = Field(default_factory=list)
    industry: Optional[str] = None
    city_id: Optional[str] = None
    max_amount_kzt: Optional[float] = None
    min_amount_kzt: Optional[float] = None
