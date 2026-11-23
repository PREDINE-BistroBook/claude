/**
 * Every visible string of the public website, in English and Arabic. `ar` is
 * typed against `en`, so a missing Arabic string is a type error. Placeholders
 * are {name}, filled by fmt(). The page language comes from :lang.
 */
import type { CourseLevel, Gender, Locale } from '../../shared/enums';
import type { SiteExperienceLevel, SiteFormErrorKey, SiteHeardFrom } from '../../shared/schemas/site';

const en = {
  meta: {
    /** When the school has no name set yet. */
    studioName: 'Turquoise Studio',
    description: 'Acting workshops and casting in Giza.',
    skip: 'Skip to the content',
    mainMenu: 'Main menu',
    otherLanguage: 'العربية',
    otherLanguageLabel: 'اقرأ هذه الصفحة بالعربية',
  },
  nav: {
    home: 'Home',
    workshops: 'Workshops',
    castingCall: 'Casting call',
    links: 'Links',
  },
  home: {
    seeWorkshops: 'See our workshops',
    whatsapp: 'Message us on WhatsApp',
    heroPhotoAlt: 'At the studio',
    aboutTitle: 'About the studio',
    workshopsTitle: 'Open workshops',
    noWorkshops: 'New workshops are coming soon. Message us on WhatsApp and we will tell you first.',
    allWorkshops: 'See all workshops',
    notSureTitle: 'Not sure which workshop is for you?',
    notSureText: 'Tell us a little about yourself and we will help you choose.',
    askUs: 'Ask us',
    castingTitle: 'Our casting call is open',
    castingText: 'Actors, new faces and children (with a parent’s consent): send us your details and photos.',
    castingCta: 'Apply to the casting call',
    coachesTitle: 'Our coaches',
    contactTitle: 'Visit or contact us',
  },
  workshop: {
    when: 'Dates',
    dateRange: '{start} to {end}',
    times: 'Days and times',
    coach: 'Coach',
    level: 'Level',
    apply: 'Apply',
    details: 'More about this workshop',
    askFees: 'Ask about fees on WhatsApp',
    feesMessage: 'Hello, I would like to know the fees for the “{title}” workshop.',
    allWorkshops: 'All workshops',
    applyTitle: 'Apply for this workshop',
    applyIntro: 'Fill in this short form. Our team will contact you on WhatsApp.',
    notAccepting: 'This workshop is not taking new applications right now. Message us on WhatsApp to hear about the next one.',
    listIntro: 'Choose a workshop and press “Apply”. Our team will contact you on WhatsApp to tell you everything, including the fees.',
    coverAlt: 'Photo of the {title} workshop',
  },
  levels: {
    beginner: 'Beginners',
    intermediate: 'Intermediate',
    advanced: 'Advanced',
    all_levels: 'All levels',
  } satisfies Record<CourseLevel, string>,
  apply: {
    title: 'Ask us',
    intro: 'Not sure which workshop fits you? Tell us about yourself and our team will contact you on WhatsApp to help you choose.',
    general: 'General question',
  },
  form: {
    required: 'required',
    optional: 'optional',
    firstName: 'First name',
    lastName: 'Last name',
    phone: 'Phone number (WhatsApp)',
    phoneHint: 'We will contact you on this number.',
    email: 'Email',
    dateOfBirth: 'Date of birth',
    /** The three lists of the date of birth (placeholders and screen-reader names). */
    dobDay: 'Day',
    dobMonth: 'Month',
    dobYear: 'Year',
    experience: 'Acting experience',
    heardFrom: 'How did you hear about us?',
    message: 'Your message',
    messageHint: 'Any questions, or which days suit you.',
    guardianTitle: 'Under 18? A parent or guardian',
    guardianIntro: 'Fill this in only if the person applying is under 18. A parent or guardian must agree.',
    guardianName: 'Parent or guardian’s name',
    guardianPhone: 'Parent or guardian’s phone',
    guardianConsent: 'I am the parent or guardian, and I agree to this application.',
    privacyConsent: 'I agree that the studio keeps these details to answer me.',
    /** The two tick boxes, as the error summary names them. */
    guardianConsentShort: 'Parent or guardian’s agreement',
    privacyConsentShort: 'Agreement to keep your details',
    send: 'Send',
    honeypot: 'Leave this empty',
    privacyApply:
      'Privacy: we keep these details only to answer you and to arrange your workshop. Our team will contact you on WhatsApp or by phone. We do not share them with anyone else.',
    // Casting call
    gender: 'Gender',
    city: 'City',
    height: 'Height in centimetres',
    languages: 'Languages you speak',
    languagesHint: 'Separate them with commas, for example: Arabic, English.',
    skills: 'Skills',
    skillsHint: 'For example: dancing, singing, horse riding, sports.',
    castingExperience: 'Acting experience',
    castingExperienceHint: 'Films, series, adverts, theatre, workshops. Write “none” if you are new.',
    links: 'Links (Instagram, showreel)',
    linksHint: 'Write your Instagram name like @yourname, or paste a link. Up to 3, one on each line.',
    photosTitle: 'Your photos',
    photosHint: 'JPG or PNG, up to 6 MB each. Recent photos without filters work best.',
    photo1: 'Photo of your face',
    photo2: 'Second photo',
    photo3: 'Third photo',
    photosAgain: 'Photos are not kept when the form needs a change. Please choose your photos again.',
    sendCasting: 'Send my application',
    privacyCasting:
      'Privacy: we keep your details and photos so our casting team can consider you for roles. We will contact you on WhatsApp or by phone. Message us on WhatsApp at any time if you want them deleted.',
  },
  experience: {
    none: 'None yet',
    some: 'Some',
    a_lot: 'A lot',
  } satisfies Record<SiteExperienceLevel, string>,
  heardFrom: {
    instagram: 'Instagram',
    friend: 'A friend',
    other: 'Somewhere else',
  } satisfies Record<SiteHeardFrom, string>,
  genders: {
    female: 'Female',
    male: 'Male',
    other: 'Other',
  } satisfies Record<Gender, string>,
  errors: {
    summaryTitle: 'Please check the form',
    summaryIntro: 'Some answers need a change:',
    tryAgain: 'Sorry, we could not send that. Please check your answers and press the button again.',
    required: 'Please fill this in.',
    tooLong: 'This is too long. Please shorten it.',
    invalidDate: 'Please enter a real date.',
    invalidEmail: 'Please enter a correct email address, or leave it empty.',
    invalidUrl: 'Please write your Instagram name like @yourname, or paste the whole link.',
    choose: 'Please choose one.',
    invalidNumber: 'Please enter a number in centimetres (50 to 250), or leave it empty.',
    invalid: 'Please check this answer.',
  },
  formErrors: {
    invalidPhone: 'Please enter a phone number we can reach on WhatsApp.',
    ageRange: 'Please check the date of birth (age 5 to 100).',
    guardianConsent: 'A parent or guardian must agree for anyone under 18.',
    privacyConsent: 'Please tick this box to agree.',
    tooManyLinks: 'Please give 3 links at most.',
    photoRequired: 'Please add a photo of your face.',
    tooManyPhotos: 'Please choose 3 photos at most.',
    photoTooLarge: 'This photo is too big. Please choose one under 6 MB.',
    photoType: 'Please choose a JPG or PNG photo.',
  } satisfies Record<SiteFormErrorKey, string>,
  casting: {
    title: 'Casting call',
    lookingForTitle: 'Who we are looking for',
    formTitle: 'Apply to the casting call',
    formIntro: 'It takes about five minutes. Have one or two recent photos ready.',
    closedTitle: 'There is no open casting call right now',
    closedText: 'Follow us on Instagram to hear about the next one.',
    followInstagram: 'Follow us on Instagram',
  },
  links: {
    title: 'Links',
    castingCall: 'Casting call: apply now',
    whatsappWorkshops: 'WhatsApp: workshops',
    whatsappCasting: 'WhatsApp: casting',
    instagram: 'Instagram',
    website: 'Our website',
    workshopApply: 'Workshop: apply',
  },
  thanks: {
    applyTitle: 'Thank you! We received your message.',
    applyText: 'Our team will contact you on WhatsApp soon.',
    castingTitle: 'Thank you! We received your application.',
    castingText: 'Our casting team looks at every application. If there is a role for you, we will contact you on WhatsApp or by phone.',
    whatsapp: 'Message us on WhatsApp',
    home: 'Back to the home page',
  },
  whatsapp: {
    general: 'Hello {name}, I have a question.',
    casting: 'Hello {name}, I have a question about the casting call.',
    afterApply: 'Hello {name}, I have just sent the form on your website.',
    afterCasting: 'Hello {name}, I have just applied to the casting call on your website.',
  },
  contact: {
    whatsappWorkshops: 'WhatsApp for workshops',
    whatsappCasting: 'WhatsApp for casting',
    call: 'Call us',
    email: 'Email us',
    instagram: 'Instagram',
    address: 'Address',
    map: 'Open the map',
  },
  pages: {
    notFoundTitle: 'We can’t find that page',
    notFoundText: 'It may have moved, or the workshop may be over.',
    tooManyTitle: 'Too many tries for now',
    tooManyText: 'Please wait a little and try again later, or message us on WhatsApp.',
    busyTitle: 'Many people are applying right now',
    busyText: 'Please wait a minute and send your application again, or message us on WhatsApp.',
    tooLargeTitle: 'The photos are too big',
    tooLargeText: 'Please go back and choose smaller photos (up to 6 MB each), or send them to us on WhatsApp.',
    forbiddenTitle: 'We could not send that',
    forbiddenText: 'Please open the page again and send the form from there.',
    errorTitle: 'Sorry, something went wrong',
    errorText: 'Please try again in a moment, or message us on WhatsApp.',
    home: 'Go to the home page',
    backToForm: 'Back to the form',
  },
  footer: {
    rights: '© {year} {name}',
  },
} as const;

