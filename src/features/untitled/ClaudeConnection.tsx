import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { ClaudeAccountSnapshot } from '@/services/api/claudeOverview';
import { ProviderMark } from './ProviderMark';
import { QuotaMeter } from './QuotaMeter';
import { remainingPercent } from './quotaFormat';
import styles from './UntitledDashboardPage.module.scss';

export function ClaudeConnection({
  account,
  unavailable = false,
}: {
  account: ClaudeAccountSnapshot;
  unavailable?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const noQuota = unavailable || account.quotaError || account.status === 'disabled';
  return (
    <article className={styles.account}>
      <header>
        <div className={styles.accountIdentity}>
          <div className={styles.accountIcon}>
            <ProviderMark provider="claude" />
          </div>
          <div>
            <h3>Claude Code</h3>
            <p>{account.email ?? t('untitled.claude_account')}</p>
            {account.planType && <p>{t(`claude_quota.${account.planType}`)}</p>}
          </div>
        </div>
        <span className={`${styles.status} ${account.status === 'active' ? styles.active : ''}`}>
          <i />
          {t(`untitled.status_${account.status}`)}
        </span>
      </header>
      <div className={styles.quotaHeading}>
        <span>{t('untitled.available_capacity')}</span>
        <span>{t('untitled.provider_reported')}</span>
      </div>
      {account.windows.length ? (
        account.windows.map((window) => (
          <QuotaMeter
            key={window.id}
            label={window.labelKey ? t(window.labelKey) : window.label}
            window={{
              remaining: noQuota ? null : remainingPercent(window.usedPercent),
              resetAt: noQuota ? null : (window.resetAtMs ?? null),
            }}
          />
        ))
      ) : (
        <QuotaMeter label={t('untitled.weekly')} window={{ remaining: null, resetAt: null }} />
      )}
      {(unavailable || account.quotaError) && (
        <p className={styles.quotaError}>{t('untitled.quota_error')}</p>
      )}
      <div className={styles.accountCounters}>
        <div>
          <span>{t('untitled.success')}</span>
          <strong>{account.success.toLocaleString(i18n.language)}</strong>
        </div>
        <div>
          <span>{t('untitled.failed')}</span>
          <strong>{account.failed.toLocaleString(i18n.language)}</strong>
        </div>
        <span>{t('untitled.counter_scope')}</span>
      </div>
      <footer>
        <span>
          {account.checkedAt
            ? t('untitled.checked', {
                time: new Date(account.checkedAt).toLocaleTimeString(i18n.language, {
                  hour: 'numeric',
                  minute: '2-digit',
                  second: '2-digit',
                }),
              })
            : t('untitled.not_checked')}
        </span>
        <Link to="/auth-files">
          {t('untitled.quota_details')} <span aria-hidden="true">↗</span>
        </Link>
      </footer>
    </article>
  );
}
