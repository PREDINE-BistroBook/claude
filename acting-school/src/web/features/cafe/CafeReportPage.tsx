import clsx from 'clsx';
import { CalendarDays, ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { shiftCafeMonth, type CafeReport, type CafeReportLine } from '@shared/schemas/cafe';
import { Avatar, Button, Card, EmptyState, ErrorState, PageHeader, PageLoader } from '@web/components/ui';
import { useFormat } from '@web/lib/format';
import { useCafeReport } from './api';
import { CafeGate, CafeTabs, WRAP_ANYWHERE, useCafeNames } from './components/CafeParts';

/**
 * /cafeteria/report — the monthly consumption page (cafeteria.report: the
 * owners). A month picker (it opens on the current month at the school), then
 * everyone who had something delivered that month — photo, name, how many
 * orders, and each item with how many — and the total of each item. Delivered
 * orders only; someone no longer on the team is still listed for the months
 * they ordered in. No prices.
 */
export default function CafeReportPage() {
  const { t } = useTranslation(['cafe']);
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={t('report.title')} subtitle={t('report.subtitle')} />
      <CafeGate>
        <CafeTabs />
        <Report />
      </CafeGate>
    </div>
  );
}

function Report() {
  const { t } = useTranslation(['cafe']);
  // null: the current month at the school — the server says which, so the browser's own clock doesn't decide.
  const [month, setMonth] = useState<string | null>(null);
  const report = useCafeReport(month);

  if (report.isPending) return <PageLoader />;
  if (report.isError || !report.data) return <ErrorState error={report.error} onRetry={() => void report.refetch()} />;
  const data = report.data;

  return (
    <div className={clsx('space-y-6 transition-opacity', report.isPlaceholderData && 'opacity-60')} aria-busy={report.isPlaceholderData || undefined}>
      <MonthPicker report={data} onPick={setMonth} />
      {data.people.length === 0 ? (
        <EmptyState icon={CalendarDays} title={t('report.empty')} description={t('report.emptyHint')} className="rounded-2xl border border-dashed border-line-strong" />
      ) : (
        <>
          <People report={data} />
          <Totals lines={data.totals} />
        </>
      )}
    </div>
  );
}

/** The month in large words, with "Previous month" / "Next month" under it (no further than the current month). */
function MonthPicker({ report, onPick }: { report: CafeReport; onPick: (month: string) => void }) {
  const { t } = useTranslation(['cafe']);
  const f = useFormat();
  const atCurrent = report.month >= report.currentMonth;
  return (
    <section aria-labelledby="cafe-report-month" className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
      <h2 id="cafe-report-month" className="flex items-center gap-2 text-xl font-bold text-ink" aria-live="polite">
        <CalendarDays className="size-6 shrink-0 text-muted" aria-hidden />
        {f.date(`${report.month}-01`, 'monthYear')}
      </h2>
      <p className="mt-1 text-sm text-muted">{t('report.ordersDelivered', { count: report.orders })}</p>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Button size="lg" icon={ChevronLeft} className="w-full px-3 [&_svg]:rtl:-scale-x-100" onClick={() => onPick(shiftCafeMonth(report.month, -1))}>
          {t('report.previous')}
        </Button>
        <Button size="lg" icon={ChevronRight} iconEnd className="w-full px-3 [&_svg]:rtl:-scale-x-100" disabled={atCurrent} onClick={() => onPick(shiftCafeMonth(report.month, 1))}>
          {t('report.next')}
        </Button>
      </div>
      {report.month < report.currentMonth && (
        <Button size="lg" variant="ghost" icon={RotateCcw} className="mt-2 w-full text-accent" onClick={() => onPick(report.currentMonth)}>
          {t('report.thisMonth')}
        </Button>
      )}
    </section>
  );
}

/** Everyone who had something delivered that month, by name: photo, name, orders, then each item and how many. */
function People({ report }: { report: CafeReport }) {
  const { t } = useTranslation(['cafe']);
  return (
    <section aria-labelledby="cafe-report-people">
      <h2 id="cafe-report-people" className="mb-3 text-lg font-semibold text-ink">
        {t('report.people')}
      </h2>
      <ul className="grid gap-3">
        {report.people.map(({ person, orders, items }) => (
          <li key={person.id} className={clsx('rounded-2xl border border-line bg-surface p-4 sm:p-5', WRAP_ANYWHERE)}>
            <div className="flex items-center gap-3">
              <Avatar name={person.name} fileId={person.photoFileId} size="md" />
              <div className="min-w-0 flex-1">
                <p className="text-base font-bold leading-tight text-ink">
                  <bdi>{person.name}</bdi>
                </p>
                <p className="text-sm text-muted">
                  {t('report.orders', { count: orders })}
                  {!person.active && <span className="font-medium text-danger"> · {t('board.left')}</span>}
                </p>
              </div>
            </div>
            <Lines lines={items} className="mt-3" />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The total of each item, everyone together. */
function Totals({ lines }: { lines: CafeReportLine[] }) {
  const { t } = useTranslation(['cafe']);
  return (
    <Card title={t('report.totals')}>
      <Lines lines={lines} />
    </Card>
  );
}

/** "Tea … 12": the item's name in the screen's language and how many, one per row. */
function Lines({ lines, className }: { lines: CafeReportLine[]; className?: string }) {
  const { itemName } = useCafeNames();
  const f = useFormat();
  return (
    <ul className={clsx('divide-y divide-line rounded-xl bg-surface-2 px-3', className)}>
      {lines.map((line) => (
        <li key={`${line.itemId ?? 'gone'}-${line.nameEn}-${line.nameAr}`} className={clsx('flex min-h-11 items-center justify-between gap-3 py-2 text-base', WRAP_ANYWHERE)}>
          <span className="min-w-0 text-ink">
            <bdi>{itemName(line)}</bdi>
          </span>
          <span className="shrink-0 text-lg font-bold tabular-nums text-ink">{f.number(line.qty)}</span>
        </li>
      ))}
    </ul>
  );
}
