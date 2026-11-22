import { Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, IconButton, Input, Select } from '@web/components/ui';
import { useFormat } from '@web/lib/format';
import { orderedWeekdays, weekdayRank } from '../utils';

export interface SlotDraft {
  key: string;
  weekday: string;
  startTime: string;
  endTime: string;
}

let nextKey = 1;
export const newSlotKey = () => `slot-${nextKey++}`;

/**
 * Weekly time slots: one row per slot (day + start + end). Stacks on phones,
 * one line per slot from sm up.
 */
export function ScheduleEditor({
  slots,
  onChange,
  error,
  weekStart,
}: {
  slots: SlotDraft[];
  onChange: (slots: SlotDraft[]) => void;
  /** Field error for a path like 'schedule.0.endTime'. */
  error: (path: string) => string | undefined;
  weekStart: number;
}) {
  const { t } = useTranslation('classes');
  const f = useFormat();
  const days = orderedWeekdays(weekStart);

  const update = (i: number, patch: Partial<SlotDraft>) => onChange(slots.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  const add = () => {
    const last = slots.at(-1);
    // Next slot: the day after the last one, same times (most classes repeat).
    const weekday = last ? (Number(last.weekday) + 1) % 7 : weekStart;
    onChange([...slots, { key: newSlotKey(), weekday: String(weekday), startTime: last?.startTime ?? '18:00', endTime: last?.endTime ?? '20:00' }]);
  };

  return (
    <div className="grid gap-3">
      {slots.length === 0 && <p className="rounded-xl border border-dashed border-line-strong px-4 py-3 text-sm text-muted">{t('schedule.empty')}</p>}
      {slots.map((slot, i) => {
        const n = i + 1;
        const ids = { day: `slot-${slot.key}-day`, start: `slot-${slot.key}-start`, end: `slot-${slot.key}-end` };
        const errs = [error(`schedule.${i}.weekday`), error(`schedule.${i}.startTime`), error(`schedule.${i}.endTime`)].filter(Boolean);
        return (
          <div key={slot.key} className="rounded-xl border border-line bg-surface-2/40 p-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
              <div className="col-span-2 flex items-end gap-2 sm:col-span-1">
                <div className="min-w-0 flex-1">
                  <label htmlFor={ids.day} className="mb-1 block text-xs font-medium text-muted">
                    {t('schedule.day')}
                  </label>
                  <Select id={ids.day} value={slot.weekday} onChange={(e) => update(i, { weekday: e.target.value })} aria-invalid={error(`schedule.${i}.weekday`) ? true : undefined}>
                    {days.map((d) => (
                      <option key={d} value={d}>
                        {f.weekday(d, 'long')}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="sm:hidden">
                  <IconButton icon={Trash2} label={t('schedule.removeSlot', { n })} variant="danger-ghost" onClick={() => onChange(slots.filter((_, j) => j !== i))} />
                </div>
              </div>
              <div>
                <label htmlFor={ids.start} className="mb-1 block text-xs font-medium text-muted">
                  {t('schedule.starts')}
                </label>
                <Input
                  id={ids.start}
                  type="time"
                  step={300}
                  value={slot.startTime}
                  onChange={(e) => update(i, { startTime: e.target.value })}
                  aria-invalid={error(`schedule.${i}.startTime`) ? true : undefined}
                />
              </div>
              <div>
                <label htmlFor={ids.end} className="mb-1 block text-xs font-medium text-muted">
                  {t('schedule.ends')}
                </label>
                <Input
                  id={ids.end}
                  type="time"
                  step={300}
                  value={slot.endTime}
                  onChange={(e) => update(i, { endTime: e.target.value })}
                  aria-invalid={error(`schedule.${i}.endTime`) ? true : undefined}
                />
              </div>
              <div className="hidden sm:block">
                <IconButton icon={Trash2} label={t('schedule.removeSlot', { n })} variant="danger-ghost" onClick={() => onChange(slots.filter((_, j) => j !== i))} />
              </div>
            </div>
            {errs.length > 0 && (
              <p className="mt-2 text-sm text-danger" role="alert">
                {t(errs[0]!)}
              </p>
            )}
          </div>
        );
      })}
      <div>
        <Button icon={Plus} onClick={add} disabled={slots.length >= 14}>
          {t('schedule.addSlot')}
        </Button>
      </div>
    </div>
  );
}

/** Slots sorted for the school's week (used when loading a class into the editor). */
export function toDrafts(slots: { weekday: number; startTime: string; endTime: string }[], weekStart: number): SlotDraft[] {
  return [...slots]
    .sort((a, b) => weekdayRank(a.weekday, weekStart) - weekdayRank(b.weekday, weekStart) || a.startTime.localeCompare(b.startTime))
    .map((s) => ({ key: newSlotKey(), weekday: String(s.weekday), startTime: s.startTime, endTime: s.endTime }));
}
