import { Drama } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { currentLanguage, setLanguage } from '../i18n';

/** Centered card for sign-in and first-run setup, with the language switch. */
export function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="pt-safe flex min-h-dvh flex-col bg-canvas">
      <div className="flex justify-end p-4">
        <button
          type="button"
          onClick={() => setLanguage(currentLanguage() === 'ar' ? 'en' : 'ar')}
          className="rounded-lg px-3 py-1.5 text-sm font-medium text-muted hover:bg-surface-2 hover:text-ink"
          lang={currentLanguage() === 'ar' ? 'en' : 'ar'}
        >
          {t('language.switchTo')}
        </button>
      </div>
      <main className="flex flex-1 items-start justify-center px-4 pb-16 pt-4 sm:items-center sm:pt-0">
        <div className="w-full max-w-sm">
          <div className="mb-6 flex flex-col items-center text-center">
            <span className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-accent text-accent-ink shadow-lg shadow-accent/20">
              <Drama className="size-7" aria-hidden />
            </span>
            <h1 className="text-2xl font-semibold tracking-tight text-balance">{title}</h1>
            {subtitle && <p className="mt-1.5 text-sm text-muted text-balance">{subtitle}</p>}
          </div>
          <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm sm:p-6">{children}</div>
        </div>
      </main>
    </div>
  );
}
