-- 2026-09-12: public team page. Title ("Founder · Sports recovery specialist"), longer story, certifications (one per line), Instagram handle.
ALTER TABLE therapists ADD COLUMN title TEXT;
ALTER TABLE therapists ADD COLUMN story TEXT;
ALTER TABLE therapists ADD COLUMN certs TEXT;
ALTER TABLE therapists ADD COLUMN instagram TEXT;
