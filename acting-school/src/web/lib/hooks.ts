import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from './auth';

export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

/** The school's name in the current language: its Arabic name in Arabic when one is set, else its name (the app's name until it loads). */
export function useSchoolName(): string {
  const { schoolName, schoolNameAr } = useAuth();
  const { t, i18n } = useTranslation();
  return (i18n.language === 'ar' && schoolNameAr) || schoolName || t('common:appName');
}

/** Sets the browser tab title: "<title> · <school>". */
export function usePageTitle(title: string | null | undefined) {
  const school = useSchoolName();
  useEffect(() => {
    document.title = [title, school].filter(Boolean).join(' · ');
  }, [title, school]);
}

/** True while the browser reports no network. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

/** Matches a CSS media query, e.g. useMediaQuery('(min-width: 1024px)'). */
export function useMediaQuery(query: string): boolean {
  const [match, setMatch] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const on = () => setMatch(mql.matches);
    on();
    mql.addEventListener('change', on);
    return () => mql.removeEventListener('change', on);
  }, [query]);
  return match;
}
