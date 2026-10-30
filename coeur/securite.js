// Contrôles de sécurité vus de l'extérieur, sans Claude : fichiers qui ne devraient pas être publics, en-têtes, HTTPS.
const path = require('path');
const S = require('./stockage');

const F = path.join(S.DONNEES, 'securite.json');
const AGENT = 'Zylot-securite/1.0';

// Un fichier n'est déclaré exposé que si son contenu ressemble vraiment au fichier attendu (et pas à une page « introuvable » servie en 200).
const SENSIBLES = [
  { chemin: '/.git/HEAD', motif: /^ref: refs\//, quoi: 'le dépôt git (tout le code et son historique)' },
  { chemin: '/.git/config', motif: /\[core\]/, quoi: 'la configuration git' },
  { chemin: '/.env', motif: /^[A-Z][A-Z0-9_]*=\S/m, quoi: 'un fichier .env (mots de passe, clés)' },
  { chemin: '/config.local.php.bak', motif: /<\?php/, quoi: 'une copie lisible de la configuration' },
  { chemin: '/config.local.php~', motif: /<\?php/, quoi: 'une copie lisible de la configuration' },
  { chemin: '/config.php.bak', motif: /<\?php/, quoi: 'une copie lisible de la configuration' },
  { chemin: '/backup.sql', motif: /CREATE TABLE|INSERT INTO/i, quoi: 'une sauvegarde de la base' },
  { chemin: '/dump.sql', motif: /CREATE TABLE|INSERT INTO/i, quoi: 'une sauvegarde de la base' },
  { chemin: '/sql/', motif: /Index of \//i, quoi: 'la liste des fichiers SQL' },
  { chemin: '/data/', motif: /Index of \//i, quoi: 'la liste du dossier data' },
  { chemin: '/coeur/', motif: /Index of \//i, quoi: 'la liste du dossier coeur' },
  { chemin: '/deploy.sh', motif: /^#!/, quoi: 'le script de déploiement' },
  { chemin: '/.DS_Store', motif: /^\0\0\0\x01Bud1/, quoi: 'un .DS_Store (liste des fichiers du dossier)' },
  { chemin: '/phpinfo.php', motif: /PHP Version|phpinfo\(\)/, quoi: 'une page phpinfo (toute la configuration du serveur)' },
];

const ENTETES = [
  { nom: 'strict-transport-security', titre: 'HSTS', pourquoi: 'force le HTTPS dans le navigateur', points: 8 },
  { nom: 'x-content-type-options', titre: 'X-Content-Type-Options', pourquoi: 'empêche le navigateur de deviner le type des fichiers', points: 4 },
  { nom: 'x-frame-options', titre: 'Protection contre l\'intégration (X-Frame-Options)', pourquoi: 'empêche un autre site d\'afficher le vôtre dans un cadre piégé', points: 5, aussi: h => /frame-ancestors/i.test(h['content-security-policy'] || '') },
  { nom: 'content-security-policy', titre: 'Content-Security-Policy', pourquoi: 'limite les dégâts d\'une faille XSS', points: 6 },
  { nom: 'referrer-policy', titre: 'Referrer-Policy', pourquoi: 'évite de transmettre les adresses de vos pages à d\'autres sites', points: 2 },
];

async function obtenir(url, opts = {}) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': AGENT }, signal: AbortSignal.timeout(12000), ...opts });
    const buf = Buffer.from(await r.arrayBuffer());
    return { code: r.status, entetes: Object.fromEntries(r.headers), corps: buf.subarray(0, 20000).toString('latin1'), location: r.headers.get('location') };
  } catch (e) {
    const code = e.cause && e.cause.code;
    return { erreur: require('./surveillance').ERREURS[code] || code || e.message };
  }
}

async function controler(p) {
  const base = p.site.replace(/\/$/, '');
  const hote = new URL(base).hostname;
  const res = { quand: new Date().toISOString(), points: [] };
  const ajout = (gravite, titre, detail, retrait) => res.points.push({ gravite, titre, detail, retrait });

  // HTTPS : le site en http renvoie-t-il bien vers https ?
  const http = await obtenir('http://' + hote + '/', { redirect: 'manual' });
  res.redirigeHttps = !!(http.location && http.location.startsWith('https://'));
  if (!http.erreur && !res.redirigeHttps) ajout('securite', 'Pas de redirection vers HTTPS', `http://${hote} ne renvoie pas vers https://. Un visiteur peut rester en clair.`, 15);

  // En-têtes de la page d'accueil
  const accueil = await obtenir(base + '/');
  if (accueil.erreur) {
    // Sans page d'accueil, on ne peut rien juger d'autre : on le dit, sans compter de faux « en-têtes manquants ».
    ajout('urgent', 'Le site ne s\'ouvre pas en HTTPS', `${base} : ${accueil.erreur}. Les visiteurs voient une alerte de sécurité.`, 40);
    res.exposes = []; res.entetes = null; res.fichiersTestes = 0;
    return res;
  }
  const h = accueil.entetes || {};
  res.entetes = {};
  for (const e of ENTETES) {
    const present = !!(h[e.nom] || (e.aussi && e.aussi(h)));
    res.entetes[e.titre] = present;
    if (!present) ajout('info', `En-tête manquant : ${e.titre}`, `Il ${e.pourquoi}.`, e.points);
  }
  const fuite = [h['x-powered-by'], h['server']].filter(v => v && /\d/.test(v));
  if (fuite.length) ajout('info', 'Le serveur affiche ses versions', `En-têtes visibles : ${fuite.join(' · ')}. Ça aide un attaquant à cibler une faille connue.`, 4);

  // Fichiers sensibles
  res.exposes = [];
  for (const s of SENSIBLES) {
    const r = await obtenir(base + s.chemin, { redirect: 'manual' });
    if (r.code === 200 && s.motif.test(r.corps)) {
      res.exposes.push(s.chemin);
      ajout('urgent', `Fichier exposé : ${s.chemin}`, `N'importe qui peut lire ${s.quoi} à l'adresse ${base}${s.chemin}. À bloquer tout de suite (règle .htaccess ou suppression du fichier sur le serveur).`, 60);
    }
  }
  res.fichiersTestes = SENSIBLES.length;
  return res;
}

// Note de A à E : on part de 100 et on retire selon ce qui est trouvé, y compris les points ouverts de l'audit Claude.
function note(controle, cert, alertesAudit = []) {
  let score = 100;
  for (const pt of (controle && controle.points) || []) score -= pt.retrait;
  if (cert && cert.jours < 14) score -= 20;
  for (const a of alertesAudit) score -= a.gravite === 'urgent' ? 30 : a.gravite === 'securite' ? 8 : 0;
  score = Math.max(0, score);
  return { score, lettre: score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 40 ? 'D' : 'E' };
}

async function tour(prevenir) {
  const tous = S.lire(F, {});
  for (const p of S.projets().filter(p => p.site)) {
    const avant = tous[p.id];
    const r = await controler(p);
    tous[p.id] = r;
    for (const chemin of r.exposes) {
      if (!avant || !(avant.exposes || []).includes(chemin)) {
        S.journal(p.nom, `fichier exposé : ${chemin}`, 'urgent');
        prevenir && prevenir(`Faille sur ${p.nom}`, `${chemin} est lisible par tout le monde.`, true);
      }
    }
  }
  S.ecrire(F, tous);
  S.journal('Tous', 'contrôles de sécurité automatiques faits');
}

function derniers() { return S.lire(F, {}); }

module.exports = { tour, derniers, note };
