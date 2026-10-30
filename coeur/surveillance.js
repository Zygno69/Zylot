// Surveillance des sites, sans Claude : le site répond-il, en combien de temps, et jusqu'à quand son certificat est valable.
const tls = require('tls');
const fs = require('fs');
const path = require('path');
const S = require('./stockage');

const DOSSIER = path.join(S.DONNEES, 'surveillance');
fs.mkdirSync(DOSSIER, { recursive: true });
const AGENT = 'Zylot-surveillance/1.0';

const ERREURS = {
  ERR_TLS_CERT_ALTNAME_INVALID: 'certificat qui ne correspond pas au domaine',
  CERT_HAS_EXPIRED: 'certificat expiré',
  DEPTH_ZERO_SELF_SIGNED_CERT: 'certificat non reconnu (auto-signé)',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'certificat non reconnu',
  ENOTFOUND: 'domaine introuvable (DNS)',
  ECONNREFUSED: 'connexion refusée par le serveur',
  ECONNRESET: 'connexion coupée par le serveur',
  ETIMEDOUT: 'ne répond pas',
};

function certificat(hote) {
  return new Promise(resolve => {
    const s = tls.connect({ host: hote, port: 443, servername: hote, timeout: 10000 }, () => {
      const c = s.getPeerCertificate();
      s.end();
      if (!c || !c.valid_to) return resolve(null);
      const expire = new Date(c.valid_to);
      resolve({ expire: expire.toISOString(), jours: Math.floor((expire - Date.now()) / 864e5), emetteur: c.issuer && (c.issuer.O || c.issuer.CN) });
    });
    s.on('error', () => resolve(null));
    s.on('timeout', () => { s.destroy(); resolve(null); });
  });
}

async function verifier(site) {
  const debut = Date.now();
  try {
    const r = await fetch(site, { redirect: 'follow', headers: { 'User-Agent': AGENT }, signal: AbortSignal.timeout(15000) });
    const ms = Date.now() - debut;
    await r.arrayBuffer();
    return { quand: new Date().toISOString(), ok: r.status < 400, code: r.status, ms, url: r.url };
  } catch (e) {
    return { quand: new Date().toISOString(), ok: false, code: null, ms: null, erreur: e.name === 'TimeoutError' ? 'ne répond pas (15 s)' : ERREURS[e.cause && e.cause.code] || (e.cause && e.cause.code) || e.message };
  }
}

function historique(id, jours = 30) {
  try {
    const limite = Date.now() - jours * 864e5;
    return fs.readFileSync(path.join(DOSSIER, id + '.jsonl'), 'utf8').trim().split('\n').filter(Boolean)
      .map(l => JSON.parse(l)).filter(x => new Date(x.quand) >= limite);
  } catch { return []; }
}

// On ne garde que 30 jours d'historique.
function elaguer(id) {
  const h = historique(id, 30);
  fs.writeFileSync(path.join(DOSSIER, id + '.jsonl'), h.map(x => JSON.stringify(x)).join('\n') + (h.length ? '\n' : ''));
}

function dispo(h, heures) {
  const limite = Date.now() - heures * 36e5;
  const x = h.filter(v => new Date(v.quand) >= limite);
  if (!x.length) return null;
  return Math.round(x.filter(v => v.ok).length / x.length * 1000) / 10;
}

// Résumé pour l'interface : dernier état, disponibilité, temps de réponse des dernières 24 h (moyenne par heure).
function resume(id) {
  const h = historique(id, 30);
  const etat = S.lire(path.join(DOSSIER, 'etat.json'), {})[id] || null;
  const heures = [];
  for (let i = 23; i >= 0; i--) {
    const de = Date.now() - (i + 1) * 36e5, a = Date.now() - i * 36e5;
    const x = h.filter(v => { const t = new Date(v.quand); return t >= de && t < a; });
    const oks = x.filter(v => v.ok && v.ms != null);
    heures.push(x.length ? { ms: oks.length ? Math.round(oks.reduce((s, v) => s + v.ms, 0) / oks.length) : null, panne: x.some(v => !v.ok) } : null);
  }
  const pannes = [];
  for (let i = 0; i < h.length; i++) if (!h[i].ok && (i === 0 || h[i - 1].ok)) pannes.push({ debut: h[i].quand, erreur: h[i].erreur || 'code ' + h[i].code });
  return { etat, dispo24: dispo(h, 24), dispo7: dispo(h, 168), dispo30: dispo(h, 720), heures, pannes: pannes.slice(-5).reverse(), mesures: h.length };
}

