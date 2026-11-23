// First: zod's settings must be in place before any schema validates (lib/zodSetup.ts).
import './lib/zodSetup';
import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import './styles.css';
import './i18n';
import { ToastProvider } from './components/ui/Toast';
import { AuthProvider } from './lib/auth';
import { queryClient } from './lib/query';
import { router } from './router';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);

// Installable app: register the service worker in production builds only.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  void import('virtual:pwa-register').then(({ registerSW }) => registerSW({ immediate: true }));
}
