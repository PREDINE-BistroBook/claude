import type { Namespace, TranslationOf } from '@web/i18n/types';

const en = {
  title: 'Students',
};

const ar: TranslationOf<typeof en> = {
  title: 'الطلاب',
};

const ns: Namespace<typeof en> = { en, ar };
export default ns;
