import clsx from 'clsx';
import { ChevronLeft, ChevronRight, ImagePlus, Images, Star, Trash2 } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import type { TalentDetail, TalentPhoto } from '@shared/schemas/talent';
import { Button, Card, ConfirmDialog, EmptyState, IconButton, Modal, useToast } from '@web/components/ui';
import { fileUrl } from '@web/lib/api';
import { errorMessageKey } from '@web/lib/forms';
import { uploadImage } from '@web/lib/image';
import { addTalentPhoto, talentKeys, useDeletePhoto, useSetHeadshot } from '../api';

const ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif';

/** Photo grid with upload, "set as primary", delete and a larger viewer. */
export function Gallery({ talent, name, canWrite }: { talent: TalentDetail; name: string; canWrite: boolean }) {
  const { t } = useTranslation(['talent', 'common']);
  const toast = useToast();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [viewIndex, setViewIndex] = useState<number | null>(null);
  const [toDelete, setToDelete] = useState<TalentPhoto | null>(null);
  const setHeadshot = useSetHeadshot(talent.id);
  const deletePhoto = useDeletePhoto(talent.id);
  const photos = talent.photos;
  const viewing = viewIndex !== null ? photos[viewIndex] : undefined;

  const upload = async (list: FileList | null) => {
    const picked = list ? Array.from(list) : [];
    if (input.current) input.current.value = '';
    if (!picked.length) return;
    setProgress({ done: 0, total: picked.length });
    let added = 0;
    for (const [i, file] of picked.entries()) {
      try {
        const fileId = await uploadImage(file);
        await addTalentPhoto(talent.id, fileId);
        added++;
        // Show each photo as soon as it lands.
        void qc.invalidateQueries({ queryKey: talentKeys.detail(talent.id) });
      } catch (err) {
        toast.error(`${t('detail.uploadFailed', { name: file.name })} ${t(errorMessageKey(err))}`);
      }
      setProgress({ done: i + 1, total: picked.length });
    }
    setProgress(null);
    await qc.invalidateQueries({ queryKey: talentKeys.all });
    if (added) toast.success(t('detail.photosAdded', { count: added }));
  };

  const makePrimary = (photo: TalentPhoto) =>
    setHeadshot.mutate(photo.fileId, {
      onSuccess: () => toast.success(t('detail.primarySet')),
      onError: (err) => toast.error(t(errorMessageKey(err))),
    });

  const confirmDelete = () => {
    if (!toDelete) return;
    const index = photos.findIndex((p) => p.id === toDelete.id);
    deletePhoto.mutate(toDelete.id, {
      onSuccess: () => {
        toast.success(t('detail.photoDeleted'));
        setToDelete(null);
        // Stay in the viewer on a neighbouring photo, or close it when none is left.
        if (viewIndex !== null) setViewIndex(photos.length > 1 ? Math.min(index, photos.length - 2) : null);
      },
      onError: (err) => {
        setToDelete(null);
        toast.error(t(errorMessageKey(err)));
      },
    });
  };

  const busy = progress !== null;

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          {t('detail.photos')}
          {photos.length > 0 && <span className="rounded-full bg-surface-2 px-2 text-xs font-medium text-muted tabular-nums">{photos.length}</span>}
        </span>
      }
      actions={
        canWrite && (
          <>
            <input ref={input} type="file" accept={ACCEPT} multiple className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => void upload(e.target.files)} />
            <Button icon={ImagePlus} size="lg" loading={busy} onClick={() => input.current?.click()}>
              {t('detail.addPhotos')}
            </Button>
          </>
        )
      }
    >
      {progress && (
        <div className="mb-3" role="status">
          <p className="mb-1.5 text-sm text-muted">{t('detail.uploading', { done: Math.min(progress.done + 1, progress.total), total: progress.total })}</p>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
          </div>
        </div>
      )}

      {photos.length === 0 ? (
        <EmptyState
          icon={Images}
          title={t('detail.noPhotos')}
          description={canWrite ? t('detail.noPhotosHint') : t('detail.noPhotosReadOnly')}
          className="py-8"
          action={
            canWrite && !busy ? (
              <Button icon={ImagePlus} size="lg" variant="primary" onClick={() => input.current?.click()}>
                {t('detail.addPhotos')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 sm:gap-3">
          {photos.map((photo, i) => {
            const primary = photo.fileId === talent.headshotFileId;
            return (
              <li key={photo.id} className="relative">
                <button
                  type="button"
                  onClick={() => setViewIndex(i)}
                  aria-label={t('detail.openPhoto', { n: i + 1 })}
                  className={clsx(
                    'block aspect-[3/4] w-full overflow-hidden rounded-xl bg-surface-2',
                    primary && 'ring-2 ring-accent ring-offset-2 ring-offset-surface',
                  )}
                >
                  <img src={fileUrl(photo.fileId)} alt={photo.caption ?? ''} loading="lazy" className="size-full object-cover" />
                </button>
                {primary ? (
                  <span
                    className="pointer-events-none absolute start-1 top-1 flex size-8 items-center justify-center rounded-full bg-accent text-accent-ink shadow"
                    title={t('detail.primary')}
                  >
                    <Star className="size-4 fill-current" aria-hidden />
                    <span className="sr-only">{t('detail.primary')}</span>
                  </span>
                ) : (
                  canWrite && (
                    <TileButton label={t('detail.setPrimary')} onClick={() => makePrimary(photo)} disabled={setHeadshot.isPending} className="start-0 top-0">
                      <Star className="size-4" aria-hidden />
                    </TileButton>
                  )
                )}
                {canWrite && (
                  <TileButton label={t('detail.deletePhoto')} onClick={() => setToDelete(photo)} className="end-0 top-0">
                    <Trash2 className="size-4" aria-hidden />
                  </TileButton>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <Modal
        open={viewing !== undefined && toDelete === null}
        onClose={() => setViewIndex(null)}
        size="lg"
        title={name}
        description={viewIndex !== null ? t('detail.photoOf', { n: viewIndex + 1, total: photos.length }) : undefined}
        footer={
          viewing &&
          canWrite && (
            <>
              {viewing.fileId === talent.headshotFileId ? (
                <span className="me-auto inline-flex items-center gap-1.5 text-sm font-medium text-accent">
                  <Star className="size-4 fill-current" aria-hidden />
                  {t('detail.primary')}
                </span>
              ) : (
                <Button icon={Star} onClick={() => makePrimary(viewing)} loading={setHeadshot.isPending} className="me-auto">
                  {t('detail.setPrimary')}
                </Button>
              )}
              <Button variant="danger-ghost" icon={Trash2} onClick={() => setToDelete(viewing)}>
                {t('common:actions.delete')}
              </Button>
            </>
          )
        }
      >
        {viewing && (
          <div className="relative">
            <img
              src={fileUrl(viewing.fileId)}
              alt={viewing.caption ?? name}
              className="mx-auto max-h-[62dvh] w-auto max-w-full rounded-xl bg-surface-2 object-contain"
            />
            {viewing.caption && (
              <p dir="auto" className="mt-2 text-center text-sm text-muted">
                {viewing.caption}
              </p>
            )}
            {photos.length > 1 && viewIndex !== null && (
              <>
                <IconButton
                  icon={ChevronLeft}
                  label={t('detail.previousPhoto')}
                  variant="secondary"
                  onClick={() => setViewIndex((viewIndex - 1 + photos.length) % photos.length)}
                  className="absolute start-1 top-1/2 -translate-y-1/2 rounded-full shadow-md [&_svg]:rtl:-scale-x-100"
                />
                <IconButton
                  icon={ChevronRight}
                  label={t('detail.nextPhoto')}
                  variant="secondary"
                  onClick={() => setViewIndex((viewIndex + 1) % photos.length)}
                  className="absolute end-1 top-1/2 -translate-y-1/2 rounded-full shadow-md [&_svg]:rtl:-scale-x-100"
                />
              </>
            )}
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={toDelete !== null}
        title={t('detail.deletePhotoTitle')}
        message={t('detail.deletePhotoMessage')}
        loading={deletePhoto.isPending}
        onConfirm={confirmDelete}
        onCancel={() => setToDelete(null)}
      />
    </Card>
  );
}

/** A 40px tap target in a tile corner with a smaller dark disc inside, readable on any photo. */
function TileButton({
  label,
  onClick,
  disabled,
  className,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={clsx('group/tile absolute flex size-10 items-center justify-center disabled:opacity-50', className)}
    >
      <span className="flex size-8 items-center justify-center rounded-full bg-black/55 text-white shadow transition-colors group-hover/tile:bg-black/75">
        {children}
      </span>
    </button>
  );
}
