import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import type { Locale } from '@shared/enums';
import admissions from '../features/admissions/i18n';
import castings from '../features/castings/i18n';
import classes from '../features/classes/i18n';
import dashboard from '../features/dashboard/i18n';
import positions from '../features/positions/i18n';
import schedule from '../features/schedule/i18n';
import settings from '../features/settings/i18n';
import staff from '../features/staff/i18n';
import students from '../features/students/i18n';
import talent from '../features/talent/i18n';
import common from './common';
import type { Namespace } from './types';

/** Every namespace. A feature's strings live in features/<name>/i18n.ts; register new namespaces here. */
export const namespaces = { common, students, classes, talent, castings, schedule, dashboard, staff, positions, settings, admissions } satisfies Record<
  string,
  Namespace<any>
>;

const pick = (lng: Locale) => Object.fromEntries(Object.entries(namespaces).map(([k, v]) => [k, v[lng]]));

const STORAGE_KEY = 'lang';

function initialLanguage(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'ar') return saved;
  } catch {
    /* storage blocked */
  }
  return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('ar') ? 'ar' : 'en';
}

export function applyDocumentLanguage(lng: Locale) {
  document.documentElement.lang = lng;
  document.documentElement.dir = lng === 'ar' ? 'rtl' : 'ltr';
}

void i18n.use(initReactI18next).init({
  resources: { en: pick('en'), ar: pick('ar') },
  lng: initialLanguage(),
  fallbackLng: 'en',
  ns: Object.keys(namespaces),
  defaultNS: 'common',
  interpolation: { escapeValue: false },
  returnNull: false,
});
applyDocumentLanguage(i18n.language as Locale);

/** Switch language for this device (the profile save is done by the caller). */
export function setLanguage(lng: Locale) {
  try {
    localStorage.setItem(STORAGE_KEY, lng);
  } catch {
    /* storage blocked */
  }
  applyDocumentLanguage(lng);
  void i18n.changeLanguage(lng);
}

export function currentLanguage(): Locale {
  return i18n.language === 'ar' ? 'ar' : 'en';
}

export default i18n;
