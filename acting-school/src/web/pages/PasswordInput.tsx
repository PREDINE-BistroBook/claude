import { Eye, EyeOff } from 'lucide-react';
import { useState, type InputHTMLAttributes } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '../components/ui/Field';

export function PasswordInput(props: InputHTMLAttributes<HTMLInputElement>) {
  const { t } = useTranslation();
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input {...props} type={show ? 'text' : 'password'} className="pe-11" dir="ltr" />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="absolute end-1.5 top-1/2 -translate-y-1/2 rounded-lg p-2 text-muted hover:text-ink"
        aria-label={show ? t('actions.hidePassword') : t('actions.showPassword')}
      >
        {show ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
      </button>
    </div>
  );
}
