import { redirect } from "next/navigation";

/**
 * No landing screen: everyone goes straight to the live data in «Тендер нарығы».
 * Guests browse the market; deep actions open the auth wall (components/auth/AuthWallModal).
 */
export default function RootPage() {
  redirect("/dashboard");
}
