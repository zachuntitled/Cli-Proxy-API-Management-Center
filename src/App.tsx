import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MainLayout } from '@/components/layout/MainLayout';
import { Outlet, RouterProvider, createHashRouter, useNavigate } from 'react-router-dom';
import { LoginPage } from '@/pages/LoginPage';
import { NotificationContainer } from '@/components/common/NotificationContainer';
import { ConfirmationModal } from '@/components/common/ConfirmationModal';
import { UntitledLayout } from '@/features/untitled/UntitledLayout';
import { ProtectedRoute } from '@/router/ProtectedRoute';
import { useLanguageStore, useThemeStore } from '@/stores';

function RouterLayout() {
  const [standard, setStandard] = useState(false);
  const navigate = useNavigate();
  const { t } = useTranslation();
  return standard ? (
    <>
      <button
        type="button"
        onClick={() => {
          setStandard(false);
          navigate('/');
        }}
        style={{
          position: 'fixed',
          bottom: 16,
          right: 16,
          zIndex: 100,
          padding: '8px 12px',
          background: 'var(--bg-primary)',
          color: 'var(--text-primary)',
          border: '1px solid var(--border-color)',
          borderRadius: 8,
          cursor: 'pointer',
        }}
      >
        {t('untitled.custom_layout')}
      </button>
      <MainLayout />
    </>
  ) : (
    <UntitledLayout
      onStandardLayout={() => {
        setStandard(true);
        navigate('/dashboard');
      }}
    />
  );
}

function RootShell() {
  return (
    <>
      <NotificationContainer />
      <ConfirmationModal />
      <Outlet />
    </>
  );
}

const router = createHashRouter([
  {
    element: <RootShell />,
    children: [
      { path: '/login', element: <LoginPage /> },
      {
        path: '/*',
        element: (
          <ProtectedRoute>
            <RouterLayout />
          </ProtectedRoute>
        ),
      },
    ],
  },
]);

function App() {
  const initializeTheme = useThemeStore((state) => state.initializeTheme);
  const language = useLanguageStore((state) => state.language);
  const setLanguage = useLanguageStore((state) => state.setLanguage);

  useEffect(() => {
    const cleanupTheme = initializeTheme();
    return cleanupTheme;
  }, [initializeTheme]);

  useEffect(() => {
    setLanguage(language);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // 仅用于首屏同步 i18n 语言

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  return <RouterProvider router={router} />;
}

export default App;
