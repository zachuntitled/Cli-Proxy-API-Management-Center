import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { CursorIntegrationState } from './cursorIntegrationState';
import styles from './UntitledDashboardPage.module.scss';

export function CursorIntegration({ state }: { state: CursorIntegrationState }) {
  const { t } = useTranslation();
  return (
    <article className={`${styles.account} ${styles.cursorAccount}`}>
      <header>
        <div className={styles.accountIdentity}>
          <div className={styles.accountIcon} aria-hidden="true">
            ↗
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
        <p>{t('untitled.cursor_quota_unavailable')}</p>
      </div>
      <footer>
        <Link to="/ai-providers">
          {t('untitled.provider_settings')} <span aria-hidden="true">→</span>
        </Link>
      </footer>
    </article>
  );
}
