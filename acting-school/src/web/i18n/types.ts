/**
 * Translation typing. Each namespace file exports { en, ar }. `ar` must have
 * every key `en` has (TypeScript enforces it) and may have extra keys — Arabic
 * needs more plural forms:
 *
 *   en: { students_one: '{{count}} student', students_other: '{{count}} students' }
 *   ar: { students_zero, students_one, students_two, students_few, students_many, students_other }
 *
 * tests/unit/i18n.test.ts checks both directions and the Arabic plural sets.
 */
export type Dict = { [key: string]: string | Dict };

export type TranslationOf<T> = {
  [K in keyof T]: T[K] extends string ? string : TranslationOf<T[K]>;
} & { [extra: string]: unknown };

export interface Namespace<T extends Dict = Dict> {
  en: T;
  ar: TranslationOf<T>;
}
