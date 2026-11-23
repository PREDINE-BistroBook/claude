/**
 * Pieces shared by several public pages: WhatsApp buttons, workshop cards,
 * the contact block, page headings.
 */
import { html } from 'hono/html';
import type { SiteContent } from '../../shared/schemas/site';
import type { PublicWorkshop } from '../lib/siteContent';
import type { SiteCtx } from './context';
import { fmt } from './i18n';
import { dateRange, excerpt, icon, instagramUrl, scheduleLines, telLink, waLink, type Html } from './render';

/** The page language's half of a bilingual text, else the other half. */
export function pick(ctx: SiteCtx, b: { en: string; ar: string }): string {
  return (ctx.lang === 'ar' ? b.ar : b.en).trim() || (ctx.lang === 'ar' ? b.en : b.ar).trim();
}

export type WhatsAppLine = 'workshops' | 'casting';

/** The studio's WhatsApp number for workshops or casting (each falls back to the other). */
export function whatsappNumber(content: SiteContent, line: WhatsAppLine): string | null {
  return line === 'casting' ? content.whatsappCasting || content.whatsappWorkshops : content.whatsappWorkshops || content.whatsappCasting;
}

/** wa.me link to that line with a message in the page's language. */
export function waHref(ctx: SiteCtx, line: WhatsAppLine, message: string): string | null {
  return waLink(whatsappNumber(ctx.content, line), ctx.countryCode, message);
}

export function waButton(href: string | null, label: string, cls = 'btn btn-wa'): Html | '' {
  return href ? html`<a class="${cls}" href="${href}" rel="noopener">${icon('whatsapp')}<span>${label}</span></a>` : '';
}

/** "Ask about fees on WhatsApp" for one workshop (no prices anywhere: the school's decision). */
export function feesButton(ctx: SiteCtx, w: PublicWorkshop): Html | '' {
  return waButton(waHref(ctx, 'workshops', fmt(ctx.t.workshop.feesMessage, { title: pick(ctx, w.title) })), ctx.t.workshop.askFees);
}

/** Dates, days and times, coach, level. */
export function workshopFacts(ctx: SiteCtx, w: PublicWorkshop): Html {
  const { t, lang } = ctx;
  const lines = scheduleLines(lang, w.schedule);
  const coach = w.coach ? pick(ctx, w.coach) : '';
  return html`<ul class="facts">
<li>${icon('calendar')}<span><b>${t.workshop.when}</b>${dateRange(lang, t, w.startDate, w.endDate)}</span></li>
${lines.length ? html`<li>${icon('clock')}<span><b>${t.workshop.times}</b>${lines.map((l, i) => (i ? html`<br>${l}` : l))}</span></li>` : ''}
${coach ? html`<li>${icon('user')}<span><b>${t.workshop.coach}</b>${coach}</span></li>` : ''}
${w.level ? html`<li>${icon('level')}<span><b>${t.workshop.level}</b>${t.levels[w.level]}</span></li>` : ''}
</ul>`;
}

/** A workshop card (home and the workshops page). */
export function workshopCard(ctx: SiteCtx, w: PublicWorkshop, opts: { heading: 'h2' | 'h3'; description: boolean }): Html {
  const { t, paths, lang } = ctx;
  const title = pick(ctx, w.title);
  const href = paths.workshop(lang, w.courseId);
  const desc = opts.description ? excerpt(pick(ctx, w.description), 200) : '';
  const heading = opts.heading === 'h2' ? html`<h2><a href="${href}">${title}</a></h2>` : html`<h3><a href="${href}">${title}</a></h3>`;
  return html`<article class="card">
${w.coverFileId ? html`<img class="cover" src="${paths.media(w.coverFileId)}" alt="${fmt(t.workshop.coverAlt, { title })}" loading="lazy" decoding="async">` : ''}
<div class="card-body">
${heading}
${workshopFacts(ctx, w)}
${desc ? html`<p>${desc}</p>` : ''}
<div class="actions">
${w.acceptingApplications ? html`<a class="btn btn-primary" href="${href}#apply">${t.workshop.apply}${icon('arrow')}</a>` : html`<a class="btn btn-line" href="${href}">${t.workshop.details}${icon('arrow')}</a>`}
${feesButton(ctx, w)}
</div>
</div>
</article>`;
}

/** WhatsApp, phone, email, Instagram, address and map. */
export function contactBlock(ctx: SiteCtx): Html {
  const { t, content } = ctx;
  const general = fmt(t.whatsapp.general, { name: ctx.studioName });
  const casting = fmt(t.whatsapp.casting, { name: ctx.studioName });
  const workshopsWa = content.whatsappWorkshops ? waLink(content.whatsappWorkshops, ctx.countryCode, general) : null;
  const castingWa = content.whatsappCasting ? waLink(content.whatsappCasting, ctx.countryCode, casting) : null;
  const tel = telLink(content.phone);
  const ig = instagramUrl(content.instagram);
  const address = pick(ctx, content.address);
  return html`<div class="contact">
${waButton(workshopsWa, t.contact.whatsappWorkshops)}
${waButton(castingWa, t.contact.whatsappCasting)}
${tel ? html`<a class="btn btn-line" href="${tel}">${icon('phone')}<span>${t.contact.call}: <span dir="ltr">${content.phone}</span></span></a>` : ''}
${content.email ? html`<a class="btn btn-line" href="mailto:${content.email}">${icon('mail')}<span>${t.contact.email}</span></a>` : ''}
${ig ? html`<a class="btn btn-line" href="${ig}" rel="noopener">${icon('instagram')}<span>${t.contact.instagram}: <span dir="ltr">@${content.instagram}</span></span></a>` : ''}
${content.mapUrl ? html`<a class="btn btn-line" href="${content.mapUrl}" rel="noopener">${icon('map')}<span>${t.contact.map}</span></a>` : ''}
</div>
${address ? html`<p class="addr">${icon('pin')}<span><b>${t.contact.address}:</b> ${address}</span></p>` : ''}`;
}

export function pageHead(title: string, intro?: string | Html): Html {
  return html`<div class="page-head"><h1>${title}</h1>${intro ? html`<p class="lead">${intro}</p>` : ''}</div>`;
}
