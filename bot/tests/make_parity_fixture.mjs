// Эталоны для tests/test_calculator.py: считает те же лоты TypeScript-движком сайта (lib/engine.ts).
// Запуск из корня репозитория:  node bot/tests/make_parity_fixture.mjs
import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const out = mkdtempSync(join(tmpdir(), "qt-engine-"));

try {
  execSync(`npx tsc lib/engine.ts --outDir ${out} --module commonjs --target es2020 --skipLibCheck --esModuleInterop`, {
    cwd: root,
    stdio: "pipe",
  });
} catch {
  // tsc без tsconfig ругается на алиасы путей в type-only импортах, но JS всё равно выпускает
}
const require = createRequire(import.meta.url);
const { analyzeTender } = require(join(out, "engine.js"));

const lots = JSON.parse(readFileSync(join(root, "bot", "data", "sample_tenders.json"), "utf8")).tenders;

const twins = {
  demo: {
    name: "demo", workingCapital: 52_000_000, maxDistanceKm: 900, staffSize: 24, baseCityId: "almaty", taxRegime: "vat",
    monthlyOpex: 4_200_000, opexAllocation: 0.35, creditRate: 0.24, experienceYears: 4, certificates: ["ISO 9001", "СТ РК"],
  },
  small: {
    name: "small", workingCapital: 10_000_000, maxDistanceKm: 1500, staffSize: 5, baseCityId: "astana", taxRegime: "simplified",
    monthlyOpex: 800_000, opexAllocation: 0.35, creditRate: 0.24, experienceYears: 1, certificates: [],
  },
  general: {
    name: "general", workingCapital: 150_000_000, maxDistanceKm: 2500, staffSize: 60, baseCityId: "karaganda", taxRegime: "general",
    monthlyOpex: 9_000_000, opexAllocation: 0.2, creditRate: 0.18, experienceYears: 10, certificates: ["ISO 9001"],
  },
  // Distributor: 50% supplier prepayment, the rest on delivery
  reseller: {
    name: "reseller", workingCapital: 25_000_000, maxDistanceKm: 1500, staffSize: 8, baseCityId: "almaty", taxRegime: "vat",
    monthlyOpex: 1_800_000, opexAllocation: 0.35, creditRate: 0.24, experienceYears: 3, certificates: ["ISO 9001"], supplierPrepayPct: 50,
  },
  // Listed in the register of unscrupulous participants (РНУ)
  blacklisted: {
    name: "blacklisted", workingCapital: 52_000_000, maxDistanceKm: 900, staffSize: 24, baseCityId: "almaty", taxRegime: "vat",
    monthlyOpex: 4_200_000, opexAllocation: 0.35, creditRate: 0.24, experienceYears: 4, certificates: ["ISO 9001", "СТ РК"], rnuListed: true,
  },
};

const neutral = { fuelDeltaPct: 0, transportDeltaPct: 0, supplierDeltaPct: 0, paymentDelayDelta: 0, lateDays: 0, deliveryDeltaDays: 0 };
const scenarios = {
  neutral,
  fuel15: { ...neutral, fuelDeltaPct: 15 },
  supplier10: { ...neutral, supplierDeltaPct: 10 },
  pay30: { ...neutral, paymentDelayDelta: 30 },
  all3: { ...neutral, fuelDeltaPct: 15, supplierDeltaPct: 10, paymentDelayDelta: 30 },
  late7: { ...neutral, lateDays: 7 },
  extend_transport: { ...neutral, deliveryDeltaDays: 10, transportDeltaPct: 20 },
};

const cases = [];
for (const lot of lots)
  for (const [twinName, twin] of Object.entries(twins))
    for (const [scName, sc] of Object.entries(scenarios)) {
      const r = analyzeTender(lot, twin, sc);
      cases.push({
        lot: lot.id,
        twin: twinName,
        scenario: scName,
        expect: {
          tos: r.tos, netProfit: r.netProfit, marginPct: r.marginPct, cashFlowGap: r.cashFlowGap, gapDay: r.gapDay,
          maxDeficit: r.maxDeficit, distanceKm: r.distanceKm, trucks: r.trucks, legalRisk: r.legalRisk,
          cashFlowRisk: r.cashFlowRisk, verdict: r.verdict, costs: r.costs, payDay: r.payDay, deliveryDay: r.deliveryDay,
          minBalance: Math.min(...r.timeline.map((p) => p.balance)), reasons: r.reasons.map((x) => x.code),
        },
      });
    }

mkdirSync(join(here, "fixtures"), { recursive: true });
writeFileSync(join(here, "fixtures", "ts_parity.json"), JSON.stringify({ twins, scenarios, cases }, null, 1));
console.log(`wrote ${cases.length} cases`);
