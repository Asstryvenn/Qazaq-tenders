// Smart Daily Digest: filter matching and the two-block card (Telegram HTML + email). npm run test:admin
import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_FILTERS, lotMatches, normalizeKeywords, publishedWithin, stem } from "../lib/digest/match.ts";
import { cardModel, digestHeader, packMessages, renderEmail, renderTelegramCard, TELEGRAM_LIMIT } from "../lib/digest/format.ts";

const NOW = Date.parse("2026-09-14T08:00:00+05:00");

const spec = {
  id: "tenderplus-52490014",
  externalId: "87420702-ЗЦП1 · Государственные закупки",
  announcementNo: "17342493-1",
  source: "tenderplus",
  sourceUrl: "https://old.goszakup.gov.kz/ru/announce/index/17342493",
  isDemo: false,
  estimated: true,
  title: 'Поставка компьютеров <Dell> & мониторов для школ "Жетісу"',
  titleKz: "Мектептерге компьютер жеткізу",
  customer: "ГУ «Отдел образования»",
  contractAmount: 12_400_000,
  advancePercentage: 0,
  deliveryDays: 30,
  paymentDelayDays: 30,
  penaltyRate: 0.001,
  purchaseCost: 9_672_000,
  cityId: "shymkent",
  cargoTonnes: 2,
  requiredExperienceYears: 0,
  requiredCertificates: [],
  hiddenRequirements: [],
  deadline: "2026-09-24",
  bidStartAt: "2026-09-13T09:00:00+05:00",
  publishedAt: "2026-09-13T18:45:00+05:00",
  purchaseMethod: "Запрос ценовых предложений",
  unitPriceKzt: 310_000,
  quantity: 40,
  unit: "Штука",
  deliveryPlace: "791010000, г.Шымкент, ул. Тауке хана 5",
  documents: [
    { name: "techspec_17342493.pdf", url: "https://v3bl.goszakup.gov.kz/files/download_file/310955288/2" },
    { name: "evil.pdf", url: "javascript:alert(1)" },
  ],
  specPages: [],
};

const result = {
  tenderId: spec.id, netProfit: 2_100_000, marginPct: 16.9, tos: 82.4, verdict: "go", cashFlowGap: true, maxDeficit: 3_200_000, gapDay: 6,
  payDay: 60, deliveryDay: 30, distanceKm: 860, trucks: 1, transportMode: "truck", transportUnits: 1, transitDays: 2,
  logisticsRateKind: "benchmark", logisticsRateLabel: "Estimated Rate",
  costs: { purchase: 9_672_000, logistics: 185_000, tax: 496_000, bank: 90_000, guarantee: 50_000, operating: 0, penalty: 0 },
  timeline: Array.from({ length: 66 }, (_, d) => ({ day: d, balance: d >= 6 && d < 40 ? -1 : 100, inflow: 0, outflow: 0, events: [] })),
  components: {}, cashFlowRisk: 0, logisticsScore: 0, legalRisk: 0, reasons: [],
};

const input = (lang) => ({ spec, result, baseCityId: "almaty", cityName: (id) => ({ almaty: "Алматы", shymkent: "Шымкент" })[id] ?? id, siteUrl: "https://www.qazaqtenders.kz/", lang });

