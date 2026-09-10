import type { Metadata } from "next";
import "./globals.css";
import { AnimatedBackground } from "@/components/AnimatedBackground";
import { Navbar } from "@/components/Navbar";
import { I18nProvider } from "@/lib/i18n";
import { ProfileProvider } from "@/lib/profile";
import { AuthModal } from "@/components/auth/AuthModal";
import { OnboardingModal } from "@/components/auth/OnboardingModal";

export const metadata: Metadata = {
  title: "Qazaq Tenders — Intelligent Economic Simulator for SME Procurement",
  description:
    "Simulate cash flow, analyze tender profitability, and detect liquidity risks before bidding.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="kk" className="dark">
      <body className="flex min-h-screen flex-col">
        <I18nProvider>
          <ProfileProvider>
            <AnimatedBackground />
            <Navbar />
            <main className="relative z-10 flex-1">{children}</main>
            <AuthModal />
            <OnboardingModal />
          </ProfileProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
