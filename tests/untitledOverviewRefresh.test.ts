import { describe, expect, mock, test } from 'bun:test';
import { refreshUntitledOverview } from '@/features/untitled/refreshUntitledOverview';
import { normalizeRouterAccount, type RouterAccountSnapshot } from '@/services/api/untitled';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((fulfill, fail) => {
    resolve = fulfill;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function createRefresh() {
  const accounts = deferred<RouterAccountSnapshot[]>();
  const config = deferred<unknown>();
  const controller = new AbortController();
  const isCurrent = mock(() => true);
  const onAccounts = mock((_accounts: RouterAccountSnapshot[]) => {});
  const onAccountsError = mock(() => {});
  const onRoutingError = mock((_failed: boolean) => {});
  const finished = refreshUntitledOverview({
    signal: controller.signal,
    isCurrent,
    loadAccounts: () => accounts.promise,
    loadConfig: () => config.promise,
    onAccounts,
    onAccountsError,
    onRoutingError,
  });
  return {
    accounts,
    config,
    controller,
    isCurrent,
    onAccounts,
    onAccountsError,
    onRoutingError,
    finished,
  };
}

const healthyAccounts: RouterAccountSnapshot[] = [
  {
    ...normalizeRouterAccount({
      name: 'example',
      provider: 'codex',
      status: 'active',
      successCount: 7,
    }),
    quota: {
      fiveHour: { remaining: null, resetAt: null },
      weekly: { remaining: 50, resetAt: null },
    },
    credits: { kind: 'unavailable' },
    quotaError: false,
    checkedAt: 1,
  },
];

describe('Untitled overview refresh', () => {
  test('commits healthy account data when routing configuration fails', async () => {
    const refresh = createRefresh();
    refresh.config.reject(new Error('Config endpoint unavailable'));
    refresh.accounts.resolve(healthyAccounts);
    await refresh.finished;

    expect(refresh.onAccounts).toHaveBeenCalledWith(healthyAccounts);
    expect(refresh.onAccountsError).not.toHaveBeenCalled();
    expect(refresh.onRoutingError).toHaveBeenCalledWith(true);
  });

  test('commits account data before a slow configuration read completes', async () => {
    const refresh = createRefresh();
    refresh.accounts.resolve(healthyAccounts);
    await refresh.accounts.promise;

    expect(refresh.onAccounts).toHaveBeenCalledWith(healthyAccounts);
    expect(refresh.onRoutingError).not.toHaveBeenCalled();

    refresh.config.resolve({});
    await refresh.finished;
    expect(refresh.onRoutingError).toHaveBeenCalledWith(false);
  });

  test('reports account failure without replacing the existing account snapshot', async () => {
    const refresh = createRefresh();
    refresh.accounts.reject(new Error('Account endpoint unavailable'));
    refresh.config.resolve({});
    await refresh.finished;

    expect(refresh.onAccounts).not.toHaveBeenCalled();
    expect(refresh.onAccountsError).toHaveBeenCalledTimes(1);
    expect(refresh.onRoutingError).toHaveBeenCalledWith(false);
  });

  test('reports both resources independently when both reads fail', async () => {
    const refresh = createRefresh();
    refresh.accounts.reject(new Error('Account endpoint unavailable'));
    refresh.config.reject(new Error('Config endpoint unavailable'));
    await refresh.finished;

    expect(refresh.onAccounts).not.toHaveBeenCalled();
    expect(refresh.onAccountsError).toHaveBeenCalledTimes(1);
    expect(refresh.onRoutingError).toHaveBeenCalledWith(true);
  });

  test('ignores late account success and config failure after abort', async () => {
    const refresh = createRefresh();
    refresh.controller.abort();
    refresh.accounts.resolve(healthyAccounts);
    refresh.config.reject(new Error('Late configuration failure'));
    await refresh.finished;

    expect(refresh.onAccounts).not.toHaveBeenCalled();
    expect(refresh.onAccountsError).not.toHaveBeenCalled();
    expect(refresh.onRoutingError).not.toHaveBeenCalled();
  });

  test('ignores late account failure and config success from an obsolete session or generation', async () => {
    const refresh = createRefresh();
    refresh.isCurrent.mockReturnValue(false);
    refresh.accounts.reject(new Error('Late account failure'));
    refresh.config.resolve({});
    await refresh.finished;

    expect(refresh.onAccounts).not.toHaveBeenCalled();
    expect(refresh.onAccountsError).not.toHaveBeenCalled();
    expect(refresh.onRoutingError).not.toHaveBeenCalled();
  });
});
