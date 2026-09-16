import { describe, expect, spyOn, test } from 'bun:test';
import {
  cursorUsageApi,
  normalizeCursorUsage,
  expireCursorUsage,
} from '@/services/api/cursorUsage';
import { apiClient } from '@/services/api/client';
import { cursorUsageRoute, sameCursorUsageRoute } from '@/features/untitled/cursorIntegrationState';
import { refreshCursorUsage } from '@/features/untitled/refreshCursorUsage';

const now = 1800000000000;
const body = {
  version: 1,
  status: 'fresh',
  cursorPercentUsed: 0.4491666667,
  otherPercentUsed: 0.4909090909,
  observedAtMs: now,
  cycleStartMs: now - 1000,
  cycleEndMs: now + 1000000,
};
const route = {
  name: 'cursor-subscription',
  baseUrl: 'http://127.0.0.1:18317/v1',
  apiKeyEntries: [{ apiKey: 'test-placeholder' }],
  models: [{ name: 'cursor/example' }],
};

describe('Cursor usage normalization and freshness', () => {
  test('keeps percentage points and only allowlisted fields', () => {
    expect(normalizeCursorUsage({ ...body, secret: 'must-not-survive' }, now)).toEqual(body);
    expect(
      normalizeCursorUsage({ ...body, cursorPercentUsed: 0, otherPercentUsed: 140 }, now)
    ).toMatchObject({ cursorPercentUsed: 0, otherPercentUsed: 140 });
  });
  test('invalid pools are independently missing, never zero', () => {
    for (const value of [-1, true, '0.4', NaN, Infinity, null, undefined]) {
      expect(normalizeCursorUsage({ ...body, cursorPercentUsed: value }, now)).toMatchObject({
        status: 'fresh',
        cursorPercentUsed: null,
        otherPercentUsed: body.otherPercentUsed,
      });
    }
    expect(
      normalizeCursorUsage({ ...body, cursorPercentUsed: false, otherPercentUsed: '1' }, now).status
    ).toBe('unavailable');
  });
  test('invalid contracts and non-data states never carry account values', () => {
    for (const input of [
      null,
      {},
      'raw',
      { ...body, version: 2 },
      { ...body, status: 'error' },
      { ...body, observedAtMs: null },
      { ...body, observedAtMs: now + 5001 },
    ]) {
      expect(normalizeCursorUsage(input, now)).toMatchObject({
        status: 'unavailable',
        cursorPercentUsed: null,
        observedAtMs: null,
      });
    }
    for (const status of ['auth_required', 'unavailable']) {
      expect(normalizeCursorUsage({ ...body, status }, now)).toMatchObject({
        status,
        cursorPercentUsed: null,
        otherPercentUsed: null,
        observedAtMs: null,
        cycleEndMs: null,
      });
    }
  });
  test('expires fresh snapshots at 60 seconds, bridge stale snapshots at five minutes or cycle end', () => {
    expect(normalizeCursorUsage({ ...body, observedAtMs: now + 5000 }, now).status).toBe('fresh');
    const fresh = normalizeCursorUsage(body, now);
    expect(expireCursorUsage(fresh, now + 59999).status).toBe('fresh');
    expect(expireCursorUsage(fresh, now + 60000).status).toBe('unavailable');
    const stale = normalizeCursorUsage({ ...body, status: 'stale' }, now);
    expect(expireCursorUsage(stale, now + 299999).status).toBe('stale');
    expect(expireCursorUsage(stale, now + 300000).cursorPercentUsed).toBeNull();
    expect(normalizeCursorUsage({ ...body, cycleEndMs: now }, now).status).toBe('unavailable');
    expect(normalizeCursorUsage({ ...body, status: 'stale', cycleEndMs: null }, now).status).toBe(
      'unavailable'
    );
    expect(expireCursorUsage({ ...stale, cycleEndMs: now + 10 }, now + 10).status).toBe(
      'unavailable'
    );
  });
});

describe('Cursor usage request chain', () => {
  test('uses real apiCallApi normalization with fixed direct loopback and no auth index', async () => {
    const live = {
      ...body,
      observedAtMs: Date.now(),
      cycleStartMs: Date.now() - 1000,
      cycleEndMs: Date.now() + 1000000,
    };
    const post = spyOn(apiClient, 'post').mockResolvedValue({
      status_code: 200,
      body: JSON.stringify(live),
    });
    const controller = new AbortController();
    try {
      expect(await cursorUsageApi.get(controller.signal)).toEqual(live);
      expect(post).toHaveBeenCalledWith(
        '/api-call',
        {
          method: 'GET',
          url: 'http://127.0.0.1:18318/usage',
          proxy_url: 'direct',
        },
        { signal: controller.signal, timeout: 15000 }
      );
      post.mockResolvedValue({ status_code: 401, body: 'untrusted upstream body' });
      expect(await cursorUsageApi.get()).toMatchObject({
        status: 'auth_required',
        cursorPercentUsed: null,
      });
      post.mockResolvedValue({ status_code: 500, body: JSON.stringify(live) });
      expect((await cursorUsageApi.get()).status).toBe('unavailable');
      post.mockResolvedValue({ status_code: 200, body: '{bad-json' });
      expect((await cursorUsageApi.get()).status).toBe('unavailable');
      post.mockRejectedValue(new Error('transport-failure'));
      expect((await cursorUsageApi.get()).status).toBe('unavailable');
    } finally {
      post.mockRestore();
    }
  });
});

