import { X } from 'lucide-react';
import { useId, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Free-form tags (skills, languages). Enter or comma adds; Backspace on an
 * empty input removes the last one. `suggestions` feed a native datalist.
 */
export function TagInput({
  value,
  onChange,
  suggestions = [],
  placeholder,
  id,
  max = 50,
}: {
  value: string[];
  onChange: (tags: string[]) => void;
  suggestions?: string[];
  placeholder?: string;
  id?: string;
  max?: number;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');
  const listId = useId();

  const add = (raw: string) => {
    const tag = raw.trim().replace(/,$/, '').trim();
    if (!tag || value.length >= max) return;
    if (value.some((v) => v.toLowerCase() === tag.toLowerCase())) return;
    onChange([...value, tag.slice(0, 60)]);
    setDraft('');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === '،') {
      e.preventDefault();
      add(draft);
    } else if (e.key === 'Backspace' && !draft && value.length) {
      onChange(value.slice(0, -1));
    }
  };

  return (
    <div className="flex min-h-11 flex-wrap items-center gap-1.5 rounded-xl border border-line-strong bg-surface px-2 py-1.5 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/25 sm:min-h-10">
      {value.map((tag) => (
        <span key={tag} className="inline-flex items-center gap-1 rounded-lg bg-surface-2 py-1 ps-2.5 pe-1 text-sm text-ink">
          {tag}
          <button
            type="button"
            onClick={() => onChange(value.filter((v) => v !== tag))}
            className="rounded p-0.5 text-muted hover:bg-line hover:text-ink"
            aria-label={`${t('common:actions.remove')} ${tag}`}
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </span>
      ))}
      <input
        id={id}
        value={draft}
        list={suggestions.length ? listId : undefined}
        onChange={(e) => {
          const v = e.target.value;
          // Picking from the datalist fires a change with the full value.
          if (suggestions.includes(v)) add(v);
          else setDraft(v);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => draft && add(draft)}
        placeholder={value.length ? '' : placeholder}
        className="h-8 w-0 min-w-[8rem] flex-1 bg-transparent px-1 text-base text-ink placeholder:text-muted focus:outline-none sm:text-sm"
      />
      {suggestions.length > 0 && (
        <datalist id={listId}>
          {suggestions
            .filter((s) => !value.includes(s))
            .map((s) => (
              <option key={s} value={s} />
            ))}
        </datalist>
      )}
    </div>
  );
}
