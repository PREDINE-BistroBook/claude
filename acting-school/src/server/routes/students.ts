import { and, asc, desc, eq, or, sql, type SQL } from 'drizzle-orm';
import { Hono } from 'hono';
import type { ListResponse } from '../../shared/schemas/common';
import {
  STUDENT_CONTACT_FIELDS,
  studentInput,
  studentListQuery,
  studentUpdateInput,
  type Student,
  type StudentDetail,
  type StudentListItem,
} from '../../shared/schemas/students';
import type { SessionUser } from '../../shared/schemas/auth';
import type { DB } from '../db/database';
import { attendance, classSessions, courses, enrollments, files, students, talent } from '../db/schema';
import type { AppEnv } from '../env';
import { schoolToday } from '../lib/clock';
import { courseScope, hasPermission, ownCourseIds, redactContact, seesAllClasses, studentScope, withoutContact } from '../lib/access';
import { reopenLeadsOfStudent } from '../lib/admissions';
import { ApiError, notFound } from '../lib/errors';
import { phoneSearchDigits, withPhoneDigits } from '../lib/phone';
import { contains } from '../lib/sqlLimits';
import { getSettings } from '../lib/settings';
import { body, paramId, query } from '../lib/validate';
import { currentUser, requireAuth, requirePermission } from '../middleware/auth';

/**
 * Students: the school's people. students.read shows them — only those in
 * your own classes, or that you added, unless you also have classes.all
 * (anyone else is a 404);
 * students.write changes them. Phone, email, guardian and emergency contacts
 * need students.contact: without it they come back null (contactHidden: true),
 * aren't searched and are ignored on writes. Deleting a student removes their
 * enrollments and attendance (FK cascade); a linked talent profile is kept,
 * unlinked; an admissions enquiry enrolled as them goes back to 'accepted'.
 */
const router = new Hono<AppEnv>();
router.use(requireAuth);

const canRead = requirePermission('students.read');
const canWrite = requirePermission('students.write');

type StudentRow = typeof students.$inferSelect;

const seesContact = (user: SessionUser) => hasPermission(user, 'students.contact');

