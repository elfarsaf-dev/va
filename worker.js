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

async function getVideoCount(supabaseKey, { search = "", category = "" } = {}) {
  let qs = `select=id&limit=1`;
  if (search) qs += `&or=(title.ilike.*${encodeURIComponent(search)}*,description.ilike.*${encodeURIComponent(search)}*)`;
  if (category) qs += `&category=eq.${encodeURIComponent(category)}`;
  const url = `${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}?${qs}`;
  const res = await fetch(url, {
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      Prefer: "count=exact",
    },
  });
  if (!res.ok) return null;
  const cr = res.headers.get("Content-Range");
  if (!cr) return null;
  const m = cr.match(/\/(\d+)$/);
  return m ? parseInt(m[1], 10) : null;
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
    prefer: "return=representation,resolution=ignore-duplicates",
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
html { scroll-behavior: smooth; -webkit-text-size-adjust: 100%; }
body {
  background: var(--bg);
  color: var(--text);
  font-family: var(--font);
  min-height: 100vh;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}
a { color: inherit; text-decoration: none; }

/* NAV */
nav {
  position: sticky; top: 0; z-index: 100;
  background: rgba(15,15,19,0.92);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border-bottom: 1px solid var(--border);
  padding: 0 16px;
  height: 52px;
  display: flex; align-items: center; justify-content: space-between;
}
.nav-brand {
  font-size: 1.05rem; font-weight: 700;
  background: linear-gradient(135deg, var(--accent), var(--accent2));
  -webkit-background-clip: text; -webkit-text-fill-color: transparent;
  display: flex; align-items: center; gap: 7px;
}
.nav-links { display: flex; align-items: center; gap: 4px; }
.nav-links a, .nav-links button {
  padding: 6px 12px; border-radius: 6px; font-size: 0.82rem; font-weight: 500;
  border: none; cursor: pointer; transition: all 0.2s;
  background: transparent; color: var(--muted);
  -webkit-tap-highlight-color: transparent;
}
.nav-links a:hover { color: var(--text); background: var(--bg3); }
.btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  padding: 9px 18px; border-radius: 8px; font-size: 0.875rem;
  font-weight: 600; border: none; cursor: pointer; transition: all 0.2s;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
}
.btn-primary { background: var(--accent); color: #fff; }
.btn-primary:hover { background: var(--accent2); }
.btn-primary:active { opacity: 0.85; transform: scale(0.97); }
.btn-danger { background: var(--danger); color: #fff; }
.btn-danger:hover { opacity: 0.85; }
.btn-ghost {
  background: var(--bg3); color: var(--text); border: 1px solid var(--border);
}
.btn-ghost:hover { border-color: var(--accent); color: var(--accent); }
.btn-sm { padding: 5px 12px; font-size: 0.78rem; }

/* CONTAINER */
.container { max-width: 1200px; margin: 0 auto; padding: 0 12px; }

/* HERO */
.hero {
  padding: 36px 16px 28px;
  text-align: center;
}
.hero h1 {
  font-size: clamp(1.6rem, 6vw, 3.2rem);
  font-weight: 800; letter-spacing: -0.02em; line-height: 1.2;
  background: linear-gradient(135deg, #fff 30%, var(--accent2));
  -webkit-background-clip: text; -webkit-text-fill-color: transparent;
  margin-bottom: 10px;
}
.hero p { color: var(--muted); font-size: 0.95rem; max-width: 480px; margin: 0 auto 24px; }

/* SEARCH */
.search-bar {
  display: flex; gap: 8px; max-width: 520px; margin: 0 auto;
}
.search-bar input {
  flex: 1; padding: 11px 14px; background: var(--bg2);
  border: 1px solid var(--border); border-radius: 8px;
  color: var(--text); font-size: 0.95rem;
  outline: none; transition: border-color 0.2s;
  -webkit-appearance: none;
}
.search-bar input:focus { border-color: var(--accent); }
.search-bar input::placeholder { color: var(--muted); }

/* FILTERS */
.filters {
  display: flex; gap: 6px; flex-wrap: wrap; margin: 16px 0;
  overflow-x: auto; -webkit-overflow-scrolling: touch;
  padding-bottom: 4px; scrollbar-width: none;
}
.filters::-webkit-scrollbar { display: none; }
.filter-btn {
  padding: 5px 13px; border-radius: 20px; font-size: 0.78rem; font-weight: 500;
  border: 1px solid var(--border); background: transparent; color: var(--muted);
  cursor: pointer; transition: all 0.2s; white-space: nowrap; flex-shrink: 0;
  -webkit-tap-highlight-color: transparent; touch-action: manipulation;
}
.filter-btn:hover, .filter-btn.active {
  border-color: var(--accent); color: var(--accent);
  background: rgba(124,111,247,0.1);
}

/* GRID — 3 kolom */
.video-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  padding: 6px 0 48px;
}
.video-card {
  background: var(--bg2); border: 1px solid var(--border);
  border-radius: 8px; overflow: hidden;
  transition: transform 0.2s, border-color 0.2s, box-shadow 0.2s;
  cursor: pointer; -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
}
.video-card:hover {
  transform: translateY(-2px); border-color: var(--accent);
  box-shadow: 0 6px 24px rgba(124,111,247,0.15);
}
.video-card:active { transform: scale(0.98); }
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
  width: 32px; height: 32px; background: rgba(124,111,247,0.85);
  border-radius: 50%; display: flex; align-items: center; justify-content: center;
}
.video-info { padding: 8px 10px 10px; }
.video-category {
  font-size: 0.62rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em;
  color: var(--accent2); margin-bottom: 4px;
}
.video-title {
  font-size: 0.78rem; font-weight: 600; color: var(--text);
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  margin-bottom: 4px; line-height: 1.4;
}
.video-desc {
  font-size: 0.72rem; color: var(--muted);
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  margin-bottom: 6px;
}
.video-meta { font-size: 0.68rem; color: var(--muted); display: flex; gap: 6px; align-items: center; }

/* MODAL / DETAIL */
.modal-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.85); z-index: 200;
  display: flex; align-items: flex-end; justify-content: center; padding: 0;
}
@media (min-width: 600px) {
  .modal-overlay { align-items: center; padding: 16px; }
}
.modal {
  background: var(--bg2); border: 1px solid var(--border);
  border-radius: 16px 16px 0 0;
  width: 100%; max-width: 800px;
  max-height: 95dvh; overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}
@media (min-width: 600px) {
  .modal { border-radius: 14px; max-height: 90vh; }
}
.modal-header {
  padding: 14px 16px 0; display: flex; justify-content: space-between; align-items: flex-start;
}
.modal-close {
  background: var(--bg3); border: none; color: var(--muted);
  width: 36px; height: 36px; border-radius: 50%; cursor: pointer; font-size: 1.2rem;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  -webkit-tap-highlight-color: transparent;
}
.modal-close:active { opacity: 0.7; }
.embed-wrap {
  position: relative; aspect-ratio: 16/9; background: #000; margin: 12px 12px 16px;
  border-radius: 10px; overflow: hidden;
}
@media (min-width: 600px) {
  .embed-wrap { margin: 16px 24px 20px; }
}
.embed-wrap iframe, .embed-wrap video { width: 100%; height: 100%; border: none; display: block; }
.thumb-vid { width: 100%; height: 100%; object-fit: cover; display: block; }

/* BUFFER BAR */
.vk-buf-track {
  position:absolute;bottom:0;left:0;right:0;height:3px;
  background:rgba(255,255,255,0.08);pointer-events:none;z-index:10;
}
.vk-buf-loaded {
  position:absolute;top:0;left:0;height:100%;
  background:rgba(124,111,247,0.55);transition:width 0.4s linear;width:0%;
}
.vk-buf-played {
  position:absolute;top:0;left:0;height:100%;
  background:var(--accent);transition:width 0.1s linear;width:0%;
}
/* BUFFERING SPINNER */
.vk-buf-spinner {
  position:absolute;top:50%;left:50%;
  width:44px;height:44px;margin:-22px 0 0 -22px;
  border:3px solid rgba(255,255,255,0.15);
  border-top-color:var(--accent2);
  border-radius:50%;
  animation:vkSpin 0.75s linear infinite;
  pointer-events:none;z-index:11;display:none;
}
@keyframes vkSpin { to { transform:rotate(360deg); } }
.thumb-play-overlay {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  background: rgba(0,0,0,0.18); pointer-events: none;
}
.modal-body { padding: 0 16px 24px; }
@media (min-width: 600px) {
  .modal-body { padding: 0 24px 28px; }
}
.modal-category { font-size: 0.72rem; color: var(--accent2); font-weight: 600; text-transform: uppercase; margin-bottom: 6px; }
.modal-title { font-size: 1.15rem; font-weight: 700; margin-bottom: 8px; line-height: 1.35; }
@media (min-width: 600px) {
  .modal-title { font-size: 1.4rem; }
}
.modal-desc { color: var(--muted); font-size: 0.875rem; line-height: 1.7; }

/* EMPTY STATE */
.empty {
  text-align: center; padding: 60px 24px;
  color: var(--muted);
}
.empty-icon { font-size: 2.5rem; margin-bottom: 14px; }
.empty h3 { font-size: 1.1rem; color: var(--text); margin-bottom: 8px; }