/** The same shape as `en` with every string widened, so `ar` must give each one. */
type Strings<T> = { [K in keyof T]: T[K] extends string ? string : Strings<T[K]> };
export type SiteStrings = Strings<typeof en>;

const ar: SiteStrings = {
  meta: {
    studioName: 'استوديو تركواز',
    description: 'ورش تمثيل وكاستينج في الجيزة.',
    skip: 'انتقل إلى المحتوى',
    mainMenu: 'القائمة الرئيسية',
    otherLanguage: 'English',
    otherLanguageLabel: 'Read this page in English',
  },
  nav: {
    home: 'الرئيسية',
    workshops: 'الورش',
    castingCall: 'الكاستينج',
    links: 'الروابط',
  },
  home: {
    seeWorkshops: 'تصفّح الورش',
    whatsapp: 'راسلنا على واتساب',
    heroPhotoAlt: 'في الاستوديو',
    aboutTitle: 'عن الاستوديو',
    workshopsTitle: 'الورش المفتوحة',
    noWorkshops: 'ورش جديدة قريبًا. راسلنا على واتساب وسنخبرك أولًا.',
    allWorkshops: 'كل الورش',
    notSureTitle: 'لست متأكدًا أي ورشة تناسبك؟',
    notSureText: 'أخبرنا قليلًا عن نفسك وسنساعدك على الاختيار.',
    askUs: 'اسألنا',
    castingTitle: 'باب الكاستينج مفتوح',
    castingText: 'ممثلون ووجوه جديدة وأطفال (بموافقة وليّ الأمر): أرسلوا بياناتكم وصوركم.',
    castingCta: 'قدّم في الكاستينج',
    coachesTitle: 'مدربونا',
    contactTitle: 'زورونا أو تواصلوا معنا',
  },
  workshop: {
    when: 'المواعيد',
    dateRange: 'من {start} إلى {end}',
    times: 'الأيام والساعات',
    coach: 'المدرب',
    level: 'المستوى',
    apply: 'قدّم الآن',
    details: 'تفاصيل الورشة',
    askFees: 'اسأل عن الرسوم على واتساب',
    feesMessage: 'مرحبًا، أود معرفة رسوم ورشة «{title}».',
    allWorkshops: 'كل الورش',
    applyTitle: 'قدّم في هذه الورشة',
    applyIntro: 'املأ هذا النموذج القصير، وسيتواصل معك فريقنا على واتساب.',
    notAccepting: 'هذه الورشة لا تستقبل طلبات جديدة حاليًا. راسلنا على واتساب لتعرف موعد الورشة القادمة.',
    listIntro: 'اختر ورشة واضغط «قدّم الآن»، وسيتواصل معك فريقنا على واتساب ليخبرك بكل التفاصيل، ومنها الرسوم.',
    coverAlt: 'صورة ورشة {title}',
  },
  levels: {
    beginner: 'للمبتدئين',
    intermediate: 'متوسط',
    advanced: 'متقدم',
    all_levels: 'لكل المستويات',
  },
  apply: {
    title: 'اسألنا',
    intro: 'لست متأكدًا أي ورشة تناسبك؟ أخبرنا عن نفسك، وسيتواصل معك فريقنا على واتساب ليساعدك على الاختيار.',
    general: 'سؤال عام',
  },
  form: {
    required: 'مطلوب',
    optional: 'اختياري',
    firstName: 'الاسم الأول',
    lastName: 'اسم العائلة',
    phone: 'رقم الهاتف (واتساب)',
    phoneHint: 'سنتواصل معك على هذا الرقم.',
    email: 'البريد الإلكتروني',
    dateOfBirth: 'تاريخ الميلاد',
    dobDay: 'اليوم',
    dobMonth: 'الشهر',
    dobYear: 'السنة',
    experience: 'خبرتك في التمثيل',
    heardFrom: 'كيف عرفت عنا؟',
    message: 'رسالتك',
    messageHint: 'أي أسئلة، أو الأيام المناسبة لك.',
    guardianTitle: 'أقل من 18 سنة؟ بيانات وليّ الأمر',
    guardianIntro: 'املأ هذا الجزء فقط إذا كان المتقدّم أقل من 18 سنة. يجب أن يوافق وليّ الأمر.',
    guardianName: 'اسم وليّ الأمر',
    guardianPhone: 'هاتف وليّ الأمر',
    guardianConsent: 'أنا وليّ الأمر، وأوافق على هذا الطلب.',
    privacyConsent: 'أوافق على أن يحتفظ الاستوديو بهذه البيانات للرد عليّ.',
    guardianConsentShort: 'موافقة وليّ الأمر',
    privacyConsentShort: 'الموافقة على حفظ بياناتك',
    send: 'إرسال',
    honeypot: 'اترك هذا الحقل فارغًا',
    privacyApply: 'الخصوصية: نحتفظ بهذه البيانات فقط للرد عليك وترتيب ورشتك. سيتواصل معك فريقنا على واتساب أو بالهاتف. لا نشاركها مع أي أحد آخر.',
    gender: 'النوع',
    city: 'المدينة',
    height: 'الطول بالسنتيمتر',
    languages: 'اللغات التي تتحدثها',
    languagesHint: 'افصل بينها بفاصلة، مثلًا: العربية، الإنجليزية.',
    skills: 'المهارات',
    skillsHint: 'مثلًا: الرقص، الغناء، ركوب الخيل، الرياضة.',
    castingExperience: 'خبرتك في التمثيل',
    castingExperienceHint: 'أفلام، مسلسلات، إعلانات، مسرح، ورش. اكتب «لا يوجد» إذا كنت جديدًا.',
    links: 'روابط (إنستجرام، فيديو لأعمالك)',
    linksHint: 'اكتب اسم حسابك على إنستجرام مثل \u2066@yourname\u2069، أو الصق رابطًا. حتى 3 روابط، كل رابط في سطر.',
    photosTitle: 'صورك',
    photosHint: 'بصيغة JPG أو PNG، حتى 6 ميجابايت لكل صورة. الصور الحديثة بدون فلاتر هي الأفضل.',
    photo1: 'صورة لوجهك',
    photo2: 'صورة ثانية',
    photo3: 'صورة ثالثة',
    photosAgain: 'لا نحتفظ بالصور عندما يحتاج النموذج إلى تعديل. من فضلك اختر صورك مرة أخرى.',
    sendCasting: 'أرسل طلبي',
    privacyCasting: 'الخصوصية: نحتفظ ببياناتك وصورك ليتمكن فريق الكاستينج من ترشيحك للأدوار. سنتواصل معك على واتساب أو بالهاتف. راسلنا على واتساب في أي وقت إذا أردت حذفها.',
  },
  experience: {
    none: 'لا توجد بعد',
    some: 'بعض الخبرة',
    a_lot: 'خبرة كبيرة',
  },
  heardFrom: {
    instagram: 'إنستجرام',
    friend: 'من صديق',
    other: 'من مكان آخر',
  },
  genders: {
    female: 'أنثى',
    male: 'ذكر',
    other: 'آخر',
  },
  errors: {
    summaryTitle: 'من فضلك راجع النموذج',
    summaryIntro: 'بعض الإجابات تحتاج إلى تعديل:',
    tryAgain: 'عذرًا، لم نتمكن من الإرسال. من فضلك راجع إجاباتك واضغط الزر مرة أخرى.',
    required: 'من فضلك املأ هذا الحقل.',
    tooLong: 'هذا النص طويل جدًا. من فضلك اختصره.',
    invalidDate: 'من فضلك أدخل تاريخًا صحيحًا.',
    invalidEmail: 'من فضلك أدخل بريدًا إلكترونيًا صحيحًا، أو اتركه فارغًا.',
    invalidUrl: 'من فضلك اكتب اسم حسابك على إنستجرام مثل \u2066@yourname\u2069، أو الصق الرابط كاملًا.',
    choose: 'من فضلك اختر إجابة.',
    invalidNumber: 'من فضلك أدخل رقمًا بالسنتيمتر (من 50 إلى 250)، أو اتركه فارغًا.',
    invalid: 'من فضلك راجع هذه الإجابة.',
  },
  formErrors: {
    invalidPhone: 'من فضلك أدخل رقم هاتف نستطيع التواصل معه على واتساب.',
    ageRange: 'من فضلك راجع تاريخ الميلاد (العمر من 5 إلى 100 سنة).',
    guardianConsent: 'يجب أن يوافق وليّ الأمر لمن هم أقل من 18 سنة.',
    privacyConsent: 'من فضلك ضع علامة في هذا المربع للموافقة.',
    tooManyLinks: 'من فضلك أضف 3 روابط على الأكثر.',
    photoRequired: 'من فضلك أضف صورة لوجهك.',
    tooManyPhotos: 'من فضلك اختر 3 صور على الأكثر.',
    photoTooLarge: 'هذه الصورة كبيرة جدًا. من فضلك اختر صورة أقل من 6 ميجابايت.',
    photoType: 'من فضلك اختر صورة بصيغة JPG أو PNG.',
  },
  casting: {
    title: 'الكاستينج',
    lookingForTitle: 'من نبحث عنه',
    formTitle: 'قدّم في الكاستينج',
    formIntro: 'يستغرق حوالي خمس دقائق. جهّز صورة أو صورتين حديثتين.',
    closedTitle: 'لا يوجد كاستينج مفتوح حاليًا',
    closedText: 'تابعنا على إنستجرام لتعرف موعد الكاستينج القادم.',
    followInstagram: 'تابعنا على إنستجرام',
  },
  links: {
    title: 'الروابط',
    castingCall: 'الكاستينج: قدّم الآن',
    whatsappWorkshops: 'واتساب: الورش',
    whatsappCasting: 'واتساب: الكاستينج',
    instagram: 'إنستجرام',
    website: 'موقعنا',
    workshopApply: 'ورشة: قدّم الآن',
  },
  thanks: {
    applyTitle: 'شكرًا لك! وصلتنا رسالتك.',
    applyText: 'سيتواصل معك فريقنا على واتساب قريبًا.',
    castingTitle: 'شكرًا لك! وصلنا طلبك.',
    castingText: 'يطّلع فريق الكاستينج على كل طلب. إذا كان هناك دور مناسب لك، سنتواصل معك على واتساب أو بالهاتف.',
    whatsapp: 'راسلنا على واتساب',
    home: 'العودة إلى الصفحة الرئيسية',
  },
  whatsapp: {
    general: 'مرحبًا {name}، عندي سؤال.',
    casting: 'مرحبًا {name}، عندي سؤال عن الكاستينج.',
    afterApply: 'مرحبًا {name}، أرسلت النموذج على موقعكم الآن.',
    afterCasting: 'مرحبًا {name}، قدّمت الآن في الكاستينج على موقعكم.',
  },
  contact: {
    whatsappWorkshops: 'واتساب للورش',
    whatsappCasting: 'واتساب للكاستينج',
    call: 'اتصل بنا',
    email: 'راسلنا بالبريد الإلكتروني',
    instagram: 'إنستجرام',
    address: 'العنوان',
    map: 'افتح الخريطة',
  },
  pages: {
    notFoundTitle: 'لم نجد هذه الصفحة',
    notFoundText: 'ربما نُقلت، أو انتهت الورشة.',
    tooManyTitle: 'محاولات كثيرة في وقت قصير',
    tooManyText: 'من فضلك انتظر قليلًا وحاول لاحقًا، أو راسلنا على واتساب.',
    busyTitle: 'كثيرون يقدّمون الآن',
    busyText: 'من فضلك انتظر دقيقة ثم أرسل طلبك مرة أخرى، أو راسلنا على واتساب.',
    tooLargeTitle: 'الصور كبيرة جدًا',
    tooLargeText: 'من فضلك ارجع واختر صورًا أصغر (حتى 6 ميجابايت لكل صورة)، أو أرسلها لنا على واتساب.',
    forbiddenTitle: 'لم نتمكن من الإرسال',
    forbiddenText: 'من فضلك افتح الصفحة من جديد وأرسل النموذج منها.',
    errorTitle: 'عذرًا، حدث خطأ',
    errorText: 'من فضلك حاول مرة أخرى بعد قليل، أو راسلنا على واتساب.',
    home: 'اذهب إلى الصفحة الرئيسية',
    backToForm: 'العودة إلى النموذج',
  },
  footer: {
    rights: '© {year} {name}',
  },
};

