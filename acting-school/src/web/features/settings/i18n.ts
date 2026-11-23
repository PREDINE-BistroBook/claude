import type { Namespace, TranslationOf } from '@web/i18n/types';

const en = {
  title: 'Settings',
  subtitle: 'These apply to everyone at the school.',
  school: {
    title: 'School',
    description: 'Shown at the top of the app, on the sign-in page and in browser tabs.',
    name: 'School name',
    namePlaceholder: 'e.g. Turquoise Studio',
    nameAr: 'Name in Arabic',
    // No Latin "e.g.": the field is right-to-left, so it would be reordered.
    nameArPlaceholder: 'استوديو تركواز',
    nameArHint: 'Shown when the app is in Arabic. Leave it empty to use the English name.',
  },
  preferences: {
    title: 'Preferences',
    description: 'How the app behaves for the whole team.',
    defaultLanguage: 'Default language',
    defaultLanguageHint: 'New team accounts start in this language. Each person can switch in My profile.',
    weekStartsOn: 'Week starts on',
    weekStartsOnHint: 'The first day of the week in the schedule and workshop calendars.',
  },
  criteria: {
    title: 'Interview criteria',
    description:
      'What admissions interviews are scored on, from 1 to 5. Renaming keeps past scores; a removed criterion’s scores stay on the interviews that have them. Without an Arabic name, the English one is shown in Arabic too.',
    label: 'English',
    labelAr: 'Arabic',
    untitled: 'Criterion {{n}}',
    new: 'New',
    keyHint: 'Stable key: stays the same when the criterion is renamed',
    moveUp: 'Move {{name}} up',
    moveDown: 'Move {{name}} down',
    remove: 'Remove {{name}}',
    add: 'Add criterion',
    empty: 'No criteria: interviews are recorded without scores.',
  },
  whatsapp: {
    title: 'WhatsApp links',
    description: 'Messages to enquiries open in WhatsApp through wa.me links — no paid service.',
    countryCode: 'Country calling code',
    countryCodeHint: 'Digits only, without “+” or leading zeros — e.g. 20 for Egypt.',
    example: '{{local}} opens {{link}}',
  },
  errors: {
    criterionKey: 'This criterion’s key isn’t valid',
    criterionKeyTaken: 'Two criteria have the same key',
    countryCode: 'Enter 1 to 4 digits, e.g. 20',
  },
  saved: 'Settings saved',
};

const ar: TranslationOf<typeof en> = {
  title: 'الإعدادات',
  subtitle: 'تنطبق هذه الإعدادات على جميع العاملين في المدرسة.',
  school: {
    title: 'المدرسة',
    description: 'يظهر في أعلى التطبيق وفي صفحة تسجيل الدخول وفي عناوين صفحات المتصفح.',
    name: 'اسم المدرسة',
    namePlaceholder: 'مثال: Turquoise Studio',
    nameAr: 'الاسم بالعربية',
    nameArPlaceholder: 'مثال: استوديو تركواز',
    nameArHint: 'يظهر عندما يكون التطبيق بالعربية. اتركه فارغًا لاستخدام الاسم الإنجليزي.',
  },
  preferences: {
    title: 'التفضيلات',
    description: 'طريقة عمل التطبيق للفريق بأكمله.',
    defaultLanguage: 'اللغة الافتراضية',
    defaultLanguageHint: 'تبدأ حسابات الفريق الجديدة بهذه اللغة، ويمكن لكل شخص تغييرها من «ملفي الشخصي».',
    weekStartsOn: 'بداية الأسبوع',
    weekStartsOnHint: 'أول يوم في الأسبوع في الجدول وتقويم الورش.',
  },
  criteria: {
    title: 'معايير المقابلات',
    description:
      'ما تُقيَّم عليه مقابلات القبول من 1 إلى 5. تغيير الاسم يحتفظ بالدرجات السابقة، ودرجات المعيار المحذوف تبقى في المقابلات التي سُجّلت فيها. إن لم يكن للمعيار اسم عربي يُعرض اسمه الإنجليزي.',
    label: 'بالإنجليزية',
    labelAr: 'بالعربية',
    untitled: 'المعيار {{n}}',
    new: 'جديد',
    keyHint: 'مفتاح ثابت: لا يتغير عند تغيير اسم المعيار',
    moveUp: 'نقل {{name}} لأعلى',
    moveDown: 'نقل {{name}} لأسفل',
    remove: 'إزالة {{name}}',
    add: 'إضافة معيار',
    empty: 'لا معايير: تُسجَّل المقابلات بلا درجات.',
  },
  whatsapp: {
    title: 'روابط واتساب',
    description: 'تُفتح الرسائل إلى أصحاب الاستفسارات في واتساب عبر روابط wa.me، دون أي خدمة مدفوعة.',
    countryCode: 'رمز الاتصال الدولي',
    countryCodeHint: 'أرقام فقط، دون «+» أو أصفار في البداية، مثل 20 لمصر.',
    example: 'الرقم {{local}} يفتح {{link}}',
  },
  errors: {
    criterionKey: 'مفتاح هذا المعيار غير صالح',
    criterionKeyTaken: 'لمعيارين المفتاح نفسه',
    countryCode: 'أدخل من رقم إلى 4 أرقام، مثل 20',
  },
  saved: 'تم حفظ الإعدادات',
};

const ns: Namespace<typeof en> = { en, ar };
export default ns;
