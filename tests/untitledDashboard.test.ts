import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { authFilesApi } from '@/services/api/authFiles';
import { apiCallApi } from '@/services/api/apiCall';
import {
  normalizeRouterAccount,
  normalizeRouterQuota,
  filterRouterAccounts,
  untitledApi,
  routerPolicy,
} from '@/services/api/untitled';

describe('Untitled dashboard data', () => {
  test('identifies Business without showing auth files or account identifiers', () => {
    const account = normalizeRouterAccount({
      name: 'secret-file.json',
      authIndex: 'a',
      provider: 'codex',
      status: 'active',
      id_token: { plan_type: 'team', chatgpt_account_id: 'private-id' },
      successCount: 8,
    });
    expect(account.plan).toBe('business');
    expect(account.status).toBe('active');
    expect(account.success).toBe(8);
    expect(JSON.stringify(account)).not.toContain('private-id');
    expect(JSON.stringify(account)).not.toContain('secret-file');
  });
  test('disabled and unavailable credentials are not active', () => {
    expect(normalizeRouterAccount({ name: 'a', disabled: true, status: 'active' }).status).toBe(
      'disabled'
    );
    expect(normalizeRouterAccount({ name: 'a', unavailable: true, status: 'active' }).status).toBe(
      'unavailable'
    );
    expect(normalizeRouterAccount({ name: 'a' }).status).toBe('unknown');
  });
  test('classifies weekly primary windows by duration, not position', () => {
    const quota = normalizeRouterQuota({
      rate_limit: {
        primary_window: { limit_window_seconds: 604800, used_percent: 44, reset_at: 1800000000 },
      },
    });
    expect(quota.weekly.remaining).toBe(56);
    expect(quota.weekly.resetAt).toBe(1800000000000);
    expect(quota.fiveHour.remaining).toBeNull();
  });
  test('absent and invalid quota is unavailable, even when limit reached', () => {
    for (const payload of [
      null,
      {},
      { rate_limit: { limit_reached: true } },
      { rate_limit: { primary_window: { limit_window_seconds: 18000, used_percent: 'bad' } } },
    ]) {
      expect(normalizeRouterQuota(payload).fiveHour.remaining).toBeNull();
    }
  });
  test('zero usage means full capacity and exhausted usage means zero', () => {
    const quota = normalizeRouterQuota({
      rate_limit: {
        primary_window: { limit_window_seconds: 18000, used_percent: 0 },
        secondary_window: { limit_window_seconds: 604800, used_percent: 100 },
      },
    });
    expect(quota.fiveHour.remaining).toBe(100);
    expect(quota.weekly.remaining).toBe(0);
  });
  test('filters keep real accounts only and support empty pools', () => {
    const accounts = [
      normalizeRouterAccount({ name: 'a', id_token: { plan_type: 'pro' } }),
      normalizeRouterAccount({ name: 'b', id_token: { plan_type: 'team' } }),
    ];
    expect(filterRouterAccounts(accounts, 'business')).toEqual([accounts[1]]);
    expect(filterRouterAccounts(accounts, 'all')).toHaveLength(2);
    expect(filterRouterAccounts([], 'pro')).toEqual([]);
  });
});

afterEach(() => mock.restore());

