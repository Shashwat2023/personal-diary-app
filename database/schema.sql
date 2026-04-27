-- ============================================================
-- Personal Diary Application — PostgreSQL Schema
-- ============================================================
-- sudo -u postgres psql
-- 
-- Run: psql -U postgres -d personal_diary -f schema.sql
-- Run: psql -U postgres -d personal_diary -f database/seed.sql

-- ============================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- USERS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username    TEXT NOT NULL CHECK (char_length(username) BETWEEN 2 AND 50),
    email       TEXT NOT NULL UNIQUE CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'),
    password    TEXT NOT NULL,   -- bcrypt hashed
    created_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Index for fast email lookups during login
CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);

-- ============================================================
-- ENTRIES TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS entries (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       TEXT,                             -- optional
    content     TEXT NOT NULL,
    mood        TEXT,                             -- optional e.g. 'happy', 'sad'
    tags        TEXT[],                           -- optional array of tag strings
    created_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at  TIMESTAMP WITH TIME ZONE          -- soft-delete: NULL = active
);

-- Index for fast per-user entry lookups
CREATE INDEX IF NOT EXISTS idx_entries_user_id ON entries (user_id);

-- Index to speed up soft-delete filtering
CREATE INDEX IF NOT EXISTS idx_entries_deleted_at ON entries (deleted_at) WHERE deleted_at IS NULL;

-- Index for date-based filtering
CREATE INDEX IF NOT EXISTS idx_entries_created_at ON entries (created_at DESC);

-- ============================================================
-- FUNCTION: auto-update updated_at on row modification
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attach trigger to entries table
DROP TRIGGER IF EXISTS set_entries_updated_at ON entries;
CREATE TRIGGER set_entries_updated_at
    BEFORE UPDATE ON entries
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- VIEW: active_entries — excludes soft-deleted entries
-- ============================================================
CREATE OR REPLACE VIEW active_entries AS
    SELECT id, user_id, title, content, mood, tags, created_at, updated_at
    FROM entries
    WHERE deleted_at IS NULL;


