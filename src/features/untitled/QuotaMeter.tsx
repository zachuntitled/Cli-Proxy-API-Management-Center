import { useTranslation } from 'react-i18next';
import type { RouterWindow } from '@/services/api/untitled';
import styles from './UntitledDashboardPage.module.scss';

export function QuotaMeter({ window, label }: { window: RouterWindow; label: string }) {
  const { t, i18n } = useTranslation();
  const remaining = window.remaining;
  const reset =
    window.resetAt === null
      ? null
      : new Date(window.resetAt).toLocaleString(i18n.language, {
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        });
  return (
    <div className={styles.meter}>
      <div className={styles.meterLabel}>
        <span>{label}</span>
        <strong>
          {remaining === null
            ? t('untitled.unavailable')
            : t('untitled.percent_remaining', { value: Math.round(remaining) })}
        </strong>
      </div>
      {remaining === null ? (
        <div className={styles.emptyTrack} aria-hidden="true" />
      ) : (
        <div
          className={styles.track}
          role="meter"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={remaining}
          aria-valuetext={t('untitled.percent_remaining', { value: Math.round(remaining) })}
        >
          <span className={remaining <= 15 ? styles.low : ''} style={{ width: `${remaining}%` }} />
        </div>
      )}
      <div className={styles.reset}>
        {reset ? t('untitled.resets', { time: reset }) : t('untitled.reset_unavailable')}
      </div>
    </div>
  );
}
