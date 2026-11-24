import { useQueryClient } from '@tanstack/react-query';
import { FolderOpen, ImagePlus, Paperclip, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RecordFile } from '@shared/schemas/files';
import { Button, ConfirmDialog, DocumentChip, EmptyState, ErrorState, PhotoViewer, Spinner, useToast } from '@web/components/ui';
import { api, fileUrl } from '@web/lib/api';
import { discardUpload, DOCUMENT_ACCEPT, PHOTO_ACCEPT, uploadAny } from '@web/lib/files';
import { useFormat } from '@web/lib/format';
import { teamErrorKey, teamKeys, useRecordFiles } from '../api';
import { isolate } from '../utils';

/**
 * A workshop's "Photos & files" tab or a casting's "Files" section: a grid of
 * photos (tap → full screen) and a list of documents (tap → download), with
 * "Add photos" / "Add a file" for people who may add, and delete where
 * `canDelete` says so. Workshop: courses.write or the workshop's coach adds;
 * casting: castings.write (the API decides; `canAdd` only hides the buttons).
 */
export function RecordFiles({ resource, recordId, canAdd }: { resource: 'courses' | 'castings'; recordId: number; canAdd: boolean }) {
  const { t } = useTranslation(['team', 'common']);
  const f = useFormat();
  const toast = useToast();
  const qc = useQueryClient();
  const list = useRecordFiles(resource, recordId);
  const photoInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [viewer, setViewer] = useState<number | null>(null);
  const [toDelete, setToDelete] = useState<RecordFile | null>(null);
  const [deleting, setDeleting] = useState(false);
  const key = teamKeys.files(resource, recordId);

  const items = list.data?.items ?? [];
  const photos = items.filter((x) => x.kind === 'photo');
  const docs = items.filter((x) => x.kind === 'document');
  const meta = (x: RecordFile) =>
    x.uploadedBy ? t('files.addedBy', { name: isolate(x.uploadedBy.name), date: f.timestamp(x.createdAt, 'short') }) : t('files.addedOn', { date: f.timestamp(x.createdAt, 'short') });

  const upload = async (picked: FileList | null, input: HTMLInputElement | null) => {
    const files = picked ? Array.from(picked) : [];
    if (input) input.value = '';
    if (!files.length) return;
    setProgress({ done: 0, total: files.length });
    let added = 0;
    let addedPhotos = 0;
    for (const [i, file] of files.entries()) {
      let uploadedId: string | null = null;
      try {
        const up = await uploadAny(file);
        uploadedId = up.id;
        await api.post<RecordFile>(`/${resource}/${recordId}/files`, { fileId: uploadedId });
        added++;
        if (up.kind === 'photo') addedPhotos++;
        void qc.invalidateQueries({ queryKey: key });
      } catch (err) {
        // Uploaded but not added: don't leave it behind on the server.
        discardUpload(uploadedId);
        toast.error(`${t('files.uploadFailed', { name: isolate(file.name) })} ${t(teamErrorKey(err))}`);
      }
      setProgress({ done: i + 1, total: files.length });
    }
    setProgress(null);
    await qc.invalidateQueries({ queryKey: key });
    // "2 photos added" / "1 file added" — the word for what was added.
    if (added) toast.success(t(addedPhotos === added ? 'files.addedPhotos' : 'files.added', { count: added }));
  };

  const remove = async () => {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await api.delete(`/${resource}/${recordId}/files/${toDelete.id}`);
      setViewer(null);
      toast.success(t('files.deleted'));
      await qc.invalidateQueries({ queryKey: key });
    } catch (err) {
      toast.error(t(teamErrorKey(err)));
    } finally {
      setDeleting(false);
      setToDelete(null);
    }
  };

  const busy = progress !== null;
  const addButtons = canAdd && (
    <div className="flex flex-wrap gap-2">
      <input ref={photoInput} type="file" accept={PHOTO_ACCEPT} multiple className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => void upload(e.target.files, photoInput.current)} />
      <input ref={fileInput} type="file" accept={DOCUMENT_ACCEPT} multiple className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => void upload(e.target.files, fileInput.current)} />
      <Button size="lg" icon={ImagePlus} disabled={busy} onClick={() => photoInput.current?.click()} data-testid="add-record-photos">
        {t('files.addPhotos')}
      </Button>
      <Button size="lg" icon={Paperclip} disabled={busy} onClick={() => fileInput.current?.click()}>
        {t('files.addFile')}
      </Button>
    </div>
  );

  if (list.isPending)
    return (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    );
  if (list.isError) return <ErrorState error={list.error} onRetry={() => void list.refetch()} />;

  const course = resource === 'courses';
  // grid-cols-1 (minmax(0, 1fr)) throughout: a long file name truncates instead of widening the page.
  return (
    <div className="grid grid-cols-1 gap-4">
      {canAdd && (
        <div className="grid gap-1.5">
          {addButtons}
          <p className="text-xs text-muted">{t('files.hint')}</p>
        </div>
      )}
      {progress && (
        <div role="status">
          <p className="mb-1.5 text-sm text-muted">{t('files.uploading', { done: Math.min(progress.done + 1, progress.total), total: progress.total })}</p>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
          </div>
        </div>
      )}

      {items.length === 0 ? (
        <EmptyState
          icon={FolderOpen}
          title={course ? t('files.empty') : t('files.emptyCasting')}
          description={course ? (canAdd ? t('files.emptyHintCoach') : t('files.emptyHintRead')) : canAdd ? t('files.emptyCastingHint') : t('files.emptyCastingRead')}
          className="rounded-2xl border border-dashed border-line-strong"
        />
      ) : (
        <>
          {photos.length > 0 && (
            <section aria-label={t('files.photos')}>
              <h3 className="mb-2 px-1 text-xs font-medium uppercase tracking-wide text-muted">
                {t('files.photos')} <span className="tabular-nums">({f.number(photos.length)})</span>
              </h3>
              <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 sm:gap-3">
                {photos.map((p, i) => (
                  <li key={p.id} className="relative">
                    <button
                      type="button"
                      onClick={() => setViewer(i)}
                      aria-label={p.caption || t('files.openPhoto', { n: i + 1 })}
                      className="block aspect-square w-full overflow-hidden rounded-xl bg-surface-2"
                    >
                      <img src={fileUrl(p.fileId)} alt={p.caption ?? ''} loading="lazy" className="size-full object-cover" />
                    </button>
                    {p.canDelete && (
                      <Button variant="danger-ghost" size="lg" icon={Trash2} className="mt-1 w-full px-2" onClick={() => setToDelete(p)}>
                        {t('common:actions.delete')}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {docs.length > 0 && (
            <section aria-label={t('files.documents')}>
              <h3 className="mb-2 px-1 text-xs font-medium uppercase tracking-wide text-muted">
                {t('files.documents')} <span className="tabular-nums">({f.number(docs.length)})</span>
              </h3>
              <ul className="grid grid-cols-1 gap-2">
                {docs.map((d) => (
                  <li key={d.id} className="grid min-w-0 gap-1 sm:flex sm:items-center sm:gap-2">
                    <DocumentChip fileId={d.fileId} name={d.caption || d.name} mime={d.mime} size={d.size} meta={meta(d)} className="min-w-0 flex-1" />
                    {d.canDelete && (
                      <Button variant="danger-ghost" size="lg" icon={Trash2} className="shrink-0 justify-self-end" onClick={() => setToDelete(d)}>
                        {t('common:actions.delete')}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      <PhotoViewer
        photos={photos.map((p) => ({ fileId: p.fileId, caption: p.caption, meta: meta(p) }))}
        index={viewer}
        onIndex={setViewer}
        onClose={() => setViewer(null)}
      />
      <ConfirmDialog
        open={!!toDelete}
        title={t('files.deleteTitle')}
        message={toDelete ? t('files.deleteMessage', { name: isolate(toDelete.caption || toDelete.name || t(`common:enums.fileKind.${toDelete.kind}`)) }) : ''}
        loading={deleting}
        onConfirm={() => void remove()}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
}
