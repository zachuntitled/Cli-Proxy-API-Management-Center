import { expect, test, spyOn } from 'bun:test';
import {
  normalizeOpenrouterCredits,
  expireOpenrouterCredits,
  openrouterCreditsApi,
} from '@/services/api/openrouterCredits';
import { apiClient } from '@/services/api/client';
const now = 1800000000000;
const fresh = {
  version: 1,
  status: 'fresh',
  totalCredits: 100,
  totalUsage: 23.5,
  remainingCredits: 76.5,
  observedAtMs: now,
};
test('strict allowlisted money contract and expiry', () => {
  expect(normalizeOpenrouterCredits({ ...fresh, secret: 'hidden' }, now)).toEqual(fresh);
  for (const bad of [
    null,
    {},
    { ...fresh, totalCredits: -1 },
    { ...fresh, totalUsage: Infinity },
    { ...fresh, remainingCredits: 8 },
    { ...fresh, observedAtMs: now + 5001 },
  ])
    expect(normalizeOpenrouterCredits(bad, now).status).toBe('unavailable');
  expect(
    normalizeOpenrouterCredits({ ...fresh, totalUsage: 120, remainingCredits: 0 }, now)
      .remainingCredits
  ).toBe(0);
  expect(
    expireOpenrouterCredits(normalizeOpenrouterCredits(fresh, now), now + 60000).remainingCredits
  ).toBeNull();
  expect(expireOpenrouterCredits(normalizeOpenrouterCredits(fresh, now), now + 59999).status).toBe(
    'fresh'
  );
});
test('inner auth errors stay local and transport failure clears values', async () => {
  const post = spyOn(apiClient, 'post').mockResolvedValue({ status_code: 401, body: 'secret' });
  try {
    expect((await openrouterCreditsApi.get()).status).toBe('auth_required');
    expect(post.mock.calls[0][1]).toEqual({
      method: 'GET',
      url: 'http://127.0.0.1:18319/credits',
      proxy_url: 'direct',
    });
    post.mockRejectedValue(new Error('offline'));
    expect((await openrouterCreditsApi.get()).totalCredits).toBeNull();
  } finally {
    post.mockRestore();
  }
});
