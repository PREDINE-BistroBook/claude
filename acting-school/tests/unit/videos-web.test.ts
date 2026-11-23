import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { VideoStatus } from '../../src/shared/enums';
import { BUILT_IN_POSITIONS, PERMISSIONS, videosAreHome, type Permission } from '../../src/shared/permissions';
import { seesAllVideos, usesVideos, videoActions, videoLinkHost, type Video, type VideoActions, type VideoViewer } from '../../src/shared/schemas/videos';
import { NAV_ITEMS, landingAfterSignIn, mobileTabs, videosFirst } from '../../src/web/layout/nav';
import { sectionForPath, visibleSections } from '../../src/web/layout/sections';
import {
  VIDEOS_PATH,
  byEditorQueue,
  defaultVideoTitle,
  dueWords,
  firstTab,
  queueIsMine,
  queueTabs,
  tabCounts,
  tabVideos,
  tidyLink,
  toggleStudent,
  videoRoles,
  videosBadge,
} from '../../src/web/features/videos/utils';

/**
 * The video pipeline on the web side (Part L): the queue's tabs and order,
 * which buttons each role sees (the shared rule the API enforces), the menu
 * entry and the editor's start, the words. Plain functions, no React.
 */

const builtIn = (key: string) => BUILT_IN_POSITIONS.find((p) => p.key === key)!.permissions as readonly Permission[];
const canWith = (permissions: readonly Permission[]) => (p: Permission) => permissions.includes(p);
const MOATY = [...new Set([...builtIn('acting_coach'), ...builtIn('finance'), ...builtIn('video_reviewer')])];
const TODAY = '2026-11-23';

let nextId = 1;
function video(over: Partial<Video> = {}): Video {
  const id = over.id ?? nextId++;
  return {
    id,
    courseId: 1,
    courseName: 'Screen Acting I',
    color: null,
    sessionId: 1,
    sessionDate: TODAY,
    sessionStartTime: '18:00',
    title: `Video ${id}`,
    kind: 'scene',
    rawLink: 'https://drive.google.com/x',
    notesForEditor: null,
    dueOn: '2026-11-24',
    status: 'new',
    addedBy: { id: 10, name: 'Layla', photoFileId: null, active: true },
    editor: null,
    reviewer: null,
    editedLink: null,
    editorNotes: null,
    changesNote: null,
    takenAt: null,
    submittedAt: null,
    decidedAt: null,
    createdAt: 1,
    updatedAt: 1,
    students: [],
    studentsHidden: 0,
    ...over,
  };
}
const person = (id: number, active = true) => ({ id, name: `P${id}`, photoFileId: null, active });

// ── Which buttons each role sees ────────────────────────────────────────────