// Le commit en ligne, si le site publie zylot-version.txt (« <sha> <date> »), déposé à chaque mise en ligne par la CI.
async function versionEnLigne(site) {
  try {
    const r = await fetch(site.replace(/\/$/, '') + '/zylot-version.txt', { headers: { 'User-Agent': AGENT, 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const m = (await r.text()).trim().match(/^([0-9a-f]{7,40})\s+(\S+)/);
    return m ? { sha: m[1], date: m[2] } : null;
  } catch { return null; }
}

// Un tour de surveillance sur tous les sites (ou un seul). Une panne n'est annoncée qu'au deuxième échec de suite, pour éviter les fausses alertes.
// hooks.surMiseEnLigne(p, version) est appelé quand une nouvelle version apparaît sur un site.
async function tour(prevenir, hooks = {}, seulement = null) {
  const fEtat = path.join(DOSSIER, 'etat.json');
  const etats = S.lire(fEtat, {});
  for (const p of S.projets().filter(p => p.site && (!seulement || p.id === seulement))) {
    const v = await verifier(p.site);
    fs.appendFileSync(path.join(DOSSIER, p.id + '.jsonl'), JSON.stringify({ quand: v.quand, ok: v.ok, code: v.code, ms: v.ms, erreur: v.erreur }) + '\n');
    const avant = etats[p.id] || {};
    const echecs = v.ok ? 0 : (avant.echecs || 0) + 1;
    const cert = (!avant.cert || !avant.certVerifie || Date.now() - new Date(avant.certVerifie) > 6 * 36e5)
      ? await certificat(new URL(p.site).hostname) : avant.cert;
    const version = await versionEnLigne(p.site);
    etats[p.id] = { ...v, echecs, enPanne: echecs >= 2, cert, certVerifie: cert === avant.cert ? avant.certVerifie : new Date().toISOString(), version: version || avant.version || null };
    if (version && (!avant.version || avant.version.sha !== version.sha)) {
      S.noterDeploiement(p.id, { sha: version.sha, misEnLigne: version.date, via: 'CI GitHub', premiereLecture: !avant.version });
      if (avant.version) {
        S.journal(p.nom, `nouvelle version en ligne : ${version.sha.slice(0, 7)}`);
        prevenir && prevenir(`${p.nom} est en ligne`, `Version ${version.sha.slice(0, 7)} en production.`);
        hooks.surMiseEnLigne && hooks.surMiseEnLigne(p, version);
      }
    }

    if (echecs === 2) {
      S.journal(p.nom, `site en panne : ${v.erreur || 'code ' + v.code}`, 'urgent');
      prevenir && prevenir(`${p.nom} ne répond plus`, `${p.site} : ${v.erreur || 'code ' + v.code}`, true);
    }
    if (v.ok && avant.enPanne) {
      S.journal(p.nom, 'site de nouveau en ligne');
      prevenir && prevenir(`${p.nom} est revenu`, `${p.site} répond de nouveau.`);
    }
    if (cert && cert.jours <= 14 && (!avant.cert || avant.cert.jours > 14)) {
      S.journal(p.nom, `certificat expire dans ${cert.jours} jours`, 'urgent');
      prevenir && prevenir(`Certificat ${p.nom}`, `Expire dans ${cert.jours} jours.`, true);
    }
  }
  S.ecrire(fEtat, etats);
}

module.exports = { tour, resume, elaguer, ERREURS };
