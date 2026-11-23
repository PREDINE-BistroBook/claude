import { Camera, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../../lib/api';
import { errorMessageKey } from '../../lib/forms';
import { discardUpload } from '../../lib/files';
import { uploadImage } from '../../lib/image';
import { Avatar } from './Avatar';
import { Button } from './Button';
import { useToast } from './Toast';

/**
 * Pick/take a photo, resize in the browser, upload, report the new file id.
 * On phones `capture` is not forced, so people can choose camera or library.
 */
export function PhotoInput({
  value,
  onChange,
  name,
  shape = 'circle',
  busy: saving = false,
  discardReplaced = false,
}: {
  value: string | null | undefined;
  onChange: (fileId: string | null) => void;
  /** Used for the initials fallback and alt text. */
  name: string;
  shape?: 'circle' | 'rounded';
  /** The caller is saving the new photo (e.g. the profile photo, saved at once). */
  busy?: boolean;
  /**
   * In a form saved later (a student's photo): a photo picked here and then
   * replaced or removed before saving is deleted from the server straight
   * away (DELETE /api/files/:id) rather than left behind.
   */
  discardReplaced?: boolean;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  // Photos uploaded from this field (only those may be discarded — never one already saved before).
  const uploadedHere = useRef(new Set<string>());
  const dropUnsaved = () => {
    if (discardReplaced && value && uploadedHere.current.has(value)) discardUpload(value);
  };

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const id = await uploadImage(file);
      uploadedHere.current.add(id);
      dropUnsaved();
      onChange(id);
    } catch (err) {
      // Uploads may also be documents, but this field takes pictures only: say so.
      toast.error(t(err instanceof ApiError && err.code === 'unsupported_type' ? 'common:errors.photoType' : errorMessageKey(err)));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <div className="flex items-center gap-4">
      <Avatar name={name || '?'} fileId={value} size="xl" shape={shape} />
      <div className="flex flex-col items-start gap-2">
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" className="sr-only" onChange={(e) => pick(e.target.files?.[0])} />
        <Button icon={Camera} size="lg" className="px-4" loading={busy || saving} onClick={() => input.current?.click()}>
          {value ? t('common:actions.changePhoto') : t('common:actions.addPhoto')}
        </Button>
        {value && (
          <Button
            icon={Trash2}
            size="lg"
            className="px-4"
            variant="danger-ghost"
            onClick={() => {
              dropUnsaved();
              onChange(null);
            }}
            disabled={busy || saving}
          >
            {t('common:actions.removePhoto')}
          </Button>
        )}
      </div>
    </div>
  );
}
