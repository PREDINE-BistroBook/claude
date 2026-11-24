import { Eye, EyeOff } from 'lucide-react';
import { useState, type InputHTMLAttributes } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '../components/ui/Field';

/**
 * A password box with a show/hide button. The box is left-to-right in both
 * languages (passwords are Latin), so its wrapper is too: the button sits at
 * the end of what is typed, never on top of where the text starts. The button
 * is as tall as the box and 48 px wide — a full tap target on a phone.
 */
export function PasswordInput(props: InputHTMLAttributes<HTMLInputElement>) {
  const { t } = useTranslation();
  const [show, setShow] = useState(false);
  return (
    <div className="relative" dir="ltr">
      <Input {...props} type={show ? 'text' : 'password'} className="pe-12" dir="ltr" />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="absolute inset-y-0 end-0 flex w-12 items-center justify-center rounded-xl text-muted hover:text-ink"
        aria-label={show ? t('actions.hidePassword') : t('actions.showPassword')}
      >
        {show ? <EyeOff className="size-5" aria-hidden /> : <Eye className="size-5" aria-hidden />}
      </button>
    </div>
  );
}
