-- 2026-09-13: the lookups the admin actually does, indexed (name / email / phone / code / date), and the ones the site does on every request
CREATE INDEX IF NOT EXISTS bookings_email ON bookings(email);
CREATE INDEX IF NOT EXISTS bookings_user ON bookings(user_id, date);
CREATE INDEX IF NOT EXISTS bookings_city_date ON bookings(city, date, status);
CREATE INDEX IF NOT EXISTS bookings_therapist_date ON bookings(therapist_id, date);
CREATE INDEX IF NOT EXISTS bookings_name ON bookings(name);
CREATE INDEX IF NOT EXISTS bookings_phone ON bookings(phone);
CREATE INDEX IF NOT EXISTS users_phone ON users(phone);
CREATE INDEX IF NOT EXISTS users_name ON users(name);
CREATE INDEX IF NOT EXISTS users_city ON users(city, nearest_city);
CREATE INDEX IF NOT EXISTS gifts_code ON gifts(code);
CREATE INDEX IF NOT EXISTS gifts_emails ON gifts(buyer_email, recipient_email);
CREATE INDEX IF NOT EXISTS applications_email ON applications(email);
CREATE INDEX IF NOT EXISTS therapist_prices_service ON therapist_prices(service_id, offered);
