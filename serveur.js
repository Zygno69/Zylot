#!/usr/bin/env node
// L'interface de Zylot, sur http://localhost:4000 — accessible depuis ce Mac seulement.
// Le serveur fait aussi tourner la surveillance des sites (toutes les 5 min) et les contrôles de sécurité (chaque jour).
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const S = require('./coeur/stockage');
const surveillance = require('./coeur/surveillance');
const securite = require('./coeur/securite');
const depots = require('./coeur/depots');
const conversation = require('./coeur/conversation');
const { prevenir } = require('./coeur/prevenir');

const { port } = S.config();
// zylot.localhost : un nom à mettre en favori (Chrome et Firefox le reconnaissent seuls ; Safari a besoin d'une ligne dans /etc/hosts).
const HOTES = new Set([`zylot.localhost:${port}`, `localhost:${port}`, `127.0.0.1:${port}`, 'zylot.localhost', 'localhost', '127.0.0.1']);

// --- Tâches de fond ---
let surveillanceEnCours = false, securiteEnCours = false;
async function surveiller() {
  if (surveillanceEnCours) return;
  surveillanceEnCours = true;
  try { await surveillance.tour(prevenir); } catch (e) { console.error('surveillance', e); }
  surveillanceEnCours = false;
}
async function controlerSecurite(forcer = false) {
  if (securiteEnCours) return;
  const d = Object.values(securite.derniers()).map(x => x.quand).sort()[0];
  if (!forcer && d && Date.now() - new Date(d) < 864e5) return;
  securiteEnCours = true;
  try { await securite.tour(prevenir); } catch (e) { console.error('securite', e); }
  securiteEnCours = false;
}
setTimeout(surveiller, 2000);
setInterval(surveiller, 5 * 60e3);
setTimeout(() => controlerSecurite(), 20e3);
setInterval(() => controlerSecurite(), 60 * 60e3);
setInterval(() => S.projets().forEach(p => surveillance.elaguer(p.id)), 24 * 36e5);

// L'état des dépôts change peu : on le relit au plus toutes les 30 s.
let cacheDepots = { quand: 0, valeur: {} };
async function etatDepots() {
  if (Date.now() - cacheDepots.quand > 30e3) cacheDepots = { quand: Date.now(), valeur: await depots.tous(S.projets()) };
  return cacheDepots.valeur;
}

// --- Réponses ---
function json(res, code, valeur) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(valeur));
}

function corps(req) {
  return new Promise(resolve => {
    let b = '';
    req.on('data', d => { b += d; if (b.length > 1e5) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); } });
  });
}

async function etat() {
  const alertes = S.alertesOuvertes();
  const secu = securite.derniers();
  const dep = await etatDepots();
  const projets = S.projets().map(p => {
    const r = S.dernierRapport(p.id);
    const surv = p.site ? surveillance.resume(p.id) : null;
    const controle = secu[p.id] || null;
    const ouvertes = alertes.filter(a => a.projet === p.id);
    return {
      id: p.id, nom: p.nom, site: p.site, note: p.note || null, admin: p.admin || null,
      dossierExiste: fs.existsSync(p.dossier),
      depot: dep[p.id] || null,
      surveillance: surv,
      securite: controle,
      notation: (controle || ouvertes.length) ? securite.note(controle, surv && surv.etat && surv.etat.cert, ouvertes) : null,
      dernier: r && {
        quand: r.quand, duree: r.duree, erreur: r.erreur || null, etat: r.etat || null,
        resume: r.resume || null, site: r.site || null, nbAlertes: (r.alertes || []).length,
        propositions: r.propositions || [],
      },
    };
  });
  return { projets, alertes, journal: S.lireJournal(40), enCours: S.verrou(), securiteEnCours, maintenant: new Date().toISOString() };
}

function lancerAudit(ids) {
  const enfant = spawn(process.execPath, [path.join(S.RACINE, 'nuit.js'), ...ids], {
    cwd: S.RACINE, detached: true, stdio: 'ignore', env: process.env,
  });
  enfant.unref();
}

http.createServer(async (req, res) => {
  // Refuser tout ce qui ne vient pas de ce Mac par son nom attendu (protège contre les pages web qui tenteraient d'appeler Zylot).
  if (!HOTES.has(req.headers.host)) return json(res, 403, { erreur: 'Hôte refusé' });
  const url = new URL(req.url, 'http://localhost');

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return fs.createReadStream(path.join(S.RACINE, 'interface', 'index.html')).pipe(res);
  }
  if (req.method === 'GET' && url.pathname === '/api/etat') return json(res, 200, await etat());
  const mc = url.pathname.match(/^\/api\/conversation\/([a-z0-9-]+)(?:\/(message|garder|jeter|arreter))?$/);
  const projetConv = mc && S.projets().find(p => p.id === mc[1]);
  if (mc && !projetConv) return json(res, 404, { erreur: 'Projet inconnu' });
  if (mc && req.method === 'GET' && !mc[2]) return json(res, 200, conversation.etat(projetConv.id));

  if (req.method === 'POST') {
    // Un en-tête maison : un autre site ne peut pas l'envoyer sans autorisation CORS, que Zylot ne donne jamais.
    if (req.headers['x-zylot'] !== '1') return json(res, 403, { erreur: 'Requête refusée' });
    const m = url.pathname.match(/^\/api\/alertes\/([a-z0-9]+)\/vu$/);
    if (m) {
      const a = S.marquerVu(m[1]);
      if (!a) return json(res, 404, { erreur: 'Alerte introuvable' });
      S.journal(S.projets().find(p => p.id === a.projet)?.nom || a.projet, `alerte vue : ${a.titre}`);
      return json(res, 200, { ok: true });
    }
    if (url.pathname === '/api/audit') {
      if (S.verrou()) return json(res, 409, { erreur: 'Un audit tourne déjà' });
      const { projets = [] } = await corps(req);
      const connus = new Set(S.projets().map(p => p.id));
      const ids = projets.filter(id => connus.has(id));
      if (projets.length && !ids.length) return json(res, 400, { erreur: 'Projet inconnu' });
      lancerAudit(ids);
      return json(res, 202, { ok: true });
    }
    if (mc && mc[2] === 'message') {
      const { texte = '', mode = 'discussion' } = await corps(req);
      if (!String(texte).trim()) return json(res, 400, { erreur: 'Message vide' });
      const r = await conversation.envoyer(projetConv, String(texte).slice(0, 8000), mode === 'travail' ? 'travail' : 'discussion');
      return json(res, r.erreur ? 409 : 202, r);
    }
    if (mc && mc[2] === 'garder') { const r = await conversation.garder(projetConv); return json(res, r.erreur ? 409 : 200, r); }
    if (mc && mc[2] === 'jeter') { const r = await conversation.jeter(projetConv); return json(res, r.erreur ? 409 : 200, r); }
    if (mc && mc[2] === 'arreter') return json(res, 200, conversation.arreter(projetConv.id));
    if (url.pathname === '/api/surveillance') { surveiller(); return json(res, 202, { ok: true }); }
    if (url.pathname === '/api/securite') {
      if (securiteEnCours) return json(res, 409, { erreur: 'Contrôles déjà en cours' });
      controlerSecurite(true); return json(res, 202, { ok: true });
    }
  }
  json(res, 404, { erreur: 'Introuvable' });
}).listen(port, '127.0.0.1', () => console.log(`Zylot : http://zylot.localhost:${port}`));
