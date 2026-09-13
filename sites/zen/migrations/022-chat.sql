-- 2026-09-13: in-site chat between a client and a therapist (or a city's room when no therapist is picked).
CREATE TABLE IF NOT EXISTS chats (id TEXT PRIMARY KEY, key TEXT UNIQUE NOT NULL, user_id TEXT NOT NULL, therapist_id TEXT, city TEXT NOT NULL, last_at TEXT, last_body TEXT, last_from TEXT, client_unread INTEGER DEFAULT 0, team_unread INTEGER DEFAULT 0, client_notified_at TEXT, team_notified_at TEXT, created_at TEXT DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS chats_user ON chats(user_id, last_at);
CREATE INDEX IF NOT EXISTS chats_therapist ON chats(therapist_id, last_at);
CREATE TABLE IF NOT EXISTS chat_messages (id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, sender TEXT NOT NULL, admin_id TEXT, admin_name TEXT, body TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS chat_messages_chat ON chat_messages(chat_id, created_at);
