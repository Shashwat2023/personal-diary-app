-- ============================================================
-- Personal Diary Application — Seed Data
-- ============================================================
-- Run AFTER schema.sql:
--   psql -U postgres -d personal_diary -f seed.sql
--
-- Test credentials:
--   Email:    testuser@example.com
--   Password: password123
-- ============================================================

-- Clear existing seed data (safe for dev re-runs)
DELETE FROM entries WHERE user_id IN (
    SELECT id FROM users WHERE email = 'testuser@example.com'
);
DELETE FROM users WHERE email = 'testuser@example.com';

-- ============================================================
-- SEED: Test User
-- Password: password123  (bcrypt, 12 rounds)
-- ============================================================
INSERT INTO users (id, username, email, password)
VALUES (
    'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    'TestUser',
    'testuser@example.com',
    '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewFpwmWWfQcLCBre'
    -- bcrypt hash of: password123
);

-- ============================================================
-- SEED: Sample Diary Entries
-- ============================================================
INSERT INTO entries (id, user_id, title, content, mood, tags, created_at, updated_at)
VALUES
(
    'b1ff1c00-1a2b-3c4d-5e6f-7a8b9c0d1e2f',
    'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    'First Day with My Diary',
    'Today I started writing in my new digital diary. It feels strange at first — typing thoughts instead of handwriting them. But I think I will enjoy having everything searchable and organized. I want to write every day and track how my thoughts change over time.',
    'happy',
    ARRAY['start', 'reflection', 'goals'],
    '2026-04-13 09:15:00+00',
    '2026-04-13 09:15:00+00'
),
(
    'c2ee2d11-2b3c-4d5e-6f7a-8b9c0d1e2f3a',
    'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    'A Productive Wednesday',
    'Had a really productive morning today. Finished the backend setup for my diary project — the Express API is running smoothly and all the endpoints are working. I also made a proper database schema with UUID primary keys and soft delete. Feeling accomplished. In the evening I read a book and went for a 30-minute walk. Small wins matter.',
    'content',
    ARRAY['work', 'productivity', 'coding'],
    '2026-04-14 20:30:00+00',
    '2026-04-14 20:30:00+00'
),
(
    'd3ff3e22-3c4d-5e6f-7a8b-9c0d1e2f3a4b',
    'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    NULL,
    'Just a quick note before bed. Some days you do not need a title — you just need to let the thoughts out. The stars were visible tonight through my window. I thought about how much has changed in the last year and how much more I want to do. Tomorrow is a new page.',
    'calm',
    ARRAY['night', 'thoughts'],
    '2026-04-15 23:05:00+00',
    '2026-04-15 23:05:00+00'
);
