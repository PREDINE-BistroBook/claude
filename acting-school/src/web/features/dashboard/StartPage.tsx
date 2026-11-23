import { Contact, MessageCircle, Sparkles, UserRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router';
import { ButtonLink, EmptyState, PageHeader, PageLoader } from '@web/components/ui';
import { TEAM_PATH, adminNavItems } from '@web/layout/nav';
import { rememberedSection, sectionByKey, startSection, visibleSections } from '@web/layout/sections';
import { useAuth } from '@web/lib/auth';
import { OrderDrinkButton } from '../cafe/components/CafeParts';
import { CAFE_BOARD_PATH, boardIsHome } from '../cafe/utils';
import { useUnread } from '../team/api';
import { firstName, greetingFor } from './utils';

/**
 * "/": straight to the home of the section the person was last in (if they can
 * still see it), otherwise their default section (sections.ts defaultSection:
 * the first one — Casting for someone whose School is only the student list).
 *
 * Someone who sees no section: if they serve the cafeteria (the Office
 * helper), the orders board is their home. Anyone else (Reception, until the
 * school says what it does) gets a small home: a greeting, a plain note that no
 * section is theirs yet, and big buttons for what every team member has —
 * Team, Messages, the cafeteria, their profile — plus whatever administration
 * pages they may open.
 */
export default function StartPage() {
  const { t } = useTranslation(['dashboard', 'common', 'team']);
  const { user, can } = useAuth();
  const poll = useUnread();
  const cafe = poll.data?.cafe;
  const visible = visibleSections(can);
  const start = startSection(visible, can, rememberedSection(user?.id ?? null));
  if (start) return <Navigate to={sectionByKey(start).home} replace />;

  // Whether the cafeteria is switched on comes with the first poll: wait for it rather than flash the small home
  // (if it can't be read, the small home it is).
  if (can('cafeteria.serve') && !cafe && poll.isPending) return <PageLoader />;
  if (boardIsHome(can, visible.length, cafe?.enabled)) return <Navigate to={CAFE_BOARD_PATH} replace />;

  const admin = adminNavItems(can);
  return (
    <div>
      <PageHeader title={t(`greeting.${greetingFor(new Date().getHours())}`, { name: firstName(user?.name) })} documentTitle={t('title')} />
      <EmptyState
        icon={Sparkles}
        title={t('start.noSection')}
        description={t('start.noSectionHint')}
        className="rounded-2xl border border-dashed border-line-strong"
        action={
          <div className="grid w-full max-w-sm grid-cols-1 gap-2 sm:max-w-none sm:grid-cols-2">
            <ButtonLink to={TEAM_PATH} icon={Contact} size="lg">
              {t('common:nav.team')}
            </ButtonLink>
            <ButtonLink to="/messages" icon={MessageCircle} size="lg">
              {t('common:nav.messages')}
            </ButtonLink>
            <OrderDrinkButton />
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
