import type { Namespace, TranslationOf } from '@web/i18n/types';

/**
 * Positions screen, plus the label and one-line description of every
 * permission (perm.<area>.<action>) — the profile page and the staff screen use
 * those too. Keep perm in step with PERMISSIONS in src/shared/permissions.ts.
 */
const en = {
  title: 'Positions',
  summary_one: '{{count}} position',
  summary_other: '{{count}} positions',
  intro: 'A position decides what someone can see and do. A person can hold several positions; their access adds up.',
  newPosition: 'New position',
  owner: 'Owner',
  builtIn: 'Built-in',
  holders_one: '{{count}} person',
  holders_other: '{{count}} people',
  noHolders: 'Nobody yet',
  allowsEverything: 'Everything',
  allows_one: 'Allows {{count}} thing',
  allows_other: 'Allows {{count}} things',
  allowsNothing: 'Allows nothing yet',
  locked: 'Includes access you don’t have',
  lockedHolders: 'Held by someone who can do more than you',
  emptyTitle: 'No positions yet',
  form: {
    newTitle: 'New position',
    editTitle: 'Edit {{name}}',
    viewTitle: '{{name}}',
    namesTitle: 'Name',
    namesHint: 'How the position appears next to people’s names.',
    name: 'Name in English',
    nameAr: 'Name in Arabic',
    nameArHint: 'Shown when the app is in Arabic. Leave it empty to use the English name.',
    ownerTitle: 'Owner position',
    ownerToggle: 'This is an owner position',
    ownerHint: 'Allows everything — including anything added to the app later, owner accounts and all money. Only owners see owner positions.',
    accessTitle: 'What it allows',
    accessHint: 'Tick what people in this position may see and do.',
    ownerAccessHint: 'Owner positions allow everything, so there is nothing to tick.',
    cantGive: 'You can’t give access you don’t have',
    readOnly: 'This position allows things you can’t do yourself, so only an owner can change it.',
    readOnlyHolders: 'Someone who holds this position can do more than you, and changing it would change their access too, so only an owner can change it.',
    builtInHint: 'A built-in position: you can rename it and change what it allows, but not delete it.',
    create: 'Create position',
  },
  remove: {
    button: 'Delete position',
    title: 'Delete “{{name}}”?',
    message: 'Nobody holds it, so nobody loses access. This can’t be undone.',
    inUse_one: 'Held by {{count}} person. Give them another position before deleting it.',
    inUse_other: 'Held by {{count}} people. Give them another position before deleting it.',
    builtIn: 'Built-in positions can’t be deleted.',
  },
  toasts: {
    created: 'Position created',
    saved: 'Position saved',
    deleted: 'Position deleted',
  },
  errors: {
    nameTaken: 'Another position already has this name',
    exceedsYourAccess: 'You can’t give access you don’t have, or change a position held by someone who can do more than you.',
    ownerOnly: 'Only an owner can create or change owner positions.',
    lastOwner: 'Nobody else would hold an owner position. Give someone else an owner position first.',
    inUse: 'Someone holds this position. Give them another position first.',
    builtIn: 'Built-in positions can’t be deleted.',
  },
  groups: {
    staff: 'Staff & settings',
    school: 'School',
    agency: 'Agency',
    admissions: 'Admissions',
    money: 'Money',
  },
  perm: {
    staff: {
      manage: { label: 'Manage staff', description: 'Add and edit staff accounts, give positions, reset passwords, deactivate accounts.' },
    },
    positions: {
      manage: { label: 'Manage positions', description: 'Create and edit positions and what each one allows.' },
    },
    settings: {
      manage: { label: 'School settings', description: 'School name, default language, first day of the week, admissions interview criteria and the country code for WhatsApp links.' },
    },
    students: {
      read: { label: 'See students', description: 'Only students in your own classes and students you added — unless “All classes” is allowed too.' },
      contact: { label: 'Students’ contact details', description: 'Phone, email, guardian and emergency contacts.' },
      write: { label: 'Edit students', description: 'Add, edit and delete students — without “All classes”, only the students you can see.' },
    },
    courses: {
      read: { label: 'See classes', description: 'Classes and their sessions: only your own (ones you teach, cover or set up), unless “All classes” is allowed too.' },
      write: { label: 'Edit classes', description: 'Create, edit and delete classes, schedules, enrollments and sessions — without “All classes”, only your own classes.' },
    },
    classes: {
      all: { label: 'All classes', description: 'See every class, session and student, not only your own.' },
    },
    attendance: {
      write: { label: 'Take attendance', description: 'Mark attendance: only for sessions you teach, unless “All classes” is allowed too. Needs “See classes” as well.' },
    },
    talent: {
      read: { label: 'See actors', description: 'The actor database: profiles, photos and skills.' },
      contact: { label: 'Actors’ contact details', description: 'Actors’ phone and email.' },
      write: { label: 'Edit actors', description: 'Add, edit and delete actors and their photos (deleting an actor also removes their casting history).' },
    },
    castings: {
      read: { label: 'See castings', description: 'Castings, their roles and shortlists.' },
      write: {
        label: 'Work on castings',
        description: 'Create, edit and delete castings and roles; add actors to shortlists, remove them, or mark them not selected or withdrawn.',
      },
      send: { label: 'Send actors to clients', description: 'Put actors forward: submitted, audition, callback, booked.' },
    },
    admissions: {
      read: { label: 'See admissions', description: 'Enquiries from people who want to join, with their contact details, interviews and history.' },
      write: {
        label: 'Work on admissions',
        description: 'Add and edit enquiries, log calls and messages, set follow-ups, schedule interviews, close and reopen enquiries.',
      },
      decide: {
        label: 'Admissions decisions',
        description:
          'Record interview assessments, accept or decline, choose the class (and so the coach) and enrol. Enrolling creates the student and their enrollment even without “Edit students” or “Edit classes”.',
      },
    },
    payments: {
      status: { label: 'Payment status', description: 'Who has paid and who still owes (comes with Tuition).' },
      manage: { label: 'Money', description: 'Amounts, totals, revenue and commissions (comes with Tuition).' },
    },
  },
};

