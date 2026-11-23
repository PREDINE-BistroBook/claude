/**
 * What an uploaded file really is, from its first bytes (magic numbers) and,
 * for Office files, the names inside the ZIP — never from the name or the type
 * the browser claims. POST /api/files stores only these:
 * - images: JPEG, PNG, WebP (lib/images.ts sniffImage);
 * - documents: PDF, and Word / Excel / PowerPoint in the modern format
 *   (.docx / .xlsx / .pptx: a ZIP with [Content_Types].xml and word/ | xl/ |
 *   ppt/). Macro files (vbaProject.bin inside) and old .doc/.xls/.ppt are refused.
 * SVG, HTML and everything else are refused, so nothing stored can run as a
 * page; GET /api/files/:id serves images inline and documents as downloads.
 */
import type { FileKind } from '../../shared/enums';
import { sniffImage } from './images';

export interface FileType {
  mime: string;
  ext: string;
  kind: FileKind;
}

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

/** The extension each stored type is downloaded with. */
export const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  [DOCX]: 'docx',
  [XLSX]: 'xlsx',
  [PPTX]: 'pptx',
};

const u16 = (b: Uint8Array, at: number) => b[at]! | (b[at + 1]! << 8);
const u32 = (b: Uint8Array, at: number) => (b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16) | (b[at + 3]! << 24)) >>> 0;

/**
 * The file names in a ZIP's central directory, or null when `buf` isn't a
 * well-formed (non-ZIP64) ZIP. Reads at most `maxEntries` names.
 */
export function zipEntryNames(buf: Uint8Array, maxEntries = 5000): string[] | null {
  if (buf.length < 30 || u32(buf, 0) !== 0x04034b50) return null;
  // End of central directory: 22 bytes plus a comment of up to 65535, at the very end.
  const lowest = Math.max(0, buf.length - 22 - 0xffff);
  let eocd = -1;
  for (let at = buf.length - 22; at >= lowest; at--) {
    if (u32(buf, at) === 0x06054b50) {
      eocd = at;
      break;
    }
  }
  if (eocd < 0) return null;
  const entries = u16(buf, eocd + 10);
  const size = u32(buf, eocd + 12);
  const offset = u32(buf, eocd + 16);
  if (entries === 0xffff || offset === 0xffffffff || offset + size > eocd || entries > maxEntries) return null;
  const decoder = new TextDecoder();
  const names: string[] = [];
  let at = offset;
  for (let i = 0; i < entries; i++) {
    if (at + 46 > eocd || u32(buf, at) !== 0x02014b50) return null;
    const nameLength = u16(buf, at + 28);
    const extraLength = u16(buf, at + 30);
    const commentLength = u16(buf, at + 32);
    if (at + 46 + nameLength > eocd) return null;
    names.push(decoder.decode(buf.subarray(at + 46, at + 46 + nameLength)));
    at += 46 + nameLength + extraLength + commentLength;
  }
  return names;
}

/** Word, Excel or PowerPoint (OOXML) from the names inside the ZIP; null for any other ZIP, and for macro files. */
function sniffOffice(buf: Uint8Array): FileType | null {
  const names = zipEntryNames(buf);
  if (!names || !names.includes('[Content_Types].xml')) return null;
  if (names.some((n) => /(^|\/)vbaProject\.bin$/i.test(n))) return null;
  if (names.includes('word/document.xml')) return { mime: DOCX, ext: 'docx', kind: 'document' };
  if (names.includes('xl/workbook.xml')) return { mime: XLSX, ext: 'xlsx', kind: 'document' };
  if (names.includes('ppt/presentation.xml')) return { mime: PPTX, ext: 'pptx', kind: 'document' };
  return null;
}

/** The type of an upload, or null when it isn't one the app stores. */
export function sniffFile(buf: Uint8Array): FileType | null {
  const image = sniffImage(buf);
  if (image) return { mime: image.mime, ext: image.ext, kind: 'photo' };
  // "%PDF-"
  if (buf.length >= 5 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46 && buf[4] === 0x2d) {
    return { mime: 'application/pdf', ext: 'pdf', kind: 'document' };
  }
  return sniffOffice(buf);
}

/**
 * A file name safe to send back: no folders, no control or bidi characters,
 * at most 120 characters, ending in the type's extension.
 */
export function downloadName(original: string | null, mime: string): string {
  const ext = EXTENSION_BY_MIME[mime] ?? 'bin';
  let name = (original ?? '')
    .split(/[\\/]/)
    .pop()!
    // Control characters and bidi controls (a name can't pretend to end in ".pdf").
    .replace(/[\u0000-\u001f\u007f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
    .trim();
  if (!name || name === '.' || name === '..') name = 'file';
  const lower = name.toLowerCase();
  if (!lower.endsWith(`.${ext}`) && !(ext === 'jpg' && lower.endsWith('.jpeg'))) name = `${name.replace(/\.+$/, '')}.${ext}`;
  if (name.length > 120) name = name.slice(0, 120 - ext.length - 1).trimEnd() + `.${ext}`;
  return name;
}

/**
 * Content-Disposition for GET /api/files/:id: images `inline`, everything else
 * `attachment` (downloaded, never opened as a page), with the file name as an
 * ASCII fallback plus the exact UTF-8 name (RFC 6266 / 5987), so an Arabic
 * name survives.
 */
export function contentDisposition(mime: string, original: string | null): string {
  const inline = mime === 'image/jpeg' || mime === 'image/png' || mime === 'image/webp';
  const name = downloadName(original, mime);
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\%;]/g, '_');
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
