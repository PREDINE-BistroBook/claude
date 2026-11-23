import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { MAX_INTERVIEW_CRITERIA } from '@shared/schemas/settings';
import { Button, IconButton, TextField } from '@web/components/ui';

/** A criterion being edited. `key` is '' for one added in this session (generated from the label on save). */
export interface CriterionDraft {
  /** Stable React key for the row. */
  rowId: string;
  key: string;
  label: string;
  labelAr: string;
}

/**
 * Edit the interview criteria: add, rename (English / Arabic), remove, reorder.
 * Keys never change once saved, so stored scores stay attached when a
 * criterion is renamed.
 */
export function CriteriaEditor({
  value,
  onChange,
  error,
}: {
  value: CriterionDraft[];
  onChange: (next: CriterionDraft[]) => void;
  /** Field errors keyed like the API's: 'interviewCriteria.2.label'. */
  error: (path: string) => string | undefined;
}) {
  const { t } = useTranslation(['settings', 'common']);
  const set = (i: number, patch: Partial<CriterionDraft>) => onChange(value.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const move = (i: number, dir: -1 | 1) => {
    const next = [...value];
    const [item] = next.splice(i, 1);
    next.splice(i + dir, 0, item!);
    onChange(next);
  };
  const add = () => onChange([...value, { rowId: `new-${Date.now()}-${value.length}`, key: '', label: '', labelAr: '' }]);

  return (
    <div className="grid gap-3">
      {value.length ? (
        <ol className="grid gap-3">
          {value.map((c, i) => {
            const name = c.label.trim() || t('criteria.untitled', { n: i + 1 });
            return (
              <li key={c.rowId} className="rounded-xl border border-line bg-surface-2/50 px-3 pt-1.5 pb-3">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-ink">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-surface text-xs tabular-nums text-muted">{i + 1}</span>
                    {c.key ? (
                      <span dir="ltr" className="truncate font-mono text-xs text-muted" title={t('criteria.keyHint')}>
                        {c.key}
                      </span>
                    ) : (
                      <span className="text-xs text-muted">{t('criteria.new')}</span>
                    )}
                  </span>
                  <span className="flex shrink-0 items-center">
                    <IconButton icon={ArrowUp} size="sm" label={t('criteria.moveUp', { name })} disabled={i === 0} onClick={() => move(i, -1)} className="disabled:opacity-30" />
                    <IconButton
                      icon={ArrowDown}
                      size="sm"
                      label={t('criteria.moveDown', { name })}
                      disabled={i === value.length - 1}
                      onClick={() => move(i, 1)}
                      className="disabled:opacity-30"
                    />
                    <IconButton icon={Trash2} size="sm" variant="danger-ghost" label={t('criteria.remove', { name })} onClick={() => onChange(value.filter((_, j) => j !== i))} />
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:gap-3">
                  <TextField
                    label={t('criteria.label')}
                    required
                    dir="ltr"
                    lang="en"
                    autoComplete="off"
                    value={c.label}
                    onChange={(e) => set(i, { label: e.target.value })}
                    aria-invalid={error(`interviewCriteria.${i}.label`) ? true : undefined}
                    error={error(`interviewCriteria.${i}.label`) ?? error(`interviewCriteria.${i}.key`)}
                  />
                  <TextField
                    label={t('criteria.labelAr')}
                    dir="rtl"
                    lang="ar"
                    autoComplete="off"
                    value={c.labelAr}
                    onChange={(e) => set(i, { labelAr: e.target.value })}
                    aria-invalid={error(`interviewCriteria.${i}.labelAr`) ? true : undefined}
                    error={error(`interviewCriteria.${i}.labelAr`)}
                  />
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="rounded-xl border border-dashed border-line-strong px-4 py-3 text-sm text-muted">{t('criteria.empty')}</p>
      )}
      <div>
        <Button icon={Plus} onClick={add} disabled={value.length >= MAX_INTERVIEW_CRITERIA}>
          {t('criteria.add')}
        </Button>
      </div>
    </div>
  );
}
