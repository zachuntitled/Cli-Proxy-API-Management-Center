import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { CursorIntegrationState } from './cursorIntegrationState';
import styles from './UntitledDashboardPage.module.scss';

export function CursorIntegration({ state }: { state: CursorIntegrationState }) {
  const { t } = useTranslation();
  return (
    <article>
      <div className={styles.integrationIcon} aria-hidden="true">
        ↗
      </div>
      <div>
        <h3>
          {t('untitled.cursor_name')}
          <span>{t(`untitled.cursor_status_${state}`)}</span>
        </h3>
        <p>{t(`untitled.cursor_detail_${state}`)}</p>
        <p>{t('untitled.cursor_quota_unavailable')}</p>
        <Link to="/ai-providers">
          {t('untitled.provider_settings')}{' '}
          <span aria-hidden="true">→</span>
        </Link>
      </div>
    </article>
  );
}
