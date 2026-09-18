import { QuotaMeter } from './QuotaMeter';
import { ClaudeConnection } from './ClaudeConnection';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { useConfigStore } from '@/stores';
import { filterRouterAccounts, routerPolicy, type RouterFilter } from '@/services/api/untitled';
import { AccountPools } from './AccountPoolsSection';
import { ProviderMark } from './ProviderMark';
import { CreditBalance } from './CreditBalance';
import { CursorIntegration } from './CursorIntegration';
import { cursorIntegrationState } from './cursorIntegrationState';
import { useUntitledOverview } from './useUntitledOverview';
import styles from './UntitledDashboardPage.module.scss';

export function UntitledDashboardPage() {
  const { t, i18n } = useTranslation();
  const {
    accounts,
    claudeAccounts,
    claudeCheckedAt,
    claudeLoading,
    claudeError,
    checkedAt,
    loading,
    error,
    routingError,
    configLoading,
    refresh,
    cursorUsage,
    openrouterCredits,
  } = useUntitledOverview();
  const config = useConfigStore((state) => state.config);
  const cursorState = cursorIntegrationState(config, {
    loading: configLoading,
    error: routingError,
  });
  const [filter, setFilter] = useState<RouterFilter>('all');
  const visible = filterRouterAccounts(accounts, filter);
  const active = accounts.filter((account) => account.status === 'active').length;
  const success = accounts.reduce((count, account) => count + account.success, 0);
  const failed = accounts.reduce((count, account) => count + account.failed, 0);
  const { strategy, affinity } = routerPolicy(routingError ? null : config);
  const strategyLabel =
    strategy === 'round-robin'
      ? t('untitled.round_robin')
      : strategy === 'fill-first'
        ? t('untitled.fill_first')
        : (strategy ?? t('untitled.unavailable'));
  const time = (value: number) =>
    new Date(value).toLocaleTimeString(i18n.language, {
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
    });
  const hasSnapshot = checkedAt !== null;
  return (
    <div className={styles.dashboard}>
      <section className={styles.heading}>
        <div>
          <div className={styles.eyebrow}>{t('untitled.workspace')}</div>
          <h1>{t('untitled.overview')}</h1>
          <p>{t('untitled.subtitle')}</p>
        </div>
        <div className={styles.headingActions}>
          <span>
            {checkedAt
              ? t('untitled.checked', { time: time(checkedAt) })
              : t('untitled.awaiting_data')}
          </span>
          <Button variant="secondary" size="sm" onClick={() => void refresh()} loading={loading}>
            {t('untitled.refresh')}
          </Button>
        </div>
      </section>
      {error && (
        <div role="alert" className={styles.alert}>
          {t(hasSnapshot ? 'untitled.refresh_error' : 'untitled.load_error')}
        </div>
      )}
      <section className={styles.summary} aria-label={t('untitled.summary')}>
        <div>
          <span>{t('untitled.active_connections')}</span>
          <strong>
            {hasSnapshot ? String(active).padStart(2, '0') : '—'}
            <small>/ {hasSnapshot ? accounts.length : '—'}</small>
          </strong>
          <p>{t('untitled.codex_oauth')}</p>
        </div>
        <div>
          <span>{t('untitled.successful_requests')}</span>
          <strong>{hasSnapshot ? success.toLocaleString(i18n.language) : '—'}</strong>
          <p>{t('untitled.counter_scope')}</p>
        </div>
        <div>
          <span>{t('untitled.failed_requests')}</span>
          <strong>{hasSnapshot ? failed.toLocaleString(i18n.language) : '—'}</strong>
          <p>{t('untitled.counter_scope')}</p>
        </div>
        <div className={styles.routingStat}>
          <span>{t('untitled.routing')}</span>
          <strong>{strategyLabel}</strong>
          <p role={routingError ? 'status' : undefined}>
            {t(
              routingError
                ? 'untitled.routing_unavailable'
                : affinity === true
                  ? 'untitled.affinity_on'
                  : affinity === false
                    ? 'untitled.affinity_off'
                    : 'untitled.affinity_unknown'
            )}
          </p>
        </div>
      </section>
      <AccountPools
        claudeAccounts={claudeAccounts}
        claudeCheckedAt={claudeCheckedAt}
        claudeLoading={claudeLoading}
        claudeError={claudeError}
        accounts={accounts}
        loading={loading}
        error={error}
        checkedAt={checkedAt}
        cursorState={cursorState}
        cursorUsage={cursorUsage}
        openrouterCredits={openrouterCredits}
      />
      <section aria-labelledby="router-pool-heading">
        <div className={styles.sectionHeading}>
          <div>
            <h2 id="router-pool-heading">{t('untitled.connected_accounts')}</h2>
            <p>{t('untitled.pool_description')}</p>
          </div>
          <Link to="/auth-files">
            {t('untitled.manage_accounts')} <span aria-hidden="true">↗</span>
          </Link>
        </div>
        <div className={styles.filters} role="group" aria-label={t('untitled.filter_accounts')}>
          <span>{t('untitled.filter_accounts')}</span>
          {(
            [
              'all',
              'pro',
              'prolite',
              'business',
              ...(accounts.some((account) => account.plan === 'other') ? ['other'] : []),
            ] as RouterFilter[]
          ).map((value) => (
            <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>
              {t(`untitled.filter_${value}`)}
              <span>{filterRouterAccounts(accounts, value).length}</span>
            </button>
          ))}
        </div>
        <div className={styles.accounts} aria-busy={loading}>
          <CursorIntegration state={cursorState} usage={cursorUsage} />
          {claudeError && (
            <p role="status" className={styles.quotaError}>
              {t('untitled.claude_refresh_failed')}
            </p>
          )}
          {claudeLoading && claudeCheckedAt === null && (
            <p role="status">{t('untitled.claude_loading')}</p>
          )}
          {claudeAccounts.map((account) => (
            <ClaudeConnection key={account.key} account={account} unavailable={claudeError} />
          ))}
          {visible.map((account) => (
            <article
              className={`${styles.account} ${account.plan === 'business' ? styles.business : ''}`}
              key={account.key}
            >
              <header>
                <div className={styles.accountIdentity}>
                  <div className={styles.accountIcon} aria-hidden="true">
                    <ProviderMark provider="openai" />
                  </div>
                  <div>
                    <h3>{t(`untitled.plan_${account.plan}`)}</h3>
                    <p>{t('untitled.codex_subscription')}</p>
                  </div>
                </div>
                <span
                  className={`${styles.status} ${account.status === 'active' ? styles.active : ''}`}
                >
                  <i />
                  {t(`untitled.status_${account.status}`)}
                </span>
              </header>
              <div className={styles.quotaHeading}>
                <span>{t('untitled.available_capacity')}</span>
                <span>{t('untitled.provider_reported')}</span>
              </div>
              <QuotaMeter label={t('untitled.five_hour')} window={account.quota.fiveHour} />
              <QuotaMeter label={t('untitled.weekly')} window={account.quota.weekly} />
              <CreditBalance credits={account.credits} />
              {account.quotaError && (
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
                    ? t('untitled.checked', { time: time(account.checkedAt) })
                    : t('untitled.not_checked')}
                </span>
                <Link to="/quota">
                  {t('untitled.quota_details')} <span aria-hidden="true">↗</span>
                </Link>
              </footer>
            </article>
          ))}
          {visible.length === 0 && (
            <div className={styles.empty}>
              <h3>
                {t(
                  loading && !hasSnapshot
                    ? 'untitled.loading'
                    : error && !hasSnapshot
                      ? 'untitled.load_error'
                      : 'untitled.empty_title'
                )}
              </h3>
              <p>
                {t(loading && !hasSnapshot ? 'untitled.loading_detail' : 'untitled.empty_detail')}
              </p>
              <Link to="/oauth">
                {t('untitled.connect_account')} <span aria-hidden="true">→</span>
              </Link>
            </div>
          )}
        </div>
      </section>
      <footer className={styles.pageFooter}>
        <span>{t('untitled.refresh_note')}</span>
        <Link to="/dashboard">
          {t('untitled.standard_dashboard')} <span aria-hidden="true">↗</span>
        </Link>
      </footer>
    </div>
  );
}
