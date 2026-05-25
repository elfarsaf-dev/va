const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseUrl = "https://bgwkwlrkvbspycqsdeif.supabase.co";

if (!serviceRoleKey) {
  console.error("SUPABASE_SERVICE_ROLE_KEY not set");
  process.exit(1);
}

const sql = `
CREATE TABLE IF NOT EXISTS videos (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT NOT NULL,
  url         TEXT NOT NULL,
  category    TEXT,
  description TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_videos_created_at ON videos (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_videos_category   ON videos (category);

ALTER TABLE videos ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'videos' AND policyname = 'Public read access') THEN
    CREATE POLICY "Public read access" ON videos FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'videos' AND policyname = 'Anon write access') THEN
    CREATE POLICY "Anon write access" ON videos FOR INSERT WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'videos' AND policyname = 'Anon update access') THEN
    CREATE POLICY "Anon update access" ON videos FOR UPDATE USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'videos' AND policyname = 'Anon delete access') THEN
    CREATE POLICY "Anon delete access" ON videos FOR DELETE USING (true);
  END IF;
END$$;
`;

// Supabase supports running SQL via the pg REST endpoint using service role
const res = await fetch(`${supabaseUrl}/rest/v1/`, {
  method: "HEAD",
  headers: {
    "apikey": serviceRoleKey,
    "Authorization": `Bearer ${serviceRoleKey}`,
  }
});
console.log("Auth check status:", res.status);

// Use the Supabase SQL API (available for service role)
const sqlRes = await fetch(`${supabaseUrl}/rest/v1/rpc/`, {
  method: "GET",
  headers: {
    "apikey": serviceRoleKey,
    "Authorization": `Bearer ${serviceRoleKey}`,
  }
});
console.log("RPC check:", sqlRes.status);

// Try pg directly via Supabase's direct database connection approach
// Supabase exposes a /pg endpoint for service role SQL execution
const pgRes = await fetch(`${supabaseUrl}/pg`, {
  method: "POST", 
  headers: {
    "apikey": serviceRoleKey,
    "Authorization": `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({ query: sql })
});

console.log("PG endpoint status:", pgRes.status);
const pgText = await pgRes.text();
console.log("PG response:", pgText.substring(0, 500));
