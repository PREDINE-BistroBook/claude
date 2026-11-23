/**
 * The public forms' HTML (labels, hints, required markers, autocomplete,
 * messages next to fields, the error summary, the hidden token and honeypot)
 * and turning a zod result into those messages. The two forms themselves are
 * in pages.ts; the POST handling (checks, rate limits, writes) in submit.ts.
 */
import { html, raw } from 'hono/html';
import type { z } from 'zod';
import type { Locale } from '../../shared/enums';
import type { SiteCtx } from './context';
import { INTL_LOCALE, fieldMessage, type SiteStrings } from './i18n';
import { icon, type Html } from './render';

/** Name of the hidden honeypot field: filled → a bot (pretend success, store nothing). */
export const HONEYPOT_FIELD = 'website';
/** Name of the hidden signed form token (lib/siteForms.ts). */
export const TOKEN_FIELD = 'formToken';

/** The date of birth's three choices (submit.ts joins them into `dateOfBirth`). */
export const DOB_PART_FIELDS = ['dobDay', 'dobMonth', 'dobYear'] as const;

export interface FormState {
  /** What was sent, to fill the fields again. */
  values: Record<string, string>;
  /** Field name → message in the page language. */
  errors: Record<string, string>;
  /** A message for the whole form (e.g. the token was refused: "please try again"). */
  formError?: string;
  /** The casting form came back: its photos must be chosen again. */
  photosAgain?: boolean;
}

export const emptyForm = (): FormState => ({ values: {}, errors: {} });

export const hasErrors = (s: FormState) => !!s.formError || Object.keys(s.errors).length > 0;

/** The text fields of a submitted form (files and unknown names ignored). */
export function formValues(fd: FormData, names: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of names) {
    const v = fd.get(name);
    if (typeof v === 'string') out[name] = v;
  }
  return out;
}

/**
 * zod issues → one message per field (the first), in the page language. A path
 * like ['links', 1] or ['photos', 0] belongs to its field (`fieldOf` can rename).
 */
export function issuesToErrors(
  t: SiteStrings,
  issues: readonly { path: readonly PropertyKey[]; message: string; code?: string }[],
  values: Record<string, string>,
  fieldOf: (path: readonly PropertyKey[]) => string = (p) => String(p[0] ?? ''),
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    const field = fieldOf(issue.path);
    if (!field || errors[field]) continue;
    errors[field] = messageFor(t, field, issue, values[field] ?? '');
  }
  return errors;
}

function messageFor(t: SiteStrings, field: string, issue: { message: string; code?: string }, value: string): string {
  const own = /^site:errors\./.test(issue.message);
  if (own) return fieldMessage(t, issue);
  // An empty required field says so, whatever check failed first.
  if (!value.trim() && ['firstName', 'lastName', 'phone', 'dateOfBirth', 'guardianName', 'guardianPhone'].includes(field)) return t.errors.required;
  switch (field) {
    case 'email':
      return t.errors.invalidEmail;
    case 'heightCm':
      return t.errors.invalidNumber;
    case 'links':
      return t.errors.invalidUrl;
    case 'languages':
    case 'skills':
      return t.errors.tooLong;
    case 'gender':
    case 'experience':
    case 'heardFrom':
      return value ? fieldMessage(t, issue) : t.errors.choose;
  }
  return fieldMessage(t, issue);
}

/** A zod result's issues (safeParse error) in the shape issuesToErrors takes. */
export const zodIssues = (err: z.ZodError) => err.issues.map((i) => ({ path: i.path, message: i.message, code: i.code }));

// ── Field markup ────────────────────────────────────────────────────────────

const fid = (name: string) => `f-${name}`;

/** The label with a "required" / "optional" marker; `required: null` → no marker (the guardian block explains when it's needed). */
function labelText(ctx: SiteCtx, label: string, required: boolean | null): Html {
  if (required === null) return html`${label}`;
  return html`${label}<span class="${required ? 'req' : 'opt'}">${required ? ctx.t.form.required : ctx.t.form.optional}</span>`;
}

function describedBy(name: string, hint: boolean, error: boolean): Html | '' {
  const ids = [hint ? `h-${name}` : '', error ? `e-${name}` : ''].filter(Boolean).join(' ');
  return ids ? html` aria-describedby="${ids}"` : '';
}

function errorLine(name: string, message: string | undefined): Html | '' {
  return message ? html`<p class="err" id="e-${name}">${icon('alert')}<span>${message}</span></p>` : '';
}

