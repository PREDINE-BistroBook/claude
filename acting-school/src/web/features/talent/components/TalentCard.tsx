import { MapPin } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { TalentListItem } from '@shared/schemas/talent';
import { Avatar, StatusBadge } from '@web/components/ui';
import { displayName, fullName } from '@web/lib/format';
import { ageLabel, BidiText } from '../utils';

/** One headshot tile on the roster grid. */
export function TalentCard({ talent: p }: { talent: TalentListItem }) {
  const { t } = useTranslation(['talent', 'common']);
  const shown = displayName(p);
  const real = fullName(p);
  const age = ageLabel(t, p);

  return (
    <li>
      <Link
        to={`/talent/${p.id}`}
        className="group block h-full rounded-2xl border border-line bg-surface p-1.5 transition-colors hover:border-line-strong hover:bg-surface-2 sm:p-2"
      >
        <div className="relative overflow-hidden rounded-xl">
          <Avatar name={real} fileId={p.headshotFileId} shape="portrait" className="transition-transform duration-300 group-hover:scale-[1.02]" />
          {p.status !== 'active' && (
            <span className="absolute start-2 top-2">
              <StatusBadge group="talentStatus" value={p.status} className="shadow-sm" />
            </span>
          )}
        </div>
        <div className="px-1 pb-1 pt-2 sm:px-1.5">
          <BidiText className="font-semibold leading-snug text-ink">{shown}</BidiText>
          {shown !== real && <BidiText className="text-xs text-muted">{real}</BidiText>}
          {(age || p.city) && (
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
              {age && <span className="whitespace-nowrap">{age}</span>}
              {p.city && (
                <span className="flex min-w-0 items-center gap-0.5">
                  <MapPin className="size-3 shrink-0" aria-hidden />
                  <BidiText>{p.city}</BidiText>
                </span>
              )}
            </div>
          )}
        </div>
      </Link>
    </li>
  );
}
