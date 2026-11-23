import { BellRing, ChevronRight } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router';
import { vibrateIfAllowed } from '../../team/utils';
import { useCafeStatus } from '../api';
import { ring } from '../sound';
import { CAFE_BOARD_PATH, cafeBadge } from '../utils';

/**
 * "2 new orders are waiting — Open the orders": across the top of every
 * screen, for someone whose home is the orders board (the Office helper) when
 * he is somewhere else in the app — the Menu tab, a chat, his profile. It
 * comes from the same 20-second poll as the Messages badge, and buzzes (and
 * rings, once the board's sound has been turned on) when the count goes up.
 * On the board itself the cards say it, so it is not shown there. AppShell
 * renders it only for those people: an owner, who also holds cafeteria.serve
 * but works in a section, is not followed around by it.
 */
export function CafeOrdersBanner() {
  const { t } = useTranslation(['cafe']);
  const { pathname } = useLocation();
  const waiting = cafeBadge(useCafeStatus());
  const onBoard = pathname === CAFE_BOARD_PATH;

  // null until the first count is known: what was already waiting when the app opened doesn't buzz.
  const last = useRef<number | null>(null);
  useEffect(() => {
    const before = last.current;
    last.current = waiting;
    if (before === null || waiting <= before || onBoard) return;
    ring();
    vibrateIfAllowed([200, 100, 200]);
  }, [waiting, onBoard]);

  if (!waiting || onBoard) return null;
  return (
    <Link
      to={CAFE_BOARD_PATH}
      role="status"
      className="flex min-h-14 items-center justify-center gap-3 border-b-4 border-warning-ink/20 bg-warning px-4 py-2 text-center text-base font-bold text-warning-ink shadow-lg"
    >
      <BellRing className="size-6 shrink-0 animate-pulse" aria-hidden />
      <span className="min-w-0">
        {t('banner.waiting', { count: waiting })}
        <span className="ms-2 inline-flex items-center gap-0.5 font-semibold underline underline-offset-4">
          {t('banner.open')}
          <ChevronRight className="size-5 shrink-0 rtl:-scale-x-100" aria-hidden />
        </span>
      </span>
    </Link>
  );
}
