import { Camera, ImageIcon, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, useToast } from '@web/components/ui';
import { fileUrl } from '@web/lib/api';
import { errorMessageKey } from '@web/lib/forms';
import { uploadImage } from '@web/lib/image';

/**
 * A wide photo (the home page's main photo, a workshop's cover): a 16:9
 * preview, then "Add / Change photo" and "Remove photo". The photo is resized
 * on the phone before upload (uploadImage), like every staff upload.
 */
export function CoverPhotoInput({ value, onChange, alt, id }: { value: string | null; onChange: (fileId: string | null) => void; alt: string; id?: string }) {
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
      <div className="aspect-video w-full max-w-md overflow-hidden rounded-2xl border border-line bg-surface-2">
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
