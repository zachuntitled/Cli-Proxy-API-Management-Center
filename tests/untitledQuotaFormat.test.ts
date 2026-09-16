import { describe, expect, test } from 'bun:test';
import { remainingPercent } from '@/features/untitled/quotaFormat';

describe('remainingPercent', () => {
  test.each([
    [0, 100],
    [44, 56],
    [100, 0],
    [-20, 100],
    [140, 0],
  ])('converts %s used percent to %s remaining percent', (used, remaining) => {
    expect(remainingPercent(used)).toBe(remaining);
  });

  test.each([
    undefined,
    null,
    '44',
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ])('returns null for absent or invalid value %s', (value) => {
    expect(remainingPercent(value)).toBeNull();
  });
});
