/** POST /api/files (multipart field "file", images only) answers with this. */
export interface UploadedFile {
  id: string;
  mime: string;
  size: number;
}

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
