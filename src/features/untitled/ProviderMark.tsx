import openaiLight from '@/assets/icons/openai-light.svg';
import openaiDark from '@/assets/icons/openai-dark.svg';
// Official app icon: https://cursor.com/marketing-static/favicon.svg (2026-09-16).
import cursor from '@/assets/icons/cursor.svg';
import styles from './ProviderMark.module.scss';

/** Decorative marks; the adjacent provider heading supplies the accessible name. */
export function ProviderMark({ provider }: { provider: 'openai' | 'cursor' }) {
  return (
    <span className={styles.mark} aria-hidden="true">
      {provider === 'cursor' ? (
        <img src={cursor} alt="" />
      ) : (
        <>
          <img className={styles.light} src={openaiLight} alt="" />
          <img className={styles.dark} src={openaiDark} alt="" />
        </>
      )}
    </span>
  );
}
