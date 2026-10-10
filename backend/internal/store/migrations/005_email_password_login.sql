-- Email + password sign-in (alongside GitHub login). Only a salted PBKDF2 hash is stored.
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX IF NOT EXISTS users_local_email_idx ON users (lower(email)) WHERE github_id IS NULL AND password_hash <> '';
CREATE INDEX IF NOT EXISTS workspace_members_user_idx ON workspace_members (user_id);
