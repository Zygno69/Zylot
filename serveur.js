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

// Les suggestions de Zylot pour un projet, de la plus importante à la moins importante.
// Ce sont elles que Claude reçoit, et que la conversation propose quand elle est vide.
async function suggestionsProjet(p) {
  const l = [];
  const ajout = (gravite, titre, detail) => l.push({ gravite, titre, detail });
  const e = p.site ? surveillance.resume(p.id).etat : null;
  if (e && e.enPanne) ajout('urgent', 'Remettre le site en ligne', `${p.site} ne répond plus : ${e.erreur || 'code ' + e.code}.`);
  if (e && e.cert && e.cert.jours < 30) ajout(e.cert.jours < 14 ? 'urgent' : 'securite', 'Renouveler le certificat', `Il expire dans ${e.cert.jours} jours.`);
  const c = securite.derniers()[p.id];
  for (const pt of (c && c.points) || []) {
    if (pt.titre.startsWith('En-tête manquant')) continue;
    ajout(pt.gravite, pt.titre.replace(/^Le serveur affiche ses versions$/, 'Masquer la version du serveur'), pt.detail);
  }
  const manquants = c && c.entetes ? Object.entries(c.entetes).filter(([, v]) => !v).map(([k]) => k) : [];
  if (manquants.length) ajout('info', 'Ajouter les en-têtes de protection', `Manquants : ${manquants.join(', ')}. Quelques lignes dans le .htaccess.`);
  for (const a of S.alertesOuvertes().filter(a => a.projet === p.id)) ajout(a.gravite, a.titre, a.detail);
  const d = (await depots.tous([p]))[p.id] || {};
  if (d.git && !d.dernierCommit) ajout('securite', 'Faire un premier commit et le pousser sur GitHub', 'Le code n\'existe que sur ce Mac et sur le serveur.');
  if (d.nonPousses > 0) ajout('info', `Pousser ${d.nonPousses} commit${d.nonPousses > 1 ? 's' : ''} sur GitHub`, 'Ce travail n\'existe que sur ce Mac.');
  if (d.dernierCommit && Date.now() - new Date(d.dernierCommit.quand) > 60 * 864e5) ajout('info', 'Faire le point sur ce projet endormi', 'Pas de commit depuis plus de deux mois : dépendances et sécurité à revoir s\'il est toujours en service.');
  const r = S.dernierRapport(p.id);
  for (const x of (r && r.propositions) || []) ajout('info', x.titre, x.detail);
  const ordre = { urgent: 0, securite: 1, info: 2 };
  return l.sort((a, b) => ordre[a.gravite] - ordre[b.gravite]);
}

// Ce que Zylot sait d'un projet, en quelques lignes, pour Claude.
async function contexteProjet(p) {
  const surv = p.site ? surveillance.resume(p.id) : null, e = surv && surv.etat;
  const c = securite.derniers()[p.id];
  const d = (await depots.tous([p]))[p.id] || {};
  const l = [];
  l.push(`- Dossier du projet : ${p.dossier}${p.deploy ? ` · mise en prod : ${p.deploy}` : ' · pas de commande de mise en prod configurée'}`);
  if (p.site) l.push(`- Site ${p.site} : ${e ? (e.ok ? `en ligne (${e.ms} ms)` : 'HORS LIGNE : ' + (e.erreur || 'code ' + e.code)) : 'pas encore testé'}${e && e.cert ? `, certificat valable ${e.cert.jours} jours` : ''}`);
  if (c) l.push(`- Contrôle de sécurité (${c.quand.slice(0, 10)}) : ${c.points.length ? c.points.map(x => x.titre).join(' ; ') : 'rien à signaler'}`);
  if (d.git) l.push(`- Git : dernier commit ${d.dernierCommit ? d.dernierCommit.quand.slice(0, 10) + ' « ' + d.dernierCommit.message + ' »' : 'aucun'}, ${d.nonCommites} fichier(s) non commité(s) dans le dossier, ${d.nonPousses == null ? 'pas de suivi GitHub' : d.nonPousses + ' commit(s) non poussé(s)'}`);
  const sg = await suggestionsProjet(p);
  l.push('', 'Suggestions affichées au propriétaire dans Zylot, de la plus importante à la moins importante :');
  l.push(...(sg.length ? sg.map((x, i) => `${i + 1}. ${x.titre} — ${x.detail}`) : ['(aucune)']));
  return l.join('\n');
}

