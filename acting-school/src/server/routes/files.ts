import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { randomUUID } from 'node:crypto';
import { MAX_UPLOAD_BYTES, type UploadedFile } from '../../shared/schemas/files';
import { files } from '../db/schema';
import type { AppEnv } from '../env';
import { ApiError, notFound } from '../lib/errors';
import { currentUser, requireAuth } from '../middleware/auth';

/**
 * Image uploads (headshots, student photos). Files are private: served only to
 * signed-in staff. The type is decided from the file's first bytes, not from
 * what the browser claims. The bytes go to the app's FileStore (a folder on
 * the Node server, the Durable Object's SQLite or R2 on Cloudflare).
 */
const router = new Hono<AppEnv>();
router.use(requireAuth);

function sniffImage(buf: Uint8Array): { mime: string; ext: string } | null {
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return { mime: 'image/png', ext: 'png' };
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  )
    return { mime: 'image/webp', ext: 'webp' };
  return null;
}

router.post(
  '/',
  bodyLimit({
    maxSize: MAX_UPLOAD_BYTES + 64 * 1024,
    onError: () => {
      throw new ApiError(413, 'too_large', 'Image is too large (max 8 MB)');
    },
  }),
  async (c) => {
    const form = await c.req.formData().catch(() => null);
    const file = form?.get('file');
    if (!file || typeof file === 'string') throw new ApiError(400, 'bad_request', 'Send the image in a "file" field');
    if (file.size > MAX_UPLOAD_BYTES) throw new ApiError(413, 'too_large', 'Image is too large (max 8 MB)');
    const buf = new Uint8Array(await file.arrayBuffer());
    const kind = sniffImage(buf);
    if (!kind) throw new ApiError(415, 'unsupported_type', 'Only JPEG, PNG or WebP images');

    const id = randomUUID();
    const storageKey = `${id}.${kind.ext}`;
    await c.get('files').put(storageKey, buf, kind.mime);
    c.get('db')
      .insert(files)
      .values({ id, originalName: file.name?.slice(0, 200) || null, mime: kind.mime, size: buf.byteLength, storageKey, uploadedBy: currentUser(c).id })
      .run();
    const res: UploadedFile = { id, mime: kind.mime, size: buf.byteLength };
    return c.json(res, 201);
  },
);

router.get('/:id', async (c) => {
  const id = c.req.param('id');
  if (!/^[0-9a-f-]{36}$/.test(id)) throw notFound();
  const row = c.get('db').select().from(files).where(eq(files.id, id)).get();
  if (!row) throw notFound();
  const data = await c.get('files').get(row.storageKey);
  if (!data) throw notFound();
  return c.body(data, 200, {
    'Content-Type': row.mime,
    'Cache-Control': 'private, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': 'inline',
  });
});

export default router;
