import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GENDERS, type Gender } from '@shared/enums';
import { Button, EnumSelect, Field, Input, Modal } from '@web/components/ui';
import { useTalentTags } from '../api';

export interface ExtraFilters {
  gender?: Gender;
  age?: number;
  skill?: string;
  language?: string;
}

interface Draft extends Record<string, string> {
  gender: string;
  age: string;
  skill: string;
  language: string;
}

const toDraft = (f: ExtraFilters): Draft => ({
  gender: f.gender ?? '',
  age: f.age !== undefined ? String(f.age) : '',
  skill: f.skill ?? '',
  language: f.language ?? '',
});

/** Gender, age, skill and language filters. A sheet on phones, a dialog on desktop. */
export function FiltersModal({
  open,
  value,
  onApply,
  onClose,
}: {
  open: boolean;
  value: ExtraFilters;
  onApply: (filters: ExtraFilters) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation(['talent', 'common']);
  const tags = useTalentTags();
  const [draft, setDraft] = useState<Draft>(() => toDraft(value));
  const [ageError, setAgeError] = useState<string | null>(null);
  const formId = useId();
  const skillsListId = useId();
  const languagesListId = useId();

  // Start from what's applied each time the sheet opens.
  useEffect(() => {
    if (open) {
      setDraft(toDraft(value));
      setAgeError(null);
    }
  }, [open]);

  const set = (key: keyof Draft, v: string) => {
    setDraft((d) => ({ ...d, [key]: v }));
    if (key === 'age') setAgeError(null);
  };

  const apply = () => {
    const ageText = draft.age.trim();
    let age: number | undefined;
    if (ageText) {
      const n = Number(ageText);
      if (!Number.isInteger(n) || n < 0 || n > 120) {
        setAgeError('common:errors.invalidNumber');
        return;
      }
      age = n;
    }
    onApply({
      gender: (GENDERS as readonly string[]).includes(draft.gender) ? (draft.gender as Gender) : undefined,
      age,
      skill: draft.skill.trim() || undefined,
      language: draft.language.trim() || undefined,
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('list.filtersTitle')}
      description={t('list.filtersDescription')}
      footer={
        <>
          <Button variant="ghost" onClick={() => setDraft({ gender: '', age: '', skill: '', language: '' })} className="me-auto">
            {t('list.reset')}
          </Button>
          <Button onClick={onClose}>{t('common:actions.cancel')}</Button>
          <Button type="submit" form={formId} variant="primary">
            {t('list.apply')}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          apply();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('common:fields.gender')} htmlFor="tf-gender">
            <EnumSelect
              id="tf-gender"
              group="gender"
              values={GENDERS}
              allowEmpty
              emptyLabel={t('list.anyGender')}
              value={draft.gender}
              onChange={(e) => set('gender', e.target.value)}
            />
          </Field>
          <Field label={t('list.age')} htmlFor="tf-age" error={ageError}>
            <Input
              id="tf-age"
              type="number"
              inputMode="numeric"
              min={0}
              max={120}
              step={1}
              placeholder={t('list.agePlaceholder')}
              value={draft.age}
              aria-invalid={ageError ? true : undefined}
              onChange={(e) => set('age', e.target.value)}
            />
          </Field>
        </div>
        <p className="-mt-2 text-xs text-muted">{t('list.ageHint')}</p>
        <Field label={t('list.skill')} htmlFor="tf-skill">
          <Input
            id="tf-skill"
            list={skillsListId}
            autoComplete="off"
            dir="auto"
            placeholder={t('list.skillPlaceholder')}
            value={draft.skill}
            onChange={(e) => set('skill', e.target.value)}
          />
          <datalist id={skillsListId}>
            {(tags.data?.skills ?? []).map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </Field>
        <Field label={t('list.language')} htmlFor="tf-language">
          <Input
            id="tf-language"
            list={languagesListId}
            autoComplete="off"
            dir="auto"
            placeholder={t('list.languagePlaceholder')}
            value={draft.language}
            onChange={(e) => set('language', e.target.value)}
          />
          <datalist id={languagesListId}>
            {(tags.data?.languages ?? []).map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </Field>
      </form>
    </Modal>
  );
}
