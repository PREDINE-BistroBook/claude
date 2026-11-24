import { SearchX } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ButtonLink, EmptyState } from '../components/ui';
import { usePageTitle } from '../lib/hooks';

export default function NotFoundPage() {
  const { t } = useTranslation();
  usePageTitle(t('errors.pageNotFound'));
  return (
    <EmptyState
      icon={SearchX}
      title={t('errors.pageNotFound')}
      description={t('errors.notFoundHint')}
      action={<ButtonLink to="/">{t('nav.home')}</ButtonLink>}
      className="min-h-[50vh]"
    />
  );
}