const ar: TranslationOf<typeof en> = {
  title: 'المناصب',
  summary_zero: 'لا توجد مناصب',
  summary_one: 'منصب واحد',
  summary_two: 'منصبان',
  summary_few: '{{count}} مناصب',
  summary_many: '{{count}} منصبًا',
  summary_other: '{{count}} منصب',
  intro: 'يحدّد المنصب ما يمكن لصاحبه رؤيته وفعله. يمكن للشخص أن يشغل أكثر من منصب، وتُجمع صلاحياتها معًا.',
  newPosition: 'منصب جديد',
  owner: 'مالك',
  builtIn: 'أساسي',
  holders_zero: 'لا أحد',
  holders_one: 'شخص واحد',
  holders_two: 'شخصان',
  holders_few: '{{count}} أشخاص',
  holders_many: '{{count}} شخصًا',
  holders_other: '{{count}} شخص',
  noHolders: 'لا أحد بعد',
  allowsEverything: 'كل شيء',
  allows_zero: 'لا يسمح بشيء',
  allows_one: 'يسمح بصلاحية واحدة',
  allows_two: 'يسمح بصلاحيتين',
  allows_few: 'يسمح بـ{{count}} صلاحيات',
  allows_many: 'يسمح بـ{{count}} صلاحية',
  allows_other: 'يسمح بـ{{count}} صلاحية',
  allowsNothing: 'لا يسمح بشيء بعد',
  locked: 'يتضمّن صلاحيات لا تملكها',
  lockedHolders: 'يشغله شخص يستطيع أكثر مما تستطيع',
  emptyTitle: 'لا توجد مناصب بعد',
  form: {
    newTitle: 'منصب جديد',
    editTitle: 'تعديل {{name}}',
    viewTitle: '{{name}}',
    namesTitle: 'الاسم',
    namesHint: 'هكذا يظهر المنصب بجانب أسماء الأشخاص.',
    name: 'الاسم بالإنجليزية',
    nameAr: 'الاسم بالعربية',
    nameArHint: 'يظهر عندما يكون التطبيق بالعربية. اتركه فارغًا لاستخدام الاسم الإنجليزي.',
    ownerTitle: 'منصب مالك',
    ownerToggle: 'هذا منصب مالك',
    ownerHint: 'يسمح بكل شيء، بما في ذلك أي صلاحيات تُضاف إلى التطبيق لاحقًا، وحسابات المالكين، وكل الأمور المالية. لا يرى مناصب المالكين إلا المالكون.',
    accessTitle: 'ما يسمح به',
    accessHint: 'حدّد ما يمكن لشاغلي هذا المنصب رؤيته وفعله.',
    ownerAccessHint: 'مناصب المالكين تسمح بكل شيء، فلا حاجة إلى تحديد شيء.',
    cantGive: 'لا يمكنك منح صلاحية لا تملكها',
    readOnly: 'يسمح هذا المنصب بأمور لا يمكنك فعلها بنفسك، لذا لا يعدّله إلا مالك.',
    readOnlyHolders: 'يشغل هذا المنصب شخص يستطيع أكثر مما تستطيع، وتعديله يغيّر صلاحياته أيضًا، لذا لا يعدّله إلا مالك.',
    builtInHint: 'منصب أساسي: يمكنك تغيير اسمه وما يسمح به، لكن لا يمكن حذفه.',
    create: 'إنشاء المنصب',
  },
  remove: {
    button: 'حذف المنصب',
    title: 'حذف «{{name}}»؟',
    message: 'لا أحد يشغله، فلن يفقد أحد صلاحياته. لا يمكن التراجع عن هذا الإجراء.',
    inUse_zero: 'لا أحد يشغله.',
    inUse_one: 'يشغله شخص واحد. امنحه منصبًا آخر قبل حذفه.',
    inUse_two: 'يشغله شخصان. امنحهما منصبًا آخر قبل حذفه.',
    inUse_few: 'يشغله {{count}} أشخاص. امنحهم منصبًا آخر قبل حذفه.',
    inUse_many: 'يشغله {{count}} شخصًا. امنحهم منصبًا آخر قبل حذفه.',
    inUse_other: 'يشغله {{count}} شخص. امنحهم منصبًا آخر قبل حذفه.',
    builtIn: 'لا يمكن حذف المناصب الأساسية.',
  },
  toasts: {
    created: 'تم إنشاء المنصب',
    saved: 'تم حفظ المنصب',
    deleted: 'تم حذف المنصب',
  },
  errors: {
    nameTaken: 'يوجد منصب آخر بهذا الاسم',
    exceedsYourAccess: 'لا يمكنك منح صلاحية لا تملكها، أو تعديل منصب يشغله شخص يستطيع أكثر مما تستطيع.',
    ownerOnly: 'لا ينشئ مناصب المالكين أو يعدّلها إلا مالك.',
    lastOwner: 'لن يبقى أحد يشغل منصب مالك. امنح شخصًا آخر منصب مالك أولًا.',
    inUse: 'هناك من يشغل هذا المنصب. امنحه منصبًا آخر أولًا.',
    builtIn: 'لا يمكن حذف المناصب الأساسية.',
  },
  groups: {
    staff: 'الفريق والإعدادات',
    school: 'المدرسة',
    agency: 'الوكالة',
    admissions: 'القبول',
    money: 'المال',
  },
  perm: {
    staff: {
      manage: { label: 'إدارة الفريق', description: 'إضافة حسابات الفريق وتعديلها، ومنح المناصب، وإعادة تعيين كلمات المرور، وإيقاف الحسابات.' },
    },
    positions: {
      manage: { label: 'إدارة المناصب', description: 'إنشاء المناصب وتعديلها وتحديد ما يسمح به كلٌّ منها.' },
    },
    settings: {
      manage: { label: 'إعدادات المدرسة', description: 'اسم المدرسة واللغة الافتراضية وأول أيام الأسبوع ومعايير مقابلات القبول ورمز الدولة لروابط واتساب.' },
    },
    students: {
      read: { label: 'عرض الطلاب', description: 'الطلاب في صفوفك والطلاب الذين أضفتهم فقط، ما لم يُسمح أيضًا بـ«كل الصفوف».' },
      contact: { label: 'بيانات تواصل الطلاب', description: 'الهاتف والبريد الإلكتروني وبيانات وليّ الأمر وجهة الاتصال في الطوارئ.' },
      write: { label: 'تعديل الطلاب', description: 'إضافة الطلاب وتعديل بياناتهم وحذفهم، ودون «كل الصفوف» يقتصر ذلك على الطلاب الذين يمكنك رؤيتهم.' },
    },
    courses: {
      read: { label: 'عرض الصفوف', description: 'الصفوف وحصصها: صفوفك فقط (التي تدرّسها أو تنوب فيها أو أنشأتها)، ما لم يُسمح أيضًا بـ«كل الصفوف».' },
      write: { label: 'تعديل الصفوف', description: 'إنشاء الصفوف وتعديلها وحذفها، والجداول، والتسجيل، والحصص، ودون «كل الصفوف» يقتصر ذلك على صفوفك.' },
    },
    classes: {
      all: { label: 'كل الصفوف', description: 'عرض كل الصفوف والحصص والطلاب، لا صفوفك وطلابك فقط.' },
    },
    attendance: {
      write: { label: 'تسجيل الحضور', description: 'تسجيل الحضور في الحصص التي تدرّسها فقط، ما لم يُسمح أيضًا بـ«كل الصفوف». تحتاج أيضًا إلى «عرض الصفوف».' },
    },
    talent: {
      read: { label: 'عرض الممثلين', description: 'قاعدة بيانات الممثلين: الملفات الشخصية والصور والمهارات.' },
      contact: { label: 'بيانات تواصل الممثلين', description: 'هاتف الممثلين وبريدهم الإلكتروني.' },
      write: { label: 'تعديل الممثلين', description: 'إضافة الممثلين وتعديل بياناتهم وصورهم وحذفهم (حذف الممثل يحذف أيضًا سجلّ ترشيحاته).' },
    },
    castings: {
      read: { label: 'عرض تجارب الأداء', description: 'تجارب الأداء وأدوارها والقوائم المختصرة.' },
      write: {
        label: 'العمل على تجارب الأداء',
        description: 'إنشاء تجارب الأداء والأدوار وتعديلها وحذفها، وإضافة الممثلين إلى القوائم المختصرة أو إزالتهم منها أو تحديدهم بـ«لم يتم الاختيار» أو «منسحب».',
      },
      send: { label: 'إرسال الممثلين إلى العملاء', description: 'ترشيح الممثلين: تم الترشيح، تجربة أداء، استدعاء ثانٍ، تم الاختيار.' },
    },
    admissions: {
      read: { label: 'عرض القبول', description: 'استفسارات الراغبين في الالتحاق، مع بيانات التواصل معهم والمقابلات وسجلّ المتابعة.' },
      write: {
        label: 'العمل على القبول',
        description: 'إضافة الاستفسارات وتعديلها، وتسجيل المكالمات والرسائل، وتحديد مواعيد المتابعة، وجدولة المقابلات، وإغلاق الاستفسارات وإعادة فتحها.',
      },
      decide: {
        label: 'قرارات القبول',
        description:
          'تسجيل تقييم المقابلات، والقبول أو الرفض، واختيار الصف (ومن ثَمّ المدرب)، وتسجيل الطالب. التسجيل يُنشئ الطالب وتسجيله في الصف حتى دون «تعديل الطلاب» أو «تعديل الصفوف».',
      },
    },
    payments: {
      status: { label: 'حالة الدفع', description: 'من دفع ومن لا يزال عليه مستحقات (مع وحدة الرسوم الدراسية).' },
      manage: { label: 'الأمور المالية', description: 'المبالغ والإجماليات والإيرادات والعمولات (مع وحدة الرسوم الدراسية).' },
    },
  },
};

const ns: Namespace<typeof en> = { en, ar };
export default ns;
