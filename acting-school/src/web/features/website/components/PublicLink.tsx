import { Copy, ExternalLink } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, buttonClasses, useToast } from '@web/components/ui';
import { copyText, shortUrl } from '../utils';

/** "Copy link" with a "Link copied" toast (or how to copy by hand when the browser refuses). */
export function useCopyLink() {
  const { t } = useTranslation('website');
  const toast = useToast();
  return async (url: string) => {
    if (await copyText(url)) toast.success(t('links.copied'));
    else toast.error(t('links.copyFailed'));
  };
}

/**
 * One public page: its name, its address (always left-to-right, selectable so
 * it can also be copied by hand), and big "Open" / "Copy link" buttons.
 */
export function PublicLinkRow({ label, url, icon }: { label: ReactNode; url: string; icon?: ReactNode }) {
  const { t } = useTranslation('website');
  const copy = useCopyLink();
  return (
    <li className="grid gap-2 px-4 py-3 sm:flex sm:items-center sm:gap-4 sm:px-5">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {icon}
        <div className="min-w-0">
          <div className="font-medium text-ink">{label}</div>
          <div dir="ltr" className="truncate text-start text-sm text-muted select-all [unicode-bidi:plaintext]">
            {shortUrl(url)}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:flex">
        <a href={url} target="_blank" rel="noopener" className={buttonClasses('secondary', 'lg', 'px-4')}>
          <ExternalLink className="size-4 shrink-0 rtl:-scale-x-100" aria-hidden />
          {t('links.open')}
          <span className="sr-only">
            {' '}
            {t('links.opensNewTab')}
          </span>
        </a>
        <Button size="lg" icon={Copy} onClick={() => void copy(url)} className="px-4">
          {t('links.copy')}
        </Button>
      </div>
    </li>
  );
}
