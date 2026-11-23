import { useTranslation } from 'react-i18next';
import { EmptyAddAction, ListAddAction } from '@web/components/ui';
import { useAuth } from '@web/lib/auth';
import { canAdd, screenAdd, type ListScreenWithAdd } from './addActions';

/**
 * A list screen's "+ Add …" as layout/addActions.ts names it: its label, the
 * page it opens (or `onClick` for a dialog on the screen) and its permission —
 * nothing at all for someone the API would refuse. Put it in PageHeader's
 * `actions`: on phones it is the fixed button above the tab bar.
 */
export function ScreenAddAction({ screen, onClick, disabled }: { screen: ListScreenWithAdd; onClick?: () => void; disabled?: boolean }) {
  const { t } = useTranslation();
  const { can } = useAuth();
  const add = screenAdd(screen);
  if (!canAdd(add, can)) return null;
  return <ListAddAction label={t(add.labelKey)} to={onClick ? undefined : add.to} onClick={onClick} disabled={disabled} testId={`add-${screen.replace(/\W+/g, '-')}`} />;
}

/**
 * The same Add inside the screen's empty state: "Add the first one" (its
 * `firstKey`, with the noun in Arabic). Render it only while the list has
 * nothing at all (wholeListEmpty), never on an empty tab next to full ones.
 */
export function ScreenEmptyAdd({ screen, onClick, disabled }: { screen: ListScreenWithAdd; onClick?: () => void; disabled?: boolean }) {
  const { t } = useTranslation();
  const { can } = useAuth();
  const add = screenAdd(screen);
  if (!canAdd(add, can)) return null;
  return <EmptyAddAction label={t(add.firstKey ?? add.labelKey)} to={onClick ? undefined : add.to} onClick={onClick} disabled={disabled} />;
}

/** Whether the person may use this screen's Add (to word an empty state for them). */
export function useCanAdd(screen: ListScreenWithAdd): boolean {
  const { can } = useAuth();
  return canAdd(screenAdd(screen), can);
}
