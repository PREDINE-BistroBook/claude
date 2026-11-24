import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { randomUUID } from 'node:crypto';
import { FILE_ERROR_CODES, MAX_UPLOAD_BYTES, UPLOADS_PER_HOUR, type UploadedFile } from '../../shared/schemas/files';
import { files } from '../db/schema';
import type { AppEnv } from '../env';
import { ApiError, notFound } from '../lib/errors';
import { deleteStoredFiles, fileInUse, sweepUnusedUploads, takeUnusedFiles } from '../lib/fileRefs';
import { contentDisposition, downloadName, sniffFile } from '../lib/fileTypes';
import { hitRateLimit, HOUR_MS } from '../lib/rateLimit';
import { currentUser, requireAuth } from '../middleware/auth';

/**
 * Uploads: images (headshots, student and profile photos, workshop photos,
 * chat pictures) and documents (PDF, Word, Excel, PowerPoint — workshop and
 * casting files, chat attachments). Files are private: served only to
 * signed-in staff, and a file id is only ever handed to people who can see the
 * record it belongs to (ids are random UUIDs, so an id works as the key — the
 * "capability" rule in CLAUDE.md). The type is decided from the file's bytes
 * (lib/fileTypes.ts), not from what the browser claims; images are served
 * inline, everything else as a download, always with nosniff. The bytes go to
 * the app's FileStore (a folder on the Node server, the Durable Object's
 * SQLite or R2 on Cloudflare).
 *
 * Uploads come first and are attached afterwards (a chat message, a photo, a
 * workshop file). One that's never attached — a mis-picked file removed
 * before sending — is deleted by its uploader (DELETE /:id, the app does it
 * when the file is removed), or swept a day later (sweepUnusedUploads, run as
 * new uploads come in). Each person uploads at most UPLOADS_PER_HOUR an hour.
 */
const router = new Hono<AppEnv>();
router.use(requireAuth);

const tooLarge = () => new ApiError(413, FILE_ERROR_CODES.tooLarge, 'File is too large (max 8 MB)');

router.post(
  '/',
  bodyLimit({
    maxSize: MAX_UPLOAD_BYTES + 64 * 1024,
    onError: () => {
      throw tooLarge();
    },
  }),
  async (c) => {
    const me = currentUser(c).id;
    const db = c.get('db');
    const now = Date.now();
    // Before reading the body: the school's one Durable Object holds every upload.
    if (hitRateLimit(db, `upload:user:${me}`, UPLOADS_PER_HOUR, HOUR_MS, now)) {
      throw new ApiError(429, FILE_ERROR_CODES.tooManyUploads, 'Too many uploads this hour. Try again later.');
    }
    await sweepUnusedUploads(db, c.get('files'), now);
    const form = await c.req.formData().catch(() => null);
    const file = form?.get('file');
    if (!file || typeof file === 'string') throw new ApiError(400, 'bad_request', 'Send the file in a "file" field');
    if (file.size > MAX_UPLOAD_BYTES) throw tooLarge();
    const buf = new Uint8Array(await file.arrayBuffer());
    const type = sniffFile(buf);
    if (!type) throw new ApiError(415, FILE_ERROR_CODES.unsupportedType, 'Only JPEG, PNG or WebP images, or PDF, Word, Excel or PowerPoint files');

    const id = randomUUID();
    const storageKey = `${id}.${type.ext}`;
    const name = file.name ? downloadName(file.name, type.mime).slice(0, 200) : null;
    await c.get('files').put(storageKey, buf, type.mime);
    db.insert(files).values({ id, originalName: name, mime: type.mime, size: buf.byteLength, storageKey, uploadedBy: me }).run();
    const res: UploadedFile = { id, mime: type.mime, size: buf.byteLength, kind: type.kind, name };
    return c.json(res, 201);
  },
);

const FILE_ID = /^[0-9a-f-]{36}$/;

router.get('/:id', async (c) => {
  const id = c.req.param('id');
  if (!FILE_ID.test(id)) throw notFound();
  const row = c.get('db').select().from(files).where(eq(files.id, id)).get();
  if (!row) throw notFound();
  const data = await c.get('files').get(row.storageKey);
  if (!data) throw notFound();
  return c.body(data, 200, {
    'Content-Type': row.mime,
    'Cache-Control': 'private, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
    // Images inline; documents (and anything unexpected) only as a download, never as a page.
    'Content-Disposition': contentDisposition(row.mime, row.originalName),
  });
});

/**
 * DELETE /api/files/:id: take back an upload you haven't attached anywhere
 * (removed from a message before sending, a photo replaced before saving).
 * Only the uploader (anyone else: 404, as for a missing file), and only while
 * nothing uses it (409 file_in_use: attached files go when their record does).
 * 204.
 */
router.delete('/:id', async (c) => {
  const id = c.req.param('id');
  if (!FILE_ID.test(id)) throw notFound();
  const me = currentUser(c).id;
  const db = c.get('db');
  const outcome = db.transaction((tx) => {
    const row = tx.select({ uploadedBy: files.uploadedBy }).from(files).where(eq(files.id, id)).get();
    if (!row || row.uploadedBy !== me) return 'missing' as const;
    if (fileInUse(tx, id)) return 'in_use' as const;
    return takeUnusedFiles(tx, [id]);
  });
  if (outcome === 'missing') throw notFound();
  if (outcome === 'in_use') throw new ApiError(409, FILE_ERROR_CODES.inUse, 'This file is attached somewhere; it goes when that is deleted');
  await deleteStoredFiles(c.get('files'), outcome);
  return c.body(null, 204);
});

export default router;
