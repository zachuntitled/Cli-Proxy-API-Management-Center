import { expect, test } from 'bun:test';
import { watchOpenrouterCreditsExpiry } from '@/features/untitled/watchOpenrouterCreditsExpiry';
import { emptyOpenrouterCredits } from '@/services/api/openrouterCredits';
test('expiry clears hidden money and a resumed unavailable snapshot refreshes once', () => {
  let now = 1000;
  let visible = false;
  let expires = () => {};
  let clears = 0;
  let refreshes = 0;
  const visibility = new EventTarget();
  const focus = new EventTarget();
  const environment = {
    now: () => now,
    isVisible: () => visible,
    schedule: (callback: () => void, delay: number) => {
      expires = callback;
      expect(delay).toBe(60000);
      return 1;
    },
    cancel: () => {},
    visibility,
    focus,
    onExpired: () => clears++,
    refresh: () => refreshes++,
  };
  const cleanup = watchOpenrouterCreditsExpiry(
    {
      version: 1,
      status: 'fresh',
      totalCredits: 100,
      totalUsage: 20,
      remainingCredits: 80,
      observedAtMs: now,
    },
    environment
  );
  now += 60000;
  expires();
  expect(clears).toBe(1);
  expect(refreshes).toBe(0);
  cleanup();
  const nextCleanup = watchOpenrouterCreditsExpiry(emptyOpenrouterCredits(), environment);
  visible = true;
  visibility.dispatchEvent(new Event('visibilitychange'));
  focus.dispatchEvent(new Event('focus'));
  expect(refreshes).toBe(1);
  nextCleanup();
  focus.dispatchEvent(new Event('focus'));
  expect(refreshes).toBe(1);
});