/* FORMS */
.form-card {
  background: var(--bg2); border: 1px solid var(--border);
  border-radius: 14px; padding: 24px 20px; max-width: 480px; margin: 40px auto;
}
.form-title { font-size: 1.4rem; font-weight: 700; margin-bottom: 4px; }
.form-subtitle { color: var(--muted); font-size: 0.875rem; margin-bottom: 24px; }
.form-group { margin-bottom: 16px; }
.form-group label { display: block; font-size: 0.85rem; font-weight: 500; margin-bottom: 6px; }
.form-group input, .form-group select, .form-group textarea {
  width: 100%; padding: 11px 14px; background: var(--bg3);
  border: 1px solid var(--border); border-radius: 8px;
  color: var(--text); font-size: 1rem; font-family: inherit;
  outline: none; transition: border-color 0.2s; -webkit-appearance: none;
}
.form-group input:focus, .form-group select:focus, .form-group textarea:focus {
  border-color: var(--accent);
}
.form-group textarea { resize: vertical; min-height: 80px; }
.form-group select option { background: var(--bg3); }
.form-actions { display: flex; gap: 10px; margin-top: 20px; }
.form-actions .btn { flex: 1; }
.alert {
  padding: 12px 16px; border-radius: 8px; font-size: 0.875rem; margin-bottom: 18px;
}
.alert-error { background: rgba(249,112,102,0.1); border: 1px solid rgba(249,112,102,0.3); color: var(--danger); }
.alert-success { background: rgba(52,211,153,0.1); border: 1px solid rgba(52,211,153,0.3); color: var(--success); }

/* ADMIN */
.admin-header {
  padding: 24px 0 20px;
  border-bottom: 1px solid var(--border);
  display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px;
}
.admin-header h1 { font-size: 1.4rem; font-weight: 700; }
.admin-table { width: 100%; border-collapse: collapse; margin-top: 20px; }
.admin-table th {
  text-align: left; font-size: 0.72rem; font-weight: 600; color: var(--muted);
  text-transform: uppercase; letter-spacing: 0.05em;
  padding: 10px 12px; border-bottom: 1px solid var(--border);
}
.admin-table td {
  padding: 10px 12px; border-bottom: 1px solid var(--border);
  font-size: 0.845rem; vertical-align: middle;
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
  overflow: hidden; margin-bottom: 40px; overflow-x: auto;
}
.stats { display: flex; gap: 12px; margin-bottom: 20px; flex-wrap: wrap; }
.stat-card {
  background: var(--bg2); border: 1px solid var(--border); border-radius: var(--radius);
  padding: 14px 18px; flex: 1; min-width: 100px;
}
.stat-card .stat-num { font-size: 1.6rem; font-weight: 700; color: var(--accent2); }
.stat-card .stat-label { font-size: 0.78rem; color: var(--muted); margin-top: 2px; }

/* DURATION BADGE */
.duration-badge {
  position: absolute; bottom: 5px; right: 5px;
  background: rgba(0,0,0,0.78); color: #fff;
  font-size: 0.65rem; font-weight: 600; letter-spacing: 0.02em;
  padding: 2px 5px; border-radius: 4px; pointer-events: none;
  line-height: 1.4;
}

/* PAGINATION */
.pagination { display: flex; gap: 6px; justify-content: center; padding: 20px 0 40px; flex-wrap: wrap; }
.page-btn {
  min-width: 36px; height: 36px; padding: 0 10px; border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  border: 1px solid var(--border); background: var(--bg2); color: var(--text);
  cursor: pointer; font-size: 0.875rem; text-decoration: none; transition: all 0.2s;
  -webkit-tap-highlight-color: transparent;
}
.page-btn:hover, .page-btn.active { border-color: var(--accent); color: var(--accent); background: rgba(124,111,247,0.1); }

/* RESPONSIVE */
@media (max-width: 480px) {
  .container { padding: 0 8px; }
  .hero { padding: 24px 12px 20px; }
  .video-grid { gap: 6px; }
  .video-info { padding: 6px 8px 8px; }
  .video-title { font-size: 0.72rem; }
  .video-category { font-size: 0.58rem; }
  .video-meta { display: none; }
  .play-icon { width: 26px; height: 26px; }
  .search-bar { flex-direction: column; }
  .admin-table th:nth-child(3), .admin-table td:nth-child(3) { display: none; }
}

/* FAV BUTTON ON CARD */
.fav-btn {
  position:absolute;top:5px;left:5px;z-index:2;
  width:26px;height:26px;border-radius:50%;
  background:rgba(0,0,0,0.55);border:none;cursor:pointer;
  display:flex;align-items:center;justify-content:center;
  font-size:0.9rem;line-height:1;
  -webkit-tap-highlight-color:transparent;
  transition:transform 0.15s,background 0.15s;
}
.fav-btn:active { transform:scale(0.82); }
.fav-btn.is-fav { background:rgba(251,191,36,0.3); }

/* SELECT CHECKBOX ON CARD */
.card-chk {
  position:absolute;top:5px;right:5px;z-index:3;
  width:20px;height:20px;border-radius:50%;
  background:rgba(0,0,0,0.55);border:2px solid rgba(255,255,255,0.45);
  display:none;align-items:center;justify-content:center;
  font-size:0.6rem;color:#fff;pointer-events:none;
}
body.sel-mode .card-chk { display:flex; }
.video-card.vk-sel { border-color:var(--accent);box-shadow:0 0 0 2px rgba(124,111,247,0.4); }

/* CONTEXT MENU */
.ctx-overlay { position:fixed;inset:0;z-index:498; }
.ctx-menu {
  position:fixed;z-index:499;background:var(--bg2);border:1px solid var(--border);
  border-radius:12px;padding:6px;min-width:196px;
  box-shadow:0 12px 40px rgba(0,0,0,0.55);
  animation:ctxIn 0.14s ease;
}
@keyframes ctxIn { from{opacity:0;transform:scale(0.9)} to{opacity:1;transform:scale(1)} }
.ctx-item {
  display:flex;align-items:center;gap:10px;padding:11px 14px;
  border-radius:8px;font-size:0.875rem;cursor:pointer;
  transition:background 0.12s;color:var(--text);
  -webkit-tap-highlight-color:transparent;
}
.ctx-item:hover,.ctx-item:active { background:var(--bg3); }
.ctx-sep { height:1px;background:var(--border);margin:4px 8px; }

/* MULTI-SELECT BAR */
.multi-bar {
  position:fixed;bottom:0;left:0;right:0;z-index:300;
  background:var(--bg2);border-top:1px solid var(--border);
  padding:12px 14px;padding-bottom:max(12px,env(safe-area-inset-bottom));
  display:none;align-items:center;gap:8px;
  box-shadow:0 -6px 24px rgba(0,0,0,0.4);
}
.multi-bar.on { display:flex; }
.multi-bar-info { flex:1;font-size:0.875rem;font-weight:600; }

/* VIDEO ERROR NOTIFICATION */
.vk-err-notif {
  position:fixed;bottom:0;left:0;right:0;z-index:9999;
  background:#1a0f0f;border-top:2px solid var(--danger);
  padding:12px 16px;padding-bottom:max(12px,env(safe-area-inset-bottom));
  display:flex;align-items:center;gap:10px;flex-wrap:wrap;
  box-shadow:0 -6px 32px rgba(249,112,102,0.25);
  animation:errSlideUp 0.25s ease;
}
@keyframes errSlideUp { from{transform:translateY(100%)} to{transform:translateY(0)} }
.vk-err-notif-icon { font-size:1.2rem;flex-shrink:0; }
.vk-err-notif-msg { flex:1;font-size:0.85rem;color:var(--text);min-width:160px; }
.vk-err-notif-msg b { color:var(--danger); }
.vk-err-notif-actions { display:flex;gap:8px;flex-shrink:0; }
.vk-err-del-btn {
  padding:7px 14px;border-radius:7px;font-size:0.8rem;font-weight:600;
  background:var(--danger);color:#fff;border:none;cursor:pointer;
  -webkit-tap-highlight-color:transparent;transition:opacity 0.15s;
}
.vk-err-del-btn:hover { opacity:0.85; }
.vk-err-skip-btn {
  padding:7px 14px;border-radius:7px;font-size:0.8rem;font-weight:600;
  background:var(--bg3);color:var(--muted);border:1px solid var(--border);cursor:pointer;
  -webkit-tap-highlight-color:transparent;
}
.vk-err-skip-btn:hover { color:var(--text); }

/* MODAL FAV BUTTON */
.modal-fav-btn {
  background:var(--bg3);border:1px solid var(--border);color:var(--text);
  width:36px;height:36px;border-radius:50%;cursor:pointer;font-size:1rem;
  display:flex;align-items:center;justify-content:center;flex-shrink:0;
  -webkit-tap-highlight-color:transparent;transition:all 0.15s;
}
.modal-fav-btn.is-fav { background:rgba(251,191,36,0.2);border-color:rgba(251,191,36,0.4); }

