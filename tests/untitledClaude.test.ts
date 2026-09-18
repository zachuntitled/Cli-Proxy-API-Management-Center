import { afterEach, expect, spyOn, test } from 'bun:test';
import { authFilesApi } from '@/services/api/authFiles';
import { apiCallApi } from '@/services/api/apiCall';
import { claudeOverviewApi } from '@/services/api/claudeOverview';

const spies: { mockRestore: () => void }[] = [];
afterEach(() => spies.splice(0).forEach((spy) => spy.mockRestore()));
const file = {
  name: 'secret-filename',
  provider: 'claude',
  authIndex: 'claude-index',
  email: ' person@example.com ',
  account: 'secret-key',
  status: 'active',
  successCount: 3,
  failureCount: 2,
};
function setup(files = [file], profileFails = false, usageFails = false) {
  spies.push(spyOn(authFilesApi, 'list').mockResolvedValue({ files }));
  const request = spyOn(apiCallApi, 'request').mockImplementation(async (payload) => {
    const profile = payload.url.endsWith('/profile');
    if ((profile && profileFails) || (!profile && usageFails)) throw new Error('Unavailable');
    return {
      statusCode: 200,
      header: {},
      bodyText: '',
      body: profile
        ? { account: { has_claude_max: true } }
        : {
            five_hour: { utilization: 5 },
            seven_day: { utilization: 100 },
            iguana_necktie: { utilization: 12 },
          },
    };
  });
  spies.push(request);
  return request;
}
test('loads Claude via established reader with safe identity and abort configuration', async () => {
  const request = setup();
  const signal = new AbortController().signal;
  const [account] = await claudeOverviewApi.listAccounts(signal);
  expect(account).toMatchObject({
    email: 'person@example.com',
    planType: 'plan_max',
    status: 'active',
    success: 3,
    failed: 2,
    quotaError: false,
  });
  expect(account.windows.map((window) => window.usedPercent)).toEqual([5, 100, 12]);
  expect(JSON.stringify(account)).not.toContain('secret');
  expect(
    request.mock.calls.every(
      ([payload, options]) =>
        payload.authIndex === 'claude-index' &&
        options?.signal === signal &&
        options?.timeout === 20000
    )
  ).toBe(true);
});
test('disabled and missing-index accounts skip usage requests', async () => {
  const request = setup([
    { ...file, disabled: true },
    { ...file, authIndex: '' },
  ] as (typeof file)[]);
  const accounts = await claudeOverviewApi.listAccounts(new AbortController().signal);
  expect(request).not.toHaveBeenCalled();
  expect(
    accounts.every((account) => account.windows.length === 0 && account.checkedAt === null)
  ).toBe(true);
});
test('usage failure preserves identity; profile failure preserves valid windows', async () => {
  setup([file], false, true);
  const [failed] = await claudeOverviewApi.listAccounts(new AbortController().signal);
  expect(failed).toMatchObject({ email: 'person@example.com', windows: [], quotaError: true });
  spies.splice(0).forEach((spy) => spy.mockRestore());
  setup([file], true);
  const [healthy] = await claudeOverviewApi.listAccounts(new AbortController().signal);
  expect(healthy.windows).toHaveLength(3);
  expect(healthy.planType).toBeNull();
  expect(healthy.quotaError).toBe(false);
});
test('an aborted load rejects without exposing a snapshot', async () => {
  setup();
  const controller = new AbortController();
  controller.abort();
  await expect(claudeOverviewApi.listAccounts(controller.signal)).rejects.toThrow('Aborted');
});

test('does not derive identity from credential metadata and excludes other providers', async () => {
  setup([
    { ...file, email: '' },
    { ...file, provider: 'codex' },
  ]);
  const accounts = await claudeOverviewApi.listAccounts(new AbortController().signal);
  expect(accounts).toHaveLength(1);
  expect(accounts[0].email).toBeNull();
  expect(JSON.stringify(accounts)).not.toContain('secret');
});

test('late quota results reject after cancellation', async () => {
  setup();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const request = spyOn(apiCallApi, 'request').mockImplementation(async () => {
    await pending;
    return { statusCode: 200, header: {}, bodyText: '', body: { seven_day: { utilization: 10 } } };
  });
  spies.push(request);
  const controller = new AbortController();
  const result = claudeOverviewApi.listAccounts(controller.signal);
  await Promise.resolve();
  controller.abort();
  release();
  await expect(result).rejects.toThrow('Aborted');
});
