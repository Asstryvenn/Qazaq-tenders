"use client";

import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, CheckCircle2, Eye, EyeOff, Loader2, Rocket, XCircle } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useProfile } from "@/lib/profile";
import { useNotifications } from "@/lib/notifications";
import { CITIES } from "@/lib/logistics";
import { DEMO_COMPANY } from "@/lib/mock-data";
import { estimateOpex } from "@/lib/profile-row";
import { binState, formatPhone, isValidEmail, isValidTelegram, normalizePhone, normalizeTelegram } from "@/lib/validation";
import type { CompanyProfile, TaxRegime } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "../ui/Button";
import { Field, inputCls } from "./Modal";

type Form = {
  email: string;
  password: string;
  phone: string;
  telegram: string;
  bin: string;
  name: string;
  directorName: string;
  legalAddress: string;
  capital: string;
  cityId: string;
  radius: string;
  regime: TaxRegime;
  staff: string;
  experience: string;
};

const INITIAL: Form = {
  email: "",
  password: "",
  phone: "",
  telegram: "",
  bin: "",
  name: "",
  directorName: "",
  legalAddress: "",
  capital: "",
  cityId: "astana",
  radius: "900",
  regime: "simplified",
  staff: "",
  experience: "",
};

const num = (v: string) => Number(v.replace(/\s/g, ""));

