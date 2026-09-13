-- 2026-09-13: read receipts for the chat (WhatsApp-style ticks): when each side last opened the conversation
ALTER TABLE chats ADD COLUMN client_read_at TEXT;
ALTER TABLE chats ADD COLUMN team_read_at TEXT;
