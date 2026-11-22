import type { Namespace, TranslationOf } from '@web/i18n/types';

const en = {
  title: 'Talent',
};

const ar: TranslationOf<typeof en> = {
  title: 'المواهب',
};

const ns: Namespace<typeof en> = { en, ar };
export default ns;
