"use client";

import { useEffect, useState } from "react";
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
  const { modal, openModal, signIn, pendingEmail } = useProfile();
  const open = modal === "login" || modal === "register";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (modal === "login" && pendingEmail && !email) setEmail(pendingEmail);
  }, [modal, pendingEmail, email]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const r = await signIn(email, password);
    setBusy(false);
    if (r.error) setError(/confirm/i.test(r.error) ? tr({ kz: "Email әлі расталмаған.", ru: "Email ещё не подтверждён." }) : r.error);
    else openModal(null);
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
        <p className="flex gap-2.5 rounded-xl border border-amber-400/25 bg-amber-400/[0.07] p-3.5 text-sm leading-relaxed text-amber-100">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          {t.auth.notConfigured}
        </p>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Field label={t.auth.email}>
            <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
          </Field>
          <Field label={t.auth.password}>
            <input type="password" required minLength={6} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} />
          </Field>
          {error && <p className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</p>}
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