export const SITE_STRINGS: Record<Locale, SiteStrings> = { en, ar };

/** "{name}"-style placeholders → values (missing ones stay as they are). */
export function fmt(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, key: string) => (key in vars ? String(vars[key]) : m));
}

/** Locale for Intl in each page language: Arabic with Western digits, as the staff app (src/web/lib/format.ts). */
export const INTL_LOCALE: Record<Locale, string> = { en: 'en-GB', ar: 'ar-u-nu-latn' };

/**
 * A validation message (zod issue message or code) → the page's wording.
 * Messages are 'errors.<key>' (common), 'site:errors.<key>' (the public forms)
 * or zod's own (then the issue code decides).
 */
export function fieldMessage(t: SiteStrings, issue: { message: string; code?: string }): string {
  const m = /^(?:site:)?errors\.(\w+)$/.exec(issue.message);
  const key = m?.[1];
  if (key) {
    if (key in t.formErrors) return t.formErrors[key as SiteFormErrorKey];
    if (key === 'invalidDate') return t.errors.invalidDate;
    if (key === 'invalidUrl') return t.errors.invalidUrl;
    if (key === 'required') return t.errors.required;
    return t.errors.invalid;
  }
  switch (issue.code) {
    case 'invalid_type':
      return t.errors.required;
    case 'too_small':
      return t.errors.required;
    case 'too_big':
      return t.errors.tooLong;
    case 'invalid_value':
      return t.errors.choose;
    default:
      return t.errors.invalid;
  }
}