describe('which buttons each role sees (videoActions — the rule the API enforces too)', () => {
  const COACH = 10;
  const EDITOR = 20;
  const OTHER_EDITOR = 21;
  const REVIEWER = 30;
  const viewers: Record<string, VideoViewer> = {
    coach: { id: COACH, isOwner: false, permissions: builtIn('acting_coach') },
    otherCoach: { id: 11, isOwner: false, permissions: builtIn('acting_coach') },
    editor: { id: EDITOR, isOwner: false, permissions: builtIn('video_editor') },
    otherEditor: { id: OTHER_EDITOR, isOwner: false, permissions: builtIn('video_editor') },
    reviewer: { id: REVIEWER, isOwner: false, permissions: MOATY },
    director: { id: 40, isOwner: false, permissions: builtIn('executive_director') },
    owner: { id: 50, isOwner: true, permissions: [...PERMISSIONS] },
  };
  const on = (a: VideoActions) => (Object.keys(a) as (keyof VideoActions)[]).filter((k) => a[k]).sort();
  const at = (status: VideoStatus, editor: number | null = status === 'new' ? null : EDITOR, editorActive = true) => video({ status, editor: editor === null ? null : person(editor, editorActive) });

  it('new: the coach changes or deletes it; editors start it; the reviewer may change it; nobody decides', () => {
    const v = at('new');
    expect(on(videoActions(v, viewers.coach!))).toEqual(['comment', 'edit', 'remove']);
    expect(on(videoActions(v, viewers.otherCoach!))).toEqual([]);
    expect(on(videoActions(v, viewers.editor!))).toEqual(['comment', 'take']);
    expect(on(videoActions(v, viewers.reviewer!))).toEqual(['comment', 'edit', 'remove']);
    expect(on(videoActions(v, viewers.director!))).toEqual([]);
    expect(on(videoActions(v, viewers.owner!))).toEqual(['comment', 'edit', 'remove', 'take']);
  });

  it('editing: only the editor on it says "Done"; another editor waits — unless the first has left', () => {
    expect(on(videoActions(at('editing'), viewers.editor!))).toEqual(['comment', 'submit']);
    expect(on(videoActions(at('editing'), viewers.otherEditor!))).toEqual(['comment']);
    expect(on(videoActions(at('editing', EDITOR, false), viewers.otherEditor!))).toEqual(['comment', 'take']);
    expect(on(videoActions(at('editing'), viewers.coach!))).toEqual(['comment']);
    expect(on(videoActions(at('editing'), viewers.reviewer!))).toEqual(['comment']);
  });

  it('in review: the reviewer sees Approved and Needs changes; the editor and the coach only comment', () => {
    expect(on(videoActions(at('in_review'), viewers.reviewer!))).toEqual(['approve', 'comment', 'requestChanges']);
    expect(on(videoActions(at('in_review'), viewers.editor!))).toEqual(['comment']);
    expect(on(videoActions(at('in_review'), viewers.coach!))).toEqual(['comment']);
    expect(on(videoActions(at('in_review'), viewers.director!))).toEqual([]);
  });

  it('changes requested: the editor sees "Start fixing" (take); approved: the reviewer can reopen', () => {
    expect(on(videoActions(at('changes_requested'), viewers.editor!))).toEqual(['comment', 'take']);
    expect(on(videoActions(at('changes_requested'), viewers.reviewer!))).toEqual(['comment']);
    expect(on(videoActions(at('approved'), viewers.reviewer!))).toEqual(['comment', 'reopen']);
    expect(on(videoActions(at('approved'), viewers.editor!))).toEqual(['comment']);
    expect(on(videoActions(at('approved'), viewers.coach!))).toEqual(['comment']);
  });

  it('who sees every video, who uses the pipeline at all', () => {
    expect(seesAllVideos(viewers.editor!)).toBe(true);
    expect(seesAllVideos(viewers.reviewer!)).toBe(true);
    expect(seesAllVideos(viewers.director!)).toBe(true);
    expect(seesAllVideos(viewers.owner!)).toBe(true);
    expect(seesAllVideos(viewers.coach!)).toBe(false);
    expect(usesVideos({ permissions: builtIn('casting_team') })).toBe(false);
    expect(usesVideos({ permissions: builtIn('finance') })).toBe(false);
    expect(usesVideos(viewers.coach!)).toBe(true);
  });
});

// ── The queue ───────────────────────────────────────────────────────────────

