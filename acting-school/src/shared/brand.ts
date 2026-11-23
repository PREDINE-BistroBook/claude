/**
 * Turquoise Studio's mark — the slanted turquoise "T" on a black disc — drawn
 * on a 100×100 grid. Interim drawing traced from the studio's Instagram avatar
 * until they send the original logo file. One source for every place that
 * draws it: the staff app (src/web/components/ui/BrandMark.tsx), the public
 * website (src/server/site/layout.ts: header, link-in-bio page, favicon) and
 * public/icon.svg (plus the PNG icons scripts/render-icons.mjs renders from it,
 * which repeat these paths by hand).
 */

/** The "T": the slanted top bar and the stem that slants down to a point. */
export const BRAND_MARK_PATH = 'M11.39 48.48L46.84 27.59L76.58 27.59L41.77 48.48ZM41.14 42.78L54.68 34.56L70.89 58.61L70.89 87.09Z';
/** The two thin cuts that split the bar and the stem into ribbons (stroked, width BRAND_CUT_WIDTH, through a mask). */
export const BRAND_CUTS_PATH = 'M25.68 49.26L62.42 26.81M51.91 42.39L72.15 72.51';
export const BRAND_CUT_WIDTH = 1.4;

/** The mark's own colours (the same in light and dark: it is always drawn on its black disc). */
export const BRAND_COLORS = {
  tile: '#000000',
  mint: '#a8f0e8',
  turquoise: '#50e0d0',
} as const;

/**
 * The mark as a standalone SVG document (fixed colours), for places without
 * the app's CSS variables: the public site's inline logo and its data: favicon.
 * `idPrefix` keeps gradient/mask ids unique when it is inlined more than once.
 */
export function brandMarkSvg(idPrefix = 'bm'): string {
  const p = idPrefix.replace(/[^a-zA-Z0-9_-]/g, '') || 'bm';
  const c = BRAND_COLORS;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">` +
    `<defs>` +
    `<linearGradient id="${p}-fill" x1="0.1" y1="0.15" x2="0.8" y2="1"><stop offset="0.2" stop-color="${c.mint}"/><stop offset="1" stop-color="${c.turquoise}"/></linearGradient>` +
    `<radialGradient id="${p}-glow" cx="0.56" cy="0.46" r="0.42"><stop offset="0" stop-color="${c.turquoise}" stop-opacity="0.22"/><stop offset="1" stop-color="${c.turquoise}" stop-opacity="0"/></radialGradient>` +
    `<mask id="${p}-cut" maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100"><rect width="100" height="100" fill="#fff"/><path d="${BRAND_CUTS_PATH}" stroke="#000" stroke-width="${BRAND_CUT_WIDTH}"/></mask>` +
    `</defs>` +
    `<circle cx="50" cy="50" r="50" fill="${c.tile}"/>` +
    `<circle cx="50" cy="50" r="50" fill="url(#${p}-glow)"/>` +
    `<path d="${BRAND_MARK_PATH}" fill="url(#${p}-fill)" mask="url(#${p}-cut)"/>` +
    `</svg>`
  );
}