/* RECENT PLAY SECTION */
.recent-sec { padding:10px 0 4px; }
.recent-sec-hd {
  font-size:0.72rem;font-weight:600;color:var(--muted);
  text-transform:uppercase;letter-spacing:0.06em;
  margin-bottom:8px;display:flex;align-items:center;gap:8px;
}
.recent-clear-btn {
  font-size:0.7rem;color:var(--muted);cursor:pointer;
  padding:2px 7px;border-radius:4px;border:1px solid var(--border);
  background:none;-webkit-tap-highlight-color:transparent;
}
.recent-clear-btn:hover { color:var(--danger);border-color:var(--danger); }
.recent-row {
  display:flex;gap:8px;overflow-x:auto;-webkit-overflow-scrolling:touch;
  scrollbar-width:none;padding-bottom:6px;
}
.recent-row::-webkit-scrollbar { display:none; }
.recent-card { flex-shrink:0;width:106px;cursor:pointer;-webkit-tap-highlight-color:transparent; }
.recent-card:active { opacity:0.75; }
.recent-thumb {
  width:106px;height:60px;border-radius:6px;overflow:hidden;
  background:var(--bg3);position:relative;margin-bottom:4px;
}
.recent-thumb img,.recent-thumb video { width:100%;height:100%;object-fit:cover;display:block; }
.recent-ph {
  width:100%;height:100%;display:flex;align-items:center;justify-content:center;
  background:linear-gradient(135deg,var(--bg3),#1a1a2e);font-size:1.2rem;
}
.recent-title {
  font-size:0.67rem;color:var(--text);line-height:1.3;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;
}
.recent-meta { font-size:0.6rem;color:var(--muted);margin-top:2px; }

/* CATEGORY SHEET */
.cat-overlay {
  position:fixed;inset:0;z-index:600;background:rgba(0,0,0,0.7);
  display:flex;align-items:flex-end;justify-content:center;
}
.cat-sheet {
  background:var(--bg2);border:1px solid var(--border);
  border-radius:16px 16px 0 0;width:100%;max-width:500px;
  padding:20px 16px;padding-bottom:max(20px,env(safe-area-inset-bottom));
  animation:slideUp 0.2s ease;
}
@keyframes slideUp { from{transform:translateY(100%)} to{transform:translateY(0)} }
.cat-sheet-title { font-size:1rem;font-weight:700;margin-bottom:12px; }
.cat-chips { display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px; }
.cat-chip {
  padding:5px 12px;border-radius:20px;font-size:0.78rem;font-weight:500;
  border:1px solid var(--border);background:transparent;color:var(--muted);
  cursor:pointer;transition:all 0.15s;-webkit-tap-highlight-color:transparent;
}
.cat-chip:hover,.cat-chip:active { border-color:var(--accent);color:var(--accent);background:rgba(124,111,247,0.1); }
.cat-custom-row { display:flex;gap:8px;margin-bottom:12px; }
.cat-custom-row input {
  flex:1;padding:9px 12px;background:var(--bg3);border:1px solid var(--border);
  border-radius:8px;color:var(--text);font-size:0.9rem;outline:none;
}
.cat-custom-row input:focus { border-color:var(--accent); }
`;

// ── HTML Layout ───────────────────────────────────────────────────────────────

function layout(title, body, { isAdmin = false, navExtra = "" } = {}) {
  return `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>${escHtml(title)} — V</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>${CSS}</style>
</head>
<body>
<nav>
  <a class="nav-brand" href="/">
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" style="-webkit-text-fill-color:initial">
      <polygon points="5 3 19 12 5 21 5 3" fill="var(--accent)"/>
    </svg>V
  </a>
  <div class="nav-links">
    ${isAdmin ? `
    <a href="/">Koleksi</a>
    <a href="/recent">Riwayat</a>
    <a href="/admin">Admin</a>
    <form method="POST" action="/logout" style="display:inline">
      <button type="submit" style="padding:6px 16px;border-radius:6px;font-size:0.875rem;font-weight:500;border:none;cursor:pointer;background:transparent;color:var(--muted)">Keluar</button>
    </form>` : ""}
    ${navExtra}
  </div>
</nav>
${body}
<script>
var VK_IS_ADMIN = ${isAdmin ? 'true' : 'false'};

// ── Video Error Notification ───────────────────────────────────────
var _vkBrokenSet = {};   // id → title
var _vkBrokenTimer = null;

function vkThumbError(el) {
  var card = el.closest ? el.closest('.video-card') : null;
  if (!card) {
    var p = el.parentNode;
    while (p && !p.classList.contains('video-card')) p = p.parentNode;
    card = p;
  }
  if (!card) return;
  var id = card.dataset.id;
  var title = card.dataset.title || id;
  if (!id || _vkBrokenSet[id]) return;
  _vkBrokenSet[id] = title || id;
  card.style.outline = '2px solid var(--danger)';
  card.style.opacity = '0.55';
  clearTimeout(_vkBrokenTimer);
  _vkBrokenTimer = setTimeout(vkShowBrokenNotif, 1800);
}

function vkVideoError(id, title) {
  if (!_vkBrokenSet[id]) {
    _vkBrokenSet[id] = title || id;
    var card = document.querySelector('.video-card[data-id="'+id+'"]');
    if (card) { card.style.outline = '2px solid var(--danger)'; card.style.opacity = '0.55'; }
  }
  vkShowBrokenNotif();
}

function vkShowBrokenNotif() {
  var ids = Object.keys(_vkBrokenSet);
  if (!ids.length) return;
  vkDismissError();
  var n = ids.length;
  var notif = document.createElement('div');
  notif.className = 'vk-err-notif';
  notif.id = 'vk-err-notif';
  var delBtn = VK_IS_ADMIN
    ? '<button class="vk-err-del-btn" onclick="vkDeleteAllBroken()">🗑️ Hapus Semua (' + n + ')</button>'
    : '';
  notif.innerHTML =
    '<span class="vk-err-notif-icon">⚠️</span>' +
    '<div class="vk-err-notif-msg"><b>' + n + ' video tidak ditemukan / error</b>' +
    '<br><span style="font-size:0.78rem;color:var(--muted)">Terdeteksi otomatis saat load thumbnail</span></div>' +
    '<div class="vk-err-notif-actions">' + delBtn +
    '<button class="vk-err-skip-btn" onclick="vkDismissError()">Abaikan</button></div>';
  document.body.appendChild(notif);
}

function vkDismissError() {
  var old = document.getElementById('vk-err-notif');
  if (old) old.remove();
}

async function vkDeleteAllBroken() {
  var ids = Object.keys(_vkBrokenSet);
  if (!ids.length) return;
  var btn = document.querySelector('.vk-err-del-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Menghapus 0/' + ids.length + '...'; }
  var success = 0, fail = 0;
  for (var i = 0; i < ids.length; i++) {
    var id = ids[i];
    try {
      var fd = new FormData();
      fd.append('id', id);
      var res = await fetch('/admin/delete', { method: 'POST', body: fd });
      if (res.ok || res.redirected) {
        var card = document.querySelector('.video-card[data-id="'+id+'"]');
        if (card) {
          var modal = document.getElementById('modal-'+id);
          if (modal) modal.remove();
          card.style.transition = 'opacity 0.3s';
          card.style.opacity = '0';
          (function(c){ setTimeout(function(){ c.remove(); }, 350); })(card);
        }
        success++;
      } else { fail++; }
    } catch(e) { fail++; }
    if (btn) btn.textContent = '⏳ Menghapus ' + (i+1) + '/' + ids.length + '...';
  }
  _vkBrokenSet = {};
  vkDismissError();
  if (fail > 0) alert('Berhasil hapus ' + success + ', gagal ' + fail + ' video.');
}

async function vkDeleteErrorVideo(id) {
  _vkBrokenSet[id] = _vkBrokenSet[id] || id;
  await vkDeleteAllBroken();
}

// ── Modal ──────────────────────────────────────────────────────────
function openVideo(id) {
  var modal = document.getElementById('modal-'+id);
  if (!modal) return;
  var wrap = modal.querySelector('.embed-wrap');
  if (wrap && !wrap.firstChild) {
    var src = wrap.dataset.src, type = wrap.dataset.type;
    var card = document.querySelector('.video-card[data-id="'+id+'"]');
    var title = card ? (card.dataset.title || id) : id;
    if (type === 'mp4') {
      var vid = document.createElement('video');
      // Set preload="auto" sebelum src agar browser buffer agresif dari awal
      vid.preload = 'auto';
      vid.controls = true; vid.autoplay = true; vid.playsInline = true;
      vid.style.cssText = 'width:100%;height:100%;object-fit:contain;background:#000';
      vid.onerror = function() { vkVideoError(id, title); };

      // ── Buffer bar + spinner ──
      var spinner = document.createElement('div');
      spinner.className = 'vk-buf-spinner';
      var bufTrack = document.createElement('div');
      bufTrack.className = 'vk-buf-track';
      var bufLoaded = document.createElement('div');
      bufLoaded.className = 'vk-buf-loaded';
      var bufPlayed = document.createElement('div');
      bufPlayed.className = 'vk-buf-played';
      bufTrack.appendChild(bufLoaded);
      bufTrack.appendChild(bufPlayed);

      function updateBufBar() {
        if (vid.duration) {
          if (vid.buffered.length > 0) {
            var pct = (vid.buffered.end(vid.buffered.length - 1) / vid.duration) * 100;
            bufLoaded.style.width = Math.min(pct, 100) + '%';
          }
          bufPlayed.style.width = ((vid.currentTime / vid.duration) * 100) + '%';
        }
      }

      // ── Auto-recover jika download terhenti ──
      var _stallTimer = null;
      var _recover = function() {
        clearTimeout(_stallTimer);
        _stallTimer = setTimeout(function() {
          if (vid.paused || vid.ended) return;
          var ct = vid.currentTime;
          vid.load();
          vid.currentTime = ct;
          vid.play().catch(function(){});
        }, 6000);
      };

      vid.onprogress  = updateBufBar;
      vid.ontimeupdate = updateBufBar;
      vid.onwaiting   = function() { spinner.style.display = 'block'; _recover(); };
      vid.onstalled   = function() { spinner.style.display = 'block'; _recover(); };
      vid.onsuspend   = function() {
        if (!vid.ended && vid.buffered.length > 0) {
          var bufferedEnd = vid.buffered.end(vid.buffered.length - 1);
          if (vid.duration && bufferedEnd < vid.duration - 2) { _recover(); }
        }
      };
      vid.onplaying   = function() { clearTimeout(_stallTimer); spinner.style.display = 'none'; };
      vid.oncanplay   = function() { spinner.style.display = 'none'; };

      vid.src = src; // Set src paling akhir setelah semua handler siap
      wrap.appendChild(vid);
      wrap.appendChild(spinner);
      wrap.appendChild(bufTrack);
      // Pause thumbnail SETELAH video modal klaim koneksinya
      setTimeout(function() {
        document.querySelectorAll('video.thumb-vid').forEach(function(tv) { try { tv.pause(); } catch(e){} });
      }, 150);
    } else {
      var fr = document.createElement('iframe');
      fr.src = src; fr.allowFullscreen = true;
      fr.allow = 'autoplay; encrypted-media'; fr.loading = 'lazy';
      wrap.appendChild(fr);
      setTimeout(function() {
        document.querySelectorAll('video.thumb-vid').forEach(function(tv) { try { tv.pause(); } catch(e){} });
      }, 150);
      // Probe raw URL via HEAD to detect 404 for non-mp4 (e.g. CDN links wrapped in embed)
      var rawurl = card ? card.dataset.rawurl : '';
      if (rawurl && rawurl.indexOf('cdn.videy.co') !== -1) {
        fetch(rawurl, { method: 'HEAD', mode: 'no-cors' }).catch(function() {
          vkVideoError(id, title);
        });
      }
    }
  }
  vkDismissError();
  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  vkSaveRecent(id);
  vkRefreshFavBtn(id);
}
function closeModal(id) {
  var m = document.getElementById('modal-'+id);
  if (!m) return;
  m.style.display = 'none';
  document.body.style.overflow = '';
  var wrap = m.querySelector('.embed-wrap');
  if (wrap) wrap.innerHTML = '';
  vkDismissError();
  vkResumeVisibleThumbs();
}
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay').forEach(function(m) {
      m.style.display = 'none';
      var wrap = m.querySelector('.embed-wrap');
      if (wrap) wrap.innerHTML = '';
    });
    document.body.style.overflow = '';
    vkCloseCtx();
    vkDismissError();
    vkResumeVisibleThumbs();
  }
});

