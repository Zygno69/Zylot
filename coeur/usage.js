// Statistiques d'usage métier : chaque appli expose une page qui renvoie des chiffres agrégés (jamais de donnée personnelle).
//
// Contrat de la page (JSON) :
//   { "genere": "2026-10-30T20:00:00Z",
//     "indicateurs": [ { "id": "connexions_7j", "libelle": "Connexions sur 7 jours", "valeur": 42,
//                        "precedent": 35, "principal": true, "aide": "…" } ],
//     "series": [ { "id": "connexions_jour", "libelle": "Connexions par jour", "points": [["2026-10-01", 3], …] } ] }
// « precedent » = la même mesure sur la période d'avant (pour la tendance). « principal » = affiché dans le cockpit.
//
// Authentification : en-tête X-Zylot-Jeton. Le jeton est dans config.local.json (jetonsStats) ; l'appli n'en connaît
// que l'empreinte SHA-256, écrite dans son code : rien à déposer à la main sur le serveur.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const S = require('./stockage');

const DOSSIER = path.join(S.DONNEES, 'usage');
fs.mkdirSync(DOSSIER, { recursive: true });
const F_CONFIG = path.join(S.RACINE, 'config.local.json');

function jeton(id) { return (S.config().jetonsStats || {})[id] || null; }

// Crée (ou relit) le jeton d'un projet et renvoie son empreinte, à écrire dans le code de l'appli.
function preparerJeton(id) {
  const conf = S.lire(F_CONFIG, {});
  conf.jetonsStats = conf.jetonsStats || {};
  if (!conf.jetonsStats[id]) {
    conf.jetonsStats[id] = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(F_CONFIG, JSON.stringify(conf, null, 2));
  }
  return crypto.createHash('sha256').update(conf.jetonsStats[id]).digest('hex');
}

function nettoyer(d) {
  const nombre = v => (typeof v === 'number' && isFinite(v)) ? v : null;
  const texte = (v, n = 120) => typeof v === 'string' ? v.slice(0, n) : '';
  return {
    genere: texte(d.genere, 40) || new Date().toISOString(),
    indicateurs: (Array.isArray(d.indicateurs) ? d.indicateurs : []).slice(0, 40).map(x => ({
      id: texte(x.id, 60), libelle: texte(x.libelle), valeur: nombre(x.valeur), precedent: nombre(x.precedent),
      principal: !!x.principal, aide: texte(x.aide, 300), unite: texte(x.unite, 20), groupe: texte(x.groupe, 60),
    })).filter(x => x.id && x.libelle),
    series: (Array.isArray(d.series) ? d.series : []).slice(0, 6).map(s => ({
      id: texte(s.id, 60), libelle: texte(s.libelle),
      points: (Array.isArray(s.points) ? s.points : []).slice(-120).filter(p => Array.isArray(p) && typeof p[0] === 'string' && typeof p[1] === 'number').map(p => [p[0].slice(0, 10), p[1]]),
    })).filter(s => s.id),
  };
}

async function relever(p) {
  if (!p.stats || !jeton(p.id)) return null;
  const f = path.join(DOSSIER, p.id + '.json');
  try {
    const r = await fetch(p.stats, { headers: { 'X-Zylot-Jeton': jeton(p.id), 'User-Agent': 'Zylot-usage/1.0', 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error('code ' + r.status);
    const d = nettoyer(await r.json());
    S.ecrire(f, { ...d, releve: new Date().toISOString(), erreur: null });
    // Un relevé par jour pour les tendances (le dernier de la journée remplace les précédents).
    const fh = path.join(DOSSIER, p.id + '-historique.jsonl');
    const jour = S.aujourdhui();
    let lignes = [];
    try { lignes = fs.readFileSync(fh, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch {}
    lignes = lignes.filter(l => l.jour !== jour).slice(-400);
    lignes.push({ jour, valeurs: Object.fromEntries(d.indicateurs.map(x => [x.id, x.valeur])) });
    fs.writeFileSync(fh, lignes.map(l => JSON.stringify(l)).join('\n') + '\n');
    return d;
  } catch (e) {
    const avant = S.lire(f, null);
    S.ecrire(f, { ...(avant || { indicateurs: [], series: [] }), erreur: e.message, essai: new Date().toISOString() });
    return null;
  }
}

async function tous() { for (const p of S.projets()) await relever(p).catch(() => {}); }

function dernier(id) { return S.lire(path.join(DOSSIER, id + '.json'), null); }
function historique(id, jours = 90) {
  try {
    return fs.readFileSync(path.join(DOSSIER, id + '-historique.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)).slice(-jours);
  } catch { return []; }
}

module.exports = { relever, tous, dernier, historique, preparerJeton };
