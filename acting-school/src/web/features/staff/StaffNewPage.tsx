import { useTranslation } from 'react-i18next';
import { PageHeader } from '@web/components/ui';
import { BackLink } from '../website/components/BackLink';
import { AddStaffForm } from './components/StaffForms';

/** /staff/new (staff.manage) — add a team member. Reached from "Add team member" on the Team page, and goes back there. */
export default function StaffNewPage() {
  const { t } = useTranslation(['staff', 'team', 'common']);
  return (
    <div className="mx-auto max-w-3xl">
      <BackLink to="/team">{t('team:title')}</BackLink>
      <PageHeader title={t('form.addTitle')} subtitle={t('form.addDescription')} />
      <AddStaffForm />
    </div>
  );
}
