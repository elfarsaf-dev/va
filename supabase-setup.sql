-- Jalankan SQL ini di Supabase SQL Editor
-- https://supabase.com/dashboard/project/bgwkwlrkvbspycqsdeif/sql

-- Buat tabel videos
CREATE TABLE IF NOT EXISTS videos (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT NOT NULL,
  url         TEXT NOT NULL,
  category    TEXT,
  description TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

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
-- Worker kita sudah punya password guard sendiri, jadi anon key bisa write
CREATE POLICY "Anon write access"
  ON videos FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anon update access"
  ON videos FOR UPDATE
  USING (true);

CREATE POLICY "Anon delete access"
  ON videos FOR DELETE
  USING (true);

-- Contoh data awal (opsional, hapus jika tidak perlu)
INSERT INTO videos (title, url, category, description) VALUES
  ('Belajar JavaScript Modern', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'Tutorial', 'Pengenalan JavaScript ES6+ untuk pemula'),
  ('Intro to Cloudflare Workers', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'Cloud', 'Membangun serverless app dengan Cloudflare Workers'),
  ('Supabase untuk Pemula', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'Database', 'Setup Supabase dari nol sampai production')
ON CONFLICT DO NOTHING;
