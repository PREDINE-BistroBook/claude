/**
 * The public website's one page layout: <html lang dir> from the page
 * language, meta tags (description, Open Graph, hreflang alternates,
 * canonical, theme colour, the brand mark as a data: favicon), one inline
 * stylesheet (mobile first, black + turquoise, CSS logical properties so
 * Arabic mirrors), the header (mark, name, language switch, menu) and the
 * footer (Instagram, address, ©). No client JavaScript anywhere.
 */
import { html, raw } from 'hono/html';
import type { Locale } from '../../shared/enums';
import type { SiteContent } from '../../shared/schemas/site';
import { fmt, type SiteStrings } from './i18n';
import type { SitePaths } from './paths';
import { FAVICON_HREF, brandMark, icon, instagramUrl, type Html } from './render';

/**
 * Black + turquoise (the staff app's brand tokens: --brand-tile #000,
 * --brand-turquoise #50e0d0, --brand-mint #a8f0e8, --accent #0c766c family).
 * Text contrast: body #0d1716 / muted #485a57 on white and #f3f8f7 ≥ 7:1;
 * white on --accent 6.4:1; black on turquoise 13:1; the WhatsApp green with its
 * dark text 7.7:1. Focus: a thick amber ring, visible on black and on white.
 */
const CSS = `
:root{--ink:#0d1716;--muted:#485a57;--line:#cfdfdc;--canvas:#f3f8f7;--surface:#fff;--tile:#000;--tq:#50e0d0;--mint:#a8f0e8;--accent:#0a6b62;--accent-h:#075750;--soft:#e0f5f1;--wa:#25d366;--wa-ink:#062a12;--danger:#b42318;--danger-soft:#fdeceb;--focus:#ffb703;--r:16px}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;text-size-adjust:100%}
body{margin:0;background:var(--canvas);color:var(--ink);font:17px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}
html[lang=ar] body{font-family:"SF Arabic","Noto Sans Arabic","Noto Naskh Arabic","Segoe UI",Tahoma,"Geeza Pro",system-ui,sans-serif;font-size:18px;line-height:1.8}
h1,h2,h3{line-height:1.25;margin:0 0 .5em;font-weight:800}
html[lang=ar] :is(h1,h2,h3){line-height:1.5}
h1{font-size:2rem}h2{font-size:1.55rem}h3{font-size:1.2rem}
p{margin:0 0 1em}
a{color:var(--accent);text-underline-offset:3px}
img{max-width:100%;height:auto;display:block}
:focus-visible{outline:3px solid var(--focus);outline-offset:3px;border-radius:6px}
.wrap{max-width:1040px;margin-inline:auto;padding-inline:16px}
.narrow{max-width:720px}
.i{width:1.25em;height:1.25em;flex:none}
[dir=rtl] .flip{transform:scaleX(-1)}
.skip{position:absolute;inset-inline-start:8px;top:-100px;background:var(--focus);color:#000;padding:12px 16px;border-radius:10px;font-weight:700;z-index:9}
.skip:focus{top:8px}
.top{background:var(--tile);color:#fff}
.top-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding-block:12px}
.brand{display:flex;align-items:center;gap:12px;color:#fff;text-decoration:none;font-weight:800;font-size:1.1rem;min-height:48px}
.mark{width:44px;height:44px;border-radius:50%;flex:none}
.lang{display:inline-flex;align-items:center;gap:8px;min-height:48px;padding:8px 16px;border:2px solid #3b4a48;border-radius:999px;color:#fff;text-decoration:none;font-weight:700}
.nav{display:flex;flex-wrap:wrap;gap:8px;padding-bottom:12px}
.nav a{display:inline-flex;align-items:center;min-height:48px;padding:8px 16px;border-radius:999px;color:var(--mint);text-decoration:none;font-weight:700;background:#121a19}
.nav a[aria-current=page]{background:var(--tq);color:#000}
.hero{background:radial-gradient(120% 90% at 70% 0%,#0f3d38 0%,#000 60%);color:#fff;padding-block:28px 40px}
.hero .mark{width:84px;height:84px;margin-bottom:16px}
.hero h1{font-size:2.2rem;margin-bottom:.25em}
.tagline{color:var(--mint);font-size:1.2rem;margin-bottom:24px}
.hero-photo{margin-top:28px;border-radius:var(--r);aspect-ratio:16/10;object-fit:cover;width:100%;background:#0b1514}
.actions{display:flex;flex-direction:column;gap:12px;margin-top:16px}
.btn{display:flex;align-items:center;justify-content:center;gap:10px;min-height:56px;padding:12px 20px;border-radius:14px;border:2px solid transparent;font:inherit;font-weight:800;text-decoration:none;text-align:center;cursor:pointer;line-height:1.3}
.btn-primary{background:var(--accent);color:#fff}
.btn-primary:hover{background:var(--accent-h)}
.btn-bright{background:var(--tq);color:#000}
.btn-wa{background:var(--wa);color:var(--wa-ink)}
.btn-line{background:var(--surface);color:var(--ink);border-color:var(--line)}
.block{padding-block:40px}
.block.alt{background:var(--surface);border-block:1px solid var(--line)}
.lead{font-size:1.1rem;color:var(--muted)}
.grid{display:grid;gap:16px}
.card{background:var(--surface);border:1px solid var(--line);border-radius:var(--r);overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,.05)}
.block.alt .card{background:var(--canvas)}
.card-body{padding:20px}
.card h3 a{color:var(--ink);text-decoration:none}
.card h3 a:hover{text-decoration:underline}
.cover{aspect-ratio:16/9;object-fit:cover;width:100%;background:var(--soft)}
.facts{list-style:none;margin:0 0 16px;padding:0;display:grid;gap:10px}
.facts li{display:flex;gap:10px;align-items:flex-start}
.facts .i{color:var(--accent);margin-top:.2em}
.facts b{display:block;font-size:.85rem;color:var(--muted);font-weight:700}
.banner{background:var(--tile);color:#fff;border-radius:var(--r);padding:24px;display:grid;gap:8px;border:2px solid var(--tq)}
.banner h2{color:var(--tq);display:flex;gap:10px;align-items:center}
.coach{display:flex;gap:16px;align-items:flex-start;padding:20px}
.coach img,.coach .ph{width:88px;height:88px;border-radius:50%;object-fit:cover;flex:none;background:var(--soft)}
.coach .ph{display:flex;align-items:center;justify-content:center;color:var(--accent)}
.coach .t{color:var(--accent);font-weight:700;margin-bottom:.4em}
.contact{display:grid;gap:12px}
.addr{display:flex;gap:10px;align-items:flex-start;margin-top:8px}
.back{display:inline-flex;align-items:center;gap:8px;min-height:48px;font-weight:700;margin-block:16px 8px}
.page-head{padding-block:24px 8px}
.ok{display:flex;justify-content:center;color:var(--accent);margin-bottom:8px}
.ok .i{width:64px;height:64px}
.center{text-align:center}
.mt{margin-top:20px}
.pad{padding-block:40px}
.rounded{border-radius:var(--r);margin-bottom:20px}
.centered{justify-content:center}
.ok.bad{color:var(--danger)}
.form-card{background:var(--surface);border:1px solid var(--line);border-radius:var(--r);padding:20px;margin-top:24px}
form{display:grid;gap:22px}
.field{display:grid;gap:6px}
label,.legend{font-weight:800}
.req,.opt{font-size:.8rem;font-weight:700;padding:1px 8px;border-radius:999px;margin-inline-start:6px;vertical-align:middle;white-space:nowrap}
.req{background:var(--soft);color:var(--accent-h)}
.opt{background:#eef1f1;color:var(--muted)}
.hint{color:var(--muted);font-size:.95rem;margin:0}
input,textarea,select{font:inherit;color:var(--ink);background:#fff;border:2px solid #7f9894;border-radius:12px;padding:12px 14px;min-height:56px;width:100%}
textarea{min-height:120px;resize:vertical}
input[type=file]{padding:10px;min-height:auto;background:var(--canvas)}
input[type=file]::file-selector-button{font:inherit;font-weight:700;border:0;border-radius:10px;background:var(--accent);color:#fff;padding:10px 16px;margin-inline-end:12px;cursor:pointer}
fieldset{border:0;margin:0;padding:0;display:grid;gap:10px;min-width:0}
legend{padding:0;margin-bottom:8px}
.choices{display:grid;gap:10px}
.choice{display:flex;align-items:center;gap:12px;min-height:56px;padding:10px 14px;border:2px solid var(--line);border-radius:12px;background:#fff;font-weight:600;cursor:pointer}
.choice input{width:24px;height:24px;min-height:0;margin:0;flex:none;accent-color:var(--accent)}
.check{align-items:flex-start}
.check input{margin-top:.2em}
.group{border:2px dashed var(--line);border-radius:var(--r);padding:16px;display:grid;gap:16px}
.group h3{margin:0}
.has-error input:not([type=checkbox]):not([type=radio]),.has-error textarea,.has-error .choice{border-color:var(--danger)}
.err{display:flex;gap:8px;align-items:flex-start;color:var(--danger);font-weight:700;margin:0}
.err .i{margin-top:.2em}
.summary{border:3px solid var(--danger);background:var(--danger-soft);border-radius:var(--r);padding:16px 20px}
.summary h2{font-size:1.25rem;color:var(--danger);display:flex;gap:10px;align-items:center}
.summary ul{margin:8px 0 0;padding-inline-start:20px}
.summary a{color:var(--danger);font-weight:700}
.note{background:var(--soft);border-radius:12px;padding:12px 16px;margin:0;color:var(--ink)}
.privacy{font-size:.95rem;color:var(--muted);margin:0}
.hp{position:absolute;inset-inline-start:-10000px;width:1px;height:1px;overflow:hidden}
.foot{background:var(--tile);color:#d7efec;padding-block:32px;margin-top:48px}
.foot a{color:var(--mint);display:inline-flex;align-items:center;gap:8px;min-height:48px;font-weight:700}
.foot p{margin:4px 0}
.bio{background:var(--tile);color:#fff}
.bio main{max-width:520px;margin-inline:auto;padding:32px 16px 16px;text-align:center}
.bio .mark{width:96px;height:96px;margin:0 auto 16px}
.bio .tagline{margin-bottom:24px}
.bio .stack{display:grid;gap:14px;text-align:start}
.bio .btn{justify-content:flex-start;font-size:1.05rem}
.bio .btn-line{background:#101817;color:#fff;border-color:#2e3d3b}
.bio small{display:block;font-weight:600;opacity:.8}
.bio .lang{margin-top:24px}
@media (min-width:760px){
h1{font-size:2.5rem}.hero h1{font-size:3rem}
.actions{flex-direction:row;flex-wrap:wrap}
.actions .btn{flex:0 1 auto}
.grid.two{grid-template-columns:1fr 1fr}
.contact{grid-template-columns:1fr 1fr}
.block{padding-block:56px}
}
`.replace(/\n/g, '');

