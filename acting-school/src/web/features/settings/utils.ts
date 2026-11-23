import { CRITERION_KEY_RE, type InterviewCriterion } from '@shared/schemas/settings';
import type { CriterionDraft } from './CriteriaEditor';

/**
 * A stable key for a new interview criterion from its English label:
 * "Voice & diction" → "voice_diction". Falls back to "criterion" (e.g. for an
 * Arabic-only label) and adds _2, _3… until it's unused.
 */
export function criterionKey(label: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  let base = label
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^[^a-z]+/, '')
    .replace(/_+$/, '')
    .slice(0, 32)
    .replace(/_+$/, '');
  if (!CRITERION_KEY_RE.test(base)) base = 'criterion';
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const key = `${base}_${n}`;
    if (!used.has(key)) return key;
  }
}

/** Saved criteria → rows for the editor. */
export function toDrafts(criteria: readonly InterviewCriterion[]): CriterionDraft[] {
  return criteria.map((c) => ({ rowId: c.key, key: c.key, label: c.label, labelAr: c.labelAr ?? '' }));
}

/**
 * Editor rows → the list to save, in order. Saved criteria keep their key (so
 * stored scores stay attached when renamed); new ones get one from their label.
 */
export function fromDrafts(drafts: readonly CriterionDraft[]): InterviewCriterion[] {
  const taken = new Set(drafts.map((d) => d.key).filter(Boolean));
  return drafts.map((d) => {
    let key = d.key;
    if (!key) {
      key = criterionKey(d.label, taken);
      taken.add(key);
    }
    return { key, label: d.label.trim(), labelAr: d.labelAr.trim() || null };
  });
}
