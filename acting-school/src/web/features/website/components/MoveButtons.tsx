import { ArrowDown, ArrowUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@web/components/ui';

/**
 * "Move up" / "Move down" buttons for ordering a list (instead of drag and
 * drop, which older people find hard on a phone). Each is 48 px tall with its
 * label written out; screen readers also hear the item's name.
 */
export function MoveButtons({
  name,
  index,
  count,
  onMove,
  disabled,
}: {
  name: string;
  index: number;
  count: number;
  onMove: (delta: -1 | 1) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation('website');
  return (
    <div className="flex gap-2">
      <Button
        size="lg"
        variant="secondary"
        icon={ArrowUp}
        disabled={disabled || index <= 0}
        onClick={() => onMove(-1)}
        className="flex-1 px-3 sm:flex-none"
      >
        {t('move.up')}
        <span className="sr-only">: {name}</span>
      </Button>
      <Button
        size="lg"
        variant="secondary"
        icon={ArrowDown}
        disabled={disabled || index >= count - 1}
        onClick={() => onMove(1)}
        className="flex-1 px-3 sm:flex-none"
      >
        {t('move.down')}
        <span className="sr-only">: {name}</span>
      </Button>
    </div>
  );
}
