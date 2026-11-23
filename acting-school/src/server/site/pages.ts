/**
 * The public website's pages, as HTML documents (layout.ts). Each takes the
 * request's SiteCtx; the route handlers (index.ts, submit.ts) load the data.
 */
import { html } from 'hono/html';
import { GENDERS, LOCALES, type Locale } from '../../shared/enums';
import { SITE_EXPERIENCE_LEVELS, SITE_HEARD_FROM } from '../../shared/schemas/site';
import type { PublicCoach, PublicWorkshop } from '../lib/siteContent';
import { contactBlock, feesButton, pageHead, pick, waButton, waHref, whatsappNumber, workshopCard, workshopFacts } from './components';
import type { SiteCtx } from './context';
import { checkbox, dobLimits, errorSummary, fileField, hiddenFields, radios, textArea, textField, type FormState } from './forms';
import { fmt } from './i18n';
import { layout } from './layout';
import type { SiteThanksKind } from './paths';
import { brandMark, excerpt, icon, instagramUrl, paragraphs, waLink, type Html } from './render';

const both = (f: (lang: Locale) => string) => Object.fromEntries(LOCALES.map((l) => [l, f(l)])) as Record<Locale, string>;

function title(ctx: SiteCtx, page?: string) {
  return page ? `${page} · ${ctx.studioName}` : ctx.studioName;
}

/** Meta description: the tagline, else the start of the about text, else a default. */
function description(ctx: SiteCtx): string {
  return pick(ctx, ctx.content.tagline) || excerpt(pick(ctx, ctx.content.about), 160) || ctx.t.meta.description;
}

const ogImage = (ctx: SiteCtx) => (ctx.content.heroFileId ? ctx.paths.media(ctx.content.heroFileId) : null);

// ── Home ────────────────────────────────────────────────────────────────────

export function homePage(ctx: SiteCtx, data: { workshops: PublicWorkshop[]; coaches: PublicCoach[] }): Html {
  const { t, lang, paths, content } = ctx;
  const tagline = pick(ctx, content.tagline);
  const about = pick(ctx, content.about);
  const generalWa = waHref(ctx, 'workshops', fmt(t.whatsapp.general, { name: ctx.studioName }));
  const body = html`
<section class="hero">
<div class="wrap">
${brandMark('mark')}
<h1>${ctx.studioName}</h1>
${tagline ? html`<p class="tagline">${tagline}</p>` : ''}
<div class="actions">
<a class="btn btn-bright" href="#workshops">${t.home.seeWorkshops}${icon('arrow')}</a>
${waButton(generalWa, t.home.whatsapp)}
</div>
${content.heroFileId ? html`<img class="hero-photo" src="${paths.media(content.heroFileId)}" alt="${t.home.heroPhotoAlt}" decoding="async">` : ''}
</div>
</section>
${content.castingCall.open
  ? html`<div class="wrap mt"><div class="banner">
<h2>${icon('clapper')}${t.home.castingTitle}</h2>
<p>${t.home.castingText}</p>
<div class="actions"><a class="btn btn-bright" href="${paths.castingCall(lang)}">${t.home.castingCta}${icon('arrow')}</a></div>
</div></div>`
  : ''}
${about ? html`<section class="block"><div class="wrap narrow"><h2>${t.home.aboutTitle}</h2>${paragraphs(about)}</div></section>` : ''}
<section class="block alt" id="workshops">
<div class="wrap">
<h2>${t.home.workshopsTitle}</h2>
${data.workshops.length
  ? html`<div class="grid two">${data.workshops.map((w) => workshopCard(ctx, w, { heading: 'h3', description: false }))}</div>`
  : html`<p class="lead">${t.home.noWorkshops}</p>`}
<div class="card mt"><div class="card-body">
<h3>${t.home.notSureTitle}</h3>
<p>${t.home.notSureText}</p>
<div class="actions"><a class="btn btn-primary" href="${paths.apply(lang)}">${t.home.askUs}${icon('arrow')}</a>${data.workshops.length > 1 ? html`<a class="btn btn-line" href="${paths.workshops(lang)}">${t.home.allWorkshops}</a>` : ''}</div>
</div></div>
</div>
</section>
${data.coaches.length
  ? html`<section class="block"><div class="wrap"><h2>${t.home.coachesTitle}</h2><div class="grid two">${data.coaches.map((c) => coachCard(ctx, c))}</div></div></section>`
  : ''}
<section class="block alt" id="contact"><div class="wrap"><h2>${t.home.contactTitle}</h2>${contactBlock(ctx)}</div></section>`;
  return layout({
    ...base(ctx),
    title: tagline ? `${ctx.studioName} · ${tagline}` : ctx.studioName,
    description: description(ctx),
    alternates: both((l) => paths.home(l)),
    current: 'home',
    ogImage: ogImage(ctx),
    body,
  });
}

