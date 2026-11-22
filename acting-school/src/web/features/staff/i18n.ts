import type { Namespace, TranslationOf } from '@web/i18n/types';

const en = {
  title: 'Staff',
};

const ar: TranslationOf<typeof en> = {
  title: 'الفريق',
};

const ns: Namespace<typeof en> = { en, ar };
export default ns;
