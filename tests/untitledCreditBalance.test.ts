import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { CreditBalance } from '@/features/untitled/CreditBalance';
import { normalizeRouterCredits } from '@/services/api/untitled';
import en from '@/i18n/locales/en.json';

const i18n = createInstance();
await i18n.init({ lng: 'en', resources: { en: { translation: en } } });
const render = (credits: unknown) =>
  renderToStaticMarkup(
    createElement(
      I18nextProvider,
      { i18n },
      createElement(CreditBalance, {
        credits: normalizeRouterCredits({ credits }),
      })
    )
  );

describe('Untitled credit balance rendering', () => {
  test('renders provider numbers with a credit label, including zero and fractional balances', () => {
    for (const [balance, formatted] of [
      ['2500', '2,500'],
      ['0', '0'],
      ['-2.5', '-2.5'],
    ]) {
      const markup = render({ balance });
      expect(markup).toContain('Codex / Work credits');
      expect(markup).toContain(`<strong>${formatted}</strong>`);
      expect(markup).not.toContain('$');
    }
  });
  test('describes a Business balance that is available but not reported without inventing a number', () => {
    const markup = render({ has_credits: true, balance: null });
    expect(markup).toContain('<strong>Available</strong>');
    expect(markup).toContain('provider does not report the balance');
    expect(markup).not.toContain('25,000');
    expect(markup).not.toContain('<strong>0</strong>');
  });
  test('keeps unavailable and unlimited distinct', () => {
    expect(render(null)).toContain('<strong>Unavailable</strong>');
    expect(render({ unlimited: true })).toContain('<strong>Unlimited</strong>');
  });
});
