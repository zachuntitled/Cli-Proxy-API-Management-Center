import { expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { ClaudeConnection } from '@/features/untitled/ClaudeConnection';
import { AccountPools } from '@/features/untitled/AccountPoolsSection';
import type { ClaudeAccountSnapshot } from '@/services/api/claudeOverview';
import en from '@/i18n/locales/en.json';
const i18n = createInstance();
await i18n.init({ lng: 'en', resources: { en: { translation: en } } });
const account: ClaudeAccountSnapshot = {
  key: 'fixture',
  email: 'person@example.test',
  status: 'active',
  planType: 'plan_max',
  success: 2,
  failed: 0,
  checkedAt: 1000,
  quotaError: false,
  windows: [
    {
      id: 'five-hour',
      label: 'ignored',
      labelKey: 'claude_quota.five_hour',
      usedPercent: 5,
      resetLabel: '',
      resetAtMs: 1900000000000,
    },
    { id: 'seven-day', label: 'Weekly', usedPercent: 1, resetLabel: '' },
    { id: 'seven-day-fable', label: 'Fable 5 weekly', usedPercent: 0, resetLabel: '' },
  ],
};
const render = (element: ReturnType<typeof createElement>) =>
  renderToStaticMarkup(
    createElement(I18nextProvider, { i18n }, createElement(MemoryRouter, {}, element))
  );
test('Claude connection renders identity, plan, all windows, real remaining values and reset', () => {
  const html = render(createElement(ClaudeConnection, { account }));
  for (const text of [
    'Claude Code',
    'person@example.test',
    'Max',
    '95% remaining',
    '99% remaining',
    '100% remaining',
    'Fable 5 weekly',
    'Resets',
  ])
    expect(html).toContain(text);
  expect(html.match(/role="meter"/g)?.length).toBe(3);
  expect(html).toContain('aria-valuenow="95"');
  expect(html).not.toContain('ignored');
});
test('Claude missing, disabled and failed quota never renders a full meter', () => {
  for (const props of [
    { account: { ...account, windows: [] } },
    { account: { ...account, status: 'disabled' as const } },
    { account: { ...account, quotaError: true } },
    { account, unavailable: true },
  ]) {
    const html = render(createElement(ClaudeConnection, props));
    expect(html).toContain('Unavailable');
    expect(html).not.toContain('role="meter"');
  }
});
test('Claude pool uses weekly percentage and suppresses stale values after a refresh error', () => {
  const props = {
    accounts: [],
    loading: false,
    error: false,
    checkedAt: 1000,
    claudeAccounts: [account],
    claudeCheckedAt: 1000,
    cursorState: 'not_configured' as const,
    cursorUsage: { status: 'loading' as const },
    openrouterCredits: { status: 'unavailable' as const },
  };
  const html = render(createElement(AccountPools, props));
  expect(html).toContain('aria-label="Claude Code weekly remaining capacity"');
  expect(html).toContain('aria-valuenow="99"');
  expect(render(createElement(AccountPools, { ...props, claudeError: true }))).not.toContain(
    'aria-valuenow="99"'
  );
});

test('Claude pool explicitly reports partial weekly coverage', () => {
  const html = render(
    createElement(AccountPools, {
      accounts: [],
      loading: false,
      error: false,
      checkedAt: 1000,
      claudeAccounts: [account, { ...account, key: 'missing', windows: [] }],
      claudeCheckedAt: 1000,
      cursorState: 'not_configured',
      cursorUsage: { status: 'loading' },
      openrouterCredits: { status: 'unavailable' },
    })
  );
  expect(html).toContain('aria-valuenow="99"');
  expect(html).toContain('aria-valuemax="200"');
  expect(html).toContain('1 of 2');
});
test('Claude connections stay outside the Codex plan filter', async () => {
  const source = await Bun.file(
    new URL('../src/features/untitled/UntitledDashboardPage.tsx', import.meta.url)
  ).text();
  expect(source).toContain('const visible = filterRouterAccounts(accounts, filter)');
  expect(source).toContain('claudeAccounts.map((account)');
  expect(source).toContain('const active = accounts.filter(');
});