function coachCard(ctx: SiteCtx, c: PublicCoach): Html {
  const name = pick(ctx, c.name);
  const role = pick(ctx, c.title);
  const bio = pick(ctx, c.bio);
  return html`<article class="card coach">
${c.photoFileId ? html`<img src="${ctx.paths.media(c.photoFileId)}" alt="${name}" loading="lazy" decoding="async" width="88" height="88">` : html`<span class="ph">${icon('user')}</span>`}
<div><h3>${name}</h3>${role ? html`<p class="t">${role}</p>` : ''}${bio ? paragraphs(bio) : ''}</div>
</article>`;
}

function base(ctx: SiteCtx) {
  return { lang: ctx.lang, t: ctx.t, paths: ctx.paths, origin: ctx.origin, studioName: ctx.studioName, content: ctx.content };
}

// ── Workshops ───────────────────────────────────────────────────────────────

export function workshopsPage(ctx: SiteCtx, workshops: PublicWorkshop[]): Html {
  const { t, paths } = ctx;
  const body = html`<div class="wrap">
${pageHead(t.nav.workshops, t.workshop.listIntro)}
${workshops.length
  ? html`<div class="grid two">${workshops.map((w) => workshopCard(ctx, w, { heading: 'h2', description: true }))}</div>`
  : html`<p class="lead">${t.home.noWorkshops}</p>${waButton(waHref(ctx, 'workshops', fmt(t.whatsapp.general, { name: ctx.studioName })), t.home.whatsapp)}`}
<div class="card mt"><div class="card-body">
<h2>${t.home.notSureTitle}</h2><p>${t.home.notSureText}</p>
<div class="actions"><a class="btn btn-primary" href="${paths.apply(ctx.lang)}">${t.home.askUs}${icon('arrow')}</a></div>
</div></div>
</div>`;
  return layout({ ...base(ctx), title: title(ctx, t.nav.workshops), description: t.workshop.listIntro, alternates: both((l) => paths.workshops(l)), current: 'workshops', ogImage: ogImage(ctx), body });
}

export function workshopPage(ctx: SiteCtx, w: PublicWorkshop, form: { state: FormState; token: string }): Html {
  const { t, paths, lang } = ctx;
  const wTitle = pick(ctx, w.title);
  const desc = pick(ctx, w.description);
  const body = html`<div class="wrap narrow">
<a class="back" href="${paths.workshops(lang)}">${icon('back')}${t.workshop.allWorkshops}</a>
<h1>${wTitle}</h1>
${w.coverFileId ? html`<img class="cover rounded" src="${paths.media(w.coverFileId)}" alt="${fmt(t.workshop.coverAlt, { title: wTitle })}" decoding="async">` : ''}
${workshopFacts(ctx, w)}
${desc ? paragraphs(desc) : ''}
<div class="actions">${feesButton(ctx, w)}</div>
${w.acceptingApplications
  ? html`<section class="form-card" id="apply">
<h2>${t.workshop.applyTitle}</h2>
<p>${t.workshop.applyIntro}</p>
${applyForm(ctx, paths.workshopApply(lang, w.courseId), form.state, form.token)}
</section>`
  : html`<p class="note mt">${t.workshop.notAccepting}</p>`}
</div>`;
  return layout({
    ...base(ctx),
    title: title(ctx, wTitle),
    description: excerpt(desc, 160) || description(ctx),
    alternates: both((l) => paths.workshop(l, w.courseId)),
    current: 'workshops',
    ogImage: w.coverFileId ? paths.media(w.coverFileId) : ogImage(ctx),
    noindex: Object.keys(form.state.values).length > 0,
    body,
  });
}

