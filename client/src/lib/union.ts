import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Certification, DispatchEvent, Entry, FundReport, User } from "@shared/schema";
import {
  apprenticeStatus,
  DEFAULT_UNION_PROFILE,
  fundCrossCheck,
  healthMonths,
  healthStatus,
  listStatus,
  localMonthKey,
  reminders,
  type UnionProfile,
} from "@shared/union";

export const UNION_QUERY_KEYS = {
  profile: ["/api/union/profile"],
  fundReports: ["/api/union/fund-reports"],
  dispatch: ["/api/union/dispatch"],
} as const;

const TWO_WEEKS = 14 * 86_400_000;

// Everything the Status, Benefits and List pages show, computed on the device
// from the member's own rows with the rules in shared/union.ts.
export function useUnionData() {
  const { data: user, isLoading: loadingUser } = useQuery<User>({ queryKey: ["/api/user"] });
  const enabled = !!user;
  const { data: entries = [] } = useQuery<Entry[]>({ queryKey: ["/api/entries"], enabled });
  const { data: profileData } = useQuery<UnionProfile>({ queryKey: UNION_QUERY_KEYS.profile, enabled });
  const { data: fundReports = [] } = useQuery<FundReport[]>({ queryKey: UNION_QUERY_KEYS.fundReports, enabled });
  const { data: dispatch = [] } = useQuery<DispatchEvent[]>({ queryKey: UNION_QUERY_KEYS.dispatch, enabled });
  const { data: certs = [] } = useQuery<Certification[]>({ queryKey: ["/api/certifications"], enabled });

  const profile = { ...DEFAULT_UNION_PROFILE, ...(profileData ?? {}) };
  const today = new Date();
  const asOf = localMonthKey(today);

  const health = healthStatus(healthMonths(entries), asOf, { startingBank: profile.startingBank });
  const apprentice = apprenticeStatus(entries, { ojt: profile.priorOjtHours, rsi: profile.priorRsiHours });
  const list = listStatus(dispatch, today);
  const crossCheck = fundCrossCheck(entries, fundReports, asOf);
  const unverifiedOld = entries.filter(
    (e) => !e.verified && !e.verificationRequestedAt && today.getTime() - new Date(e.date).getTime() > TWO_WEEKS,
  ).length;
  const todo = reminders({ today, profile, health, list, certs, crossCheck, unverifiedOld });

  return { user, loadingUser, entries, profile, fundReports, dispatch, certs, health, apprentice, list, crossCheck, reminders: todo, asOf, today };
}

// Add an out-of-work list event (sign-in, re-registration, dispatch, layoff).
export function useAddDispatchEvent() {
  return useMutation({
    mutationFn: async (body: { date: string; kind: string; employer?: string | null; note?: string | null }) =>
      (await apiRequest("POST", "/api/union/dispatch", body)).json(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: UNION_QUERY_KEYS.dispatch }),
  });
}

export function useDeleteUnionRow(kind: "dispatch" | "fundReports") {
  const path = kind === "dispatch" ? "/api/union/dispatch" : "/api/union/fund-reports";
  return useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `${path}/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: UNION_QUERY_KEYS[kind] }),
  });
}
