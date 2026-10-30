#!/usr/bin/env node
// L'interface de Zylot, sur http://localhost:4000 — accessible depuis ce Mac seulement.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const S = require('./coeur/stockage');

const { port } = S.config();
const HOTES = new Set([`localhost:${port}`, `127.0.0.1:${port}`]);

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

function etat() {
  const projets = S.projets().map(p => {
    const r = S.dernierRapport(p.id);
    return {
      id: p.id, nom: p.nom, site: p.site, note: p.note || null,
      dossierExiste: fs.existsSync(p.dossier),
      dernier: r && {
        quand: r.quand, duree: r.duree, erreur: r.erreur || null, etat: r.etat || null,
        resume: r.resume || null, site: r.site || null, nbAlertes: (r.alertes || []).length,
        propositions: r.propositions || [],
      },
    };
  });
  return { projets, alertes: S.alertesOuvertes(), journal: S.lireJournal(30), enCours: S.verrou() };
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
  if (req.method === 'GET' && url.pathname === '/api/etat') return json(res, 200, etat());

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
  }
  json(res, 404, { erreur: 'Introuvable' });
}).listen(port, '127.0.0.1', () => console.log(`Zylot : http://localhost:${port}`));