describe('the queue: tabs for each role and their order', () => {
  it('tabs: the editor, the reviewer (To check first), both, the director, a coach', () => {
    expect(queueTabs(videoRoles(canWith(builtIn('video_editor'))))).toEqual(['toEdit', 'editing', 'waiting', 'approved']);
    expect(queueTabs(videoRoles(canWith(MOATY)))).toEqual(['toCheck', 'withEditor', 'approved']);
    expect(queueTabs(videoRoles(canWith(builtIn('video_reviewer'))))).toEqual(['toCheck', 'withEditor', 'approved']);
    expect(queueTabs(videoRoles(canWith([...PERMISSIONS])))).toEqual(['toCheck', 'toEdit', 'editing', 'approved']);
    expect(queueTabs(videoRoles(canWith(builtIn('executive_director'))))).toEqual(['withEditor', 'waiting', 'approved']);
    expect(queueTabs(videoRoles(canWith(builtIn('acting_coach'))))).toEqual(['mine', 'approved']);
    expect(queueIsMine(videoRoles(canWith(builtIn('acting_coach'))))).toBe(true);
    expect(queueIsMine(videoRoles(canWith(MOATY)))).toBe(false);
  });

  it('"To edit": changes requested on top, then by due date (most overdue first); "Editing" is mine; "Approved" newest first', () => {
    const late = video({ title: 'late', dueOn: '2026-11-20' });
    const soon = video({ title: 'soon', dueOn: '2026-11-24' });
    const today = video({ title: 'today', dueOn: TODAY });
    const backLater = video({ title: 'back later', status: 'changes_requested', dueOn: '2026-11-30' });
    const backSoon = video({ title: 'back soon', status: 'changes_requested', dueOn: '2026-11-22' });
    const mine = video({ title: 'mine', status: 'editing', editor: person(20) });
    const theirs = video({ title: 'theirs', status: 'editing', editor: person(21) });
    const check = video({ title: 'check', status: 'in_review' });
    const old = video({ title: 'old', status: 'approved', decidedAt: 100 });
    const recent = video({ title: 'recent', status: 'approved', decidedAt: 200 });
    const all = [late, soon, today, backLater, backSoon, mine, theirs, check, old, recent];
    const titles = (tab: Parameters<typeof tabVideos>[1], isOwner = false) => tabVideos(all, tab, 20, isOwner).map((v) => v.title);
    expect(titles('toEdit')).toEqual(['back soon', 'back later', 'late', 'today', 'soon']);
    expect(titles('editing')).toEqual(['mine']);
    expect(titles('editing', true)).toEqual(['mine', 'theirs']);
    expect(titles('waiting')).toEqual(['check']);
    expect(titles('toCheck')).toEqual(['check']);
    // Everywhere else: by due date only.
    expect(titles('withEditor')).toEqual(['late', 'back soon', 'today', 'soon', 'mine', 'theirs', 'back later']);
    expect(titles('approved')).toEqual(['recent', 'old']);
    expect(titles('mine')).toEqual(['late', 'back soon', 'today', 'soon', 'mine', 'theirs', 'check', 'back later']);
    expect([backLater, late].sort(byEditorQueue)[0]).toBe(backLater);
    // The counts on the tabs, and the tab that opens first: the first with work in it.
    const counts = tabCounts(all, ['toEdit', 'editing', 'waiting', 'approved'], 20);
    expect(counts).toEqual({ toEdit: 5, editing: 1, waiting: 1, approved: 2 });
    expect(firstTab(['toCheck', 'withEditor', 'approved'], { toCheck: 0, withEditor: 3, approved: 2 })).toBe('withEditor');
    expect(firstTab(['toCheck', 'withEditor', 'approved'], { toCheck: 1 })).toBe('toCheck');
    expect(firstTab(['toEdit', 'editing', 'waiting', 'approved'], { approved: 4 })).toBe('toEdit');
  });

  it('due dates in words: today, tomorrow, a date — late (red) only while it still waits for the editor', () => {
    expect(dueWords(TODAY, TODAY, 'new')).toEqual({ key: 'today', late: false });
    expect(dueWords('2026-11-24', TODAY, 'new')).toEqual({ key: 'tomorrow', late: false });
    expect(dueWords('2026-11-27', TODAY, 'editing')).toEqual({ key: 'on', late: false });
    expect(dueWords('2026-11-21', TODAY, 'new')).toEqual({ key: 'late', late: true, days: 2 });
    expect(dueWords('2026-11-22', TODAY, 'changes_requested')).toEqual({ key: 'late', late: true, days: 1 });
    expect(dueWords('2026-11-21', TODAY, 'in_review').late).toBe(false);
    expect(dueWords('2026-11-21', TODAY, 'approved').late).toBe(false);
    // Across the March clock change (Cairo has none, but the browser's zone might).
    expect(dueWords('2027-03-26', '2027-03-28', 'new')).toEqual({ key: 'late', late: true, days: 2 });
  });

  it('the badge on "Videos": what waits for this person — owners and coaches get none', () => {
    expect(videosBadge(undefined)).toBe(0);
    expect(videosBadge(null)).toBe(0);
    expect(videosBadge({ toEdit: 3, dueToday: 1, late: 0, toCheck: null, addedByMe: 0, approvedThisWeek: 0 })).toBe(3);
    expect(videosBadge({ toEdit: null, dueToday: null, late: null, toCheck: 2, addedByMe: 4, approvedThisWeek: 1 })).toBe(2);
    expect(videosBadge({ toEdit: null, dueToday: null, late: null, toCheck: null, addedByMe: 4, approvedThisWeek: 1 })).toBe(0);
  });
});

