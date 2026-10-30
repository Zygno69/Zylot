// Tout ce que Zylot garde sur le disque, dans donnees/ (jamais dans git).
const fs = require('fs');
const path = require('path');
const os = require('os');

const RACINE = path.join(__dirname, '..');
const DONNEES = path.join(RACINE, 'donnees');
const RAPPORTS = path.join(DONNEES, 'rapports');
const F_ALERTES = path.join(DONNEES, 'alertes.json');
const F_JOURNAL = path.join(DONNEES, 'journal.jsonl');
const F_VERROU = path.join(DONNEES, 'en-cours.json');

fs.mkdirSync(RAPPORTS, { recursive: true });

function lire(fichier, defaut) {
  try { return JSON.parse(fs.readFileSync(fichier, 'utf8')); } catch { return defaut; }
}

// Écriture atomique : on écrit à côté puis on renomme, pour ne jamais laisser un fichier à moitié écrit.
function ecrire(fichier, valeur) {
  const tmp = fichier + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(valeur, null, 2));
  fs.renameSync(tmp, fichier);
}

function config() {
  return { port: 4000, modele: 'sonnet', ntfy: '', ...lire(path.join(RACINE, 'config.local.json'), {}) };
}

function projets() {
  return lire(path.join(RACINE, 'projets.json'), []).map(p => ({
    ...p,
    dossier: p.dossier.replace(/^~(?=\/|$)/, os.homedir()),
  }));
}

function aujourdhui(d = new Date()) {
  return d.toLocaleDateString('sv-SE'); // AAAA-MM-JJ, heure locale
}

// --- Journal ---
function journal(projet, message, niveau = 'info') {
  const ligne = { quand: new Date().toISOString(), projet, message, niveau };
  fs.appendFileSync(F_JOURNAL, JSON.stringify(ligne) + '\n');
}

function lireJournal(n = 40) {
  try {
    return fs.readFileSync(F_JOURNAL, 'utf8').trim().split('\n').filter(Boolean)
      .slice(-n).map(l => JSON.parse(l)).reverse();
  } catch { return []; }
}

// --- Rapports ---
function enregistrerRapport(idProjet, rapport) {
  const dossier = path.join(RAPPORTS, aujourdhui());
  fs.mkdirSync(dossier, { recursive: true });
  ecrire(path.join(dossier, idProjet + '.json'), rapport);
}

function dernierRapport(idProjet) {
  let dates = [];
  try { dates = fs.readdirSync(RAPPORTS).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse(); } catch {}
  for (const d of dates) {
    const r = lire(path.join(RAPPORTS, d, idProjet + '.json'), null);
    if (r) return r;
  }
  return null;
}

// --- Alertes ---
// Une alerte encore ouverte avec le même titre sur le même projet n'est pas recréée : on note seulement qu'elle a été revue.
function ajouterAlertes(idProjet, nouvelles) {
  const toutes = lire(F_ALERTES, []);
  let ajoutees = 0;
  for (const a of nouvelles) {
    const existante = toutes.find(x => x.projet === idProjet && !x.vu && x.titre === a.titre);
    if (existante) { existante.revue = new Date().toISOString(); existante.detail = a.detail; continue; }
    toutes.push({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      projet: idProjet, quand: new Date().toISOString(), vu: false, ...a,
    });
    ajoutees++;
  }
  ecrire(F_ALERTES, toutes);
  return ajoutees;
}

function alertesOuvertes() {
  return lire(F_ALERTES, []).filter(a => !a.vu);
}

function marquerVu(id) {
  const toutes = lire(F_ALERTES, []);
  const a = toutes.find(x => x.id === id);
  if (!a) return null;
  a.vu = new Date().toISOString();
  ecrire(F_ALERTES, toutes);
  return a;
}

// --- Audit en cours (un seul à la fois) ---
function verrou() {
  const v = lire(F_VERROU, null);
  if (!v) return null;
  try { process.kill(v.pid, 0); return v; } catch { fs.rmSync(F_VERROU, { force: true }); return null; }
}
function poserVerrou(etat) { ecrire(F_VERROU, { pid: process.pid, ...etat }); }
function leverVerrou() { fs.rmSync(F_VERROU, { force: true }); }

module.exports = {
  RACINE, config, projets, journal, lireJournal, enregistrerRapport, dernierRapport,
  ajouterAlertes, alertesOuvertes, marquerVu, verrou, poserVerrou, leverVerrou,
};
