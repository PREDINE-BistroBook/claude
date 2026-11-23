import { useTranslation } from 'react-i18next';
import { Badge, type Tone } from './Badge';

/**
 * Coloured, translated badge for any enum value. One mapping for the whole app
 * so "active" is the same green everywhere.
 *   <StatusBadge group="studentStatus" value={s.status} />
 */
export const STATUS_TONES = {
  studentStatus: { prospect: 'info', active: 'success', paused: 'warning', alumni: 'neutral' },
  courseStatus: { active: 'success', archived: 'neutral' },
  enrollmentStatus: { enrolled: 'success', withdrawn: 'neutral', completed: 'info' },
  sessionStatus: { scheduled: 'neutral', cancelled: 'danger' },
  attendanceStatus: { present: 'success', late: 'warning', absent: 'danger', excused: 'info' },
  talentStatus: { active: 'success', on_hold: 'warning', former: 'neutral' },
  castingStatus: { open: 'success', closed: 'neutral', cancelled: 'danger' },
  submissionStatus: {
    shortlisted: 'neutral',
    submitted: 'info',
    audition: 'warning',
    callback: 'accent',
    booked: 'success',
    rejected: 'neutral',
    withdrawn: 'neutral',
  },
  // Admissions: open statuses that need someone to act are coloured; closed ones are quiet.
  leadStatus: {
    new: 'accent',
    contacted: 'info',
    interview_scheduled: 'warning',
    interviewed: 'warning',
    accepted: 'success',
    enrolled: 'success',
    declined: 'neutral',
    lost: 'neutral',
  },
  interviewStatus: { scheduled: 'info', done: 'success', no_show: 'danger', cancelled: 'neutral' },
  interviewRecommendation: { accept: 'success', maybe: 'warning', decline: 'danger' },
  // Casting applications from the website: new ones need someone, so they stand out.
  castingApplicationStatus: { new: 'accent', reviewing: 'warning', accepted: 'success', declined: 'neutral' },
} as const satisfies Record<string, Record<string, Tone>>;

export type StatusGroup = keyof typeof STATUS_TONES;

export function StatusBadge<G extends StatusGroup>({ group, value, className }: { group: G; value: keyof (typeof STATUS_TONES)[G] & string; className?: string }) {
  const { t } = useTranslation();
  const tone = (STATUS_TONES[group] as Record<string, Tone>)[value] ?? 'neutral';
  const key: string = `common:enums.${group}.${value}`;
  return (
    <Badge tone={tone} className={className}>
      {t(key)}
    </Badge>
  );
}
