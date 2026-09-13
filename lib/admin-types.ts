/** Shapes shared by the admin API and the admin UI. */
import type { PlanId } from "./plans";

export type IntegrationState = "ok" | "fallback" | "missing" | "error";

export interface Integration {
  id: string;
  name: string;
  state: IntegrationState;
  label: string;
  detail?: string;
}

export interface DailyPoint {
  day: string;
  binLookups: number;
  tenders: number;
  aiQueries: number;
  signups: number;
}

export interface LogRow {
  at: string;
  source: string;
  status: string;
  detail: string;
}

export interface AdminStats {
  generatedAt: string;
  /** False until migration 0006 (events table) is applied. */
  eventsAvailable: boolean;
  kpi: {
    totalUsers: number;
    newUsers30: number;
    activeToday: number;
    totalBinSearches: number;
    calculatedTenders: number;
    payingUsers: number;
    testSubscriptions: number;
    conversionRate: number;
    mrrKzt: number;
    arrKzt: number;
    revenue30Kzt: number;
    revenueTotalKzt: number;
    aiQueries30: number;
  };
  daily: DailyPoint[];
  logistics: { mode: string; count: number }[];
  regions: { cityId: string; name: string; users: number }[];
  planMix: { plan: PlanId; users: number }[];
  integrations: Integration[];
  errors: LogRow[];
}

export interface AdminUserRow {
  id: string;
  email: string;
  phone: string;
  bin: string;
  companyName: string;
  createdAt: string;
  role: "admin" | "user";
  roleSource: "app_metadata" | "env" | null;
  plan: PlanId;
  planProvider: string | null;
  planUntil: string | null;
  calculations: number;
  binLookups: number;
  aiQueries30: number;
  lastActivity: string | null;
  banned: boolean;
}

export interface AdminSettings {
  adminEmails: number;
  paymentsMode: string;
  eventsAvailable: boolean;
  keys: { name: string; set: boolean }[];
}