// ── Thumbnail lazy-loader (Intersection Observer) ──────────────────
var _vkThumbObs = null;
function vkInitThumbObs() {
  if (!window.IntersectionObserver) {
    // Fallback: langsung load semua
    document.querySelectorAll('video.thumb-vid[data-src]').forEach(function(v) { vkLoadThumb(v); });
    return;
  }
  _vkThumbObs = new IntersectionObserver(function(entries) {
    entries.forEach(function(entry) {
      var v = entry.target;
      if (entry.isIntersecting) {
        vkLoadThumb(v);
      } else {
        try { v.pause(); } catch(e) {}
      }
    });
  }, { rootMargin: '120px' });
  document.querySelectorAll('video.thumb-vid[data-src]').forEach(function(v) {
    _vkThumbObs.observe(v);
  });
}
function vkLoadThumb(v) {
  if (!v.src && v.dataset.src) {
    v.src = v.dataset.src;
    v.preload = 'metadata';
    v.onloadedmetadata = function() { try { v.currentTime = 0.001; } catch(e) {} };
  } else if (v.paused && v.readyState >= 1) {
    // sudah punya frame, tidak perlu load ulang
  }
}
function vkResumeVisibleThumbs() {
  if (!_vkThumbObs) return;
  // Trigger ulang observer agar thumbnail visible kembali aktif
  document.querySelectorAll('video.thumb-vid').forEach(function(v) {
    _vkThumbObs.unobserve(v);
    _vkThumbObs.observe(v);
  });
}
// Init saat DOM siap
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', vkInitThumbObs);
} else {
  vkInitThumbObs();
}

// ── LocalStorage helpers ───────────────────────────────────────────
var VK_FAV_KEY = 'vk_favs', VK_RECENT_KEY = 'vk_recent';
function vkGetFavs() {
  try { return new Set(JSON.parse(localStorage.getItem(VK_FAV_KEY) || '[]')); } catch(e) { return new Set(); }
}
function vkSetFavs(s) {
  try { localStorage.setItem(VK_FAV_KEY, JSON.stringify(Array.from(s))); } catch(e) {}
}
function vkGetRecent() {
  try { return JSON.parse(localStorage.getItem(VK_RECENT_KEY) || '[]'); } catch(e) { return []; }
}
function vkSetRecent(arr) {
  try { localStorage.setItem(VK_RECENT_KEY, JSON.stringify(arr)); } catch(e) {}
}

// ── Favorites ──────────────────────────────────────────────────────
function toggleFav(id) {
  var favs = vkGetFavs();
  if (favs.has(id)) { favs.delete(id); } else { favs.add(id); }
  vkSetFavs(favs);
  vkRefreshFavBtn(id);
  if (_favFilterOn) {
    var card = document.querySelector('.video-card[data-id="' + id + '"]');
    if (card) card.style.display = favs.has(id) ? '' : 'none';
  }
}
function vkRefreshFavBtn(id) {
  var favs = vkGetFavs();
  var isFav = favs.has(id);
  var star = isFav ? '\\u2605' : '\\u2606';
  var cb = document.getElementById('favbtn-'+id);
  var mb = document.getElementById('mfav-'+id);
  if (cb) { cb.textContent = star; cb.classList.toggle('is-fav', isFav); }
  if (mb) { mb.textContent = star; mb.classList.toggle('is-fav', isFav); }
}
function vkInitFavBtns() {
  var favs = vkGetFavs();
  favs.forEach(function(id) { vkRefreshFavBtn(id); });
}

// ── Fav filter toggle ──────────────────────────────────────────────
var _favFilterOn = false;
function vkToggleFavFilter(btn) {
  _favFilterOn = !_favFilterOn;
  if (btn) btn.classList.toggle('active', _favFilterOn);
  var favs = vkGetFavs();
  document.querySelectorAll('.video-card').forEach(function(card) {
    var id = card.dataset.id;
    card.style.display = (_favFilterOn && (!id || !favs.has(id))) ? 'none' : '';
  });
  var pag = document.getElementById('vk-pagination');
  if (pag) pag.style.display = _favFilterOn ? 'none' : '';
}

// ── Recent play ────────────────────────────────────────────────────
function vkSaveRecent(id) {
  var card = document.querySelector('.video-card[data-id="' + id + '"]');
  var title = card ? (card.dataset.title || id) : id;
  var thumb = card ? (card.dataset.thumb || '') : '';
  var rawurl = card ? (card.dataset.rawurl || '') : '';
  var page = (typeof VK_PAGE !== 'undefined' ? VK_PAGE : 1);
  var cat = (typeof VK_CAT !== 'undefined' ? VK_CAT : '');
  var q = (typeof VK_Q !== 'undefined' ? VK_Q : '');
  var recent = vkGetRecent().filter(function(r) { return r.id !== id; });
  recent.unshift({ id: id, title: title, thumb: thumb, rawurl: rawurl, ts: Date.now(), page: page, cat: cat, q: q });
  if (recent.length > 20) recent.length = 20;
  vkSetRecent(recent);
}
function vkTimeAgo(ts) {
  var diff = Date.now() - ts;
  var m = Math.floor(diff / 60000);
  if (m < 1) return 'baru saja';
  if (m < 60) return m + 'm lalu';
  var h = Math.floor(m / 60);
  if (h < 24) return h + 'j lalu';
  return Math.floor(h / 24) + 'h lalu';
}
function vkRenderRecent() {
  var wrap = document.getElementById('vk-recent-wrap');
  if (!wrap) return;
  var recent = vkGetRecent();
  if (!recent.length) { wrap.innerHTML = ''; return; }
  var html = '<div class="recent-sec"><div class="recent-sec-hd">Terakhir Ditonton <button class="recent-clear-btn" onclick="vkClearRecent()">Hapus</button></div><div class="recent-row">';
  for (var i = 0; i < recent.length; i++) {
    var r = recent[i];
    var isMp4 = r.rawurl && r.rawurl.indexOf('.mp4') !== -1;
    var tHtml;
    if (isMp4 && r.rawurl) {
      tHtml = '<video src="' + r.rawurl + '" muted playsinline preload="metadata" style="width:100%;height:100%;object-fit:cover;display:block" onloadedmetadata="this.currentTime=0.001"></video>';
    } else if (r.thumb) {
      tHtml = '<img src="' + r.thumb + '" style="width:100%;height:100%;object-fit:cover;display:block" loading="lazy" onerror="vkThumbErr(this)">';
    } else {
      tHtml = '<div class="recent-ph">&#9654;</div>';
    }
    var safeTitle = r.title.replace(/&/g,'&amp;').replace(/</g,'&lt;');
    var pageMeta = 'Hal.' + r.page + (r.cat ? ' \u00b7 ' + r.cat : '') + (r.q ? ' \u00b7 "' + r.q + '"' : '');
    html += '<div class="recent-card" data-rid="' + r.id + '">';
    html += '<div class="recent-thumb">' + tHtml + '</div>';
    html += '<div class="recent-title">' + safeTitle + '</div>';
    html += '<div class="recent-meta">' + vkTimeAgo(r.ts) + ' &middot; ' + pageMeta + '</div>';
    html += '</div>';
  }
  html += '</div></div>';
  wrap.innerHTML = html;
}
function vkClearRecent() { vkSetRecent([]); vkRenderRecent(); }

