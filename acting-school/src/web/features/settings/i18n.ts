import type { Namespace, TranslationOf } from '@web/i18n/types';

const en = {
  title: 'Settings',
};

const ar: TranslationOf<typeof en> = {
  title: 'الإعدادات',
};

const ns: Namespace<typeof en> = { en, ar };
export default ns;
