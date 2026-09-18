import type { ClaudeAccountSnapshot } from '@/services/api/claudeOverview';
import { useTranslation } from 'react-i18next';
import type { RouterAccountSnapshot } from '@/services/api/untitled';
import { expireCursorUsage, type CursorUsage } from '@/services/api/cursorUsage';
import {
  expireOpenrouterCredits,
  type OpenrouterCreditsState,
} from '@/services/api/openrouterCredits';
import type { CursorIntegrationState } from './cursorIntegrationState';
import { claudePool, codexPool, cursorPools, openrouterPool } from './accountPools';
import { ProviderMark } from './ProviderMark';
import styles from './AccountPoolsSection.module.scss';

export interface AccountPoolsProps {
  accounts: RouterAccountSnapshot[];
  claudeAccounts?: ClaudeAccountSnapshot[];
  claudeLoading?: boolean;
  claudeError?: boolean;
  claudeCheckedAt?: number | null;
  loading: boolean;
  error: boolean;
  checkedAt: number | null;
  cursorState: CursorIntegrationState;
  cursorUsage: CursorUsage | { status: 'loading' };
  openrouterCredits: OpenrouterCreditsState;
}
function PoolMeter({
  value,
  maximum,
  fill,
  label,
  text,
}: {
  value: number | null;
  maximum: number;
  fill: number | null;
  label: string;
  text: string;
}) {
  if (value === null || fill === null)
    return <div className={styles.unknownTrack} aria-hidden="true" />;
  return (
    <div
      className={styles.track}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={maximum}
      aria-valuenow={value}
      aria-valuetext={text}
    >
      <span style={{ width: `${fill}%` }} />
    </div>
  );
}
export function AccountPools({
  accounts,
  claudeAccounts = [],
  claudeLoading = false,
  claudeError = false,
  claudeCheckedAt = null,
  loading,
  error,
  checkedAt,
  cursorState,
  cursorUsage,
  openrouterCredits,
}: AccountPoolsProps) {
  const { t, i18n } = useTranslation();
  const percent = (value: number) =>
    new Intl.NumberFormat(i18n.language, { style: 'percent', maximumFractionDigits: 2 }).format(
      value / 100
    );
  const money = (value: number) =>
    new Intl.NumberFormat(i18n.language, { style: 'currency', currency: 'USD' }).format(value);
  const claude = claudePool(claudeError || claudeCheckedAt === null ? [] : claudeAccounts);
  const codex = codexPool(error || checkedAt === null ? [] : accounts);
  const usage = cursorUsage.status === 'loading' ? cursorUsage : expireCursorUsage(cursorUsage);
  const cursor = cursorPools(cursorState === 'configured' ? usage : { status: 'loading' });
  const credits =
    'observedAtMs' in openrouterCredits
      ? expireOpenrouterCredits(openrouterCredits)
      : openrouterCredits;
  const openrouter = openrouterPool(credits);
  const codexText =
    codex.remaining === null
      ? t('untitled.unavailable')
      : t('untitled.pools_remaining', { value: percent(codex.remaining) });
  const creditText =
    openrouter.remaining === null
      ? t('untitled.unavailable')
      : t('untitled.pools_remaining', { value: money(openrouter.remaining) });
  const codexNote = () => {
    if (error) return t('untitled.pools_refresh_failed');
    if (loading && checkedAt === null) return t('untitled.loading');
    if (codex.total === 0) return t('untitled.pools_no_accounts');
    if (codex.partial)
      return t('untitled.pools_partial', { known: codex.known, total: codex.total });
    return t('untitled.pools_accounts', { count: codex.total });
  };
  return (
    <section aria-labelledby="account-pools-heading">
      <div className={styles.heading}>
        <h2 id="account-pools-heading">{t('untitled.pools_title')}</h2>
        <p>{t('untitled.pools_description')}</p>
      </div>
      <div className={styles.grid}>
        <article className={styles.codex}>
          <h3>
            <ProviderMark provider="openai" />
            Codex
          </h3>
          <p className={styles.label}>{t('untitled.pools_weekly')}</p>
          <div className={styles.value}>
            {codex.remaining === null ? '—' : percent(codex.remaining)}
          </div>
          <p className={styles.caption}>
            {codex.total
              ? t('untitled.pools_of', { value: percent(codex.maximum) })
              : t('untitled.unavailable')}
          </p>
          <PoolMeter
            value={codex.remaining}
            maximum={codex.maximum}
            fill={codex.fill}
            label={t('untitled.pools_codex_meter')}
            text={codexText}
          />
          <p className={styles.note}>{codexNote()}</p>
        </article>
        <article className={styles.claude}>
          <h3>
            <ProviderMark provider="claude" />
            Claude Code
          </h3>
          <p className={styles.label}>{t('untitled.pools_weekly')}</p>
          <div className={styles.value}>
            {claude.remaining === null ? '—' : percent(claude.remaining)}
          </div>
          <p className={styles.caption}>
            {claude.total
              ? t('untitled.pools_of', { value: percent(claude.maximum) })
              : t('untitled.unavailable')}
          </p>
          <PoolMeter
            value={claude.remaining}
            maximum={claude.maximum}
            fill={claude.fill}
            label={t('untitled.pools_claude_meter')}
            text={
              claude.remaining === null
                ? t('untitled.unavailable')
                : t('untitled.pools_remaining', { value: percent(claude.remaining) })
            }
          />
          <p className={styles.note}>
            {claudeError
              ? t('untitled.pools_refresh_failed')
              : claudeLoading && claudeCheckedAt === null
                ? t('untitled.loading')
                : claude.total === 0
                  ? t('untitled.pools_no_claude_accounts')
                  : claude.partial
                    ? t('untitled.pools_partial', { known: claude.known, total: claude.total })
                    : t('untitled.pools_accounts', { count: claude.total })}
          </p>
        </article>
        <article className={styles.cursor}>
          <h3>
            <ProviderMark provider="cursor" />
            Cursor
          </h3>
          <div className={styles.cursorValues}>
            {(['cursor', 'other'] as const).map((id) => {
              const value = cursor[id];
              const label = t(`untitled.cursor_usage_${id}_models`);
              const text =
                value === null
                  ? t('untitled.unavailable')
                  : t('untitled.pools_remaining', { value: percent(value) });
              return (
                <div key={id}>
                  <p className={styles.label}>{label}</p>
                  <div className={styles.value}>{value === null ? '—' : percent(value)}</div>
                  <p className={styles.caption}>{t('untitled.pools_remaining_label')}</p>
                  <PoolMeter
                    value={value}
                    maximum={100}
                    fill={value}
                    label={t('untitled.pools_cursor_meter', { name: label })}
                    text={text}
                  />
                </div>
              );
            })}
          </div>
          <p className={styles.note}>
            {cursorState !== 'configured'
              ? t(`untitled.cursor_status_${cursorState}`)
              : t(`untitled.cursor_usage_${usage.status}`)}
          </p>
          {cursorState === 'configured' &&
            ['fresh', 'stale'].includes(usage.status) &&
            (cursor.cursor === null || cursor.other === null) && (
              <p className={styles.note}>{t('untitled.cursor_usage_partial')}</p>
            )}
        </article>
        <article className={styles.openrouter}>
          <h3>
            <ProviderMark provider="openrouter" />
            OpenRouter
          </h3>
          <p className={styles.label}>{t('untitled.pools_credit_balance')}</p>
          <div className={styles.value}>
            {openrouter.remaining === null ? '—' : money(openrouter.remaining)}
          </div>
          <p className={styles.caption}>
            {openrouter.maximum === null
              ? t('untitled.unavailable')
              : t('untitled.pools_purchased', { value: money(openrouter.maximum) })}
          </p>
          <PoolMeter
            value={openrouter.fill}
            maximum={100}
            fill={openrouter.fill}
            label={t('untitled.pools_openrouter_meter')}
            text={creditText}
          />
          <p className={styles.note}>{t(`untitled.pools_credits_${credits.status}`)}</p>
        </article>
      </div>
    </section>
  );
}