describe('Cursor route association', () => {
  test('requires a unique enabled expected loopback route with credential and model', () => {
    expect(cursorUsageRoute({ openaiCompatibility: [route] })).toEqual(route);
    for (const patch of [
      { disabled: true },
      { name: 'Cursor' },
      { baseUrl: 'https://example.com/v1' },
      { baseUrl: 'http://127.0.0.1:18317/v1?x=1' },
      { apiKeyEntries: [] },
      { models: [] },
    ]) {
      expect(cursorUsageRoute({ openaiCompatibility: [{ ...route, ...patch }] })).toBeNull();
    }
    expect(cursorUsageRoute({ openaiCompatibility: [route, route] })).toBeNull();
    expect(
      cursorUsageRoute({ openaiCompatibility: [route, { ...route, disabled: true }] })
    ).toEqual(route);
    expect(
      cursorUsageRoute({ openaiCompatibility: [{ ...route, baseUrl: 'http://127.0.0.1:18317' }] })
    ).not.toBeNull();
    expect(sameCursorUsageRoute(route, { ...route })).toBe(true);
    expect(
      sameCursorUsageRoute(route, { ...route, apiKeyEntries: [{ apiKey: 'replacement' }] })
    ).toBe(false);
  });
});

describe('independent Cursor resource commits', () => {
  test('clears values on failure and ignores late canceled or obsolete success', async () => {
    for (const stale of ['abort', 'session', 'route']) {
      let resolve!: (value: ReturnType<typeof normalizeCursorUsage>) => void;
      const promise = new Promise<ReturnType<typeof normalizeCursorUsage>>((r) => {
        resolve = r;
      });
      const abort = new AbortController();
      let current = true;
      const committed: unknown[] = [];
      const finished = refreshCursorUsage({
        signal: abort.signal,
        isCurrent: () => current,
        load: () => promise,
        onUsage: (usage) => committed.push(usage),
      });
      if (stale === 'abort') abort.abort();
      else current = false;
      resolve(normalizeCursorUsage(body, now));
      await finished;
      expect(committed).toEqual([]);
    }
    let committed = normalizeCursorUsage(body, now);
    await refreshCursorUsage({
      signal: new AbortController().signal,
      isCurrent: () => true,
      load: async () => {
        throw new Error('offline');
      },
      onUsage: (usage) => {
        committed = usage;
      },
    });
    expect(committed).toMatchObject({
      status: 'unavailable',
      cursorPercentUsed: null,
      observedAtMs: null,
    });
  });
});

import { useAuthStore, useConfigStore } from '@/stores';
import { subscribeCursorUsageInvalidation } from '@/features/untitled/cursorUsageInvalidation';

test('store subscriptions invalidate an old request across batched route and session round trips', async () => {
  const storageBefore = useAuthStore.persist.getOptions().storage;
  useAuthStore.persist.setOptions({
    storage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  });
  const authBefore = useAuthStore.getState();
  const configBefore = useConfigStore.getState();
  useAuthStore.setState({
    isAuthenticated: true,
    apiBase: 'test-host',
    managementKey: 'test-only',
  });
  useConfigStore.setState({ config: { openaiCompatibility: [route] } });
  let controller = new AbortController();
  let generation = 0;
  const invalidate = () => {
    controller.abort();
    generation += 1;
  };
  const unsubscribe = subscribeCursorUsageInvalidation(invalidate, invalidate);
  try {
    for (const change of ['route', 'disable', 'credential', 'logout', 'connection']) {
      controller = new AbortController();
      const started = generation;
      let resolve!: (value: ReturnType<typeof normalizeCursorUsage>) => void;
      const pending = new Promise<ReturnType<typeof normalizeCursorUsage>>((r) => {
        resolve = r;
      });
      const results: unknown[] = [];
      const finished = refreshCursorUsage({
        signal: controller.signal,
        isCurrent: () => started === generation,
        load: () => pending,
        onUsage: (usage) => results.push(usage),
      });
      if (change === 'logout') {
        useAuthStore.setState({ isAuthenticated: false });
        useAuthStore.setState({ isAuthenticated: true });
      } else if (change === 'connection') {
        useAuthStore.setState({ apiBase: 'other-host' });
        useAuthStore.setState({ apiBase: 'test-host' });
      } else {
        const replacement =
          change === 'route'
            ? { ...route, baseUrl: 'https://other-host/v1' }
            : change === 'disable'
              ? { ...route, disabled: true }
              : { ...route, apiKeyEntries: [{ apiKey: 'replacement' }] };
        useConfigStore.setState({ config: { openaiCompatibility: [replacement] } });
        useConfigStore.setState({ config: { openaiCompatibility: [route] } });
      }
      resolve(normalizeCursorUsage(body, now));
      await finished;
      expect(controller.signal.aborted).toBe(true);
      expect(results).toEqual([]);
    }
    const previous = generation;
    useConfigStore.setState({ config: { openaiCompatibility: [{ ...route }], requestRetry: 3 } });
    expect(generation).toBe(previous);
  } finally {
    unsubscribe();
    useAuthStore.setState(authBefore);
    useConfigStore.setState(configBefore);
    useAuthStore.persist.setOptions({ storage: storageBefore });
  }
});
