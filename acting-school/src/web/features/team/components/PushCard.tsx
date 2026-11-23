import { useQueryClient } from '@tanstack/react-query';
import { BellOff, BellRing, ChevronDown, Send, Smartphone } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PushSubscribeResponse, PushTestResponse } from '@shared/schemas/notifications';
import { Button, Card, Spinner, useToast } from '@web/components/ui';
import { api } from '@web/lib/api';
import { currentPushSubscription } from '@web/lib/push';
import { teamErrorKey, teamKeys, usePushConfig } from '../api';
import { base64UrlToBytes, pushSupport } from '../utils';

/** The service worker, if one is (or becomes) ready within `ms` — none in development builds. */
async function readyRegistration(ms = 6000): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), ms));
  return Promise.race([navigator.serviceWorker.ready, timeout]);
}

function detectSupport() {
  const nav = navigator as Navigator & { standalone?: boolean };
  return pushSupport({
    userAgent: nav.userAgent,
    maxTouchPoints: nav.maxTouchPoints ?? 0,
    standalone: nav.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches === true,
    serviceWorker: 'serviceWorker' in nav,
    pushManager: 'PushManager' in window,
    notification: 'Notification' in window,
  });
}

/**
 * Profile › "Turn on notifications on this phone". Explains plainly that an
 * iPhone needs the app on the Home Screen first, and asks the browser for
 * permission only when the button is tapped. Push is per phone/browser: the
 * subscription is sent to POST /api/push/subscribe. With `prompt` (the orders
 * board, for the Office helper) it has its own title and words and shows only
 * while alerts could be turned on for this phone and aren't yet.
 */
