import type { Namespace, TranslationOf } from '@web/i18n/types';

const en = {
  title: 'Castings',
};

const ar: TranslationOf<typeof en> = {
  title: 'تجارب الأداء',
};

const ns: Namespace<typeof en> = { en, ar };
export default ns;
