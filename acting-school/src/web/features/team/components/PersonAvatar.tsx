import { Avatar } from '@web/components/ui';
import { usePersonPhoto } from '../api';

/**
 * A colleague's avatar when a screen only has their id and name (a workshop's
 * coach, an enquiry's assignee, a schedule entry): the photo comes from the
 * Team directory (GET /api/team, cached), initials until then or for people
 * no longer active.
 */
export function PersonAvatar({
  userId,
  name,
  size = 'sm',
  className,
}: {
  userId: number | null | undefined;
  name: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}) {
  const photo = usePersonPhoto(userId);
  return <Avatar name={name} fileId={photo} size={size} className={className} />;
}
