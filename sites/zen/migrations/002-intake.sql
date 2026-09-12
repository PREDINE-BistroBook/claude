-- 2026-09-12: client intake (where they live, goals, pain areas, health flags) + recommended centre.
-- Applied to production via the Cloudflare D1 console on 2026-09-12. Fresh installs get these columns from schema.sql.
ALTER TABLE users ADD COLUMN country TEXT;
ALTER TABLE users ADD COLUMN city_text TEXT;
ALTER TABLE users ADD COLUMN nearest_city TEXT;
ALTER TABLE users ADD COLUMN intake TEXT;
