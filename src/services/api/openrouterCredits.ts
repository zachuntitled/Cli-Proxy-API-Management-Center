import { apiCallApi } from './apiCall';
import { isRecord } from '@/utils/helpers';

export interface OpenrouterCredits {
  version: 1;
  status: 'fresh' | 'auth_required' | 'unavailable';
  totalCredits: number | null;
  totalUsage: number | null;
  remainingCredits: number | null;
  observedAtMs: number | null;
}
export type OpenrouterCreditsState =
  OpenrouterCredits | { status: 'loading' | 'disabled' | 'not_configured' };
export const emptyOpenrouterCredits = (
  status: 'auth_required' | 'unavailable' = 'unavailable'
): OpenrouterCredits => ({
  version: 1,
  status,
  totalCredits: null,
  totalUsage: null,
  remainingCredits: null,
  observedAtMs: null,
});
export function openrouterCreditsExpiresAt(value: OpenrouterCredits): number | null {
  return value.status === 'fresh' && value.observedAtMs !== null
    ? value.observedAtMs + 60000
    : null;
}
export function expireOpenrouterCredits(
  value: OpenrouterCredits,
  now = Date.now()
): OpenrouterCredits {
  const expiry = openrouterCreditsExpiresAt(value);
  return expiry !== null && now >= expiry ? emptyOpenrouterCredits() : value;
}
export function normalizeOpenrouterCredits(input: unknown, now = Date.now()): OpenrouterCredits {
  if (!isRecord(input) || input.version !== 1) return emptyOpenrouterCredits();
  if (input.status === 'auth_required') return emptyOpenrouterCredits('auth_required');
  const { totalCredits, totalUsage, remainingCredits, observedAtMs } = input;
  if (
    input.status !== 'fresh' ||
    typeof totalCredits !== 'number' ||
    !Number.isFinite(totalCredits) ||
    totalCredits < 0 ||
    typeof totalUsage !== 'number' ||
    !Number.isFinite(totalUsage) ||
    totalUsage < 0 ||
    typeof remainingCredits !== 'number' ||
    !Number.isFinite(remainingCredits) ||
    Math.abs(remainingCredits - Math.max(0, totalCredits - totalUsage)) > 0.000001 ||
    typeof observedAtMs !== 'number' ||
    !Number.isSafeInteger(observedAtMs) ||
    observedAtMs <= 0 ||
    observedAtMs > now + 5000
  )
    return emptyOpenrouterCredits();
  return expireOpenrouterCredits(
    { version: 1, status: 'fresh', totalCredits, totalUsage, remainingCredits, observedAtMs },
    now
  );
}
export const openrouterCreditsApi = {
  get: async (signal?: AbortSignal): Promise<OpenrouterCredits> => {
    try {
      const result = await apiCallApi.request(
        { method: 'GET', url: 'http://127.0.0.1:18319/credits', proxy_url: 'direct' },
        { signal, timeout: 15000 }
      );
      if (result.statusCode === 401 || result.statusCode === 403)
        return emptyOpenrouterCredits('auth_required');
      return result.statusCode === 200
        ? normalizeOpenrouterCredits(result.body)
        : emptyOpenrouterCredits();
    } catch {
      return emptyOpenrouterCredits();
    }
  },
};