/** The general enquiry page ("Not sure which workshop? Ask us"). */
export function applyPage(ctx: SiteCtx, form: { state: FormState; token: string }): Html {
  const { t, paths, lang } = ctx;
  const body = html`<div class="wrap narrow">
${pageHead(t.apply.title, t.apply.intro)}
<section class="form-card" id="apply">${applyForm(ctx, paths.apply(lang), form.state, form.token)}</section>
</div>`;
  return layout({
    ...base(ctx),
    title: title(ctx, t.apply.title),
    description: t.apply.intro,
    alternates: both((l) => paths.apply(l)),
    noindex: Object.keys(form.state.values).length > 0,
    body,
  });
}

/** Labels for the error summary (field name → label). */
export function applyLabels(ctx: SiteCtx): Record<string, string> {
  const f = ctx.t.form;
  return {
    firstName: f.firstName,
    lastName: f.lastName,
    phone: f.phone,
    email: f.email,
    dateOfBirth: f.dateOfBirth,
    experience: f.experience,
    heardFrom: f.heardFrom,
    message: f.message,
    guardianName: f.guardianName,
    guardianPhone: f.guardianPhone,
    guardianConsent: f.guardianConsent,
    privacyConsent: f.privacyConsent,
  };
}

function applyForm(ctx: SiteCtx, action: string, state: FormState, token: string): Html {
  const { t } = ctx;
  const f = t.form;
  const dob = dobLimits(ctx.today);
  return html`${errorSummary(ctx, state, applyLabels(ctx))}
<form method="post" action="${action}#apply" accept-charset="utf-8">
${hiddenFields(ctx, token)}
${textField(ctx, state, 'firstName', f.firstName, { required: true, autocomplete: 'given-name', maxlength: 100 })}
${textField(ctx, state, 'lastName', f.lastName, { required: true, autocomplete: 'family-name', maxlength: 100 })}
${textField(ctx, state, 'phone', f.phone, { type: 'tel', required: true, autocomplete: 'tel', inputmode: 'tel', hint: f.phoneHint, dir: 'ltr', maxlength: 50 })}
${textField(ctx, state, 'email', f.email, { type: 'email', autocomplete: 'email', inputmode: 'email', dir: 'ltr', maxlength: 254 })}
${textField(ctx, state, 'dateOfBirth', f.dateOfBirth, { type: 'date', required: true, autocomplete: 'bday', min: dob.min, max: dob.max })}
${radios(ctx, state, 'experience', f.experience, SITE_EXPERIENCE_LEVELS.map((v) => [v, t.experience[v]] as const))}
${radios(ctx, state, 'heardFrom', f.heardFrom, SITE_HEARD_FROM.map((v) => [v, t.heardFrom[v]] as const))}
${textArea(ctx, state, 'message', f.message, { hint: f.messageHint, maxlength: 2000 })}
${guardianGroup(ctx, state)}
${checkbox(ctx, state, 'privacyConsent', f.privacyConsent, true)}
<button class="btn btn-primary" type="submit">${f.send}${icon('arrow')}</button>
<p class="privacy">${f.privacyApply}</p>
</form>`;
}

