/**
 * Running the Cloudflare Worker locally (workerd via `wrangler dev --local`),
 * shared by `npm run cf:dev` and `npm run cf:smoke`. Local only: wrangler gets
 * no Cloudflare credentials (CLOUDFLARE_API_TOKEN / ACCOUNT_ID are removed
 * from its environment), metrics are off, and remote bindings are disabled.
 * Never deploy from here — deploys go through Workers Builds.
 *
 * The Worker sees the real local address (wranglerDevArgs: origin inference
 * from "routes" is off), so its host routing — the public site's hosts, the
 * old staff address — runs here exactly as it does on Cloudflare.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const DEV_VARS = path.join(ROOT, '.dev.vars');

/** The environment for wrangler: no Cloudflare credentials, no metrics. */
export function wranglerEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  // CLOUDFLARE_CF_FETCH_ENABLED=false: no request for the placeholder Request.cf object either.
  const env: NodeJS.ProcessEnv = { ...process.env, WRANGLER_SEND_METRICS: 'false', CLOUDFLARE_CF_FETCH_ENABLED: 'false', ...extra };
  for (const key of Object.keys(env)) {
    if (/^(CLOUDFLARE_API_TOKEN|CLOUDFLARE_API_KEY|CLOUDFLARE_EMAIL|CLOUDFLARE_ACCOUNT_ID|CF_API_TOKEN|CF_ACCOUNT_ID)$/.test(key)) delete env[key];
  }
  return env;
}

/** Variables for local runs (gitignored): a throwaway ADMIN_TOKEN and ALLOW_DEMO_RESET=true. Created on first use. */
export function ensureDevVars(): Record<string, string> {
  if (!fs.existsSync(DEV_VARS)) {
    fs.writeFileSync(
      DEV_VARS,
      [
        '# Local `wrangler dev` only (gitignored). A throwaway token: never reuse it for a deployment.',
        `ADMIN_TOKEN=${randomBytes(24).toString('hex')}`,
        'ALLOW_DEMO_RESET=true',
        '',
      ].join('\n'),
    );
    console.log(`Created ${path.relative(process.cwd(), DEV_VARS) || '.dev.vars'} with a throwaway ADMIN_TOKEN.`);
  }
  const vars: Record<string, string> = {};
  for (const line of fs.readFileSync(DEV_VARS, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) vars[m[1]!] = m[2]!.replace(/^"(.*)"$/, '$1');
  }
  return vars;
}

/** `vite build` when dist/web is missing (or always with force): the Worker serves it as static assets. */
export function ensureWebBuild(force = false) {
  if (!force && fs.existsSync(path.join(ROOT, 'dist/web/index.html'))) return;
  const r = spawnSync('npx', ['vite', 'build'], { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) throw new Error('vite build failed');
}

/**
 * The arguments of every local `wrangler dev` here.
 *
 * --infer-origin-from-routes=false: both wrangler configs have "routes" (the
 * studio's custom domains), and by default `wrangler dev` then tells the
 * Worker that every request came to the FIRST route's host over https
 * (request.url and the Host header say team.turquoisestudio.app). The Worker
 * routes by host, so that would hide the public website's hosts and the old
 * staff address from local runs, and the public forms' Origin check (Origin
 * must be the host the Worker sees) would refuse every form sent to
 * http://127.0.0.1. With the inference off the Worker sees the address the
 * request really came to — localhost, or whatever Host header a test sends.
 */
export function wranglerDevArgs(port: number, extra: readonly string[] = []): string[] {
  return ['wrangler', 'dev', '--local', '--port', String(port), '--infer-origin-from-routes=false', ...extra];
}

export interface WranglerDev {
  child: ChildProcess;
  url: string;
  stop(): Promise<void>;
}

/** Start `wrangler dev --local` on `port` and wait until /api/health answers. */
export async function startWranglerDev(opts: { port: number; persistTo?: string; quiet?: boolean; timeoutMs?: number; config?: string }): Promise<WranglerDev> {
  const args = wranglerDevArgs(opts.port, ['--ip', '127.0.0.1', '--show-interactive-dev-session=false']);
  if (opts.config) args.push('-c', opts.config);
  if (opts.persistTo) args.push('--persist-to', opts.persistTo);
  const child = spawn('npx', args, { cwd: ROOT, env: wranglerEnv(), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let output = '';
  const onData = (chunk: Buffer) => {
    const text = chunk.toString();
    output += text;
    if (!opts.quiet) process.stdout.write(text.replace(/^/gm, '  [wrangler] '));
  };
  child.stdout!.on('data', onData);
  child.stderr!.on('data', onData);
  const url = `http://127.0.0.1:${opts.port}`;
  const stop = async () => {
    if (child.exitCode !== null) return;
    // The whole process group: npx → wrangler → workerd.
    try {
      process.kill(-child.pid!, 'SIGTERM');
    } catch {
      /* already gone */
    }
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        try {
          process.kill(-child.pid!, 'SIGKILL');
        } catch {
          /* gone */
        }
        resolve();
      }, 5000);
      child.once('exit', () => {
        clearTimeout(t);
        resolve();
      });
    });
  };
  const deadline = Date.now() + (opts.timeoutMs ?? 120_000);
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`wrangler dev exited (${child.exitCode}):\n${output}`);
    try {
      const res = await fetch(`${url}/api/health`);
      if (res.status === 200) return { child, url, stop };
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  await stop();
  throw new Error(`wrangler dev did not answer on ${url} in time:\n${output}`);
}
