/**
 * The Worker for the "embedded" deploy (wrangler.embedded.jsonc): the same
 * Worker as index.ts, with the web app bundled in instead of uploaded as
 * static assets (see embeddedAssets.ts for why). scripts/embed-assets.ts
 * writes dist/cf-embedded/entry.ts, which calls this with the built files and
 * is what wrangler bundles.
 */
import { createAssetFetcher, type EmbeddedFiles } from './embeddedAssets';
import type { Env } from './env';
import worker from './index';

export { SchoolDO } from './school';

export function createEmbeddedWorker(files: EmbeddedFiles): ExportedHandler<Env> {
  const assets = createAssetFetcher(files) as unknown as Fetcher;
  return {
    fetch(request, env) {
      return worker.fetch(request, { ...env, ASSETS: assets });
    },
  };
}
