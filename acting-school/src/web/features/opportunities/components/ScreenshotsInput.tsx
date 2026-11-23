import { ImagePlus, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { OPPORTUNITY_MAX_FILES } from '@shared/schemas/opportunities';
import { Button, useToast } from '@web/components/ui';
import { ApiError, fileUrl } from '@web/lib/api';
import { discardUpload, PHOTO_ACCEPT } from '@web/lib/files';
import { errorMessageKey } from '@web/lib/forms';
import { uploadImage } from '@web/lib/image';
import { screenshotRoom } from '../utils';

/**
 * Up to three screenshots or photos of the post, from the gallery or the
 * camera (the phone offers both). Each is shrunk and uploaded as it is picked
 * (the existing upload flow, POST /api/files); the form sends their ids. One
 * picked here and removed before saving is taken back from the server at once.
 */
export function ScreenshotsInput({ value, onChange, error }: { value: string[]; onChange: (ids: string[]) => void; error?: string | null }) {
  const { t } = useTranslation(['opportunities', 'common']);
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  // Uploaded from this field (only those may be taken back — never one saved before).
  const uploadedHere = useRef(new Set<string>());
  const room = screenshotRoom(value.length);

  const pick = async (list: FileList | null) => {
    const picked = Array.from(list ?? []).slice(0, room);
    if (!picked.length) return;
    setBusy(true);
    const ids = [...value];
    try {
      for (const file of picked) {
        const id = await uploadImage(file);
        uploadedHere.current.add(id);
        ids.push(id);
        onChange([...ids]);
      }
      if ((list?.length ?? 0) > room) toast.error(t('form.full'));
    } catch (err) {
      toast.error(t(err instanceof ApiError && err.code === 'unsupported_type' ? 'common:errors.photoType' : errorMessageKey(err)));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  const remove = (id: string) => {
    if (uploadedHere.current.has(id)) discardUpload(id);
    onChange(value.filter((v) => v !== id));
  };

  return (
    <div className="grid gap-3">
      {value.length > 0 && (
        <ul className="grid grid-cols-3 gap-2">
          {value.map((id, i) => (
            <li key={id} className="grid gap-1.5">
              <img src={fileUrl(id)} alt={t('form.screenshotAlt', { n: i + 1 })} className="aspect-square w-full rounded-xl border border-line bg-surface-2 object-cover" />
              <Button size="lg" variant="danger-ghost" icon={Trash2} onClick={() => remove(id)} disabled={busy} className="w-full px-2">
                <span className="sr-only">{t('form.removeScreenshot', { n: i + 1 })}</span>
                <span aria-hidden>{t('common:actions.remove')}</span>
              </Button>
            </li>
          ))}
        </ul>
      )}
      <input ref={input} type="file" accept={PHOTO_ACCEPT} multiple className="sr-only" onChange={(e) => void pick(e.target.files)} data-testid="screenshot-input" />
      {room > 0 ? (
        <Button size="lg" icon={ImagePlus} loading={busy} onClick={() => input.current?.click()} className="w-full sm:w-auto">
          {busy ? t('form.uploading') : t('form.addScreenshots')}
        </Button>
      ) : (
        <p className="text-sm text-muted">{t('form.full')}</p>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {t(error)}
        </p>
      )}
      <p className="text-xs text-muted">{t('form.screenshotsHint', { max: OPPORTUNITY_MAX_FILES })}</p>
    </div>
  );
}
