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

// Clés qui ne doivent jamais se trouver dans une page servie au navigateur. On ne garde que le type, jamais la valeur.
const SECRETS = [
  { quoi: 'clé Stripe secrète', motif: /\b(sk|rk)_live_[A-Za-z0-9]{16,}/ },
  { quoi: 'clé secrète Supabase', motif: /\bsb_secret_[A-Za-z0-9_-]{16,}/ },
  { quoi: 'clé AWS', motif: /\bAKIA[0-9A-Z]{16}\b/ },
  { quoi: 'clé OpenAI', motif: /\bsk-(proj-)?[A-Za-z0-9_-]{32,}/ },
  { quoi: 'clé Anthropic', motif: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { quoi: 'clé privée', motif: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
];
function jetonsDangereux(texte) {
  const trouves = [];
  for (const t of texte.match(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g) || []) {
    try {
      const d = JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString());
      if (d.role === 'service_role') trouves.push('clé Supabase service_role (accès total à la base)');
    } catch {}
  }
  for (const x of SECRETS) if (x.motif.test(texte)) trouves.push(x.quoi);
  return [...new Set(trouves)];
}

async function obtenir(url, opts = {}) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': AGENT }, signal: AbortSignal.timeout(12000), ...opts });
    const buf = Buffer.from(await r.arrayBuffer());
    return { code: r.status, entetes: Object.fromEntries(r.headers), corps: buf.subarray(0, opts.taille || 20000).toString('latin1'), location: r.headers.get('location') };
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
  if (!http.erreur && !res.redirigeHttps) ajout('securite', 'HTTPS en place, mais http:// ne redirige pas', `Le site marche bien en https://, mais quelqu'un qui tape http://${hote} (ou suit un vieux lien) reste sur la version non chiffrée : le serveur ne le renvoie pas vers https://. Les navigateurs récents corrigent souvent d'eux-mêmes, d'où l'impression que tout va bien. Trois lignes dans le .htaccess.`, 15);

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

  // Clés secrètes dans les pages publiques et leurs scripts (accueil, pages d'admin courantes, JavaScript du même site).
  res.secrets = [];
  const pages = ['/', '/admin.html', '/admin/', '/admin', '/dashboard.html', '/login.html'];
  const vues = new Set(), scripts = new Set();
  for (const chemin of pages) {
    const r = await obtenir(base + chemin, { taille: 3e6 });
    if (r.code !== 200 || !r.corps || vues.has(r.corps.length + chemin.length)) continue;
    vues.add(r.corps.length + chemin.length);
    for (const quoi of jetonsDangereux(r.corps)) res.secrets.push({ ou: base + chemin, quoi });
    for (const m of r.corps.matchAll(/<script[^>]+src=["']([^"']+\.js[^"']*)["']/gi)) {
      try { const u = new URL(m[1], base + chemin); if (u.hostname === hote && scripts.size < 10) scripts.add(u.href); } catch {}
    }
  }
  for (const u of scripts) {
    const r = await obtenir(u, { taille: 6e6 });
    if (r.code === 200) for (const quoi of jetonsDangereux(r.corps)) res.secrets.push({ ou: u, quoi });
  }
  for (const x of res.secrets) {
    ajout('urgent', `Clé secrète visible en ligne : ${x.quoi}`, `Elle est lisible par n'importe qui dans ${x.ou} (code source de la page). La changer tout de suite chez le fournisseur (l'ancienne est compromise), puis la retirer du site : une clé secrète ne doit jamais être dans une page web, seulement côté serveur.`, 60);
  }
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
    for (const x of r.secrets || []) {
      if (!avant || !(avant.secrets || []).some(y => y.ou === x.ou && y.quoi === x.quoi)) {
        S.journal(p.nom, `clé secrète visible en ligne : ${x.quoi}`, 'urgent');
        prevenir && prevenir(`Clé exposée sur ${p.nom}`, `${x.quoi} visible dans ${x.ou}`, true);
      }
    }
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

async function unProjet(p) {
  if (!p.site) return null;
  const tous = S.lire(F, {});
  tous[p.id] = await controler(p);
  S.ecrire(F, tous);
  return tous[p.id];
}

function derniers() { return S.lire(F, {}); }

module.exports = { tour, derniers, note, unProjet, jetonsDangereux };
