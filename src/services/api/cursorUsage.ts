import { apiCallApi } from './apiCall';
import { isRecord } from '@/utils/helpers';

export interface CursorUsage {
  version: 1;
  status: 'fresh' | 'stale' | 'auth_required' | 'unavailable';
  cursorPercentUsed: number | null;
  otherPercentUsed: number | null;
  observedAtMs: number | null;
  cycleStartMs: number | null;
  cycleEndMs: number | null;
}

export const emptyCursorUsage = (
  status: 'auth_required' | 'unavailable' = 'unavailable'
): CursorUsage => ({
  version: 1,
  status,
  cursorPercentUsed: null,
  otherPercentUsed: null,
  observedAtMs: null,
  cycleStartMs: null,
  cycleEndMs: null,
});

const percent = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const timestamp = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 8640000000000000
    ? value
    : null;

export function cursorUsageExpiresAt(usage: CursorUsage): number | null {
  if (usage.observedAtMs === null || !['fresh', 'stale'].includes(usage.status)) return null;
  return Math.min(
    usage.observedAtMs + (usage.status === 'stale' ? 300000 : 60000),
    usage.cycleEndMs ?? Infinity
  );
}

// Only the bridge can mark data stale. Local expiry and transport failures clear data.
export function expireCursorUsage(usage: CursorUsage, now = Date.now()): CursorUsage {
  const expires = cursorUsageExpiresAt(usage);
  return expires !== null && now >= expires ? emptyCursorUsage() : usage;
}

export function normalizeCursorUsage(input: unknown, now = Date.now()): CursorUsage {
  if (!isRecord(input) || input.version !== 1) return emptyCursorUsage();
  if (input.status === 'auth_required') return emptyCursorUsage('auth_required');
  if (input.status !== 'fresh' && input.status !== 'stale') return emptyCursorUsage();
  const cursorPercentUsed = percent(input.cursorPercentUsed);
  const otherPercentUsed = percent(input.otherPercentUsed);
  const observedAtMs = timestamp(input.observedAtMs);
  const cycleStartMs = timestamp(input.cycleStartMs);
  const cycleEndMs = timestamp(input.cycleEndMs);
  if (
    (cursorPercentUsed === null && otherPercentUsed === null) ||
    observedAtMs === null ||
    observedAtMs > now + 5000 ||
    (input.status === 'stale' && cycleEndMs === null) ||
    (cycleStartMs !== null && cycleEndMs !== null && cycleStartMs >= cycleEndMs)
  )
    return emptyCursorUsage();
  return expireCursorUsage(
    {
      version: 1,
      status: input.status,
      cursorPercentUsed,
      otherPercentUsed,
      observedAtMs,
      cycleStartMs,
      cycleEndMs,
    },
    now
  );
}

export const cursorUsageApi = {
  get: async (signal?: AbortSignal): Promise<CursorUsage> => {
    try {
      const result = await apiCallApi.request(
        {
          method: 'GET',
          url: 'http://127.0.0.1:18318/usage',
          proxy_url: 'direct',
        },
        { signal, timeout: 15000 }
      );
      // Inner failures belong to this resource, never the management session.
      if (result.statusCode === 401 || result.statusCode === 403)
        return emptyCursorUsage('auth_required');
      if (result.statusCode !== 200) return emptyCursorUsage();
      return normalizeCursorUsage(result.body);
    } catch {
      return emptyCursorUsage();
    }
  },
};
