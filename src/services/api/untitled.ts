import type { AuthFileItem, Config } from '@/types';
import { apiCallApi } from './apiCall';
import { authFilesApi } from './authFiles';
import { resolvePlanTier } from '@/utils/quota/planTier';
import { isRecord } from '@/utils/helpers';
import { normalizeAuthIndex } from '@/utils/authIndex';
import { remainingPercent } from '@/features/untitled/quotaFormat';
import {
  isCodexFile,
  CODEX_REQUEST_HEADERS,
  CODEX_USAGE_URL,
  normalizePlanType,
  resolveCodexChatgptAccountId,
  resolveCodexPlanType,
} from '@/utils/quota';

export type RouterPlan = 'pro' | 'prolite' | 'business' | 'other';
export type RouterFilter = 'all' | RouterPlan;
export type RouterAccount = {
  key: string;
  plan: RouterPlan;
  status: 'active' | 'disabled' | 'unavailable' | 'unknown';
  success: number;
  failed: number;
};
export type RouterWindow = { remaining: number | null; resetAt: number | null };
export type RouterQuota = { fiveHour: RouterWindow; weekly: RouterWindow };
export type RouterCredits =
  { kind: 'balance'; balance: number } | { kind: 'unlimited' | 'available' | 'unavailable' };
export type RouterAccountSnapshot = RouterAccount & {
  quota: RouterQuota;
  credits: RouterCredits;
  quotaError: boolean;
  checkedAt: number | null;
};

const record = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {});

const normalizeRouterStatus = (file: AuthFileItem): RouterAccount['status'] => {
  if (file.disabled) return 'disabled';
  if (file.unavailable) return 'unavailable';
  return file.status === 'active' ? 'active' : 'unknown';
};

const classifyRouterPlan = (plan: string | null): RouterPlan => {
  if (plan === 'pro') return 'pro';
  if (resolvePlanTier(plan) === 'premium') return 'prolite';
  if (plan === 'team' || plan === 'business') return 'business';
  return 'other';
};

export const normalizeRouterAccount = (file: AuthFileItem): RouterAccount => {
  const plan = resolveCodexPlanType(file);
  return {
    key: normalizeAuthIndex(file.authIndex) ?? '',
    plan: classifyRouterPlan(plan),
    status: normalizeRouterStatus(file),
    success: file.successCount ?? 0,
    failed: file.failureCount ?? 0,
  };
};

export const normalizeRouterQuota = (payload: unknown): RouterQuota => {
  const limits = record(record(payload).rate_limit);
  const result: RouterQuota = {
    fiveHour: { remaining: null, resetAt: null },
    weekly: { remaining: null, resetAt: null },
  };
  for (const raw of [limits.primary_window, limits.secondary_window]) {
    const window = record(raw);
    const key =
      window.limit_window_seconds === 18000
        ? 'fiveHour'
        : window.limit_window_seconds === 604800
          ? 'weekly'
          : null;
    if (!key) continue;
    result[key] = {
      remaining: remainingPercent(window.used_percent),
      resetAt:
        typeof window.reset_at === 'number' && Number.isFinite(window.reset_at)
          ? window.reset_at * 1000
          : null,
    };
  }
  return result;
};

export const normalizeRouterCredits = (payload: unknown): RouterCredits => {
  const credits = record(record(payload).credits);
  if (credits.unlimited === true) return { kind: 'unlimited' };
  const raw = credits.balance;
  const balance =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && /^-?\d+(?:\.\d+)?$/.test(raw.trim())
        ? Number(raw)
        : NaN;
  if (Number.isFinite(balance)) return { kind: 'balance', balance };
  return { kind: credits.has_credits === true ? 'available' : 'unavailable' };
};

export const filterRouterAccounts = <T extends RouterAccount>(
  accounts: T[],
  filter: RouterFilter
): T[] => accounts.filter((account) => filter === 'all' || account.plan === filter);

export const untitledApi = {
  listAccounts: async (signal: AbortSignal): Promise<RouterAccountSnapshot[]> => {
    const response = await authFilesApi.list();
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const files = response.files.filter(isCodexFile);
    return Promise.all(
      files.map(async (file, index) => {
        const account = normalizeRouterAccount(file);
        const empty: RouterAccountSnapshot = {
          ...account,
          // The fallback is only a render key; it is never used to select a credential.
          key: account.key || `unavailable-${index}`,
          quota: normalizeRouterQuota(null),
          credits: normalizeRouterCredits(null),
          quotaError: false,
          checkedAt: null,
        };
        const accountId = resolveCodexChatgptAccountId(file);
        if (account.status === 'disabled' || !account.key) return empty;
        const header: Record<string, string> = { ...CODEX_REQUEST_HEADERS };
        if (accountId) header['Chatgpt-Account-Id'] = accountId;
        try {
          const result = await apiCallApi.request(
            {
              authIndex: account.key,
              method: 'GET',
              url: CODEX_USAGE_URL,
              header,
            },
            { signal, timeout: 20000 }
          );
          if (result.statusCode < 200 || result.statusCode >= 300) {
            return { ...empty, quotaError: true };
          }
          const payload = record(result.body);
          const usagePlan = normalizePlanType(payload.plan_type ?? payload.planType);
          return {
            ...empty,
            plan: usagePlan ? classifyRouterPlan(usagePlan) : empty.plan,
            quota: normalizeRouterQuota(result.body),
            credits: normalizeRouterCredits(result.body),
            checkedAt: Date.now(),
          };
        } catch {
          return { ...empty, quotaError: true };
        }
      })
    );
  },
};

export const routerPolicy = (config: Config | null) => {
  const routing = config?.raw?.routing;
  // The backend omits session-affinity when its boolean value is false.
  const affinity = isRecord(routing)
    ? 'session-affinity' in routing
      ? routing['session-affinity']
      : false
    : null;
  return {
    strategy: config?.routingStrategy,
    affinity: typeof affinity === 'boolean' ? affinity : null,
  };
};
