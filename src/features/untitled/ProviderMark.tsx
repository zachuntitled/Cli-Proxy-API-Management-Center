import openaiLight from '@/assets/icons/openai-light.svg';
import openaiDark from '@/assets/icons/openai-dark.svg';
// Official app icon: https://cursor.com/marketing-static/favicon.svg (2026-09-16).
import cursor from '@/assets/icons/cursor.svg';
// Official glyphs: https://openrouter.ai/brand/v2/ (2026-09-16).
import openrouterLight from '@/assets/icons/openrouter-light.svg';
import openrouterDark from '@/assets/icons/openrouter-dark.svg';
import styles from './ProviderMark.module.scss';

/** Decorative marks; the adjacent provider heading supplies the accessible name. */
export function ProviderMark({ provider }: { provider: 'openai' | 'cursor' | 'openrouter' }) {
  return (
    <span className={styles.mark} aria-hidden="true">
      {provider === 'cursor' ? (
        <img src={cursor} alt="" />
      ) : (
        <>
          <img className={styles.light} src={provider === 'openrouter' ? openrouterLight : openaiLight} alt="" />
          <img className={styles.dark} src={provider === 'openrouter' ? openrouterDark : openaiDark} alt="" />
        </>
      )}
    </span>
  );
}
