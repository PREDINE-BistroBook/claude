import { afterEach, describe, expect, it, vi } from 'vitest';
import { pointInTimeRecovery, RESTART_AFTER_MS, type RecoveryStorage } from '../../src/worker/pointInTimeRecovery';

/**
 * The Durable Object's point-in-time recovery as the app's `restore`
 * dependency (src/worker/pointInTimeRecovery.ts), against a fake storage:
 * what Cloudflare answers, and what local workerd answers (checked against
 * workerd 1.20261113: a stand-in bookmark, and a throw from the other two).
 */

const NOW = '0000007b-0000b26e-00001538-0c3e87bb37b3db5cc52eedb93cd3b96b';
const EARLIER = '0000007a-00000004-00001538-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const UNDO = '0000007c-00000001-00001538-11111111111111111111111111111111';
const NOT_HERE = "This Durable Object's storage back-end does not implement point-in-time recovery.";

function fake(storage: Partial<RecoveryStorage>) {
  const events: string[] = [];
  const background: Promise<unknown>[] = [];
  const full: RecoveryStorage = {
    getCurrentBookmark: async () => NOW,
    getBookmarkForTime: async (time) => (events.push(`forTime:${time}`), EARLIER),
    onNextSessionRestoreBookmark: async (bookmark) => (events.push(`restoreOnNextStart:${bookmark}`), UNDO),
    ...storage,
  };
  const object = { waitUntil: (task: Promise<unknown>) => void background.push(task), abort: (reason?: string) => void events.push(`abort:${reason}`) };
  return { recovery: pointInTimeRecovery(full, object), events, background };
}

afterEach(() => vi.useRealTimers());

describe('pointInTimeRecovery', () => {
  it('on Cloudflare: a bookmark for now, as the restore point of a run and for GET restore-point', async () => {
    vi.useFakeTimers({ now: 1_800_000_000_000 });
    const { recovery, events } = fake({});
    expect(await recovery.current!()).toEqual({ bookmark: NOW, at: 1_800_000_000_000 });
    expect(await recovery.record()).toEqual({ kind: 'bookmark', bookmark: NOW, at: 1_800_000_000_000 });
    expect(events).toEqual([]); // looking never restarts anything
  });

  it('restore: the bookmark is set for the next start, the answer comes back, and only then the object restarts', async () => {
    vi.useFakeTimers({ now: 1_800_000_000_000 });
    const { recovery, events, background } = fake({});
    expect(await recovery.restoreTo!({ bookmark: EARLIER })).toEqual({ restoringTo: EARLIER, undoBookmark: UNDO });
    expect(events).toEqual([`restoreOnNextStart:${EARLIER}`]);
    expect(background).toHaveLength(1); // kept alive until the restart
    await vi.advanceTimersByTimeAsync(RESTART_AFTER_MS - 1);
    expect(events).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(events[1]).toMatch(/^abort:Restarting to restore/);

    // By time: the bookmark for that moment first.
    const byTime = fake({});
    expect(await byTime.recovery.restoreTo!({ time: 1_799_999_000_000 })).toEqual({ restoringTo: EARLIER, undoBookmark: UNDO });
    expect(byTime.events).toEqual(['forTime:1799999000000', `restoreOnNextStart:${EARLIER}`]);
  });

  it('a refusal by the runtime is thrown on, and nothing restarts', async () => {
    vi.useFakeTimers();
    const unknown = fake({
      onNextSessionRestoreBookmark: async () => {
        throw new Error('Invalid bookmark');
      },
    });
    await expect(unknown.recovery.restoreTo!({ bookmark: 'nonsense-bookmark' })).rejects.toThrow('Invalid bookmark');
    const tooOld = fake({
      getBookmarkForTime: async () => {
        throw new Error('timestamp is too far in the past');
      },
    });
    await expect(tooOld.recovery.restoreTo!({ time: 1 })).rejects.toThrow('too far in the past');
    const broken = fake({
      getCurrentBookmark: async () => {
        throw new Error('storage is not answering');
      },
    });
    await expect(broken.recovery.record()).rejects.toThrow('storage is not answering');
    await vi.advanceTimersByTimeAsync(RESTART_AFTER_MS * 4);
    expect([...unknown.events, ...tooOld.events, ...broken.events].filter((e) => e.startsWith('abort'))).toEqual([]);
  });

  it('in local workerd there is none: the stand-in bookmark and the "not implemented" errors read as null, nothing restarts', async () => {
    vi.useFakeTimers();
    const notHere = async (): Promise<string> => {
      throw new Error(NOT_HERE);
    };
    for (const standIn of ['00000000-00000000-00000000-00000000000000000000000000000000', '00000000-00000001-00000000-00000000000000000000000000000000', '00000000-000000ff-00000000-00000000000000000000000000000000']) {
      const local = fake({ getCurrentBookmark: async () => standIn, getBookmarkForTime: notHere, onNextSessionRestoreBookmark: notHere });
      expect(await local.recovery.current!()).toBeNull();
      expect(await local.recovery.record()).toBeNull();
      expect(await local.recovery.restoreTo!({ time: Date.now() - 60_000 })).toBeNull();
      expect(await local.recovery.restoreTo!({ bookmark: NOW })).toBeNull();
      await vi.advanceTimersByTimeAsync(RESTART_AFTER_MS * 4);
      expect(local.events).toEqual([]);
      expect(local.background).toEqual([]);
    }
    // A runtime that throws for getCurrentBookmark too.
    expect(await fake({ getCurrentBookmark: notHere }).recovery.record()).toBeNull();
  });
});
