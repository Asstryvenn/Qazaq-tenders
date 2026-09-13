import type { Metadata } from "next";
import "./globals.css";
import "./theme-light.css";
import { AnimatedBackground } from "@/components/AnimatedBackground";
import { Navbar } from "@/components/Navbar";
import { I18nProvider } from "@/lib/i18n";
import { ProfileProvider } from "@/lib/profile";
import { AuthModal } from "@/components/auth/AuthModal";
import { OnboardingModal } from "@/components/auth/OnboardingModal";
import { NotificationsProvider } from "@/lib/notifications";
import { Toaster } from "@/components/Toaster";
import { BillingProvider } from "@/lib/billing-client";
import { CheckoutModal } from "@/components/billing/CheckoutModal";
import { AccountGate } from "@/components/AccountGate";

export const metadata: Metadata = {
  title: "Qazaq Tenders — бизнеске арналған тендер симуляторы",
  description: "Тендердің табыстылығын, ақша ағынын және өтімділік тәуекелдерін өтінім бермес бұрын бағалау.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="kk" className="dark" suppressHydrationWarning>
      <head>
        {/* Apply the saved theme before first paint — no dark→light flash. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem("qt-theme")==="light"){var d=document.documentElement;d.classList.remove("dark");d.classList.add("light")}}catch(e){}`,
          }}
        />
      </head>
      <body className="flex min-h-screen flex-col">
        <I18nProvider>
          <ProfileProvider>
            <NotificationsProvider>
              <BillingProvider>
                <AnimatedBackground />
                <Navbar />
                <main className="relative z-10 flex-1">
                  <AccountGate>{children}</AccountGate>
                </main>
                <AuthModal />
                <OnboardingModal />
                <CheckoutModal />
                <Toaster />
              </BillingProvider>
            </NotificationsProvider>
          </ProfileProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
