import { describe, expect, it } from 'vitest';
import { BUILT_IN_POSITIONS, PERMISSIONS, type Permission } from '../../src/shared/permissions';
import type { ChatMessage, ChatPreview } from '../../src/shared/schemas/chat';
import type { SummonsView } from '../../src/shared/schemas/summons';
import type { TeamMember } from '../../src/shared/schemas/team';
import {
  advanceCursor,
  conversationIdFromPath,
  dayKind,
  groupByDay,
  localDay,
  mergeMessages,
  messageToMarkRead,
  previewParts,
  receipt,
} from '../../src/web/features/chat/utils';
import {
  bannerSummons,
  base64UrlToBytes,
  filterTeam,
  hasPersonActions,
  newlyAnswered,
  personActionButtons,
  pushSupport,
  safeAppLink,
  summonsIdFrom,
} from '../../src/web/features/team/utils';
import { documentLabel, formatFileSize, isPhotoFile } from '../../src/web/lib/files';

const builtIn = (key: string) => BUILT_IN_POSITIONS.find((p) => p.key === key)!.permissions as readonly Permission[];
const viewer = (id: number, key: string) => ({ id, permissions: builtIn(key) });
const member = (id: number, over: Partial<TeamMember> = {}): TeamMember => ({
  id,
  name: `Person ${id}`,
  photoFileId: null,
  active: true,
  positions: [],
  isMe: false,
  lastSummons: null,
  ...over,
});

describe('PersonActions visibility', () => {
  const coach = member(7);

  it('the CEO, CFO and Executive Director get "Message" and "Call to the office" beside a colleague', () => {
    for (const key of ['ceo', 'cfo', 'executive_director']) {
      expect(personActionButtons(viewer(1, key), coach)).toEqual({ message: true, summon: true });
    }
  });

  it('everyone else gets "Message" only (everyone can message everyone)', () => {
    for (const key of ['head_of_casting', 'casting_team', 'video_editor', 'acting_coach', 'finance']) {
      expect(personActionButtons(viewer(1, key), coach)).toEqual({ message: true, summon: false });
    }
  });

  it('only the owners and the Executive Director hold staff.summon among the built-in positions (no COO)', () => {
    const summoners = BUILT_IN_POSITIONS.filter((p) => (p.permissions as readonly string[]).includes('staff.summon')).map((p) => p.key);
    expect(summoners.sort()).toEqual(['ceo', 'cfo', 'executive_director']);
    expect(PERMISSIONS).toContain('staff.summon');
  });

  it('a custom position with staff.summon gets the button: it follows the permission, never a position name', () => {
    expect(personActionButtons({ id: 1, permissions: ['staff.summon'] }, coach)).toEqual({ message: true, summon: true });
    expect(personActionButtons({ id: 1, permissions: [] }, coach)).toEqual({ message: true, summon: false });
  });

  it('never offers to message or call yourself', () => {
    expect(personActionButtons(viewer(7, 'executive_director'), coach)).toEqual({ message: false, summon: false });
    expect(hasPersonActions(personActionButtons(viewer(7, 'ceo'), coach))).toBe(false);
  });

  it('nothing for someone not in the Team directory (inactive, unknown, or the list not loaded yet)', () => {
    expect(personActionButtons(viewer(1, 'ceo'), undefined)).toEqual({ message: false, summon: false });
    expect(personActionButtons(viewer(1, 'ceo'), null)).toEqual({ message: false, summon: false });
    expect(personActionButtons(viewer(1, 'ceo'), member(8, { active: false }))).toEqual({ message: false, summon: false });
  });

  it('nothing when nobody is signed in', () => {
    expect(personActionButtons(null, coach)).toEqual({ message: false, summon: false });
  });

  it('owners shown to a non-owner (no positions) can still be messaged', () => {
    const owner = member(2, { positions: [] });
    expect(personActionButtons(viewer(5, 'casting_team'), owner)).toEqual({ message: true, summon: false });
    expect(personActionButtons(viewer(3, 'executive_director'), owner)).toEqual({ message: true, summon: true });
  });
});

