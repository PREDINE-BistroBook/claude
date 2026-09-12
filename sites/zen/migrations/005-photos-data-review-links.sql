-- 2026-09-12 (late): photos can live in D1 (base64) until R2 is enabled; Google-review links per city.
ALTER TABLE photos ADD COLUMN data TEXT;
INSERT OR IGNORE INTO settings VALUES ('review_cairo', '');
INSERT OR IGNORE INTO settings VALUES ('review_dahab', '');
INSERT OR IGNORE INTO settings VALUES ('review_florence', '');
