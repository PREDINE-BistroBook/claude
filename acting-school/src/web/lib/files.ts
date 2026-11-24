import { ALLOWED_DOCUMENT_TYPES, MAX_UPLOAD_BYTES } from '@shared/schemas/files';
import type { FileKind } from '@shared/enums';
import { api, ApiError } from './api';
import { uploadImageFile } from './image';

/** For the "camera / gallery" button: photos (HEIC is turned into JPEG on the phone where the browser can). */
export const PHOTO_ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif';
/** For the "file" button: the documents the server takes. */
export const DOCUMENT_ACCEPT = ['.pdf', '.docx', '.xlsx', '.pptx', ...ALLOWED_DOCUMENT_TYPES].join(',');

/** A picked file that is a picture (resized before upload), judged by its type or, when the browser gives none, its name. */
export function isPhotoFile(file: { type: string; name: string }): boolean {
  if (file.type) return file.type.startsWith('image/');
  return /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name);
}

export interface Uploaded {
  id: string;
  kind: FileKind;
  name: string;
  mime: string;
  size: number;
}

/**
 * Upload one picked file: photos are shrunk on the phone first (uploadImage),
 * documents go as they are under their own name. A document over 8 MB is
 * refused before sending (the server would answer 413 after the whole upload).
 */
export async function uploadAny(file: File): Promise<Uploaded> {
  if (isPhotoFile(file)) {
    const res = await uploadImageFile(file);
    return { id: res.id, kind: res.kind, name: res.name ?? file.name, mime: res.mime, size: res.size };
  }
  if (file.size > MAX_UPLOAD_BYTES) throw new ApiError(413, 'too_large', 'File is too large');
  const res = await api.upload(file, file.name || 'file');
  return { id: res.id, kind: res.kind, name: res.name ?? file.name, mime: res.mime, size: res.size };
}

/**
 * Take back an upload that won't be attached after all (removed from a
 * message before sending, a photo replaced before saving, an attach that
 * failed): DELETE /api/files/:id. Fire and forget — the server refuses a file
 * that's in use, and sweeps forgotten uploads a day later anyway.
 */
export function discardUpload(id: string | null | undefined): void {
  if (!id) return;
  void api.delete(`/files/${id}`).catch(() => undefined);
}

/** "820 KB", "1.4 MB" — sizes for document chips. */
export function formatFileSize(bytes: number, locale: string): string {
  const nf = (n: number, digits: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(n);
  if (bytes < 1024) return `${nf(bytes, 0)} B`;
  if (bytes < 1024 * 1024) return `${nf(Math.max(1, Math.round(bytes / 1024)), 0)} KB`;
  return `${nf(bytes / (1024 * 1024), 1)} MB`;
}

/** Short type label for a document chip (PDF, Word, Excel, PowerPoint). */
export function documentLabel(mime: string, name?: string | null): string {
  if (mime === 'application/pdf') return 'PDF';
  if (mime.includes('wordprocessingml')) return 'Word';
  if (mime.includes('spreadsheetml')) return 'Excel';
  if (mime.includes('presentationml')) return 'PowerPoint';
  const ext = name?.match(/\.([a-z0-9]{1,5})$/i)?.[1];
  return ext ? ext.toUpperCase() : '';
}
