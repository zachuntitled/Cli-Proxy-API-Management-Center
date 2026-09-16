import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { emptyCursorUsage, expireCursorUsage, type CursorUsage } from '@/services/api/cursorUsage';
import type { CursorIntegrationState } from './cursorIntegrationState';
import { ProviderMark } from './ProviderMark';
import styles from './UntitledDashboardPage.module.scss';

export function CursorIntegration({
  state,
  usage = emptyCursorUsage(),
}: {
  state: CursorIntegrationState;
  usage?: CursorUsage | { status: 'loading' };
}) {
  const { t, i18n } = useTranslation();
  const current =
    state !== 'configured'
      ? emptyCursorUsage()
      : usage.status === 'loading'
        ? usage
        : expireCursorUsage(usage);
  const data = current.status === 'fresh' || current.status === 'stale' ? current : null;
  const percent = (value: number) =>
    new Intl.NumberFormat(i18n.language, {
      style: 'percent',
      maximumFractionDigits: 2,
    }).format(value / 100);
  const date = (value: number) =>
    new Date(value).toLocaleString(i18n.language, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  const pools = [
    { id: 'cursor', value: data?.cursorPercentUsed ?? null },
    { id: 'other', value: data?.otherPercentUsed ?? null },
  ] as const;
  return (
    <article className={`${styles.account} ${styles.cursorAccount}`}>
      <header>
        <div className={styles.accountIdentity}>
          <div className={styles.accountIcon} aria-hidden="true">
            <ProviderMark provider="cursor" />
          </div>
          <div>
            <h3>{t('untitled.cursor_name')}</h3>
            <p>{t('untitled.cursor_subscription')}</p>
          </div>
        </div>
        <span className={styles.status}>{t(`untitled.cursor_status_${state}`)}</span>
      </header>
      <div className={styles.cursorDetails}>
        <p>{t(`untitled.cursor_detail_${state}`)}</p>
        <p role="status">{t(`untitled.cursor_usage_${current.status}`)}</p>
        {data && (
          <div className={styles.cursorPools}>
            {pools.map(({ id, value }) => {
              const label = t(`untitled.cursor_usage_${id}_models`);
              const used =
                value === null
                  ? t('untitled.unavailable')
                  : t('untitled.cursor_usage_used', { value: percent(value) });
              return (
                <section className={styles.cursorPool} key={id}>
                  <div className={styles.cursorPoolHeading}>
                    <h4>{label}</h4>
                    <span>{used}</span>
                  </div>
                  {id === 'cursor' && <p>{t('untitled.cursor_usage_includes')}</p>}
                  {value !== null && (
                    <div
                      className={`${styles.cursorBar} ${id === 'other' ? styles.cursorOtherBar : ''}`}
                      role="progressbar"
                      aria-label={label}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.min(100, value)}
                      aria-valuetext={used}
                    >
                      <span style={{ width: `${Math.min(100, value)}%` }} />
                    </div>
                  )}
                  <p>{t(`untitled.cursor_usage_${id}_overflow`)}</p>
                </section>
              );
            })}
            {(data.cursorPercentUsed === null || data.otherPercentUsed === null) && (
              <p>{t('untitled.cursor_usage_partial')}</p>
            )}
            <div className={styles.cursorTimes}>
              <p>
                {data.cycleEndMs !== null
                  ? t('untitled.cursor_usage_resets', { time: date(data.cycleEndMs) })
                  : t('untitled.reset_unavailable')}
              </p>
              {data.observedAtMs !== null && (
                <p>{t('untitled.cursor_usage_observed', { time: date(data.observedAtMs) })}</p>
              )}
            </div>
          </div>
        )}
      </div>
      <footer>
        <Link to="/ai-providers">
          {t('untitled.provider_settings')} <span aria-hidden="true">→</span>
        </Link>
      </footer>
    </article>
  );
}
