import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { BrandMark } from '../components/ui/BrandMark';
import { currentLanguage, setLanguage } from '../i18n';

/** Centered card for sign-in and first-run setup, with the language switch. `school`: the school's name, shown above the title. */
export function AuthLayout({ title, subtitle, school, children }: { title: string; subtitle?: string; school?: string; children: ReactNode }) {
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
            <BrandMark className="mb-4 size-16 shadow-lg shadow-accent/25" />
            {school && <p className="mb-1.5 text-sm font-semibold uppercase tracking-wider text-accent rtl:tracking-normal">{school}</p>}
            <h1 className="text-2xl font-semibold tracking-tight text-balance">{title}</h1>
            {subtitle && <p className="mt-1.5 text-sm text-muted text-balance">{subtitle}</p>}
          </div>
          <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm sm:p-6">{children}</div>
        </div>
      </main>
    </div>
  );
}
