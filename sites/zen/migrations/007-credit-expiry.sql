-- 2026-09-12: birthday reward is 50% and only valid from 10 days before to 5 days after the birthday, so credits can expire.
ALTER TABLE credits ADD COLUMN expires_at TEXT;
UPDATE settings SET value = '50' WHERE key = 'birthday_pct';
