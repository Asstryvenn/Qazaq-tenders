"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, Eye, EyeOff, Loader2, Package } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useProfile } from "@/lib/profile";
import { useNotifications } from "@/lib/notifications";
import { CITIES } from "@/lib/logistics";
import { postRegisterPath } from "@/lib/account";
import { binState, formatPhone, isValidEmail, normalizePhone } from "@/lib/validation";
import { cn } from "@/lib/utils";
import { Button } from "../ui/Button";
import { Field, inputCls } from "./Modal";

type Form = { name: string; email: string; password: string; city: string; contactEmail: string; contactPhone: string; bin: string; publish: boolean };
const INITIAL: Form = { name: "", email: "", password: "", city: "", contactEmail: "", contactPhone: "", bin: "", publish: false };

/** Короткая регистрация поставщика: без цифрового двойника и финансовых полей. */
export function SupplierRegisterForm({ onBack }: { onBack: () => void }) {
  const { tr, t, lang } = useI18n();
  const { registerSupplier, openModal } = useProfile();
  const { toast } = useNotifications();
  const router = useRouter();
  const [f, setF] = useState<Form>(INITIAL);
  const [touched, setTouched] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));

  const contactEmail = f.contactEmail.trim() || f.email.trim();
  const errors: Partial<Record<keyof Form, string>> = {
    name: f.name.trim().length >= 2 ? undefined : tr({ kz: "Атауын енгізіңіз", ru: "Введите имя или название компании" }),
    email: isValidEmail(f.email) ? undefined : tr({ kz: "Дұрыс email енгізіңіз", ru: "Введите корректный email" }),
    password: f.password.length >= 6 ? undefined : tr({ kz: "Кемінде 6 таңба", ru: "Минимум 6 символов" }),
    city: f.city.trim().length >= 2 ? undefined : tr({ kz: "Қаланы көрсетіңіз", ru: "Укажите город" }),
    contactEmail: !f.contactEmail.trim() || isValidEmail(f.contactEmail) ? undefined : tr({ kz: "Дұрыс email енгізіңіз", ru: "Введите корректный email" }),
    contactPhone: !f.contactPhone.trim() || normalizePhone(f.contactPhone) ? undefined : tr({ kz: "+7 (7XX) XXX-XX-XX форматы", ru: "Формат +7 (7XX) XXX-XX-XX" }),
    bin: !f.bin || binState(f.bin) === "valid" ? undefined : tr({ kz: "12 цифр, бақылау саны сәйкес болуы керек", ru: "12 цифр с верной контрольной цифрой" }),
  };
  const show = (k: keyof Form) => (touched ? errors[k] : undefined);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (Object.values(errors).some(Boolean)) return;
    setBusy(true);
    setServerError(null);
    const r = await registerSupplier({
      email: f.email.trim(),
      password: f.password,
      name: f.name.trim(),
      city: f.city.trim(),
      contactEmail,
      contactPhone: f.contactPhone ? normalizePhone(f.contactPhone) ?? "" : "",
      bin: f.bin,
      publish: f.publish,
    });
    setBusy(false);
    if (r.error) {
      setServerError(
        r.error === "email-taken" || /already/i.test(r.error)
          ? tr({ kz: "Бұл email тіркелген. «Кіру» арқылы кіріңіз.", ru: "Этот email уже зарегистрирован. Войдите." })
          : r.error === "supplier-profile-unavailable"
            ? tr({ kz: "Жеткізуші профилі әзірге қолжетімсіз. Кейінірек қайталаңыз.", ru: "Профиль поставщика сейчас недоступен. Попробуйте позже." })
            : r.error
      );
      return;
    }
    openModal(null);
    if (r.mode === "pending") {
      toast({
        kind: "info",
        title: tr({ kz: "Поштаны растаңыз", ru: "Подтвердите почту" }),
        body: tr({ kz: "Растағаннан кейін кіріңіз — жеткізуші профилі автоматты түрде жасалады.", ru: "После подтверждения войдите — профиль поставщика создастся автоматически." }),
      });
      return;
    }
    router.push(postRegisterPath("supplier"));
    toast({
      kind: "success",
      title: tr({ kz: "Жеткізуші кабинеті дайын", ru: "Кабинет поставщика готов" }),
      body: tr({ kz: "Прайсты жүктеңіз немесе автоматты жаңартуды қосыңыз.", ru: "Загрузите прайс или подключите автоматическое обновление." }),
    });
  };

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <p className="flex items-center gap-2 text-sm font-semibold text-white">
        <Package className="h-4 w-4 text-blue-300" /> {tr({ kz: "Тауар жеткіземін", ru: "Поставляю товары" })}
      </p>
      <Field label={tr({ kz: "Аты немесе компания атауы", ru: "Имя / название компании" })} error={show("name")}>
        <input className={inputCls} autoComplete="organization" value={f.name} onChange={(e) => set("name", e.target.value)} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={tr({ kz: "Кіру үшін email", ru: "Email для входа" })} error={show("email")}>
          <input type="email" autoComplete="email" className={inputCls} value={f.email} onChange={(e) => set("email", e.target.value)} />
        </Field>
        <Field label={t.auth.password} error={show("password")}>
          <div className="relative">
            <input type={showPw ? "text" : "password"} autoComplete="new-password" className={cn(inputCls, "pr-10")} value={f.password} onChange={(e) => set("password", e.target.value)} />
            <button type="button" onClick={() => setShowPw((v) => !v)} aria-label={tr({ kz: "Құпиясөзді көрсету немесе жасыру", ru: "Показать или скрыть пароль" })} className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-white">
              {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </Field>
      </div>
      <Field label={tr({ kz: "Қала", ru: "Город" })} error={show("city")}>
        <input list="supplier-cities" className={inputCls} value={f.city} onChange={(e) => set("city", e.target.value)} />
        <datalist id="supplier-cities">
          {CITIES.map((c) => (
            <option key={c.id} value={c[lang]} />
          ))}
        </datalist>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={tr({ kz: "Сатып алушыларға арналған email", ru: "Email для покупателей" })}
          hint={tr({ kz: "Бос болса — кіру email-і", ru: "Если пусто — email для входа" })}
          error={show("contactEmail")}
        >
          <input type="email" className={inputCls} value={f.contactEmail} onChange={(e) => set("contactEmail", e.target.value)} />
        </Field>
        <Field label={tr({ kz: "Телефон (міндетті емес)", ru: "Телефон (необязательно)" })} error={show("contactPhone")}>
          <input type="tel" placeholder="+7 (7XX) XXX-XX-XX" className={inputCls} value={f.contactPhone} onChange={(e) => set("contactPhone", formatPhone(e.target.value))} />
        </Field>
      </div>
      <Field
        label={tr({ kz: "БСН / ЖСН (міндетті емес)", ru: "БИН / ИИН (необязательно)" })}
        hint={tr({ kz: "Тек формат пен бақылау саны тексеріледі, тізілімде тексерілмейді.", ru: "Проверяется только формат и контрольная цифра, не наличие в реестре." })}
        error={show("bin")}
      >
        <input inputMode="numeric" maxLength={12} placeholder="000000000000" className={cn(inputCls, "font-mono tracking-wider")} value={f.bin} onChange={(e) => set("bin", e.target.value.replace(/\D/g, "").slice(0, 12))} />
      </Field>
      <label className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm text-slate-300">
        <input type="checkbox" className="mt-0.5" checked={f.publish} onChange={(e) => set("publish", e.target.checked)} />
        <span>
          {tr({
            kz: "Компания атауын, байланыс деректерін және каталогты сайт пайдаланушыларына жариялауға келісемін. Келісімсіз каталог жасырын болады; кейін кабинетте қосуға болады.",
            ru: "Согласен публиковать название, контакты и каталог для пользователей сайта. Без согласия каталог скрыт; включить можно позже в кабинете.",
          })}
        </span>
      </label>

      {serverError && <p className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{serverError}</p>}

      <div className="flex items-center justify-between gap-3 pt-2">
        <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-sm text-blue-300 hover:text-blue-200">
          <ArrowLeft className="h-3.5 w-3.5" /> {tr({ kz: "Аккаунт түрі", ru: "Тип аккаунта" })}
        </button>
        <Button type="submit" disabled={busy} className="disabled:opacity-60">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : tr({ kz: "Тіркелу", ru: "Зарегистрироваться" })}
        </Button>
      </div>
    </form>
  );
}
