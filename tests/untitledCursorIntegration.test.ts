import { describe, expect, test } from 'bun:test';
import { cursorIntegrationState } from '@/features/untitled/cursorIntegrationState';
import type { Config, OpenAIProviderConfig } from '@/types';

const provider: OpenAIProviderConfig = {
  name: 'cursor-subscription',
  baseUrl: 'http://127.0.0.1:18317/v1',
  apiKeyEntries: [{ apiKey: 'test-only-placeholder' }],
  models: [{ name: 'cursor/example-model' }],
};
const configured: Config = { openaiCompatibility: [provider] };
const ready = { loading: false, error: false };

describe('Cursor integration configuration state', () => {
  test('failed and pending config reads never reuse a configured snapshot', () => {
    expect(cursorIntegrationState(configured, { ...ready, error: true })).toBe('unavailable');
    expect(cursorIntegrationState(configured, { ...ready, loading: true })).toBe('unavailable');
    expect(cursorIntegrationState(null, ready)).toBe('unavailable');
  });

  test('requires the explicitly named provider, a URL, credential and model', () => {
    expect(cursorIntegrationState(configured, ready)).toBe('configured');
    for (const patch of [
      { name: 'other-provider' },
      { baseUrl: ' ' },
      { apiKeyEntries: [] },
      { apiKeyEntries: [{ apiKey: ' ' }] },
      { models: [] },
      { models: [{ name: ' ' }] },
    ]) {
      expect(
        cursorIntegrationState({ openaiCompatibility: [{ ...provider, ...patch }] }, ready)
      ).toBe('not_configured');
    }
    expect(cursorIntegrationState({}, ready)).toBe('not_configured');
  });

  test('distinguishes disabled providers from configured and absent routes', () => {
    expect(
      cursorIntegrationState({ openaiCompatibility: [{ ...provider, disabled: true }] }, ready)
    ).toBe('disabled');
    expect(
      cursorIntegrationState(
        { openaiCompatibility: [{ ...provider, disabled: true }, provider] },
        ready
      )
    ).toBe('configured');
  });
});

import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { CursorIntegration } from '@/features/untitled/CursorIntegration';
import { UntitledDashboardPage } from '@/features/untitled/UntitledDashboardPage';
import type { CursorIntegrationState } from '@/features/untitled/cursorIntegrationState';
import en from '@/i18n/locales/en.json';
import zhCN from '@/i18n/locales/zh-CN.json';
import zhTW from '@/i18n/locales/zh-TW.json';
import ru from '@/i18n/locales/ru.json';

const i18n = createInstance();
await i18n.init({ lng: 'en', resources: { en: { translation: en } } });
const renderElement = (element: ReactElement) =>
  renderToStaticMarkup(
    createElement(I18nextProvider, { i18n }, createElement(MemoryRouter, {}, element))
  );

const render = (state: CursorIntegrationState) =>
  renderElement(createElement(CursorIntegration, { state }));

describe('Cursor integration presentation', () => {
  test('missing route links to provider settings for the isolated integration', () => {
    const markup = render('not_configured');
    expect(markup).toContain('href="/ai-providers"');
    expect(markup).not.toContain('href="/plugins"');
  });

  test('configured route links to provider settings without claiming quota or health', () => {
    const markup = render('configured');
    expect(markup).toContain('<span>Configured</span>');
    expect(markup).toContain('href="/ai-providers"');
    expect(markup).not.toContain('href="/plugins"');
    expect(markup).toContain('does not verify service health');
    expect(markup).toContain('Usage unavailable.');
    expect(markup).not.toContain('role="meter"');
  });

  test('disabled and unavailable routes never display configured status', () => {
    for (const state of ['disabled', 'unavailable'] as const) {
      const markup = render(state);
      expect(markup).not.toContain('<span>Configured</span>');
      expect(markup).toContain(
        state === 'disabled' ? '<span>Disabled</span>' : '<span>Unavailable</span>'
      );
      expect(markup).toContain('href="/ai-providers"');
    }
  });

  test('all four locales include the configuration states and quota limitation', () => {
    for (const locale of [en, zhCN, zhTW, ru]) {
      for (const state of ['configured', 'disabled', 'unavailable', 'not_configured'] as const) {
        expect(locale.untitled[`cursor_status_${state}`].trim()).not.toBe('');
        expect(locale.untitled[`cursor_detail_${state}`].trim()).not.toBe('');
      }
      expect(locale.untitled.cursor_quota_unavailable.trim()).not.toBe('');
    }
  });
});

