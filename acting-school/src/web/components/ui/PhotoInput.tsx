import { Camera, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessageKey } from '../../lib/forms';
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
}: {
  value: string | null | undefined;
  onChange: (fileId: string | null) => void;
  /** Used for the initials fallback and alt text. */
  name: string;
  shape?: 'circle' | 'rounded';
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      onChange(await uploadImage(file));
    } catch (err) {
      toast.error(t(errorMessageKey(err)));
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
        <Button icon={Camera} size="sm" loading={busy} onClick={() => input.current?.click()}>
          {value ? t('common:actions.changePhoto') : t('common:actions.addPhoto')}
        </Button>
        {value && (
          <Button icon={Trash2} size="sm" variant="danger-ghost" onClick={() => onChange(null)} disabled={busy}>
            {t('common:actions.removePhoto')}
          </Button>
        )}
      </div>
    </div>
  );
}