function guardianGroup(ctx: SiteCtx, state: FormState): Html {
  const f = ctx.t.form;
  return html`<div class="group">
<h3>${f.guardianTitle}</h3>
<p class="hint">${f.guardianIntro}</p>
${textField(ctx, state, 'guardianName', f.guardianName, { autocomplete: 'off', maxlength: 200 })}
${textField(ctx, state, 'guardianPhone', f.guardianPhone, { type: 'tel', autocomplete: 'off', inputmode: 'tel', dir: 'ltr', maxlength: 50 })}
${checkbox(ctx, state, 'guardianConsent', f.guardianConsent)}
</div>`;
}

// ── Casting call ────────────────────────────────────────────────────────────

/** Text fields of the casting form, in order (the photos travel separately). */
export const CASTING_TEXT_FIELDS = [
  'firstName',
  'lastName',
  'gender',
  'dateOfBirth',
  'phone',
  'email',
  'city',
  'heightCm',
  'languages',
  'skills',
  'experience',
  'links',
  'message',
  'guardianName',
  'guardianPhone',
  'guardianConsent',
  'privacyConsent',
] as const;
/** The three photo inputs; the first is the headshot. */
export const CASTING_PHOTO_FIELDS = ['photo1', 'photo2', 'photo3'] as const;

export function castingLabels(ctx: SiteCtx): Record<string, string> {
  const f = ctx.t.form;
  return {
    firstName: f.firstName,
    lastName: f.lastName,
    gender: f.gender,
    dateOfBirth: f.dateOfBirth,
    phone: f.phone,
    email: f.email,
    city: f.city,
    heightCm: f.height,
    languages: f.languages,
    skills: f.skills,
    experience: f.castingExperience,
    links: f.links,
    message: f.message,
    photo1: f.photo1,
    photo2: f.photo2,
    photo3: f.photo3,
    guardianName: f.guardianName,
    guardianPhone: f.guardianPhone,
    guardianConsent: f.guardianConsent,
    privacyConsent: f.privacyConsent,
  };
}

export function castingPage(ctx: SiteCtx, form: { state: FormState; token: string }): Html {
  const { t, paths, lang, content } = ctx;
  if (!content.castingCall.open) return castingClosedPage(ctx);
  const intro = pick(ctx, content.castingCall.intro);
  const lookingFor = pick(ctx, content.castingCall.lookingFor);
  const f = t.form;
  const state = form.state;
  const dob = dobLimits(ctx.today);
  const body = html`<div class="wrap narrow">
${pageHead(t.casting.title)}
${intro ? paragraphs(intro, 'lead') : ''}
${lookingFor ? html`<section class="card mt"><div class="card-body"><h2>${t.casting.lookingForTitle}</h2>${paragraphs(lookingFor)}</div></section>` : ''}
<section class="form-card" id="apply">
<h2>${t.casting.formTitle}</h2>
<p>${t.casting.formIntro}</p>
${errorSummary(ctx, state, castingLabels(ctx))}
<form method="post" action="${paths.castingCall(lang)}#apply" enctype="multipart/form-data" accept-charset="utf-8">
${hiddenFields(ctx, form.token)}
${textField(ctx, state, 'firstName', f.firstName, { required: true, autocomplete: 'given-name', maxlength: 100 })}
${textField(ctx, state, 'lastName', f.lastName, { required: true, autocomplete: 'family-name', maxlength: 100 })}
${radios(ctx, state, 'gender', f.gender, GENDERS.map((g) => [g, t.genders[g]] as const))}
${textField(ctx, state, 'dateOfBirth', f.dateOfBirth, { type: 'date', required: true, autocomplete: 'bday', min: dob.min, max: dob.max })}
${textField(ctx, state, 'phone', f.phone, { type: 'tel', required: true, autocomplete: 'tel', inputmode: 'tel', hint: f.phoneHint, dir: 'ltr', maxlength: 50 })}
${textField(ctx, state, 'email', f.email, { type: 'email', autocomplete: 'email', inputmode: 'email', dir: 'ltr', maxlength: 254 })}
${textField(ctx, state, 'city', f.city, { autocomplete: 'address-level2', maxlength: 100 })}
${textField(ctx, state, 'heightCm', f.height, { inputmode: 'numeric', maxlength: 3, dir: 'ltr' })}
${textField(ctx, state, 'languages', f.languages, { hint: f.languagesHint, maxlength: 600 })}
${textField(ctx, state, 'skills', f.skills, { hint: f.skillsHint, maxlength: 1200 })}
${textArea(ctx, state, 'experience', f.castingExperience, { hint: f.castingExperienceHint, maxlength: 2000 })}
${textArea(ctx, state, 'links', f.links, { hint: f.linksHint, rows: 3, dir: 'ltr', maxlength: 1600 })}
${textArea(ctx, state, 'message', f.message, { maxlength: 2000 })}
<div class="group">
<h3>${f.photosTitle}</h3>
<p class="hint">${f.photosHint}</p>
${state.photosAgain ? html`<p class="note">${icon('camera')} ${f.photosAgain}</p>` : ''}
${fileField(ctx, state, 'photo1', f.photo1, true)}
${fileField(ctx, state, 'photo2', f.photo2, false)}
${fileField(ctx, state, 'photo3', f.photo3, false)}
</div>
${guardianGroup(ctx, state)}
${checkbox(ctx, state, 'privacyConsent', f.privacyConsent, true)}
<button class="btn btn-primary" type="submit">${f.sendCasting}${icon('arrow')}</button>
<p class="privacy">${f.privacyCasting}</p>
</form>
</section>
</div>`;
  return layout({
    ...base(ctx),
    title: title(ctx, t.casting.title),
    description: excerpt(intro, 160) || t.home.castingText,
    alternates: both((l) => paths.castingCall(l)),
    current: 'castingCall',
    ogImage: ogImage(ctx),
    noindex: Object.keys(state.values).length > 0,
    body,
  });
}

