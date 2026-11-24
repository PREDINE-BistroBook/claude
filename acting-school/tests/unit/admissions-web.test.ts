import { describe, expect, it } from 'vitest';
import type { Interview } from '../../src/shared/schemas/admissions';
import {
  canReopen,
  canScheduleInterview,
  criteriaFor,
  criterionLabel,
  followUpChoices,
  followUpTone,
  latestDoneInterview,
  manualStatusOptions,
  nextScheduledInterview,
  parseSource,
  parseTab,
  statusAfterInterviewEnds,
  statusAfterScheduling,
  suggestedTemplate,
  tabFilter,
} from '../../src/web/features/admissions/utils';
import { criterionKey, fromDrafts, toDrafts } from '../../src/web/features/settings/utils';

const iv = (id: number, scheduledAt: string, status: Interview['status']): Interview =>
  ({ id, scheduledAt, status, scores: {} }) as unknown as Interview;

describe('admissions list tabs', () => {
  it('unknown or missing ?tab= falls back to follow-ups due', () => {
    expect(parseTab(null)).toBe('follow_up');
    expect(parseTab('bogus')).toBe('follow_up');
    expect(parseTab('closed')).toBe('closed');
  });
  it('each tab asks the API for the right group or status', () => {
    expect(tabFilter('follow_up')).toEqual({ group: 'follow_up_due' });
    expect(tabFilter('new')).toEqual({ status: 'new' });
    expect(tabFilter('interviews')).toEqual({ group: 'interviews' });
    expect(tabFilter('open')).toEqual({ group: 'open' });
    expect(tabFilter('closed')).toEqual({ group: 'closed' });
  });
  it('source filter accepts only known sources', () => {
    expect(parseSource('instagram')).toBe('instagram');
    expect(parseSource('myspace')).toBeUndefined();
  });
});

describe('manual status options mirror the server', () => {
  it('never offers enrolled (only through Enrol) nor the current status', () => {
    const opts = manualStatusOptions('contacted', true);
    expect(opts).not.toContain('enrolled');
    expect(opts).not.toContain('contacted');
    expect(opts).toContain('lost');
  });
  it('accepted / declined only with admissions.decide', () => {
    expect(manualStatusOptions('interviewed', false)).not.toContain('accepted');
    expect(manualStatusOptions('interviewed', false)).not.toContain('declined');
    expect(manualStatusOptions('interviewed', true)).toEqual(expect.arrayContaining(['accepted', 'declined']));
  });
  it('an enrolled lead’s status is final', () => {
    expect(manualStatusOptions('enrolled', true)).toEqual([]);
  });
  it('reopen only lost/declined; interviews only on open leads', () => {
    expect(canReopen('lost')).toBe(true);
    expect(canReopen('declined')).toBe(true);
    expect(canReopen('enrolled')).toBe(false);
    expect(canScheduleInterview('accepted')).toBe(true);
    expect(canScheduleInterview('lost')).toBe(false);
    expect(canScheduleInterview('enrolled')).toBe(false);
  });
});

describe('follow-ups', () => {
  it('quick choices: tomorrow, in 3 days, next week', () => {
    expect(followUpChoices('2026-11-30').map((c) => c.date)).toEqual(['2026-12-01', '2026-12-03', '2026-12-07']);
  });
  it('overdue is danger, today warning, later neutral', () => {
    expect(followUpTone('2026-11-20', '2026-11-23')).toBe('danger');
    expect(followUpTone('2026-11-23', '2026-11-23')).toBe('warning');
    expect(followUpTone('2026-11-24', '2026-11-23')).toBe('neutral');
  });
});

