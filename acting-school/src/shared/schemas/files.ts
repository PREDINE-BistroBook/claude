import { z } from 'zod';
import type { FileKind } from '../enums';
import type { PersonRef } from './team';

/** POST /api/files (multipart field "file": an image or a document) answers with this. */
export interface UploadedFile {
  id: string;
  mime: string;
  size: number;
  /** 'photo' for JPEG/PNG/WebP, 'document' for PDF, Word, Excel and PowerPoint files. */
  kind: FileKind;
  /** The file name as uploaded (shortened), used when the file is downloaded. */
  name: string | null;
}

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/**
 * Documents POST /api/files accepts besides images, each recognised from its
 * bytes (lib/fileTypes.ts): PDF, and Word / Excel / PowerPoint files in the
 * modern format (.docx/.xlsx/.pptx; old .doc/.xls/.ppt and macro files are refused).
 */
export const ALLOWED_DOCUMENT_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
] as const;

/** Every type POST /api/files stores. */
export const ALLOWED_UPLOAD_TYPES: readonly string[] = [...ALLOWED_IMAGE_TYPES, ...ALLOWED_DOCUMENT_TYPES];

/** For a file input's `accept` attribute: what the server takes (HEIC photos are turned into JPEG on the phone first). */
export const UPLOAD_ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,.pdf,.docx,.xlsx,.pptx,' + ALLOWED_DOCUMENT_TYPES.join(',');

/** A photo (shown inline) or a document (downloaded), from the stored type. */
export function fileKindOf(mime: string): FileKind {
  return (ALLOWED_IMAGE_TYPES as readonly string[]).includes(mime) ? 'photo' : 'document';
}

/** Uploads (POST /api/files) one person may make per hour: a whole rehearsal's photos at once, not an endless stream. */
export const UPLOADS_PER_HOUR = 100;

/**
 * An upload that was never attached anywhere is deleted this long after it
 * was made (well past the hour in which it can be attached, and a day for
 * forms that take any existing image, like a student's photo). DELETE
 * /api/files/:id (204) lets the uploader take one back at once.
 */
export const UNUSED_UPLOAD_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Error codes (error.code) of POST and DELETE /api/files. */
export const FILE_ERROR_CODES = {
  /** 413 — over MAX_UPLOAD_BYTES (8 MB). */
  tooLarge: 'too_large',
  /** 415 — not a JPEG/PNG/WebP image or a PDF/Word/Excel/PowerPoint file (checked from the bytes, not the name). */
  unsupportedType: 'unsupported_type',
  /** 429 — more than UPLOADS_PER_HOUR uploads this hour. */
  tooManyUploads: 'too_many_uploads',
  /** 409 (DELETE) — the file is attached somewhere; it goes when that record is deleted. */
  inUse: 'file_in_use',
} as const;

/**
 * A file attached to a record — a workshop's "Photos & files" (GET
 * /api/courses/:courseId/files) or a casting's "Files" (GET
 * /api/castings/:castingId/files). Bytes: GET /api/files/:fileId (photos
 * inline, documents as a download with `name`).
 */
export interface RecordFile {
  id: number;
  fileId: string;
  kind: FileKind;
  caption: string | null;
  /** Original file name (documents are downloaded under it). */
  name: string | null;
  mime: string;
  size: number;
  /** Who added it; null when that account is gone. */
  uploadedBy: PersonRef | null;
  createdAt: number;
  /** The caller may delete it (workshop: courses.write or the uploader; casting: castings.write). */
  canDelete: boolean;
}

/**
 * POST /api/courses/:courseId/files and /api/castings/:castingId/files: attach
 * a file you uploaded in the last hour (POST /api/files) that isn't used
 * anywhere yet. The kind comes from the file's type.
 */
export const recordFileInput = z.object({
  fileId: z.uuid(),
  caption: z.preprocess((v) => (typeof v === 'string' ? v.trim() || null : v), z.string().max(200).nullable().optional()),
});
export type RecordFileInput = z.infer<typeof recordFileInput>;
