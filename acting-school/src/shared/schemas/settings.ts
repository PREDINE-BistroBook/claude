import { z } from 'zod';
import { LOCALES, type Locale } from '../enums';
import { reqText } from './common';

export const settingsInput = z
  .object({
    schoolName: reqText(120),
    defaultLocale: z.enum(LOCALES),
    /** 0 Sunday, 1 Monday, 6 Saturday. */
    weekStartsOn: z.union([z.literal(0), z.literal(1), z.literal(6)]),
  })
  .partial();

export interface AppSettings {
  schoolName: string;
  defaultLocale: Locale;
  weekStartsOn: 0 | 1 | 6;
}

export const DEFAULT_SETTINGS: AppSettings = {
  schoolName: 'Acting School',
  defaultLocale: 'en',
  weekStartsOn: 1,
};
