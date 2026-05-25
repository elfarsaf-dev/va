// Cloudflare Worker - Video Collection SSR
// Single file deployment

const SUPABASE_URL = "https://bgwkwlrkvbspycqsdeif.supabase.co";
const SUPABASE_TABLE = "videos";

// ── Helpers ──────────────────────────────────────────────────────────────────

function getEnv(env) {
  return {
    supabaseKey: env.SUPABASE_ANON_KEY,
    adminPassword: env.ADMIN_PASSWORD,
    sessionSecret: env.SESSION_SECRET || "changeme-secret-32chars-minimum!",
  };
}

async function supabaseFetch(path, options = {}, supabaseKey) {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      "Content-Type": "application/json",
      Prefer: options.prefer || "return=representation",
      ...options.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase error ${res.status}: ${text}`);
  }
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return res.json();
  return null;
}

async function getVideos(supabaseKey, { search = "", category = "", limit = 50, offset = 0 } = {}) {
  let qs = `select=*&order=created_at.desc&limit=${limit}&offset=${offset}`;
  if (search) qs += `&or=(title.ilike.*${encodeURIComponent(search)}*,description.ilike.*${encodeURIComponent(search)}*)`;
  if (category) qs += `&category=eq.${encodeURIComponent(category)}`;
  return supabaseFetch(`${SUPABASE_TABLE}?${qs}`, {}, supabaseKey);
}

async function getVideo(id, supabaseKey) {
  const rows = await supabaseFetch(`${SUPABASE_TABLE}?id=eq.${id}&select=*`, {}, supabaseKey);
  return rows?.[0] || null;
}

async function createVideo(data, supabaseKey) {
  return supabaseFetch(SUPABASE_TABLE, {
    method: "POST",
    body: JSON.stringify(data),
    prefer: "return=representation",
  }, supabaseKey);
}

async function updateVideo(id, data, supabaseKey) {
  return supabaseFetch(`${SUPABASE_TABLE}?id=eq.${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
    prefer: "return=representation",
  }, supabaseKey);
}

async function deleteVideo(id, supabaseKey) {
  return supabaseFetch(`${SUPABASE_TABLE}?id=eq.${id}`, {
    method: "DELETE",
    prefer: "return=minimal",
  }, supabaseKey);
}

async function getCategories(supabaseKey) {
  const rows = await supabaseFetch(`${SUPABASE_TABLE}?select=category&order=category.asc`, {}, supabaseKey);
  const cats = [...new Set((rows || []).map((r) => r.category).filter(Boolean))];
  return cats;
}

// ── Session (cookie-based signed token) ──────────────────────────────────────

async function signToken(payload, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const data = JSON.stringify(payload);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  const b64 = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return btoa(data) + "." + b64;
}

async function verifyToken(token, secret) {
  try {
    const [dataB64, sigB64] = token.split(".");
    if (!dataB64 || !sigB64) return null;
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    const data = atob(dataB64);
    const sig = Uint8Array.from(atob(sigB64), (c) => c.charCodeAt(0));
    const valid = await crypto.subtle.verify("HMAC", key, sig, enc.encode(data));
    if (!valid) return null;
    return JSON.parse(data);
  } catch {
    return null;
  }
}

