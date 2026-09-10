"use client";

import { useState } from "react";
import { Info } from "lucide-react";
import { useProfile } from "@/lib/profile";
import { isSupabaseConfigured } from "@/lib/supabase";
import { useI18n } from "@/lib/i18n";
import { Button } from "../ui/Button";
import { Field, inputCls, Modal } from "./Modal";

/** Кіру / Тіркелу. Without Supabase, offers to continue with a local profile. */
export function AuthModal() {
  const { t } = useI18n();
  const { modal, openModal, signIn, signUp } = useProfile();
  const mode = modal === "register" ? "register" : "login";
  const open = modal === "login" || modal === "register";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setBusy(true);
    if (mode === "login") {
      const r = await signIn(email, password);
      if (r.error) setError(r.error);
      else openModal(null);
    } else {
      const r = await signUp(email, password);
      if (r.error) setError(r.error);
      else if (r.needsConfirm) setInfo(t.auth.confirmEmail);
      else openModal("onboarding");
    }
    setBusy(false);
  };

  return (
    <Modal open={open} onClose={() => openModal(null)} title={mode === "login" ? t.auth.loginTitle : t.auth.registerTitle}>
      {!isSupabaseConfigured ? (
        <div className="space-y-5">
          <p className="flex gap-2.5 rounded-xl border border-amber-400/25 bg-amber-400/[0.07] p-3.5 text-sm leading-relaxed text-amber-100">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            {t.auth.notConfigured}
          </p>
          <Button className="w-full" onClick={() => openModal("onboarding")}>
            {t.auth.continueLocal}
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Field label={t.auth.email}>
            <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
          </Field>
          <Field label={t.auth.password} hint={mode === "register" ? t.auth.passwordHint : undefined}>
            <input
              type="password"
              required
              minLength={6}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputCls}
            />
          </Field>
          {error && <p className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</p>}
          {info && <p className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{info}</p>}
          <Button type="submit" disabled={busy} className="w-full disabled:opacity-60">
            {mode === "login" ? t.auth.submitLogin : t.auth.submitRegister}
          </Button>
          <button
            type="button"
            onClick={() => openModal(mode === "login" ? "register" : "login")}
            className="w-full text-center text-sm text-blue-300 hover:text-blue-200"
          >
            {mode === "login" ? t.auth.toRegister : t.auth.toLogin}
          </button>
        </form>
      )}
    </Modal>
  );
}
