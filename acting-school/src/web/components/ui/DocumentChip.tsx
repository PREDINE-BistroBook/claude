import clsx from 'clsx';
import { Download, FileSpreadsheet, FileText, Presentation, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { fileUrl } from '../../lib/api';
import { documentLabel, formatFileSize } from '../../lib/files';
import { intlLocale } from '../../lib/format';

function iconFor(mime: string): LucideIcon {
  if (mime.includes('spreadsheetml')) return FileSpreadsheet;
  if (mime.includes('presentationml')) return Presentation;
  return FileText;
}

/**
 * A document (PDF, Word, Excel, PowerPoint) as a tappable chip: type icon,
 * file name, type and size, and a download arrow. The server sends documents
 * as a download under their own name.
 */
export function DocumentChip({
  fileId,
  name,
  mime,
  size,
  meta,
  className,
  tone = 'surface',
}: {
  fileId: string;
  name: string | null;
  mime: string;
  size: number;
  /** Extra line ("Added by Layla · 3 Nov"). */
  meta?: ReactNode;
  className?: string;
  /** 'accent' inside my own chat bubble. */
  tone?: 'surface' | 'accent';
}) {
  const { t, i18n } = useTranslation();
  const Icon = iconFor(mime);
  const label = name || documentLabel(mime) || t('common:enums.fileKind.document');
  const details = [documentLabel(mime, name), formatFileSize(size, intlLocale(i18n.language))].filter(Boolean).join(' · ');
  return (
    <a
      href={fileUrl(fileId)}
      download={name ?? true}
      aria-label={`${t('common:actions.download')}: ${label}`}
      className={clsx(
        'flex min-h-14 min-w-0 items-center gap-3 rounded-xl border px-3 py-2 transition-colors',
        tone === 'accent' ? 'border-accent-ink/25 bg-accent-ink/10 text-accent-ink hover:bg-accent-ink/15' : 'border-line bg-surface hover:bg-surface-2',
        className,
      )}
    >
      <span className={clsx('flex size-10 shrink-0 items-center justify-center rounded-lg', tone === 'accent' ? 'bg-accent-ink/15' : 'bg-accent-soft text-accent')}>
        <Icon className="size-5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        {/* The whole name on up to two lines, and who added it on a line of its own: nothing important cut off on a phone. */}
        <bdi dir="auto" className={clsx('line-clamp-2 block break-words text-sm font-medium', tone === 'accent' ? '' : 'text-ink')}>
          {label}
        </bdi>
        <span className={clsx('block truncate text-xs', tone === 'accent' ? 'opacity-80' : 'text-muted')}>{details}</span>
        {meta && <span className={clsx('block text-xs', tone === 'accent' ? 'opacity-80' : 'text-muted')}>{meta}</span>}
      </span>
      <Download className="size-5 shrink-0 opacity-70" aria-hidden />
    </a>
  );
}
