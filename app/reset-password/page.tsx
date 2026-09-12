"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Loader2 } from "lucide-react";
import { GlassCard } from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/Button";
import { Field, inputCls } from "@/components/auth/Modal";
import { supabase } from "@/lib/supabase";
import { useI18n } from "@/lib/i18n";

/**
 * Landing page of the Supabase password-reset email. supabase-js reads the recovery token
 * from the URL and opens a temporary session; here the user sets the new password.
 */
export default function ResetPasswordPage() {
  const { tr } = useI18n();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => data.session && setReady(true));
    const { data: sub } = supabase.auth.onAuthStateChange((evt, session) => {
      if (evt === "PASSWORD_RECOVERY" || session) setReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 6) return setError(tr({ kz: "Кемінде 6 таңба", ru: "Минимум 6 символов" }));
    if (password !== repeat) return setError(tr({ kz: "Құпиясөздер сәйкес емес", ru: "Пароли не совпадают" }));
    if (!supabase) return;
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) return setError(error.message);
    router.push("/dashboard");
  };

  return (
    <div className="mx-auto grid min-h-[70vh] max-w-md place-items-center px-5 py-10">
      <GlassCard interactive={false} className="w-full p-7">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl border border-accent-blue/40 bg-accent-blue/15 text-sky-300">
            <KeyRound className="h-5 w-5" />
          </span>
          <h1 className="text-lg font-semibold text-white">{tr({ kz: "Жаңа құпиясөз", ru: "Новый пароль" })}</h1>
        </div>

        {!ready ? (
          <p className="mt-5 flex items-center gap-2 text-sm text-slate-300">
            <Loader2 className="h-4 w-4 animate-spin" />
            {tr({ kz: "Сілтеме тексерілуде… Хаттағы сілтемені осы браузерде ашыңыз.", ru: "Проверяем ссылку… Откройте ссылку из письма в этом браузере." })}
          </p>
        ) : (
          <form onSubmit={submit} className="mt-6 space-y-4">
            <Field label={tr({ kz: "Жаңа құпиясөз", ru: "Новый пароль" })} hint={tr({ kz: "Кемінде 6 таңба", ru: "Минимум 6 символов" })}>
              <input type="password" autoComplete="new-password" className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            <Field label={tr({ kz: "Қайталаңыз", ru: "Повторите" })}>
              <input type="password" autoComplete="new-password" className={inputCls} value={repeat} onChange={(e) => setRepeat(e.target.value)} />
            </Field>
            {error && <p className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</p>}
            <Button type="submit" disabled={busy} className="w-full disabled:opacity-60">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : tr({ kz: "Сақтау және кіру", ru: "Сохранить и войти" })}
            </Button>
          </form>
        )}
      </GlassCard>
    </div>
  );
}
