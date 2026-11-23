/**
 * The orders board's ring for a new order: two short notes made with Web
 * Audio (no sound file to load, nothing the CSP has to allow). Browsers only
 * let a page make sound after it has been tapped, so the board calls
 * unlockSound() from a tap and shows whether the ring is ready. The phone can
 * take the audio back later (a screen lock, a call): the state follows the
 * audio's own `statechange` (subscribeSound), so the board says "tap here"
 * again instead of promising a ring it can't make. ring() tries to wake the
 * audio first and answers whether it could ring; with the app closed the push
 * notification rings instead.
 */

type AudioContextClass = typeof AudioContext;

/** 'unsupported': this browser can't ring; 'locked': it needs a tap first (or again); 'ready': a ring will be heard. */
export type SoundState = 'unsupported' | 'locked' | 'ready';

let context: AudioContext | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

function audioContextClass(): AudioContextClass | null {
  if (typeof window === 'undefined') return null;
  const w = window as Window & { webkitAudioContext?: AudioContextClass };
  return window.AudioContext ?? w.webkitAudioContext ?? null;
}

/** Whether this browser can ring at all. */
export function soundSupported(): boolean {
  return audioContextClass() !== null;
}

/** Whether the ring will be heard (the page has been tapped and the audio is running now). */
export function soundReady(): boolean {
  return context?.state === 'running';
}

export function soundState(): SoundState {
  if (!soundSupported()) return 'unsupported';
  return soundReady() ? 'ready' : 'locked';
}

/** Back on screen after a lock: the browser may have suspended the audio meanwhile; try to wake it, and say how it went. */
function onVisible() {
  if (document.visibilityState === 'visible' && context && context.state !== 'running') void context.resume().catch(() => undefined).finally(notify);
}

/** Be told when the sound state changes (for useSyncExternalStore). */
export function subscribeSound(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) document.addEventListener('visibilitychange', onVisible);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) document.removeEventListener('visibilitychange', onVisible);
  };
}

function makeContext(Ctx: AudioContextClass): AudioContext {
  const ctx = new Ctx();
  // Suspended or interrupted by the phone, running again: whatever shows the state follows.
  ctx.addEventListener('statechange', notify);
  return ctx;
}

/** Call from a tap (pointerdown / click): makes, or wakes, the audio. Answers whether the ring is ready now. */
export async function unlockSound(): Promise<boolean> {
  try {
    const Ctx = audioContextClass();
    if (!Ctx) return false;
    context ??= makeContext(Ctx);
    if (context.state !== 'running') await context.resume();
    return context.state === 'running';
  } catch {
    return false;
  } finally {
    notify();
  }
}

/**
 * Two short notes, the second higher: "ding-dong". Wakes the audio first if
 * the phone had suspended it (allowed when called from a tap; otherwise it may
 * stay silent). Answers whether it rang.
 */
export async function ring(): Promise<boolean> {
  const ctx = context;
  if (!ctx) return false;
  try {
    if (ctx.state !== 'running') await ctx.resume();
  } catch {
    // Not allowed without a tap: silent.
  }
  if (ctx.state !== 'running') {
    notify();
    return false;
  }
  try {
    const note = (frequency: number, start: number, length: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = frequency;
      // A soft start and end: no click.
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + start);
      gain.gain.exponentialRampToValueAtTime(0.4, ctx.currentTime + start + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + length);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + length + 0.02);
    };
    note(784, 0, 0.28);
    note(1047, 0.3, 0.45);
    return true;
  } catch {
    // The audio went away (the phone took it back): the card on screen still shows the order.
    return false;
  }
}
