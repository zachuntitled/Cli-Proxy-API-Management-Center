import { useState } from 'react';
import { NavLink, Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MainRoutes } from '@/router/MainRoutes';
import { PageTransition } from '@/components/common/PageTransition';
import {
  useAuthStore,
  useConfigStore,
  useLanguageStore,
  useThemeStore,
  useNotificationStore,
} from '@/stores';
import { triggerHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { LANGUAGE_ORDER, LANGUAGE_LABEL_KEYS } from '@/utils/constants';
import type { Theme } from '@/types';
import untitledCreativeMark from '@/assets/untitled-creative.png';
import styles from './UntitledLayout.module.scss';

export function UntitledLayout({ onStandardLayout }: { onStandardLayout: () => void }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const connected = useAuthStore((state) => state.connectionStatus === 'connected');
  const supportsPlugin = useAuthStore((state) => state.supportsPlugin);
  const version = useAuthStore((state) => state.serverVersion);
  const logout = useAuthStore((state) => state.logout);
  const language = useLanguageStore((state) => state.language);
  const setLanguage = useLanguageStore((state) => state.setLanguage);
  const theme = useThemeStore((state) => state.theme);
  const setTheme = useThemeStore((state) => state.setTheme);
  const [refreshing, setRefreshing] = useState(false);
  const manage = [
    '/auth-files',
    '/oauth',
    '/quota',
    '/ai-providers',
    '/quick-start',
    '/plugins',
    '/plugin-store',
    '/plugin-pages',
  ].some((path) => pathname.startsWith(path));
  const settings = pathname === '/config' || pathname === '/system';
  const refresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([useConfigStore.getState().fetchConfig(true), triggerHeaderRefresh()]);
    } catch {
      useNotificationStore.getState().showNotification(t('notification.refresh_failed'), 'error');
    } finally {
      setRefreshing(false);
    }
  };
  const secondary = [
    ['/auth-files', 'untitled.accounts'],
    ['/oauth', 'untitled.connect'],
    ['/quota', 'untitled.quota'],
    ['/ai-providers', 'untitled.providers'],
    ['/quick-start', 'untitled.quick_start'],
    ...(supportsPlugin
      ? [
          ['/plugins', 'untitled.plugins'],
          ['/plugin-store', 'untitled.plugin_store'],
        ]
      : []),
    ['/dashboard', 'untitled.standard_dashboard'],
    ['/config', 'untitled.configuration'],
    ['/system', 'untitled.system'],
  ];
  return (
    <div className={styles.shell}>
      <a
        href="#router-content"
        className={styles.skip}
        onClick={(event) => {
          event.preventDefault();
          document.getElementById('router-content')?.focus();
        }}
      >
        {t('untitled.skip_content')}
      </a>
      <header className={styles.header}>
        <Link to="/" className={styles.brand} aria-label={t('untitled.home')}>
          <span className={styles.brandMark} aria-hidden="true">
            <img src={untitledCreativeMark} alt="" />
          </span>
          <strong>
            UNTITLED <span>/</span> <em>ROUTER</em>
          </strong>
        </Link>
        <nav className={styles.nav} aria-label={t('untitled.navigation')}>
          <NavLink to="/" end>
            {t('untitled.overview')}
          </NavLink>
          <Link to="/auth-files" aria-current={manage ? 'page' : undefined}>
            {t('untitled.manage')}
          </Link>
          <NavLink to="/logs">{t('untitled.logs')}</NavLink>
          <Link to="/config" aria-current={settings ? 'page' : undefined}>
            {t('untitled.settings')}
          </Link>
        </nav>
        <div className={styles.actions}>
          <span className={styles.connection}>
            <i className={connected ? styles.connected : ''} />
            {t(connected ? 'untitled.connected' : 'untitled.disconnected')}
          </span>
          <button
            aria-label={t('untitled.refresh')}
            title={t('untitled.refresh')}
            disabled={refreshing}
            onClick={() => void refresh()}
          >
            ↻
          </button>
          <details className={styles.menu} key={pathname}>
            <summary aria-label={t('untitled.more')}>•••</summary>
            <div>
              <span className={styles.menuTitle}>{t('untitled.workspace')}</span>
              {secondary.map(([path, label]) => (
                <Link key={path} to={path}>
                  {t(label)}
                </Link>
              ))}
              <label>
                {t('language.switch')}
                <select value={language} onChange={(event) => setLanguage(event.target.value)}>
                  {LANGUAGE_ORDER.map((value) => (
                    <option key={value} value={value}>
                      {t(LANGUAGE_LABEL_KEYS[value])}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t('theme.switch')}
                <select value={theme} onChange={(event) => setTheme(event.target.value as Theme)}>
                  {(['dark', 'light', 'white', 'auto'] as const).map((value) => (
                    <option key={value} value={value}>
                      {t(`theme.${value}`)}
                    </option>
                  ))}
                </select>
              </label>
              <button onClick={onStandardLayout}>{t('untitled.standard_layout')}</button>
              <button onClick={logout}>{t('header.logout')}</button>
            </div>
          </details>
        </div>
      </header>
      {(manage || settings) && (
        <nav className={styles.secondary} aria-label={t('untitled.management_navigation')}>
          {secondary
            .filter(([path]) =>
              settings
                ? ['/config', '/system'].includes(path)
                : !['/config', '/system', '/dashboard'].includes(path)
            )
            .map(([path, label]) => (
              <NavLink key={path} to={path} end>
                {t(label)}
              </NavLink>
            ))}
        </nav>
      )}
      <main
        id="router-content"
        className={`${styles.content} ${pathname === '/logs' ? styles.logs : ''}`}
        tabIndex={-1}
      >
        <PageTransition render={(location) => <MainRoutes location={location} />} />
      </main>
      <footer className={styles.footer}>
        <span>{t('untitled.workspace')}</span>
        <span>CLIProxyAPI {version || '—'}</span>
      </footer>
    </div>
  );
}