describe('interviews', () => {
  const list = [iv(1, '2026-11-20T10:00', 'done'), iv(2, '2026-11-26T10:00', 'scheduled'), iv(3, '2026-11-24T09:00', 'scheduled'), iv(4, '2026-11-22T10:00', 'done')];
  it('next scheduled = the soonest still scheduled; latest done = the most recent done', () => {
    expect(nextScheduledInterview(list)?.id).toBe(3);
    expect(latestDoneInterview(list)?.id).toBe(4);
    expect(nextScheduledInterview([])).toBeNull();
  });
  it('scores of a removed criterion are kept and shown with their key', () => {
    const rows = criteriaFor([{ key: 'voice', label: 'Voice', labelAr: 'الصوت' }], { voice: 4, mime: 3 });
    expect(rows.map((r) => [r.key, r.removed])).toEqual([
      ['voice', false],
      ['mime', true],
    ]);
  });
  it('criterion labels: Arabic when set, else English', () => {
    expect(criterionLabel({ label: 'Voice', labelAr: 'الصوت' }, 'ar')).toBe('الصوت');
    expect(criterionLabel({ label: 'Voice', labelAr: null }, 'ar')).toBe('Voice');
    expect(criterionLabel({ label: 'Voice', labelAr: 'الصوت' }, 'en')).toBe('Voice');
  });
  it('scheduling an interview moves new/contacted/interviewed leads to interview_scheduled; an accepted lead keeps its decision', () => {
    expect(statusAfterScheduling('new')).toBe('interview_scheduled');
    expect(statusAfterScheduling('contacted')).toBe('interview_scheduled');
    expect(statusAfterScheduling('interviewed')).toBe('interview_scheduled');
    expect(statusAfterScheduling('interview_scheduled')).toBe('interview_scheduled');
    expect(statusAfterScheduling('accepted')).toBe('accepted');
  });
  it('cancelling / missing the last scheduled interview: back to interviewed after an assessment, else contacted (as the server)', () => {
    // First interview only → contacted.
    expect(statusAfterInterviewEnds({ status: 'interview_scheduled', interviews: [iv(1, '2026-11-26T10:00', 'scheduled')] }, 1)).toBe('contacted');
    // A callback after a done interview → interviewed, not contacted.
    expect(
      statusAfterInterviewEnds({ status: 'interview_scheduled', interviews: [iv(1, '2026-11-20T10:00', 'done'), iv(2, '2026-11-26T10:00', 'scheduled')] }, 2),
    ).toBe('interviewed');
    // Another interview still scheduled → stays.
    expect(
      statusAfterInterviewEnds({ status: 'interview_scheduled', interviews: [iv(1, '2026-11-26T10:00', 'scheduled'), iv(2, '2026-11-27T10:00', 'scheduled')] }, 1),
    ).toBe('interview_scheduled');
    // An accepted lead keeps its decision.
    expect(statusAfterInterviewEnds({ status: 'accepted', interviews: [iv(1, '2026-11-26T10:00', 'scheduled')] }, 1)).toBe('accepted');
  });
  it('suggested WhatsApp message follows the stage', () => {
    expect(suggestedTemplate('new', false)).toBe('first_reply');
    expect(suggestedTemplate('contacted', false)).toBe('follow_up');
    expect(suggestedTemplate('interview_scheduled', true)).toBe('interview_invite');
    expect(suggestedTemplate('accepted', true)).toBe('accepted');
  });
});

describe('interview criteria keys (settings)', () => {
  it('slugs the English label', () => {
    expect(criterionKey('Voice & diction', [])).toBe('voice_diction');
    expect(criterionKey('  Émotion 2 ', [])).toBe('emotion_2');
  });
  it('falls back for labels without Latin letters and never reuses a key', () => {
    expect(criterionKey('الارتجال', [])).toBe('criterion');
    expect(criterionKey('Voice', ['voice', 'voice_2'])).toBe('voice_3');
  });
  it('renaming keeps the key; new rows get unique keys', () => {
    const drafts = toDrafts([{ key: 'voice', label: 'Voice', labelAr: null }]);
    drafts[0]!.label = 'Voice and speech';
    drafts.push({ rowId: 'n1', key: '', label: 'Voice', labelAr: ' ' }, { rowId: 'n2', key: '', label: 'Voice', labelAr: 'الصوت' });
    expect(fromDrafts(drafts)).toEqual([
      { key: 'voice', label: 'Voice and speech', labelAr: null },
      { key: 'voice_2', label: 'Voice', labelAr: null },
      { key: 'voice_3', label: 'Voice', labelAr: 'الصوت' },
    ]);
  });
});
