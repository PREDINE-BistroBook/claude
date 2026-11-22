import { CalendarClock, MapPin, Pencil, Trash2, UserPlus, UserRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { SUBMISSION_STATUSES } from '@shared/enums';
import type { CastingRole, Submission } from '@shared/schemas/castings';
import { Avatar, Badge, Button, Card, IconButton, StatusBadge } from '@web/components/ui';
import { displayName, fullName, useFormat } from '@web/lib/format';
import { SUBMISSION_TONES, roleHasRequirements } from '../utils';
import { BidiText, RoleRequirementChips } from './bits';

interface Props {
  role: CastingRole;
  canWrite: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onAddTalent: () => void;
  onOpenSubmission: (s: Submission) => void;
}

/** One role of a casting: what it asks for, where its submissions stand, and the talent on it. */
export function RoleCard({ role, canWrite, onEdit, onDelete, onAddTalent, onOpenSubmission }: Props) {
  const { t } = useTranslation(['castings', 'common']);
  const counts = new Map<string, number>();
  for (const s of role.submissions) counts.set(s.status, (counts.get(s.status) ?? 0) + 1);
  const hasText = !!(role.description || role.requirements);

  return (
    <Card
      padded={false}
      title={<bdi>{role.name}</bdi>}
      description={roleHasRequirements(role) ? <RoleRequirementChips role={role} className="mt-1.5" /> : undefined}
      actions={
        canWrite && (
          <>
            <IconButton icon={Pencil} label={t('roles.editRole', { name: role.name })} onClick={onEdit} />
            <IconButton icon={Trash2} variant="danger-ghost" label={t('roles.deleteRole', { name: role.name })} onClick={onDelete} />
          </>
        )
      }
    >
      {(hasText || role.submissions.length > 0) && (
        <div className="grid grid-cols-1 gap-3 px-4 py-3 sm:px-5">
          {role.description && (
            <p dir="auto" className="text-start text-sm leading-relaxed whitespace-pre-line break-words text-ink">
              {role.description}
            </p>
          )}
          {role.requirements && (
            <div className="text-sm">
              <span className="text-xs font-medium tracking-wide text-muted uppercase">{t('roles.requirements')}</span>
              <p dir="auto" className="mt-0.5 text-start leading-relaxed whitespace-pre-line break-words text-ink">
                {role.requirements}
              </p>
            </div>
          )}
          {role.submissions.length > 0 && (
            <ul className="flex flex-wrap gap-1.5" aria-label={t('roles.statusSummary')}>
              {SUBMISSION_STATUSES.filter((s) => counts.has(s)).map((s) => (
                <li key={s}>
                  <Badge tone={SUBMISSION_TONES[s]}>
                    {t(`common:enums.submissionStatus.${s}`)}
                    <span className="font-semibold tabular-nums">{counts.get(s)}</span>
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {role.submissions.length > 0 ? (
        <ul className="divide-y divide-line border-t border-line">
          {role.submissions.map((s) => (
            <SubmissionRow key={s.id} submission={s} onOpen={canWrite ? () => onOpenSubmission(s) : undefined} />
          ))}
        </ul>
      ) : (
        <p className="border-t border-line px-4 py-4 text-sm text-muted sm:px-5">{t('roles.noSubmissions')}</p>
      )}

      {canWrite && (
        <div className="border-t border-line px-4 py-2.5 sm:px-5">
          <Button variant="ghost" icon={UserPlus} onClick={onAddTalent} className="-mx-2 max-sm:w-full max-sm:justify-center">
            {t('roles.addTalent')}
          </Button>
        </div>
      )}
    </Card>
  );
}

function SubmissionRow({ submission: s, onOpen }: { submission: Submission; onOpen?: () => void }) {
  const { t } = useTranslation(['castings', 'common']);
  const f = useFormat();
  const name = displayName(s.talent);
  const realName = fullName(s.talent);

  const main = (
    <>
      <Avatar name={name} fileId={s.talent.headshotFileId} size="md" shape="rounded" />
      <span className="min-w-0 flex-1">
        <BidiText className="font-medium text-ink">{name}</BidiText>
        {s.auditionAt ? (
          <span className="mt-0.5 flex min-w-0 items-center gap-1 text-sm text-muted">
            <CalendarClock className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">
              {/* Compact date on phones so the time stays visible; the place shows from sm up (and in the dialog). */}
              <span className="sm:hidden">{f.dateTime(s.auditionAt, 'short')}</span>
              <span className="max-sm:hidden">{f.dateTime(s.auditionAt)}</span>
              {s.auditionLocation && (
                <span className="max-sm:hidden">
                  <span aria-hidden> · </span>
                  <bdi>{s.auditionLocation}</bdi>
                </span>
              )}
            </span>
          </span>
        ) : s.auditionLocation ? (
          <span className="mt-0.5 flex min-w-0 items-center gap-1 text-sm text-muted">
            <MapPin className="size-3.5 shrink-0" aria-hidden />
            <bdi className="truncate">{s.auditionLocation}</bdi>
          </span>
        ) : name !== realName ? (
          <BidiText className="mt-0.5 text-sm text-muted">{realName}</BidiText>
        ) : null}
      </span>
      <StatusBadge group="submissionStatus" value={s.status} />
    </>
  );

  return (
    <li className="flex items-center gap-1 pe-2 sm:pe-3">
      {onOpen ? (
        <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 py-2.5 ps-4 pe-2 text-start transition-colors hover:bg-surface-2 sm:ps-5">
          {main}
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-3 py-2.5 ps-4 pe-2 sm:ps-5">{main}</div>
      )}
      <Link
        to={`/talent/${s.talentId}`}
        aria-label={t('submission.openProfile', { name })}
        title={t('submission.openProfile', { name })}
        className="flex size-10 shrink-0 items-center justify-center rounded-xl text-muted transition-colors hover:bg-surface-2 hover:text-ink"
      >
        <UserRound className="size-5" aria-hidden />
      </Link>
    </li>
  );
}
