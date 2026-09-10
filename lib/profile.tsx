"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { DEMO_COMPANY } from "./mock-data";
import type { CompanyProfile } from "./types";

const LOCAL_KEY = "qt-profile";

type ModalKind = "login" | "register" | "onboarding" | null;

interface ProfileValue {
  /** Active digital twin — the user's own once onboarded, the demo company before. */
  company: CompanyProfile;
  isDemo: boolean;
  session: Session | null;
  loading: boolean;
  saveProfile: (p: CompanyProfile) => Promise<{ error?: string }>;
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signUp: (email: string, password: string) => Promise<{ error?: string; needsConfirm?: boolean }>;
  signOut: () => Promise<void>;
  modal: ModalKind;
  openModal: (m: ModalKind) => void;
}

const ProfileContext = createContext<ProfileValue | null>(null);

/* DB row <-> CompanyProfile. Fields not stored per user keep the model defaults. */
type Row = {
  name: string;
  working_capital: number;
  base_city_id: string;
  max_distance_km: number;
  staff_size: number;
  tax_regime: CompanyProfile["taxRegime"];
  monthly_opex: number;
  experience_years: number;
  certificates: string[];
};

const fromRow = (r: Row): CompanyProfile => ({
  ...DEMO_COMPANY,
  name: r.name,
  workingCapital: Number(r.working_capital),
  baseCityId: r.base_city_id,
  maxDistanceKm: r.max_distance_km,
  staffSize: r.staff_size,
  taxRegime: r.tax_regime,
  monthlyOpex: Number(r.monthly_opex),
  experienceYears: r.experience_years,
  certificates: r.certificates ?? [],
});

const toRow = (p: CompanyProfile): Row => ({
  name: p.name,
  working_capital: Math.round(p.workingCapital),
  base_city_id: p.baseCityId,
  max_distance_km: Math.round(p.maxDistanceKm),
  staff_size: Math.round(p.staffSize),
  tax_regime: p.taxRegime,
  monthly_opex: Math.round(p.monthlyOpex),
  experience_years: Math.round(p.experienceYears),
  certificates: p.certificates,
});

export function ProfileProvider({ children }: { children: React.ReactNode }) {
  const [company, setCompany] = useState<CompanyProfile>(DEMO_COMPANY);
  const [isDemo, setIsDemo] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<ModalKind>(null);

  const loadRemote = useCallback(async (s: Session | null) => {
    if (!supabase || !s) return false;
    const { data } = await supabase.from("companies").select("*").eq("user_id", s.user.id).maybeSingle();
    if (data) {
      setCompany(fromRow(data as Row));
      setIsDemo(false);
      return true;
    }
    // Signed in but no profile yet → straight into onboarding.
    setModal("onboarding");
    return false;
  }, []);

  useEffect(() => {
    // Demo mode: profile survives reloads in localStorage.
    try {
      const raw = localStorage.getItem(LOCAL_KEY);
      if (raw) {
        setCompany({ ...DEMO_COMPANY, ...JSON.parse(raw) });
        setIsDemo(false);
      }
    } catch {}

    if (!supabase) {
      setLoading(false);
      return;
    }
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      await loadRemote(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, s) => {
      setSession(s);
      loadRemote(s);
    });
    return () => sub.subscription.unsubscribe();
  }, [loadRemote]);

  const saveProfile = useCallback(
    async (p: CompanyProfile) => {
      if (supabase && session) {
        const { error } = await supabase.from("companies").upsert({ user_id: session.user.id, ...toRow(p) });
        if (error) return { error: error.message };
      } else {
        try {
          localStorage.setItem(LOCAL_KEY, JSON.stringify(p));
        } catch {}
      }
      setCompany(p);
      setIsDemo(false);
      return {};
    },
    [session]
  );

  const signIn = useCallback(async (email: string, password: string) => {
    if (!supabase) return { error: "supabase-not-configured" };
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return error ? { error: error.message } : {};
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    if (!supabase) return { error: "supabase-not-configured" };
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return { error: error.message };
    // With email confirmation on, there is no session until the link is clicked.
    return { needsConfirm: !data.session };
  }, []);

  const signOut = useCallback(async () => {
    await supabase?.auth.signOut();
    setSession(null);
    setCompany(DEMO_COMPANY);
    setIsDemo(true);
  }, []);

  return (
    <ProfileContext.Provider
      value={{ company, isDemo, session, loading, saveProfile, signIn, signUp, signOut, modal, openModal: setModal }}
    >
      {children}
    </ProfileContext.Provider>
  );
}

export function useProfile() {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error("useProfile must be used inside <ProfileProvider>");
  return ctx;
}
