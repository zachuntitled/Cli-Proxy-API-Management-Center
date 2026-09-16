import { describe, expect, mock, test } from 'bun:test';
import { watchCursorUsageExpiry } from '@/features/untitled/watchCursorUsageExpiry';
import { emptyCursorUsage, type CursorUsage } from '@/services/api/cursorUsage';

const fresh: CursorUsage = {
  version: 1,
  status: 'fresh',
  cursorPercentUsed: 0.52,
  otherPercentUsed: 0.49,
  observedAtMs: 1000,
  cycleStartMs: 1,
  cycleEndMs: 1000000,
};

function watch(usage = fresh, start = 60000) {
  let now = start;
  let visible = true;
  let deadline: number | null = null;
  let callback: (() => void) | null = null;
  const visibility = new EventTarget();
  const focus = new EventTarget();
  const events: string[] = [];
  const onExpired = mock(() => {
    events.push('clear');
  });
  const refresh = mock(() => {
    events.push('request');
  });
  const cancel = mock((_timer: number) => {
    callback = null;
  });
  const dispose = watchCursorUsageExpiry(usage, {
    now: () => now,
    isVisible: () => visible,
    schedule: (fn, delay) => {
      callback = fn;
      deadline = now + delay;
      return 1;
    },
    cancel,
    visibility,
    focus,
    onExpired,
    refresh,
  });
  return {
    onExpired,
    refresh,
    cancel,
    dispose,
    events,
    get deadline() {
      return deadline;
    },
    advance: (time: number) => {
      now = time;
      if (deadline !== null && now >= deadline) callback?.();
    },
    hide: () => {
      visible = false;
      visibility.dispatchEvent(new Event('visibilitychange'));
    },
    resume: () => {
      visible = true;
      visibility.dispatchEvent(new Event('visibilitychange'));
      focus.dispatchEvent(new Event('focus'));
    },
    focus: () => focus.dispatchEvent(new Event('focus')),
  };
}

describe('Cursor observation expiry and resume', () => {
  test('refetches at t=61s after the t=60s poll returns an observation made at t=1s', () => {
    const lifecycle = watch();
    expect(lifecycle.deadline).toBe(61000);
    lifecycle.advance(60999);
    lifecycle.focus();
    expect(lifecycle.events).toEqual([]);
    lifecycle.advance(61000);
    expect(lifecycle.events).toEqual(['clear', 'request']);
    lifecycle.resume();
    lifecycle.advance(120000);
    expect(lifecycle.refresh).toHaveBeenCalledTimes(1);
    lifecycle.dispose();
  });

  test('clears hidden expired values and refetches immediately on visible resume only once', () => {
    const lifecycle = watch();
    lifecycle.hide();
    lifecycle.advance(90000);
    expect(lifecycle.events).toEqual(['clear']);
    lifecycle.resume();
    expect(lifecycle.events).toEqual(['clear', 'request']);
    lifecycle.dispose();
  });

  test('resume after the cleared snapshot was rendered still requests new usage', () => {
    const lifecycle = watch(emptyCursorUsage(), 90000);
    expect(lifecycle.deadline).toBeNull();
    lifecycle.resume();
    expect(lifecycle.events).toEqual(['request']);
    lifecycle.dispose();
  });

  test('stale data never survives its five-minute bound or billing reset', () => {
    for (const cycleEndMs of [1000000, 120000]) {
      const lifecycle = watch({ ...fresh, status: 'stale', cycleEndMs });
      const expiry = Math.min(301000, cycleEndMs);
      expect(lifecycle.deadline).toBe(expiry);
      lifecycle.advance(expiry);
      expect(lifecycle.events).toEqual(['clear', 'request']);
      lifecycle.dispose();
    }
  });

  test('cleanup removes listeners and timer so unmounted or replaced observations cannot refresh', () => {
    const lifecycle = watch();
    lifecycle.dispose();
    lifecycle.advance(90000);
    lifecycle.resume();
    expect(lifecycle.cancel).toHaveBeenCalledWith(1);
    expect(lifecycle.events).toEqual([]);
  });
});