describe('notification links stay inside the app', () => {
  it('keeps app paths', () => {
    expect(safeAppLink('/messages/12')).toBe('/messages/12');
    expect(safeAppLink('/team?summons=4')).toBe('/team?summons=4');
  });
  it('anything that could leave the app becomes "/"', () => {
    for (const bad of ['https://evil.example', '//evil.example/x', 'javascript:alert(1)', '/\\evil.example', '', 'messages/1', null, 42, '/a\nb', '/' + 'x'.repeat(600)]) {
      expect(safeAppLink(bad)).toBe('/');
    }
  });
  it('reads the summons id from a /team link', () => {
    expect(summonsIdFrom('?summons=12')).toBe(12);
    expect(summonsIdFrom('/team?summons=3')).toBe(3);
    expect(summonsIdFrom('?summons=abc')).toBeNull();
    expect(summonsIdFrom('?summons=-1')).toBeNull();
    expect(summonsIdFrom('')).toBeNull();
  });
});

const person = (id: number) => ({ id, name: `P${id}`, photoFileId: null, active: true });
const summons = (id: number, over: Partial<SummonsView> = {}): SummonsView => ({
  id,
  from: person(1),
  to: person(2),
  note: null,
  status: 'pending',
  createdAt: 1_000_000 + id,
  answeredAt: null,
  expiresAt: 1_000_000 + id + 2 * 60 * 60 * 1000,
  ...over,
});

describe('the call-to-the-office banner', () => {
  it('shows the newest waiting call and counts the rest', () => {
    const now = 1_000_500;
    const { first, more } = bannerSummons([summons(1), summons(3), summons(2)], now);
    expect(first?.id).toBe(3);
    expect(more).toBe(2);
  });
  it('ignores answered, cancelled and expired calls', () => {
    const now = 1_000_500;
    const items = [summons(1, { status: 'on_my_way' }), summons(2, { status: 'cancelled' }), summons(3, { status: 'expired' }), summons(4, { expiresAt: now - 1 })];
    expect(bannerSummons(items, now)).toEqual({ first: null, more: 0 });
  });
});

describe("the caller's answer toast", () => {
  const since = 1_000_000;
  it('toasts a call that went from waiting to answered', () => {
    const before = new Map([[5, 'pending' as const]]);
    expect(newlyAnswered(before, [summons(5, { status: 'on_my_way' })], since).map((s) => s.id)).toEqual([5]);
    expect(newlyAnswered(before, [summons(5, { status: 'cant_now' })], since).map((s) => s.id)).toEqual([5]);
  });
  it('does not toast again, nor for cancelled/expired ones', () => {
    expect(newlyAnswered(new Map([[5, 'on_my_way' as const]]), [summons(5, { status: 'on_my_way' })], since)).toEqual([]);
    expect(newlyAnswered(new Map([[5, 'pending' as const]]), [summons(5, { status: 'expired' })], since)).toEqual([]);
  });
  it('a call sent and answered between two looks toasts only when it is new', () => {
    expect(newlyAnswered(new Map(), [summons(6, { status: 'on_my_way', createdAt: since + 10 })], since).map((s) => s.id)).toEqual([6]);
    expect(newlyAnswered(new Map(), [summons(6, { status: 'on_my_way', createdAt: since - 10 })], since)).toEqual([]);
  });
});

describe('phone notifications', () => {
  it('decodes the base64url VAPID key', () => {
    const bytes = Uint8Array.from({ length: 65 }, (_, i) => (i * 37) % 256);
    const b64url = Buffer.from(bytes).toString('base64url');
    expect([...base64UrlToBytes(b64url)]).toEqual([...bytes]);
  });

  const apis = { serviceWorker: true, pushManager: true, notification: true };
  const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
  const ipad = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15';
  const android = 'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36';

  it('an iPhone in Safari must add the app to the Home Screen first', () => {
    expect(pushSupport({ userAgent: iphone, maxTouchPoints: 5, standalone: false, serviceWorker: true, pushManager: false, notification: false })).toEqual({
      iphone: true,
      status: 'iphoneNeedsHomeScreen',
    });
  });
  it('an iPhone opened from the Home Screen can subscribe', () => {
    expect(pushSupport({ userAgent: iphone, maxTouchPoints: 5, standalone: true, ...apis })).toEqual({ iphone: true, status: 'ok' });
  });
  it('an iPad (which says "Macintosh") counts as an iPhone; a Mac does not', () => {
    expect(pushSupport({ userAgent: ipad, maxTouchPoints: 5, standalone: false, ...apis }).status).toBe('iphoneNeedsHomeScreen');
    expect(pushSupport({ userAgent: ipad, maxTouchPoints: 0, standalone: false, ...apis })).toEqual({ iphone: false, status: 'ok' });
  });
  it('Android works in the browser; a browser without push says so', () => {
    expect(pushSupport({ userAgent: android, maxTouchPoints: 5, standalone: false, ...apis })).toEqual({ iphone: false, status: 'ok' });
    expect(pushSupport({ userAgent: android, maxTouchPoints: 5, standalone: false, ...apis, pushManager: false }).status).toBe('unsupported');
  });
});

