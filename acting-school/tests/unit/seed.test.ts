import Database from 'better-sqlite3';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * The demo seed goes through the real API, so it breaks whenever a route's rules
 * change under it. Run it for real into a throwaway data folder.
 */
const root = path.resolve(__dirname, '../..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acting-school-seed-'));
const tsx = path.join(root, 'node_modules/.bin/tsx');

function seed(...args: string[]) {
  return spawnSync(tsx, ['src/server/db/seed.ts', ...args], {
    cwd: root,
    env: { ...process.env, DATA_DIR: dataDir, NODE_ENV: 'test' },
    encoding: 'utf8',
    timeout: 60_000,
  });
}

afterAll(() => fs.rmSync(dataDir, { recursive: true, force: true }));

describe('npm run seed', () => {
  it('fills an empty database, refuses a second run, and starts over with --reset', () => {
    const first = seed();
    expect(first.stderr).toBe('');
    expect(first.status).toBe(0);
    expect(first.stdout).toContain('owner@demo.school');

    const count = (sql: string) => {
      const db = new Database(path.join(dataDir, 'app.db'), { readonly: true });
      try {
        return (db.prepare(sql).get() as { n: number }).n;
      } finally {
        db.close();
      }
    };
    expect(count('select count(*) as n from users')).toBe(6);
    expect(count('select count(*) as n from students')).toBeGreaterThanOrEqual(20);
    expect(count('select count(*) as n from courses')).toBeGreaterThanOrEqual(4);
    expect(count('select count(*) as n from attendance')).toBeGreaterThan(100);
    expect(count('select count(*) as n from talent')).toBeGreaterThanOrEqual(12);
    expect(count('select count(*) as n from talent_photos')).toBeGreaterThan(5);
    expect(count('select count(distinct status) as n from submissions')).toBe(7);
    expect(fs.readdirSync(path.join(dataDir, 'uploads')).length).toBeGreaterThan(5);

    const again = seed();
    expect(again.status).toBe(1);
    expect(again.stderr).toContain('--reset');
    expect(count('select count(*) as n from users')).toBe(6);

    const reset = seed('--reset');
    expect(reset.status).toBe(0);
    expect(count('select count(*) as n from users')).toBe(6);
  }, 90_000);
});