// ── Long-press & context menu ──────────────────────────────────────
var _lpTimer = null, _lpFired = false, _ctxId = null;
function vkTouchStart(e, id) {
  _lpFired = false;
  clearTimeout(_lpTimer);
  var touch = e.touches ? e.touches[0] : e;
  var cx = touch.clientX, cy = touch.clientY;
  _lpTimer = setTimeout(function() {
    _lpFired = true;
    if (navigator.vibrate) navigator.vibrate(30);
    vkShowCtxAt(cx, cy, id);
  }, 500);
}
function vkTouchEnd(e) {
  clearTimeout(_lpTimer);
  if (_lpFired) { e.preventDefault(); _lpFired = false; }
}
function vkCtxMenu(e, id) { _ctxId = id; vkShowCtxAt(e.clientX, e.clientY, id); }
function vkCardClick(e, id) {
  if (_lpFired) { _lpFired = false; return; }
  if (document.body.classList.contains('sel-mode')) { vkToggleSel(id); return; }
  openVideo(id);
}
function vkShowCtxAt(x, y, id) {
  _ctxId = id;
  var favs = vkGetFavs();
  var isFav = favs.has(id);
  vkCloseCtx();
  var ov = document.createElement('div');
  ov.className = 'ctx-overlay'; ov.onclick = vkCloseCtx;
  document.body.appendChild(ov);
  var menu = document.createElement('div');
  menu.className = 'ctx-menu'; menu.id = 'vk-ctx';
  menu.innerHTML =
    '<div class="ctx-item" onclick="vkCtxFav()">' + (isFav ? '\\u2605 Hapus dari Favorit' : '\\u2606 Tambah ke Favorit') + '</div>' +
    '<div class="ctx-item" onclick="vkCtxCat()">&#128193; Pindah Kategori</div>' +
    '<div class="ctx-sep"></div>' +
    '<div class="ctx-item" onclick="vkCtxSel()">&#9745; Pilih</div>';
  document.body.appendChild(menu);
  var mw = 200, mh = 160;
  var left = Math.max(8, Math.min(x, window.innerWidth - mw - 8));
  var top = Math.max(8, Math.min(y + 8, window.innerHeight - mh - 8));
  menu.style.left = left + 'px'; menu.style.top = top + 'px';
}
function vkCloseCtx() {
  var m = document.getElementById('vk-ctx');
  var o = document.querySelector('.ctx-overlay');
  if (m) m.remove(); if (o) o.remove();
}
function vkCtxFav() { vkCloseCtx(); if (_ctxId) toggleFav(_ctxId); }
function vkCtxCat() { vkCloseCtx(); if (_ctxId) vkShowCatSheet([_ctxId]); }
function vkCtxSel() { vkCloseCtx(); if (_ctxId) { vkEnterSelMode(); vkToggleSel(_ctxId); } }

// ── Multi-select ───────────────────────────────────────────────────
var _selSet = new Set();
function vkEnterSelMode() {
  document.body.classList.add('sel-mode');
  _selSet.clear(); vkUpdateMultiBar();
}
function vkExitSelMode() {
  document.body.classList.remove('sel-mode');
  _selSet.clear();
  document.querySelectorAll('.video-card.vk-sel').forEach(function(c) { c.classList.remove('vk-sel'); });
  document.querySelectorAll('.card-chk').forEach(function(c) { c.textContent = ''; });
  vkUpdateMultiBar();
}
function vkToggleSel(id) {
  var card = document.querySelector('.video-card[data-id="' + id + '"]');
  var chk = document.getElementById('chk-' + id);
  if (_selSet.has(id)) {
    _selSet.delete(id);
    if (card) card.classList.remove('vk-sel');
    if (chk) chk.textContent = '';
  } else {
    _selSet.add(id);
    if (card) card.classList.add('vk-sel');
    if (chk) chk.textContent = '\\u2713';
  }
  vkUpdateMultiBar();
}
function vkUpdateMultiBar() {
  var bar = document.getElementById('vk-multi-bar');
  if (!bar) return;
  var inSel = document.body.classList.contains('sel-mode');
  bar.classList.toggle('on', inSel);
  var info = bar.querySelector('.multi-bar-info');
  if (info) info.textContent = _selSet.size + ' dipilih';
}
function vkSelFavAll() {
  var favs = vkGetFavs();
  _selSet.forEach(function(id) { favs.add(id); vkRefreshFavBtn(id); });
  vkSetFavs(favs); vkExitSelMode();
}
function vkSelCat() { if (_selSet.size) vkShowCatSheet(Array.from(_selSet)); }

// ── Category sheet ─────────────────────────────────────────────────
var _catIds = [];
function vkShowCatSheet(ids) {
  _catIds = ids;
  var cats = (typeof VK_CATS !== 'undefined' ? VK_CATS : []);
  var chipsHtml = cats.map(function(c) {
    var sc = c.replace(/&/g,'&amp;').replace(/</g,'&lt;');
    return '<button class="cat-chip" onclick="vkPickCat(this.dataset.cat)" data-cat="' + c.replace(/"/g,'&quot;') + '">' + sc + '</button>';
  }).join('');
  vkCloseCatSheet();
  var ov = document.createElement('div');
  ov.className = 'cat-overlay'; ov.id = 'vk-cat-ov';
  ov.onclick = function(e) { if (e.target === ov) vkCloseCatSheet(); };
  ov.innerHTML =
    '<div class="cat-sheet">' +
    '<div class="cat-sheet-title">Pindah ke Kategori (' + ids.length + ' video)</div>' +
    '<div class="cat-chips">' + chipsHtml + '</div>' +
    '<div class="cat-custom-row">' +
    '<input type="text" id="vk-cat-inp" placeholder="Kategori baru...">' +
    '<button class="btn btn-primary btn-sm" onclick="vkSubmitCatInp()">OK</button>' +
    '</div>' +
    '<button class="btn btn-ghost btn-sm" style="margin-top:10px" onclick="vkCloseCatSheet()">Batal</button>' +
    '</div>';
  document.body.appendChild(ov);
}
function vkCloseCatSheet() { var o = document.getElementById('vk-cat-ov'); if (o) o.remove(); }
function vkPickCat(cat) {
  if (!cat) return;
  vkCloseCatSheet();
  var ids = _catIds.slice();
  var done = 0;
  ids.forEach(function(id) {
    fetch('/api/move-cat', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({id: id, category: cat})
    }).then(function() {
      done++;
      if (done === ids.length) { vkExitSelMode(); location.reload(); }
    }).catch(function() { done++; });
  });
}

// ── Helpers for inline handlers ────────────────────────────────────
function vkThumbErr(el) {
  el.parentNode.innerHTML = '<div class="recent-ph">&#9654;</div>';
}
function vkSubmitCatInp() {
  var el = document.getElementById('vk-cat-inp');
  if (el && el.value.trim()) vkPickCat(el.value.trim());
}

// ── Init ───────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function() {
  vkInitFavBtns();
  vkRenderRecent();
});
document.addEventListener('click', function(e) {
  var rc = e.target.closest && e.target.closest('.recent-card');
  if (rc && rc.dataset.rid) openVideo(rc.dataset.rid);
});
</script>
</body>
</html>`;
}

function escHtml(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function fmtDuration(sec) {
  if (!sec || sec <= 0) return "";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
  return `${m}:${String(s).padStart(2,"0")}`;
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
  const isMp4 = /\.mp4(\?.*)?$/i.test(v.url);
  const playIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="white"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;

  const thumbHtml = isMp4
    ? `<video class="thumb-vid" data-src="${escHtml(v.url)}" muted playsinline preload="none" onerror="vkThumbError(this)"></video>
       <div class="thumb-play-overlay"><div class="play-icon">${playIcon}</div></div>`
    : thumb
      ? `<img src="${escHtml(thumb)}" alt="${escHtml(v.title)}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
         <div class="thumb-placeholder" style="display:none"><div class="play-icon">${playIcon}</div></div>`
      : `<div class="thumb-placeholder"><div class="play-icon">${playIcon}</div></div>`;

  const playerSrc = escHtml(isMp4 ? v.url : (embed || v.url));
  const playerType = isMp4 ? "mp4" : "iframe";
  const durBadge = v.duration ? `<div class="duration-badge">${fmtDuration(v.duration)}</div>` : "";

  const vid = escHtml(v.id);
  const vtitle = escHtml(v.title);
  const vthumb = escHtml(thumb || "");
  const vrawurl = escHtml(v.url);
  const vcat = escHtml(v.category || "");

  return `
