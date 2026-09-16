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

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { CursorIntegration } from '@/features/untitled/CursorIntegration';
import type { CursorIntegrationState } from '@/features/untitled/cursorIntegrationState';
import en from '@/i18n/locales/en.json';
import zhCN from '@/i18n/locales/zh-CN.json';
import zhTW from '@/i18n/locales/zh-TW.json';
import ru from '@/i18n/locales/ru.json';

const i18n = createInstance();
await i18n.init({ lng: 'en', resources: { en: { translation: en } } });
const render = (state: CursorIntegrationState) =>
  renderToStaticMarkup(
    createElement(
      I18nextProvider,
      { i18n },
      createElement(
        MemoryRouter,
        {},
        createElement(CursorIntegration, { state })
      )
    )
  );

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
    expect(markup).toContain('Subscription remaining: unavailable.');
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
