/**
 * Prepares the "embedded" Cloudflare deploy (`npm run cf:deploy-embedded`):
 * bundles the built web app (dist/web) into the Worker instead of uploading
 * it as static assets. See src/worker/embeddedAssets.ts for why this exists;
 * the normal deploy (Workers Builds, `wrangler deploy`) doesn't use it.
 *
 * Writes dist/cf-embedded/entry.ts. Each file carries the headers that
 * dist/web/_headers gives it on the real asset server, so the two deploys
 * answer alike. Also checks that wrangler.embedded.jsonc matches
 * wrangler.jsonc in everything but `main` and `assets`, so the two can't
 * drift apart (both deploy the same Worker and the same Durable Object).
 * Refuses, with the reason, anything it can't serve like the real asset
 * server: a _redirects file, or _headers rules beyond exact paths and a
 * trailing * (parseHeadersText, unsupportedAssetConfig).
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB = path.join(ROOT, 'dist/web');
const OUT_DIR = path.join(ROOT, 'dist/cf-embedded');

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
};
/** Files the real asset server reads as configuration and never serves. */
const NOT_SERVED = new Set(['/_headers', '/_redirects']);

function fail(message: string): never {
  console.error(`embed-assets: ${message}`);
  process.exit(1);
}

/** wrangler.jsonc allows // comments; these files only use whole-line ones. */
function readJsonc(file: string): Record<string, unknown> {
  const text = fs.readFileSync(file, 'utf8');
  const json = text
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch (err) {
    fail(`${path.basename(file)} isn't plain JSON once its whole-line comments are removed (${(err as Error).message})`);
  }
}

function checkConfigsMatch(): void {
  const main = readJsonc(path.join(ROOT, 'wrangler.jsonc'));
  const embedded = readJsonc(path.join(ROOT, 'wrangler.embedded.jsonc'));
  /** JSON with object keys sorted at every level, so key order doesn't count as a difference. */
  const canonical = (value: unknown): string =>
    Array.isArray(value)
      ? `[${value.map(canonical).join(',')}]`
      : value && typeof value === 'object'
        ? `{${Object.keys(value)
            .sort()
            .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
            .join(',')}}`
        : JSON.stringify(value);
  const strip = (c: Record<string, unknown>) => {
    const { main: _m, assets: _a, $schema: _s, ...rest } = c;
    return rest;
  };
  if (canonical(strip(main)) !== canonical(strip(embedded))) {
    fail('wrangler.embedded.jsonc must match wrangler.jsonc except for "main" and "assets" — update it to match.');
  }
  if ('assets' in embedded) fail('wrangler.embedded.jsonc must not have an "assets" block.');
}

interface Rule {
  pattern: string;
  headers: [string, string][];
}

/**
 * The subset of the _headers format this app uses: a path line, then indented
 * "Name: value" lines. Everything else the real asset server understands —
 * placeholders (/blog/:slug), a * that isn't at the end, absolute URLs,
 * "! Name" lines that remove a header — is refused with an error rather than
 * quietly served differently from the real deploy.
 */
export function parseHeadersText(text: string): Rule[] {
  const rules: Rule[] = [];
  for (const raw of text.split('\n')) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    if (!/^\s/.test(raw)) {
      rules.push({ pattern: raw.trim(), headers: [] });
      continue;
    }
    const rule = rules.at(-1);
    const line = raw.trim();
    const colon = line.indexOf(':');
    if (!rule || colon < 1) throw new Error(`can't read this line of _headers: ${raw}`);
    if (line.startsWith('!')) throw new Error(`_headers line "${line}" removes a header, which this script doesn't emulate`);
    rule.headers.push([line.slice(0, colon).trim(), line.slice(colon + 1).trim()]);
  }
  for (const rule of rules) {
    const star = rule.pattern.indexOf('*');
    if (!rule.pattern.startsWith('/') || rule.pattern.startsWith('//') || (star >= 0 && star !== rule.pattern.length - 1) || /\/:|\s/.test(rule.pattern)) {
      throw new Error(`_headers rule "${rule.pattern}" uses a pattern this script doesn't handle (only exact paths and a trailing *)`);
    }
  }
  return rules;
}

/**
 * What in the built folder the embedded Worker can't reproduce: a _redirects
 * file (the real asset server would apply it; this one has no redirect rules).
 * Returns the reason, or null when the folder is fine.
 */
export function unsupportedAssetConfig(webDir: string): string | null {
  if (fs.existsSync(path.join(webDir, '_redirects'))) {
    return 'dist/web/_redirects exists: the embedded Worker does not emulate redirect rules. Remove it (or teach src/worker/embeddedAssets.ts to apply it) before deploying this way.';
  }
  return null;
}

function parseHeaders(file: string): Rule[] {
  if (!fs.existsSync(file)) return [];
  try {
    return parseHeadersText(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    fail((err as Error).message);
  }
}

function matches(pattern: string, urlPath: string): boolean {
  return pattern.endsWith('*') ? urlPath.startsWith(pattern.slice(0, -1)) : urlPath === pattern;
}

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function main(): void {
if (!fs.existsSync(path.join(WEB, 'index.html'))) fail('dist/web/index.html is missing — run `npm run build` first.');
checkConfigsMatch();
const unsupported = unsupportedAssetConfig(WEB);
if (unsupported) fail(unsupported);

const rules = parseHeaders(path.join(WEB, '_headers'));
const files: Record<string, { b64: string; etag: string; headers: Record<string, string> }> = {};
let total = 0;
for (const full of walk(WEB).sort()) {
  const urlPath = `/${path.relative(WEB, full).split(path.sep).join('/')}`;
  if (NOT_SERVED.has(urlPath)) continue;
  const data = fs.readFileSync(full);
  total += data.byteLength;
  const headers: Record<string, string> = { 'Content-Type': TYPES[path.extname(full).toLowerCase()] ?? 'application/octet-stream' };
  for (const rule of rules) {
    if (matches(rule.pattern, urlPath)) for (const [name, value] of rule.headers) headers[name] = value;
  }
  // The real asset server's default for files _headers gives no Cache-Control.
  headers['Cache-Control'] ??= 'public, max-age=0, must-revalidate';
  files[urlPath] = {
    b64: data.toString('base64'),
    etag: `"${createHash('sha256').update(data).digest('hex').slice(0, 32)}"`,
    headers,
  };
}

fs.rmSync(OUT_DIR, { recursive: true, force: true });
fs.mkdirSync(OUT_DIR, { recursive: true });
const entry = `// Generated by scripts/embed-assets.ts from dist/web — do not edit.
import { createEmbeddedWorker } from '../../src/worker/embedded';

export { SchoolDO } from '../../src/worker/embedded';

const FILES = ${JSON.stringify(files)};

export default createEmbeddedWorker(FILES);
`;
fs.writeFileSync(path.join(OUT_DIR, 'entry.ts'), entry);
console.log(`embed-assets: ${Object.keys(files).length} files (${(total / 1024).toFixed(0)} KiB) → dist/cf-embedded/entry.ts`);
}

// Run as a script (not when a test imports the helpers above).
if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) main();
