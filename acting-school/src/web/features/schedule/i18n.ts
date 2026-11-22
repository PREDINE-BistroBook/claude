import type { Namespace, TranslationOf } from '@web/i18n/types';

const en = {
  title: 'Schedule',
};

const ar: TranslationOf<typeof en> = {
  title: 'الجدول',
};

const ns: Namespace<typeof en> = { en, ar };
export default ns;
