-- 2026-09-13: partner codes get a kind (partner / hostel / gym / corporate), a contact and who created them,
-- so the owner AND a city's partner-level admin can hand out gym and corporate codes without us.
ALTER TABLE partners ADD COLUMN kind TEXT DEFAULT 'partner';
ALTER TABLE partners ADD COLUMN contact TEXT;
ALTER TABLE partners ADD COLUMN created_by TEXT;
