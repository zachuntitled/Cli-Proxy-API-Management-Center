import { expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { AccountPools, type AccountPoolsProps } from '@/features/untitled/AccountPoolsSection';
import type { RouterAccountSnapshot } from '@/services/api/untitled';
import en from '@/i18n/locales/en.json';
import zhCN from '@/i18n/locales/zh-CN.json';
import zhTW from '@/i18n/locales/zh-TW.json';
import ru from '@/i18n/locales/ru.json';
const now = Date.now();
const defaults: AccountPoolsProps = {
  accounts: [99, 99, 15].map(
    (remaining) =>
      ({ quota: { weekly: { remaining } }, status: 'unavailable' }) as RouterAccountSnapshot
  ),
  loading: false,
  error: false,
  checkedAt: now,
  cursorState: 'configured',
  cursorUsage: {
    version: 1,
    status: 'fresh',
    cursorPercentUsed: 0.57,
    otherPercentUsed: 0.49,
    observedAtMs: now,
    cycleStartMs: null,
    cycleEndMs: null,
  },
  openrouterCredits: {
    version: 1,
    status: 'fresh',
    totalCredits: 100,
    totalUsage: 23.5,
    remainingCredits: 76.5,
    observedAtMs: now,
  },
};
async function render(patch: Partial<AccountPoolsProps> = {}, lng = 'en', locale = en) {
  const i18n = createInstance();
  await i18n.init({ lng, resources: { [lng]: { translation: locale } } });
  return renderToStaticMarkup(
    createElement(I18nextProvider, { i18n }, createElement(AccountPools, { ...defaults, ...patch }))
  );
}
test('renders summed Codex capacity, independent Cursor remaining pools and purchased-credit bar', async () => {
  const markup = await render();
  for (const text of [
    '213%',
    '300%',
    '99.43%',
    '99.51%',
    '$76.50',
    '$100.00',
    'width:71%',
    'width:76.5%',
  ])
    expect(markup).toContain(text);
  expect(markup.match(/role="meter"/g)).toHaveLength(4);
  expect(markup).toContain('aria-valuenow="213"');
  expect(markup).toContain('aria-valuemax="300"');
});
test('partial quota is labeled and failed list refresh does not present retained quota as current', async () => {
  expect(
    await render({
      accounts: [
        ...defaults.accounts,
        { quota: { weekly: { remaining: null } } } as RouterAccountSnapshot,
      ],
    })
  ).toContain('Partial');
  expect(await render({ error: true })).not.toContain('213%');
  expect(await render({ loading: true, checkedAt: null })).not.toContain('213%');
});
test('zero credit is a real balance; unavailable and expired credit never show money', async () => {
  expect(
    await render({
      openrouterCredits: {
        ...defaults.openrouterCredits,
        totalCredits: 0,
        totalUsage: 0,
        remainingCredits: 0,
      } as never,
    })
  ).toContain('$0.00');
  for (const credits of [
    { status: 'unavailable' },
    { ...defaults.openrouterCredits, observedAtMs: now - 60000 },
  ]) {
    const markup = await render({ openrouterCredits: credits as never });
    expect(markup).not.toContain('$76.50');
    expect(markup).not.toContain('$0.00');
  }
});
test('disabled Cursor hides values and stale Cursor is labeled', async () => {
  expect(await render({ cursorState: 'disabled' })).not.toContain('99.43%');
  expect(
    await render({ cursorUsage: { ...defaults.cursorUsage, status: 'stale' } as never })
  ).toContain('Stale usage');
});
test('all locales render translated meter names and explanatory labels', async () => {
  for (const [lng, locale] of Object.entries({ en, 'zh-CN': zhCN, 'zh-TW': zhTW, ru })) {
    const markup = await render({}, lng, locale);
    expect(markup).not.toContain('untitled.');
    expect(markup.match(/role="meter"/g)).toHaveLength(4);
  }
});

test('credit route states stay distinct and zero purchased credits use a valid normalized meter', async () => {
  for (const [status, text] of [
    ['loading', 'Loading credit balance'],
    ['disabled', 'OpenRouter is disabled'],
    ['not_configured', 'OpenRouter is not configured'],
    ['auth_required', 'Check your OpenRouter API key'],
  ] as const) {
    const markup = await render({ openrouterCredits: { status } as never });
    expect(markup).toContain(text);
    expect(markup).not.toContain('$76.50');
  }
  const zero = await render({
    openrouterCredits: {
      ...defaults.openrouterCredits,
      totalCredits: 0,
      totalUsage: 0,
      remainingCredits: 0,
    } as never,
  });
  expect(zero).not.toContain('aria-valuemax="0"');
  expect(zero).toContain('aria-valuetext="$0.00 remaining"');
});