export interface TextFieldOptions {
  type?: 'text' | 'tel' | 'email' | 'date' | 'url';
  required?: boolean;
  /** No required/optional marker (fields needed only sometimes). */
  noMarker?: boolean;
  autocomplete?: string;
  inputmode?: 'tel' | 'numeric' | 'email' | 'url' | 'text';
  hint?: string;
  dir?: 'ltr' | 'rtl';
  maxlength?: number;
  min?: string;
  max?: string;
}

export function textField(ctx: SiteCtx, state: FormState, name: string, label: string, o: TextFieldOptions = {}): Html {
  const err = state.errors[name];
  const required = !!o.required;
  return html`<div class="field${err ? ' has-error' : ''}">
<label for="${fid(name)}">${labelText(ctx, label, o.noMarker ? null : required)}</label>
${o.hint ? html`<p class="hint" id="h-${name}">${o.hint}</p>` : ''}
<input id="${fid(name)}" name="${name}" type="${o.type ?? 'text'}" value="${state.values[name] ?? ''}"${required ? raw(' required') : ''}${o.autocomplete ? html` autocomplete="${o.autocomplete}"` : ''}${o.inputmode ? html` inputmode="${o.inputmode}"` : ''}${o.dir ? html` dir="${o.dir}"` : ''}${o.maxlength ? html` maxlength="${o.maxlength}"` : ''}${o.min ? html` min="${o.min}"` : ''}${o.max ? html` max="${o.max}"` : ''}${err ? raw(' aria-invalid="true"') : ''}${describedBy(name, !!o.hint, !!err)}>
${errorLine(name, err)}
</div>`;
}

export function textArea(ctx: SiteCtx, state: FormState, name: string, label: string, o: { required?: boolean; hint?: string; maxlength?: number; rows?: number; dir?: 'ltr' } = {}): Html {
  const err = state.errors[name];
  return html`<div class="field${err ? ' has-error' : ''}">
<label for="${fid(name)}">${labelText(ctx, label, !!o.required)}</label>
${o.hint ? html`<p class="hint" id="h-${name}">${o.hint}</p>` : ''}
<textarea id="${fid(name)}" name="${name}" rows="${o.rows ?? 4}"${o.required ? raw(' required') : ''}${o.maxlength ? html` maxlength="${o.maxlength}"` : ''}${o.dir ? html` dir="${o.dir}"` : ''}${err ? raw(' aria-invalid="true"') : ''}${describedBy(name, !!o.hint, !!err)}>${state.values[name] ?? ''}</textarea>
${errorLine(name, err)}
</div>`;
}

/** Big radio buttons in a fieldset; the first option carries the id the error summary links to. */
export function radios(ctx: SiteCtx, state: FormState, name: string, legend: string, options: readonly (readonly [string, string])[], required = true): Html {
  const err = state.errors[name];
  return html`<fieldset class="field${err ? ' has-error' : ''}"${describedBy(name, false, !!err)}>
<legend class="legend">${labelText(ctx, legend, required)}</legend>
<div class="choices">${options.map(
    ([value, label], i) =>
      html`<label class="choice"><input type="radio" name="${name}" value="${value}"${i === 0 ? html` id="${fid(name)}"` : ''}${state.values[name] === value ? raw(' checked') : ''}${required ? raw(' required') : ''}>${label}</label>`,
  )}</div>
${errorLine(name, err)}
</fieldset>`;
}

export function checkbox(_ctx: SiteCtx, state: FormState, name: string, label: string, required = false): Html {
  const err = state.errors[name];
  const checked = ['on', 'true', '1', 'yes'].includes(state.values[name] ?? '');
  return html`<div class="field${err ? ' has-error' : ''}">
<label class="choice check"><input type="checkbox" id="${fid(name)}" name="${name}"${checked ? raw(' checked') : ''}${required ? raw(' required') : ''}${err ? raw(' aria-invalid="true"') : ''}${describedBy(name, false, !!err)}><span>${label}</span></label>
${errorLine(name, err)}
</div>`;
}