export interface LayoutOptions {
  lang: Locale;
  t: SiteStrings;
  paths: SitePaths;
  /** "https://host" of this request (absolute URLs for canonical, hreflang, og). */
  origin: string;
  /** The studio's name in this language. */
  studioName: string;
  title: string;
  description: string;
  /** This page in each language (paths), for the switch and hreflang; null on pages that have none (errors). */
  alternates: Record<Locale, string> | null;
  /** Which menu entry is this page. */
  current?: 'home' | 'workshops' | 'castingCall' | 'links';
  /** A public image path for og:image (/site/media/…). */
  ogImage?: string | null;
  content: SiteContent | null;
  /** Errors, thanks, form re-renders: keep out of search results. */
  noindex?: boolean;
  /** The link-in-bio page: no header/footer, dark. */
  bare?: boolean;
  body: Html;
}

export function layout(o: LayoutOptions): Html {
  const { lang, t, paths } = o;
  const other: Locale = lang === 'ar' ? 'en' : 'ar';
  const abs = (p: string) => o.origin + p;
  const ig = instagramUrl(o.content?.instagram);
  const address = o.content?.address[lang]?.trim() || o.content?.address[other]?.trim() || '';
  const nav = (
    [
      ['home', paths.home(lang), t.nav.home],
      ['workshops', paths.workshops(lang), t.nav.workshops],
      ['castingCall', paths.castingCall(lang), t.nav.castingCall],
      ['links', paths.links(lang), t.nav.links],
    ] as const
  ).map(([key, href, label]) => html`<a href="${href}"${o.current === key ? raw(' aria-current="page"') : ''}>${label}</a>`);
  const langSwitch = o.alternates
    ? html`<a class="lang" href="${o.alternates[other]}" hreflang="${other}" lang="${other}" title="${t.meta.otherLanguageLabel}">${icon('globe')}${t.meta.otherLanguage}</a>`
    : '';

  const head = html`<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${o.title}</title>
<meta name="description" content="${o.description}">
${o.noindex ? raw('<meta name="robots" content="noindex">') : ''}
${o.alternates
  ? html`<link rel="canonical" href="${abs(o.alternates[lang])}">
<link rel="alternate" hreflang="en" href="${abs(o.alternates.en)}">
<link rel="alternate" hreflang="ar" href="${abs(o.alternates.ar)}">
<link rel="alternate" hreflang="x-default" href="${abs(paths.root())}">`
  : ''}
<meta name="theme-color" content="#000000">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${o.studioName}">
<meta property="og:title" content="${o.title}">
<meta property="og:description" content="${o.description}">
<meta property="og:locale" content="${lang === 'ar' ? 'ar_EG' : 'en_GB'}">
${o.alternates ? html`<meta property="og:url" content="${abs(o.alternates[lang])}">` : ''}
${o.ogImage ? html`<meta property="og:image" content="${abs(o.ogImage)}"><meta name="twitter:card" content="summary_large_image">` : ''}
<link rel="icon" href="${FAVICON_HREF}">
<style>${raw(CSS)}</style>`;

  if (o.bare) {
    return html`<!doctype html>
<html lang="${lang}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}">
<head>${head}</head>
<body class="bio">
<main id="main">${o.body}${langSwitch}</main>
</body>
</html>`;
  }

  return html`<!doctype html>
<html lang="${lang}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}">
<head>${head}</head>
<body>
<a class="skip" href="#main">${t.meta.skip}</a>
<header class="top">
<div class="wrap top-row"><a class="brand" href="${paths.home(lang)}">${brandMark('mark')}<span>${o.studioName}</span></a>${langSwitch}</div>
<nav class="wrap nav" aria-label="${t.meta.mainMenu}">${nav}</nav>
</header>
<main id="main">${o.body}</main>
<footer class="foot">
<div class="wrap">
${ig ? html`<p><a href="${ig}" rel="noopener">${icon('instagram')}${t.contact.instagram}: @${o.content!.instagram}</a></p>` : ''}
${address ? html`<p class="addr">${icon('pin')}<span>${address}</span></p>` : ''}
<p>${fmt(t.footer.rights, { year: new Date().getUTCFullYear(), name: o.studioName })}</p>
</div>
</footer>
</body>
</html>`;
}
