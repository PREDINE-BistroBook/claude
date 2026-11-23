/**
 * The Cloudflare Worker locally, in workerd: `npm run cf:dev` (port 8787) or
 * `npm run cf:dev -- --port 8790`. Serves dist/web (built first if missing;
 * `--build` rebuilds it) and the API in the Durable Object, with data under
 * .wrangler/state. Variables come from wrangler.jsonc plus .dev.vars (created
 * with a throwaway ADMIN_TOKEN and ALLOW_DEMO_RESET=true on first run), so the
 * demo can be loaded with:
 *
 *   curl -X POST localhost:8787/api/admin/seed-demo \
 *     -H "Authorization: Bearer $(grep ADMIN_TOKEN .dev.vars | cut -d= -f2)" \
 *     -H 'Content-Type: application/json' -d '{"password":"pick-a-password"}'
 *
 * The Worker sees the address you really use (localhost:8787), not the first
 * custom domain in "routes": to try the public website as its own domain
 * serves it, send that Host header —
 *
 *   curl -H 'Host: turquoisestudio.app' localhost:8787/en/workshops
 *
 * Local only — see scripts/cf-local.ts.
 */
import { spawn } from 'node:child_process';
import { ensureDevVars, ensureWebBuild, ROOT, wranglerDevArgs, wranglerEnv } from './cf-local';

const argv = process.argv.slice(2);
const portArg = argv.indexOf('--port');
const port = Number(portArg >= 0 ? argv[portArg + 1] : (process.env.PORT ?? 8787));
const passThrough = argv.filter((a, i) => a !== '--build' && (portArg < 0 || (i !== portArg && i !== portArg + 1)));

ensureDevVars();
ensureWebBuild(argv.includes('--build'));
const child = spawn('npx', wranglerDevArgs(port, passThrough), { cwd: ROOT, env: wranglerEnv(), stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => child.kill(signal));
child.on('exit', (code) => process.exit(code ?? 0));