/** No open casting call (also the 410 answer to a POST then). */
export function castingClosedPage(ctx: SiteCtx): Html {
  const { t, paths } = ctx;
  const ig = instagramUrl(ctx.content.instagram);
  const body = html`<div class="wrap narrow center pad">
<div class="ok">${icon('clapper')}</div>
<h1>${t.casting.closedTitle}</h1>
<p class="lead">${t.casting.closedText}</p>
<div class="actions centered">
${ig ? html`<a class="btn btn-primary" href="${ig}" rel="noopener">${icon('instagram')}<span>${t.casting.followInstagram}</span></a>` : ''}
<a class="btn btn-line" href="${paths.home(ctx.lang)}">${t.pages.home}</a>
</div>
</div>`;
  return layout({ ...base(ctx), title: title(ctx, t.casting.title), description: t.casting.closedText, alternates: both((l) => paths.castingCall(l)), current: 'castingCall', body });
}

// ── Link in bio ─────────────────────────────────────────────────────────────

export function linksPage(ctx: SiteCtx, workshops: PublicWorkshop[]): Html {
  const { t, paths, lang, content } = ctx;
  const tagline = pick(ctx, content.tagline);
  const ig = instagramUrl(content.instagram);
  const wa = (line: 'workshops' | 'casting', label: string) => {
    const number = line === 'casting' ? content.whatsappCasting : content.whatsappWorkshops;
    const text = fmt(line === 'casting' ? t.whatsapp.casting : t.whatsapp.general, { name: ctx.studioName });
    return waButton(number ? waLink(number, ctx.countryCode, text) : null, label);
  };
  const custom = content.links.filter((l) => l.visible && pick(ctx, l.label));
  const body = html`${brandMark('mark')}
<h1>${ctx.studioName}</h1>
${tagline ? html`<p class="tagline">${tagline}</p>` : ''}
<div class="stack">
${workshops
  .filter((w) => w.acceptingApplications)
  .map((w) => html`<a class="btn btn-bright" href="${paths.workshop(lang, w.courseId)}#apply">${icon('calendar')}<span>${pick(ctx, w.title)}<small>${t.links.workshopApply}</small></span></a>`)}
${content.castingCall.open ? html`<a class="btn btn-bright" href="${paths.castingCall(lang)}">${icon('clapper')}<span>${t.links.castingCall}</span></a>` : ''}
${wa('workshops', t.links.whatsappWorkshops)}
${wa('casting', t.links.whatsappCasting)}
${ig ? html`<a class="btn btn-line" href="${ig}" rel="noopener">${icon('instagram')}<span>${t.links.instagram}<small dir="ltr">@${content.instagram}</small></span></a>` : ''}
${custom.map((l) => html`<a class="btn btn-line" href="${l.url}" rel="noopener">${icon('link')}<span>${pick(ctx, l.label)}</span></a>`)}
<a class="btn btn-line" href="${paths.home(lang)}">${icon('globe')}<span>${t.links.website}</span></a>
</div>`;
  return layout({
    ...base(ctx),
    title: title(ctx, t.links.title),
    description: description(ctx),
    alternates: both((l) => paths.links(l)),
    current: 'links',
    ogImage: ogImage(ctx),
    bare: true,
    body,
  });
}

