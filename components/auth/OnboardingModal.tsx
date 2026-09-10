"use client";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { useProfile } from "@/lib/profile";
import { useI18n } from "@/lib/i18n";
import { CITIES } from "@/lib/logistics";
import type { CompanyProfile, TaxRegime } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "../ui/Button";
import { Field, inputCls, Modal } from "./Modal";
import { formatPhone, isValidBin, isValidTelegram, normalizePhone, normalizeTelegram } from "@/lib/validation";

type Draft = {
  name: string;
  bin: string;
  directorName: string;
  phone: string;
  telegramUsername: string;
  legalAddress: string;
  workingCapital: string;
  monthlyOpex: string;
  baseCityId: string;
  maxDistanceKm: string;
  staffSize: string;
  experienceYears: string;
  certificates: string;
  taxRegime: TaxRegime;
};

const toDraft = (c: CompanyProfile): Draft => ({
  name: c.name,
  bin: c.bin,
  directorName: c.directorName,
  phone: c.phone ? formatPhone(c.phone) : "",
  telegramUsername: c.telegramUsername,
  legalAddress: c.legalAddress,
  workingCapital: String(c.workingCapital),
  monthlyOpex: String(c.monthlyOpex),
  baseCityId: c.baseCityId,
  maxDistanceKm: String(c.maxDistanceKm),
  staffSize: String(c.staffSize),
  experienceYears: String(c.experienceYears),
  certificates: c.certificates.join(", "),
  taxRegime: c.taxRegime,
});

const num = (v: string) => Number(v.replace(/\s/g, ""));

/** Fields each step must validate before moving on. */
const STEP_FIELDS: (keyof Draft)[][] = [
  ["name", "bin", "directorName", "workingCapital", "monthlyOpex"],
  ["baseCityId", "maxDistanceKm"],
  ["staffSize", "experienceYears", "phone", "telegramUsername"],
  ["taxRegime"],
];

