-- 2026-09-13: services carry Italian/Arabic (name, description) like profiles; a therapist can have their own price per service
ALTER TABLE services ADD COLUMN i18n TEXT;
CREATE TABLE IF NOT EXISTS therapist_prices (therapist_id TEXT NOT NULL, service_id TEXT NOT NULL, amount INTEGER NOT NULL, PRIMARY KEY (therapist_id, service_id));