// ── Thanks and friendly errors ──────────────────────────────────────────────

export function thanksPage(ctx: SiteCtx, kind: SiteThanksKind): Html {
  const { t, paths, lang } = ctx;
  const casting = kind === 'casting';
  const wa = waHref(ctx, casting ? 'casting' : 'workshops', fmt(casting ? t.whatsapp.afterCasting : t.whatsapp.afterApply, { name: ctx.studioName }));
  const body = html`<div class="wrap narrow center pad">
<div class="ok">${icon('check')}</div>
<h1>${casting ? t.thanks.castingTitle : t.thanks.applyTitle}</h1>
<p class="lead">${casting ? t.thanks.castingText : t.thanks.applyText}</p>
<div class="actions centered">
${waButton(wa, t.thanks.whatsapp)}
<a class="btn btn-line" href="${paths.home(lang)}">${t.thanks.home}</a>
</div>
</div>`;
  return layout({
    ...base(ctx),
    title: title(ctx, casting ? t.thanks.castingTitle : t.thanks.applyTitle),
    description: description(ctx),
    alternates: both((l) => paths.thanks(l, kind)),
    noindex: true,
    body,
  });
}

export type ErrorPageKind = 'notFound' | 'tooMany' | 'tooLarge' | 'forbidden' | 'error';

/** A friendly error page in the page's language, with WhatsApp and a way home. */
export function errorPage(ctx: SiteCtx, kind: ErrorPageKind, back?: string): Html {
  const { t, paths, lang } = ctx;
  const text = {
    notFound: [t.pages.notFoundTitle, t.pages.notFoundText],
    tooMany: [t.pages.tooManyTitle, t.pages.tooManyText],
    tooLarge: [t.pages.tooLargeTitle, t.pages.tooLargeText],
    forbidden: [t.pages.forbiddenTitle, t.pages.forbiddenText],
    error: [t.pages.errorTitle, t.pages.errorText],
  }[kind];
  const number = whatsappNumber(ctx.content, 'workshops');
  const wa = number ? waLink(number, ctx.countryCode, fmt(t.whatsapp.general, { name: ctx.studioName })) : null;
  const body = html`<div class="wrap narrow center pad">
<div class="ok bad">${icon('alert')}</div>
<h1>${text[0]}</h1>
<p class="lead">${text[1]}</p>
<div class="actions centered">
${back ? html`<a class="btn btn-primary" href="${back}">${icon('back')}${t.pages.backToForm}</a>` : ''}
${waButton(wa, t.home.whatsapp)}
<a class="btn btn-line" href="${paths.home(lang)}">${t.pages.home}</a>
</div>
</div>`;
  return layout({ ...base(ctx), title: title(ctx, text[0]), description: text[1], alternates: null, noindex: true, body });
}