function getCookie(req, name) {
  const cookie = req.headers.get("Cookie") || "";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

async function isAuthenticated(req, secret) {
  const token = getCookie(req, "admin_session");
  if (!token) return false;
  const payload = await verifyToken(token, secret);
  return payload?.role === "admin";
}

// ── Embed URL helpers ─────────────────────────────────────────────────────────

function toEmbedUrl(url) {
  if (!url) return null;
  // YouTube
  const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`;
  // Vimeo
  const vim = url.match(/vimeo\.com\/(\d+)/);
  if (vim) return `https://player.vimeo.com/video/${vim[1]}`;
  // Already embed or direct
  return url;
}

function getThumbnail(url) {
  if (!url) return null;
  const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  if (yt) return `https://img.youtube.com/vi/${yt[1]}/hqdefault.jpg`;
  const vim = url.match(/vimeo\.com\/(\d+)/);
  if (vim) return `https://vumbnail.com/${vim[1]}.jpg`;
  return null;
}

// ── CSS ───────────────────────────────────────────────────────────────────────

const CSS = `
:root {
  --bg: #0f0f13;
  --bg2: #16161e;
  --bg3: #1e1e2a;
  --border: #2a2a3a;
  --accent: #7c6ff7;
  --accent2: #a78bfa;
  --text: #e2e2f0;
  --muted: #8b8ba8;
  --danger: #f97066;
  --success: #34d399;
  --radius: 10px;
  --font: 'Inter', system-ui, sans-serif;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
html { scroll-behavior: smooth; }
body {
  background: var(--bg);
  color: var(--text);
  font-family: var(--font);
  min-height: 100vh;
  line-height: 1.6;
}
a { color: inherit; text-decoration: none; }

/* NAV */
nav {
  position: sticky; top: 0; z-index: 100;
  background: rgba(15,15,19,0.85);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--border);
  padding: 0 24px;
  height: 60px;
  display: flex; align-items: center; justify-content: space-between;
}
.nav-brand {
  font-size: 1.2rem; font-weight: 700;
  background: linear-gradient(135deg, var(--accent), var(--accent2));
  -webkit-background-clip: text; -webkit-text-fill-color: transparent;
  display: flex; align-items: center; gap: 8px;
}
.nav-links { display: flex; align-items: center; gap: 12px; }
.nav-links a, .nav-links button {
  padding: 6px 16px; border-radius: 6px; font-size: 0.875rem; font-weight: 500;
  border: none; cursor: pointer; transition: all 0.2s;
  background: transparent; color: var(--muted);
}
.nav-links a:hover { color: var(--text); background: var(--bg3); }
.btn {
  display: inline-flex; align-items: center; gap-: 6px;
  padding: 8px 18px; border-radius: 8px; font-size: 0.875rem;
  font-weight: 600; border: none; cursor: pointer; transition: all 0.2s;
}
.btn-primary {
  background: var(--accent); color: #fff;
}
.btn-primary:hover { background: var(--accent2); transform: translateY(-1px); }
.btn-danger { background: var(--danger); color: #fff; }
.btn-danger:hover { opacity: 0.85; }
.btn-ghost {
  background: var(--bg3); color: var(--text); border: 1px solid var(--border);
}
.btn-ghost:hover { border-color: var(--accent); color: var(--accent); }
.btn-sm { padding: 5px 12px; font-size: 0.8rem; }

/* CONTAINER */
.container { max-width: 1200px; margin: 0 auto; padding: 0 24px; }

/* HERO */
.hero {
  padding: 64px 24px 40px;
  text-align: center;
}
.hero h1 {
  font-size: clamp(2rem, 5vw, 3.5rem);
  font-weight: 800; letter-spacing: -0.02em; line-height: 1.2;
  background: linear-gradient(135deg, #fff 30%, var(--accent2));
  -webkit-background-clip: text; -webkit-text-fill-color: transparent;
  margin-bottom: 12px;
}
.hero p { color: var(--muted); font-size: 1.1rem; max-width: 500px; margin: 0 auto 32px; }

/* SEARCH */
.search-bar {
  display: flex; gap: 10px; max-width: 560px; margin: 0 auto;
}
.search-bar input {
  flex: 1; padding: 12px 16px; background: var(--bg2);
  border: 1px solid var(--border); border-radius: 8px;
  color: var(--text); font-size: 0.95rem;
  outline: none; transition: border-color 0.2s;
}
.search-bar input:focus { border-color: var(--accent); }
.search-bar input::placeholder { color: var(--muted); }

/* FILTERS */
.filters {
  display: flex; gap: 8px; flex-wrap: wrap; margin: 24px 0;
}
.filter-btn {
  padding: 6px 14px; border-radius: 20px; font-size: 0.8rem; font-weight: 500;
  border: 1px solid var(--border); background: transparent; color: var(--muted);
  cursor: pointer; transition: all 0.2s;
}
.filter-btn:hover, .filter-btn.active {
  border-color: var(--accent); color: var(--accent);
  background: rgba(124,111,247,0.1);
}

/* GRID */
.video-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 20px;
  padding: 8px 0 48px;
}
.video-card {
  background: var(--bg2); border: 1px solid var(--border);
  border-radius: var(--radius); overflow: hidden;
  transition: transform 0.2s, border-color 0.2s, box-shadow 0.2s;
  cursor: pointer;
}
.video-card:hover {
  transform: translateY(-3px); border-color: var(--accent);
  box-shadow: 0 8px 32px rgba(124,111,247,0.15);
}
.video-thumb {
  position: relative; aspect-ratio: 16/9; background: var(--bg3); overflow: hidden;
}
.video-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.thumb-placeholder {
  width: 100%; height: 100%;
  display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, var(--bg3), #1a1a2e);
}
.play-icon {
  width: 48px; height: 48px; background: rgba(124,111,247,0.8);
  border-radius: 50%; display: flex; align-items: center; justify-content: center;
}
.video-info { padding: 14px 16px; }
.video-category {
  font-size: 0.7rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em;
  color: var(--accent2); margin-bottom: 6px;
}
.video-title {
  font-size: 0.95rem; font-weight: 600; color: var(--text);
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  margin-bottom: 6px;
}
.video-desc {
  font-size: 0.8rem; color: var(--muted); 
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  margin-bottom: 10px;
}
.video-meta { font-size: 0.75rem; color: var(--muted); display: flex; gap: 8px; align-items: center; }

/* MODAL / DETAIL */
.modal-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.8); z-index: 200;
  display: flex; align-items: center; justify-content: center; padding: 24px;
}
.modal {
  background: var(--bg2); border: 1px solid var(--border); border-radius: 14px;
  width: 100%; max-width: 780px; max-height: 90vh; overflow-y: auto;
}
.modal-header {
  padding: 20px 24px 0; display: flex; justify-content: space-between; align-items: flex-start;
}
.modal-close {
  background: var(--bg3); border: none; color: var(--muted);
  width: 32px; height: 32px; border-radius: 50%; cursor: pointer; font-size: 1.1rem;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.modal-close:hover { color: var(--text); }
.embed-wrap {
  position: relative; aspect-ratio: 16/9; background: #000; margin: 16px 24px 20px;
  border-radius: 10px; overflow: hidden;
}
.embed-wrap iframe { width: 100%; height: 100%; border: none; }
.modal-body { padding: 0 24px 24px; }
.modal-category { font-size: 0.75rem; color: var(--accent2); font-weight: 600; text-transform: uppercase; margin-bottom: 8px; }
.modal-title { font-size: 1.4rem; font-weight: 700; margin-bottom: 10px; }
.modal-desc { color: var(--muted); font-size: 0.9rem; line-height: 1.7; }

/* EMPTY STATE */
.empty {
  text-align: center; padding: 80px 24px;
  color: var(--muted);
}
.empty-icon { font-size: 3rem; margin-bottom: 16px; }
.empty h3 { font-size: 1.2rem; color: var(--text); margin-bottom: 8px; }

/* FORMS */
.form-card {
  background: var(--bg2); border: 1px solid var(--border);
  border-radius: 14px; padding: 32px; max-width: 480px; margin: 60px auto;
}
.form-title { font-size: 1.5rem; font-weight: 700; margin-bottom: 4px; }
.form-subtitle { color: var(--muted); font-size: 0.875rem; margin-bottom: 28px; }
.form-group { margin-bottom: 18px; }
.form-group label { display: block; font-size: 0.85rem; font-weight: 500; margin-bottom: 6px; }
.form-group input, .form-group select, .form-group textarea {
  width: 100%; padding: 10px 14px; background: var(--bg3);
  border: 1px solid var(--border); border-radius: 8px;
  color: var(--text); font-size: 0.9rem; font-family: inherit;
  outline: none; transition: border-color 0.2s;
}
.form-group input:focus, .form-group select:focus, .form-group textarea:focus {
  border-color: var(--accent);
}
.form-group textarea { resize: vertical; min-height: 80px; }
.form-group select option { background: var(--bg3); }
.form-actions { display: flex; gap: 10px; margin-top: 24px; }
.form-actions .btn { flex: 1; justify-content: center; }
.alert {
  padding: 12px 16px; border-radius: 8px; font-size: 0.875rem; margin-bottom: 20px;
}
.alert-error { background: rgba(249,112,102,0.1); border: 1px solid rgba(249,112,102,0.3); color: var(--danger); }
.alert-success { background: rgba(52,211,153,0.1); border: 1px solid rgba(52,211,153,0.3); color: var(--success); }

/* ADMIN */
.admin-header {
  padding: 32px 0 24px;
  border-bottom: 1px solid var(--border);
  display: flex; align-items: center; justify-content: space-between; flex-wrap: gap;
}
.admin-header h1 { font-size: 1.6rem; font-weight: 700; }
.admin-table { width: 100%; border-collapse: collapse; margin-top: 24px; }
.admin-table th {
  text-align: left; font-size: 0.75rem; font-weight: 600; color: var(--muted);
  text-transform: uppercase; letter-spacing: 0.05em;
  padding: 10px 14px; border-bottom: 1px solid var(--border);
}
.admin-table td {
  padding: 12px 14px; border-bottom: 1px solid var(--border);
  font-size: 0.875rem; vertical-align: middle;
}
.admin-table tr:last-child td { border-bottom: none; }
.admin-table tr:hover td { background: var(--bg3); }
.admin-table .actions { display: flex; gap: 6px; }
.badge {
  display: inline-block; padding: 3px 10px; border-radius: 20px;
  font-size: 0.7rem; font-weight: 600;
  background: rgba(124,111,247,0.15); color: var(--accent2);
}
.table-wrap {
  background: var(--bg2); border: 1px solid var(--border); border-radius: var(--radius);
  overflow: hidden; margin-bottom: 40px;
}
.stats { display: flex; gap: 16px; margin-bottom: 24px; flex-wrap: wrap; }
.stat-card {
  background: var(--bg2); border: 1px solid var(--border); border-radius: var(--radius);
  padding: 16px 20px; flex: 1; min-width: 120px;
}
.stat-card .stat-num { font-size: 1.8rem; font-weight: 700; color: var(--accent2); }
.stat-card .stat-label { font-size: 0.8rem; color: var(--muted); margin-top: 2px; }

/* PAGINATION */
.pagination { display: flex; gap: 8px; justify-content: center; padding: 24px 0 40px; }
.page-btn {
  width: 36px; height: 36px; border-radius: 8px; display: flex; align-items: center; justify-content: center;
  border: 1px solid var(--border); background: var(--bg2); color: var(--text);
  cursor: pointer; font-size: 0.875rem; text-decoration: none; transition: all 0.2s;
}
.page-btn:hover, .page-btn.active { border-color: var(--accent); color: var(--accent); background: rgba(124,111,247,0.1); }

/* RESPONSIVE */
@media (max-width: 600px) {
  .video-grid { grid-template-columns: 1fr 1fr; gap: 12px; }
  .search-bar { flex-direction: column; }
  .admin-table { font-size: 0.8rem; }
  .admin-table th:nth-child(3), .admin-table td:nth-child(3) { display: none; }
}
@media (max-width: 420px) {
  .video-grid { grid-template-columns: 1fr; }
}
`;

// ── HTML Layout ───────────────────────────────────────────────────────────────

function layout(title, body, { isAdmin = false, navExtra = "" } = {}) {
  return `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escHtml(title)} — VideoKoleksi</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>${CSS}</style>
</head>
<body>
<nav>
  <a class="nav-brand" href="/">
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" style="-webkit-text-fill-color:initial">
      <polygon points="5 3 19 12 5 21 5 3" fill="var(--accent)"/>
    </svg>
    VideoKoleksi
  </a>
  <div class="nav-links">
    ${isAdmin ? `
    <a href="/">Koleksi</a>
    <a href="/admin">Admin</a>
    <form method="POST" action="/logout" style="display:inline">
      <button type="submit" style="padding:6px 16px;border-radius:6px;font-size:0.875rem;font-weight:500;border:none;cursor:pointer;background:transparent;color:var(--muted)">Keluar</button>
    </form>` : ""}
    ${navExtra}
  </div>
</nav>
${body}
<script>
// Video modal
function openVideo(id) {
  document.getElementById('modal-'+id).style.display='flex';
  document.body.style.overflow='hidden';
}
function closeModal(id) {
  const m = document.getElementById('modal-'+id);
  if(m) { m.style.display='none'; document.body.style.overflow=''; }
  // pause iframe by resetting src
  const iframe = m && m.querySelector('iframe');
  if(iframe) { const s=iframe.src; iframe.src=''; iframe.src=s; }
}
document.addEventListener('keydown', e => {
  if(e.key==='Escape') document.querySelectorAll('.modal-overlay').forEach(m=>{ m.style.display='none'; document.body.style.overflow=''; });
});
</script>
</body>
</html>`;
}

function escHtml(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m lalu`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}j lalu`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}h lalu`;
  return new Date(dateStr).toLocaleDateString("id-ID");
}

// ── Page renderers ────────────────────────────────────────────────────────────

function renderVideoCard(v) {
  const thumb = getThumbnail(v.url);
  const embed = toEmbedUrl(v.url);
  return `
<div class="video-card" onclick="openVideo('${escHtml(v.id)}')">
  <div class="video-thumb">
    ${thumb
      ? `<img src="${escHtml(thumb)}" alt="${escHtml(v.title)}" loading="lazy">`
      : `<div class="thumb-placeholder"><div class="play-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="white"><polygon points="5 3 19 12 5 21 5 3"/></svg></div></div>`
    }
  </div>
  <div class="video-info">
    ${v.category ? `<div class="video-category">${escHtml(v.category)}</div>` : ""}
    <div class="video-title">${escHtml(v.title)}</div>
    ${v.description ? `<div class="video-desc">${escHtml(v.description)}</div>` : ""}
    <div class="video-meta">${v.created_at ? timeAgo(v.created_at) : ""}</div>
  </div>
</div>
<!-- Modal -->
<div class="modal-overlay" id="modal-${escHtml(v.id)}" style="display:none" onclick="if(event.target===this)closeModal('${escHtml(v.id)}')">
  <div class="modal">
    <div class="modal-header">
      <div></div>
      <button class="modal-close" onclick="closeModal('${escHtml(v.id)}')">&times;</button>
    </div>
    <div class="embed-wrap">
      <iframe src="${escHtml(embed || v.url)}" allowfullscreen allow="autoplay; encrypted-media" loading="lazy"></iframe>
    </div>
    <div class="modal-body">
      ${v.category ? `<div class="modal-category">${escHtml(v.category)}</div>` : ""}
      <div class="modal-title">${escHtml(v.title)}</div>
      ${v.description ? `<div class="modal-desc">${escHtml(v.description)}</div>` : ""}
    </div>
  </div>
</div>`;
}

async function renderHome(req, env) {
  const { supabaseKey } = getEnv(env);
  const url = new URL(req.url);
  const search = url.searchParams.get("q") || "";
  const category = url.searchParams.get("cat") || "";
  const page = parseInt(url.searchParams.get("page") || "1", 10);
  const limit = 24;
  const offset = (page - 1) * limit;

  let videos = [], categories = [];
  let error = null;
  try {
    [videos, categories] = await Promise.all([
      getVideos(supabaseKey, { search, category, limit, offset }),
      getCategories(supabaseKey),
    ]);
  } catch (e) {
    error = e.message;
  }

  const filterBtns = [
    `<button class="filter-btn ${!category ? "active" : ""}" onclick="location.href='/?${search ? "q=" + encodeURIComponent(search) + "&" : ""}'" >Semua</button>`,
    ...categories.map(cat =>
      `<button class="filter-btn ${category === cat ? "active" : ""}" onclick="location.href='/?${search ? "q=" + encodeURIComponent(search) + "&" : ""}cat=${encodeURIComponent(cat)}'">${escHtml(cat)}</button>`
    ),
  ].join("");

  const cards = (videos || []).map(renderVideoCard).join("");

  const body = `
<div class="hero">
  <h1>Koleksi Video</h1>
  <p>Temukan dan nikmati video pilihan terbaik kami</p>
  <form class="search-bar" method="GET" action="/">
    <input type="text" name="q" placeholder="Cari video..." value="${escHtml(search)}">
    ${category ? `<input type="hidden" name="cat" value="${escHtml(category)}">` : ""}
    <button type="submit" class="btn btn-primary">Cari</button>
  </form>
</div>
<div class="container">
  ${error ? `<div class="alert alert-error">Gagal memuat: ${escHtml(error)}</div>` : ""}
  <div class="filters">${filterBtns}</div>
  ${videos && videos.length > 0
    ? `<div class="video-grid">${cards}</div>`
    : `<div class="empty"><div class="empty-icon">📭</div><h3>Belum ada video</h3><p>${search ? "Tidak ada hasil untuk pencarian kamu." : "Belum ada video yang ditambahkan."}</p></div>`
  }
  ${videos && videos.length === limit
    ? `<div class="pagination">
        ${page > 1 ? `<a class="page-btn" href="?${search ? "q=" + encodeURIComponent(search) + "&" : ""}${category ? "cat=" + encodeURIComponent(category) + "&" : ""}page=${page - 1}">←</a>` : ""}
        <span class="page-btn active">${page}</span>
        <a class="page-btn" href="?${search ? "q=" + encodeURIComponent(search) + "&" : ""}${category ? "cat=" + encodeURIComponent(category) + "&" : ""}page=${page + 1}">→</a>
      </div>` : ""
  }
</div>`;

  return new Response(layout("Koleksi Video", body, { isAdmin: true }), {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

async function renderLogin(req, env, flash = "") {
  const body = `
<div class="form-card">
  <div class="form-title">Selamat Datang</div>
  <div class="form-subtitle">Masukkan password untuk mengakses koleksi video</div>
  ${flash ? `<div class="alert alert-error">${escHtml(flash)}</div>` : ""}
  <form method="POST" action="/login">
    <div class="form-group">
      <label>Password</label>
      <input type="password" name="password" placeholder="••••••••" required autofocus>
    </div>
    <div class="form-actions">
      <button type="submit" class="btn btn-primary">Masuk</button>
    </div>
  </form>
</div>`;
  return new Response(layout("Login", body), {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

async function renderAdmin(req, env, flash = "") {
  const { supabaseKey } = getEnv(env);
  const url = new URL(req.url);
  const search = url.searchParams.get("q") || "";

  let videos = [], categories = [];
  try {
    [videos, categories] = await Promise.all([
      getVideos(supabaseKey, { search, limit: 100 }),
      getCategories(supabaseKey),
    ]);
  } catch (e) {
    flash = "Gagal memuat data: " + e.message;
  }

  const catOptions = categories.map(c => `<option value="${escHtml(c)}">${escHtml(c)}</option>`).join("");

  const rows = (videos || []).map(v => `
<tr>
  <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><strong>${escHtml(v.title)}</strong></td>
  <td>${v.category ? `<span class="badge">${escHtml(v.category)}</span>` : "-"}</td>
  <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
    <a href="${escHtml(v.url)}" target="_blank" style="color:var(--accent2);font-size:0.8rem">${escHtml(v.url)}</a>
  </td>
  <td>${v.created_at ? timeAgo(v.created_at) : "-"}</td>
  <td>
    <div class="actions">
      <button class="btn btn-ghost btn-sm" onclick="editVideo(${JSON.stringify(JSON.stringify(v))})">Edit</button>
      <form method="POST" action="/admin/delete" style="display:inline" onsubmit="return confirm('Hapus video ini?')">
        <input type="hidden" name="id" value="${escHtml(v.id)}">
        <button type="submit" class="btn btn-danger btn-sm">Hapus</button>
      </form>
    </div>
  </td>
</tr>`).join("");

  const body = `
<div class="container">
  <div class="admin-header">
    <h1>Panel Admin</h1>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn btn-ghost" onclick="document.getElementById('bulk-modal').style.display='flex'" style="border-color:var(--accent);color:var(--accent)">⚡ Bulk Import Videy</button>
      <button class="btn btn-primary" onclick="document.getElementById('add-modal').style.display='flex'">+ Tambah Video</button>
    </div>
  </div>
  ${flash ? `<div class="alert ${flash.startsWith("Berhasil") ? "alert-success" : "alert-error"}" style="margin-top:20px">${escHtml(flash)}</div>` : ""}
  <div class="stats">
    <div class="stat-card"><div class="stat-num">${(videos || []).length}</div><div class="stat-label">Total Video</div></div>
    <div class="stat-card"><div class="stat-num">${categories.length}</div><div class="stat-label">Kategori</div></div>
  </div>

  <!-- Search -->
  <form method="GET" action="/admin" style="display:flex;gap:10px;margin-bottom:16px">
    <input type="text" name="q" value="${escHtml(search)}" placeholder="Cari video..." style="flex:1;padding:9px 14px;background:var(--bg2);border:1px solid var(--border);border-radius:8px;color:var(--text);outline:none;font-size:0.9rem">
    <button type="submit" class="btn btn-ghost">Cari</button>
  </form>

  <div class="table-wrap">
    <table class="admin-table">
      <thead><tr><th>Judul</th><th>Kategori</th><th>Link</th><th>Ditambah</th><th>Aksi</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="5" style="text-align:center;padding:32px;color:var(--muted)">Belum ada video</td></tr>`}</tbody>
    </table>
  </div>
</div>

<!-- Add Modal -->
<div class="modal-overlay" id="add-modal" style="display:none" onclick="if(event.target===this)this.style.display='none'">
  <div class="modal" style="max-width:520px">
    <div class="modal-header" style="padding:24px 24px 0">
      <h2 style="font-size:1.2rem;font-weight:700">Tambah Video</h2>
      <button class="modal-close" onclick="document.getElementById('add-modal').style.display='none'">&times;</button>
    </div>
    <div style="padding:20px 24px 24px">
      <form method="POST" action="/admin/add">
        <div class="form-group">
          <label>Judul *</label>
          <input type="text" name="title" required placeholder="Judul video">
        </div>
        <div class="form-group">
          <label>Link Video *</label>
          <input type="url" name="url" required placeholder="https://youtube.com/watch?v=... atau link lainnya">
        </div>
        <div class="form-group">
          <label>Kategori</label>
          <input type="text" name="category" list="cat-list" placeholder="Pilih atau ketik kategori baru">
          <datalist id="cat-list">${catOptions}</datalist>
        </div>
        <div class="form-group">
          <label>Deskripsi</label>
          <textarea name="description" placeholder="Deskripsi singkat (opsional)"></textarea>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" onclick="document.getElementById('add-modal').style.display='none'">Batal</button>
          <button type="submit" class="btn btn-primary">Simpan</button>
        </div>
      </form>
    </div>
  </div>
</div>

<!-- Edit Modal -->
<div class="modal-overlay" id="edit-modal" style="display:none" onclick="if(event.target===this)this.style.display='none'">
  <div class="modal" style="max-width:520px">
    <div class="modal-header" style="padding:24px 24px 0">
      <h2 style="font-size:1.2rem;font-weight:700">Edit Video</h2>
      <button class="modal-close" onclick="document.getElementById('edit-modal').style.display='none'">&times;</button>
    </div>
    <div style="padding:20px 24px 24px">
      <form method="POST" action="/admin/edit" id="edit-form">
        <input type="hidden" name="id" id="edit-id">
        <div class="form-group">
          <label>Judul *</label>
          <input type="text" name="title" id="edit-title" required>
        </div>
        <div class="form-group">
          <label>Link Video *</label>
          <input type="url" name="url" id="edit-url" required>
        </div>
        <div class="form-group">
          <label>Kategori</label>
          <input type="text" name="category" id="edit-category" list="cat-list-edit">
          <datalist id="cat-list-edit">${catOptions}</datalist>
        </div>
        <div class="form-group">
          <label>Deskripsi</label>
          <textarea name="description" id="edit-description"></textarea>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" onclick="document.getElementById('edit-modal').style.display='none'">Batal</button>
          <button type="submit" class="btn btn-primary">Update</button>
        </div>
      </form>
    </div>
  </div>
</div>

<!-- Bulk Import Modal -->
<div class="modal-overlay" id="bulk-modal" style="display:none" onclick="if(event.target===this)this.style.display='none'">
  <div class="modal" style="max-width:680px;max-height:90vh;display:flex;flex-direction:column">
    <div class="modal-header" style="padding:24px 24px 0;flex-shrink:0">
      <div>
        <h2 style="font-size:1.2rem;font-weight:700">⚡ Bulk Import Videy</h2>
        <p style="color:var(--muted);font-size:0.8rem;margin-top:4px">Paste banyak link sekaligus — otomatis extract ID &amp; convert ke CDN</p>
      </div>
      <button class="modal-close" onclick="document.getElementById('bulk-modal').style.display='none'">&times;</button>
    </div>
    <div style="padding:20px 24px;overflow-y:auto;flex:1">

      <!-- Step 1: Paste links -->
      <div id="bulk-step1">
        <div class="form-group">
          <label>Paste link-link videy di sini (satu per baris atau campur dengan teks lain)</label>
          <textarea id="bulk-input" rows="8" placeholder="https://videy.co/v?id=hQF0u32U1&#10;https://videvideoy.site/u3lun&#10;https://videyvideo.short.gy/blH8n1&#10;..." style="width:100%;padding:10px 14px;background:var(--bg3);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:0.85rem;font-family:monospace;resize:vertical"></textarea>
        </div>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <div class="form-group" style="margin:0;flex:1;min-width:160px">
            <input type="text" id="bulk-category" list="cat-list-bulk" placeholder="Kategori (opsional)" style="width:100%;padding:9px 14px;background:var(--bg3);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:0.875rem;outline:none">
            <datalist id="cat-list-bulk">${catOptions}</datalist>
          </div>
          <button class="btn btn-primary" onclick="bulkScan()" style="flex-shrink:0">🔍 Scan Link</button>
        </div>
        <div id="bulk-scan-info" style="display:none;margin-top:10px;font-size:0.8rem;color:var(--muted)"></div>
      </div>

      <!-- Step 2: Preview results -->
      <div id="bulk-step2" style="display:none">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:8px">
          <div style="font-size:0.875rem">
            <span id="bulk-count" style="font-weight:700;color:var(--accent2)"></span>
            <button onclick="bulkBack()" style="margin-left:12px;background:none;border:none;color:var(--muted);cursor:pointer;font-size:0.8rem;text-decoration:underline">← Edit ulang</button>
          </div>
          <div style="display:flex;gap:6px">
            <button class="btn btn-ghost btn-sm" onclick="bulkSelectAll(true)">Pilih Semua</button>
            <button class="btn btn-ghost btn-sm" onclick="bulkSelectAll(false)">Batal Semua</button>
          </div>
        </div>
        <div id="bulk-list" style="max-height:320px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;background:var(--bg3)"></div>
        <div style="margin-top:16px;display:flex;gap:10px;justify-content:flex-end">
          <button class="btn btn-ghost" onclick="bulkBack()">Batal</button>
          <button class="btn btn-primary" id="bulk-submit-btn" onclick="bulkSubmit()">💾 Simpan yang Dipilih</button>
        </div>
        <div id="bulk-progress" style="display:none;margin-top:12px">
          <div style="background:var(--bg2);border-radius:6px;overflow:hidden;height:8px">
            <div id="bulk-progress-bar" style="height:100%;background:var(--accent);transition:width 0.3s;width:0%"></div>
          </div>
          <div id="bulk-progress-text" style="font-size:0.8rem;color:var(--muted);margin-top:6px;text-align:center"></div>
        </div>
      </div>

    </div>
  </div>
</div>

<script>
function editVideo(jsonStr) {
  const v = JSON.parse(jsonStr);
  document.getElementById('edit-id').value = v.id;
  document.getElementById('edit-title').value = v.title || '';
  document.getElementById('edit-url').value = v.url || '';
  document.getElementById('edit-category').value = v.category || '';
  document.getElementById('edit-description').value = v.description || '';
  document.getElementById('edit-modal').style.display = 'flex';
}

// ── Bulk Import Logic ─────────────────────────────────────────────────────────

var bulkItems = [];

function bulkScan() {
  var text = document.getElementById('bulk-input').value;
  var info = document.getElementById('bulk-scan-info');
  var seen = {};
  var found = [];
  // Extract any ?id=VALUE or &id=VALUE from anywhere in the text
  var re = /[?&]id=([A-Za-z0-9_\-]+)/g;
  var m;
  while ((m = re.exec(text)) !== null) {
    var id = m[1];
    if (id.length >= 3 && !seen[id]) {
      seen[id] = true;
      found.push(id);
    }
  }
  info.style.display = 'block';
  if (!found.length) {
    info.innerHTML = 'Tidak ada ID yang ditemukan. Pastikan link mengandung <b>?id=</b> atau <b>&amp;id=</b>.';
    return;
  }
  info.innerHTML = '';
  bulkItems = found.map(function(id) {
    return { id: id, cdnUrl: 'https://cdn.videy.co/' + id + '.mp4', selected: true, title: 'Video ' + id };
  });
  document.getElementById('bulk-count').textContent = bulkItems.length + ' ID ditemukan';
  renderBulkList();
  document.getElementById('bulk-step1').style.display = 'none';
  document.getElementById('bulk-step2').style.display = 'block';
}

function escH(s) {
  return String(s || '').split('&').join('&amp;').split('"').join('&quot;');
}

function renderBulkList() {
  var container = document.getElementById('bulk-list');
  var html = '';
  for (var i = 0; i < bulkItems.length; i++) {
    var item = bulkItems[i];
    var chk = item.selected ? ' checked' : '';
    html += '<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--border)">';
    html += '<input type="checkbox"' + chk + ' data-idx="' + i + '" onchange="bulkToggle(this)" style="width:16px;height:16px;accent-color:var(--accent);flex-shrink:0">';
    html += '<div style="flex:1;min-width:0">';
    html += '<input type="text" value="' + escH(item.title) + '" data-idx="' + i + '" oninput="bulkTitle(this)" style="width:100%;padding:5px 10px;background:var(--bg2);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:0.8rem;margin-bottom:4px;outline:none">';
    html += '<div style="font-size:0.72rem;color:var(--accent2);font-family:monospace">' + escH(item.cdnUrl) + '</div>';
    html += '</div></div>';
  }
  container.innerHTML = html;
  updateBulkBtn();
}

function bulkToggle(el) {
  bulkItems[+el.dataset.idx].selected = el.checked;
  updateBulkBtn();
}

function bulkTitle(el) {
  bulkItems[+el.dataset.idx].title = el.value;
}

function updateBulkBtn() {
  var n = 0;
  for (var i = 0; i < bulkItems.length; i++) { if (bulkItems[i].selected) n++; }
  document.getElementById('bulk-submit-btn').textContent = 'Simpan ' + n + ' Video';
  document.getElementById('bulk-submit-btn').disabled = (n === 0);
}

function bulkSelectAll(val) {
  for (var i = 0; i < bulkItems.length; i++) { bulkItems[i].selected = val; }
  renderBulkList();
}

function bulkBack() {
  document.getElementById('bulk-step1').style.display = 'block';
  document.getElementById('bulk-step2').style.display = 'none';
}

async function bulkSubmit() {
  var category = document.getElementById('bulk-category').value.trim();
  var selected = bulkItems.filter(function(x) { return x.selected; });
  if (!selected.length) return;
  var btn = document.getElementById('bulk-submit-btn');
  btn.disabled = true;
  document.getElementById('bulk-progress').style.display = 'block';
  var done = 0, failed = 0;
  for (var j = 0; j < selected.length; j++) {
    var item = selected[j];
    try {
      var fd = new FormData();
      fd.append('title', item.title || ('Video ' + item.id));
      fd.append('url', item.cdnUrl);
      fd.append('category', category);
      fd.append('description', '');
      await fetch('/admin/add', { method: 'POST', body: fd });
      done++;
    } catch(e) { failed++; }
    var pct = Math.round(((done + failed) / selected.length) * 100);
    document.getElementById('bulk-progress-bar').style.width = pct + '%';
    document.getElementById('bulk-progress-text').textContent = done + '/' + selected.length + ' disimpan' + (failed ? ', ' + failed + ' gagal' : '');
  }
  document.getElementById('bulk-progress-text').textContent = 'Selesai! ' + done + ' video ditambahkan. Memuat ulang...';
  setTimeout(function() { window.location.href = '/admin?msg=Berhasil+menambahkan+' + done + '+video'; }, 1200);
}
</script>`;

  return new Response(layout("Admin", body, { isAdmin: true }), {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

// ── Router ────────────────────────────────────────────────────────────────────

export default {
  async fetch(req, env) {
    const { supabaseKey, adminPassword, sessionSecret } = getEnv(env);
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    // ── Static: robots.txt
    if (path === "/robots.txt") {
      return new Response("User-agent: *\nDisallow: /", {
        headers: { "Content-Type": "text/plain" },
      });
    }

    // ── GET /login
    if (path === "/login" && method === "GET") {
      const authed = await isAuthenticated(req, sessionSecret);
      if (authed) return Response.redirect(new URL("/", req.url), 302);
      return renderLogin(req, env);
    }

    // ── POST /login
    if (path === "/login" && method === "POST") {
      const form = await req.formData();
      const pass = form.get("password") || "";
      if (pass === adminPassword) {
        const token = await signToken({ role: "admin", ts: Date.now() }, sessionSecret);
        return new Response(null, {
          status: 302,
          headers: {
            Location: "/",
            "Set-Cookie": `admin_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400`,
          },
        });
      }
      return renderLogin(req, env, "Password salah. Coba lagi.");
    }

    // ── POST /logout
    if (path === "/logout" && method === "POST") {
      return new Response(null, {
        status: 302,
        headers: {
          Location: "/login",
          "Set-Cookie": "admin_session=; Path=/; HttpOnly; Max-Age=0",
        },
      });
    }

    // ── Global auth guard — semua halaman butuh login
    const authedGlobal = await isAuthenticated(req, sessionSecret);
    if (!authedGlobal) {
      return Response.redirect(new URL("/login", req.url), 302);
    }

    // ── GET /
    if (path === "/" && method === "GET") {
      return renderHome(req, env);
    }

    // ── Admin routes (already authenticated via global guard above)
    const adminPaths = ["/admin", "/admin/add", "/admin/edit", "/admin/delete"];
    if (adminPaths.some(p => path === p || path.startsWith(p))) {
      const authed = true; // already checked above

      // GET /admin
      if (path === "/admin" && method === "GET") {
        const flash = url.searchParams.get("msg") || "";
        return renderAdmin(req, env, flash);
      }

      // POST /admin/add
      if (path === "/admin/add" && method === "POST") {
        try {
          const form = await req.formData();
          const title = (form.get("title") || "").trim();
          const videoUrl = (form.get("url") || "").trim();
          const category = (form.get("category") || "").trim();
          const description = (form.get("description") || "").trim();
          if (!title || !videoUrl) throw new Error("Judul dan link wajib diisi.");
          await createVideo({ title, url: videoUrl, category: category || null, description: description || null }, supabaseKey);
          return Response.redirect(new URL("/admin?msg=Berhasil+menambahkan+video", req.url), 303);
        } catch (e) {
          return renderAdmin(req, env, "Gagal menambahkan: " + e.message);
        }
      }

      // POST /admin/edit
      if (path === "/admin/edit" && method === "POST") {
        try {
          const form = await req.formData();
          const id = form.get("id") || "";
          const title = (form.get("title") || "").trim();
          const videoUrl = (form.get("url") || "").trim();
          const category = (form.get("category") || "").trim();
          const description = (form.get("description") || "").trim();
          if (!id || !title || !videoUrl) throw new Error("Data tidak lengkap.");
          await updateVideo(id, { title, url: videoUrl, category: category || null, description: description || null }, supabaseKey);
          return Response.redirect(new URL("/admin?msg=Berhasil+mengupdate+video", req.url), 303);
        } catch (e) {
          return renderAdmin(req, env, "Gagal update: " + e.message);
        }
      }

      // POST /admin/delete
      if (path === "/admin/delete" && method === "POST") {
        try {
          const form = await req.formData();
          const id = form.get("id") || "";
          if (!id) throw new Error("ID tidak valid.");
          await deleteVideo(id, supabaseKey);
          return Response.redirect(new URL("/admin?msg=Video+berhasil+dihapus", req.url), 303);
        } catch (e) {
          return renderAdmin(req, env, "Gagal hapus: " + e.message);
        }
      }
    }

    // 404
    return new Response(layout("404", `
<div class="empty" style="padding:120px 24px">
  <div class="empty-icon">🔍</div>
  <h3>Halaman Tidak Ditemukan</h3>
  <p>Halaman yang kamu cari tidak ada.</p>
  <a href="/" class="btn btn-primary" style="margin-top:20px;display:inline-flex">Kembali ke Beranda</a>
</div>`), {
      status: 404,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  },
};
