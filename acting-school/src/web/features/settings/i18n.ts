import type { Namespace, TranslationOf } from '@web/i18n/types';

const en = {
  title: 'Settings',
  subtitle: 'These apply to everyone at the school.',
  school: {
    title: 'School',
    description: 'Shown at the top of the app and in browser tabs.',
    name: 'School name',
    namePlaceholder: 'e.g. Stage Left Academy',
  },
  preferences: {
    title: 'Preferences',
    description: 'How the app behaves for the whole team.',
    defaultLanguage: 'Default language',
    defaultLanguageHint: 'New staff accounts start in this language. Each person can switch in My profile.',
    weekStartsOn: 'Week starts on',
    weekStartsOnHint: 'The first day of the week in the schedule and class calendars.',
  },
  saved: 'Settings saved',
};

const ar: TranslationOf<typeof en> = {
  title: 'الإعدادات',
  subtitle: 'تنطبق هذه الإعدادات على جميع العاملين في المدرسة.',
  school: {
    title: 'المدرسة',
    description: 'يظهر في أعلى التطبيق وفي عناوين صفحات المتصفح.',
    name: 'اسم المدرسة',
    namePlaceholder: 'مثال: أكاديمية المسرح',
  },
  preferences: {
    title: 'التفضيلات',
    description: 'طريقة عمل التطبيق للفريق بأكمله.',
    defaultLanguage: 'اللغة الافتراضية',
    defaultLanguageHint: 'تبدأ حسابات الفريق الجديدة بهذه اللغة، ويمكن لكل شخص تغييرها من «ملفي الشخصي».',
    weekStartsOn: 'بداية الأسبوع',
    weekStartsOnHint: 'أول يوم في الأسبوع في الجدول وتقويم الصفوف.',
  },
  saved: 'تم حفظ الإعدادات',
};

const ns: Namespace<typeof en> = { en, ar };
export default ns;