describe('Untitled gateway reads', () => {
  test('requests only Codex quota and selects the matching credential', async () => {
    spyOn(authFilesApi, 'list').mockResolvedValue({
      files: [
        {
          name: 'business.json',
          provider: 'codex',
          authIndex: 'example-index',
          status: 'active',
          id_token: { plan_type: 'team', chatgpt_account_id: 'example-workspace' },
        },
        { name: 'other.json', provider: 'gemini' },
      ],
    });
    const request = spyOn(apiCallApi, 'request').mockResolvedValue({
      statusCode: 200,
      header: {},
      bodyText: '',
      body: { rate_limit: { primary_window: { limit_window_seconds: 18000, used_percent: 10 } } },
    });
    const result = await untitledApi.listAccounts(new AbortController().signal);
    expect(result).toHaveLength(1);
    expect(result[0].plan).toBe('business');
    expect(result[0].quota.fiveHour.remaining).toBe(90);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toMatchObject({
      authIndex: 'example-index',
      method: 'GET',
      header: { Authorization: 'Bearer $TOKEN$', 'Chatgpt-Account-Id': 'example-workspace' },
    });
  });
  test('fetches quota by auth index without an account ID header', async () => {
    spyOn(authFilesApi, 'list').mockResolvedValue({
      files: [{ name: 'pro.json', provider: 'codex', authIndex: 'example-index', status: 'active' }],
    });
    const request = spyOn(apiCallApi, 'request').mockResolvedValue({
      statusCode: 200,
      header: {},
      bodyText: '',
      body: { rate_limit: { primary_window: { limit_window_seconds: 18000, used_percent: 25 } } },
    });
    const [account] = await untitledApi.listAccounts(new AbortController().signal);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toMatchObject({
      authIndex: 'example-index',
      method: 'GET',
      header: { Authorization: 'Bearer $TOKEN$' },
    });
    expect(request.mock.calls[0][0].header).not.toHaveProperty('Chatgpt-Account-Id');
    expect(account.quota.fiveHour.remaining).toBe(75);
    expect(account.quotaError).toBe(false);
    expect(account.checkedAt).toBeNumber();
  });
  test.each([
    [{ plan_type: ' PRO ' }, 'team', 'pro'],
    [{ planType: ' Team ' }, 'pro', 'business'],
    [{ plan_type: 'BUSINESS' }, 'pro', 'business'],
    [{ plan_type: 'plus' }, 'pro', 'other'],
    [{}, 'team', 'business'],
    [{ plan_type: null }, 'pro', 'pro'],
    [{ planType: ' ' }, 'pro', 'pro'],
  ])('prefers normalized usage plan %j over file plan %s', async (usage, filePlan, expected) => {
    spyOn(authFilesApi, 'list').mockResolvedValue({
      files: [
        {
          name: 'account.json',
          provider: 'codex',
          authIndex: 'example-index',
          status: 'active',
          id_token: { plan_type: filePlan, chatgpt_account_id: 'example-workspace' },
        },
      ],
    });
    spyOn(apiCallApi, 'request').mockResolvedValue({
      statusCode: 200,
      header: {},
      bodyText: '',
      body: usage,
    });
    const [account] = await untitledApi.listAccounts(new AbortController().signal);
    expect(account.plan).toBe(expected);
    expect(filterRouterAccounts([account], account.plan)).toEqual([account]);
  });
  test('upstream errors leave quota unavailable instead of reusing a full meter', async () => {
    spyOn(authFilesApi, 'list').mockResolvedValue({
      files: [
        {
          name: 'pro.json',
          provider: 'codex',
          authIndex: 'example-index',
          status: 'active',
          id_token: { plan_type: 'pro', chatgpt_account_id: 'example-workspace' },
        },
      ],
    });
    spyOn(apiCallApi, 'request').mockResolvedValue({
      statusCode: 429,
      header: {},
      bodyText: '',
      body: {},
    });
    const [account] = await untitledApi.listAccounts(new AbortController().signal);
    expect(account.quotaError).toBe(true);
    expect(account.quota.weekly.remaining).toBeNull();
    expect(account.checkedAt).toBeNull();
  });
  test('an aborted connection cannot start quota requests after its list resolves', async () => {
    const controller = new AbortController();
    spyOn(authFilesApi, 'list').mockImplementation(async () => {
      controller.abort();
      return { files: [] };
    });
    const request = spyOn(apiCallApi, 'request');
    await expect(untitledApi.listAccounts(controller.signal)).rejects.toThrow('Aborted');
    expect(request).not.toHaveBeenCalled();
  });
  test('missing credentials never fall back to a random account for quota', async () => {
    spyOn(authFilesApi, 'list').mockResolvedValue({
      files: [
        {
          name: 'a',
          provider: 'codex',
          status: 'active',
          id_token: { chatgpt_account_id: 'example-workspace' },
        },
      ],
    });
    const request = spyOn(apiCallApi, 'request');
    const [account] = await untitledApi.listAccounts(new AbortController().signal);
    expect(account.quota.fiveHour.remaining).toBeNull();
    expect(request).not.toHaveBeenCalled();
  });
  test('routing policy reads omitted affinity as false for a loaded routing object', () => {
    expect(
      routerPolicy({
        routingStrategy: 'round-robin',
        raw: { routing: { strategy: 'round-robin' } },
      })
    ).toEqual({ strategy: 'round-robin', affinity: false });
  });
  test('routing policy preserves explicit boolean affinity', () => {
    for (const affinity of [false, true]) {
      expect(
        routerPolicy({
          routingStrategy: 'round-robin',
          raw: { routing: { strategy: 'round-robin', 'session-affinity': affinity } },
        })
      ).toEqual({ strategy: 'round-robin', affinity });
    }
  });
  test('routing policy preserves unknown affinity for missing or malformed routing', () => {
    expect(routerPolicy(null)).toEqual({ strategy: undefined, affinity: null });
    expect(routerPolicy({})).toEqual({ strategy: undefined, affinity: null });
    expect(routerPolicy({ raw: {} })).toEqual({ strategy: undefined, affinity: null });
    for (const routing of [undefined, null, false, 'round-robin', []]) {
      expect(routerPolicy({ raw: { routing } }).affinity).toBeNull();
    }
    for (const affinity of [undefined, null, 'false', 0, {}, []]) {
      expect(
        routerPolicy({ raw: { routing: { 'session-affinity': affinity } } }).affinity
      ).toBeNull();
    }
  });
});
