import type { Namespace, TranslationOf } from '@web/i18n/types';

const en = {
  title: 'Home',
  noAccess: 'Your account can’t see anything yet',
  empty: {
    title: 'Nothing for you on Home',
    hint: 'Open the sections your positions allow from the menu.',
  },
  greeting: {
    morning: 'Good morning, {{name}}',
    afternoon: 'Good afternoon, {{name}}',
    evening: 'Good evening, {{name}}',
  },
  stats: {
    label: 'At a glance',
    activeStudents: 'Active students',
    activeCourses: 'Active classes',
    activeTalent: 'Active talent',
    openCastings: 'Open castings',
  },
  quick: {
    label: 'Quick actions',
    newStudent: 'New student',
    newClass: 'New class',
    addTalent: 'Add talent',
    newCasting: 'New casting',
  },
  today: {
    title: 'Today’s classes',
    titleMine: 'Your classes today',
    empty: 'No classes today',
    emptyHint: 'Nothing on the timetable for today.',
    attendanceTaken: 'Attendance taken',
  },
  attendance: {
    title: 'Attendance to take',
    hint_one: '{{count}} session from the last two weeks has no attendance yet.',
    hint_other: '{{count}} sessions from the last two weeks have no attendance yet.',
    more_one: 'And {{count}} more',
    more_other: 'And {{count}} more',
  },
  auditions: {
    title: 'Upcoming auditions',
    subtitle: 'The next two weeks',
    empty: 'No auditions coming up',
    emptyHint: 'Auditions show here once a submission has a date and time.',
  },
  closing: {
    title: 'Castings closing soon',
    subtitle: 'Submission deadlines in the next 7 days',
    empty: 'No deadlines this week',
    emptyHint: 'Open castings with a deadline in the next 7 days show here.',
    deadline: 'Deadline {{date}}',
  },
};

const ar: TranslationOf<typeof en> = {
  title: 'الرئيسية',
  noAccess: 'لا يمكن لحسابك رؤية أي شيء بعد',
  empty: {
    title: 'لا شيء لك في الصفحة الرئيسية',
    hint: 'افتح من القائمة الأقسام التي تسمح بها مناصبك.',
  },
  greeting: {
    morning: 'صباح الخير، {{name}}',
    afternoon: 'طاب يومك، {{name}}',
    evening: 'مساء الخير، {{name}}',
  },
  stats: {
    label: 'نظرة سريعة',
    activeStudents: 'الطلاب النشطون',
    activeCourses: 'الصفوف النشطة',
    activeTalent: 'المواهب النشطة',
    openCastings: 'تجارب الأداء المفتوحة',
  },
  quick: {
    label: 'إجراءات سريعة',
    newStudent: 'طالب جديد',
    newClass: 'صف جديد',
    addTalent: 'إضافة موهبة',
    newCasting: 'تجربة أداء جديدة',
  },
  today: {
    title: 'صفوف اليوم',
    titleMine: 'صفوفك اليوم',
    empty: 'لا صفوف اليوم',
    emptyHint: 'لا شيء في الجدول لهذا اليوم.',
    attendanceTaken: 'تم تسجيل الحضور',
  },
  attendance: {
    title: 'حضور بانتظار التسجيل',
    hint_zero: 'لا حصص بلا حضور في الأسبوعين الماضيين.',
    hint_one: 'حصة واحدة من الأسبوعين الماضيين لم يُسجَّل حضورها بعد.',
    hint_two: 'حصتان من الأسبوعين الماضيين لم يُسجَّل حضورهما بعد.',
    hint_few: '{{count}} حصص من الأسبوعين الماضيين لم يُسجَّل حضورها بعد.',
    hint_many: '{{count}} حصة من الأسبوعين الماضيين لم يُسجَّل حضورها بعد.',
    hint_other: '{{count}} حصة من الأسبوعين الماضيين لم يُسجَّل حضورها بعد.',
    more_zero: 'لا مزيد',
    more_one: 'وحصة أخرى',
    more_two: 'وحصتان أخريان',
    more_few: 'و{{count}} حصص أخرى',
    more_many: 'و{{count}} حصة أخرى',
    more_other: 'و{{count}} حصة أخرى',
  },
  auditions: {
    title: 'الاختبارات القادمة',
    subtitle: 'خلال الأسبوعين القادمين',
    empty: 'لا اختبارات قادمة',
    emptyHint: 'تظهر الاختبارات هنا عند تحديد موعد اختبار لأحد الترشيحات.',
  },
  closing: {
    title: 'تجارب أداء تُغلق قريبًا',
    subtitle: 'مواعيد الترشيح النهائية خلال 7 أيام',
    empty: 'لا مواعيد نهائية هذا الأسبوع',
    emptyHint: 'تظهر هنا تجارب الأداء المفتوحة التي ينتهي موعد الترشيح لها خلال 7 أيام.',
    deadline: 'آخر موعد {{date}}',
  },
};

const ns: Namespace<typeof en> = { en, ar };
export default ns;
