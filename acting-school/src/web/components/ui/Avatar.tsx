import clsx from 'clsx';
import { useState } from 'react';
import { fileUrl } from '../../lib/api';
import { avatarTone } from '../../lib/colors';

const SIZES = {
  xs: 'size-6 text-[10px]',
  sm: 'size-8 text-xs',
  md: 'size-10 text-sm',
  lg: 'size-14 text-base',
  xl: 'size-24 text-2xl',
  '2xl': 'size-32 text-3xl',
} as const;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const first = [...parts[0]!][0] ?? '';
  const last = parts.length > 1 ? ([...parts[parts.length - 1]!][0] ?? '') : '';
  return (first + last).toUpperCase();
}

/** Photo if there is one, otherwise tinted initials. `shape="portrait"` for headshots (3:4). */
export function Avatar({
  name,
  fileId,
  size = 'md',
  shape = 'circle',
  className,
}: {
  name: string;
  fileId?: string | null;
  size?: keyof typeof SIZES;
  shape?: 'circle' | 'rounded' | 'portrait';
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  const shapeCls = shape === 'circle' ? 'rounded-full' : 'rounded-xl';
  const dims = shape === 'portrait' ? '' : SIZES[size];
  const portraitCls = shape === 'portrait' ? 'aspect-[3/4] w-full text-3xl' : '';
  if (fileId && !broken) {
    return (
      <img
        src={fileUrl(fileId)}
        alt={name}
        loading="lazy"
        onError={() => setBroken(true)}
        className={clsx('shrink-0 object-cover bg-surface-2', shapeCls, dims, portraitCls, className)}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={clsx('inline-flex shrink-0 items-center justify-center font-semibold', shapeCls, dims, portraitCls, avatarTone(name), className)}
    >
      {initials(name)}
    </span>
  );
}
