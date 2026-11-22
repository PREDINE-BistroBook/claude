import { and, asc, desc, eq, or, sql, type SQL } from 'drizzle-orm';
import { Hono } from 'hono';
import { todayISO } from '../../shared/dates';
import type { ListResponse } from '../../shared/schemas/common';
import {
  studentInput,
  studentListQuery,
  studentUpdateInput,
  type Student,
  type StudentDetail,
  type StudentListItem,
} from '../../shared/schemas/students';
import type { DB } from '../db/client';
import { attendance, courses, enrollments, files, students, talent } from '../db/schema';
import type { AppEnv } from '../env';
import { ApiError, notFound } from '../lib/errors';
import { body, paramId, query } from '../lib/validate';
import { requireAuth, requirePermission } from '../middleware/auth';

/**
 * Students: the school's people. Everyone on staff can read them; owners and
 * admins can change them. Deleting a student removes their enrollments and
 * attendance (FK cascade); a linked talent profile is kept, unlinked.
 */
const router = new Hono<AppEnv>();
router.use(requireAuth);

const canRead = requirePermission('students.read');
const canWrite = requirePermission('students.write');

type StudentRow = typeof students.$inferSelect;

function toStudent(r: StudentRow): Student {
  return {
    id: r.id,
    firstName: r.firstName,
    lastName: r.lastName,
    email: r.email,
    phone: r.phone,
    dateOfBirth: r.dateOfBirth,
    gender: r.gender,
    status: r.status,
    joinedOn: r.joinedOn,
    guardianName: r.guardianName,
    guardianPhone: r.guardianPhone,
    guardianEmail: r.guardianEmail,
    emergencyName: r.emergencyName,
    emergencyPhone: r.emergencyPhone,
    photoFileId: r.photoFileId,
    mediaConsent: r.mediaConsent,
    notes: r.notes,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

/** A photo id must name an uploaded file; otherwise a field-level 400 on photoFileId. */
function assertPhotoExists(db: DB, fileId: string | null | undefined) {
  if (!fileId) return;
  const found = db.select({ id: files.id }).from(files).where(eq(files.id, fileId)).get();
  if (!found) {
    throw new ApiError(400, 'validation', 'Some fields are missing or invalid', [
      { path: ['photoFileId'], code: 'custom', message: 'students:errors.photoNotFound' },
    ]);
  }
}

function findStudent(db: DB, id: number): StudentRow {
  const row = db.select().from(students).where(eq(students.id, id)).get();
  if (!row) throw notFound('Student not found');
  return row;
}

/** Escape LIKE wildcards so a search for "50%" or "a_b" is taken literally. */
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);
const likeEscaped = (expr: SQL, pattern: string) => sql`${expr} like ${pattern} escape '\\'`;

/** Phone digits with common separators removed, for matching "050 123 4567" against "0501234567". */
const phoneDigitsSql = sql`replace(replace(replace(replace(replace(coalesce(${students.phone}, ''), ' ', ''), '-', ''), '(', ''), ')', ''), '+', '')`;

function searchCondition(q: string): SQL {
  const term = q.replace(/\s+/g, ' ');
  const pattern = `%${escapeLike(term)}%`;
  const parts: SQL[] = [
    likeEscaped(sql`${students.firstName}`, pattern),
    likeEscaped(sql`${students.lastName}`, pattern),
    likeEscaped(sql`(${students.firstName} || ' ' || ${students.lastName})`, pattern),
    likeEscaped(sql`(${students.lastName} || ' ' || ${students.firstName})`, pattern),
    likeEscaped(sql`${students.email}`, pattern),
    likeEscaped(sql`${students.phone}`, pattern),
  ];
  const digits = term.replace(/[\s\-().+]/g, '');
  if (/^\d{3,}$/.test(digits)) parts.push(sql`${phoneDigitsSql} like ${`%${digits}%`}`);
  return or(...parts)!;
}

// ── List ────────────────────────────────────────────────────────────────────

router.get('/', canRead, (c) => {
  const { q, status } = query(c, studentListQuery);
  const db = c.get('db');

  // One grouped subquery for every student's active-enrollment count (no per-row queries).
  const active = db
    .select({ studentId: enrollments.studentId, n: sql<number>`count(*)`.as('n') })
    .from(enrollments)
    .where(eq(enrollments.status, 'enrolled'))
    .groupBy(enrollments.studentId)
    .as('active_enrollments');

  const conditions: SQL[] = [];
  if (status) conditions.push(eq(students.status, status));
  if (q) conditions.push(searchCondition(q));

  const items: StudentListItem[] = db
    .select({
      id: students.id,
      firstName: students.firstName,
      lastName: students.lastName,
      email: students.email,
      phone: students.phone,
      dateOfBirth: students.dateOfBirth,
      status: students.status,
      photoFileId: students.photoFileId,
      activeEnrollments: sql<number>`coalesce(${active.n}, 0)`.mapWith(Number),
    })
    .from(students)
    .leftJoin(active, eq(active.studentId, students.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(sql`${students.lastName} collate nocase`, sql`${students.firstName} collate nocase`, asc(students.id))
    .all();

  const res: ListResponse<StudentListItem> = { items };
  return c.json(res);
});

// ── Create ──────────────────────────────────────────────────────────────────

router.post('/', canWrite, async (c) => {
  const input = await body(c, studentInput);
  const db = c.get('db');
  assertPhotoExists(db, input.photoFileId);
  const created = db
    .insert(students)
    .values({
      ...input,
      status: input.status ?? 'active',
      joinedOn: input.joinedOn ?? todayISO(),
      mediaConsent: input.mediaConsent ?? false,
    })
    .returning()
    .get();
  return c.json(toStudent(created), 201);
});

// ── Detail ──────────────────────────────────────────────────────────────────

router.get('/:id', canRead, (c) => {
  const id = paramId(c);
  const db = c.get('db');
  const row = findStudent(db, id);

  const enrollmentRows = db
    .select({
      id: enrollments.id,
      courseId: enrollments.courseId,
      courseName: courses.name,
      courseColor: courses.color,
      status: enrollments.status,
      enrolledOn: enrollments.enrolledOn,
    })
    .from(enrollments)
    .innerJoin(courses, eq(courses.id, enrollments.courseId))
    .where(eq(enrollments.studentId, id))
    .orderBy(desc(enrollments.enrolledOn), desc(enrollments.id))
    .all();

  const counts = db
    .select({ status: attendance.status, n: sql<number>`count(*)`.mapWith(Number) })
    .from(attendance)
    .where(eq(attendance.studentId, id))
    .groupBy(attendance.status)
    .all();
  const totals: StudentDetail['attendance'] = { present: 0, late: 0, absent: 0, excused: 0, total: 0 };
  for (const r of counts) {
    totals[r.status] = r.n;
    totals.total += r.n;
  }

  const talentRow = db.select({ id: talent.id }).from(talent).where(eq(talent.studentId, id)).get();

  const res: StudentDetail = {
    ...toStudent(row),
    enrollments: enrollmentRows,
    attendance: totals,
    talentId: talentRow?.id ?? null,
  };
  return c.json(res);
});

// ── Update ──────────────────────────────────────────────────────────────────

router.patch('/:id', canWrite, async (c) => {
  const id = paramId(c);
  const db = c.get('db');
  const existing = findStudent(db, id);
  const input = await body(c, studentUpdateInput);
  assertPhotoExists(db, input.photoFileId);

  const patch = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) as Partial<typeof students.$inferInsert>;
  if (!Object.keys(patch).length) return c.json(toStudent(existing));
  const updated = db.update(students).set(patch).where(eq(students.id, id)).returning().get();
  if (!updated) throw notFound('Student not found');
  return c.json(toStudent(updated));
});

// ── Delete ──────────────────────────────────────────────────────────────────

router.delete('/:id', canWrite, (c) => {
  const id = paramId(c);
  // Enrollments and attendance cascade; talent.student_id is set to NULL (see db/schema.ts).
  const result = c.get('db').delete(students).where(eq(students.id, id)).run();
  if (result.changes === 0) throw notFound('Student not found');
  return c.body(null, 204);
});

export default router;
