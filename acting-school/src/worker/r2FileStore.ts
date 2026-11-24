import type { FileStore } from '../server/lib/fileStore';

/**
 * Uploaded files in an R2 bucket (private: no public access; served only by
 * the API to signed-in staff). Used automatically when the Worker has an R2
 * binding named FILES (wrangler.jsonc); otherwise files stay in the Durable
 * Object's SQLite (lib/fileStore.ts sqliteFileStore).
 */
export function r2FileStore(bucket: R2Bucket, prefix = 'uploads/'): FileStore {
  return {
    async put(key, data, contentType) {
      await bucket.put(prefix + key, data, { httpMetadata: { contentType } });
    },
    async get(key) {
      const object = await bucket.get(prefix + key);
      return object ? new Uint8Array(await object.arrayBuffer()) : null;
    },
    async delete(key) {
      await bucket.delete(prefix + key);
    },
  };
}
