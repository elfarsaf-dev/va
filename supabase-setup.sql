-- Jalankan SQL ini di Supabase SQL Editor
-- https://supabase.com/dashboard/project/bgwkwlrkvbspycqsdeif/sql

-- Buat tabel videos
CREATE TABLE IF NOT EXISTS videos (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT NOT NULL,
  url         TEXT NOT NULL,
  category    TEXT,
  description TEXT,
  duration    INTEGER,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- UNIQUE constraint pada url — duplikat ditangani di sisi Supabase,
-- bukan di client. Insert dengan url yang sama akan di-ignore otomatis.
ALTER TABLE videos ADD CONSTRAINT videos_url_unique UNIQUE (url);

-- Index untuk pencarian dan sorting
CREATE INDEX IF NOT EXISTS idx_videos_created_at ON videos (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_videos_category   ON videos (category);

-- Enable Row Level Security (RLS)
ALTER TABLE videos ENABLE ROW LEVEL SECURITY;

-- Policy: siapapun bisa READ (publik)
CREATE POLICY "Public read access"
  ON videos FOR SELECT
  USING (true);

-- Policy: INSERT/UPDATE/DELETE pakai anon key (worker kita yang handle auth-nya)
CREATE POLICY "Anon write access"
  ON videos FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anon update access"
  ON videos FOR UPDATE
  USING (true);

CREATE POLICY "Anon delete access"
  ON videos FOR DELETE
  USING (true);

-- Kalau tabel sudah ada dan belum punya UNIQUE constraint,
-- jalankan ini saja untuk tambah constraint-nya:
-- ALTER TABLE videos ADD CONSTRAINT videos_url_unique UNIQUE (url);