// ── The menu, the start page, the bottom bar ────────────────────────────────

describe('where the queue lives: School, the menu entry, the editor’s start and bottom bar', () => {
  it('/videos is School’s; any videos permission opens School and shows the "Videos" entry with its badge', () => {
    expect(sectionForPath('/videos')).toBe('school');
    expect(sectionForPath('/videos/12')).toBe('school');
    const entry = NAV_ITEMS.find((i) => i.to === VIDEOS_PATH)!;
    expect(entry).toMatchObject({ label: 'videos', section: 'school', badge: 'videosWaiting' });
    for (const p of ['videos.read', 'videos.add', 'videos.edit', 'videos.review'] as const) {
      expect(visibleSections(canWith([p])).map((s) => s.key), p).toEqual(['school']);
    }
    expect(visibleSections(canWith(builtIn('office_helper'))).map((s) => s.key)).toEqual([]);
  });

  it('the editor-only start: "/" opens the queue for someone whose only work is editing videos', () => {
    expect(videosAreHome(['videos.edit'])).toBe(true);
    expect(videosAreHome(builtIn('video_editor'))).toBe(false);
    expect(mobileTabs('school', canWith(['videos.edit']))).toEqual(['/school', '/videos']);
  });

  it('the bottom bar: the queue first for the editor and the reviewer (Moaty), never for the director or owners', () => {
    expect(mobileTabs('school', canWith(builtIn('video_editor')))).toEqual(['/school', '/videos', '/students', '/classes']);
    expect(mobileTabs('school', canWith(MOATY))).toEqual(['/school', '/videos', '/students', '/classes']);
    expect(mobileTabs('school', canWith(builtIn('acting_coach')))).toEqual(['/school', '/schedule', '/classes', '/students']);
    expect(mobileTabs('school', canWith(builtIn('executive_director')))).toEqual(['/school', '/admissions', '/students', '/classes']);
    expect(mobileTabs('school', canWith([...PERMISSIONS]))).toEqual(['/school', '/admissions', '/students', '/classes']);
    expect(videosFirst(canWith(builtIn('video_editor')))).toBe(true);
    expect(videosFirst(canWith(builtIn('executive_director')))).toBe(false);
  });

  it('after sign-in, a link to the queue is kept for whoever may open it, else "/"', () => {
    expect(landingAfterSignIn('/videos/4', canWith(builtIn('video_editor')))).toBe('/videos/4');
    expect(landingAfterSignIn('/videos', canWith(builtIn('acting_coach')))).toBe('/videos');
    expect(landingAfterSignIn('/videos', canWith(builtIn('casting_team')))).toBe('/');
    expect(landingAfterSignIn('/videos/4', canWith(builtIn('finance')))).toBe('/');
  });
});

// ── The add form ────────────────────────────────────────────────────────────