describe('Team directory search', () => {
  it('matches any part of the name, in any case, Arabic too', () => {
    const items = [{ name: 'Layla Haddad' }, { name: 'Daniel Price' }, { name: 'داليا فتحي' }];
    expect(filterTeam(items, 'had').map((m) => m.name)).toEqual(['Layla Haddad']);
    expect(filterTeam(items, 'فتحي').map((m) => m.name)).toEqual(['داليا فتحي']);
    expect(filterTeam(items, '  ')).toHaveLength(3);
  });
});

const msg = (id: number, over: Partial<ChatMessage> = {}): ChatMessage => ({
  id,
  conversationId: 1,
  senderId: 2,
  mine: false,
  body: `m${id}`,
  attachments: [],
  createdAt: Date.UTC(2026, 10, 20, 10, 0) + id * 60_000,
  deleted: false,
  canDelete: false,
  ...over,
});

describe('chat: messages on screen', () => {
  it('merges polls and earlier pages by id, oldest first, newer copies win', () => {
    const merged = mergeMessages([msg(3), msg(4)], [msg(5), msg(1), msg(4, { deleted: true, body: null })]);
    expect(merged.map((m) => m.id)).toEqual([1, 3, 4, 5]);
    expect(merged.find((m) => m.id === 4)?.deleted).toBe(true);
    const same = [msg(1)];
    expect(mergeMessages(same, [])).toBe(same);
  });

  it('"Seen" under my newest message once the other person has read it, else "Sent"', () => {
    const items = [msg(1), msg(2, { mine: true })];
    expect(receipt(items, 1)).toEqual({ messageId: 2, status: 'sent' });
    expect(receipt(items, 2)).toEqual({ messageId: 2, status: 'seen' });
    expect(receipt(items, null)).toEqual({ messageId: 2, status: 'sent' });
    // Their reply is newer: no receipt needed. A deleted last message: none either.
    expect(receipt([msg(1, { mine: true }), msg(2)], 1)).toBeNull();
    expect(receipt([msg(1, { mine: true, deleted: true })], 1)).toBeNull();
    expect(receipt([], 5)).toBeNull();
  });

  it('crossed messages: theirs, sent just before mine, still arrives with the next poll', () => {
    // On screen: [1]; the server has answered up to 1.
    let screen = [msg(1)];
    let cursor = advanceCursor(null, screen);
    expect(cursor).toBe(1);
    // They send 2; before the next poll I send 3, which goes on screen at once (it doesn't move the cursor).
    screen = mergeMessages(screen, [msg(3, { mine: true })]);
    // The poll asks for after=1, not after=3, and gets both.
    const answer = [msg(2), msg(3, { mine: true })];
    screen = mergeMessages(screen, answer);
    cursor = advanceCursor(cursor, answer);
    expect(screen.map((m) => m.id)).toEqual([1, 2, 3]);
    expect(cursor).toBe(3);
    // Their message is then reported read (it clears the bell).
    expect(messageToMarkRead(screen, 1)).toBe(2);
    expect(advanceCursor(5, [])).toBe(5);
    expect(advanceCursor(null, [])).toBeNull();
  });

  it('reports the newest message from the other person as read, once', () => {
    const items = [msg(1), msg(2, { mine: true }), msg(3), msg(4, { mine: true })];
    expect(messageToMarkRead(items, null)).toBe(3);
    expect(messageToMarkRead(items, 1)).toBe(3);
    expect(messageToMarkRead(items, 3)).toBeNull();
    expect(messageToMarkRead([msg(1, { mine: true })], null)).toBeNull();
  });

  it('groups messages by day for the date separators', () => {
    const day1 = new Date(2026, 10, 20, 9, 0).getTime();
    const day2 = new Date(2026, 10, 21, 9, 0).getTime();
    const groups = groupByDay([msg(1, { createdAt: day1 }), msg(2, { createdAt: day1 + 60_000 }), msg(3, { createdAt: day2 })]);
    expect(groups.map((g) => [g.day, g.items.map((m) => m.id)])).toEqual([
      [localDay(day1), [1, 2]],
      [localDay(day2), [3]],
    ]);
  });

  it('today / yesterday / older', () => {
    const now = new Date(2026, 10, 23, 12, 0).getTime();
    expect(dayKind(new Date(2026, 10, 23, 0, 5).getTime(), now)).toBe('today');
    expect(dayKind(new Date(2026, 10, 22, 23, 55).getTime(), now)).toBe('yesterday');
    expect(dayKind(new Date(2026, 10, 20, 12, 0).getTime(), now)).toBe('older');
  });

  it('conversation previews', () => {
    const p = (over: Partial<ChatPreview>): ChatPreview => ({ id: 1, senderId: 2, mine: false, text: null, photos: 0, documents: 0, deleted: false, createdAt: 0, ...over });
    expect(previewParts(null)).toEqual({ kind: 'none' });
    expect(previewParts(p({ deleted: true, text: 'x' }))).toEqual({ kind: 'deleted' });
    expect(previewParts(p({ text: 'Hello', photos: 1 }))).toEqual({ kind: 'text', text: 'Hello' });
    expect(previewParts(p({ photos: 2 }))).toEqual({ kind: 'photos', count: 2 });
    expect(previewParts(p({ documents: 1 }))).toEqual({ kind: 'files', count: 1 });
  });

  it('finds the conversation in a /messages/:id path', () => {
    expect(conversationIdFromPath('/messages/12')).toBe(12);
    expect(conversationIdFromPath('/messages')).toBeNull();
    expect(conversationIdFromPath('/messages/x')).toBeNull();
  });
});

