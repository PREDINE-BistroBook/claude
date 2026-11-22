import { api } from './api';

/**
 * Shrink a photo in the browser before upload (phone cameras produce 5–15 MB
 * files): longest side ≤ maxSize px, re-encoded as JPEG. Orientation from EXIF
 * is applied by createImageBitmap.
 */
export async function resizeImage(file: File, maxSize = 1600, quality = 0.85): Promise<Blob> {
  if (!file.type.startsWith('image/')) return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return file; // let the server decide (it will reject unsupported types)
  }
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size < 1.5 * 1024 * 1024 && file.type !== 'image/heic') {
    bitmap.close();
    return file;
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b ?? file), 'image/jpeg', quality));
}

/** Resize + upload; resolves to the new file id. */
export async function uploadImage(file: File): Promise<string> {
  const blob = await resizeImage(file);
  const name = file.name.replace(/\.[^.]+$/, '') + (blob.type === 'image/jpeg' ? '.jpg' : '');
  const res = await api.upload(blob, name || 'image.jpg');
  return res.id;
}