// Après une mise en ligne : le site répond-il, et les contrôles de sécurité sont-ils meilleurs ?
async function verifierApresMiseEnLigne(p) {
  if (!p.site) return '';
  await surveillance.tour(prevenir);
  const e = surveillance.resume(p.id).etat;
  const c = await securite.unProjet(p);
  return `${e && e.ok ? `Le site répond (${e.ms} ms).` : 'ATTENTION : le site ne répond pas (' + ((e && (e.erreur || 'code ' + e.code)) || '?') + ').'}` +
    (c ? `\nContrôle de sécurité refait : ${c.points.length ? c.points.map(x => x.titre).join(' ; ') : 'plus rien à signaler'}.` : '');
}

// Mise en ligne lancée par un bouton : à la fin, Zylot prévient Claude, qui vérifie et rend compte au propriétaire.
function lancerMiseEnLigne(p, reponse) {
  conversation.deployer(p, () => verifierApresMiseEnLigne(p), null, { confirme: true, reponse })
    .then(async r => {
      if (r.erreur && !r.message) r.message = r.erreur;
      if (/pose une question/.test(r.message || '')) return;
      await conversation.envoyer(p, `La mise en ligne lancée par le propriétaire est terminée. Compte rendu de Zylot :\n${r.message}\n\nVérifie toi-même sur le site (curl) que ce qui devait partir est bien en ligne, puis dis-lui en deux ou trois phrases ce que tu constates.`,
        await contexteProjet(p), { role: 'zylot' });
    })
    .catch(e => console.error('mise en ligne', e));
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
  const mc = url.pathname.match(/^\/api\/conversation\/([a-z0-9-]+)(?:\/(message|garder|jeter|arreter|nouvelle|deployer|annulerprod|repondreprod))?$/);
  const projetConv = mc && S.projets().find(p => p.id === mc[1]);
  if (mc && !projetConv) return json(res, 404, { erreur: 'Projet inconnu' });
  if (mc && req.method === 'GET' && !mc[2]) return json(res, 200, { ...conversation.etat(projetConv.id), suggestions: await suggestionsProjet(projetConv) });

  // Appels de la commande `zylot`, lancée par Claude pendant une conversation.
  const ma = url.pathname.match(/^\/api\/agent\/([a-z0-9-]+)\/(garder|deployer|pousser|etat)$/);
  if (ma && req.method === 'POST') {
    const p = S.projets().find(x => x.id === ma[1]);
    if (!p || req.headers['x-zylot'] !== '1' || !conversation.jetonValide(p.id, req.headers['x-zylot-jeton'])) return json(res, 403, { erreur: 'Refusé : pas de conversation en cours pour ce projet.' });
    if (ma[2] === 'etat') return json(res, 200, { message: await contexteProjet(p) });
    const { message } = await corps(req);
    if (ma[2] === 'garder') return json(res, 200, await conversation.garder(p, message));
    if (ma[2] === 'pousser') return json(res, 200, await conversation.pousser(p));
    return json(res, 200, await conversation.deployer(p, () => verifierApresMiseEnLigne(p), message));
  }

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
      const { texte = '' } = await corps(req);
      if (!String(texte).trim()) return json(res, 400, { erreur: 'Message vide' });
      const r = await conversation.envoyer(projetConv, String(texte).slice(0, 8000), await contexteProjet(projetConv));
      return json(res, r.erreur ? 409 : 202, r);
    }
    if (mc && mc[2] === 'deployer') {
      if (conversation.enCours.has(projetConv.id)) return json(res, 409, { erreur: 'Claude travaille encore : attendez qu\'il ait fini.' });
      lancerMiseEnLigne(projetConv, '');
      return json(res, 202, { ok: true });
    }
    if (mc && mc[2] === 'repondreprod') {
      const { reponse } = await corps(req);
      if (reponse !== 'oui') return json(res, 200, conversation.annulerProd(projetConv.id));
      if (conversation.enCours.has(projetConv.id)) return json(res, 409, { erreur: 'Claude travaille encore : attendez qu\'il ait fini.' });
      lancerMiseEnLigne(projetConv, 'o\n');
      return json(res, 202, { ok: true });
    }
    if (mc && mc[2] === 'annulerprod') return json(res, 200, conversation.annulerProd(projetConv.id));
    if (mc && mc[2] === 'nouvelle') { const r = await conversation.nouvelle(projetConv); return json(res, r.erreur ? 409 : 200, r); }
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
