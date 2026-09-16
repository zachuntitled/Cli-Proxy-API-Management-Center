import { expect, test } from 'bun:test';
import { codexPool, cursorPools, openrouterPool } from '@/features/untitled/accountPools';
import type { RouterAccountSnapshot } from '@/services/api/untitled';
const account = (remaining: number | null, status = 'active') =>
  ({ quota: { weekly: { remaining } }, status }) as RouterAccountSnapshot;
test('Codex sums every configured account, including unavailable routes, with partial coverage', () => {
  expect(codexPool([account(99), account(99), account(15, 'unavailable')])).toEqual({
    remaining: 213,
    maximum: 300,
    fill: 71,
    known: 3,
    total: 3,
    partial: false,
  });
  expect(codexPool([account(99), account(null, 'disabled')])).toEqual({
    remaining: 99,
    maximum: 200,
    fill: 49.5,
    known: 1,
    total: 2,
    partial: true,
  });
  expect(codexPool([account(null)]).remaining).toBeNull();
  expect(codexPool([]).fill).toBeNull();
});
test('Cursor keeps distinct fractional percentage-point pools and clamps exhaustion', () => {
  expect(
    cursorPools({ status: 'fresh', cursorPercentUsed: 0.57, otherPercentUsed: 0.49 } as never)
  ).toEqual({ cursor: 99.43, other: 99.51 });
  expect(
    cursorPools({ status: 'fresh', cursorPercentUsed: 130, otherPercentUsed: null } as never)
  ).toEqual({ cursor: 0, other: null });
  expect(cursorPools({ status: 'loading' })).toEqual({ cursor: null, other: null });
});
test('credit pool uses purchased total, with real zero and exhaustion distinct from unavailable', () => {
  expect(
    openrouterPool({
      status: 'fresh',
      totalCredits: 100,
      totalUsage: 23.5,
      remainingCredits: 76.5,
    } as never)
  ).toEqual({ remaining: 76.5, maximum: 100, fill: 76.5 });
  expect(
    openrouterPool({
      status: 'fresh',
      totalCredits: 0,
      totalUsage: 1,
      remainingCredits: -1,
    } as never)
  ).toEqual({ remaining: 0, maximum: 0, fill: 0 });
  expect(openrouterPool({ status: 'unavailable' } as never).remaining).toBeNull();
});

test('expired observations cannot render while resume effects are delayed', () => {
  const now = Date.now();
  expect(
    cursorPools(
      {
        version: 1,
        status: 'fresh',
        cursorPercentUsed: 1,
        otherPercentUsed: 2,
        observedAtMs: now - 60000,
        cycleStartMs: null,
        cycleEndMs: null,
      },
      now
    )
  ).toEqual({ cursor: null, other: null });
  expect(
    openrouterPool(
      {
        version: 1,
        status: 'fresh',
        totalCredits: 100,
        totalUsage: 20,
        remainingCredits: 80,
        observedAtMs: now - 60000,
      },
      now
    ).remaining
  ).toBeNull();
});
