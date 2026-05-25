# Cara Deploy ke Cloudflare Workers

## 1. Setup Supabase (sekali saja)

1. Buka https://supabase.com/dashboard/project/bgwkwlrkvbspycqsdeif/sql
2. Copy isi file `supabase-setup.sql` dan jalankan di SQL Editor

## 2. Install Wrangler CLI

```bash
npm install -g wrangler
```

## 3. Login ke Cloudflare

```bash
wrangler login
```

## 4. Set Secrets

```bash
wrangler secret put SUPABASE_ANON_KEY
# (paste nilai SUPABASE_ANON_KEY kamu)

wrangler secret put ADMIN_PASSWORD
# (paste password admin kamu)

wrangler secret put SESSION_SECRET
# (buat string random panjang, misal: openssl rand -base64 32)
```

## 5. Deploy

```bash
wrangler deploy
```

Selesai! Worker akan live di `https://video-koleksi.<subdomain-kamu>.workers.dev`

## File penting

| File | Keterangan |
|------|-----------|
| `worker.js` | Seluruh kode aplikasi (SSR, routing, HTML, CSS) |
| `wrangler.toml` | Konfigurasi Cloudflare Workers |
| `supabase-setup.sql` | SQL untuk buat tabel di Supabase |

## Fitur

- **Halaman publik** (`/`) — koleksi video dengan search & filter kategori
- **Login admin** (`/login`) — akses dengan password
- **Panel admin** (`/admin`) — tambah, edit, hapus video
- **Modal player** — embed YouTube/Vimeo otomatis saat klik video
- **SSR penuh** — semua dirender di server (Cloudflare Edge)