<div class="video-card" data-id="${vid}" data-title="${vtitle}" data-thumb="${vthumb}" data-rawurl="${vrawurl}" data-cat="${vcat}"
  onclick="vkCardClick(event,'${vid}')"
  ontouchstart="vkTouchStart(event,'${vid}')"
  ontouchend="vkTouchEnd(event)"
  ontouchcancel="vkTouchEnd(event)"
  oncontextmenu="vkCtxMenu(event,'${vid}');return false">
  <div class="video-thumb">
    ${thumbHtml}
    ${durBadge}
    <button class="fav-btn" id="favbtn-${vid}" onclick="event.stopPropagation();toggleFav('${vid}')" aria-label="Favorit">&#9734;</button>
    <div class="card-chk" id="chk-${vid}"></div>
  </div>
  <div class="video-info">
    ${v.category ? `<div class="video-category">${escHtml(v.category)}</div>` : ""}
    <div class="video-title">${escHtml(v.title)}</div>
    ${v.description ? `<div class="video-desc">${escHtml(v.description)}</div>` : ""}
    <div class="video-meta">${v.created_at ? timeAgo(v.created_at) : ""}</div>
  </div>
</div>
<!-- Modal -->
<div class="modal-overlay" id="modal-${vid}" style="display:none" onclick="if(event.target===this)closeModal('${vid}')">
  <div class="modal">
    <div class="modal-header">
      <div></div>
      <div style="display:flex;gap:8px;align-items:center">
        <button class="modal-fav-btn" id="mfav-${vid}" onclick="toggleFav('${vid}')" aria-label="Favorit">&#9734;</button>
        <button class="modal-close" onclick="closeModal('${vid}')">&times;</button>
      </div>
    </div>
    <div class="embed-wrap" data-src="${playerSrc}" data-type="${playerType}"></div>
    <div class="modal-body">
      ${v.category ? `<div class="modal-category">${escHtml(v.category)}</div>` : ""}
      <div class="modal-title">${escHtml(v.title)}</div>
      ${v.description ? `<div class="modal-desc">${escHtml(v.description)}</div>` : ""}
    </div>
  </div>
</div>`;
}

async function renderRecentPage(req, env) {
  const body = `
<div style="padding:20px 16px 16px;max-width:1200px;margin:0 auto;display:flex;align-items:center;justify-content:space-between">
  <div style="display:flex;align-items:center;gap:12px">
    <a href="/" class="btn btn-ghost btn-sm" style="text-decoration:none">&#8592; Kembali</a>
    <h2 style="margin:0;font-size:1.1rem;font-weight:700">Terakhir Dilihat</h2>
  </div>
  <button id="rp-clear-btn" class="btn btn-ghost btn-sm" style="display:none;color:var(--danger)" onclick="rpClear()">Hapus Semua</button>
</div>
<div class="container">
  <div id="rp-empty" class="empty" style="display:none">
    <div class="empty-icon">&#128065;</div>
    <h3>Belum ada riwayat</h3>
    <p>Video yang kamu tonton akan muncul di sini.</p>
  </div>
  <div class="video-grid" id="rp-grid"></div>
</div>
<div class="modal-overlay" id="rp-modal" style="display:none">
  <div class="modal">
    <div class="modal-header">
      <div></div>
      <button class="modal-close" onclick="rpCloseModal()">&times;</button>
    </div>
    <div class="embed-wrap" id="rp-embed"></div>
    <div class="modal-body" id="rp-modal-body"></div>
  </div>
