-- 2026-09-14: a therapist's own services (Ash: "why can't Shika and the other therapists add or change products?"). NULL = the city's list, the owner's.
ALTER TABLE services ADD COLUMN therapist_id TEXT;
