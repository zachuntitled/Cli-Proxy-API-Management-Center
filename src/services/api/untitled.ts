import type { AuthFileItem, Config } from '@/types';
import { apiCallApi } from './apiCall';
import { authFilesApi } from './authFiles';
import { isRecord } from '@/utils/helpers';
import { normalizeAuthIndex } from '@/utils/authIndex';
import { remainingPercent } from '@/features/untitled/quotaFormat';
import {
  isCodexFile,
  CODEX_REQUEST_HEADERS,
  CODEX_USAGE_URL,
  resolveCodexChatgptAccountId,
  resolveCodexPlanType,
} from '@/utils/quota';

export type RouterPlan = 'pro' | 'business' | 'other';
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
export type RouterAccountSnapshot = RouterAccount & {
  quota: RouterQuota;
  quotaError: boolean;
  checkedAt: number | null;
};

const record = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {});

const normalizeRouterStatus = (file: AuthFileItem): RouterAccount['status'] => {
  if (file.disabled) return 'disabled';
  if (file.unavailable) return 'unavailable';
  return file.status === 'active' ? 'active' : 'unknown';
};

export const normalizeRouterAccount = (file: AuthFileItem): RouterAccount => {
  const plan = resolveCodexPlanType(file);
  return {
    key: normalizeAuthIndex(file.authIndex) ?? '',
    plan: plan === 'pro' ? 'pro' : plan === 'team' || plan === 'business' ? 'business' : 'other',
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
          quotaError: false,
          checkedAt: null,
        };
        const accountId = resolveCodexChatgptAccountId(file);
        if (account.status === 'disabled' || !account.key || !accountId) return empty;
        try {
          const result = await apiCallApi.request(
            {
              authIndex: account.key,
              method: 'GET',
              url: CODEX_USAGE_URL,
              header: { ...CODEX_REQUEST_HEADERS, 'Chatgpt-Account-Id': accountId },
            },
            { signal, timeout: 20000 }
          );
          if (result.statusCode < 200 || result.statusCode >= 300) {
            return { ...empty, quotaError: true };
          }
          return { ...empty, quota: normalizeRouterQuota(result.body), checkedAt: Date.now() };
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