/** Account → Legal entity → Digital twin. Ends on the dashboard, never on "check your email". */
export function RegisterWizard() {
  const { tr, t, lang } = useI18n();
  const { register, openModal } = useProfile();
  const { toast } = useNotifications();
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [f, setF] = useState<Form>(INITIAL);
  const [touched, setTouched] = useState<Partial<Record<keyof Form, boolean>>>({});
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const set = (k: keyof Form, v: string) => setF((x) => ({ ...x, [k]: v }));
  const touch = (k: keyof Form) => setTouched((x) => ({ ...x, [k]: true }));

  const errors: Partial<Record<keyof Form, string>> = {
    email: isValidEmail(f.email) ? undefined : tr({ kz: "Дұрыс email енгізіңіз", ru: "Введите корректный email" }),
    password: f.password.length >= 6 ? undefined : tr({ kz: "Кемінде 6 таңба", ru: "Минимум 6 символов" }),
    phone: normalizePhone(f.phone) ? undefined : tr({ kz: "+7 (7XX) XXX-XX-XX форматы", ru: "Формат +7 (7XX) XXX-XX-XX" }),
    telegram: !f.telegram || isValidTelegram(f.telegram) ? undefined : tr({ kz: "5–32 таңба: әріп, сан, _", ru: "5–32 символа: буквы, цифры, _" }),
    bin: binState(f.bin) === "valid" ? undefined : binState(f.bin) === "invalid" ? tr({ kz: "Бақылау саны сәйкес емес", ru: "Не сходится контрольная цифра" }) : tr({ kz: "12 цифр", ru: "12 цифр" }),
    name: f.name.trim().length >= 2 ? undefined : tr({ kz: "Компания атауын енгізіңіз", ru: "Введите название компании" }),
    legalAddress: f.legalAddress.trim().length >= 5 ? undefined : tr({ kz: "Заңды мекенжайды енгізіңіз", ru: "Введите юридический адрес" }),
    capital: num(f.capital) > 0 ? undefined : tr({ kz: "Сомасы 0-ден көп болуы керек", ru: "Сумма должна быть больше 0" }),
    radius: num(f.radius) > 0 ? undefined : tr({ kz: "Км санын енгізіңіз", ru: "Укажите км" }),
    staff: num(f.staff) > 0 ? undefined : tr({ kz: "Кемінде 1 адам", ru: "Минимум 1 человек" }),
    experience: f.experience.trim() !== "" && num(f.experience) >= 0 ? undefined : tr({ kz: "Жыл санын енгізіңіз", ru: "Укажите число лет" }),
  };

  const STEPS: (keyof Form)[][] = [
    ["email", "password", "phone", "telegram"],
    ["bin", "name", "legalAddress"],
    ["capital", "cityId", "radius", "regime", "staff", "experience"],
  ];
  const stepValid = (s: number) => STEPS[s].every((k) => !errors[k]);
  const show = (k: keyof Form) => (touched[k] ? errors[k] : undefined);

  const next = async () => {
    setTouched((x) => ({ ...x, ...Object.fromEntries(STEPS[step].map((k) => [k, true])) }));
    if (!stepValid(step)) return;
    if (step < 2) return setStep(step + 1);

    setBusy(true);
    setServerError(null);
    const profile: CompanyProfile = {
      ...DEMO_COMPANY,
      name: f.name.trim(),
      bin: f.bin,
      directorName: f.directorName.trim(),
      legalAddress: f.legalAddress.trim(),
      phone: normalizePhone(f.phone)!,
      telegramUsername: normalizeTelegram(f.telegram),
      workingCapital: num(f.capital),
      baseCityId: f.cityId,
      maxDistanceKm: num(f.radius),
      taxRegime: f.regime,
      staffSize: num(f.staff),
      experienceYears: num(f.experience),
      monthlyOpex: estimateOpex(num(f.staff)),
      certificates: [],
    };
    const r = await register(f.email.trim(), f.password, profile);
    setBusy(false);

    if (r.error) {
      setServerError(
        r.error === "email-taken" || /already/i.test(r.error)
          ? tr({ kz: "Бұл email тіркелген. «Кіру» арқылы кіріңіз.", ru: "Этот email уже зарегистрирован. Войдите." })
          : r.error
      );
      return;
    }
    openModal(null);
    router.push("/dashboard");
    toast({
      kind: "success",
      title: tr({ kz: "Қозғалтқыш іске қосылды", ru: "Движок запущен" }),
      body:
        r.mode === "pending"
          ? tr({
              kz: "TOS сіздің профиліңіз бойынша есептелді. Поштаңызды растағаннан кейін профиль бұлтқа сақталады.",
              ru: "TOS пересчитан под ваш профиль. После подтверждения почты профиль сохранится в облаке.",
            })
          : tr({ kz: "Барлық TOS сіздің цифрлық егізіңіз бойынша қайта есептелді.", ru: "Все TOS пересчитаны под ваш цифровой двойник." }),
    });
  };

  const titles = [
    tr({ kz: "Аккаунт және байланыс", ru: "Аккаунт и контакты" }),
    tr({ kz: "Заңды тұлға", ru: "Юридическое лицо" }),
    tr({ kz: "Цифрлық егіз", ru: "Цифровой двойник" }),
  ];
  const bin = binState(f.bin);

  return (
    <div>
      <ol className="mb-7 flex items-center gap-2">
        {titles.map((label, i) => (
          <li key={label} className="flex flex-1 flex-col gap-2">
            <div className={cn("h-1 rounded-full transition-colors", i <= step ? "bg-accent-blue" : "bg-white/10")} />
            <span className={cn("flex items-center gap-1 text-xs", i === step ? "font-semibold text-white" : i < step ? "text-blue-300" : "text-slate-500")}>
              {i < step && <Check className="h-3 w-3" />}
              {i + 1}. {label}
            </span>
          </li>
        ))}
      </ol>

      <motion.div key={step} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.18 }} className="space-y-4">
          {step === 0 && (
            <>
              <Field label="Email" error={show("email")}>
                <input type="email" autoComplete="email" className={inputCls} value={f.email} onChange={(e) => set("email", e.target.value)} onBlur={() => touch("email")} />
              </Field>
              <Field label={t.auth.password} error={show("password")} hint={t.auth.passwordHint}>
                <div className="relative">
                  <input
                    type={showPw ? "text" : "password"}
                    autoComplete="new-password"
                    className={cn(inputCls, "pr-10")}
                    value={f.password}
                    onChange={(e) => set("password", e.target.value)}
                    onBlur={() => touch("password")}
                  />
                  <button type="button" onClick={() => setShowPw((v) => !v)} aria-label="toggle password" className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-white">
                    {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={tr({ kz: "Байланыс телефоны", ru: "Контактный телефон" })} error={show("phone")}>
                  <input
                    type="tel"
                    autoComplete="tel"
                    placeholder="+7 (7XX) XXX-XX-XX"
                    className={inputCls}
                    value={f.phone}
                    onChange={(e) => set("phone", formatPhone(e.target.value))}
                    onBlur={() => touch("phone")}
                  />
                </Field>
                <Field label={tr({ kz: "Telegram (міндетті емес)", ru: "Telegram (необязательно)" })} error={show("telegram")}>
                  <input placeholder="@username" className={inputCls} value={f.telegram} onChange={(e) => set("telegram", e.target.value)} onBlur={() => touch("telegram")} />
                </Field>
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <Field label={tr({ kz: "БСН / ЖСН", ru: "БИН / ИИН" })} error={show("bin")}>
                <div className="relative">
                  <input
                    inputMode="numeric"
                    maxLength={12}
                    placeholder="000000000000"
                    className={cn(inputCls, "pr-10 font-mono tracking-wider", bin === "valid" && "border-emerald-400/60", bin === "invalid" && "border-rose-400/60")}
                    value={f.bin}
                    onChange={(e) => set("bin", e.target.value.replace(/\D/g, "").slice(0, 12))}
                    onBlur={() => touch("bin")}
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2">
                    {bin === "valid" && <CheckCircle2 className="h-4 w-4 text-emerald-400" />}
                    {bin === "invalid" && <XCircle className="h-4 w-4 text-rose-400" />}
                    {bin === "partial" && <span className="font-mono text-[11px] text-slate-500">{f.bin.length}/12</span>}
                  </span>
                </div>
              </Field>
              <Field label={t.onb.name} error={show("name")}>
                <input placeholder='ТОО "Алтын Логистик"' className={inputCls} value={f.name} onChange={(e) => set("name", e.target.value)} onBlur={() => touch("name")} />
              </Field>
              <Field label={tr({ kz: "Заңды мекенжай", ru: "Юридический адрес" })} error={show("legalAddress")}>
                <input
                  placeholder={tr({ kz: "Астана, Есіл ауданы, ...", ru: "Астана, район Есиль, ..." })}
                  className={inputCls}
                  value={f.legalAddress}
                  onChange={(e) => set("legalAddress", e.target.value)}
                  onBlur={() => touch("legalAddress")}
                />
              </Field>
              <Field label={tr({ kz: "Басшының аты-жөні (кепілдік хат үшін)", ru: "ФИО руководителя (для гарантийного письма)" })}>
                <input className={inputCls} value={f.directorName} onChange={(e) => set("directorName", e.target.value)} />
              </Field>
            </>
          )}

          {step === 2 && (
            <>
              <Field label={t.onb.capital} hint={t.onb.capitalHint} error={show("capital")}>
                <input inputMode="numeric" placeholder="50000000" className={inputCls} value={f.capital} onChange={(e) => set("capital", e.target.value.replace(/[^\d\s]/g, ""))} onBlur={() => touch("capital")} />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t.onb.city}>
                  <select className={inputCls} value={f.cityId} onChange={(e) => set("cityId", e.target.value)}>
                    {CITIES.map((c) => (
                      <option key={c.id} value={c.id} className="bg-ink-800">
                        {c[lang]}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={tr({ kz: "Жеткізу радиусы, км", ru: "Радиус доставки, км" })} error={show("radius")}>
                  <input inputMode="numeric" className={inputCls} value={f.radius} onChange={(e) => set("radius", e.target.value.replace(/\D/g, ""))} onBlur={() => touch("radius")} />
                </Field>
              </div>
              <div>
                <p className="mb-1.5 text-sm font-medium text-slate-200">{t.onb.regime}</p>
                <div role="radiogroup" className="grid grid-cols-2 gap-2 rounded-xl border border-white/10 bg-black/20 p-1">
                  {(["simplified", "vat"] as TaxRegime[]).map((r) => (
                    <button
                      key={r}
                      type="button"
                      role="radio"
                      aria-checked={f.regime === r}
                      onClick={() => set("regime", r)}
                      className={cn("rounded-lg px-3 py-2.5 text-left transition-colors", f.regime === r ? "bg-accent-blue text-white shadow-glow" : "text-slate-300 hover:bg-white/5")}
                    >
                      <span className="block text-sm font-semibold">{t.onb.regimes[r].title}</span>
                      <span className={cn("block text-[11px]", f.regime === r ? "text-blue-100" : "text-slate-500")}>{t.onb.regimes[r].desc}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Field label={t.onb.staff} error={show("staff")}>
                  <input inputMode="numeric" className={inputCls} value={f.staff} onChange={(e) => set("staff", e.target.value.replace(/\D/g, ""))} onBlur={() => touch("staff")} />
                </Field>
                <Field label={t.onb.experience} error={show("experience")}>
                  <input inputMode="numeric" className={inputCls} value={f.experience} onChange={(e) => set("experience", e.target.value.replace(/\D/g, ""))} onBlur={() => touch("experience")} />
                </Field>
              </div>
            </>
          )}
        </motion.div>

      {serverError && <p className="mt-4 rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{serverError}</p>}

      <div className="mt-7 flex items-center justify-between gap-3">
        {step === 0 ? (
          <button type="button" onClick={() => openModal("login")} className="text-sm text-blue-300 hover:text-blue-200">
            {t.auth.toLogin}
          </button>
        ) : (
          <Button variant="ghost" onClick={() => setStep(step - 1)} disabled={busy}>
            {t.onb.back}
          </Button>
        )}
        <Button onClick={next} disabled={busy} className="disabled:opacity-60">
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : step < 2 ? (
            t.onb.next
          ) : (
            <>
              <Rocket className="h-4 w-4" /> {tr({ kz: "Тіркелу және Движокты іске қосу", ru: "Зарегистрироваться и запустить движок" })}
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