/** Multi-step Digital Twin form: Қаржы → Логистика → Команда → Салық. */
export function OnboardingModal() {
  const { t, lang } = useI18n();
  const { modal, openModal, company, saveProfile } = useProfile();
  const open = modal === "onboarding";
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Draft>(toDraft(company));
  const [errors, setErrors] = useState<Partial<Record<keyof Draft, boolean>>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setDraft(toDraft(company));
      setStep(0);
      setErrors({});
      setSaveError(null);
    }
  }, [open, company]);

  const set = (k: keyof Draft, v: string) => setDraft((d) => ({ ...d, [k]: v }));

  const validate = (s: number) => {
    const e: Partial<Record<keyof Draft, boolean>> = {};
    for (const k of STEP_FIELDS[s]) {
      const v = draft[k];
      if (k === "bin") e[k] = !isValidBin(String(v));
      else if (k === "phone") e[k] = !!String(v).trim() && !normalizePhone(String(v));
      else if (k === "telegramUsername") e[k] = !!String(v).trim() && !isValidTelegram(String(v));
      else if (k === "name" || k === "directorName" || k === "baseCityId" || k === "taxRegime") e[k] = !String(v).trim();
      else if (k === "experienceYears" || k === "monthlyOpex") e[k] = !(num(v) >= 0) || v.trim() === "";
      else e[k] = !(num(v) > 0);
    }
    setErrors(e);
    return !Object.values(e).some(Boolean);
  };

  const next = async () => {
    if (!validate(step)) return;
    if (step < 3) return setStep(step + 1);
    setSaving(true);
    const r = await saveProfile({
      ...company,
      name: draft.name.trim(),
      bin: draft.bin.trim(),
      directorName: draft.directorName.trim(),
      phone: normalizePhone(draft.phone) ?? "",
      telegramUsername: normalizeTelegram(draft.telegramUsername),
      legalAddress: draft.legalAddress.trim(),
      workingCapital: num(draft.workingCapital),
      monthlyOpex: num(draft.monthlyOpex),
      baseCityId: draft.baseCityId,
      maxDistanceKm: num(draft.maxDistanceKm),
      staffSize: num(draft.staffSize),
      experienceYears: num(draft.experienceYears),
      certificates: draft.certificates.split(",").map((s) => s.trim()).filter(Boolean),
      taxRegime: draft.taxRegime,
    });
    setSaving(false);
    if (r.error) setSaveError(r.error);
    else openModal(null);
  };

  const err = (k: keyof Draft) => (errors[k] ? t.onb.required : undefined);

  return (
    <Modal open={open} onClose={() => openModal(null)} title={t.onb.title} subtitle={t.onb.subtitle} width="max-w-lg">
      {/* Stepper */}
      <ol className="mb-7 flex items-center gap-2">
        {t.onb.steps.map((label, i) => (
          <li key={label} className="flex flex-1 flex-col gap-2">
            <div className={cn("h-1 rounded-full transition-colors", i <= step ? "bg-accent-blue" : "bg-white/10")} />
            <span className={cn("flex items-center gap-1 text-xs", i === step ? "font-semibold text-white" : i < step ? "text-blue-300" : "text-slate-500")}>
              {i < step && <Check className="h-3 w-3" />}
              {label}
            </span>
          </li>
        ))}
      </ol>

              <motion.div
          key={step}
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.2 }}
          className="space-y-4"
        >
          {step === 0 && (
            <>
              <Field label={t.onb.name} error={err("name")}>
                <input className={inputCls} value={draft.name} onChange={(e) => set("name", e.target.value)} />
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label={lang === "kz" ? "БСН (12 цифр)" : "БИН (12 цифр)"} error={errors.bin ? (lang === "kz" ? "12 цифр, бақылау саны дұрыс болуы керек" : "12 цифр с верной контрольной цифрой") : undefined}>
                  <input className={inputCls} inputMode="numeric" maxLength={12} value={draft.bin} onChange={(e) => set("bin", e.target.value.replace(/\D/g, ""))} />
                </Field>
                <Field label={lang === "kz" ? "Басшының аты-жөні" : "ФИО руководителя"} error={err("directorName")}>
                  <input className={inputCls} value={draft.directorName} onChange={(e) => set("directorName", e.target.value)} />
                </Field>
              </div>
              <Field label={t.onb.capital} hint={t.onb.capitalHint} error={err("workingCapital")}>
                <input className={inputCls} inputMode="numeric" value={draft.workingCapital} onChange={(e) => set("workingCapital", e.target.value)} />
              </Field>
              <Field label={t.onb.opex} hint={t.onb.opexHint} error={err("monthlyOpex")}>
                <input className={inputCls} inputMode="numeric" value={draft.monthlyOpex} onChange={(e) => set("monthlyOpex", e.target.value)} />
              </Field>
            </>
          )}
          {step === 1 && (
            <>
              <Field label={t.onb.city} error={err("baseCityId")}>
                <select className={inputCls} value={draft.baseCityId} onChange={(e) => set("baseCityId", e.target.value)}>
                  {CITIES.map((c) => (
                    <option key={c.id} value={c.id} className="bg-ink-800">
                      {c[lang]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t.onb.radius} hint={t.onb.radiusHint} error={err("maxDistanceKm")}>
                <input className={inputCls} inputMode="numeric" value={draft.maxDistanceKm} onChange={(e) => set("maxDistanceKm", e.target.value)} />
              </Field>
            </>
          )}
          {step === 2 && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <Field label={t.onb.staff} error={err("staffSize")}>
                  <input className={inputCls} inputMode="numeric" value={draft.staffSize} onChange={(e) => set("staffSize", e.target.value)} />
                </Field>
                <Field label={t.onb.experience} error={err("experienceYears")}>
                  <input className={inputCls} inputMode="numeric" value={draft.experienceYears} onChange={(e) => set("experienceYears", e.target.value)} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Field label={lang === "kz" ? "Телефон" : "Телефон"} error={errors.phone ? "+7 (7XX) XXX-XX-XX" : undefined}>
                  <input className={inputCls} type="tel" value={draft.phone} onChange={(e) => set("phone", formatPhone(e.target.value))} />
                </Field>
                <Field label="Telegram" error={errors.telegramUsername ? "@username" : undefined}>
                  <input className={inputCls} placeholder="@username" value={draft.telegramUsername} onChange={(e) => set("telegramUsername", e.target.value)} />
                </Field>
              </div>
              <Field label={lang === "kz" ? "Заңды мекенжай" : "Юридический адрес"}>
                <input className={inputCls} value={draft.legalAddress} onChange={(e) => set("legalAddress", e.target.value)} />
              </Field>
              <Field label={t.onb.certs} hint={t.onb.certsHint}>
                <input className={inputCls} value={draft.certificates} onChange={(e) => set("certificates", e.target.value)} />
              </Field>
            </>
          )}
          {step === 3 && (
            <fieldset className="space-y-3">
              <legend className="mb-1 text-sm font-medium text-slate-200">{t.onb.regime}</legend>
              {((company.taxRegime === "general" ? ["simplified", "vat", "general"] : ["simplified", "vat"]) as TaxRegime[]).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => set("taxRegime", r)}
                  aria-pressed={draft.taxRegime === r}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-xl border p-4 text-left transition-colors",
                    draft.taxRegime === r ? "border-blue-400/60 bg-blue-500/10" : "border-white/10 bg-white/[0.03] hover:border-white/20"
                  )}
                >
                  <span className={cn("grid h-5 w-5 shrink-0 place-items-center rounded-full border-2", draft.taxRegime === r ? "border-blue-400" : "border-white/30")}>
                    {draft.taxRegime === r && <span className="h-2.5 w-2.5 rounded-full bg-blue-400" />}
                  </span>
                  <span>
                    <span className="block text-sm font-semibold text-white">{t.onb.regimes[r].title}</span>
                    <span className="block text-xs text-slate-400">{t.onb.regimes[r].desc}</span>
                  </span>
                </button>
              ))}
            </fieldset>
          )}
        </motion.div>

      {saveError && <p className="mt-4 rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{saveError}</p>}

      <div className="mt-7 flex items-center justify-between gap-3">
        <Button variant="ghost" onClick={() => setStep(step - 1)} className={cn(step === 0 && "invisible")}>
          {t.onb.back}
        </Button>
        <span className="text-xs text-slate-500">
          {t.onb.step} {step + 1}/4
        </span>
        <Button onClick={next} disabled={saving} className="disabled:opacity-60">
          {saving ? t.onb.saving : step < 3 ? t.onb.next : t.onb.finish}
        </Button>
      </div>
    </Modal>
  );
}
