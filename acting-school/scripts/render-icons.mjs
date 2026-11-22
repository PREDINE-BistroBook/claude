// Renders src/web/public/icon.svg to the PNG sizes the web manifest and iOS need.
// Run: node scripts/render-icons.mjs
import { chromium } from 'playwright';
import fs from 'node:fs';

const svg = fs.readFileSync(new URL('../src/web/public/icon.svg', import.meta.url), 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, size, pad] of [
  ['icon-192.png', 192, 0],
  ['icon-512.png', 512, 0],
  // iOS adds its own rounded mask: give it a full-bleed square.
  ['apple-touch-icon.png', 180, 0],
]) {
  await page.setViewportSize({ width: size, height: size });
  const body = name.startsWith('apple')
    ? svg.replace('rx="112"', 'rx="0"')
    : svg;
  await page.setContent(`<html><body style="margin:0;background:transparent">${body.replace('<svg ', `<svg width="${size - pad * 2}" height="${size - pad * 2}" `)}</body></html>`);
  await page.screenshot({ path: new URL(`../src/web/public/${name}`, import.meta.url).pathname, omitBackground: true });
}
await browser.close();
console.log('icons written');
