-- 2026-09-12: admins sign in with their email or a username of their choosing (both, once they have an email).
ALTER TABLE admins ADD COLUMN username TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS admins_username ON admins(username) WHERE username IS NOT NULL;
