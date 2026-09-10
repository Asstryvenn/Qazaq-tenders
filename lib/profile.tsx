"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { DEMO_COMPANY } from "./mock-data";
import { fromRow, isMissingColumnError, toRow, withoutOptional, type CompanyRow } from "./profile-row";
import type { CompanyProfile } from "./types";

const LOCAL_KEY = "qt-profile";
/** Email of a sign-up whose local profile still has to be pushed to Supabase. */
const PENDING_KEY = "qt-pending-sync";

type ModalKind = "login" | "register" | "onboarding" | null;

/** How a registration completed — the UI words its confirmation accordingly. */
export type RegisterMode = "confirmed" | "session" | "pending" | "local";

interface ProfileValue {
  /** Active digital twin — the user's own once onboarded, the demo company before. */
  company: CompanyProfile;
  isDemo: boolean;
  session: Session | null;
  loading: boolean;
  /** Set while a sign-up awaits email confirmation; the profile already works locally. */
  pendingEmail: string | null;
  saveProfile: (p: CompanyProfile) => Promise<{ error?: string }>;
  register: (email: string, password: string, p: CompanyProfile) => Promise<{ error?: string; mode?: RegisterMode }>;
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
  modal: ModalKind;
  openModal: (m: ModalKind) => void;
}

const ProfileContext = createContext<ProfileValue | null>(null);

const readLocal = (): CompanyProfile | null => {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    return raw ? { ...DEMO_COMPANY, ...JSON.parse(raw) } : null;
  } catch {
    return null;
  }
};
const writeLocal = (p: CompanyProfile) => {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(p));
  } catch {}
};
const readPending = () => {
  try {
    return localStorage.getItem(PENDING_KEY);
  } catch {
    return null;
  }
};
const setPendingStorage = (email: string | null) => {
  try {
    if (email) localStorage.setItem(PENDING_KEY, email);
    else localStorage.removeItem(PENDING_KEY);
  } catch {}
};

/** Upsert the company row, tolerating a database that hasn't run the newest migration. */
async function upsertRemote(userId: string, p: CompanyProfile): Promise<string | null> {
  if (!supabase) return "supabase-not-configured";
  const row: CompanyRow = toRow(p);
  let { error } = await supabase.from("companies").upsert({ user_id: userId, ...row });
  if (error && isMissingColumnError(error.message)) {
    ({ error } = await supabase.from("companies").upsert({ user_id: userId, ...withoutOptional(row) }));
  }
  return error ? error.message : null;
}

export function ProfileProvider({ children }: { children: React.ReactNode }) {
  const [company, setCompany] = useState<CompanyProfile>(DEMO_COMPANY);
  const [isDemo, setIsDemo] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalKind>(null);

  const loadRemote = useCallback(async (s: Session | null) => {
    if (!supabase || !s) return;
    const { data } = await supabase.from("companies").select("*").eq("user_id", s.user.id).maybeSingle();
    if (data) {
      const p = fromRow(data as CompanyRow);
      setCompany(p);
      writeLocal(p);
      setIsDemo(false);
      return;
    }
    // First sign-in after a sign-up that saved its profile locally → push it to the cloud.
    const local = readLocal();
    if (local && readPending()?.toLowerCase() === s.user.email?.toLowerCase()) {
      const err = await upsertRemote(s.user.id, local);
      if (!err) {
        setPendingStorage(null);
        setPendingEmail(null);
      }
      setCompany(local);
      setIsDemo(false);
      return;
    }
    // Signed in with no profile anywhere → collect it.
    setModal("onboarding");
  }, []);

  useEffect(() => {
    const local = readLocal();
    if (local) {
      setCompany(local);
      setIsDemo(false);
    }
    setPendingEmail(readPending());

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
      writeLocal(p); // always keep a local copy
      if (supabase && session) {
        const err = await upsertRemote(session.user.id, p);
        if (err) return { error: err };
      }
      setCompany(p);
      setIsDemo(false);
      return {};
    },
    [session]
  );

  /**
   * Registration never blocks on email confirmation:
   *   1. server route with the Supabase secret key → user created confirmed → sign in
   *   2. otherwise normal sign-up → session right away if confirmation is off in Supabase
   *   3. otherwise the profile works locally now and syncs on the first sign-in
   */
  const register = useCallback(async (email: string, password: string, p: CompanyProfile) => {
    writeLocal(p);
    const adopt = () => {
      setCompany(p);
      setIsDemo(false);
    };
    if (!supabase) {
      adopt();
      return { mode: "local" as const };
    }

    setPendingStorage(email); // lets loadRemote push the local profile if the row isn't there yet
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, profile: p }),
    });

    if (res.ok) {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return { error: error.message };
      setPendingStorage(null);
      adopt();
      return { mode: "confirmed" as const };
    }
    if (res.status !== 501) {
      setPendingStorage(null);
      const d = await res.json().catch(() => ({}));
      return { error: d.error || `HTTP ${res.status}` };
    }

    // No secret key on the server → regular sign-up.
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { phone: p.phone, telegram: p.telegramUsername, company: p.name } },
    });
    if (error) {
      setPendingStorage(null);
      return { error: error.message };
    }
    adopt();
    if (data.session) {
      await upsertRemote(data.session.user.id, p);
      setPendingStorage(null);
      return { mode: "session" as const };
    }
    setPendingEmail(email);
    return { mode: "pending" as const };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    if (!supabase) return { error: "supabase-not-configured" };
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return error ? { error: error.message } : {};
  }, []);

  const signOut = useCallback(async () => {
    await supabase?.auth.signOut();
    try {
      localStorage.removeItem(LOCAL_KEY);
    } catch {}
    setPendingStorage(null);
    setPendingEmail(null);
    setSession(null);
    setCompany(DEMO_COMPANY);
    setIsDemo(true);
  }, []);

  return (
    <ProfileContext.Provider
      value={{ company, isDemo, session, loading, pendingEmail, saveProfile, register, signIn, signOut, modal, openModal: setModal }}
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