function toStudent(r: StudentRow, user: SessionUser): Student {
  return redactContact(
    {
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
    },
    STUDENT_CONTACT_FIELDS,
    seesContact(user),
  );
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

/** The student, if this person may see them; a 404 otherwise (not in a class they teach, or no such student). */
function findStudent(db: DB, id: number, user: SessionUser): StudentRow {
  const row = db
    .select()
    .from(students)
    .where(and(eq(students.id, id), studentScope(user)))
    .get();
  if (!row) throw notFound('Student not found');
  return row;
}

/**
 * Name search; email and phone too only for someone who may see them (otherwise a search would reveal them).
 * Substring matches with instr, not LIKE (no pattern-length limit on Durable Objects: lib/sqlLimits.ts).
 */
function searchCondition(q: string, withContact: boolean, countryCode: string): SQL {
  const term = q.replace(/\s+/g, ' ');
  const parts: SQL[] = [
    contains(students.firstName, term),
    contains(students.lastName, term),
    contains(sql`(${students.firstName} || ' ' || ${students.lastName})`, term),
    contains(sql`(${students.lastName} || ' ' || ${students.firstName})`, term),
  ];
  if (withContact) {
    parts.push(contains(students.email, term), contains(students.phone, term));
    // Phone digits in any format ("050 123 4567" finds "0501234567", Arabic digits too).
    for (const digits of phoneSearchDigits(term, countryCode) ?? []) parts.push(contains(students.phoneDigits, digits));
  }
  return or(...parts)!;
}

// ── List ────────────────────────────────────────────────────────────────────

router.get('/', canRead, (c) => {
  const { q, status } = query(c, studentListQuery);
  const db = c.get('db');
  const me = currentUser(c);
  const all = seesAllClasses(me);

  // One grouped subquery for every student's active-enrollment count (no per-row queries).
  const active = db
    .select({ studentId: enrollments.studentId, n: sql<number>`count(*)`.as('n') })
    .from(enrollments)
    .where(and(eq(enrollments.status, 'enrolled'), all ? undefined : sql`${enrollments.courseId} in (${ownCourseIds(me.id)})`))
    .groupBy(enrollments.studentId)
    .as('active_enrollments');

  const conditions: SQL[] = [];
  const scope = studentScope(me);
  if (scope) conditions.push(scope);
  if (status) conditions.push(eq(students.status, status));
  if (q) conditions.push(searchCondition(q, seesContact(me), getSettings(db).defaultCountryCode));

  const rows = db
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
  const items: StudentListItem[] = rows.map((r) => redactContact(r, STUDENT_CONTACT_FIELDS, seesContact(me)));

  const res: ListResponse<StudentListItem> = { items };
  return c.json(res);
});

// ── Create ──────────────────────────────────────────────────────────────────

router.post('/', canWrite, async (c) => {
  const me = currentUser(c);
  const input = withoutContact(await body(c, studentInput), STUDENT_CONTACT_FIELDS, seesContact(me));
  const db = c.get('db');
  assertPhotoExists(db, input.photoFileId);
  const created = db
    .insert(students)
    .values(
      withPhoneDigits({
        ...input,
        status: input.status ?? 'active',
        joinedOn: input.joinedOn ?? schoolToday(c),
        mediaConsent: input.mediaConsent ?? false,
        createdBy: me.id,
      }),
    )
    .returning()
    .get();
  return c.json(toStudent(created, me), 201);
});

// ── Detail ──────────────────────────────────────────────────────────────────

router.get('/:id', canRead, (c) => {
  const id = paramId(c);
  const db = c.get('db');
  const me = currentUser(c);
  const row = findStudent(db, id, me);
  // Without classes.all, only their enrollments (and attendance) in classes you teach.
  const visibleCourses = courseScope(me);

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
    .where(and(eq(enrollments.studentId, id), visibleCourses))
    .orderBy(desc(enrollments.enrolledOn), desc(enrollments.id))
    .all();

  const counts = db
    .select({ status: attendance.status, n: sql<number>`count(*)`.mapWith(Number) })
    .from(attendance)
    .innerJoin(classSessions, eq(classSessions.id, attendance.sessionId))
    .innerJoin(courses, eq(courses.id, classSessions.courseId))
    .where(and(eq(attendance.studentId, id), visibleCourses))
    .groupBy(attendance.status)
    .all();
  const totals: StudentDetail['attendance'] = { present: 0, late: 0, absent: 0, excused: 0, total: 0 };
  for (const r of counts) {
    totals[r.status] = r.n;
    totals.total += r.n;
  }

  const talentRow = db.select({ id: talent.id }).from(talent).where(eq(talent.studentId, id)).get();

  const res: StudentDetail = {
    ...toStudent(row, me),
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
  const me = currentUser(c);
  const existing = findStudent(db, id, me);
  const input = withoutContact(await body(c, studentUpdateInput), STUDENT_CONTACT_FIELDS, seesContact(me));
  assertPhotoExists(db, input.photoFileId);

  const patch = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) as Partial<typeof students.$inferInsert>;
  if (!Object.keys(patch).length) return c.json(toStudent(existing, me));
  const updated = db.update(students).set(withPhoneDigits(patch)).where(eq(students.id, id)).returning().get();
  if (!updated) throw notFound('Student not found');
  return c.json(toStudent(updated, me));
});

// ── Delete ──────────────────────────────────────────────────────────────────

router.delete('/:id', canWrite, (c) => {
  const id = paramId(c);
  const db = c.get('db');
  const me = currentUser(c);
  findStudent(db, id, me);
  db.transaction((tx) => {
    // An enquiry enrolled as this student goes back to 'accepted' (admissions), so it can be enrolled again.
    reopenLeadsOfStudent(tx, id, me.id);
    // Enrollments and attendance cascade; talent.student_id is set to NULL (see db/schema.ts).
    const deleted = tx.delete(students).where(eq(students.id, id)).returning({ id: students.id }).get();
    if (!deleted) throw notFound('Student not found');
  });
  return c.body(null, 204);
});

export default router;
