import { useTranslation } from 'react-i18next';
import type { RouterCredits } from '@/services/api/untitled';
import styles from './UntitledDashboardPage.module.scss';

export function CreditBalance({ credits }: { credits: RouterCredits }) {
  const { t, i18n } = useTranslation();
  const value =
    credits.kind === 'balance'
      ? credits.balance.toLocaleString(i18n.language, { maximumFractionDigits: 20 })
      : t(`untitled.credits_${credits.kind}`);
  return (
    <div className={styles.credits}>
      <div className={styles.meterLabel}>
        <span>{t('untitled.credit_balance')}</span>
        <strong>{value}</strong>
      </div>
      <p className={styles.creditNote}>
        {t(
          credits.kind === 'available'
            ? 'untitled.credit_balance_not_reported'
            : 'untitled.credits_scope'
        )}
      </p>
    </div>
  );
}
