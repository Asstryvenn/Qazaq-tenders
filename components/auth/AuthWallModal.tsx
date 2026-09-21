"use client";

import { Check, LineChart, LogIn, ShieldCheck, UserPlus, Wallet } from "lucide-react";
import { Modal } from "./Modal";
import { Button } from "../ui/Button";
import { useProfile } from "@/lib/profile";
import { useI18n } from "@/lib/i18n";

/** Auth wall shown when a guest opens a deep action on the public tender market. */
export function AuthWallModal() {
  const { modal, openModal } = useProfile();
  const { tr } = useI18n();
  const benefits = [
    { Icon: LineChart, text: tr({ kz: "Лоттың толық талдауы және TOS түсіндірмесі", ru: "Полный анализ лота и расшифровка TOS" }) },
    { Icon: Wallet, text: tr({ kz: "Кассалық алшақтық пен таза пайда есебі", ru: "Расчёт кассового разрыва и чистой прибыли" }) },
    { Icon: ShieldCheck, text: tr({ kz: "Есептер сіздің компанияңыз бойынша", ru: "Расчёты под вашу компанию" }) },
  ];
  return (
    <Modal
      open={modal === "gate"}
      onClose={() => openModal(null)}
      width="max-w-md"
      title={tr({ kz: "Кіру / Тіркелу", ru: "Вход / Регистрация" })}
      subtitle={tr({
        kz: "Толық талдау мен кассалық алшақтық есебін көру үшін жүйеге кіріңіз",
        ru: "Чтобы увидеть полный анализ и расчёт кассового разрыва, войдите в систему",
      })}
    >
      <ul className="space-y-2.5">
        {benefits.map(({ Icon, text }) => (
          <li key={text} className="flex items-center gap-3 rounded-lg border border-[#E5E0D8] bg-[#F4F1EA] px-3 py-2.5 text-sm text-[#292524] dark:border-white/10 dark:bg-white/5 dark:text-slate-200">
            <Icon className="h-4 w-4 shrink-0 text-[#07575B] dark:text-[#10B981]" />
            <span className="min-w-0 flex-1">{text}</span>
            <Check className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          </li>
        ))}
      </ul>
      <div className="mt-6 grid gap-2 sm:grid-cols-2">
        <Button className="w-full py-2.5" onClick={() => openModal("register")}>
          <UserPlus className="h-4 w-4" /> {tr({ kz: "Тіркелу — тегін", ru: "Регистрация — бесплатно" })}
        </Button>
        <Button variant="outline" className="w-full py-2.5" onClick={() => openModal("login")}>
          <LogIn className="h-4 w-4" /> {tr({ kz: "Кіру", ru: "Войти" })}
        </Button>
      </div>
      <p className="mt-4 text-center text-xs text-[#78716C] dark:text-slate-400">
        {tr({ kz: "Лоттар тізімі тіркелусіз ашық. Тіркелу 1 минут алады.", ru: "Список лотов открыт без регистрации. Регистрация занимает 1 минуту." })}
      </p>
    </Modal>
  );
}
