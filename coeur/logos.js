// Le logo de chaque site : l'icône qu'il déclare (apple-touch-icon de préférence, plus grande), sinon /favicon.ico.
// Gardé dans donnees/logos/, rafraîchi une fois par semaine.
const fs = require('fs');
const path = require('path');
const S = require('./stockage');

const DOSSIER = path.join(S.DONNEES, 'logos');
fs.mkdirSync(DOSSIER, { recursive: true });
const AGENT = 'Zylot-logos/1.0';
const TYPES = { 'image/png': 'png', 'image/x-icon': 'ico', 'image/vnd.microsoft.icon': 'ico', 'image/svg+xml': 'svg', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };

function existant(id) {
  for (const ext of new Set(Object.values(TYPES))) {
    const f = path.join(DOSSIER, `${id}.${ext}`);
    if (fs.existsSync(f)) return { fichier: f, ext };
  }
  return null;
}

async function telecharger(url) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': AGENT }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    const type = (r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const ext = TYPES[type] || (url.match(/\.(png|ico|svg|jpe?g|webp|gif)(\?|$)/i) || [])[1]?.toLowerCase().replace('jpeg', 'jpg');
    if (!ext) return null;
    const donnees = Buffer.from(await r.arrayBuffer());
    if (!donnees.length || donnees.length > 5e5) return null;
    return { ext, donnees };
  } catch { return null; }
}

async function chercher(p) {
  if (!p.site) return null;
  const base = p.site.replace(/\/$/, '');
  const candidats = [];
  try {
    const r = await fetch(base + '/', { headers: { 'User-Agent': AGENT }, signal: AbortSignal.timeout(10000) });
    const html = (await r.text()).slice(0, 200000);
    for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
      const tag = m[0];
      const rel = (tag.match(/rel=["']([^"']+)["']/i) || [])[1] || '';
      const href = (tag.match(/href=["']([^"']+)["']/i) || [])[1];
      if (!href || !/icon/i.test(rel)) continue;
      const taille = Number(((tag.match(/sizes=["'](\d+)x\d+["']/i) || [])[1]) || (/apple-touch/i.test(rel) ? 180 : 32));
      try { candidats.push({ url: new URL(href, base + '/').href, taille }); } catch {}
    }
  } catch {}
  candidats.sort((a, b) => b.taille - a.taille);
  candidats.push({ url: base + '/favicon.ico', taille: 16 });
  for (const c of candidats) {
    const img = await telecharger(c.url);
    if (img) return img;
  }
  return null;
}

async function rafraichir(p, forcer = false) {
  const e = existant(p.id);
  if (e && !forcer && Date.now() - fs.statSync(e.fichier).mtimeMs < 7 * 864e5) return;
  const img = await chercher(p);
  if (!img) return;
  if (e) fs.rmSync(e.fichier, { force: true });
  fs.writeFileSync(path.join(DOSSIER, `${p.id}.${img.ext}`), img.donnees);
}

async function tous() { for (const p of S.projets()) await rafraichir(p).catch(() => {}); }

const MIME = { png: 'image/png', ico: 'image/x-icon', svg: 'image/svg+xml', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
function servir(id, res) {
  const e = existant(id);
  if (!e) return false;
  // SVG servi avec une politique stricte : une icône ne doit jamais pouvoir exécuter de script.
  res.writeHead(200, { 'Content-Type': MIME[e.ext], 'Cache-Control': 'max-age=86400', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'", 'X-Content-Type-Options': 'nosniff' });
  fs.createReadStream(e.fichier).pipe(res);
  return true;
}

module.exports = { tous, servir, rafraichir };
