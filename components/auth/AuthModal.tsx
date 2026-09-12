"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Info } from "lucide-react";
import { useProfile } from "@/lib/profile";
import { isSupabaseConfigured } from "@/lib/supabase";
import { useI18n } from "@/lib/i18n";
import { Button } from "../ui/Button";
import { Field, inputCls, Modal } from "./Modal";
import { RegisterWizard } from "./RegisterWizard";

/** Кіру → simple email/password. Тіркелу → the 3-step registration wizard. */
export function AuthModal() {
  const { t, tr } = useI18n();
  const { modal, openModal, signIn, resetPassword, pendingEmail, company, isDemo } = useProfile();
  const open = modal === "login" || modal === "register";
  const pathname = usePathname();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wrongPassword, setWrongPassword] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  useEffect(() => {
    if (modal === "login" && pendingEmail && !email) setEmail(pendingEmail);
  }, [modal, pendingEmail, email]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setWrongPassword(false);
    setResetSent(false);
    setBusy(true);
    const r = await signIn(email, password);
    setBusy(false);
    if (r.error) {
      // Supabase answers "Invalid login credentials" for an unknown email OR a wrong password.
      const invalid = /invalid login credentials/i.test(r.error);
      setWrongPassword(invalid);
      setError(
        invalid
          ? tr({ kz: "Email немесе құпиясөз қате.", ru: "Неверный email или пароль." })
          : /confirm/i.test(r.error)
            ? tr({ kz: "Email әлі расталмаған.", ru: "Email ещё не подтверждён." })
            : r.error
      );
    }
    else {
      openModal(null);
      // Signing in from the landing page goes straight to the app, like registration does.
      if (pathname === "/") router.push("/dashboard");
    }
  };

  if (modal === "register")
    return (
      <Modal
        open={open}
        onClose={() => openModal(null)}
        title={t.auth.registerTitle}
        subtitle={tr({ kz: "3 қадам — және TOS сіздің компанияңыз бойынша есептеледі", ru: "3 шага — и TOS считается под вашу компанию" })}
        width="max-w-xl"
      >
        <RegisterWizard />
      </Modal>
    );

  return (
    <Modal
      open={open}
      onClose={() => openModal(null)}
      title={t.auth.loginTitle}
      subtitle={pendingEmail ? tr({ kz: "Профиліңіз осы браузерде бар — тіркелген email-мен кіріңіз.", ru: "Профиль уже есть в этом браузере — войдите с email регистрации." }) : undefined}
    >
      {!isSupabaseConfigured ? (
        <div className="space-y-4">
          <p className="flex gap-2.5 rounded-xl border border-white/10 bg-white/[0.04] p-3.5 text-sm leading-relaxed text-slate-300">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-300" />
            {tr({ kz: "Бұлттық аккаунттар осы серверде әлі қосылмаған. Профиль осы браузерде сақталады.", ru: "Облачные аккаунты на этом сервере ещё не подключены. Профиль сохранится в этом браузере." })}
          </p>
          <Button className="w-full" onClick={() => openModal("register")}>
            {t.nav.register}
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Field label={t.auth.email}>
            <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
          </Field>
          <Field label={t.auth.password}>
            <input type="password" required minLength={6} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} />
          </Field>
          {error && (
            <div className="space-y-2 rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2.5 text-sm text-rose-200">
              <p>{error}</p>
              {wrongPassword && (
                <button
                  type="button"
                  disabled={busy || !email.trim()}
                  onClick={async () => {
                    setBusy(true);
                    const r = await resetPassword(email);
                    setBusy(false);
                    if (r.error) setError(r.error);
                    else setResetSent(true);
                  }}
                  className="font-semibold text-sky-200 underline-offset-2 hover:underline disabled:opacity-50"
                >
                  {tr({ kz: "Құпиясөзді ұмыттыңыз ба? Қалпына келтіру сілтемесін жіберу", ru: "Забыли пароль? Отправить ссылку для сброса" })}
                </button>
              )}
            </div>
          )}
          {resetSent && (
            <p className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
              {tr({ kz: `${email} поштасына құпиясөзді жаңарту сілтемесі жіберілді.`, ru: `На ${email} отправлена ссылка для смены пароля.` })}
            </p>
          )}
          {!isDemo && (
            <p className="text-xs text-slate-400">
              {tr({
                kz: `«${company.name}» профилі кіргеннен кейін аккаунтқа өзі сақталады.`,
                ru: `Профиль «${company.name}» сам сохранится в аккаунт после входа.`,
              })}
            </p>
          )}
          <Button type="submit" disabled={busy} className="w-full disabled:opacity-60">
            {t.auth.submitLogin}
          </Button>
          <button type="button" onClick={() => openModal("register")} className="w-full text-center text-sm text-blue-300 hover:text-blue-200">
            {t.auth.toRegister}
          </button>
        </form>
      )}
    </Modal>
  );
}
