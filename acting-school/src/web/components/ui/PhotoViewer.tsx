import { ChevronLeft, ChevronRight, Download, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { fileUrl } from '../../lib/api';

export interface ViewerPhoto {
  fileId: string;
  /** Shown under the photo and used as its alt text. */
  caption?: string | null;
  /** Small line under the caption ("Added by Layla · 3 Nov"). */
  meta?: string | null;
}

/**
 * Full-screen photo viewer: the photo as large as the screen allows, big
 * labelled Close / Previous / Next buttons (arrows mirror in Arabic), a
 * Download link, Escape and the arrow keys. `index` null = closed.
 */
export function PhotoViewer({
  photos,
  index,
  onIndex,
  onClose,
}: {
  photos: readonly ViewerPhoto[];
  index: number | null;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const closeRef = useRef<HTMLButtonElement>(null);
  const open = index !== null && index >= 0 && index < photos.length;
  const photo = open ? photos[index] : undefined;
  const rtl = i18n.dir() === 'rtl';

  useEffect(() => {
    if (!open) return;
    const prevFocus = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = prevOverflow;
      prevFocus?.focus?.();
    };
  }, [open]);

  useEffect(() => {
    if (!open || index === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      // ArrowRight goes "forward" in English and "back" in Arabic, like the page itself.
      else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        const forward = (e.key === 'ArrowRight') !== rtl;
        const next = index + (forward ? 1 : -1);
        if (next >= 0 && next < photos.length) onIndex(next);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, index, photos.length, onIndex, onClose, rtl]);

  if (!open || !photo || index === null) return null;
  const many = photos.length > 1;
  const navBtn = 'inline-flex min-h-12 items-center gap-2 rounded-xl bg-white/10 px-4 text-base font-medium text-white hover:bg-white/20 disabled:opacity-30';

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={photo.caption || t('common:fields.photo')} className="fixed inset-0 z-[80] flex flex-col bg-black text-white">
      <div className="pt-safe flex items-center justify-between gap-2 px-3 py-2">
        <span className="px-2 text-sm text-white/80 tabular-nums">{many ? `${index + 1} / ${photos.length}` : ''}</span>
        <div className="flex items-center gap-2">
          <a href={fileUrl(photo.fileId)} download className={navBtn}>
            <Download className="size-5" aria-hidden />
            {t('common:actions.download')}
          </a>
          <button ref={closeRef} type="button" onClick={onClose} className={navBtn}>
            <X className="size-5" aria-hidden />
            {t('common:actions.close')}
          </button>
        </div>
      </div>
      {/* Tapping the dark area around the photo closes it too. */}
      <div className="flex min-h-0 flex-1 items-center justify-center px-2" onClick={(e) => e.target === e.currentTarget && onClose()}>
        <img key={photo.fileId} src={fileUrl(photo.fileId)} alt={photo.caption ?? ''} className="max-h-full max-w-full object-contain" />
      </div>
      {(photo.caption || photo.meta) && (
        <div className="px-4 pt-2 text-center">
          {photo.caption && (
            <p dir="auto" className="text-base">
              {photo.caption}
            </p>
          )}
          {photo.meta && <p className="mt-0.5 text-sm text-white/70">{photo.meta}</p>}
        </div>
      )}
      <div className="pb-safe flex items-center justify-between gap-2 px-3 py-3">
        {many ? (
          <>
            <button type="button" className={navBtn} disabled={index === 0} onClick={() => onIndex(index - 1)}>
              <ChevronLeft className="size-5 rtl:-scale-x-100" aria-hidden />
              {t('common:actions.previous')}
            </button>
            <button type="button" className={navBtn} disabled={index === photos.length - 1} onClick={() => onIndex(index + 1)}>
              {t('common:actions.next')}
              <ChevronRight className="size-5 rtl:-scale-x-100" aria-hidden />
            </button>
          </>
        ) : (
          <span />
        )}
      </div>
    </div>,
    document.body,
  );
}