describe('picked files', () => {
  it('tells photos (resized on the phone) from documents', () => {
    expect(isPhotoFile({ type: 'image/jpeg', name: 'a.jpg' })).toBe(true);
    expect(isPhotoFile({ type: 'image/heic', name: 'IMG_1.HEIC' })).toBe(true);
    expect(isPhotoFile({ type: '', name: 'IMG_2.HEIC' })).toBe(true);
    expect(isPhotoFile({ type: 'application/pdf', name: 'script.pdf' })).toBe(false);
    expect(isPhotoFile({ type: '', name: 'notes.docx' })).toBe(false);
  });
  it('shows document type and size plainly', () => {
    expect(documentLabel('application/pdf')).toBe('PDF');
    expect(documentLabel('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe('Word');
    expect(documentLabel('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe('Excel');
    expect(documentLabel('application/vnd.openxmlformats-officedocument.presentationml.presentation')).toBe('PowerPoint');
    expect(formatFileSize(512, 'en-GB')).toBe('512 B');
    expect(formatFileSize(300 * 1024, 'en-GB')).toBe('300 KB');
    expect(formatFileSize(1.5 * 1024 * 1024, 'en-GB')).toBe('1.5 MB');
  });
});

describe('every Team pack error the server can answer has words on screen', () => {
  it('team:errors.* and chat:errors.* keys used by the server and shared schemas exist in EN and AR', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { default: team } = await import('../../src/web/features/team/i18n');
    const { default: chat } = await import('../../src/web/features/chat/i18n');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (p.endsWith('.ts')) files.push(p);
      }
    };
    walk(path.resolve(__dirname, '../../src/server'));
    walk(path.resolve(__dirname, '../../src/shared'));
    const keys = new Set<string>();
    for (const f of files) for (const m of fs.readFileSync(f, 'utf8').matchAll(/'(team|chat):errors\.(\w+)'/g)) keys.add(`${m[1]}:${m[2]}`);
    expect(keys.size).toBeGreaterThan(5);
    const ns = { team, chat } as const;
    const missing = [...keys].filter((k) => {
      const [name, key] = k.split(':') as ['team' | 'chat', string];
      const en = (ns[name].en.errors as Record<string, string>)[key];
      const ar = (ns[name].ar.errors as Record<string, unknown>)[key];
      return !en || !ar;
    });
    expect(missing).toEqual([]);
  });
});
