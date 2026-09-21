"use client";

import { useMemo, useRef, useState } from "react";
import { MapPinned, X } from "lucide-react";
import { KZ_CITY_MARKERS, KZ_MAP_VIEWBOX, KZ_REGIONS, type KzRegion } from "@/lib/kz-map";
import { cn } from "@/lib/utils";

type Tr = (m: { kz: string; ru: string }) => string;

/** Region id that owns a lot's city (lib/logistics city id). */
export function regionOfCity(cityId: string): string | undefined {
  return KZ_REGIONS.find((r) => r.cities.includes(cityId))?.id;
}

/**
 * Interactive map of Kazakhstan: regional borders, hover glow, tooltip with the number of
 * active tenders, click to filter the list. Works in the beige light theme and the dark theme.
 */
export function KazakhstanMap({
  counts,
  selected,
  onSelect,
  lang,
  tr,
}: {
  /** Tenders per city id */
  counts: Record<string, number>;
  /** Selected region id or "all" */
  selected: string;
  onSelect: (regionId: string) => void;
  lang: "kz" | "ru";
  tr: Tr;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ region: KzRegion; x: number; y: number } | null>(null);

  const regionCount = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of KZ_REGIONS) m[r.id] = r.cities.reduce((s, c) => s + (counts[c] ?? 0), 0);
    return m;
  }, [counts]);
  const max = Math.max(1, ...Object.values(regionCount));
  const total = Object.values(regionCount).reduce((a, b) => a + b, 0);
  const name = (r: KzRegion) => (lang === "kz" ? r.kz : r.ru);

  const track = (r: KzRegion, e: React.MouseEvent) => {
    const rect = box.current?.getBoundingClientRect();
    if (rect) setHover({ region: r, x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  const cityRegion: Record<string, string> = { astana: "astana_c", almaty: "almaty_c", shymkent: "turkistan" };

  return (
    <section className="mt-10 rounded-2xl border border-[#E5E0D8] bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#13222A]/80 dark:shadow-none">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-[#292524] dark:text-white">
            <MapPinned className="h-4 w-4 text-[#07575B] dark:text-[#2DD4BF]" /> {tr({ kz: "Қазақстандағы тендерлер", ru: "Тендеры по Казахстану" })}
          </div>
          <p className="mt-1 text-xs text-[#78716C] dark:text-slate-400">
            {tr({ kz: "Облысты басыңыз — тізім сүзіледі", ru: "Нажмите на область — список отфильтруется" })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {selected !== "all" && (
            <button
              onClick={() => onSelect("all")}
              className="inline-flex items-center gap-1 rounded-full border border-[#D6CFC4] px-2.5 py-1 text-xs text-[#44403C] transition-all duration-300 hover:border-[#07575B] dark:border-white/15 dark:text-slate-200 dark:hover:border-[#2DD4BF]"
            >
              <X className="h-3 w-3" /> {tr({ kz: "Барлық облыстар", ru: "Все регионы" })}
            </button>
          )}
          <span className="rounded-full bg-[#07575B]/10 px-2.5 py-1 text-xs font-medium text-[#07575B] dark:bg-white/10 dark:text-[#C4DFE6]">
            {total} {tr({ kz: "тендер", ru: "тендеров" })}
          </span>
        </div>
      </div>

      <div ref={box} className="relative overflow-hidden rounded-xl border border-[#E5E0D8] bg-[#F8F6F1] p-3 dark:border-white/10 dark:bg-[#0B1319]" onMouseLeave={() => setHover(null)}>
        <svg viewBox={KZ_MAP_VIEWBOX} className="h-auto w-full" role="img" aria-label={tr({ kz: "Қазақстан картасы", ru: "Карта Казахстана" })}>
          <defs>
            <filter id="kz-glow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="0" stdDeviation="6" floodColor="#2DD4BF" floodOpacity="0.55" />
            </filter>
          </defs>
          {KZ_REGIONS.map((r) => {
            const n = regionCount[r.id] ?? 0;
            const active = selected === r.id;
            const hovered = hover?.region.id === r.id;
            const intensity = n ? 0.12 + (n / max) * 0.38 : 0.04;
            return (
              <path
                key={r.id}
                d={r.d}
                role="button"
                tabIndex={0}
                aria-label={`${name(r)}: ${n}`}
                aria-pressed={active}
                onMouseMove={(e) => track(r, e)}
                onClick={() => onSelect(active ? "all" : r.id)}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onSelect(active ? "all" : r.id))}
                filter={hovered || active ? "url(#kz-glow)" : undefined}
                className={cn(
                  "cursor-pointer outline-none transition-all duration-300 [stroke-linejoin:round]",
                  active || hovered
                    ? "fill-[#2DD4BF]/70 stroke-[#07575B] dark:fill-[#2DD4BF]/60 dark:stroke-[#C4DFE6]"
                    : "fill-[#07575B] stroke-white dark:fill-[#66A5AD] dark:stroke-[#0B1319]"
                )}
                style={active || hovered ? { strokeWidth: 1.6 } : { fillOpacity: intensity, strokeWidth: 1.1 }}
              />
            );
          })}
          {Object.entries(KZ_CITY_MARKERS).map(([id, p]) => {
            const r = KZ_REGIONS.find((x) => x.id === cityRegion[id]);
            if (!r) return null;
            return (
              <g key={id} className="cursor-pointer" onMouseMove={(e) => track(r, e)} onClick={() => onSelect(selected === r.id ? "all" : r.id)}>
                <circle cx={p.x} cy={p.y} r={9} className="fill-[#07575B]/15 dark:fill-[#2DD4BF]/15" />
                <circle cx={p.x} cy={p.y} r={4.5} className="fill-[#07575B] stroke-white dark:fill-[#2DD4BF] dark:stroke-[#0B1319]" strokeWidth={1.5} />
              </g>
            );
          })}
        </svg>

        {hover && (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-[calc(100%+12px)] whitespace-nowrap rounded-lg border border-[#E5E0D8] bg-white px-3 py-2 text-xs shadow-lg transition-opacity duration-150 dark:border-white/10 dark:bg-[#13222A]"
            style={{ left: hover.x, top: hover.y }}
          >
            <p className="font-semibold text-[#292524] dark:text-white">{name(hover.region)}</p>
            <p className="mt-0.5 font-mono text-[#07575B] dark:text-[#2DD4BF]">
              {regionCount[hover.region.id] ?? 0} {tr({ kz: "тендер", ru: "тендеров" })}
            </p>
          </div>
        )}
      </div>
      <p className="mt-2 text-[10px] text-[#A8A29E] dark:text-slate-600">Boundaries: geoBoundaries (CC BY 4.0)</p>
    </section>
  );
}