export function fileField(ctx: SiteCtx, state: FormState, name: string, label: string, required: boolean): Html {
  const err = state.errors[name];
  return html`<div class="field${err ? ' has-error' : ''}">
<label for="${fid(name)}">${icon('camera')} ${labelText(ctx, label, required)}</label>
<input id="${fid(name)}" name="${name}" type="file" accept="image/jpeg,image/png,image/webp"${required ? raw(' required') : ''}${err ? raw(' aria-invalid="true"') : ''}${describedBy(name, false, !!err)}>
${errorLine(name, err)}
</div>`;
}

const monthNames = new Map<string, string[]>();
/** January … December in the page's language. */
function months(lang: Locale): string[] {
  let names = monthNames.get(lang);
  if (!names) {
    const f = new Intl.DateTimeFormat(INTL_LOCALE[lang], { month: 'long', timeZone: 'UTC' });
    names = Array.from({ length: 12 }, (_, m) => f.format(new Date(Date.UTC(2024, m, 15))));
    monthNames.set(lang, names);
  }
  return names;
}

/**
 * Date of birth as three plain lists — day, month by name, year — under one
 * legend. A phone's calendar picker opens on today's month and makes people
 * hunt for a way back to 1985 or 2016; three lists need no explaining. The
 * day list carries the id the error summary links to.
 */
export function dobField(ctx: SiteCtx, state: FormState, label: string): Html {
  const name = 'dateOfBirth';
  const err = state.errors[name];
  const f = ctx.t.form;
  const thisYear = Number(ctx.today.slice(0, 4)) || new Date().getUTCFullYear();
  const [dayName, monthName, yearName] = DOB_PART_FIELDS;
  const picked = (part: string, value: number) => (Number(state.values[part]) === value ? raw(' selected') : '');
  const list = (part: string, id: string, placeholder: string, autocomplete: string, options: readonly (readonly [number, string])[]) =>
    html`<select id="${id}" name="${part}" aria-label="${placeholder}" autocomplete="${autocomplete}" required${err ? raw(' aria-invalid="true"') : ''}><option value="">${placeholder}</option>${options.map(
      ([value, text]) => html`<option value="${value}"${picked(part, value)}>${text}</option>`,
    )}</select>`;
  return html`<fieldset class="field${err ? ' has-error' : ''}"${describedBy(name, false, !!err)}>
<legend class="legend">${labelText(ctx, label, true)}</legend>
<div class="dob">
${list(dayName, fid(name), f.dobDay, 'bday-day', Array.from({ length: 31 }, (_, i) => [i + 1, String(i + 1)] as const))}
${list(monthName, fid(monthName), f.dobMonth, 'bday-month', months(ctx.lang).map((m, i) => [i + 1, m] as const))}
${list(yearName, fid(yearName), f.dobYear, 'bday-year', Array.from({ length: 102 }, (_, i) => [thisYear - i, String(thisYear - i)] as const))}
</div>
${errorLine(name, err)}
</fieldset>`;
}

/** The hidden token and the honeypot (hidden with CSS, out of the tab order, hidden from screen readers). */
export function hiddenFields(ctx: SiteCtx, token: string): Html {
  return html`<input type="hidden" name="${TOKEN_FIELD}" value="${token}">
<div class="hp" aria-hidden="true"><label for="${fid(HONEYPOT_FIELD)}">${ctx.t.form.honeypot}</label><input id="${fid(HONEYPOT_FIELD)}" name="${HONEYPOT_FIELD}" type="text" tabindex="-1" autocomplete="off" value=""></div>`;
}

/** "First name: Please fill this in." — and no colon after a label that is a question ("How did you hear about us? Please choose one."). */
const labelled = (label: string, message: string) => (/[?؟]$/.test(label.trim()) ? `${label} ${message}` : `${label}: ${message}`);

/** The error summary at the top of a form: each message links to its field. */
export function errorSummary(ctx: SiteCtx, state: FormState, labels: Record<string, string>): Html | '' {
  if (!hasErrors(state)) return '';
  const items = Object.entries(state.errors);
  return html`<div class="summary" role="alert" id="errors">
<h2>${icon('alert')}${ctx.t.errors.summaryTitle}</h2>
${state.formError ? html`<p>${state.formError}</p>` : ''}
${items.length
  ? html`<p>${ctx.t.errors.summaryIntro}</p><ul>${items.map(([name, message]) => html`<li><a href="#${fid(name)}">${labelled(labels[name] ?? name, message)}</a></li>`)}</ul>`
  : ''}
${state.photosAgain ? html`<p class="note">${icon('camera')} ${ctx.t.form.photosAgain}</p>` : ''}
</div>`;
}
