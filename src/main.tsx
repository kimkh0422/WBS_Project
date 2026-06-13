import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider, Outlet } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { LevelColorsProvider } from './context/LevelColorsContext';
import { OrganizationProvider } from './context/OrganizationContext';
import App from './App.tsx';
import './index.css';

/** Data Router 래퍼 — `useBlocker` 등은 이 트리 안에서만 사용 가능 */
function RootLayout() {
  return (
    <AuthProvider>
      <OrganizationProvider>
        <LevelColorsProvider>
          <Outlet />
        </LevelColorsProvider>
      </OrganizationProvider>
    </AuthProvider>
  );
}

const basename = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '') || '/';

const router = createBrowserRouter(
  [
    {
      path: '/',
      element: <RootLayout />,
      children: [
        {
          path: '*',
          element: <App />,
        },
      ],
    },
  ],
  { basename },
);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
