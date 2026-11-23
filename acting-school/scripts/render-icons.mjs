// Renders src/web/public/icon.svg to the PNG sizes the web manifest and iOS need.
// Run: node scripts/render-icons.mjs
//
// icon.svg is the favicon: a rounded black tile with the mark at full size. The PNGs
// are full-bleed black squares (Android and iOS apply their own masks) with the mark
// scaled down so every point stays inside the maskable safe zone (the central
// circle, 40% of the size in radius): the mark reaches 42.6 units from the centre at
// scale 1, so 0.82 keeps it within 35 of the 40 allowed.
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium } = require('playwright');

const svg = fs.readFileSync(new URL('../src/web/public/icon.svg', import.meta.url), 'utf8');
const square = svg.replace('rx="22"', 'rx="0"').replace('scale(1)', 'scale(0.82)');
if (square === svg) throw new Error('icon.svg changed shape: update render-icons.mjs');

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, size] of [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['apple-touch-icon.png', 180],
]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:#000">${square.replace('<svg ', `<svg width="${size}" height="${size}" style="display:block" `)}</body></html>`);
  await page.screenshot({ path: new URL(`../src/web/public/${name}`, import.meta.url).pathname });
}
await browser.close();
console.log('icons written');
