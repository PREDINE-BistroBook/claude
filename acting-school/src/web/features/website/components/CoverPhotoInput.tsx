import clsx from 'clsx';
import { Camera, ImageIcon, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, useToast } from '@web/components/ui';
import { fileUrl } from '@web/lib/api';
import { errorMessageKey } from '@web/lib/forms';
import { uploadImage } from '@web/lib/image';

/**
 * A photo for the website (the home page's main photo, a workshop's cover, a
 * coach's portrait): a large preview, then big "Add / Change photo" and
 * "Remove photo" buttons. The photo is resized on the phone before upload
 * (uploadImage), like every staff upload.
 */
export function CoverPhotoInput({
  value,
  onChange,
  alt,
  id,
  shape = 'wide',
}: {
  value: string | null;
  onChange: (fileId: string | null) => void;
  alt: string;
  id?: string;
  /** 'wide' (16:9) for covers and the main photo, 'portrait' (3:4) for a person. */
  shape?: 'wide' | 'portrait';
}) {
  const { t } = useTranslation(['website', 'common']);
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [broken, setBroken] = useState<string | null>(null);

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
    <div className="grid gap-3">
      <div className={clsx('w-full overflow-hidden rounded-2xl border border-line bg-surface-2', shape === 'wide' ? 'aspect-video max-w-md' : 'aspect-[3/4] max-w-40')}>
        {value && broken !== value ? (
          <img src={fileUrl(value)} alt={alt} className="size-full object-cover" onError={() => setBroken(value)} />
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-2 text-muted">
            <ImageIcon className="size-8" aria-hidden />
            <span className="text-sm">{t('website:photo.none')}</span>
          </div>
        )}
      </div>
      <input
        id={id}
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => void pick(e.target.files?.[0])}
      />
      <div className="flex flex-wrap gap-2">
        <Button icon={Camera} size="lg" loading={busy} onClick={() => input.current?.click()}>
          {value ? t('website:photo.change') : t('website:photo.add')}
        </Button>
        {value && (
          <Button icon={Trash2} size="lg" variant="danger-ghost" onClick={() => onChange(null)} disabled={busy}>
            {t('website:photo.remove')}
          </Button>
        )}
      </div>
    </div>
  );
}
