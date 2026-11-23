import type { Namespace, TranslationOf } from '@web/i18n/types';

const en = {
  title: 'Home',
  empty: {
    title: 'Nothing here for you yet',
    hint: 'Use the menu to open the pages your positions allow.',
  },
  start: {
    /** The small home of someone who sees none of the three sections (Reception, until the school says what it does). */
    noSection: 'Here is what you can use',
    noSectionHint: 'More will be added to your position later.',
  },
  greeting: {
    morning: 'Good morning, {{name}}',
    afternoon: 'Good afternoon, {{name}}',
    evening: 'Good evening, {{name}}',
  },
  stats: {
    label: 'At a glance',
    activeStudents: 'Active students',
    activeCourses: 'Active workshops',
    activeTalent: 'Talent on the roster',
    openCastings: 'Open castings',
    openLeads: 'Open enquiries',
    newLeadsThisWeek: 'New this week',
    newWebsiteLeads: 'New website enquiries',
    newCastingApplications: 'New casting applications',
    newOpportunities: 'New opportunities',
  },
  /** The tiles' "+ Add …" words are the list buttons' own (common:add.*, layout/addActions.ts HOME_QUICK_ACTIONS). */
  quick: {
    label: 'Quick actions',
    callToOffice: 'Call someone to the office',
  },
  today: {
    title: 'Today’s sessions',
    titleMine: 'Your sessions today',
    empty: 'No sessions today',
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
  followUps: {
    title: 'Follow-ups due',
    hint_one: '{{count}} enquiry is waiting to hear from us.',
    hint_other: '{{count}} enquiries are waiting to hear from us.',
    more_one: 'And {{count}} more',
    more_other: 'And {{count}} more',
    empty: 'No follow-ups due',
    emptyHint: 'Everyone who asked about workshops has been followed up.',
  },
  interviews: {
    title: 'Upcoming interviews',
    subtitle: 'Admissions interviews in the next 7 days',
    empty: 'No interviews coming up',
    emptyHint: 'Interviews scheduled from an enquiry show here.',
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
  empty: {
    title: 'لا شيء لك هنا بعد',
    hint: 'استخدم القائمة لفتح الصفحات التي تسمح بها مناصبك.',
  },
  start: {
    noSection: 'هذا ما يمكنك استخدامه الآن',
    noSectionHint: 'ستُضاف صفحات أخرى إلى منصبك لاحقًا.',
  },
  greeting: {
    morning: 'صباح الخير، {{name}}',
    afternoon: 'طاب يومك، {{name}}',
    evening: 'مساء الخير، {{name}}',
  },
  stats: {
    label: 'نظرة سريعة',
    activeStudents: 'الطلاب النشطون',
    activeCourses: 'الورش النشطة',
    activeTalent: 'المواهب في القائمة',
    openCastings: 'تجارب الأداء المفتوحة',
    openLeads: 'الاستفسارات المفتوحة',
    newLeadsThisWeek: 'جديدة هذا الأسبوع',
    newWebsiteLeads: 'استفسارات جديدة من الموقع',
    newCastingApplications: 'طلبات انضمام جديدة',
    newOpportunities: 'فرص جديدة',
  },
  quick: {
    label: 'إجراءات سريعة',
    callToOffice: 'استدعاء شخص إلى المكتب',
  },
  today: {
    title: 'حصص اليوم',
    titleMine: 'حصصك اليوم',
    empty: 'لا حصص اليوم',
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
  followUps: {
    title: 'متابعات مستحقة',
    hint_zero: 'لا استفسارات بانتظار ردّنا.',
    hint_one: 'استفسار واحد بانتظار ردّنا.',
    hint_two: 'استفساران بانتظار ردّنا.',
    hint_few: '{{count}} استفسارات بانتظار ردّنا.',
    hint_many: '{{count}} استفسارًا بانتظار ردّنا.',
    hint_other: '{{count}} استفسار بانتظار ردّنا.',
    more_zero: 'لا مزيد',
    more_one: 'واستفسار آخر',
    more_two: 'واستفساران آخران',
    more_few: 'و{{count}} استفسارات أخرى',
    more_many: 'و{{count}} استفسارًا آخر',
    more_other: 'و{{count}} استفسار آخر',
    empty: 'لا متابعات مستحقة',
    emptyHint: 'تمت متابعة كل من سأل عن الورش.',
  },
  interviews: {
    title: 'المقابلات القادمة',
    subtitle: 'مقابلات القبول خلال 7 أيام',
    empty: 'لا مقابلات قادمة',
    emptyHint: 'تظهر هنا المقابلات المحددة من الاستفسارات.',
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
