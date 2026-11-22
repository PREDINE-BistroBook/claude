import type { Namespace, TranslationOf } from '@web/i18n/types';

const en = {
  title: 'Classes',
};

const ar: TranslationOf<typeof en> = {
  title: 'الصفوف',
};

const ns: Namespace<typeof en> = { en, ar };
export default ns;