</div>
<script>
(function() {
  var KEY = 'vk_recent';
  function gr() { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch(e) { return []; } }
  function sr(a) { try { localStorage.setItem(KEY, JSON.stringify(a)); } catch(e) {} }
  function ta(ts) {
    var d = Date.now() - ts, m = Math.floor(d/60000);
    if (m < 1) return 'baru saja';
    if (m < 60) return m + 'm lalu';
    var h = Math.floor(m/60);
    if (h < 24) return h + 'j lalu';
    return Math.floor(h/24) + 'h lalu';
  }
  function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'); }

  window.rpClear = function() { localStorage.removeItem(KEY); location.reload(); };

  window.rpCloseModal = function() {
    var m = document.getElementById('rp-modal');
    if (!m) return;
    var emb = document.getElementById('rp-embed');
    if (emb) emb.innerHTML = '';
    m.style.display = 'none';
    document.body.style.overflow = '';
  };

  window.rpOpenModal = function(idx) {
    var recent = gr();
    var r = recent[idx];
    if (!r) return;
    recent.splice(idx, 1);
    recent.unshift({id:r.id,title:r.title,thumb:r.thumb||'',rawurl:r.rawurl||'',ts:Date.now(),page:r.page||1,cat:r.cat||'',q:r.q||''});
    sr(recent);
    var isMp4 = r.rawurl && r.rawurl.toLowerCase().indexOf('.mp4') !== -1;
    var emb = document.getElementById('rp-embed');
    emb.innerHTML = '';
    if (isMp4 && r.rawurl) {
      var v = document.createElement('video');
      v.src = r.rawurl; v.controls = true; v.autoplay = true; v.playsInline = true;
      v.style.cssText = 'width:100%;height:100%;object-fit:contain;background:#000';
      emb.appendChild(v);
    } else if (r.rawurl) {
      var fr = document.createElement('iframe');
      fr.src = r.rawurl; fr.allowFullscreen = true;
      fr.allow = 'autoplay; encrypted-media'; fr.loading = 'lazy';
      emb.appendChild(fr);
    }
    var mb = document.getElementById('rp-modal-body');
    mb.innerHTML = (r.cat ? '<div class="modal-category">'+esc(r.cat)+'</div>' : '') + '<div class="modal-title">'+esc(r.title)+'</div>';
    var m = document.getElementById('rp-modal');
    m.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    m.onclick = function(e) { if (e.target === m) rpCloseModal(); };
  };

  var recent = gr();
  var grid = document.getElementById('rp-grid');
  var empty = document.getElementById('rp-empty');
  var clearBtn = document.getElementById('rp-clear-btn');
  if (!recent.length) { if (empty) empty.style.display = ''; return; }
  if (clearBtn) clearBtn.style.display = '';
  var html = '';
  for (var i = 0; i < recent.length; i++) {
    var r = recent[i];
    var isMp4 = r.rawurl && r.rawurl.toLowerCase().indexOf('.mp4') !== -1;
    var tHtml;
    if (isMp4 && r.rawurl) {
      tHtml = '<video src="'+esc(r.rawurl)+'" muted playsinline preload="metadata" style="width:100%;height:100%;object-fit:cover;display:block" onloadedmetadata="this.currentTime=0.001"></video>';
    } else if (r.thumb) {
      tHtml = '<img src="'+esc(r.thumb)+'" loading="lazy" style="width:100%;height:100%;object-fit:cover;display:block">';
    } else {
      tHtml = '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:2rem;color:var(--muted)">&#9654;</div>';
    }
    html += '<div class="video-card" style="cursor:pointer" data-ridx="'+i+'">';
    html += '<div class="video-thumb">'+tHtml+'</div>';
    html += '<div class="video-info">';
    if (r.cat) html += '<div class="video-category">'+esc(r.cat)+'</div>';
    html += '<div class="video-title">'+esc(r.title)+'</div>';
    html += '<div class="video-meta">'+ta(r.ts)+'</div>';
    html += '</div></div>';
  }
  grid.innerHTML = html;
  grid.addEventListener('click', function(e) {
    var card = e.target.closest('.video-card');
    if (card && card.dataset.ridx !== undefined) rpOpenModal(parseInt(card.dataset.ridx, 10));
  });
})();
</script>`;

  return new Response(layout('Terakhir Dilihat', body, { isAdmin: true }), {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
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

  const qParam = search ? "q=" + encodeURIComponent(search) + "&" : "";
  const filterBtns = [
    `<button class="filter-btn ${!category ? "active" : ""}" onclick="location.href='/?${qParam}'">Semua</button>`,
    `<button class="filter-btn" id="fav-filter-btn" onclick="vkToggleFavFilter(this)">&#9733; Favorit</button>`,
    ...categories.map(cat =>
      `<button class="filter-btn ${category === cat ? "active" : ""}" onclick="location.href='/?${qParam}cat=${encodeURIComponent(cat)}'">${escHtml(cat)}</button>`
    ),
  ].join("");

  const cards = (videos || []).map(renderVideoCard).join("");

  const body = `
<script>var VK_CATS=${JSON.stringify(categories)};var VK_PAGE=${page};var VK_CAT=${JSON.stringify(category)};var VK_Q=${JSON.stringify(search)};</script>
<div class="hero">
  <h1>V</h1>
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
    ? `<div class="video-grid" id="vk-grid">${cards}</div>`
    : `<div class="empty"><div class="empty-icon">&#128269;</div><h3>Belum ada video</h3><p>${search ? "Tidak ada hasil untuk pencarian kamu." : "Belum ada video yang ditambahkan."}</p></div>`
  }
  ${videos && videos.length === limit
    ? `<div class="pagination" id="vk-pagination">
        ${page > 1 ? `<a class="page-btn" href="?${qParam}${category ? "cat=" + encodeURIComponent(category) + "&" : ""}page=${page - 1}">&#8592;</a>` : ""}
        <span class="page-btn active">${page}</span>
        <a class="page-btn" href="?${qParam}${category ? "cat=" + encodeURIComponent(category) + "&" : ""}page=${page + 1}">&#8594;</a>
      </div>` : ""
  }
</div>
<div class="multi-bar" id="vk-multi-bar">
  <span class="multi-bar-info">0 dipilih</span>
  <button class="btn btn-ghost btn-sm" onclick="vkSelFavAll()">&#9733; Favorit</button>
  <button class="btn btn-ghost btn-sm" onclick="vkSelCat()">&#128193; Kategori</button>
  <button class="btn btn-ghost btn-sm" onclick="vkExitSelMode()">Batal</button>
</div>`;

  return new Response(layout("V", body, { isAdmin: true }), {
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

  let videos = [], categories = [], totalCount = null;
  try {
    [videos, categories, totalCount] = await Promise.all([
      getVideos(supabaseKey, { search, limit: 100 }),
      getCategories(supabaseKey),
      getVideoCount(supabaseKey, { search }),
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
      <button type="button" class="btn btn-ghost btn-sm" onclick="editVideo(${escHtml(JSON.stringify(JSON.stringify(v)))})">Edit</button>
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
    <div class="stat-card"><div class="stat-num">${totalCount !== null ? totalCount : (videos || []).length}</div><div class="stat-label">Total Video</div></div>
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
          <textarea id="bulk-input" rows="8" placeholder="cdn.videy.co/hQF0u32U1.mp4&#10;https://cdn.videy.co/xYz123.mp4&#10;https://videy.co/v?id=hQF0u32U1&#10;https://domain.com/video/?=hQF0u32U1&#10;https://domain.com/watch?v=hQF0u32U1&#10;https://other-host.com/video.mp4&#10;&#10;Format yang didukung:&#10;• cdn.videy.co/{id}.mp4 → langsung dipakai&#10;• URL .mp4 lainnya → langsung dipakai&#10;• Link dengan ?id= atau &id= → dikonversi ke CDN&#10;• Link dengan ={id} di query string → dikonversi ke CDN" style="width:100%;padding:10px 14px;background:var(--bg3);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:0.85rem;font-family:monospace;resize:vertical"></textarea>
        </div>
        <div id="bulk-scan-info" style="display:none;margin-bottom:10px;font-size:0.82rem;color:var(--text);padding:10px 14px;border-radius:8px;border:1px solid var(--accent);background:var(--bg2)"></div>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <div class="form-group" style="margin:0;flex:1;min-width:160px">
            <input type="text" id="bulk-category" list="cat-list-bulk" placeholder="Kategori (opsional)" style="width:100%;padding:9px 14px;background:var(--bg3);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:0.875rem;outline:none">
            <datalist id="cat-list-bulk">${catOptions}</datalist>
          </div>
          <button type="button" class="btn btn-primary" onclick="bulkScan()" style="flex-shrink:0">🔍 Scan Link</button>
        </div>
      </div>

      <!-- Step 2: Preview results -->
      <div id="bulk-step2" style="display:none">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:8px">
          <div style="font-size:0.875rem">
            <span id="bulk-count" style="font-weight:700;color:var(--accent2)"></span>
            <button type="button" onclick="bulkBack()" style="margin-left:12px;background:none;border:none;color:var(--muted);cursor:pointer;font-size:0.8rem;text-decoration:underline">← Edit ulang</button>
          </div>
          <div style="display:flex;gap:6px">
            <button type="button" class="btn btn-ghost btn-sm" onclick="bulkSelectAll(true)">Pilih Semua</button>
            <button type="button" class="btn btn-ghost btn-sm" onclick="bulkSelectAll(false)">Batal Semua</button>
          </div>
        </div>
        <div id="bulk-list" style="max-height:320px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;background:var(--bg3)"></div>
        <div style="margin-top:16px;display:flex;gap:10px;justify-content:flex-end">
          <button type="button" class="btn btn-ghost" onclick="bulkBack()">Batal</button>
          <button type="button" class="btn btn-primary" id="bulk-submit-btn" onclick="bulkSubmit()">💾 Simpan yang Dipilih</button>
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

// Read big-endian uint32 from Uint8Array
function readU32(b, o) { return ((b[o]<<24)|(b[o+1]<<16)|(b[o+2]<<8)|b[o+3])>>>0; }

// Fetch MP4 metadata: title (©nam) + duration (mvhd) + Content-Disposition
async function fetchMp4Meta(url) {
  var result = { title: null, duration: null };
  try {
    var res = await fetch(url, {
      headers: { 'Range': 'bytes=0-131071' }, // 128KB
      signal: AbortSignal.timeout(7000)
    });
    if (!res.ok && res.status !== 206) throw new Error('bad status');

    // Content-Disposition filename
    var cd = res.headers.get('content-disposition') || '';
    var cdMatch = cd.match(/filename\\*?=(?:UTF-8''|")?([^";\\n]+)/i);
    if (cdMatch) {
      var cdName = decodeURIComponent(cdMatch[1].trim().replace(/^"|"$/g,'').replace(/\\.mp4$/i,''));
      if (cdName && cdName.length > 2) result.title = cdName;
    }

    var buf = await res.arrayBuffer();
    var b = new Uint8Array(buf);
    var dec = new TextDecoder('utf-8', { fatal: false });

    for (var i = 0; i < b.length - 28; i++) {
      // ©nam atom → title
      if (!result.title && b[i]===0xA9 && b[i+1]===0x6E && b[i+2]===0x61 && b[i+3]===0x6D) {
        var dBoxSize = readU32(b, i+4);
        var tStart = i + 4 + 16; // skip data-box(8) + version_flags(4) + locale(4)
        var tLen = dBoxSize - 16;
        if (tLen > 0 && tLen < 512 && tStart + tLen <= b.length) {
          var t = dec.decode(b.slice(tStart, tStart + tLen)).trim();
          if (t) result.title = t;
        }
      }
      // mvhd atom → duration
      if (!result.duration && b[i]===0x6D && b[i+1]===0x76 && b[i+2]===0x68 && b[i+3]===0x64) {
        var ver = b[i+4];
        var timescale, durationTicks;
        if (ver === 0 && i + 24 <= b.length) {
          // v0: version(1)+flags(3)+creation(4)+modification(4)+timescale(4)+duration(4)
          timescale = readU32(b, i + 16);
          durationTicks = readU32(b, i + 20);
        } else if (ver === 1 && i + 36 <= b.length) {
          // v1: version(1)+flags(3)+creation(8)+modification(8)+timescale(4)+duration(8)
          timescale = readU32(b, i + 24);
          durationTicks = readU32(b, i + 32); // use upper 4 bytes (lower 4 sufficient for < 50h)
        }
        if (timescale > 0 && durationTicks > 0) {
          result.duration = Math.round(durationTicks / timescale);
        }
      }
      if (result.title && result.duration) break;
    }
  } catch(e) {}

  // Fallback title: clean filename from URL
  if (!result.title) {
    try {
      var parts = new URL(url).pathname.split('/');
      var fname = parts[parts.length-1].replace(/\\.mp4$/i,'').replace(/[_\\-\\.]+/g,' ').trim();
      if (fname && fname.length > 2) result.title = fname.charAt(0).toUpperCase() + fname.slice(1);
    } catch(e) {}
  }

  return result;
}

function fmtDurClient(sec) {
  if (!sec || sec <= 0) return '';
  var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
  if (h > 0) return h + ':' + String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0');
  return m + ':' + String(s).padStart(2,'0');
}

async function bulkFetchTitles() {
  var info = document.getElementById('bulk-scan-info');
  var total = bulkItems.length;
  var done = 0;

  info.innerHTML = '⏳ Ambil metadata... <b>0/' + total + '</b>';

  var idx = 0;
  async function fetchWorker() {
    while (idx < total) {
      var i = idx++;
      var item = bulkItems[i];
      var meta = await fetchMp4Meta(item.cdnUrl);
      if (meta.title) {
        bulkItems[i].title = meta.title;
        var inp = document.querySelector('#bulk-list input[type=text][data-idx="' + i + '"]');
        if (inp) inp.value = meta.title;
      }
      if (meta.duration) {
        bulkItems[i].duration = meta.duration;
        var durEl = document.querySelector('#bulk-list .dur-badge[data-idx="' + i + '"]');
        if (durEl) durEl.textContent = fmtDurClient(meta.duration);
      }
      done++;
      info.innerHTML = '⏳ Ambil metadata... <b>' + done + '/' + total + '</b>';
    }
  }

  var workers = [];
  for (var w = 0; w < Math.min(5, total); w++) workers.push(fetchWorker());
  await Promise.all(workers);

  var foundTitles = bulkItems.filter(function(x) { return x.title && !x.title.startsWith('Video '); }).length;
  var foundDur = bulkItems.filter(function(x) { return x.duration > 0; }).length;
  var directCount = bulkItems.filter(function(x) { return x.direct; }).length;
  var convertCount = total - directCount;
  var msg = '✅ ' + total + ' link';
  if (directCount > 0) msg += ' · <span style="color:var(--success)">' + directCount + ' CDN</span>';
  if (convertCount > 0) msg += ' · <span style="color:var(--accent2)">' + convertCount + ' dikonversi</span>';
  if (foundTitles > 0) msg += ' · <span style="color:var(--muted)">' + foundTitles + ' judul</span>';
  if (foundDur > 0) msg += ' · <span style="color:var(--muted)">' + foundDur + ' durasi</span>';
  info.innerHTML = msg;
  updateBulkBtn();
}

function bulkScan() {
  var info = document.getElementById('bulk-scan-info');
  if (!info) { alert('Error: elemen bulk-scan-info tidak ditemukan. Coba refresh halaman.'); return; }
  info.style.display = 'block';
  info.innerHTML = '⏳ Memproses...';
  info.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  try {
    var text = document.getElementById('bulk-input').value.trim();
    if (!text) {
      info.innerHTML = '❌ Textarea kosong. Paste link dulu sebelum scan.';
      return;
    }
    var seen = {};
    var found = [];

    // Split by lines first, then by comma/space as fallback
    var lines = text.split(/[\\n\\r]+/);
    var tokens = [];
    for (var li = 0; li < lines.length; li++) {
      var parts = lines[li].split(/[,\\s]+/);
      for (var pi = 0; pi < parts.length; pi++) {
        var p = parts[pi].trim();
        if (p) tokens.push(p);
      }
    }

    for (var t = 0; t < tokens.length; t++) {
      var token = tokens[t];

      // Pattern 1: cdn.videy.co/{id}.mp4 URL
      var cdnMatch = token.match(/cdn\\.videy\\.co\\/([A-Za-z0-9_\\-]+)(?:\\.mp4)?/i);
      if (cdnMatch) {
        var vid = cdnMatch[1];
        var fullUrl = 'https://cdn.videy.co/' + vid + '.mp4';
        if (!seen[fullUrl]) { seen[fullUrl] = true; found.push({ id: vid, cdnUrl: fullUrl, direct: true }); }
        continue;
      }

      // Pattern 2: any other direct .mp4 URL
      if (/^https?:\\/\\/[^\\s"'<>]+\\.mp4(\\?[^\\s"'<>]*)?$/i.test(token)) {
        if (!seen[token]) {
          seen[token] = true;
          var mp4Id = token.replace(/^https?:\\/\\//, '').replace(/[^A-Za-z0-9_\\-]/g, '_').slice(0, 24);
          found.push({ id: mp4Id, cdnUrl: token, direct: true });
        }
        continue;
      }

      // Pattern 3: ?id= or &id= param (e.g. videy.co/v?id=XXX)
      var idMatch = token.match(/[?&]id=([A-Za-z0-9_\\-]+)/);
      if (idMatch) {
        var vid2 = idMatch[1];
        var fullUrl2 = 'https://cdn.videy.co/' + vid2 + '.mp4';
        if (vid2.length >= 3 && !seen[fullUrl2]) { seen[fullUrl2] = true; found.push({ id: vid2, cdnUrl: fullUrl2, direct: false }); }
        continue;
      }

      // Pattern 3b: any =VALUE in query string (e.g. ?={id}, ?v={id}, ?file={id})
      // catches URLs like domain.com/video/?=hQF0u32U1 or https://domain.com/watch?v=hQF0u32U1
      if (token.indexOf('=') !== -1 && token.indexOf('.') !== -1) {
        var eqMatch = token.match(/[?&][^=]*=([A-Za-z0-9_\\-]{6,20})(?:[&#]|$)/);
        if (eqMatch) {
          var vid3 = eqMatch[1];
          var fullUrl3b = 'https://cdn.videy.co/' + vid3 + '.mp4';
          if (!seen[fullUrl3b]) { seen[fullUrl3b] = true; found.push({ id: vid3, cdnUrl: fullUrl3b, direct: false }); }
          continue;
        }
      }

      // Pattern 4: plain alphanumeric ID (6-16 chars, looks like a videy ID)
      if (/^[A-Za-z0-9_\\-]{6,20}$/.test(token) && token.indexOf('.') === -1) {
        var fullUrl3 = 'https://cdn.videy.co/' + token + '.mp4';
        if (!seen[fullUrl3]) { seen[fullUrl3] = true; found.push({ id: token, cdnUrl: fullUrl3, direct: false }); }
      }
    }

    if (!found.length) {
      info.innerHTML = '❌ Tidak ada link yang dikenali.<br><small>Format yang didukung: <b>cdn.videy.co/ID.mp4</b>, URL <b>.mp4</b> langsung, link dengan <b>?id=...</b>, link dengan <b>={id}</b> di query string, atau plain <b>ID</b> videy.</small>';
      return;
    }

    var directCount = found.filter(function(x) { return x.direct; }).length;
    var convertCount = found.length - directCount;
    var msg = '✅ ' + found.length + ' link ditemukan';
    if (directCount > 0) msg += ' · <span style="color:var(--success)">' + directCount + ' CDN</span>';
    if (convertCount > 0) msg += ' · <span style="color:var(--accent2)">' + convertCount + ' dikonversi</span>';
    info.innerHTML = msg;

    bulkItems = found.map(function(item) {
      return { id: item.id, cdnUrl: item.cdnUrl, selected: true, title: 'Video ' + item.id, direct: item.direct, duration: null };
    });
    document.getElementById('bulk-count').textContent = bulkItems.length + ' link ditemukan';
    renderBulkList();
    document.getElementById('bulk-step1').style.display = 'none';
    document.getElementById('bulk-step2').style.display = 'block';
    bulkFetchTitles();
  } catch(err) {
    info.innerHTML = '❌ Error: ' + err.message;
    console.error('bulkScan error:', err);
  }
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
    var typeBadge = item.direct
      ? '<span style="font-size:0.62rem;padding:1px 7px;border-radius:10px;background:rgba(52,211,153,0.15);color:var(--success);font-weight:600;flex-shrink:0">CDN ✓</span>'
      : '<span style="font-size:0.62rem;padding:1px 7px;border-radius:10px;background:rgba(167,139,250,0.15);color:var(--accent2);font-weight:600;flex-shrink:0">ID→CDN</span>';
    var durBadge = item.duration
      ? '<span class="dur-badge" data-idx="' + i + '" style="font-size:0.62rem;padding:1px 7px;border-radius:10px;background:rgba(0,0,0,0.35);color:#ccc;font-weight:600;flex-shrink:0">' + fmtDurClient(item.duration) + '</span>'
      : '<span class="dur-badge" data-idx="' + i + '" style="font-size:0.62rem;color:var(--muted);flex-shrink:0"></span>';
    html += '<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--border)">';
    html += '<input type="checkbox"' + chk + ' data-idx="' + i + '" onchange="bulkToggle(this)" style="width:16px;height:16px;accent-color:var(--accent);flex-shrink:0">';
    html += '<div style="flex:1;min-width:0">';
    html += '<div style="display:flex;align-items:center;gap:6px;margin-bottom:5px">';
    html += '<input type="text" value="' + escH(item.title) + '" data-idx="' + i + '" oninput="bulkTitle(this)" style="flex:1;padding:5px 10px;background:var(--bg2);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:0.8rem;outline:none">';
    html += durBadge + typeBadge;
    html += '</div>';
    html += '<div style="font-size:0.7rem;color:var(--muted);font-family:monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escH(item.cdnUrl) + '</div>';
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
      if (item.duration) fd.append('duration', String(item.duration));
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

    // ── GET /recent
    if (path === "/recent" && method === "GET") {
      return renderRecentPage(req, env);
    }

    // ── POST /api/move-cat — update video category
    if (path === "/api/move-cat" && method === "POST") {
      try {
        const body = await req.json();
        const id = (body.id || "").trim();
        const category = (body.category || "").trim();
        if (!id) return new Response(JSON.stringify({ error: "Missing id" }), { status: 400, headers: { "Content-Type": "application/json" } });
        await supabaseFetch(`${SUPABASE_TABLE}?id=eq.${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: JSON.stringify({ category }),
          prefer: "return=minimal",
        }, supabaseKey);
        return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { "Content-Type": "application/json" } });
      }
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
          const durationRaw = form.get("duration") || "";
          const duration = durationRaw ? parseInt(durationRaw, 10) || null : null;
          if (!title || !videoUrl) throw new Error("Judul dan link wajib diisi.");
          await createVideo({ title, url: videoUrl, category: category || null, description: description || null, ...(duration ? { duration } : {}) }, supabaseKey);
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
