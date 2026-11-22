import type { Namespace, TranslationOf } from '@web/i18n/types';

const en = {
  title: 'Home',
};

const ar: TranslationOf<typeof en> = {
  title: 'الرئيسية',
};

const ns: Namespace<typeof en> = { en, ar };
export default ns;
