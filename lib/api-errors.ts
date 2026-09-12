/** Server error codes → user-facing messages (KZ / RU). Shared by every AI screen. */
type Bi = { kz: string; ru: string };

const MESSAGES: Record<string, Bi> = {
  OPENAI_KEY_MISSING: { kz: "Серверде OPENAI_API_KEY бапталмаған.", ru: "На сервере не настроен OPENAI_API_KEY." },
  OPENAI_INVALID_KEY: { kz: "OpenAI кілті қате немесе жарамсыз.", ru: "Ключ OpenAI неверный или недействителен." },
  OPENAI_QUOTA: { kz: "OpenAI лимиті өтті немесе баланс жеткіліксіз.", ru: "Лимит OpenAI исчерпан или недостаточно баланса." },
  OPENAI_UPSTREAM: { kz: "OpenAI сервері уақытша қолжетімсіз. Кейінірек қайталаңыз.", ru: "Сервер OpenAI временно недоступен. Повторите позже." },
  OPENAI_BAD_REQUEST: { kz: "OpenAI сұранысты қабылдамады.", ru: "OpenAI отклонил запрос." },
  EXTRACT_FAILED: { kz: "Құжатты талдау мүмкін болмады.", ru: "Не удалось разобрать документ." },
  auth: { kz: "Аккаунтқа кіріңіз.", ru: "Войдите в аккаунт." },
  quota: { kz: "AI сұраныс лимиті бітті — тарифті жаңартыңыз.", ru: "Лимит AI-запросов исчерпан — улучшите тариф." },
  "no-text": { kz: "PDF-те мәтін табылмады.", ru: "В PDF не найден текст." },
  network: { kz: "Желі қатесі — интернетті тексеріңіз.", ru: "Ошибка сети — проверьте интернет." },
};

export function apiErrorMessage(code: string | undefined, lang: "kz" | "ru", fallback?: string): string {
  const m = code ? MESSAGES[code] : undefined;
  if (m) return m[lang];
  return fallback ?? (lang === "kz" ? `Қате: ${code ?? "белгісіз"}` : `Ошибка: ${code ?? "неизвестная"}`);
}