describe('the add form', () => {
  it('offers "<workshop> — <date>" as the title', () => {
    expect(defaultVideoTitle('Screen Acting I', '24 Nov 2026')).toBe('Screen Acting I — 24 Nov 2026');
    expect(defaultVideoTitle('Screen Acting I', null)).toBe('Screen Acting I');
  });

  it('tidies a pasted link: spaces off, https:// in front of a bare address; anything else is left for the server to refuse', () => {
    expect(tidyLink('  https://youtu.be/abc  ')).toBe('https://youtu.be/abc');
    expect(tidyLink('drive.google.com/file/d/1/view')).toBe('https://drive.google.com/file/d/1/view');
    expect(tidyLink('we.tl/t-abc')).toBe('https://we.tl/t-abc');
    expect(tidyLink('javascript:alert(1)')).toBe('javascript:alert(1)');
    expect(tidyLink('not a link')).toBe('not a link');
    expect(tidyLink('')).toBe('');
  });

  it('one tap ticks or unticks a student', () => {
    expect(toggleStudent([1, 2], 3)).toEqual([1, 2, 3]);
    expect(toggleStudent([1, 2, 3], 2)).toEqual([1, 3]);
  });

  it('shows the link’s host next to it', () => {
    expect(videoLinkHost('https://www.youtube.com/watch?v=1')).toBe('youtube.com');
    expect(videoLinkHost('https://drive.google.com/file/d/1')).toBe('drive.google.com');
    expect(videoLinkHost('nonsense')).toBeNull();
    expect(videoLinkHost(null)).toBeNull();
  });
});

// ── Words and the route table ───────────────────────────────────────────────

describe('the words on screen and the route table', () => {
  beforeAll(() => {
    vi.stubGlobal('document', { documentElement: {} });
  });
  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('every videos:errors.* key the server and the shared schemas answer has words in English and Arabic', async () => {
    const { default: videos } = await import('../../src/web/features/videos/i18n');
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
    for (const f of files) for (const m of fs.readFileSync(f, 'utf8').matchAll(/'videos:errors\.(\w+)'/g)) keys.add(m[1]!);
    expect([...keys].sort()).toEqual(['invalidLink', 'notInWorkshop', 'sessionNotInWorkshop']);
    const missing = [...keys].filter((k) => !(videos.en.errors as Record<string, string>)[k] || !(videos.ar.errors as Record<string, unknown>)[k]);
    expect(missing).toEqual([]);
  });

  it('every error code of the videos API has its own words (never the generic "Something went wrong")', async () => {
    const { VIDEO_ERROR_CODES } = await import('../../src/shared/schemas/videos');
    const { videoErrorKey } = await import('../../src/web/features/videos/api');
    const { ApiError } = await import('../../src/web/lib/api');
    for (const code of Object.values(VIDEO_ERROR_CODES)) expect(videoErrorKey(new ApiError(409, code, code)), code).toMatch(/^videos:/);
    expect(videoErrorKey(new ApiError(400, 'validation', 'x', [{ path: ['rawLink'], code: 'custom', message: 'videos:errors.invalidLink' }]))).toBe('videos:errors.invalidLink');
  });

  it('statuses and kinds have words in both languages, and every video alert has its own icon in the bell', async () => {
    const { default: common } = await import('../../src/web/i18n/common');
    const { VIDEO_KINDS, VIDEO_STATUSES } = await import('../../src/shared/enums');
    for (const lang of ['en', 'ar'] as const) {
      const enums = common[lang].enums as Record<string, Record<string, string>>;
      for (const s of VIDEO_STATUSES) expect(enums.videoStatus![s], `${lang} ${s}`).toBeTruthy();
      for (const k of VIDEO_KINDS) expect(enums.videoKind![k], `${lang} ${k}`).toBeTruthy();
    }
    const { notificationLook } = await import('../../src/web/features/team/components/HeaderButtons');
    const { Bell } = await import('lucide-react');
    for (const kind of ['video_new', 'video_review', 'video_changes', 'video_approved']) expect(notificationLook(kind).icon, kind).not.toBe(Bell);
  });

  it('the route table: /videos and /videos/:id, behind the videos guard', async () => {
    const { videosRoutes } = await import('../../src/web/features/videos/routes');
    expect(videosRoutes.map((r) => r.path)).toEqual(['videos', 'videos/:id']);
    for (const r of videosRoutes) expect((r.element as { type: { name?: string } }).type.name).toBe('VideosGuard');
  });
});
