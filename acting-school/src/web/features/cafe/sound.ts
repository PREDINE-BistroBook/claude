/**
 * The orders board's ring for a new order: two short notes made with Web
 * Audio (no sound file to load, nothing the CSP has to allow). Browsers only
 * let a page make sound after it has been tapped, so the board calls
 * unlockSound() from its first tap and shows whether the ring is ready;
 * until then ring() does nothing (the alert and the card on screen are enough,
 * and with the app closed the push notification rings instead).
 */

type AudioContextClass = typeof AudioContext;

let context: AudioContext | null = null;

function audioContextClass(): AudioContextClass | null {
  if (typeof window === 'undefined') return null;
  const w = window as Window & { webkitAudioContext?: AudioContextClass };
  return window.AudioContext ?? w.webkitAudioContext ?? null;
}

/** Whether this browser can ring at all. */
export function soundSupported(): boolean {
  return audioContextClass() !== null;
}

/** Whether the ring will be heard (the page has been tapped and the audio is running). */
export function soundReady(): boolean {
  return context?.state === 'running';
}

/** Call from a tap (pointerdown / click): makes, or wakes, the audio. Answers whether the ring is ready now. */
export async function unlockSound(): Promise<boolean> {
  try {
    const Ctx = audioContextClass();
    if (!Ctx) return false;
    context ??= new Ctx();
    if (context.state !== 'running') await context.resume();
    return context.state === 'running';
  } catch {
    return false;
  }
}

/** Two short notes, the second higher: "ding-dong". Silent when the audio isn't unlocked. */
export function ring(): void {
  const ctx = context;
  if (!ctx || ctx.state !== 'running') return;
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
  } catch {
    // The audio went away (the phone took it back): the card on screen still shows the order.
  }
}