/** Telegram HTML subset: only these tags, all balanced, entities escaped. */
function assertTelegramHtml(text) {
  assert.ok(text.length <= TELEGRAM_LIMIT, `too long: ${text.length}`);
  const allowed = new Set(["b", "i", "a", "code", "pre", "u", "s"]);
  const stack = [];
  for (const m of text.matchAll(/<(\/?)([a-z-]+)([^>]*)>/g)) {
    const [, close, tag, attrs] = m;
    assert.ok(allowed.has(tag), `tag <${tag}> is not allowed by Telegram`);
    if (close) assert.equal(stack.pop(), tag, `unbalanced </${tag}>`);
    else {
      if (tag === "a") assert.match(attrs, /^ href="https?:\/\/[^"<>]+"$/, `bad link ${attrs}`);
      stack.push(tag);
    }
  }
  assert.deepEqual(stack, [], "unclosed tags");
  assert.doesNotMatch(text.replace(/<\/?(b|i|a|code|pre|u|s)( href="[^"]*")?>/g, ""), /[<>]/, "raw < or > left in text");
}

test("keywords match by stem, budget and region filters apply", () => {
  assert.equal(stem("компьютеры"), "компьюте"); // matches «компьютеров», «компьютерного»
  const f = { ...DEFAULT_FILTERS, keywords: ["компьютеры"], regions: ["shymkent"] };
  assert.equal(lotMatches(spec, f), true);
  assert.equal(lotMatches(spec, { ...f, regions: ["astana"] }), false);
  assert.equal(lotMatches(spec, { ...f, keywords: ["мебель"] }), false);
  assert.equal(lotMatches(spec, { ...f, minBudget: 20e6 }), false);
  assert.equal(lotMatches(spec, { ...DEFAULT_FILTERS }), true); // empty filters = everything in budget
  assert.deepEqual(normalizeKeywords("Сервера, компьютеры;; ок, сервера"), ["сервера", "компьютеры"]);
});

test("only lots published in the window count; demo lots never do", () => {
  assert.equal(publishedWithin(spec, 24, NOW), true);
  assert.equal(publishedWithin(spec, 6, NOW), false);
  assert.equal(publishedWithin({ ...spec, isDemo: true }, 24, NOW), false);
  assert.equal(publishedWithin({ ...spec, publishedAt: undefined }, 24, NOW), false);
});

test("Telegram card has both blocks, escapes text and drops unsafe links", () => {
  const html = renderTelegramCard(cardModel(input("ru")), "ru");
  assertTelegramHtml(html);
  for (const needle of ["📌 <b>Лот:</b>", "Бюджет: 12,4 млн ₸", "📍 <b>Город:</b> Алматы → Шымкент", "ИИ-аналитика", "TOS Индекс: <b>82/100</b> — 🟢 <b>ВЫГОДНО</b>",
    "Прогнозируемая чистая прибыль: <b>+2,1 млн ₸</b>", "Кассовый разрыв: 34 дн.", "Логистика: Фура 20 т · 185 тыс ₸", "Технические детали",
    "17342493-1", "Запрос ценовых предложений", "13.09.2026 — 24.09.2026", "techspec_17342493.pdf",
    'href="https://www.qazaqtenders.kz/tender/tenderplus-52490014"']) assert.ok(html.includes(needle), `missing: ${needle}`);
  assert.ok(html.includes("&lt;Dell&gt; &amp; мониторов"), "title must be escaped");
  assert.ok(!html.includes("javascript:"), "unsafe link must be dropped");
  assert.ok(html.indexOf("ИИ-аналитика") < html.indexOf("Технические детали"), "analytics block comes first");
});

test("Kazakh card renders and stays valid", () => {
  const html = renderTelegramCard(cardModel(input("kz")), "kz");
  assertTelegramHtml(html);
  assert.ok(html.includes("Мектептерге компьютер жеткізу") && html.includes("ТИІМДІ") && html.includes("Тапсырыс беруші"));
});

test("very long content is cut to Telegram's limit and stays valid", () => {
  const long = { ...input("ru"), spec: { ...spec, title: "Очень длинное название ".repeat(400), customer: "Заказчик ".repeat(300) } };
  assertTelegramHtml(renderTelegramCard(cardModel(long), "ru"));
});

test("cards are packed into as few ≤4096 messages as possible", () => {
  const card = renderTelegramCard(cardModel(input("ru")), "ru");
  const msgs = packMessages([digestHeader(8, "ru"), ...Array(8).fill(card)]);
  assert.ok(msgs.length >= 2 && msgs.length < 9);
  msgs.forEach(assertTelegramHtml);
});

test("email version carries the same two blocks", () => {
  const { subject, html } = renderEmail([cardModel(input("ru"))], "ru");
  assert.match(subject, /1 новых лотов/);
  assert.ok(html.includes("ИИ-аналитика") && html.includes("Технические детали") && html.includes("Открыть полный симулятор"));
  assert.ok(!html.includes("<Dell>"));
});
