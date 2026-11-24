import clsx from 'clsx';
import { useRef, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ATTENDANCE_STATUSES, type AttendanceStatus } from '@shared/enums';

const SELECTED: Record<AttendanceStatus, string> = {
  present: 'bg-success text-success-ink border-success',
  late: 'bg-warning text-warning-ink border-warning',
  absent: 'bg-danger text-danger-ink border-danger',
  excused: 'bg-info text-info-ink border-info',
};

/**
 * Four big buttons (Present / Late / Absent / Excused) acting as one radio
 * group. Arrow keys move the choice, like native radios.
 */
export function AttendanceControl({
  value,
  onChange,
  label,
  disabled,
}: {
  value: AttendanceStatus | null;
  onChange: (v: AttendanceStatus) => void;
  /** Accessible name, e.g. "Attendance for Layla Haddad". */
  label: string;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (e: KeyboardEvent, i: number) => {
    const rtl = document.documentElement.dir === 'rtl';
    const forward = e.key === 'ArrowDown' || e.key === (rtl ? 'ArrowLeft' : 'ArrowRight');
    const back = e.key === 'ArrowUp' || e.key === (rtl ? 'ArrowRight' : 'ArrowLeft');
    if (!forward && !back) return;
    e.preventDefault();
    const n = ATTENDANCE_STATUSES.length;
    const j = (i + (forward ? 1 : n - 1)) % n;
    onChange(ATTENDANCE_STATUSES[j]!);
    refs.current[j]?.focus();
  };

  // Only one option is tabbable: the selected one, else the first.
  const tabIndexFor = (i: number) => (value ? (ATTENDANCE_STATUSES[i] === value ? 0 : -1) : i === 0 ? 0 : -1);

  return (
    <div role="radiogroup" aria-label={label} className="grid grid-cols-4 gap-1.5">
      {ATTENDANCE_STATUSES.map((status, i) => {
        const selected = value === status;
        return (
          <button
            key={status}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={tabIndexFor(i)}
            disabled={disabled}
            onClick={() => onChange(status)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={clsx(
              'h-11 min-w-0 truncate rounded-xl border px-1.5 text-sm font-medium transition-colors disabled:opacity-50 sm:h-10 sm:px-3',
              selected ? SELECTED[status] : 'border-line-strong bg-surface text-ink/80 hover:bg-surface-2',
            )}
          >
            {t(`common:enums.attendanceStatus.${status}`)}
          </button>
        );
      })}
    </div>
  );
}
