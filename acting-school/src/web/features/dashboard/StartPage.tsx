import { Lock, UserRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router';
import { ButtonLink, EmptyState, PageHeader } from '@web/components/ui';
import { adminNavItems } from '@web/layout/nav';
import { rememberedSection, sectionByKey, startSection, visibleSections } from '@web/layout/sections';
import { useAuth } from '@web/lib/auth';
import { firstName, greetingFor } from './utils';

/**
 * "/": straight to the home of the section the person was last in (if they can
 * still see it), otherwise their default section (sections.ts defaultSection:
 * the first one — Casting for someone whose School is only the student list). Someone who sees no section
 * gets a small home: greeting, a "nothing assigned yet" note, their profile
 * and whatever administration pages they may open.
 */
export default function StartPage() {
  const { t } = useTranslation(['dashboard', 'common']);
  const { user, can } = useAuth();
  const visible = visibleSections(can);
  const start = startSection(visible, can, rememberedSection(user?.id ?? null));
  if (start) return <Navigate to={sectionByKey(start).home} replace />;

  const admin = adminNavItems(can);
  const nothingAtAll = !user?.permissions.length;
  return (
    <div>
      <PageHeader title={t(`greeting.${greetingFor(new Date().getHours())}`, { name: firstName(user?.name) })} documentTitle={t('title')} />
      <EmptyState
        icon={Lock}
        title={nothingAtAll ? t('noAccess') : t('start.noSection')}
        description={nothingAtAll ? t('common:profile.nothingYet') : t('start.noSectionHint')}
        className="rounded-2xl border border-dashed border-line-strong"
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <ButtonLink to="/profile" icon={UserRound} size="lg">
              {t('common:nav.profile')}
            </ButtonLink>
            {admin.map((i) => (
              <ButtonLink key={i.to} to={i.to} icon={i.icon} size="lg">
                {t(`common:nav.${i.label}`)}
              </ButtonLink>
            ))}
          </div>
        }
      />
    </div>
  );
}
