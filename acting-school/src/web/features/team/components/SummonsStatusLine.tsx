import clsx from 'clsx';
import { CircleCheck, Clock, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { SummonsView } from '@shared/schemas/summons';
import { Button, useToast } from '@web/components/ui';
import { useFormat } from '@web/lib/format';
import { teamErrorKey, useCancelSummons } from '../api';
import { clockOf, summonsMoment } from '../utils';

const TONE = {
  pending: 'bg-warning-soft text-warning',
  on_my_way: 'bg-success-soft text-success',
  cant_now: 'bg-danger-soft text-danger',
  cancelled: 'bg-surface-2 text-muted',
  expired: 'bg-surface-2 text-muted',
} as const;

/**
 * The caller's view of their last call to someone: "Called at 10:40 · waiting
 * for an answer" (with "Cancel the call"), "On my way ✓ 10:42", "Can't come
 * now · 10:42"…
 */
export function SummonsStatusLine({ summons: s, className }: { summons: SummonsView; className?: string }) {
  const { t } = useTranslation(['team', 'common']);
  const f = useFormat();
  const toast = useToast();
  const cancel = useCancelSummons();
  const time = f.time(clockOf(summonsMoment(s)));
  const Icon = s.status === 'on_my_way' ? CircleCheck : s.status === 'pending' ? Clock : X;
  return (
    <div className={clsx('flex flex-wrap items-center gap-2', className)} role="status">
      <span className={clsx('inline-flex min-h-8 items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium', TONE[s.status])}>
        <Icon className="size-4 shrink-0" aria-hidden />
        {t(`summon.status.${s.status}`, { time })}
      </span>
      {s.status === 'pending' && (
        <Button
          variant="danger-ghost"
          size="lg"
          loading={cancel.isPending}
          onClick={() =>
            cancel.mutate(s.id, {
              onSuccess: () => toast.success(t('summon.cancelled')),
              onError: (err) => toast.error(t(teamErrorKey(err))),
            })
          }
        >
          {t('summon.cancel')}
        </Button>
      )}
    </div>
  );
}
