import { expect, test } from 'bun:test';
import {
  createOpenrouterCreditsResource,
  openrouterCreditsRoute,
} from '@/features/untitled/openrouterCreditsState';
import type { OpenrouterCredits } from '@/services/api/openrouterCredits';
const fresh = (): OpenrouterCredits => ({
  version: 1,
  status: 'fresh',
  totalCredits: 100,
  totalUsage: 20,
  remainingCredits: 80,
  observedAtMs: Date.now(),
});
test('deduplicates refresh and discards responses after repeated invalidation', async () => {
  for (const transition of ['A/B/A', 'logout/login', 'removed', 'key changed']) {
    const values: unknown[] = [];
    let resolve!: (value: OpenrouterCredits) => void;
    let calls = 0;
    const resource = createOpenrouterCreditsResource({
      load: () => {
        calls++;
        return new Promise((done) => {
          resolve = done;
        });
      },
      onChange: (value) => values.push(value),
    });
    const pending = resource.refresh();
    await resource.refresh();
    expect(calls).toBe(1);
    resource.invalidate();
    resource.invalidate();
    resolve(fresh());
    await pending;
    expect(values.at(-1), transition).toMatchObject({
      status: 'unavailable',
      remainingCredits: null,
    });
  }
});
test('failed refresh clears a prior value', async () => {
  const values: unknown[] = [];
  let failed = false;
  const resource = createOpenrouterCreditsResource({
    load: async () => {
      if (failed) throw new Error('offline');
      return fresh();
    },
    onChange: (value) => values.push(value),
  });
  await resource.refresh();
  failed = true;
  await resource.refresh();
  expect(values.at(-1)).toMatchObject({ status: 'unavailable', remainingCredits: null });
});
test('only one enabled official route with one key qualifies', () => {
  const route = {
    name: 'openrouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKeyEntries: [{ apiKey: 'placeholder' }],
  };
  expect(openrouterCreditsRoute({ openaiCompatibility: [route] })).toEqual(route);
  for (const routes of [
    [],
    [route, route],
    [{ ...route, disabled: true }],
    [{ ...route, baseUrl: 'https://evil.test' }],
    [{ ...route, apiKeyEntries: [] }],
  ])
    expect(openrouterCreditsRoute({ openaiCompatibility: routes })).toBeNull();
});

test('real store subscriptions invalidate synchronous session and route round trips', async () => {
  const { useAuthStore, useConfigStore } = await import('@/stores');
  const { subscribeOpenrouterCreditsInvalidation } =
    await import('@/features/untitled/openrouterCreditsInvalidation');
  const authBefore = useAuthStore.getState();
  const configBefore = useConfigStore.getState();
  const storageBefore = useAuthStore.persist.getOptions().storage;
  useAuthStore.persist.setOptions({
    storage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  });
  const route = {
    name: 'openrouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKeyEntries: [{ apiKey: 'placeholder' }],
  };
  useAuthStore.setState({ isAuthenticated: true, apiBase: 'test-a', managementKey: 'placeholder' });
  useConfigStore.setState({ config: { openaiCompatibility: [route] } });
  let invalidations = 0;
  const values: unknown[] = [];
  let resolve!: (value: OpenrouterCredits) => void;
  const resource = createOpenrouterCreditsResource({
    load: () =>
      new Promise((done) => {
        resolve = done;
      }),
    onChange: (value) => values.push(value),
  });
  const pending = resource.refresh();
  const invalidate = () => {
    invalidations++;
    resource.invalidate();
  };
  const unsubscribe = subscribeOpenrouterCreditsInvalidation(invalidate, invalidate);
  try {
    for (const field of ['apiBase', 'managementKey', 'isAuthenticated'] as const) {
      const original = useAuthStore.getState()[field];
      useAuthStore.setState({ [field]: field === 'isAuthenticated' ? false : 'changed' });
      useAuthStore.setState({ [field]: original });
    }
    for (const replacement of [
      [],
      [{ ...route, disabled: true }],
      [{ ...route, apiKeyEntries: [{ apiKey: 'changed' }] }],
    ]) {
      useConfigStore.setState({ config: { openaiCompatibility: replacement } });
      useConfigStore.setState({ config: { openaiCompatibility: [route] } });
    }
    expect(invalidations).toBe(12);
    resolve(fresh());
    await pending;
    expect(values.at(-1)).toMatchObject({ status: 'unavailable', remainingCredits: null });
    useConfigStore.setState({ config: { openaiCompatibility: [{ ...route }], requestRetry: 3 } });
    expect(invalidations).toBe(12);
  } finally {
    unsubscribe();
    useAuthStore.setState(authBefore);
    useConfigStore.setState(configBefore);
    useAuthStore.persist.setOptions({ storage: storageBefore });
  }
});
