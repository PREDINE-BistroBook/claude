import clsx from 'clsx';
import { GraduationCap, Plus, SearchX, Users } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { STUDENT_STATUSES, type StudentStatus } from '@shared/enums';
import type { StudentListItem } from '@shared/schemas/students';
import {
  Avatar,
  Button,
  ButtonLink,
  EmptyState,
  ErrorState,
  List,
  ListRow,
  PageHeader,
  PageLoader,
  SearchInput,
  Segmented,
  StatusBadge,
} from '@web/components/ui';
import { useAuth } from '@web/lib/auth';
import { ageOn, fullName } from '@web/lib/format';
import { useDebounced } from '@web/lib/hooks';
import { useStudents } from './api';
import { BidiText } from '@web/components/ui';

type StatusFilter = StudentStatus | 'all';

const isStatus = (v: string | null): v is StudentStatus => !!v && (STUDENT_STATUSES as readonly string[]).includes(v);

export default function StudentsPage() {
  const { t } = useTranslation(['students', 'common']);
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const statusParam = params.get('status');
  const status = isStatus(statusParam) ? statusParam : undefined;

  // The box updates instantly; the URL (and so the query) follows after a pause in typing.
  const [text, setText] = useState(q);
  const debounced = useDebounced(text.trim(), 300);
  const pushed = useRef(q);

  useEffect(() => {
    if (debounced === pushed.current) return;
    pushed.current = debounced;
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (debounced) next.set('q', debounced);
        else next.delete('q');
        return next;
      },
      { replace: true },
    );
  }, [debounced, setParams]);

  // Back/forward (or a link) changed ?q= — reflect it in the box.
  useEffect(() => {
    if (q !== pushed.current) {
      pushed.current = q;
      setText(q);
    }
  }, [q]);

  const setStatus = (value: StatusFilter) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value === 'all') next.delete('status');
        else next.set('status', value);
        return next;
      },
      { replace: true },
    );

  const clearFilters = () => {
    pushed.current = '';
    setText('');
    setParams({}, { replace: true });
  };

  const students = useStudents({ q: q || undefined, status });
  const items = students.data?.items ?? [];
  const filtered = !!q || !!status;
  const canWrite = can('students.write');

  const newButton = canWrite ? (
    <ButtonLink to="/students/new" variant="primary" icon={Plus}>
      {t('newStudent')}
    </ButtonLink>
  ) : null;

  let body;
  if (students.isPending) body = <PageLoader />;
  else if (students.isError) body = <ErrorState error={students.error} onRetry={() => void students.refetch()} />;
  else if (!items.length && !filtered)
    body = (
      <EmptyState
        icon={Users}
        title={t('list.emptyTitle')}
        description={canWrite ? t('list.emptyHint') : t('list.emptyHintReadOnly')}
        action={newButton}
        className="rounded-2xl border border-dashed border-line-strong"
      />
    );
  else if (!items.length)
    body = (
      <EmptyState
        icon={SearchX}
        title={t('common:states.noResults')}
        description={t('common:states.noResultsHint')}
        action={<Button onClick={clearFilters}>{t('list.clearFilters')}</Button>}
      />
    );
  else
    body = (
      <>
        <p className="mb-2 px-1 text-sm text-muted" aria-live="polite">
          {t('list.count', { count: items.length })}
        </p>
        <List className={clsx('transition-opacity', students.isPlaceholderData && 'opacity-60')}>
          {items.map((s) => (
            <StudentRow key={s.id} student={s} />
          ))}
        </List>
      </>
    );

  return (
    <div>
      <PageHeader title={t('title')} actions={newButton} />
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <SearchInput value={text} onChange={setText} placeholder={t(can('students.contact') ? 'list.searchPlaceholder' : 'list.searchNamePlaceholder')} className="w-full md:max-w-sm" />
        <Segmented<StatusFilter>
          label={t('list.statusFilter')}
          value={status ?? 'all'}
          onChange={setStatus}
          options={[
            { value: 'all', label: t('list.all') },
            ...STUDENT_STATUSES.map((s) => ({ value: s, label: t(`common:enums.studentStatus.${s}`) })),
          ]}
          className="self-start"
        />
      </div>
      {body}
    </div>
  );
}

function StudentRow({ student: s }: { student: StudentListItem }) {
  const { t } = useTranslation(['students', 'common']);
  // A second guard behind the API's redaction: never show contacts the signed-in person's positions hide.
  const showContact = useAuth().can('students.contact') && !s.contactHidden;
  const name = fullName(s);
  const age = ageOn(s.dateOfBirth);
  // Age keeps its place; a long phone/email (last) is cut at its own end ("+20 101 23…"), not its start.
  const details: ReactNode[] = [];
  if (age !== null)
    details.push(
      <span key="age" className="shrink-0">
        {t('common:units.years', { count: age })}
      </span>,
    );
  const contact = showContact ? (s.phone ?? (age === null ? s.email : null)) : null;
  if (contact)
    details.push(
      <span key="contact" dir="ltr" className="min-w-0 truncate">
        {contact}
      </span>,
    );
  const classes = t('list.classes', { count: s.activeEnrollments });

  return (
    <ListRow
      to={`/students/${s.id}`}
      leading={<Avatar name={name} fileId={s.photoFileId} />}
      title={<BidiText>{name}</BidiText>}
      subtitle={
        details.length ? (
          <span className="flex min-w-0 items-center">
            {details.flatMap((d, i) =>
              i === 0
                ? [d]
                : [
                    <span key={`sep${i}`} aria-hidden className="shrink-0 whitespace-pre">
                      {' · '}
                    </span>,
                    d,
                  ],
            )}
          </span>
        ) : undefined
      }
      trailing={
        <>
          <span className="hidden text-sm text-muted sm:inline">{classes}</span>
          {s.activeEnrollments > 0 && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-muted tabular-nums sm:hidden">
              <GraduationCap className="size-3.5" aria-hidden />
              <span aria-hidden>{s.activeEnrollments}</span>
              <span className="sr-only">{classes}</span>
            </span>
          )}
          <StatusBadge group="studentStatus" value={s.status} />
        </>
      }
    />
  );
}