describe('Cursor in the main dashboard', () => {
  test('renders Cursor once inside Connections', () => {
    const markup = renderElement(createElement(UntitledDashboardPage));
    const start = markup.indexOf('aria-labelledby="router-pool-heading"');
    expect(start).toBeGreaterThanOrEqual(0);
    const end = markup.indexOf('</section>', start);
    expect(end).toBeGreaterThan(start);
    const connections = markup.slice(start, end);
    expect(connections).toContain('Cursor Pro+');
    expect(markup.match(/Cursor Pro\+/g)).toHaveLength(1);
    expect(markup).toContain('<h2 id="router-pool-heading">Connections</h2>');
    expect(markup).toContain('Active Codex accounts');
    expect(markup).toContain('Successful Codex requests');
    expect(markup).toContain('Failed Codex requests');
    expect(markup).toContain('Filter Codex accounts');
  });

  test('the Cursor card uses a full account header and always exposes provider settings', () => {
    const markup = render('configured');
    expect(markup).toContain('<header>');
    expect(markup).toContain('<footer>');
    expect(markup).toContain('Cursor subscription');
    expect(markup).toContain('href="/ai-providers"');
  });
});

const observedAtMs = Date.now();
const usage = {
  version: 1 as const,
  status: 'fresh' as const,
  cursorPercentUsed: 0.4491666667,
  otherPercentUsed: 0.4909090909,
  observedAtMs,
  cycleStartMs: observedAtMs - 1000,
  cycleEndMs: observedAtMs + 1000000,
};

describe('Cursor subscription pools', () => {
  test('renders two used-percentage bars, precise small values, captions and times', () => {
    const markup = renderElement(createElement(CursorIntegration, { state: 'configured', usage }));
    expect(markup.match(/role="progressbar"/g)).toHaveLength(2);
    for (const text of [
      'Cursor Models',
      'Other Models',
      'Includes Cursor Grok and Composer',
      '0.45% used',
      '0.49% used',
      'Additional usage beyond limits consumes Other Models quota or on-demand spend.',
      'Additional usage beyond limits consumes on-demand spend.',
      'Last observed',
      'Resets',
    ])
      expect(markup).toContain(text);
    expect(markup).toContain('aria-valuenow="0.4491666667"');
    expect(markup).toContain('width:0.4491666667%');
  });
  test('partial usage stays unknown and over-100 readouts clamp only their bar', () => {
    const markup = renderElement(
      createElement(CursorIntegration, {
        state: 'configured',
        usage: {
          ...usage,
          cursorPercentUsed: null,
          otherPercentUsed: 125.1234,
        },
      })
    );
    expect(markup.match(/role="progressbar"/g)).toHaveLength(1);
    expect(markup).toContain('125.12% used');
    expect(markup).toContain('width:100%');
    expect(markup).toContain('aria-valuenow="100"');
    expect(markup).toContain('aria-valuetext="125.12% used"');
    expect(markup).toContain('Some usage data is unavailable');
  });
  test('loading, auth, stale, unavailable and disabled states are distinct', () => {
    for (const [status, text] of [
      ['loading', 'Loading usage'],
      ['auth_required', 'Sign in to Cursor'],
      ['unavailable', 'Usage unavailable'],
      ['stale', 'Stale usage'],
    ] as const) {
      const markup = renderElement(
        createElement(CursorIntegration, { state: 'configured', usage: { ...usage, status } })
      );
      expect(markup).toContain(text);
      expect(markup.match(/role="progressbar"/g)?.length ?? 0).toBe(status === 'stale' ? 2 : 0);
    }
    expect(
      renderElement(createElement(CursorIntegration, { state: 'disabled', usage }))
    ).not.toContain('0.45%');
  });
  test('renders translated accessible pool names and locale-aware percentages in every locale', async () => {
    for (const [lng, locale] of Object.entries({ en, 'zh-CN': zhCN, 'zh-TW': zhTW, ru })) {
      const local = createInstance();
      await local.init({ lng, resources: { [lng]: { translation: locale } } });
      const markup = renderToStaticMarkup(
        createElement(
          I18nextProvider,
          { i18n: local },
          createElement(
            MemoryRouter,
            {},
            createElement(CursorIntegration, { state: 'configured', usage })
          )
        )
      );
      expect(markup).not.toContain('untitled.cursor_usage_');
      expect(markup.match(/role="progressbar"/g)).toHaveLength(2);
      expect(markup).toContain(`aria-label="${locale.untitled.cursor_usage_cursor_models}"`);
      expect(markup).toContain(
        new Intl.NumberFormat(lng, { style: 'percent', maximumFractionDigits: 2 }).format(
          0.4491666667 / 100
        )
      );
    }
  });
});

test('expired snapshots cannot render values even before a delayed resume callback runs', () => {
  for (const expired of [
    { ...usage, observedAtMs: Date.now() - 60000 },
    { ...usage, status: 'stale' as const, observedAtMs: Date.now() - 300000 },
    { ...usage, cycleEndMs: Date.now() - 1 },
  ]) {
    const markup = renderElement(
      createElement(CursorIntegration, { state: 'configured', usage: expired })
    );
    expect(markup).toContain('Usage unavailable');
    expect(markup).not.toContain('role="progressbar"');
    expect(markup).not.toContain('0.45%');
    expect(markup).not.toContain('Last observed');
  }
});
