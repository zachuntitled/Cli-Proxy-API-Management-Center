import type { ClaudeAccountSnapshot } from '@/services/api/claudeOverview';
import { remainingPercent } from './quotaFormat';
import type { RouterAccountSnapshot } from '@/services/api/untitled';
import { expireCursorUsage, type CursorUsage } from '@/services/api/cursorUsage';
import {
  expireOpenrouterCredits,
  type OpenrouterCreditsState,
} from '@/services/api/openrouterCredits';
const clamp = (value: number) => Math.max(0, Math.min(100, value));
export function codexPool(accounts: RouterAccountSnapshot[]) {
  const readings = accounts
    .map((account) => account.quota.weekly.remaining)
    .filter((value): value is number => value !== null && Number.isFinite(value));
  const remaining = readings.length ? readings.reduce((sum, value) => sum + clamp(value), 0) : null;
  const maximum = accounts.length * 100;
  return {
    remaining,
    maximum,
    fill: remaining !== null && maximum ? (remaining / maximum) * 100 : null,
    known: readings.length,
    total: accounts.length,
    partial: readings.length < accounts.length,
  };
}
export function cursorPools(usage: CursorUsage | { status: 'loading' }, now = Date.now()) {
  if ('observedAtMs' in usage) usage = expireCursorUsage(usage, now);
  if (!('cursorPercentUsed' in usage) || !['fresh', 'stale'].includes(usage.status))
    return { cursor: null, other: null };
  const remaining = (used: number | null) =>
    used !== null && Number.isFinite(used) && used >= 0 ? clamp(100 - used) : null;
  return { cursor: remaining(usage.cursorPercentUsed), other: remaining(usage.otherPercentUsed) };
}
export function openrouterPool(credits: OpenrouterCreditsState, now = Date.now()) {
  if ('observedAtMs' in credits) credits = expireOpenrouterCredits(credits, now);
  if (
    credits.status !== 'fresh' ||
    !('remainingCredits' in credits) ||
    credits.remainingCredits === null ||
    credits.totalCredits === null
  )
    return { remaining: null, maximum: null, fill: null };
  const remaining = Math.max(0, credits.remainingCredits);
  return {
    remaining,
    maximum: credits.totalCredits,
    fill: credits.totalCredits > 0 ? clamp((remaining / credits.totalCredits) * 100) : 0,
  };
}

export function claudePool(accounts: ClaudeAccountSnapshot[]) {
  const readings = accounts
    .map((account) =>
      account.status === 'disabled' || account.quotaError
        ? null
        : remainingPercent(account.windows.find((window) => window.id === 'seven-day')?.usedPercent)
    )
    .filter((value): value is number => value !== null);
  const remaining = readings.length ? readings.reduce((sum, value) => sum + value, 0) : null;
  const maximum = accounts.length * 100;
  return {
    remaining,
    maximum,
    fill: remaining !== null && maximum ? (remaining / maximum) * 100 : null,
    known: readings.length,
    total: accounts.length,
    partial: readings.length < accounts.length,
  };
}
