/**
 * Client-safe Telegram config. Next inlines NEXT_PUBLIC_* only when referenced literally,
 * so the variable is read exactly once here. A leading "@" is stripped.
 */
export const PUBLIC_BOT_USERNAME = (process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME ?? "").trim().replace(/^@+/, "");