export function PushCard({ prompt }: { prompt?: { title: string; description: string } } = {}) {
  const { t } = useTranslation(['team', 'common']);
  const toast = useToast();
  const qc = useQueryClient();
  const support = useMemo(detectSupport, []);
  // This browser's own subscription: undefined while asking the browser, null when it has none.
  const [browserSub, setBrowserSub] = useState<PushSubscription | null | undefined>(() => (support.status === 'ok' ? undefined : null));
  // The server says whether that subscription is mine in this sign-in: on a shared computer it may
  // have been someone else's, and signing out stops it on the server even if the browser keeps it.
  const config = usePushConfig(browserSub === undefined ? undefined : (browserSub?.endpoint ?? null));
  const [busy, setBusy] = useState<'on' | 'off' | 'test' | null>(null);
  const [permission, setPermission] = useState(() => ('Notification' in window ? Notification.permission : 'default'));

  useEffect(() => {
    if (support.status !== 'ok') return;
    let cancelled = false;
    void currentPushSubscription(6000).then((sub) => !cancelled && setBrowserSub(sub));
    return () => {
      cancelled = true;
    };
  }, [support.status]);

  const publicKey = config.data?.publicKey ?? null;
  const subscribed = !!browserSub && config.data?.thisDevice === true;

  const turnOn = async () => {
    if (!publicKey) return;
    setBusy('on');
    try {
      // Asked only now, from the tap (browsers require it, and it's the polite way).
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result !== 'granted') {
        toast.error(t(result === 'denied' ? 'push.denied' : 'push.failed'));
        return;
      }
      const reg = await readyRegistration();
      if (!reg) {
        toast.error(t('push.unsupported'));
        return;
      }
      const key = base64UrlToBytes(publicKey);
      // A subscription this browser already has (perhaps from someone else's sign-in) moves to me.
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }).catch(async () => {
          // A subscription made with an older server key: start again.
          await (await reg.pushManager.getSubscription())?.unsubscribe();
          return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
        });
      }
      await api.post<PushSubscribeResponse>('/push/subscribe', sub.toJSON());
      setBrowserSub(sub);
      await qc.invalidateQueries({ queryKey: teamKeys.pushConfig });
      toast.success(t('push.turnedOn'));
    } catch (err) {
      toast.error(t(teamErrorKey(err) === 'common:errors.generic' ? 'push.failed' : teamErrorKey(err)));
    } finally {
      setBusy(null);
    }
  };

  const turnOff = async () => {
    setBusy('off');
    try {
      const sub = browserSub ?? (await currentPushSubscription());
      if (sub) {
        await api.delete(`/push/subscribe?endpoint=${encodeURIComponent(sub.endpoint)}`);
        await sub.unsubscribe();
      }
      setBrowserSub(null);
      await qc.invalidateQueries({ queryKey: teamKeys.pushConfig });
      toast.success(t('push.turnedOff'));
    } catch (err) {
      toast.error(t(teamErrorKey(err)));
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    setBusy('test');
    try {
      await api.post<PushTestResponse>('/push/test');
      toast.success(t('push.testSent'));
    } catch (err) {
      toast.error(t(teamErrorKey(err)));
    } finally {
      setBusy(null);
    }
  };

  const offLine = (text: string) => (
    <p className="flex items-start gap-2 font-medium text-ink">
      <BellOff className="mt-0.5 size-5 shrink-0 text-muted" aria-hidden />
      {text}
    </p>
  );

  let body;
  if (config.isPending) body = <Spinner />;
  else if (!publicKey) body = <p className="text-sm text-muted">{t('push.offServer')}</p>;
  else if (support.status === 'iphoneNeedsHomeScreen') body = offLine(t('push.offIphone'));
  else if (support.status === 'unsupported') body = <p className="text-sm text-muted">{t('push.unsupported')}</p>;
  else if (permission === 'denied') body = <p className="rounded-xl bg-warning-soft px-3.5 py-3 text-sm text-warning">{t('push.blocked')}</p>;
  else if (subscribed)
    body = (
      <div className="grid gap-3">
        <p className="flex items-center gap-2 font-medium text-success">
          <BellRing className="size-5 shrink-0" aria-hidden />
          {t('push.on')}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button size="lg" icon={Send} loading={busy === 'test'} disabled={!!busy} onClick={() => void test()}>
            {t('push.test')}
          </Button>
          <Button size="lg" variant="danger-ghost" icon={BellOff} loading={busy === 'off'} disabled={!!busy} onClick={() => void turnOff()}>
            {t('push.turnOff')}
          </Button>
        </div>
      </div>
    );
  else
    body = (
      <div className="grid gap-3">
        {offLine(t('push.off'))}
        <Button size="lg" variant="primary" icon={BellRing} loading={busy === 'on'} disabled={!!busy} onClick={() => void turnOn()} className="max-sm:w-full">
          {t('push.turnOn')}
        </Button>
      </div>
    );

  // As a prompt elsewhere (the orders board): only while there is something to turn on for this phone.
  if (prompt && (config.isPending || browserSub === undefined || !publicKey || subscribed || support.status === 'unsupported')) return null;

  const iphoneReady = support.iphone && support.status !== 'iphoneNeedsHomeScreen';
  const steps = (
    <ol className="mt-1 list-decimal space-y-1.5 ps-5 text-[15px] leading-relaxed">
      <li>{t('push.iphoneStep1')}</li>
      <li>{t('push.iphoneStep2')}</li>
      <li>{t('push.iphoneStep3')}</li>
      <li>{t('push.iphoneStep4')}</li>
    </ol>
  );

  return (
    <Card title={prompt?.title ?? t('push.title')} description={prompt?.description ?? t('push.description')}>
      <div className="grid gap-4">
        {body}
        {/* On an iPhone the steps are open; elsewhere they're one tap away (someone may be setting up a colleague's iPhone). */}
        {publicKey &&
          (support.iphone ? (
            <div className="flex items-start gap-3 rounded-xl bg-info-soft px-3.5 py-3 text-ink">
              <Smartphone className="mt-0.5 size-5 shrink-0 text-info" aria-hidden />
              <div className="min-w-0">
                <p className="font-semibold">{t('push.iphoneTitle')}</p>
                {iphoneReady ? <p className="mt-0.5 text-[15px] leading-relaxed">{t('push.iphoneReady')}</p> : steps}
              </div>
            </div>
          ) : (
            <details className="group rounded-xl bg-info-soft text-ink">
              <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 px-3.5 py-2 font-semibold [&::-webkit-details-marker]:hidden">
                <Smartphone className="size-5 shrink-0 text-info" aria-hidden />
                <span className="min-w-0 flex-1">{t('push.iphoneSetup')}</span>
                <ChevronDown className="size-5 shrink-0 text-muted transition-transform group-open:rotate-180" aria-hidden />
              </summary>
              <div className="px-3.5 pb-3">{steps}</div>
            </details>
          ))}
        {publicKey && (config.data?.devices ?? 0) > 0 && <p className="text-sm text-muted">{t('push.devices', { count: config.data!.devices })}</p>}
      </div>
    </Card>
  );
}
